// Les alertes de temperature. Ce qui se joue ici n'est pas un affichage :
// c'est un telephone qui sonne a 3 h du matin, ou qui ne sonne pas.
// Les fonctions sont celles de temp-alertes.js, chargees telles quelles.
// node essais/temperatures-alertes.js
const AL = require('../temp-alertes');

let ok = 0, ko = 0;
const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };
console.log('\nALERTES DE TEMPÉRATURE — quand le téléphone doit sonner\n');

// Des instants ECRITS EN UTC, pour que l'essai dise quelque chose du vrai
// serveur : Railway tourne en UTC, et un raisonnement sur « il est 3 h » fait
// en heure serveur se trompe d'une ou deux heures selon la saison.
const U = s => new Date(s);
const ETE_MARDI_14H  = U('2026-07-14T12:00:00Z');   // Paris = UTC+2 -> 14 h
const ETE_MARDI_03H  = U('2026-07-14T01:00:00Z');   // Paris = UTC+2 ->  3 h
const HIVER_MAR_14H  = U('2026-01-13T13:00:00Z');   // Paris = UTC+1 -> 14 h
const HIVER_MAR_03H  = U('2026-01-13T02:00:00Z');   // Paris = UTC+1 ->  3 h
const DIMANCHE_14H   = U('2026-07-12T12:00:00Z');   // dimanche, 14 h a Paris
const SAMEDI_14H     = U('2026-07-11T12:00:00Z');
const MARDI_19H45    = U('2026-07-14T17:45:00Z');   // 19 h 45 : ferme
const MARDI_08H59    = U('2026-07-14T06:59:00Z');   // 8 h 59 : pas encore ouvert

console.log('L’heure de Paris, pas celle du serveur');
t('un mardi à 14 h en été : ouverture', AL.regime(ETE_MARDI_14H) === 'ouverture');
t('le même mardi à 14 h en HIVER aussi — le changement d’heure ne déplace pas l’officine',
  AL.regime(HIVER_MAR_14H) === 'ouverture');
t('à 3 h du matin, été : fermeture', AL.regime(ETE_MARDI_03H) === 'fermeture');
t('à 3 h du matin, hiver : fermeture', AL.regime(HIVER_MAR_03H) === 'fermeture');
t('le samedi compte comme un jour ouvré', AL.regime(SAMEDI_14H) === 'ouverture');
t('le dimanche, non — personne ne passera', AL.regime(DIMANCHE_14H) === 'fermeture');
t('19 h 45 : l’officine est fermée', AL.regime(MARDI_19H45) === 'fermeture');
t('8 h 59 : pas encore ouverte', AL.regime(MARDI_08H59) === 'fermeture');

console.log('\nCombien de relévés avant de réveiller quelqu’un');
t('en journée, trois — une porte restée ouverte trois minutes ne doit rien déclencher',
  AL.relevesRequis(ETE_MARDI_14H) === 3);
t('la nuit, un seul', AL.relevesRequis(ETE_MARDI_03H) === 1);
t('le dimanche, un seul', AL.relevesRequis(DIMANCHE_14H) === 1);

console.log('\nL’état d’une armoire');
const P = { min: 2, max: 8 };
const MAINTENANT = U('2026-07-14T12:00:00Z');
const rel = (vals, pasMin) => vals.map((v, i) => ({
  valeur: v, ts: new Date(+MAINTENANT - i * (pasMin || 15) * 60000).toISOString() }));

t('dans la plage : rien à signaler', AL.etatPoint(rel([5.5, 5.4, 5.6]), P, MAINTENANT).etat === 'ok');
t('au-dessus : hors plage', AL.etatPoint(rel([9.2, 5.4]), P, MAINTENANT).etat === 'hors');
t('... et on dit dans quel sens', AL.etatPoint(rel([9.2, 5.4]), P, MAINTENANT).sens === 'haut');
t('EN DESSOUS aussi — à 0 °C les vaccins gèlent sans qu’aucune alarme de chaleur ne sonne',
  AL.etatPoint(rel([1.1, 5.4]), P, MAINTENANT).etat === 'hors');
t('... et le sens est le bon', AL.etatPoint(rel([1.1, 5.4]), P, MAINTENANT).sens === 'bas');
t('les consécutifs se comptent depuis le plus récent',
  AL.etatPoint(rel([9.2, 9.4, 9.1, 5.0]), P, MAINTENANT).consecutifs === 3);
t('... et s’arrêtent au premier relevé rentré dans la plage',
  AL.etatPoint(rel([9.2, 5.0, 9.1, 9.3]), P, MAINTENANT).consecutifs === 1);
t('8,0 °C pile est dans la plage', AL.etatPoint(rel([8]), P, MAINTENANT).etat === 'ok');
t('2,0 °C pile aussi', AL.etatPoint(rel([2]), P, MAINTENANT).etat === 'ok');

console.log('\nUne donnée vieille n’est pas une bonne donnée');
const vieux = [{ valeur: 5.5, ts: new Date(+MAINTENANT - 50 * 60000).toISOString() }];
t('50 minutes sans relevé : muet, jamais « bon »',
  AL.etatPoint(vieux, P, MAINTENANT).etat === 'muet');
t('... même si la dernière valeur était parfaite',
  AL.etatPoint(vieux, P, MAINTENANT).valeur === 5.5);
t('aucune mesure du tout : muet aussi', AL.etatPoint([], P, MAINTENANT).etat === 'muet');
t('une liste absente ne casse rien', AL.etatPoint(null, P, MAINTENANT).etat === 'muet');

console.log('\nLa décision — en journée');
const horsDepuis = n => AL.etatPoint(rel(Array(n).fill(9.5).concat([5])), P, MAINTENANT);
t('un seul relévé hors plage : on attend',
  AL.decider(horsDepuis(1), null, MAINTENANT, 3).action === 'rien');
t('deux : on attend encore',
  AL.decider(horsDepuis(2), null, MAINTENANT, 3).action === 'rien');
t('trois — 45 minutes : on alerte',
  AL.decider(horsDepuis(3), null, MAINTENANT, 3).action === 'ouvrir');

console.log('\nLa décision — la nuit et le dimanche');
t('dès le premier relévé', AL.decider(horsDepuis(1), null, MAINTENANT, 1).action === 'ouvrir');

console.log('\nUn défaut qui dure ne doit pas noyer le destinataire');
const epOuvert = (ilYaMs, motif) => ({
  motif: motif || 'seuil', ouvert_le: new Date(+MAINTENANT - ilYaMs).toISOString(),
  dernier_envoi_le: new Date(+MAINTENANT - ilYaMs).toISOString(), clos_le: null });
t('un quart d’heure après l’alerte : on se tait',
  AL.decider(horsDepuis(3), epOuvert(15 * 60000), MAINTENANT, 1).action === 'rien');
t('une heure après : toujours',
  AL.decider(horsDepuis(3), epOuvert(3600000), MAINTENANT, 1).action === 'rien');
t('deux heures après : on rappelle, une fois',
  AL.decider(horsDepuis(3), epOuvert(2 * 3600000 + 1000), MAINTENANT, 1).action === 'rappeler');
t('six heures de défaut ne font donc PAS vingt-quatre SMS',
  AL.decider(horsDepuis(3), epOuvert(30 * 60000), MAINTENANT, 1).action === 'rien');

console.log('\nLe retour à la normale se dit, une fois');
const bon = AL.etatPoint(rel([5.5]), P, MAINTENANT);
t('un épisode ouvert se clot', AL.decider(bon, epOuvert(3600000), MAINTENANT, 1).action === 'clore');
t('... et rien ne se reproduit ensuite',
  AL.decider(bon, { motif: 'seuil', clos_le: MAINTENANT.toISOString() }, MAINTENANT, 1).action === 'rien');
t('tout va bien, rien ne s’est passé : silence',
  AL.decider(bon, null, MAINTENANT, 1).action === 'rien');

console.log('\nLa panne du robot');
const muet = AL.etatPoint(vieux, P, MAINTENANT);
t('plus de données : on alerte, quel que soit le régime',
  AL.decider(muet, null, MAINTENANT, 3).action === 'ouvrir');
t('... et c’est bien une panne, pas un dépassement',
  AL.decider(muet, null, MAINTENANT, 3).motif === 'panne');
t('un dépassement qui devient un silence réouvre : ce n’est plus la même alerte',
  AL.decider(muet, epOuvert(60000, 'seuil'), MAINTENANT, 1).action === 'ouvrir');
t('une panne qui dure ne se répète pas toutes les 15 min',
  AL.decider(muet, epOuvert(60000, 'panne'), MAINTENANT, 1).action === 'rien');

console.log('\nLe texte du SMS');
const txtHaut = AL.texte('Frigo Vaccins', { action: 'ouvrir', motif: 'seuil', valeur: 9.44, sens: 'haut' }, P);
t('il nomme l’armoire', /Frigo Vaccins/.test(txtHaut));
t('il donne la valeur, arrondie au dixième', /9\.4 C/.test(txtHaut));
t('il dit le sens', /trop chaud/.test(txtHaut));
t('il rappelle la plage', /2-8 C/.test(txtHaut));
t('SANS ACCENT : un seul caractère hors GSM-7 ferait tomber la limite à 70',
  !/[à-ÿÀ-Ý]/.test(txtHaut));
t('... et il tient en un seul SMS', txtHaut.length <= 160);
const txtBas = AL.texte('PDA', { action: 'ouvrir', motif: 'seuil', valeur: 0.8, sens: 'bas' }, P);
t('le froid se dit aussi', /trop froid/.test(txtBas));
const txtPanne = AL.texte('Surveillance temperatures', { action: 'ouvrir', motif: 'panne', age: 47 * 60000 }, P);
t('la panne dit depuis combien de temps', /47 min/.test(txtPanne));
t('... et ce qu’elle signifie', /interrompue/i.test(txtPanne));
t('... sans accent non plus', !/[à-ÿÀ-Ý]/.test(txtPanne));
const txtFin = AL.texte('Frigo 1', { action: 'clore', motif: 'seuil', valeur: 5.5 }, P);
t('le retour à la normale est explicite', /retour dans la plage/.test(txtFin));
t('aucun texte ne porte de donnée de santé — un nom d’armoire et des degrés',
  [txtHaut, txtBas, txtPanne, txtFin].every(x => x.length <= 160));

console.log('\nLes astreintes');
const num = n => /^0[67]\d{8}$/.test(String(n).replace(/\s/g, '')) ? String(n).replace(/\s/g, '') : null;
const A = (tel, actif, nom) => ({ nom: nom || '', tel: tel, actif: actif !== false });
t('toute la liste est prévenue, pas seulement deux',
  AL.destinataires([A('0612345678'), A('0698765432'), A('0611111111'), A('0622222222')], num).length === 4);
t('une ligne décochée est mise en pause, sans perdre son numéro',
  AL.destinataires([A('0612345678'), A('0698765432', false)], num).length === 1);
t('un numéro invalide n’empêche pas les autres d’être prévenus',
  AL.destinataires([A('n’importe quoi'), A('0612345678')], num).length === 1);
t('un fixe est écarté — un SMS sur un fixe ne prévient personne',
  AL.destinataires([A('0231841200'), A('0612345678')], num).length === 1);
t('le même numéro deux fois ne fait pas deux SMS',
  AL.destinataires([A('0612345678', true, 'Olivier'), A('0612345678', true, 'Portable 2')], num).length === 1);
t('une liste vide : personne, et on le saura', AL.destinataires([], num).length === 0);
t('une liste absente ne casse rien', AL.destinataires(null, num).length === 0);

console.log('\n' + ok + ' vérifications, ' + ko + ' échec(s)\n');
process.exit(ko ? 1 : 0);
