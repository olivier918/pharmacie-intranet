// D'ou vient le materiel loue. Le point sensible n'est pas la liste, c'est
// l'amorcage : une provenance ecrite dans un dossier et absente de la liste
// rendrait ce dossier orphelin de sa propre provenance. Les fonctions sont
// extraites de public/index.html lui-meme.
// node essais/provenance-materiel.js
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
function extraireBloc(nom) {
  const d = src.indexOf('\nfunction ' + nom + '(');
  if (d < 0) throw new Error('fonction introuvable : ' + nom);
  const f = src.indexOf('\n}\n', d);
  if (f < 0) throw new Error('fin introuvable : ' + nom);
  return src.slice(d + 1, f + 3);
}
// Le catalogue d'amorcage, lu dans le fichier reel : une valeur ajoutee la-bas
// et oubliee ici ferait passer cet essai a cote.
const mD = /const LOC_PROV_DEFAUT=\[[\s\S]*?\n\];/.exec(src);
if (!mD) throw new Error('LOC_PROV_DEFAUT introuvable');
eval(mD[0].replace('const ', 'var '));
var locProvDB = [];
var locations = [];
eval(extraireBloc('ensureLocProv'));
eval(extraireBloc('locProvLabel'));
eval(extraireBloc('locProvDefaut'));

let ok = 0, ko = 0;
const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };
console.log('\nPROVENANCE DU MATÉRIEL — à qui il appartient, où il repart\n');

console.log('L’amorçage');
locProvDB = []; locations = [];
t('la liste vide se remplit au premier affichage', ensureLocProv() === true && locProvDB.length === 3);
t('Bluestone y est', locProvDB.some(p => p.id === 'bluestone'));
t('le parc de la pharmacie aussi', locProvDB.some(p => p.id === 'pharmacie'));
t('Oxypharm aussi', locProvDB.some(p => p.id === 'oxypharm'));
t('une seule est proposée par défaut', locProvDB.filter(p => p.defaut).length === 1);
t('... et c’est celle-là que le formulaire présélectionne', locProvDefaut() === 'bluestone');
t('chacune est horodatée, sinon la fusion la perdrait', locProvDB.every(p => p.updatedAt > 0));
t('un second passage ne recrée rien', ensureLocProv() === false && locProvDB.length === 3);

console.log('\nAucun dossier orphelin de sa provenance');
locations = [{ id: 1, provenance: 'sadir' }, { id: 2, provenance: 'bluestone' }, { id: 3 }];
t('une provenance vue dans un dossier entre dans la liste', ensureLocProv() === true);
t('... une seule fois', locProvDB.filter(p => p.id === 'sadir').length === 1);
t('... sous le nom écrit, faute de mieux', locProvLabel('sadir') === 'sadir');
t('... et elle ne devient pas celle par défaut', locProvDefaut() === 'bluestone');
t('un dossier sans provenance n’ajoute pas de ligne vide',
  !locProvDB.some(p => !p.id));
t('la liste ne bouge plus au passage suivant', ensureLocProv() === false);

console.log('\nCe qui s’affiche');
t('le nom complet, pas l’identifiant', locProvLabel('bluestone') === 'Bluestone Medical');
t('une provenance absente reste lisible plutôt que vide', locProvLabel('zzz') === 'zzz');
t('pas de provenance : rien du tout, pas un tiret trompeur',
  locProvLabel('') === '' && locProvLabel(null) === '' && locProvLabel(undefined) === '');

console.log('\nQuand plus rien n’est coché par défaut');
locProvDB.forEach(p => { p.defaut = false; });
t('le formulaire ne présélectionne rien plutôt que d’inventer', locProvDefaut() === '');
locProvDB = [{ id: 'a', lbl: 'A' }, { id: 'b', lbl: 'B', defaut: true }, { id: 'c', lbl: 'C', defaut: true }];
t('deux cochées par accident : on en prend une, on n’échoue pas',
  locProvDefaut() === 'b');

console.log('\nCe qui ne doit pas casser');
locProvDB = null; locations = [];
t('une liste absente se recrée', ensureLocProv() === true && locProvDB.length === 3);
locations = [null, { id: 9, provenance: '' }];
t('une entrée nulle est ignorée', ensureLocProv() === false);

console.log('\n' + ok + ' vérifications, ' + ko + ' échec(s)\n');
process.exit(ko ? 1 : 0);
