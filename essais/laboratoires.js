// Le repertoire des laboratoires. Ce qui se joue ici : reconnaitre qu'un
// dossier ecrit « mkl » parle du meme fournisseur que la fiche « MKL », SANS
// jamais confondre deux fournisseurs differents. Les fonctions sont extraites
// de public/lb-module.js lui-meme.
// node essais/laboratoires.js
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'lb-module.js'), 'utf8');
function extraire(nom) {
  const d = src.indexOf('  function ' + nom + '(');
  if (d < 0) throw new Error('fonction introuvable : ' + nom);
  const f = src.indexOf('\n  }\n', d);
  if (f < 0) throw new Error('fin introuvable : ' + nom);
  return src.slice(d, f + 4);
}
let laboratoires = [];
function lbListe() { return laboratoires; }
eval(extraire('lbPlat'));
const lbClef = nom => lbPlat(nom);
eval(extraire('lbIndex'));
function lbParNom(nom, idx) { return (idx || lbIndex()).get(lbClef(nom)) || null; }
function lbParId(id) { return lbListe().find(f => f && f.id === id) || null; }
eval(extraire('lbDuDossier'));
eval(extraire('lbContactLitige'));
eval(extraire('lbNomsDesDossiers'));
eval(extraire('lbARattacher'));
eval(extraire('lbDistance'));
eval(extraire('lbProches'));
eval(extraire('lbDoublons'));
eval(extraire('lbAbsorber'));

let ok = 0, ko = 0;
const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };
console.log('\nLABORATOIRES — reconnaître sans confondre\n');

console.log('La clé d’identité');
t('la casse ne fait pas deux fournisseurs', lbClef('mkl') === lbClef('MKL'));
t('les accents non plus', lbClef('La Rosée') === lbClef('la rosee'));
t('la ponctuation non plus', lbClef('Eurodep / Panda Tea') === lbClef('Eurodep Panda Tea'));
t('les espaces en trop non plus', lbClef('  Pierre   Fabre ') === lbClef('Pierre Fabre'));
t('l’apostrophe non plus', lbClef('L’Oréal') === lbClef("L'Oreal"));
t('les chiffres comptent : 3M n’est pas M', lbClef('3M') !== lbClef('M'));
t('deux noms différents restent différents', lbClef('SVR') !== lbClef('SVP'));
t('le vide reste vide', lbClef('') === '' && lbClef(null) === '');

console.log('\nCe qu’on ose rapprocher, et ce qu’on n’ose pas');
t('même nom à la casse près : certain', lbProches('La Rosée', 'la rosee') === 'certain');
t('un nom qui en préfixe un autre : probable',
  lbProches('Pierre Fabre', 'Pierre Fabre Dermo') === 'probable');
t('une lettre d’écart sur un nom long : probable',
  lbProches('Expanscience', 'Expanscienze') === 'probable');
t('SVR et SVP ne sont PAS rapprochés : trois lettres, un fournisseur chacun',
  lbProches('SVR', 'SVP') === null);
t('un préfixe de trois lettres n’attrape pas tout',
  lbProches('URG', 'URGO France') === null);
t('deux noms sans rapport : rien', lbProches('Sanofi', 'Urgo') === null);
t('un nom vide ne rapproche rien', lbProches('', 'Sanofi') === null);

console.log('\nLes doublons du répertoire');
const F = (id, nom, o) => Object.assign({ id: id, nom: nom, alias: [], contacts: [] }, o || {});
let dbl = lbDoublons([F(1, 'La Rosée'), F(2, 'la rosee'), F(3, 'Sanofi')]);
t('un seul groupe repéré', dbl.length === 1);
t('... des deux bonnes fiches', dbl[0].fiches.map(f => f.id).sort().join() === '1,2');
t('... annoncé comme certain', dbl[0].degre === 'certain');
t('une fiche seule n’est jamais un doublon', lbDoublons([F(1, 'Sanofi')]).length === 0);
t('un répertoire vide ne casse rien', lbDoublons([]).length === 0 && lbDoublons(null).length === 0);
t('trois orthographes font UN groupe, pas trois paires',
  lbDoublons([F(1, 'MKL'), F(2, 'mkl'), F(3, 'M.K.L')])[0].fiches.length === 3);

console.log('\nCe que les dossiers appellent un laboratoire');
const dossiers = [
  { id: 1, labo: 'mkl' }, { id: 2, labo: 'MKL' }, { id: 3, labo: 'mkl' },
  { id: 4, labo: 'Sanofi' }, { id: 5, labo: '' }, { id: 6 }
];
const noms = lbNomsDesDossiers(dossiers);
t('trois orthographes de MKL comptent pour un seul nom', noms.size === 2);
t('... avec ses trois dossiers', noms.get(lbClef('mkl')).n === 3);
t('l’orthographe la plus fréquente est celle qu’on proposera',
  noms.get(lbClef('mkl')).texte === 'mkl');
t('un dossier sans laboratoire est ignoré, pas compté comme vide',
  !noms.has(''));

console.log('\nÀ rattacher');
laboratoires = [F(1, 'MKL Distribution', { alias: [] })];
let rat = lbARattacher(dossiers, lbIndex());
t('MKL n’est pas reconnu tant que l’alias manque', rat.some(e => e.texte === 'mkl'));
laboratoires = [F(1, 'MKL Distribution', { alias: ['mkl'] })];
rat = lbARattacher(dossiers, lbIndex());
t('l’alias posé, les trois dossiers sont reconnus', !rat.some(e => e.texte === 'mkl'));
t('... y compris écrit autrement : MKL retrouve sa fiche par la clé',
  lbParNom('MKL') === laboratoires[0]);
t('Sanofi reste à rattacher', rat.some(e => e.texte === 'Sanofi'));
t('les plus nombreux d’abord', lbARattacher(
  [{ labo: 'a' }, { labo: 'b' }, { labo: 'b' }], new Map())[0].texte === 'b');

console.log('\nLe dossier retrouve sa fiche');
laboratoires = [F(1, 'MKL Distribution', { alias: ['mkl'] }), F(2, 'Sanofi')];
const idx = lbIndex();
t('par le nom écrit', lbDuDossier({ labo: 'mkl' }, idx).id === 1);
t('par le lien explicite, même si le nom écrit dit autre chose',
  lbDuDossier({ labo: 'orthographe oubliée', laboId: 2 }, idx).id === 2);
t('le lien explicite passe AVANT le nom : un rattachement à la main ne se défait pas tout seul',
  lbDuDossier({ labo: 'mkl', laboId: 2 }, idx).id === 2);
t('un nom inconnu ne rend rien', lbDuDossier({ labo: 'Inconnu' }, idx) === null);
t('un dossier vide ne casse rien', lbDuDossier(null, idx) === null);

console.log('\nÀ qui l’on écrit');
t('le contact coché « litiges » passe avant le délégué', lbContactLitige({ contacts: [
  { nom: 'A', mail: 'a@x.fr' }, { nom: 'B', mail: 'b@x.fr', litiges: true }] }).nom === 'B');
t('sans case cochée, le premier qui a une adresse', lbContactLitige({ contacts: [
  { nom: 'A' }, { nom: 'B', mail: 'b@x.fr' }] }).nom === 'B');
t('coché mais sans adresse : on le propose quand même, c’est un choix humain',
  lbContactLitige({ contacts: [{ nom: 'A', mail: 'a@x.fr' }, { nom: 'B', litiges: true }] }).nom === 'B');
t('aucun contact : rien, pas un objet vide', lbContactLitige({ contacts: [] }) === null);
t('pas de fiche : rien', lbContactLitige(null) === null);

console.log('\nFusionner sans rien perdre de vue');
let g = F(1, 'MKL Distribution', { ville: 'Caen', contacts: [{ nom: 'DUPONT', mail: 'd@mkl.fr', litiges: true }] });
let a = F(2, 'mkl', { alias: ['M.K.L'], tel: '0231', ville: 'Lyon',
  contacts: [{ nom: 'MARTIN', mail: 'm@mkl.fr', litiges: true }] });
lbAbsorber(g, a);
t('le nom absorbé devient un alias : ses dossiers suivent',
  g.alias.some(x => lbClef(x) === lbClef('mkl')));
t('les alias de l’absorbée suivent aussi',
  g.alias.some(x => lbClef(x) === lbClef('M.K.L')));
t('ce que la fiche conservée n’avait pas, elle le prend', g.tel === '0231');
t('ce qu’elle avait, elle le garde : c’est elle qu’on a choisie', g.ville === 'Caen');
t('les deux contacts sont là', g.contacts.length === 2);
t('mais UN SEUL reste l’interlocuteur litiges',
  g.contacts.filter(c => c.litiges).length === 1);
t('... et c’est celui de la fiche conservée', g.contacts[0].nom === 'DUPONT');
t('la fusion est horodatée, sinon elle se perdrait à la synchro', g.updatedAt > 0);
g = F(1, 'Sanofi'); lbAbsorber(g, F(2, 'sanofi'));
t('une orthographe déjà couverte par la clé n’encombre pas les alias',
  g.alias.length === 0);
g = F(1, 'A', { contacts: [{ nom: 'X', mail: 'x@a.fr' }] });
lbAbsorber(g, F(2, 'B', { contacts: [{ nom: 'X', mail: 'x@a.fr' }] }));
t('le même contact des deux côtés ne fait pas deux lignes', g.contacts.length === 1);

console.log('\n' + ok + ' vérifications, ' + ko + ' échec(s)\n');
process.exit(ko ? 1 : 0);
