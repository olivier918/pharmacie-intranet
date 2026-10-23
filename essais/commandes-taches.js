// LES TÂCHES DE COMMANDE — un laboratoire à commander apparaît dans la to-do
// list de ceux qui l'appellent, et disparaît chez TOUS dès que la commande
// est marquée passée.
// node essais/commandes-taches.js
const C = require('../commandes');
const fs = require('fs'), path = require('path'), vm = require('vm');
const coSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'co-module.js'), 'utf8');
const acSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'ac-module.js'), 'utf8');
const svSrc = fs.readFileSync(path.join(__dirname, '..', 'commandes.js'), 'utf8');

let ok = 0, ko = 0;
const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };
console.log('\nTÂCHES DE COMMANDE — la to-do list suit la liste du jour\n');

const H = 3600e3;
const MAINTENANT = Date.parse('2026-10-23T09:00:00+02:00');
const p = (code, urgence, statut) => ({ code: code, urgence: urgence, statut: statut || null });
function syn(labos, fiches, ageH) {
  return { id: 7, date: new Date(MAINTENANT - (ageH || 2) * H).toISOString(),
           labos: labos, fiches: fiches || {} };
}

// ── CE QUI DONNE UNE TÂCHE ───────────────────────────────────────────────────
console.log('Ce qui donne une tâche (serveur)');
let r = C.tachesCommande(syn([
  { labo: 'MKL', urgence: 'rouge', produits: [p('1', 'rouge'), p('2', 'orange'), p('3', 'gris')] },
  { labo: 'SVR', urgence: 'orange', produits: [p('4', 'orange')] },
  { labo: 'BIODERMA', urgence: 'gris', produits: [p('5', 'gris')] },
  { labo: 'URIAGE', urgence: 'relance', produits: [p('6', 'relance')] }
], { MKL: { operateurs: ['JP'] } }), MAINTENANT);
t('un laboratoire rouge et un orange donnent deux tâches', r.length === 2);
t('le « pas pressé » ne donne pas de case à cocher', !r.some(x => x.labo === 'BIODERMA'));
t('une relance n’est pas une commande à passer', !r.some(x => x.labo === 'URIAGE'));
t('seuls les produits rouge/orange sont à commander', r[0].codes.join() === '1,2');
t('l’urgent passe en tête', r[0].labo === 'MKL' && r[0].urgence === 'rouge');
t('les opérateurs de la fiche suivent la tâche', r[0].operateurs.join() === 'JP');
t('sans fiche, la tâche n’a personne : elle ira aux administrateurs',
  Array.isArray(r[1].operateurs) && r[1].operateurs.length === 0);

console.log('\nLa tâche s’éteint quand la commande est passée');
r = C.tachesCommande(syn([
  { labo: 'MKL', urgence: 'rouge', produits: [p('1', 'rouge', 'commandee'), p('2', 'orange')] }
]), MAINTENANT);
t('un produit commandé sort de la tâche, le reste y demeure', r.length === 1 && r[0].codes.join() === '2');
t('... et l’urgence suit ce qui reste', r[0].urgence === 'orange');
r = C.tachesCommande(syn([
  { labo: 'MKL', urgence: 'rouge', produits: [p('1', 'rouge', 'commandee'), p('2', 'orange', 'ignoree')] }
]), MAINTENANT);
t('tout commandé ou ignoré : plus de tâche, pour personne', r.length === 0);

console.log('\nUne liste périmée ne fait appeler personne');
t('une synthèse de 30 h donne encore ses tâches',
  C.tachesCommande(syn([{ labo: 'A', produits: [p('1', 'rouge')] }], {}, 30), MAINTENANT).length === 1);
t('une synthèse de plus de 36 h n’en donne aucune',
  C.tachesCommande(syn([{ labo: 'A', produits: [p('1', 'rouge')] }], {}, 37), MAINTENANT).length === 0);
t('même seuil que l’avertissement de la page Commandes', C.TACHES_PERIME_H === 36
  && /const PERIME_H = 36;/.test(coSrc));
t('aucune synthèse : aucune tâche, sans erreur',
  C.tachesCommande(null).length === 0 && C.tachesCommande({}).length === 0);
t('un laboratoire à identifier reste une tâche (sans nom)',
  C.tachesCommande(syn([{ labo: null, produits: [p('9', 'orange')] }]), MAINTENANT)[0].labo === null);

console.log('\nLa route');
t('GET /api/commandes/taches est déclarée', /app\.get\('\/api\/commandes\/taches'/.test(svSrc));
t('... et s’appuie sur la même lecture que la page', /tachesCommande\(syn\)/.test(svSrc));

// ── LE POSTE : À QUI VA LA TÂCHE, ET LE GESTE QUI L'ÉTEINT ──────────────────
console.log('\nÀ qui va la tâche (poste)');
function poste(uid, admin, taches) {
  const appels = [];
  const el = () => ({ style: {}, setAttribute() {}, appendChild() {}, classList: { add() {}, remove() {} } });
  const ctx = {
    console, JSON, Date, Math, Promise, setTimeout, clearTimeout,
    document: { readyState: 'complete', head: el(), getElementById: () => null,
                querySelector: () => null, querySelectorAll: () => [], createElement: el,
                addEventListener() {}, removeEventListener() {} },
    localStorage: { getItem: () => null, setItem() {} },
    currentUser: uid ? { id: uid } : null,
    isAdmin: () => admin,
    confirm: () => true, alert: () => {}, addEventListener() {}, removeEventListener() {},
    fetch: async (url, o) => {
      appels.push({ url, body: o && o.body ? JSON.parse(o.body) : null });
      if (url.indexOf('/api/commandes/taches') === 0)
        return { json: async () => ({ ok: true, syntheseId: 7, taches: taches }) };
      if (url.indexOf('/api/commandes/courant') === 0)
        return { json: async () => ({ ok: true, synthese: null }) };
      return { json: async () => ({ ok: true }) };
    }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(coSrc, ctx);
  return { ctx, appels };
}
const TACHES = [
  { labo: 'MKL', urgence: 'rouge', codes: ['1', '2'], operateurs: ['JP'] },
  { labo: 'SVR', urgence: 'orange', codes: ['4'], operateurs: [] }
];
const attendre = () => new Promise(r => setTimeout(r, 20));

(async function () {
  let x = poste('JP', false, TACHES);
  await attendre();
  t('l’opérateur désigné reçoit la tâche de son laboratoire',
    x.ctx.coMesTaches().map(c => c.labo).join() === 'MKL');
  t('... mais pas celle d’un laboratoire sans opérateur', !x.ctx.coMesTaches().some(c => c.labo === 'SVR'));

  x = poste('AF', true, TACHES);
  await attendre();
  t('un administrateur reçoit les laboratoires sans opérateur (Anouck, Olivier)',
    x.ctx.coMesTaches().map(c => c.labo).join() === 'SVR');
  t('... et pas ceux qui sont attribués à quelqu’un d’autre',
    !x.ctx.coMesTaches().some(c => c.labo === 'MKL'));

  x = poste('MB', false, TACHES);
  await attendre();
  t('un collègue sans laboratoire n’a rien', x.ctx.coMesTaches().length === 0);
  x = poste(null, false, TACHES);
  await attendre();
  t('personne d’identifié : rien', x.ctx.coMesTaches().length === 0);

  console.log('\nCocher la tâche, c’est « commande passée »');
  x = poste('JP', false, TACHES);
  await attendre();
  const box = { checked: true, getAttribute: () => 'MKL' };
  await x.ctx.coTachePassee(box);
  const st = x.appels.filter(a => a.url === '/api/commandes/statut');
  t('chaque produit restant est marqué commandé', st.length === 2
    && st.every(a => a.body.statut === 'commandee' && a.body.syntheseId === 7)
    && st.map(a => a.body.code).join() === '1,2');
  t('... puis la liste des tâches est relue, pour l’éteindre',
    x.appels.filter(a => a.url === '/api/commandes/taches').length >= 2);

  x = poste('JP', false, TACHES);
  await attendre();
  x.ctx.confirm = () => false;
  const box2 = { checked: true, getAttribute: () => 'MKL' };
  await x.ctx.coTachePassee(box2);
  t('refuser la confirmation ne marque rien et décoche la case',
    !x.appels.some(a => a.url === '/api/commandes/statut') && box2.checked === false);

  console.log('\nL’accueil');
  t('la todo affiche les commandes avant les tâches écrites',
    /cmd\.map\(acLigneCommande\)\.join\(''\) \+ mien\.map/.test(acSrc));
  t('la pastille les compte', /acMesTodos\(\)\.length \+ acCommandes\(\)\.length/.test(acSrc));
  t('une commande urgente allume le rouge', /acCommandes\(\)\.some\(c => c\.urgence === 'rouge'\)/.test(acSrc));
  t('le module Commande peut redessiner la todo', /window\.acRendTodos = acRendTodos;/.test(acSrc));
  t('rien n’est écrit dans todoPerso pour une commande', !/todoPerso/.test(coSrc));

  console.log('\n' + ok + ' réussi(s), ' + ko + ' échec(s)\n');
  process.exit(ko ? 1 : 0);
}());
