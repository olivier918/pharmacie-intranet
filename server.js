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

// ─── Load all data ───
app.get('/api/data', (req, res) => {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      res.json(JSON.parse(raw));
    } else {
      res.json(null); // No saved data yet — frontend will use defaults
    }
  } catch (err) {
    console.error('Erreur lecture données:', err.message);
    res.json(null);
  }
});

// ─── Save all data ───
app.post('/api/data', (req, res) => {
  try {
    // Ensure data directory exists
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // Write data with pretty print for readability
    fs.writeFileSync(DATA_FILE, JSON.stringify(req.body, null, 2), 'utf8');

    // Also keep a daily backup
    const today = new Date().toISOString().split('T')[0];
    const backupFile = path.join(dir, `backup-${today}.json`);
    if (!fs.existsSync(backupFile)) {
      fs.writeFileSync(backupFile, JSON.stringify(req.body, null, 2), 'utf8');
    }

    res.json({ ok: true, saved: new Date().toISOString() });
  } catch (err) {
    console.error('Erreur sauvegarde:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── Start server ───
app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   Pharmacie du Centre — Intranet                ║');
  console.log('║   Serveur démarré avec succès !                 ║');
  console.log('╠══════════════════════════════════════════════════╣');

  // Find local IP address
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
  console.log(`║   Sur ce poste :                                 ║`);
  console.log(`║   👉  http://localhost:${PORT}                     ║`);
  console.log(`║                                                  ║`);
  console.log(`║   Depuis les autres postes :                     ║`);
  console.log(`║   👉  http://${localIP}:${PORT}                    ║`);
  console.log(`║                                                  ║`);
  console.log('╠══════════════════════════════════════════════════╣');
  console.log('║   Ne fermez pas cette fenêtre.                  ║');
  console.log('║   Elle doit rester ouverte pour que             ║');
  console.log('║   l\'intranet fonctionne.                        ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');
});
