// LE DOMAINE PATIENT — un seul nom pour tout ce qu'on leur envoie.
// node essais/domaine-patient.js
//
// CE QUI SE JOUE. Trois choses partent par SMS vers des patients : la
// confirmation de renouvellement (/r/), la demande de document (/o/) et
// l'affiche du moment (/offre). Elles vivent dans la MÊME application, qui
// répond par chemin et non par nom d'hôte : un seul domaine les porte toutes.
//
// Le nom de ce domaine a changé — « renouvellement » ne disait plus ce qu'il
// portait, « client » le dit. Un renommage est exactement le genre de geste qui
// coupe des liens sans bruit, et ce fichier garde les trois endroits où ça
// pourrait arriver :
//
//   1. LA VARIABLE. L'ancienne (`RENOUV_BASE_URL`) doit continuer de servir
//      tant qu'elle est seule définie. Sinon, entre le déploiement et le
//      réglage de la nouvelle, les liens repartent sur le back-office.
//   2. LES POSTES. Ils ne sont pas tous sur la même version et restent ouverts
//      des journées entières : `/api/config` doit livrer l'ancienne clef ET la
//      nouvelle, et les modules doivent lire les deux.
//   3. LE CODE. Aucun domaine écrit en dur : il se règle hors du code, et un
//      nom gelé dans une ligne survivrait à tous les réglages.
const fs = require('fs'), path = require('path');
const of = require('../offres');

const lire = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let ok = 0, ko = 0;
const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };

console.log('\nLE DOMAINE PATIENT — un seul nom\n');

// ── La lecture d'une adresse, en un seul endroit ────────────────────────────
console.log('Lire une adresse de domaine');
t('la barre finale est ôtée — sans quoi le lien porterait un double slash',
  of.adressePublique('https://client.pharmacie-mondeville.fr/') === 'https://client.pharmacie-mondeville.fr');
t('les espaces autour ne gênent pas — on colle souvent depuis un courriel',
  of.adressePublique('  https://client.pharmacie-mondeville.fr  ') === 'https://client.pharmacie-mondeville.fr');
t('SANS PROTOCOLE, ON REFUSE plutôt que de servir un lien de travers',
  of.adressePublique('client.pharmacie-mondeville.fr') === null);
t('vide ou absente, c’est non', of.adressePublique('') === null && of.adressePublique(null) === null);

const sv = lire('server.js');
console.log('\nLa règle n’est écrite qu’une fois');
t('server.js ne réimplémente pas la lecture, il appelle offres.adressePublique',
  /offres\.adressePublique\(process\.env\.PUBLIC_BASE_URL\)/.test(sv));

// ── L'ordre des variables ───────────────────────────────────────────────────
console.log('\nRenommer une variable ne coupe pas les liens');
const bloc = (function () {
  const i = sv.indexOf('function basePatients()');
  return sv.slice(i, sv.indexOf('\n}', i));
}());
t('la nouvelle variable est lue', /PUBLIC_BASE_URL/.test(bloc));
t('L’ANCIENNE AUSSI', /RENOUV_BASE_URL/.test(bloc));
t('... et la nouvelle passe devant',
  bloc.indexOf('PUBLIC_BASE_URL') < bloc.indexOf('RENOUV_BASE_URL'));
t('aucune des deux n’étant définie, on rend null et non une adresse inventée',
  /\|\|\s*null;/.test(bloc));

// Le même ordre, vérifié en marche sur la règle partagée.
const ordre = (pub, anc) => of.adressePublique(pub) || of.adressePublique(anc) || null;
t('réglée seule, l’ancienne sert encore',
  ordre(undefined, 'https://renouvellement.pharmacie-mondeville.fr')
  === 'https://renouvellement.pharmacie-mondeville.fr');
t('LES DEUX RÉGLÉES, LA NOUVELLE GAGNE — c’est ce qui permet de basculer',
  ordre('https://client.pharmacie-mondeville.fr', 'https://renouvellement.pharmacie-mondeville.fr')
  === 'https://client.pharmacie-mondeville.fr');
t('une nouvelle mal écrite ne fait pas taire l’ancienne',
  ordre('client.pharmacie-mondeville.fr', 'https://renouvellement.pharmacie-mondeville.fr')
  === 'https://renouvellement.pharmacie-mondeville.fr');

// ── Les postes d'hier ───────────────────────────────────────────────────────
console.log('\nUn poste ouvert depuis ce matin continue de marcher');
const cfg = sv.slice(sv.indexOf("app.get('/api/config'"), sv.indexOf("app.get('/api/config'") + 900);
t('/api/config livre la nouvelle clef', /basePatients:\s*basePatients\(\)/.test(cfg));
t('... ET L’ANCIENNE, avec la même valeur', /renouvBase:\s*basePatients\(\)/.test(cfg));

[['public/rn-module.js', 'renouvellements'], ['public/od-module.js', 'dépôt d’ordonnance']].forEach(function (x) {
  const m = lire(x[0]);
  t('le module ' + x[1] + ' lit la nouvelle clef', /c\.basePatients/.test(m));
  t('... et retombe sur l’ancienne', /c\.basePatients\s*\|\|\s*c\.renouvBase/.test(m));
});

// ── Aucun domaine gelé dans le code ─────────────────────────────────────────
//
// On cherche un nom d'hôte patient écrit en dur dans un fichier qui CONSTRUIT
// des liens. Les adresses de courriel (contact@…) et l'adresse du back-office
// dans la documentation ne comptent pas : ce qu'on traque, c'est un sous-domaine
// qui survivrait à tous les réglages.
console.log('\nLe domaine ne vit pas dans le code');
const FICHIERS = ['server.js', 'offres.js', 'depots.js', 'public/rn-module.js',
                  'public/od-module.js', 'public/of-module.js'];
const EN_DUR = /https?:\/\/[a-z0-9-]+\.pharmacie-mondeville\.fr/gi;
const coupables = [];
FICHIERS.forEach(function (f) {
  lire(f).split('\n').forEach(function (l, i) {
    const nu = l.replace(/\s+/g, ' ').trim();
    if (/^(\/\/|\*|\/\*)/.test(nu)) return;          // un commentaire peut citer un exemple
    const m = nu.match(EN_DUR);
    if (m) coupables.push(f + ':' + (i + 1) + ' → ' + m[0]);
  });
});
t('AUCUN sous-domaine écrit en dur hors commentaire'
  + (coupables.length ? ' — trouvés : ' + coupables.join(', ') : ''),
  coupables.length === 0);

console.log('\nL’affiche se range derrière, elle n’ouvre pas un domaine de plus');
t('sans réglage propre, elle suit le domaine patient',
  of.diffusion('https://client.pharmacie-mondeville.fr') === 'https://client.pharmacie-mondeville.fr');
t('server.js lui transmet bien ce domaine',
  /basePatients:\s*\(\)\s*=>\s*basePatients\(\)/.test(sv));

const exp = lire('EXPLOITATION.md');
console.log('\nLe manuel d’exploitation dit ce qui est vrai');
t('il nomme la nouvelle variable', /PUBLIC_BASE_URL/.test(exp));
t('... et dit que l’ancienne est encore lue', /RENOUV_BASE_URL/.test(exp) && /[Aa]ncien nom/.test(exp));

console.log('\n' + ok + ' vérifications, ' + ko + ' échec(s)\n');
process.exit(ko ? 1 : 0);
