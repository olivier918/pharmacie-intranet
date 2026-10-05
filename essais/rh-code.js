// LE CODE DE LA RUBRIQUE RH — éprouvé en marche, pas seulement lu dans la source.
// node essais/rh-code.js
//
// Ce qui se joue : une seconde serrure sur les fiches du personnel. Les essais
// de `essais/rh.js` lisent le code ; ceux-ci le font tourner. Les deux servent :
// une expression régulière dit que la ligne existe, elle ne dit pas qu'elle
// refuse. On ouvre donc de VRAIES sessions, avec de vrais codes PIN, et on
// frappe aux portes.
const express = require('express');
const identite = require('../identite');
const rh = require('../rh');

let ok = 0, ko = 0;
const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };

// La base n'est jamais atteinte si la porte tient : c'est en soi une vérification.
let baseTouchee = false;
const fausseBase = { query: async () => { baseTouchee = true; return { rows: [] }; } };

function equipe() {
  const fab = (id, pin) => {
    const sel = identite.nouveauSel();
    return { id, prenom: id, pinSel: sel, pinHash: identite.empreinte(pin, sel), admin: true };
  };
  return [fab('OF', '1234'), fab('AF', '5678')];
}

async function lancer() {
  console.log('\nLE CODE DE LA RUBRIQUE RH\n');
  process.env.RH_CODE = '482913';
  const staffDB = equipe();

  const app = express();
  app.use(express.json());
  identite.installer(app, {
    lireEtat: async () => ({ staffDB }), ecrireEtat: async () => {}, journaliser: () => {}
  });
  rh.routes(app, () => fausseBase, {
    qui: identite.qui,
    estAdmin: async () => true,          // titulaire : tout est en règle SAUF le code
    codeRH: (req) => identite.jetonRHValide(req)
  });

  const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = 'http://127.0.0.1:' + srv.address().port;

  const appel = async (chemin, { methode = 'GET', corps, cookie, jeton } = {}) => {
    const h = {};
    if (corps !== undefined) h['Content-Type'] = 'application/json';
    if (cookie) h.Cookie = cookie;
    if (jeton) h['X-RH-Jeton'] = jeton;
    const r = await fetch(base + chemin, {
      method: methode, headers: h, body: corps === undefined ? undefined : JSON.stringify(corps)
    });
    let j = null; try { j = await r.json(); } catch (e) {}
    const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    return { statut: r.status, corps: j, cookie: set.map((c) => c.split(';')[0]).join('; ') };
  };

  const ouvrirSession = async (pin) => {
    const r = await appel('/api/session/pin', { methode: 'POST', corps: { pin } });
    if (r.statut !== 200 || !r.cookie) throw new Error('session non ouverte : ' + r.statut);
    return r.cookie;
  };

  const of = await ouvrirSession('1234');
  const af = await ouvrirSession('5678');

  // ── La porte est fermée tant que le code n'est pas tapé ───────────────────
  let r = await appel('/api/rh/equipe', { cookie: of });
  t('titulaire, mais sans code : la rubrique refuse', r.statut === 403 && r.corps.error === 'code_rh_requis');
  t('... et la base n’a même pas été interrogée', baseTouchee === false);

  // ── Un code faux ne donne rien ────────────────────────────────────────────
  r = await appel('/api/session/rh', { methode: 'POST', corps: { code: '000000' }, cookie: of });
  t('un code faux est refusé', r.statut === 403 && !(r.corps && r.corps.jeton));
  t('... et la réponse ne laisse rien filtrer du vrai code',
    JSON.stringify(r.corps || {}).indexOf('482913') < 0);

  // Le code seul, sans session, n'ouvre rien : les deux verrous sont bien
  // indépendants, et c'était la raison de prendre les deux.
  r = await appel('/api/session/rh', { methode: 'POST', corps: { code: '482913' } });
  t('le bon code sans session n’ouvre rien — deux verrous, pas un', r.statut === 401);

  // ── Le bon code ouvre ─────────────────────────────────────────────────────
  r = await appel('/api/session/rh', { methode: 'POST', corps: { code: '482913' }, cookie: of });
  const jeton = r.corps && r.corps.jeton;
  t('le bon code rend un jeton', r.statut === 200 && typeof jeton === 'string' && jeton.length >= 32);

  r = await appel('/api/rh/equipe', { cookie: of, jeton });
  t('avec le jeton, la rubrique s’ouvre', r.statut === 200);

  r = await appel('/api/rh/equipe', { cookie: of });
  t('sans le jeton, elle reste fermée — l’ouverture n’est pas dans le cookie', r.statut === 403);

  r = await appel('/api/rh/equipe', { cookie: of, jeton: 'jeton-invente-de-toutes-pieces' });
  t('un jeton inventé ne vaut rien', r.statut === 403);

  // ── Le jeton appartient à celui qui l'a obtenu ────────────────────────────
  r = await appel('/api/rh/equipe', { cookie: af, jeton });
  t('le jeton d’un collègue ne sert pas au suivant — il est lié à l’identité', r.statut === 403);

  // ── Refermer ──────────────────────────────────────────────────────────────
  await appel('/api/session/rh/fermer', { methode: 'POST', cookie: of, jeton });
  r = await appel('/api/rh/equipe', { cookie: of, jeton });
  t('après fermeture, le jeton ne vaut plus rien', r.statut === 403);

  // ── Sans code configuré, la rubrique est CLOSE et non ouverte ─────────────
  delete process.env.RH_CODE;
  r = await appel('/api/session/rh', { methode: 'POST', corps: { code: '482913' }, cookie: of });
  t('aucun code configuré : on refuse d’ouvrir, on ne laisse pas entrer',
    r.statut === 503 && r.corps.error === 'code_non_configure');

  srv.close();
  console.log('\n' + (ok + ko) + ' vérifications, ' + ko + ' échec(s)\n');
  process.exit(ko ? 1 : 0);
}

lancer().catch((e) => { console.error(e); process.exit(1); });
