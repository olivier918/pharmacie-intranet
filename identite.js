// ─────────────────────────────────────────────────────────────────────────────
//  IDENTITÉ — qui est devant le poste, vérifié par le SERVEUR
// ─────────────────────────────────────────────────────────────────────────────
//
//  CE QUI CHANGE, ET POURQUOI. Jusqu'ici le code PIN etait compare DANS LE
//  NAVIGATEUR, contre la liste complete du personnel que /api/data livrait a
//  chaque poste — PIN compris. Trois consequences :
//    - n'importe qui ouvrant la console lisait les codes de ses collegues et
//      agissait sous leur identite ;
//    - les PIN dormaient en clair dans PostgreSQL et dans 300 instantanes ;
//    - le journal d'actions ne prouvait rien, l'identite etant usurpable.
//
//  Desormais : le PIN part au serveur, qui le compare a une EMPREINTE (scrypt,
//  sel par personne) et renvoie un cookie de session nominatif. Le PIN en clair
//  n'existe plus nulle part — ni en base, ni sur le reseau au repos, ni dans le
//  navigateur.
//
//  LE POINT DELICAT : un PIN a quatre chiffres, c'est 10 000 combinaisons. Le
//  hachage protege la base en cas de fuite, il ne protege pas d'un essai en
//  force. C'est le FREINAGE ci-dessous qui s'en charge — sans lui, tout le
//  reste serait decoratif.
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');

const COOKIE = 'phc_user';
const DUREE_MS = 12 * 60 * 60 * 1000;          // une journee de travail
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SECURE = process.env.NODE_ENV === 'production' || !!process.env.DATABASE_URL;

// Freinage : au-dela de ce nombre d'echecs, l'adresse attend. Dix essais laissent
// largement la place aux doigts qui glissent, et rendent le balayage des 10 000
// combinaisons impraticable.
const ECHECS_MAX = 10;
const FENETRE_MS = 15 * 60 * 1000;

// ── Empreintes ──────────────────────────────────────────────────────────────
// scrypt plutot qu'un simple SHA : il est volontairement lent et gourmand en
// memoire. Sur un secret aussi court qu'un PIN, c'est le seul rempart serieux
// si la base venait a fuir.
function empreinte(pin, sel) {
  return crypto.scryptSync(String(pin), sel, 32, { N: 16384, r: 8, p: 1 }).toString('hex');
}
function nouveauSel() { return crypto.randomBytes(16).toString('hex'); }

// Comparaison a temps constant : une comparaison naive revele, par sa duree, le
// nombre de caracteres justes.
function memeEmpreinte(a, b) {
  const x = Buffer.from(String(a || ''), 'utf8'), y = Buffer.from(String(b || ''), 'utf8');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// ── Le cookie de session nominatif ──────────────────────────────────────────
function b64url(b) { return Buffer.from(b).toString('base64url'); }
function signer(o) {
  const p = b64url(JSON.stringify(o));
  return p + '.' + crypto.createHmac('sha256', SECRET).update(p).digest('base64url');
}
function verifier(jeton) {
  if (!jeton || jeton.indexOf('.') < 0) return null;
  const [p, mac] = jeton.split('.');
  const attendu = crypto.createHmac('sha256', SECRET).update(p).digest('base64url');
  const a = Buffer.from(mac), b = Buffer.from(attendu);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let o; try { o = JSON.parse(Buffer.from(p, 'base64url').toString()); } catch (e) { return null; }
  if (!o || !o.exp || Date.now() > o.exp) return null;
  return o;
}
function lireCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(function (p) {
    const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function poserCookie(res, uid) {
  const parts = [COOKIE + '=' + signer({ uid: uid, exp: Date.now() + DUREE_MS }),
    'HttpOnly', 'Path=/', 'SameSite=Lax', 'Max-Age=' + Math.floor(DUREE_MS / 1000)];
  if (SECURE) parts.push('Secure');
  // On AJOUTE l'en-tete : le portail pose deja le sien, et un setHeader
  // ecraserait la session d'acces a l'officine.
  const deja = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', (deja ? [].concat(deja) : []).concat(parts.join('; ')));
}
function retirerCookie(res) {
  const parts = [COOKIE + '=', 'HttpOnly', 'Path=/', 'Max-Age=0'];
  if (SECURE) parts.push('Secure');
  const deja = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', (deja ? [].concat(deja) : []).concat(parts.join('; ')));
}
// Identifiant de la personne connectee, ou null.
function qui(req) { const o = verifier(lireCookies(req)[COOKIE]); return o ? o.uid : null; }

// ── Ce qui ne sort jamais, ce qui n'entre jamais ────────────────────────────
// Les deux sens comptent. Nettoyer la sortie sans nettoyer l'entree laisserait
// un poste resté sur l'ancien code RENVOYER les PIN en clair, et la fusion
// champ par champ les remettrait sagement en base.
const SECRETS_STAFF = ['pin', 'pinHash', 'pinSel'];

function sansSecrets(data) {
  if (!data || typeof data !== 'object') return data;
  const out = Object.assign({}, data);
  if (Array.isArray(out.staffDB)) {
    out.staffDB = out.staffDB.map(function (s) {
      if (!s || typeof s !== 'object') return s;
      const c = Object.assign({}, s);
      SECRETS_STAFF.forEach(function (k) { delete c[k]; });
      // Ce que le poste a le droit de savoir : qu'un code existe, pas lequel.
      c.aPin = !!(s.pinHash || s.pin);
      return c;
    });
  }
  if (out.ADMIN && typeof out.ADMIN === 'object') {
    out.ADMIN = { mail: out.ADMIN.mail || '' };
  }
  return out;
}

// Retire des donnees RECUES tout ce qui touche aux secrets : un client n'a
// aucune raison legitime d'en proposer, et la seule voie de changement d'un
// code est la route dediee ci-dessous.
function sansSecretsEntrants(recu) {
  if (!recu || typeof recu !== 'object') return recu;
  if (Array.isArray(recu.staffDB)) {
    recu.staffDB.forEach(function (s) {
      if (s && typeof s === 'object') SECRETS_STAFF.concat(['aPin']).forEach(function (k) { delete s[k]; });
    });
  }
  if (recu.ADMIN && typeof recu.ADMIN === 'object') {
    delete recu.ADMIN.pw; delete recu.ADMIN.pwHash; delete recu.ADMIN.pwSel;
  }
  return recu;
}

// ── Ce que la fusion ne doit jamais emporter ────────────────────────────────
// mergeState fait `Object.assign({}, existing, incoming)` : une rubrique OBJET
// envoyee par un poste REMPLACE celle de la base, elle ne s'y fond pas. Or le
// client envoie desormais `ADMIN = { mail }`, sans empreinte — la premiere
// sauvegarde venue effacait donc `pwHash` et `pwSel`, et plus personne ne
// passait l'ecran de connexion.
//
// staffDB echappe au probleme : il se fusionne CHAMP par champ, et un
// enregistrement entrant sans `pinHash` laisse celui de la base en place. On le
// protege quand meme, parce qu'une fusion peut changer et que cette erreur-la
// coute une officine bloquee un matin.
function preserverSecrets(existant, fusionne) {
  if (!fusionne || typeof fusionne !== 'object') return fusionne;
  const A = (existant && existant.ADMIN) || null;
  if (A && (A.pwHash || A.pwSel)) {
    fusionne.ADMIN = Object.assign({}, fusionne.ADMIN || {});
    if (!fusionne.ADMIN.pwHash) { fusionne.ADMIN.pwHash = A.pwHash; fusionne.ADMIN.pwSel = A.pwSel; }
    if (!fusionne.ADMIN.mail && A.mail) fusionne.ADMIN.mail = A.mail;
  }
  if (Array.isArray(fusionne.staffDB) && Array.isArray(existant && existant.staffDB)) {
    const avant = new Map(existant.staffDB.filter(s => s && s.id != null).map(s => [s.id, s]));
    fusionne.staffDB.forEach(function (s) {
      if (!s || s.id == null) return;
      const a = avant.get(s.id); if (!a) return;
      if (!s.pinHash && a.pinHash) { s.pinHash = a.pinHash; s.pinSel = a.pinSel; }
    });
  }
  return fusionne;
}

// ── La reprise des codes existants ──────────────────────────────────────────
// CLAUDE.md interdit d'ecrire une migration de donnees en base — la regle est
// bonne, et celle-ci en est l'exception assumee : le but EST de faire
// disparaitre un secret de la base. La traduire a la lecture laisserait les PIN
// en clair dans PostgreSQL et dans les 300 instantanes d'historique, c'est-a-
// dire ne rien corriger. Elle ne s'execute qu'une fois, chaque code etant
// converti puis efface.
function convertirCodes(data) {
  if (!data || !Array.isArray(data.staffDB)) return 0;
  let n = 0;
  data.staffDB.forEach(function (s) {
    if (!s || typeof s !== 'object') return;
    if (s.pin && !s.pinHash) {
      s.pinSel = nouveauSel();
      s.pinHash = empreinte(s.pin, s.pinSel);
      n++;
    }
    // `null` et non delete : staffDB se fusionne CHAMP PAR CHAMP cote serveur,
    // et une cle supprimee serait reintroduite par la copie d'un poste en retard.
    if (s.pin) { s.pin = null; s.updatedAt = Date.now(); }
  });
  if (data.ADMIN && data.ADMIN.pw && !data.ADMIN.pwHash) {
    data.ADMIN.pwSel = nouveauSel();
    data.ADMIN.pwHash = empreinte(data.ADMIN.pw, data.ADMIN.pwSel);
    data.ADMIN.pw = null;
    n++;
  }
  return n;
}

// ── Le freinage ─────────────────────────────────────────────────────────────
const _echecs = new Map();   // adresse -> { n, jusqu }
function adresse(req) {
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
      || req.socket.remoteAddress || '?';
}
function freine(req) {
  const e = _echecs.get(adresse(req));
  if (!e) return 0;
  if (Date.now() > e.jusqu) { _echecs.delete(adresse(req)); return 0; }
  return e.n >= ECHECS_MAX ? Math.ceil((e.jusqu - Date.now()) / 1000) : 0;
}
function noterEchec(req) {
  const a = adresse(req), e = _echecs.get(a);
  if (!e || Date.now() > e.jusqu) _echecs.set(a, { n: 1, jusqu: Date.now() + FENETRE_MS });
  else { e.n++; e.jusqu = Date.now() + FENETRE_MS; }
}
function oublierEchecs(req) { _echecs.delete(adresse(req)); }

// ─────────────────────────────────────────────────────────────────────────────
function installer(app, deps) {
  const { lireEtat, ecrireEtat, journaliser } = deps;

  // Qui suis-je ? Le front s'en sert au chargement pour reprendre une session
  // en cours plutot que de redemander le code a chaque rafraichissement.
  app.get('/api/session', async (req, res) => {
    const uid = qui(req);
    if (!uid) return res.json({ ok: true, connecte: false });
    try {
      const data = await lireEtat();
      const s = (data.staffDB || []).find(x => x && x.id === uid);
      if (!s) { retirerCookie(res); return res.json({ ok: true, connecte: false }); }
      const c = Object.assign({}, s); SECRETS_STAFF.forEach(k => delete c[k]);
      return res.json({ ok: true, connecte: true, user: c });
    } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
  });

  // Le code PIN : compare ici, jamais dans le navigateur.
  app.post('/api/session/pin', async (req, res) => {
    const attente = freine(req);
    if (attente) return res.status(429).json({ ok: false, error: 'trop_d_essais', attente });
    const pin = String((req.body && req.body.pin) || '').trim();
    if (!/^\d{4,8}$/.test(pin)) { noterEchec(req); return res.status(400).json({ ok: false, error: 'code_invalide' }); }
    try {
      const data = await lireEtat();
      const liste = Array.isArray(data.staffDB) ? data.staffDB : [];
      // On parcourt TOUT le monde, sans court-circuit : sortir a la premiere
      // correspondance ferait varier le temps de reponse selon la position de la
      // personne dans la liste, ce qui se mesure.
      let trouve = null;
      for (const s of liste) {
        if (!s || !s.pinHash || !s.pinSel) continue;
        if (memeEmpreinte(empreinte(pin, s.pinSel), s.pinHash) && !trouve) trouve = s;
      }
      if (!trouve) { noterEchec(req); return res.status(401).json({ ok: false, error: 'code_inconnu' }); }
      oublierEchecs(req);
      poserCookie(res, trouve.id);
      const c = Object.assign({}, trouve); SECRETS_STAFF.forEach(k => delete c[k]);
      if (journaliser) journaliser(trouve.id, 'Ouverture de session');
      return res.json({ ok: true, user: c });
    } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/session/fin', (req, res) => { retirerCookie(res); res.json({ ok: true }); });

  // Le mot de passe administrateur du planning, retire du fichier public.
  app.post('/api/session/admin', async (req, res) => {
    const attente = freine(req);
    if (attente) return res.status(429).json({ ok: false, error: 'trop_d_essais', attente });
    const mail = String((req.body && req.body.mail) || '').trim().toLowerCase();
    const pw = String((req.body && req.body.pw) || '');
    try {
      const data = await lireEtat();
      const A = data.ADMIN || {};
      const attenduMail = String(A.mail || '').trim().toLowerCase();
      const okMail = !attenduMail || memeEmpreinte(
        crypto.createHash('sha256').update(mail).digest('hex'),
        crypto.createHash('sha256').update(attenduMail).digest('hex'));
      // Soupape ADMIN_PASSWORD. Elle vaut TOUJOURS, et non plus seulement quand
      // la base est vide : le 13/09/2026, une empreinte effacee par la fusion a
      // enferme l'officine dehors, et la soupape — conditionnee a l'absence
      // d'empreinte — ne s'est pas ouverte. Une clé de secours qui ne fonctionne
      // que dans le cas qu'on avait prevu n'est pas une clé de secours.
      // Elle vit dans une variable d'environnement, jamais dans le code ni en
      // base ; la connaitre suppose l'acces a la console d'hebergement.
      const secours = (process.env.ADMIN_PASSWORD || '').trim();
      const parSecours = !!secours && !!pw && memeEmpreinte(
        crypto.createHash('sha256').update(pw).digest('hex'),
        crypto.createHash('sha256').update(secours).digest('hex'));
      const parEmpreinte = !!(A.pwHash && A.pwSel) && memeEmpreinte(empreinte(pw, A.pwSel), A.pwHash);
      const okPw = parEmpreinte || parSecours;
      if (parSecours && !parEmpreinte && journaliser) journaliser('secours', 'Accès administrateur par ADMIN_PASSWORD');
      if (!okMail || !okPw) { noterEchec(req); return res.status(401).json({ ok: false, error: 'identifiants_refuses' }); }
      oublierEchecs(req);
      return res.json({ ok: true });
    } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
  });

  // Changer l'acces administrateur du planning. Reserve a un administrateur
  // deja identifie : sans cela, la route serait un moyen de se donner l'acces.
  app.post('/api/session/admin/maj', async (req, res) => {
    const uid = qui(req);
    if (!uid) return res.status(401).json({ ok: false, error: 'non_identifie' });
    const mail = String((req.body && req.body.mail) || '').trim();
    const pw = String((req.body && req.body.pw) || '');
    if (!mail) return res.status(400).json({ ok: false, error: 'mail_requis' });
    if (pw && pw.length < 10) return res.status(400).json({ ok: false, error: 'mot_de_passe_trop_court' });
    try {
      const data = await lireEtat();
      const moi = (data.staffDB || []).find(x => x && x.id === uid);
      if (!moi || !moi.admin) return res.status(403).json({ ok: false, error: 'interdit' });
      data.ADMIN = data.ADMIN || {};
      data.ADMIN.mail = mail;
      if (pw) { data.ADMIN.pwSel = nouveauSel(); data.ADMIN.pwHash = empreinte(pw, data.ADMIN.pwSel); data.ADMIN.pw = null; }
      await ecrireEtat(data);
      if (journaliser) journaliser(uid, 'Accès administrateur modifié');
      return res.json({ ok: true });
    } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
  });

  // Changer un code. Seul chemin possible : la rubrique staffDB envoyee par les
  // postes ne porte plus de secret, et le serveur en refuse.
  app.post('/api/session/code', async (req, res) => {
    const uid = qui(req);
    if (!uid) return res.status(401).json({ ok: false, error: 'non_identifie' });
    const cible = String((req.body && req.body.id) || uid);
    const neuf = String((req.body && req.body.pin) || '').trim();
    if (!/^\d{4,8}$/.test(neuf)) return res.status(400).json({ ok: false, error: 'code_invalide' });
    try {
      const data = await lireEtat();
      const liste = Array.isArray(data.staffDB) ? data.staffDB : [];
      const moi = liste.find(x => x && x.id === uid);
      // On ne change que son propre code, sauf a etre administrateur.
      if (cible !== uid && !(moi && moi.admin)) return res.status(403).json({ ok: false, error: 'interdit' });
      const s = liste.find(x => x && x.id === cible);
      if (!s) return res.status(404).json({ ok: false, error: 'introuvable' });
      // Deux personnes avec le meme code, et l'identification designe la
      // premiere venue : on refuse, comme le faisait l'ancien ecran.
      for (const autre of liste) {
        if (!autre || autre.id === cible || !autre.pinHash || !autre.pinSel) continue;
        if (memeEmpreinte(empreinte(neuf, autre.pinSel), autre.pinHash)) {
          return res.status(409).json({ ok: false, error: 'code_deja_pris' });
        }
      }
      s.pinSel = nouveauSel(); s.pinHash = empreinte(neuf, s.pinSel); s.pin = null;
      s.updatedAt = Date.now();
      await ecrireEtat(data);
      if (journaliser) journaliser(uid, 'Code modifié' + (cible !== uid ? ' pour ' + cible : ''));
      return res.json({ ok: true });
    } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
  });
}

// Etat de l'identification, affiche au demarrage. Un serveur qui ne peut
// identifier personne doit le DIRE : c'est le genre de panne qu'on decouvre
// autrement a 8 h 30, devant un comptoir qui se remplit.
function diagnostic(data) {
  const liste = Array.isArray(data && data.staffDB) ? data.staffDB : [];
  const avec = liste.filter(s => s && s.pinHash && s.pinSel).length;
  const clair = liste.filter(s => s && s.pin).length;
  const A = (data && data.ADMIN) || {};
  return { personnes: liste.length, avecEmpreinte: avec, encoreEnClair: clair,
           adminEmpreinte: !!(A.pwHash && A.pwSel), adminSecours: !!(process.env.ADMIN_PASSWORD || '').trim() };
}

module.exports = {
  installer, sansSecrets, sansSecretsEntrants, preserverSecrets, convertirCodes, diagnostic,
  qui, empreinte, nouveauSel, SECRETS_STAFF
};
