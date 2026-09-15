#!/usr/bin/env node
//
//  RACCORDER LES ACCUSES DE REMISE SMS
//  ═══════════════════════════════════
//
//  Brevo n'expose PAS les webhooks SMS dans son tableau de bord (verifie le
//  15/09/2026 : Transactionnel -> SMS ne propose que Temps reel, Statistiques
//  et Logs). Cela se fait uniquement par l'API — d'ou cet outil.
//
//  Ni la cle API ni le secret ne s'affichent, ne passent en argument, ni ne
//  restent dans l'historique du terminal. Ce qui sort a l'ecran, c'est ce que
//  Brevo repond, secrets retires.
//
//  Usage :
//    node outils/raccorder-accuses-sms.js            -> cree le webhook
//    node outils/raccorder-accuses-sms.js --lister   -> montre ce qui existe
//
//  Aucune dependance : tout vient de Node.
//
'use strict';
const https = require('https');

const ADRESSE = 'https://pilot.pharmacie-mondeville.fr/api/brevo/sms';
const EN_TETE = 'x-pilot-hook';

// La documentation ne fixe pas la liste exacte des noms d'evenements du canal
// SMS. Plutot que de parier, on envoie une liste et on LIT ce que Brevo repond :
// un refus nomme les valeurs acceptees, ce qui vaut mieux qu'une devinette.
const EVENEMENTS = ['sent', 'delivered', 'hardBounce', 'softBounce', 'blocked', 'unsubscribed', 'replied'];

function sortir(m) { console.error('\n  ⛔ ' + m + '\n'); process.exit(1); }

function demander(invite) {
  return new Promise((resoudre) => {
    process.stdout.write(invite);
    if (!process.stdin.isTTY) {
      let t = ''; try { t = require('fs').readFileSync(0, 'utf8'); } catch (e) {}
      process.stdout.write('\n'); return resoudre((t.split('\n')[0] || '').trim());
    }
    process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding('utf8');
    let saisie = '';
    const surTouche = (c) => {
      if (c === '\r' || c === '\n') {
        process.stdin.setRawMode(false); process.stdin.pause();
        process.stdin.removeListener('data', surTouche);
        process.stdout.write('\n'); return resoudre(saisie.trim());
      }
      if (c === '') { process.stdout.write('\n'); process.exit(130); }
      if (c === '' || c === '\b') { saisie = saisie.slice(0, -1); return; }
      saisie += c;
    };
    process.stdin.on('data', surTouche);
  });
}

function appeler(cle, methode, chemin, corps) {
  return new Promise((resoudre, rejeter) => {
    const charge = corps ? JSON.stringify(corps) : null;
    const entetes = { 'api-key': cle, 'accept': 'application/json' };
    if (charge) { entetes['content-type'] = 'application/json'; entetes['content-length'] = Buffer.byteLength(charge); }
    const req = https.request({ hostname: 'api.brevo.com', path: chemin, method: methode, headers: entetes }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        let j = null; try { j = JSON.parse(body); } catch (e) {}
        resoudre({ code: res.statusCode, corps: j, brut: body });
      });
    });
    req.on('error', rejeter);
    req.setTimeout(20000, () => req.destroy(new Error('Delai depasse')));
    if (charge) req.write(charge);
    req.end();
  });
}

// Ce qu'on affiche d'un webhook : jamais les valeurs d'en-tete.
function montrer(w) {
  const entetes = w.headers ? (Array.isArray(w.headers)
    ? w.headers.map(h => h.key || h.name).join(', ')
    : Object.keys(w.headers).join(', ')) : '(aucun)';
  console.log('    #' + w.id + '  ' + (w.channel || '?') + '/' + (w.type || '?'));
  console.log('      ' + w.url);
  console.log('      evenements : ' + ((w.events || []).join(', ') || '(aucun)'));
  console.log('      en-tetes   : ' + entetes);
}

(async () => {
  const lister = process.argv[2] === '--lister';
  if (process.argv[2] && !lister) sortir('Option inconnue. Usage : node outils/raccorder-accuses-sms.js [--lister]');

  console.log('\n  Raccordement des accuses de remise SMS\n  Rien ne s\'affichera pendant les saisies.\n');
  const cle = await demander('  Cle API Brevo : ');
  if (!cle) sortir('Aucune cle saisie.');

  if (lister) {
    const r = await appeler(cle, 'GET', '/v3/webhooks?type=transactional');
    if (r.code !== 200) sortir('Brevo ' + r.code + ' : ' + (r.corps && r.corps.message || r.brut).slice(0, 300));
    const l = (r.corps && r.corps.webhooks) || [];
    console.log('\n  ' + l.length + ' webhook(s) transactionnel(s) :\n');
    l.forEach(montrer);
    console.log('');
    return;
  }

  const secret = await demander('  Secret (celui de BREVO_HOOK_SECRET) : ');
  if (!secret) sortir('Aucun secret saisi.');
  if (secret.length < 16) sortir('Secret trop court : 32 caracteres attendus.');

  const base = {
    url: ADRESSE, channel: 'sms', type: 'transactional',
    description: 'PILOT — accuses de remise SMS', events: EVENEMENTS
  };
  // Deux formes plausibles pour les en-tetes personnalises. On essaie, on lit.
  const formes = [
    { nom: 'objet', headers: (() => { const o = {}; o[EN_TETE] = secret; return o; })() },
    { nom: 'tableau', headers: [{ key: EN_TETE, value: secret }] }
  ];

  for (const f of formes) {
    const r = await appeler(cle, 'POST', '/v3/webhooks', Object.assign({}, base, { headers: f.headers }));
    if (r.code >= 200 && r.code < 300) {
      console.log('\n  ✅ Webhook cree (forme d\'en-tete : ' + f.nom + ').\n');
      const v = await appeler(cle, 'GET', '/v3/webhooks?type=transactional');
      const l = (v.corps && v.corps.webhooks) || [];
      const n = l.filter(w => w.url === ADRESSE);
      console.log('  Ce que Brevo a retenu :\n');
      n.forEach(montrer);
      console.log('\n  VERIFIEZ la ligne « en-tetes » ci-dessus : elle doit citer ' + EN_TETE + '.');
      console.log('  Si elle dit « (aucun) », l\'en-tete n\'a pas ete enregistre et PILOT');
      console.log('  refusera les accuses — dites-le, on prendra une autre voie.\n');
      return;
    }
    const msg = (r.corps && (r.corps.message || r.corps.code)) || r.brut;
    console.log('  → forme « ' + f.nom + ' » refusee (' + r.code + ') : ' + String(msg).slice(0, 300));
  }
  sortir('Les deux formes ont ete refusees. Le message ci-dessus nomme en general\n'
    + '     les valeurs acceptees — recopiez-le, il dit quoi corriger.');
})();
