// LA DATE DE NAISSANCE DANS LE FORMULAIRE DE LIVRAISON.
// node essais/livraison-naissance.js
//
// CE QUI S'EST PASSE. Le champ « date de naissance » a ete ajoute au
// formulaire de livraison, mais rien ne l'a branche : il n'etait ni vide a
// l'ouverture, ni rempli a la modification, ni repris quand on choisit un
// patient connu, ni transmis a la fiche patient. Deux consequences, et la
// premiere est silencieuse :
//
//   1. LA DATE DU PATIENT PRECEDENT RESTAIT DANS LE CHAMP. On enchaine dix
//      livraisons au comptoir ; a la deuxieme, la date affichee est celle de
//      la premiere, et personne ne la relit puisqu'elle est deja remplie. La
//      livraison part alors avec la date de quelqu'un d'autre — exactement ce
//      que la date etait censee empecher.
//   2. LA FICHE PATIENT NE LA RECEVAIT JAMAIS. On la ressaisissait a chaque
//      livraison, et l'annuaire restait incapable de separer deux homonymes.
//
// On ne verifie donc pas le texte du fichier : ON EXECUTE les vraies fonctions
// contre un document de poche, et on enchaine deux patients comme au comptoir.
const fs = require('fs'), path = require('path');
const ix = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

let ok = 0, ko = 0;
const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };
console.log('\nLA DATE DE NAISSANCE EN LIVRAISON\n');

// ── Le document de poche ───────────────────────────────────────────────────
const champs = {};
function champ(id) {
  if (!champs[id]) champs[id] = { id: id, value: '', checked: false, textContent: '',
                                  style: {}, dataset: {}, focus: function () {} };
  return champs[id];
}
global.document = { getElementById: champ };
let alerte = null;
global.alert = function (m) { alerte = m; };
global.deliveries = [];
global.patients = [];
global.currentUser = { id: 'OF' };
global.nowStamp = function () { return '2026-11-02 09:00'; };
// UNE HORLOGE QUI AVANCE A COUP SUR. L'identifiant d'une livraison est
// `Date.now()` : deux livraisons enregistrees dans la meme milliseconde
// porteraient le meme, et le test retrouverait la mauvaise. Au comptoir cela
// n'arrive pas — ici, si, puisque rien ne nous ralentit.
let horloge = 1762070400000;
Date.now = function () { return horloge++; };
global.renderD = function () {};
global.majFabLiv = function () {};
global.formEnVue = function () {};
global.psResPatients = [];

// ── Les vraies fonctions, prises dans la page ──────────────────────────────
function prendre(nom) {
  const d = ix.indexOf('function ' + nom + '(');
  if (d < 0) throw new Error(nom + ' introuvable dans index.html');
  // Une fonction d'une seule ligne se referme sur cette ligne ; les autres se
  // referment sur une accolade en debut de ligne. Aller chercher « \n} » pour
  // une fonction d'une ligne avalerait la suivante.
  const ligne = ix.slice(d, ix.indexOf('\n', d));
  if (ligne.trim().slice(-1) === '}') return ligne;
  const f = ix.indexOf('\n}', d);
  return ix.slice(d, f + 2);
}
['dobFr', 'dobIso', 'dobMasque', 'dobPoser', 'dobExigee', 'upsertPatient',
 'openDForm', 'closeDForm', 'saveD', 'fillP'].forEach(function (n) {
  global[n] = eval('(' + prendre(n) + ')');
});
// Les fonctions s'appellent entre elles : elles doivent se voir.
['dobFr', 'dobIso', 'dobPoser', 'dobExigee', 'upsertPatient', 'closeDForm',
 'majFabLiv', 'formEnVue'].forEach(function (n) { global[n] = global[n]; });

function saisir(nom, prenom, dobFrSaisie) {
  champ('d-nom').value = nom;
  champ('d-prenom').value = prenom;
  if (dobFrSaisie !== undefined) champ('d-dob').value = dobFrSaisie;
  champ('d-adresse').value = ''; champ('d-commune').value = '';
  champ('d-tel').value = ''; champ('d-lieu').value = 'Domicile';
  champ('d-montant').value = ''; champ('d-date').value = '2026-11-02';
  champ('d-heure').value = ''; champ('d-notes').value = ''; champ('d-prepnotes').value = '';
}

// ── Deux patients de suite, comme au comptoir ──────────────────────────────
console.log('Deux livraisons enchaînées');
champ('dv-date').value = '2026-11-02';
openDForm();
saisir('MARTIN', 'Jean', '12/03/1948');
champ('d-lieu').value = 'EHPAD';
alerte = null;
saveD();
t('la première livraison s’enregistre', deliveries.length === 1 && alerte === null);
t('... avec sa date de naissance, en ISO', deliveries[0].dob === '1948-03-12');
// LA FICHE PATIENT. C'est elle qui porte la date pour toutes les fois suivantes.
t('LA FICHE PATIENT REÇOIT LA DATE', patients.length === 1 && patients[0].dob === '1948-03-12');
t('... et son identifiant la porte, pour départager les homonymes',
  /#1948-03-12$/.test(patients[0].id));

// Patient suivant : le formulaire se rouvre.
openDForm();
t('LE CHAMP EST VIDE POUR LE PATIENT SUIVANT', champ('d-dob').value === '');
t('... et la recherche de patient aussi', champ('ps-q').value === '');
// LE LIEU EST DE LA MEME FAMILLE : reste sur « EHPAD », il part avec la
// livraison suivante, qui va au domicile.
t('... et le lieu revient au domicile', champ('d-lieu').value === 'Domicile');

// Et sans date, on ne passe pas : c'est la regle de la maison a la creation.
saisir('MARTIN', 'Jeanne', '');
alerte = null;
saveD();
t('UNE CRÉATION SANS DATE EST REFUSÉE', deliveries.length === 1 && /nécessaire/.test(alerte || ''));

champ('d-dob').value = '04/07/1951';
alerte = null;
saveD();
t('... la même famille passe avec sa propre date', deliveries.length === 2
  && deliveries[0].dob === '1951-07-04');
t('... ET CE SONT BIEN DEUX FICHES, PAS UNE', patients.length === 2
  && patients[0].dob !== patients[1].dob);

// ── Rouvrir une livraison ──────────────────────────────────────────────────
console.log('\nRouvrir une livraison existante');
openDForm(deliveries[1].id);
t('LA DATE ENREGISTRÉE REVIENT À L’ÉCRAN, en français', champ('d-dob').value === '12/03/1948');
alerte = null;
saveD();
t('... et elle repart en ISO, inchangée', deliveries[1].dob === '1948-03-12');
// UNE LIVRAISON ANCIENNE N'A PAS DE DATE, et on ne bloque pas une correction
// de telephone pour autant.
deliveries[1].dob = '';
openDForm(deliveries[1].id);
t('une livraison d’avant la règle rouvre avec un champ vide', champ('d-dob').value === '');
alerte = null;
saveD();
t('... et se laisse corriger sans exiger la date', alerte === null);

// ── Choisir un patient connu ───────────────────────────────────────────────
console.log('\nChoisir un patient déjà connu');
openDForm();
champ('d-dob').value = '31/12/1999';          // reste d'une saisie precedente
psResPatients = [patients[0]];
fillP(0);
t('SA DATE REMPLACE CELLE QUI TRAÎNAIT À L’ÉCRAN', champ('d-dob').value === '12/03/1948');
t('... et son nom suit', champ('d-nom').value === 'MARTIN');

console.log('\n' + ok + ' vérifications, ' + ko + ' échec(s)\n');
process.exit(ko ? 1 : 0);
