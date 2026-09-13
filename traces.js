// ─────────────────────────────────────────────────────────────────────────────
//  JOURNAL DES ACCÈS — qui a consulté quelle donnée de santé, et quand
// ─────────────────────────────────────────────────────────────────────────────
//
//  POURQUOI MAINTENANT ET PAS AVANT. Un journal de consultation ne vaut que ce
//  que vaut l'identification. Tant que le code PIN etait compare dans le
//  navigateur contre la liste de toute l'equipe, n'importe qui pouvait agir sous
//  le nom d'un collegue : le journal aurait enregistre des noms sans rien
//  prouver. Depuis le 13/09/2026 l'identite est verifiee par le serveur — le
//  journal devient une piece.
//
//  DEUX REGLES DE CONSTRUCTION :
//
//  1. L'AUTEUR N'EST JAMAIS CELUI QUE LE CLIENT ANNONCE. Il est lu dans le
//     cookie de session, cote serveur. Un poste peut mentir sur ce qu'il
//     consulte ; il ne peut pas mentir sur qui il est.
//
//  2. RIEN NE S'EFFACE. Aucune route de suppression, pas meme pour un
//     administrateur. Un journal qu'on peut nettoyer ne prouve rien — et c'est
//     la premiere chose qu'un controle verifie.
//
//  CE QU'ON N'ENREGISTRE PAS : le contenu. On note qu'une fiche a ete ouverte,
//  jamais ce qu'elle contenait. Un journal qui recopie les donnees de sante
//  devient lui-meme une donnee de sante a proteger, et double le probleme.
// ─────────────────────────────────────────────────────────────────────────────

// Conservation. La CNIL retient ordinairement six mois a trois ans pour les
// journaux d'acces ; on prend trois ans, qui couvre la duree d'un cycle de
// certification HDS et les delais de reclamation.
const JOURS_GARDE = Math.max(30, parseInt(process.env.TRACES_JOURS || '1095', 10) || 1095);

// Vocabulaire ferme : un journal ou chacun invente ses libelles n'est pas
// exploitable six mois plus tard.
const ACTIONS = { consultation: 1, modification: 1, creation: 1, suppression: 1, impression: 1,
                  envoi: 1, export: 1, connexion: 1, deconnexion: 1 };
const OBJETS  = { patient: 1, ordonnance: 1, renouvellement: 1, credit: 1, bpm: 1, preparation: 1,
                  location: 1, controle: 1, livraison: 1, collaborateur: 1, journal: 1, session: 1, autre: 1 };

async function creerTable(db) {
  if (!db) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS app_acces (
      id     BIGSERIAL PRIMARY KEY,
      ts     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      uid    TEXT NOT NULL,
      action TEXT NOT NULL,
      objet  TEXT NOT NULL,
      ref    TEXT,
      detail TEXT
    )
  `);
  await db.query('CREATE INDEX IF NOT EXISTS app_acces_ts ON app_acces (ts DESC)');
  await db.query('CREATE INDEX IF NOT EXISTS app_acces_uid ON app_acces (uid, ts DESC)');
  await db.query('CREATE INDEX IF NOT EXISTS app_acces_ref ON app_acces (objet, ref)');
}

async function purger(db) {
  if (!db) return 0;
  const r = await db.query("DELETE FROM app_acces WHERE ts < NOW() - INTERVAL '" + JOURS_GARDE + " days'");
  return r.rowCount || 0;
}

// Ecriture directe, pour ce que le serveur constate lui-meme : une ouverture de
// session, un changement de code. Ces evenements-la ne passent pas par le
// navigateur, et c'est precisement ce qui leur donne du poids.
async function noter(db, uid, action, objet, ref, detail) {
  if (!db || !uid) return;
  try {
    await db.query('INSERT INTO app_acces (uid, action, objet, ref, detail) VALUES ($1,$2,$3,$4,$5)',
      [String(uid), ACTIONS[action] ? action : 'autre', OBJETS[objet] ? objet : 'autre',
       ref == null ? null : String(ref).slice(0, 120), detail == null ? null : String(detail).slice(0, 200)]);
  } catch (e) { /* le journal ne doit jamais faire echouer l'action journalisee */ }
}

function installer(app, deps) {
  const { getDb, qui, estAdmin } = deps;

  // Une consultation repetee de la meme fiche par la meme personne dans la
  // minute ne cree qu'une ligne. Sans ce filtre, un simple va-et-vient entre
  // deux onglets produirait des centaines d'entrees et noierait le journal —
  // un journal illisible ne se lit pas, donc ne protege personne.
  const _recent = new Map();
  function doublon(cle) {
    const t = Date.now(), v = _recent.get(cle);
    if (v && t - v < 60000) return true;
    _recent.set(cle, t);
    if (_recent.size > 5000) { for (const k of _recent.keys()) { _recent.delete(k); if (_recent.size < 2500) break; } }
    return false;
  }

  app.post('/api/acces', async (req, res) => {
    const db = getDb(); if (!db) return res.status(503).json({ ok: false });
    // L'auteur vient du cookie, JAMAIS du corps de la requete.
    const uid = qui(req);
    if (!uid) return res.status(401).json({ ok: false, error: 'non_identifie' });
    const b = req.body || {};
    const action = ACTIONS[b.action] ? b.action : 'consultation';
    const objet  = OBJETS[b.objet] ? b.objet : 'autre';
    const ref    = b.ref == null ? null : String(b.ref).slice(0, 120);
    const detail = b.detail == null ? null : String(b.detail).slice(0, 200);
    try {
      if (doublon(uid + '|' + action + '|' + objet + '|' + ref)) return res.json({ ok: true, doublon: true });
      await db.query('INSERT INTO app_acces (uid, action, objet, ref, detail) VALUES ($1,$2,$3,$4,$5)',
        [uid, action, objet, ref, detail]);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // Consultation du journal. Reservee aux administrateurs — et elle se journalise
  // elle-meme : savoir qui est alle regarder qui fait partie de ce qu'un controle
  // demande.
  app.get('/api/acces', async (req, res) => {
    const db = getDb(); if (!db) return res.status(503).json({ ok: false });
    const uid = qui(req);
    if (!uid) return res.status(401).json({ ok: false, error: 'non_identifie' });
    if (!(await estAdmin(uid))) return res.status(403).json({ ok: false, error: 'interdit' });
    const q = req.query || {};
    const cond = [], args = [];
    if (q.depuis) { args.push(q.depuis); cond.push('ts >= $' + args.length); }
    if (q.jusqu)  { args.push(q.jusqu);  cond.push('ts <= $' + args.length); }
    if (q.uid)    { args.push(String(q.uid));   cond.push('uid = $' + args.length); }
    if (q.objet)  { args.push(String(q.objet)); cond.push('objet = $' + args.length); }
    if (q.ref)    { args.push(String(q.ref));   cond.push('ref = $' + args.length); }
    const limite = Math.min(2000, Math.max(1, parseInt(q.limite, 10) || 300));
    try {
      const r = await db.query(
        'SELECT ts, uid, action, objet, ref, detail FROM app_acces'
        + (cond.length ? ' WHERE ' + cond.join(' AND ') : '')
        + ' ORDER BY ts DESC LIMIT ' + limite, args);
      await db.query('INSERT INTO app_acces (uid, action, objet, ref, detail) VALUES ($1,$2,$3,$4,$5)',
        [uid, 'consultation', 'journal', null, 'journal des accès consulté']).catch(() => {});
      res.json({ ok: true, lignes: r.rows, garde_jours: JOURS_GARDE });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // Volontairement : AUCUNE route de suppression ni de modification.
}

module.exports = { creerTable, purger, installer, noter, JOURS_GARDE, ACTIONS, OBJETS };
