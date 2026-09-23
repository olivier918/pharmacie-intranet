// L'ordonnance recuperee pendant une livraison : le bouton sur la ligne, et
// la liste « a facturer » des livraisons qui doit se taire une fois le
// dossier parti dans les renouvellements. Les fonctions sont extraites de
// public/index.html lui-meme : c'est le code reel qui est eprouve.
// node essais/livraison-ordo.js
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

// Une declaration sur une seule ligne (dRetrait, dTermine, dAFacturer).
function extraireLigne(nom) {
  const m = new RegExp('^function ' + nom + '\\(.*$', 'm').exec(src);
  if (!m) throw new Error('fonction introuvable : ' + nom);
  return m[0];
}
// Une declaration sur plusieurs lignes, fermee par une accolade en colonne 1.
function extraireBloc(nom) {
  const d = src.indexOf('\nfunction ' + nom + '(');
  if (d < 0) throw new Error('fonction introuvable : ' + nom);
  const f = src.indexOf('\n}\n', d);
  if (f < 0) throw new Error('fin introuvable : ' + nom);
  return src.slice(d + 1, f + 3);
}
const mLieux = /^const LIEUX_RETRAIT=.*$/m.exec(src);
if (!mLieux) throw new Error('LIEUX_RETRAIT introuvable');
eval(mLieux[0].replace('const ', 'var '));
eval(extraireLigne('dRetrait'));
eval(extraireLigne('dTermine'));
eval(extraireLigne('dAFacturer'));
eval(extraireBloc('dBoutonOrdo'));
// Le seul emprunt de dBoutonOrdo au reste de la page.
function ico(n) { return '<svg><use href="#ic-' + n + '"></use></svg>'; }
// Le module des depots est charge par index.html ; ici on le simule.
global.odCapturerLivraison = function () {};

let ok = 0, ko = 0;
const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };
console.log('\nLIVRAISON — l’ordonnance récupérée chez le patient\n');

const PHOTO = 1758000000000;
const liv = (o) => Object.assign({ id: 7, lieu: 'Domicile', status: 'done', ordo: true }, o);

console.log('Le bouton sur la ligne');
t('une livraison avec ordonnance à récupérer porte un bouton',
  /<button/.test(dBoutonOrdo(liv({ status: 'wait' }))));
t('... qui ouvre l’appareil photo sur CETTE livraison',
  dBoutonOrdo(liv({ id: 42, status: 'wait' })).indexOf('odCapturerLivraison(42)') > 0);
t('... sans déclencher le clic de la ligne au passage',
  /event\.stopPropagation\(\)/.test(dBoutonOrdo(liv({ status: 'wait' }))));
t('... et il ne part pas à l’impression',
  /no-print/.test(dBoutonOrdo(liv({ status: 'wait' }))));
t('une livraison sans ordonnance n’affiche rien',
  dBoutonOrdo(liv({ ordo: false })) === '' && dBoutonOrdo(null) === '');

console.log('\nUne fois la photo prise');
const pris = liv({ ordoRecupereeLe: PHOTO });
t('la ligne le dit, en clair', /récupérée/.test(dBoutonOrdo(pris)));
t('... et ne propose plus de rephotographier', !/<button/.test(dBoutonOrdo(pris)));
t('... la date de la photo reste consultable',
  dBoutonOrdo(pris).indexOf(new Date(PHOTO).toLocaleString('fr-FR')) > 0);

console.log('\nCe qui ne doit PAS être facturé deux fois');
t('avant la photo, la livraison est bien à facturer ici',
  dAFacturer(liv({})) === true);
t('après la photo, le dossier vit dans les renouvellements',
  dAFacturer(pris) === false);
t('... et une facturation déjà finalisée ne revient pas non plus',
  dAFacturer(liv({ factureAt: '2026-09-16' })) === false);
t('une livraison non terminée n’est pas à facturer',
  dAFacturer(liv({ status: 'wait' })) === false);
t('un retrait au comptoir est à facturer dès qu’il est préparé',
  dAFacturer(liv({ lieu: 'Pharmacie', status: 'prep' })) === true);
t('... et se tait lui aussi une fois l’ordonnance photographiée',
  dAFacturer(liv({ lieu: 'Pharmacie', status: 'prep', ordoRecupereeLe: PHOTO })) === false);
t('sans ordonnance, rien à facturer', dAFacturer(liv({ ordo: false })) === false);

console.log('\nLe repli quand le module des dépôts n’est pas chargé');
const vraiOd = global.odCapturerLivraison;
t('module présent : un vrai bouton', /<button/.test(dBoutonOrdo(liv({}))));
global.odCapturerLivraison = undefined;
t('module absent : un badge, pas un bouton mort',
  !/<button/.test(dBoutonOrdo(liv({}))) && /Ordo/.test(dBoutonOrdo(liv({}))));
global.odCapturerLivraison = vraiOd;

// ── L'ordre des dates dans le journal ───────────────────────────────────────
eval(extraireBloc('dDatesTriees'));

console.log('\nL’ordre des en-têtes de date');
const G = { '2024-03-02': [1], '2026-09-23': [1], '2025-11-14': [1] };
// Une semaine se lit en avancant : lundi, mardi, mercredi.
t('sans recherche, la semaine se lit du plus ancien au plus récent',
  dDatesTriees(G, false).join() === '2024-03-02,2025-11-14,2026-09-23');
// Une recherche par nom traverse les annees : c'est la derniere livraison qui
// interesse, et elle se trouvait tout en bas de la page.
t('en recherche, la plus récente est en tête',
  dDatesTriees(G, true).join() === '2026-09-23,2025-11-14,2024-03-02');
t('une seule date ne change pas d’ordre',
  dDatesTriees({ '2026-09-23': [1] }, true).join() === '2026-09-23');
t('aucune date ne casse rien', dDatesTriees({}, true).length === 0 && dDatesTriees(null, true).length === 0);
// Les dates sont en ISO : leur ordre texte EST leur ordre chronologique, y
// compris d'une annee sur l'autre et sur un changement de mois.
t('le tri est bien chronologique, pas alphabétique par hasard',
  dDatesTriees({ '2026-01-02': [], '2026-01-10': [], '2026-02-01': [] }, true).join()
  === '2026-02-01,2026-01-10,2026-01-02');
// C'est la RECHERCHE qui renverse, pas la vue semaine ni la liste a facturer :
// une liste de travail se prend par le plus ancien.
t('c’est la recherche, et elle seule, qui renverse l’ordre',
  /const sortedDates=dDatesTriees\(groups, !!q\);/.test(src));

console.log('\n' + ok + ' vérifications, ' + ko + ' échec(s)\n');
process.exit(ko ? 1 : 0);
