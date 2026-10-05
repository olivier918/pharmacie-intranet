// LA QUALIFICATION A LA VACCINATION. Ce qui se joue ici : une grille qui doit
// rester fidèle aux textes, un verdict qui décide si l'on peut signer, et une
// signature qui ne doit PAS changer la session du poste où elle est tapée.
// node essais/vaccination.js
const R = require('../rh');
const fs = require('fs'), path = require('path');
const rac = path.join(__dirname, '..');
const lire = f => fs.readFileSync(path.join(rac, f), 'utf8');
const src = lire('rh.js');
const id = lire('identite.js');
const vq = lire('public/vq-module.js');
const ix = lire('public/index.html');
const rhm = lire('public/rh-module.js');
const sv = lire('server.js');

let ok = 0, ko = 0;
const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };
console.log('\nQUALIFICATION À LA VACCINATION\n');

// ── LA GRILLE ───────────────────────────────────────────────────────────────
console.log('La grille');
const clefs = R.pointsGrille();
t('treize points', clefs.length === 13);
t('aucune clef en double', new Set(clefs).size === clefs.length);
t('deux blocs : le droit d’exercer, et ce qu’elle sait faire',
  R.GRILLE_VACCINATION.length === 2);
t('chaque point a un titre', R.GRILLE_VACCINATION.every(b => b.points.every(p => !!p.titre)));
t('la grille est versionnée — une qualification signée doit rester lisible',
  /^\d{4}-\d{2}-\d{2}$/.test(R.GRILLE_VERSION));

// LES POINTS QUI NE DOIVENT PAS DISPARAITRE. Ce sont ceux qui font la
// différence entre une check-list et une formalité.
console.log('\nLes points qu’on ne retire pas');
[['formation_admin', 'l’attestation de formation à l’administration'],
 ['declaration_ordre', 'la déclaration de l’activité à l’Ordre'],
 ['supervision', 'la supervision d’un préparateur par un pharmacien formé'],
 ['eligibilite', 'la vérification de l’éligibilité avant d’injecter'],
 ['consentement', 'le recueil du consentement'],
 ['anaphylaxie', 'la conduite devant une anaphylaxie'],
 ['dasri', 'l’élimination de l’aiguille en DASRI'],
 ['tracabilite', 'la traçabilité de l’injection']
].forEach(function (x) { t(x[1] + ' est dans la grille', clefs.indexOf(x[0]) >= 0); });

const tous = {};
R.GRILLE_VACCINATION.forEach(b => b.points.forEach(p => { tous[p.clef] = p; }));
t('l’anaphylaxie dit où est l’adrénaline et qu’on appelle le 15',
  /adrénaline/i.test(tous.anaphylaxie.titre) && /15/.test(tous.anaphylaxie.titre));
t('... et rappelle la surveillance de 15 minutes',
  /15 minutes/.test(tous.anaphylaxie.aide || ''));
t('l’éligibilité porte les deux âges : 11 ans, et 5 ans pour la Covid',
  /11 ans/.test(tous.eligibilite.aide) && /5 ans/.test(tous.eligibilite.aide));
t('la traçabilité nomme le lot, Mon espace santé et le médecin traitant',
  /lot/i.test(tous.tracabilite.aide) && /Mon espace santé/.test(tous.tracabilite.aide)
  && /médecin traitant/.test(tous.tracabilite.aide));
t('la formation à l’administration porte sa durée : 7 h dont 3 h 30 en présentiel',
  /7 h/.test(tous.formation_admin.aide) && /3 h 30/.test(tous.formation_admin.aide));
t('le DASRI dit de ne pas recapuchonner — c’est là que les piqûres arrivent',
  /recapuchonner/i.test(tous.dasri.titre));
t('les points portent la référence du texte qui les fonde',
  R.GRILLE_VACCINATION[0].points.filter(p => p.ref).length >= 4);
t('la déclaration va au conseil de l’Ordre, pas à l’ARS',
  /Ordre/.test(tous.declaration_ordre.titre) && !/ARS/.test(tous.declaration_ordre.titre));

// ── TROIS ETATS, PAS DEUX ───────────────────────────────────────────────────
// Un préparateur n'a pas à déclarer une activité de prescription. Sans « sans
// objet », il faudrait cocher pour mentir, ou brancher la grille sur le statut.
console.log('\nOui, non, et sans objet');
t('trois états', R.ETATS.length === 3 && R.ETATS.indexOf('so') >= 0);

const rep = (v) => { const o = {}; clefs.forEach(c => { o[c] = v; }); return o; };

let v = R.verdict(rep('oui'), '');
t('tout vérifié : on peut signer', v.ok === true && v.avecReserve === false);

v = R.verdict(rep('so'), '');
t('tout sans objet : on peut signer aussi — c’est au pharmacien d’en répondre', v.ok === true);

let partiel = rep('oui'); delete partiel.anaphylaxie;
v = R.verdict(partiel, '');
t('un point sans réponse bloque', v.ok === false);
t('... et il est nommé', v.manquants.length === 1 && v.manquants[0] === 'anaphylaxie');
t('... et le motif le dit en français', /sans réponse/.test(v.motif));

// LA DECISION D'OLIVIER : on peut qualifier avec réserve, mais la réserve doit
// être ECRITE. Une réserve vide serait une case cochée de plus.
console.log('\nLa réserve écrite');
let refus = rep('oui'); refus.formation_presc = 'non';
t('un point refusé sans réserve bloque', R.verdict(refus, '').ok === false);
t('... une réserve de trois caractères ne suffit pas', R.verdict(refus, 'ok').ok === false);
t('... le motif demande la réserve ET le délai', /réserve et le délai/.test(R.verdict(refus, '').motif));
v = R.verdict(refus, 'Attestation de prescription à fournir avant le 30 novembre.');
t('une vraie réserve débloque la signature', v.ok === true);
t('... et la qualification est marquée comme étant sous réserve', v.avecReserve === true);
t('un état inventé compte comme une absence de réponse',
  R.verdict(Object.assign(rep('oui'), { dasri: 'peut-être' }), '').ok === false);
t('une grille vide ne passe pas', R.verdict({}, '').ok === false);
t('une grille absente ne fait pas tomber le calcul', R.verdict(null, null).ok === false);

// ── QUI PEUT SIGNER ─────────────────────────────────────────────────────────
// « Préparateur en pharmacie » contient « pharmacie » et non « pharmacien ».
// Le test tient à une lettre : il est donc éprouvé dans les deux sens.
console.log('\nQui peut signer');
t('une pharmacienne adjointe le peut', R.estPharmacien({ poste: 'Pharmacienne adjointe' }) === true);
t('un pharmacien titulaire aussi', R.estPharmacien({ poste: 'Pharmacien titulaire' }) === true);
t('UN PRÉPARATEUR EN PHARMACIE NON — le mot « pharmacie » ne suffit pas',
  R.estPharmacien({ poste: 'Préparateur en pharmacie' }) === false);
t('une préparatrice non plus', R.estPharmacien({ poste: 'Préparatrice' }) === false);
t('un apprenti non plus', R.estPharmacien({ poste: 'Apprenti préparateur' }) === false);
t('un titulaire marqué administrateur le peut, quel que soit son libellé de poste',
  R.estPharmacien({ poste: 'Gérante', admin: true }) === true);
t('une fiche vide ne passe pas', R.estPharmacien(null) === false && R.estPharmacien({}) === false);

// ── L'ÉCHÉANCE ──────────────────────────────────────────────────────────────
console.log('\nUn an, avant chaque campagne grippe');
t('douze mois', R.QUALIF_MOIS === 12);
t('une qualification d’octobre vaut jusqu’en octobre suivant',
  R.echeanceQualif('2026-10-05') === '2027-10-05');
t('le 29 février ne glisse pas au 1er mars', R.echeanceQualif('2024-02-29') === '2025-02-28');

// ── LA SIGNATURE ────────────────────────────────────────────────────────────
// LE DÉFAUT QUE CE MODULE POUVAIT INTRODUIRE : le pharmacien tape son code sur
// le poste d'un collègue, et le collègue se retrouve connecté sous son nom.
console.log('\nSigner n’est pas se connecter');
t('identite.js sait vérifier un code sans ouvrir de session',
  /async function signataire\(req, pin, data\)/.test(id));
t('... et il ne pose AUCUN cookie en le faisant',
  !/poserCookie/.test(id.slice(id.indexOf('async function signataire'),
                              id.indexOf('function installer'))));
t('... ni ne journalise une ouverture de session',
  !/Ouverture de session/.test(id.slice(id.indexOf('async function signataire'),
                                        id.indexOf('function installer'))));
t('le freinage est le même que celui de la porte d’entrée',
  /function signataire[\s\S]{0,400}freine\(req\)/.test(id)
  && /function signataire[\s\S]{0,900}noterEchec\(req\)/.test(id));
t('il parcourt toute l’équipe sans court-circuit — le temps de réponse ne doit rien dire',
  /function signataire[\s\S]{0,1200}&& !trouve\) trouve = s;/.test(id));
t('il ne rend jamais les secrets de la fiche',
  /function signataire[\s\S]{0,1400}SECRETS_STAFF\.forEach/.test(id));
t('il est exporté', /qui, signataire, empreinte/.test(id));
t('le serveur le prête au module RH', /signataire: async \(req, code\) => identite\.signataire/.test(sv));

// ── CE QUI REMONTE DANS L'ESPACE RH ─────────────────────────────────────────
console.log('\nLa remontée dans le suivi RH');
t('la qualification crée l’habilitation toute seule',
  /INSERT INTO app_rh_habilitations[\s\S]{0,200}Vaccination — qualification/.test(src));
t('... et remplace la précédente au lieu d’en empiler une par an',
  /DELETE FROM app_rh_habilitations WHERE uid = \$1 AND libelle = 'Vaccination — qualification'/.test(src));
t('la réserve est signalée dans l’habilitation', /avec réserve/.test(src));
t('la grille signée est conservée avec sa version',
  /INSERT INTO app_rh_qualifications[\s\S]{0,160}version/.test(src));
t('... et seules les clefs connues sont enregistrées — pas ce que le poste a envoyé',
  /pointsGrille\(\)\.forEach\(function \(c\) \{ propres\[c\] = b\.reponses\[c\]; \}\)/.test(src));
t('la signature part au journal des accès', /qualification vaccination/.test(src));
t('la fiche RH montre les qualifications', /function rhBlocQualifications/.test(rhm));
t('... et la grille s’y relit point par point', /rhQualif/.test(rhm) && /q\.reponses/.test(rhm));
t('on ne corrige pas une qualification depuis la fiche : on la refait',
  !/api\/rh\/qualif[a-z-]*modifier/.test(rhm));

// ── L'ÉCRAN ─────────────────────────────────────────────────────────────────
console.log('\nL’écran de l’espace général');
t('il est dans l’espace général, pas dans le planning',
  /id="vq-host"/.test(ix) && /onclick="vqOuvrir\(\)"/.test(ix));
t('la grille vient du serveur, elle n’est pas recopiée dans l’écran',
  !/formation_admin/.test(vq) && /vqEtat\.grille|j\.grille/.test(vq));
t('le verdict est affiché AVANT le clic — un bouton qui refuse après coup fait tout perdre',
  /b\.disabled = !!motif/.test(vq));
t('le champ du code est masqué', /type="password" id="vq-code"/.test(vq));
t('... et il est vidé dès qu’il est refusé', /c\.value = ''; c\.focus\(\)/.test(vq));
t('l’écran dit que le code ne change pas la session du poste',
  /ne change pas la session de ce poste/.test(vq));
t('la réserve n’apparaît que si un point est refusé',
  /refuses\.length[\s\S]{0,120}vq-reserve/.test(vq));
t('un gestionnaire ne reçoit qu’un indice et un état, jamais du texte saisi',
  /onclick="vqRepondre\(' \+ i \+ ',\\'' \+ k/.test(vq));
t('« qui peut vacciner » signale aussi ce qui va périmer',
  /jours <= 60/.test(vq) && /bientot/.test(vq));
t('la fiche papier est proposée, pas imposée',
  /window\.vqImprimer = function/.test(vq) && /Imprimer la fiche/.test(vq));

// ── LE FEU D'ARTIFICE ───────────────────────────────────────────────────────
// Une animation plein écran qu'on n'a pas demandée peut faire mal : troubles
// vestibulaires, migraines. Le réglage système existe, il se lit.
console.log('\nLe feu d’artifice');
t('il part quand le serveur a dit oui, pas avant',
  /if \(!j \|\| !j\.ok\)[\s\S]{0,400}vqFeu\(\);/.test(vq));
t('IL SE TAIT SI LE SYSTÈME DEMANDE MOINS D’ANIMATIONS',
  /prefers-reduced-motion: reduce/.test(vq)
  && /if \(vqAnimationsCoupees\(\)\) return false;/.test(vq));
t('... et la lecture du réglage ne fait pas tomber la page si elle échoue',
  /catch \(e\) \{ return false; \}/.test(vq));
t('on peut cliquer à travers pendant qu’il brûle',
  /#vq-feu\{[^}]*pointer-events:none/.test(vq));
t('il est invisible pour un lecteur d’écran', /aria-hidden/.test(vq));
t('il ne se superpose pas à lui-même',
  /if \(document\.getElementById\('vq-feu'\)\) return false;/.test(vq));
t('il se range — un canevas plein écran oublié coûte une trame sur deux',
  /cancelAnimationFrame\(trame\)[\s\S]{0,160}c\.remove\(\)/.test(vq));
t('... et il retire l’écouteur de redimensionnement avec lui',
  /removeEventListener\('resize', mesurer\)/.test(vq));
// LE DEFAUT QUE LA PREMIERE VERSION PORTAIT : la vitesse etait comptee en
// trames. Sur un ecran a 120 Hz, le feu partait deux fois trop vite.
t('IL EST CALÉ SUR LE TEMPS, PAS SUR LA CADENCE DE L’ÉCRAN',
  /const dt = Math\.min\(2\.5/.test(vq) && /CADENCE = 1000 \/ 60/.test(vq));
t('... la pesanteur des obus suit le temps', /o\.vy \+= G_OBUS \* dt/.test(vq));
t('... celle des éclats aussi', /e\.vy \+= 0\.105 \* dt/.test(vq));
t('... le frottement de l’air aussi, en puissance et non en produit',
  /Math\.pow\(0\.986, dt\)/.test(vq));
t('... et l’effacement des traînées aussi', /0\.26 \* dt/.test(vq));
t('un onglet revenu au premier plan ne projette pas tout d’un coup',
  /Math\.min\(2\.5, Math\.max\(0\.2/.test(vq));
t('la hauteur d’éclatement se calcule, elle ne se devine pas',
  /Math\.sqrt\(2 \* G_OBUS \* montee\)/.test(vq));
t('les couleurs sont celles de la maison, en version soutenue',
  /#2E7D54/.test(vq) && /#D26E96/.test(vq) && !/#F2F7F4/.test(vq));
t('on ne peint pas en « lighter » : c’est le mode des feux sur ciel noir',
  /globalCompositeOperation = 'source-over'/.test(vq)
  && !/globalCompositeOperation = 'lighter'/.test(vq));

console.log('\n' + ok + ' vérifications, ' + ko + ' échec(s)\n');
process.exit(ko ? 1 : 0);
