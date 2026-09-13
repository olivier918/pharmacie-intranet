// ─────────────────────────────────────────────────────────────────────────────
//  DURCISSEMENT — en-tetes de securite et limitation de debit
// ─────────────────────────────────────────────────────────────────────────────
//
//  POURQUOI PAS HELMET. Une quinzaine d'en-tetes ne justifie pas une dependance
//  de plus : chaque paquet ajoute est une surface d'approvisionnement a
//  surveiller, et celui-ci ne fait rien qu'on ne puisse ecrire ici, en clair,
//  ou chacun peut lire ce qui est envoye et pourquoi.
//
//  LA REGLE DU FREINAGE. Une limite de debit qui gene le comptoir sera
//  contournee, puis retiree. Les seuils ci-dessous sont calibres tres au-dessus
//  de l'usage reel d'une officine : ils n'existent pas pour brider l'equipe,
//  mais pour arreter une boucle partie de travers et une passerelle detournee.
//  Un envoi legitime ne doit JAMAIS les rencontrer.
// ─────────────────────────────────────────────────────────────────────────────

// ── Ce que la page a le droit de charger ────────────────────────────────────
// Les scripts et les styles sont massivement integres a la page : 'unsafe-inline'
// est inevitable tant que ce n'est pas repris, et le dire franchement vaut mieux
// que de pretendre une CSP stricte. Ce qui est gagne malgre cela, et qui compte :
// aucun script d'un domaine tiers ne peut s'executer, la page ne peut pas etre
// encadree par un site tiers, et aucun formulaire ne peut poster ailleurs.
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  // jsPDF, servi par cdnjs — les rapports imprimables en dependent.
  "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  // data: et blob: : les scans d'ordonnance affiches avant leur reprise, et les
  // fichiers construits en memoire (exports CSV, PDF).
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  // Les scans PDF s'ouvrent dans un cadre ; la fenetre d'impression aussi.
  "frame-src 'self' data: blob:",
  "connect-src 'self'",
  "worker-src 'self' blob:"
].join('; ');

// Aucune de ces capacites n'est utilisee par PILOT. Les refuser explicitement
// evite qu'un script injecte s'en serve, et qu'une evolution les ouvre par
// inadvertance.
const PERMISSIONS = 'geolocation=(), microphone=(), camera=(), payment=(), usb=(), magnetometer=(), gyroscope=()';

function enTetes(req, res, suite) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('Permissions-Policy', PERMISSIONS);
  res.setHeader('Content-Security-Policy', CSP);
  // HSTS seulement quand la requete est bien arrivee en HTTPS. Poser cet en-tete
  // sur une connexion locale en clair condamnerait le poste a ne plus joindre le
  // serveur de l'officine pendant six mois, sans recours simple.
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  if (proto === 'https') res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  suite();
}

// ── Le freinage ─────────────────────────────────────────────────────────────
// Fenetres glissantes, en memoire. Le serveur est unique : une table partagee
// serait plus juste apres une mise a l'echelle, elle n'apporterait rien ici.
function limiteur(nom, regles, clef) {
  const seaux = new Map();   // clef -> [{ debut, n }, ... ] dans l'ordre de `regles`
  let dernierBalayage = Date.now();
  const plusLongue = regles.reduce((m, r) => Math.max(m, r.fenetreMs), 0);

  return function (req, res, suite) {
    const maintenant = Date.now();
    // Menage : sans lui, la table garde une entree par adresse vue depuis le
    // demarrage. Un balayage par heure suffit largement.
    if (maintenant - dernierBalayage > 3600000) {
      dernierBalayage = maintenant;
      for (const [k, v] of seaux) if (maintenant - v[v.length - 1].debut > plusLongue) seaux.delete(k);
    }
    const k = String(clef(req) || '?');
    let etat = seaux.get(k);
    if (!etat) { etat = regles.map(() => ({ debut: maintenant, n: 0 })); seaux.set(k, etat); }
    for (let i = 0; i < regles.length; i++) {
      const r = regles[i], e = etat[i];
      if (maintenant - e.debut >= r.fenetreMs) { e.debut = maintenant; e.n = 0; }
      if (e.n >= r.max) {
        const attente = Math.ceil((e.debut + r.fenetreMs - maintenant) / 1000);
        console.warn('  🚦 ' + nom + ' : plafond atteint (' + r.max + ' / ' + Math.round(r.fenetreMs / 1000) + ' s) pour ' + k);
        // `error` porte la phrase lisible : c'est ce champ que les ecrans
        // affichent tel quel. Le code machine va a cote, pour qui voudra le lire.
        return res.status(429).json({ ok: false, code: 'trop_d_envois', attente,
          error: 'Trop d\'envois en peu de temps. Réessayez dans ' + attente + ' s.' });
      }
    }
    for (const e of etat) e.n++;
    suite();
  };
}

// Qui demande ? L'identite de session si elle existe — c'est elle qui compte,
// puisque tous les postes de l'officine partagent la meme adresse publique et
// qu'un plafond par adresse punirait l'equipe entiere pour un seul poste parti
// en boucle. L'adresse ne sert que de repli.
function demandeur(qui) {
  return function (req) {
    let uid = null;
    try { uid = qui ? qui(req) : null; } catch (e) {}
    if (uid) return 'u:' + uid;
    return 'ip:' + (String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
      || (req.socket && req.socket.remoteAddress) || '?');
  };
}

const MIN = 60000, JOUR = 86400000;

// Seuils. Reperes d'usage : l'officine sert environ 450 patients par jour, et
// un envoi groupe le plus large (les medecins prescripteurs) tient en quelques
// dizaines de messages. Ces plafonds sont donc hors d'atteinte d'un usage
// normal, et immediatement atteints par une boucle ou un abus.
const SEUILS = {
  sms:        [{ fenetreMs: MIN, max: 30 },  { fenetreMs: JOUR, max: 300 }],
  smsGlobal:  [{ fenetreMs: MIN, max: 120 }, { fenetreMs: JOUR, max: 900 }],
  mail:       [{ fenetreMs: MIN, max: 30 },  { fenetreMs: JOUR, max: 300 }],
  mailGlobal: [{ fenetreMs: MIN, max: 120 }, { fenetreMs: JOUR, max: 900 }]
};

// Un en-tete de courriel ne doit jamais contenir de saut de ligne : injecte
// dans un objet, il permet d'ajouter des destinataires caches au message. Les
// adresses sont deja filtrees par leur expression reguliere ; l'objet, non.
function enTeteSur(v, max) {
  return String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').trim().slice(0, max || 300);
}

function installer(app, deps) {
  const d = deps || {};
  app.use(enTetes);
  const parPersonne = demandeur(d.qui);
  const global = () => 'tous';
  return {
    sms:  [limiteur('SMS', SEUILS.sms, parPersonne),   limiteur('SMS (serveur)', SEUILS.smsGlobal, global)],
    mail: [limiteur('Mail', SEUILS.mail, parPersonne), limiteur('Mail (serveur)', SEUILS.mailGlobal, global)]
  };
}

module.exports = { installer, enTetes, limiteur, enTeteSur, CSP, SEUILS };
