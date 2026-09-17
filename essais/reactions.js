// Les reactions aux messages. Ce qui se joue ici : une reaction par personne
// et par message, dans les deux fils (cahier de transmission et messagerie),
// sans qu'une reaction en efface une autre. Les fonctions sont extraites de
// public/rx-module.js lui-meme.
// node essais/reactions.js
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'rx-module.js'), 'utf8');
function extraire(nom) {
  const d = src.indexOf('  function ' + nom + '(');
  if (d < 0) throw new Error('fonction introuvable : ' + nom);
  const f = src.indexOf('\n  }\n', d);
  if (f < 0) throw new Error('fin introuvable : ' + nom);
  return src.slice(d, f + 4);
}
const mE = /^  const RX_EMOJIS = .*$/m.exec(src);
if (!mE) throw new Error('RX_EMOJIS introuvable');
eval(mE[0].replace('const ', 'var '));
let reactions = [];
function rxListe() { return reactions; }
const rxRef = r => String(r == null ? '' : r);
eval(extraire('rxDe'));
eval(extraire('rxGroupes'));
eval(extraire('rxMienne'));
eval(extraire('rxAppliquer'));

let ok = 0, ko = 0;
const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };
console.log('\nRÉACTIONS — répondre sans écrire un message\n');

const POUCE = RX_EMOJIS[0], COEUR = RX_EMOJIS[1], RIRE = RX_EMOJIS[2];

console.log('La palette');
t('six emoji, pas un clavier', RX_EMOJIS.length === 6);
t('le pouce en premier : c’est celui qu’on cherche', POUCE === '👍');
t('aucun doublon dans la palette', new Set(RX_EMOJIS).size === 6);

console.log('\nPoser, changer, retirer');
let l = [];
let g = rxAppliquer(l, 'msg', 12, 'of', POUCE, 1000);
t('une première réaction s’ajoute', g.geste === 'ajoute' && l.length === 1);
t('... horodatée, sinon la fusion la perdrait', l[0].updatedAt === 1000);
t('... au nom de qui l’a posée', l[0].uid === 'of' && l[0].e === POUCE);
g = rxAppliquer(l, 'msg', 12, 'of', COEUR, 1001);
t('un autre emoji REMPLACE le sien', g.geste === 'remplace' && l.length === 1);
t('... et c’est bien le nouveau', l[0].e === COEUR);
t('... réhorodaté', l[0].updatedAt === 1001);
g = rxAppliquer(l, 'msg', 12, 'of', COEUR, 1002);
t('le même emoji RETIRE la sienne', g.geste === 'retire' && l.length === 0);
t('... en disant quel enregistrement a disparu, pour la pierre tombale',
  g.retire != null);

console.log('\nChacun la sienne');
l = [];
rxAppliquer(l, 'msg', 12, 'of', POUCE, 2000);
rxAppliquer(l, 'msg', 12, 'ma', POUCE, 2000);
rxAppliquer(l, 'msg', 12, 'ju', COEUR, 2000);
t('trois personnes, trois enregistrements', l.length === 3);
t('... des identifiants distincts, même à la même milliseconde',
  new Set(l.map(x => x.id)).size === 3);
t('retirer la mienne ne touche pas celle des autres',
  (rxAppliquer(l, 'msg', 12, 'of', POUCE, 2001), l.length === 2));
t('... et les autres sont intactes',
  l.some(x => x.uid === 'ma' && x.e === POUCE) && l.some(x => x.uid === 'ju' && x.e === COEUR));

console.log('\nChaque message le sien');
l = [];
rxAppliquer(l, 'msg', 12, 'of', POUCE, 3000);
rxAppliquer(l, 'msg', 13, 'of', POUCE, 3000);
rxAppliquer(l, 'th', '7-1699', 'of', POUCE, 3000);
t('trois messages, trois réactions', l.length === 3);
t('retirer sur l’un ne retire pas sur l’autre',
  (rxAppliquer(l, 'msg', 12, 'of', POUCE, 3001), l.length === 2));
reactions = l;
t('... la référence du cahier est « dossier-horodatage »',
  rxDe('th', '7-1699').length === 1);
t('... et un même numéro dans l’autre fil ne la ramasse pas',
  rxDe('msg', '7-1699').length === 0);
t('un identifiant numérique et son écriture en texte désignent le même message',
  rxDe('msg', 13).length === 1 && rxDe('msg', '13').length === 1);

console.log('\nCe qui s’affiche sous le message');
reactions = [];
rxAppliquer(reactions, 'msg', 5, 'of', COEUR, 4000);
rxAppliquer(reactions, 'msg', 5, 'ma', POUCE, 4000);
rxAppliquer(reactions, 'msg', 5, 'ju', POUCE, 4000);
rxAppliquer(reactions, 'msg', 5, 'pa', RIRE, 4000);
let gr = rxGroupes('msg', 5, 'of');
t('trois pastilles pour quatre personnes', gr.length === 3);
t('le pouce compte deux', gr.find(x => x.e === POUCE).uids.length === 2);
t('l’ordre est celui de la palette, pas celui d’arrivée — sinon les pastilles dansent',
  gr.map(x => x.e).join('') === POUCE + COEUR + RIRE);
t('la mienne est marquée', gr.find(x => x.e === COEUR).moi === true);
t('... et pas celles des autres', gr.find(x => x.e === POUCE).moi === false);
t('qui a réagi est conservé, pour l’infobulle',
  gr.find(x => x.e === POUCE).uids.sort().join() === 'ju,ma');
t('sans session, aucune pastille n’est « la mienne »',
  rxGroupes('msg', 5, null).every(x => x.moi === false));
t('un message sans réaction n’affiche rien', rxGroupes('msg', 999, 'of').length === 0);

console.log('\nCe qu’on retrouve');
t('ma réaction est retrouvée', (rxMienne('msg', 5, 'of') || {}).e === COEUR);
t('celle d’un absent n’existe pas', rxMienne('msg', 5, 'zz') === null);
t('une liste vide ne casse rien',
  (reactions = [], rxGroupes('msg', 5, 'of').length === 0 && rxMienne('msg', 5, 'of') === null));

console.log('\n' + ok + ' vérifications, ' + ko + ' échec(s)\n');
process.exit(ko ? 1 : 0);
