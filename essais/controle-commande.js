// LE CONTRÔLE DE COMMANDE — la couture entre qui pointe et qui recontrôle.
// node essais/controle-commande.js
//
// CE QUI SE JOUE. Entre la responsable qui pointe la facture et celui qui
// recontrôle le prix de vente, il n'y a aujourd'hui qu'un carnet et la mémoire
// de deux personnes. Le module ne vaut que si chaque ligne dit QUI a contrôlé,
// QUAND, À QUI elle s'adresse, et si quelqu'un l'a vue — sans quoi la question
// « est-ce que quelqu'un a regardé la 170412 ? » continue de se poser à voix
// haute, et la réponse reste « je crois ».
//
// Les fonctions sont extraites de public/cc-module.js lui-même : un essai qui
// recopierait la règle ne vérifierait que sa propre copie.
const fs = require('fs'), path = require('path');
const lire = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const src = lire('public/cc-module.js');
const ix = lire('public/index.html');

function extraire(nom) {
  const d = src.indexOf('  function ' + nom + '(');
  if (d < 0) throw new Error('fonction introuvable : ' + nom);
  const f = src.indexOf('\n  }\n', d);
  if (f < 0) throw new Error('fin introuvable : ' + nom);
  return src.slice(d, f + 4);
}
function bloc(depart, fin, texte) {
  const s = texte || src;
  const d = s.indexOf(depart);
  if (d < 0) throw new Error('bloc introuvable : ' + depart);
  const f = s.indexOf(fin, d);
  if (f < 0) throw new Error('fin de bloc introuvable : ' + fin);
  return s.slice(d, f + fin.length);
}
// `const` déclaré dans un eval ne vit que dans cet eval : on pose en global.
const global_ = (d, f) => eval(bloc(d, f).replace(/^\s*const /, 'globalThis.'));

const pad = n => String(n).padStart(2, '0');
global_('const E = s =>', '}[c]));');
global_('const CC_PROBS = [', "\n  ];");
global_('const CC_HISTO_JOURS =', '30;');

eval(['ccNumCanon', 'ccNumValide', 'ccNumAttendu', 'ccProbs', 'ccSansProbleme',
      'ccDestinataires', 'ccVu', 'ccPour', 'ccEstPourMoi', 'ccPeutMarquer',
      'ccMarquer', 'ccTrier', 'ccARevoir', 'ccHistorique', 'ccDoublon',
      'ccCompteurPour', 'ccMoisDe'].map(extraire).join('\n'));

let ok = 0, ko = 0;
const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };
console.log('\nLE CONTRÔLE DE COMMANDE\n');

// ── Le numéro ───────────────────────────────────────────────────────────────
console.log('Le numéro de commande');
t('six chiffres font un numéro', ccNumValide('170412'));
t('on ne tape que des chiffres — le reste tombe', ccNumCanon('17 04-12a') === '170412');
t('et on ne dépasse pas six', ccNumCanon('1704123456') === '170412');
t('cinq chiffres n’en font pas un', !ccNumValide('17041'));
t('une case vide non plus', !ccNumValide('') && !ccNumValide(null));
t('celui d’aujourd’hui commence par 17', ccNumAttendu('170412'));
// ON NE REFUSE PAS CE QUI NE COMMENCE PAS PAR 17. La numérotation franchira
// 179999, et un module qui refuserait ce jour-là serait un module qu'on
// contourne. On demande confirmation : la faute de frappe est attrapée, pas
// l'avenir.
t('UN NUMÉRO QUI NE COMMENCE PAS PAR 17 RESTE VALIDE — il est seulement inattendu',
  ccNumValide('180001') && !ccNumAttendu('180001'));
t('... et le module demande confirmation au lieu de refuser',
  /ne commence pas par 17/.test(src) && /On l\\'enregistre quand même/.test(src));

// ── Ce qui cloche ───────────────────────────────────────────────────────────
console.log('\nLes quatre écarts du pointage');
t('les quatre cases de la demande sont là, et pas une de plus',
  CC_PROBS.map(p => p.k).join(',') === 'remise,ug,quantite,prix');
t('elles s’affichent dans la langue de l’officine',
  CC_PROBS.map(p => p.lbl).join(', ') === 'Remise, UG, Quantité, Prix');
const C1 = { id: 'a', num: '170412', remise: true, prix: true };
t('on relit ce qui a été coché', ccProbs(C1).map(p => p.k).join(',') === 'remise,prix');
t('une commande sans écart est reconnue comme telle', ccSansProbleme({ id: 'b', num: '170413' }));
t('... et une commande avec écart ne l’est pas', !ccSansProbleme(C1));
t('une case à `false` ne compte pas pour une case cochée',
  ccSansProbleme({ remise: false, ug: false, quantite: false, prix: false }));

// ── Qui recontrôle ──────────────────────────────────────────────────────────
// LES DESTINATAIRES SONT LES ADMINISTRATEURS, pas deux identifiants écrits en
// dur. Anouck et Olivier le sont ; le jour où la répartition change, la liste
// suit au lieu de mentir.
console.log('\nÀ qui s’adresse la commande');
const STAFF = [
  { id: 'OF', prenom: 'Olivier', nom: 'Ferran', admin: true, col: '#2E7D54' },
  { id: 'AF', prenom: 'Anouck', nom: 'Ferran', admin: true, col: '#B36A8C' },
  { id: 'JN', prenom: 'Jeanne', nom: 'Normand', col: '#5B7FB3' }
];
t('ce sont les administrateurs, donc Anouck et Olivier',
  ccDestinataires(STAFF).map(s => s.id).sort().join(',') === 'AF,OF');
t('une préparatrice n’y est pas', !ccDestinataires(STAFF).some(s => s.id === 'JN'));
t('QUAND PERSONNE N’EST MARQUÉ, LE REPLI DU DÉPÔT S’APPLIQUE — OF et AF',
  ccDestinataires([{ id: 'OF' }, { id: 'AF' }, { id: 'JN' }]).map(s => s.id).join(',') === 'OF,AF');
t('une liste vide ne fait pas tomber la lecture', ccDestinataires([]).length === 0);
t('le module n’écrit aucun identifiant en dur dans sa logique',
  !/pour: 'OF'|pour: 'AF'/.test(src));

// ── Le « vu » ───────────────────────────────────────────────────────────────
console.log('\nLe geste du destinataire : vu, et c’est tout');
const T = Date.UTC(2026, 9, 23, 9, 0, 0);
let c = { id: 'x', num: '170412', pour: 'OF', par: 'JN', le: T, remise: true };
t('elle n’est pas vue en arrivant', !ccVu(c));
ccMarquer(c, 'OF', T + 3600000);
t('« vu » retient qui et quand', ccVu(c) && c.vuPar === 'OF' && c.vuLe === T + 3600000);
t('... et estampille updatedAt — sans lui, un autre poste écraserait la ligne',
  c.updatedAt === T + 3600000);
ccMarquer(c, 'OF', T + 7200000);
t('ON PEUT DÉFAIRE — un « vu » cliqué par erreur n’est pas un verdict gravé',
  !ccVu(c) && !c.vuPar);
t('... et la saisie d’origine n’a pas bougé', c.par === 'JN' && c.le === T);

console.log('\nLe bouton n’appartient qu’au destinataire');
const D = { id: 'y', pour: 'AF' };
t('Anouck peut marquer ce qui lui est adressé', ccPeutMarquer(D, 'AF', false));
t('JEANNE NE PEUT PAS — ce n’est pas à elle qu’on demande', !ccPeutMarquer(D, 'JN', false));
t('un administrateur le peut, pour qu’une absence ne bloque pas la liste',
  ccPeutMarquer(D, 'JN', true));
t('une ligne adressée à personne n’est à personne', !ccEstPourMoi({ id: 'z' }, 'OF'));
t('et un poste sans opérateur ne s’approprie rien', !ccEstPourMoi(D, ''));

// ── Les listes ──────────────────────────────────────────────────────────────
console.log('\nCe qu’on voit en arrivant : ce qu’on attend de VOUS');
const L = [
  { id: '1', num: '170401', pour: 'OF', le: T + 100 },
  { id: '2', num: '170402', pour: 'AF', le: T + 300 },
  { id: '3', num: '170403', pour: 'OF', le: T + 200 },
  { id: '4', num: '170404', pour: 'OF', le: T + 400, vuLe: T + 500, vuPar: 'OF' }
];
const av = ccARevoir(L, 'OF');
t('les miennes sont à part', av.miennes.map(x => x.num).join(',') === '170403,170401');
t('LA PLUS RÉCENTE EN TÊTE — c’est ce qu’on vient de contrôler qu’on cherche',
  av.miennes[0].num === '170403');
t('celles des autres suivent', av.autres.map(x => x.num).join(',') === '170402');
t('UNE COMMANDE DÉJÀ VUE SORT DE LA LISTE', !av.miennes.some(x => x.num === '170404'));
t('une liste vide ne casse rien',
  ccARevoir([], 'OF').miennes.length === 0 && ccARevoir(null, 'OF').autres.length === 0);

console.log('\nLa pastille du menu compte ce qui vous attend');
t('deux pour Olivier', ccCompteurPour(L, 'OF') === 2);
t('une pour Anouck', ccCompteurPour(L, 'AF') === 1);
t('zéro pour Jeanne — et la pastille s’éteint', ccCompteurPour(L, 'JN') === 0);

console.log('\nL’historique montre trente jours, et n’efface rien');
const J = 86400000;
const H = [
  { id: '1', vuLe: T - 2 * J }, { id: '2', vuLe: T - 29 * J },
  { id: '3', vuLe: T - 40 * J }, { id: '4', vuLe: T - 400 * J },
  { id: '5', le: T }
];
const h = ccHistorique(H, T);
t('les contrôles vus de moins de trente jours sont montrés', h.recentes.length === 2);
t('LES PLUS ANCIENS SONT COMPTÉS, PAS JETÉS', h.anciennes === 2);
t('le plus récemment vu est en tête', h.recentes[0].id === '1');
t('ce qui n’est pas vu n’entre pas dans l’historique', !h.recentes.some(x => x.id === '5'));

console.log('\nLe même numéro deux fois : on demande, on n’interdit pas');
t('UN CONTRÔLE NON VU FAIT SOUPÇONNER UNE SAISIE EN DOUBLE',
  ccDoublon(L, '170401') !== null);
t('... mais un contrôle déjà vu laisse passer le suivant — on recontrôle parfois',
  ccDoublon(L, '170404') === null);
t('un numéro inconnu ne déclenche rien', ccDoublon(L, '179999') === null);
t('la comparaison ignore la mise en forme', ccDoublon(L, '17 04 01') !== null);

console.log('\nLe mois, sans toISOString');
t('LE 1ER À MINUIT RESTE LE MOIS EN COURS — pas celui d’avant',
  ccMoisDe(new Date(2026, 10, 1, 0, 0, 0)) === '2026-11');

// ── L'écran, exécuté pour de vrai ───────────────────────────────────────────
// Le défaut du matin même : les vues peuvent toutes être justes et l'écran
// rester vide. On exécute donc `ccRender` contre un document de poche.
console.log('\nL’écran s’assemble, pas seulement ses morceaux');
const ELS = {};
globalThis.window = globalThis.window || {};
globalThis.document = {
  getElementById: function (id) {
    if (!ELS[id]) ELS[id] = { id: id, innerHTML: '', style: {}, value: '', checked: false };
    return ELS[id];
  }
};
let FIX = [], FIX_U = { id: 'OF' }, FIX_ADMIN = true, FIX_S = STAFF;
const ccListe = () => FIX;
const ccUser = () => FIX_U;
const ccStaff = () => FIX_S;
const ccAdmin = () => FIX_ADMIN;
const ccHistoOuvert = false;
eval(['ccInitiales', 'ccPrenom', 'ccCouleur', 'ccQuand'].map(extraire).join('\n'));
eval(bloc('  function ccLigne(c, uid, admin) {', '\n  }\n'));
eval(bloc('window.ccRender = function (delibere) {', '\n  };'));

FIX = [
  { id: '1', num: '170412', pour: 'OF', par: 'JN', le: T, remise: true, prix: true,
    note: 'remise à 24 % au lieu de 30 %' },
  { id: '2', num: '170413', pour: 'AF', par: 'JN', le: T + 60000 },
  { id: '3', num: '170400', pour: 'OF', par: 'JN', le: T - J, vuLe: T, vuPar: 'OF' }
];
let jet = null;
try { window.ccRender(true); } catch (e) { jet = e.message; }
const vue = ELS['cc-listes'].innerHTML;
t('ELLE NE JETTE PAS' + (jet ? ' — ' + jet : ''), jet === null);
t('la commande qui m’est adressée est en tête', vue.indexOf('170412') < vue.indexOf('170413'));
t('mes lignes sont annoncées comme miennes', /Pour vous — 1 à revoir/.test(vue));
t('les écarts cochés s’affichent', /class="cc-p">Remise</.test(vue) && /class="cc-p">Prix</.test(vue));
t('UNE COMMANDE SANS ÉCART LE DIT, au lieu de rester muette', /rien à signaler/.test(vue));
t('la précision écrite se lit', /remise à 24 % au lieu de 30 %/.test(vue));
t('on voit qui a contrôlé, en initiales', /class="cc-qui"[^>]*>JN</.test(vue));
t('... dans sa couleur de fiche', /background:#5B7FB3/.test(vue));
t('et à qui elle est adressée', /Olivier/.test(vue) && /Anouck/.test(vue));
t('LE BOUTON « VU » EST LÀ POUR CELLE QUI M’EST ADRESSÉE',
  /ccVoir\('1'\)/.test(vue) && />Vu</.test(vue));
t('la pastille du menu compte mes lignes', ELS['cc-navb'].textContent === '1');

FIX_U = { id: 'JN' }; FIX_ADMIN = false;
jet = null; try { window.ccRender(true); } catch (e) { jet = e.message; }
const vueJN = ELS['cc-listes'].innerHTML;
t('elle ne jette pas non plus pour une préparatrice', jet === null);
t('JEANNE VOIT TOUT — la liste est ouverte à l’équipe', /170412/.test(vueJN) && /170413/.test(vueJN));
t('... mais n’a aucun bouton « Vu » à cliquer', !/>Vu</.test(vueJN));
t('... et on lui dit qui l’on attend', /en attente de Olivier/.test(vueJN));
t('elle peut retirer SA propre saisie', /ccSupprimer\('1'\)/.test(vueJN));
t('sa pastille reste éteinte', ELS['cc-navb'].style.display === 'none');
FIX_U = { id: 'OF' }; FIX_ADMIN = true;

FIX = [];
jet = null; try { window.ccRender(true); } catch (e) { jet = e.message; }
t('une liste vide le dit au lieu de rester blanche',
  jet === null && /Aucune commande en attente/.test(ELS['cc-listes'].innerHTML));

// ── Les gestionnaires cités existent ────────────────────────────────────────
console.log('\nAucun bouton ne désigne une fonction qui n’existe pas');
const EXPOSEES = new Set((src.match(/window\.(cc[A-Za-z]+)\s*=\s*function/g) || [])
  .map(m => /window\.(cc[A-Za-z]+)/.exec(m)[1]));
const CITEES = new Set((src.match(/(?:onclick|oninput|onkeydown)="[^"]*?\b(cc[A-Za-z]+)\(/g) || [])
  .map(m => /\b(cc[A-Za-z]+)\(/.exec(m)[1]));
const orphelines = [...CITEES].filter(f => !EXPOSEES.has(f));
t('les ' + CITEES.size + ' gestionnaires cités sont tous exposés sur window'
  + (orphelines.length ? ' — ORPHELINES : ' + orphelines.join(', ') : ''),
  orphelines.length === 0);
t('... et il y en a bien, sinon l’essai ne vérifierait rien', CITEES.size >= 4);

// ── Le sous-menu ────────────────────────────────────────────────────────────
// `ordonnerSidebar` classe par ordre alphabétique et REMONTE tout au premier
// niveau. Sans `rangerSousEntrees`, « Litiges » repartirait se ranger entre
// « Livraisons » et « Locations ».
console.log('\nLe sous-menu de Suivi administratif');
t('« Contrôle de commande » se déclare sous son parent',
  /b\.setAttribute\('data-parent', 'suiviadmin'\)/.test(src));
t('« Litiges » aussi', /b\.setAttribute\('data-parent', 'suiviadmin'\)/.test(lire('public/lt-module.js')));
t('les deux portent la classe d’indentation',
  /'sb-item sb-sub'/.test(src) && /'sb-item sb-sub'/.test(lire('public/lt-module.js')));
t('la classe existe dans la feuille de style', /\.sb-sub\{padding-left/.test(ix));
t('LE CLASSEMENT LES RAMÈNE SOUS LEUR PARENT, après son passage',
  /rangerSousEntrees\(bar\);/.test(ix) && /function rangerSousEntrees/.test(ix));
t('une sous-entrée disparaît avec son parent',
  /UNE SOUS-ENTREE DISPARAIT AVEC SON PARENT/.test(ix));
t('... et le parent s’allume quand on est dans une de ses pages',
  /p\.classList\.add\('sb-ouvert'\)/.test(ix)
  && /b\.classList\.remove\('sb-ouvert'\)/.test(ix));

console.log('\nL’ordre des sous-entrées est tenu');
// On exécute `rangerSousEntrees` contre une barre de poche : insérer les
// enfants un par un en « afterend » sans déplacer l'ancre les RETOURNERAIT,
// et « Litiges » passerait devant « Contrôle de commande ».
const BARRE = (function () {
  const items = [];
  function el(sec, parent) {
    return {
      sec: sec, parent: parent || null,
      getAttribute: function (k) { return k === 'data-sec' ? this.sec : (k === 'data-parent' ? this.parent : null); },
      insertAdjacentElement: function (pos, autre) {
        const i = items.indexOf(autre); if (i >= 0) items.splice(i, 1);
        items.splice(items.indexOf(this) + 1, 0, autre);
      }
    };
  }
  return {
    items: items, el: el,
    querySelectorAll: function (sel) {
      if (sel === '.sb-item[data-parent]') return items.filter(x => x.parent);
      return [];
    },
    querySelector: function (sel) {
      const m = /data-sec="([^"]+)"/.exec(sel);
      return items.find(x => x.sec === m[1] && !x.parent) || null;
    }
  };
}());
['livraisons', 'ctrlcmd', 'litiges', 'suiviadmin', 'caisse'].forEach(function (s) {
  BARRE.items.push(BARRE.el(s, (s === 'ctrlcmd' || s === 'litiges') ? 'suiviadmin' : null));
});
eval(bloc('function rangerSousEntrees(bar){', '\n}', ix));
rangerSousEntrees(BARRE);
t('les deux sous-entrées suivent leur parent',
  BARRE.items.map(x => x.sec).join(',') === 'livraisons,suiviadmin,ctrlcmd,litiges,caisse');
t('... DANS LEUR ORDRE, pas à l’envers',
  BARRE.items.indexOf(BARRE.items.find(x => x.sec === 'ctrlcmd'))
  < BARRE.items.indexOf(BARRE.items.find(x => x.sec === 'litiges')));
t('un parent absent ne fait pas disparaître l’enfant', (function () {
  const B2 = Object.create(BARRE);
  const items = [BARRE.el('ctrlcmd', 'suiviadmin')];
  B2.items = items;
  B2.querySelectorAll = sel => (sel === '.sb-item[data-parent]' ? items.filter(x => x.parent) : []);
  B2.querySelector = () => null;
  rangerSousEntrees(B2);
  return items.length === 1;
}()));

// ── La collection est déclarée partout (piège n°4) ──────────────────────────
console.log('\nLa collection est déclarée partout (piège n°4)');
t('la variable existe', /let ccControles = \[\];/.test(ix));
t('elle est dans SYNCED_COLLS', /'saIndics','ccControles'/.test(ix));
t('_collRef sait la rendre', ix.indexOf("case 'ccControles':return ccControles;") > 0);
t('saveAll l’envoie — SANS ÇA ELLE NE QUITTE JAMAIS LE NAVIGATEUR',
  /saIndics,ccControles,/.test(ix));
t('loadAll la relit', /if\(Array\.isArray\(data\.ccControles\)\)ccControles=data\.ccControles;/.test(ix));
t('la resynchronisation aussi, et sous filet',
  /if\(d\.ccControles\)\{ ccControles=d\.ccControles; try\{ if\(window\.ccRender\)ccRender\(\); \}/.test(ix));
t('le serveur la fusionne par identifiant', /'ccControles'/.test(lire('server.js')));
t('le module est chargé par l’application', /<script src="cc-module\.js"><\/script>/.test(ix));
t('la rubrique porte un nom dans le fil d’Ariane', /ctrlcmd:'Contrôle de commande'/.test(ix));
t('et son ouverture repose la liste des destinataires',
  /name==='ctrlcmd'&&window\.ccOuvrir/.test(ix));

console.log('\nCe que le module fait bien');
t('il lit la collection par _collRef, jamais par window (piège n°8)',
  /window\._collRef\('ccControles'\)/.test(src) && !/window\['ccControles'\]/.test(src));
t('il pose une pierre tombale AVANT de retirer une ligne (sinon elle revient)',
  src.indexOf("markDeleted('ccControles'") < src.indexOf('l.splice(i, 1)'));
t('un changement d’état part tout de suite, sans attendre les 600 ms (piège n°6)',
  /typeof saveNow === 'function'\) saveNow\(\)/.test(src) && !/schedSave/.test(src));
t('LA SAISIE N’EST PAS DANS LA PARTIE REDESSINÉE (piège n°9)',
  /z\.innerHTML = s;/.test(src)
  && !/cc-num|cc-note|cc-pour/.test(src.slice(src.indexOf('window.ccRender'), src.indexOf('window.ccOuvrir'))));
t('... et elle est posée une seule fois, à l’injection', /sec\.innerHTML = CC_SECTION;/.test(src));
t('un gestionnaire ne reçoit qu’un identifiant, jamais du texte saisi',
  !/onclick="cc[A-Za-z]+\('[^']*' \+ /.test(src) && /ccVoir\(\\'' \+ E\(c\.id\)/.test(src));

console.log('\n' + ok + ' vérifications, ' + ko + ' échec(s)\n');
process.exit(ko ? 1 : 0);
