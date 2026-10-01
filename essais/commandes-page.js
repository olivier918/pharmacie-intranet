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
  /creerTables/.test(sv)
  && !/schema_migrations|migrations\//i.test(sv));
t('une colonne qui arrive plus tard s’ajoute sans toucher aux données',
  /ALTER TABLE app_cmd_labos ADD COLUMN IF NOT EXISTS/.test(sv));
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
// LE SCRIPT SE COLLE A LA MAIN DANS UN EDITEUR WEB. Le 01/10/2026, un en-tete
// de commentaire orne de filets a casse au collage : Apps Script a repondu
// « Unexpected identifier 'verifierAsca' (ligne 1) » et le declencheur etait
// impossible a creer. Tout ce qui peut s'abimer dans un copier-coller doit
// donc etre absent du fichier.
t('le script est en ASCII pur — ni accents ni filets à abîmer au collage',
  !/[^\x00-\x7F]/.test(gs));
t('la fonction est déclarée dès la LIGNE 1 : même un collage partiel la montre',
  /^function verifierAsca\(\) \{/.test(gs));
t('aucun commentaire de bloc, qui est ce qui avait cassé', !/\/\*/.test(gs));
t('le mode d’emploi vit dans EXPLOITATION.md, pas dans le fichier à coller',
  /asca-vers-pilot/.test(fs.readFileSync(path.join(__dirname,'..','EXPLOITATION.md'),'utf8')));

// ── LES LABORATOIRES ────────────────────────────────────────────────────────
// ASCA ecrit parfois le meme laboratoire de deux facons. Deux cartes pour un
// seul interlocuteur, c'est deux appels — et un rapprochement fait tout seul,
// c'est le mauvais service appele tous les jours.
console.log('\nRapprocher deux laboratoires');
const H1 = 'HALEON GLAXOSMITHKLINE', H2 = 'HALEON GLAXOSMITHKLINE SANTE GP';
const PF1 = 'PIERRE FABRE MEDICAMENT', PF2 = 'PIERRE FABRE ORAL CARE';
const noms = [H1, H2, PF1, PF2, 'AVENE', 'AVENIR SANTE', 'A-DERMA'];
const pr = A.rapprochements(noms, []);
t('un nom suivi d’une précision est proposé', pr.length === 1 && pr[0].garde === H1 && pr[0].absorbe === H2);
// LA RAISON D'ETRE DE TOUT CECI : deux divisions d'un meme groupe se
// ressemblent autant que deux ecritures d'un meme labo.
t('deux divisions d’un même groupe ne sont PAS proposées — aucun des deux noms '
  + 'ne commence par l’autre', !pr.some(x => x.garde === PF1 || x.absorbe === PF2));
t('« AVENE » et « AVENIR SANTE » ne sont pas confondus',
  !pr.some(x => /AVEN/.test(x.garde) || /AVEN/.test(x.absorbe)));
t('un nom trop court ne déclenche rien', A.rapprochements(['ABC', 'ABCDEF'], []).length === 0);
t('un refus déjà exprimé fait taire la question',
  A.rapprochements(noms, [[H1, H2]]).length === 0);
t('... quel que soit l’ordre où il a été enregistré',
  A.rapprochements(noms, [[H2, H1]]).length === 0);
t('la casse et les accents ne changent rien', A.cleLabo('Hélon-Santé ') === 'HELONSANTE');
t('le nom le plus COURT est proposé comme nom retenu — c’est le tronc commun',
  pr[0].garde.length < pr[0].absorbe.length);
t('une liste vide ne casse rien', A.rapprochements(null, null).length === 0);

console.log('\nLe nom retenu s’applique à la LECTURE');
const LAB = [{ nom: H1, alias: [H2] }];
t('un alias retombe sur le nom retenu', A.nomRetenu(H2, LAB) === H1);
t('le nom retenu reste lui-même', A.nomRetenu(H1, LAB) === H1);
t('un laboratoire inconnu passe tel quel', A.nomRetenu('BAYER', LAB) === 'BAYER');
t('sans table, rien ne change', A.nomRetenu('BAYER', []) === 'BAYER');
// PIEGE #7 : la traduction se fait a la lecture, les lignes enregistrees
// gardent le nom qu'ASCA a ecrit — sinon defaire deviendrait impossible.
t('les lignes enregistrées ne sont jamais réécrites',
  /nomRetenu\(x\.labo, labos\)/.test(sv) && !/UPDATE app_cmd_lignes SET labo/.test(sv));

// CE QUE L'ESSAI EN SESSION REELLE A TROUVE : un meme produit peut porter deux
// orthographes selon le tableau. Le rassemblement par code n'en garde qu'une,
// et la variante disparait avant qu'on ait pu proposer de les rapprocher.
t('les propositions se calculent sur les noms LUS, pas sur les cartes',
  /const nomsVus = new Set\(\)/.test(sv) && /A\.rapprochements\(\[\.\.\.nomsVus\]/.test(sv));

console.log('\nFusionner, refuser, et la fiche');
t('fusionner AJOUTE un alias, n’efface pas un nom — c’est ce qui permet de défaire',
  /INSERT INTO app_cmd_labos \(nom, alias, maj\)/.test(sv) && /unnest\(app_cmd_labos\.alias/.test(sv));
t('la fiche du nom absorbé est versée dans celle qui reste, sans rien écraser',
  /COALESCE\(g\.contact, a\.contact\)/.test(sv));
t('un refus se mémorise — sinon la question revient chaque matin',
  /INSERT INTO app_cmd_labos_refus/.test(sv));
t('... et la paire est rangée dans un ordre fixe, pour ne pas la stocker deux fois',
  /\.sort\(\);\s*\n\s*if \(!p\[0\] \|\| !p\[1\]\)/.test(sv));
t('fusionner et refuser demandent une session', 
  (sv.match(/session inconnue/g) || []).length >= 4);
t('un import en bloc n’écrase jamais ce qui est déjà renseigné',
  /COALESCE\(app_cmd_labos\.contact, \$2\)/.test(sv));
t('... et il est réservé aux administrateurs',
  /labos-import[\s\S]{0,300}réservé aux administrateurs/.test(sv));
t('les colonnes manquantes sont ajoutées sans toucher aux données',
  /ADD COLUMN IF NOT EXISTS/.test(sv));

console.log('\nCe qu’on voit sur la carte');
t('le numéro s’affiche dans l’en-tête, là où on regarde avant de décrocher',
  /function coContact/.test(co));
t('... et il est cliquable, débarrassé de ses espaces',
  /href="tel:' \+ E\(String\(f\.tel\)\.replace\(\/\[\^0-9\+\]\/g, ''\)\)/.test(co));
t('le bloc de rapprochement s’efface quand il n’y a plus rien à trancher',
  /if \(!p\.length\) \{ z\.innerHTML = ''; return; \}/.test(co));
t('la fiche se ferme avec Échap', /function coFicheEchap/.test(co));
t('un gestionnaire ne reçoit jamais de texte saisi, seulement un indice',
  /onclick="coFusionner\(' \+ i \+ '\)/.test(co) && /onclick="coFiche\(' \+ coIndex/.test(co));

// ── QUI APPELLE QUEL LABORATOIRE ────────────────────────────────────────────
// Décision d'Olivier du 01/10 : plusieurs opérateurs par laboratoire, sans
// hiérarchie ; ce qui n'est attribué à personne revient aux administrateurs,
// et la carte le dit en orange plutôt que de le taire.
console.log('\nQui appelle quel laboratoire');
t('l’attribution est une colonne du laboratoire, pas une table de plus',
  /operateurs TEXT\[\] NOT NULL DEFAULT '\{\}'/.test(sv));
t('... posée sur une base existante sans toucher aux données',
  /"operateurs TEXT\[\][^"]*"[\s\S]{0,200}ADD COLUMN IF NOT EXISTS/.test(sv));
t('elle est relue avec la fiche et redescend à l’écran',
  /SELECT nom, alias, contact, tel, mail, notes, operateurs FROM app_cmd_labos/.test(sv)
  && /operateurs: r\.operateurs \|\| \[\]/.test(sv));
t('attribuer est réservé aux administrateurs — c’est une décision d’organisation',
  /labo-operateurs[\s\S]{0,400}réservé aux administrateurs/.test(sv));
t('une liste vide est une réponse valable : « à attribuer »',
  /Array\.isArray\(b\.operateurs\)/.test(sv));
t('on enregistre des identifiants de collaborateur, pas du texte libre',
  /x\.length <= 8/.test(sv) && /new Set\(b\.operateurs/.test(sv));
t('... et on ne les laisse pas s’accumuler sans borne', /\.slice\(0, 20\)/.test(sv));
t('une liste importée peut porter l’attribution, sans remplacer celle déjà faite',
  /cardinality\(app_cmd_labos\.operateurs\) = 0/.test(sv));
t('fusionner deux laboratoires ne perd pas l’opérateur du nom absorbé',
  /cardinality\(g\.operateurs\) = 0/.test(sv));

console.log('\nL’écran : ma tournée d’abord');
t('un laboratoire sans opérateur revient aux administrateurs',
  /return o\.length \? o\.indexOf\(u\.id\) >= 0 : coAdmin\(\);/.test(co));
t('... et la carte le signale « à attribuer », au lieu de le taire',
  /co-op0/.test(co) && /à attribuer/.test(co));
t('la page s’ouvre sur mes laboratoires, le reste est replié',
  /function coGroupes/.test(co) && /Mes laboratoires/.test(co));
t('RIEN D’URGENT NE SE CACHE DERRIÈRE LE REPLI : une ligne le dit',
  /co-ailleurs/.test(co)
  && /g\.urgence === 'rouge' \|\| g\.urgence === 'relance'/.test(co));
t('chercher donne une liste à plat — on cherche un laboratoire, pas sa tournée',
  /if \(coFiltre\.trim\(\) \|\| coUrgence \|\| !coUser\(\)\)/.test(co));
t('quand rien ne m’est attribué, le reste est ouvert d’emblée',
  /\(coAutres === null\) \? \(miens\.length === 0\)/.test(co));
t('on n’imprime pas une liste tronquée',
  /addEventListener\('beforeprint'/.test(co));
t('les cases à cocher ne sont montrées qu’aux administrateurs',
  /if \(!coAdmin\(\)\) \{[\s\S]{0,300}co-op-lu/.test(co));
t('... et le gestionnaire ne reçoit que des identifiants, jamais du texte saisi',
  /getAttribute\('data-uid'\)/.test(co) && !/co-f-ops'\)\.value/.test(co));
t('enregistrer la fiche et l’attribution ne recharge la page qu’une fois',
  /await coPost\('\/api\/commandes\/labo-fiche'/.test(co)
  && /await coPost\('\/api\/commandes\/labo-operateurs'/.test(co)
  && (co.match(/await coCharger\(\); window\.coRender\(\);\n      coMsg\('Fiche/g) || []).length === 1);

// ── LE REGROUPEMENT, ÉPROUVÉ SUR LA VRAIE FONCTION ──────────────────────────
// Les vérifications ci-dessus lisent le source ; celles-ci FONT TOURNER
// coGroupes et coAMoi, extraites de co-module.js. C'est la seule façon de
// savoir qu'un laboratoire pressé attribué à un absent ne disparaît pas.
console.log('\nLe regroupement, mis à l’épreuve');
(function () {
  function extraire(nom) {
    const d = co.indexOf('  function ' + nom + '(');
    if (d < 0) throw new Error('fonction introuvable : ' + nom);
    const f = co.indexOf('\n  }\n', d);
    return co.slice(d, f + 4);
  }
  // Le décor : juste ce dont les fonctions extraites ont besoin.
  const ICO = { rouge: '🔴', orange: '🟠', gris: '⚪', relance: '🔁' };
  const E = x => String(x == null ? '' : x);
  let coEtat = null, coAutres = null, moi = null, admin = false;
  const coUser = () => moi;
  const coAdmin = () => admin;
  const coPrenom = id => ({ OF: 'Olivier', AF: 'Anouck', SM: 'Sophie' })[id] || id;
  const coCarte = l => '[' + l.labo + ']';
  eval(extraire('coOps'));
  eval(extraire('coAMoi'));
  eval(extraire('coBadgeOps'));
  eval(extraire('coGroupes'));
  const window = { coRender() {} };

  const labos = [
    { labo: 'URGENT CHEZ MOI', urgence: 'rouge', produits: [] },
    { labo: 'URGENT AILLEURS', urgence: 'rouge', produits: [] },
    { labo: 'TRANQUILLE AILLEURS', urgence: 'gris', produits: [] },
    { labo: 'PERSONNE', urgence: 'orange', produits: [] }
  ];
  const fiches = {
    'URGENT CHEZ MOI': { operateurs: ['SM'] },
    'URGENT AILLEURS': { operateurs: ['AF'] },
    'TRANQUILLE AILLEURS': { operateurs: ['AF'] },
    'PERSONNE': { operateurs: [] }
  };
  coEtat = { labos: labos, fiches: fiches };

  // Sophie : préparatrice, pas administratrice.
  moi = { id: 'SM' }; admin = false; coAutres = null;
  let h = coGroupes(labos);
  t('Sophie voit son laboratoire', h.indexOf('[URGENT CHEZ MOI]') >= 0);
  t('... un seul : le compte le dit', /Mes laboratoires <b>1<\/b>/.test(h));
  t('... les autres sont repliés', h.indexOf('[TRANQUILLE AILLEURS]') < 0);
  t('... mais l’urgent d’Anouck est annoncé en clair',
    h.indexOf('co-ailleurs') >= 0 && h.indexOf('URGENT AILLEURS') >= 0);
  t('... et le tranquille d’Anouck ne vient pas encombrer cette ligne',
    h.split('co-ailleurs')[1].indexOf('TRANQUILLE AILLEURS') < 0);
  t('un laboratoire sans opérateur n’est pas à Sophie',
    h.indexOf('[PERSONNE]') < 0);

  // Le repli s'ouvre.
  coAutres = true;
  h = coGroupes(labos);
  t('déplié, tout est là', h.indexOf('[TRANQUILLE AILLEURS]') >= 0 && h.indexOf('[PERSONNE]') >= 0);
  t('... et la ligne rouge s’efface, elle n’a plus d’objet', h.indexOf('co-ailleurs') < 0);

  // Olivier : administrateur. Ce que personne n'a pris est à lui.
  moi = { id: 'OF' }; admin = true; coAutres = null;
  h = coGroupes(labos);
  t('ce que personne n’a pris revient à l’administrateur', h.indexOf('[PERSONNE]') >= 0);
  t('... mais pas ce qui est explicitement à quelqu’un d’autre',
    h.indexOf('[URGENT CHEZ MOI]') < 0);
  t('l’urgent d’Anouck lui est signalé aussi', h.indexOf('co-ailleurs') >= 0);

  // Personne n'a rien attribué : un préparateur ne doit pas voir une page vide.
  moi = { id: 'SM' }; admin = false; coAutres = null;
  coEtat = { labos: labos, fiches: { 'URGENT CHEZ MOI': { operateurs: [] },
    'URGENT AILLEURS': { operateurs: [] }, 'TRANQUILLE AILLEURS': { operateurs: [] },
    'PERSONNE': { operateurs: [] } } };
  h = coGroupes(labos);
  t('rien ne m’est attribué : le reste est ouvert, pas caché',
    h.indexOf('[URGENT AILLEURS]') >= 0 && h.indexOf('[PERSONNE]') >= 0);
  t('... et on me le dit franchement', /Aucun laboratoire ne vous est attribué/.test(h));

  // Le badge.
  coEtat = { labos: labos, fiches: fiches };
  t('le badge nomme les opérateurs par leur prénom',
    coBadgeOps('URGENT AILLEURS').indexOf('Anouck') >= 0);
  t('... et dit « à attribuer » quand il n’y en a pas',
    coBadgeOps('PERSONNE').indexOf('à attribuer') >= 0);
  t('un laboratoire inconnu des fiches ne fait pas tomber la page',
    coOps('JAMAIS VU').length === 0);
}());

console.log('\n' + ok + ' vérifications, ' + ko + ' échec(s)\n');
process.exit(ko ? 1 : 0);
