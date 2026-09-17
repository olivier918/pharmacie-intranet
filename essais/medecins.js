// L'annuaire des medecins. Le prescripteur est ecrit en texte libre dans
// quatre endroits, et comme on l'a lu sur une ordonnance : « Dr Timsit »,
// « Dr TIMSIT Liliane », « Dr Liliane Timsit ». Ce qui se joue ici : les
// reconnaitre tous les trois SANS jamais confondre deux homonymes.
// node essais/medecins.js
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'md-module.js'), 'utf8');
function extraire(nom) {
  const d = src.indexOf('  function ' + nom + '(');
  if (d < 0) throw new Error('fonction introuvable : ' + nom);
  const f = src.indexOf('\n  }\n', d);
  if (f < 0) throw new Error('fin introuvable : ' + nom);
  return src.slice(d, f + 4);
}
// La liste des titres, lue dans le fichier reel : un titre ajoute la-bas et
// oublie ici ferait passer cet essai a cote.
const mT = /^  const MD_TITRES = .*$/m.exec(src);
if (!mT) throw new Error('MD_TITRES introuvable');
eval(mT[0].replace('const ', 'var '));
var medecins = [];
function mdListe() { return medecins; }
eval(extraire('mdPlat'));
eval(extraire('mdMots'));
eval(extraire('mdSignature'));
eval(extraire('mdSignatureFiche'));
eval(extraire('mdIndex'));
eval(extraire('mdRattacher'));
eval(extraire('mdEcritures'));
eval(extraire('mdARattacher'));
eval(extraire('mdProches'));
eval(extraire('mdDoublons'));
eval(extraire('mdAbsorber'));

let ok = 0, ko = 0;
const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };
console.log('\nANNUAIRE DES MÉDECINS — reconnaître sans confondre\n');

const F = (nom, prenom, o) => Object.assign({ id: 'md:' + nom, nom: nom, prenom: prenom || '', alias: [] }, o || {});

console.log('Le titre ne distingue personne');
t('« Dr » est retiré', mdSignature('Dr Timsit') === mdSignature('Timsit'));
t('« Docteur » aussi', mdSignature('Docteur Timsit') === mdSignature('Timsit'));
t('« Dr. » avec le point aussi', mdSignature('Dr. Timsit') === mdSignature('Timsit'));
t('« Pr » aussi', mdSignature('Pr Timsit') === mdSignature('Timsit'));
t('mais un nom qui commence par Dr reste entier',
  mdSignature('Drouet') === 'DROUET');

console.log('\nL’ordre cesse d’être une question');
t('« TIMSIT Liliane » et « Liliane Timsit » ont la même signature',
  mdSignature('TIMSIT Liliane') === mdSignature('Liliane Timsit'));
t('la casse n’y change rien', mdSignature('timsit') === mdSignature('TIMSIT'));
t('les accents non plus', mdSignature('Léa Morère') === mdSignature('LEA MORERE'));
t('un nom composé garde son trait d’union',
  mdSignature('Jean-Pierre') !== mdSignature('Jean Pierre'));
t('un texte vide ne signe rien', mdSignature('') === '' && mdSignature('Dr') === '');

console.log('\nRattacher : le nom seul suffit s’il est unique');
medecins = [F('TIMSIT', 'Liliane'), F('VICENTE', 'Paul'), F('CAUCHY', '')];
let idx = mdIndex();
t('« Dr Timsit » trouve sa fiche',
  mdRattacher('Dr Timsit', idx).medecin === medecins[0]);
t('... et le verdict est net', mdRattacher('Dr Timsit', idx).etat === 'sur');
t('« Dr TIMSIT Liliane » aussi',
  mdRattacher('Dr TIMSIT Liliane', idx).medecin === medecins[0]);
t('« Dr Liliane Timsit » aussi, malgré l’ordre inverse',
  mdRattacher('Dr Liliane Timsit', idx).medecin === medecins[0]);
t('une fiche sans prénom se retrouve par son nom',
  mdRattacher('Dr Cauchy', idx).medecin === medecins[2]);
t('un inconnu reste inconnu', mdRattacher('Dr Personne', idx).etat === 'inconnu');
t('... et ne désigne personne', mdRattacher('Dr Personne', idx).medecin === undefined);

console.log('\nDeux homonymes : on ne tranche pas à la place du préparateur');
medecins = [F('MARTIN', 'Claire'), F('MARTIN', 'Paul')];
idx = mdIndex();
t('« Dr Martin » ne désigne plus personne',
  mdRattacher('Dr Martin', idx).etat === 'homonyme');
t('... et le dit : deux candidats', mdRattacher('Dr Martin', idx).candidats.length === 2);
t('... aucun médecin n’est rendu', mdRattacher('Dr Martin', idx).medecin === undefined);
t('avec le prénom, le doute tombe',
  mdRattacher('Dr MARTIN Claire', idx).medecin === medecins[0]);
t('... même écrit dans l’autre sens',
  mdRattacher('Dr Paul Martin', idx).medecin === medecins[1]);

console.log('\nL’alias, ce qui retient les dossiers déjà écrits');
medecins = [F('TIMSIT', 'Liliane', { alias: ['Dr Timsitt'] }), F('MARTIN', 'Claire')];
idx = mdIndex();
t('une orthographe rattachée à la main est reconnue',
  mdRattacher('Dr Timsitt', idx).medecin === medecins[0]);
t('... sans être devenue le nom de la fiche', medecins[0].nom === 'TIMSIT');
t('une faute non rattachée reste inconnue',
  mdRattacher('Dr Timsi', idx).etat === 'inconnu');

console.log('\nCe qui reste à rattacher');
medecins = [F('TIMSIT', 'Liliane'), F('MARTIN', 'Claire'), F('MARTIN', 'Paul')];
idx = mdIndex();
const sources = [
  { texte: 'Dr Timsit', ou: 'location' }, { texte: 'Dr TIMSIT Liliane', ou: 'location' },
  { texte: 'Dr Martin', ou: 'préparation' }, { texte: 'Dr Martin', ou: 'location' },
  { texte: 'Dr Vallaeys', ou: 'bilan partagé' }, { texte: '', ou: 'cahier' }
];
let rat = mdARattacher(sources, idx);
t('ce qui est reconnu ne figure pas dans la file',
  !rat.some(e => /timsit/i.test(e.texte)));
t('un homonyme EST un travail à faire, pas un dossier réglé',
  rat.some(e => e.etat === 'homonyme'));
t('un inconnu aussi', rat.some(e => e.texte === 'Dr Vallaeys' && e.etat === 'inconnu'));
t('les deux « Dr Martin » ne comptent que pour une ligne',
  rat.filter(e => /martin/i.test(e.texte)).length === 1);
t('... avec ses deux dossiers',
  rat.find(e => /martin/i.test(e.texte)).n === 2);
t('... et d’où ils viennent',
  Object.keys(rat.find(e => /martin/i.test(e.texte)).ou).sort().join() === 'location,préparation');
t('les plus nombreux d’abord', rat[0].n >= rat[rat.length - 1].n);
t('un texte vide n’entre pas dans la file', !rat.some(e => !e.texte));

console.log('\nLes doublons de l’annuaire');
let dbl = mdDoublons([F('TIMSIT', 'Liliane'), F('timsit', 'liliane'), F('MARTIN', 'Claire')]);
t('mêmes mots, même personne : signalé comme certain',
  dbl.length === 1 && dbl[0].degre === 'certain');
dbl = mdDoublons([F('TIMSIT', 'Liliane'), F('TIMSIT', '')]);
t('même nom, un prénom manquant : probable',
  dbl.length === 1 && dbl[0].degre === 'probable');
dbl = mdDoublons([F('MARTIN', 'Claire'), F('MARTIN', 'Paul')]);
t('même nom mais deux prénoms connus : ce sont DEUX médecins, pas un doublon',
  dbl.length === 0);
t('l’ordre inversé est un doublon certain',
  mdProches(F('TIMSIT', 'Liliane'), F('LILIANE', 'Timsit')) === 'certain');
t('un annuaire vide ne casse rien', mdDoublons([]).length === 0 && mdDoublons(null).length === 0);

console.log('\nFusionner sans perdre de vue les dossiers');
let g = F('TIMSIT', 'Liliane', { spec: 'Généraliste' });
let a = F('TIMSIT', '', { alias: ['Dr Timsitt'], tel: '02 31 00', cabinet: 'MSP Mondeville' });
mdAbsorber(g, a);
t('ce que la fiche conservée n’avait pas, elle le prend', g.tel === '02 31 00');
t('... et le cabinet aussi', g.cabinet === 'MSP Mondeville');
t('ce qu’elle avait, elle le garde', g.spec === 'Généraliste');
t('les alias de l’absorbée suivent', g.alias.some(x => mdSignature(x) === mdSignature('Dr Timsitt')));
t('un nom absorbé déjà couvert par la signature n’encombre pas les alias',
  !g.alias.some(x => mdSignature(x) === mdSignatureFiche(g)));
t('la fusion est horodatée, sinon elle se perdrait à la synchro', g.updatedAt > 0);
g = F('TIMSIT', 'Liliane'); mdAbsorber(g, F('MORERE', 'Léa'));
t('un nom réellement différent part en alias', g.alias.length === 1);
medecins = [g];
t('... et il retrouve les dossiers écrits sous ce nom',
  mdRattacher('Dr Morère Léa', mdIndex()).medecin === g);

console.log('\n' + ok + ' vérifications, ' + ko + ' échec(s)\n');
process.exit(ko ? 1 : 0);
