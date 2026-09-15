// Garde-fou des accusés de remise SMS. Tout ce qui se décide ici se décide
// AVANT la base : on éprouve donc les fonctions pures, sans serveur ni réseau.
// node essais/accuses.js
const a = require('../accuses');

let ok = 0, ko = 0; const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };
console.log('\nACCUSÉS DE REMISE — ce que Brevo dit, ce qu’on en fait\n');

console.log('Traduire l’état');
t('delivered → remis', a.etatSms('delivered') === 'remis');
t('sent n’est PAS remis — Brevo a accepté, l’opérateur n’a rien confirmé',
  a.etatSms('sent') === 'en cours' && a.etatSms('accepted') === 'en cours');
t('hard_bounce → non remis', a.etatSms('hard_bounce') === 'non remis');
t('« Soft Bounce » écrit autrement est reconnu', a.etatSms('Soft Bounce') === 'non remis');
t('rejected et blacklisted → non remis',
  a.etatSms('rejected') === 'non remis' && a.etatSms('blacklisted') === 'non remis');
t('une réponse du patient n’est pas un échec', a.etatSms('replied') === 'autre');
t('un état inconnu ne devient jamais « remis »', a.etatSms('zzz') !== 'remis');
t('vide ne devient jamais « remis »', a.etatSms('') !== 'remis' && a.etatSms(null) !== 'remis');

console.log('\nRetrouver de quel envoi il s’agit');
// Le piege reel : `reference` est tantot une chaine, tantot un objet.
t('reference en objet {"1":"abc"} est lue',
  a.clesSms({ reference: { '1': 'abc' } }).indexOf('abc') !== -1);
t('reference en chaîne est lue', a.clesSms({ reference: 'abc' }).indexOf('abc') !== -1);
t('messageId numérique devient une chaîne',
  a.clesSms({ messageId: 123 }).indexOf('123') !== -1);
t('les deux clés sont gardées, pas l’une ou l’autre',
  a.clesSms({ messageId: 123, reference: 'abc' }).length === 2);
t('aucune clé -> aucun accusé exploitable', a.clesSms({}).length === 0);
t('pas de doublon si les deux coïncident',
  a.clesSms({ messageId: 'x', reference: 'x' }).length === 1);

console.log('\nLes accusés arrivent dans le désordre');
const remis = { etat: 'remis', ts: 100 };
const enCours = { etat: 'en cours', ts: 200 };
t('un premier accusé s’enregistre toujours', a.doitRemplacer(null, enCours) === true);
t('« sent » arrivé APRÈS « delivered » ne fait pas reculer la fiche',
  a.doitRemplacer(remis, enCours) === false);
t('« delivered » arrivé après « sent » avance bien',
  a.doitRemplacer({ etat: 'en cours', ts: 300 }, { etat: 'remis', ts: 100 }) === true);
t('un échec l’emporte sur un « en cours » même plus récent',
  a.doitRemplacer({ etat: 'en cours', ts: 999 }, { etat: 'non remis', ts: 1 }) === true);
t('entre deux états finaux, le plus récent gagne',
  a.doitRemplacer({ etat: 'remis', ts: 100 }, { etat: 'non remis', ts: 200 }) === true);
t('... et le plus ancien perd',
  a.doitRemplacer({ etat: 'non remis', ts: 200 }, { etat: 'remis', ts: 100 }) === false);

console.log('\nLire la charge, quelle que soit sa forme');
const un = { messageId: 1, msg_status: 'delivered', ts_event: 1728459617 };
t('un accusé seul', a.lireCharge(un).length === 1);
t('un envoi groupé (tableau)', a.lireCharge([un, un]).length === 2);
t('un envoi groupé ({events:[...]})', a.lireCharge({ events: [un] }).length === 1);
t('ce qui n’a pas de clé est écarté, pas planté', a.lireCharge({ msg_status: 'delivered' }).length === 0);
t('n’importe quoi ne fait pas tomber le serveur',
  a.lireCharge(null).length === 0 && a.lireCharge('coucou').length === 0);
t('la description et le code d’erreur sont conservés',
  /injoignable/.test(a.lireCharge({ messageId: 1, msg_status: 'hard_bounce', description: 'injoignable', error_code: 21 })[0].detail));
t('l’horodatage manquant ne vaut pas 1970',
  a.lireCharge({ messageId: 1, msg_status: 'sent' })[0].ts > 1700000000);

console.log('\nLe secret de l’en-tête');
t('le bon secret passe', a.memeSecret('abc', 'abc') === true);
t('un mauvais secret est refusé', a.memeSecret('abd', 'abc') === false);
t('une longueur différente est refusée', a.memeSecret('ab', 'abc') === false);
t('LE VIDE N’AUTHENTIFIE PAS', a.memeSecret('', '') === false);
t('absent n’authentifie pas', a.memeSecret(undefined, '') === false);

console.log('\nRetrouver le patient dans le journal des SMS');
const blob = { smsLog: [
  { smsId: 777, nom: 'DUPONT', prenom: 'Marie', source: 'livraison' },
  { smsId: null, nom: 'SANS', prenom: 'Id' }
] };
t('un envoi est retrouvé par son identifiant',
  (a.trouverEnvoi(blob, ['777']) || {}).nom === 'DUPONT');
t('un identifiant numérique côté journal, chaîne côté accusé : ça matche quand même',
  a.trouverEnvoi(blob, ['777']) !== null);
t('un identifiant inconnu ne rend rien', a.trouverEnvoi(blob, ['999']) === null);
t('un journal absent ne fait pas tomber', a.trouverEnvoi({}, ['777']) === null);

console.log('\nLe texte de la transmission');
const txt = a.texteEchec({ nom: 'DUPONT', prenom: 'Marie', source: 'livraison' },
  { brut: 'hard_bounce', etat: 'non remis', detail: 'numéro invalide' });
t('il nomme le patient', /DUPONT Marie/.test(txt));
t('il dit ce qu’il faut faire', /reprendre contact/i.test(txt));
t('il ne contient aucun nom de médicament ni contenu du message',
  !/mg\b|comprim|traitement/i.test(txt));
t('un envoi introuvable donne quand même un texte lisible',
  a.texteEchec(null, { brut: 'rejected', etat: 'non remis', detail: null }).length > 20);

console.log('\n' + ok + ' réussi(s), ' + ko + ' échec(s)\n');
process.exit(ko ? 1 : 0);
