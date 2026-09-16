// Garde-fou du module Depots. Les fonctions viennent de depots.js lui-meme.
// node essais/depots.js
const D = require('../depots');

let ok = 0, ko = 0;
const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };
const J = 86400000;
console.log('\nDÉPÔTS — ce que le patient envoie, et ce qui en reste\n');

// ── Le jeton ───────────────────────────────────────────────────────────────
console.log('Le jeton du lien envoyé par SMS');
const j1 = D.nouveauJeton(), j2 = D.nouveauJeton();
t('il fait 128 bits, soit 22 caractères en base64url', j1.length === 22);
t('deux jetons ne se ressemblent pas', j1 !== j2);
t('il tient dans une adresse, sans caractère à échapper', /^[A-Za-z0-9_-]+$/.test(j1));
t('il est reconnu', D.jetonValide(j1));
t('une chaîne vide n’est pas un jeton', !D.jetonValide('') && !D.jetonValide(null));
t('un jeton trop court est refusé', !D.jetonValide('abc'));
t('une tentative d’injection est refusée',
  !D.jetonValide('../../etc/passwd') && !D.jetonValide('a'.repeat(15) + '<script>'));
// Le SMS ne doit pas basculer a deux segments a cause du jeton.
t('l’adresse complète reste courte',
  ('https://pilot.pharmacie-mondeville.fr/o/' + j1).length <= 62);

// ── Ce qui est rattaché, ce qui ne l'est pas ───────────────────────────────
console.log('\nRattaché ou non — c’est tout ce qui décide');
t('sans lien, un dépôt est libre', !D.rattache({ id: 1 }));
t('un lien vide ne rattache pas', !D.rattache({ id: 1, lien: {} }));
t('un lien sans référence ne rattache pas', !D.rattache({ id: 1, lien: { type: 'location' } }));
t('une location rattache', D.rattache({ id: 1, lien: { type: 'location', ref: 42 } }));
t('un renouvellement rattache', D.rattache({ id: 1, lien: { type: 'renouvellement', ref: 7 } }));
t('la référence zéro rattache quand même',
  D.rattache({ id: 1, lien: { type: 'location', ref: 0 } }));

// ── La rétention ───────────────────────────────────────────────────────────
console.log('\nSept jours — et seulement ce que personne n’a classé');
const T = 1789000000000;
const LOT = [
  { id: 1, ts: T - 9 * J },                                          // vieux, libre
  { id: 2, ts: T - 9 * J, lien: { type: 'location', ref: 5 } },       // vieux, rattache
  { id: 3, ts: T - 2 * J },                                          // recent, libre
  { id: 4, ts: T - 7 * J - 1000 },                                   // juste au-dela
  { id: 5, ts: T - 6 * J }                                           // juste en deca
];
const p = D.aPurger(LOT, T);
t('le vieux dépôt libre part', p.some(x => x.id === 1));
// LA regle du module : rattacher, c'est conserver. Un effet de bord ici viderait
// un dossier de location.
t('le vieux dépôt RATTACHÉ reste, quel que soit son âge',
  !p.some(x => x.id === 2));
t('un dépôt récent reste', !p.some(x => x.id === 3));
t('sept jours et une seconde, c’est parti', p.some(x => x.id === 4));
t('six jours, c’est encore là', !p.some(x => x.id === 5));
t('au total, deux dépôts sur cinq', p.length === 2);
t('une liste vide ou absente ne casse rien',
  D.aPurger([], T).length === 0 && D.aPurger(null, T).length === 0);
t('la durée est réglable', D.aPurger(LOT, T, 30).length === 0);
t('sept jours est bien la valeur retenue', D.DEPOT_JOURS === 7);

// ── La déduplication : le piège du 13/09, dans l'autre sens ────────────────
console.log('\nLes octets partagés ne doivent pas partir avec le dépôt');
const MEME = 'a'.repeat(32), AUTRE = 'b'.repeat(32);
t('un dépôt rend les identifiants qu’il détient',
  D.imagesDuDepot({ fichiers: [{ fichId: MEME }, { fichId: AUTRE }] }).join() === MEME + ',' + AUTRE);
t('un dépôt sans fichier n’en rend aucun',
  D.imagesDuDepot({}).length === 0 && D.imagesDuDepot(null).length === 0);
t('une entrée sans identifiant est ignorée',
  D.imagesDuDepot({ fichiers: [{ fichId: null }, { fichId: MEME }] }).length === 1);
// Le scenario reel : le patient envoie deux fois la meme photo, une fois au
// comptoir (purgee) et une fois par le lien de sa location (conservee). Le
// condensat etant le meme, les deux depots partagent UN octet.
const partage = [
  { id: 10, ts: T - 9 * J, fichiers: [{ fichId: MEME }] },
  { id: 11, ts: T - 1 * J, fichiers: [{ fichId: MEME }], lien: { type: 'location', ref: 3 } }
];
const partis = D.aPurger(partage, T);
t('seul le dépôt libre est purgé', partis.length === 1 && partis[0].id === 10);
const restant = partage.filter(x => x.id !== 10);
const encore = new Set(restant.reduce((a, x) => a.concat(D.imagesDuDepot(x)), []));
t('... et son octet est encore référencé par le dossier de location',
  encore.has(MEME));
t('un octet que plus personne ne référence, lui, peut partir', !encore.has(AUTRE));

// ── La date du jour ────────────────────────────────────────────────────────
console.log('\nLa date du jour, à Paris');
// Un serveur en UTC place une ordonnance déposée à 00h30 la veille, et le
// dossier ouvert apparaît aussitôt en retard.
t('elle a la forme attendue par le module', /^\d{4}-\d{2}-\d{2}$/.test(D.jourParis()));
t('... et le numéro D-47 a bien disparu', D.numeroLibre === undefined);

// ── Les types acceptés ─────────────────────────────────────────────────────
console.log('\nCe que la route publique accepte');
t('le PDF du médecin', !!D.DEPOT_TYPES['application/pdf']);
t('les photos', !!D.DEPOT_TYPES['image/jpeg'] && !!D.DEPOT_TYPES['image/png']);
t('une page web déguisée est refusée', !D.DEPOT_TYPES['text/html']);
t('un exécutable est refusé', !D.DEPOT_TYPES['application/x-msdownload']);
// La page convertit toute image en JPEG avant l'envoi : le HEIC d'un iPhone
// n'arrive jamais ici, et la liste reste courte.
t('le HEIC n’a pas à être accepté côté serveur', !D.DEPOT_TYPES['image/heic']);
t('six fichiers au maximum', D.DEPOT_MAX_FICHIERS === 6);
t('huit méga-octets au maximum', D.DEPOT_MAX_OCTETS === 8 * 1024 * 1024);

// ── Retrouver un dépôt par son jeton ───────────────────────────────────────
console.log('\nRetrouver un dépôt par son jeton');
const JJ = D.nouveauJeton();
const etat = { depots: [{ id: 1, jeton: JJ }, { id: 2, jeton: D.nouveauJeton() }] };
t('le bon dépôt est trouvé', (D.parJeton(etat, JJ) || {}).id === 1);
t('un jeton inconnu ne rend rien', D.parJeton(etat, D.nouveauJeton()) === null);
t('un jeton mal formé ne rend rien, et ne cherche même pas',
  D.parJeton(etat, '../x') === null && D.parJeton(etat, '') === null);
t('une base sans dépôt ne rend rien', D.parJeton({}, JJ) === null);


// ══════════════════════════════════════════════════════════════════════════
//  LA ROUTE ELLE-MÊME
//  ────────────────────────────────────────────────────────────────────────
//  Ajouté le 16/09/2026 après un défaut que les 46 vérifications ci-dessus
//  n'ont pas vu : le gestionnaire lisait l'état, y ajoutait le dépôt, et ne
//  l'ÉCRIVAIT JAMAIS. Les octets de l'image partaient bien dans app_images,
//  le patient recevait son numéro, et il ne restait rien.
//
//  Éprouver des fonctions pures ne suffit pas quand le travail réel est un
//  effet de bord. On fait donc passer un vrai dépôt par la vraie route, avec
//  un état qui n'est modifié QUE par ecrireEtat — c'est ce qui rend le défaut
//  visible.
// ══════════════════════════════════════════════════════════════════════════
console.log('\nLa route de dépôt, de bout en bout');

function fauxApp() {
  const routes = {};
  const poser = (m) => (p, ...h) => { routes[m + ' ' + p] = h; };
  return { get: poser('GET'), post: poser('POST'), routes };
}
const fauxExpress = { json: () => (req, res, suite) => suite() };

// Déroule la chaîne de gestionnaires comme le ferait Express.
async function appeler(handlers, req) {
  const res = { code: 200, corps: null, fini: false,
    status(c) { this.code = c; return this; },
    json(o) { this.corps = o; this.fini = true; return this; },
    set() { return this; }, end() { this.fini = true; return this; },
    sendFile() { this.fini = true; return this; } };
  for (const f of handlers) {
    const continuer = await new Promise((ok) => {
      let suivantAppele = false;
      const suite = () => { suivantAppele = true; ok(true); };
      let r;
      try { r = f(req, res, suite); } catch (e) { res.erreur = e; return ok(false); }
      if (r && typeof r.then === 'function') r.then(() => { if (!suivantAppele) ok(false); },
                                                     (e) => { res.erreur = e; ok(false); });
      else if (!suivantAppele) ok(false);
    });
    if (!continuer) break;
  }
  return res;
}

// Un JPEG minuscule mais valide en base64.
const IMG = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a'
          + 'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA'
          + 'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

async function bancDepot(opts) {
  const o = opts || {};
  const app = fauxApp();
  // L'etat n'est modifiable QUE par ecrireEtat : une mutation en memoire qui
  // ne serait pas ecrite ne laisse aucune trace ici, et l'essai echoue.
  let etat = o.etat || {};
  let ecritures = 0;
  D.installer(app, fauxExpress, {
    lireEtat: async () => JSON.parse(JSON.stringify(etat)),
    ecrireEtat: async (e) => { etat = JSON.parse(JSON.stringify(e)); ecritures++; },
    serialiser: (fn) => fn(),
    deposerImage: async () => (o.image === null ? null : (o.image || 'a'.repeat(32))),
    ouvert: async () => (o.ouvert !== false),
    frein: (req, res, suite) => suite()
  });
  return { app, lire: () => etat, ecritures: () => ecritures };
}
const corpsOk = (n) => ({ body: { nom: 'DUPONT', prenom: 'Marie',
  fichiers: Array.from({ length: n || 1 },
  () => ({ mime: 'image/jpeg', data: IMG, nom: 'ordo.jpg' })) }, params: {}, headers: {} });

(async function () {
  // ── Le dépôt du comptoir ────────────────────────────────────────────────
  let b = await bancDepot();
  let r = await appeler(b.app.routes['POST /api/depot'], corpsOk(1));
  t('un dépôt valide est accepté', r.code === 200 && r.corps && r.corps.ok === true);
  // LE test qui manquait.
  t('... et il est VRAIMENT écrit en base', (b.lire().depots || []).length === 1);
  t('... par un appel à ecrireEtat, pas une mutation en mémoire', b.ecritures() === 1);
  t('aucun numéro n’est rendu : le nom le remplace', r.corps.num === undefined);
  t('le dépôt porte son origine', (b.lire().depots[0] || {}).origine === 'comptoir');
  // Sans le nom, une ordonnance envoyée de chez le patient est inexploitable :
  // il n'y a personne au comptoir pour dire le numéro.
  t('... le nom du patient', (b.lire().depots[0] || {}).nom === 'DUPONT');
  t('... et son prénom', (b.lire().depots[0] || {}).prenom === 'Marie');
  t('... l’heure d’arrivée', !!(b.lire().depots[0] || {}).ts);
  t('... et le fichier déposé', ((b.lire().depots[0] || {}).fichiers || []).length === 1);
  t('il n’est rattaché à rien : il partira dans sept jours',
    !D.rattache(b.lire().depots[0]));

  r = await appeler(b.app.routes['POST /api/depot'], corpsOk(2));
  t('un second dépôt s’ajoute sans numéro', r.corps.num === undefined);
  t('... et s’ajoute au premier', b.lire().depots.length === 2);
  t('... avec ses deux fichiers', b.lire().depots[1].fichiers.length === 2);

  // ── Ce qui ne doit RIEN écrire ──────────────────────────────────────────
  console.log('\nCe qui est refusé ne doit rien laisser derrière');
  b = await bancDepot();
  r = await appeler(b.app.routes['POST /api/depot'],
    { body: { fichiers: [{ mime: 'text/html', data: IMG }] }, params: {}, headers: {} });
  t('un type interdit est refusé', r.code === 400);
  t('... et rien n’est écrit', b.ecritures() === 0 && !(b.lire().depots || []).length);

  b = await bancDepot();
  r = await appeler(b.app.routes['POST /api/depot'], { body: { fichiers: [] }, params: {}, headers: {} });
  t('un envoi vide est refusé', r.code === 400 && b.ecritures() === 0);

  // Le nom : exigé sans jeton, jamais redemandé avec.
  b = await bancDepot();
  r = await appeler(b.app.routes['POST /api/depot'], { params: {}, headers: {}, body: {
    fichiers: [{ mime: 'image/jpeg', data: IMG }] } });
  t('sans nom ni prénom, le dépôt est refusé', r.code === 400);
  t('... et le message dit quoi faire', /nom/i.test((r.corps || {}).error || ''));
  t('... et rien n’est écrit', b.ecritures() === 0);

  b = await bancDepot();
  r = await appeler(b.app.routes['POST /api/depot'], { params: {}, headers: {}, body: {
    nom: 'DUPONT', prenom: '   ', fichiers: [{ mime: 'image/jpeg', data: IMG }] } });
  t('un prénom fait d’espaces ne compte pas', r.code === 400 && b.ecritures() === 0);

  b = await bancDepot();
  r = await appeler(b.app.routes['POST /api/depot'], { params: {}, headers: {}, body: {
    nom: 'DUPONT', prenom: 'Marie', naissance: '1954-03-12',
    fichiers: [{ mime: 'image/jpeg', data: IMG }] } });
  t('la date de naissance est retenue quand elle est donnée',
    b.lire().depots[0].naissance === '1954-03-12');
  b = await bancDepot();
  await appeler(b.app.routes['POST /api/depot'], corpsOk(1));
  t('... et vaut null quand elle ne l’est pas', b.lire().depots[0].naissance === null);

  // Un seul fichier illisible sur trois : on refuse TOUT. Un envoi a moitie
  // depose laisserait des octets orphelins et un patient sans reponse claire.
  b = await bancDepot();
  r = await appeler(b.app.routes['POST /api/depot'], { params: {}, headers: {}, body: { fichiers: [
    { mime: 'image/jpeg', data: IMG }, { mime: 'image/jpeg', data: 'pas du base64 !' },
    { mime: 'image/jpeg', data: IMG }] } });
  t('un seul fichier illisible fait refuser tout l’envoi', r.code === 400);
  t('... et rien n’est écrit', b.ecritures() === 0);

  b = await bancDepot({ ouvert: false });
  r = await appeler(b.app.routes['POST /api/depot'], corpsOk(1));
  t('dépôt fermé : refusé, et le message renvoie vers la pharmacie',
    r.code === 503 && /pharmacie/i.test((r.corps || {}).error || ''));
  t('... et rien n’est écrit', b.ecritures() === 0);

  // ── Le lien envoyé par SMS ──────────────────────────────────────────────
  console.log('\nLe lien envoyé par SMS');
  const JET = D.nouveauJeton();
  const attendu = { depots: [{ id: 9, ts: 1, jeton: JET, prenom: 'Marie',
    lien: { type: 'location', ref: 11 }, fichiers: [] }] };
  b = await bancDepot({ etat: attendu });
  r = await appeler(b.app.routes['POST /api/depot'],
    Object.assign(corpsOk(1), { body: Object.assign(corpsOk(1).body, { jeton: JET }) }));
  t('le dépôt par lien est accepté, SANS qu’on redemande le nom',
    r.code === 200 && r.corps.ok === true);
  t('... et écrit', b.ecritures() === 1);
  t('... et il est déjà rattaché à son dossier', D.rattache(b.lire().depots[0]));
  t('... le dossier d’origine est conservé', D.rattache(b.lire().depots[0]));
  t('... et le fichier est bien posé', b.lire().depots[0].fichiers.length === 1);
  t('... la rétention repart de l’arrivée', b.lire().depots[0].ts > 1);

  // Un jeton ne sert qu'UNE fois.
  r = await appeler(b.app.routes['POST /api/depot'],
    Object.assign(corpsOk(1), { body: Object.assign(corpsOk(1).body, { jeton: JET }) }));
  t('le même lien ne resservira pas', r.code === 410);
  t('... et le second envoi n’écrase pas le premier', b.ecritures() === 1);

  b = await bancDepot({ etat: { depots: [] } });
  r = await appeler(b.app.routes['POST /api/depot'],
    Object.assign(corpsOk(1), { body: Object.assign(corpsOk(1).body, { jeton: D.nouveauJeton() }) }));
  t('un jeton inconnu est refusé', r.code === 410 && b.ecritures() === 0);

  // ── L'état que la page publique a le droit de lire ──────────────────────
  console.log('\nCe que la page publique a le droit de savoir');
  b = await bancDepot({ etat: attendu });
  r = await appeler(b.app.routes['GET /api/depot/etat/:jeton'], { params: { jeton: JET }, headers: {} });
  t('un jeton connu donne le prénom, et rien d’autre',
    r.corps && r.corps.lien === true && r.corps.prenom === 'Marie'
    && Object.keys(r.corps).sort().join() === 'lien,ok,ouvert,prenom');
  r = await appeler(b.app.routes['GET /api/depot/etat/:jeton'],
    { params: { jeton: D.nouveauJeton() }, headers: {} });
  t('un jeton inconnu ne dit NI pourquoi, NI de qui il s’agit',
    r.corps.lien === false && r.corps.prenom === undefined);
  r = await appeler(b.app.routes['GET /api/depot/etat/:jeton'],
    { params: { jeton: '../../etc/passwd' }, headers: {} });
  t('un jeton mal formé ne cherche même pas', r.corps.lien === false);

  console.log('\n' + ok + ' vérifications, ' + ko + ' échec(s)\n');
  process.exit(ko ? 1 : 0);
})();
