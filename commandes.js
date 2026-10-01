/* ═══════════════════════════════════════════════════════════════════════════
   MODULE COMMANDES — tables, routes, conservation

   Les synthèses ASCA NE VONT PAS DANS LE BLOB. Environ deux cents lignes de
   stock par jour, soit une dizaine de mégaoctets sur un an : le blob, qui en
   pèse onze et repart vers chaque poste toutes les huit secondes, doublerait —
   pour une donnée qu'on regarde une fois le matin. Ce module suit donc le
   modèle de `temperatures.js` : ses tables, ses routes, son module d'écran.

   La lecture des PDF est dans `commandes-asca.js`, qui ne connaît ni base ni
   réseau et s'éprouve seul (`essais/commandes-asca.js`).
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';
const A = require('./commandes-asca');

// Les mesures brutes vieillissent vite ; ce qui compte à un an, c'est la liste
// et les décisions. On garde le détail treize mois, comme les températures.
const CONSERVATION_JOURS = 400;

async function creerTables(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS app_cmd_syntheses (
      id            SERIAL PRIMARY KEY,
      date_synthese TIMESTAMPTZ NOT NULL UNIQUE,
      recu_le       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      source        TEXT,
      indicateurs   JSONB,
      erreurs       JSONB
    )`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS app_cmd_lignes (
      id          SERIAL PRIMARY KEY,
      synthese_id INTEGER NOT NULL REFERENCES app_cmd_syntheses(id) ON DELETE CASCADE,
      code        TEXT NOT NULL,
      libelle     TEXT,
      labo        TEXT,
      categorie   TEXT NOT NULL,
      moy_vte     NUMERIC,
      brut        JSONB
    )`);
  await db.query('CREATE INDEX IF NOT EXISTS app_cmd_lignes_syn ON app_cmd_lignes (synthese_id)');
  // Le rattachement retenu : il survit aux synthèses, et une correction faite
  // une fois ne se refait pas.
  await db.query(`
    CREATE TABLE IF NOT EXISTS app_cmd_produits (
      code    TEXT PRIMARY KEY,
      libelle TEXT,
      labo    TEXT,
      origine TEXT,
      maj     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS app_cmd_labos (
      nom     TEXT PRIMARY KEY,
      alias   TEXT[] NOT NULL DEFAULT '{}',
      contact TEXT,
      notes   TEXT
    )`);
  // Le statut est porté par le COUPLE produit + synthèse : « commandé » le
  // 28 ne vaut pas pour la synthèse du 29, où le produit doit reparaître s'il
  // est toujours en rupture. C'est ce qui fait apparaître les relances.
  await db.query(`
    CREATE TABLE IF NOT EXISTS app_cmd_statuts (
      code        TEXT NOT NULL,
      synthese_id INTEGER NOT NULL REFERENCES app_cmd_syntheses(id) ON DELETE CASCADE,
      statut      TEXT NOT NULL,
      par         TEXT,
      le          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      commentaire TEXT,
      PRIMARY KEY (code, synthese_id)
    )`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS app_cmd_reglages (
      id        INTEGER PRIMARY KEY DEFAULT 1,
      urgent    NUMERIC NOT NULL DEFAULT 8,
      commander NUMERIC NOT NULL DEFAULT 4,
      maj       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await db.query('INSERT INTO app_cmd_reglages (id) VALUES (1) ON CONFLICT (id) DO NOTHING');
}

async function lireSeuils(db) {
  const r = await db.query('SELECT urgent, commander FROM app_cmd_reglages WHERE id = 1');
  const g = r.rows[0] || {};
  return { urgent: Number(g.urgent) || A.SEUILS.urgent,
           commander: Number(g.commander) || A.SEUILS.commander };
}

// Les trois tableaux qu'on sait lire, reconnus par leur NOM DE FICHIER — ASCA
// les nomme toujours pareil. Un fichier inconnu n'est pas une erreur : la
// synthèse en porte huit, et cinq ne nous servent pas.
// ON RECONNAIT PAR MOTS-CLES, PAS PAR LA PHRASE ENTIERE. ASCA nomme toujours
// ses fichiers pareil, mais ce qui arrive ici ne porte pas toujours ce nom : un
// fichier enregistre puis renvoye, un exemple range dans le depot sous une
// forme datee (« 2026-09-28-risque-15-jours.pdf »), un « (1) » de second
// telechargement. Une reconnaissance trop litterale laisse alors tomber un
// tableau entier — et la liste du jour perd quatre-vingt-quinze lignes sans
// qu'aucune erreur ne soit levee.
const TABLEAUX = [
  [/ruptures? sans commande/i,                 'sansCommande'],
  [/risque.*ruptures?|risque.*15 jours/i,      'risque15'],
  [/ruptures? avec commandes?/i,               'avecCommande']
];

// ON NORMALISE LE NOM AVANT DE LE RECONNAITRE. Enregistré depuis un courriel,
// un fichier perd ses espaces : « Produits_en_rupture_sans_commande.PDF ».
// Selon le client de messagerie et le système, on reçoit des tirets bas, des
// tirets, des espaces doublés, des accents en plus ou en moins — et une
// pièce jointe non reconnue, c'est une liste de commandes amputée d'un tiers
// sans que rien ne le dise.
function normaliserNom(n) {
  return String(n || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function quelTableau(nom) {
  const n = normaliserNom(nom);
  const t = TABLEAUX.find(function (x) { return x[0].test(n); });
  return t ? t[1] : null;
}

// ── L'enregistrement d'une synthèse ─────────────────────────────────────────
//
// IDEMPOTENT PAR LA DATE. Réimporter la même synthèse la REMPLACE : on ne
// laisse pas deux exemplaires du 28 septembre se disputer l'écran. La clé est
// la date lue dans le PDF lui-même, pas celle du jour où on l'importe.
async function enregistrer(db, fichiers, source, indicateurs) {
  const lu = {}, nonLus = [];
  fichiers.forEach(function (f) {
    const quoi = quelTableau(f.nom);
    if (!quoi) { nonLus.push(f.nom); return; }
    lu[quoi] = A.analyser(Buffer.from(f.b64, 'base64'), quoi);
  });
  if (!lu.sansCommande && !lu.risque15 && !lu.avecCommande) {
    const e = new Error('Aucun des tableaux attendus. Fichiers reçus : ' + (nonLus.join(', ') || 'aucun'));
    e.attendu = TABLEAUX.map(function (x) { return x[1]; });
    throw e;
  }
  const date = (lu.sansCommande || lu.risque15 || lu.avecCommande).date;
  if (!date) throw new Error('Date de synthèse illisible dans le pied de page des PDF.');

  const erreurs = [];
  Object.keys(lu).forEach(function (k) {
    lu[k].nonLues.forEach(function (l) { erreurs.push({ tableau: k, ligne: l }); });
  });
  // Le contrôle par les totaux annoncés dans le courriel, quand on les a.
  if (indicateurs) A.verifier(lu, indicateurs).forEach(function (m) { erreurs.push({ controle: m }); });

  const s = await db.query(
    `INSERT INTO app_cmd_syntheses (date_synthese, source, indicateurs, erreurs)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (date_synthese) DO UPDATE
       SET recu_le = NOW(), source = $2, indicateurs = $3, erreurs = $4
     RETURNING id`,
    [date, source || 'import', indicateurs ? JSON.stringify(indicateurs) : null,
     JSON.stringify(erreurs)]);
  const id = s.rows[0].id;
  await db.query('DELETE FROM app_cmd_lignes WHERE synthese_id = $1', [id]);

  const cats = { sansCommande: 'sans_cde', risque15: 'risque', avecCommande: 'avec_cde' };
  for (const k of Object.keys(lu)) {
    for (const x of lu[k].lignes) {
      await db.query(
        `INSERT INTO app_cmd_lignes (synthese_id, code, libelle, labo, categorie, moy_vte, brut)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [id, x.Code, x.Produit, x.labo, cats[k], A.nombre(x['Moy.Vte']), JSON.stringify(x)]);
      // Le rattachement au laboratoire se retient : il servira le jour où une
      // ligne arrivera sans intertitre.
      if (x.labo) await db.query(
        `INSERT INTO app_cmd_produits (code, libelle, labo, origine, maj)
         VALUES ($1,$2,$3,'asca',NOW())
         ON CONFLICT (code) DO UPDATE SET libelle = $2,
           labo = CASE WHEN app_cmd_produits.origine = 'manuel'
                       THEN app_cmd_produits.labo ELSE $3 END,
           maj = NOW()`,
        [x.Code, x.Produit, x.labo]);
    }
  }
  return { id: id, date: date, erreurs: erreurs, nonLus: nonLus,
           lignes: Object.keys(lu).reduce(function (n, k) { return n + lu[k].lignes.length; }, 0) };
}

// Reconstruit la forme que `consolider` attend, depuis la base.
async function consolidee(db, id) {
  const s = await db.query(
    'SELECT id, date_synthese, recu_le, indicateurs, erreurs FROM app_cmd_syntheses '
    + (id ? 'WHERE id = $1' : 'ORDER BY date_synthese DESC LIMIT 1'), id ? [id] : []);
  if (!s.rows[0]) return null;
  const syn = s.rows[0];
  const l = await db.query('SELECT code, libelle, labo, categorie, brut FROM app_cmd_lignes WHERE synthese_id = $1', [syn.id]);
  const par = { sans_cde: 'sansCommande', risque: 'risque15', avec_cde: 'avecCommande' };
  const lu = { sansCommande: { lignes: [] }, risque15: { lignes: [] }, avecCommande: { lignes: [] } };
  // Le laboratoire retenu à la main prime sur celui du PDF.
  const corr = await db.query("SELECT code, labo FROM app_cmd_produits WHERE origine = 'manuel'");
  const manuel = new Map(corr.rows.map(function (r) { return [r.code, r.labo]; }));
  l.rows.forEach(function (r) {
    const x = r.brut || {};
    if (manuel.has(r.code)) x.labo = manuel.get(r.code);
    lu[par[r.categorie]].lignes.push(x);
  });
  const seuils = await lireSeuils(db);
  const st = await db.query('SELECT code, statut, par, le, commentaire FROM app_cmd_statuts WHERE synthese_id = $1', [syn.id]);
  const statuts = new Map(st.rows.map(function (r) { return [r.code, r]; }));
  const labos = A.consolider(lu, { seuils: seuils, aujourdhui: syn.date_synthese });
  labos.forEach(function (g) {
    g.produits.forEach(function (p) {
      const s = statuts.get(p.code);
      if (s) { p.statut = s.statut; p.statutPar = s.par; p.statutLe = s.le; p.commentaire = s.commentaire; }
      p.cats = [...p.cats];   // les Set ne traversent pas JSON
    });
  });
  return { id: syn.id, date: syn.date_synthese, recuLe: syn.recu_le,
           indicateurs: syn.indicateurs, erreurs: syn.erreurs || [],
           seuils: seuils, labos: labos };
}

function routes(app, getDb, deps) {
  const db = function () {
    const d = getDb(); if (!d) { const e = new Error('base indisponible'); e.code = 503; throw e; }
    return d;
  };
  const rate = function (res, e) {
    res.status(e.code === 503 ? 503 : 400).json({ ok: false, error: e.message });
  };

  // LA PAGE EST OUVERTE À TOUS — décision d'Olivier : chacun peut la lire et
  // marquer une commande passée. Le nom est enregistré, c'est une trace, pas
  // un droit. On exige seulement une session ouverte.
  app.get('/api/commandes/courant', async (req, res) => {
    try { res.json({ ok: true, synthese: await consolidee(db(), null) }); }
    catch (e) { rate(res, e); }
  });

  app.get('/api/commandes/historique', async (req, res) => {
    try {
      const q = await db().query(
        `SELECT s.id, s.date_synthese, s.recu_le,
                (SELECT COUNT(*) FROM app_cmd_lignes l
                  WHERE l.synthese_id = s.id AND l.categorie = 'sans_cde') AS sans_cde
           FROM app_cmd_syntheses s ORDER BY s.date_synthese DESC LIMIT 60`);
      res.json({ ok: true, syntheses: q.rows });
    } catch (e) { rate(res, e); }
  });

  // L'import manuel. Les PDF arrivent en base64 dans le corps JSON : pas de
  // traitement multipart, donc pas de dépendance de plus, et ils pèsent
  // cinquante kilooctets.
  app.post('/api/commandes/import', async (req, res) => {
    try {
      const b = req.body || {};
      if (!Array.isArray(b.fichiers) || !b.fichiers.length)
        return res.status(400).json({ ok: false, error: 'aucun fichier' });
      const r = await enregistrer(db(), b.fichiers, 'import manuel', b.indicateurs || null);
      res.json({ ok: true, resultat: r });
    } catch (e) { rate(res, e); }
  });

  app.post('/api/commandes/statut', async (req, res) => {
    try {
      const uid = (deps && typeof deps.qui === 'function') ? deps.qui(req) : null;
      if (!uid) return res.status(401).json({ ok: false, error: 'session inconnue' });
      const b = req.body || {};
      const statut = String(b.statut || '');
      if (['a_faire', 'commandee', 'ignoree'].indexOf(statut) < 0)
        return res.status(400).json({ ok: false, error: 'statut inconnu' });
      const syn = b.syntheseId || (await db().query(
        'SELECT id FROM app_cmd_syntheses ORDER BY date_synthese DESC LIMIT 1')).rows[0].id;
      if (statut === 'a_faire') {
        await db().query('DELETE FROM app_cmd_statuts WHERE code = $1 AND synthese_id = $2',
                         [String(b.code), syn]);
      } else {
        await db().query(
          `INSERT INTO app_cmd_statuts (code, synthese_id, statut, par, le, commentaire)
           VALUES ($1,$2,$3,$4,NOW(),$5)
           ON CONFLICT (code, synthese_id) DO UPDATE
             SET statut = $3, par = $4, le = NOW(), commentaire = $5`,
          [String(b.code), syn, statut, uid, String(b.commentaire || '').slice(0, 500)]);
      }
      res.json({ ok: true });
    } catch (e) { rate(res, e); }
  });

  // Le rattachement corrigé à la main, mémorisé pour toutes les synthèses.
  app.post('/api/commandes/labo', async (req, res) => {
    try {
      const uid = (deps && typeof deps.qui === 'function') ? deps.qui(req) : null;
      if (!uid) return res.status(401).json({ ok: false, error: 'session inconnue' });
      const b = req.body || {};
      const labo = String(b.labo || '').trim().slice(0, 120);
      if (!b.code || !labo) return res.status(400).json({ ok: false, error: 'code et laboratoire requis' });
      await db().query(
        `INSERT INTO app_cmd_produits (code, labo, origine, maj) VALUES ($1,$2,'manuel',NOW())
         ON CONFLICT (code) DO UPDATE SET labo = $2, origine = 'manuel', maj = NOW()`,
        [String(b.code), labo]);
      await db().query('INSERT INTO app_cmd_labos (nom) VALUES ($1) ON CONFLICT (nom) DO NOTHING', [labo]);
      res.json({ ok: true });
    } catch (e) { rate(res, e); }
  });

  app.get('/api/commandes/reglages', async (req, res) => {
    try { res.json({ ok: true, seuils: await lireSeuils(db()) }); }
    catch (e) { rate(res, e); }
  });

  app.post('/api/commandes/reglages', async (req, res) => {
    try {
      if (deps && typeof deps.estAdmin === 'function' && !(await deps.estAdmin(req)))
        return res.status(403).json({ ok: false, error: 'réservé aux administrateurs' });
      const b = req.body || {};
      const u = Number(b.urgent), c = Number(b.commander);
      if (!(u > 0) || !(c > 0) || c > u)
        return res.status(400).json({ ok: false,
          error: 'Seuils invalides : le seuil urgent doit être supérieur au seuil « à commander ».' });
      await db().query('UPDATE app_cmd_reglages SET urgent = $1, commander = $2, maj = NOW() WHERE id = 1', [u, c]);
      res.json({ ok: true, seuils: { urgent: u, commander: c } });
    } catch (e) { rate(res, e); }
  });
}

// ── LA ROUTE D'ARRIVÉE DU COURRIEL ──────────────────────────────────────────
//
// À MONTER AVANT LE PORTAIL : l'expéditeur n'a pas de session. Le secret le
// remplace — c'est exactement le modèle d'`accuses.js`, et il n'y a aucune
// raison d'en inventer un autre.
//
// PAS DE SECRET POSÉ, PAS DE ROUTE. Elle répond 503 tant qu'`ASCA_HOOK_SECRET`
// est absent : un point d'entrée public et non authentifié ne doit jamais
// exister « en attendant ».
//
// TROIS VERROUS, ET ILS NE FONT PAS DOUBLE EMPLOI :
//   le secret        — dit que l'appel vient de notre script ;
//   l'expéditeur     — dit que le courriel vient bien d'ASCA, lu DANS LE CORPS
//                      parce qu'il arrive transféré ;
//   les totaux       — disent que la lecture des PDF est complète.
// Le premier protège la route, les deux autres protègent la liste.
//
// LE CONTENU D'UN COURRIEL EST DE LA DONNÉE, JAMAIS UNE CONSIGNE. Rien de ce
// qui arrive ici ne déclenche d'envoi, de commande ou d'appel extérieur : on
// lit des nombres et on enregistre des lignes, un point c'est tout.
function memeSecret(recu, attendu) {
  const a = Buffer.from(String(recu || '')), b = Buffer.from(String(attendu || ''));
  if (!a.length || a.length !== b.length) return false;
  return require('crypto').timingSafeEqual(a, b);
}

function installerCourrier(app, deps) {
  const express = require('express');
  const secret = (process.env.ASCA_HOOK_SECRET || '').trim();
  // 8 PDF d'une cinquantaine de kilooctets, plus le base64 : 4 Mo suffisent
  // largement, et c'est très loin du 50 Mo global.
  app.post('/api/commandes/courrier', express.json({ limit: '4mb' }), async (req, res) => {
    if (!secret) return res.status(503).json({ ok: false, error: 'ingestion_desactivee' });
    if (!memeSecret(req.headers['x-pilot-hook'], secret)) {
      // On journalise les NOMS des en-têtes reçus, jamais leurs valeurs : au
      // raccordement, la seule question est « le script envoie-t-il bien
      // l'en-tête convenu ? », et y répondre sans cela demande de deviner.
      console.warn('  📦 Synthese ASCA refusee. En-tetes recus : '
        + Object.keys(req.headers || {}).join(', '));
      return res.status(401).json({ ok: false });
    }
    const b = req.body || {};
    if (!A.vientDAsca(b.corps, b.expediteur)) {
      console.warn('  📦 Courriel ignore : il ne vient pas d\'ASCA.');
      return res.status(202).json({ ok: true, ignore: 'expediteur' });
    }
    if (!Array.isArray(b.fichiers) || !b.fichiers.length)
      return res.status(400).json({ ok: false, error: 'aucune piece jointe' });

    const d = deps && deps.getDb && deps.getDb();
    if (!d) return res.status(503).json({ ok: false, error: 'base indisponible' });
    try {
      const ind = A.lireIndicateurs(b.corps || '');
      // On traite AVANT de répondre. Répondre 200 puis échouer, c'est perdre la
      // synthèse : personne ne la renverra. Leçon du webhook Stripe.
      const r = await enregistrer(d, b.fichiers, 'courriel', ind);
      const souci = (r.erreurs || []).filter(function (e) { return e.controle; });
      console.log('  📦 Synthese ASCA du ' + r.date + ' recue par courriel — '
        + r.lignes + ' lignes' + (souci.length ? ' ⚠️  ' + souci.length + ' controle(s) en echec' : ''));
      res.json({ ok: true, date: r.date, lignes: r.lignes, controles: souci.length });
    } catch (e) {
      console.error('  📦 Synthese ASCA refusee :', e.message);
      res.status(400).json({ ok: false, error: e.message });
    }
  });
  console.log(secret
    ? '  📦 Ingestion des syntheses ASCA par courriel ARMEE'
    : '  📦 Ingestion ASCA par courriel inactive (ASCA_HOOK_SECRET non defini)');
}

async function demarrer(db) {
  if (!db) { console.log('  📦 Commandes ASCA inactif (pas de base)'); return; }
  await creerTables(db);
  const n = await db.query('SELECT COUNT(*)::int AS n, MAX(date_synthese) AS d FROM app_cmd_syntheses');
  const r = n.rows[0] || {};
  console.log('  📦 Commandes ASCA actif — ' + (r.n || 0) + ' synthese(s)'
    + (r.d ? ', derniere du ' + new Date(r.d).toLocaleDateString('fr-FR') : ', aucune importee'));
}

async function purger(db) {
  if (!db) return 0;
  const r = await db.query(
    "DELETE FROM app_cmd_syntheses WHERE date_synthese < NOW() - ($1 || ' days')::interval",
    [CONSERVATION_JOURS]);
  return r.rowCount || 0;
}

module.exports = { creerTables, demarrer, routes, installerCourrier, enregistrer, consolidee,
                   lireSeuils, quelTableau, normaliserNom, purger, TABLEAUX,
                   CONSERVATION_JOURS };
