// LE CLASSEUR DU CABINET — on part du leur, on n'en refait pas un.
// node essais/navette-fichier.js
//
// CE QUI SE JOUE. Le cabinet lit un classeur à SA mise en page : salariés en
// colonnes B à Q, rubriques en lignes, des largeurs, des fusions et des
// bordures précises. La reconstruire serait la trahir — au premier mois où une
// bordure change de place, c'est eux qui perdent du temps à chercher.
//
// On part donc de LEUR fichier. `modeles/navette-modele.xlsx` est leur classeur
// d'octobre dont on a vidé les 338 cellules variables. Générer un mois, c'est
// rouvrir ce ZIP, réécrire les valeurs dans la feuille, et refermer : tout le
// reste — styles, fusions, réglages d'impression — ressort octet pour octet.
//
// Et aucune dépendance : un .xlsx est un ZIP de XML, node sait faire les deux.
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const racine = path.join(__dirname, '..');
const nx = require(path.join(racine, 'navette-xlsx.js'));
const GABARIT = fs.readFileSync(path.join(racine, 'modeles', 'navette-modele.xlsx'));

let ok = 0, ko = 0;
const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };
console.log('\nLE CLASSEUR DU CABINET\n');

// ── Le conteneur ZIP ────────────────────────────────────────────────────────
console.log('Le ZIP se relit après avoir été réécrit');
const entrees = nx.lireZip(GABARIT);
t('le gabarit contient ses treize entrées', entrees.length === 13);
t('la feuille de calcul en fait partie',
  entrees.some(e => e.nom === 'xl/worksheets/sheet1.xml'));
const refait = nx.lireZip(nx.ecrireZip(entrees));
t('RÉÉCRIT PUIS RELU, RIEN NE MANQUE', refait.length === entrees.length);
t('... et chaque entrée est identique à l’octet près',
  entrees.every(function (e, i) {
    return refait[i].nom === e.nom && Buffer.compare(refait[i].contenu, e.contenu) === 0;
  }));
// Le CRC32 est ce qui fait accepter ou rejeter l'archive. Une table fausse
// produit un fichier que Windows ouvre et qu'Excel refuse.
t('le CRC32 est celui de la norme',
  nx.crc32(Buffer.from('123456789')) === 0xCBF43926);
t('... et celui d’une chaîne vide aussi', nx.crc32(Buffer.alloc(0)) === 0);

// ── Le remplissage ──────────────────────────────────────────────────────────
console.log('\nLes valeurs vont dans les cases que le cabinet a prévues');
const SORTIE = nx.remplir(GABARIT, {
  mois: '2026-11',
  colonnes: [
    { nom: 'BAGUELIN ALEXIS', contract: 151.67, t125: 4, cpDu: '13/10/2026', cpAu: '15/10/2026' },
    { nom: 'BOURDON CELINE', contract: 151.67, t125: 3.5,
      cpDu: '06/10/2026 et 27/10/2026', cpAu: '10/10/2026 et 28/10/2026', primes: '106 euros' },
    { nom: 'PETIT PALOMA', contract: 117, c10: 2.7, cPlus: 0.3, t125: 0 }
  ],
  etudiants: 'Lise Tison : 45 heures'
});
const feuille = nx.lireZip(SORTIE).find(e => e.nom === 'xl/worksheets/sheet1.xml').contenu.toString('utf8');
const cell = (ref) => {
  const i = feuille.indexOf('<c r="' + ref + '"');
  if (i < 0) return null;
  const t0 = feuille.indexOf('>', i);
  const f = feuille[t0 - 1] === '/' ? t0 + 1 : feuille.indexOf('</c>', t0) + 4;
  const bloc = feuille.slice(i, f);
  const txt = /<t[^>]*>([\s\S]*?)<\/t>/.exec(bloc);
  if (txt) return txt[1];
  const v = /<v>([^<]*)<\/v>/.exec(bloc);
  return v ? v[1] : '';
};
t('le mois s’écrit en toutes lettres', cell('B4') === 'NOVEMBRE' && cell('C4') === '2026');
t('les salariés occupent les colonnes, de gauche à droite',
  cell('B7') === 'BAGUELIN ALEXIS' && cell('C7') === 'BOURDON CELINE' && cell('D7') === 'PETIT PALOMA');
t('les heures contractuelles sont sur la ligne 8',
  cell('B8') === '151.67' && cell('D8') === '117');
t('LES 125 % SONT SUR LA LIGNE DU CABINET, la onzième',
  cell('B11') === '4' && cell('C11') === '3.5');
t('les complémentaires d’un temps partiel sur les lignes 9 et 10',
  cell('D9') === '2.7' && cell('D10') === '0.3');
t('UN TEMPS PARTIEL N’ÉCRIT RIEN SUR LA LIGNE DES HEURES SUP', cell('D11') === '');
t('les congés : les débuts ligne 14, les fins ligne 15',
  cell('B14') === '13/10/2026' && cell('B15') === '15/10/2026');
t('DEUX PÉRIODES TIENNENT SUR LES MÊMES LIGNES',
  cell('C14') === '06/10/2026 et 27/10/2026' && cell('C15') === '10/10/2026 et 28/10/2026');
t('les primes restent sur leur ligne', cell('C22') === '106 euros');
t('les étudiants sont nommés en bas', cell('B27') === 'Lise Tison : 45 heures');
// UN ZERO NE S'ECRIT PAS : une case vide se lit mieux qu'une colonne de zeros,
// et c'est ainsi que le cabinet remplit la sienne.
t('UN ZÉRO LAISSE LA CASE VIDE', cell('B12') === '' && cell('B9') === '');
t('... et les colonnes sans salarié restent vides',
  cell('E7') === '' && cell('Q7') === '' && cell('Q8') === '');

// ── Ce qui ne doit pas bouger ───────────────────────────────────────────────
console.log('\nTout le reste du classeur ressort intact');
const avant = nx.lireZip(GABARIT), apres = nx.lireZip(SORTIE);
const changees = apres.filter(function (e, i) {
  return Buffer.compare(e.contenu, avant[i].contenu) !== 0;
}).map(e => e.nom);
t('UNE SEULE ENTRÉE EST MODIFIÉE : la feuille',
  changees.length === 1 && changees[0] === 'xl/worksheets/sheet1.xml');
t('les styles ne sont pas touchés', !changees.includes('xl/styles.xml'));
t('LES CHAÎNES PARTAGÉES NON PLUS — y toucher décalerait des libellés qu’on n’écrit pas',
  !changees.includes('xl/sharedStrings.xml') && /t="inlineStr"/.test(feuille));
t('les réglages d’impression suivent', !changees.includes('xl/printerSettings/printerSettings1.bin'));
t('les fusions du cabinet sont conservées',
  /C21:Q21/.test(feuille) && /C16:Q16/.test(feuille) && /A13:Q13/.test(feuille));
// Les intitules du cabinet vivent dans sharedStrings, qu'on ne touche pas.
// Ce sont eux qui portent la regle : « au dela de 35h00 et jusqu'a la 43eme
// heure par semaine ». S'ils bougeaient, la navette ne dirait plus la meme
// chose que le calcul du module.
const CHAINES = avant.find(e => e.nom === 'xl/sharedStrings.xml').contenu.toString('utf8');
t('LES INTITULÉS DU CABINET SONT INTACTS — ce sont eux qui portent la règle',
  CHAINES.indexOf('43\u00e8me heure par semaine') > 0
  && CHAINES.indexOf('Navette pour les salaires') > 0
  && CHAINES.indexOf('Temps partiel') > 0);
t('le style de chaque case écrite est conservé',
  /<c r="B8" s="\d+"><v>151.67<\/v><\/c>/.test(feuille));

// ── Les refus ───────────────────────────────────────────────────────────────
console.log('\nCe que le générateur refuse de produire');
// PLUS DE SEIZE SALARIES NE RENTRENT PAS : le classeur s'arrete a la colonne Q.
// Mieux vaut un refus qu'un fichier amputé en silence.
const trop = { mois: '2026-11', colonnes: [] };
for (let i = 0; i < 17; i++) trop.colonnes.push({ nom: 'SALARIE ' + i, contract: 151.67 });
let refus = null;
try { nx.remplir(GABARIT, trop); } catch (e) { refus = String(e.message); }
t('DIX-SEPT SALARIÉS NE PASSENT PAS EN SILENCE', refus !== null);
t('... et le message dit quoi faire', /colonne de plus/.test(refus || ''));
t('seize passent', nx.remplir(GABARIT, {
  mois: '2026-11',
  colonnes: trop.colonnes.slice(0, 16)
}).length > 1000);

// ── Le fichier est valide ──────────────────────────────────────────────────
console.log('\nLe fichier produit est un classeur valide');
t('il commence par la signature d’un ZIP',
  SORTIE[0] === 0x50 && SORTIE[1] === 0x4B && SORTIE[2] === 0x03 && SORTIE[3] === 0x04);
t('toutes ses entrées se décompressent', (function () {
  try { nx.lireZip(SORTIE).forEach(e => e.contenu.length); return true; } catch (e) { return false; }
})());
t('ses XML sont bien formés', (function () {
  // Pas d'analyseur XML dans node : on vérifie l'équilibre des balises de la
  // feuille, qui est la seule qu'on réécrit.
  const o = (feuille.match(/<c /g) || []).length;
  const f = (feuille.match(/<\/c>/g) || []).length + (feuille.match(/\/>/g) || []).length;
  return o > 300 && f >= o && feuille.indexOf('</worksheet>') > 0;
})());
t('et il porte le nom que le cabinet attend',
  /mois \+ ' NAVETTE SALAIRES-PHARMACIE FERRAN\.xlsx'/.test(
    fs.readFileSync(path.join(racine, 'server.js'), 'utf8')));

console.log('\n' + ok + ' vérifications, ' + ko + ' échec(s)\n');
process.exit(ko ? 1 : 0);
