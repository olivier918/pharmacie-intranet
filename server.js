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
const BUILD_ID = process.env.RAILWAY_GIT_COMMIT_SHA || process.env.SOURCE_VERSION || process.env.BUILD_ID || String(Date.now());
const DATA_FILE = path.join(__dirname, 'data', 'pharmacie-data.json');
const HISTORY_DIR = path.join(__dirname, 'data', 'history');
const MAX_HISTORY = 300; // nombre de snapshots conservés (anti-perte de données)

// ─── Webhook de paiement (Stripe) ───
// DOIT être déclaré AVANT express.json() et AVANT le portail d'authentification :
// la signature Stripe se vérifie sur le corps BRUT, et Stripe n'a pas de session.
// La route est protégée par sa signature cryptographique, pas par le portail.
const paiement = require('./paiement');
paiement.installWebhook(app, express, { onPaid: marquerCreditPaye });

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

// Page dédiée du module Planning : /planning (adresse propre, sans .html).
// C'est un client indépendant de la même base — il ne renvoie que ses rubriques.
app.get('/planning', (req, res) => res.sendFile(path.join(__dirname, 'public', 'planning.html')));

// ─── DATABASE SETUP ───
let db = null;
let dbError = null;      // dernier message d'erreur de connexion (diagnostic)
let dbConnectedAt = null;
const DATABASE_URL = process.env.DATABASE_URL;

// ─── Politique de persistance ─────────────────────────────────────────────
// Sur un hebergeur (Scalingo, Railway, Heroku...), le disque du conteneur est
// EPHEMERE : il revient a l'etat du depot Git a chaque deploiement, chaque
// redemarrage et chaque deplacement de la machine. Une ecriture dans data/ y
// disparait sans le moindre message. La regle est donc sans exception :
//   - DATABASE_URL definie -> PostgreSQL obligatoire, aucun repli sur disque.
//   - DATABASE_URL absente -> installation locale (PC de l'officine), mode fichier.
// REQUIRE_DB=1 couvre le dernier cas dangereux : la variable oubliee sur l'hebergeur.
const REQUIRE_DB = process.env.REQUIRE_DB === '1';
const MODE_HEBERGE = !!DATABASE_URL || REQUIRE_DB;

// Garde-fou : toute ecriture disque de donnees metier passe par ici. En mode
// heberge elle echoue bruyamment plutot que d'ecrire dans le vide. Le poste
// recoit alors une erreur et affiche « Modifications NON enregistrees » —
// mille fois preferable a une sauvegarde silencieuse qui sera effacee.
function refuserDisque(operation) {
  if (MODE_HEBERGE) {
    throw new Error(
      'Ecriture disque refusee (' + operation + ') : serveur en mode heberge, ' +
      'les donnees doivent etre ecrites en base PostgreSQL.'
    );
  }
}

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

function logSmsStatus() {
  if (smsConfigured()) {
    const brut = (process.env.BREVO_SMS_SENDER || '').trim();
    const net = smsSender();
    console.log('  📱 Envoi SMS via Brevo configuré (expéditeur « ' + net + ' »)');
    if (net !== brut) {
      console.log('  ⚠️  BREVO_SMS_SENDER « ' + brut + ' » n\'est pas conforme à la charte AF2M : envoyé sous « ' + net + ' ».');
      console.log('     Alignez la variable sur cette valeur pour éviter toute ambiguïté.');
    }
  }
  else if (process.env.BREVO_API_KEY) console.log('  📱 Envoi SMS inactif : définir BREVO_SMS_SENDER (lettres et chiffres uniquement, 11 caractères max, pas uniquement des chiffres)');
  else console.log('  📱 Envoi SMS inactif (pas de BREVO_API_KEY)');
}

// Envoi via l'API HTTPS de Brevo
function sendViaBrevo({ to, cc, subject, text, from, attachments }) {
  return new Promise((resolve, reject) => {
    const https = require('https');
    const payload = JSON.stringify({
      sender: { email: from },
      // `to` et `cc` arrivent deja normalises en tableaux d'adresses valides
      // (voir destinataires() cote route). Brevo attend un objet par adresse.
      to: (Array.isArray(to) ? to : [to]).map(e => ({ email: e })),
      cc: (Array.isArray(cc) ? cc : (cc ? [cc] : [])).length
        ? (Array.isArray(cc) ? cc : [cc]).map(e => ({ email: e }))
        : undefined,
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
    if (REQUIRE_DB) {
      console.error('');
      console.error('  ⛔ REQUIRE_DB=1 mais DATABASE_URL est absente : arret du serveur.');
      console.error('     Le disque de ce serveur est ephemere. Demarrer en mode fichier');
      console.error('     ferait perdre toute la saisie au prochain redemarrage.');
      console.error('');
      process.exit(1);
    }
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
    db = null;
    console.error('');
    console.error('  ⛔ Connexion PostgreSQL impossible :', err.message);
    console.error('     AUCUN repli sur le disque : il est ephemere sur un hebergeur,');
    console.error('     la saisie de la journee y serait perdue en silence.');
    console.error('     Le serveur s\'arrete ; la plateforme le relancera.');
    console.error('');
    process.exit(1);
  }
}

// ─── Configuration publique lue par le front ───
// RENOUV_BASE_URL : adresse sous laquelle les liens envoyes aux PATIENTS sont
// construits (ex. https://renouvellement.pharmacie-mondeville.fr). Elle doit
// pointer sur ce meme serveur — c'est un simple alias, pas un autre service.
// Non definie, le front retombe sur l'adresse courante : le lien reste valide,
// il porte seulement le nom du back-office.
function renouvBase() {
  const v = (process.env.RENOUV_BASE_URL || '').trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(v) ? v : null;
}
app.get('/api/config', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ renouvBase: renouvBase() });
});

// ─── Version déployée (pour l'auto-rafraîchissement des postes) ───
app.get('/api/version', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ version: BUILD_ID });
});

// ─── SONNETTE COMPTOIR (temps réel, SSE) ───
// Un poste appuie sur la sonnette → tous les postes « récepteurs » sonnent.
// Technique : Server-Sent Events (flux HTTP maintenu ouvert). Aucune dépendance
// supplémentaire, aucun port à ouvrir : le poste écoute /api/sonnette/stream et
// reçoit l'événement dans la seconde.
const sonnetteClients = new Map();   // id -> { res, nom, rx }
let sonnetteLast = null;

function sonnetteCount() { let n = 0; sonnetteClients.forEach(c => { if (c.rx) n++; }); return n; }

app.get('/api/sonnette/stream', (req, res) => {
  const id  = String(req.query.id || Math.random().toString(36).slice(2)).slice(0, 40);
  const nom = String(req.query.nom || '').slice(0, 40);
  const rx  = req.query.rx !== '0';
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  if (res.flushHeaders) res.flushHeaders();
  res.write('retry: 3000\n\n');
  res.write('event: hello\ndata: ' + JSON.stringify({ id, recepteurs: sonnetteCount() }) + '\n\n');

  // Un même poste qui se reconnecte remplace son ancien flux (pas de doublon).
  const old = sonnetteClients.get(id);
  if (old && old.res !== res) { try { old.res.end(); } catch (_) {} }
  sonnetteClients.set(id, { res, nom, rx });

  // Battement de cœur : empêche proxys et hébergeurs de couper le flux.
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (_) {} }, 25000);
  req.on('close', () => {
    clearInterval(ping);
    const cur = sonnetteClients.get(id);
    if (cur && cur.res === res) sonnetteClients.delete(id);
  });
});

// Trois natures d'appel. La sonnette du comptoir prévient les postes qui se sont
// déclarés « récepteurs » ; un appel du comptoir avancé s'affiche sur TOUS les
// postes connectés — c'est une personne qui demande du renfort, pas un client
// qui patiente.
const SONNETTE_TYPES = {
  comptoir:     'Sonnette comptoir',
  aide:         'Aide au comptoir avancé',
  remplacement: 'Remplacement au comptoir avancé'
};

app.post('/api/sonnette', (req, res) => {
  const b = req.body || {};
  const type = SONNETTE_TYPES[b.type] ? b.type : 'comptoir';
  const evt = {
    id:    'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    type,
    par:   String(b.par || '').slice(0, 60) || 'Un poste',
    poste: String(b.poste || '').slice(0, 40),
    src:   String(b.src || '').slice(0, 40),
    ts:    Date.now()
  };
  sonnetteLast = evt;
  const payload = 'event: ring\ndata: ' + JSON.stringify(evt) + '\n\n';
  let prevenus = 0;
  sonnetteClients.forEach((c, id) => {
    if (id === evt.src) return;
    if (type === 'comptoir' && !c.rx) return;
    try { c.res.write(payload); prevenus++; } catch (_) { sonnetteClients.delete(id); }
  });
  console.log('  🔔 ' + SONNETTE_TYPES[type] + ' par ' + evt.par + ' → ' + prevenus + ' poste(s)');
  res.json({ ok: true, id: evt.id, type, prevenus, recepteurs: sonnetteCount(), postes: sonnetteClients.size, ts: evt.ts });
});

// « J'y vais » : referme l'alerte sur tous les postes et prévient l'appelant de
// qui arrive, pour que deux personnes ne se déplacent pas en même temps.
app.post('/api/sonnette/repondre', (req, res) => {
  const b = req.body || {};
  const evt = {
    id:  String(b.id || '').slice(0, 40),
    par: String(b.par || '').slice(0, 60) || 'Un collègue',
    ts:  Date.now()
  };
  if (sonnetteLast && sonnetteLast.id === evt.id) sonnetteLast.repondu = evt;
  const payload = 'event: answer\ndata: ' + JSON.stringify(evt) + '\n\n';
  sonnetteClients.forEach((c, id) => {
    try { c.res.write(payload); } catch (_) { sonnetteClients.delete(id); }
  });
  console.log('  ✅ ' + evt.par + ' répond à l\'appel ' + evt.id);
  res.json({ ok: true });
});

// Repli : si le flux a été coupé (veille du poste, proxy), le poste interroge
// le dernier appel au réveil et rattrape une sonnerie manquée.
app.get('/api/sonnette/last', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(sonnetteLast || {});
});

// ─── Diagnostic : mode réel + éventuelle erreur de connexion DB ───
app.get('/api/health', (req, res) => {
  res.json({
    mode: db ? 'postgresql' : 'fichier',
    heberge: MODE_HEBERGE,
    degrade: MODE_HEBERGE && !db,
    sessionSecret: !!process.env.SESSION_SECRET,
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
// Normalise un destinataire : accepte une chaine ou un tableau, retire les
// entrees vides, refuse ce qui ne ressemble pas a une adresse.
// Les retours chariot sont exclus par la regex : injectes dans un en-tete
// SMTP, ils permettraient d'ajouter des destinataires caches au message.
const ADRESSE_OK = /^[^\s@,;:<>"\r\n]+@[^\s@,;:<>"\r\n]+\.[A-Za-z]{2,}$/;
function destinataires(v) {
  const brut = Array.isArray(v) ? v : String(v == null ? '' : v).split(/[,;]/);
  const vus = new Set();
  return brut
    .map(a => String(a || '').trim())
    .filter(a => a && ADRESSE_OK.test(a) && !vus.has(a.toLowerCase()) && vus.add(a.toLowerCase()))
    .slice(0, 10);
}
app.post('/api/send-mail', async (req, res) => {
  if (!mailMethod) return res.status(400).json({ ok: false, error: 'Aucun service d\'envoi configuré sur le serveur.' });
  const { subject, text, attachments } = req.body || {};
  const to = destinataires((req.body || {}).to);
  const cc = destinataires((req.body || {}).cc);
  if (!to.length) return res.status(400).json({ ok: false, error: 'Aucune adresse destinataire valide.' });
  if (!subject || !text) return res.status(400).json({ ok: false, error: 'Objet et message sont requis.' });
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
      return res.json({ ok: true, id: r.id, to });
    }
    const info = await mailTransport.sendMail({
      from, to, cc: cc.length ? cc : undefined, subject, text,
      attachments: atts ? atts.map(a => ({ filename: a.name, content: a.content, encoding: 'base64' })) : undefined
    });
    return res.json({ ok: true, id: info.messageId });
  } catch (err) {
    console.error('Envoi mail:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── ENVOI DE SMS (Brevo, API HTTPS) ───
// Même clé API que les e-mails (BREVO_API_KEY). L'expéditeur alphanumérique
// (11 caractères max) doit être déclaré et validé côté Brevo : BREVO_SMS_SENDER.
// SMS « transactionnels » uniquement : rappels sur un dossier ouvert du patient.
// Identifiant d'expéditeur alphanumérique, mis en conformité avec la charte
// AF2M applicable en France depuis le 1er mars 2026 : uniquement des lettres
// latines et des chiffres (ni accent, ni espace, ni caractère spécial), 11
// caractères maximum, et jamais un identifiant purement numérique (il serait
// pris pour un numéro de téléphone). Un expéditeur non conforme passe l'API
// sans erreur puis se fait filtrer par l'opérateur : le SMS reste au statut
// « sent » chez Brevo et n'arrive jamais. On nettoie donc avant d'envoyer.
function smsSender() {
  const brut = (process.env.BREVO_SMS_SENDER || '').trim();
  if (!brut) return null;
  const v = brut
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // é → e, à → a…
    .replace(/[^A-Za-z0-9]/g, '')                        // espaces et ponctuation retirés
    .slice(0, 11);
  if (!v) return null;
  if (/^\d+$/.test(v)) return null;                      // purement numérique : refusé par la charte
  return v;
}
function smsConfigured() { return !!process.env.BREVO_API_KEY && !!smsSender(); }

// 06 12 34 56 78 · +33 6 12 … · 0033612345678 → 33612345678.
// Renvoie null pour un fixe, un numéro étranger ou un numéro incomplet.
function toMsisdnFR(raw) {
  let n = String(raw || '').replace(/[^\d+]/g, '');
  if (n.startsWith('+')) n = n.slice(1);
  else if (n.startsWith('00')) n = n.slice(2);
  if (/^0[67]\d{8}$/.test(n)) n = '33' + n.slice(1);
  return /^33[67]\d{8}$/.test(n) ? n : null;
}

function sendSmsViaBrevo({ to, text, tag }) {
  return new Promise((resolve, reject) => {
    const https = require('https');
    const payload = JSON.stringify({
      sender: smsSender(),
      recipient: to,
      content: text,
      type: 'transactional',
      tag: tag || undefined
    });
    const req = https.request({
      hostname: 'api.brevo.com', path: '/v3/transactionalSMS/send', method: 'POST',
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
          let id = null, credits = null;
          try { const j = JSON.parse(body); id = j.messageId || j.reference || null; credits = j.remainingCredits; } catch (e) {}
          resolve({ id, credits });
        } else {
          let msg = body; try { msg = JSON.parse(body).message || body; } catch (e) {}
          reject(new Error('Brevo SMS ' + res.statusCode + ' : ' + msg));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(new Error('Délai dépassé (Brevo SMS)')); });
    req.write(payload);
    req.end();
  });
}

// ─── Statut SMS (le front active/désactive le bouton « Envoyer le SMS ») ───
app.get('/api/sms-status', (req, res) => {
  res.json({
    configured: smsConfigured(),
    sender: smsSender(),
    error: !process.env.BREVO_API_KEY ? 'Clé API Brevo absente (BREVO_API_KEY).'
         : !smsSender() ? 'Expéditeur SMS non configuré (BREVO_SMS_SENDER).'
         : null
  });
});

// ─── Envoi d'un SMS, déclenché par l'utilisateur depuis l'appli ───
app.post('/api/send-sms', async (req, res) => {
  if (!smsConfigured()) return res.status(400).json({ ok: false, error: 'Service SMS non configuré sur le serveur (BREVO_API_KEY + BREVO_SMS_SENDER).' });
  const { to, text, tag } = req.body || {};
  const msisdn = toMsisdnFR(to);
  if (!msisdn) return res.status(400).json({ ok: false, error: 'Numéro de mobile invalide (attendu : 06…, 07… ou +33…).' });
  const body = String(text || '').trim();
  if (!body) return res.status(400).json({ ok: false, error: 'Le message est vide.' });
  if (body.length > 640) return res.status(400).json({ ok: false, error: 'Message trop long (640 caractères maximum, soit 4 SMS).' });
  try {
    const r = await sendSmsViaBrevo({ to: msisdn, text: body, tag: tag || 'intranet' });
    return res.json({ ok: true, id: r.id, credits: r.credits, to: msisdn });
  } catch (err) {
    console.error('Envoi SMS:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── Routes du paiement en ligne (protégées par le portail) ───
paiement.installApi(app);

// ─── Passage d'un crédit en « soldé » après encaissement en ligne ───
// Appelé par le webhook Stripe (signature déjà vérifiée). Lecture-modification-
// écriture sur l'état courant. `updatedAt` est réhaussé pour que la fusion par
// enregistrement (mergeById) fasse gagner cette version sur la copie qu'un poste
// resté ouvert pourrait renvoyer ensuite. Renvoie true si un dossier a été modifié.
async function marquerCreditPaye(creditId, info) {
  const appliquer = (data) => {
    if (!data || !Array.isArray(data.credits)) return false;
    const c = data.credits.find((x) => x && String(x.id) === String(creditId));
    if (!c) return false;
    const p = c.paiement || {};
    if (p.status === 'paye' && p.ref === info.ref) return false;   // déjà encaissé (doublon d'événement)
    c.paiement = Object.assign({}, p, {
      status: 'paye',
      ref: info.ref,
      paidAt: info.at,
      montantPaye: info.montant
    });
    // On s'arrête à « payé » : l'argent est encaissé sur Stripe, mais la vente
    // n'est pas soldée dans Winpharma. Passer directement à « soldé » ferait
    // disparaître le dossier de la liste active et la saisie serait oubliée.
    // La clôture est un geste humain, confirmé depuis l'intranet.
    c.status = 'payé';
    c.updatedAt = Date.now();
    return true;
  };

  if (db) {
    const cur = await db.query('SELECT data FROM app_data WHERE id = 1');
    const data = (cur.rows[0] && cur.rows[0].data) || {};
    if (!appliquer(data)) return false;
    await db.query('UPDATE app_data SET data = $1, updated_at = NOW() WHERE id = 1', [JSON.stringify(data)]);
    return true;
  }
  refuserDisque('credit paye');
  if (!fs.existsSync(DATA_FILE)) return false;
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  if (!appliquer(data)) return false;
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  return true;
}

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
      refuserDisque('snapshot historique');
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
// staffDB : fusion AU CHAMP par id (préserve PIN, signature, RPPS, photo), mais surtout UNION.
// Avant, cette fonction renvoyait la seule liste entrante : un poste dont l'onglet datait
// d'avant la création d'un collaborateur le faisait disparaître pour tout le monde à sa
// première sauvegarde, sans qu'aucune suppression n'ait été demandée. Un collaborateur ne
// doit sortir de la liste que par une suppression explicite, c'est-à-dire un tombstone.
function mergeStaff(existingArr, incomingArr) {
  if (!Array.isArray(existingArr)) return incomingArr;
  if (!Array.isArray(incomingArr)) return existingArr;
  const inc = {};
  incomingArr.forEach(r => { if (r && r.id != null) inc[r.id] = r; });
  const seen = {};
  const out = [];
  existingArr.forEach(r => {
    if (!r || r.id == null) { out.push(r); return; }
    if (seen[r.id]) return; seen[r.id] = 1;
    const i = inc[r.id];
    if (!i) { out.push(r); return; }                    // absent de l'envoi : on le garde
    // champ par champ ; à égalité l'entrant gagne, mais une version serveur plus récente
    // n'est pas écrasée par un onglet en retard (ex. un PIN modifié entre-temps)
    out.push(((i.updatedAt || 0) >= (r.updatedAt || 0))
      ? Object.assign({}, r, i)
      : Object.assign({}, i, r));
  });
  incomingArr.forEach(r => {
    if (!r || r.id == null) { out.push(r); return; }
    if (seen[r.id]) return; seen[r.id] = 1;
    out.push(r);                                        // nouveau collaborateur
  });
  return out;
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
const SYNCED_COLLS = ['deliveries', 'staffDB', 'threads', 'preps', 'bpmList', 'locations', 'locTypes', 'credits', 'controles', 'retours', 'renouvellements', 'renouvArchives', 'patients', 'medecins', 'smsLog', 'smsTemplates',
  // Module Planning (Lot 1) : collections à id, fusion par enregistrement + tombstones
  'plPostes', 'plRotations', 'plContrats', 'plTrames', 'plExceptions', 'plDemandes', 'plReels', 'plNotifs', 'plClotures',
  'plHeuresSup', 'plAbsences', 'plEchanges',
  // Module Dépannage : bons de commande envoyés aux dépositaires
  'depannages',
  // Journal d'activite : append-only, jamais modifie apres coup — la fusion par
  // id garantit que les actions de deux postes se cumulent au lieu de s'ecraser.
  'journal'];

// ── caisse : conteneur (réglages + sous-listes à id) ──
// La caisse n'est pas une collection plate : c'est un objet qui contient des
// réglages scalaires (seuils), un fond de monnaie (monnaie.fond) ET plusieurs
// journaux à id : relevés du soir, remises en banque, ajustements d'écart,
// commandes de monnaie. Avant, la caisse entière était remplacée par le dernier
// envoi (dernier-écrit-gagne) → un poste en retard écrasait les écritures d'un
// autre (relevé qui « disparaît » d'un poste à l'autre). On fusionne désormais
// FINEMENT chaque journal par id (union + updatedAt le plus récent), comme les
// autres collections. Les réglages et monnaie.fond restent en dernier-écrit-gagne
// (faible fréquence, valeur d'officine et non par-enregistrement).
const CAISSE_SUBS = ['releves', 'remises', 'ajustements', 'commandesMonnaie'];
function mergeCaisse(existing, incoming) {
  if (!existing || typeof existing !== 'object') return incoming;
  if (!incoming || typeof incoming !== 'object') return existing;
  const out = Object.assign({}, existing, incoming); // réglages + monnaie.fond : dernier envoi
  CAISSE_SUBS.forEach(sub => {
    if (!Array.isArray(existing[sub]) && !Array.isArray(incoming[sub])) return;
    out[sub] = mergeById(existing[sub], incoming[sub]);
  });
  return out;
}

// ── plParams (module Planning) : conteneur, comme la caisse ──
// Réglages scalaires (pas d'ouverture, règles CCN) en dernier-écrit-gagne,
// sous-listes à id fusionnées finement (clé tombstone 'plParams.<sub>').
const PLPARAMS_SUBS = ['periodes', 'seuilsComptoir', 'seuilsPharmaciens', 'seuilsPostes', 'motifsAbsence'];
function mergePlParams(existing, incoming) {
  if (!existing || typeof existing !== 'object') return incoming;
  if (!incoming || typeof incoming !== 'object') return existing;
  const out = Object.assign({}, existing, incoming);
  PLPARAMS_SUBS.forEach(sub => {
    if (!Array.isArray(existing[sub]) && !Array.isArray(incoming[sub])) return;
    out[sub] = mergeById(existing[sub], incoming[sub]);
  });
  return out;
}

// patients/medecins n'ont pas d'id stocké : on leur en assigne un DÉTERMINISTE par clé naturelle
// (patient = nom|prénom, médecin = nom), identique sur tous les postes. Idempotent, et sans écraser
// un id déjà présent (un patient renommé garde son id d'origine).
function ensureNatIds(coll, arr) {
  if (!Array.isArray(arr)) return arr;
  arr.forEach(r => {
    if (r && r.id == null) {
      r.id = (coll === 'patients')
        ? ('pt:' + (r.nom || '') + '|' + (r.prenom || ''))
        : ('md:' + (r.nom || ''));
    }
  });
  return arr;
}

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
      if (n === 'patients' || n === 'medecins') { ensureNatIds(n, existing[n]); ensureNatIds(n, incoming[n]); }
      arr = mergeById(existing[n], incoming[n]);
    }
    merged[n] = applyTombstones(arr, merged.tombstones, n);
  });
  // caisse : fusion fine des journaux + suppressions horodatées (clé 'caisse.<sub>')
  if (existing.caisse || incoming.caisse) {
    const c = mergeCaisse(existing.caisse, incoming.caisse);
    if (c && typeof c === 'object') {
      CAISSE_SUBS.forEach(sub => {
        if (Array.isArray(c[sub])) c[sub] = applyTombstones(c[sub], merged.tombstones, 'caisse.' + sub);
      });
    }
    merged.caisse = c;
  }
  // plParams (module Planning) : fusion fine des sous-listes + tombstones 'plParams.<sub>'
  if (existing.plParams || incoming.plParams) {
    const p = mergePlParams(existing.plParams, incoming.plParams);
    if (p && typeof p === 'object') {
      PLPARAMS_SUBS.forEach(sub => {
        if (Array.isArray(p[sub])) p[sub] = applyTombstones(p[sub], merged.tombstones, 'plParams.' + sub);
      });
    }
    merged.plParams = p;
  }
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
    // Surtout PAS `res.json(null)` : un 200 au corps vide, le poste le lit comme
    // « la base est vide », il s'autorise a sauvegarder et ecrase l'etat reel.
    // Un 503 verrouille les sauvegardes cote client (_loadedOK reste a false).
    console.error('Erreur lecture:', err.message);
    res.status(503).json({ ok: false, error: 'Base de donnees injoignable' });
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
      refuserDisque('sauvegarde /api/data');
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

// ══════════════════════════════════════════════════════════════════════════
//  CONFIRMATION DU RENOUVELLEMENT PAR LE PATIENT (page publique, sans compte)
//  ────────────────────────────────────────────────────────────────────────
//  Le patient reçoit par SMS un lien /r/<jeton>. Le jeton est aléatoire (128
//  bits), à usage unique, et ne donne accès qu'à SA demande : ni la liste des
//  patients, ni les autres ordonnances ne sont joignables par cette route.
//  La page ne renvoie au patient que son prénom, l'échéance et le téléphone de
//  l'officine — jamais le nom du traitement, qui n'a pas à circuler sur le web.
//  La décision est DÉFINITIVE : une fois enregistrée, le lien ne fait plus que
//  la rappeler, en invitant à appeler l'officine pour la modifier.
// ══════════════════════════════════════════════════════════════════════════
const RENOUV_OFFICINE = { nom: 'Pharmacie du Centre', tel: '02 31 52 15 71' };

app.get('/r/:token', (req, res) => res.sendFile(path.join(__dirname, 'public', 'renouv.html')));

async function renouvLire() {
  if (db) { const r = await db.query('SELECT data FROM app_data WHERE id = 1'); return (r.rows[0] && r.rows[0].data) || {}; }
  if (fs.existsSync(DATA_FILE)) { try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) { return {}; } }
  return {};
}
async function renouvEcrire(etat) {
  if (db) { await db.query('UPDATE app_data SET data = $1, updated_at = NOW() WHERE id = 1', [JSON.stringify(etat)]); return; }
  refuserDisque('confirmation renouvellement');
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(etat, null, 2), 'utf8');
}
// Les réponses des patients arrivent une par une mais peuvent se croiser : on les
// sérialise pour qu'une lecture-modification-écriture n'en efface jamais une autre.
let _renouvFile = Promise.resolve();
function renouvSerialise(fn) { const p = _renouvFile.then(fn, fn); _renouvFile = p.catch(() => { }); return p; }

function renouvParJeton(etat, token) {
  const arr = Array.isArray(etat.renouvellements) ? etat.renouvellements : [];
  return arr.find(r => r && r.conf && r.conf.token === token) || null;
}
function renouvVue(rec) {
  const c = rec.conf || {};
  return {
    ok: true,
    officine: RENOUV_OFFICINE.nom,
    tel: RENOUV_OFFICINE.tel,
    prenom: rec.prenom || '',
    echeance: rec.date || '',
    repondu: !!c.choix,
    choix: c.choix || null,
    dateChoisie: c.dateChoisie || null,
    repondule: c.at || null
  };
}

app.get('/api/renouv/:token', async (req, res) => {
  try {
    const etat = await renouvLire();
    const rec = renouvParJeton(etat, String(req.params.token || ''));
    if (!rec) return res.status(404).json({ ok: false, error: 'lien_inconnu' });
    res.json(renouvVue(rec));
  } catch (e) {
    console.error('Renouv (lecture):', e.message);
    res.status(500).json({ ok: false, error: 'serveur' });
  }
});

app.post('/api/renouv/:token', async (req, res) => {
  const token = String(req.params.token || '');
  const choix = String((req.body && req.body.choix) || '');
  const dateChoisie = String((req.body && req.body.date) || '');
  if (['confirme', 'reporte', 'arret'].indexOf(choix) < 0) return res.status(400).json({ ok: false, error: 'choix_invalide' });
  if (choix === 'reporte') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateChoisie)) return res.status(400).json({ ok: false, error: 'date_requise' });
    const d = new Date(dateChoisie + 'T12:00'), now = new Date();
    const max = new Date(now.getTime() + 365 * 86400000);
    if (isNaN(d.getTime()) || d <= now || d > max) return res.status(400).json({ ok: false, error: 'date_hors_limites' });
  }
  try {
    const out = await renouvSerialise(async () => {
      const etat = await renouvLire();
      const rec = renouvParJeton(etat, token);
      if (!rec) return { code: 404, corps: { ok: false, error: 'lien_inconnu' } };
      // Décision définitive : on ne l'écrase jamais, on la rappelle.
      if (rec.conf && rec.conf.choix) return { code: 200, corps: Object.assign(renouvVue(rec), { deja: true }) };
      rec.conf = rec.conf || {};
      rec.conf.choix = choix;
      rec.conf.at = new Date().toISOString();
      if (choix === 'reporte') { rec.conf.dateChoisie = dateChoisie; rec.date = dateChoisie; }
      if (choix === 'confirme') { rec.confirme = true; }
      if (choix === 'arret') { rec.pause = true; }   // sort de « à préparer », passe en « à vérifier »
      rec.updatedAt = Date.now();
      await renouvEcrire(etat);
      return { code: 200, corps: renouvVue(rec) };
    });
    res.status(out.code).json(out.corps);
  } catch (e) {
    console.error('Renouv (réponse):', e.message);
    res.status(500).json({ ok: false, error: 'serveur' });
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
  if (MODE_HEBERGE && !process.env.SESSION_SECRET) {
    console.warn('  ⚠️  SESSION_SECRET non definie : le secret est regenere a chaque');
    console.warn('     redemarrage, donc tout le monde est deconnecte a chaque deploiement.');
  }
  initMail();
  logSmsStatus();
  console.log(renouvBase()
    ? '  🔗 Liens patients construits sur ' + renouvBase()
    : '  🔗 Liens patients sur l\'adresse courante (definir RENOUV_BASE_URL pour un sous-domaine dedie)');
  paiement.logStatus();
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

// Démarrage uniquement en exécution directe (`node server.js`). En require (tests),
// on n'ouvre ni port ni connexion : on expose les fonctions de fusion pour les vérifier.
if (require.main === module) start();

module.exports = { mergeState, mergeCaisse, mergePlParams, mergeById, mergeTombstones, applyTombstones, mergeStaff, ensureNatIds, toMsisdnFR, smsSender, smsConfigured };
