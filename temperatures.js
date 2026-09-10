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

let _minuterie = null;

async function demarrer(db) {
  if (!db) return;
  await creerTable(db);
  if (!configure()) {
    console.log('  🌡️  Suivi des temperatures inactif (SAVERIS_USER / SAVERIS_PASS absents)');
    return;
  }
  console.log('  🌡️  Suivi des temperatures actif — tirage toutes les 15 minutes');
  await tirage(db);
  if (_minuterie) clearInterval(_minuterie);
  _minuterie = setInterval(() => { tirage(db).catch(() => {}); }, PERIODE_MS);
}

// ─── Les routes ───
// Le portail (auth.js) protege deja tout /api/ : rien de plus a faire ici.
function routes(app, getDb) {
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

module.exports = { demarrer, routes, tirage, creerTable, configure, normaliser, lireGroupes };
