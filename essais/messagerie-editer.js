// Modifier et supprimer un message de la messagerie. Ce qui se joue ici : qui a
// le droit, et ce qui part AVEC le message quand il part. Les fonctions sont
// extraites de public/mp-module.js lui-meme.
// node essais/messagerie-editer.js
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'mp-module.js'), 'utf8');
function bloc(nom) {
  const d = src.indexOf('\n  function ' + nom + '(');
  if (d < 0) throw new Error('introuvable : ' + nom);
  const f = src.indexOf('\n  }\n', d);
  if (f < 0) throw new Error('fin introuvable : ' + nom);
  return src.slice(d + 1, f + 4);
}

let USER = null, ADMIN = false;
const mpUser = () => USER;
const mpAdmin = () => ADMIN;
eval(bloc('mpPeutToucher'));
eval(bloc('mpRxDuMessage'));

let ok = 0, ko = 0;
const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };
console.log('\nMESSAGERIE — modifier et supprimer\n');

// ── Qui a le droit ──────────────────────────────────────────────────────────
console.log('Qui peut toucher un message');
USER = { id: 'u1' }; ADMIN = false;
t('on peut toucher son propre message', mpPeutToucher({ uid: 'u1' }));
t('pas celui d’un autre', !mpPeutToucher({ uid: 'u2' }));
ADMIN = true;
// Un administrateur, parce qu'il faut pouvoir retirer une betise le jour ou son
// auteur est en conge, et que quelqu'un doit repondre de ce qui traine ici.
t('un administrateur peut toucher celui d’un autre', mpPeutToucher({ uid: 'u2' }));
t('et le sien, evidemment', mpPeutToucher({ uid: 'u1' }));
USER = null; ADMIN = true;
t('personne d’identifié ne touche rien, même administrateur', !mpPeutToucher({ uid: 'u1' }));
USER = { id: 'u1' };
t('un message inexistant ne se touche pas', !mpPeutToucher(null));
ADMIN = false;
t('un message sans auteur ne se touche pas par défaut', !mpPeutToucher({ id: 5 }));

// ── Ce qui part avec le message ─────────────────────────────────────────────
// Supprimer efface POUR DE BON — c'est le choix retenu. Les reactions posees
// dessus doivent partir avec lui : orphelines, elles se rattacheraient a un
// identifiant qui n'existe plus.
console.log('\nLes réactions partent avec le message');
const RX = [
  { id: 1, c: 'msg', r: 13, uid: 'u1', e: '👍' },
  { id: 2, c: 'msg', r: 13, uid: 'u2', e: '🙏' },
  { id: 3, c: 'msg', r: 14, uid: 'u1', e: '👍' },
  // LE PIEGE : le cahier de transmission pose les siennes sous 'th', et ses
  // references ressemblent a des identifiants de messages.
  { id: 4, c: 'th', r: '13', uid: 'u2', e: '👍' },
  { id: 5, c: 'th', r: 13, uid: 'u1', e: '❤️' }
];
const p13 = mpRxDuMessage(RX, 13);
t('les deux réactions du message sont trouvées', p13.length === 2);
t('... et ce sont les bonnes', p13.map(r => r.id).join() === '1,2');
t('celles du CAHIER ne sont pas touchées', !p13.some(r => r.c === 'th'));
t('celles d’un autre message non plus', !p13.some(r => String(r.r) === '14'));
t('l’identifiant se compare en texte — 13 et « 13 » sont le même message',
  mpRxDuMessage([{ id: 9, c: 'msg', r: '13' }], 13).length === 1);
t('un message sans réaction n’en emporte aucune', mpRxDuMessage(RX, 99).length === 0);
t('une liste vide ne casse rien', mpRxDuMessage([], 13).length === 0);
t('pas de liste du tout non plus', mpRxDuMessage(null, 13).length === 0);
t('une entrée abîmée est ignorée', mpRxDuMessage([null, { c: 'msg', r: 13 }], 13).length === 1);

// ── La trace de la modification ─────────────────────────────────────────────
// Supprimer efface sans trace, c'est assume. MODIFIER, non : un message reecrit
// qui ne le dirait pas ferait mentir le fil a ceux qui l'ont deja lu.
console.log('\nUn message modifié le dit');
t('le champ qui porte la marque existe dans le rendu',
  /m\.editeLe \? '<span class="mp-m-ed"/.test(src));
t('... et il est posé à l’enregistrement', /m\.editeLe = Date\.now\(\);/.test(src));
t('... avec qui a modifié', /m\.editePar = /.test(src));
t('un message vide ne s’enregistre pas, il se supprime',
  /Un message vide se supprime/.test(src));
t('la suppression demande confirmation, et dit que c’est définitif',
  /disparaîtra pour tout le monde, définitivement/.test(src));
t('la pierre tombale est posée AVANT de retirer de la liste',
  src.indexOf("markDeleted('messages', id)") < src.indexOf('l.splice(i, 1)'));

console.log('\n' + (ok + ko) + ' vérifications, ' + ko + ' échec(s)\n');
process.exit(ko ? 1 : 0);
