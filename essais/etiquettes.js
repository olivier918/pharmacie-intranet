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

console.log('\n' + (ok + ko) + ' vérifications, ' + ko + ' échec(s)\n');
process.exit(ko ? 1 : 0);
