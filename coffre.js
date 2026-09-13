// ─────────────────────────────────────────────────────────────────────────────
//  COFFRE — chiffrement au repos des scans d'ordonnance
// ─────────────────────────────────────────────────────────────────────────────
//
//  CONTRE QUOI. Le chiffrement applicatif protege contre une BASE QUI S'ECHAPPE
//  SANS SA CLE : une sauvegarde exportee, un DATABASE_URL qui fuite, une
//  restauration mal configuree, un administrateur de l'hebergeur, une
//  requisition adressee au mauvais interlocuteur. Il ne protege PAS contre une
//  application compromise — elle a la cle par construction — ni contre un
//  collaborateur curieux, que l'authentification et le journal des acces
//  couvrent deja. Le dire franchement evite de croire la maison plus sure
//  qu'elle ne l'est.
//
//  OU VIT LA CLE. Dans la configuration de la plateforme (SCANS_CLE), donc pas
//  dans PostgreSQL : deux systemes, deux chemins d'acces. Un export de base
//  seul est inutilisable. Un service externe de gestion de cles serait plus
//  fort sur le papier, au prix d'un appel reseau sur le chemin d'affichage
//  d'une ordonnance — c'est-a-dire d'une nouvelle facon pour le comptoir de
//  tomber en panne. Pour une officine, le remede serait pire.
//
//  ENVELOPPE. Chaque fichier est chiffre avec SA PROPRE cle tiree au hasard ;
//  cette petite cle est emballee par la cle maitresse et rangee a cote du
//  fichier. Changer de cle maitresse ne reemballe donc que des cles de 32
//  octets, jamais les fichiers eux-memes : la rotation devient une operation de
//  quelques secondes au lieu d'une reecriture complete.
//
//  ROTATION. SCANS_CLE chiffre ; SCANS_CLES_ANCIENNES (separees par des
//  virgules) ne sert qu'a dechiffrer. On pose la nouvelle cle, on deplace
//  l'ancienne dans la liste, on deploie, on reemballe, on retire l'ancienne.
//  Aucune interruption, et a aucun moment un fichier n'est illisible.
//
//  SI LA CLE EST PERDUE, LES ORDONNANCES SONT PERDUES. C'est le seul risque que
//  ce fichier ajoute, et aucune ligne de code ne le couvre : il se couvre par
//  une deuxieme copie de la cle, ailleurs, et par un essai de restauration
//  reellement fait. Une cle dont on ne s'est jamais servi pour restaurer n'est
//  pas une cle, c'est une croyance.
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const VERSION = 'c1';           // format d'enveloppe, pour pouvoir en changer

// Une cle se lit en base64 ou en hexadecimal, et vaut 32 octets. Toute autre
// longueur est un refus net : une cle « presque bonne » chiffrerait des
// ordonnances qu'on ne saurait plus relire.
function lireCle(brut, ou) {
  const s = String(brut || '').trim();
  if (!s) return null;
  let b = null;
  if (/^[0-9a-fA-F]{64}$/.test(s)) b = Buffer.from(s, 'hex');
  else { try { b = Buffer.from(s, 'base64'); } catch (e) { b = null; } }
  if (!b || b.length !== 32) {
    throw new Error('Clé de chiffrement invalide (' + ou + ') : 32 octets attendus, '
      + (b ? b.length : 0) + ' lus. Générez-la avec : openssl rand -base64 32');
  }
  return b;
}

// Empreinte publique d'une cle : quatre octets du condensat de la cle, jamais
// la cle. Ecrite a cote de chaque fichier, elle repond a « avec laquelle de mes
// cles ce fichier a-t-il ete chiffre ? » sans rien reveler. Sans elle, une
// rotation obligerait a essayer toutes les cles sur chaque lecture.
function marque(cle) {
  return crypto.createHash('sha256').update(cle).digest('hex').slice(0, 8);
}

function charger() {
  const courante = lireCle(process.env.SCANS_CLE, 'SCANS_CLE');
  const anciennes = String(process.env.SCANS_CLES_ANCIENNES || '')
    .split(',').map(x => x.trim()).filter(Boolean)
    .map((x, i) => lireCle(x, 'SCANS_CLES_ANCIENNES #' + (i + 1)));
  const par = new Map();
  if (courante) par.set(marque(courante), courante);
  anciennes.forEach(k => { if (!par.has(marque(k))) par.set(marque(k), k); });
  return { courante, par, marqueCourante: courante ? marque(courante) : null };
}

let etat = { courante: null, par: new Map(), marqueCourante: null };
let erreur = null;
try { etat = charger(); } catch (e) { erreur = e.message; }

function actif() { return !!etat.courante; }
function diagnostic() {
  return { actif: actif(), erreur,
           marque: etat.marqueCourante, anciennes: Math.max(0, etat.par.size - (etat.courante ? 1 : 0)) };
}

// ── Chiffrer ────────────────────────────────────────────────────────────────
// Rend l'enveloppe a ranger a cote du fichier. Le condensat qui sert
// d'identifiant est calcule AILLEURS, sur les octets EN CLAIR : c'est ce qui
// preserve la deduplication — et la capacite de restaurer un scan en
// reenvoyant les memes octets, qui nous a sauves le 13/09.
function chiffrer(clair) {
  if (!actif()) return null;
  const cleFichier = crypto.randomBytes(32);
  const ivF = crypto.randomBytes(12);
  const cF = crypto.createCipheriv(ALGO, cleFichier, ivF);
  const contenu = Buffer.concat([cF.update(clair), cF.final()]);
  const tagF = cF.getAuthTag();

  const ivC = crypto.randomBytes(12);
  const cC = crypto.createCipheriv(ALGO, etat.courante, ivC);
  const cleEmballee = Buffer.concat([cC.update(cleFichier), cC.final()]);
  const tagC = cC.getAuthTag();
  cleFichier.fill(0);

  return {
    algo: VERSION,
    octets: contenu,
    // Tout ce qui permet de rouvrir, sauf la cle maitresse : iv et sceau du
    // fichier, puis la petite cle emballee avec son propre iv et son sceau.
    enveloppe: Buffer.concat([ivF, tagF, ivC, tagC, cleEmballee]),
    marque: etat.marqueCourante
  };
}

// ── Dechiffrer ──────────────────────────────────────────────────────────────
function dechiffrer(rangee) {
  if (!rangee || !rangee.algo) return rangee ? rangee.octets : null;   // fichier encore en clair
  if (rangee.algo !== VERSION) throw new Error('Format d\'enveloppe inconnu : ' + rangee.algo);
  const cle = etat.par.get(rangee.marque);
  if (!cle) {
    throw new Error('Aucune clé ne correspond à ce fichier (empreinte ' + rangee.marque + '). '
      + 'Si une rotation est en cours, la clé précédente doit rester dans SCANS_CLES_ANCIENNES.');
  }
  const e = rangee.enveloppe;
  if (!e || e.length < 56) throw new Error('Enveloppe illisible ou tronquée');
  const ivF = e.subarray(0, 12), tagF = e.subarray(12, 28);
  const ivC = e.subarray(28, 40), tagC = e.subarray(40, 56);
  const cleEmballee = e.subarray(56);

  const dC = crypto.createDecipheriv(ALGO, cle, ivC);
  dC.setAuthTag(tagC);
  const cleFichier = Buffer.concat([dC.update(cleEmballee), dC.final()]);

  const dF = crypto.createDecipheriv(ALGO, cleFichier, ivF);
  dF.setAuthTag(tagF);
  const clair = Buffer.concat([dF.update(rangee.octets), dF.final()]);
  cleFichier.fill(0);
  return clair;
}

// ── Rotation ────────────────────────────────────────────────────────────────
// Reemballe la petite cle d'un fichier sous la cle courante. Le contenu n'est
// pas touche : c'est tout l'interet de l'enveloppe.
function reemballer(rangee) {
  if (!actif() || !rangee || !rangee.algo) return null;
  if (rangee.marque === etat.marqueCourante) return null;   // deja a jour
  const ancienne = etat.par.get(rangee.marque);
  if (!ancienne) throw new Error('Clé précédente absente (empreinte ' + rangee.marque + ')');
  const e = rangee.enveloppe;
  const ivC = e.subarray(28, 40), tagC = e.subarray(40, 56), cleEmballee = e.subarray(56);
  const dC = crypto.createDecipheriv(ALGO, ancienne, ivC);
  dC.setAuthTag(tagC);
  const cleFichier = Buffer.concat([dC.update(cleEmballee), dC.final()]);

  const nIvC = crypto.randomBytes(12);
  const cC = crypto.createCipheriv(ALGO, etat.courante, nIvC);
  const nEmballee = Buffer.concat([cC.update(cleFichier), cC.final()]);
  const nTagC = cC.getAuthTag();
  cleFichier.fill(0);

  return {
    enveloppe: Buffer.concat([e.subarray(0, 28), nIvC, nTagC, nEmballee]),
    marque: etat.marqueCourante
  };
}

module.exports = { actif, diagnostic, chiffrer, dechiffrer, reemballer, marque, VERSION };
