// L'ORDRE DES RENOUVELLEMENTS — par jour, puis par nom.
// node essais/renouvellements-ordre.js
//
// L'adjoint d'Olivier, le 28/10/2026 : « les patients ne s'affichent pas du
// tout classés par date de préparation ; deux patients programmés au même jour
// n'apparaissent pas l'un en dessous de l'autre dans l'onglet Programmés. »
//
// Le tri EXISTE, et sur des données propres il fonctionne — vérifié en rendant
// l'onglet dans un navigateur. Mais il reposait sur la chaîne BRUTE `it.date`,
// et le regroupement par jour aussi (`it.date !== last`). Or `rnDayDiff` et
// `rnFmtFr` tronquaient déjà à dix caractères de leur côté : ils toléraient ce
// que le tri ne tolérait pas.
//
// Deux enregistrements du même jour écrits sous des formes différentes —
// « 2026-10-30 », « 2026-10-30T00:00:00.000Z », une espace en trop — comptent
// alors pour deux jours distincts. On obtient deux titres portant la MÊME date,
// et les patients séparés. Pire : une date précédée d'une espace passe AVANT
// tout le reste (l'espace vaut moins que les chiffres), et le patient part en
// tête de liste, à des écrans de ses voisins du même jour.
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'rn-module.js'), 'utf8');
function extraire(nom) {
  const d = src.indexOf('  function ' + nom + '(');
  if (d < 0) throw new Error('fonction introuvable : ' + nom);
  const fl = src.indexOf('\n', d);
  if (src.slice(d, fl).trimEnd().endsWith('}')) return src.slice(d, fl);
  const f = src.indexOf('\n  }\n', d);
  if (f < 0) throw new Error('fin introuvable : ' + nom);
  return src.slice(d, f + 4);
}
let ok = 0, ko = 0;
const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };
console.log('\nL’ORDRE DES RENOUVELLEMENTS\n');

eval(['rnCleJour', 'rnTrier'].map(extraire).join('\n'));

// ── La clé du jour ─────────────────────────────────────────────────────────
console.log('Une seule clé de jour, quelle que soit la forme écrite');
t('une date propre passe telle quelle', rnCleJour({ date: '2026-10-30' }) === '2026-10-30');
t('UN HORODATAGE COMPLET DONNE LE MÊME JOUR',
  rnCleJour({ date: '2026-10-30T00:00:00.000Z' }) === '2026-10-30');
t('UNE ESPACE EN TROP AUSSI — c’est elle qui envoyait le patient en tête',
  rnCleJour({ date: ' 2026-10-30 ' }) === '2026-10-30');
t('une date vide ne donne pas de jour',
  rnCleJour({ date: '' }) === '' && rnCleJour({}) === '' && rnCleJour(null) === '');
t('et ce qui n’est pas une date non plus',
  rnCleJour({ date: '30/10/2026' }) === '' && rnCleJour({ date: 'bientôt' }) === '');

// ── Le défaut, rejoué ──────────────────────────────────────────────────────
// On compare l'ancien comparateur et le nouveau sur le MEME jeu.
console.log('\nQuatre patients du même jour, écrits de quatre façons');
const J = '2026-10-30';
const JEU = [
  { nom: 'ROUX',   prenom: 'Paul',  date: J },
  { nom: 'MARTIN', prenom: 'Jean',  date: J + 'T00:00:00.000Z' },
  { nom: 'DUPONT', prenom: 'Marie', date: ' ' + J + ' ' },
  { nom: 'ALBERT', prenom: 'Zoe',   date: J },
  { nom: 'BERNARD', prenom: 'Luc',  date: '2026-11-02' }
];
const ANCIEN = JEU.slice().sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
const groupes = (liste, cle) => { let n = 0, last = null;
  liste.forEach(x => { const k = cle(x); if (k !== last) { n++; last = k; } }); return n; };
t('L’ANCIEN TRI FAISAIT QUATRE JOURNÉES LÀ OÙ IL Y EN A DEUX',
  groupes(ANCIEN, x => x.date) === 4);
t('... et il mettait Marie en tête, loin de ses voisins du même jour',
  ANCIEN[0].prenom === 'Marie');
const NEUF = rnTrier(JEU);
t('LE NOUVEAU N’EN FAIT QUE DEUX', groupes(NEUF, rnCleJour) === 2);
t('ET LES QUATRE DU 30 SE SUIVENT',
  NEUF.slice(0, 4).every(x => rnCleJour(x) === J));
t('... dans l’ordre alphabétique, qui se parcourt',
  NEUF.slice(0, 4).map(x => x.nom).join(' ') === 'ALBERT DUPONT MARTIN ROUX');
t('et le jour suivant vient après', rnCleJour(NEUF[4]) === '2026-11-02');

// ── Ce qui n'a pas de date remonte, au lieu de se diluer ───────────────────
// Une fiche sans date exploitable n'est pas classable : la noyer au milieu la
// rend introuvable, et c'est elle qu'il faut corriger.
console.log('\nCe qui n’a pas de date remonte au lieu de se diluer');
const AVEC_TROU = rnTrier([
  { nom: 'ZOLA', prenom: 'Emile', date: '2026-11-02' },
  { nom: 'SANSDATE', prenom: 'Qui', date: '' },
  { nom: 'ALBERT', prenom: 'Zoe', date: '2026-10-30' }
]);
t('LA FICHE SANS DATE EST EN TÊTE', AVEC_TROU[0].nom === 'SANSDATE');
t('... et le reste garde son ordre',
  AVEC_TROU[1].nom === 'ALBERT' && AVEC_TROU[2].nom === 'ZOLA');
t('elle est annoncée pour être corrigée, pas cachée',
  /Sans date de préparation/.test(src) && /à corriger/.test(src));
t('ON NE TRIE PAS LA LISTE D’ORIGINE', (function () {
  const l = [{ nom: 'B', prenom: '', date: '2026-11-02' }, { nom: 'A', prenom: '', date: '2026-10-30' }];
  rnTrier(l); return l[0].nom === 'B';
})());
t('et sans date exploitable, la fiche reste visible dans « À préparer »',
  /!rnCleJour\(it\) \|\| rnDayDiff\(rnCleJour\(it\)\) <= 7/.test(src));

// ── Les journées ne s'emboîtent plus ───────────────────────────────────────
// L'ancien rendu ouvrait un `.rn-daygroup` par journée et n'en fermait qu'UN
// a la fin : six journees donnaient six niveaux d'imbrication. Benin tant que
// la regle ne porte qu'une marge, mais le premier cadre ou fond ajoute dessus
// aurait decale toute la liste.
console.log('\nLes journées ne s’emboîtent plus les unes dans les autres');
const PARJOUR = extraire('rnParJour');
t('chaque journée se referme avant la suivante',
  /if \(ouvert\) html \+= '<\/div>';\n\s*cle = j; ouvert = true;/.test(PARJOUR));
t('... et la dernière aussi', /if \(ouvert\) html \+= '<\/div>';\n\s*return html;/.test(PARJOUR));
t('le regroupement n’est plus écrit qu’une fois',
  (src.match(/<div class="rn-daygroup"><div class="rn-dayhead">/g) || []).length === 2
  && (src.match(/rnParJour\(/g) || []).length === 3);

// ── Les autres vues suivent la même règle ──────────────────────────────────
console.log('\nLes quatre onglets rangent de la même façon');
t('« À préparer » trie avec rnTrier', /const visible = rnTrier\(rnList\(\)/.test(src));
t('« Programmés » aussi', /const all = rnTrier\(rnList\(\)/.test(src));
t('« À vérifier » aussi', /const l = rnTrier\(rnList\(\)/.test(src));
t('plus aucun tri sur la chaîne brute de la date',
  !/sort\(\(a, b\) => a\.date < b\.date/.test(src) && !/sort\(\(a, b\) => \(a\.date < b\.date/.test(src));
// LES ARCHIVES N'ETAIENT PAS TRIEES DU TOUT : elles sortaient dans l'ordre ou
// elles avaient ete ecrites. On y cherche ce qui vient de s'y ranger.
t('LES ARCHIVES SONT TRIÉES — elles ne l’étaient pas du tout',
  /la plus récente d’abord|la plus récente d'abord/.test(src)
  && /const dx = String\(x\.prepDate \|\| ''\)\.slice\(0, 10\)/.test(src));

console.log('\n' + ok + ' vérifications, ' + ko + ' échec(s)\n');
process.exit(ko ? 1 : 0);
