// Le moteur d'etiquettes des preparations (ZD230). Ce qui se joue ici : un
// numero de lot qui ne se repete pas dans la journee, une date limite qui
// tombe sur un jour qui existe, et une fonction d'ajustement qui doit survivre
// a sa recopie dans la fenetre d'impression. Les fonctions sont extraites de
// public/et-module.js lui-meme.
// node essais/etiquettes.js
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'et-module.js'), 'utf8');
function bloc(nom) {
  const d = src.indexOf('\n  function ' + nom + '(');
  if (d < 0) throw new Error('introuvable : ' + nom);
  const une = src.slice(d + 1).split('\n')[0];
  if (/^\s*function [^(]+\([^)]*\)\s*\{.*\}$/.test(une)) return une;
  const f = src.indexOf('\n  }\n', d);
  if (f < 0) throw new Error('fin introuvable : ' + nom);
  return src.slice(d + 1, f + 4);
}
const pad = n => String(n).padStart(2, '0');
eval(bloc('etIso'));
eval(bloc('etFr'));
eval(bloc('etPlusMois'));
eval(bloc('etLotPropose'));
eval(bloc('etAjuster'));

let ok = 0, ko = 0;
const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };
console.log('\nÉTIQUETTES DE PRÉPARATION — le moteur\n');

// ── La date limite d'utilisation ────────────────────────────────────────────
console.log('« À utiliser avant le »');
t('trois mois plus tard', etPlusMois('2026-09-19', 3) === '2026-12-19');
t('un mois plus tard', etPlusMois('2026-01-15', 1) === '2026-02-15');
t('douze mois, c’est l’année suivante', etPlusMois('2026-09-19', 12) === '2027-09-19');
// LE PIEGE : le 31 fevrier n'existe pas, et le navigateur le fait glisser au
// 3 mars — une DLU plus longue que celle qu'on a demandee.
t('le 31 janvier + 1 mois tombe au 28 février, pas au 3 mars',
  etPlusMois('2026-01-31', 1) === '2026-02-28');
t('le 31 mars + 1 mois tombe au 30 avril', etPlusMois('2026-03-31', 1) === '2026-04-30');
t('une année bissextile est respectée', etPlusMois('2024-01-31', 1) === '2024-02-29');
t('le 30 novembre + 3 mois', etPlusMois('2026-11-30', 3) === '2027-02-28');

console.log('\nL’affichage des dates');
t('une date ISO se lit à la française', etFr('2026-12-19') === '19/12/2026');
t('une date vide ne dit rien', etFr('') === '' && etFr(null) === '');

// ── Le numéro de lot ────────────────────────────────────────────────────────
// Deux preparations du meme jour ne doivent jamais porter le meme lot : c'est
// par lui qu'on retrouve laquelle est dans le flacon.
console.log('\nLe numéro de lot');
t('le premier lot du jour', etLotPropose([], '2026-09-19') === '20260919-1');
const L = [{ etiq: { lot: '20260919-1' } }, { etiq: { lot: '20260919-2' } }];
t('le suivant incrémente', etLotPropose(L, '2026-09-19') === '20260919-3');
t('un trou ne fait pas reculer le compteur',
  etLotPropose([{ etiq: { lot: '20260919-7' } }], '2026-09-19') === '20260919-8');
t('les lots d’un autre jour ne comptent pas',
  etLotPropose([{ etiq: { lot: '20260918-9' } }], '2026-09-19') === '20260919-1');
t('un lot saisi à la main ne casse rien',
  etLotPropose([{ etiq: { lot: 'PREP-ABC' } }], '2026-09-19') === '20260919-1');
t('une préparation sans étiquette est ignorée',
  etLotPropose([{ id: 1 }, null, { etiq: {} }], '2026-09-19') === '20260919-1');
t('le jour du lot est bien celui de la date passée',
  etLotPropose([], '2027-01-05').indexOf('20270105-') === 0);

// ── L'ajustement de la police ───────────────────────────────────────────────
// Cette fonction est RECOPIEE telle quelle dans la fenetre d'impression, par
// toString(). Toute constante du module qu'elle citerait y serait introuvable :
// c'est arrive, l'ajustement se plantait en silence et l'etiquette sortait
// coupee. Le garde-fou verifie la source, pas seulement le comportement.
console.log('\nL’ajustement, qui doit survivre à sa recopie');
const srcAj = etAjuster.toString();
t('elle ne cite aucune constante du module', !/ET_[A-Z]+/.test(srcAj));
t('elle n’utilise ni const ni let — elle sera recopiée telle quelle',
  !/\b(const|let)\b/.test(srcAj));
t('le minimum est un paramètre, avec sa valeur par défaut',
  /function etAjuster\(boite, min\)/.test(srcAj) && /min \|\| 4/.test(srcAj));
// forEach passe (element, index) : sans enveloppe, la 2e etiquette recevrait
// 1 comme minimum et tomberait a 1 pt.
t('l’appel d’impression enveloppe l’appel, pour que l’indice ne devienne pas le minimum',
  /forEach\(function\(e\)\{etAjuster\(e\);\}\)/.test(src));

// Un faux element : on verifie la boucle de reduction, pas le navigateur.
function faux(hauteurA) {
  return {
    dataset: { police: '9' }, style: {},
    clientHeight: 100,
    get scrollHeight() { return hauteurA(parseFloat(this.style.fontSize) || 9); }
  };
}
let r = etAjuster(faux(() => 50));
t('un texte qui tient garde la taille du format', r.police === 9 && !r.deborde);
r = etAjuster(faux(pt => pt > 6 ? 200 : 50));
t('un texte trop long fait baisser la police', r.police === 6 && !r.deborde);
r = etAjuster(faux(() => 500));
t('un texte impossible s’arrête à 4 pt et le dit', r.police === 4 && r.deborde === true);
r = etAjuster(faux(pt => pt > 4.5 ? 200 : 50));
t('la réduction se fait par demi-point', r.police === 4.5);
t('rien du tout ne casse rien', etAjuster(null) === null);

// ── Ce que la page d'impression doit porter ─────────────────────────────────
console.log('\nLa page d’impression');
t('la taille de page est celle de l’étiquette, sans marge',
  /@page\{size:' \+ f\.w \+ 'mm ' \+ f\.h \+ 'mm;margin:0\}/.test(src));
t('chaque étiquette est une page', /page-break-after:always/.test(src));
t('la dernière n’en ajoute pas une vide', /\.et:last-child\{page-break-after:auto/.test(src));
t('l’impression est différée, le temps que la police soit ajustée',
  /setTimeout\(function\(\)\{window\.print\(\);\},250\)/.test(src));
t('une composition vide est refusée — une étiquette sans composition ne dit rien',
  /La composition est vide/.test(src));
t('ce qui a été imprimé reste sur la fiche',
  /etPrep\.etiq = Object\.assign/.test(src) && /imprimeLe: Date\.now\(\)/.test(src));
t('les mentions réglementaires sont toutes au gabarit',
  ['Lot ', 'Ordo n° ', 'À utiliser avant le ', 'Posologie'].every(m => src.indexOf(m) > 0));
t('le nom et l’adresse de la pharmacie sont en tête', /etOfficine\(\)/.test(src));
t('la largeur maximale de la ZD230 est vérifiée à la création d’un format',
  /w > 104/.test(src));

// ── L'ÉTIQUETTE LIBRE ───────────────────────────────────────────────────────
// Un flacon d'alcool, un pot de vaseline : juste un texte, et trois options.
console.log('\nL’étiquette libre');
const ix = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const svr = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

// LE PIÈGE #4 : une collection oubliée dans l'un des six endroits ne lève
// aucune erreur — elle cesse simplement de voyager entre les postes.
const SIX = [
  ['déclarée avec let', /let etiqLibres\s*=\s*\[\]/.test(ix)],
  ['dans SYNCED_COLLS', /SYNCED_COLLS=\[[^\]]*'etiqLibres'/.test(ix)],
  ['dans le résolveur _collRef', /case 'etiqLibres':\s*return etiqLibres/.test(ix)],
  ['dans le corps de saveAll', /JSON\.stringify\(\{staffDB[\s\S]{0,2000}etiqLibres/.test(ix)],
  ['relue par loadAll', /data\.etiqLibres/.test(ix)],
  ['relue par la resynchro de 8 s', /d\.etiqLibres/.test(ix)],
  ['connue du serveur', /'etiqLibres'/.test(svr)]
];
SIX.forEach(function (x) { t('la collection est ' + x[0], x[1]); });

// LE DÉFAUT QUE CE MODULE POUVAIT INTRODUIRE : deux contenants différents, le
// même jour, avec le même numéro de lot.
console.log('\nLe numéro de lot ne se répète pas, même entre les deux usages');
const preps = [{ etiq: { lot: '20261004-1' } }];
const libres = [{ lot: '20261004-2' }];
t('sans étiquette libre, le rang suit les préparations',
  etLotPropose(preps, '2026-10-04', []) === '20261004-2');
t('UNE ÉTIQUETTE LIBRE COMPTE AUSSI : le rang passe au suivant',
  etLotPropose(preps, '2026-10-04', libres) === '20261004-3');
t('... et une étiquette libre seule suffit à faire avancer le rang',
  etLotPropose([], '2026-10-04', libres) === '20261004-3');
t('un lot d’un autre jour ne compte pas',
  etLotPropose([], '2026-10-05', libres) === '20261005-1');
t('la troisième source est facultative — l’appel à deux arguments tient',
  etLotPropose(preps, '2026-10-04') === '20261004-2');
t('une entrée sans lot ne fait pas tomber le calcul',
  etLotPropose([{}, { etiq: {} }], '2026-10-04', [{}, { lot: null }]) === '20261004-1');

console.log('\nCe que la fenêtre promet');
t('le texte est le seul champ obligatoire', /Le texte est vide/.test(src));
t('les trois options sont bien trois cases à cocher',
  /etl-c-lot/.test(src) && /etl-c-ordo/.test(src) && /etl-c-dlu/.test(src));
t('cocher « numéro de lot » propose le numéro du jour',
  /if \(i && !i\.value\) i\.value = etLotPropose\(etPreps\(\), etIso\(new Date\(\)\), etLibres\(\)\)/.test(src));
t('cocher « péremption » propose un mois',
  /i\.value = etPlusMois\(etIso\(new Date\(\)\), 1\)/.test(src));
// LE PIEGE : +1 puis +2 ne doit pas faire trois mois. La version des
// preparations compte depuis la date affichee ; celle-ci compte depuis
// aujourd'hui, et c'est volontaire.
t('+1 et +2 mois comptent depuis aujourd’hui, pas depuis la date affichée',
  /window\.etlDlu = function \(n\) \{[\s\S]{0,200}etPlusMois\(etIso\(new Date\(\)\), n\)/.test(src));
t('... alors que l’étiquette de préparation, elle, cumule — deux fonctions distinctes',
  /window\.etDlu = function \(n\) \{[\s\S]{0,200}etPlusMois\(d\.value \|\| etIso\(new Date\(\)\), n\)/.test(src));
t('une option décochée n’imprime rien, même si le champ est resté rempli',
  /lot: on\('lot'\) \? v\('etl-lot'\) : ''/.test(src));
t('l’étiquette libre ne porte AUCUN nom de patient',
  /function etlCorps/.test(src)
  && !/et-qui/.test(src.slice(src.indexOf('function etlCorps'), src.indexOf('window.etlOuvrir'))));
t('le nom de la pharmacie y est, lui', /function etlCorps[\s\S]{0,600}etOfficine\(\)/.test(src));
t('une seule fenêtre d’impression pour les deux usages',
  (src.match(/function etLancerImpression/g) || []).length === 1
  && (src.match(/if \(!etLancerImpression\(f,/g) || []).length === 2);
t('... et elle recopie l’ajustement, sans quoi l’étiquette sortirait coupée',
  /function etLancerImpression[\s\S]{0,900}etAjuster\.toString\(\)/.test(src));
t('ce qui a été imprimé est gardé, avec qui et quand',
  /le: Date\.now\(\)/.test(src) && /par: \(etUser\(\) \|\| \{\}\)\.id/.test(src));
t('réimprimer rouvre la fenêtre déjà remplie — donc le même lot',
  /window\.etlReprendre = function \(i\) \{[\s\S]{0,120}etlOuvrir\(x\)/.test(src));
t('la liste des dernières se borne — c’est un aide-mémoire, pas un registre',
  /ETL_VUES = 8/.test(src));
t('le bouton existe dans la section Préparations',
  /onclick="etlOuvrir\(\)"/.test(ix) && /id="etl-liste"/.test(ix));
t('la resynchro redessine la liste si un autre poste imprime',
  /if\(window\.etlRendre\)etlRendre\(\)/.test(ix));

console.log('\n' + (ok + ko) + ' vérifications, ' + ko + ' échec(s)\n');
process.exit(ko ? 1 : 0);
