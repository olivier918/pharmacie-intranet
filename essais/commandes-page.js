// LE MODULE COMMANDES : ce que le serveur reconnaît, et ce que l'écran promet.
// La lecture des PDF est éprouvée à part (essais/commandes-asca.js) ; ici on
// vérifie ce qui l'entoure — et qui se casse sans bruit.
// node essais/commandes-page.js
const C = require('../commandes');
const fs = require('fs'), path = require('path');
const co = fs.readFileSync(path.join(__dirname, '..', 'public', 'co-module.js'), 'utf8');
const sv = fs.readFileSync(path.join(__dirname, '..', 'commandes.js'), 'utf8');
const ix = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

let ok = 0, ko = 0;
const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };
console.log('\nCOMMANDES À PASSER — l’écran du matin\n');

// ── RECONNAÎTRE LES PIÈCES JOINTES ──────────────────────────────────────────
// Enregistré depuis un courriel, un fichier perd ses espaces. Une pièce jointe
// non reconnue, c'est une liste amputée d'un tiers — sans que rien ne le dise.
console.log('Reconnaître les pièces jointes du courriel');
t('le nom tel qu’ASCA l’envoie', C.quelTableau('Produits en rupture sans commande.PDF') === 'sansCommande');
t('... avec des tirets bas, comme après un enregistrement',
  C.quelTableau('Produits_en_rupture_sans_commande.PDF') === 'sansCommande');
t('... avec un préfixe ajouté par le navigateur',
  C.quelTableau('99f2e122-Produits_en_rupture_sans_commande.PDF') === 'sansCommande');
t('... avec le « (1) » d’un second téléchargement',
  C.quelTableau('Produits_en_Ruptures_avec_Commandes (1).PDF') === 'avecCommande');
t('le risque 15 jours', C.quelTableau('Risque de Ruptures par rapport aux ventes sur 15 Jours.PDF') === 'risque15');
t('les accents ne décident de rien', C.normaliserNom('Réassort Rayon') === 'Reassort Rayon');
// LE PIEGE QUI A COUTE 95 LIGNES. Les exemples du depot sont ranges sous une
// forme datee, et la reconnaissance, trop litterale, laissait tomber le tableau
// « risque 15 jours » en entier — sans lever la moindre erreur.
t('un exemple daté du dépôt est reconnu aussi',
  C.quelTableau('2026-09-28-risque-15-jours.pdf') === 'risque15');
t('... et les deux autres', C.quelTableau('2026-09-28-rupture-sans-commande.pdf') === 'sansCommande'
  && C.quelTableau('2026-09-28-rupture-avec-commande.pdf') === 'avecCommande');
t('un tableau écarté le reste, quelle que soit sa forme',
  C.quelTableau('2026-09-28-hit-parade.pdf') === null
  && C.quelTableau('Reassort Rayon depuis Reserve.PDF') === null
  && C.quelTableau('Produits à faible rotation.PDF') === null);
t('le Hit Parade n’est pas un tableau de commandes', C.quelTableau('Hit Parade.PDF') === null);
t('les promotions non plus', C.quelTableau('Liste des Promotions.PDF') === null);
t('un nom absent ne casse rien', C.quelTableau(null) === null);

// ── CE QUI DOIT ÊTRE DIT À L'ÉCRAN ──────────────────────────────────────────
console.log('\nCe que l’écran doit dire plutôt que taire');
t('une synthèse de plus de 36 h est signalée — sinon on commanderait sur les '
  + 'ruptures d’avant-hier en croyant voir celles du jour',
  /PERIME_H = 36/.test(co) && /ce ne sont pas les ruptures/.test(co));
t('un compte qui ne correspond pas au courriel est signalé — une liste trop '
  + 'courte ressemble à une bonne nouvelle',
  /compte ne correspond pas/.test(co) && /peut-être incomplète/.test(co));
t('les lignes non lues sont comptées à l’écran', /ligne\(s\) non lue\(s\)/.test(co));
t('une page sans synthèse explique quoi faire', /Déposez les PDF/.test(co));
t('le contrôle par les totaux est appliqué à l’import', /A\.verifier\(lu, indicateurs\)/.test(sv));

// ── LES DROITS ──────────────────────────────────────────────────────────────
// Decision d'Olivier : la page est ouverte a tous, et marquer aussi. Seuls les
// seuils restent aux administrateurs.
console.log('\nQui peut quoi');
t('lire la liste ne demande aucun droit particulier',
  !/estAdmin[\s\S]{0,200}commandes\/courant/.test(sv));
t('marquer « commande passée » demande une session, pas un rôle',
  /commandes\/statut[\s\S]{0,300}session inconnue/.test(sv));
t('... et le nom est enregistré : c’est une trace, pas un droit',
  /INSERT INTO app_cmd_statuts[\s\S]{0,200}par/.test(sv));
t('changer les seuils reste aux administrateurs',
  /commandes\/reglages[\s\S]{0,400}réservé aux administrateurs/.test(sv));
t('un seuil « à commander » supérieur au seuil urgent est refusé',
  /c > u\)[\s\S]{0,120}Seuils invalides/.test(sv));

// ── LES DONNÉES NE VONT PAS DANS LE BLOB ────────────────────────────────────
// 200 lignes par jour dans un blob de 11 Mo qui repart vers chaque poste
// toutes les huit secondes : il doublerait en un an.
console.log('\nLes synthèses restent hors du blob');
t('le module a ses propres tables', /CREATE TABLE IF NOT EXISTS app_cmd_syntheses/.test(sv));
t('... créées au démarrage, sans système de migrations',
  /creerTables/.test(sv) && !/migration/i.test(sv));
t('aucune rubrique n’est ajoutée au blob',
  !/SYNCED_COLLS/.test(sv) && !/_collRef\('commandes/.test(co));
t('l’écran lit l’équipe par _collRef — piège #8', /_collRef\('staffDB'\)/.test(co));
t('réimporter la même synthèse la remplace, sans doublon',
  /ON CONFLICT \(date_synthese\) DO UPDATE/.test(sv));
t('... et ses lignes sont refaites, pas empilées',
  /DELETE FROM app_cmd_lignes WHERE synthese_id/.test(sv));
t('le statut est porté par le couple produit + synthèse : « commandé » le 28 '
  + 'ne vaut pas pour le 29', /PRIMARY KEY \(code, synthese_id\)/.test(sv));

// ── L'ÉCRAN ─────────────────────────────────────────────────────────────────
console.log('\nL’écran');
t('la section s’injecte, comme les autres modules', /id = 'sec-commandes'/.test(co));
t('l’entrée de barre aussi', /data-sec', 'commandes'/.test(co));
t('l’icône existe dans le sprite', /id="ic-commandes"/.test(ix));
t('le module est chargé par index.html', /<script src="co-module\.js"><\/script>/.test(ix));
t('le champ de recherche se déclare au clavier — data-rc, rien de plus',
  /data-rc="recherche"/.test(co));
t('les PDF partent en base64 dans le corps JSON : pas de multipart, donc pas '
  + 'de dépendance de plus', /readAsDataURL/.test(co) && /base64/.test(sv));
t('la liste s’imprime sans les boutons', /@media print\{[^}]*co-p-a/.test(co));
t('une carte de laboratoire ne se coupe pas entre deux pages',
  /break-inside:avoid/.test(co));
t('aucune commande n’est passée automatiquement',
  /AUCUNE COMMANDE N'EST JAMAIS PASSÉE/.test(co));

// ── L'ARRIVEE PAR COURRIEL ──────────────────────────────────────────────────
// Une route montee AVANT le portail est un point d'entree public. Ce qui se
// joue ici n'est pas le confort : c'est qu'elle n'existe que si on l'a voulue,
// et qu'elle n'avale pas n'importe quel courriel.
const A = require('../commandes-asca');
const gs = fs.readFileSync(path.join(__dirname, '..', 'outils', 'asca-vers-pilot.gs'), 'utf8');
console.log('\nL’arrivée des synthèses par courriel');

t('pas de secret posé, pas de route : elle répond 503',
  /if \(!secret\) return res\.status\(503\)/.test(sv));
t('le secret est comparé en temps constant', /timingSafeEqual/.test(sv));
t('il vient d’une variable d’environnement, jamais du dépôt',
  /process\.env\.ASCA_HOOK_SECRET/.test(sv) && !/ASCA_HOOK_SECRET\s*=\s*['"]/.test(sv));
t('un refus journalise les NOMS des en-têtes, jamais leurs valeurs',
  /Object\.keys\(req\.headers/.test(sv) && !/JSON\.stringify\(req\.headers/.test(sv));
t('elle est montée AVANT le portail', (function () {
  const srv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  return srv.indexOf('installerCourrier') < srv.indexOf('app.use(auth.gate)');
}()));
t('son analyseur JSON est serré, très loin du 50 Mo global',
  /express\.json\(\{ limit: '4mb' \}\)/.test(sv));
t('on traite AVANT de répondre — répondre puis échouer perdrait la synthèse',
  /await enregistrer\(d, b\.fichiers[\s\S]{0,400}res\.json\(\{ ok: true, date/.test(sv));

// L'EXPEDITEUR SE LIT DANS LE CORPS : le courriel arrive TRANSFERE, son `From`
// est celui de la pharmacie. Un filtre sur l'en-tete n'aurait rien laisse
// passer — ou aurait laisse passer n'importe quel transfert.
const CORPS = 'Forwarded message\nDe : <' + A.ASCA_EXPEDITEUR + '>\n'
  + 'Produits en rupture avec une commande 33 57\n'
  + 'Produits en rupture avec une réserve (réassort rayon) 1 1\n'
  + 'Produits en rupture (pas de réserve, pas de commande) 52 41\n'
  + 'Nombre d’étiquettes dont la pile est faible 88\n'
  + 'Etat du serveur de mise à jour En marche';
t('un transfert d’ASCA est reconnu par son CORPS', A.vientDAsca(CORPS, 'pharmacie@ferran.fr'));
t('... et aussi quand il arrive en direct', A.vientDAsca('', A.ASCA_EXPEDITEUR));
t('un courriel quelconque est écarté', !A.vientDAsca('Bonjour, voici des PDF', 'inconnu@exemple.fr'));
t('... et la route l’écarte au lieu de l’avaler', /ignore: 'expediteur'/.test(sv));

// LES TOTAUX ANNONCES : c'est ce que la voie automatique apporte et que le
// depot manuel ne peut pas donner.
const ind = A.lireIndicateurs(CORPS);
t('le corps donne les 52 ruptures sans commande', ind.sansCommande === 52);
t('... les 33 avec commande', ind.avecCommande === 33);
t('... et la moyenne sur 30 jours, second nombre de la même ligne',
  ind.moyennes.sansCommande === 41 && ind.moyennes.avecCommande === 57);
t('l’état du serveur ASCA est relevé', ind.serveur === 'En marche');
t('une ligne absente rend null, et null n’est pas zéro',
  A.lireIndicateurs('rien du tout').sansCommande === null);
t('les accents perdus en route ne cassent rien',
  A.lireIndicateurs(A.sansAccent(CORPS)).sansCommande === 52);
t('ces totaux sont passés au contrôle de lecture',
  /A\.lireIndicateurs\(b\.corps/.test(sv) && /enregistrer\(d, b\.fichiers, 'courriel', ind\)/.test(sv));

// ── LE SCRIPT GOOGLE ────────────────────────────────────────────────────────
console.log('\nLe script qui vit dans le compte Google');
t('le secret n’est pas dans le fichier — il est dans les propriétés du projet',
  /getScriptProperties\(\)/.test(gs) && !/PILOT_SECRET\s*=\s*['"][^'"]+['"]/.test(gs));
t('il n’envoie que si le secret ET l’adresse sont posés',
  /if \(!url \|\| !secret\)/.test(gs));
t('il lit l’expéditeur d’origine dans le corps, comme la route',
  /corps\.indexOf\(EXPEDITEUR\) < 0/.test(gs));
t('il n’étiquette QUE si PILOT a répondu oui — sinon la synthèse du jour '
  + 'serait perdue en silence', /if \(code >= 200 && code < 300\) envoye = true/.test(gs));
t('il ne supprime rien et ne répond à personne',
  !/moveToTrash|sendEmail|reply\(/.test(gs));
t('il ne regarde que trois jours en arrière, pas toute la boîte',
  /newer_than:3d/.test(gs));

console.log('\n' + ok + ' vérifications, ' + ko + ' échec(s)\n');
process.exit(ko ? 1 : 0);
