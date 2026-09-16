// Garde-fou du module Reunion d'equipe. Les fonctions sont extraites de
// public/re-module.js lui-meme : c'est le code reel qui est eprouve.
// node essais/reunion.js
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 're-module.js'), 'utf8');
function extraire(nom) {
  const d = src.indexOf('  function ' + nom + '(');
  if (d < 0) throw new Error('fonction introuvable : ' + nom);
  const f = src.indexOf('\n  }\n', d);
  if (f < 0) throw new Error('fin introuvable : ' + nom);
  return src.slice(d, f + 4);
}
// Une declaration de fonction dans un eval non strict atterrit dans la portee
// du module : les fonctions extraites sont ensuite appelables telles quelles.
const pad = n => String(n).padStart(2, '0');
eval(extraire('reIso'));
eval(extraire('reDate'));
eval(extraire('reJours'));
eval(extraire('reDelai'));
eval(extraire('reProchaine'));
eval(extraire('reOrdreDuJour'));
eval(extraire('reAbordes'));
eval(extraire('rePeutToucher'));
eval(extraire('reTaille'));
eval(extraire('reMime'));
eval(extraire('reLibelleDate'));
const RE_JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const RE_MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const RE_TYPES = {
  'application/pdf': 'PDF',
  'image/jpeg': 'image', 'image/png': 'image', 'image/gif': 'image', 'image/webp': 'image',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
  'application/msword': 'Word', 'application/vnd.ms-excel': 'Excel'
};
const RE_EXT = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  gif: 'image/gif', webp: 'image/webp',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  doc: 'application/msword', xls: 'application/vnd.ms-excel'
};

let ok = 0, ko = 0;
const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };
console.log('\nRÉUNION D’ÉQUIPE — l’ordre du jour tient tout seul\n');

// ── La date de la prochaine séance ────────────────────────────────────────
console.log('La prochaine séance');
const SEANCES = [
  { id: 1, date: '2026-08-04' },   // passée
  { id: 2, date: '2026-10-06' },
  { id: 3, date: '2026-11-03' }
];
t('c’est la plus proche à venir', (reProchaine(SEANCES, '2026-09-16') || {}).id === 2);
t('une séance passée ne remonte jamais',
  (reProchaine(SEANCES, '2026-09-16') || {}).date > '2026-09-16');
t('le jour même, la réunion est encore à venir',
  (reProchaine(SEANCES, '2026-10-06') || {}).id === 2);
t('... et le lendemain, c’est la suivante',
  (reProchaine(SEANCES, '2026-10-07') || {}).id === 3);
t('aucune séance à venir -> rien, pas une date passée',
  reProchaine(SEANCES, '2026-12-01') === null);
t('liste vide ou absente -> rien',
  reProchaine([], '2026-09-16') === null && reProchaine(null, '2026-09-16') === null);
t('une entrée sans date est ignorée',
  (reProchaine([{ id: 9 }, { id: 2, date: '2026-10-06' }], '2026-09-16') || {}).id === 2);
t('l’ordre de la liste ne compte pas',
  (reProchaine(SEANCES.slice().reverse(), '2026-09-16') || {}).id === 2);

console.log('\nDans combien de temps — ce qui se comprend sans calculer');
t('le jour même', reDelai('2026-10-06', '2026-10-06') === "aujourd'hui");
t('la veille', reDelai('2026-10-06', '2026-10-05') === 'demain');
t('dans la semaine', reDelai('2026-10-06', '2026-09-30') === 'dans 6 jours');
t('au-delà, on compte en semaines', reDelai('2026-11-03', '2026-09-16') === 'dans 7 semaines');
t('une date passée le dit', reDelai('2026-09-15', '2026-09-16') === 'hier');
// Le piege que midi evite : un changement d'heure ne doit pas decaler le compte.
t('le passage à l’heure d’hiver ne décale pas le compte',
  reJours('2026-10-24', '2026-10-26') === 2);
t('... ni celui à l’heure d’été', reJours('2026-03-28', '2026-03-30') === 2);
t('une date illisible ne produit pas un faux délai',
  reDelai('demain', '2026-09-16') === '' && reJours(null, '2026-09-16') === null);
t('la date s’écrit en toutes lettres', reLibelleDate('2026-10-06') === 'mardi 6 octobre');

// ── L'ordre du jour ────────────────────────────────────────────────────────
console.log('\nL’ordre du jour');
const THEMES = [
  { id: 1, ts: 300, par: 'marie', titre: 'Plan de nettoyage' },
  { id: 2, ts: 100, par: 'of', titre: 'Horaires de Noël' },
  { id: 3, ts: 200, par: 'marie', titre: 'Rangement du back-office', aborde: true, abordeLe: 900, abordePar: 'of' },
  { id: 4, ts: 400, par: 'quentin', titre: 'Formation vaccination', aborde: true, abordeLe: 800, abordePar: 'of' }
];
t('le premier posé est le premier abordé', reOrdreDuJour(THEMES)[0].id === 2);
t('... et l’ordre suit l’arrivée', reOrdreDuJour(THEMES).map(x => x.id).join() === '2,1');
t('un thème coché quitte l’ordre du jour',
  reOrdreDuJour(THEMES).every(x => !x.aborde));
t('... mais n’est pas perdu', reAbordes(THEMES).length === 2);
t('les thèmes traités remontent du plus récent',
  reAbordes(THEMES).map(x => x.id).join() === '3,4');
t('rien à l’ordre du jour ne casse rien',
  reOrdreDuJour([]).length === 0 && reOrdreDuJour(null).length === 0);
t('une entrée nulle est ignorée',
  reOrdreDuJour([null, { id: 1, ts: 1 }]).length === 1);
// La regle de fond : un theme decoche RESTE. C'est tout l'interet de la coche
// individuelle : ce qu'on n'a pas eu le temps de traiter n'a pas disparu.
t('un thème jamais coché reste à l’ordre du jour de la réunion suivante',
  reOrdreDuJour(THEMES).some(x => x.id === 1));

console.log('\nQui peut toucher à quoi');
const MIEN = THEMES[0], PAS_MIEN = THEMES[1];
t('j’efface mon propre thème', rePeutToucher(MIEN, 'marie', false) === true);
t('je ne touche pas à celui d’un collègue', rePeutToucher(PAS_MIEN, 'marie', false) === false);
t('un administrateur peut arbitrer', rePeutToucher(PAS_MIEN, 'marie', true) === true);
t('sans session, personne ne modifie rien',
  rePeutToucher(MIEN, null, true) === false && rePeutToucher(MIEN, undefined, false) === false);
t('un thème absent ne se modifie pas', rePeutToucher(null, 'marie', true) === false);
t('7 et "7" sont la même personne',
  rePeutToucher({ par: 7 }, '7', false) === true && rePeutToucher({ par: 7 }, '8', false) === false);

// ── Les pièces jointes ─────────────────────────────────────────────────────
console.log('\nLes pièces jointes');
t('un PDF passe', reMime({ name: 'devis.pdf', type: 'application/pdf' }) === 'application/pdf');
t('un Excel passe', reMime({ name: 'planning.xlsx', type: RE_EXT.xlsx }) === RE_EXT.xlsx);
t('un Word passe', reMime({ name: 'courrier.docx', type: RE_EXT.docx }) === RE_EXT.docx);
// Windows annonce parfois un type vide : refuser serait incomprehensible au
// comptoir alors que l'extension dit tout.
t('un type vide retombe sur l’extension',
  reMime({ name: 'planning.xlsx', type: '' }) === RE_EXT.xlsx);
t('... quelle que soit la casse', reMime({ name: 'PHOTO.JPG', type: '' }) === 'image/jpeg');
t('un exécutable est refusé', reMime({ name: 'virus.exe', type: 'application/x-msdownload' }) === null);
t('une page web déguisée est refusée', reMime({ name: 'page.html', type: 'text/html' }) === null);
t('un fichier sans extension ni type est refusé', reMime({ name: 'truc', type: '' }) === null);
t('aucun fichier -> rien', reMime(null) === null);

console.log('\nLa taille annoncée');
t('des octets', reTaille(900) === '900 o');
t('des kilo-octets', reTaille(240 * 1024) === '240 Ko');
t('des méga-octets', reTaille(3 * 1048576) === '3,0 Mo');
t('zéro ne produit pas NaN', reTaille(0) === '0 o');
t('une taille absente non plus', reTaille(null) === '0 o' && reTaille(undefined) === '0 o');

console.log('\n' + ok + ' vérifications, ' + ko + ' échec(s)\n');
process.exit(ko ? 1 : 0);
