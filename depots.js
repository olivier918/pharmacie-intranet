/* ════════════════════════════════════════════════════════════════════════════
   Module DÉPÔTS — les ordonnances que les patients nous envoient.

   Remplace la boîte mail de l'officine, qui était hors cadre : la donnée y
   transitait et y séjournait chez un tiers non certifié.

   Trois portes, une boîte de réception :
     /o                 l'affiche du comptoir. Dépôt anonyme, rendu au patient
                        sous la forme d'un numéro court (« D-47 ») qu'il lit au
                        pharmacien. Aucune donnée identifiante ne transite.
     /o/<jeton>         le lien envoyé par SMS depuis un dossier de location ou
                        un renouvellement. Le jeton PORTE le dossier : le dépôt
                        arrive déjà rattaché, sans numéro à lire.

   Ces routes sont montées AVANT le portail, comme les accusés Brevo : un
   patient n'a pas de session et ne peut pas franchir la porte. Elles ont leur
   propre analyseur JSON, bien plus serré que le 50 Mo global — une route
   ouverte à l'internet n'a pas à en hériter (constat #19 de l'audit).

   La page est en ÉCRITURE SEULE. Elle ne renvoie ni liste, ni nom de
   traitement, au plus un prénom quand un jeton l'ouvre. Une adresse publique
   qui n'accepte que des dépôts est un objet bien moins dangereux qu'une
   adresse qui affiche.
   ════════════════════════════════════════════════════════════════════════════ */
'use strict';

const crypto = require('crypto');
const path = require('path');

// Sept jours : la durée retenue pour un dépôt que personne n'a rattaché.
// Rattaché à un dossier, il en devient une pièce et suit SA rétention — c'est
// l'acte de rattacher qui conserve, personne n'a de classification à retenir.
// La date du jour A PARIS. `new Date()` sur un serveur en UTC place une
// ordonnance deposee a 00h30 la veille — et le dossier apparait en retard.
function jourParis() {
  try {
    return new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' }).format(new Date());
  } catch (e) {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
      + '-' + String(d.getDate()).padStart(2, '0');
  }
}

const DEPOT_JOURS = 7;
const DEPOT_MAX_FICHIERS = 6;
const DEPOT_MAX_OCTETS = 8 * 1024 * 1024;     // par fichier, après réduction
const DEPOT_MAX_CORPS = '12mb';               // l'enveloppe JSON de la requête

// Ce que la page peut déposer. Les photos sont converties en JPEG par le
// navigateur avant l'envoi ; le HEIC d'un iPhone n'arrive donc jamais ici.
const DEPOT_TYPES = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'application/pdf': 'pdf'
};

// ── Le jeton ────────────────────────────────────────────────────────────────
// 128 bits, comme celui des confirmations de renouvellement. En base64url il
// tient en 22 caractères : le SMS reste à un seul segment, ce qui n'est pas un
// detail quand chaque demande coûte un crédit.
function nouveauJeton() {
  return crypto.randomBytes(16).toString('base64url');
}
function jetonValide(v) {
  return /^[A-Za-z0-9_-]{16,64}$/.test(String(v || ''));
}

// ── Lecture des dépôts ──────────────────────────────────────────────────────
function liste(etat) {
  return Array.isArray(etat && etat.depots) ? etat.depots : [];
}
function parJeton(etat, jeton) {
  if (!jetonValide(jeton)) return null;
  return liste(etat).find(d => d && d.jeton === jeton) || null;
}
// Un dépôt rattaché a trouvé son dossier : il n'est plus dans la boîte.
function rattache(d) {
  return !!(d && d.lien && d.lien.type && d.lien.ref != null);
}
// Il y a eu ici un numéro « D-47 » que le patient lisait au pharmacien. Il
// supposait le patient DEVANT le comptoir ; depuis que le nom est demandé, il
// ne servait plus qu'à encombrer l'écran. Retiré le 16/09/2026.

// ── Ce qui reste à purger ───────────────────────────────────────────────────
// Non rattaché, plus vieux que sept jours. Un dépôt rattaché est devenu la
// pièce d'un dossier : le toucher ici, ce serait vider un dossier de location
// par un effet de bord.
function aPurger(l, maintenant, jours) {
  const limite = maintenant - (jours == null ? DEPOT_JOURS : jours) * 86400000;
  return (l || []).filter(d => d && !rattache(d) && Number(d.ts || 0) < limite);
}

// Les identifiants d'images qu'un dépôt détient.
function imagesDuDepot(d) {
  return ((d && Array.isArray(d.fichiers)) ? d.fichiers : [])
    .map(f => f && f.fichId).filter(Boolean);
}

module.exports = {
  DEPOT_JOURS, DEPOT_MAX_FICHIERS, DEPOT_MAX_OCTETS, DEPOT_TYPES,
  nouveauJeton, jetonValide, liste, parJeton, rattache, jourParis,
  aPurger, imagesDuDepot,

  /* ──────────────────────────────────────────────────────────────────────────
     installer(app, express, deps)
       deps.lireEtat / deps.ecrireEtat : accès sérialisé au bloc de données
       deps.serialiser                 : enchaîne les écritures (cf. renouv)
       deps.deposerImage(mime, octets) : écrit dans app_images, rend l'identifiant
       deps.ouvert()                   : l'interrupteur du back office
       deps.frein                      : middleware de débit
       deps.tracer(quoi, ref)          : journal des accès
     À monter AVANT auth.gate.
     ────────────────────────────────────────────────────────────────────────── */
  installer(app, express, deps) {
    const d = deps || {};
    const frein = typeof d.frein === 'function' ? d.frein : (req, res, suite) => suite();
    const jsonServre = express.json({ limit: DEPOT_MAX_CORPS });

    // La page. Avec ou sans jeton : c'est le même fichier, il se débrouille.
    const page = (req, res) => res.sendFile(path.join(__dirname, 'public', 'depot.html'));
    app.get('/o', page);
    app.get('/o/:jeton', page);

    // Ce que la page a le droit de savoir avant d'afficher quoi que ce soit :
    // le dépôt est-il ouvert, et — si un jeton l'accompagne — à quel prénom
    // s'adresser. Rien d'autre ne sort d'ici. Surtout pas un nom de traitement.
    app.get('/api/depot/etat', async (req, res) => {
      const ouvert = d.ouvert ? !!(await d.ouvert()) : true;
      res.set('Cache-Control', 'no-store');
      res.json({ ok: true, ouvert });
    });

    app.get('/api/depot/etat/:jeton', frein, async (req, res) => {
      res.set('Cache-Control', 'no-store');
      const ouvert = d.ouvert ? !!(await d.ouvert()) : true;
      const jeton = String(req.params.jeton || '');
      if (!jetonValide(jeton)) return res.json({ ok: true, ouvert, lien: false });
      let etat = {};
      try { etat = await d.lireEtat(); } catch (e) { return res.status(503).json({ ok: false }); }
      const dep = parJeton(etat, jeton);
      // Un jeton inconnu, expiré ou déjà servi ne se distingue pas d'un autre :
      // la page invite à passer par l'adresse générale, sans jamais dire
      // laquelle des trois raisons s'applique.
      if (!dep || dep.recuLe || (dep.expireLe && Date.now() > dep.expireLe)) {
        return res.json({ ok: true, ouvert, lien: false });
      }
      res.json({ ok: true, ouvert, lien: true, prenom: String(dep.prenom || '') });
    });

    // Le dépôt lui-même.
    app.post('/api/depot', frein, jsonServre, async (req, res) => {
      try {
        if (d.ouvert && !(await d.ouvert())) {
          return res.status(503).json({ ok: false, error: 'Le dépôt en ligne est momentanément fermé. Merci de vous adresser à la pharmacie.' });
        }
        const corps = req.body || {};
        const jeton = corps.jeton ? String(corps.jeton) : null;

        // Sans jeton, on ne sait PAS de qui vient l'ordonnance. Le numero lu au
        // pharmacien supposait le patient devant le comptoir ; or l'ordonnance
        // est le plus souvent dans sa boite mail, et il l'envoie de chez lui.
        // Le nom est donc exige — c'est le minimum pour que le depot serve a
        // quelque chose. Avec un jeton, on sait deja : on ne redemande rien.
        const nom = String(corps.nom || '').trim().slice(0, 60);
        const prenom = String(corps.prenom || '').trim().slice(0, 60);
        const naissance = String(corps.naissance || '').trim().slice(0, 10);
        if (!jeton && (!nom || !prenom)) {
          return res.status(400).json({ ok: false, error: 'Merci d\u2019indiquer votre nom et votre pr\u00e9nom.' });
        }
        const brut = Array.isArray(corps.fichiers) ? corps.fichiers : [];
        if (!brut.length) return res.status(400).json({ ok: false, error: 'Aucun fichier reçu.' });
        if (brut.length > DEPOT_MAX_FICHIERS) {
          return res.status(400).json({ ok: false, error: 'Six fichiers au maximum par envoi.' });
        }

        // On valide TOUT avant d'écrire quoi que ce soit : un envoi à moitié
        // deposé laisserait des octets orphelins et un patient sans reponse.
        const prets = [];
        for (const f of brut) {
          const mime = String((f && f.mime) || '');
          if (!DEPOT_TYPES[mime]) return res.status(400).json({ ok: false, error: 'Type de fichier non accepté.' });
          const data = String((f && f.data) || '');
          if (!/^[A-Za-z0-9+/=]+$/.test(data) || !data.length) {
            return res.status(400).json({ ok: false, error: 'Fichier illisible.' });
          }
          const octets = Buffer.from(data, 'base64');
          if (!octets.length) return res.status(400).json({ ok: false, error: 'Fichier vide.' });
          if (octets.length > DEPOT_MAX_OCTETS) {
            return res.status(413).json({ ok: false, error: 'Fichier trop lourd (8 Mo maximum).' });
          }
          prets.push({ mime, octets, nom: String((f && f.nom) || '').slice(0, 120) });
        }

        const poses = [];
        for (const p of prets) {
          const id = await d.deposerImage(p.mime, p.octets);
          if (!id) return res.status(500).json({ ok: false, error: 'L’enregistrement a échoué.' });
          poses.push({ fichId: id, fichMime: p.mime, fichNom: p.nom, fichTaille: p.octets.length });
        }

        // Écriture sérialisée : les dépôts arrivent un par un mais peuvent se
        // croiser, et une lecture-modification-écriture non sérialisée en
        // effacerait un.
        const sortie = await d.serialiser(async () => {
          const etat = await d.lireEtat();
          if (!Array.isArray(etat.depots)) etat.depots = [];
          const maintenant = Date.now();

          if (jeton) {
            const dep = parJeton(etat, jeton);
            if (!dep || dep.recuLe || (dep.expireLe && maintenant > dep.expireLe)) return { perime: true };
            dep.fichiers = poses;
            dep.recuLe = maintenant;
            dep.ts = maintenant;                 // la rétention part du dépôt
            dep.updatedAt = maintenant;
            // Ordonnance récupérée chez un patient : elle a été rapportée mais
            // pas encore facturée. On ouvre le dossier tout de suite, du côté
            // serveur — attendre qu'un poste ait PILOT ouvert ferait dépendre
            // la création d'un hasard.
            if (dep.creerRenouv) {
              if (!Array.isArray(etat.renouvellements)) etat.renouvellements = [];
              const rid = etat.renouvellements.concat(
                Array.isArray(etat.renouvArchives) ? etat.renouvArchives : []
              ).reduce((m, x) => (x && x.id > m ? x.id : m), 0) + 1;
              etat.renouvellements.push({
                id: rid,
                nom: String(dep.nom || '').toUpperCase(), prenom: String(dep.prenom || ''),
                date: jourParis(), cycle: 0,
                // `facturation` existe deja dans le module : badge « € Facturation
                // a faire ». Pas de nouveau concept a inventer ni a expliquer.
                ponctuel: true, nature: 'facturation',
                notes: 'Ordonnance recuperee chez le patient le ' + jourParis() + '.',
                updatedAt: maintenant
              });
              dep.lien = { type: 'renouvellement', ref: rid };   // rattache = conserve
              dep.creerRenouv = false;
            }
            await d.ecrireEtat(etat);
            return { ok: true };
          }

          etat.depots.push({
            id: maintenant, ts: maintenant,
            origine: 'comptoir', fichiers: poses,
            nom: nom, prenom: prenom, naissance: naissance || null,
            recuLe: maintenant, lien: null, archiveLe: null,
            updatedAt: maintenant
          });
          // L'ECRITURE. Sans elle, l'objet est modifie en memoire puis jete :
          // les octets de l'image restent dans app_images, le patient voit son
          // numero, et il ne reste rien. C'est arrive.
          await d.ecrireEtat(etat);
          return { ok: true };
        });

        if (sortie && sortie.perime) {
          return res.status(410).json({ ok: false, error: 'Ce lien n’est plus valable. Merci de contacter la pharmacie.' });
        }
        if (d.tracer) { try { d.tracer('Dépôt d’ordonnance', jeton ? 'lien' : 'comptoir'); } catch (e) {} }
        res.json({ ok: true });
      } catch (err) {
        console.error('Dépôt d’ordonnance :', err.message);
        res.status(500).json({ ok: false, error: 'L’envoi a échoué. Merci de réessayer.' });
      }
    });
  },

  /* ──────────────────────────────────────────────────────────────────────────
     purger(deps) — la destruction à sept jours.

     Le piège est ici, et il a déjà coûté 95 scans le 13/09 dans l'autre sens :
     les images sont adressées par le CONDENSAT de leur contenu, donc
     dédupliquées. Deux envois du même fichier partagent un identifiant. Effacer
     l'octet d'un dépôt purgé viderait le dossier de location où la même image
     est référencée.

     On supprime donc l'enregistrement, PUIS l'octet seulement s'il n'est plus
     référencé nulle part — la liste des références est relue APRÈS coup, sur
     l'état déjà nettoyé.
     ────────────────────────────────────────────────────────────────────────── */
  async purger(deps) {
    const d = deps || {};
    const jours = d.jours == null ? DEPOT_JOURS : d.jours;
    let bilan = { depots: 0, images: 0, gardees: 0 };

    const candidats = await d.serialiser(async () => {
      const etat = await d.lireEtat();
      const l = liste(etat);
      const vieux = aPurger(l, Date.now(), jours);
      if (!vieux.length) return [];
      const ids = new Set(vieux.map(x => x.id));
      etat.depots = l.filter(x => x && !ids.has(x.id));
      if (typeof d.marquerSupprime === 'function') {
        vieux.forEach(x => d.marquerSupprime('depots', x.id));
      }
      await d.ecrireEtat(etat);
      bilan.depots = vieux.length;
      // Les octets que ces dépôts détenaient — à confronter aux références
      // restantes, une fois l'état réécrit.
      return vieux.reduce((acc, x) => acc.concat(imagesDuDepot(x)), []);
    });

    if (!candidats || !candidats.length) return bilan;

    const etat = await d.lireEtat();
    const encoreReferencees = d.imagesReferencees ? d.imagesReferencees(etat) : new Set();
    for (const id of new Set(candidats)) {
      if (encoreReferencees.has && encoreReferencees.has(id)) { bilan.gardees++; continue; }
      if (Array.isArray(encoreReferencees) && encoreReferencees.indexOf(id) >= 0) { bilan.gardees++; continue; }
      try { await d.supprimerImage(id); bilan.images++; }
      catch (e) { console.error('Purge dépôt, image ' + id + ' :', e.message); }
    }
    if (bilan.depots) {
      console.log('  🧾 Dépôts purgés : ' + bilan.depots
        + ' (images effacées : ' + bilan.images
        + (bilan.gardees ? ', gardées car encore référencées : ' + bilan.gardees : '') + ')');
    }
    return bilan;
  }
};
