// Un module ne lit JAMAIS une collection sur `window`.
//
// Les collections d'index.html sont declarees avec `let` au premier niveau
// d'un <script>. Elles vivent dans la portee lexicale globale — `typeof
// deliveries` repond bien « object » — mais ELLES NE SONT PAS des proprietes
// de `window`. Un module qui lit `window['deliveries']` recoit `undefined`,
// se croit devant une liste vide, et n'a aucune erreur a montrer.
//
// C'est exactement ce qui a vide les fiches patients de tout leur historique :
// les cinq sources d'evenements rendaient zero, la fiche s'affichait, et rien
// ne disait qu'il manquait quelque chose. Un defaut muet.
//
// Cet essai garde la REGLE, pas le correctif : il verifie le code source
// lui-meme, comme essais/echappement.js.
// node essais/acces-collections.js
const fs = require('fs'), path = require('path');
const rac = path.join(__dirname, '..');
const pub = f => fs.readFileSync(path.join(rac, 'public', f), 'utf8');
const ix = pub('index.html');

let ok = 0, ko = 0;
const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };
console.log('\nACCÈS AUX COLLECTIONS — jamais par window\n');

// Les noms tels que le serveur les connait.
const mS = /const SYNCED_COLLS=\[([^\]]*)\]/.exec(ix);
if (!mS) throw new Error('SYNCED_COLLS introuvable');
const COLLS = mS[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean);

console.log('Le point d’accès');
t('index.html expose son résolveur', /window\._collRef\s*=\s*_collRef/.test(ix));
t('... et il couvre les collections déclarées', COLLS.length > 20);

// pl-core.js est le noyau de planning.html, une AUTRE page, qui cree ses
// propres globales avec `window.x = ...`. Son usage de window[] est legitime.
const MODULES = fs.readdirSync(path.join(rac, 'public'))
  .filter(f => /-module\.js$|^pl-core\.js$/.test(f))
  .filter(f => f !== 'pl-core.js');

console.log('\nAucun module ne lit une collection sur window');
MODULES.forEach(function (f) {
  const src = pub(f);
  // Une lecture indexee : window[nom]. Tolérée uniquement dans un repli
  // explicite, après le résolveur.
  const indexees = (src.match(/window\s*\[/g) || []).length;
  const passeParResolveur = /window\._collRef/.test(src);
  t(f + ' : pas de window[...] sans passer par le résolveur',
    indexees === 0 || passeParResolveur);
  // Une lecture directe : window.deliveries, window.locations... Elle n'est
  // admise que si le module lit AUSSI le nom nu — c'est alors un repli
  // defensif derriere la vraie lecture lexicale, et non le chemin principal.
  // Trois modules font exactement cela, en le documentant.
  const directes = COLLS.filter(function (c) {
    if (!new RegExp('window\\.' + c + '\\b').test(src)) return false;
    const nu = new RegExp('(^|[^\\w.$])' + c + '\\b(?!\\s*:)', 'm');
    return !nu.test(src.replace(new RegExp('window\\.' + c + '\\b', 'g'), 'WINDOWDOT'));
  });
  t(f + ' : aucune collection lue UNIQUEMENT sur window' + (directes.length ? ' (' + directes.join(', ') + ')' : ''),
    directes.length === 0);
});

console.log('\nLes deux modules qui agrègent passent bien par le résolveur');
t('pt-module lit par _collRef', /window\._collRef/.test(pub('pt-module.js')));
t('md-module lit par _collRef', /window\._collRef/.test(pub('md-module.js')));

console.log('\nLa forme qui a produit le défaut ne doit pas revenir');
// « const v = window[nom]; return Array.isArray(v) ? v : []; » : une lecture
// indexee dont le repli est une liste vide, sans resolveur en amont.
MODULES.forEach(function (f) {
  const src = pub(f);
  const naif = /window\s*\[\s*[A-Za-z_$][\w$]*\s*\]/.test(src) && !/window\._collRef/.test(src);
  t(f + ' : pas de lecture naïve avec repli sur une liste vide', !naif);
});

console.log('\n' + ok + ' vérifications, ' + ko + ' échec(s)\n');
process.exit(ko ? 1 : 0);
