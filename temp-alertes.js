// ─────────────────────────────────────────────────────────────────────────────
//  Les alertes de température — ce qui fait qu'un frigo à 12 °C un dimanche
//  à 3 h du matin n'est pas seulement ENREGISTRÉ, mais SIGNALÉ.
// ─────────────────────────────────────────────────────────────────────────────
//
//  POURQUOI DEUX SEUILS, ET PAS UN. La demande initiale ne portait que sur le
//  haut. Un frigo qui descend vers 0 °C congèle les vaccins et les détruit
//  sans qu'aucune alarme de chaleur ne sonne, et sans que rien ne se voie à
//  l'œil. La plage retenue est 2 – 8 °C : 2 plutôt que 0 pour prévenir avant
//  que le mal soit fait.
//
//  POURQUOI DEUX RÉGIMES. En journée, quelqu'un est là : une porte restée
//  ouverte trois minutes ne doit pas faire sonner un téléphone. On attend donc
//  trois relevés consécutifs, soit quarante-cinq minutes. La nuit et le
//  dimanche, personne ne passera : on alerte dès le premier relevé.
//
//  POURQUOI L'ABSENCE DE DONNÉES EST ELLE-MÊME UNE ALERTE. L'API interrogée
//  est celle que l'interface web de Testo utilise pour elle-même ; elle peut
//  changer sans préavis. Un écran vert sur des données figées est plus
//  dangereux que pas d'écran du tout.
//
//  POURQUOI L'ÉTAT DES ÉPISODES EST EN BASE, ET PAS EN MÉMOIRE. Un
//  redémarrage — et il y en a à chaque déploiement — ne doit ni renvoyer une
//  alerte déjà envoyée, ni oublier qu'un frigo est en défaut depuis deux
//  heures. C'est aussi la règle du CLAUDE.md : tout état partagé entre
//  requêtes va en base.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const PLAGE_DEFAUT = { min: 2, max: 8 };
const PANNE_MS     = 45 * 60 * 1000;   // plus rien depuis 45 min = le robot est mort
const RAPPEL_MS    =  2 * 3600 * 1000; // un défaut qui dure : on rappelle toutes les 2 h
const RELEVES_JOUR = 3;                // 3 relevés = 45 min, en journée

// ─── Le moment de la semaine ────────────────────────────────────────────────
// Toujours en heure de Paris : le serveur est en UTC, et un raisonnement sur
// « il est 3 h du matin » fait en UTC se trompe d'une ou deux heures selon la
// saison — c'est-à-dire précisément aux heures qui décident du régime.
function momentParis(d) {
  const f = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false
  });
  const p = {};
  f.formatToParts(d instanceof Date ? d : new Date(d)).forEach(x => { p[x.type] = x.value; });
  const jour = String(p.weekday || '').toLowerCase().slice(0, 3);   // lun, mar, … dim
  const h = parseInt(p.hour, 10), m = parseInt(p.minute, 10);
  return { jour: jour, minutes: h * 60 + m };
}

// Deux régimes, et un seul critère : quelqu'un est-il dans l'officine ?
//   'ouverture' — lundi au samedi, 9 h 00 à 19 h 30
//   'fermeture' — tout le reste : les nuits, et le dimanche entier
function regime(d) {
  const t = momentParis(d);
  if (t.jour === 'dim') return 'fermeture';
  const ouvre = 9 * 60, ferme = 19 * 60 + 30;
  return (t.minutes >= ouvre && t.minutes < ferme) ? 'ouverture' : 'fermeture';
}
// Combien de relevés hors plage avant de réveiller quelqu'un.
function relevesRequis(d) { return regime(d) === 'ouverture' ? RELEVES_JOUR : 1; }

// ─── L'état d'un point ──────────────────────────────────────────────────────
// `mesures` : les relevés du point, du plus RÉCENT au plus ancien.
// Rend l'état, la dernière valeur, et depuis combien de relevés consécutifs on
// est hors plage — compté depuis le plus récent, car c'est la situation
// présente qui décide, pas l'histoire.
function etatPoint(mesures, plage, maintenant) {
  const p = plage || PLAGE_DEFAUT;
  const l = (mesures || []).filter(m => m && typeof m.valeur === 'number');
  if (!l.length) return { etat: 'muet', valeur: null, ts: null, consecutifs: 0 };

  const dernier = l[0];
  const age = (+new Date(maintenant)) - (+new Date(dernier.ts));
  // Des mesures qui ne bougent plus : l'armoire n'est pas « bonne », elle est
  // inconnue. On ne peint jamais du vert sur une donnée périmée.
  if (age > PANNE_MS) return { etat: 'muet', valeur: dernier.valeur, ts: dernier.ts, consecutifs: 0, age: age };

  let n = 0;
  for (const m of l) {
    if (m.valeur < p.min || m.valeur > p.max) n++;
    else break;
  }
  return {
    etat: n > 0 ? 'hors' : 'ok',
    valeur: dernier.valeur, ts: dernier.ts, consecutifs: n, age: age,
    sens: n > 0 ? (dernier.valeur > p.max ? 'haut' : 'bas') : null
  };
}

// ─── Ce qu'on fait de cet état ──────────────────────────────────────────────
// `episode` : l'épisode ouvert pour ce point, ou null. Rend UNE décision.
//   ouvrir   — premier franchissement : on alerte
//   rappeler — le défaut dure : on rappelle, toutes les deux heures
//   clore    — c'est rentré dans l'ordre : on le dit, une fois
//   rien     — le cas le plus fréquent, et il ne doit rien coûter
//
// Un frigo bloqué à 12 °C pendant six heures ne doit pas envoyer vingt-quatre
// SMS : ce serait la meilleure façon de faire ignorer le vingt-cinquième.
function decider(etat, episode, maintenant, requis) {
  const t = +new Date(maintenant);
  const ouvert = episode && !episode.clos_le;

  if (etat.etat === 'hors') {
    if (!ouvert) {
      return etat.consecutifs >= requis
        ? { action: 'ouvrir', motif: 'seuil', valeur: etat.valeur, sens: etat.sens }
        : { action: 'rien', motif: 'pas encore ' + requis + ' relevés' };
    }
    const depuis = t - (+new Date(episode.dernier_envoi_le || episode.ouvert_le));
    return depuis >= RAPPEL_MS
      ? { action: 'rappeler', motif: 'seuil', valeur: etat.valeur, sens: etat.sens }
      : { action: 'rien', motif: 'rappel pas encore dû' };
  }

  if (etat.etat === 'muet') {
    if (!ouvert) return { action: 'ouvrir', motif: 'panne', valeur: etat.valeur, age: etat.age };
    if (episode.motif !== 'panne') {
      // On passait d'un dépassement à un silence : ce n'est plus la même
      // alerte, et confondre les deux ferait croire que le frigo va bien.
      return { action: 'ouvrir', motif: 'panne', valeur: etat.valeur, age: etat.age };
    }
    const depuis = t - (+new Date(episode.dernier_envoi_le || episode.ouvert_le));
    return depuis >= RAPPEL_MS
      ? { action: 'rappeler', motif: 'panne', valeur: etat.valeur, age: etat.age }
      : { action: 'rien', motif: 'rappel pas encore dû' };
  }

  // etat.etat === 'ok'
  return ouvert
    ? { action: 'clore', motif: episode.motif, valeur: etat.valeur }
    : { action: 'rien', motif: 'tout va bien' };
}

// ─── Le texte du SMS ────────────────────────────────────────────────────────
// SANS ACCENTS, volontairement. Un seul caractère hors GSM-7 fait tomber la
// limite de 160 à 70 caracteres : le message passe a deux ou trois credits, et
// une alerte a 3 h du matin n'a pas besoin de cedilles. Aucune donnee de sante
// ne figure ici — un nom d'armoire et un nombre de degres, rien d'autre.
function texte(point, decision, plage) {
  const p = plage || PLAGE_DEFAUT;
  const nom = String(point || 'Armoire').slice(0, 24);
  if (decision.motif === 'panne') {
    const min = decision.age ? Math.round(decision.age / 60000) : null;
    return 'PILOT - ' + nom + ' : plus aucun releve'
      + (min ? ' depuis ' + min + ' min' : '') + '. Surveillance interrompue.';
  }
  if (decision.action === 'clore') {
    return 'PILOT - ' + nom + ' : retour dans la plage (' + fmt(decision.valeur) + ' C).';
  }
  const v = fmt(decision.valeur);
  const sens = decision.sens === 'bas' ? 'trop froid' : 'trop chaud';
  return 'PILOT - ' + nom + ' : ' + v + ' C, ' + sens
    + ' (plage ' + p.min + '-' + p.max + ' C).'
    + (decision.action === 'rappeler' ? ' Toujours en defaut.' : '');
}
function fmt(v) {
  return (typeof v === 'number') ? String(Math.round(v * 10) / 10).replace(',', '.') : '?';
}

// Les destinataires réellement joignables, à partir de la liste d'astreintes.
// Une astreinte à une seule personne est un point unique de défaillance — mais
// un numéro invalide ne doit pas empêcher les autres d'être prévenus. Les
// lignes décochées sont ignorées : on met quelqu'un en pause sans effacer son
// numéro, et on le remet d'une case à cocher.
function destinataires(astreintes, valider) {
  const ok = typeof valider === 'function' ? valider : (x => x || null);
  return (Array.isArray(astreintes) ? astreintes : [])
    .filter(a => a && a.actif !== false)
    .map(a => ok(a.tel))
    .filter(Boolean)
    .filter((n, i, l) => l.indexOf(n) === i);
}

module.exports = {
  PLAGE_DEFAUT, PANNE_MS, RAPPEL_MS, RELEVES_JOUR,
  momentParis, regime, relevesRequis, etatPoint, decider, texte, destinataires
};
