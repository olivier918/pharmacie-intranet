/* ════════════════════════════════════════════════════════════════════════════
   LE DOMAINE PATIENT — ce qu'on y montre, et ce qu'on n'y montre pas.

   Une seule application sert deux publics sous deux noms :
     pilot.pharmacie-mondeville.fr   le back-office, pour l'equipe
     client.pharmacie-mondeville.fr  les patients, pour les liens des SMS

   Elle repond par CHEMIN, pas par nom d'hote. C'est ce qui permet a un seul
   domaine de porter /r/, /o/ et /offre -- et c'est aussi ce qui faisait que
   client.pharmacie-mondeville.fr, a la racine, rendait l'ECRAN DE CONNEXION DE
   L'OFFICINE. Un patient qui tronque le lien de son SMS, ou qui tape juste le
   nom de domaine, tombait sur « PILOT — Acces officine ». Deroutant pour lui,
   et inutilement bavard sur nos outils internes.

   Ce module ferme la porte. Sur le domaine patient, et LA SEULEMENT, tout ce
   qui n'est pas destine a un patient renvoie vers l'affiche du moment -- qui
   porte le nom de la pharmacie, son adresse et son telephone, et fait donc une
   page d'accueil honnete quand aucune offre n'est en cours.

   CE N'EST PAS UNE SECURITE. Le portail d'acces reste seul juge de qui entre :
   un redirecteur ne protege rien, il range. La protection est dans auth.gate,
   et elle vaut pour tous les noms d'hote.

   Non reglé (PUBLIC_BASE_URL absente), ce module ne fait rien du tout.
   ════════════════════════════════════════════════════════════════════════════ */
'use strict';

// CE QUI EST LEGITIME SUR LE DOMAINE PATIENT, et rien d'autre.
// `/r/`   la confirmation de renouvellement
// `/o`    le depot d'ordonnance
// `/offre` l'affiche du moment
// Les routes d'API correspondantes, et elles seules : renouv.html et depot.html
// n'appellent rien d'autre (verifie par essais/domaine-patient.js).
const CHEMINS = [
  /^\/offre(\/|$)/,
  /^\/r\//,
  /^\/o(\/|$)/,
  /^\/api\/renouv\//,
  /^\/api\/depot(\/|$)/,
  /^\/api\/(health|version)$/
];

// L'identite visuelle : sans elle, les pages patients s'affichent sans icone.
// Ce sont les memes fichiers que le portail laisse passer sans session.
const MARQUE = new Set([
  '/favicon.ico', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png',
  '/apple-touch-icon.png', '/manifest.webmanifest'
]);

function estCheminPatient(chemin) {
  const p = String(chemin || '').split('?')[0];
  if (MARQUE.has(p)) return true;
  return CHEMINS.some((r) => r.test(p));
}

// Le nom d'hote recu est-il celui du domaine patient ? On compare a l'adresse
// REGLEE, pas a une liste ecrite en dur : changer de domaine reste un reglage.
function memeHote(hoteRecu, base) {
  if (!base) return false;
  let attendu;
  try { attendu = new URL(String(base)).host.toLowerCase(); } catch (e) { return false; }
  const recu = String(hoteRecu == null ? '' : hoteRecu).split(',')[0].trim().toLowerCase();
  return !!recu && !!attendu && recu === attendu;
}

module.exports = {
  CHEMINS, MARQUE, estCheminPatient, memeHote,

  /* ──────────────────────────────────────────────────────────────────────────
     installer(app, deps) — À MONTER AVANT auth.gate, et APRÈS les routes
     publiques (elles sont dans la liste ci-dessus, donc elles passent).
       deps.base() : l'adresse du domaine patient, ou null
     ────────────────────────────────────────────────────────────────────────── */
  installer(app, deps) {
    const d = deps || {};
    const base = (typeof d.base === 'function') ? d.base : () => null;

    app.use((req, res, next) => {
      const hote = req.headers['x-forwarded-host'] || req.headers.host;
      if (!memeHote(hote, base())) return next();        // back-office : rien ne change
      if (estCheminPatient(req.path)) return next();

      // UNE REDIRECTION, PAS UN REFUS. « Acces interdit » dirait qu'il y a
      // quelque chose ici ; l'affiche du moment ne dit rien et rend service.
      // On ne redirige que ce qui se navigue : une requete POST egaree n'a rien
      // a faire ici et merite un 404 ordinaire, pas un detour.
      if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(404).end();
      res.set('Cache-Control', 'no-store');
      return res.redirect(302, '/offre');
    });
  }
};
