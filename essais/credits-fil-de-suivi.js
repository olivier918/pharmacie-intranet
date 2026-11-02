// LE FIL DE SUIVI D'UN CRÉDIT — ce qui s'y inscrit, et ce qui s'y perdait.
// node essais/credits-fil-de-suivi.js
//
// CE QUI S'EST PASSÉ. On relance un patient par SMS, le SMS part, et le fil de
// suivi ne bouge pas. Rien n'est tombé en erreur : la relance a bien été
// écrite — dans un objet qui n'était plus dans la collection.
//
// Toutes les huit secondes, la resynchronisation REMPLACE les collections par
// celles du serveur. `credits` n'est plus le même tableau, et ses fiches ne
// sont plus les mêmes objets. Une fonction qui garde une fiche sous le coude
// PENDANT qu'on rédige un SMS — et rédiger un SMS prend plus de huit secondes —
// écrit donc à l'envoi dans un orphelin. L'écriture ne se voit nulle part et
// disparaît à la première sauvegarde.
//
// Le remède tient en une ligne par endroit : avant d'écrire après une attente,
// on redemande la fiche à la collection.
const fs = require('fs'), path = require('path');
const lire = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const ix = lire('public/index.html');

let ok = 0, ko = 0;
const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };
console.log('\nLE FIL DE SUIVI D’UN CRÉDIT\n');

// ── Le remède existe, et il est écrit une seule fois ───────────────────────
console.log('Retrouver une fiche après une attente');
t('UNE SEULE FONCTION POUR TOUTE L’APPLICATION', /function fraiche\(coll, id\)\{/.test(ix)
  && (ix.match(/function fraiche\(/g) || []).length === 1);
t('... elle passe par _collRef, donc par les vraies collections',
  /const l=_collRef\(coll\);/.test(ix));
t('... elle rend null plutôt que d’inventer', /return null;\n\}\nwindow\.fraiche=fraiche;/.test(ix));

// On l'execute : c'est une fonction de dix lignes, il n'y a aucune raison de
// se contenter de la lire.
const bloc = ix.slice(ix.indexOf('function fraiche(coll, id){'), ix.indexOf('window.fraiche=fraiche;'));
const COLL = { credits: [{ id: 1, nom: 'MARTIN' }, { id: 2, nom: 'DURAND' }] };
global._collRef = n => COLL[n];
const fraiche = eval('(' + bloc + ')');
t('elle retrouve la fiche par son identifiant', fraiche('credits', 2).nom === 'DURAND');
t('... y compris apres que la collection a ete remplacee', (function () {
  COLL.credits = JSON.parse(JSON.stringify(COLL.credits));   // la resynchronisation
  const f = fraiche('credits', 2);
  return f.nom === 'DURAND' && f === COLL.credits[1];        // l'objet de la NOUVELLE liste
})());
t('une collection inconnue ne la fait pas tomber', fraiche('inconnue', 1) === null);
t('un identifiant absent non plus', fraiche('credits', 99) === null);

// ── Les six endroits qui écrivaient dans le vide ───────────────────────────
// Tous suivent le même scénario : on ouvre la modale SMS, on rédige, on envoie,
// et le rappel `onSent` écrit. Entre les deux, huit secondes ont passé.
console.log('\nChaque envoi différé redemande sa fiche');
const od = lire('public/od-module.js'), pp = lire('public/pp-module.js');
t('LA RELANCE DE CRÉDIT PAR SMS — celle qui a été vue au comptoir',
  /const cf=fraiche\('credits',credId\)\|\|c;/.test(ix) && /credEnsureRelances\(cf\);/.test(ix)
  && /credTouche\(cf\);/.test(ix));
t('le lien de paiement envoyé par SMS', /const cf=fraiche\('credits',c\.id\)\|\|c;/.test(ix));
t('le SMS de livraison', /const df=fraiche\('deliveries',id\)\|\|d;/.test(ix));
t('le SMS de préparation prête', /const pf=fraiche\('preps',id\)\|\|p;/.test(ix));
t('la demande de document au patient', /const df = odListe\(\)\.find\(function \(x\) \{ return x && x\.id === d\.id; \}\) \|\| d;/.test(od));
t('LE LIEN DE PAIEMENT ENVOYÉ PAR MAIL — l’attente est celle du serveur de mail',
  /const cf=fraiche\('credits',c\.id\)\|\|c;\n\s*credEnsureRelances\(cf\);/.test(ix));
t('le SMS de préparation du module Préparations',
  /const pf = P\(\)\.find\(function \(x\) \{ return x && x\.id === p\.id; \}\) \|\| p;/.test(pp));
// LA PREUVE PAR L'ABSURDE : plus aucun de ces rappels n'écrit dans la fiche
// capturée avant l'attente.
t('PLUS AUCUN N’ÉCRIT DANS LA FICHE CAPTURÉE AVANT L’ATTENTE',
  !/onSent:\(r\)=>\{\s*\n\s*d\.smsAt=/.test(ix)
  && !/onSent:\(r\)=>\{\s*\n\s*p\.smsAt=/.test(ix)
  && !/credEnsureRelances\(c\);\s*\n\s*c\.relances\.push\(\{\s*\n\s*date:now/.test(ix));
// Et celles qui etaient deja correctes le restent : elles retrouvent leur
// fiche au moment ou elles s'executent, ce qui revient au meme.
t('celles qui retrouvaient déjà leur fiche sont inchangées',
  /function confirmCredMsg\(\)\{\n  const c=credits\.find/.test(ix)
  && /function credPayNoteEnvoi\(credId, canal, dest\)\{\n  const c=credits\.find/.test(ix));

// ── LE MONTANT EN JEU ──────────────────────────────────────────────────────
// Une relance se relit des mois plus tard, quand le dossier part chez
// l'huissier ou qu'un patient conteste. « Relance du 5 mai » ne dit rien ;
// « relance du 5 mai, 47,60 € dus » dit tout.
console.log('\nLe montant en jeu, sur chaque relance');
const blocM = ix.slice(ix.indexOf('function credRelMontant(r, c){'), ix.indexOf('function credAmountTxt(c){'));
const credRelMontant = eval('(' + blocM + ')');
t('une relance qui porte son montant l’affiche',
  credRelMontant({ montant: 47.6 }, { montant: 90 }).txt === '47.60 €');
t('... et il est marqué comme propre à cette relance',
  credRelMontant({ montant: 47.6 }, { montant: 90 }).propre === true);
// AUCUNE MIGRATION : les relances d'avant n'ont pas de montant. On affiche
// alors celui du dossier, EN LE DISANT — un chiffre d'aujourd'hui presente
// comme celui d'hier est un mensonge discret.
t('UNE RELANCE D’AVANT MONTRE LE MONTANT DU DOSSIER',
  credRelMontant({}, { montant: 90 }).txt === '90.00 €');
t('... et dit que c’est celui d’aujourd’hui', credRelMontant({}, { montant: 90 }).propre === false);
t('un produit avancé sans montant reste « à régulariser »',
  credRelMontant({}, { montant: 0 }).txt === 'À régulariser');
t('un zéro explicitement enregistré reste propre à la relance',
  credRelMontant({ montant: 0 }, { montant: 90 }).propre === true);
t('la ligne d’historique l’affiche, et dit lequel des deux c’est',
  /credRelMontant\(r,c\)\.txt/.test(ix) && /aujourd\\u2019hui|aujourd’hui/.test(ix));

// Chaque relance ecrite depuis aujourd'hui porte son montant.
console.log('\nChaque relance créée l’enregistre');
t('la saisie du crédit', /relances:\[\{date:jourSaisie[\s\S]{0,120}montant:\(obj\.montant\|\|0\)/.test(ix));
t('la relance orale ou téléphonique',
  /c\.relances\.push\(\{date, type:canal, etape, notes, by:currentUser\?\.id\|\|'\?', montant:\(c\.montant\|\|0\)\}\);/.test(ix));
t('la relance par SMS', /smsTo:r\.to\|\|null,\n\s*montant:\(cf\.montant\|\|0\),/.test(ix));
t('le courrier et le mail', /etape:e, subject, body, montant:\(c\.montant\|\|0\),/.test(ix));
t('LES QUATRE CANAUX, SANS EXCEPTION', (ix.match(/montant:\((?:c|cf|obj)\.montant\|\|0\)/g) || []).length >= 5);

console.log('\n' + ok + ' vérifications, ' + ko + ' échec(s)\n');
process.exit(ko ? 1 : 0);
