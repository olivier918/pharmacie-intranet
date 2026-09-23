// La livraison du materiel loue. Un contrat dit ce qu'on facture ; il ne dit
// pas ce qu'il faut monter dans le camion. Un lit medicalise, c'est aussi un
// matelas, des barrieres et une potence - et un lit livre sans sa potence est
// un second aller-retour.
// node essais/livraison-location.js
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
// Une declaration sur une seule ligne, ou sur plusieurs : les deux existent
// dans index.html, et prendre l'une pour l'autre embarque la fonction suivante.
function bloc(nom) {
  const m = new RegExp('^function ' + nom + '\\(.*$', 'm').exec(src);
  if (m && /\}\s*$/.test(m[0])
      && (m[0].match(/\{/g) || []).length === (m[0].match(/\}/g) || []).length) return m[0];
  const d = src.indexOf('\nfunction ' + nom + '(');
  if (d < 0) throw new Error('fonction introuvable : ' + nom);
  const f = src.indexOf('\n}\n', d);
  if (f < 0) throw new Error('fin introuvable : ' + nom);
  return src.slice(d + 1, f + 3);
}
eval(bloc('dMat'));
eval(bloc('dCharges'));
eval(bloc('dToutCharge'));
eval(bloc('dSeriesAttendues'));
function dTermine(d){ return d && d.status === 'done'; }
eval(bloc('dSerieAFaire'));

let ok = 0, ko = 0;
const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };
console.log('\nLIVRAISON D’UNE LOCATION — le chargement et les numéros\n');

const M = () => ([
  { k: 'lit', lbl: 'Lit médicalisé', principal: true, avecSerie: true, charge: false, serie: '' },
  { k: 'lit:barG', lbl: 'Barrière gauche', avecSerie: false, charge: false },
  { k: 'lit:potence', lbl: 'Potence', avecSerie: false, charge: false },
  { k: 'deambulateur', lbl: 'Déambulateur', avecSerie: true, charge: false, serie: '' }
]);
const liv = (o) => Object.assign({ id: 1, status: 'wait', mat: M() }, o || {});

console.log('Le chargement du camion');
let d = liv();
t('rien n’est chargé au départ', dCharges(d) === 0);
t('... et la livraison n’est pas prête', dToutCharge(d) === false);
d.mat[0].charge = true; d.mat[1].charge = true;
t('deux sur quatre', dCharges(d) === 2);
t('... toujours pas prête — c’est tout l’intérêt de la liste', dToutCharge(d) === false);
d.mat.forEach(m => { m.charge = true; });
t('tout coché : prête', dToutCharge(d) === true);
t('une livraison sans matériel n’est jamais « prête » : elle n’a rien à charger',
  dToutCharge(liv({ mat: [] })) === false);
t('une livraison ordinaire n’a pas de liste', dMat({ id: 2 }).length === 0);
t('une liste absente ne casse rien', dMat(null).length === 0 && dCharges(null) === 0);

console.log('\nQui porte un numéro de série');
d = liv();
t('deux appareils en attendent un', dSeriesAttendues(d).length === 2);
t('... le lit', dSeriesAttendues(d).some(x => x.m.principal));
t('... et le déambulateur ajouté à la livraison',
  dSeriesAttendues(d).some(x => x.m.k === 'deambulateur'));
t('les accessoires n’en ont pas — une barrière n’est pas un appareil suivi',
  !dSeriesAttendues(d).some(x => /barri/i.test(x.m.lbl)));
t('l’indice est conservé, pour écrire au bon endroit',
  dSeriesAttendues(d)[0].i === 0);
d.mat[0].serie = 'LT-017';
t('un numéro déjà relevé ne se redemande pas', dSeriesAttendues(d).length === 1);
d.mat[3].serie = 'DA-441';
t('tout relevé : plus rien à demander', dSeriesAttendues(d).length === 0);

console.log('\nQuand on les demande');
d = liv({ status: 'wait' });
t('avant la livraison, on ne demande rien — l’appareil est encore au dépôt',
  dSerieAFaire(d) === false);
d.status = 'done';
t('une fois livrée, on les réclame', dSerieAFaire(d) === true);
d.mat.forEach(m => { if (m.avecSerie) m.serie = 'X'; });
t('... et plus une fois relevés', dSerieAFaire(d) === false);
t('une livraison sans matériel ne réclame jamais rien',
  dSerieAFaire(liv({ status: 'done', mat: [] })) === false);
t('une livraison ordinaire non plus', dSerieAFaire({ id: 3, status: 'done' }) === false);
t('rien du tout ne casse rien', dSerieAFaire(null) === false);

// ── La caution : trois etats, pas deux ──────────────────────────────────────
// « Oui » disait qu'une caution etait DUE, pas que le cheque etait dans le
// tiroir. Au retour, personne ne savait s'il fallait rendre un cheque ou en
// reclamer un.
eval(bloc('locCautionEtat'));

console.log('\nLa caution — reçue, en attente, ou pas de caution');
t('un dossier neuf porte son état', locCautionEtat({ cautionEtat: 'attente' }) === 'attente');
t('« oui » se lit tel quel', locCautionEtat({ cautionEtat: 'oui' }) === 'oui');
t('« non » aussi', locCautionEtat({ cautionEtat: 'non' }) === 'non');
// LECTURE AU LIEU DE MIGRATION : les dossiers ouverts avant ce changement
// n'ont pas de cautionEtat, et on ne reecrit pas le bloc pour le leur poser.
t('un ancien dossier avec caution se lit « reçue »', locCautionEtat({ caution: true }) === 'oui');
t('un ancien dossier sans caution se lit « non »', locCautionEtat({ caution: false }) === 'non');
t('un ancien dossier muet se lit « non »', locCautionEtat({}) === 'non');
t('rien du tout ne casse rien', locCautionEtat(null) === 'non');
t('une valeur inconnue retombe sur le booléen',
  locCautionEtat({ cautionEtat: 'peut-être', caution: true }) === 'oui');

// ── Ce qu'on emporte sans le facturer ───────────────────────────────────────
const mE = /const LIV_A_EMPORTER=\[[\s\S]*?\n\];/.exec(src);
if (!mE) throw new Error('LIV_A_EMPORTER introuvable');
eval(mE[0].replace('const', 'var'));
eval(bloc('livEmporterLbl'));

console.log('\nLe matériel à emporter, non facturé');
t('le matelas y est', livEmporterLbl('liv:matelas') === 'Matelas');
t('la table de lit aussi', livEmporterLbl('liv:tablelit') === 'Table de lit');
t('la chaise garde-robe aussi', livEmporterLbl('liv:chaisegarde') === 'Chaise garde-robe');
t('le déambulateur, demandé dès le premier jour, est là',
  livEmporterLbl('liv:deambulateur') === 'Déambulateur');
t('un identifiant du catalogue loué n’en fait pas partie', livEmporterLbl('lit') === null);
t('leurs identifiants sont préfixés, donc jamais confondus avec un type loué',
  LIV_A_EMPORTER.every(e => /^liv:/.test(e.k)));
t('aucun doublon dans la liste',
  new Set(LIV_A_EMPORTER.map(e => e.k)).size === LIV_A_EMPORTER.length);

// On ne releve pas le numero de serie d'un matelas : la regle est portee par
// `serie:false` a l'ajout, et relue par lcLivMateriel.
console.log('\nQui porte un numéro de série');
function sup(l) {   // la boucle de lcLivMateriel, telle qu'elle est ecrite
  const out = [];
  l.forEach(function (x) {
    const ap = (x.serie !== false);
    out.push(ap ? { k: x.k, lbl: x.lbl, avecSerie: true, charge: false, serie: '' }
                : { k: x.k, lbl: x.lbl, avecSerie: false, charge: false });
  });
  return out;
}
t('un appareil ajouté réclame son numéro',
  sup([{ k: 'fauteuil', lbl: 'Fauteuil', serie: true }])[0].avecSerie === true);
t('un matelas, non',
  sup([{ k: 'liv:matelas', lbl: 'Matelas', serie: false }])[0].avecSerie === false);
t('... et il n’a pas de case « serie » qui trainerait vide',
  sup([{ k: 'liv:matelas', lbl: 'Matelas', serie: false }])[0].serie === undefined);
t('un ajout d’avant ce changement, sans drapeau, reste un appareil',
  sup([{ k: 'lit', lbl: 'Lit' }])[0].avecSerie === true);

// ── L'adresse du patient, sur le contrat ────────────────────────────────────
// Elle vit dans l'annuaire, la seule a jour ; le dossier ne sert que de repli
// pour un contrat imprime avant l'enregistrement.
let patients = [];
eval(bloc('locPatient'));
eval(bloc('locAdresseLignes'));

console.log('\nL’adresse du patient sur le contrat');
patients = [{ nom: 'MARTIN', prenom: 'Claire', adresse: '12 rue des Lilas', cp: '14120', commune: 'Mondeville' }];
let a = locAdresseLignes({ nom: 'MARTIN', prenom: 'Claire' });
t('elle vient de l’annuaire', a.join('|') === '12 rue des Lilas|14120 Mondeville');
t('deux lignes, comme sur une enveloppe', a.length === 2);
t('la casse du nom ne change rien',
  locAdresseLignes({ nom: 'martin', prenom: 'CLAIRE' }).length === 2);

// Un contrat imprime avant d'enregistrer : la fiche n'existe pas encore.
patients = [];
a = locAdresseLignes({ nom: 'NOUVEAU', prenom: 'Patient', adresse: '3 place du Marché', cp: '14000', commune: 'Caen' });
t('à défaut de fiche, ce qui vient d’être saisi est repris',
  a.join('|') === '3 place du Marché|14000 Caen');

// L'ANNUAIRE L'EMPORTE : un patient qui a demenage a corrige sa fiche, pas le
// vieux dossier de location.
patients = [{ nom: 'MARTIN', prenom: 'Claire', adresse: '9 rue Neuve', cp: '14120', commune: 'Mondeville' }];
t('l’annuaire l’emporte sur le dossier',
  locAdresseLignes({ nom: 'MARTIN', prenom: 'Claire', adresse: 'ancienne adresse' })[0] === '9 rue Neuve');

patients = [];
t('sans rien, la ligne ne s’invente pas', locAdresseLignes({ nom: 'X', prenom: 'Y' }).length === 0);
t('une commune sans rue tient quand même sur une ligne',
  locAdresseLignes({ nom: 'X', prenom: 'Y', commune: 'Caen' }).join('|') === 'Caen');
t('un code postal sans commune aussi',
  locAdresseLignes({ nom: 'X', prenom: 'Y', cp: '14000' }).join('|') === '14000');
t('rien du tout ne casse rien', locAdresseLignes(null).length === 0);
t('les espaces parasites sont rognés',
  locAdresseLignes({ nom: 'X', prenom: 'Y', adresse: '  3 rue A  ', commune: ' Caen ' }).join('|') === '3 rue A|Caen');

// Le telephone du contrat suit exactement la meme regle : c'est le numero
// qu'on compose le jour ou le materiel n'est pas revenu.
eval(bloc('locTel'));
console.log('\nLe téléphone sur le contrat');
patients = [{ nom: 'MARTIN', prenom: 'Claire', tel: '06 01 02 03 04' }];
t('il vient de l’annuaire', locTel({ nom: 'MARTIN', prenom: 'Claire' }) === '06 01 02 03 04');
t('l’annuaire l’emporte sur le dossier',
  locTel({ nom: 'MARTIN', prenom: 'Claire', tel: '06 99 99 99 99' }) === '06 01 02 03 04');
patients = [];
t('à défaut de fiche, ce qui vient d’être saisi est repris',
  locTel({ nom: 'NOUVEAU', prenom: 'Patient', tel: '06 99 88 77 66' }) === '06 99 88 77 66');
t('sans numéro nulle part, rien ne s’invente', locTel({ nom: 'X', prenom: 'Y' }) === '');
t('le contrat écrit un tiret plutôt qu’une case vide',
  /const telLbl=locTel\(l\)\?hEsc\(locTel\(l\)\):'—';/.test(src));

console.log('\n' + ok + ' vérifications, ' + ko + ' échec(s)\n');
process.exit(ko ? 1 : 0);
