// LE SUIVI ADMINISTRATIF — ce que le mois doit produire, et ce qu'il a produit.
// node essais/suivi-admin.js
//
// CE QUI SE JOUE. Une to-do list qui se renouvelle toute seule a deux façons
// de trahir, et les deux sont silencieuses :
//
//   • elle oublie — une relance d'impayés non faite disparaît avec le mois,
//     et personne ne saura jamais qu'elle a existé ;
//   • elle double — deux postes ouvrent le module le 1er à la même seconde et
//     génèrent chacun leur liste, qui se superposent.
//
// La première se tient par le report ; la seconde par des identifiants
// CALCULÉS, que la fusion par id ramène à un seul exemplaire. Ces deux
// mécaniques sont la raison d'être de cet essai.
//
// Les fonctions sont extraites de public/sa-module.js lui-même : un essai qui
// recopierait la règle ne vérifierait que sa propre copie.
const fs = require('fs'), path = require('path');
const lire = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const src = lire('public/sa-module.js');

function extraire(nom) {
  const d = src.indexOf('  function ' + nom + '(');
  if (d < 0) throw new Error('fonction introuvable : ' + nom);
  const f = src.indexOf('\n  }\n', d);
  if (f < 0) throw new Error('fin introuvable : ' + nom);
  return src.slice(d, f + 4);
}
function bloc(depart, fin) {
  const d = src.indexOf(depart);
  if (d < 0) throw new Error('bloc introuvable : ' + depart);
  const f = src.indexOf(fin, d);
  return src.slice(d, f + fin.length);
}

// Les constantes viennent AUSSI du module : la liste des indicateurs y est la
// seule vérité, et un essai qui la recopierait ne verrait pas une ligne ajoutée.
const pad = n => String(n).padStart(2, '0');
// `const` declare dans un eval ne vit QUE dans cet eval : les fonctions
// evaluees plus bas, dans un autre eval, ne le verraient pas. On les pose donc
// en global, ou tout le monde les lit.
const global_ = (d, f) => eval(bloc(d, f).replace(/^const /, 'globalThis.'));
global_('const SA_ETATS =', "'fait'];");
global_('const SA_MOIS_LBL =', "'décembre'];");
global_('const SA_MOIS_COURT =', "'Déc'];");
global_('const SA_GROUPES =', "Anouck'];");
global_('const SA_INDICS = [', "\n  ];");

// UN SEUL eval, AU PREMIER NIVEAU. Evaluer dans le rappel d'un `forEach`
// declarerait chaque fonction dans la portee du rappel, et nulle part ailleurs :
// l'essai tomberait sur « saMoisValide is not defined » des la premiere ligne.
eval(['saMoisDe', 'saMoisValide', 'saMoisDecale', 'saMoisLbl', 'saMoisDuModele', 'saDuMois',
 'saPeriodeLbl', 'saEtat', 'saEtatSuivant', 'saIdModele', 'saIdReport', 'saOrigine',
 'saAGenerer', 'saTrier', 'saOrdreDeplace', 'saDuMoisListe', 'saSousActions', 'saGroupes', 'saAvancement',
 'saNombre', 'saEuro', 'saValeur', 'saPct', 'saReleve', 'saDateFr', 'saDateIso'
].map(extraire).join('\n'));

let ok = 0, ko = 0;
const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };
console.log('\nLE SUIVI ADMINISTRATIF\n');

// ── Le calendrier ───────────────────────────────────────────────────────────
console.log('Le calendrier, sans toISOString');
t('un mois se lit AAAA-MM', saMoisValide('2026-10') && saMoisValide('2026-01'));
t('un mois à 13 n’existe pas', !saMoisValide('2026-13') && !saMoisValide('2026-00'));
t('le mois précédent de janvier est décembre de l’an d’avant',
  saMoisDecale('2026-01', -1) === '2025-12');
t('le mois suivant de décembre est janvier de l’an d’après',
  saMoisDecale('2026-12', 1) === '2027-01');
t('on peut reculer de plus d’un an', saMoisDecale('2026-03', -15) === '2024-12');
// LE PIÈGE N°3 DU DÉPÔT. `toISOString()` sur une Date à minuit locale rend la
// veille — et le 1er du mois, la veille, c'est le mois d'avant.
t('LE 1ER À MINUIT RESTE LE MOIS EN COURS — pas celui d’avant',
  saMoisDe(new Date(2026, 10, 1, 0, 0, 0)) === '2026-11');
t('le 31 à 23h59 aussi', saMoisDe(new Date(2026, 9, 31, 23, 59, 59)) === '2026-10');
t('le mois s’affiche en toutes lettres', saMoisLbl('2026-08') === 'août 2026');

// ── La périodicité ──────────────────────────────────────────────────────────
console.log('\nLa périodicité est portée par les mois eux-mêmes');
t('une tâche sans liste de mois revient tous les mois',
  saMoisDuModele({ titre: 'x' }).length === 12);
t('... et elle est donc due en février comme en juillet',
  saDuMois({ id: 1, titre: 'x' }, '2026-02') && saDuMois({ id: 1, titre: 'x' }, '2026-07'));
t('UNE TÂCHE TRIMESTRIELLE N’EST DUE QUE SES QUATRE MOIS',
  saDuMois({ id: 1, mois: [1, 4, 7, 10] }, '2026-04')
  && !saDuMois({ id: 1, mois: [1, 4, 7, 10] }, '2026-05'));
t('une tâche annuelle ne vient qu’une fois',
  saDuMois({ id: 1, mois: [3] }, '2026-03') && !saDuMois({ id: 1, mois: [3] }, '2026-09'));
t('UNE TÂCHE SUSPENDUE N’EST DUE NULLE PART', !saDuMois({ id: 1, actif: false }, '2026-03'));
t('un mois hors bornes est ignoré au lieu de créer une colonne treize',
  saMoisDuModele({ mois: [3, 13, 0, 7] }).join(',') === '3,7');
t('l’étiquette dit « tous les mois »', saPeriodeLbl({}) === 'Tous les mois');
t('... « une fois par an », avec le mois', /Une fois par an — mars/.test(saPeriodeLbl({ mois: [3] })));
t('... et « trimestriel », avec les quatre', /Trimestriel/.test(saPeriodeLbl({ mois: [1, 4, 7, 10] })));

// ── Les trois états ─────────────────────────────────────────────────────────
console.log('\nTrois états, et le tour est rond');
t('une tâche neuve est à faire', saEtat({ id: 1 }) === 'a_faire');
t('UN ÉTAT INVENTÉ RETOMBE SUR « À FAIRE » — jamais sur « fait »',
  saEtat({ etat: 'archivee' }) === 'a_faire');
t('une ligne absente ne fait pas tomber la lecture', saEtat(null) === 'a_faire');
t('le clic fait le tour : à faire → en cours → fait → à faire',
  saEtatSuivant('a_faire') === 'en_cours'
  && saEtatSuivant('en_cours') === 'fait'
  && saEtatSuivant('fait') === 'a_faire');

// ── La génération d'un mois ─────────────────────────────────────────────────
console.log('\nLe 1er du mois : ce que PILOT fabrique');
const MODS = [
  { id: 'm1', titre: 'Relance des impayés', groupe: 'Clients en compte', ordre: 10 },
  { id: 'm2', titre: 'Tableau des remises CERP', groupe: 'Grossistes', ordre: 20 },
  { id: 'm3', titre: 'Classement récaps CERP', groupe: 'Grossistes', mois: [3], ordre: 30 },
  { id: 'm4', titre: 'Tâche suspendue', groupe: '', actif: false, ordre: 40 }
];
const T0 = Date.UTC(2026, 10, 1);
let g = saAGenerer(MODS, [], '2026-11', T0);
t('les tâches dues du mois sont créées', g.length === 2);
t('... la trimestrielle de mars n’en est pas', !g.some(x => x.modeleId === 'm3'));
t('UNE TÂCHE SUSPENDUE N’EST PAS GÉNÉRÉE', !g.some(x => x.modeleId === 'm4'));
t('elles naissent à faire, sans opérateur',
  g.every(x => x.etat === 'a_faire' && !x.par && !x.le));
t('elles gardent la rubrique du modèle',
  g.find(x => x.modeleId === 'm1').groupe === 'Clients en compte');
t('mars, lui, reçoit bien la trimestrielle',
  saAGenerer(MODS, [], '2026-03', T0).some(x => x.modeleId === 'm3'));

console.log('\nDeux postes au même instant ne font pas deux listes');
const g2 = saAGenerer(MODS, [], '2026-11', T0 + 931);
t('L’IDENTIFIANT EST CALCULÉ, PAS TIRÉ AU SORT — la fusion n’en garde qu’un',
  g.map(x => x.id).join('|') === g2.map(x => x.id).join('|'));
t('... et il porte le mois et le modèle, donc il se lit',
  g[0].id === saIdModele('2026-11', g[0].modeleId));

console.log('\nChaque récurrente due a sa ligne, même dans un mois commencé');
// Le défaut du 23/10 : une action écrite à la main dans le mois, et aucune
// récurrente ne s'affichait plus dans la to-do list.
const AMAIN = [{ id: 'x', mois: '2026-11', titre: 'Écrite à la main' }];
t('UNE ACTION ÉCRITE À LA MAIN N’EMPÊCHE PLUS LES RÉCURRENTES D’APPARAÎTRE',
  saAGenerer(MODS, AMAIN, '2026-11', T0).filter(x => x.modeleId).length === 2);
t('un mois complet ne produit rien de plus — compléter deux fois ne double rien',
  saAGenerer(MODS, g, '2026-11', T0).length === 0);
t('UNE RÉCURRENTE CRÉÉE EN COURS DE MOIS EST À FAIRE CE MOIS-CI',
  (() => { const n = saAGenerer(MODS.concat([{ id: 'm5', titre: 'Nouvelle', ordre: 50 }]), g, '2026-11', T0);
           return n.length === 1 && n[0].modeleId === 'm5' && n[0].id === saIdModele('2026-11', 'm5'); })());
t('une ligne déjà là sous l’ancien identifiant n’est pas doublée',
  saAGenerer(MODS, [{ id: 'autre', mois: '2026-11', modeleId: 'm1' }], '2026-11', T0)
    .filter(x => x.modeleId === 'm1').length === 0);
t('LE REPORT D’UNE PONCTUELLE NE SE REPOSE PAS DANS UN MOIS COMMENCÉ — effacé, il ne revient pas',
  !saAGenerer(MODS, [{ id: 'p9', mois: '2026-10', titre: 'Ponctuelle', etat: 'a_faire' },
                     { id: 'y', mois: '2026-11', modeleId: 'm1' }], '2026-11', T0)
    .some(x => x.titre === 'Ponctuelle'));
t('un mois invalide ne produit rien', saAGenerer(MODS, [], 'octobre', T0).length === 0);

// ── Le report, et c'est le cœur ─────────────────────────────────────────────
console.log('\nCe qui n’est pas fait ne disparaît pas');
const OCT = [
  { id: saIdModele('2026-10', 'm1'), mois: '2026-10', modeleId: 'm1', etat: 'a_faire' },
  { id: saIdModele('2026-10', 'm2'), mois: '2026-10', modeleId: 'm2', etat: 'fait' }
];
let gr = saAGenerer(MODS, OCT, '2026-11', T0);
const r1 = gr.find(x => x.modeleId === 'm1'), r2 = gr.find(x => x.modeleId === 'm2');
t('UNE TÂCHE NON FAITE EN OCTOBRE REVIENT MARQUÉE EN RETARD', r1.reportDe === '2026-10');
t('une tâche faite revient propre, sans retard', r2.reportDe === null);

console.log('\nLe retard dit depuis QUAND, pas seulement qu’il y en a');
const DEUX = [
  { id: saIdModele('2026-09', 'm1'), mois: '2026-09', modeleId: 'm1', etat: 'a_faire' },
  { id: saIdModele('2026-10', 'm1'), mois: '2026-10', modeleId: 'm1', etat: 'en_cours' }
];
t('DEUX MOIS OUBLIÉS REMONTENT AU PREMIER — « en retard depuis septembre »',
  saAGenerer(MODS, DEUX, '2026-11', T0).find(x => x.modeleId === 'm1').reportDe === '2026-09');
t('« en cours » n’est pas « fait » : le retard court toujours',
  saAGenerer(MODS, [{ id: 'a', mois: '2026-10', modeleId: 'm1', etat: 'en_cours' }],
             '2026-11', T0).find(x => x.modeleId === 'm1').reportDe === '2026-10');
t('un mois fait coupe la remontée',
  saAGenerer(MODS, [
    { id: 'a', mois: '2026-09', modeleId: 'm1', etat: 'a_faire' },
    { id: 'b', mois: '2026-10', modeleId: 'm1', etat: 'fait' }
  ], '2026-11', T0).find(x => x.modeleId === 'm1').reportDe === null);

console.log('\nUne tâche écrite à la main suit, elle aussi');
const PONCT = [{ id: 'p1', mois: '2026-10', titre: 'Rappeler le cabinet', groupe: '', etat: 'a_faire' }];
let gp = saAGenerer(MODS, PONCT, '2026-11', T0);
const port = gp.find(x => x.titre === 'Rappeler le cabinet');
t('UNE TÂCHE PONCTUELLE NON FAITE EST REPORTÉE', !!port);
t('... en disant d’où elle vient', port.reportDe === '2026-10');
t('... et son identifiant reste calculable', port.id === saIdReport('2026-11', 'p1'));
t('une tâche ponctuelle FAITE ne revient pas',
  !saAGenerer(MODS, [{ id: 'p2', mois: '2026-10', titre: 'Fini', etat: 'fait' }], '2026-11', T0)
    .some(x => x.titre === 'Fini'));
t('une sous-action ne se reporte pas toute seule — elle suit sa tâche',
  !saAGenerer(MODS, [{ id: 'p3', mois: '2026-10', parent: 'p1', titre: 'Sous', etat: 'a_faire' }],
              '2026-11', T0).some(x => x.titre === 'Sous'));

console.log('\nUn report de report ne fait pas enfler l’identifiant');
const rep1 = saAGenerer([], PONCT, '2026-11', T0)[0];
const rep2 = saAGenerer([], [rep1], '2026-12', T0)[0];
t('L’ORIGINE RESTE LA PREMIÈRE — sinon l’identifiant s’allonge chaque mois',
  rep2.id === saIdReport('2026-12', 'p1') && rep2.origine === 'p1');
t('... et il ne contient pas l’identifiant du mois précédent',
  rep2.id.indexOf('2026-11') < 0);

// ── L'ordre réglé à la main ─────────────────────────────────────────────────
console.log('\nL’ordre des récurrentes se règle');
const ORD = [
  { id: 'a', titre: 'A', groupe: 'Grossistes', ordre: 10 },
  { id: 'b', titre: 'B', groupe: 'Clients en compte', ordre: 20 },
  { id: 'c', titre: 'C', groupe: 'Grossistes', ordre: 30 },
  { id: 'd', titre: 'D', groupe: 'Grossistes', ordre: 30 },
  { id: 'sam:graine', graine: true, ordre: 0 }
];
const od = saOrdreDeplace(ORD, 'c', -1);
const rg = id => od.find(o => o.id === id).ordre;
t('MONTER UNE TÂCHE LA FAIT PASSER DEVANT LA PRÉCÉDENTE DE SA RUBRIQUE', rg('c') < rg('a'));
t('... sans sauter par-dessus une autre rubrique', rg('c') === 10 && rg('b') === 20 && rg('a') === 30);
t('TOUTE LA LISTE EST RENUMÉROTÉE, sans rang égal', new Set(od.map(o => o.ordre)).size === od.length && od.length === 4);
t('le repère de semis n’est pas rangé', !od.some(o => o.id === 'sam:graine'));
t('la première de sa rubrique ne monte pas', saOrdreDeplace(ORD, 'a', -1) === null);
t('la dernière de sa rubrique ne descend pas', saOrdreDeplace(ORD, 'b', 1) === null);
t('descendre est l’inverse de monter',
  (() => { const o = saOrdreDeplace(ORD, 'a', 1); const r = id => o.find(x => x.id === id).ordre; return r('a') > r('c'); })());
const MOD2 = [{ id: 'm1', ordre: 20 }, { id: 'm2', ordre: 10 }];
const LIG = [{ id: 'l1', mois: '2026-11', modeleId: 'm1', ordre: 10 }, { id: 'l2', mois: '2026-11', modeleId: 'm2', ordre: 20 },
             { id: 'l3', mois: '2026-11', ordre: 900, titre: 'Ponctuelle' }];
t('L’ORDRE DU MOIS SE LIT SUR LE MODÈLE — les lignes du mois ne sont pas réécrites',
  saDuMoisListe(LIG, '2026-11', MOD2).map(x => x.id).join(',') === 'l2,l1,l3');
t('sans modèle fourni, la ligne garde son propre rang',
  saDuMoisListe(LIG, '2026-11').map(x => x.id).join(',') === 'l1,l2,l3');

// ── Le classement ───────────────────────────────────────────────────────────
console.log('\nL’écran suit l’ordre du tableau papier');
const L = [
  { id: 1, mois: '2026-11', titre: 'B', groupe: 'Grossistes', ordre: 20 },
  { id: 2, mois: '2026-11', titre: 'A', groupe: '', ordre: 10 },
  { id: 3, mois: '2026-10', titre: 'C', groupe: '', ordre: 5 },
  { id: 4, mois: '2026-11', titre: 'D', groupe: 'Clients en compte', ordre: 30, parent: null },
  { id: 5, mois: '2026-11', titre: 'sous', parent: 1, ordre: 21 }
];
t('un mois ne montre que ses tâches', saDuMoisListe(L, '2026-11').length === 3);
t('... et pas les sous-actions, qui s’affichent sous leur tâche',
  !saDuMoisListe(L, '2026-11').some(x => x.parent));
t('les sous-actions se retrouvent par leur parent', saSousActions(L, 1).length === 1);
t('LES RUBRIQUES GARDENT L’ORDRE DU TABLEAU PAPIER, pas l’alphabet',
  saGroupes(saDuMoisListe(L, '2026-11')).join('|') === '|Grossistes|Clients en compte');
t('une rubrique inventée se range après les connues',
  saGroupes([{ groupe: 'Zèbre' }, { groupe: 'Grossistes' }]).join('|') === 'Grossistes|Zèbre');

console.log('\nL’avancement se lit d’un coup d’œil');
const AV = saAvancement([
  { etat: 'fait' }, { etat: 'fait' }, { etat: 'en_cours' },
  { etat: 'a_faire', reportDe: '2026-10' }
]);
t('il compte ce qui est fait', AV.fait === 2 && AV.total === 4 && AV.pct === 50);
t('IL COMPTE AUSSI LES RETARDS — c’est le chiffre qui doit gêner', AV.retard === 1);
t('une tâche en retard mais faite n’est plus en retard',
  saAvancement([{ etat: 'fait', reportDe: '2026-10' }]).retard === 0);
t('un mois vide ne divise pas par zéro', saAvancement([]).pct === 0);

// ── Les chiffres ────────────────────────────────────────────────────────────
console.log('\nLa saisie des chiffres accepte ce qu’on colle d’un tableur');
t('un nombre français se lit', saNombre('40 987,22') === 40987.22);
t('... avec l’espace fine insécable du copier-coller', saNombre('40 987,22') === 40987.22);
t('... et l’insécable ordinaire', saNombre('40 987,22') === 40987.22);
t('l’euro collé avec ne gêne pas', saNombre('1 234,50 €') === 1234.5);
t('le point décimal passe aussi', saNombre('40987.22') === 40987.22);
t('UN TEXTE N’EST PAS UN ZÉRO — il est refusé', saNombre('environ 400') === null);
t('une case vide n’est pas zéro non plus', saNombre('') === null && saNombre(null) === null);
t('un nombre s’affiche à la française', saEuro(40987.22) === '40 987,22 €');
t('... y compris les petits', saEuro(784.1) === '784,10 €');
t('... et la virgule, jamais le point', !/\d\.\d\d €/.test(saEuro(1234.56)));

console.log('\nCe qui se calcule ne se saisit pas');
const REL = { mois: '2026-10', v: {
  encoursSecu: 51762.10, encoursMut: 13674.94,
  vaTotal: 1567.92, va30: 575.26, vaMorts: 101.49,
  stockTotal: 641401.64, stockTva21: 140242.92
} };
t('L’ENCOURS TOTAL EST LA SOMME DE SES DEUX LIGNES, pas une troisième saisie',
  Math.abs(saValeur(REL, 'encoursTotal') - 65437.04) < 0.005);
t('il reste vide si ses deux lignes le sont',
  saValeur({ v: {} }, 'encoursTotal') === null);
t('une seule des deux suffit à donner un total',
  saValeur({ v: { encoursSecu: 100 } }, 'encoursTotal') === 100);
t('VA > 30 jours vaut 37 % du total — le chiffre de la feuille', saPct(REL, 'va30') === 37);
t('VA > 12 mois morts en vaut 6 %', saPct(REL, 'vaMorts') === 6);
t('le stock à 2,1 % en vaut 22 %', saPct(REL, 'stockTva21') === 22);
t('UN POURCENTAGE SANS TOTAL NE S’INVENTE PAS',
  saPct({ v: { va30: 100 } }, 'va30') === null);
t('... et on ne divise pas par zéro', saPct({ v: { va30: 10, vaTotal: 0 } }, 'va30') === null);
t('une ligne qui n’a pas de pourcentage n’en reçoit pas', saPct(REL, 'vaTotal') === null);
t('le relevé d’un mois se retrouve par son mois',
  saReleve([REL], '2026-10') === REL && saReleve([REL], '2026-09') === null);
t('les dix-huit lignes de la feuille sont là', SA_INDICS.length === 18);
t('... et une seule est calculée', SA_INDICS.filter(d => d.somme).length === 1);

console.log('\nLa date du relevé est au format de la maison');
t('elle s’affiche en français', saDateFr('2026-10-12') === '12/10/2026');
t('et revient en base au format qui se trie', saDateIso('12/10/2026') === '2026-10-12');
t('LE 31 FÉVRIER EST REFUSÉ — une Date l’aurait ramené au 3 mars en silence',
  saDateIso('31/02/2026') === null);
t('un format américain ne passe pas en douce', saDateIso('2026-10-12') === null);

// ── Ce que le module promet au reste de l'application ───────────────────────
console.log('\nLes collections sont déclarées partout (piège n°4)');
const ix = lire('public/index.html');
['saModeles', 'saTaches', 'saIndics'].forEach(function (c) {
  t(c + ' : la variable existe', new RegExp('let ' + c + ' = \\[\\];').test(ix));
  t(c + ' : _collRef sait la rendre', ix.indexOf("case '" + c + "':return " + c + ';') > 0);
  t(c + ' : loadAll la relit',
    ix.indexOf('if(Array.isArray(data.' + c + '))' + c + '=data.' + c + ';') > 0);
  t(c + ' : le serveur la fusionne par identifiant',
    new RegExp("'" + c + "'").test(lire('server.js')));
});
t('les trois sont dans SYNCED_COLLS', /'saModeles','saTaches','saIndics'\]/.test(ix));
t('saveAll les envoie — SANS ÇA ELLES NE QUITTENT JAMAIS LE NAVIGATEUR',
  /cmdPasser,saModeles,saTaches,saIndics,modulesParPoste/.test(ix));
t('la resynchronisation les relit, et redessine',
  /if\(d\.saTaches\)\{ saTaches=d\.saTaches; try\{ if\(window\.saRender\)saRender\(\); \}/.test(ix));
t('... DERRIÈRE UN FILET : une vue qui jetterait ne gèlerait pas les autres modules',
  /catch\(e\)\{ console\.error\('saRender',e\); \}/.test(ix));
t('le module est chargé par l’application', /<script src="sa-module\.js"><\/script>/.test(ix));
t('la rubrique porte un nom dans le fil d’Ariane', /suiviadmin:'Suivi administratif'/.test(ix));
t('et l’ouverture clôture le mois écoulé', /name==='suiviadmin'&&window\.saOuvrir/.test(ix));

console.log('\nCe que le module fait bien');
t('il lit les collections par _collRef, jamais par window (piège n°8)',
  /window\._collRef\('saTaches'\)/.test(src)
  && !/window\['sa(Taches|Modeles|Indics)'\]/.test(src));
t('il pose une pierre tombale AVANT de retirer une ligne (sinon elle revient)',
  src.indexOf("markDeleted('saTaches'") < src.indexOf('l.splice(k, 1)')
  && /markDeleted\('saModeles'/.test(src));
t('un changement d’état part tout de suite, sans attendre les 600 ms (piège n°6)',
  /typeof saveNow === 'function'\) saveNow\(\)/.test(src) && !/schedSave/.test(src));
t('AUCUNE MIGRATION N’EST ÉCRITE EN BASE (piège n°7) — on traduit à la lecture',
  /LECTURE AU LIEU DE MIGRATION/.test(src));

// LE PIÈGE N°9. La resynchronisation rappelle saRender toutes les huit
// secondes. Une sous-action qu'on est en train d'écrire se trouve DANS la
// partie redessinée : sans garde, elle disparaîtrait sous les doigts.
console.log('\nLa saisie en cours est protégée (piège n°9)');
t('un redessin automatique n’écrase pas une sous-action en cours d’écriture',
  /if \(!delibere && document\.getElementById\('sa-sous-saisie'\)\) return;/.test(src));
t('ni un relevé chiffré ouvert',
  /if \(!delibere && document\.getElementById\('sa-i-vaTotal'\)\) return;/.test(src));
t('UN REDESSIN DÉLIBÉRÉ PASSE LA GARDE — sinon le bouton serait mort',
  /saRender\(true\)/.test(src));
t('la ligne d’ajout est posée une seule fois, à l’injection',
  /sec\.innerHTML = SA_SECTION;/.test(src) && !/sa-t-titre/.test(src.slice(src.indexOf('function saVueMois'), src.indexOf('function saVueGrille'))));

console.log('\nLes chiffres restent aux administrateurs');
t('l’onglet ne s’affiche que pour eux',
  /saAdmin\(\) \? '<button class="sa-o'/.test(src));
t('ON NE PASSE PAS PAR L’ONGLET : la vue elle-même refuse',
  /if \(!saAdmin\(\)\) return '<div class="sa-vide">Les indicateurs sont réservés/.test(src));
t('... et l’enregistrement aussi, au cas où',
  /saIndicEnregistrer = function \(mois\) \{\n\s*if \(!saAdmin\(\)\) return;/.test(src));
t('la to-do list, elle, est ouverte à toute l’équipe',
  !/saBasculer = function \(id\) \{\n\s*if \(!saAdmin/.test(src));
t('un mois archivé ne se retouche que par un administrateur',
  /return mois === saMoisDe\(new Date\(\)\) \|\| saAdmin\(\);/.test(src));

console.log('\nLe modèle ne se sème pas tout seul');
t('les dix-neuf lignes du tableau papier sont là',
  /window\.saInstallerDepart = function/.test(src) && SA_DEPART_LONGUEUR() === 19);
// LA DERNIERE LIGNE VIOLETTE DE LA FEUILLE EST UN INTITULE DE RUBRIQUE, pas une
// tache : elle porte la couleur des bandeaux, pas celle des lignes. La prendre
// pour une tache aurait donne une case a cocher pour un titre de chapitre.
t('« Organisation de la transmission… » est une rubrique, pas une tâche',
  SA_GROUPES.indexOf('Organisation de la transmission mensuelle avec Olivier & Anouck') > 0
  && !/\['Relation Cabinet comptable', 'Organisation/.test(src));
t('... et le bouton manuel ne sert qu’à REPARTIR d’une liste vidée',
  /if \(saVraisModeles\(\)\.length\) \{ alert\('Le modèle contient déjà des tâches\.'\); return; \}/.test(src));
function SA_DEPART_LONGUEUR() {
  const b = src.slice(src.indexOf('const SA_DEPART = ['), src.indexOf('\n  ];', src.indexOf('const SA_DEPART = [')));
  return (b.match(/\n    \['/g) || []).length;
}


// ── Le rendu, exécuté pour de vrai ──────────────────────────────────────────
// CE QUI SE JOUE ICI. Les fonctions pures peuvent toutes être justes et l'écran
// rester blanc : il suffit d'une apostrophe mal échappée dans un gabarit. On
// exécute donc les quatre vues contre des données de poche, et on relit ce
// qu'elles rendent. Si l'une jette, l'essai tombe — et c'est le but : une vue
// qui jette dans la resynchronisation emporterait avec elle le rafraîchissement
// des modules suivants.
global_('const E = s =>', '}[c]));');
global_('const SA_DEPART = [', '\n  ];');

let FIX_T = [], FIX_M = [], FIX_I = [], FIX_S = [], FIX_ADMIN = true;
let saSousDe = null, saModeleOuvert = true, saMois = '2026-11', saAnnee = 2026;
const saTaches = () => FIX_T;
const saModeles = () => FIX_M;
const saIndics = () => FIX_I;
const saStaff = () => FIX_S;
const saAdmin = () => FIX_ADMIN;
eval(['saVraisModeles', 'saInitiales', 'saCouleur', 'saQuand', 'saPastille', 'saQui',
      'saLigne', 'saVueMois', 'saVueGrille', 'saVueIndic', 'saVueModele'].map(extraire).join('\n'));

console.log('\nLa to-do list s’affiche');
FIX_S = [{ id: 'JN', prenom: 'Jeanne', nom: 'Normand', col: '#2E7D54' }];
FIX_M = MODS;
FIX_T = [
  { id: 'a', mois: '2026-11', modeleId: 'm1', titre: 'Relance des impayés',
    groupe: 'Clients en compte', ordre: 10, etat: 'fait', par: 'JN', le: Date.UTC(2026, 10, 3) },
  { id: 'b', mois: '2026-11', modeleId: 'm2', titre: 'Tableau des remises CERP',
    groupe: 'Grossistes', ordre: 20, etat: 'a_faire', reportDe: '2026-09' },
  { id: 'c', mois: '2026-11', titre: 'Rappeler « Les Tilleuls »', groupe: '', ordre: 900, etat: 'en_cours' },
  { id: 'd', mois: '2026-11', parent: 'c', titre: 'Laisser un message', ordre: 901, etat: 'a_faire' }
];
let vue = saVueMois();
t('les trois tâches du mois sont là',
  /Relance des impayés/.test(vue) && /remises CERP/.test(vue) && /Rappeler/.test(vue));
t('la sous-action s’affiche sous la sienne',
  vue.indexOf('Laisser un message') > vue.indexOf('Rappeler'));
t('LES INITIALES DE QUI A COCHÉ APPARAISSENT', /class="sa-qui"[^>]*>JN</.test(vue));
t('... avec sa couleur de fiche', /background:#2E7D54/.test(vue));
t('LE RETARD DIT DEPUIS QUAND', /en retard depuis septembre/.test(vue));
t('... et pas sur une tâche faite', (vue.match(/sa-retard/g) || []).length === 1);
t('l’avancement est affiché', /1 \/ 3 fait/.test(vue) && /1 en retard/.test(vue));
t('les rubriques structurent la liste', /class="sa-g">Grossistes</.test(vue));
// UN GESTIONNAIRE NE REÇOIT JAMAIS DE TEXTE SAISI (règle de la maison) : ce qui
// traverse le HTML est un identifiant, et le titre n'est qu'affiché, échappé.
t('les guillemets d’un titre ne sortent pas de l’attribut',
  /Rappeler &laquo;|Rappeler « Les Tilleuls »/.test(vue) || /&quot;/.test(vue) || vue.indexOf('Les Tilleuls') > 0);
t('les gestionnaires ne transportent que des identifiants',
  !/onclick="sa[A-Za-z]+\('[^']*Tilleuls/.test(vue));

console.log('\nLa saisie d’une sous-action n’est posée que là où on l’a demandée');
t('aucune par défaut', !/id="sa-s-titre"/.test(saVueMois()));
saSousDe = 'c';
t('... et une seule quand on clique', (saVueMois().match(/id="sa-s-titre"/g) || []).length === 1);
saSousDe = null;

console.log('\nUn mois vide dit quoi faire');
FIX_T = [];
t('le mois non encore généré le dit, au lieu de rester blanc',
  /Aucune tâche pour novembre 2026/.test(saVueMois()));
FIX_M = [];
t('... et le dit aussi quand le modèle est vide', /modèle des tâches récurrentes est vide/.test(saVueMois()));
FIX_M = MODS;

console.log('\nLa grille annuelle reprend le tableau papier');
FIX_T = [
  { id: 'a', mois: '2026-03', modeleId: 'm3', titre: 'Classement récaps CERP', etat: 'fait', par: 'JN' },
  { id: 'b', mois: '2026-05', modeleId: 'm1', titre: 'Relance des impayés', etat: 'en_cours' }
];
const gr2 = saVueGrille();
t('douze colonnes, une par mois', (gr2.match(/<th>/g) || []).length === 12);
t('une tâche faite porte une croix', /class="sa-ok"/.test(gr2));
t('une tâche en cours porte un demi-rond', /class="sa-mi"/.test(gr2));
// Onze cases pour la trimestrielle de mars, douze pour la tache suspendue :
// une tache qui n'est plus due garde son historique, mais sa ligne dit qu'on
// ne l'attend plus. Une case vide aurait voulu dire « oubliee ».
t('LES MOIS OÙ LA TÂCHE N’EST PAS DUE SONT HACHURÉS, pas vides',
  (gr2.match(/sa-c-na/g) || []).length === 23);

console.log('\nLe tableau d’indicateurs');
FIX_I = [{ id: 'sai:2026-10', mois: '2026-10', releve: '2026-10-12', v: {
  encoursSecu: 51762.10, encoursMut: 13674.94, vaTotal: 1567.92, va30: 575.26,
  stockTotal: 641401.64, stockTva21: 140242.92 } }];
const ind = saVueIndic();
t('les dix-huit lignes y sont', (ind.match(/class="sa-ir /g) || ind.match(/sa-ir sa-ir-/g) || []).length === 18);
t('LE TOTAL CALCULÉ S’AFFICHE SANS AVOIR ÉTÉ SAISI', /65 437,04 €/.test(ind));
t('le pourcentage aussi', /37%/.test(ind) && /22%/.test(ind));
t('la date du relevé est en français', /12\/10\/2026/.test(ind));
t('un mois sans relevé montre un tiret, pas un zéro', /sa-iv-0/.test(ind));
t('UN NON-ADMINISTRATEUR NE VOIT AUCUN CHIFFRE',
  (function () { FIX_ADMIN = false; const h = saVueIndic(); FIX_ADMIN = true;
    return /réservés aux administrateurs/.test(h) && !/641/.test(h); })());

console.log('\nLe panneau des tâches récurrentes');
const mo = saVueModele();
t('chaque tâche montre sa périodicité', /Tous les mois/.test(mo) && /Une fois par an/.test(mo));
t('les douze mois se cochent un par un', (mo.match(/class="sa-mm/g) || []).length >= 48);
t('une tâche suspendue se voit', /sa-mr-off/.test(mo));
t('IL EST INVISIBLE POUR QUI N’EST PAS ADMINISTRATEUR',
  (function () { FIX_ADMIN = false; const h = saVueModele(); FIX_ADMIN = true; return h === ''; })());


// ── saRender, exécutée pour de vrai ─────────────────────────────────────────
// CE QUI SE JOUE ICI, ET POURQUOI CE BLOC EXISTE. Le 23/10/2026, le module est
// parti en production avec une variable renommée à moitié : les quatre vues
// étaient justes, leurs essais verts, et l'écran restait vide. `saRender`
// jetait un ReferenceError à sa troisième ligne, avant d'avoir rien rempli.
//
// Un essai qui n'exécute que les morceaux ne voit pas tomber l'assemblage.
// On lui donne donc un document de poche, et on la lance.
console.log('\nL’écran s’assemble, pas seulement ses morceaux');
const ELS = {};
globalThis.window = globalThis.window || {};
globalThis.document = {
  getElementById: function (id) {
    if (!ELS[id]) ELS[id] = { id: id, innerHTML: '', style: {} };
    return ELS[id];
  }
};
let saVue = 'todo', saVueAnnee = false;
eval(extraire('saModifiable'));
eval(bloc('window.saRender = function (delibere) {', '\n  };'));

FIX_T = []; FIX_M = MODS; FIX_ADMIN = true;
saMois = null; saAnnee = null;
let jet = null;
try { window.saRender(true); } catch (e) { jet = e.message; }
t('ELLE NE JETTE PAS — c’est tout le défaut du 23/10', jet === null);
t('les onglets sont posés', /To-do list/.test(ELS['sa-onglets'].innerHTML));
t('la navigation du mois aussi', /sa-nb/.test(ELS['sa-nav'].innerHTML));
t('et le corps est rempli', ELS['sa-corps'].innerHTML.length > 20);
t('le mois affiché par défaut est le mois en cours',
  ELS['sa-nav'].innerHTML.indexOf(saMoisLbl(saMoisDe(new Date()))) > 0);
t('la ligne d’ajout est offerte sur le mois en cours', ELS['sa-saisie'].style.display === '');

FIX_ADMIN = false; saVue = 'indic';
jet = null; try { window.saRender(true); } catch (e) { jet = e.message; }
t('elle ne jette pas non plus pour un non-administrateur', jet === null);
t('L’ONGLET DES CHIFFRES N’EST MÊME PAS PROPOSÉ', !/Indicateurs/.test(ELS['sa-onglets'].innerHTML));
t('... et la vue retombe sur la to-do list', saVue === 'todo');
FIX_ADMIN = true;

// ── Tout gestionnaire cité doit exister ─────────────────────────────────────
// La racine du défaut : `onclick="saOnglet('todo')"` désignait une fonction qui
// n'a jamais été exposée. Le navigateur ne le dit qu'au clic, et seulement dans
// la console. On confronte donc les deux listes à la source.
console.log('\nAucun bouton ne désigne une fonction qui n’existe pas');
const EXPOSEES = new Set((src.match(/window\.(sa[A-Za-z]+)\s*=\s*function/g) || [])
  .map(m => /window\.(sa[A-Za-z]+)/.exec(m)[1]));
const CITEES = new Set((src.match(/onclick="(sa[A-Za-z]+)\(/g) || [])
  .map(m => /onclick="(sa[A-Za-z]+)\(/.exec(m)[1]));
const orphelines = [...CITEES].filter(f => !EXPOSEES.has(f));
t('les ' + CITEES.size + ' gestionnaires cités sont tous exposés sur window'
  + (orphelines.length ? ' — ORPHELINES : ' + orphelines.join(', ') : ''),
  orphelines.length === 0);
t('... et il y en a bien, sinon l’essai ne vérifierait rien', CITEES.size >= 8);


// ── Le semis ────────────────────────────────────────────────────────────────
// CE QUI SE JOUE. Poser les tâches du tableau papier à la première ouverture
// est commode. Les reposer à chaque ouverture serait une catastrophe
// tranquille : une tâche supprimée exprès reviendrait le lendemain, et au
// troisième retour plus personne ne croirait la liste.
console.log('\nLe semis a lieu une fois, et une seule');
global_('const SA_REPERE =', "'sam:graine';");
const saJournal = () => {};
eval(extraire('saSemer'));

FIX_M = [];
t('à la première ouverture, les dix-neuf tâches sont posées', saSemer(T0) === 19);
t('... et le repère de semis avec elles', FIX_M.some(m => m.id === SA_REPERE));
t('... qui ne compte pas pour une tâche', saVraisModeles().length === 19);
t('les rubriques de la feuille sont respectées',
  saVraisModeles().filter(m => m.groupe === 'Grossistes').length === 3
  && saVraisModeles().filter(m => m.groupe === 'Clients en compte').length === 5
  && saVraisModeles().filter(m => m.groupe === 'Trades et mises en avant').length === 6
  && saVraisModeles().filter(m => m.groupe === 'Relation Cabinet comptable').length === 3
  && saVraisModeles().filter(m => !m.groupe).length === 2);
t('elles partent toutes mensuelles, à régler ensuite ligne par ligne',
  saVraisModeles().every(m => saMoisDuModele(m).length === 12));

t('À LA DEUXIÈME OUVERTURE, RIEN N’EST REPOSÉ', saSemer(T0 + 60000) === 0);
t('... et rien n’a bougé', saVraisModeles().length === 19);

console.log('\nCe qu’on supprime exprès ne revient pas');
FIX_M = FIX_M.filter(m => m.graine);          // on efface les dix-neuf, on garde le repère
t('LE LENDEMAIN, LA LISTE EST TOUJOURS VIDE — c’est tout l’intérêt du repère',
  saSemer(T0 + 86400000) === 0 && saVraisModeles().length === 0);

console.log('\nUne liste écrite à la main n’est pas écrasée');
FIX_M = [{ id: 'mien', titre: 'Ma propre tâche', ordre: 10, actif: true }];
t('le semis se contente de poser son repère', saSemer(T0) === 0);
t('... et la tâche écrite à la main reste seule',
  saVraisModeles().length === 1 && saVraisModeles()[0].titre === 'Ma propre tâche');

console.log('\nLe repère n’est jamais pris pour une tâche');
t('IL NE GÉNÈRE AUCUNE LIGNE DE MOIS — il n’a pas de titre à afficher',
  saAGenerer([{ id: SA_REPERE, graine: true, titre: '', actif: false }], [], '2026-11', T0).length === 0);
t('... même si quelqu’un le réactivait par mégarde',
  saAGenerer([{ id: SA_REPERE, graine: true, titre: '', actif: true }], [], '2026-11', T0).length === 0);
FIX_M = [{ id: SA_REPERE, graine: true, actif: false },
         { id: 'm1', titre: 'Relance des impayés', groupe: '', ordre: 10, actif: true }];
t('il ne s’affiche pas dans le panneau des tâches récurrentes',
  (saVueModele().match(/class="sa-mr /g) || saVueModele().match(/class="sa-mr"/g) || []).length === 1);

console.log('\nL’ouverture sème avant de clôturer');
t('L’ORDRE COMPTE : sans lui, le premier mois serait vide jusqu’au 1er suivant',
  src.indexOf('if (saSemer(Date.now()))') < src.indexOf('saCloturer();', src.indexOf('window.saOuvrir')));
t('et une erreur de semis ne fait pas tomber l’ouverture',
  /catch \(e\) \{ console\.error\('saOuvrir', e\); \}/.test(src));

console.log('\n' + ok + ' vérifications, ' + ko + ' échec(s)\n');
process.exit(ko ? 1 : 0);
