// LES PIÈCES JOINTES D'UNE LIVRAISON.
// node essais/livraison-pieces-jointes.js
//
// Une ordonnance photographiée, un devis, le courrier d'une mutuelle : ce qui
// accompagne une livraison se perdait sur un bureau. On le range avec elle.
//
// DEUX CHOSES SE JOUENT ICI, ET AUCUNE N'EST COSMÉTIQUE :
//   • le fichier part dans le COFFRE (/api/images, chiffré, dédupliqué) et
//     jamais dans le blob de données, qui part en clair à chaque
//     synchronisation et serait recopié toutes les huit secondes ;
//   • la liste en cours de saisie vit HORS de la livraison, parce qu'une
//     livraison neuve n'existe pas encore, et qu'une livraison ouverte en
//     modification peut être remplacée sous nos pieds par la resynchronisation
//     (piège n°5). C'est « Enregistrer » qui la pose, comme tout le reste.
const fs = require('fs'), path = require('path');
const ix = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

let ok = 0, ko = 0;
const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };
console.log('\nLES PIÈCES JOINTES D’UNE LIVRAISON\n');

// ── Le document de poche ───────────────────────────────────────────────────
const champs = {};
function champ(id) {
  if (!champs[id]) champs[id] = { id: id, value: '', checked: false, innerHTML: '',
                                  style: {}, dataset: {}, focus: function () {} };
  return champs[id];
}
global.document = { getElementById: champ };
let alerte = null;
global.alert = function (m) { alerte = m; };
global.deliveries = []; global.patients = [];
global.currentUser = { id: 'OF' };
global.nowStamp = () => '2026-11-13 09:00';
global.renderD = () => {}; global.majFabLiv = () => {}; global.formEnVue = () => {};
global.hEsc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
let horloge = 1763020800000;
Date.now = () => horloge++;

// Les appels réseau, observés plutôt que faits.
const appels = [];
global.fetch = async function (url, opts) {
  appels.push({ url: url, corps: JSON.parse((opts && opts.body) || '{}') });
  return { ok: true, status: 200, json: async () => ({ ok: true, id: 'a1b2c3d4e5f60718293a4b5c6d7e8f90' }) };
};
// Un lecteur de fichier de poche : il rend la data-URL que le vrai rendrait.
global.FileReader = function () {
  this.readAsDataURL = (f) => { this.result = 'data:' + (f.type || 'application/octet-stream')
    + ';base64,' + Buffer.from(f._contenu || 'coucou').toString('base64');
    setTimeout(() => this.onload && this.onload(), 0); };
};
const fichier = (nom, type, taille) => ({ name: nom, type: type || '', size: taille || 1234, _contenu: 'x' });

function prendre(nom) {
  let deb = ix.indexOf('function ' + nom + '(');
  if (deb >= 0) {
    const ligne = ix.slice(deb, ix.indexOf('\n', deb));
    // Une fonction d'une seule ligne se referme sur cette ligne ; les autres
    // sur une accolade en debut de ligne.
    if (ligne.trim().slice(-1) === '}') return ligne;
    return ix.slice(deb, ix.indexOf('\n}', deb) + 2);
  }
  deb = ix.indexOf('window.' + nom + ' = ');
  if (deb < 0) throw new Error(nom + ' introuvable');
  return ix.slice(deb, ix.indexOf('\n};', deb) + 2).replace('window.' + nom + ' = ', '');
}
// Les constantes du module, prises telles quelles — AVANT les fonctions, qui
// s'en servent : un `const` eval-e dans une fonction ne serait visible que la.
eval(ix.slice(ix.indexOf('const D_PJ_LBL = {'), ix.indexOf('let dPJ = [];'))
       .replace(/^const /gm, 'global.'));
global.dPJ = [];
['dobFr','dobIso','dobMasque','dobPoser','dobExigee','upsertPatient','dCompleterPatient',
 'dPjMime','dPjLireBase64','dPjRendre','dPjAjouter','dPjRetirer','openDForm','closeDForm','saveD']
  .forEach(n => { global[n] = eval('(' + prendre(n) + ')'); });

// ── Le type du fichier ─────────────────────────────────────────────────────
console.log('Ce que l’on accepte de joindre');
t('un PDF annoncé par le navigateur', dPjMime(fichier('ordo.pdf', 'application/pdf')) === 'application/pdf');
t('une photo', dPjMime(fichier('photo.jpg', 'image/jpeg')) === 'image/jpeg');
// UN SCAN ARRIVÉ D'UN RÉSEAU PARTAGÉ arrive parfois sans type du tout.
t('UN FICHIER SANS TYPE EST RECONNU À SON EXTENSION', dPjMime(fichier('ordo.pdf', '')) === 'application/pdf');
t('... en majuscules aussi', dPjMime(fichier('ORDO.PDF', '')) === 'application/pdf');
t('un devis Excel passe', /spreadsheetml/.test(dPjMime(fichier('devis.xlsx', '')) || ''));
t('UN EXÉCUTABLE NE PASSE PAS', dPjMime(fichier('virus.exe', 'application/x-msdownload')) === null);
t('... ni un fichier texte sans extension connue', dPjMime(fichier('notes.txt', 'text/plain')) === null);

// ── Le dépôt ───────────────────────────────────────────────────────────────
console.log('\nLe fichier part dans le coffre, jamais dans le blob');
(async () => {
  dPJ.length = 0; appels.length = 0; alerte = null;
  await dPjAjouter({ files: [fichier('ordonnance-dupont.pdf', 'application/pdf', 50000)], value: 'x' });
  t('UNE PIÈCE JOINTE PART VERS /api/images', appels.length === 1 && appels[0].url === '/api/images');
  t('... avec son type, et son contenu en base64',
    appels[0].corps.mime === 'application/pdf' && typeof appels[0].corps.data === 'string');
  t('... et la livraison ne garde que l’identifiant, le nom et le type',
    dPJ.length === 1 && dPJ[0].id.length === 32 && dPJ[0].nom === 'ordonnance-dupont.pdf'
    && dPJ[0].mime === 'application/pdf' && !('data' in dPJ[0]));
  t('... avec qui l’a jointe', dPJ[0].par === 'OF' && !!dPJ[0].le);

  // UN FICHIER TROP LOURD N'EST MÊME PAS LU : le refuser après l'avoir envoyé
  // ne servirait qu'à faire attendre.
  appels.length = 0; alerte = null;
  await dPjAjouter({ files: [fichier('scan-enorme.pdf', 'application/pdf', 9 * 1024 * 1024)], value: 'x' });
  t('UN FICHIER DE PLUS DE 8 Mo EST REFUSÉ AVANT TOUT ENVOI',
    appels.length === 0 && dPJ.length === 1 && /8 Mo/.test(alerte || ''));
  appels.length = 0; alerte = null;
  await dPjAjouter({ files: [fichier('virus.exe', 'application/x-msdownload')], value: 'x' });
  t('... un type refusé non plus', appels.length === 0 && dPJ.length === 1 && /accept/.test(alerte || ''));

  // ── Le formulaire ────────────────────────────────────────────────────────
  console.log('\nLe formulaire les charge, les vide et les enregistre');
  champ('dv-date').value = '2026-11-13';
  champ('d-nom').value = 'THOMAS'; champ('d-prenom').value = 'Liliane'; champ('d-dob').value = '25/03/1938';
  champ('d-lieu').value = 'Domicile'; champ('d-date').value = '2026-11-13';
  alerte = null;
  saveD();
  t('ENREGISTRER POSE LES PIÈCES SUR LA LIVRAISON',
    deliveries.length === 1 && (deliveries[0].pj || []).length === 1
    && deliveries[0].pj[0].nom === 'ordonnance-dupont.pdf');
  t('... et la liste de saisie est une COPIE, pas la même', deliveries[0].pj !== dPJ);

  openDForm();
  t('UN FORMULAIRE NEUF N’HÉRITE PAS DES PIÈCES DU PATIENT PRÉCÉDENT', dPJ.length === 0);
  openDForm(deliveries[0].id);
  t('... et rouvrir une livraison les retrouve', dPJ.length === 1
    && dPJ[0].nom === 'ordonnance-dupont.pdf');
  t('... sans partager l’objet de la livraison', dPJ !== deliveries[0].pj);
  dPjRetirer(0);
  t('retirer une pièce la retire de la saisie', dPJ.length === 0);
  t('... mais la livraison ne change qu’à l’enregistrement', (deliveries[0].pj || []).length === 1);
  saveD();
  t('... et alors elle change', (deliveries[0].pj || []).length === 0);

  // ── Ce que le code promet ────────────────────────────────────────────────
  console.log('\nCe que le code tient par ailleurs');
  t('la carte de livraison montre les pièces, sans ouvrir le formulaire',
    /class="dc-pj" href="\/api\/images\/\$\{hEsc\(x\.id\)\}/.test(ix));
  t('... et elles ne salissent pas la feuille de tournée', /dc-row2 no-print">\$\{d\.pj/.test(ix));
  t('RETIRER NE SUPPRIME PAS LE FICHIER DU COFFRE — il est dédupliqué',
    /On détache, on ne détruit pas\./.test(ix));
  t('le ticket remis au patient n’en parle pas', !/pj/.test(ix.slice(ix.indexOf('function ticketHTML'),
    ix.indexOf('function ticketHTML') + 2600)));

  console.log('\n' + ok + ' vérifications, ' + ko + ' échec(s)\n');
  process.exit(ko ? 1 : 0);
})();
