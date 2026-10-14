/* ════════════════════════════════════════════════════════════════════════════
   OFFRES — l'affiche que la pharmacie envoie par SMS.

   Une opération commerciale tient dans une image. Le SMS, lui, ne transporte
   pas d'image : il transporte un lien. Ce module sert ce lien, et rien d'autre.

   TROIS DÉCISIONS QUI EXPLIQUENT TOUT LE RESTE.

   1. La page est PUBLIQUE, donc montée AVANT le portail (comme /o, le dépôt
      d'ordonnance). Un patient n'a pas de session. Mais une page publique sur
      notre domaine est aussi une surface d'attaque : on n'y sert que des
      images matricielles (jamais de SVG, qui porte du script), toujours avec
      `nosniff`, et la page elle-même ne contient AUCUN JavaScript.

   2. L'affiche ne vit NI dans le blob (11 Mo, relu toutes les 8 s par chaque
      poste — y glisser une affiche de 400 Ko la ferait voyager mille fois par
      jour), NI dans `app_images` (le coffre des ordonnances : chiffré, soumis
      à la purge, et surtout réservé à de la donnée de santé). Elle a sa table.

   3. UN LIEN ENVOYÉ NE MEURT JAMAIS. Un patient rouvre son SMS trois semaines
      plus tard ; la remise n'a plus cours. On ne lui rend donc ni une page
      morte ni une promesse périmée, mais l'image de VEILLE — « pas d'offre en
      ce moment ». Une seule ligne porte ce rôle, et l'adresse générale /offre
      la sert dès qu'aucune opération n'est en cours.

   L'adresse de diffusion est libre : la page se construit à partir de l'hôte
   reçu. pharmacie-mondeville.fr/offre et pilot.pharmacie-mondeville.fr/offre
   rendent la même chose, chacune avec ses propres liens absolus.
   ════════════════════════════════════════════════════════════════════════════ */
'use strict';

// Ce qu'un navigateur affiche sans danger dans une page. PAS de SVG : un SVG
// est un document, il peut porter du script, et il serait servi depuis notre
// domaine. PAS de PDF : une affiche se regarde, elle ne se télécharge pas.
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_OCTETS = 4 * 1024 * 1024;
const CODE_MAX = 32;
// Réservés : ce sont des segments d'adresse du module lui-même. Un code qui
// s'appellerait « i » rendrait /offre/i/xxx ambigu.
const RESERVES = { i: 1, img: 1, image: 1, api: 1, offre: 1, offres: 1 };

const OFFICINE = {
  nom: 'Pharmacie du Centre',
  adresse: '48 rue Chapron',
  cp: '14120', ville: 'Mondeville',
  tel: '02 31 52 15 71', telIntl: '+33231521571'
};

const E = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

// Le jour tel que la pharmacie le vit. `toISOString()` sur une date à minuit
// locale rend la veille : c'est le piège n°3 du dépôt, il a déjà décalé cinq
// endroits du code.
function jourParis() {
  try {
    return new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' }).format(new Date());
  } catch (e) {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
      + '-' + String(d.getDate()).padStart(2, '0');
  }
}

function sansAccent(v) {
  return String(v == null ? '' : v).normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// « Journée Avène -20% » → « avene ». Le code EST l'adresse : il doit tenir
// dans un SMS, se relire au téléphone, et ne jamais surprendre.
function normCode(v) {
  const c = sansAccent(v).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, CODE_MAX)
    .replace(/-+$/g, '');
  if (!c || RESERVES[c]) return '';
  return c;
}

function jourValide(v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')); }

// Les dates sont des chaînes « AAAA-MM-JJ » : elles se comparent telles quelles,
// sans fuseau et sans objet Date. `fin` est le DERNIER JOUR INCLUS — « jusqu'au
// 16 » veut dire que le 16 au soir l'offre tient encore.
function enCours(o, jour) {
  if (!o) return false;
  const j = jour || jourParis();
  if (o.debut && jourValide(o.debut) && j < o.debut) return false;
  if (o.fin && jourValide(o.fin) && j > o.fin) return false;
  return true;
}

function terminee(o, jour) {
  return !!(o && o.fin && jourValide(o.fin) && (jour || jourParis()) > o.fin);
}

function laVeille(liste) {
  return (liste || []).find((o) => o && o.veille) || null;
}

// CE QUE MONTRE L'ADRESSE GÉNÉRALE. S'il y a plusieurs opérations en cours —
// ça arrive, deux laboratoires la même semaine — on montre celle qui se termine
// le plus tôt : c'est la plus urgente, et c'est celle qu'on perdrait.
function choisir(liste, jour) {
  const j = jour || jourParis();
  const vivantes = (liste || [])
    .filter((o) => o && !o.veille && enCours(o, j))
    .sort((a, b) => {
      const fa = a.fin || '9999-99-99', fb = b.fin || '9999-99-99';
      if (fa !== fb) return fa < fb ? -1 : 1;
      return String(b.cree || '') < String(a.cree || '') ? -1 : 1;
    });
  return vivantes[0] || laVeille(liste);
}

// ── LA PAGE ────────────────────────────────────────────────────────────────
//
// Server-rendered, et sans une ligne de JavaScript. Deux raisons, aucune n'est
// une question de goût : l'aperçu du lien dans iMessage, WhatsApp ou Signal est
// fabriqué par un robot qui lit le HTML et n'exécute rien — sans balises Open
// Graph DANS la source, le SMS n'affiche qu'une adresse nue. Et une page sans
// script est une page qui ne peut rien faire d'autre que ce qu'on voit.
const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%}
body{font-family:'Schibsted Grotesk',-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;
  background:#F8F5F4;color:#25282A;line-height:1.5;
  padding:16px 16px calc(24px + env(safe-area-inset-bottom));
  display:flex;justify-content:center}
.w{width:100%;max-width:520px}
.affiche{display:block;width:100%;height:auto;border-radius:16px;
  box-shadow:0 2px 10px rgba(70,40,55,.05);background:#fff}
.veille{background:#fff;border:1px solid #E9E2E1;border-radius:16px;padding:48px 28px;
  text-align:center;box-shadow:0 2px 10px rgba(70,40,55,.05)}
.veille .pastille{display:inline-block;background:#E6F1EB;color:#348466;border-radius:20px;
  padding:5px 14px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.07em}
.veille h2{font-size:1.35rem;font-weight:700;margin:18px 0 8px;color:#25282A}
.veille p{color:#71787A;font-size:.95rem}
.mentions{color:#71787A;font-size:.78rem;line-height:1.6;margin:12px 4px 0}
.fin{margin:12px 0 0;background:#FAEAF1;color:#B04A74;border-radius:12px;
  padding:11px 14px;font-size:.84rem;font-weight:600;text-align:center}
.officine{background:#fff;border:1px solid #E9E2E1;border-radius:16px;padding:20px;
  margin-top:16px;text-align:center;box-shadow:0 2px 10px rgba(70,40,55,.05)}
.officine h1{font-size:1.1rem;font-weight:700;color:#348466;margin-bottom:4px}
.officine .ou{color:#71787A;font-size:.88rem}
.actions{display:flex;gap:9px;margin-top:16px}
.b{flex:1;display:block;padding:13px 10px;border-radius:9px;text-decoration:none;
  font-size:.92rem;font-weight:600;text-align:center}
.bp{background:#348466;color:#fff}
.bs{background:#F8F5F4;color:#25282A;border:1px solid #E9E2E1}
footer{text-align:center;color:#71787A;font-size:.72rem;margin-top:18px;line-height:1.6}
@media(prefers-color-scheme:dark){
  body{background:#1b1d1e;color:#ECEFEE}
  .veille,.officine{background:#232626;border-color:#333736}
  .veille h2{color:#ECEFEE}.bs{background:#232626;color:#ECEFEE;border-color:#333736}
  .officine .ou,.veille p,.mentions,footer{color:#9AA3A0}
}`;

// L'adresse absolue sous laquelle CETTE visite est arrivée. Les aperçus de lien
// exigent une adresse absolue ; la déduire de la requête évite un réglage de
// plus, et fait que le lien marche sous n'importe quel nom d'hôte.
function origine(req) {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  const hote = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return hote ? proto + '://' + hote : '';
}

// L'ADRESSE SOUS LAQUELLE ON DIFFUSE. Elle n'est pas dans le code : le jour ou
// le domaine change -- un sous-domaine plutot que le domaine nu, un autre
// hebergeur -- il n'y a pas de ligne a reecrire ni de version a pousser, une
// variable d'environnement suffit. Non definie, l'ecran retombe sur l'adresse
// par laquelle le poste est arrive : le lien reste valide, il porte seulement
// le nom du back-office.
function diffusion() {
  const v = String(process.env.OFFRE_BASE_URL || '').trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(v) ? v : null;
}

function urlImage(base, o) {
  return base + '/offre/i/' + encodeURIComponent(o.code) + '?v=' + encodeURIComponent(String(o.empreinte || '').slice(0, 12));
}

function pageHtml(o, opts) {
  const d = opts || {};
  const base = d.base || '';
  const url = base + (d.code ? '/offre/' + encodeURIComponent(d.code) : '/offre');
  const titre = (o && o.titre) || 'Pharmacie du Centre';
  const desc = (o && o.veille)
    ? 'Pas d’offre en ce moment — revenez bientôt.'
    : (o ? ((o.mentions || '').slice(0, 180) || 'L’offre du moment à la Pharmacie du Centre de Mondeville.')
         : 'Pas d’offre en ce moment — revenez bientôt.');

  const corps = o
    ? '<img class="affiche" src="' + E(urlImage(base, o)) + '" alt="' + E(titre) + '"'
      + (o.largeur && o.hauteur ? ' width="' + o.largeur + '" height="' + o.hauteur + '"' : '')
      + ' fetchpriority="high">'
    : '<div class="veille"><span class="pastille">Pharmacie du Centre</span>'
      + '<h2>Pas d’offre en ce moment</h2>'
      + '<p>Revenez bientôt en découvrir une nouvelle.</p></div>';

  // CE BANDEAU EST UNE QUESTION D'HONNÊTETÉ. Il n'apparaît que sur le lien
  // NOMMÉ d'une opération terminée : la personne a rouvert un vieux SMS, elle
  // doit savoir avant de se déplacer. L'adresse générale, elle, ne dit rien —
  // elle montre simplement la veille ou l'offre du jour.
  const bandeau = d.terminee
    ? '<p class="fin">Cette offre est terminée.</p>' : '';

  const mentions = (o && o.mentions && !o.veille)
    ? '<p class="mentions">' + E(o.mentions) + '</p>' : '';

  const itineraire = 'https://www.google.com/maps/search/?api=1&query='
    + encodeURIComponent(OFFICINE.nom + ', ' + OFFICINE.adresse + ', ' + OFFICINE.cp + ' ' + OFFICINE.ville);

  return '<!doctype html><html lang="fr"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
    + '<title>' + E(titre) + ' — ' + E(OFFICINE.nom) + '</title>'
    + '<meta name="description" content="' + E(desc) + '">'
    + '<meta name="theme-color" content="#348466">'
    + '<link rel="icon" href="/favicon.ico" sizes="any">'
    + '<link rel="apple-touch-icon" href="/apple-touch-icon.png">'
    + '<meta property="og:type" content="website">'
    + '<meta property="og:site_name" content="' + E(OFFICINE.nom) + ' — ' + E(OFFICINE.ville) + '">'
    + '<meta property="og:title" content="' + E(titre) + '">'
    + '<meta property="og:description" content="' + E(desc) + '">'
    + '<meta property="og:url" content="' + E(url) + '">'
    + (o ? '<meta property="og:image" content="' + E(urlImage(base, o)) + '">'
         + (o.largeur ? '<meta property="og:image:width" content="' + o.largeur + '">' : '')
         + (o.hauteur ? '<meta property="og:image:height" content="' + o.hauteur + '">' : '')
         + '<meta property="og:image:alt" content="' + E(titre) + '">' : '')
    + '<meta name="twitter:card" content="summary_large_image">'
    + '<style>' + CSS + '</style></head><body><main class="w">'
    + corps + bandeau + mentions
    + '<section class="officine"><h1>' + E(OFFICINE.nom) + '</h1>'
    + '<p class="ou">' + E(OFFICINE.adresse) + ' · ' + E(OFFICINE.cp) + ' ' + E(OFFICINE.ville) + '</p>'
    + '<div class="actions">'
    + '<a class="b bp" href="tel:' + E(OFFICINE.telIntl) + '">Appeler</a>'
    + '<a class="b bs" href="' + E(itineraire) + '" target="_blank" rel="noopener noreferrer">Itinéraire</a>'
    + '</div></section>'
    + '<footer>' + E(OFFICINE.nom) + ' — ' + E(OFFICINE.tel) + '<br>'
    + 'Cette page ne dépose aucun cookie et ne vous identifie pas.</footer>'
    + '</main></body></html>';
}

module.exports = {
  TYPES, MAX_OCTETS, CODE_MAX, OFFICINE,
  normCode, jourValide, enCours, terminee, choisir, laVeille, jourParis, pageHtml, urlImage,
  diffusion,

  /* ──────────────────────────────────────────────────────────────────────────
     Les tables. `CREATE TABLE IF NOT EXISTS` au démarrage, comme partout ici :
     il n'y a pas de système de migration dans ce dépôt, et il n'en faut pas un
     pour une table de plus.
     ────────────────────────────────────────────────────────────────────────── */
  async preparer(db) {
    await db.query(`
      CREATE TABLE IF NOT EXISTS app_offres (
        code      TEXT PRIMARY KEY,
        titre     TEXT NOT NULL DEFAULT '',
        mentions  TEXT,
        mime      TEXT NOT NULL,
        octets    BYTEA NOT NULL,
        taille    INTEGER NOT NULL DEFAULT 0,
        empreinte TEXT NOT NULL DEFAULT '',
        largeur   INTEGER,
        hauteur   INTEGER,
        debut     TEXT,
        fin       TEXT,
        veille    BOOLEAN NOT NULL DEFAULT FALSE,
        vues      INTEGER NOT NULL DEFAULT 0,
        par       TEXT,
        cree      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        maj       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    // Une seule veille possible. L'index le GARANTIT en base plutôt que dans le
    // code : deux titulaires qui en désignent une chacun de leur côté ne
    // peuvent pas en laisser deux derrière eux.
    await db.query('CREATE UNIQUE INDEX IF NOT EXISTS app_offres_veille ON app_offres (veille) WHERE veille');
  },

  /* ──────────────────────────────────────────────────────────────────────────
     publiques(app, deps) — À MONTER AVANT auth.gate.
       deps.getDb()  : la base, ou null
       deps.frein    : middleware de débit (securite.limiteur)
     ────────────────────────────────────────────────────────────────────────── */
  publiques(app, deps) {
    const d = deps || {};
    const base = () => (d.getDb ? d.getDb() : null);
    const frein = typeof d.frein === 'function' ? d.frein : (req, res, suite) => suite();

    const toutes = async () => {
      const db = base();
      if (!db) return [];
      const r = await db.query(
        `SELECT code, titre, mentions, empreinte, largeur, hauteur, debut, fin, veille, cree
           FROM app_offres`);
      return r.rows || [];
    };

    // L'IMAGE. Déclarée AVANT /offre/:code : Express sert dans l'ordre, et
    // « i » est réservé côté codes pour que les deux ne se croisent jamais.
    app.get('/offre/i/:code', frein, async (req, res) => {
      try {
        const db = base();
        if (!db) return res.status(503).end();
        const code = normCode(req.params.code);
        if (!code) return res.status(404).end();
        const r = await db.query('SELECT mime, octets, empreinte FROM app_offres WHERE code = $1', [code]);
        const o = r.rows[0];
        if (!o || !TYPES[o.mime]) return res.status(404).end();
        // Le nom ne désigne pas le contenu (le code survit à un remplacement
        // d'affiche) : c'est l'empreinte, passée en `v`, qui l'autorise. Sans
        // elle, une minute de cache — le temps d'une rafale de SMS, pas plus.
        const bonne = String(req.query.v || '') === String(o.empreinte || '').slice(0, 12);
        res.set('Cache-Control', bonne ? 'public, max-age=31536000, immutable' : 'public, max-age=60');
        res.set('Content-Type', o.mime);
        res.set('X-Content-Type-Options', 'nosniff');
        res.set('Content-Security-Policy', "default-src 'none'; sandbox");
        res.send(o.octets);
      } catch (e) { res.status(500).end(); }
    });

    const page = async (req, res) => {
      try {
        const demande = req.params.code ? normCode(req.params.code) : null;
        const liste = await toutes();
        const j = jourParis();
        let o = null, fini = false;
        if (demande) {
          const cible = liste.find((x) => x.code === demande);
          if (cible && enCours(cible, j)) o = cible;
          else { o = laVeille(liste); fini = terminee(cible, j); }
        } else {
          o = choisir(liste, j);
        }
        // Jamais de cache sur la page : une affiche remplacée à 9 h doit être
        // la bonne à 9 h 01, y compris pour qui a déjà ouvert le lien.
        res.set('Cache-Control', 'no-store');
        res.set('X-Content-Type-Options', 'nosniff');
        res.type('html').send(pageHtml(o, { base: origine(req), code: demande, terminee: fini }));
        // Le compteur vient APRÈS la réponse, et il ne retient rien d'autre
        // qu'un nombre : ni adresse, ni cookie, ni horaire. Il répond à une
        // seule question — « le SMS a-t-il été ouvert ? »
        if (o && base()) {
          base().query('UPDATE app_offres SET vues = vues + 1 WHERE code = $1', [o.code])
            .catch(() => {});
        }
      } catch (e) {
        res.set('Cache-Control', 'no-store');
        res.type('html').send(pageHtml(null, { base: origine(req) }));
      }
    };
    app.get('/offre', frein, page);
    app.get('/offre/:code', frein, page);
  },

  /* ──────────────────────────────────────────────────────────────────────────
     routes(app, getDb, deps) — APRÈS le portail. Réservé aux administrateurs.
       deps.qui(req) / deps.estAdmin(req)
     ────────────────────────────────────────────────────────────────────────── */
  routes(app, getDb, deps) {
    const db = () => getDb();
    const d = deps || {};

    const admin = async (req, res) => {
      const uid = (typeof d.qui === 'function') ? d.qui(req) : null;
      if (!uid) { res.status(401).json({ ok: false, error: 'session inconnue' }); return null; }
      const ok = (typeof d.estAdmin === 'function') ? await d.estAdmin(uid) : false;
      if (!ok) { res.status(403).json({ ok: false, error: 'réservé aux administrateurs' }); return null; }
      return uid;
    };

    // LA LECTURE N'EST PAS RÉSERVÉE. Une affiche est publique par destination :
    // la cacher à l'équipe n'ajoute rien, et prive le comptoir du lien à donner
    // ou à envoyer. Seules les ÉCRITURES passent par la porte des titulaires.
    app.get('/api/offres', async (req, res) => {
      try {
        const uid = (typeof d.qui === 'function') ? d.qui(req) : null;
        if (!uid) return res.status(401).json({ ok: false, error: 'session inconnue' });
        if (!db()) return res.status(503).json({ ok: false, error: 'base indisponible' });
        // JAMAIS les octets ici : la liste se rafraîchit souvent, et une affiche
        // pèse mille fois ce que pèsent ses métadonnées.
        const r = await db().query(
          `SELECT code, titre, mentions, mime, taille, empreinte, largeur, hauteur,
                  debut, fin, veille, vues, par, cree, maj
             FROM app_offres ORDER BY veille, cree DESC`);
        const peut = (typeof d.estAdmin === 'function') ? await d.estAdmin(uid) : false;
        res.json({ ok: true, jour: jourParis(), redacteur: peut, base: diffusion(),
                   offres: r.rows || [] });
      } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    app.post('/api/offres', async (req, res) => {
      try {
        const moi = await admin(req, res); if (!moi) return;
        if (!db()) return res.status(503).json({ ok: false, error: 'base indisponible' });
        const b = req.body || {};
        const code = normCode(b.code);
        if (!code) return res.status(400).json({ ok: false, error: 'Adresse de l’offre invalide.' });
        const titre = String(b.titre || '').trim().slice(0, 120);
        if (!titre) return res.status(400).json({ ok: false, error: 'Un titre est nécessaire.' });
        const mentions = String(b.mentions || '').trim().slice(0, 600) || null;
        const debut = jourValide(b.debut) ? b.debut : null;
        const fin = jourValide(b.fin) ? b.fin : null;
        if (debut && fin && fin < debut) {
          return res.status(400).json({ ok: false, error: 'La fin précède le début.' });
        }
        const veille = b.veille === true;

        // L'image est facultative à la MODIFICATION : corriger une date ne doit
        // pas obliger à redéposer l'affiche.
        let img = null;
        if (b.mime || b.data) {
          const mime = String(b.mime || '');
          if (!TYPES[mime]) return res.status(400).json({ ok: false, error: 'Image JPEG, PNG ou WebP uniquement.' });
          const brut = String(b.data || '');
          if (!/^[A-Za-z0-9+/=]+$/.test(brut) || !brut.length) {
            return res.status(400).json({ ok: false, error: 'Image illisible.' });
          }
          const octets = Buffer.from(brut, 'base64');
          if (!octets.length) return res.status(400).json({ ok: false, error: 'Image vide.' });
          if (octets.length > MAX_OCTETS) {
            return res.status(413).json({ ok: false, error: 'Affiche trop lourde (4 Mo maximum).' });
          }
          img = {
            mime, octets,
            empreinte: require('crypto').createHash('sha256').update(octets).digest('hex').slice(0, 16),
            largeur: parseInt(b.largeur, 10) || null,
            hauteur: parseInt(b.hauteur, 10) || null
          };
        }

        const existe = (await db().query('SELECT code FROM app_offres WHERE code = $1', [code])).rows[0];
        if (!existe && !img) return res.status(400).json({ ok: false, error: 'Il manque l’affiche.' });

        // La veille est unique : on libère l'ancienne AVANT d'écrire, sinon
        // l'index unique refuse l'écriture et l'opération échoue au milieu.
        if (veille) await db().query('UPDATE app_offres SET veille = FALSE WHERE veille AND code <> $1', [code]);

        if (existe) {
          // DEUX REQUÊTES PLUTÔT QU'UN `COALESCE($n, colonne)`. Un paramètre nul
          // dans un COALESCE laisse PostgreSQL deviner son type, et il échoue
          // parfois à le faire — « could not determine data type of parameter ».
          // Corriger une date ne doit pas dépendre d'une inférence.
          const champs = [code, titre, mentions, debut, fin, veille, moi];
          let sql = `UPDATE app_offres SET titre=$2, mentions=$3, debut=$4, fin=$5,
                            veille=$6, par=$7, maj=NOW()`;
          if (img) {
            sql += `, mime=$8, octets=$9, taille=$10, empreinte=$11, largeur=$12, hauteur=$13`;
            champs.push(img.mime, img.octets, img.octets.length, img.empreinte,
                        img.largeur, img.hauteur);
          }
          await db().query(sql + ' WHERE code=$1', champs);
        } else {
          await db().query(
            `INSERT INTO app_offres (code,titre,mentions,mime,octets,taille,empreinte,
                                     largeur,hauteur,debut,fin,veille,par)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
            [code, titre, mentions, img.mime, img.octets, img.octets.length, img.empreinte,
             img.largeur, img.hauteur, debut, fin, veille, moi]);
        }
        res.json({ ok: true, code });
      } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    app.post('/api/offres/supprimer', async (req, res) => {
      try {
        const moi = await admin(req, res); if (!moi) return;
        if (!db()) return res.status(503).json({ ok: false, error: 'base indisponible' });
        const code = normCode((req.body || {}).code);
        if (!code) return res.status(400).json({ ok: false, error: 'offre inconnue' });
        const r = await db().query('DELETE FROM app_offres WHERE code = $1', [code]);
        res.json({ ok: true, supprime: r.rowCount > 0 });
      } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });
  }
};
