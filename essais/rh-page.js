// LA PAGE DU SUIVI RH — éprouvée en marche.
// node essais/rh-page.js
//
// Ce qui se joue : rendre le dispositif INVISIBLE, pas seulement inaccessible.
// Avant, tout poste ouvrant le planning téléchargeait `rh-module.js` — quarante
// kilooctets lisibles où l'on apprenait l'existence du compteur de silence.
// Aucune donnée ne fuyait ; le dispositif, lui, était à nu.
//
// Une expression régulière dit que la ligne existe, elle ne dit pas que le
// serveur refuse. On monte donc les vraies routes et on frappe aux portes, avec
// et sans session de titulaire.
const express = require('express');
const path = require('path');
const fs = require('fs');
const identite = require('../identite');

let ok = 0, ko = 0;
const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };

function equipe() {
  const fab = (id, pin, admin) => {
    const sel = identite.nouveauSel();
    return { id, prenom: id, nom: id, poste: admin ? 'Pharmacien titulaire' : 'Préparatrice',
             pinSel: sel, pinHash: identite.empreinte(pin, sel), admin: admin };
  };
  return [fab('OF', '1234', true), fab('SM', '9876', false)];
}

async function lancer() {
  console.log('\nLA PAGE DU SUIVI RH — servie, ou introuvable\n');
  const staffDB = equipe();
  const rac = path.join(__dirname, '..');

  const app = express();
  app.use(express.json());
  identite.installer(app, {
    lireEtat: async () => ({ staffDB }), ecrireEtat: async () => {}, journaliser: () => {}
  });

  // Le statique, tel que le serveur le monte : ce qui est dans public/ est
  // servi a tout le monde. C'est precisement ce qu'on veut verifier.
  app.use(express.static(path.join(rac, 'public')));

  const estAdministrateur = async (uid) => {
    const s = staffDB.find(x => x.id === uid);
    return !!(s && s.admin === true);
  };
  const garde = (fichier) => async (req, res, next) => {
    try {
      const uid = identite.qui(req);
      if (!uid || !(await estAdministrateur(uid))) return next();
    } catch (e) { return next(); }
    res.sendFile(path.join(rac, 'prive', fichier));
  };
  app.get('/rh', garde('rh.html'));
  app.get('/rh-module.js', garde('rh-module.js'));

  const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = 'http://127.0.0.1:' + srv.address().port;

  const frapper = async (chemin, cookie) => {
    const r = await fetch(base + chemin, { headers: cookie ? { cookie } : {} });
    return { code: r.status, corps: await r.text() };
  };
  const ouvrirSession = async (pin) => {
    const r = await fetch(base + '/api/session/pin', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin })
    });
    const brut = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')];
    return (brut || []).filter(Boolean).map(c => c.split(';')[0]).join('; ');
  };

  // ── SANS SESSION ──────────────────────────────────────────────────────────
  console.log('Sans session');
  let a = await frapper('/rh');
  t('la page du suivi RH est introuvable', a.code === 404);
  let b = await frapper('/rh-module.js');
  t('le module aussi', b.code === 404);
  // LE 404 DOIT ETRE LE MEME que celui d'une adresse qui n'existe pas : un
  // refus distinct dirait deja qu'il y a quelque chose a cet endroit.
  const neant = await frapper('/cette-adresse-n-existe-pas');
  t('... et c’est le 404 ORDINAIRE, celui d’une adresse qui n’existe pas',
    a.code === neant.code && a.corps === neant.corps.replace('cette-adresse-n-existe-pas', 'rh'));

  // ── SESSION DE PRÉPARATRICE ───────────────────────────────────────────────
  console.log('\nAvec une session de préparatrice');
  const cSM = await ouvrirSession('9876');
  t('la session s’ouvre bien', !!cSM);
  a = await frapper('/rh', cSM);
  t('la page reste introuvable', a.code === 404);
  b = await frapper('/rh-module.js', cSM);
  t('le module reste introuvable', b.code === 404);
  t('... et rien de son contenu n’a transité', !/compteur de silence|rhJeton/.test(b.corps));

  // ── SESSION DE TITULAIRE ──────────────────────────────────────────────────
  console.log('\nAvec une session de titulaire');
  const cOF = await ouvrirSession('1234');
  a = await frapper('/rh', cOF);
  t('la page est servie', a.code === 200);
  t('... et c’est bien celle du suivi RH', /id="rh-host"/.test(a.corps));
  t('... qui appelle le module par son adresse gardée', /src="\/rh-module\.js"/.test(a.corps));
  b = await frapper('/rh-module.js', cOF);
  t('le module est servi', b.code === 200);
  t('... et c’est bien lui', /rhRendreEquipe/.test(b.corps));

  // ── CE QUE LE STATIQUE NE SERT PLUS ───────────────────────────────────────
  // Le vrai defaut d'avant : le fichier vivait dans public/, donc n'importe
  // qui l'obtenait sans la moindre garde.
  console.log('\nCe que le statique ne sert plus à personne');
  for (const chemin of ['/rh-module.js'.replace('/rh', '/public/rh'), '/rh.html']) {
    const r = await frapper(chemin, cSM);
    t('« ' + chemin +' » est introuvable même avec une session', r.code === 404);
  }
  t('le module n’est plus dans public/',
    !fs.existsSync(path.join(rac, 'public', 'rh-module.js')));
  t('il est dans prive/', fs.existsSync(path.join(rac, 'prive', 'rh-module.js')));
  t('la page aussi', fs.existsSync(path.join(rac, 'prive', 'rh.html')));

  // ── LE PLANNING N'EN PARLE PLUS ───────────────────────────────────────────
  console.log('\nLe planning, servi à toute l’équipe');
  const pl = await frapper('/planning.html', cSM);
  t('il est bien servi à une préparatrice', pl.code === 200);
  t('... et il ne contient plus une mention du suivi RH', !/\brh\b/i.test(pl.corps));
  t('... ni l’appel de son module', !/rh-module/.test(pl.corps));

  srv.close();
  console.log('\n' + ok + ' vérifications, ' + ko + ' échec(s)\n');
  process.exit(ko ? 1 : 0);
}

lancer().catch(e => { console.error('ESSAI INTERROMPU :', e); process.exit(1); });
