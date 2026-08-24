// ─────────────────────────────────────────────────────────────
//  Liens de paiement en ligne (Stripe) — Pharmacie du Centre
//
//  Permet, depuis le module « Crédits / relances », de générer un lien de
//  paiement au montant voulu, de l'envoyer par SMS ou par mail au patient,
//  et de recevoir automatiquement la confirmation d'encaissement.
//
//  Variables d'environnement :
//    STRIPE_SECRET_KEY      clé secrète Stripe (sk_test_… en test, sk_live_… en réel).
//                           NON définie => fonctionnalité DÉSACTIVÉE proprement
//                           (l'appli continue de tourner, le bouton est grisé).
//    STRIPE_WEBHOOK_SECRET  secret de signature du webhook (whsec_…). Sans lui,
//                           la confirmation automatique est refusée par sécurité.
//
//  Aucune dépendance npm : appels HTTPS natifs, comme pour Brevo.
//
//  ⚠ SECRET MÉDICAL : le libellé transmis à Stripe apparaît sur le relevé
//  bancaire du patient et dans le tableau de bord Stripe. Il ne doit JAMAIS
//  contenir de nom de médicament ni d'information de santé. Le serveur refuse
//  les libellés trop longs et l'interface propose un libellé neutre par défaut.
// ─────────────────────────────────────────────────────────────
const crypto = require('crypto');
const https = require('https');

const API_HOST = 'api.stripe.com';
const LIBELLE_MAX = 90;

function secretKey() { return (process.env.STRIPE_SECRET_KEY || '').trim(); }
function webhookSecret() { return (process.env.STRIPE_WEBHOOK_SECRET || '').trim(); }
function configured() { return !!secretKey(); }
function mode() {
  const k = secretKey();
  if (!k) return null;
  return k.startsWith('sk_live_') ? 'reel' : 'test';
}

// ── Encodage form-urlencoded avec notation à crochets (format attendu par Stripe) ──
// {a:{b:1}, c:[{d:2}]}  →  a[b]=1&c[0][d]=2
function formEncode(obj, prefix, out) {
  out = out || [];
  Object.keys(obj || {}).forEach((k) => {
    const v = obj[k];
    if (v === undefined || v === null) return;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item !== null && typeof item === 'object') formEncode(item, `${key}[${i}]`, out);
        else out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
      });
    } else if (typeof v === 'object') {
      formEncode(v, key, out);
    } else {
      out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  });
  return out.join('&');
}

// ── Appel de l'API Stripe ──
function stripeCall(method, path, params) {
  return new Promise((resolve, reject) => {
    const body = params ? formEncode(params) : null;
    const headers = {
      'Authorization': 'Bearer ' + secretKey(),
      'Accept': 'application/json'
    };
    if (body) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    const req = https.request({ hostname: API_HOST, path, method, headers }, (res) => {
      let raw = '';
      res.on('data', (c) => raw += c);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch (e) {}
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(json);
        const msg = (json && json.error && json.error.message) || raw || ('HTTP ' + res.statusCode);
        const err = new Error('Stripe ' + res.statusCode + ' : ' + msg);
        err.statusCode = res.statusCode;
        err.stripeParam = json && json.error && json.error.param;
        reject(err);
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(new Error('Délai dépassé (Stripe injoignable)')); });
    if (body) req.write(body);
    req.end();
  });
}

// ── Vérification de la signature du webhook (méthode manuelle documentée par Stripe) ──
// En-tête : « t=<horodatage>,v1=<signature hex>[,v1=…] ». On recalcule
// HMAC-SHA256("<t>.<corps brut>") avec le secret, et on compare en temps constant.
// Le corps DOIT être le buffer brut : tout reparsage JSON invaliderait la signature.
function verifierSignature(rawBody, header, secret, toleranceSec) {
  toleranceSec = toleranceSec || 300;
  if (!rawBody || !header || !secret) return false;
  let t = null;
  const sigs = [];
  String(header).split(',').forEach((part) => {
    const i = part.indexOf('=');
    if (i < 0) return;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === 't') t = v;
    else if (k === 'v1') sigs.push(v);   // on ignore v0 (schémas de test) : anti-downgrade
  });
  if (!t || !sigs.length) return false;
  const ts = parseInt(t, 10);
  if (!isFinite(ts)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - ts) > toleranceSec) return false;  // anti-rejeu
  const expected = crypto.createHmac('sha256', secret).update(t + '.').update(rawBody).digest('hex');
  const eb = Buffer.from(expected, 'utf8');
  return sigs.some((s) => {
    const sb = Buffer.from(String(s), 'utf8');
    return sb.length === eb.length && crypto.timingSafeEqual(sb, eb);
  });
}

// ── Nettoyage du libellé : pas de retour à la ligne, longueur bornée ──
function nettoyerLibelle(raw) {
  return String(raw || '').replace(/\s+/g, ' ').trim().slice(0, LIBELLE_MAX);
}

// ── Création d'un lien de paiement ──
// On crée un prix ponctuel, puis un Payment Link. Contrairement à une session
// Checkout (24 h maximum), un Payment Link n'expire pas : le patient peut régler
// plusieurs jours après réception du SMS, ce qui est le cas normal en relance.
async function creerLien({ creditId, montantCents, libelle, dossier }) {
  const prix = await stripeCall('POST', '/v1/prices', {
    currency: 'eur',
    unit_amount: montantCents,
    product_data: { name: libelle }
  });

  const base = {
    line_items: [{ price: prix.id, quantity: 1 }],
    metadata: { creditId: String(creditId), dossier: String(dossier || ''), source: 'intranet-phc' },
    after_completion: {
      type: 'hosted_confirmation',
      hosted_confirmation: {
        custom_message: 'Merci, votre règlement a bien été enregistré. La Pharmacie du Centre clôture votre dossier automatiquement. Aucune démarche supplémentaire n\'est nécessaire.'
      }
    },
    // Message affiché si le patient rouvre le lien APRÈS avoir payé (le lien se
    // désactive au premier règlement). Sans cela, Stripe affiche un texte générique
    // qui laisse croire à un problème et déclenche un appel à l'officine.
    inactive_message: 'Ce lien de paiement a déjà été utilisé : votre dossier est réglé, rien ne vous est demandé. Pour toute question, la Pharmacie du Centre est joignable au 02 31 52 15 71.'
  };
  // Un lien = un seul règlement possible : évite qu'un patient paie deux fois
  // en rouvrant un vieux SMS. Si l'API refusait ce paramètre, on repart sans
  // plutôt que d'échouer (le garde-fou devient alors le contrôle à l'écran).
  try {
    return await stripeCall('POST', '/v1/payment_links',
      Object.assign({ restrictions: { completed_sessions: { limit: 1 } } }, base));
  } catch (err) {
    if (err.statusCode === 400) {
      console.warn('Stripe : paramètre « restrictions » refusé, création du lien sans limite de règlement.');
      return await stripeCall('POST', '/v1/payment_links', base);
    }
    throw err;
  }
}

// ── Désactivation d'un lien (annulation d'une relance) ──
function desactiverLien(linkId) {
  return stripeCall('POST', '/v1/payment_links/' + encodeURIComponent(linkId), { active: false });
}

// ── Recherche d'un règlement abouti sur un lien (bouton « Vérifier ») ──
async function chercherReglement(linkId) {
  const r = await stripeCall('GET',
    '/v1/checkout/sessions?limit=10&payment_link=' + encodeURIComponent(linkId), null);
  const sessions = (r && r.data) || [];
  const payee = sessions.find((s) => s.payment_status === 'paid' || s.status === 'complete');
  if (!payee) return null;
  return {
    ref: payee.id,
    montant: (payee.amount_total || 0) / 100,
    at: new Date((payee.created || Math.floor(Date.now() / 1000)) * 1000).toISOString()
  };
}

// ─────────────────────────────────────────────────────────────
//  Route WEBHOOK — à installer AVANT express.json() et AVANT le portail
//  d'authentification : Stripe n'a pas de cookie de session, et la signature
//  ne peut être vérifiée que sur le corps brut de la requête.
//  deps = { onPaid(creditId, {ref, montant, at}) : Promise<bool> }
// ─────────────────────────────────────────────────────────────
function installWebhook(app, express, deps) {
  const traites = new Set();   // ids d'événements déjà traités (anti-doublon en mémoire)

  app.post('/api/paiement/webhook', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
    const secret = webhookSecret();
    if (!secret) {
      console.warn('Webhook Stripe reçu mais STRIPE_WEBHOOK_SECRET n\'est pas défini : ignoré.');
      return res.status(400).send('webhook secret absent');
    }
    if (!verifierSignature(req.body, req.headers['stripe-signature'], secret)) {
      console.warn('Webhook Stripe : signature invalide, requête rejetée.');
      return res.status(400).send('signature invalide');
    }

    let evt = null;
    try { evt = JSON.parse(req.body.toString('utf8')); } catch (e) {
      return res.status(400).send('corps illisible');
    }

    // Réponse immédiate : Stripe exige un 2xx rapide, le traitement suit.
    res.json({ received: true });

    if (!evt || evt.type !== 'checkout.session.completed') return;
    if (evt.id && traites.has(evt.id)) return;
    if (evt.id) { traites.add(evt.id); if (traites.size > 500) traites.delete(traites.values().next().value); }

    const s = (evt.data && evt.data.object) || {};
    if (s.payment_status && s.payment_status !== 'paid') return;
    const creditId = (s.metadata && s.metadata.creditId) || null;
    if (!creditId) return;

    try {
      const ok = await deps.onPaid(creditId, {
        ref: s.id,
        montant: (s.amount_total || 0) / 100,
        at: new Date().toISOString()
      });
      console.log(ok
        ? `  💳 Paiement en ligne reçu — crédit ${creditId} soldé (${((s.amount_total || 0) / 100).toFixed(2)} €)`
        : `  💳 Paiement reçu pour le crédit ${creditId}, mais dossier introuvable ou déjà soldé.`);
    } catch (err) {
      console.error('Traitement du paiement:', err.message);
    }
  });
}

// ─────────────────────────────────────────────────────────────
//  Routes applicatives — à installer APRÈS le portail d'authentification,
//  avec les autres routes /api (elles doivent rester protégées).
// ─────────────────────────────────────────────────────────────
function installApi(app) {
  app.get('/api/paiement/status', (req, res) => {
    res.json({
      configured: configured(),
      mode: mode(),
      webhook: !!webhookSecret(),
      error: !configured() ? 'Clé Stripe absente (STRIPE_SECRET_KEY).'
           : !webhookSecret() ? 'Confirmation automatique inactive : STRIPE_WEBHOOK_SECRET n\'est pas défini.'
           : null
    });
  });

  app.post('/api/paiement/creer', async (req, res) => {
    if (!configured()) return res.status(400).json({ ok: false, error: 'Paiement en ligne non configuré sur le serveur (STRIPE_SECRET_KEY).' });
    const { creditId, montant, libelle, dossier } = req.body || {};
    if (creditId === undefined || creditId === null || creditId === '') {
      return res.status(400).json({ ok: false, error: 'Dossier de crédit manquant.' });
    }
    const cents = Math.round(parseFloat(montant) * 100);
    if (!isFinite(cents) || cents < 100) return res.status(400).json({ ok: false, error: 'Montant invalide (minimum 1,00 €).' });
    if (cents > 500000) return res.status(400).json({ ok: false, error: 'Montant trop élevé (plafond 5 000 € par lien).' });
    const lib = nettoyerLibelle(libelle);
    if (!lib) return res.status(400).json({ ok: false, error: 'Le libellé est obligatoire.' });

    try {
      const lien = await creerLien({ creditId, montantCents: cents, libelle: lib, dossier });
      return res.json({
        ok: true,
        id: lien.id,
        url: lien.url,
        montant: cents / 100,
        libelle: lib,
        mode: mode()
      });
    } catch (err) {
      console.error('Création lien de paiement:', err.message);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/paiement/verifier', async (req, res) => {
    if (!configured()) return res.status(400).json({ ok: false, error: 'Paiement en ligne non configuré.' });
    const linkId = String(req.query.linkId || '').trim();
    if (!/^plink_/.test(linkId)) return res.status(400).json({ ok: false, error: 'Identifiant de lien invalide.' });
    try {
      const r = await chercherReglement(linkId);
      return res.json({ ok: true, paye: !!r, reglement: r });
    } catch (err) {
      console.error('Vérification paiement:', err.message);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/paiement/annuler', async (req, res) => {
    if (!configured()) return res.status(400).json({ ok: false, error: 'Paiement en ligne non configuré.' });
    const linkId = String((req.body && req.body.linkId) || '').trim();
    if (!/^plink_/.test(linkId)) return res.status(400).json({ ok: false, error: 'Identifiant de lien invalide.' });
    try {
      await desactiverLien(linkId);
      return res.json({ ok: true });
    } catch (err) {
      console.error('Désactivation lien:', err.message);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });
}

function logStatus() {
  if (!configured()) { console.log('  💳 Paiement en ligne inactif (pas de STRIPE_SECRET_KEY)'); return; }
  console.log('  💳 Paiement en ligne Stripe configuré — mode ' + (mode() === 'reel' ? 'RÉEL' : 'test'));
  if (!webhookSecret()) console.log('  ⚠️  STRIPE_WEBHOOK_SECRET absent : confirmation automatique inactive (vérification manuelle uniquement)');
}

module.exports = {
  installWebhook, installApi, logStatus,
  configured, mode, verifierSignature, formEncode, nettoyerLibelle, LIBELLE_MAX
};
