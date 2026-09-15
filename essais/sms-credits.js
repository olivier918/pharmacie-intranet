// Garde-fou du compteur de credits SMS. Les deux fonctions sont extraites de
// server.js lui-meme : c'est le code reel qui est eprouve, pas une copie.
// node essais/sms-credits.js
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
function extraire(nom) {
  const d = src.indexOf('function ' + nom + '(');
  if (d < 0) throw new Error('fonction introuvable : ' + nom);
  const f = src.indexOf('\n}\n', d);
  return src.slice(d, f + 3);
}
eval(extraire('extraireSoldeSms'));
eval(extraire('niveauSms'));

let ok = 0, ko = 0; const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };
console.log('\nCRÉDITS SMS — lire Brevo, et décider quoi montrer\n');

console.log('Ce que Brevo répond');
// Forme reelle : un tableau `plan` qui melange les natures.
const reel = { email: 'x@y.fr', plan: [
  { type: 'free', credits: 300, creditsType: 'sendLimit' },
  { type: 'sms', credits: 312, creditsType: 'send' }
] };
t('le solde SMS est extrait du tableau des plans', extraireSoldeSms(reel) === 312);
t('les crédits e-mail ne sont pas comptés', extraireSoldeSms(reel) !== 612);
t('deux packs SMS s’additionnent',
  extraireSoldeSms({ plan: [{ type: 'sms', credits: 100 }, { type: 'sms', credits: 25 }] }) === 125);
t('la casse du type ne gêne pas', extraireSoldeSms({ plan: [{ type: 'SMS', credits: 40 }] }) === 40);
t('un solde fractionnaire passe', extraireSoldeSms({ plan: [{ type: 'sms', credits: 12.5 }] }) === 12.5);
t('un solde à zéro est un ZÉRO, pas une absence',
  extraireSoldeSms({ plan: [{ type: 'sms', credits: 0 }] }) === 0);

console.log('\nCe qui ne doit pas être pris pour un solde');
t('aucun plan SMS -> inconnu', extraireSoldeSms({ plan: [{ type: 'free', credits: 300 }] }) === null);
t('tableau vide -> inconnu', extraireSoldeSms({ plan: [] }) === null);
t('pas de tableau -> inconnu', extraireSoldeSms({}) === null);
t('reponse absente -> inconnu', extraireSoldeSms(null) === null);
t('une entrée SMS illisible n’est pas un solde de zéro',
  extraireSoldeSms({ plan: [{ type: 'sms', credits: 'beaucoup' }] }) === null);
t('... ni une entrée à null (Number(null) vaut 0, le piège est là)',
  extraireSoldeSms({ plan: [{ type: 'sms', credits: null }] }) === null);
t('... ni une entrée vide', extraireSoldeSms({ plan: [{ type: 'sms', credits: '' }] }) === null);
t('un vrai zéro reste un zéro à côté d’une entrée illisible',
  extraireSoldeSms({ plan: [{ type: 'sms', credits: 0 }, { type: 'sms', credits: null }] }) === 0);

console.log('\nLe seuil — « en dessous de 50 »');
t('312 crédits : rien à signaler', niveauSms(312, 50) === 'ok');
t('50 pile : ce n’est pas EN DESSOUS de 50', niveauSms(50, 50) === 'ok');
t('49 : alerte', niveauSms(49, 50) === 'bas');
t('1 : alerte', niveauSms(1, 50) === 'bas');
t('0 : plus rien ne part', niveauSms(0, 50) === 'vide');
t('un seuil différent est respecté', niveauSms(80, 100) === 'bas' && niveauSms(120, 100) === 'ok');

console.log('\nCe que « je ne sais pas » ne doit JAMAIS devenir');
// Le piege qui ferait crier au loup : une panne reseau affichee comme un
// solde epuise. L'equipe apprendrait a ignorer le bandeau rouge, et le jour
// ou il dit vrai plus personne ne le lirait.
t('solde inconnu n’est pas un solde vide', niveauSms(null, 50) === 'inconnu');
t('... même chose pour undefined', niveauSms(undefined, 50) === 'inconnu');
t('... et pour une valeur illisible', niveauSms('?', 50) === 'inconnu');
t('un solde négatif ne se déguise pas en « ok »', niveauSms(-3, 50) === 'vide');

console.log('\n' + ok + ' réussi(s), ' + ko + ' échec(s)\n');
process.exit(ko ? 1 : 0);
