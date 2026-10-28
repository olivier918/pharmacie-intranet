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

function bloc(depart, fin) {
  const d = src.indexOf(depart);
  if (d < 0) throw new Error('bloc introuvable : ' + depart);
  const f = src.indexOf(fin, d);
  if (f < 0) throw new Error('fin de bloc introuvable : ' + fin);
  return src.slice(d, f + fin.length);
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
eval(['plExEnAttente', 'plEcartEx'].map(extraire).join('\n'));
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


// ── La validation des modifications proches ─────────────────────────────────
// CE QUI SE JOUE. Loin devant, on organise ; a trente jours, on derange
// quelqu'un — et ca se decide. Deux pieges se cachent la :
//
//   • LE PASSE. Corriger hier n'est pas deranger quelqu'un : une correction
//     retroactive bloquee en file d'attente serait absurde, et personne ne
//     penserait a aller la valider.
//   • LES COMPTEURS. Une modification pas encore accordee ne doit crediter ni
//     debiter une seule minute — sinon le compte-temps avance sur une decision
//     qui n'a pas ete prise, et se corrige tout seul en sens inverse si elle
//     est refusee.
console.log('\nUne modification proche se fait valider');
eval(['plJoursJusqua', 'plDoitValider'].map(extraire).join('\n'));
eval(bloc("const PL_VALID_JOURS =", "30;").replace(/^\s*const /, 'globalThis.'));
eval(bloc("const PL_ADMIN_DISPENSE =", "true;").replace(/^\s*const /, 'globalThis.'));
const REF = '2026-10-28';
t('la fenêtre est de trente jours', PL_VALID_JOURS === 30);
t('demain se fait valider', plDoitValider('2026-10-29', false, REF) === true);
t('aujourd’hui aussi', plDoitValider('2026-10-28', false, REF) === true);
t('le trentième jour encore', plDoitValider('2026-11-27', false, REF) === true);
t('LE TRENTE ET UNIÈME EST LIBRE — on organise, on ne dérange personne',
  plDoitValider('2026-11-28', false, REF) === false);
t('LE PASSÉ NE SE FAIT PAS VALIDER — une correction rétroactive attendrait pour rien',
  plDoitValider('2026-10-27', false, REF) === false);
t('UN ADMINISTRATEUR EST DISPENSÉ — il est déjà celui qui validerait',
  plDoitValider('2026-10-29', true, REF) === false);
t('... et la dispense tient sur une seule ligne, prête à être retournée',
  PL_ADMIN_DISPENSE === true && /PL_ADMIN_DISPENSE = true;/.test(src));
t('une date absente ne fait pas tomber la lecture',
  plDoitValider(null, false, REF) === false && plJoursJusqua(null) === null);

console.log('\nTant qu’elle n’est pas accordée, elle ne compte pas');
t('une exception en attente est reconnue',
  plExEnAttente({ statut: 'attente' }) && !plExEnAttente({ statut: 'valide' })
  && !plExEnAttente({}) && !plExEnAttente(null));
TRAME = { c1: ['9h-12h30', null] };
t('UNE MODIFICATION EN ATTENTE NE BOUGE AUCUN COMPTEUR',
  plEcartEx({ contratId: 'c1', type: 'horaire', date: '2026-11-23', demi: 'M',
              horaire: null, statut: 'attente' }, C) === 0);
t('... et la même, une fois validée, compte normalement',
  plEcartEx({ contratId: 'c1', type: 'horaire', date: '2026-11-23', demi: 'M',
              horaire: null, statut: 'valide' }, C) === -3.5);
t('une exception d’avant la règle, sans statut, compte comme valide',
  plEcartEx({ contratId: 'c1', type: 'horaire', date: '2026-11-23', demi: 'M',
              horaire: null }, C) === -3.5);

console.log('\nCe que l’écran promet');
t('LE PLANNING AFFICHE L’HORAIRE HABITUEL, pas celui qui est demandé',
  /MODIFICATION EN ATTENTE DE VALIDATION/.test(src)
  && /l\\'horaire affiché reste celui qui fait foi/.test(src));
t('... et la case porte la marque de l’attente', /pl-att' : ''/.test(src));
t('la lecture du planning ignore ce qui attend',
  /&& !plExEnAttente\(x\)\) \|\| null;/.test(src));
t('le bandeau d’accueil les compte', /bout\(mods, 'modification du planning'/.test(src));
t('... et dit où regarder : la case passe au violet',
  /la case passe au <b>violet<\/b>/.test(src));
t('et l’administrateur peut valider ou refuser',
  /window\.plModValider = function/.test(src) && /window\.plModRefuser = function/.test(src));
t('UN REFUS RETIRE LA LIGNE, avec sa pierre tombale',
  /markDeleted\('plExceptions', exId\)/.test(src));

console.log('\nLa modification ponctuelle se voit — sans changer de taille');
// OLIVIER, LE 28/10 : « attention a bien harmoniser la taille des cartouches
// dans le planning. on abandonne l'idee des contours en pointille. c'est pas
// lisible. les modification avant validation doivent apparaitre en violet. »
//
// Le contour en pointille coutait DEUX fois. Il posait des bordures (2 px en
// haut, a droite, en bas) et, surtout, son `padding:1px 5px` ecrasait le
// `padding-right:20px` de la regle de base : le cartouche maigrissait d'une
// quinzaine de pixels, et la pastille de poste — en position absolue a droite —
// venait recouvrir l'horaire. Trois cases cote a cote n'avaient plus la meme
// largeur.
//
// D'ou l'invariant verifie ici, mecaniquement : AUCUNE VARIANTE DE CARTOUCHE NE
// TOUCHE A SA GEOMETRIE. Seuls la couleur, le fond et l'ombre INTERIEURE — qui
// ne prend aucune place — distinguent les etats.
const CSS = bloc('.pl-cell{padding', '.pl-chip.pl-ch-part');
// On ne retient que les variantes du cartouche LUI-MEME : un selecteur a
// descendant (`.pl-shift.pl-formation .pl-fortag`) habille un element interieur,
// qui a le droit d'avoir sa propre taille.
const REGLES = CSS.split('\n').map(l => l.trim())
  .filter(l => /^\.pl-(shift|off|vide|abs)\./.test(l) && l.indexOf('{') > 0)
  .filter(l => !/\s/.test(l.slice(0, l.indexOf('{')).trim()));
// L'ARRONDI N'OCCUPE AUCUNE PLACE : il n'est pas de la geometrie. Ne sont
// interdites que les proprietes qui changent la TAILLE de la boite.
const GEOMETRIE = /(^|;|\{)\s*(padding|border-width|border-top|border-right|border-bottom|font-size|margin|width|height)\s*:/;
const fautives = REGLES.filter(l => {
  const corps = l.slice(l.indexOf('{'));
  // `border:` nu change la largeur, sauf s'il ne fait que remplacer un filet
  // deja present de meme epaisseur (la case de repos, qui porte 1 px).
  const bordureNue = /(^|;|\{)\s*border\s*:/.test(corps) && !/^\{border:1px solid/.test(corps);
  return GEOMETRIE.test(corps) || bordureNue;
});
t('les ' + REGLES.length + ' variantes de cartouche ne touchent pas à la géométrie'
  + (fautives.length ? ' — FAUTIVES : ' + fautives.map(l => l.slice(0, l.indexOf('{'))).join(', ') : ''),
  fautives.length === 0);
t('... et l’essai en a bien examiné une poignée, sinon il ne vérifie rien',
  REGLES.length >= 8);
t('PLUS AUCUN POINTILLÉ NI TIRET SUR UN CARTOUCHE',
  !/\.pl-(shift|off|abs)\.[^{]*\{[^}]*(dotted|dashed)/.test(CSS)
  && !/style="border:2px dotted/.test(src));

t('LA MODIFICATION VALIDÉE PORTE UN LISERÉ INTÉRIEUR, dans la couleur du créneau',
  /\.pl-shift\.pl-mod\{box-shadow:inset 0 0 0 2px currentColor\}/.test(src));
t('... donc vert au comptoir, bleu au back-office, rose au poste avancé, sans le nommer',
  /currentColor/.test(bloc('.pl-shift.pl-mod{', '}')));
t('un créneau supprimé ce jour le dit aussi, et de la même façon',
  /\.pl-off\.pl-mod\{box-shadow:inset 0 0 0 2px var\(--plwarn\)/.test(src));

console.log('\nL’attente de validation est violette');
t('LE VIOLET EST DÉFINI UNE FOIS, avec son fond et sa teinte foncée',
  /--platt:#7B4FC9;--plattb:#F0EAFB;--platti:#50308C;/.test(src));
t('... et c’est une couleur qu’aucun poste n’utilise',
  !/--pl(ac|rose|pB|pA):#7B4FC9/.test(src));
t('UNE MODIFICATION EN ATTENTE EST VIOLETTE, fond et liseré',
  /\.pl-shift\.pl-echatt,\.pl-shift\.pl-att\{background:var\(--plattb\);color:var\(--platti\);\n\s*border-left-color:var\(--platt\);box-shadow:inset 0 0 0 2px var\(--platt\)\}/.test(src));
t('un échange demandé l’est aussi — « en attente » ne se dit pas de deux façons',
  /\.pl-shift\.pl-echatt,/.test(src) && /\.pl-echdot\.pl-att\{background:var\(--platt\)/.test(src));
// LA PASTILLE D'ATTENTE A DISPARU. Posee a -4px du coin superieur gauche, elle
// recouvrait le debut de « 9h-12h30 » — sur un texte de 10,5 px, exactement le
// chiffre qu'on vient lire. Et elle ne disait rien de plus : le cartouche est
// deja violet de fond, de texte et de lisere, et l'infobulle porte deja
// « MODIFICATION EN ATTENTE DE VALIDATION ». Un repere redondant qui gene la
// lecture n'est pas un repere.
t('LA PASTILLE QUI RECOUVRAIT L’HORAIRE A DISPARU — le violet suffit',
  !/pl-attdot/.test(src));
// Les pastilles qui restent (creneau supprime, echange) sont en position
// ABSOLUE : sans `position:relative` sur leur parent elles se calaient sur le
// coin de la PAGE, a l'autre bout de l'ecran.
t('LES PASTILLES RESTANTES NE S’ÉCHAPPENT PLUS DE LEUR CASE',
  /\.pl-off\{position:relative;/.test(src) && /\.pl-vide\{position:relative;/.test(src));
t('et une demi-journée de repos en attente aussi',
  /\.pl-cell \.pl-vide\.pl-att,[^{]*\{\n\s*border:1px solid var\(--platt\);color:var\(--platti\)/.test(src));
// MEME PIEGE QUE LE SURVOL DU CARTOUCHE : `.pl-cell:hover .pl-vide` est plus
// specifique que `.pl-vide.pl-att`. Survoler la case — le geste par lequel on
// va justement la lire — remplacait le violet par le vert du bouton « ajouter ».
t('... ET LE SURVOL NE LA REPEINT PLUS EN VERT',
  /\.pl-cell:hover \.pl-vide\.pl-att/.test(src)
  && /\.pl-cell \.pl-vide\.pl-att:hover/.test(src));
// L'ORDRE DECIDE QUI GAGNE : une case peut porter une modification validee ET
// un echange demande. A specificite egale, la derniere regle s'applique.
t('LE VIOLET PASSE APRÈS LE VERT — sinon on croirait la case acquise',
  src.indexOf('.pl-shift.pl-echpair{') < src.indexOf('.pl-shift.pl-echatt,.pl-shift.pl-att{')
  && src.indexOf('.pl-shift.pl-mod{') < src.indexOf('.pl-shift.pl-echatt,.pl-shift.pl-att{'));
// LE SURVOL EFFACAIT LE LISERE : `.pl-shift.pl-click:hover` est plus specifique
// que `.pl-shift.pl-mod`, et son box-shadow d'elevation remplacait l'ombre
// interieure — a l'instant ou l'on cherche justement a lire la case.
t('LE SURVOL N’EFFACE PLUS LE LISERÉ — l’élévation passe par un filtre',
  /\.pl-shift\.pl-click:hover\{filter:brightness\(\.94\) drop-shadow/.test(src)
  && !/pl-click:hover\{[^}]*box-shadow/.test(src));
t('une demande d’absence ne grossit plus sa pastille',
  /\.pl-abs\.pl-dem\{[^}]*box-shadow:inset 0 0 0 1\.5px var\(--plcp\)/.test(src)
  && !/\.pl-abs\.pl-dem\{[^}]*border:1px dashed/.test(src));

console.log('\nL’échange apparie deux plages');
t('un troisième motif est proposé', /onclick="plImputChoisir\('echange'\)"/.test(src));
t('... qui bascule en mode appariement au lieu d’enregistrer',
  /if \(v === 'echange' && ex\) \{\n\s*plEchSlot = ex\.id;/.test(src));
t('LE CLIC SUIVANT APPARIE AU LIEU D’OUVRIR L’ÉDITEUR',
  /if \(plEchSlot\) \{ plEchApparier\(cid, iso, hh\); return; \}/.test(src));
t('on ne s’échange pas avec soi-même',
  /Choisissez une AUTRE plage horaire/.test(src));
t('ON N’ÉCHANGE PAS CONTRE UNE DEMI-JOURNÉE DE REPOS — il n’y a rien à prendre',
  /n’est pas travaillée : il n’y a rien à échanger/.test(src));
t('LES DEUX PLAGES PORTENT LE MÊME IDENTIFIANT', /prem\.echangeId = eid;/.test(src)
  && /echangeId: eid/.test(src));
t('... et le même repère à l’écran', /pl-echpair/.test(src) && /Plage échangée/.test(src));
t('un échange proche attend sa validation comme le reste',
  /statut: plDoitValider\(iso, plIsAdmin\(\)\) \? 'attente' : 'valide',\n\s*horaire: null, pos: null, echangeId: eid/.test(src));
// L'ECHANGE N'EST PAS UN TROISIEME MODE DE COMPTAGE : c'est deux ecarts
// apparies. Le compte-temps les lit comme les autres, et la difference de
// duree compte normalement — c'est la decision du 28/10.
t('l’échange ne crée aucune règle de comptage à part',
  /DEUX ECARTS\n\s*\/\/ APPARIES/.test(src));

console.log('\nRetirer quelqu’un du planning');
t('le bouton est dans la liste des contrats', /onclick="plContratRetirer\(/.test(src));
t('RIEN N’EST DÉTRUIT — le contrat est désactivé', /c\.actif = false; plStamp\(c\); plPersist\(\);/.test(src));
t('... et on dit où la retrouver pour la remettre',
  /Collaborateurs du site sans contrat au planning/.test(src));
t('c’est réservé aux administrateurs',
  /plContratRetirer = function \(cid\) \{\n\s*if \(!plGarde\(\)\) return;/.test(src));


// ── La remise à zéro, et l'oubli ────────────────────────────────────────────
// CE QUI SE JOUE. Olivier : « l'historique disparaît quand au bout de 3 mois
// ET une mise à 0 ». Les DEUX conditions, pas l'une ou l'autre — et c'est la
// seule lecture qui tienne : un mouvement qui compte encore dans le solde ne
// peut pas disparaître de la liste censée l'expliquer. On n'oublie que ce qui
// est soldé *et* ancien.
//
// Et une remise à zéro n'efface rien : elle pose une date. Les exceptions,
// elles, sont le planning lui-même — les supprimer effacerait des journées de
// travail. Ce qui disparaît, c'est une ligne dans le détail du compteur.
console.log('\nLa remise à zéro, et l’oubli à trois mois');
eval(bloc("const PL_OUBLI_MOIS =", "3;").replace(/^\s*const /, 'globalThis.'));
eval(['plRazDe', 'plApresRaz', 'plEncoreLisible'].map(extraire).join('\n'));
const AUJ = '2026-10-28';
const sansRaz = { id: 'c1' }, avecRaz = { id: 'c1', razAt: '2026-09-30' };

t('la fenêtre d’oubli est de trois mois', PL_OUBLI_MOIS === 3);
t('sans remise à zéro, tout compte',
  plRazDe(sansRaz) === null && plApresRaz(sansRaz, '2020-01-01') === true);
t('APRÈS LA REMISE À ZÉRO, LE MOUVEMENT COMPTE', plApresRaz(avecRaz, '2026-10-01') === true);
t('AVANT, IL NE COMPTE PLUS — il a été récupéré ou payé',
  plApresRaz(avecRaz, '2026-09-29') === false);
t('le jour même de la remise est soldé, pas reporté',
  plApresRaz(avecRaz, '2026-09-30') === false);

console.log('\nOn n’oublie que ce qui est soldé ET ancien');
t('un mouvement qui compte encore reste lisible, même vieux de deux ans',
  plEncoreLisible(sansRaz, '2024-01-01', AUJ) === true);
t('UN MOUVEMENT SOLDÉ MAIS RÉCENT RESTE LISIBLE — on doit pouvoir vérifier',
  plEncoreLisible(avecRaz, '2026-09-01', AUJ) === true);
t('SOLDÉ ET VIEUX DE PLUS DE TROIS MOIS, IL DISPARAÎT DE LA LISTE',
  plEncoreLisible(avecRaz, '2026-05-01', AUJ) === false);
t('... la limite se joue bien autour de trois mois',
  plEncoreLisible(avecRaz, '2026-08-20', AUJ) === true
  && plEncoreLisible(avecRaz, '2026-06-20', AUJ) === false);

console.log('\nCe que la remise à zéro ne fait pas');
t('ELLE N’EFFACE AUCUNE EXCEPTION — ce sont des journées de travail',
  !/plExceptions\.splice/.test(bloc('window.plRazFaire = function', '};')));
t('elle pose une date, un auteur et le solde repris',
  /c\.razAt = plIso\(new Date\(\)\);/.test(src) && /c\.razSolde = s0\.compte;/.test(src));
t('elle annonce le solde avant d’agir', /Solde actuel : ' \+ plFmtH\(s0\.compte\)/.test(src));
t('elle est réservée aux administrateurs',
  /plRazFaire = function \(cid\) \{\n\s*if \(!plGarde\(\)\) return;/.test(src));
// FILTRER AVANT DE NETTER, et pas l'inverse : une semaine a cheval sur la
// remise a zero serait sinon comptee des deux cotes a la fois.
t('LE SOLDE FILTRE LES MOUVEMENTS AVANT DE NETTER PAR SEMAINE',
  /plEcartsParSemaine\(c, L\('exceptions'\)\.filter\(x => x && plApresRaz\(c, x\.date\)\)\)/.test(src));

console.log('\nLe détail s’ouvre au clic');
t('le solde est un bouton, plus un simple chiffre',
  /onclick="plCompteDetail\(/.test(src) && /title="Voir le détail du compte-temps"/.test(src));
t('il ouvre une fenêtre qui lui est propre', /id="pl-ov-cpt"/.test(src));
t('le détail est semaine par semaine', /semaine du ' \+ plJoliDate\(b\.lun\)/.test(src));
t('... et chaque mouvement y porte son signe',
  /\(e < 0 \? '' : '\+'\) \+ plFmtH\(e\)/.test(src));
t('les semaines soldées se lisent encore, en gris', /pl-sub">soldé</.test(src));
t('et la remise à zéro se déclenche de là', /plRazFaire\(\\'' \+ c\.id/.test(src));

console.log('\n' + ok + ' vérifications, ' + ko + ' échec(s)\n');
process.exit(ko ? 1 : 0);
