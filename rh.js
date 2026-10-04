// ─────────────────────────────────────────────────────────────────────────────
//  SUIVI RH — la fiche de chaque collaborateur, et ce qu'on en fait
// ─────────────────────────────────────────────────────────────────────────────
//
//  POURQUOI CE MODULE N'EST PAS DANS LE BLOB. Toutes les autres rubriques de
//  PILOT vivent dans `app_data`, un seul objet JSON que `/api/data` renvoie
//  ENTIER a chaque poste, toutes les huit secondes. C'est assume pour les
//  patients : toute l'equipe les soigne. Ce ne l'est pas ici. Une appreciation
//  portee sur un collegue n'a aucune raison de transiter par son propre poste,
//  et le fait qu'un ecran ne l'affiche pas ne la rend pas invisible — elle est
//  dans la reponse JSON, lisible en trois clics.
//
//  Le precedent est dans ce depot : « /api/data livrait les codes de toute
//  l'equipe a chaque poste ». On ne recommence pas. Tables dediees, autorisation
//  verifiee par le SERVEUR a chaque appel, et rien qui parte vers un poste qui
//  n'y a pas droit.
//
//  TROIS REGLES DE CONSTRUCTION
//
//  1. ON ECRIT DES FAITS. « Souvent en retard » ne se discute pas, donc ne se
//     corrige pas ; « arrivee a 9 h 20 le 12/09 pour un creneau de 9 h » se
//     discute et se corrige. Le module ne peut pas l'imposer — aucun filtre de
//     mots ne distingue un fait d'un jugement — mais l'ecran le rappelle a
//     chaque saisie, avec le nom de la personne concernee.
//
//  2. LA PERSONNE PEUT TOUT LIRE. Article 15 du RGPD : elle peut exiger
//     l'integralite de ce qui la concerne. Ce qui est ecrit ici doit donc etre
//     ecrit comme si elle lisait par-dessus l'epaule. Et elle doit avoir ete
//     informee AVANT que la collecte commence — c'est une obligation, pas une
//     politesse.
//
//  3. ON COMPTE LE SILENCE AUTANT QUE LE BRUIT. On consigne les ecarts, jamais
//     la normale : au bout d'un an, une fiche ne contient que du negatif et
//     devient un dossier a charge. Et les collaborateurs reguliers et discrets
//     n'ont rien dans la leur — donc rien a valoriser le jour de l'entretien.
//     Les deux defauts sont affiches, c'est le seul moyen de les corriger.
//
//  CE QU'ON N'ECRIT PAS, JAMAIS : sante, arret maladie, grossesse, handicap,
//  vie privee, convictions, origine, activite syndicale. Hors sujet, et
//  illegal.
//
//  HORS PERIMETRE, DECIDE LE 04/10/2026 : aucun marqueur disciplinaire, aucun
//  compte a rebours de l'article L.1332-4. Ce journal sert a manager ; un fait
//  grave se traite ailleurs, par ecrit, avec un conseil.
// ─────────────────────────────────────────────────────────────────────────────

// ── Le vocabulaire ──────────────────────────────────────────────────────────
// Ferme, comme celui du journal des acces : une fiche ou chacun invente ses
// libelles ne se relit pas deux ans plus tard.
const TONS = ['positif', 'neutre', 'corriger'];
const TAGS = ['fiabilite', 'relation', 'initiative', 'qualite', 'securite', 'equipe', 'formation'];
const TYPES = ['point', 'parcours', 'bilan'];

// ── Les echeances legales ───────────────────────────────────────────────────
// La loi 2025-989 du 24 octobre 2025 a remplace l'entretien professionnel par
// l'ENTRETIEN DE PARCOURS PROFESSIONNEL : il passe de deux a QUATRE ans, et le
// bilan recapitulatif de six a HUIT ans. Le premier se tient dans l'annee qui
// suit l'embauche. Il ne porte plus sur l'evaluation de la performance.
//
// CES TROIS NOMBRES SONT ICI ET NULLE PART AILLEURS. La regle a deja change une
// fois ; elle rechangera. Une duree recopiee dans trois fonctions se corrige
// dans deux.
const PARCOURS_ANS = 4;
const BILAN_ANS = 8;
const PREMIER_AN = 1;

// Le preavis d'alerte : deux mois avant l'echeance. Assez tot pour organiser un
// entretien ou inscrire une formation, assez tard pour ne pas crier au loup.
const PREAVIS_JOURS = 60;

// Au-dela, une fiche ou il ne s'est rien passe est une fiche qu'on a oubliee.
const SILENCE_JOURS = 90;

const pad = n => String(n).padStart(2, '0');
function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function dateDe(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}
// Ajouter des annees sans tomber un 29 fevrier qui n'existe pas : meme piege
// que la date limite d'utilisation des preparations, meme correction.
function plusAns(isoD, n) {
  const d = dateDe(isoD); if (!d) return null;
  const j = d.getDate();
  d.setFullYear(d.getFullYear() + n);
  if (d.getDate() !== j) d.setDate(0);
  return iso(d);
}
function joursEntre(a, b) {
  const x = dateDe(a), y = dateDe(b);
  if (!x || !y) return null;
  return Math.round((y - x) / 86400000);
}

// ── CE QUI EST DU, ET QUAND ─────────────────────────────────────────────────
// Rendue pure et exportee : c'est la seule facon de verifier une regle qui
// compte en annees sans attendre quatre ans.
function echeances(entretiens, embauche, aujourdhui) {
  const auj = aujourdhui || iso(new Date());
  const dernier = function (type) {
    return (entretiens || [])
      .filter(function (e) { return e && e.type === type && e.le; })
      .map(function (e) { return String(e.le).slice(0, 10); })
      .sort().pop() || null;
  };
  const faire = function (type, ans) {
    const d = dernier(type);
    // Jamais tenu : l'echeance part de l'embauche. Le premier entretien de
    // parcours est du dans l'annee qui suit ; le bilan, lui, se compte en huit
    // ans d'anciennete.
    const base = d || embauche || null;
    if (!base) return { type: type, du: null, dernier: null, dans: null, inconnu: true };
    const du = plusAns(base, d ? ans : (type === 'parcours' ? PREMIER_AN : ans));
    return { type: type, du: du, dernier: d, dans: joursEntre(auj, du), inconnu: false };
  };
  return [faire('parcours', PARCOURS_ANS), faire('bilan', BILAN_ANS)];
}

// ── L'EQUILIBRE ─────────────────────────────────────────────────────────────
// Un compteur, pas une note. Il ne juge personne : il dit ce que NOUS avons
// ecrit, et c'est a nous qu'il s'adresse.
function equilibre(faits) {
  const n = { positif: 0, neutre: 0, corriger: 0, total: 0 };
  (faits || []).forEach(function (f) {
    if (!f || TONS.indexOf(f.ton) < 0) return;
    n[f.ton]++; n.total++;
  });
  return n;
}

// Depuis quand n'a-t-on rien ecrit ? La question la plus utile de l'ecran :
// ceux dont on ne parle jamais sont ceux qui n'ont rien a entendre le jour de
// leur entretien.
function silence(faits, aujourdhui) {
  const auj = aujourdhui || iso(new Date());
  const d = (faits || []).map(function (f) { return f && f.le ? String(f.le).slice(0, 10) : null; })
    .filter(Boolean).sort().pop();
  if (!d) return { dernier: null, jours: null, muet: true };
  const j = joursEntre(d, auj);
  return { dernier: d, jours: j, muet: j != null && j >= SILENCE_JOURS };
}

// ── CE QU'ON EMPORTE A L'ENTRETIEN ──────────────────────────────────────────
// Tout ce qui s'est passe depuis le dernier point, groupe par ton. Sans cette
// fonction, le journal devient un tas de notes qu'on n'ouvre jamais — et un
// journal qu'on n'ouvre pas ne sert qu'a se donner bonne conscience.
function aPreparer(faits, entretiens, aujourdhui) {
  const pts = (entretiens || []).filter(function (e) { return e && e.le; })
    .map(function (e) { return String(e.le).slice(0, 10); }).sort();
  const depuis = pts.length ? pts[pts.length - 1] : null;
  const pris = (faits || []).filter(function (f) {
    return f && f.le && (!depuis || String(f.le).slice(0, 10) > depuis);
  }).sort(function (a, b) { return String(a.le).localeCompare(String(b.le)); });
  return {
    depuis: depuis,
    jours: depuis ? joursEntre(depuis, aujourdhui || iso(new Date())) : null,
    positif: pris.filter(function (f) { return f.ton === 'positif'; }),
    neutre: pris.filter(function (f) { return f.ton === 'neutre'; }),
    corriger: pris.filter(function (f) { return f.ton === 'corriger'; }),
    total: pris.length
  };
}

// ── CE QUI PERIME ───────────────────────────────────────────────────────────
function habilitationsDues(habs, aujourdhui, preavis) {
  const auj = aujourdhui || iso(new Date());
  const p = preavis == null ? PREAVIS_JOURS : preavis;
  return (habs || []).filter(function (h) { return h && h.echeance; }).map(function (h) {
    const j = joursEntre(auj, String(h.echeance).slice(0, 10));
    return Object.assign({}, h, { dans: j, perimee: j != null && j < 0, due: j != null && j <= p });
  }).filter(function (h) { return h.due; })
    .sort(function (a, b) { return (a.dans || 0) - (b.dans || 0); });
}

// ─────────────────────────────────────────────────────────────────────────────
//  LES TABLES
// ─────────────────────────────────────────────────────────────────────────────
async function creerTables(db) {
  if (!db) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS app_rh_faits (
      id       BIGSERIAL PRIMARY KEY,
      uid      TEXT NOT NULL,
      le       DATE NOT NULL,
      ton      TEXT NOT NULL,
      tag      TEXT,
      texte    TEXT NOT NULL,
      par      TEXT NOT NULL,
      saisi_le TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      maj      TIMESTAMPTZ
    )`);
  await db.query('CREATE INDEX IF NOT EXISTS app_rh_faits_uid ON app_rh_faits (uid, le DESC)');
  await db.query(`
    CREATE TABLE IF NOT EXISTS app_rh_entretiens (
      id       BIGSERIAL PRIMARY KEY,
      uid      TEXT NOT NULL,
      le       DATE NOT NULL,
      type     TEXT NOT NULL,
      notes    TEXT,
      suites   TEXT,
      par      TEXT NOT NULL,
      saisi_le TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      maj      TIMESTAMPTZ
    )`);
  await db.query('CREATE INDEX IF NOT EXISTS app_rh_entretiens_uid ON app_rh_entretiens (uid, le DESC)');
  await db.query(`
    CREATE TABLE IF NOT EXISTS app_rh_habilitations (
      id       BIGSERIAL PRIMARY KEY,
      uid      TEXT NOT NULL,
      libelle  TEXT NOT NULL,
      obtenue  DATE,
      echeance DATE,
      notes    TEXT,
      par      TEXT NOT NULL,
      maj      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await db.query('CREATE INDEX IF NOT EXISTS app_rh_hab_uid ON app_rh_habilitations (uid, echeance)');
  // La date d'embauche vit ici, pas dans staffDB : c'est elle qui fait courir
  // la premiere echeance d'entretien, et c'est une donnee RH comme les autres.
  await db.query(`
    CREATE TABLE IF NOT EXISTS app_rh_collab (
      uid      TEXT PRIMARY KEY,
      embauche DATE,
      maj      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
}

// ─────────────────────────────────────────────────────────────────────────────
//  LES ROUTES
// ─────────────────────────────────────────────────────────────────────────────
function routes(app, getDb, deps) {
  const db = function () {
    const d = getDb(); if (!d) { const e = new Error('base indisponible'); e.code = 503; throw e; }
    return d;
  };
  const rate = function (res, e) {
    res.status(e.code === 503 ? 503 : 400).json({ ok: false, error: e.message });
  };

  // LA PORTE. Une seule, et toutes les routes passent par elle. Un module ou
  // l'autorisation se verifie route par route finit par en oublier une, et
  // celle-la ne se voit pas : elle repond 200.
  const titulaire = async function (req, res) {
    const uid = (deps && typeof deps.qui === 'function') ? deps.qui(req) : null;
    if (!uid) { res.status(401).json({ ok: false, error: 'session inconnue' }); return null; }
    const ok = (deps && typeof deps.estAdmin === 'function') ? await deps.estAdmin(req) : false;
    if (!ok) { res.status(403).json({ ok: false, error: 'réservé aux titulaires' }); return null; }
    return uid;
  };
  const tracer = function (uid, action, ref, detail) {
    if (deps && typeof deps.noter === 'function') deps.noter(uid, action, 'collaborateur', ref, detail);
  };
  const txt = function (v, n) {
    const x = String(v == null ? '' : v).trim();
    return x ? x.slice(0, n || 2000) : null;
  };
  const jour = function (v) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
    return m ? m[0].slice(0, 10) : null;
  };

  // ── L'ecran d'accueil : toute l'equipe d'un coup d'oeil ───────────────────
  app.get('/api/rh/equipe', async (req, res) => {
    try {
      const moi = await titulaire(req, res); if (!moi) return;
      const f = await db().query('SELECT uid, le, ton FROM app_rh_faits');
      const e = await db().query('SELECT uid, le, type FROM app_rh_entretiens');
      const h = await db().query('SELECT uid, libelle, echeance FROM app_rh_habilitations');
      const c = await db().query('SELECT uid, embauche FROM app_rh_collab');
      const parUid = function (rows) {
        const m = {};
        rows.forEach(function (r) { (m[r.uid] = m[r.uid] || []).push(r); });
        return m;
      };
      const F = parUid(f.rows), E = parUid(e.rows), H = parUid(h.rows);
      const emb = {};
      c.rows.forEach(function (r) { emb[r.uid] = r.embauche ? iso(new Date(r.embauche)) : null; });
      const uids = [...new Set([].concat(
        Object.keys(F), Object.keys(E), Object.keys(H), Object.keys(emb)))];
      const auj = iso(new Date());
      const fiches = uids.map(function (u) {
        const faits = (F[u] || []).map(function (r) { return { le: iso(new Date(r.le)), ton: r.ton }; });
        const ents = (E[u] || []).map(function (r) { return { le: iso(new Date(r.le)), type: r.type }; });
        const habs = (H[u] || []).map(function (r) {
          return { libelle: r.libelle, echeance: r.echeance ? iso(new Date(r.echeance)) : null };
        });
        return {
          uid: u, embauche: emb[u] || null,
          equilibre: equilibre(faits),
          silence: silence(faits, auj),
          echeances: echeances(ents, emb[u], auj),
          habilitations: habilitationsDues(habs, auj)
        };
      });
      // On ne journalise pas cet ecran : il ne montre aucun contenu, seulement
      // des compteurs. Journaliser ce qui ne revele rien noie ce qui revele.
      res.json({ ok: true, fiches: fiches, silenceJours: SILENCE_JOURS });
    } catch (e) { rate(res, e); }
  });

  // ── Une fiche ─────────────────────────────────────────────────────────────
  // CELLE-CI SE JOURNALISE. Elle montre ce qui a ete ecrit sur quelqu'un ; la
  // meme regle que la fiche patient, pour la meme raison.
  app.get('/api/rh/fiche', async (req, res) => {
    try {
      const moi = await titulaire(req, res); if (!moi) return;
      const u = String(req.query.uid || '').trim();
      if (!u) return res.status(400).json({ ok: false, error: 'collaborateur requis' });
      const f = await db().query(
        'SELECT id, le, ton, tag, texte, par, saisi_le, maj FROM app_rh_faits WHERE uid = $1 ORDER BY le DESC, id DESC', [u]);
      const e = await db().query(
        'SELECT id, le, type, notes, suites, par, saisi_le FROM app_rh_entretiens WHERE uid = $1 ORDER BY le DESC', [u]);
      const h = await db().query(
        'SELECT id, libelle, obtenue, echeance, notes FROM app_rh_habilitations WHERE uid = $1 ORDER BY echeance NULLS LAST', [u]);
      const c = await db().query('SELECT embauche FROM app_rh_collab WHERE uid = $1', [u]);
      const embauche = (c.rows[0] && c.rows[0].embauche) ? iso(new Date(c.rows[0].embauche)) : null;
      const auj = iso(new Date());
      const faits = f.rows.map(function (r) {
        return { id: r.id, le: iso(new Date(r.le)), ton: r.ton, tag: r.tag, texte: r.texte,
                 par: r.par, saisiLe: r.saisi_le, maj: r.maj };
      });
      const ents = e.rows.map(function (r) {
        return { id: r.id, le: iso(new Date(r.le)), type: r.type, notes: r.notes,
                 suites: r.suites, par: r.par };
      });
      const habs = h.rows.map(function (r) {
        return { id: r.id, libelle: r.libelle,
                 obtenue: r.obtenue ? iso(new Date(r.obtenue)) : null,
                 echeance: r.echeance ? iso(new Date(r.echeance)) : null, notes: r.notes };
      });
      tracer(moi, 'consultation', u, 'fiche RH');
      res.json({ ok: true, uid: u, embauche: embauche, faits: faits, entretiens: ents,
                 habilitations: habs, equilibre: equilibre(faits), silence: silence(faits, auj),
                 echeances: echeances(ents, embauche, auj),
                 habilitationsDues: habilitationsDues(habs, auj),
                 preparer: aPreparer(faits, ents, auj) });
    } catch (e) { rate(res, e); }
  });

  // ── Consigner un fait ─────────────────────────────────────────────────────
  app.post('/api/rh/fait', async (req, res) => {
    try {
      const moi = await titulaire(req, res); if (!moi) return;
      const b = req.body || {};
      const u = String(b.uid || '').trim();
      const texte = txt(b.texte, 2000);
      const le = jour(b.le) || iso(new Date());
      const ton = TONS.indexOf(b.ton) >= 0 ? b.ton : null;
      if (!u || !texte) return res.status(400).json({ ok: false, error: 'collaborateur et texte requis' });
      if (!ton) return res.status(400).json({ ok: false, error: 'ton inconnu' });
      const tag = TAGS.indexOf(b.tag) >= 0 ? b.tag : null;
      const r = await db().query(
        'INSERT INTO app_rh_faits (uid, le, ton, tag, texte, par) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
        [u, le, ton, tag, texte, moi]);
      tracer(moi, 'creation', u, 'fait RH');
      res.json({ ok: true, id: r.rows[0].id });
    } catch (e) { rate(res, e); }
  });

  // CORRIGER ET RETIRER SONT DES DROITS, PAS DES COMMODITES. Le RGPD donne a la
  // personne le droit de faire rectifier ce qui est inexact : si le module ne
  // savait pas corriger, il ne saurait pas obeir.
  app.post('/api/rh/fait-modifier', async (req, res) => {
    try {
      const moi = await titulaire(req, res); if (!moi) return;
      const b = req.body || {};
      const id = parseInt(b.id, 10);
      const texte = txt(b.texte, 2000);
      const ton = TONS.indexOf(b.ton) >= 0 ? b.ton : null;
      if (!id || !texte || !ton) return res.status(400).json({ ok: false, error: 'fait, texte et ton requis' });
      const tag = TAGS.indexOf(b.tag) >= 0 ? b.tag : null;
      const r = await db().query(
        'UPDATE app_rh_faits SET le = COALESCE($2, le), ton = $3, tag = $4, texte = $5, maj = NOW() WHERE id = $1 RETURNING uid',
        [id, jour(b.le), ton, tag, texte]);
      if (!r.rows[0]) return res.status(404).json({ ok: false, error: 'fait introuvable' });
      tracer(moi, 'modification', r.rows[0].uid, 'fait RH');
      res.json({ ok: true });
    } catch (e) { rate(res, e); }
  });

  app.post('/api/rh/fait-retirer', async (req, res) => {
    try {
      const moi = await titulaire(req, res); if (!moi) return;
      const id = parseInt((req.body || {}).id, 10);
      if (!id) return res.status(400).json({ ok: false, error: 'fait requis' });
      const r = await db().query('DELETE FROM app_rh_faits WHERE id = $1 RETURNING uid', [id]);
      if (!r.rows[0]) return res.status(404).json({ ok: false, error: 'fait introuvable' });
      tracer(moi, 'suppression', r.rows[0].uid, 'fait RH');
      res.json({ ok: true });
    } catch (e) { rate(res, e); }
  });

  // ── Les entretiens ────────────────────────────────────────────────────────
  app.post('/api/rh/entretien', async (req, res) => {
    try {
      const moi = await titulaire(req, res); if (!moi) return;
      const b = req.body || {};
      const u = String(b.uid || '').trim();
      const type = TYPES.indexOf(b.type) >= 0 ? b.type : null;
      const le = jour(b.le) || iso(new Date());
      if (!u || !type) return res.status(400).json({ ok: false, error: 'collaborateur et type requis' });
      if (b.id) {
        const r = await db().query(
          'UPDATE app_rh_entretiens SET le = $2, type = $3, notes = $4, suites = $5, maj = NOW() WHERE id = $1 RETURNING uid',
          [parseInt(b.id, 10), le, type, txt(b.notes, 4000), txt(b.suites, 4000)]);
        if (!r.rows[0]) return res.status(404).json({ ok: false, error: 'entretien introuvable' });
        tracer(moi, 'modification', u, 'entretien');
        return res.json({ ok: true });
      }
      const r = await db().query(
        'INSERT INTO app_rh_entretiens (uid, le, type, notes, suites, par) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
        [u, le, type, txt(b.notes, 4000), txt(b.suites, 4000), moi]);
      tracer(moi, 'creation', u, 'entretien');
      res.json({ ok: true, id: r.rows[0].id });
    } catch (e) { rate(res, e); }
  });

  app.post('/api/rh/entretien-retirer', async (req, res) => {
    try {
      const moi = await titulaire(req, res); if (!moi) return;
      const id = parseInt((req.body || {}).id, 10);
      if (!id) return res.status(400).json({ ok: false, error: 'entretien requis' });
      const r = await db().query('DELETE FROM app_rh_entretiens WHERE id = $1 RETURNING uid', [id]);
      if (!r.rows[0]) return res.status(404).json({ ok: false, error: 'entretien introuvable' });
      tracer(moi, 'suppression', r.rows[0].uid, 'entretien');
      res.json({ ok: true });
    } catch (e) { rate(res, e); }
  });

  // ── Les habilitations ─────────────────────────────────────────────────────
  app.post('/api/rh/habilitation', async (req, res) => {
    try {
      const moi = await titulaire(req, res); if (!moi) return;
      const b = req.body || {};
      const u = String(b.uid || '').trim();
      const lib = txt(b.libelle, 120);
      if (!u || !lib) return res.status(400).json({ ok: false, error: 'collaborateur et libellé requis' });
      if (b.id) {
        const r = await db().query(
          `UPDATE app_rh_habilitations SET libelle = $2, obtenue = $3, echeance = $4,
             notes = $5, maj = NOW() WHERE id = $1 RETURNING uid`,
          [parseInt(b.id, 10), lib, jour(b.obtenue), jour(b.echeance), txt(b.notes, 500)]);
        if (!r.rows[0]) return res.status(404).json({ ok: false, error: 'habilitation introuvable' });
        tracer(moi, 'modification', u, 'habilitation');
        return res.json({ ok: true });
      }
      const r = await db().query(
        `INSERT INTO app_rh_habilitations (uid, libelle, obtenue, echeance, notes, par)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [u, lib, jour(b.obtenue), jour(b.echeance), txt(b.notes, 500), moi]);
      tracer(moi, 'creation', u, 'habilitation');
      res.json({ ok: true, id: r.rows[0].id });
    } catch (e) { rate(res, e); }
  });

  app.post('/api/rh/habilitation-retirer', async (req, res) => {
    try {
      const moi = await titulaire(req, res); if (!moi) return;
      const id = parseInt((req.body || {}).id, 10);
      if (!id) return res.status(400).json({ ok: false, error: 'habilitation requise' });
      const r = await db().query('DELETE FROM app_rh_habilitations WHERE id = $1 RETURNING uid', [id]);
      if (!r.rows[0]) return res.status(404).json({ ok: false, error: 'habilitation introuvable' });
      tracer(moi, 'suppression', r.rows[0].uid, 'habilitation');
      res.json({ ok: true });
    } catch (e) { rate(res, e); }
  });

  // ── La date d'embauche ────────────────────────────────────────────────────
  app.post('/api/rh/embauche', async (req, res) => {
    try {
      const moi = await titulaire(req, res); if (!moi) return;
      const b = req.body || {};
      const u = String(b.uid || '').trim();
      if (!u) return res.status(400).json({ ok: false, error: 'collaborateur requis' });
      await db().query(
        `INSERT INTO app_rh_collab (uid, embauche, maj) VALUES ($1,$2,NOW())
         ON CONFLICT (uid) DO UPDATE SET embauche = $2, maj = NOW()`, [u, jour(b.embauche)]);
      tracer(moi, 'modification', u, 'date d’embauche');
      res.json({ ok: true });
    } catch (e) { rate(res, e); }
  });

  // ── LE DOSSIER COMPLET D'UNE PERSONNE ─────────────────────────────────────
  // Article 15 du RGPD : si quelqu'un demande ce qui est ecrit sur lui, la
  // reponse doit pouvoir etre donnee. Sans cette route, il faudrait recopier
  // trois ecrans a la main — et c'est ainsi qu'on repond mal, ou tard.
  app.get('/api/rh/dossier', async (req, res) => {
    try {
      const moi = await titulaire(req, res); if (!moi) return;
      const u = String(req.query.uid || '').trim();
      if (!u) return res.status(400).json({ ok: false, error: 'collaborateur requis' });
      const f = await db().query(
        'SELECT le, ton, tag, texte, par FROM app_rh_faits WHERE uid = $1 ORDER BY le', [u]);
      const e = await db().query(
        'SELECT le, type, notes, suites, par FROM app_rh_entretiens WHERE uid = $1 ORDER BY le', [u]);
      const h = await db().query(
        'SELECT libelle, obtenue, echeance, notes FROM app_rh_habilitations WHERE uid = $1 ORDER BY libelle', [u]);
      tracer(moi, 'export', u, 'dossier RH remis');
      res.json({ ok: true, uid: u, edite: new Date().toISOString(),
                 faits: f.rows, entretiens: e.rows, habilitations: h.rows });
    } catch (e) { rate(res, e); }
  });
}

module.exports = {
  creerTables, routes,
  echeances, equilibre, silence, aPreparer, habilitationsDues,
  plusAns, joursEntre, iso,
  TONS, TAGS, TYPES, PARCOURS_ANS, BILAN_ANS, PREMIER_AN, SILENCE_JOURS, PREAVIS_JOURS
};
