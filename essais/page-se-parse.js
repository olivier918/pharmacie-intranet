// LA PAGE SE PARSE-T-ELLE ENCORE ?
// node essais/page-se-parse.js
//
// CE QUI SE JOUE. `public/index.html` porte un bloc de six cent mille
// caractères de JavaScript. Une apostrophe droite glissée dans une chaîne à
// quotes simples — « elle s'archive » au lieu de « elle s’archive » — et c'est
// la PAGE ENTIÈRE qui ne se charge plus : écran blanc, aucun module, aucune
// donnée. Le 19/11/2026, c'est exactement ce qui s'est produit en modifiant
// une phrase d'aide.
//
// Aucun autre essai ne pouvait le voir : ils lisent le fichier comme du texte,
// ou en extraient une fonction à la fois. Celui-ci donne tout le bloc à
// l'analyseur de JavaScript, sans jamais l'exécuter — `new Function` compile,
// c'est tout ce qu'on lui demande.
const fs = require('fs'), path = require('path');
const racine = path.join(__dirname, '..');

let ok = 0, ko = 0;
const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };
console.log('\nTOUT LE JAVASCRIPT DE L’APPLICATION SE COMPILE\n');

function parse(src, quoi) {
  try { new Function(src); return null; }
  catch (e) { return e.message + (e.lineNumber ? ' (ligne ' + e.lineNumber + ')' : ''); }
}

console.log('Les blocs écrits dans les pages');
['index.html', 'planning.html', 'renouv.html', 'depot.html', 'compression.html'].forEach(function (f) {
  const chemin = path.join(racine, 'public', f);
  if (!fs.existsSync(chemin)) return;
  const html = fs.readFileSync(chemin, 'utf8');
  const blocs = html.match(/<script>([\s\S]*?)<\/script>/g) || [];
  let mauvais = null, n = 0;
  blocs.forEach(function (b) {
    const src = b.replace(/^<script>/, '').replace(/<\/script>$/, '');
    if (!src.trim()) return;
    n++;
    const err = parse(src);
    if (err && !mauvais) mauvais = err;
  });
  t(f + ' — ses ' + n + ' bloc(s) se compilent' + (mauvais ? ' — ' + mauvais : ''), mauvais === null);
});

console.log('\nLes modules servis à part');
fs.readdirSync(path.join(racine, 'public'))
  .filter(f => f.endsWith('.js'))
  .forEach(function (f) {
    const err = parse(fs.readFileSync(path.join(racine, 'public', f), 'utf8'));
    t(f + (err ? ' — ' + err : ''), err === null);
  });

console.log('\nLe serveur et ses voisins');
fs.readdirSync(racine)
  .filter(f => f.endsWith('.js'))
  .forEach(function (f) {
    const src = fs.readFileSync(path.join(racine, f), 'utf8');
    // Ces fichiers-la sont des modules node : `require` et `module` y vivent,
    // mais la COMPILATION ne s'en soucie pas.
    const err = parse(src);
    t(f + (err ? ' — ' + err : ''), err === null);
  });

console.log('\n' + ok + ' vérifications, ' + ko + ' échec(s)\n');
process.exit(ko ? 1 : 0);
