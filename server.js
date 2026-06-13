const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'pharmacie-data.json');

// Parse JSON bodies up to 50MB (for base64 images in preps)
app.use(express.json({ limit: '50mb' }));

// Serve the frontend
app.use(express.static(path.join(__dirname, 'public')));

// ─── DATABASE SETUP ───
let db = null;
const DATABASE_URL = process.env.DATABASE_URL;

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
    console.log('  🐘 Base PostgreSQL connectée !');
  } catch (err) {
    console.error('  ❌ Erreur connexion PostgreSQL:', err.message);
    console.log('  📁 Repli sur fichier local');
    db = null;
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

// ─── Start server ───
async function start() {
  await initDB();

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
