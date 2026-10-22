// LA DATE DE NAISSANCE — ce qui distingue deux homonymes.
// node essais/date-de-naissance.js
//
// CE QUI SE JOUE. Deux patients du même nom, dans une officine, ça arrive
// toutes les semaines — et dans une famille, le père et le fils portent souvent
// le même prénom. Sans date, rien ne les sépare : une ordonnance se range au
// mauvais dossier, un crédit se réclame à la mauvaise personne, un SMS part au
// mauvais numéro. C'est la seule donnée qui distingue, et elle ne change jamais.
//
// ELLE EST DONC EXIGÉE À LA CRÉATION, PARTOUT. Et nulle part à la modification :
// les dossiers ouverts avant cette règle n'ont pas de date, personne ne la
// connaît forcément, et rouvrir une fiche pour corriger un téléphone ne doit
// pas se solder par un refus.
const fs = require('fs'), path = require('path');
const lire = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const ix = lire('public/index.html');

let ok = 0, ko = 0;
const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };
console.log('\nLA DATE DE NAISSANCE\n');

// ── La règle elle-même, exécutée ────────────────────────────────────────────
const bloc = (function () {
  const d = ix.indexOf('function dobExigee(');
  if (d < 0) throw new Error('dobExigee introuvable');
  return ix.slice(d, ix.indexOf('\n}', d) + 2);
}());
const conv = (function () {
  const d = ix.indexOf('function dobFr(');
  return ix.slice(d, ix.indexOf('function dobPoser(', d));
}());
let champ = { value: '' }, alerte = null, focus = 0;
global.document = { getElementById: function () { return champ; } };
global.alert = function (m) { alerte = m; };
champ.focus = function () { focus++; };
eval(conv);
eval(bloc);

// ── LE FORMAT FRANÇAIS ──────────────────────────────────────────────────────
// `<input type="date">` s'affiche dans la langue du NAVIGATEUR, pas de la page.
// Sur un poste réglé en anglais, le 3 avril se saisit « 04/03 » et devient le
// 4 mars sans que personne ne le voie. On tape donc en JJ/MM/AAAA.
console.log('Le format français');
t('une date de la base s’affiche en français', dobFr('1948-03-12') === '12/03/1948');
t('une valeur vide ne devient pas une date', dobFr('') === '' && dobFr(null) === '');
t('et le français revient en base au format qui se trie',
  dobIso('12/03/1948') === '1948-03-12');
t('LE 3 AVRIL RESTE LE 3 AVRIL — jamais le 4 mars',
  dobIso('03/04/1960') === '1960-04-03');
t('LE 31 FÉVRIER EST REFUSÉ — une Date l’aurait ramené au 3 mars en silence',
  dobIso('31/02/1960') === null);
t('le 29 février d’une année bissextile passe', dobIso('29/02/1960') === '1960-02-29');
t('... et celui d’une autre année, non', dobIso('29/02/1961') === null);
t('un mois à 13 est refusé', dobIso('01/13/1960') === null);
t('une date à venir est refusée — on ne naît pas demain', dobIso('01/01/2099') === null);
t('un format américain ne passe pas en douce', dobIso('1960-04-03') === null);
t('une saisie incomplète non plus', dobIso('03/04/60') === null && dobIso('3/4/1960') === null);

console.log('\nLes barres se posent toutes seules');
const tape = (txt) => { const e = { value: txt }; dobMasque(e); return e.value; };
t('deux chiffres, puis la barre', tape('12') === '12' && tape('123') === '12/3');
t('quatre chiffres, deux barres', tape('1203') === '12/03' && tape('12031') === '12/03/1');
t('huit chiffres font une date', tape('12031948') === '12/03/1948');
t('ON NE TAPE QUE DES CHIFFRES — le reste est ignoré', tape('12a03b1948') === '12/03/1948');
t('et on ne dépasse pas huit', tape('120319481234') === '12/03/1948');

console.log('\nLa règle');
champ.value = '12/03/1948';
t('une date française est rendue au format de la base',
  dobExigee('x', false) === '1948-03-12');
champ.value = '  12/03/1948  ';
t('les espaces autour ne gênent pas', dobExigee('x', false) === '1948-03-12');
champ.value = '99/99/1948'; alerte = null;
t('UNE DATE ILLISIBLE N’EST PAS UNE DATE VIDE — elle arrête aussi',
  dobExigee('x', false) === null);
t('... et le message dit le format attendu', /JJ\/MM\/AAAA/.test(alerte || ''));

champ.value = ''; alerte = null; focus = 0;
t('À LA CRÉATION, UNE DATE VIDE ARRÊTE TOUT', dobExigee('x', false) === null);
t('... et on dit pourquoi, pas seulement que c’est obligatoire',
  /homonyme/.test(alerte || ''));
t('... et le curseur se pose sur le champ fautif', focus === 1);

champ.value = ''; alerte = null;
t('À LA MODIFICATION, UNE DATE VIDE PASSE — on ne bloque jamais l’existant',
  dobExigee('x', true) === '');
t('... et sans alerter : ce n’est pas une faute', alerte === null);
champ.value = '12/03/1948';
t('une fiche ancienne qui reçoit une date la garde',
  dobExigee('x', true) === '1948-03-12');

// ── Les formulaires qui la demandent ────────────────────────────────────────
// Chacun passe par la MÊME règle, avec son propre drapeau d'édition : c'est ce
// drapeau qui dit « création » ou « modification », et il diffère d'un écran à
// l'autre.
console.log('\nChaque formulaire passe par la même règle');
const FORMULAIRES = [
  ['Livraisons', "dobExigee('d-dob', !!editId)"],
  ['Préparations', "dobExigee('p-dob', !!prepEditId)"],
  ['Locations', "dobExigee('lc-dob-pat', !!locEditId)"],
  ['Crédits', "dobExigee('cr-dob', !!credEditId)"],
  ['Fiche patient', "dobExigee('bp-dob', patEditIdx!==null)"]
];
FORMULAIRES.forEach(function (f) {
  t(f[0] + ' l’exige, et sait reconnaître une modification', ix.indexOf(f[1]) > 0);
});
t('chacun s’arrête vraiment quand la règle dit non',
  (ix.match(/dobExigee\([^)]*\); if\(dob[A-Za-z]*===null\) return;/g) || []).length >= 5);

console.log('\nPlus aucun champ de naissance au format du navigateur');
['p-dob', 'lc-dob-pat', 'nt-dob', 'cr-dob', 'bp-dob', 'd-dob', 'bon-dob', 'gir-dob', 'ap-dob']
  .forEach(function (id) {
    t(id + ' se saisit en JJ/MM/AAAA',
      ix.indexOf('placeholder="JJ/MM/AAAA" oninput="dobMasque(this)" id="' + id + '"') > 0);
  });
t('AUCUN NE RESTE EN type="date"',
  !/type="date" id="(p-dob|lc-dob-pat|nt-dob|cr-dob|bp-dob|d-dob|bon-dob|gir-dob|ap-dob)"/.test(ix));
t('ce qui part en base reste au format qui se trie',
  /return a\+'-'\+String\(mo\)\.padStart\(2,'0'\)\+'-'\+String\(j\)\.padStart\(2,'0'\);/.test(ix));
t('l’autocomplétion remplit le champ en français, pas en ISO',
  /if\(c\.dobId\) dobPoser\(c\.dobId, p\.dob\);/.test(ix));
t('les onze endroits qui posent une date passent par dobPoser',
  (ix.match(/dobPoser\(/g) || []).length >= 12);

console.log('\nLe champ existait-il seulement ?');
t('LIVRAISONS N’EN AVAIT AUCUN — il a été ajouté',
  /<label>Date de naissance <span class="req">\*<\/span><\/label><input [^>]*id="d-dob">/.test(ix));
t('il est posé juste après le prénom, là où on le cherche',
  ix.indexOf('id="d-prenom"') < ix.indexOf('id="d-dob"')
  && ix.indexOf('id="d-dob"') < ix.indexOf('id="d-adresse"'));
t('et la livraison enregistre bien la date', /const obj=\{\n?\s*nom,prenom,dob,/.test(ix));

console.log('\nL’étiquette le dit');
t('les champs obligatoires portent l’astérisque de la maison',
  (ix.match(/Date de naissance <span class="req">\*<\/span>/g) || []).length >= 5);

// ── L'exception, et elle est documentée ─────────────────────────────────────
console.log('\nLa seule exception');
t('LE CAHIER DE TRANSMISSION ACCEPTE UNE NOTE SANS PATIENT — un sujet, un médecin',
  /const dob=\(nom&&prenom\)\?dobExigee\('nt-dob', false\)/.test(ix));
t('... la date n’y est donc exigée que si l’on nomme quelqu’un',
  /:document\.getElementById\('nt-dob'\)\.value;/.test(ix));
t('... et c’est écrit dans le code, pas seulement vrai',
  /ACCEPTE UNE ENTRÉE SANS PATIENT/.test(ix));

// ── Les deux écrans hors index.html ─────────────────────────────────────────
console.log('\nLa création depuis une demande de document');
const od = lire('public/od-module.js');
t('elle exige la date', /if \(!lu\('od-n-dob'\)\) \{ dire\('La date de naissance est nécessaire/.test(od));

console.log('\nLes deux modules');
const rn = lire('public/rn-module.js');
t('le renouvellement se saisit en JJ/MM/AAAA aussi',
  /id="rn-dob" type="text"[^>]*placeholder="JJ\/MM\/AAAA"/.test(rn));
t('... et ce qu’il enregistre repasse en ISO',
  /dob: \(typeof dobIso==='function' \? \(dobIso\(g\('rn-dob'\)\.value\)\|\|''\)/.test(rn));
t('la création depuis une demande aussi',
  /id="od-n-dob" type="text"[^>]*JJ\/MM\/AAAA/.test(od));
t('... et elle refuse une date illisible',
  /Date de naissance : écrivez-la en JJ\/MM\/AAAA/.test(od));

console.log('\nLa page que le patient remplit lui-même');
const dep = lire('public/depot.html');
t('LA DATE N’Y EST PLUS « FACULTATIVE »',
  !/f-naissance[\s\S]{0,200}facultatif/.test(dep) && !/facultatif[\s\S]{0,200}f-naissance/.test(dep));
// ELLE RESTE EN `type="date"`, ET C'EST VOULU : le patient la remplit sur son
// propre téléphone, dans sa propre langue, avec le sélecteur natif — qui est
// bien meilleur au doigt qu'un champ à masque.
t('... mais elle garde le sélecteur natif : c’est le téléphone du patient',
  /<input type="date" id="f-naissance"/.test(dep));
t('... elle est vérifiée comme le nom et le prénom',
  /\['f-nom', 'f-prenom', 'f-naissance'\]/.test(dep));
t('... et le message dit à quoi elle sert',
  /arrive au bon dossier/.test(dep));
t('elle part bien avec le dépôt', /naissance: JETON \? '' : String\(\$\('f-naissance'\)\.value/.test(dep));

console.log('\n' + ok + ' vérifications, ' + ko + ' échec(s)\n');
process.exit(ko ? 1 : 0);
