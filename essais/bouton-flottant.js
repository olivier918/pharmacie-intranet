// LE BOUTON FLOTTANT « NOUVELLE LIVRAISON ».
// Ce qui se joue ici n'est pas l'esthetique : c'est qu'un bouton fixe en bas a
// droite peut RECOUVRIR quelque chose. S'il recouvre « Enregistrer », le
// formulaire ne se valide plus — et on ne s'en apercoit qu'au comptoir.
// node essais/bouton-flottant.js
const fs = require('fs'), path = require('path');
const h = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

let ok = 0, ko = 0;
const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };
console.log('\nLE BOUTON QUI NE PART PAS AVEC LA PAGE\n');

// ── Ou il vit ───────────────────────────────────────────────────────────────
// DANS la section, pas dans <body> : une section inactive est en display:none,
// donc le bouton dispararait seul dans les autres modules. Le jour ou il
// remonterait au niveau du body, il s'afficherait par-dessus la Caisse.
const sec = h.slice(h.indexOf('<div id="sec-livraisons"'), h.indexOf('<!-- ═══ TO DO'));
t('le bouton est à l’intérieur de #sec-livraisons', sec.indexOf('id="fab-liv"') > 0);
t('... donc il s’efface seul dans les autres sections (.sec inactive = display:none)',
  /\.sec\{display:none\}\.sec\.active\{display:block\}/.test(h));
t('il est après la liste, pas dedans — #dlist est réécrit à chaque rendu',
  sec.indexOf('id="dlist"') < sec.indexOf('id="fab-liv"'));

// ── Ce qu'il fait ───────────────────────────────────────────────────────────
t('il ouvre le formulaire de livraison', /id="fab-liv"[\s\S]{0,120}onclick="openDForm\(\)"/.test(h));
t('il a un nom pour les lecteurs d’écran, l’icône seule ne suffit pas',
  /id="fab-liv"[\s\S]{0,200}aria-label="Nouvelle livraison"/.test(h));
t('le « + » décoratif est masqué aux lecteurs d’écran',
  /class="fab-plus"\s*\n?\s*aria-hidden="true"/.test(h));
t('le focus clavier se voit', /\.fab-liv:focus-visible\{[^}]*outline/.test(h));

// ── CE QU'IL NE DOIT PAS RECOUVRIR ──────────────────────────────────────────
t('il s’efface quand le formulaire est ouvert — sinon il couvrirait « Enregistrer »',
  /\.fab-liv\.off\{[^}]*pointer-events:none/.test(h));
t('... et openDForm le lui dit', /form\.style\.display='block';\s*\n\s*majFabLiv\(\);/.test(h));
t('... et closeDForm aussi',
  /function closeDForm\(\)\{[^}]*majFabLiv\(\);\}/.test(h));
t('majFabLiv lit l’état réel du formulaire, il ne tient pas un drapeau à part',
  /function majFabLiv\(\)\{[\s\S]{0,400}f\.style\.display!=='none'/.test(h));
t('la liste réserve la place du bouton sous sa dernière ligne',
  /#sec-livraisons\{padding-bottom:\d+px\}/.test(h));
t('il passe sous le voile du menu mobile (z-index < .sb-backdrop)', (function () {
  const f = /\.fab-liv\{[^}]*z-index:(\d+)/.exec(h), b = /\.sb-backdrop\{[^}]*z-index:(\d+)/.exec(h);
  return f && b && Number(f[1]) < Number(b[1]);
}()));
t('il passe sous les fenêtres modales (z-index < .overlay)', (function () {
  const f = /\.fab-liv\{[^}]*z-index:(\d+)/.exec(h), o = /\.overlay\{[^}]*z-index:(\d+)/.exec(h);
  return f && o && Number(f[1]) < Number(o[1]);
}()));
t('il ne s’imprime pas', /@media print\{\.fab-liv\{display:none\}\}/.test(h));

// ── La forme ────────────────────────────────────────────────────────────────
// Un bouton ECRIT tant que la place le permet : « + Nouvelle livraison » se
// lit, un « + » nu se devine. Le rond n'est pas un choix de style, c'est ce
// qui reste quand l'ecran est trop etroit pour une phrase.
t('en grand écran il garde son libellé', /class="fab-txt">Nouvelle livraison</.test(h));
t('sous 720 px il devient le rond', /@media\(max-width:720px\)\{[\s\S]{0,400}\.fab-liv \.fab-txt\{display:none\}/.test(h));
t('... et il est carré, donc rond avec border-radius:999px',
  /@media\(max-width:720px\)\{[\s\S]{0,300}width:60px;height:60px/.test(h) && /\.fab-liv\{[^}]*border-radius:999px/.test(h));
t('... au-dessus de la barre système des téléphones',
  /bottom:calc\(16px \+ env\(safe-area-inset-bottom/.test(h));
t('la cible tactile dépasse les 44 px recommandés', (function () {
  const m = /@media\(max-width:720px\)\{[\s\S]{0,300}width:(\d+)px;height:(\d+)px/.exec(h);
  return m && Number(m[1]) >= 44 && Number(m[2]) >= 44;
}()));
t('l’animation se tait pour qui la refuse', /prefers-reduced-motion[\s\S]{0,120}\.fab-liv\{transition:none\}/.test(h));

// ── Ce qui a disparu ────────────────────────────────────────────────────────
// Deux boutons pour le meme geste, c'est une hesitation a chaque livraison.
t('l’ancien bouton de l’en-tête a bien été retiré, pas dupliqué',
  (h.match(/>\+ Nouvelle livraison</g) || []).length === 0);
t('le bouton Imprimer de l’en-tête est resté', /onclick="window\.print\(\)"/.test(sec));

console.log('\n' + ok + ' vérifications, ' + ko + ' échec(s)\n');
process.exit(ko ? 1 : 0);
