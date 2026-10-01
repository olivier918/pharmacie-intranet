/* ═══════════════════════════════════════════════════════════════════════════
   ASCA → PILOT — à coller dans Google Apps Script

   Cherche la synthèse quotidienne d'ASCA dans la boîte, et envoie ses pièces
   jointes à PILOT. Tourne dans le compte Google d'Olivier : aucun mot de passe
   de messagerie ne quitte Google, et PILOT n'a rien à installer.

   ─── POSE, UNE FOIS ────────────────────────────────────────────────────────
   1. script.google.com → Nouveau projet → coller ce fichier.
   2. Paramètres du projet → Propriétés du script → ajouter :
         PILOT_URL     https://pilot.pharmacie-mondeville.fr/api/commandes/courrier
         PILOT_SECRET  (la même valeur que ASCA_HOOK_SECRET sur Railway)
      NE JAMAIS écrire le secret dans le code : ce fichier est dans un dépôt.
   3. Déclencheurs → Ajouter → fonction `verifierAsca`, déclencheur horaire,
      toutes les 15 minutes.
   4. Exécuter `verifierAsca` une fois à la main pour accorder les
      autorisations Gmail.

   ─── CE QU'IL NE FAIT PAS ──────────────────────────────────────────────────
   Il ne supprime rien, ne répond à personne, n'envoie rien ailleurs. Il lit,
   il POSTe, il pose une étiquette. C'est tout.
   ═══════════════════════════════════════════════════════════════════════════ */

var ETIQUETTE = 'PILOT-traite';   // marque les fils déjà envoyés
var EXPEDITEUR = 'SyntheseAscaEtiq@noreply.asca-pharma.com';

function verifierAsca() {
  var prop = PropertiesService.getScriptProperties();
  var url = prop.getProperty('PILOT_URL');
  var secret = prop.getProperty('PILOT_SECRET');
  if (!url || !secret) { Logger.log('PILOT_URL ou PILOT_SECRET manquant.'); return; }

  var lab = GmailApp.getUserLabelByName(ETIQUETTE) || GmailApp.createLabel(ETIQUETTE);

  // L'ETIQUETTE EST CE QUI EVITE LE DOUBLON, pas la date : un fil deja traite
  // est ecarte des la recherche. PILOT sait de toute facon remplacer une
  // synthese reimportee, mais autant ne pas la lui envoyer vingt fois.
  var fils = GmailApp.search(
    'subject:"ASCA : Synthese" has:attachment newer_than:3d -label:' + ETIQUETTE, 0, 10);

  fils.forEach(function (fil) {
    var messages = fil.getMessages();
    var envoye = false;

    messages.forEach(function (m) {
      var corps = m.getPlainBody() || '';
      // L'EXPEDITEUR D'ORIGINE EST DANS LE CORPS : le courriel arrive
      // transfere, donc son `From` est celui de la pharmacie, pas d'ASCA.
      if (corps.indexOf(EXPEDITEUR) < 0 && m.getFrom().indexOf(EXPEDITEUR) < 0) return;

      var pj = m.getAttachments().filter(function (a) {
        return /\.pdf$/i.test(a.getName());
      });
      if (!pj.length) return;

      var charge = {
        expediteur: m.getFrom(),
        recuLe: m.getDate().toISOString(),
        corps: corps.slice(0, 20000),
        fichiers: pj.map(function (a) {
          return { nom: a.getName(), b64: Utilities.base64Encode(a.getBytes()) };
        })
      };

      var rep = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        headers: { 'X-PILOT-HOOK': secret },
        payload: JSON.stringify(charge),
        muteHttpExceptions: true
      });
      var code = rep.getResponseCode();
      Logger.log('PILOT a repondu ' + code + ' : ' + rep.getContentText().slice(0, 200));
      // ON N'ETIQUETTE QUE SI PILOT A DIT OUI. Marquer un fil que PILOT a
      // refuse, c'est perdre la synthese du jour en silence : le prochain
      // passage ne la reverrait plus.
      if (code >= 200 && code < 300) envoye = true;
    });

    if (envoye) fil.addLabel(lab);
  });
}
