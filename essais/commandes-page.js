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

console.log('\n' + ok + ' vérifications, ' + ko + ' échec(s)\n');
process.exit(ko ? 1 : 0);
