const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const maint = require('./maintenance');

const app = express();
const PORT = process.env.PORT || 3000;
// Identifiant de version : change à chaque déploiement Railway (commit) ou,
// en local, à chaque redémarrage du serveur. Sert à l'auto-rafraîchissement
// des postes (voir /api/version).
const BUILD_ID = process.env.RAILWAY_GIT_COMMIT_SHA || process.env.SOURCE_VERSION || process.env.BUILD_ID || String(Date.now());
const DATA_FILE = path.join(__dirname, 'data', 'pharmacie-data.json');
const HISTORY_DIR = path.join(__dirname, 'data', 'history');
// L'historique se regle desormais en DUREE, pas en nombre : voir
// maintenance.js, « L'HISTORIQUE ». Cette borne ne sert plus que de filet
// contre une regle de temps mal reglee.
const MAX_HISTORY = 400;

// ─── Webhook de paiement (Stripe) ───
// DOIT être déclaré AVANT express.json() et AVANT le portail d'authentification :
// la signature Stripe se vérifie sur le corps BRUT, et Stripe n'a pas de session.
// La route est protégée par sa signature cryptographique, pas par le portail.
const paiement = require('./paiement');
const temperatures = require('./temperatures');
const smsProgrammes = require('./sms-programmes');
const identite = require('./identite');
const traces = require('./traces');
const securite = require('./securite');
const coffre = require('./coffre');
paiement.installWebhook(app, express, { onPaid: marquerCreditPaye });

// ─── Durcissement : en-tetes de securite et freins de debit (voir securite.js) ───
// Monte le plus tot possible : les en-tetes doivent accompagner TOUTES les
// reponses, y compris les fichiers statiques et les pages du portail.
const freins = securite.installer(app, { qui: (req) => identite.qui(req) });

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
console.log(auth.SONNETTE_TOKEN
  ? '  🔔 Jeton de sonnette actif (poste dédié autorisé sur le flux)'
  : '  🔔 Aucun jeton de sonnette (définir SONNETTE_TOKEN pour un poste dédié)');

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
      // nodemailer a ete RETIRE des dependances le 13/09/2026 : douze avis de
      // securite ouverts, dont plusieurs injections CRLF, sans correctif avant
      // une version majeure 10 — et ce chemin n'a jamais servi, l'officine
      // envoyant par l'API Brevo depuis toujours. Garder une bibliotheque
      // vulnerable pour un chemin mort n'est pas un compromis, c'est un oubli.
      //
      // Le require est laisse en place : si le SMTP redevenait necessaire, un
      // `npm install nodemailer@^10` suffit a le rallumer, et d'ici la l'echec
      // du require tombe proprement dans le catch ci-dessous.
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
      mailError = /Cannot find module/.test(err.message)
        ? 'Le chemin SMTP demande nodemailer, retire des dependances. Installez nodemailer@^10 pour le retablir.'
        : err.message;
      console.error('  ❌ Erreur configuration SMTP:', mailError);
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

// ── Le certificat du serveur de base de donnees ─────────────────────────────
// Jusqu'ici : `rejectUnauthorized: false`, c'est-a-dire « chiffre mais ne
// verifie pas a qui je parle ». Sur le reseau prive de Railway le risque reste
// theorique ; apres la migration HDS il ne le sera plus, et un hebergeur
// certifie fournit son autorite de certification.
//
// Trois cas, du meilleur au moins bon :
//   1. PG_CA_CERT contient l'autorite (le certificat lui-meme, pas un chemin) :
//      on verifie contre elle. C'est ce qu'il faudra poser chez l'hebergeur HDS.
//   2. PG_SSL_STRICT=1 : on verifie contre les autorites du systeme.
//   3. sinon : comportement actuel, mais dit a voix haute au demarrage — une
//      faiblesse silencieuse est une faiblesse qu'on oublie.
function reglageSSL() {
  // Quatrieme cas, apparu avec la reponse de Scalingo du 14/09/2026 : chez eux
  // la base n'est pas exposee sur le web et la liaison se fait SANS TLS. Si on
  // laissait `ssl` renseigne, pg tenterait de negocier et la connexion
  // echouerait. PG_SSL=off le dit explicitement.
  //
  // C'est un recul assume par rapport a Railway, ou la liaison est chiffree
  // (sans verification du certificat) : l'isolation reseau remplace alors le
  // chiffrement. Elle vaut ce qu'elle vaut — a demander a l'hebergeur s'il
  // accepte d'activer TLS quand meme, puisqu'il fournit son autorite.
  if ((process.env.PG_SSL || '').toLowerCase() === 'off') {
    console.log('  🔐 PostgreSQL : liaison SANS TLS (reseau prive de l\'hebergeur, PG_SSL=off)');
    return false;
  }
  const ca = (process.env.PG_CA_CERT || '').trim();
  if (ca) {
    console.log('  🔐 PostgreSQL : certificat verifie contre PG_CA_CERT');
    return { rejectUnauthorized: true, ca: ca.replace(/\\n/g, '\n') };
  }
  if ((process.env.PG_SSL_STRICT || '') === '1') {
    console.log('  🔐 PostgreSQL : certificat verifie contre les autorites du systeme');
    return { rejectUnauthorized: true };
  }
  console.warn('  ⚠️  PostgreSQL : liaison chiffree mais certificat NON verifie.');
  console.warn('     A reprendre avec l\'hebergeur HDS : poser PG_CA_CERT, ou PG_SSL_STRICT=1.');
  return { rejectUnauthorized: false };
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
      ssl: reglageSSL()
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
    // Images du « Quoi de neuf ? » : hors du blob, dans leur propre table.
    // Le blob est relu EN ENTIER par chaque poste toutes les huit secondes ;
    // une photo qui y vit repart sur le reseau a chaque tour. Ici elle est
    // servie une fois, puis mise en cache par le navigateur — l'identifiant
    // etant le condensat du contenu, l'adresse ne designe jamais autre chose.
    await db.query(`
      CREATE TABLE IF NOT EXISTS app_images (
        id TEXT PRIMARY KEY,
        mime TEXT NOT NULL,
        octets BYTEA NOT NULL,
        taille INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    // Chiffrement au repos (voir coffre.js). Colonnes ajoutees apres coup :
    // `algo` nul signifie « encore en clair », et c'est le seul marqueur dont
    // la lecture a besoin pour servir les deux epoques sans rien casser.
    await db.query('ALTER TABLE app_images ADD COLUMN IF NOT EXISTS algo TEXT');
    await db.query('ALTER TABLE app_images ADD COLUMN IF NOT EXISTS enveloppe BYTEA');
    await db.query('ALTER TABLE app_images ADD COLUMN IF NOT EXISTS marque TEXT');
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
// ─── IMAGES ────────────────────────────────────────────────────────────────
// Stockees hors du blob metier, et adressees par le CONDENSAT de leur contenu.
// Deux consequences : deux envois de la meme image ne prennent la place qu'une
// fois, et l'adresse d'une image ne peut jamais designer un autre contenu — ce
// qui autorise une mise en cache definitive par le navigateur.
// Le PDF est de la partie : les ordonnances scannees des locations en sont
// souvent, et l'application les affiche dans un cadre plutot qu'en image.
const IMG_TYPES = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
  'application/pdf': 'pdf'
};
const IMG_MAX_OCTETS = 8 * 1024 * 1024;   // une ordonnance scannee peut etre lourde

app.post('/api/images', async (req, res) => {
  try {
    if (!db) return res.status(503).json({ ok: false, error: 'Base de donnees requise' });
    const b = req.body || {};
    const mime = String(b.mime || '');
    if (!IMG_TYPES[mime]) return res.status(400).json({ ok: false, error: 'Type d image non accepte' });
    const brut = String(b.data || '');
    if (!/^[A-Za-z0-9+/=]+$/.test(brut) || !brut.length) {
      return res.status(400).json({ ok: false, error: 'Contenu illisible' });
    }
    const octets = Buffer.from(brut, 'base64');
    if (!octets.length) return res.status(400).json({ ok: false, error: 'Image vide' });
    if (octets.length > IMG_MAX_OCTETS) {
      return res.status(413).json({ ok: false, error: 'Fichier trop lourd (max 8 Mo)' });
    }
    // L'identifiant est le condensat des octets EN CLAIR, calcule avant le
    // chiffrement : c'est ce qui preserve la deduplication, et la capacite de
    // restaurer un scan en reenvoyant les memes octets.
    const id = crypto.createHash('sha256').update(octets).digest('hex').slice(0, 32);
    const scelle = coffre.chiffrer(octets);
    await db.query(
      'INSERT INTO app_images (id, mime, octets, taille, algo, enveloppe, marque)'
      + ' VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING',
      scelle
        ? [id, mime, scelle.octets, octets.length, scelle.algo, scelle.enveloppe, scelle.marque]
        : [id, mime, octets, octets.length, null, null, null]
    );
    res.json({ ok: true, id: id, url: '/api/images/' + id });
  } catch (err) {
    console.error('Erreur enregistrement image:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/images/:id', async (req, res) => {
  try {
    if (!db) return res.status(503).end();
    const id = String(req.params.id || '');
    if (!/^[0-9a-f]{32}$/.test(id)) return res.status(400).end();
    const r = await db.query('SELECT mime, octets, algo, enveloppe, marque FROM app_images WHERE id = $1', [id]);
    if (!r.rows.length) return res.status(404).end();
    // Les deux epoques cohabitent : `algo` nul rend les octets tels quels.
    let clair;
    try { clair = coffre.dechiffrer(r.rows[0]); }
    catch (e) {
      console.error('  ⛔ Scan ' + id + ' illisible : ' + e.message);
      return res.status(500).end();
    }
    // Immuable : le nom EST le contenu. Le navigateur ne redemandera jamais.
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.set('Content-Type', r.rows[0].mime);
    res.send(clair);
  } catch (err) {
    console.error('Erreur lecture image:', err.message);
    res.status(500).end();
  }
});

// ─── COFFRE : chiffrement au repos des scans (voir coffre.js) ──────────────
// Trois routes d'administration. Aucune n'est automatique : une operation qui
// reecrit des ordonnances se declenche a la main, se verifie piece par piece,
// et se lit dans le journal des acces apres coup.
async function gardeCoffre(req, res) {
  const uid = identite.qui(req);
  if (!uid) { res.status(401).json({ ok: false, error: 'non_identifie' }); return null; }
  if (!(await estAdministrateur(uid))) { res.status(403).json({ ok: false, error: 'interdit' }); return null; }
  if (!db) { res.status(503).json({ ok: false, error: 'base_indisponible' }); return null; }
  return uid;
}

app.get('/api/coffre/etat', async (req, res) => {
  if (!(await gardeCoffre(req, res))) return;
  try {
    const d = coffre.diagnostic();
    const r = await db.query(
      'SELECT COUNT(*) FILTER (WHERE algo IS NULL) AS clair,'
      + ' COUNT(*) FILTER (WHERE algo IS NOT NULL) AS chiffres,'
      + ' COUNT(*) FILTER (WHERE algo IS NOT NULL AND marque IS DISTINCT FROM $1) AS areemballer,'
      + ' COUNT(*) AS total FROM app_images', [d.marque]);
    const l = r.rows[0] || {};

    // ── Rapprochement ────────────────────────────────────────────────────
    // Le nombre de FICHIERS et le nombre de RENVOIS vers des fichiers n'ont
    // aucune raison d'etre egaux : l'identifiant etant le condensat du contenu,
    // un meme document joint deux fois ne fait qu'une seule ligne. L'ecart est
    // donc normal — mais il ne doit jamais cacher un renvoi SANS fichier.
    // C'est precisement ce qui s'est produit le 13/09, et ce qu'on avait
    // explique au lieu de le compter.
    let uniques = 0, manquants = 0, orphelins = 0, dou = [], ailleurs = 0, echantillon = [];
    try {
      const cur = await db.query('SELECT data FROM app_data WHERE id = 1');
      const blob = (cur.rows[0] && cur.rows[0].data) || {};
      const attendues = imagesAttendues(blob);
      const ids = Array.from(attendues.keys());
      uniques = ids.length;
      // Tout le reste : des chaines de 32 caracteres hexadecimaux qui ne sont
      // pas posees dans un champ d'image. Comptees a part, sans alarme.
      ailleurs = Math.max(0, ouSontLesIdentifiants(blob).size - uniques);
      if (ids.length) {
        const p = await db.query('SELECT id FROM app_images WHERE id = ANY($1)', [ids]);
        const presents = new Set(p.rows.map(x => x.id));
        const perdus = ids.filter(x => !presents.has(x));
        manquants = perdus.length;
        // D'ou viennent-ils ? Un compteur brut ne dit pas s'il faut s'inquieter ;
        // « 12 dans locations.renewals.scanId » le dit.
        const parRubrique = {};
        perdus.forEach(id => (attendues.get(id) || []).forEach(c => { parRubrique[c] = (parRubrique[c] || 0) + 1; }));
        dou = Object.entries(parRubrique).sort((a, b) => b[1] - a[1]).slice(0, 8)
          .map(([chemin, n]) => ({ chemin, n }));
        // Un compteur qui annonce une perte doit pouvoir la MONTRER. Deux
        // compteurs se sont deja contredits sur ce sujet ; celui qui ne sait
        // pas nommer ce qu'il compte a tort par defaut.
        // UN COMPTEUR DOIT PROUVER SON AFFIRMATION. Celui-ci s'appuie sur un
        // `WHERE id = ANY(...)` ; le navigateur, lui, demande /api/images/<id>
        // et voit l'ordonnance s'afficher. Les deux ne peuvent pas avoir
        // raison. On refait donc la recherche UN PAR UN, exactement comme la
        // route de lecture, et on dit ce que chacune repond.
        echantillon = [];
        for (const id of perdus.slice(0, 8)) {
          let seul = null;
          try {
            const u = await db.query('SELECT id FROM app_images WHERE id = $1', [id]);
            seul = u.rows.length ? 'TROUVE a l unite' : 'absent a l unite aussi';
          } catch (e) { seul = 'erreur : ' + e.message; }
          echantillon.push({ id: id, ou: (attendues.get(id) || []).join(', '), seul: seul });
        }
        orphelins = Math.max(0, (+l.total || 0) - presents.size);
      } else {
        orphelins = +l.total || 0;
      }
    } catch (e) { /* le rapprochement est un confort, jamais un blocage */ }

    // Taille reelle occupee, compression PostgreSQL comprise : c'est ce chiffre
    // qui doit dimensionner un plan d'hebergement, jamais une estimation faite
    // sur la taille du JSON.
    let tailles = null;
    try {
      const tr = await db.query(
        "SELECT relname AS table, pg_total_relation_size(c.oid) AS octets"
        + " FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace"
        + " WHERE n.nspname = current_schema() AND relkind = 'r'"
        + "   AND relname IN ('app_data','app_data_history','app_images','app_acces','app_temperatures')"
        + " ORDER BY 2 DESC");
      const h = await db.query('SELECT COUNT(*) AS n, MIN(created_at) AS plusVieux FROM app_data_history');
      tailles = { tables: tr.rows.map(r => ({ table: r.table, ko: Math.round(+r.octets / 1024) })),
                  instantanes: +(h.rows[0] || {}).n || 0,
                  plusVieux: (h.rows[0] || {}).plusvieux || null };
    } catch (e) { /* diagnostic, jamais bloquant */ }

    res.json({ ok: true, actif: d.actif, marque: d.marque, anciennes: d.anciennes, erreur: d.erreur,
      clair: +l.clair || 0, chiffres: +l.chiffres || 0, aReemballer: +l.areemballer || 0, total: +l.total || 0,
      uniques, manquants, orphelins, ailleurs, dou, echantillon, tailles });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Reprise des fichiers encore en clair. C'est l'exception assumee a la regle
// « pas de migration ecrite en base » — comme pour les codes PIN, le but EST de
// faire disparaitre du clair. Chaque fichier est chiffre, RELU, et compare
// octet pour octet AVANT que le clair ne soit remplace. Un fichier qui ne se
// relit pas a l'identique reste intact.
app.post('/api/coffre/chiffrer', async (req, res) => {
  const uid = await gardeCoffre(req, res); if (!uid) return;
  if (!coffre.actif()) return res.status(400).json({ ok: false, error: 'Aucune clé : définissez SCANS_CLE.' });
  const lot = Math.min(50, Math.max(1, parseInt((req.body || {}).lot, 10) || 20));
  let faits = 0; const rates = [];
  try {
    const r = await db.query('SELECT id, octets FROM app_images WHERE algo IS NULL ORDER BY created_at LIMIT $1', [lot]);
    for (const ligne of r.rows) {
      try {
        const clair = ligne.octets;
        const scelle = coffre.chiffrer(clair);
        const relu = coffre.dechiffrer({ algo: scelle.algo, octets: scelle.octets,
                                         enveloppe: scelle.enveloppe, marque: scelle.marque });
        if (!relu.equals(clair)) throw new Error('la relecture ne redonne pas les mêmes octets');
        const maj = await db.query(
          'UPDATE app_images SET octets = $2, algo = $3, enveloppe = $4, marque = $5 WHERE id = $1 AND algo IS NULL',
          [ligne.id, scelle.octets, scelle.algo, scelle.enveloppe, scelle.marque]);
        if (maj.rowCount) faits++;
      } catch (e) { rates.push(ligne.id + ' : ' + e.message); }
    }
    const reste = await db.query('SELECT COUNT(*) AS n FROM app_images WHERE algo IS NULL');
    if (faits) traces.noter(db, uid, 'modification', 'ordonnance', null, 'Chiffrement au repos de ' + faits + ' fichier(s)');
    res.json({ ok: true, faits, rates, reste: +(reste.rows[0] || {}).n || 0 });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Export d'UN fichier scelle, pour l'epreuve de la cle. Ce qui sort est
// chiffre : sans la cle, ce n'est qu'un bloc d'octets. Le but est justement de
// verifier, hors de l'application et hors de la plateforme, que la copie papier
// de la cle rouvre reellement une ordonnance — voir outils/ouvrir-une-ordonnance.js.
app.get('/api/coffre/echantillon', async (req, res) => {
  const uid = await gardeCoffre(req, res); if (!uid) return;
  try {
    const r = await db.query(
      'SELECT id, mime, algo, enveloppe, marque, octets FROM app_images'
      + ' WHERE algo IS NOT NULL ORDER BY created_at DESC LIMIT 1');
    if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Aucun fichier chiffré à éprouver.' });
    const l = r.rows[0];
    traces.noter(db, uid, 'export', 'ordonnance', l.id, 'Export scellé pour l\'épreuve de la clé');
    res.json({ ok: true, id: l.id, mime: l.mime, algo: l.algo, marque: l.marque,
      enveloppe: l.enveloppe.toString('base64'), octets: l.octets.toString('base64') });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Rotation : on ne reecrit que les petites cles, jamais les fichiers.
app.post('/api/coffre/reemballer', async (req, res) => {
  const uid = await gardeCoffre(req, res); if (!uid) return;
  if (!coffre.actif()) return res.status(400).json({ ok: false, error: 'Aucune clé : définissez SCANS_CLE.' });
  const d = coffre.diagnostic();
  const lot = Math.min(200, Math.max(1, parseInt((req.body || {}).lot, 10) || 100));
  let faits = 0; const rates = [];
  try {
    const r = await db.query(
      'SELECT id, octets, algo, enveloppe, marque FROM app_images'
      + ' WHERE algo IS NOT NULL AND marque IS DISTINCT FROM $1 LIMIT $2', [d.marque, lot]);
    for (const ligne of r.rows) {
      try {
        const neuve = coffre.reemballer(ligne);
        if (!neuve) continue;
        // Meme exigence que pour la reprise : on relit avant de remplacer.
        coffre.dechiffrer({ algo: ligne.algo, octets: ligne.octets,
                            enveloppe: neuve.enveloppe, marque: neuve.marque });
        const maj = await db.query(
          'UPDATE app_images SET enveloppe = $2, marque = $3 WHERE id = $1 AND marque IS DISTINCT FROM $3',
          [ligne.id, neuve.enveloppe, neuve.marque]);
        if (maj.rowCount) faits++;
      } catch (e) { rates.push(ligne.id + ' : ' + e.message); }
    }
    const reste = await db.query(
      'SELECT COUNT(*) AS n FROM app_images WHERE algo IS NOT NULL AND marque IS DISTINCT FROM $1', [d.marque]);
    if (faits) traces.noter(db, uid, 'modification', 'ordonnance', null, 'Rotation de clé : ' + faits + ' fichier(s) réemballé(s)');
    res.json({ ok: true, faits, rates, reste: +(reste.rows[0] || {}).n || 0 });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Liste COMPLETE des renvois sans fichier. L'etat n'en montre que huit, ce qui
// suffit pour savoir s'il y a un probleme ; quand il faut agir, il faut les
// avoir tous. Ce qui sort ici, ce sont des identifiants et des noms de
// rubriques — jamais un nom de patient ni un contenu.
app.get('/api/coffre/manquants', async (req, res) => {
  if (!(await gardeCoffre(req, res))) return;
  try {
    const cur = await db.query('SELECT data FROM app_data WHERE id = 1');
    const attendues = imagesAttendues((cur.rows[0] && cur.rows[0].data) || {});
    const ids = Array.from(attendues.keys());
    if (!ids.length) return res.json({ ok: true, manquants: [] });
    const p = await db.query('SELECT id FROM app_images WHERE id = ANY($1)', [ids]);
    const presents = new Set(p.rows.map(x => x.id));
    res.json({ ok: true, manquants: ids.filter(x => !presents.has(x))
      .map(id => ({ id: id, ou: attendues.get(id) || [] })) });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ─── COMPACTAGE DE LA BASE ────────────────────────────────────────────────
// Une ligne supprimee ne rend pas sa place. L'historique, elague tous les
// jours depuis des mois, occupait 2,9 Go pour quelques dizaines d'instantanes
// vivants. VACUUM FULL reecrit la table proprement.
//
// Deux precautions, et elles expliquent la forme de ces deux routes.
//
// LE VERROU. Pendant la reecriture, plus personne n'ecrit NI ne lit la table.
// Sur `app_data`, cela veut dire que l'intranet entier attend. L'operation se
// declenche donc a la main, a une heure creuse, et jamais depuis un automate.
//
// LA DUREE. Reecrire 3 Go prend plus longtemps qu'une requete HTTP ne doit
// vivre. La route repond donc AVANT d'avoir fini, et l'ecran vient demander ou
// ca en est. La liaison est prise sur une connexion dediee : un VACUUM qui
// occupe une place du pool pendant cinq minutes, c'est une place de moins pour
// les quinze postes de l'officine.
let compactage = null;   // { table, debut, fin, avant, apres, erreur }

function compactageEnCours() { return !!(compactage && !compactage.fin); }

async function tailleTable(cl, table) {
  const r = await cl.query('SELECT pg_total_relation_size($1::regclass) AS o', [table]);
  return +(r.rows[0] || {}).o || 0;
}

app.get('/api/base/compactage', async (req, res) => {
  if (!(await gardeCoffre(req, res))) return;
  try {
    // reltuples est une ESTIMATION tenue par l'analyseur, pas un COUNT(*) :
    // on ne va pas parcourir trois giga-octets pour afficher un nombre de
    // lignes a cote d'une taille.
    const tr = await db.query(
      "SELECT relname AS table, pg_total_relation_size(c.oid) AS octets, c.reltuples::bigint AS lignes"
      + " FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace"
      + " WHERE n.nspname = current_schema() AND relkind = 'r' AND relname = ANY($1)"
      + " ORDER BY 2 DESC", [maint.TABLES_COMPACTABLES]);
    res.json({ ok: true, encours: compactageEnCours(), dernier: compactage,
      tables: tr.rows.map(r => ({ table: r.table, octets: +r.octets, lignes: +r.lignes })) });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/base/compacter', async (req, res) => {
  const uid = await gardeCoffre(req, res); if (!uid) return;
  const table = maint.tableCompactable((req.body || {}).table);
  if (!table) return res.status(400).json({ ok: false, error: 'table non autorisee' });
  if (compactageEnCours()) return res.status(409).json({ ok: false, error: 'compactage deja en cours sur ' + compactage.table });
  if (!process.env.DATABASE_URL) return res.status(503).json({ ok: false, error: 'base_indisponible' });

  compactage = { table: table, debut: Date.now(), fin: null, avant: null, apres: null, erreur: null };
  traces.noter(db, uid, 'modification', 'base', table, 'Compactage (VACUUM FULL) lance');
  res.json({ ok: true, lance: true, table: table });

  // A partir d'ici, plus personne n'attend cette reponse.
  let cl = null;
  try {
    const { Client } = require('pg');
    cl = new Client({ connectionString: process.env.DATABASE_URL, ssl: reglageSSL() });
    await cl.connect();
    compactage.avant = await tailleTable(cl, table);
    // `table` sort de la liste fermee de maintenance.js, jamais de la requete.
    await cl.query('VACUUM (FULL, ANALYZE) ' + table);
    compactage.apres = await tailleTable(cl, table);
  } catch (e) {
    compactage.erreur = e.message;
  } finally {
    compactage.fin = Date.now();
    if (cl) { try { await cl.end(); } catch (e) { /* rien a rattraper */ } }
  }
});

// ─── ENVOI D'UNE DEMANDE EN DEVELOPPEMENT ──────────────────────────────────
// Cree une issue GitHub a partir d'une demande de la boite a idees. L'action
// `.github/workflows/claude.yml` fait le reste quand le corps mentionne
// @claude.
//
// Le jeton est PERSONNEL (celui d'Olivier), pas un jeton d'application :
// l'action Claude verifie que l'auteur du declenchement a un acces en ecriture
// au depot et rejette les robots. Une issue creee par une application serait
// ignoree.
//
// Ce que cette route ne fait PAS : envoyer la capture d'ecran de la demande.
// Une capture de l'application contient presque toujours des noms de patients.
// Seul le texte part, et il est relu par un humain avant l'envoi.
const GH_REPO = (process.env.GITHUB_REPO || '').trim();
const GH_TOKEN = (process.env.GITHUB_TOKEN || '').trim();

app.get('/api/dev/dispo', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, actif: !!(GH_REPO && GH_TOKEN), repo: GH_REPO || null });
});

app.post('/api/dev/issue', async (req, res) => {
  try {
    if (!GH_REPO || !GH_TOKEN) {
      return res.status(503).json({ ok: false, error: 'Envoi non configuré (GITHUB_REPO / GITHUB_TOKEN)' });
    }
    if (!/^[\w.-]+\/[\w.-]+$/.test(GH_REPO)) {
      return res.status(500).json({ ok: false, error: 'GITHUB_REPO mal formé (attendu : proprietaire/depot)' });
    }
    const b = req.body || {};
    const titre = String(b.titre || '').trim().slice(0, 200);
    const corps = String(b.corps || '').trim().slice(0, 20000);
    if (!titre || !corps) return res.status(400).json({ ok: false, error: 'Titre et contenu requis' });

    if (typeof fetch !== 'function') {
      return res.status(500).json({ ok: false, error: 'Node trop ancien : fetch indisponible (Node 18 minimum)' });
    }
    const r = await fetch('https://api.github.com/repos/' + GH_REPO + '/issues', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + GH_TOKEN,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'PILOT-intranet'
      },
      body: JSON.stringify({ title: titre, body: corps })
    });
    const j = await r.json().catch(() => null);
    if (!r.ok) {
      // Le message de GitHub est utile ; le jeton, lui, ne doit jamais sortir
      // d'ici ni finir dans un journal.
      const msg = (j && j.message) ? j.message : ('erreur ' + r.status);
      console.error('Creation issue GitHub refusee :', r.status, msg);
      return res.status(502).json({ ok: false, error: 'GitHub a refusé : ' + msg });
    }
    res.json({ ok: true, url: j.html_url, numero: j.number });
  } catch (err) {
    console.error('Erreur envoi en developpement :', err.message);
    res.status(500).json({ ok: false, error: 'Envoi impossible : ' + err.message });
  }
});

// ─── Suivi des armoires refrigerees (voir temperatures.js) ───
temperatures.routes(app, () => db);

// ─── Identite des operateurs (voir identite.js) ───
// Lecture et ecriture de l'etat, partagees avec le module : elles suivent le
// meme chemin que le reste (PostgreSQL si present, fichier sinon).
async function lireEtatBrut() {
  if (db) {
    const r = await db.query('SELECT data FROM app_data WHERE id = 1');
    return (r.rows[0] && r.rows[0].data) || {};
  }
  if (fs.existsSync(DATA_FILE)) { try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) {} }
  return {};
}
async function ecrireEtatBrut(data) {
  if (db) {
    await db.query('UPDATE app_data SET data = $1, updated_at = NOW() WHERE id = 1', [JSON.stringify(data)]);
    return;
  }
  refuserDisque('ecriture identite');
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}
identite.installer(app, {
  lireEtat: lireEtatBrut,
  ecrireEtat: ecrireEtatBrut,
  // Tout ce que le serveur constate lui-meme part aussi au journal des acces :
  // ouverture de session, changement de code, entree par le mot de passe de
  // secours. Ces lignes-la ne dependent d'aucun navigateur.
  journaliser: (uid, texte) => {
    try { console.log('  🔑 ' + texte + ' — ' + uid); } catch (e) {}
    const acte = /^Ouverture/i.test(texte) ? 'connexion'
               : /^Fermeture/i.test(texte) ? 'deconnexion'
               : 'modification';
    traces.noter(db, uid, acte, 'session', null, texte);
  }
});

// ─── Journal des acces (voir traces.js) ───
// « Administrateur » n'est pas une notion du journal : c'est celle de l'equipe,
// portee par staffDB. On la lit a chaque fois plutot que de la mettre en cache,
// pour qu'un retrait de droit prenne effet immediatement.
async function estAdministrateur(uid) {
  try {
    const etat = await lireEtatBrut();
    const liste = etat.staffDB || [];
    const s = liste.find(x => x && x.id === uid);
    if (!s) return false;
    // Meme regle que le navigateur (staffIsAdmin) : tant que PERSONNE n'est
    // marque administrateur, ce sont les deux titulaires. Si le serveur ne
    // reprenait pas cette reprise, l'onglet s'afficherait et la lecture serait
    // refusee — l'ecart entre les deux regles se voit en 403 incomprehensible.
    const quelquUnMarque = liste.some(x => x && x.admin === true);
    return quelquUnMarque ? s.admin === true : (uid === 'OF' || uid === 'AF');
  } catch (e) { return false; }
}
traces.installer(app, { getDb: () => db, qui: identite.qui, estAdmin: estAdministrateur });

// ─── SMS programmes (voir sms-programmes.js) ───
const smsProg = smsProgrammes.installer(app, {
  getDb: () => db,
  envoyerSms: sendSmsViaBrevo,
  smsConfigure: smsConfigured,
  toMsisdn: toMsisdnFR
});

app.get('/api/config', (req, res) => {
  res.set('Cache-Control', 'no-store');
  // `version` sert aux demandes des operateurs : savoir sur quelle version une
  // anomalie a ete vue evite de chercher un defaut deja corrige.
  res.json({ renouvBase: renouvBase(), version: BUILD_ID });
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

// Sonneries disponibles sur le poste dedie. Liste FERMEE : le nom recu sert a
// choisir un fichier sur le Raspberry, il ne doit jamais pouvoir designer autre
// chose que ces neuf-la.
const SONNERIES = ['dingdong', 'westminster', 'carillon3', 'grelot', 'electrique',
  'moderne', 'doux', 'marimba', 'harpe'];

app.post('/api/sonnette', (req, res) => {
  const b = req.body || {};
  const type = SONNETTE_TYPES[b.type] ? b.type : 'comptoir';
  const evt = {
    id:    'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    type,
    par:   String(b.par || '').slice(0, 60) || 'Un poste',
    poste: String(b.poste || '').slice(0, 40),
    src:   String(b.src || '').slice(0, 40),
    // Sonnerie et nombre de repetitions destines au poste dedie. Les postes
    // navigateur les ignorent : ils ont leur propre reglage, local a la machine.
    son:   SONNERIES.indexOf(String(b.son || '')) >= 0 ? String(b.son) : 'dingdong',
    rep:   Math.max(1, Math.min(5, parseInt(b.rep, 10) || 1)),
    vol:   Math.max(10, Math.min(100, parseInt(b.vol, 10) || 80)),
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
app.post('/api/send-mail', freins.mail[0], freins.mail[1], async (req, res) => {
  if (!mailMethod) return res.status(400).json({ ok: false, error: 'Aucun service d\'envoi configuré sur le serveur.' });
  const { text, attachments } = req.body || {};
  // L'objet part dans un en-tete SMTP : un saut de ligne y ajouterait des
  // destinataires caches. Les adresses sont deja filtrees, l'objet ne l'etait pas.
  const subject = securite.enTeteSur((req.body || {}).subject, 300);
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
app.post('/api/send-sms', freins.sms[0], freins.sms[1], async (req, res) => {
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
// Renvoie null si rien n'a ete applique, sinon { partiel, du, recu }.
async function marquerCreditPaye(creditId, info) {
  let verdict = null;
  const appliquer = (data) => {
    if (!data || !Array.isArray(data.credits)) return false;
    const c = data.credits.find((x) => x && String(x.id) === String(creditId));
    if (!c) return false;
    const p = c.paiement || {};
    if ((p.status === 'paye' || p.status === 'partiel') && p.ref === info.ref) return false;   // doublon d'événement

    // Le montant encaisse n'etait jamais compare a la somme due : un reglement
    // de 1 euro sur 300 dus passait le dossier a « payé ». On tolere un centime
    // d'arrondi, et rien de plus.
    const du = Number(c.montant) || 0;
    const recu = Number(info.montant) || 0;
    const insuffisant = du > 0 && recu + 0.005 < du;

    c.paiement = Object.assign({}, p, {
      status: insuffisant ? 'partiel' : 'paye',
      ref: info.ref,
      paidAt: info.at,
      montantPaye: recu
    });
    if (insuffisant) {
      // Le dossier reste ouvert, et il porte de quoi comprendre sans aller
      // fouiller le tableau de bord Stripe.
      c.paiement.duAuPaiement = du;
      c.paiement.reste = Math.round((du - recu) * 100) / 100;
    } else {
      delete c.paiement.duAuPaiement;
      delete c.paiement.reste;
      // On s'arrête à « payé » : l'argent est encaissé sur Stripe, mais la vente
      // n'est pas soldée dans Winpharma. Passer directement à « soldé » ferait
      // disparaître le dossier de la liste active et la saisie serait oubliée.
      // La clôture est un geste humain, confirmé depuis l'intranet.
      c.status = 'payé';
    }
    c.updatedAt = Date.now();
    verdict = { partiel: insuffisant, du, recu };
    return true;
  };

  if (db) {
    const cur = await db.query('SELECT data FROM app_data WHERE id = 1');
    const data = (cur.rows[0] && cur.rows[0].data) || {};
    if (!appliquer(data)) return null;
    await db.query('UPDATE app_data SET data = $1, updated_at = NOW() WHERE id = 1', [JSON.stringify(data)]);
    return verdict;
  }
  refuserDisque('credit paye');
  if (!fs.existsSync(DATA_FILE)) return null;
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  if (!appliquer(data)) return null;
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  return verdict;
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
        // Elagage par age : fin sur les heures recentes, grossier sur les mois.
        const toutes = await db.query('SELECT id, created_at FROM app_data_history');
        const aJeter = maint.elagage(toutes.rows, Date.now());
        if (aJeter.length) await db.query('DELETE FROM app_data_history WHERE id = ANY($1)', [aJeter]);
        // Filet, si la regle de temps laissait tout passer.
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
  'journal',
  // Demandes des operateurs (anomalies, idees) : fusion par id + tombstones.
  'demandes',
  // Page d'accueil : taches personnelles, moments d'equipe, agenda partage.
  'todoPerso', 'moments', 'agenda', 'liens',
  // Messagerie personnelle : les messages sont une collection a part, pour que
  // deux personnes qui ecrivent en meme temps ne s'effacent pas l'une l'autre.
  'convos', 'messages',
  // Groupes de destinataires reutilisables de la messagerie.
  'groupesMsg',
  // Module Litiges : litiges fournisseurs et factures manquantes.
  'litiges', 'facturesManq',
  // SMS programmes : envoyes par le serveur, a 8 h 30, sans poste allume.
  'smsProg'];

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

// Reglages de configuration : un objet unique, pas une collection a id. Sans
// precaution, Object.assign fait gagner l'ENVOI LE PLUS RECENT, pas la VERSION
// la plus recente : un poste dont l'onglet est ouvert depuis ce matin renvoie sa
// copie perimee a sa prochaine sauvegarde et annule le reglage d'un autre. On
// compare donc leurs `updatedAt` respectifs, comme pour les enregistrements.
const CONFIGS_DATEES = ['modulesParPoste', 'sonnetteRpi'];
function mergeParDate(a, b) {
  if (!a || typeof a !== 'object') return b;
  if (!b || typeof b !== 'object') return a;
  return ((b.updatedAt || 0) >= (a.updatedAt || 0)) ? b : a;
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
  // Reglages de configuration : on garde la version au `updatedAt` le plus recent.
  CONFIGS_DATEES.forEach(n => {
    if (existing[n] || incoming[n]) merged[n] = mergeParDate(existing[n], incoming[n]);
  });
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

// Balayage des images devenues orphelines. Une image reste tant qu'un
// enregistrement la designe ; passee une journee sans reference, elle part.
// Le delai de grace est indispensable : une image est envoyee AVANT que la
// publication qui la porte ne soit enregistree, et sans lui elle disparaitrait
// dans cet intervalle.
const IMG_GRACE_H = 24;
// ⚠ CE QUI S'EST PASSE LE 10/09/2026, ET QU'IL NE FAUT JAMAIS REFAIRE.
// Cette fonction ne descendait que dans les cles nommees `imgId` ou dans les
// valeurs qui sont elles-memes des objets. Une chaine rangee sous un AUTRE nom
// — `scanId`, pour les ordonnances de location — n'etait donc jamais vue. Le
// balayeur les a prises pour des orphelines et a SUPPRIME 45 scans
// d'ordonnances. Irreversible sans les instantanes d'historique.
//
// La regle qui en decoule : on ne cherche pas les references la ou on croit
// qu'elles sont, on parcourt TOUT et on reconnait la forme. Un faux positif
// — une chaine de 32 hexadecimaux qui ne designe rien — ne coute qu'une image
// gardee pour rien. Un faux negatif coute une ordonnance.
function imagesReferencees(blob) {
  const vus = new Set();
  const voir = (v) => {
    if (v === null || v === undefined) return;
    if (typeof v === 'string') { if (/^[0-9a-f]{32}$/.test(v)) vus.add(v); return; }
    if (Array.isArray(v)) { v.forEach(voir); return; }
    if (typeof v === 'object') { Object.keys(v).forEach(k => voir(v[k])); return; }
  };
  voir(blob);
  return vus;
}

// ── La meme marche, mais en notant D'OU vient chaque identifiant ────────────
// Deux questions opposees se posent sur le meme ensemble, et une seule fonction
// ne peut pas servir les deux :
//
//   « QUE PUIS-JE SUPPRIMER ? »  Trop large est SANS DANGER, trop etroit
//   efface des ordonnances. D'ou la marche ci-dessus, qui reconnait un
//   identifiant a sa FORME et ratisse tout — c'est la lecon du 13/09.
//
//   « QUE ME MANQUE-T-IL ? »  Trop large invente des pertes qui n'existent pas
//   et fait paniquer ; trop etroit cache une perte reelle. La forme ne suffit
//   plus : une chaine de 32 caracteres hexadecimaux dans un journal, un
//   horodatage archive ou une pierre tombale n'a jamais designe une image.
//
// On garde donc le ratissage — mais on retient le chemin, pour pouvoir dire
// d'ou vient un identifiant sans fichier, au lieu de compter un chiffre brut.
function ouSontLesIdentifiants(blob) {
  const ou = new Map();   // id -> Set de rubriques
  const voir = (v, chemin) => {
    if (v === null || v === undefined) return;
    if (typeof v === 'string') {
      if (/^[0-9a-f]{32}$/.test(v)) {
        if (!ou.has(v)) ou.set(v, new Set());
        ou.get(v).add(chemin);
      }
      return;
    }
    if (Array.isArray(v)) { v.forEach(x => voir(x, chemin)); return; }
    if (typeof v === 'object') { Object.keys(v).forEach(k => voir(v[k], chemin + '.' + k)); return; }
  };
  Object.keys(blob || {}).forEach(k => voir(blob[k], k));
  return ou;
}

// Ce qui designe VRAIMENT une image : les champs que l'application affiche
// comme telle. Liste explicite et assumee — ici, se tromper par exces invente
// des pertes, alors que pour le balayeur c'est l'inverse.
const CHAMPS_IMAGE = ['scanId', 'imgId', 'photo', 'sig'];
function imagesAttendues(blob) {
  const ou = ouSontLesIdentifiants(blob);
  const attendues = new Map();
  for (const [id, chemins] of ou) {
    const retenus = Array.from(chemins).filter(c => CHAMPS_IMAGE.some(f => c.endsWith('.' + f)));
    if (retenus.length) attendues.set(id, retenus);
  }
  return attendues;
}
async function balayerImages() {
  if (!db) return;
  try {
    const cur = await db.query('SELECT data FROM app_data WHERE id = 1');
    const blob = (cur.rows[0] && cur.rows[0].data) || {};
    const gardees = Array.from(imagesReferencees(blob));
    const r = await db.query(
      "DELETE FROM app_images WHERE created_at < NOW() - INTERVAL '" + IMG_GRACE_H + " hours'"
      + (gardees.length ? ' AND NOT (id = ANY($1))' : ''),
      gardees.length ? [gardees] : []
    );
    if (r.rowCount) console.log('  🧹 Images orphelines supprimees :', r.rowCount);
  } catch (err) {
    console.error('Balayage des images:', err.message);
  }
}
// Le balayage est SUSPENDU par defaut depuis l'incident du 13/09/2026. Il ne
// reprendra que sur decision explicite, une fois la perte instruite et la
// correction de imagesReferencees verifiee sur des donnees reelles.
// Pour le reactiver : BALAYAGE_IMAGES=1.
if (process.env.BALAYAGE_IMAGES === '1') {
  setInterval(balayerImages, 6 * 3600 * 1000);
  setTimeout(balayerImages, 5 * 60 * 1000);
} else {
  console.log('  🧹 Balayage des images SUSPENDU (BALAYAGE_IMAGES non defini)');
}

// ─── Load all data ───
app.get('/api/data', async (req, res) => {
  try {
    if (db) {
      // PostgreSQL
      const result = await db.query('SELECT data FROM app_data WHERE id = 1');
      if (result.rows.length > 0 && Object.keys(result.rows[0].data).length > 0) {
        // sansSecrets : ni code PIN, ni empreinte, ni mot de passe administrateur
        // ne quittent le serveur. C'etait LE trou — /api/data livrait les codes
        // de toute l'equipe a chaque poste.
        return res.json(identite.sansSecrets(maint.pruneRetention(result.rows[0].data)));
      }
      return res.json(null);
    } else {
      // Fichier local
      if (fs.existsSync(DATA_FILE)) {
        const raw = fs.readFileSync(DATA_FILE, 'utf8');
        return res.json(identite.sansSecrets(maint.pruneRetention(JSON.parse(raw))));
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
    // Nettoyer la sortie sans nettoyer l'entree ne servirait a rien : un poste
    // reste sur l'ancienne version renverrait les PIN qu'il detient encore, et
    // la fusion champ par champ les remettrait sagement en base.
    const incoming = identite.sansSecretsEntrants(req.body || {});
    if (db) {
      // PostgreSQL — fusion au niveau des rubriques : un client sur une ancienne
      // version, qui n'envoie pas certaines rubriques (retours, bluestone,
      // contrôles, crédits…), ne doit PAS les effacer de la base.
      const cur = await db.query('SELECT data FROM app_data WHERE id = 1');
      const existing = (cur.rows[0] && cur.rows[0].data) || {};
      // preserverSecrets : la fusion REMPLACE les rubriques objet. Le client
      // envoie ADMIN sans empreinte — sans cette ligne, la premiere sauvegarde
      // venue efface pwHash et plus personne ne passe l'ecran de connexion.
      const merged = identite.preserverSecrets(existing, maint.pruneRetention(mergeState(existing, incoming)));
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
      // preserverSecrets : la fusion REMPLACE les rubriques objet. Le client
      // envoie ADMIN sans empreinte — sans cette ligne, la premiere sauvegarde
      // venue efface pwHash et plus personne ne passe l'ecran de connexion.
      const merged = identite.preserverSecrets(existing, maint.pruneRetention(mergeState(existing, incoming)));
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
  (() => {
    const d = coffre.diagnostic();
    if (d.erreur) console.error('  ⛔ Chiffrement des scans : ' + d.erreur);
    else if (d.actif) console.log('  🔐 Scans chiffrés au repos (clé ' + d.marque
      + (d.anciennes ? ', ' + d.anciennes + ' ancienne(s) en déchiffrement seul' : '') + ')');
    else console.warn('  ⚠️  Scans d\'ordonnance stockés EN CLAIR (définir SCANS_CLE pour les chiffrer)');
  })();
  // Reprise des codes en clair : voir identite.js — c'est l'exception assumee a
  // la regle « pas de migration ecrite en base », puisque le but EST d'en faire
  // disparaitre un secret.
  try {
    const etat = await lireEtatBrut();
    const n = identite.convertirCodes(etat);
    if (n > 0) { await ecrireEtatBrut(etat); console.log('  🔑 ' + n + ' code(s) converti(s) en empreinte, clair efface'); }
    const d = identite.diagnostic(etat);
    console.log('  🔑 Identite : ' + d.avecEmpreinte + '/' + d.personnes + ' code(s) en empreinte'
      + (d.encoreEnClair ? ', ' + d.encoreEnClair + ' ENCORE EN CLAIR' : '')
      + ', administrateur ' + (d.adminEmpreinte ? 'configure' : (d.adminSecours ? 'par ADMIN_PASSWORD' : 'ABSENT')));
    if (!d.avecEmpreinte) console.error('  ⛔ AUCUN code ne permet d\'ouvrir une session : personne ne pourra se connecter.');
    if (!d.adminEmpreinte && !d.adminSecours) console.error('  ⛔ Aucun mot de passe administrateur : definissez ADMIN_PASSWORD pour entrer.');
  } catch (e) { console.error('  ⛔ Reprise des codes impossible :', e.message); }
  try {
    await traces.creerTable(db);
    if (db) {
      const n = await traces.purger(db);
      console.log('  📓 Journal des accès : conservation ' + traces.JOURS_GARDE + ' jours'
        + (n ? ', ' + n + ' ligne(s) hors délai purgée(s)' : ''));
      // Une purge par jour suffit : le journal ne grossit pas assez vite pour
      // justifier davantage, et un intervalle long survit aux redemarrages.
      setInterval(() => { traces.purger(db).catch(() => {}); }, 24 * 60 * 60 * 1000);
    }
  } catch (e) { console.error('  ⛔ Journal des accès indisponible :', e.message); }
  await temperatures.demarrer(db);
  if (db) smsProg.demarrer();
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
