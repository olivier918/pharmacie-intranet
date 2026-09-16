// Garde-fou des raccourcis personnels de l'accueil. Les trois fonctions sont
// extraites de public/ac-module.js lui-meme : c'est le code reel qui est
// eprouve, pas une copie qui divergera au premier correctif.
// node essais/raccourcis.js
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'ac-module.js'), 'utf8');
function extraire(nom) {
  const d = src.indexOf('  function ' + nom + '(');
  if (d < 0) throw new Error('fonction introuvable : ' + nom);
  const f = src.indexOf('\n  }\n', d);
  if (f < 0) throw new Error('fin introuvable : ' + nom);
  return src.slice(d, f + 4);
}
// Une declaration de fonction dans un eval non strict atterrit bien dans la
// portee du module : acMesLiens et acLiensOrphelins sont ensuite appelables.
eval(extraire('acMesLiens'));
eval(extraire('acLiensOrphelins'));

let ok = 0, ko = 0;
const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };
console.log('\nRACCOURCIS — chacun les siens, personne ceux des autres\n');

const OF = 'of', MA = 'marie';
const base = [
  { id: 1, qui: OF, lbl: 'Ameli' },
  { id: 2, qui: OF, lbl: 'Vidal' },
  { id: 3, qui: MA, lbl: 'Grossiste' },
  { id: 4, lbl: 'Ancien lien commun' },      // d'avant la bascule
  { id: 5, qui: null, lbl: 'Autre ancien' }
];

console.log('Ce que chacun voit');
t('je vois mes deux raccourcis', acMesLiens(base, OF).length === 2);
t('... et pas ceux de ma collegue',
  acMesLiens(base, OF).every(r => r.lbl !== 'Grossiste'));
t('ma collegue voit le sien, seule', acMesLiens(base, MA).length === 1);
t('un collaborateur sans raccourci part d’une page vide',
  acMesLiens(base, 'quentin').length === 0);

console.log('\nCe qui ne doit surtout pas s’afficher');
t('les liens sans proprietaire ne sont a personne',
  acMesLiens(base, OF).every(r => r.qui != null));
t('session absente -> rien, jamais tout',
  acMesLiens(base, null).length === 0 && acMesLiens(base, undefined).length === 0);
t('un identifiant vide n’est pas un passe-partout', acMesLiens(base, '').length === 0);
t('... et ne ramasse pas non plus les orphelins',
  acMesLiens(base, '').length === 0);
t('une liste absente ne casse rien', acMesLiens(null, OF).length === 0);
t('une entree nulle est ignoree', acMesLiens([null, { id: 9, qui: OF }], OF).length === 1);

console.log('\nL’identifiant compare : nombre ou texte, c’est la meme personne');
t('7 et "7" designent le meme compte',
  acMesLiens([{ id: 1, qui: 7 }], '7').length === 1);
t('... et 8 ne le devient pas pour autant',
  acMesLiens([{ id: 1, qui: 7 }], '8').length === 0);
t('zero est un identifiant, pas une absence',
  acMesLiens([{ id: 1, qui: 0 }], 0).length === 1);

console.log('\nLes liens d’avant la bascule');
t('ils sont reperes, pas effaces', acLiensOrphelins(base).length === 2);
t('ceux qui ont un proprietaire ne sont pas repris',
  acLiensOrphelins(base).every(r => r.qui == null));
t('une fois repris, il n’en reste plus',
  acLiensOrphelins(base.map(r => ({ ...r, qui: r.qui == null ? OF : r.qui }))).length === 0);
t('... et ils rejoignent bien ma liste',
  acMesLiens(base.map(r => ({ ...r, qui: r.qui == null ? OF : r.qui })), OF).length === 4);
t('liste absente -> aucun orphelin', acLiensOrphelins(null).length === 0);

console.log('\n' + ok + ' verifications, ' + ko + ' echec(s)\n');
process.exit(ko ? 1 : 0);
