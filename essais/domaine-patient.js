// LE DOMAINE PATIENT — un seul nom pour tout ce qu'on leur envoie.
// node essais/domaine-patient.js
//
// CE QUI SE JOUE. Trois choses partent par SMS vers des patients : la
// confirmation de renouvellement (/r/), la demande de document (/o/) et
// l'affiche du moment (/offre). Elles vivent dans la MÊME application, qui
// répond par chemin et non par nom d'hôte : un seul domaine les porte toutes.
//
// Le nom de ce domaine a changé — « renouvellement » ne disait plus ce qu'il
// portait, « client » le dit. Un renommage est exactement le genre de geste qui
// coupe des liens sans bruit, et ce fichier garde les trois endroits où ça
// pourrait arriver :
//
//   1. LA VARIABLE. L'ancienne (`RENOUV_BASE_URL`) doit continuer de servir
//      tant qu'elle est seule définie. Sinon, entre le déploiement et le
//      réglage de la nouvelle, les liens repartent sur le back-office.
//   2. LES POSTES. Ils ne sont pas tous sur la même version et restent ouverts
//      des journées entières : `/api/config` doit livrer l'ancienne clef ET la
//      nouvelle, et les modules doivent lire les deux.
//   3. LE CODE. Aucun domaine écrit en dur : il se règle hors du code, et un
//      nom gelé dans une ligne survivrait à tous les réglages.
const fs = require('fs'), path = require('path');
const express = require('express');
const of = require('../offres');
const dp = require('../domaine-patient');

const lire = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let ok = 0, ko = 0;
const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };

console.log('\nLE DOMAINE PATIENT — un seul nom\n');

// ── La lecture d'une adresse, en un seul endroit ────────────────────────────
console.log('Lire une adresse de domaine');
t('la barre finale est ôtée — sans quoi le lien porterait un double slash',
  of.adressePublique('https://client.pharmacie-mondeville.fr/') === 'https://client.pharmacie-mondeville.fr');
t('les espaces autour ne gênent pas — on colle souvent depuis un courriel',
  of.adressePublique('  https://client.pharmacie-mondeville.fr  ') === 'https://client.pharmacie-mondeville.fr');
t('SANS PROTOCOLE, ON REFUSE plutôt que de servir un lien de travers',
  of.adressePublique('client.pharmacie-mondeville.fr') === null);
t('vide ou absente, c’est non', of.adressePublique('') === null && of.adressePublique(null) === null);

const sv = lire('server.js');
console.log('\nLa règle n’est écrite qu’une fois');
t('server.js ne réimplémente pas la lecture, il appelle offres.adressePublique',
  /offres\.adressePublique\(process\.env\.PUBLIC_BASE_URL\)/.test(sv));

// ── L'ordre des variables ───────────────────────────────────────────────────
console.log('\nRenommer une variable ne coupe pas les liens');
const bloc = (function () {
  const i = sv.indexOf('function basePatients()');
  return sv.slice(i, sv.indexOf('\n}', i));
}());
t('la nouvelle variable est lue', /PUBLIC_BASE_URL/.test(bloc));
t('L’ANCIENNE AUSSI', /RENOUV_BASE_URL/.test(bloc));
t('... et la nouvelle passe devant',
  bloc.indexOf('PUBLIC_BASE_URL') < bloc.indexOf('RENOUV_BASE_URL'));
t('aucune des deux n’étant définie, on rend null et non une adresse inventée',
  /\|\|\s*null;/.test(bloc));

// Le même ordre, vérifié en marche sur la règle partagée.
const ordre = (pub, anc) => of.adressePublique(pub) || of.adressePublique(anc) || null;
t('réglée seule, l’ancienne sert encore',
  ordre(undefined, 'https://renouvellement.pharmacie-mondeville.fr')
  === 'https://renouvellement.pharmacie-mondeville.fr');
t('LES DEUX RÉGLÉES, LA NOUVELLE GAGNE — c’est ce qui permet de basculer',
  ordre('https://client.pharmacie-mondeville.fr', 'https://renouvellement.pharmacie-mondeville.fr')
  === 'https://client.pharmacie-mondeville.fr');
t('une nouvelle mal écrite ne fait pas taire l’ancienne',
  ordre('client.pharmacie-mondeville.fr', 'https://renouvellement.pharmacie-mondeville.fr')
  === 'https://renouvellement.pharmacie-mondeville.fr');

// ── Les postes d'hier ───────────────────────────────────────────────────────
console.log('\nUn poste ouvert depuis ce matin continue de marcher');
const cfg = sv.slice(sv.indexOf("app.get('/api/config'"), sv.indexOf("app.get('/api/config'") + 900);
t('/api/config livre la nouvelle clef', /basePatients:\s*basePatients\(\)/.test(cfg));
t('... ET L’ANCIENNE, avec la même valeur', /renouvBase:\s*basePatients\(\)/.test(cfg));

[['public/rn-module.js', 'renouvellements'], ['public/od-module.js', 'dépôt d’ordonnance']].forEach(function (x) {
  const m = lire(x[0]);
  t('le module ' + x[1] + ' lit la nouvelle clef', /c\.basePatients/.test(m));
  t('... et retombe sur l’ancienne', /c\.basePatients\s*\|\|\s*c\.renouvBase/.test(m));
});

// ── Aucun domaine gelé dans le code ─────────────────────────────────────────
//
// On cherche un nom d'hôte patient écrit en dur dans un fichier qui CONSTRUIT
// des liens. Les adresses de courriel (contact@…) et l'adresse du back-office
// dans la documentation ne comptent pas : ce qu'on traque, c'est un sous-domaine
// qui survivrait à tous les réglages.
console.log('\nLe domaine ne vit pas dans le code');
const FICHIERS = ['server.js', 'offres.js', 'depots.js', 'public/rn-module.js',
                  'public/od-module.js', 'public/of-module.js'];
const EN_DUR = /https?:\/\/[a-z0-9-]+\.pharmacie-mondeville\.fr/gi;
const coupables = [];
FICHIERS.forEach(function (f) {
  lire(f).split('\n').forEach(function (l, i) {
    const nu = l.replace(/\s+/g, ' ').trim();
    if (/^(\/\/|\*|\/\*)/.test(nu)) return;          // un commentaire peut citer un exemple
    const m = nu.match(EN_DUR);
    if (m) coupables.push(f + ':' + (i + 1) + ' → ' + m[0]);
  });
});
t('AUCUN sous-domaine écrit en dur hors commentaire'
  + (coupables.length ? ' — trouvés : ' + coupables.join(', ') : ''),
  coupables.length === 0);

console.log('\nL’affiche se range derrière, elle n’ouvre pas un domaine de plus');
t('sans réglage propre, elle suit le domaine patient',
  of.diffusion('https://client.pharmacie-mondeville.fr') === 'https://client.pharmacie-mondeville.fr');
t('server.js lui transmet bien ce domaine',
  /basePatients:\s*\(\)\s*=>\s*basePatients\(\)/.test(sv));

const exp = lire('EXPLOITATION.md');
console.log('\nLe manuel d’exploitation dit ce qui est vrai');
t('il nomme la nouvelle variable', /PUBLIC_BASE_URL/.test(exp));
t('... et dit que l’ancienne est encore lue', /RENOUV_BASE_URL/.test(exp) && /[Aa]ncien nom/.test(exp));

// ── CE QU'ON MONTRE SUR LE DOMAINE PATIENT ──────────────────────────────────
//
// Une seule application, deux noms. Elle repond par chemin : sans ce tri,
// client.pharmacie-mondeville.fr rendait a la racine l'ECRAN DE CONNEXION DE
// L'OFFICINE. Un patient qui tronque le lien de son SMS tombait sur
// « PILOT — Acces officine ».
async function lancer() {
  const PAT = 'https://client.pharmacie-mondeville.fr';
  const HOTE = 'client.pharmacie-mondeville.fr';
  const BO = 'pilot.pharmacie-mondeville.fr';

  console.log('\nReconnaitre le domaine patient');
  t('le nom regle est reconnu', dp.memeHote(HOTE, PAT));
  t('le back-office ne l’est pas', !dp.memeHote(BO, PAT));
  t('la casse ne decide de rien', dp.memeHote('Client.Pharmacie-Mondeville.FR', PAT));
  t('plusieurs hotes enchaines : on prend le premier',
    dp.memeHote(HOTE + ', autre.example', PAT));
  t('SANS RÉGLAGE, AUCUN HÔTE N’EST LE DOMAINE PATIENT — le module dort',
    !dp.memeHote(HOTE, null) && !dp.memeHote(HOTE, ''));
  t('une adresse illisible ne reconnait rien', !dp.memeHote(HOTE, 'pas une adresse'));

  console.log('\nCe qui a sa place sur le domaine patient');
  ['/offre', '/offre/avene', '/r/abc123', '/o', '/o/jeton', '/api/renouv/x',
   '/api/depot', '/api/depot/etat', '/favicon.ico', '/manifest.webmanifest'
  ].forEach(function (c) { t(c + ' passe', dp.estCheminPatient(c)); });

  console.log('\nCe qui n’y a pas sa place');
  ['/', '/index.html', '/planning', '/rh', '/api/data', '/api/login', '/depot.html',
   '/of-module.js', '/api/offres'
  ].forEach(function (c) { t(c + ' ne passe pas', !dp.estCheminPatient(c)); });

  // LA LISTE DOIT SUIVRE LES PAGES. Si renouv.html se met demain a charger une
  // feuille de style depuis public/, elle sera redirigee et la page patiente
  // s'affichera cassee -- sans que personne ne l'ait vu venir.
  console.log('\nLes pages patients n’appellent rien d’autre');
  ['public/renouv.html', 'public/depot.html'].forEach(function (f) {
    const html = lire(f);
    const demandes = [];
    (html.match(/(?:href|src)="(\/[^"]*)"/g) || []).forEach(function (m) {
      demandes.push(m.replace(/^(?:href|src)="/, '').replace(/"$/, ''));
    });
    (html.match(/fetch\('(\/[^']*)/g) || []).forEach(function (m) {
      demandes.push(m.replace(/^fetch\('/, ''));
    });
    const refusees = demandes.filter(function (c) { return !dp.estCheminPatient(c); });
    t(f + ' ne demande que des chemins autorises'
      + (refusees.length ? ' — refusés : ' + refusees.join(', ') : ''),
      demandes.length > 0 && refusees.length === 0);
  });

  // ── En marche ─────────────────────────────────────────────────────────────
  const app = express();
  let BASE = PAT;
  dp.installer(app, { base: () => BASE });
  // Ce qui vit derriere : les routes patients, et le portail pour tout le reste.
  app.get('/offre', (req, res) => res.type('html').send('affiche'));
  app.get('/r/:j', (req, res) => res.type('html').send('renouvellement'));
  app.use((req, res) => res.type('html').send('PILOT — Acces officine'));

  const srv = await new Promise(r => { const x = app.listen(0, () => r(x)); });
  const port = srv.address().port;
  // `fetch` refuse de poser un en-tete Host : il le deduit de l'adresse. Or
  // c'est precisement l'en-tete qu'on teste. On descend donc d'un etage.
  const http = require('http');
  const voir = (chemin, hote, methode) => new Promise((ok, non) => {
    const q = http.request(
      { host: '127.0.0.1', port: port, path: chemin, method: methode || 'GET',
        headers: { Host: hote } },
      (r) => {
        let corps = '';
        r.on('data', (m) => { corps += m; });
        r.on('end', () => ok({ code: r.statusCode, vers: r.headers.location,
                               cache: r.headers['cache-control'], corps: corps }));
      });
    q.on('error', non);
    q.end();
  });

  console.log('\nLa racine du domaine patient');
  let r = await voir('/', HOTE);
  t('ELLE NE REND PLUS L’ÉCRAN DE CONNEXION DE L’OFFICINE',
    !/Acces officine/.test(r.corps));
  t('... elle renvoie vers l’affiche du moment', r.code === 302 && r.vers === '/offre');
  t('... sans mise en cache : le renvoi ne doit pas se figer chez le patient',
    /no-store/.test(r.cache || ''));

  console.log('\nLe reste du domaine patient');
  for (const c of ['/planning', '/rh', '/index.html', '/api/data']) {
    r = await voir(c, HOTE);
    t(c + ' renvoie vers l’affiche', r.code === 302 && r.vers === '/offre');
  }
  r = await voir('/offre', HOTE);
  t('/offre est servie, elle', r.code === 200 && /affiche/.test(r.corps));
  r = await voir('/r/abc', HOTE);
  t('un lien de renouvellement passe', r.code === 200 && /renouvellement/.test(r.corps));
  r = await voir('/api/data', HOTE, 'POST');
  t('UNE REQUÊTE QUI N’EST PAS UNE NAVIGATION N’EST PAS DÉTOURNÉE — 404 ordinaire',
    r.code === 404);

  console.log('\nLe back-office, lui, ne change pas');
  r = await voir('/', BO);
  t('sa racine reste ce qu’elle était', r.code === 200);
  r = await voir('/planning', BO);
  t('ses pages aussi', r.code === 200);

  console.log('\nSans réglage, le module dort');
  BASE = null;
  r = await voir('/', HOTE);
  t('plus rien n’est détourné', r.code === 200);
  BASE = PAT;
  srv.close();

  // ── Le montage ────────────────────────────────────────────────────────────
  console.log('\nLe montage dans server.js');
  const iTri = sv.indexOf('domainePatient.installer(');
  const iGate = sv.indexOf('app.use(auth.gate)');
  const iOffre = sv.indexOf('offres.publiques(');
  const iDepot = sv.indexOf('depots.installer(');
  t('le tri est monté', iTri > 0);
  t('APRÈS les routes publiques — sinon il les détournerait elles aussi',
    iTri > iOffre && iTri > iDepot);
  t('et AVANT le portail — sinon le patient verrait l’écran de connexion',
    iTri < iGate);
  t('le démarrage annonce le renvoi, pour qu’une variable mal réglée se voie',
    /renvoie vers \/offre/.test(sv));

  console.log('\n' + ok + ' vérifications, ' + ko + ' échec(s)\n');
  process.exit(ko ? 1 : 0);
}

lancer().catch(e => { console.error('ESSAI INTERROMPU :', e); process.exit(1); });

