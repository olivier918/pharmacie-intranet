// LA LISTE DES COLLABORATEURS, DANS LE BACK OFFICE.
// node essais/collaborateurs-liste.js
//
// CE QUI SE JOUE. L'écran de l'équipe était une grille de cartes, sept boutons
// par personne. On y cherchait un nom et on y trouvait des commandes. C'est
// devenu une liste : le portrait, le nom, le poste — et la fiche s'ouvre au
// clic, avec tout ce que PILOT sait de la personne.
//
// L'essai EXÉCUTE le rendu contre un document de poche. Une fonction manquante
// dans un gabarit `${}` ne se voit pas à la lecture : elle jette à l'exécution,
// et l'écran reste vide.
const fs = require('fs'), path = require('path');
const ix = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

let ok = 0, ko = 0;
const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };
console.log('\nLA LISTE DES COLLABORATEURS\n');

// ── Le document de poche ───────────────────────────────────────────────────
const zone = { id: 'staff-grid', className: 'staff-grid', innerHTML: '', style: {} };
global.document = { getElementById: (id) => (id === 'staff-grid' ? zone : null) };
global.staffDB = [
  { id:'OF', prenom:'Olivier', nom:'Ferran', poste:'Pharmacien', pin:'1234', col:'#348466',
    admin:true, rpps:'10001234567', anniv:'12/03', sig:'x' },
  { id:'AF', prenom:'Anouck', nom:'Ferran', poste:'Pharmacien', pin:'2222', col:'#B36A8C', admin:true },
  { id:'TV', prenom:'Jean-Claude', nom:'Tran Van', poste:'Préparateur', col:'#7E6BB8' },   // sans PIN
  { id:'CB', prenom:'Céline', nom:'Bourdon', poste:'Préparateur', pin:'2345', col:'#D26E96' },
  { id:'XX', prenom:'Sans', nom:'Poste', pin:'9999', col:'#999' }                          // sans poste
];
global.currentUser = { id: 'OF' };
global.plContrats = [{ id:'c1', staffId:'CB', actif:true, base:35, role:'Préparatrice', grp:'prep' }];
global.imgSrc = v => v || '';
global.remplirPostes = () => {};
global.applyAdminUI = () => {};
global.schedSave = () => {};
global.plFonctionsDispo = () => null;        // la page principale n'a pas le planning
global.plContratDeStaff = undefined;
global.posteHtml = (s) => '<select>' + (s.poste || '') + '</select>';
global.planningHtml = (s) => (plContrats.find(x => x.staffId === s.id) ? 'Planning : contrat actif' : 'Planning : aucun contrat');
global.staffIsAdmin = s => s && s.admin === true;
global.isAdmin = () => true;
// La page principale n'a pas le module Planning : `window.plFonctionDe` y est
// absent, et c'est le cas que l'on eprouve ici.
global.window = global;

function prendre(nom) {
  let deb = ix.indexOf('function ' + nom + '(');
  if (deb >= 0) {
    const ligne = ix.slice(deb, ix.indexOf('\n', deb));
    if (ligne.trim().slice(-1) === '}') return ligne;
    return ix.slice(deb, ix.indexOf('\n}', deb) + 2);
  }
  deb = ix.indexOf('window.' + nom + ' = ');
  if (deb < 0) throw new Error(nom + ' introuvable');
  return ix.slice(deb, ix.indexOf('\n};', deb) + 2).replace('window.' + nom + ' = ', '');
}
eval(ix.slice(ix.indexOf('let _stOuvert = null;'), ix.indexOf('window.staffOuvrir'))
       .replace('let _stOuvert', 'global._stOuvert'));
['stRang','stLibelleFonction','stTries','stManques','stAvatar','stFiche','renderStaff','staffOuvrir']
  .forEach(n => { global[n] = eval('(' + prendre(n) + ')'); });

// ── L'ordre de la maison ───────────────────────────────────────────────────
console.log('L’équipe se range comme on la lit');
const noms = () => stTries().map(s => s.id).join(',');
t('SANS LE PLANNING, LES FAMILLES RESTENT D’UN SEUL TENANT', noms() === 'AF,OF,CB,TV,XX');
t('... et la personne sans poste ferme la marche', stTries()[staffDB.length - 1].id === 'XX');
t('... et chaque personne y est une fois, pas deux', stTries().length === staffDB.length);

// ── Ce qui manque vraiment ─────────────────────────────────────────────────
// Le code PIN et le poste empêchent de travailler. Une photo manquante, non :
// une pastille orange pour une photo userait l'alerte jusqu'à ce qu'on ne la
// voie plus.
console.log('\nCe que « À compléter » veut dire');
const m = id => stManques(staffDB.find(s => s.id === id));
t('SANS CODE PIN, LA PERSONNE NE PEUT PAS ENTRER', m('TV').indexOf('code PIN') >= 0);
t('sans poste, le planning ne sait pas où la ranger', m('XX').indexOf('poste') >= 0);
t('une fiche complète ne signale rien', m('OF').length === 0);
t('... même sans photo, sans RPPS ni anniversaire', m('AF').length === 0);

// ── Le rendu, exécuté ──────────────────────────────────────────────────────
console.log('\nLa liste se dessine');
let jet = null;
try { renderStaff(); } catch (e) { jet = e.message; }
t('ELLE NE JETTE PAS' + (jet ? ' — ' + jet : ''), jet === null);
const vue = () => zone.innerHTML;
t('le conteneur cesse d’être une grille de cartes', zone.className === 'stl-wrap');
t('elle annonce l’effectif', /5 collaborateurs/.test(vue()));
t('une ligne par personne', (vue().match(/class="stl-r/g) || []).length === 5);
t('ON Y VOIT LE NOM, LE POSTE ET LE PORTRAIT',
  /Jean-Claude Tran Van/.test(vue()) && /class="stl-p">Préparateur/.test(vue())
  && /class="stl-av"/.test(vue()));
t('... les postes font des familles', /class="stl-grp">Pharmacien</.test(vue()));
t('... l’administrateur porte son étoile', /stl-etoile/.test(vue()));
t('... et la fiche incomplète se signale', /À compléter/.test(vue()));
t('AUCUNE FICHE N’EST OUVERTE AU DÉPART', !/class="stl-f"/.test(vue()));
// LES COMMANDES NE SONT PLUS DANS LA LISTE : c'est tout l'objet de la refonte.
t('LA LISTE NE PORTE PLUS AUCUN BOUTON', !/<button/.test(vue()));

// ── La fiche ───────────────────────────────────────────────────────────────
console.log('\nLa fiche s’ouvre au clic, et dit tout');
staffOuvrir('TV');
t('une fiche s’ouvre', (vue().match(/class="stl-f"/g) || []).length === 1);
t('... celle de la personne cliquée', /Jean-Claude Tran Van[\s\S]{0,400}class="stl-f"/.test(vue()));
t('elle montre le poste, le code, l’accès, le PIN, le RPPS, l’anniversaire, la signature, la photo et le contrat',
  ['Poste','Code','Accès','Code PIN','N° RPPS','Anniversaire','Signature','Photo','Contrat au planning']
    .every(k => vue().indexOf('>' + k + '</div>') > 0));
t('ELLE NE MONTRE JAMAIS LE CODE PIN LUI-MÊME', vue().indexOf('1234') < 0 && vue().indexOf('2345') < 0);
t('... elle dit seulement s’il est posé', /aucun — cette personne ne peut pas entrer/.test(vue()));
t('les commandes sont là, toutes', ['Code PIN','RPPS','Anniversaire','Signature','Photo','Supprimer']
  .every(b => new RegExp('>\\s*' + b.replace(/[°]/g, '.') + '</button>').test(vue().replace(/<svg[\s\S]*?<\/svg>/g, ''))));
t('... y compris les droits d’administrateur', /Rendre administrateur/.test(vue()));
staffOuvrir('CB');
t('UNE SEULE FICHE À LA FOIS — deux ouvertes, c’est une liste qu’on ne voit plus',
  (vue().match(/class="stl-f"/g) || []).length === 1 && /Céline Bourdon[\s\S]{0,400}class="stl-f"/.test(vue()));
t('... et son contrat au planning s’y lit', /contrat actif|35 h/.test(vue()));
staffOuvrir('CB');
t('recliquer la referme', !/class="stl-f"/.test(vue()));

console.log('\n' + ok + ' vérifications, ' + ko + ' échec(s)\n');
process.exit(ko ? 1 : 0);
