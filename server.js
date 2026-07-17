const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'pharmacie-data.json');
const HISTORY_DIR = path.join(__dirname, 'data', 'history');
const MAX_HISTORY = 300; // nombre de snapshots conservés (anti-perte de données)

// Parse JSON bodies up to 50MB (for base64 images in preps)
app.use(express.json({ limit: '50mb' }));

// Serve the frontend
app.use(express.static(path.join(__dirname, 'public')));

// ─── DATABASE SETUP ───
let db = null;
let dbError = null;      // dernier message d'erreur de connexion (diagnostic)
let dbConnectedAt = null;
const DATABASE_URL = process.env.DATABASE_URL;

// ─── ENVOI D'E-MAILS ───
// Deux méthodes possibles :
//   1) Brevo (API HTTPS, port 443) — recommandé sur hébergeur cloud (jamais bloqué). Variable BREVO_API_KEY.
//   2) SMTP direct (nodemailer) — souvent bloqué par les messageries mutualisées (Viaduc, etc.).
let mailMethod = null;      // 'brevo' | 'smtp' | null
let mailTransport = null;
let mailError = null;
function mailFrom() { return process.env.MAIL_FROM || process.env.SMTP_USER || process.env.BREVO_SENDER || null; }

function initMail() {
  if (process.env.BREVO_API_KEY) {
    mailMethod = 'brevo';
    mailError = null;
    console.log('  ✉️  Envoi via Brevo (API HTTPS) configuré');
    return;
  }
  const { SMTP_HOST, SMTP_USER, SMTP_PASS } = process.env;
  if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
    try {
      const nodemailer = require('nodemailer');
      const port = parseInt(process.env.SMTP_PORT || '587', 10);
      mailTransport = nodemailer.createTransport({
        host: SMTP_HOST,
        port,
        secure: process.env.SMTP_SECURE === 'true' || port === 465,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
        connectionTimeout: 12000, greetingTimeout: 12000, socketTimeout: 15000
      });
      mailMethod = 'smtp';
      mailError = null;
      console.log('  ✉️  Envoi SMTP configuré (' + SMTP_HOST + ')');
      return;
    } catch (err) {
      mailError = err.message;
      console.error('  ❌ Erreur configuration SMTP:', err.message);
    }
  }
  console.log('  ✉️  Aucun service d\'envoi configuré (ni Brevo ni SMTP)');
}

// Envoi via l'API HTTPS de Brevo
function sendViaBrevo({ to, cc, subject, text, from }) {
  return new Promise((resolve, reject) => {
    const https = require('https');
    const payload = JSON.stringify({
      sender: { email: from },
      to: [{ email: to }],
      cc: cc ? [{ email: cc }] : undefined,
      subject,
      textContent: text
    });
    const req = https.request({
      hostname: 'api.brevo.com', path: '/v3/smtp/email', method: 'POST',
      headers: {
        'api-key': process.env.BREVO_API_KEY,
        'content-type': 'application/json',
        'accept': 'application/json',
        'content-length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          let id = null; try { id = JSON.parse(body).messageId; } catch (e) {}
          resolve({ id });
        } else {
          let msg = body; try { msg = JSON.parse(body).message || body; } catch (e) {}
          reject(new Error('Brevo ' + res.statusCode + ' : ' + msg));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(new Error('Délai dépassé (Brevo injoignable)')); });
    req.write(payload);
    req.end();
  });
}

async function initDB() {
  if (!DATABASE_URL) {
    console.log('  📁 Mode fichier local (pas de DATABASE_URL)');
    return;
  }
  try {
    const { Pool } = require('pg');
    db = new Pool({
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    // Create table if not exists
    await db.query(`
      CREATE TABLE IF NOT EXISTS app_data (
        id INTEGER PRIMARY KEY DEFAULT 1,
        data JSONB NOT NULL DEFAULT '{}',
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    // Insert default row if empty
    await db.query(`
      INSERT INTO app_data (id, data) VALUES (1, '{}')
      ON CONFLICT (id) DO NOTHING
    `);
    // Historique automatique : chaque sauvegarde archive l'état précédent
    await db.query(`
      CREATE TABLE IF NOT EXISTS app_data_history (
        id BIGSERIAL PRIMARY KEY,
        data JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    dbError = null;
    dbConnectedAt = new Date().toISOString();
    console.log('  🐘 Base PostgreSQL connectée !');
  } catch (err) {
    dbError = err.message;
    console.error('  ❌ Erreur connexion PostgreSQL:', err.message);
    console.log('  📁 Repli sur fichier local');
    db = null;
  }
}

// ─── Diagnostic : mode réel + éventuelle erreur de connexion DB ───
app.get('/api/health', (req, res) => {
  res.json({
    mode: db ? 'postgresql' : 'fichier',
    hasDatabaseUrl: !!DATABASE_URL,
    dbConnectedAt,
    dbError,
    time: new Date().toISOString()
  });
});

// ─── Statut de l'envoi d'e-mails (le front active/désactive le bouton Envoyer) ───
app.get('/api/mail-status', (req, res) => {
  res.json({
    configured: mailMethod !== null,
    method: mailMethod,
    from: mailFrom(),
    error: mailError
  });
});

// ─── Envoi d'un e-mail (déclenché par l'utilisateur depuis l'appli) ───
app.post('/api/send-mail', async (req, res) => {
  if (!mailMethod) return res.status(400).json({ ok: false, error: 'Aucun service d\'envoi configuré sur le serveur.' });
  const { to, cc, subject, text } = req.body || {};
  if (!to || !subject || !text) return res.status(400).json({ ok: false, error: 'Destinataire, objet et message sont requis.' });
  const from = mailFrom();
  if (!from) return res.status(400).json({ ok: false, error: 'Adresse expéditeur (MAIL_FROM) non configurée.' });
  try {
    if (mailMethod === 'brevo') {
      const r = await sendViaBrevo({ to, cc, subject, text, from });
      return res.json({ ok: true, id: r.id });
    }
    const info = await mailTransport.sendMail({ from, to, cc: cc || undefined, subject, text });
    return res.json({ ok: true, id: info.messageId });
  } catch (err) {
    console.error('Envoi mail:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── Archive l'état ACTUEL avant qu'il ne soit remplacé (filet anti-écrasement) ───
async function snapshotCurrent() {
  try {
    if (db) {
      const cur = await db.query('SELECT data FROM app_data WHERE id = 1');
      const data = cur.rows[0] && cur.rows[0].data;
      if (data && Object.keys(data).length > 0) {
        await db.query('INSERT INTO app_data_history (data) VALUES ($1)', [JSON.stringify(data)]);
        // Purge : ne conserver que les MAX_HISTORY plus récents
        await db.query(
          `DELETE FROM app_data_history
             WHERE id NOT IN (SELECT id FROM app_data_history ORDER BY id DESC LIMIT ${MAX_HISTORY})`
        );
      }
    } else {
      if (fs.existsSync(DATA_FILE)) {
        if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        fs.copyFileSync(DATA_FILE, path.join(HISTORY_DIR, `snapshot-${ts}.json`));
        // Purge
        const files = fs.readdirSync(HISTORY_DIR).filter(f => f.startsWith('snapshot-')).sort();
        while (files.length > MAX_HISTORY) {
          fs.unlinkSync(path.join(HISTORY_DIR, files.shift()));
        }
      }
    }
  } catch (e) {
    console.warn('Snapshot historique:', e.message);
  }
}

// ─── Load all data ───
app.get('/api/data', async (req, res) => {
  try {
    if (db) {
      // PostgreSQL
      const result = await db.query('SELECT data FROM app_data WHERE id = 1');
      if (result.rows.length > 0 && Object.keys(result.rows[0].data).length > 0) {
        return res.json(result.rows[0].data);
      }
      return res.json(null);
    } else {
      // Fichier local
      if (fs.existsSync(DATA_FILE)) {
        const raw = fs.readFileSync(DATA_FILE, 'utf8');
        return res.json(JSON.parse(raw));
      }
      return res.json(null);
    }
  } catch (err) {
    console.error('Erreur lecture:', err.message);
    res.json(null);
  }
});

// ─── Save all data ───
app.post('/api/data', async (req, res) => {
  try {
    // On archive l'état existant AVANT de le remplacer
    await snapshotCurrent();
    if (db) {
      // PostgreSQL
      await db.query(
        'UPDATE app_data SET data = $1, updated_at = NOW() WHERE id = 1',
        [JSON.stringify(req.body)]
      );
    } else {
      // Fichier local
      const dir = path.dirname(DATA_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify(req.body, null, 2), 'utf8');
      // Backup quotidien
      const today = new Date().toISOString().split('T')[0];
      const backupFile = path.join(dir, `backup-${today}.json`);
      if (!fs.existsSync(backupFile)) {
        fs.writeFileSync(backupFile, JSON.stringify(req.body, null, 2), 'utf8');
      }
    }
    res.json({ ok: true, saved: new Date().toISOString() });
  } catch (err) {
    console.error('Erreur sauvegarde:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── Liste des snapshots d'historique ───
app.get('/api/backups', async (req, res) => {
  try {
    if (db) {
      const r = await db.query('SELECT id, created_at FROM app_data_history ORDER BY id DESC LIMIT 300');
      return res.json(r.rows);
    } else {
      if (!fs.existsSync(HISTORY_DIR)) return res.json([]);
      const files = fs.readdirSync(HISTORY_DIR).filter(f => f.startsWith('snapshot-')).sort().reverse();
      return res.json(files.map(f => ({ id: f, created_at: f.replace('snapshot-', '').replace('.json', '') })));
    }
  } catch (err) {
    console.error('Erreur liste backups:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Contenu d'un snapshot (pour consultation / restauration manuelle) ───
app.get('/api/backups/:id', async (req, res) => {
  try {
    if (db) {
      const r = await db.query('SELECT data FROM app_data_history WHERE id = $1', [req.params.id]);
      return res.json(r.rows.length ? r.rows[0].data : null);
    } else {
      const fp = path.join(HISTORY_DIR, path.basename(req.params.id));
      if (!fs.existsSync(fp)) return res.json(null);
      return res.json(JSON.parse(fs.readFileSync(fp, 'utf8')));
    }
  } catch (err) {
    console.error('Erreur lecture backup:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Start server ───
async function start() {
  await initDB();
  initMail();

  app.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║   Pharmacie du Centre — Intranet                ║');
    console.log('║   Serveur démarré avec succès !                 ║');
    console.log('╠══════════════════════════════════════════════════╣');

    const nets = os.networkInterfaces();
    let localIP = 'localhost';
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          localIP = net.address;
          break;
        }
      }
    }

    console.log(`║                                                  ║`);
    console.log(`║   👉  http://localhost:${PORT}                     ║`);
    console.log(`║   👉  http://${localIP}:${PORT}                    ║`);
    console.log(`║                                                  ║`);
    console.log(`║   Base : ${db ? 'PostgreSQL ✅' : 'Fichier local 📁'}            ║`);
    console.log('╠══════════════════════════════════════════════════╣');
    console.log('║   Ne fermez pas cette fenêtre.                  ║');
    console.log('╚══════════════════════════════════════════════════╝');
    console.log('');
  });
}

start();
