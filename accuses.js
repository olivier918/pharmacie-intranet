/* ═══════════════════════════════════════════════════════════════════════════
   PILOT — Accusés de remise des SMS (webhooks Brevo)
   ---------------------------------------------------------------------------
   « SMS envoyé » ne voulait dire qu'une chose : Brevo a accepté la demande.
   Pas que le patient l'a reçu. Un numéro changé, un mobile éteint depuis trois
   semaines, un opérateur qui rejette — et la personne n'a jamais su que son
   ordonnance était prête, pendant qu'on la croyait prévenue.

   Brevo rappelle l'intranet à chaque changement d'état. On enregistre, on
   affiche, et quand un message n'arrive pas on ouvre une transmission pour
   que quelqu'un reprenne le patient autrement.

   TROIS CHOSES QUI EXPLIQUENT LA FORME DE CE FICHIER
   --------------------------------------------------
   1. LES ACCUSÉS ARRIVENT DANS LE DÉSORDRE. « delivered » peut précéder
      « sent » : ce sont deux chemins réseau différents. Un état final ne
      redevient donc jamais « en cours » (voir `doitRemplacer`).

   2. BREVO NE SIGNE PAS SES APPELS. Contrairement à Stripe, il n'y a pas de
      signature à vérifier — mais il sait poser un en-tête personnalisé. Le
      secret voyage donc dans un en-tête, JAMAIS dans l'adresse : une adresse
      se retrouve dans les journaux de tous les serveurs traversés.

   3. LE NUMÉRO DU PATIENT N'EST PAS ENREGISTRÉ ICI. Le webhook le transmet,
      mais `smsLog` sait déjà à qui ce message était destiné. Recopier un
      numéro de mobile dans une deuxième table, c'est une donnée personnelle
      de plus à protéger, à purger et à justifier — pour rien.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';
const crypto = require('crypto');

// Combien de temps on garde un accusé. Au-delà, la fiche porte déjà
// l'information utile et l'accusé n'apprend plus rien.
const ACCUSES_JOURS = Math.max(7, parseInt(process.env.ACCUSES_JOURS, 10) || 400);

// ─── Ce que Brevo dit, ce que l'écran doit montrer ──────────────────────────
// Quatre états, et le vocabulaire est celui du comptoir, pas celui de l'API :
// une préparatrice n'a pas à savoir ce qu'est un « soft bounce ».
const ETATS = {
  queued: 'en cours', sent: 'en cours', accepted: 'en cours',
  delivered: 'remis',
  soft_bounce: 'non remis', hard_bounce: 'non remis', rejected: 'non remis',
  blocked: 'non remis', blacklisted: 'non remis', skip: 'non remis', error: 'non remis',
  unsubscribed: 'autre', unsubscribe: 'autre', replied: 'autre', reply: 'autre', subscribe: 'autre'
};
function etatSms(brut) {
  const k = String(brut == null ? '' : brut).trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!k) return 'autre';
  return ETATS[k] || 'autre';
}
const FINAL = { 'remis': 1, 'non remis': 1 };

// ─── Retrouver DE QUEL envoi il s'agit ──────────────────────────────────────
// Le piège : `reference` est tantôt une chaîne, tantôt un objet {"1":"abc"}.
// Et selon le module, l'intranet a pu retenir `messageId` plutôt que
// `reference` — `sendSmsViaBrevo` garde `messageId || reference`. On récolte
// donc TOUTES les clés possibles et on range l'accusé sous chacune. Chercher
// la bonne aurait demandé de savoir laquelle a été retenue ce jour-là.
function clesSms(charge) {
  const out = [];
  const ajouter = (v) => {
    if (v === null || v === undefined) return;
    if (typeof v === 'object') { Object.keys(v).forEach(k => ajouter(v[k])); return; }
    const s = String(v).trim();
    if (s && out.indexOf(s) === -1) out.push(s);
  };
  if (charge) { ajouter(charge.messageId); ajouter(charge.message_id); ajouter(charge.reference); }
  return out;
}

// ─── Un accusé remplace-t-il celui qu'on a déjà ? ───────────────────────────
// La règle tient en une phrase : on avance, on ne recule pas. Un « sent »
// arrivé en retard ne doit pas effacer le « delivered » déjà reçu — sinon la
// fiche repasserait en « en cours » et personne ne comprendrait pourquoi.
function doitRemplacer(ancien, nouveau) {
  if (!ancien) return true;
  if (!nouveau) return false;
  const aFinal = !!FINAL[ancien.etat], nFinal = !!FINAL[nouveau.etat];
  if (aFinal && !nFinal) return false;          // jamais de retour en arrière
  if (!aFinal && nFinal) return true;           // un état final l'emporte toujours
  return Number(nouveau.ts || 0) >= Number(ancien.ts || 0);
}

// ─── Lire un accusé, quelle que soit sa forme ───────────────────────────────
function lireAccuse(charge) {
  if (!charge || typeof charge !== 'object') return null;
  const brut = charge.msg_status || charge.event || charge.status || null;
  const cles = clesSms(charge);
  if (!cles.length) return null;
  const ts = Number(charge.ts_event || charge.ts || 0) || Math.floor(Date.now() / 1000);
  const detail = [charge.description, charge.reason,
    charge.error_code !== undefined && charge.error_code !== null ? 'code ' + charge.error_code : null]
    .filter(Boolean).join(' · ') || null;
  return { cles, brut: brut ? String(brut) : null, etat: etatSms(brut), ts, detail };
}

// Un envoi groupé arrive en tableau, un envoi simple en objet. Brevo fait les
// deux selon le réglage `batched`.
function lireCharge(corps) {
  const l = Array.isArray(corps) ? corps
    : (corps && Array.isArray(corps.events) ? corps.events : [corps]);
  return l.map(lireAccuse).filter(Boolean);
}

// ─── Comparaison du secret, à temps constant ────────────────────────────────
function memeSecret(a, b) {
  const x = Buffer.from(String(a || ''), 'utf8'), y = Buffer.from(String(b || ''), 'utf8');
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

async function creerTable(db) {
  if (!db) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS app_sms (
      cle    TEXT PRIMARY KEY,
      etat   TEXT NOT NULL,
      brut   TEXT,
      detail TEXT,
      ts     BIGINT,
      fil    BIGINT,
      maj    TIMESTAMP DEFAULT NOW()
    )
  `);
  await db.query('CREATE INDEX IF NOT EXISTS app_sms_maj ON app_sms (maj DESC)');
}

// ─── Enregistrement ─────────────────────────────────────────────────
// Un accusé est rangé sous CHACUNE de ses clés : on ne sait pas laquelle le
// module émetteur a retenue, et une recherche ratée vaudrait un statut perdu.
async function enregistrer(db, accuses) {
  const echecs = [];
  for (const a of accuses) {
    let pose = false;
    for (const cle of a.cles) {
      const r = await db.query('SELECT etat, ts, fil FROM app_sms WHERE cle = $1', [cle]);
      const ancien = r.rows[0] || null;
      if (!doitRemplacer(ancien, a)) continue;
      await db.query(
        'INSERT INTO app_sms (cle, etat, brut, detail, ts, maj) VALUES ($1,$2,$3,$4,$5,NOW())'
        + ' ON CONFLICT (cle) DO UPDATE SET etat = $2, brut = $3, detail = $4, ts = $5, maj = NOW()',
        [cle, a.etat, a.brut, a.detail, a.ts]);
      pose = true;
    }
    // Une transmission par échec, et une seule : la colonne `fil` de la
    // première clé se souvient qu'on l'a déjà ouverte. Sans elle, les trois
    // accusés successifs d'un même envoi raté feraient trois billets.
    if (pose && a.etat === 'non remis') {
      const g = await db.query('SELECT fil FROM app_sms WHERE cle = $1', [a.cles[0]]);
      if (!(g.rows[0] && g.rows[0].fil)) echecs.push(a);
    }
  }
  return echecs;
}

// ─── Ouvrir une transmission pour ce qui n'est pas arrivé ───────────────
// `smsLog` sait à qui chaque message était destiné : c'est là qu'on retrouve le
// patient, pas en parcourant les trois modules émetteurs.
function trouverEnvoi(blob, cles) {
  const l = blob && Array.isArray(blob.smsLog) ? blob.smsLog : [];
  for (const e of l) {
    if (e && e.smsId != null && cles.indexOf(String(e.smsId)) !== -1) return e;
  }
  return null;
}

function texteEchec(envoi, a) {
  const qui = envoi && (envoi.nom || envoi.prenom)
    ? String(envoi.nom || '') + ' ' + String(envoi.prenom || '')
    : null;
  const src = envoi && envoi.source ? envoi.source : null;
  return 'Le SMS ' + (src ? '« ' + src + ' » ' : '')
    + (qui ? 'à ' + qui.trim() + ' ' : '')
    + 'n\'est pas arrivé (' + (a.brut || a.etat) + ').'
    + (a.detail ? ' ' + a.detail + '.' : '')
    + ' Le patient n\'a donc pas été prévenu : reprendre contact autrement.';
}

async function ouvrirTransmissions(db, deps, echecs) {
  if (!echecs.length || !deps.lireEtat || !deps.ecrireEtat) return 0;
  const blob = await deps.lireEtat();
  if (!blob || typeof blob !== 'object') return 0;
  const fils = Array.isArray(blob.threads) ? blob.threads : [];
  const n = new Date();
  const hh = String(n.getHours()).padStart(2, '0') + ':' + String(n.getMinutes()).padStart(2, '0');
  const jj = String(n.getDate()).padStart(2, '0') + '/' + String(n.getMonth() + 1).padStart(2, '0');
  let poses = 0;
  for (const a of echecs) {
    const envoi = trouverEnvoi(blob, a.cles);
    const titre = envoi && envoi.nom ? String(envoi.nom) + ' ' + String(envoi.prenom || '') : 'SMS non remis';
    // Un identifiant qui ne peut pas entrer en collision avec ceux du
    // navigateur (Date.now()) : la fusion par id ne doit jamais confondre
    // deux fils. On décale, et on vérifie.
    let id = Date.now() * 10 + 7;
    while (fils.some(f => f && f.id === id)) id++;
    fils.unshift({
      id: id, subj: titre.trim(), type: 'Patient', status: 'open',
      patient: envoi && envoi.nom ? { nom: envoi.nom, prenom: envoi.prenom || '', tel: envoi.tel || '' } : null,
      msgs: [{ from: 'SMS', text: texteEchec(envoi, a), time: hh, date: jj }],
      updatedAt: Date.now()
    });
    await db.query('UPDATE app_sms SET fil = $2 WHERE cle = $1', [a.cles[0], id]);
    poses++;
  }
  if (poses) { blob.threads = fils; await deps.ecrireEtat(blob); }
  return poses;
}

// ─── La route d'arrivée ─────────────────────────────────────────
// À monter AVANT le portail : Brevo n'a pas de session. Le secret le remplace.
function installer(app, deps) {
  const express = require('express');
  const secret = (process.env.BREVO_HOOK_SECRET || '').trim();
  app.post('/api/brevo/sms', express.json({ limit: '256kb' }), async (req, res) => {
    // Pas de secret posé : la route n'existe pas. Un point d'entrée public et
    // non authentifié ne doit jamais exister « en attendant ».
    if (!secret) return res.status(503).json({ ok: false, error: 'hook_desactive' });
    if (!memeSecret(req.headers['x-pilot-hook'], secret)) {
      // On journalise les NOMS des en-tetes recus, jamais leurs valeurs.
      // Au raccordement, la seule question est « Brevo envoie-t-il bien
      // l'en-tete convenu ? » ; y repondre sans cela demande de deviner.
      console.warn('  \u26a0\ufe0f  Accuse SMS refuse. En-tetes recus : '
        + Object.keys(req.headers || {}).join(', '));
      return res.status(401).json({ ok: false });
    }

    const db = deps.getDb && deps.getDb();
    const accuses = lireCharge(req.body);
    if (!accuses.length) return res.json({ ok: true, recus: 0 });
    if (!db) return res.status(503).json({ ok: false, error: 'base_indisponible' });

    // On traite AVANT de répondre. Répondre 200 puis échouer, c'est perdre
    // l'accusé pour toujours : personne ne le renverra. Leçon du webhook
    // Stripe, constat #6 de l'audit.
    try {
      const echecs = await enregistrer(db, accuses);
      let fils = 0;
      if (echecs.length) {
        try { fils = await ouvrirTransmissions(db, deps, echecs); }
        catch (e) { console.error('  ⚠️  Transmission d\'échec SMS :', e.message); }
      }
      res.json({ ok: true, recus: accuses.length, fils: fils });
    } catch (e) {
      // 500 : Brevo réessaiera, et un réessai peut réussir.
      console.error('  ⛔ Accusés SMS :', e.message);
      res.status(500).json({ ok: false });
    }
  });
  console.log(secret
    ? '  ✉️  Accusés de remise SMS actifs (/api/brevo/sms)'
    : '  ✉️  Accusés de remise SMS INACTIFS (BREVO_HOOK_SECRET non defini)');
}

// ─── Lecture par l'écran ──────────────────────────────────────
// Derrière le portail, celle-là. Elle ne rend que des identifiants d'envoi et
// des états — aucun numéro, aucun nom, aucun texte de message.
function installerLecture(app, deps) {
  app.get('/api/sms-statuts', async (req, res) => {
    const db = deps.getDb && deps.getDb();
    if (!db) return res.json({ ok: true, statuts: {} });
    try {
      const r = await db.query(
        'SELECT cle, etat, detail, ts FROM app_sms'
        + ' WHERE maj > NOW() - ($1 * INTERVAL \'1 day\') ORDER BY maj DESC LIMIT 3000',
        [ACCUSES_JOURS]);
      const statuts = {};
      r.rows.forEach(x => { statuts[x.cle] = { etat: x.etat, detail: x.detail || null, ts: Number(x.ts) || null }; });
      res.json({ ok: true, statuts: statuts });
    } catch (e) { res.json({ ok: true, statuts: {}, erreur: e.message }); }
  });
}

// Purge : même doctrine que le journal des accès, une durée et pas un nombre.
async function elaguer(db) {
  if (!db) return 0;
  const r = await db.query('DELETE FROM app_sms WHERE maj < NOW() - ($1 * INTERVAL \'1 day\')', [ACCUSES_JOURS]);
  return r.rowCount || 0;
}

module.exports = {
  ACCUSES_JOURS, ETATS, etatSms, clesSms, doitRemplacer, lireAccuse, lireCharge,
  memeSecret, creerTable, enregistrer, trouverEnvoi, texteEchec, installer,
  installerLecture, elaguer
};
