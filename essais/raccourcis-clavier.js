// LES RACCOURCIS CLAVIER. Ce qui se joue ici n'est pas le confort : c'est
// qu'une touche partie au mauvais moment remplace un nom de patient par un
// ecran qui s'ouvre. Les deux pieges verifies en premier — le Mac et l'AZERTY
// — sont ceux qui ne se voient PAS sur le poste ou l'on developpe.
// node essais/raccourcis-clavier.js
const fs = require('fs'), path = require('path');
const rc = fs.readFileSync(path.join(__dirname, '..', 'public', 'rc-module.js'), 'utf8');
const h  = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

let ok = 0, ko = 0;
const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };
console.log('\nRACCOURCIS CLAVIER — Alt + lettre\n');

// ── Les deux pièges invisibles ──────────────────────────────────────────────
console.log('Ce qui ne se voit pas sur le poste où l’on développe');
t('on lit e.code, jamais e.key — sinon Option+L sur un Mac envoie « ¬ »',
  /ev\.code/.test(rc) && !/ev\.key\s*===\s*'[A-Za-z]'/.test(rc));
t('... et le module dit pourquoi', /Option\+L ne produit/.test(rc));
t('tout ce qui porte ctrlKey est ignoré — AltGr, c’est Ctrl+Alt',
  /if \(!ev\.altKey \|\| ev\.ctrlKey/.test(rc));
t('... et le module dit pourquoi (le « € » d’un montant)',
  /AltGr EST\s*\n?\s*\/\/ Ctrl\+Alt|AltGr EST/.test(rc));
t('Cmd (metaKey) ne déclenche rien non plus', /ev\.ctrlKey \|\| ev\.metaKey/.test(rc));

// ── Les touches que Chrome garde ────────────────────────────────────────────
console.log('\nLes touches que le navigateur ne rend pas');
t('Alt+D, Alt+E et Alt+F sont explicitement écartées',
  /RC_INTERDITES\s*=\s*\['KeyD',\s*'KeyE',\s*'KeyF'\]/.test(rc));
t('... et aucune section ne s’en sert', (function () {
  const m = /RC_SECTIONS = \[([\s\S]*?)\n  \];/.exec(rc);
  return m && !/'Key[DEF]'/.test(m[1]);
}()));
t('aucune touche F n’est utilisée — F1 est l’aide du navigateur, F11/F12 lui appartiennent',
  !/'F\d/.test(rc));

// ── Le clavier ne connaît aucun module ──────────────────────────────────────
// C'est ce qui fait qu'un module ajoute demain gagne ses raccourcis sans que
// ce fichier soit rouvert. Le jour ou une liste de fonctions apparait ici,
// elle divergera du reste de l'application au premier renommage.
console.log('\nLe clavier ne connaît aucun module');
t('« commencer une fiche » se trouve par l’attribut data-rc, pas par un nom de fonction',
  /data-rc="\s*'\s*\+\s*role|\[data-rc="'/.test(rc));
t('... et ne cherche que DANS la section ouverte',
  /function rcCible[\s\S]{0,260}rcSection\(\)/.test(rc));
t('aucun appel en dur à une fonction de module (openDForm, toggleLocForm…)',
  !/openDForm|toggleLocForm|savePrep|newThread/.test(rc));
t('un bouton se clique, un champ se prend au curseur — les pavés toujours ouverts comptent aussi',
  /function rcDeclencher[\s\S]{0,300}el\.focus\(\)[\s\S]{0,200}el\.click\(\)/.test(rc));

// ── Ce que le clavier ne doit pas contourner ────────────────────────────────
console.log('\nCe qu’un raccourci ne doit jamais contourner');
t('une fenêtre ouverte suspend tout — sinon on perd une saisie sans comprendre',
  /if \(rcFenetreOuverte\(\)\) return;/.test(rc));
t('... sauf l’aide, qui reste joignable', (function () {
  const iA = rc.indexOf("code === 'KeyH'"), iF = rc.indexOf('if (rcFenetreOuverte()) return;');
  return iA > 0 && iF > iA;
}()));
t('un module fermé sur ce poste le reste — le raccourci passe par l’entrée de menu',
  /function rcEntree[\s\S]{0,200}\.sb-item\[data-sec=/.test(rc) && /rcVisible\(b\) \? b : null/.test(rc));
t('... et il le DIT au lieu de ne rien faire', /n’est pas ouvert sur ce poste/.test(rc));
t('une section sans création le dit aussi', /Rien à créer dans cette section/.test(rc));

// ── Se faire connaître ──────────────────────────────────────────────────────
// Un raccourci que personne ne peut decouvrir n'existe pas.
console.log('\nSe faire connaître');
t('Alt+H ouvre l’aide-mémoire', /code === 'KeyH'[\s\S]{0,120}rcAideBasculer/.test(rc));
t('elle ne liste que les modules ouverts à cette personne',
  /RC_SECTIONS\.filter\(function \(r\) \{ return !!rcEntree\(r\[1\]\); \}\)/.test(rc));
t('le raccourci s’annonce aussi sur le bouton, en infobulle',
  /function rcInfobulles\(\)[\s\S]{0,900}setAttribute\('title'/.test(rc));
t('... y compris sur un bouton étiqueté plus tard', /\[data-rc="neuf"\],\[data-rc="recherche"\]/.test(rc));
t('Échap referme l’aide', /ev\.key === 'Escape'[\s\S]{0,120}rc-aide/.test(rc));

// ── Le branchement dans l'application ───────────────────────────────────────
console.log('\nLe branchement');
t('le module est chargé par index.html', /<script src="rc-module\.js"><\/script>/.test(h));
t('l’écoute est en capture, comme la couche des listes de suggestion',
  /addEventListener\('keydown', rcClavier, true\)/.test(rc));
const neuf = (h.match(/data-rc="neuf"/g) || []).length;
const rech = (h.match(/data-rc="recherche"/g) || []).length;
t('au moins six sections savent commencer une fiche (' + neuf + ')', neuf >= 6);
t('au moins huit sections ont une recherche étiquetée (' + rech + ')', rech >= 8);
t('le bouton flottant des livraisons en fait partie',
  /<button data-rc="neuf" type="button" class="fab-liv/.test(h));
t('les préparations passent par leur premier champ, faute de bouton « nouvelle »',
  /<input data-rc="neuf" type="text" id="p-nom"/.test(h));
t('chaque section étiquetée existe vraiment', (function () {
  const m = /RC_SECTIONS = \[([\s\S]*?)\n  \];/.exec(rc);
  if (!m) return false;
  return (m[1].match(/'([a-z]+)',\s*'/g) || []).map(x => x.replace(/'/g, '').replace(',', '').trim())
    .every(sec => h.indexOf('data-sec="' + sec + '"') > 0 || h.indexOf("data-sec='" + sec + "'") > 0
                 || sec === 'accueil' || sec === 'temperatures' || sec === 'depots' || sec === 'mp');
}()));
t('aucune lettre n’est attribuée deux fois', (function () {
  const m = /RC_SECTIONS = \[([\s\S]*?)\n  \];/.exec(rc);
  const l = (m[1].match(/'Key[A-Z]'/g) || []).concat(["'KeyN'", "'KeyR'", "'KeyH'"]);
  return new Set(l).size === l.length;
}()));
t('l’aide et le message ne s’impriment pas', /@media print\{#rc-mot,\.rc-aide\{display:none\}\}/.test(rc));

console.log('\n' + ok + ' vérifications, ' + ko + ' échec(s)\n');
process.exit(ko ? 1 : 0);
