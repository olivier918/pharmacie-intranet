// Intervertir un nom et un prenom mal saisis. Le piege n'est pas l'echange :
// c'est que l'historique d'un patient est rapproche PAR LE NOM. Corriger la
// fiche sans laisser d'alias la viderait de ses livraisons a l'instant meme de
// la correction. Les fonctions sont extraites des fichiers reels.
// node essais/inversion-nom-prenom.js
const fs = require('fs'), path = require('path');
const pub = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
const ix = pub('index.html'), pt = pub('pt-module.js');

function blocIndex(nom) {
  const d = ix.indexOf('\nfunction ' + nom + '(');
  if (d < 0) throw new Error('fonction introuvable : ' + nom);
  const f = ix.indexOf('\n}\n', d);
  return ix.slice(d + 1, f + 3);
}
function winPt(nom) {
  const d = pt.indexOf('  window.' + nom + ' = function');
  if (d < 0) throw new Error('fonction introuvable : ' + nom);
  const f = pt.indexOf('\n  };\n', d);
  return pt.slice(d, f + 6);
}
// La cle d'identite du module patients, celle qui decide si deux ecritures
// designent la meme personne.
function ptPlat(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/['’`]/g, ' ')
    .replace(/[^A-Z0-9-]+/g, ' ').replace(/\s+/g, ' ').trim();
}
global.window = global;
window.ptClef = (n, p) => ptPlat(n) + '|' + ptPlat(p);
eval(blocIndex('capPrenom'));
eval(blocIndex('nomInverse'));
global.nomInverse = nomInverse;
var patients = [], choisi = null;
function saveNow() {}
window.ptRender = function () {};
eval(winPt('ptIntervertir'));

let ok = 0, ko = 0;
const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };
console.log('\nINVERSION NOM / PRÉNOM — corriger sans perdre l’historique\n');

console.log('L’échange et la convention de la maison');
t('le nom passe en capitales', nomInverse('JEAN', 'Dupont').nom === 'DUPONT');
t('le prénom se capitalise', nomInverse('JEAN', 'Dupont').prenom === 'Jean');
t('une fiche saisie tout en capitales ressort propre des deux côtés',
  nomInverse('CLAIRE', 'MARTIN').nom === 'MARTIN'
  && nomInverse('CLAIRE', 'MARTIN').prenom === 'Claire');
t('une saisie tout en minuscules aussi',
  nomInverse('jean', 'dupont').nom === 'DUPONT' && nomInverse('jean', 'dupont').prenom === 'Jean');
t('un prénom composé garde ses deux majuscules',
  nomInverse('JEAN-PIERRE', 'Durand').prenom === 'Jean-Pierre');
t('un prénom à apostrophe aussi', capPrenom("o'brien") === "O'Brien");
t('les accents ne déraillent pas', capPrenom('élise') === 'Élise');
t('deux prénoms séparés d’un espace', capPrenom('marie claire') === 'Marie Claire');
t('les espaces en trop sont mangés', nomInverse('  JEAN ', ' Dupont ').nom === 'DUPONT');

console.log('\nCe qu’on refuse de faire');
t('sans prénom, on n’intervertit pas : ce serait vider le nom',
  nomInverse('DUPONT', '') === null);
t('sans nom non plus', nomInverse('', 'Jean') === null);
t('des champs absents ne cassent rien',
  nomInverse(null, undefined) === null && nomInverse(undefined, null) === null);
t('un champ qui ne contient que des espaces vaut absent',
  nomInverse('DUPONT', '   ') === null);

console.log('\nLa fiche patient, et son historique');
patients = [{ id: 1, nom: 'JEAN', prenom: 'Dupont', dob: '1948-06-21' }];
choisi = 1;
ptIntervertir();
let p = patients[0];
t('la fiche porte enfin le bon nom', p.nom === 'DUPONT' && p.prenom === 'Jean');
t('l’ancienne écriture est gardée en ALIAS', (p.alias || []).length === 1);
t('... exactement telle qu’elle était saisie',
  p.alias[0].nom === 'JEAN' && p.alias[0].prenom === 'Dupont');
t('... c’est elle qui retient les livraisons déjà enregistrées',
  window.ptClef(p.alias[0].nom, p.alias[0].prenom) === window.ptClef('JEAN', 'Dupont'));
t('la fiche est horodatée, sinon la correction se perdrait à la synchro', p.updatedAt > 0);
t('le reste de la fiche n’a pas bougé', p.dob === '1948-06-21');

console.log('\nRevenir en arrière : deux clics, et rien ne traîne');
ptIntervertir();
p = patients[0];
t('le second clic remet tout en place', p.nom === 'JEAN' && p.prenom === 'Dupont');
t('... et l’alias devenu inutile disparaît',
  !(p.alias || []).some(a => window.ptClef(a.nom, a.prenom) === window.ptClef(p.nom, p.prenom)));
t('... sans laisser d’alias en double', (p.alias || []).length <= 1);

console.log('\nCe qui ne doit pas arriver');
patients = [{ id: 2, nom: 'MARTIN', prenom: '' }];
choisi = 2;
const avant = JSON.stringify(patients[0]);
try { ptIntervertir(); } catch (e) { /* l'alerte n'existe pas hors navigateur */ }
t('une fiche sans prénom n’est pas touchée', JSON.stringify(patients[0]) === avant);
patients = [{ id: 3, nom: 'A', prenom: 'B' }];
choisi = 99;
t('aucune fiche choisie : rien ne bouge',
  (ptIntervertir(), patients[0].nom === 'A'));

console.log('\nUn alias déjà présent');
patients = [{ id: 4, nom: 'JEAN', prenom: 'Dupont', alias: [{ nom: 'DUPOND', prenom: 'Jean' }] }];
choisi = 4;
ptIntervertir();
p = patients[0];
t('l’alias existant est conservé',
  p.alias.some(a => a.nom === 'DUPOND'));
t('... et le nouveau s’y ajoute', p.alias.length === 2);

console.log('\n' + ok + ' vérifications, ' + ko + ' échec(s)\n');
process.exit(ko ? 1 : 0);
