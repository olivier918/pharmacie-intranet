// LES LITIGES ET LES FACTURES MANQUANTES — le tableur fait foi, et rien d'autre.
// node essais/litiges.js
//
// CE QUI SE JOUE. Remplacer une liste de dossiers en production, c'est effacer
// pour de bon. Deux façons de se tromper, et les deux sont silencieuses :
//
//   • on reprend les lignes VIDES du tableur — celles qui ne portent qu'un
//     reste de liste déroulante — et la liste se remplit de dossiers fantômes
//     qu'on relance auprès de personne ;
//   • on efface sans pierre tombale, et les anciens dossiers reviennent à la
//     resynchronisation suivante, reposés par un poste qui les a encore.
//
// Les fonctions sont extraites de public/lt-module.js lui-même : un essai qui
// recopierait les données ne vérifierait que sa propre copie.
const fs = require('fs'), path = require('path');
const lire = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const src = lire('public/lt-module.js');

function extraire(nom) {
  const d = src.indexOf('  function ' + nom + '(');
  if (d < 0) throw new Error('fonction introuvable : ' + nom);
  const f = src.indexOf('\n  }\n', d);
  return src.slice(d, f + 4);
}
function bloc(depart, fin) {
  const d = src.indexOf(depart);
  if (d < 0) throw new Error('bloc introuvable : ' + depart);
  const f = src.indexOf(fin, d);
  if (f < 0) throw new Error('fin de bloc introuvable : ' + fin);
  return src.slice(d, f + fin.length);
}
const global_ = (d, f) => eval(bloc(d, f).replace(/^\s*const /, 'globalThis.'));

global_('const LT_TYPES = {', '\n  };');
global_('const LT_ETATS = {', '\n  };');
global_('const LT_FETATS = {', '\n  };');
global_('const LT_SEED_LITIGES = [', '\n  ];');
global_('const LT_SEED_FACTURES = [', '\n  ];');
eval(['ltClefReprise', 'ltMemoireDesFils', 'ltVider'].map(extraire).join('\n'));

let ok = 0, ko = 0;
const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };
console.log('\nLES LITIGES ET LES FACTURES MANQUANTES\n');

// ── Ce que le tableur contient ──────────────────────────────────────────────
console.log('Le tableur du 25/10, tel qu’il est');
t('trente litiges', LT_SEED_LITIGES.length === 30);
t('six factures manquantes', LT_SEED_FACTURES.length === 6);
// LES LIGNES VIDES DU TABLEUR NE SONT PAS DES DOSSIERS. Soixante et une lignes
// de la feuille ne portaient qu'un reste de liste déroulante dans une colonne
// annexe. Les reprendre aurait rempli l'écran de dossiers sans laboratoire.
t('AUCUNE LIGNE VIDE N’A ÉTÉ REPRISE — toutes portent un laboratoire',
  LT_SEED_LITIGES.every(r => r.labo && r.labo.trim())
  && LT_SEED_FACTURES.every(r => r.labo && r.labo.trim()));
t('aucun laboratoire ne traîne d’espace', LT_SEED_LITIGES.every(r => r.labo === r.labo.trim()));

console.log('\nChaque dossier est lisible par le module');
const typesInconnus = LT_SEED_LITIGES.filter(r => !LT_TYPES[r.type]).map(r => r.type);
t('tous les motifs sont connus' + (typesInconnus.length ? ' — INCONNUS : ' + typesInconnus.join(', ') : ''),
  typesInconnus.length === 0);
const etatsInconnus = LT_SEED_LITIGES.filter(r => !LT_ETATS[r.etat]).map(r => r.etat);
t('tous les états de litige sont connus' + (etatsInconnus.length ? ' — INCONNUS : ' + etatsInconnus.join(', ') : ''),
  etatsInconnus.length === 0);
const fetatsInconnus = LT_SEED_FACTURES.filter(r => !LT_FETATS[r.etat]).map(r => r.etat);
t('tous les états de facture aussi' + (fetatsInconnus.length ? ' — INCONNUS : ' + fetatsInconnus.join(', ') : ''),
  fetatsInconnus.length === 0);
t('les dates sont au format qui se trie',
  LT_SEED_LITIGES.concat(LT_SEED_FACTURES).every(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date)));
// UN MONTANT ABSENT N'EST PAS UN MONTANT NUL. Dix-huit litiges sur trente n'ont
// pas de montant dans le tableur : les mettre à zéro aurait faussé tout total.
t('MONTANT OU « À CHIFFRER », jamais ni l’un ni l’autre, jamais les deux',
  LT_SEED_LITIGES.concat(LT_SEED_FACTURES).every(r =>
    (typeof r.montant === 'number') !== (r.aChiffrer === true)));
t('dix-huit litiges restent à chiffrer',
  LT_SEED_LITIGES.filter(r => r.aChiffrer).length === 18);
t('et douze portent leur montant',
  LT_SEED_LITIGES.filter(r => typeof r.montant === 'number').length === 12);
t('les six factures sont toutes chiffrées',
  LT_SEED_FACTURES.every(r => typeof r.montant === 'number'));

console.log('\nL’état « Constaté » existe, parce que le tableur l’emploie');
// Le replier sur « En cours » aurait dit qu'on s'en occupe, alors qu'on vient
// seulement de le voir — et c'est justement la distinction qui compte au début.
t('il est déclaré', !!LT_ETATS.constate && LT_ETATS.constate.lbl === 'Constaté');
t('IL COMPTE COMME OUVERT — un litige constaté n’est pas un litige classé',
  LT_ETATS.constate.ouvert === true);
t('et il vient en tête, avant « En cours »',
  Object.keys(LT_ETATS)[0] === 'constate');
t('le dossier Avène du 20/10 le porte',
  LT_SEED_LITIGES.some(r => r.labo === 'Avène' && r.etat === 'constate'));

console.log('\nLes quatre dossiers que le tableur ajoute');
[['svr', '2026-09-21'], ['mam', '2026-09-21'], ['Menarini', '2026-09-24'], ['Avène', '2026-10-20']]
  .forEach(function (d) {
    t(d[0] + ' du ' + d[1] + ' est repris',
      LT_SEED_LITIGES.some(r => r.labo === d[0] && r.date === d[1]));
  });
t('et thuasne est passé de « avoir en cours » à « réglé »',
  LT_SEED_LITIGES.some(r => r.labo === 'thuasne' && r.etat === 'regle'));

console.log('\nUne date du tableur est dans l’avenir, et on le dit');
// 01/12/2026, commande 146678. C'est vraisemblablement 01/12/2025 — mais
// personne ici ne peut en decider a la place de l'officine.
const futur = LT_SEED_FACTURES.filter(r => r.date > '2026-10-25');
t('ELLE EST REPRISE TELLE QUELLE, pas corrigée à l’aveugle',
  futur.length === 1 && futur[0].cmd === '146678');
t('... et le code dit pourquoi', /POSTERIEURE A AUJOURD'HUI/.test(src));

// ── Le remplacement ─────────────────────────────────────────────────────────
console.log('\nLa clé qui reconnaît un dossier d’un import à l’autre');
t('elle ignore la casse et les espaces du laboratoire',
  ltClefReprise({ labo: '  MKL ', cmd: '158211', facture: '2000252' })
  === ltClefReprise({ labo: 'mkl', cmd: '158211', facture: '2000252' }));
t('un numéro de commande différent fait un autre dossier',
  ltClefReprise({ labo: 'mkl', cmd: '1' }) !== ltClefReprise({ labo: 'mkl', cmd: '2' }));
t('un dossier sans rien ne fait pas tomber la lecture', ltClefReprise(null) === '||');

console.log('\nCe qui survit au remplacement : le fil, et rien d’autre');
const AVANT = [
  { id: 'a', labo: 'mkl', cmd: '158211', facture: '2000252', etat: 'encours',
    montant: 999, note: 'vieille note', fil: [{ q: 'appel du 12/09' }], relances: [{ t: 1 }] },
  { id: 'b', labo: 'disparu', cmd: '000', facture: '', fil: [], relances: [] }
];
const mem = ltMemoireDesFils(AVANT);
t('seuls les dossiers qui ont un fil sont retenus', Object.keys(mem).length === 1);
t('... et on retient le fil ET les relances',
  mem['mkl|158211|2000252'].fil.length === 1 && mem['mkl|158211|2000252'].relances.length === 1);

console.log('\nOn efface, mais on pose une pierre tombale');
const tombes = [];
globalThis.markDeleted = (coll, id) => tombes.push(coll + ':' + id);
const liste = AVANT.slice();
ltVider('litiges', liste);
t('LA LISTE EST VIDÉE', liste.length === 0);
t('ET CHAQUE DOSSIER A SA PIERRE TOMBALE — sinon ils reviennent dans huit secondes',
  tombes.join(',') === 'litiges:a,litiges:b');
t('une liste absente ne fait pas tomber l’opération',
  (function () { try { ltVider('litiges', null); return true; } catch (e) { return false; } }()));

console.log('\nLe remplacement, joué pour de vrai');
globalThis.litiges = [
  { id: 'v1', labo: 'mkl', cmd: '158211', facture: '2000252', etat: 'encours',
    note: 'ce que PILOT disait avant', fil: [{ q: 'appel du 12/09' }], relances: [{ t: 1 }] },
  { id: 'v2', labo: 'dossier parti', cmd: 'zz', facture: '', fil: [], relances: [] }
];
globalThis.facturesManq = [];
let demandes = 0, dit = '';
globalThis.confirm = () => { demandes++; return true; };
globalThis.alert = (m) => { dit = m; };
globalThis.saveNow = () => {};
globalThis.logAction = () => {};
globalThis.ltRender = () => {};
globalThis.isAdmin = () => true;
globalThis.ltAdmin = () => true;
globalThis.window = globalThis;
tombes.length = 0;
eval(bloc('window.ltRemplacer = function () {', '\n  };'));
window.ltRemplacer();

t('IL DEMANDE DEUX FOIS — effacer des dossiers ne se fait pas d’un clic distrait',
  demandes === 2);
t('les trente litiges du tableur sont en place', litiges.length === 30);
t('et les six factures', facturesManq.length === 6);
t('LES ANCIENS SONT TOUS SOUS PIERRE TOMBALE',
  tombes.indexOf('litiges:v1') >= 0 && tombes.indexOf('litiges:v2') >= 0);
t('un dossier absent du fichier a bien disparu',
  !litiges.some(r => r.labo === 'dossier parti'));
const mkl = litiges.find(r => r.labo === 'mkl' && r.cmd === '158211');
t('LE FIL DU DOSSIER RECONNU A SUIVI — PILOT le savait, le tableur l’ignorait',
  mkl && mkl.fil.length === 1 && mkl.relances.length === 1);
// Le dossier mkl illustre tout le propos : PILOT le disait « en cours » avec
// une vieille note, le tableur le dit « réglé — attente avoir ». C'est le
// tableur qui l'emporte, et seul le fil de PILOT survit.
t('... mais tout le reste vient du fichier, pas de l’ancien dossier',
  mkl.note === 'attente avoir' && mkl.etat === 'regle'
  && mkl.note.indexOf('PILOT disait') < 0);
t('les dossiers inconnus repartent avec un fil vide',
  litiges.filter(r => (r.fil || []).length).length === 1);
t('chaque dossier porte un identifiant distinct',
  new Set(litiges.concat(facturesManq).map(r => r.id)).size === 36);
t('la référence du tableur rejoint le n° de facture',
  facturesManq.some(r => r.facture === 'liv2515762') && !facturesManq.some(r => r.ref));
t('et l’écran annonce ce qui a été fait', /30 litiges et 6 factures/.test(dit));

console.log('\nCe que le module promet');
t('le remplacement est réservé aux administrateurs',
  /if \(!ltAdmin\(\)\) \{ alert\('Action réservée aux administrateurs\.'\); return; \}/.test(src));
t('le bouton ne s’affiche que pour eux',
  /bmaj\.style\.display = ltAdmin\(\) \? '' : 'none';/.test(src));
t('l’opération est journalisée', /logAction\('Litiges — remplacement depuis le tableur'/.test(src));
t('la reprise initiale reste refusée sur une liste non vide',
  /La reprise ne peut se faire que sur des listes vides\./.test(src));

console.log('\n' + ok + ' vérifications, ' + ko + ' échec(s)\n');
process.exit(ko ? 1 : 0);
