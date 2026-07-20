const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const maint = require('./maintenance');

const app = express();
const PORT = process.env.PORT || 3000;
// Identifiant de version : change à chaque déploiement Railway (commit) ou,
// en local, à chaque redémarrage du serveur. Sert à l'auto-rafraîchissement
// des postes (voir /api/version).
const BUILD_ID = process.env.RAILWAY_GIT_COMMIT_SHA || process.env.BUILD_ID || String(Date.now());
const DATA_FILE = path.join(__dirname, 'data', 'pharmacie-data.json');
const HISTORY_DIR = path.join(__dirname, 'data', 'history');
const MAX_HISTORY = 300; // nombre de snapshots conservés (anti-perte de données)

// Parse JSON bodies up to 50MB (for base64 images in preps)
app.use(express.json({ limit: '50mb' }));

// ─── Authentification (portail serveur) ───
// Ferme le trou « API ouverte » : protège /api/* et les pages tant qu'aucune
// session valide n'est présente. Désactivé si GATE_PASSWORD n'est pas défini
// (déploiement sans risque de blocage). N'affecte pas index.html.
const auth = require('./auth');
auth.install(app);            // routes /api/login, /api/logout (avant le portail)
app.use(auth.gate);           // portail : à placer avant le static et les routes /api de données
console.log(auth.AUTH_DISABLED
  ? '  🔓 Portail d\'accès DÉSACTIVÉ (définir GATE_PASSWORD pour l\'activer)'
  : '  🔒 Portail d\'accès ACTIF');

// Serve the frontend
// Fichiers statiques. Le HTML et le JS sont servis en "no-cache" : le
// navigateur revalide à chaque chargement (304 si inchangé, code frais après
// un déploiement). Combiné à /api/version, aucun poste ne reste sur du vieux code.
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (/\.(html|js)$/i.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
  }
}));

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
function sendViaBrevo({ to, cc, subject, text, from, attachments }) {
  return new Promise((resolve, reject) => {
    const https = require('https');
    const payload = JSON.stringify({
      sender: { email: from },
      to: [{ email: to }],
      cc: cc ? [{ email: cc }] : undefined,
      subject,
      textContent: text,
      // Brevo attend { name, content(base64) } — omis si aucune pièce jointe (rétro-compatible)
      attachment: (Array.isArray(attachments) && attachments.length)
        ? attachments.map(a => ({ name: a.name, content: a.content }))
        : undefined
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

// ─── Version déployée (pour l'auto-rafraîchissement des postes) ───
app.get('/api/version', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ version: BUILD_ID });
});

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
  const { to, cc, subject, text, attachments } = req.body || {};
  if (!to || !subject || !text) return res.status(400).json({ ok: false, error: 'Destinataire, objet et message sont requis.' });
  const from = mailFrom();
  if (!from) return res.status(400).json({ ok: false, error: 'Adresse expéditeur (MAIL_FROM) non configurée.' });
  // Normalisation des pièces jointes : on n'accepte que { name, content(base64) }, sans en-tête data:
  let atts = null;
  if (Array.isArray(attachments) && attachments.length) {
    atts = attachments
      .filter(a => a && a.name && a.content)
      .map(a => ({ name: String(a.name), content: String(a.content).replace(/^data:[^;]*;base64,/, '') }));
    if (!atts.length) atts = null;
  }
  try {
    if (mailMethod === 'brevo') {
      const r = await sendViaBrevo({ to, cc, subject, text, from, attachments: atts });
      return res.json({ ok: true, id: r.id });
    }
    const info = await mailTransport.sendMail({
      from, to, cc: cc || undefined, subject, text,
      attachments: atts ? atts.map(a => ({ filename: a.name, content: a.content, encoding: 'base64' })) : undefined
    });
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
      // Throttle : pas de nouvel instantané si le dernier est très récent (évite les doublons pendant l'édition)
      const last = await db.query('SELECT created_at FROM app_data_history ORDER BY id DESC LIMIT 1');
      if (last.rows.length) {
        const ageMin = (Date.now() - new Date(last.rows[0].created_at).getTime()) / 60000;
        if (ageMin < maint.HISTORY_MIN_INTERVAL_MIN) return;
      }
      const cur = await db.query('SELECT data FROM app_data WHERE id = 1');
      const data = cur.rows[0] && cur.rows[0].data;
      if (data && Object.keys(data).length > 0) {
        // Instantané ALLÉGÉ (sans les champs lourds régénérables)
        await db.query('INSERT INTO app_data_history (data) VALUES ($1)', [JSON.stringify(maint.slimForHistory(data))]);
        await db.query(
          `DELETE FROM app_data_history
             WHERE id NOT IN (SELECT id FROM app_data_history ORDER BY id DESC LIMIT ${MAX_HISTORY})`
        );
      }
    } else {
      if (fs.existsSync(DATA_FILE)) {
        if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });
        // Throttle : dernier snapshot trop récent ?
        const existing = fs.readdirSync(HISTORY_DIR).filter(f => f.startsWith('snapshot-')).sort();
        if (existing.length) {
          const newest = path.join(HISTORY_DIR, existing[existing.length - 1]);
          if ((Date.now() - fs.statSync(newest).mtimeMs) / 60000 < maint.HISTORY_MIN_INTERVAL_MIN) return;
        }
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        fs.writeFileSync(path.join(HISTORY_DIR, `snapshot-${ts}.json`), JSON.stringify(maint.slimForHistory(data)), 'utf8');
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

// ─── Fusion d'état ───
// Par rubrique : une rubrique absente de l'envoi n'est pas effacée (comportement existant).
// En plus, pour staffDB : fusion AU CHAMP par identifiant. Ainsi un poste qui renvoie un
// collaborateur sans sa signature (parce qu'il ne l'a pas encore reçue) n'écrase pas la
// signature (ni le RPPS, ni le PIN) enregistrée par un autre poste — la valeur existante
// est conservée quand l'envoi ne contient pas ce champ.
function mergeStaff(existingArr, incomingArr) {
  if (!Array.isArray(existingArr)) return incomingArr;
  if (!Array.isArray(incomingArr)) return existingArr;
  const byId = {};
  existingArr.forEach(r => { if (r && r.id != null) byId[r.id] = r; });
  return incomingArr.map(inc => (inc && inc.id != null && byId[inc.id]) ? Object.assign({}, byId[inc.id], inc) : inc);
}
// ── Sync : réconciliation par enregistrement + suppressions horodatées ──
// Union par id en conservant, pour chaque id, la version au `updatedAt` le plus récent,
// SANS perdre les enregistrements présents d'un seul côté et EN PRÉSERVANT l'ordre
// (ordre de `existing` d'abord, puis les nouveaux de `incoming`). Un poste en retard qui
// repousse une vieille copie ne peut donc plus écraser une modif plus récente d'un autre poste.
function mergeById(existingArr, incomingArr) {
  const inc = {};
  if (Array.isArray(incomingArr)) incomingArr.forEach(r => { if (r && r.id != null) inc[r.id] = r; });
  const seen = {};
  const out = [];
  if (Array.isArray(existingArr)) existingArr.forEach(r => {
    if (!r || r.id == null) { out.push(r); return; }
    if (seen[r.id]) return; seen[r.id] = 1;
    const i = inc[r.id];
    out.push((i && (i.updatedAt || 0) >= (r.updatedAt || 0)) ? i : r);
  });
  if (Array.isArray(incomingArr)) incomingArr.forEach(r => {
    if (!r || r.id == null) { out.push(r); return; }
    if (seen[r.id]) return; seen[r.id] = 1;
    out.push(r);
  });
  return out;
}
// Fusion des tombstones (suppressions horodatées) par collection+id, en gardant la date la plus récente.
// Purge des tombstones de plus de 90 j pour ne pas gonfler le blob indéfiniment.
const TOMB_TTL_MS = 90 * 24 * 3600 * 1000;
function mergeTombstones(a, b) {
  const m = {};
  const add = t => { if (t && t.id != null && t.c) { const k = t.c + '|' + t.id; if (!m[k] || (t.t || 0) > (m[k].t || 0)) m[k] = t; } };
  if (Array.isArray(a)) a.forEach(add);
  if (Array.isArray(b)) b.forEach(add);
  const cutoff = Date.now() - TOMB_TTL_MS;
  return Object.values(m).filter(t => (t.t || 0) >= cutoff);
}
// Retire d'une collection tout enregistrement couvert par un tombstone au moins aussi récent que sa dernière modif.
function applyTombstones(arr, tombs, coll) {
  if (!Array.isArray(arr) || !Array.isArray(tombs)) return arr;
  const byId = {};
  tombs.forEach(t => { if (t && t.c === coll && t.id != null) byId[t.id] = Math.max(byId[t.id] || 0, t.t || 0); });
  return arr.filter(r => !(r && r.id != null && byId[r.id] != null && (r.updatedAt || 0) <= byId[r.id]));
}

// Collections synchronisées « à id » : réconciliation par enregistrement + tombstones.
// (patients/medecins exclus : pas d'id stable — traités séparément par clé naturelle.)
const SYNCED_COLLS = ['deliveries', 'staffDB', 'threads', 'preps', 'bpmList', 'locations', 'credits', 'controles', 'retours', 'renouvellements', 'renouvArchives'];

function mergeState(existing, incoming) {
  const merged = Object.assign({}, existing, incoming);
  // Suppressions horodatées, communes à toutes les collections
  merged.tombstones = mergeTombstones(existing.tombstones, incoming.tombstones);
  SYNCED_COLLS.forEach(n => {
    if (!Array.isArray(existing[n]) && !Array.isArray(incoming[n])) return; // rubrique inutilisée : ne pas créer de tableau vide
    let arr;
    if (n === 'staffDB') {
      // staffDB : on conserve la fusion AU CHAMP par id (préserve signatures/RPPS/PIN) puis on applique les tombstones.
      arr = (Array.isArray(existing.staffDB) && Array.isArray(incoming.staffDB))
        ? mergeStaff(existing.staffDB, incoming.staffDB)
        : (incoming.staffDB || existing.staffDB);
    } else {
      arr = mergeById(existing[n], incoming[n]);
    }
    merged[n] = applyTombstones(arr, merged.tombstones, n);
  });
  return merged;
}

// ─── Load all data ───
app.get('/api/data', async (req, res) => {
  try {
    if (db) {
      // PostgreSQL
      const result = await db.query('SELECT data FROM app_data WHERE id = 1');
      if (result.rows.length > 0 && Object.keys(result.rows[0].data).length > 0) {
        return res.json(maint.pruneRetention(result.rows[0].data));
      }
      return res.json(null);
    } else {
      // Fichier local
      if (fs.existsSync(DATA_FILE)) {
        const raw = fs.readFileSync(DATA_FILE, 'utf8');
        return res.json(maint.pruneRetention(JSON.parse(raw)));
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
    const incoming = req.body || {};
    if (db) {
      // PostgreSQL — fusion au niveau des rubriques : un client sur une ancienne
      // version, qui n'envoie pas certaines rubriques (retours, bluestone,
      // contrôles, crédits…), ne doit PAS les effacer de la base.
      const cur = await db.query('SELECT data FROM app_data WHERE id = 1');
      const existing = (cur.rows[0] && cur.rows[0].data) || {};
      const merged = maint.pruneRetention(mergeState(existing, incoming));
      await db.query(
        'UPDATE app_data SET data = $1, updated_at = NOW() WHERE id = 1',
        [JSON.stringify(merged)]
      );
    } else {
      // Fichier local — même logique de fusion
      const dir = path.dirname(DATA_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      let existing = {};
      if (fs.existsSync(DATA_FILE)) { try { existing = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) {} }
      const merged = maint.pruneRetention(mergeState(existing, incoming));
      fs.writeFileSync(DATA_FILE, JSON.stringify(merged, null, 2), 'utf8');
      // Backup quotidien
      const today = new Date().toISOString().split('T')[0];
      const backupFile = path.join(dir, `backup-${today}.json`);
      if (!fs.existsSync(backupFile)) {
        fs.writeFileSync(backupFile, JSON.stringify(merged, null, 2), 'utf8');
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
  await snapshotCurrent();   // point de restauration AVANT la purge de rétention
  if (await maint.pruneStored(db, DATA_FILE)) {
    console.log('  🧹 Rétention : anciennes livraisons (>' + maint.DELIV_DAYS + 'j) / préparations (>' + maint.PREPS_DAYS + 'j) purgées au démarrage');
  }

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
