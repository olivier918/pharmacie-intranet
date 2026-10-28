// LE COMPTE-TEMPS — un compteur qui ne sait que monter ment.
// node essais/compte-temps.js
//
// CE QUI SE JOUE. Olivier, le 28/10/2026 : « si je passe ensuite une plage
// horaire travaillée en repos, elle n'est pas décomptée du compte temps ».
// C'était exact, et le défaut était de construction : seuls les créneaux posés
// SUR UN REPOS étaient reconnus. Retirer des heures, ou raccourcir un créneau,
// ne produisait rien du tout.
//
// Un compteur d'heures qui ne descend jamais finit par créditer des heures que
// personne n'a faites — et c'est de la paie. Trois règles en découlent, et les
// trois sont éprouvées ici :
//
//   1. UNE EXCEPTION N'EST PAS UN AJOUT, C'EST UN ÉCART : ce qui est posé moins
//      ce que la trame prévoyait. Un créneau raccourci de deux heures vaut −2.
//   2. LA SEMAINE EST L'UNITÉ DE COMPTE. Un retrait mange d'abord les heures
//      supplémentaires de la MÊME semaine, puis le compte-temps de cette
//      semaine, et ce qui reste fait plonger le compte sous zéro.
//   3. UN COMPTEUR QUI PEUT DESCENDRE DOIT SAVOIR S'ÉCRIRE EN NÉGATIF.
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'pl-module.js'), 'utf8');

function extraire(nom) {
  const d = src.indexOf('  function ' + nom + '(');
  if (d < 0) throw new Error('fonction introuvable : ' + nom);
  const finLigne = src.indexOf('\n', d);
  const ligne = src.slice(d, finLigne);
  if (ligne.trimEnd().endsWith('}')) return ligne;
  const f = src.indexOf('\n  }\n', d);
  if (f < 0) throw new Error('fin introuvable : ' + nom);
  return src.slice(d, f + 4);
}

let ok = 0, ko = 0;
const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };
console.log('\nLE COMPTE-TEMPS\n');

// ── L'écriture d'un compteur qui descend ────────────────────────────────────
// Math.floor(-2.5) vaut -3, et le reste 0.5 : l'ancienne version ecrivait
// « -3h30 » pour deux heures et demie en moins. Tant que rien ne descendait
// jamais, personne ne pouvait s'en apercevoir.
console.log('Un compteur qui peut descendre doit savoir s’écrire');
eval(extraire('plFmtH'));
t('une durée pleine', plFmtH(7) === '7 h');
t('une durée avec des minutes', plFmtH(3.5) === '3h30');
t('rien du tout', plFmtH(null) === '—' && plFmtH(0) === '0 h');
t('MOINS DEUX HEURES ET DEMIE S’ÉCRIT −2h30, pas −3h30',
  plFmtH(-2.5) === '−2h30');
t('... et moins sept heures, −7 h', plFmtH(-7) === '−7 h');
t('un arrondi à la minute pleine ne fabrique pas 60 minutes',
  plFmtH(2.999722) === '3 h' && plFmtH(-2.999722) === '−3 h');

// ── L'écart ─────────────────────────────────────────────────────────────────
console.log('\nUne exception n’est pas un ajout, c’est un écart');
let TRAME = {};
globalThis.L = () => [];
globalThis.plSlotsTrame = (c, d) => TRAME[c.id] || [null, null];
eval(['plDurOf', 'plIso', 'plMonday'].map(extraire).join('\n'));
eval(extraire('plEcartEx'));
const C = { id: 'c1', nom: 'Essai' };
const ex = (h, demi) => ({ contratId: 'c1', type: 'horaire', date: '2026-11-23', demi: demi || 'M', horaire: h });

TRAME = { c1: [null, null] };
t('UN CRÉNEAU POSÉ SUR UN REPOS COMPTE EN PLUS', plEcartEx(ex('9h-12h30'), C) === 3.5);
TRAME = { c1: ['9h-12h30', null] };
t('LE MÊME JOUR PASSÉ EN REPOS COMPTE EN MOINS — c’est tout le défaut signalé',
  plEcartEx(ex(null), C) === -3.5);
t('... et un horaire vide vaut repos', plEcartEx(ex(''), C) === -3.5);
TRAME = { c1: ['9h-12h30', null] };
t('UN CRÉNEAU RACCOURCI COMPTE LA DIFFÉRENCE, pas sa durée entière',
  plEcartEx(ex('9h-11h30'), C) === -1);
t('... et un créneau rallongé aussi', plEcartEx(ex('9h-14h30'), C) === 2);
t('un créneau identique à la trame ne compte rien', plEcartEx(ex('9h-12h30'), C) === 0);
TRAME = { c1: [null, '14h-19h30'] };
t('l’après-midi se lit sur la bonne moitié de la journée',
  plEcartEx(ex(null, 'AM'), C) === -5.5 && plEcartEx(ex(null, 'M'), C) === 0);
t('une exception qui n’est pas un horaire ne compte rien',
  plEcartEx({ contratId: 'c1', type: 'pos', date: '2026-11-23', demi: 'M' }, C) === 0);
t('une ligne sans date ne fait pas tomber la lecture', plEcartEx({ type: 'horaire' }, C) === 0);

// ── La semaine ──────────────────────────────────────────────────────────────
console.log('\nLa semaine est l’unité de compte');
eval(['plEcartsParSemaine', 'plNetSemaine'].map(extraire).join('\n'));
const net = (hs, compte, moins) => plNetSemaine({ hs: hs, compte: compte, moins: moins });
t('sans retrait, rien ne bouge', net(3, 2, 0).hs === 3 && net(3, 2, 0).compte === 2);
t('UN RETRAIT MANGE D’ABORD LES HEURES SUPPLÉMENTAIRES DE LA SEMAINE',
  net(3, 2, 2).hs === 1 && net(3, 2, 2).compte === 2);
t('... exactement, sans entamer le compte-temps', net(3, 2, 3).hs === 0 && net(3, 2, 3).compte === 2);
t('puis le compte-temps de cette même semaine',
  net(3, 2, 4).hs === 0 && net(3, 2, 4).compte === 1);
t('ET CE QUI RESTE FAIT PLONGER LE COMPTE SOUS ZÉRO',
  net(3, 2, 8).hs === 0 && net(3, 2, 8).compte === -3);
t('un retrait sec, sans rien pour l’absorber, passe directement en négatif',
  net(0, 0, 3.5).compte === -3.5);
t('les heures supplémentaires ne deviennent jamais négatives, elles',
  net(1, 0, 5).hs === 0 && net(1, 0, 5).compte === -4);
t('une semaine vide ne fait rien', net(0, 0, 0).compte === 0 && plNetSemaine(null).compte === 0);

console.log('\nChaque semaine se solde pour elle-même');
TRAME = { c1: ['9h-12h30', '14h-19h30'] };
const EXS = [
  // semaine du 23/11 : trois heures en plus (heures sup), puis la journee de
  // jeudi retiree — le retrait doit manger les heures sup, pas le mois d'apres.
  { contratId: 'c1', type: 'horaire', date: '2026-11-24', demi: 'M', horaire: '9h-15h30', imputation: 'hs' },
  { contratId: 'c1', type: 'horaire', date: '2026-11-26', demi: 'M', horaire: null },
  // semaine du 30/11 : un retrait sec
  { contratId: 'c1', type: 'horaire', date: '2026-12-01', demi: 'AM', horaire: null }
];
const sem = plEcartsParSemaine(C, EXS);
t('les écarts se rangent par semaine', Object.keys(sem).sort().join() === '2026-11-23,2026-11-30');
t('la première semaine porte ses deux mouvements',
  sem['2026-11-23'].hs === 3 && sem['2026-11-23'].moins === 3.5);
t('UN RETRAIT NE TRAVERSE PAS LES SEMAINES', sem['2026-11-30'].moins === 5.5);
t('la première semaine finit à −0h30 sur le compte, heures sup épuisées',
  plNetSemaine(sem['2026-11-23']).hs === 0
  && Math.abs(plNetSemaine(sem['2026-11-23']).compte + 0.5) < 1e-9);
t('la seconde plonge de 5h30', plNetSemaine(sem['2026-11-30']).compte === -5.5);
t('une exception d’un autre contrat n’entre pas dans le compte',
  Object.keys(plEcartsParSemaine(C, [{ contratId: 'autre', type: 'horaire', date: '2026-11-24', demi: 'M', horaire: null }])).length === 0);
t('sans imputation choisie, les heures en plus vont aux heures supplémentaires',
  plEcartsParSemaine(C, [{ contratId: 'c1', type: 'horaire', date: '2026-11-24', demi: 'M', horaire: '9h-15h30' }])['2026-11-23'].hs === 3);

// ── Ce que le module promet ─────────────────────────────────────────────────
console.log('\nCe que le module promet');
t('LE SOLDE LIT LES ÉCARTS, plus seulement les ajouts',
  /const sem = plEcartsParSemaine\(c, L\('exceptions'\)\);/.test(src)
  && !/plAjoutsDe\(c\)\.forEach\(a => \{ if \(a\.imp === 'compte'\)/.test(src));
t('... et le mois courant lit la même source — sinon deux écrans, deux réponses',
  (src.match(/plNetSemaine\(sem\[lun\]\)/g) || []).length >= 1
  && /if \(lun\.slice\(0, 7\) !== m\) return;/.test(src));
// LES CONGES NE SONT PAS DES RETRAITS. Ils vivent dans `plAbsences`, pas dans
// les exceptions : une semaine de vacances ne fait donc pas plonger le
// compte-temps. C'est ce qui rend ce calcul tenable, et ca merite d'etre ecrit.
t('les congés vivent ailleurs, et le code le dit',
  /CE QUI N'EST PAS UN ECART : les conges, maladies et formations/.test(src));
t('l’écran montre les retraits, pas seulement les ajouts',
  /Écarts à la semaine type/.test(src) && /déduit de la semaine/.test(src));
t('... et explique dans quel ordre ils se déduisent',
  /les heures en moins se déduisent d\\'abord des heures supplémentaires de la même semaine/.test(src));
t('UN COMPTE NÉGATIF NE S’AFFICHE PAS DU MÊME BLEU QU’UN CRÉDIT',
  /s\.compte < 0 \? '#C62828' : '#0D47A1'/.test(src));

console.log('\n' + ok + ' vérifications, ' + ko + ' échec(s)\n');
process.exit(ko ? 1 : 0);
