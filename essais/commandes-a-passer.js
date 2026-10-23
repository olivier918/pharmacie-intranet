// LES COMMANDES À PASSER — trois états, et personne entre les deux.
// node essais/commandes-a-passer.js
//
// CE QUI SE JOUE. Entre la rupture constatée au comptoir et la boîte posée sur
// l'étagère, il y a trois personnes et deux jours. Le tableau ne vaut que si
// chaque clic laisse un nom et une heure : sans ça, la question « est-ce que
// quelqu'un l'a commandé ? » continue de se poser à voix haute, et on commande
// deux fois — ou pas du tout.
//
// Les fonctions sont extraites de public/cp-module.js lui-même : un essai qui
// recopierait la règle ne vérifierait que sa propre copie.
const fs = require('fs'), path = require('path');
const lire = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const src = lire('public/cp-module.js');

function extraire(nom) {
  const d = src.indexOf('  function ' + nom + '(');
  if (d < 0) throw new Error('fonction introuvable : ' + nom);
  const f = src.indexOf('\n  }\n', d);
  if (f < 0) throw new Error('fin introuvable : ' + nom);
  return src.slice(d, f + 4);
}
const CP_ETATS = ['a_passer', 'commande', 'recu_partiel', 'recu'];
const CP_ETAPE = { a_passer: 0, commande: 1, recu_partiel: 2, recu: 2 };
const CP_AVANT = { commande: 'a_passer', recu_partiel: 'commande', recu: 'commande' };
const CP_HISTO_JOURS = 30;
eval(extraire('cpEtat'));
eval(extraire('cpEtape'));
eval(extraire('cpPartielle'));
eval(extraire('cpClose'));
eval(extraire('cpTrier'));
eval(extraire('cpParEtat'));
eval(extraire('cpHistorique'));
eval(extraire('cpPar'));

let ok = 0, ko = 0;
const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };
console.log('\nLES COMMANDES À PASSER\n');

// ── L'état ──────────────────────────────────────────────────────────────────
console.log('Trois états, pas un de plus');
t('une ligne neuve est à commander', cpEtat({ id: 1 }) === 'a_passer');
t('les trois états sont reconnus',
  cpEtat({ etat: 'a_passer' }) === 'a_passer'
  && cpEtat({ etat: 'commande' }) === 'commande'
  && cpEtat({ etat: 'recu' }) === 'recu');
t('la réception partielle en est un', cpEtat({ etat: 'recu_partiel' }) === 'recu_partiel');
t('UN ÉTAT INVENTÉ RETOMBE SUR « À COMMANDER » — jamais sur « reçu »',
  cpEtat({ etat: 'livree' }) === 'a_passer');
t('une ligne absente ne fait pas tomber la lecture', cpEtat(null) === 'a_passer');

console.log('\nQuatre états, mais trois marches');
t('à commander, commandée : deux premières marches',
  cpEtape({ etat: 'a_passer' }) === 0 && cpEtape({ etat: 'commande' }) === 1);
t('LA RÉCEPTION PARTIELLE EST SUR LA DERNIÈRE MARCHE, pas sur une de plus',
  cpEtape({ etat: 'recu_partiel' }) === 2 && cpEtape({ etat: 'recu' }) === 2);
t('... mais elle ne la franchit pas : la ligne reste ouverte',
  cpPartielle({ etat: 'recu_partiel' }) === true && cpClose({ etat: 'recu_partiel' }) === false);
t('seule une réception complète clôt la ligne',
  cpClose({ etat: 'recu' }) === true && cpClose({ etat: 'commande' }) === false);

// ── Le parcours ─────────────────────────────────────────────────────────────
console.log('\nLe parcours d’une ligne');
const T = 1700000000000;
let c = { id: 1, labo: 'MKL', ts: T };
cpPar(c, 'commande', 'JN', T + 1000);
t('« commandé » retient qui et quand',
  c.etat === 'commande' && c.commandePar === 'JN' && c.commandeLe === T + 1000);
t('... et estampille updatedAt — sans lui, un autre poste écraserait la ligne',
  c.updatedAt === T + 1000);
t('la réception n’est pas encore remplie', !c.recuLe && !c.recuPar);
cpPar(c, 'recu', 'QD', T + 2000);
t('« réceptionné » retient qui et quand',
  c.etat === 'recu' && c.recuPar === 'QD' && c.recuLe === T + 2000);
t('... sans effacer qui avait commandé', c.commandePar === 'JN');

console.log('\nLa réception partielle');
let d = { id: 2, labo: 'Gilbert', ts: T };
cpPar(d, 'commande', 'JN', T + 1000);
cpPar(d, 'recu_partiel', 'QD', T + 2000);
t('elle retient qui et quand',
  d.etat === 'recu_partiel' && d.partielPar === 'QD' && d.partielLe === T + 2000);
t('... et la ligne n’est PAS reçue', !d.recuLe && !d.recuPar && cpClose(d) === false);
t('... la commande reste au nom de qui l’a passée', d.commandePar === 'JN');
cpPar(d, 'recu', 'JC', T + 3000);
t('compléter clôt la ligne', d.etat === 'recu' && d.recuPar === 'JC');
t('COMPLÉTER NE RENIE PAS LA PARTIELLE — la ligne garde qu’elle est arrivée en deux fois',
  d.partielLe === T + 2000 && d.partielPar === 'QD');
let r = { id: 3, labo: 'Pierre Fabre', ts: T, etat: 'recu_partiel', partielLe: T, partielPar: 'QD',
          commandeLe: T, commandePar: 'JN' };
cpPar(r, 'a_passer', 'ER', T + 9000);
t('RECOMMANDER REPART DE ZÉRO — plus de commande, plus de réception partielle',
  r.etat === 'a_passer' && !r.commandeLe && !r.partielLe && !r.partielPar && !r.recuLe);

console.log('\nRevenir en arrière efface ce qui n’est plus vrai');
cpPar(c, 'commande', 'OF', T + 3000);
t('DÉFAIRE UNE RÉCEPTION EFFACE LA RÉCEPTION — sinon la ligne dirait qu’elle est arrivée',
  c.etat === 'commande' && c.recuLe === null && c.recuPar === null);
t('... mais la commande, elle, tient toujours', c.commandePar === 'JN');
cpPar(c, 'a_passer', 'OF', T + 4000);
t('REMISE À COMMANDER, ELLE N’EST PLUS COMMANDÉE PAR PERSONNE',
  c.etat === 'a_passer' && c.commandeLe === null && c.commandePar === null
  && c.recuLe === null && c.recuPar === null);
t('on ne recule que d’un cran, comme sur les livraisons',
  CP_AVANT.commande === 'a_passer' && CP_AVANT.recu_partiel === 'commande'
  && CP_AVANT.recu === 'commande' && CP_AVANT.a_passer === undefined);

// ── Le tri et les groupes ───────────────────────────────────────────────────
console.log('\nCe que chaque groupe contient');
const L = [
  { id: 1, labo: 'A', ts: T + 100 },
  { id: 2, labo: 'B', ts: T + 300, etat: 'commande' },
  { id: 3, labo: 'C', ts: T + 200 },
  { id: 4, labo: 'D', ts: T + 400, etat: 'recu', recuLe: T + 500 }
];
t('à commander : celles qui le sont', cpParEtat(L, 'a_passer').map(x => x.labo).join('') === 'CA');
t('LE PLUS RÉCENT EN TÊTE — c’est ce qu’on vient de noter qu’on cherche',
  cpParEtat(L, 'a_passer')[0].labo === 'C');
t('commandées : la seule qui l’est', cpParEtat(L, 'commande').map(x => x.labo).join('') === 'B');
t('reçues : la seule qui l’est', cpParEtat(L, 'recu').map(x => x.labo).join('') === 'D');
t('une liste vide ne casse rien', cpParEtat([], 'a_passer').length === 0 && cpParEtat(null, 'recu').length === 0);

// ── L'historique ────────────────────────────────────────────────────────────
console.log('\nL’historique montre trente jours, et n’efface rien');
const J = 86400000;
const H = [
  { id: 1, etat: 'recu', recuLe: T - 2 * J },
  { id: 2, etat: 'recu', recuLe: T - 29 * J },
  { id: 3, etat: 'recu', recuLe: T - 40 * J },
  { id: 4, etat: 'recu', recuLe: T - 400 * J },
  { id: 5, etat: 'a_passer', ts: T }
];
const h = cpHistorique(H, T);
t('les réceptions de moins de trente jours sont montrées', h.recentes.length === 2);
t('LES PLUS ANCIENNES SONT COMPTÉES, PAS JETÉES', h.anciennes === 2);
t('la plus récente est en tête', h.recentes[0].id === 1);
t('ce qui n’est pas reçu n’entre pas dans l’historique',
  !h.recentes.some(x => x.id === 5));
t('une ligne reçue sans date de réception se range sur sa date de création',
  cpHistorique([{ id: 9, etat: 'recu', ts: T - J }], T).recentes.length === 1);

// ── Ce que le module promet au reste de l'application ──────────────────────
console.log('\nLa collection est déclarée partout (piège n°4)');
const ix = lire('public/index.html');
t('la variable existe', /let cmdPasser = \[\];/.test(ix));
// On ne s'accroche PAS a la fin de la liste : une collection ajoutee apres
// celle-ci ferait echouer un essai qui n'a rien a voir avec elle.
t('elle est dans SYNCED_COLLS', /'ruptures','cmdPasser'/.test(ix));
t('_collRef sait la rendre', /case 'cmdPasser':return cmdPasser;/.test(ix));
t('saveAll l’envoie — SANS ÇA ELLE NE QUITTE JAMAIS LE NAVIGATEUR',
  /ruptures,cmdPasser,/.test(ix));
t('loadAll la relit', /if\(Array\.isArray\(data\.cmdPasser\)\)cmdPasser=data\.cmdPasser;/.test(ix));
t('la resynchronisation aussi', /if\(d\.cmdPasser\)\{ cmdPasser=d\.cmdPasser;/.test(ix));
t('et le serveur la fusionne par identifiant',
  /'reunionThemes', 'reunions', 'cmdPasser',/.test(lire('server.js')));
t('le module est chargé par l’application', /<script src="cp-module\.js"><\/script>/.test(ix));

console.log('\nCe que le module fait bien');
t('il lit les collections par _collRef, jamais par window (piège n°8)',
  /window\._collRef\('cmdPasser'\)/.test(src) && !/window\['cmdPasser'\]/.test(src));
t('il pose une pierre tombale AVANT de retirer une ligne (sinon elle revient)',
  src.indexOf("markDeleted('cmdPasser'") < src.indexOf('l.splice(i, 1)')
  && /markDeleted\('cmdPasser', l\[i\]\.id\)/.test(src));
t('un changement d’état part tout de suite, sans attendre les 600 ms (piège n°6)',
  /typeof saveNow === 'function'\) saveNow\(\)/.test(src) && !/schedSave/.test(src));

// LE PIÈGE N°9. La resynchronisation rappelle cpRender toutes les huit
// secondes. Si la saisie se trouvait dans le morceau redessiné, le nom du
// laboratoire qu'on est en train de taper disparaîtrait sous les doigts.
console.log('\nLa question « tout ou en partie »');
t('elle est posée en toutes lettres, pas devinée',
  /Tout ce qui était commandé est-il arrivé \?/.test(src)
  && /Oui, tout est arrivé/.test(src) && /Non, il en manque/.test(src));
t('ELLE VIT SUR LE CORPS DE LA PAGE, PAS DANS LA LISTE — sinon elle s’évapore en huit secondes',
  /document\.body\.appendChild/.test(src)
  && !/CP_SECTION[\s\S]{0,400}cp-ov/.test(src));
t('répondre « tout » archive la ligne',
  /window\.cpMarquer\(id, tout \? 'recu' : 'recu_partiel'\);/.test(src));
t('recevoir sans commande notée comble le trou au lieu de refuser le geste',
  /if \(!c\.commandeLe\) \{ c\.commandeLe = Date\.now\(\)/.test(src));
t('une ligne close s’appelle « archivée »', /' Archivées <b>'/.test(src));

console.log('\nLa saisie n’est pas dans la partie redessinée (piège n°9)');
const rendu = src.slice(src.indexOf('window.cpRender = function'), src.indexOf('function cpRemplirAnnuaire'));
t('cpRender ne touche qu’aux listes', /z\.innerHTML = h;/.test(rendu)
  && /getElementById\('cp-listes'\)/.test(rendu));
t('... et ne réécrit jamais les champs de saisie',
  !/cp-labo/.test(rendu) && !/cp-prod/.test(rendu) && !/cp-saisie/.test(rendu));
t('la saisie est posée une seule fois, à l’injection',
  /hote\.innerHTML = CP_SECTION;/.test(src));
t('l’autocomplétion ne retouche le DOM que si le répertoire a changé',
  /if \(dl\.dataset\.sig === sig\) return;/.test(src));

console.log('\nL’escalier est celui des livraisons');
t('les mêmes classes, donc le même dessin — rien n’a été recopié',
  /status-stepper__track/.test(src) && /status-stepper__connector-fill/.test(src)
  && /is-done/.test(src) && /is-next/.test(src) && /is-pending/.test(src));
t('le style vient d’index.html, le module n’en redéfinit pas',
  /\.status-stepper\{/.test(ix) && !/'\.status-stepper\{/.test(src));
t('TROIS RONDS, PAS QUATRE', (src.match(/\{ e: '/g) || []).length === 3);
// L'ESCALIER EST LA COMMANDE, PAS UN VOYANT. Aucun bouton d'action à côté de
// la ligne : on clique sur la marche pour la valider, comme sur les livraisons.
t('CLIQUER SUR UNE MARCHE LA VALIDE',
  /onclick="cpEtapeClic\(/.test(src) && /window\.cpEtapeClic = function/.test(src));
t('... et il n’y a plus aucun bouton d’action à côté', !/cpActions/.test(src));
t('la marche qu’on occupe ne répond pas — sauf la partielle, par où l’on complète',
  /const inerte = \(i === cur\) && !\(dernier && part\);/.test(src));
t('chaque marche cliquable dit ce qu’elle fera', /title="' \+ E\(CP_TITRE\[i\]\)/.test(src));
t('RECULER DE PLUS D’UN CRAN SE CONFIRME — ça efface une commande déjà passée',
  /Remettre « ' \+ \(c\.labo \|\| ''\) \+ ' » à commander/.test(src));
t('la marche partielle est ambrée et nommée',
  /cp-part/.test(src) && /'Partielle'/.test(src));

console.log('\nUne réception partielle reste un travail en cours');
t('elle a son propre groupe, avant l’historique',
  /Reçues en partie — reste à recevoir/.test(src));
t('... et on la complète en recliquant sur sa marche',
  /dernier && part/.test(src));
t('l’historique ne retient que les lignes closes',
  /cpParEtat\(l, 'recu'\)/.test(src.slice(src.indexOf('function cpHistorique'), src.indexOf('// ── Les gestes'))));

console.log('\nLes reliquats sont affichés, pas déduits');
t('le laboratoire est retrouvé dans le répertoire à chaque affichage',
  /window\.lbParNom\(c\.labo\)/.test(src));
t('... et non figé à la saisie — une fiche créée ce soir éclaire les lignes du matin',
  !/laboId/.test(src));
t('le répertoire porte le champ', /reliquats: ''/.test(lire('public/lb-module.js')));
t('TROIS ÉTATS CÔTÉ RÉPERTOIRE : oui, non, et pas renseigné',
  /\(v === 'oui' \|\| v === 'non'\) \? v : ''/.test(lire('public/lb-module.js')));
t('« pas renseigné » se voit sur la ligne, au lieu de se taire',
  /cp-rel-x/.test(src) && /reliquats \?/.test(src));
// LE DRAPEAU ÉCLAIRE, IL NE DÉCIDE PAS. « À recommander » est un bouton que
// quelqu'un presse ; rien ne doit changer d'état tout seul parce qu'un
// laboratoire est marqué « pas de reliquats ». C'est l'opérateur qui sait si la
// livraison était complète, et lui seul.
const appels = (src.match(/cpReliquats\(/g) || []).length;
const pastille = src.slice(src.indexOf('function cpPastille'), src.indexOf('function cpLigne'));
t('LE DRAPEAU N’EST LU QU’À L’AFFICHAGE — il ne déclenche jamais un changement d’état',
  appels === 2 && /cpReliquats\(c\)/.test(pastille));
t('... aucune transition ne le consulte',
  !/cpReliquats[\s\S]{0,120}cpPar\(/.test(src) && !/cpPar\([\s\S]{0,60}cpReliquats/.test(src));

console.log('\nL’analyse ASCA est repliée par défaut');
const co = lire('public/co-module.js');
t('le corps de la carte ASCA est masqué au départ',
  /<div id="co-corps" style="display:none">/.test(co));
t('un bouton le déplie', /onclick="coPlier\(\)"/.test(co));
t('l’état est retenu par poste, pas partagé',
  /localStorage\.getItem\(CO_CLE_PLI\)/.test(co));
t('REPLIÉE, LA BARRE DIT COMBIEN — sinon on la déplie pour rien',
  /co-plier-n/.test(co) && /laboratoire' \+ \(n > 1 \? 's' : ''\)/.test(co));
t('le suivi est placé AVANT elle dans la rubrique',
  co.indexOf("'<div id=\"cp-host\"></div>'") < co.indexOf('Analyse ASCA'));

console.log('\n' + ok + ' vérifications, ' + ko + ' échec(s)\n');
process.exit(ko ? 1 : 0);
