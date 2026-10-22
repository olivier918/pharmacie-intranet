// LA SAISIE EN COURS APPARTIENT À CELUI QUI ÉCRIT.
// node essais/saisie-en-cours.js
//
// CE QUI SE JOUE, ET POURQUOI C'EST UN ESSAI À PART.
//
// Toutes les huit secondes, la boucle de resynchronisation remplace les
// collections par la copie du serveur et redessine l'écran. C'est ce qui fait
// qu'un poste voit arriver ce qu'un autre vient d'écrire — et c'est la plus
// grande qualité de cette application.
//
// Mais un redessin reconstruit le HTML À PARTIR DES DONNÉES ENREGISTRÉES. Si
// un formulaire se trouve dans le morceau reconstruit, tout ce qui vient d'y
// être tapé disparaît, et le curseur avec. On a donc huit secondes, montre en
// main, pour remplir le champ. Deux fois le défaut est passé en production :
//
//   · la DATE DE RÉUNION D'ÉQUIPE — poser une date était devenu impossible,
//     le calendrier du navigateur se refermant avec le champ qui le portait ;
//   · la FICHE LABORATOIRE — adresse, téléphone, courriel : tout s'effaçait.
//
// Les deux sont corrigés par la même garde : ON NE REDESSINE PAS UN FORMULAIRE
// DÉJÀ OUVERT. Tant que la saisie est ouverte, elle appartient à la personne
// qui écrit ; ce qu'un autre poste a posé entre-temps s'affichera à la
// fermeture. C'est le dernier qui enregistre qui l'emporte, comme partout
// ailleurs dans cette application.
//
// La règle générale est consignée dans CLAUDE.md (piège n°9). Cet essai garde
// les deux corrections, mot pour mot.
const fs = require('fs'), path = require('path');

let ok = 0, ko = 0;
const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };
const lire = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

console.log('\nLA SAISIE EN COURS — ce que la resynchronisation n’a pas le droit d’effacer\n');

// ── Les fonctions que la resynchronisation rappelle ─────────────────────────
const ix = lire('public/index.html');

// Le bloc de resynchronisation : du `setInterval` jusqu'à son `renderAll()`.
const resync = (function () {
  const i = ix.indexOf('_suppressSave=true; try{ renderAll();');
  const d = ix.lastIndexOf('setInterval', i);
  return (i > 0 && d >= 0) ? ix.slice(d, i + 200) : '';
}());
t('le bloc de resynchronisation est retrouvé dans index.html', resync.length > 200);
t('... il remplace bien les collections par la copie du serveur',
  /reunions=d\.reunions/.test(resync) && /laboratoires=d\.laboratoires/.test(resync));
t('... et il redessine', /renderAll\(\)/.test(resync));

const renderAll = (function () {
  const d = ix.indexOf('function renderAll()');
  return d < 0 ? '' : ix.slice(d, ix.indexOf('\n}', d));
}());
t('renderAll est retrouvée', renderAll.length > 20);

const ENTREES = new Set();
[resync, renderAll].forEach(function (bloc) {
  (bloc.match(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g) || []).forEach(function (m) {
    ENTREES.add(m.replace(/\s*\($/, ''));
  });
});
['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof', 'JSON', 'Array']
  .forEach(n => ENTREES.delete(n));
t('les points d’entrée du redessin sont nombreux — c’est tout l’écran',
  ENTREES.size > 15);

// ── Pourquoi il n'y a pas de balayage automatique ici ──────────────────────
//
// La tentation est grande : suivre toutes les fonctions que la resynchronisation
// rappelle, et signaler celles qui reconstruisent un champ. On l'a ecrit. Il
// remonte vingt-cinq fonctions, parce que la propriete « pose un champ » se
// propage a travers chaque fonction appelante -- plRender appelle tout, donc
// plRender est suspecte, et la liste ne veut plus rien dire.
//
// Un essai qui crie vingt-cinq fois ne protege de rien : on apprend a ne plus
// le lire. La regle vit donc dans CLAUDE.md, parmi les pieges du depot, et cet
// essai garde ce qu'il peut garder exactement : les deux endroits ou le defaut
// s'est produit, et la forme precise de leur correction.

// ── Les deux gardes, mot pour mot ───────────────────────────────────────────
console.log('\nLa date de réunion d’équipe');
const re = lire('public/re-module.js');
const bloc = re.slice(re.indexOf('if (reEditDate && reAdmin())'), re.indexOf('re-date re-date-edit'));
t('le formulaire ouvert n’est pas redessiné',
  /if \(document\.getElementById\('re-d-date'\)\) return;/.test(bloc));
t('... et la garde précède l’écriture du HTML',
  bloc.indexOf("getElementById('re-d-date')") < bloc.length);
t('le champ existe bien sous ce nom — sinon la garde ne garderait rien',
  /id="re-d-date"/.test(re));

console.log('\nLa fiche laboratoire');
const lb = lire('public/lb-module.js');
t('le formulaire ouvert n’est pas redessiné',
  /if \(lbEdite !== null && !refaireLaSaisie && document\.getElementById\('lb-f-nom'\)\) return;/.test(lb));
t('le champ existe bien sous ce nom', /id="lb-f-nom"/.test(lb) || /ch\('lb-f-nom'/.test(lb));
t('les redessins délibérés, eux, passent',
  /lbNouveau = function \(\) \{ lbEdite = 0; lbBrouillon = lbVide\(\); lbRendBO\(true\)/.test(lb)
  && /lbVue = 'fiches'; lbRendBO\(true\); lbFocus\(\);/.test(lb));
t('changer d’onglet emporte ce qui est tapé',
  /lbOnglet = function \(v\) \{\s*if \(lbBrouillon && document\.getElementById\('lb-f-nom'\)\) lbChampsDuDom\(lbBrouillon\);/.test(lb));
t('retirer un alias aussi',
  /lbAliasRetirer[\s\S]{0,200}lbChampsDuDom\(lbBrouillon\);/.test(lb));
t('ANNULER ET ENREGISTRER NE SONT PAS BLOQUÉS — ils ferment la saisie d’abord',
  /lbAnnuler = function \(\) \{ lbEdite = null; lbBrouillon = null; lbRendBO\(\); \}/.test(lb)
  && /lbEdite = null; lbBrouillon = null;\s*\n\s*lbSave\(\); lbRendBO\(\);/.test(lb));
t('la recherche disparaît pendant une saisie, au lieu de ne plus répondre',
  /if \(lbEdite === null\) \{\s*\n\s*h \+= '<div class="lb-barre">/.test(lb));

console.log('\n' + ok + ' vérifications, ' + ko + ' échec(s)\n');
process.exit(ko ? 1 : 0);
