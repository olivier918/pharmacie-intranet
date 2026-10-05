// LE MODULE CRÉDITS — écrire, c'est enregistrer.
// node essais/credits.js
//
// CE QUE CET ESSAI GARDE. Toutes les écritures du module estampillaient
// `updatedAt` et appelaient `renderCreds()` — et aucune n'enregistrait. L'écran
// montrait donc la bonne chose, pendant huit secondes : la boucle de
// resynchronisation remplace `credits` par la copie du serveur, et une
// modification qui n'a pas été envoyée entre-temps disparaît sans un mot.
//
// Le défaut était sournois parce qu'il ne se voyait pas toujours : n'importe
// quelle autre action déclenchait un enregistrement global qui emportait la
// relance au passage. Elle tenait une fois sur deux, au hasard de ce qu'on
// faisait ensuite. Les relances par SMS ne tenaient jamais — la fenêtre d'envoi
// se referme sans que rien d'autre ne sauvegarde.
//
// L'essai ne vérifie pas une ligne : il vérifie LA RÈGLE, fonction par
// fonction. Une écriture ajoutée demain sans son enregistrement le fait
// échouer.
const fs = require('fs'), path = require('path');
const ix = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const L = ix.split('\n');

let ok = 0, ko = 0;
const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };
console.log('\nMODULE CRÉDITS — écrire, c’est enregistrer\n');

// ── La porte unique ─────────────────────────────────────────────────────────
console.log('Le point de passage');
t('credTouche existe', /function credTouche\(c\)\{[^}]*saveNow\(\);/.test(ix));
t('il estampille ET il enregistre',
  /function credTouche\(c\)\{ if\(c\) c\.updatedAt=Date\.now\(\); saveNow\(\); \}/.test(ix));
// `saveNow` et non `schedSave` : la maison reserve l'envoi immediat aux
// changements d'etat deliberes et rares. Une relance en est un.
t('... sans attendre les 600 ms du report', !/function credTouche\(c\)\{[^}]*schedSave/.test(ix));

// ── La règle, fonction par fonction ─────────────────────────────────────────
const debuts = [];
for (let i = 0; i < L.length; i++) {
  const m = /^(?:async )?function ([A-Za-z0-9_]+)/.exec(L[i]);
  if (m) debuts.push([i, m[1]]);
}
function fin(i) { for (let j = i + 1; j < L.length; j++) if (L[j] === '}') return j; return L.length - 1; }

const ECRIT = /\.updatedAt\s*=\s*Date\.now\(\)|\.status\s*=\s*['"]|relances\.push|credTouche\(/;
const ENREGISTRE = /\bschedSave\(\)|\bsaveNow\(\)|\bcredTouche\(|\bcredPayNoteEnvoi\(/;

const fautives = [];
let examinees = 0;
debuts.forEach(function (d) {
  const [i, nom] = d;
  const corps = L.slice(i, fin(i) + 1).join('\n');
  const touche = /\bcredits\b/.test(corps) || /cred/i.test(nom);
  if (!touche || !ECRIT.test(corps)) return;
  examinees++;
  if (!ENREGISTRE.test(corps)) fautives.push(nom);
});

console.log('\nChaque fonction qui écrit un crédit enregistre');
t('il y a bien des fonctions à examiner', examinees >= 14);
t('AUCUNE n’écrit sans enregistrer'
  + (fautives.length ? ' — manquantes : ' + fautives.join(', ') : ''),
  fautives.length === 0);

// ── Ce qui rendait le défaut invisible ──────────────────────────────────────
console.log('\nPourquoi une écriture non enregistrée disparaît');
t('la resynchronisation remplace les crédits par la copie du serveur',
  /if\(d\.credits\)credits=d\.credits;/.test(ix));
t('... toutes les huit secondes', /setInterval\(async\(\)=>\{[\s\S]{0,200}\/api\/data/.test(ix));
t('... sauf si un envoi est en attente — c’est la seule protection',
  /!_savePending\)\{/.test(ix));
t('schedSave est ce qui pose cette attente', /_savePending=true/.test(ix));

// ── La suppression ──────────────────────────────────────────────────────────
// LE SECOND DEFAUT. Le serveur fusionne par id : une liste a laquelle il manque
// une ligne ne dit pas qu'elle a ete supprimee. Sans pierre tombale, le credit
// supprime revient au premier envoi d'un autre poste.
console.log('\nSupprimer un crédit');
const del = (function () {
  const i = L.findIndex(x => /^function deleteCred\(/.test(x));
  return L.slice(i, fin(i) + 1).join('\n');
}());
t('la suppression pose une pierre tombale', /markDeleted\('credits', id\)/.test(del));
t('... AVANT de retirer la ligne',
  del.indexOf("markDeleted('credits'") < del.indexOf('credits=credits.filter'));
t('... et elle enregistre', /saveNow\(\)/.test(del));

// ── Le chemin du SMS, celui qui ne tenait jamais ────────────────────────────
console.log('\nLa relance par SMS');
t('elle part vers la fenêtre d’envoi, sans rien écrire encore',
  /if\(canal==='sms'\)\{[\s\S]{0,120}openCredSms\(c\.id, etape, date, notes\);/.test(ix));
t('la relance n’est écrite qu’à la confirmation d’envoi',
  /onSent:\(r\)=>\{[\s\S]{0,400}c\.relances\.push/.test(ix));
t('... et cette écriture enregistre',
  /onSent:\(r\)=>\{[\s\S]{0,700}credTouche\(c\);/.test(ix));
t('le texte du SMS porte le montant et l’étape',
  /function buildCredSmsBody/.test(ix));

console.log('\n' + ok + ' vérifications, ' + ko + ' échec(s)\n');
process.exit(ko ? 1 : 0);
