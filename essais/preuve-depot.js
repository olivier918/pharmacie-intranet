// La preuve de depot sur un point de livraison groupee (EHPAD). Une photo,
// douze livraisons, et un geste qui passe tout le groupe en « livre » : c'est
// justement parce que ce geste touche douze dossiers d'un coup qu'il doit
// pouvoir etre rendu exactement.
// node essais/preuve-depot.js
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

function extraireLigne(nom) {
  const m = new RegExp('^function ' + nom + '\\(.*$', 'm').exec(src);
  if (!m) throw new Error('fonction introuvable : ' + nom);
  return m[0];
}
function extraireBloc(nom) {
  const d = src.indexOf('\nfunction ' + nom + '(');
  if (d < 0) throw new Error('fonction introuvable : ' + nom);
  const f = src.indexOf('\n}\n', d);
  if (f < 0) throw new Error('fin introuvable : ' + nom);
  return src.slice(d + 1, f + 3);
}
const mL = /^const LIEUX_POINT_UNIQUE=.*$/m.exec(src);
if (!mL) throw new Error('LIEUX_POINT_UNIQUE introuvable');
eval(mL[0].replace('const ', 'var '));
eval(extraireLigne('dPointUnique'));
eval(extraireBloc('dPreuveDu'));
eval(extraireBloc('dPoserPreuve'));
eval(extraireBloc('dRetirerPreuve'));

let ok = 0, ko = 0;
const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };
console.log('\nPREUVE DE DÉPÔT — une photo pour tout un point de livraison\n');

const TS = { date: '16/09/2026', heure: '11:20', initiales: 'jp' };
const ID = 'a'.repeat(32);
const groupe = (statuts) => statuts.map((st, i) => ({
  id: i + 1, date: '2026-09-16', lieu: 'EHPAD', nom: 'P' + i, status: st,
  prepBy: st === 'wait' ? null : 'ma', prepAt: st === 'wait' ? null : TS,
  livrBy: st === 'done' ? 'ma' : null, livrAt: st === 'done' ? TS : null
}));

console.log('Où une preuve unique a un sens');
t('l’EHPAD est un point de livraison groupée', dPointUnique('EHPAD') === true);
t('les IDE MDS aussi', dPointUnique('IDE MDS') === true);
t('le domicile, non : douze portes ne se prouvent pas d’une photo',
  dPointUnique('Domicile') === false);
t('un lieu de retrait non plus : c’est le patient qui vient',
  dPointUnique('Pharmacie') === false && dPointUnique('IDE 9') === false);
t('un lieu inconnu ou vide : non', dPointUnique('Cabinet Untel') === false
  && dPointUnique('') === false && dPointUnique(null) === false);
t('les espaces de saisie ne déguisent pas un lieu', dPointUnique('  EHPAD ') === true);

console.log('\nLa photo posée');
let g = groupe(['wait', 'prep', 'prep', 'done']);
let n = dPoserPreuve(g, ID, 'jp', 7000, 7000, TS);
t('les quatre livraisons portent la photo', g.every(d => d.preuveId === ID));
t('... la même photo, pas quatre copies', new Set(g.map(d => d.preuveId)).size === 1);
t('... qui les a posée et quand', g.every(d => d.preuvePar === 'jp' && d.preuveAt === 7000));
t('... et le même lot, sinon on ne sait plus quoi défaire',
  g.every(d => d.preuveLot === 7000));
t('toutes sont livrées', g.every(d => d.status === 'done'));
t('trois ont changé d’état, la quatrième était déjà livrée', n === 3);
t('celle qui était « à préparer » reçoit aussi son estampille de préparation',
  g[0].prepAt === TS && g[0].prepBy === 'jp');
t('celle qui était déjà préparée garde SON préparateur',
  g[1].prepBy === 'ma');
t('l’heure de livraison est posée sur celles qui viennent de passer',
  g[0].livrAt === TS && g[0].livrBy === 'jp');
t('celle qui était déjà livrée n’est pas réestampillée',
  g[3].livrBy === 'ma');
t('chacune est horodatée pour la synchronisation', g.every(d => d.updatedAt > 0));

console.log('\nCe que la boîte de réception du groupe sait dire');
t('le groupe donne sa preuve', (dPreuveDu(g) || {}).id === ID);
t('... avec son lot, pour pouvoir la défaire', (dPreuveDu(g) || {}).lot === 7000);
t('un groupe sans photo ne promet rien',
  dPreuveDu(groupe(['prep', 'prep'])) === null);
t('une liste vide ne casse rien', dPreuveDu([]) === null && dPreuveDu(null) === null);

console.log('\nDéfaire, exactement');
let rendues = dRetirerPreuve(g, 7000);
t('trois livraisons rendues à leur état précédent', rendues === 3);
t('... celle qui attendait attend de nouveau', g[0].status === 'wait');
t('... celles qui étaient préparées le redeviennent',
  g[1].status === 'prep' && g[2].status === 'prep');
t('... et celle qui était déjà livrée NE RECULE PAS', g[3].status === 'done');
t('l’estampille de livraison est effacée sur celles qui reculent',
  g[0].livrAt === null && g[1].livrAt === null);
t('... mais pas sur celle qui était déjà livrée', g[3].livrAt === TS);
t('celle qui repart en « à préparer » perd l’estampille qu’on lui avait mise',
  g[0].prepAt === null && g[0].prepBy === null);
t('celle qui était déjà préparée garde la sienne',
  g[1].prepAt === TS && g[1].prepBy === 'ma');
t('plus aucune trace de la photo', g.every(d => !d.preuveId && !d.preuveLot && !d.preuveAvant));
t('le groupe ne promet plus de preuve', dPreuveDu(g) === null);

console.log('\nUn autre lot ne doit pas être emporté');
g = groupe(['prep', 'prep']);
dPoserPreuve([g[0]], ID, 'jp', 100, 100, TS);
dPoserPreuve([g[1]], ID, 'jp', 200, 200, TS);
dRetirerPreuve(g, 100);
t('le lot visé est défait', g[0].status === 'prep' && !g[0].preuveId);
t('... et l’autre reste intact', g[1].status === 'done' && g[1].preuveLot === 200);

console.log('\n' + ok + ' vérifications, ' + ko + ' échec(s)\n');
process.exit(ko ? 1 : 0);
