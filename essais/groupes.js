// Les groupes de l'officine, des deux cotes : le nom qui s'affiche en tete
// d'une conversation, et la tache confiee a plusieurs. Les fonctions sont
// extraites de public/mp-module.js et public/ac-module.js eux-memes.
// node essais/groupes.js
const fs = require('fs'), path = require('path');
const lire = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
const MP = lire('mp-module.js'), AC = lire('ac-module.js');

function extraire(src, nom) {
  const d = src.indexOf('  function ' + nom + '(');
  if (d < 0) throw new Error('fonction introuvable : ' + nom);
  // Une declaration sur une seule ligne se ferme avant le premier saut.
  const finLigne = src.indexOf('\n', d);
  const ligne = src.slice(d, finLigne);
  if (/\}\s*$/.test(ligne) && (ligne.match(/\{/g) || []).length === (ligne.match(/\}/g) || []).length) return ligne;
  const f = src.indexOf('\n  }\n', d);
  if (f < 0) throw new Error('fin introuvable : ' + nom);
  return src.slice(d, f + 4);
}

let ok = 0, ko = 0;
const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };

// ── La messagerie ──────────────────────────────────────────────────────────
// mpTitre et mpGroupeDe empruntent trois choses au module : qui je suis, la
// liste des groupes, et comment on ecrit un prenom.
let MOI = 'of';
let GROUPES = [];
function mpUser() { return { id: MOI }; }
function mpGroupes() { return GROUPES; }
function mpPrenom(id) { return ({ of: 'Olivier', ma: 'Marie', cl: 'Claire', ju: 'Julien', pa: 'Paul' })[id] || id; }
eval(extraire(MP, 'mpGroupeDe'));
eval(extraire(MP, 'mpTitre'));

console.log('\nMESSAGERIE — le nom du groupe en tête de conversation\n');
console.log('Reconnaître le groupe');
GROUPES = [
  { id: 1, nom: 'PDA', membres: ['ma', 'cl', 'ju'] },
  { id: 2, nom: 'Comptoir', membres: ['of', 'ma', 'pa'] }   // un groupe où je suis
];
t('les destinataires du groupe : c’est le groupe',
  (mpGroupeDe(['ma', 'cl', 'ju'], MOI) || {}).nom === 'PDA');
t('l’ordre des cases cochées n’y change rien',
  (mpGroupeDe(['ju', 'ma', 'cl'], MOI) || {}).nom === 'PDA');
t('un groupe où je figure : ma présence ne compte pas',
  (mpGroupeDe(['ma', 'pa'], MOI) || {}).nom === 'Comptoir');
t('une personne EN PLUS : ce n’est plus le groupe',
  mpGroupeDe(['ma', 'cl', 'ju', 'pa'], MOI) === null);
t('une personne EN MOINS : ce n’est plus le groupe',
  mpGroupeDe(['ma', 'cl'], MOI) === null);
t('à une seule personne, jamais de groupe',
  mpGroupeDe(['ma'], MOI) === null && mpGroupeDe([], MOI) === null);
t('aucun groupe composé : rien ne casse',
  (GROUPES = [], mpGroupeDe(['ma', 'cl'], MOI)) === null);

console.log('\nCe qui s’affiche en tête');
const conv = (o) => Object.assign({ membres: ['of', 'ma', 'cl', 'ju'] }, o);
t('adressée à un groupe : le nom du groupe',
  mpTitre(conv({ groupeNom: 'PDA' })) === 'PDA');
t('... et pas la liste des prénoms',
  mpTitre(conv({ groupeNom: 'PDA' })).indexOf('Marie') < 0);
t('un titre écrit à la main passe avant le groupe',
  mpTitre(conv({ groupeNom: 'PDA', titre: 'Audit du 12' })) === 'Audit du 12');
t('sans groupe, les prénoms des autres, moi excepté',
  mpTitre(conv({})) === 'Marie, Claire, Julien');
t('une conversation avec moi-même reste « Moi »',
  mpTitre({ membres: ['of'] }) === 'Moi');
console.log('\nLes conversations d’avant, traduites à la lecture');
GROUPES = [{ id: 1, nom: 'PDA', membres: ['ma', 'cl', 'ju'] }];
t('une conversation d’avant retrouve son groupe',
  mpTitre({ membres: ['of', 'ma', 'cl', 'ju'] }) === 'PDA');
t('... mais pas si quelqu’un d’autre y figure',
  mpTitre({ membres: ['of', 'ma', 'cl', 'ju', 'pa'] }) === 'Marie, Claire, Julien, Paul');
t('« groupeNom » à vide veut dire « cherché, ce n’est pas un groupe »',
  mpTitre({ membres: ['of', 'ma', 'cl', 'ju'], groupeNom: '' }) === 'Marie, Claire, Julien');
t('à deux, on ne cherche pas de groupe',
  mpTitre({ membres: ['of', 'ma'] }) === 'Marie');

console.log('\nCe qui reste écrit une fois pour toutes');
t('un groupe supprimé depuis : le nom tenu reste affiché',
  (GROUPES = [], mpTitre(conv({ groupeNom: 'PDA' }))) === 'PDA');
t('... et un groupe renommé ne réécrit pas une conversation déjà tenue',
  (GROUPES = [{ id: 1, nom: 'PDA 2027', membres: ['ma', 'cl', 'ju'] }],
   mpTitre(conv({ groupeId: 1, groupeNom: 'PDA' }))) === 'PDA');

// ── La todo ────────────────────────────────────────────────────────────────
eval(extraire(AC, 'acReplier'));
eval(extraire(AC, 'acLotNeuf'));
eval(extraire(AC, 'acTachesDeGroupe'));

console.log('\n\nTODO — une tâche confiée à un groupe\n');
console.log('Une tâche par personne');
const PDA = { id: 1, nom: 'PDA', membres: ['ma', 'cl', 'ju'] };
let l = acTachesDeGroupe(PDA, 'Relire la procédure', 'of', 1000, []);
t('trois personnes, trois tâches', l.length === 3);
t('... une pour chacune', l.map(x => x.pour).sort().join() === 'cl,ju,ma');
t('... le même texte', l.every(x => x.texte === 'Relire la procédure'));
t('... le même demandeur', l.every(x => x.par === 'of'));
t('... et le même lot, sinon elles ne se replient plus',
  l.every(x => x.lot === l[0].lot) && l[0].lot === 1000);
t('le nom du groupe est recopié sur chaque tâche',
  l.every(x => x.lotNom === 'PDA'));
t('aucune n’est faite d’avance', l.every(x => x.fait === false));
t('chacune porte son updatedAt — sans lui, rien ne se synchronise',
  l.every(x => x.updatedAt === 1000));

console.log('\nDes identifiants qui n’écrasent rien');
t('trois identifiants distincts', new Set(l.map(x => x.id)).size === 3);
const dejaLa = [{ id: 1000 }, { id: 1001 }, { id: 1003 }];
l = acTachesDeGroupe(PDA, 'x', 'of', 1000, dejaLa);
t('les identifiants déjà pris sont enjambés',
  l.every(x => !dejaLa.some(d => d.id === x.id)));
t('... et restent distincts entre eux', new Set(l.map(x => x.id)).size === 3);
t('un membre en double ne donne pas deux tâches',
  acTachesDeGroupe({ nom: 'X', membres: ['ma', 'ma', 'cl'] }, 'x', 'of', 1, []).length === 2);
t('un groupe vide ne fabrique rien',
  acTachesDeGroupe({ nom: 'X', membres: [] }, 'x', 'of', 1, []).length === 0
  && acTachesDeGroupe(null, 'x', 'of', 1, []).length === 0);

console.log('\nCe que voit celui qui a confié');
const lot = (faits, vus) => ['ma', 'cl', 'ju'].map((p, i) => ({
  id: i, lot: 77, lotNom: 'PDA', texte: 'Relire', par: 'of', pour: p,
  fait: i < faits, vuPar: i < vus ? 1 : null
}));
let r = acReplier(lot(1, 0));
t('trois tâches identiques tiennent sur UNE ligne', r.length === 1);
t('... qui garde les trois pour compter', r[0].taches.length === 3);
t('... et son numéro de lot', r[0].lot === 77);
t('l’avancement se lit : une faite sur trois',
  r[0].taches.filter(x => x.fait).length === 1);
t('une tâche individuelle reste une ligne à elle',
  acReplier([{ id: 9, pour: 'ma' }]).length === 1
  && acReplier([{ id: 9, pour: 'ma' }])[0].lot === null);
t('deux lots distincts font deux lignes',
  acReplier(lot(0, 0).concat(lot(0, 0).map(x => Object.assign({}, x, { lot: 88 })))).length === 2);
t('mélange de lots et d’individuelles : chacune sa ligne',
  acReplier(lot(0, 0).concat([{ id: 50, pour: 'pa' }])).length === 2);
t('une liste vide ne casse rien', acReplier([]).length === 0 && acReplier(null).length === 0);

console.log('\nCe qui appelle mon attention');
t('une personne a fini sans que je l’aie vu : la ligne s’allume',
  acLotNeuf(acReplier(lot(1, 0))[0]) === true);
t('je l’ai vu passer : elle s’éteint',
  acLotNeuf(acReplier(lot(1, 1))[0]) === false);
t('personne n’a encore fini : rien à signaler',
  acLotNeuf(acReplier(lot(0, 0))[0]) === false);
t('tout le monde a fini, tout est vu : éteinte',
  acLotNeuf(acReplier(lot(3, 3))[0]) === false);

console.log('\n' + ok + ' vérifications, ' + ko + ' échec(s)\n');
process.exit(ko ? 1 : 0);
