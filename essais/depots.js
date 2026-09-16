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

// ── Le numéro lu à voix haute ──────────────────────────────────────────────
console.log('\nLe numéro que le patient lit au pharmacien');
t('la boîte vide commence à 1', D.numeroLibre({ depots: [] }) === 1);
t('sans rubrique du tout non plus ça ne casse', D.numeroLibre({}) === 1);
t('le suivant est pris',
  D.numeroLibre({ depots: [{ num: 1 }, { num: 2 }] }) === 3);
// Il doit etre court a dire : on rebouche les trous plutot que de compter
// indefiniment.
t('un trou est rebouché plutôt que d’allonger le numéro',
  D.numeroLibre({ depots: [{ num: 1 }, { num: 3 }] }) === 2);
t('un dépôt archivé libère son numéro',
  D.numeroLibre({ depots: [{ num: 1, archiveLe: T }, { num: 2 }] }) === 1);
t('deux dépôts ouverts n’ont jamais le même numéro',
  D.numeroLibre({ depots: [{ num: 1 }, { num: 2 }, { num: 3 }] }) === 4);

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

console.log('\n' + ok + ' vérifications, ' + ko + ' échec(s)\n');
process.exit(ko ? 1 : 0);
