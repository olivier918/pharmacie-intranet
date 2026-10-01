function verifierAsca() {
  // ASCA vers PILOT. Cherche la synthese quotidienne dans la boite Gmail et
  // envoie ses pieces jointes a PILOT. Mode d'emploi : EXPLOITATION.md.
  // Volontairement sans accents ni caracteres decoratifs : ce texte est colle
  // a la main dans un editeur web, et tout ce qui peut s'y abimer s'y abime.
  var ETIQUETTE = 'PILOT-traite';
  var EXPEDITEUR = 'SyntheseAscaEtiq@noreply.asca-pharma.com';

  var prop = PropertiesService.getScriptProperties();
  var url = prop.getProperty('PILOT_URL');
  var secret = prop.getProperty('PILOT_SECRET');
  if (!url || !secret) {
    Logger.log('PILOT_URL ou PILOT_SECRET manquant dans les proprietes du script.');
    return;
  }

  var lab = GmailApp.getUserLabelByName(ETIQUETTE) || GmailApp.createLabel(ETIQUETTE);

  // L'etiquette est ce qui evite le doublon, pas la date : un fil deja traite
  // est ecarte des la recherche. On ne regarde que trois jours en arriere.
  var fils = GmailApp.search(
    'subject:"ASCA : Synthese" has:attachment newer_than:3d -label:' + ETIQUETTE, 0, 10);
  Logger.log(fils.length + ' fil(s) a examiner.');

  for (var i = 0; i < fils.length; i++) {
    var messages = fils[i].getMessages();
    var envoye = false;

    for (var j = 0; j < messages.length; j++) {
      var m = messages[j];
      var corps = m.getPlainBody() || '';

      // L'expediteur d'origine est dans le CORPS : le courriel arrive
      // transfere, donc son From est celui de la pharmacie, pas d'ASCA.
      if (corps.indexOf(EXPEDITEUR) < 0 && m.getFrom().indexOf(EXPEDITEUR) < 0) continue;

      var pj = [];
      var toutes = m.getAttachments();
      for (var k = 0; k < toutes.length; k++) {
        if (/\.pdf$/i.test(toutes[k].getName())) {
          pj.push({ nom: toutes[k].getName(), b64: Utilities.base64Encode(toutes[k].getBytes()) });
        }
      }
      if (!pj.length) continue;

      var charge = {
        expediteur: m.getFrom(),
        recuLe: m.getDate().toISOString(),
        corps: corps.slice(0, 20000),
        fichiers: pj
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

      // On n'etiquette QUE si PILOT a dit oui. Marquer un fil refuse, c'est
      // perdre la synthese du jour en silence : le prochain passage ne la
      // reverrait plus.
      if (code >= 200 && code < 300) envoye = true;
    }

    if (envoye) fils[i].addLabel(lab);
  }
}
