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

console.log('\n' + ok + ' vérifications, ' + ko + ' échec(s)\n');
process.exit(ko ? 1 : 0);
