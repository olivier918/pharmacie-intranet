// ─────────────────────────────────────────────────────────────────────────────
//  Suivi des armoires refrigerees — le robot qui interroge Testo Saveris
// ─────────────────────────────────────────────────────────────────────────────
//
//  CE QU'IL FAUT SAVOIR AVANT DE TOUCHER A CE FICHIER
//
//  1. L'API interrogee ici n'est PAS l'API publique documentee de Testo. C'est
//     celle que l'interface web Smart Connect utilise pour elle-meme. Testo ne
//     s'engage sur rien : elle peut changer sans preavis. C'est pourquoi CHAQUE
//     tirage laisse une trace, et pourquoi l'absence de donnees est elle-meme
//     une alerte. Un ecran vert sur des donnees figees est plus dangereux que
//     pas d'ecran du tout.
//
//  2. Testo reste le systeme qui fait foi — sondes etalonnees, certificat, et
//     ses propres notifications, QUI DOIVENT RESTER ACTIVEES. PILOT ajoute une
//     surveillance, il ne remplace rien.
//
//  3. Les mesures ne vont pas dans le blob : 384 par jour, ~140 000 par an, et
//     le blob est relu en entier par chaque poste toutes les huit secondes.
//     Elles vivent dans leur propre table (piege n°4 de CLAUDE.md : ce fichier
//     n'ajoute AUCUNE rubrique synchronisee).
//
//  Identifiants : SAVERIS_USER / SAVERIS_PASS, variables d'environnement.
//  Ils ne sont jamais journalises, jamais renvoyes par une route.
// ─────────────────────────────────────────────────────────────────────────────

const https = require('https');
const AL = require('./temp-alertes');

const AUTH_HOTE  = 'login.food.saveris.net';
const AUTH_CHEMIN = '/oauth/token';
const CLIENT_ID  = (process.env.SAVERIS_CLIENT_ID || 'meMfnSuasmwaep56PfeyJxkIDOxyEQgL').trim();
const AUDIENCE   = 'https://food.saveris.net/';
const API_HOTE   = 'stationary-monitoring-frontend.eu.p.platform.aws.testo.cloud';
const API_BASE   = '/api/saveris3-stationary-monitoring-service';

const PERIODE_MS   = 15 * 60 * 1000;   // rythme d'envoi de la sonde
const FENETRE_MS   =  2 * 3600 * 1000; // on redemande toujours DEUX HEURES :
                                       // apres une coupure, le trou se comble seul.
const MARGE_JETON_S = 300;             // on renouvelle 5 min avant l'expiration

function configure() {
  return !!(process.env.SAVERIS_USER && process.env.SAVERIS_PASS);
}

// ─── Petit client HTTPS, sans dependance ───
function requete(options, corps) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => resolve({ statut: res.statusCode, corps: body }));
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('Delai depasse (' + options.hostname + ')')));
    if (corps) req.write(corps);
    req.end();
  });
}

// ─── Le jeton ───
// Auth0. Duree de vie constatee : 24 h, sans jeton de rafraichissement — on
// redemande simplement un jeton quand celui-ci approche de sa fin.
let _jeton = null;         // { valeur, expireA }

async function jeton(force) {
  if (!force && _jeton && Date.now() < _jeton.expireA) return _jeton.valeur;
  if (!configure()) throw new Error('SAVERIS_USER / SAVERIS_PASS absents');

  const payload = JSON.stringify({
    grant_type: 'password',
    username: process.env.SAVERIS_USER,
    password: process.env.SAVERIS_PASS,
    audience: AUDIENCE,
    scope: 'openid profile email',
    client_id: CLIENT_ID
  });
  const r = await requete({
    hostname: AUTH_HOTE, path: AUTH_CHEMIN, method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }
  }, payload);

  if (r.statut < 200 || r.statut >= 300) {
    // On relaie le message d'Auth0 tel quel : « unauthorized_client » signifie
    // que l'echange identifiant/mot de passe est desactive sur l'application,
    // et qu'il faut basculer sur le flux « device code ». Le mot de passe, lui,
    // n'apparait jamais ici.
    let msg = r.corps;
    try { const j = JSON.parse(r.corps); msg = (j.error || '') + (j.error_description ? ' — ' + j.error_description : ''); } catch (e) {}
    throw new Error('Auth0 ' + r.statut + ' : ' + msg);
  }
  const j = JSON.parse(r.corps);
  const duree = Number(j.expires_in) || 86400;
  _jeton = { valeur: j.access_token, expireA: Date.now() + (duree - MARGE_JETON_S) * 1000 };
  return _jeton.valeur;
}

// ─── Appel de l'API de supervision ───
// Teste et confirme : un simple en-tete « Authorization: Bearer » suffit.
// Ni cookie, ni session a entretenir.
async function api(chemin, jt) {
  const r = await requete({
    hostname: API_HOTE, path: API_BASE + chemin, method: 'GET',
    headers: { Authorization: 'Bearer ' + jt, accept: 'application/json' }
  });
  return r;
}

async function apiJson(chemin, jt) {
  let r = await api(chemin, jt);
  if (r.statut === 401) {                  // jeton perime plus tot que prevu
    r = await api(chemin, await jeton(true));
  }
  if (r.statut < 200 || r.statut >= 300) throw new Error('API ' + r.statut + ' sur ' + chemin + ' : ' + r.corps.slice(0, 200));
  return JSON.parse(r.corps);
}

// ─── Les points de mesure ───
async function points(jt) {
  const j = await apiJson('/locations', jt);
  const arr = j.locations || j.content || (Array.isArray(j) ? j : []);
  return arr.map(l => ({ uuid: l.uuid || l.id, nom: l.name || l.label || l.uuid }));
}

// ─── Les mesures ───
// La forme exacte des parametres n'a pas ete relevee en session : plutot que de
// la deviner une fois pour toutes, on essaie les variantes plausibles et on
// retient celle qui repond. La variante gagnante est memorisee pour les tirages
// suivants ; si Testo change, on repart en exploration au lieu de tomber en
// panne silencieuse.
let _variante = null;

function variantes(uuids, deb, fin) {
  const t = (d) => new Date(d).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const D = encodeURIComponent(t(deb)), F = encodeURIComponent(t(fin));
  const tous = uuids.join(',');
  return [
    { cle: 'location_uuids',  chemin: `/measurements?location_uuids=${tous}&start_time=${D}&end_time=${F}` },
    { cle: 'location_ids',    chemin: `/measurements?location_ids=${tous}&start_time=${D}&end_time=${F}` },
    { cle: 'sans_filtre',     chemin: `/measurements?start_time=${D}&end_time=${F}` },
    { cle: 'par_point',       parPoint: true,
      chemin: (u) => `/measurements?location_uuid=${u}&start_time=${D}&end_time=${F}` },
    { cle: 'sous_ressource',  parPoint: true,
      chemin: (u) => `/locations/${u}/measurements?start_time=${D}&end_time=${F}` }
  ];
}

// La forme reelle de la reponse, relevee le 10/09/2026 :
//
//   { measurements: [
//       { locations: [{ uuid, name }],
//         physical_property: "GENERAL_TEMPERATURE",
//         measurements: [{ timestamp, value }, ...] },
//       ... un groupe par point ]}
//
// Le point n'est PAS a cote de chaque mesure : il est porte par le groupe. Une
// lecture naive qui cherche « un uuid quelque part au-dessus » les confond tous
// en un seul point — c'est arrive, et le symptome est traitre : les mesures
// arrivent, la table se remplit, mais quatre armoires n'en font plus qu'une.
function lireGroupes(j) {
  const groupes = j && Array.isArray(j.measurements) ? j.measurements : null;
  if (!groupes) return null;
  const sortie = [];
  for (const g of groupes) {
    // Un enregistreur peut aussi remonter de l'hygrometrie : on ne garde que la
    // temperature, sous peine de melanger des degres et des pourcentages.
    if (g.physical_property && !/TEMPERATURE/i.test(g.physical_property)) continue;
    const loc = Array.isArray(g.locations) ? g.locations[0] : (g.location || null);
    const point = loc ? (loc.uuid || loc.id) : null;
    const nom   = loc ? (loc.name || null) : null;
    const liste = Array.isArray(g.measurements) ? g.measurements : [];
    for (const m of liste) {
      const d = new Date(m.timestamp || m.time || m.measured_at);
      const v = Number(m.value !== undefined ? m.value : m.valeur);
      if (!isNaN(d.getTime()) && isFinite(v)) sortie.push({ point, nom, ts: d.toISOString(), valeur: v });
    }
  }
  return sortie;
}

// Repli, si Testo change la forme sans prevenir : on parcourt l'arbre a la
// recherche de couples (horodatage, valeur). Moins fiable pour l'identite du
// point, mais mieux que de ne plus rien enregistrer du tout.
const CLES_TEMPS  = ['timestamp', 'time', 'measurement_time', 'measured_at', 'ts', 'date_time', 'datetime'];
const CLES_VALEUR = ['value', 'valeur', 'measurement_value', 'temperature', 'val'];
const CLES_POINT  = ['location_uuid', 'location_id', 'locationUuid', 'uuid', 'id', 'location'];

function normaliser(noeud, pointCourant, sortie) {
  if (!noeud || typeof noeud !== 'object') return;
  if (Array.isArray(noeud)) { noeud.forEach(n => normaliser(n, pointCourant, sortie)); return; }

  let point = pointCourant;
  for (const c of CLES_POINT) {
    const v = noeud[c];
    if (typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(v)) { point = v; break; }
  }

  const ct = CLES_TEMPS.find(c => noeud[c] !== undefined && noeud[c] !== null);
  const cv = CLES_VALEUR.find(c => typeof noeud[c] === 'number');
  if (ct && cv) {
    const d = new Date(typeof noeud[ct] === 'number'
      ? (noeud[ct] > 1e12 ? noeud[ct] : noeud[ct] * 1000)
      : noeud[ct]);
    if (!isNaN(d.getTime())) sortie.push({ point, ts: d.toISOString(), valeur: noeud[cv] });
  }
  for (const k of Object.keys(noeud)) {
    if (noeud[k] && typeof noeud[k] === 'object') normaliser(noeud[k], point, sortie);
  }
}

async function mesures(jt, pts, deb, fin) {
  const uuids = pts.map(p => p.uuid);
  const liste = variantes(uuids, deb, fin);
  const ordre = _variante ? [liste.find(v => v.cle === _variante), ...liste.filter(v => v.cle !== _variante)].filter(Boolean) : liste;

  for (const v of ordre) {
    try {
      const sortie = [];
      const lire = (j, uuidForce) => {
        const exact = lireGroupes(j);
        if (exact && exact.length) { sortie.push(...exact); return; }
        const part = []; normaliser(j, uuidForce || null, part); sortie.push(...part);
      };
      if (v.parPoint) {
        for (const u of uuids) lire(await apiJson(v.chemin(u), jt), u);
      } else {
        lire(await apiJson(v.chemin, jt));
      }
      if (sortie.length) { _variante = v.cle; return sortie; }
    } catch (e) { /* variante suivante */ }
  }
  return [];
}

// ─── La table ───
// PRIMARY KEY (point, ts) : rejouer une plage ne duplique rien, ce qui rend le
// tirage sur deux heures gratuit et le rattrapage apres coupure automatique.
async function creerTable(db) {
  if (!db) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS app_temperatures (
      point   TEXT NOT NULL,
      ts      TIMESTAMPTZ NOT NULL,
      valeur  REAL NOT NULL,
      PRIMARY KEY (point, ts)
    )
  `);
  await db.query('CREATE INDEX IF NOT EXISTS app_temperatures_ts ON app_temperatures (ts DESC)');
  // Les lignes « inconnu » sont celles qu'une lecture fautive a ecrites avant la
  // correction du 10/09/2026 : quatre armoires confondues en une. Ce n'est pas
  // une migration de donnees (piege n°7) mais le retrait de rebut produit par un
  // defaut connu ; les vraies mesures reviendront d'elles-memes au prochain
  // tirage, qui redemande toujours deux heures.
  await db.query("DELETE FROM app_temperatures WHERE point = 'inconnu'");
  // Les reglages de l'alerte. UNE SEULE LIGNE, et une table a part plutot que
  // le blob : le robot tourne cote serveur, il ne doit pas avoir a lire un
  // fichier de donnees relu par chaque poste toutes les huit secondes. Meme
  // choix que l'interrupteur d'ouverture des depots.
  await db.query(`
    CREATE TABLE IF NOT EXISTS app_temp_reglages (
      id     INTEGER PRIMARY KEY DEFAULT 1,
      actif  BOOLEAN NOT NULL DEFAULT false,
      tel1   TEXT,
      tel2   TEXT,
      vmin   REAL NOT NULL DEFAULT 2,
      vmax   REAL NOT NULL DEFAULT 8,
      maj    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT app_temp_reglages_unique CHECK (id = 1)
    )
  `);
  await db.query('INSERT INTO app_temp_reglages (id) VALUES (1) ON CONFLICT (id) DO NOTHING');

  // Les astreintes. UNE TABLE, pas deux colonnes : l'equipe compte dix-huit
  // personnes et les tours changent. Deux numeros en dur, c'etait decider a la
  // place d'Olivier combien de gens peuvent etre prevenus.
  await db.query(`
    CREATE TABLE IF NOT EXISTS app_temp_astreintes (
      id     BIGSERIAL PRIMARY KEY,
      nom    TEXT NOT NULL DEFAULT '',
      tel    TEXT NOT NULL,
      actif  BOOLEAN NOT NULL DEFAULT true,
      maj    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // La reprise des deux anciens numeros, UNE SEULE FOIS. Sans ce drapeau, un
  // redemarrage ressusciterait une astreinte qu'on vient de retirer - et
  // quelqu'un recevrait des SMS de frigo a 3 h du matin sans comprendre.
  await db.query('ALTER TABLE app_temp_reglages ADD COLUMN IF NOT EXISTS repris BOOLEAN NOT NULL DEFAULT false');
  const av = await db.query('SELECT tel1, tel2, repris FROM app_temp_reglages WHERE id = 1');
  const g = av.rows[0];
  if (g && !g.repris) {
    for (const [n, t] of [['Astreinte 1', g.tel1], ['Astreinte 2', g.tel2]]) {
      if (t && String(t).trim()) {
        await db.query('INSERT INTO app_temp_astreintes (nom, tel) VALUES ($1, $2)', [n, String(t).trim()]);
      }
    }
    await db.query('UPDATE app_temp_reglages SET repris = true WHERE id = 1');
  }

  // Les episodes d'alerte. EN BASE, pas en memoire : un redemarrage - et il y
  // en a a chaque deploiement - ne doit ni renvoyer une alerte deja envoyee,
  // ni oublier qu'un frigo est en defaut depuis deux heures.
  await db.query(`
    CREATE TABLE IF NOT EXISTS app_temp_episodes (
      id               BIGSERIAL PRIMARY KEY,
      point            TEXT NOT NULL,
      motif            TEXT NOT NULL,
      ouvert_le        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      dernier_envoi_le TIMESTAMPTZ,
      clos_le          TIMESTAMPTZ,
      valeur           REAL,
      envois           INTEGER NOT NULL DEFAULT 0
    )
  `);
  await db.query('CREATE INDEX IF NOT EXISTS app_temp_episodes_ouverts ON app_temp_episodes (point) WHERE clos_le IS NULL');

  // Le releve quotidien signe. C'est la trace de la surveillance HUMAINE -
  // celle qu'un inspecteur demande, et celle qui manque au site Testo, qui ne
  // sait dire que ce que les sondes ont mesure, jamais que quelqu'un a regarde.
  await db.query(`
    CREATE TABLE IF NOT EXISTS app_temp_releves (
      id            BIGSERIAL PRIMARY KEY,
      le            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      par           TEXT NOT NULL,
      nom           TEXT NOT NULL DEFAULT '',
      debut         TIMESTAMPTZ,
      fin           TIMESTAMPTZ NOT NULL,
      depassements  INTEGER NOT NULL DEFAULT 0,
      commentaire   TEXT NOT NULL DEFAULT ''
    )
  `);
  await db.query('CREATE INDEX IF NOT EXISTS app_temp_releves_le ON app_temp_releves (le DESC)');

  // La trace des tirages : c'est elle qui distingue « le frigo va bien » de
  // « on ne sait plus rien du frigo ».
  await db.query(`
    CREATE TABLE IF NOT EXISTS app_temp_tirages (
      id      BIGSERIAL PRIMARY KEY,
      ts      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ok      BOOLEAN NOT NULL,
      recues  INTEGER NOT NULL DEFAULT 0,
      detail  TEXT
    )
  `);
}

// ─── Un tirage ───
let _dernier = { ts: null, ok: null, recues: 0, detail: null };

async function tirage(db) {
  const debut = Date.now();
  try {
    const jt  = await jeton();
    const pts = await points(jt);
    const nom = new Map(pts.map(p => [p.uuid, p.nom]));
    const brut = await mesures(jt, pts, debut - FENETRE_MS, debut);

    let ecrites = 0;
    for (const m of brut) {
      const etiquette = nom.get(m.point) || m.nom || m.point || 'inconnu';
      const r = await db.query(
        'INSERT INTO app_temperatures (point, ts, valeur) VALUES ($1, $2, $3) ON CONFLICT (point, ts) DO NOTHING',
        [etiquette, m.ts, m.valeur]
      );
      ecrites += r.rowCount;
    }
    _dernier = { ts: new Date().toISOString(), ok: true, recues: brut.length, ecrites,
                 variante: _variante, points: pts.length, detail: null };
    await db.query('INSERT INTO app_temp_tirages (ok, recues, detail) VALUES (true, $1, $2)',
                   [brut.length, 'variante=' + _variante + ' nouvelles=' + ecrites]);
    return _dernier;
  } catch (e) {
    _dernier = { ts: new Date().toISOString(), ok: false, recues: 0, detail: e.message };
    try { await db.query('INSERT INTO app_temp_tirages (ok, recues, detail) VALUES (false, 0, $1)', [e.message.slice(0, 400)]); } catch (_) {}
    console.error('  🌡️  Tirage temperatures en echec :', e.message);
    return _dernier;
  }
}

// ─── Les alertes ───
// Le robot enregistre ; ceci signale. Les deux sont volontairement separes :
// un defaut du signalement ne doit jamais empecher l'enregistrement, et un
// tirage en echec doit au contraire DECLENCHER le signalement.
const POINT_ROBOT = '(robot)';

async function lireReglages(db) {
  const r = await db.query('SELECT actif, vmin, vmax FROM app_temp_reglages WHERE id = 1');
  const g = r.rows[0] || {};
  const a = await db.query('SELECT id, nom, tel, actif FROM app_temp_astreintes ORDER BY id');
  return { actif: !!g.actif,
           vmin: g.vmin == null ? AL.PLAGE_DEFAUT.min : Number(g.vmin),
           vmax: g.vmax == null ? AL.PLAGE_DEFAUT.max : Number(g.vmax),
           astreintes: a.rows.map(x => ({ id: x.id, nom: x.nom || '', tel: x.tel, actif: !!x.actif })) };
}

async function episodeOuvert(db, point) {
  const r = await db.query(
    'SELECT * FROM app_temp_episodes WHERE point = $1 AND clos_le IS NULL ORDER BY id DESC LIMIT 1', [point]);
  return r.rows[0] || null;
}

// Envoie, et ne laisse JAMAIS un echec d'envoi interrompre la surveillance des
// autres points. Un numero injoignable ne doit pas rendre le dispositif muet.
async function envoyer(deps, tels, txt) {
  if (!deps || typeof deps.sms !== 'function' || !tels.length) return 0;
  let n = 0;
  for (const t of tels) {
    try { await deps.sms({ to: t, text: txt, tag: 'temp-alerte' }); n++; }
    catch (e) { console.error('  \ud83c\udf21\ufe0f  SMS alerte refuse :', e.message); }
  }
  return n;
}

async function evaluerAlertes(db, deps) {
  if (!db) return { actif: false, decisions: [] };
  const reg = await lireReglages(db);
  const tels = AL.destinataires(reg.astreintes, deps && deps.numero);
  const maintenant = new Date();
  const requis = AL.relevesRequis(maintenant);
  const plage = { min: reg.vmin, max: reg.vmax };
  const decisions = [];

  // On agit meme alertes eteintes : l'episode est trace, l'ecran le montre.
  // Seul l'ENVOI est conditionne. Un dispositif qui n'enregistre rien quand il
  // est en veille ne sait rien dire le jour ou on le rallume.
  const agir = async (point, dec, txt) => {
    decisions.push({ point: point, action: dec.action, motif: dec.motif, valeur: dec.valeur });
    if (dec.action === 'rien') return;
    const envoye = (reg.actif && dec.action !== 'rien') ? await envoyer(deps, tels, txt) : 0;
    if (dec.action === 'ouvrir') {
      await db.query('UPDATE app_temp_episodes SET clos_le = NOW() WHERE point = $1 AND clos_le IS NULL', [point]);
      await db.query(
        'INSERT INTO app_temp_episodes (point, motif, valeur, dernier_envoi_le, envois) VALUES ($1,$2,$3,$4,$5)',
        [point, dec.motif, dec.valeur == null ? null : dec.valeur, envoye ? new Date() : null, envoye]);
    } else if (dec.action === 'rappeler') {
      await db.query(
        'UPDATE app_temp_episodes SET dernier_envoi_le = $2, envois = envois + $3, valeur = $4 WHERE point = $1 AND clos_le IS NULL',
        [point, envoye ? new Date() : null, envoye ? 1 : 0, dec.valeur == null ? null : dec.valeur]);
    } else if (dec.action === 'clore') {
      await db.query('UPDATE app_temp_episodes SET clos_le = NOW() WHERE point = $1 AND clos_le IS NULL', [point]);
    }
  };

  // 1. LE ROBOT D'ABORD. Si plus rien n'arrive, les quatre armoires sont
  //    muettes pour UNE seule cause : envoyer quatre SMS pour une panne unique
  //    est la meilleure facon de faire ignorer le cinquieme.
  const d = await db.query('SELECT MAX(ts) AS dernier FROM app_temperatures');
  const dernier = d.rows[0] && d.rows[0].dernier;
  const age = dernier ? (+maintenant - +new Date(dernier)) : null;
  const enPanne = (dernier == null) || age > AL.PANNE_MS;

  const epRobot = await episodeOuvert(db, POINT_ROBOT);
  const etatRobot = enPanne
    ? { etat: 'muet', valeur: null, age: age }
    : { etat: 'ok', valeur: null };
  const decRobot = AL.decider(etatRobot, epRobot, maintenant, 1);
  await agir(POINT_ROBOT, decRobot, AL.texte('Surveillance temperatures', decRobot, plage));

  if (enPanne) return { actif: reg.actif, panne: true, decisions: decisions, destinataires: tels.length };

  // 2. PUIS CHAQUE ARMOIRE.
  const pts = (await db.query(
    "SELECT DISTINCT point FROM app_temperatures WHERE ts > NOW() - INTERVAL '24 hours' ORDER BY point")).rows;
  for (const row of pts) {
    const point = row.point;
    const m = await db.query(
      'SELECT ts, valeur FROM app_temperatures WHERE point = $1 ORDER BY ts DESC LIMIT 8', [point]);
    const etat = AL.etatPoint(m.rows, plage, maintenant);
    const ep = await episodeOuvert(db, point);
    const dec = AL.decider(etat, ep, maintenant, requis);
    await agir(point, dec, AL.texte(point, dec, plage));
  }
  return { actif: reg.actif, panne: false, decisions: decisions, destinataires: tels.length };
}

let _minuterie = null;

// Un tirage PUIS l'evaluation, toujours dans cet ordre et toujours les deux :
// un tirage en echec est justement le cas ou l'alerte de panne doit partir.
async function cycle(db, deps) {
  try { await tirage(db); } catch (e) { /* tirage() trace deja son echec */ }
  try { await evaluerAlertes(db, deps); }
  catch (e) { console.error('  🌡️  Evaluation des alertes en echec :', e.message); }
}

async function demarrer(db, deps) {
  if (!db) return;
  await creerTable(db);
  if (!configure()) {
    console.log('  🌡️  Suivi des temperatures inactif (SAVERIS_USER / SAVERIS_PASS absents)');
    return;
  }
  const reg = await lireReglages(db).catch(() => ({ actif: false }));
  console.log('  🌡️  Suivi des temperatures actif — tirage toutes les 15 minutes'
    + (reg.actif ? ' — alertes ARMEES' : ' — alertes eteintes (Back office > Temperatures)'));
  await cycle(db, deps);
  if (_minuterie) clearInterval(_minuterie);
  _minuterie = setInterval(() => { cycle(db, deps).catch(() => {}); }, PERIODE_MS);
}

// ─── Les routes ───
// Le portail (auth.js) protege deja tout /api/ : rien de plus a faire ici.
function routes(app, getDb, deps) {
  // Les reglages de l'alerte. Lecture ouverte a l'application, ecriture
  // reservee aux administrateurs : un numero d'astreinte n'est pas un reglage
  // d'ecran.
  app.get('/api/temp/reglages', async (req, res) => {
    try {
      const db = getDb(); if (!db) return res.status(503).json({ ok: false, error: 'base indisponible' });
      const r = await lireReglages(db);
      const ep = await db.query(
        'SELECT point, motif, ouvert_le, valeur, envois FROM app_temp_episodes WHERE clos_le IS NULL ORDER BY ouvert_le');
      res.json({ ok: true, reglages: r, episodes: ep.rows });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/temp/reglages', async (req, res) => {
    try {
      if (deps && typeof deps.estAdmin === 'function' && !(await deps.estAdmin(req))) {
        return res.status(403).json({ ok: false, error: 'reserve aux administrateurs' });
      }
      const db = getDb(); if (!db) return res.status(503).json({ ok: false, error: 'base indisponible' });
      const b = req.body || {};
      const vmin = Number(b.vmin), vmax = Number(b.vmax);
      if (!isFinite(vmin) || !isFinite(vmax) || vmin >= vmax) {
        return res.status(400).json({ ok: false, error: 'Plage invalide : le minimum doit etre sous le maximum.' });
      }
      const actif = !!b.actif;
      if (actif) {
        const a = await db.query('SELECT tel FROM app_temp_astreintes WHERE actif = true');
        const joignables = AL.destinataires(
          a.rows.map(x => ({ tel: x.tel, actif: true })), deps && deps.numero);
        if (!joignables.length) {
          return res.status(400).json({ ok: false,
            error: 'Armer les alertes sans aucune astreinte joignable reviendrait a ne prevenir personne.' });
        }
      }
      await db.query('UPDATE app_temp_reglages SET actif=$1, vmin=$2, vmax=$3, maj=NOW() WHERE id=1',
        [actif, vmin, vmax]);
      res.json({ ok: true, reglages: await lireReglages(db) });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // La liste des astreintes. On remplace L'ENSEMBLE plutot que de modifier
  // ligne par ligne : l'ecran envoie ce qu'il montre, et il n'existe aucun etat
  // intermediaire ou la base contiendrait une liste que personne n'a voulue.
  app.post('/api/temp/astreintes', async (req, res) => {
    try {
      if (deps && typeof deps.estAdmin === 'function' && !(await deps.estAdmin(req))) {
        return res.status(403).json({ ok: false, error: 'reserve aux administrateurs' });
      }
      const db = getDb(); if (!db) return res.status(503).json({ ok: false, error: 'base indisponible' });
      const brut = Array.isArray((req.body || {}).astreintes) ? req.body.astreintes : [];
      if (brut.length > 20) return res.status(400).json({ ok: false, error: 'Vingt astreintes suffisent.' });

      // Un numero refuse est RENDU A L'ECRAN, jamais avale en silence : croire
      // qu'on a pose une astreinte et n'avoir rien pose est exactement le
      // defaut que ce dispositif existe pour eviter.
      const lignes = [];
      for (const a of brut) {
        const tel = String((a && a.tel) || '').trim();
        if (!tel) continue;
        const n = (deps && typeof deps.numero === 'function') ? deps.numero(tel) : tel;
        if (!n) return res.status(400).json({ ok: false, error: 'Numero de mobile non reconnu : ' + tel });
        lignes.push({ nom: String((a && a.nom) || '').trim().slice(0, 40), tel: tel, actif: a.actif !== false });
      }
      // Armer sans personne de joignable n'a pas de sens : on eteint plutot que
      // de laisser croire que quelqu'un sera prevenu.
      const reste = AL.destinataires(lignes, deps && deps.numero);
      if (!reste.length) await db.query('UPDATE app_temp_reglages SET actif = false WHERE id = 1');

      await db.query('DELETE FROM app_temp_astreintes');
      for (const l of lignes) {
        await db.query('INSERT INTO app_temp_astreintes (nom, tel, actif) VALUES ($1,$2,$3)', [l.nom, l.tel, l.actif]);
      }
      res.json({ ok: true, reglages: await lireReglages(db) });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ── Le releve quotidien signe ─────────────────────────────────────
  // Ce que l'ecran a besoin de savoir : la derniere signature, et ce qui s'est
  // passe depuis. La periode part de la DERNIERE VALIDATION, pas d'il y a
  // vingt-quatre heures : apres un week-end, c'est le week-end entier qu'il
  // faut regarder, sans quoi le dimanche ne serait jamais relu par personne.
  app.get('/api/temp/releve', async (req, res) => {
    try {
      const db = getDb(); if (!db) return res.status(503).json({ ok: false, error: 'base indisponible' });
      const d = await db.query('SELECT le, par, nom, commentaire, depassements FROM app_temp_releves ORDER BY le DESC LIMIT 1');
      const dernier = d.rows[0] || null;
      const reg = await lireReglages(db);
      const depuis = dernier ? new Date(dernier.le) : new Date(Date.now() - 24 * 3600 * 1000);
      const dep = await db.query(
        'SELECT point, ts, valeur FROM app_temperatures WHERE ts > $1 AND (valeur < $2 OR valeur > $3) ORDER BY ts',
        [depuis.toISOString(), reg.vmin, reg.vmax]);
      res.json({ ok: true, dernier: dernier, depuis: depuis.toISOString(),
                 plage: { min: reg.vmin, max: reg.vmax },
                 depassements: dep.rows });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/temp/releve', async (req, res) => {
    try {
      const db = getDb(); if (!db) return res.status(503).json({ ok: false, error: 'base indisponible' });
      const uid = (deps && typeof deps.qui === 'function') ? deps.qui(req) : null;
      if (!uid) return res.status(401).json({ ok: false, error: 'session inconnue' });
      const b = req.body || {};
      const commentaire = String(b.commentaire || '').trim().slice(0, 1000);
      const depassements = Math.max(0, parseInt(b.depassements, 10) || 0);
      // UN DEPASSEMENT NON COMMENTE N'EST PAS UN RELEVE. Signer une periode ou
      // un frigo est monte a 11 C sans ecrire un mot, c'est signer qu'on n'a
      // rien vu - et c'est exactement ce qu'on cherche a rendre impossible.
      if (depassements > 0 && commentaire.length < 3) {
        return res.status(400).json({ ok: false,
          error: 'Un depassement doit etre commente : ce qui s\'est passe, et ce qui a ete fait.' });
      }
      await db.query(
        'INSERT INTO app_temp_releves (par, nom, debut, fin, depassements, commentaire) VALUES ($1,$2,$3,$4,$5,$6)',
        [uid, String(b.nom || '').slice(0, 60), b.debut || null, new Date(), depassements, commentaire]);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // Force une evaluation. Sert a l'essai en conditions reelles : on baisse un
  // seuil, on appelle, on verifie que le telephone sonne.
  app.post('/api/temp/alerte-test', async (req, res) => {
    try {
      if (deps && typeof deps.estAdmin === 'function' && !(await deps.estAdmin(req))) {
        return res.status(403).json({ ok: false, error: 'reserve aux administrateurs' });
      }
      const db = getDb(); if (!db) return res.status(503).json({ ok: false, error: 'base indisponible' });
      res.json({ ok: true, resultat: await evaluerAlertes(db, deps) });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // Etat du dispositif — c'est ce que l'ecran interroge pour savoir s'il doit
  // afficher des valeurs ou dire que les donnees sont vieilles.
  app.get('/api/temp/etat', async (req, res) => {
    const db = getDb();
    if (!db) return res.status(503).json({ ok: false, error: 'base indisponible' });
    try {
      const q = await db.query(`
        SELECT point, MAX(ts) AS derniere,
               (SELECT valeur FROM app_temperatures t2 WHERE t2.point = t1.point ORDER BY ts DESC LIMIT 1) AS valeur
        FROM app_temperatures t1 GROUP BY point ORDER BY point`);
      res.json({ ok: true, configure: configure(), dernierTirage: _dernier, points: q.rows });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // Les mesures d'une plage, pour les courbes et pour le rapport.
  app.get('/api/temp/mesures', async (req, res) => {
    const db = getDb();
    if (!db) return res.status(503).json({ ok: false, error: 'base indisponible' });
    const fin = req.query.fin ? new Date(req.query.fin) : new Date();
    const deb = req.query.debut ? new Date(req.query.debut) : new Date(fin.getTime() - 24 * 3600 * 1000);
    if (isNaN(deb) || isNaN(fin)) return res.status(400).json({ ok: false, error: 'plage invalide' });
    try {
      const q = await db.query(
        'SELECT point, ts, valeur FROM app_temperatures WHERE ts >= $1 AND ts <= $2 ORDER BY ts',
        [deb.toISOString(), fin.toISOString()]);
      res.json({ ok: true, debut: deb.toISOString(), fin: fin.toISOString(), mesures: q.rows });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // Diagnostic : force un tirage et raconte ce qui s'est passe. C'est la route
  // qu'on regarde quand plus rien n'arrive. Elle ne renvoie jamais d'identifiant.
  app.post('/api/temp/diag', async (req, res) => {
    const db = getDb();
    if (!db) return res.status(503).json({ ok: false, error: 'base indisponible' });
    const etapes = [];
    try {
      etapes.push({ etape: 'identifiants', ok: configure() });
      if (!configure()) return res.json({ ok: false, etapes });
      const jt = await jeton(true);
      etapes.push({ etape: 'jeton', ok: true, expire_dans_h: Math.round((_jeton.expireA - Date.now()) / 36e5) });
      const pts = await points(jt);
      etapes.push({ etape: 'points', ok: true, noms: pts.map(p => p.nom) });
      const fin = Date.now(), deb = fin - FENETRE_MS;
      const essais = [];
      for (const v of variantes(pts.map(p => p.uuid), deb, fin)) {
        try {
          if (v.parPoint) {
            const r = await api(v.chemin(pts[0].uuid), jt);
            essais.push({ variante: v.cle, statut: r.statut, apercu: r.corps.slice(0, 300) });
          } else {
            const r = await api(v.chemin, jt);
            essais.push({ variante: v.cle, statut: r.statut, apercu: r.corps.slice(0, 300) });
          }
        } catch (e) { essais.push({ variante: v.cle, erreur: e.message }); }
      }
      etapes.push({ etape: 'mesures', essais });
      const t = await tirage(db);
      etapes.push({ etape: 'ecriture', resultat: t });
      res.json({ ok: true, etapes });
    } catch (e) {
      etapes.push({ etape: 'echec', erreur: e.message });
      res.json({ ok: false, etapes });
    }
  });
}

module.exports = { demarrer, routes, tirage, creerTable, configure, normaliser, lireGroupes,
                   evaluerAlertes, lireReglages, cycle, POINT_ROBOT };
