// Le lien nominatif : demander un document a un patient par SMS. Ce qui se
// joue ici : le message doit tenir en UN segment GSM-7 avec un lien de 63
// caracteres, ne jamais nommer autre chose que ce qu'on a demande, et le
// jeton doit avoir la forme que depots.js accepte. Les fonctions sont
// extraites de public/od-module.js et de public/index.html eux-memes.
// node essais/demande-document.js
const fs = require('fs'), path = require('path');
const od = fs.readFileSync(path.join(__dirname, '..', 'public', 'od-module.js'), 'utf8');
const ix = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const D = require('../depots');

// ── Extraction ──────────────────────────────────────────────────────────────
// Deux formes dans le depot : la declaration sur une ligne, et le bloc qui se
// termine par une accolade en colonne 3. Chercher la seconde sur la premiere
// avalerait la fonction suivante.
function extraire(src, nom, indent) {
  const i = indent || '  ';
  const d = src.indexOf('\n' + i + 'function ' + nom + '(');
  if (d < 0) throw new Error('introuvable : ' + nom);
  const une = new RegExp('^' + i + 'function ' + nom + '\\([^)]*\\) \\{.*\\}$', 'm');
  const ligne = src.slice(d + 1).split('\n')[0];
  if (une.test(ligne)) return ligne;
  const f = src.indexOf('\n' + i + '}\n', d);
  if (f < 0) throw new Error('fin introuvable : ' + nom);
  return src.slice(d + 1, f + i.length + 3);
}
function constante(src, nom) {
  const m = new RegExp('^  const ' + nom + ' = \\{[\\s\\S]*?\\n  \\};$', 'm').exec(src);
  if (!m) throw new Error('introuvable : ' + nom);
  return m[0];
}

// Le compteur de segments de l'application, pour ne pas en ecrire un second.
eval(/const SMS_GSM7='.*?';/s.exec(ix)[0].replace('const', 'var'));
eval(/const SMS_GSM7_EXT='.*?';/.exec(ix)[0].replace('const', 'var'));
eval((function () {
  const d = ix.indexOf('function smsSegments(');
  return ix.slice(d, ix.indexOf('\n}', d) + 2);
}()));

const OD_JOURS = 7;
eval(constante(od, 'OD_MOTIFS').replace('const', 'var'));
eval(extraire(od, 'odAscii'));
eval(extraire(od, 'odTexteSms'));
eval(extraire(od, 'odMemeCible'));
eval(extraire(od, 'odDemandes'));

// odJetonNeuf s'appuie sur le navigateur : on lui prete ce qu'il attend.
global.window = { crypto: { getRandomValues: a => { for (let i = 0; i < a.length; i++) a[i] = (i * 37 + 11) % 256; return a; } } };
global.btoa = b => Buffer.from(b, 'binary').toString('base64');
eval(extraire(od, 'odJetonNeuf'));

// ── Les essais ──────────────────────────────────────────────────────────────
let ok = 0, ko = 0;
const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };
console.log('\nDEMANDER UN DOCUMENT — le lien nominatif envoyé par SMS\n');

// ── Le jeton ────────────────────────────────────────────────────────────────
console.log('Le jeton fabriqué par le poste');
const jet = odJetonNeuf();
t('il fait 22 caractères, comme celui du serveur', jet.length === 22);
t('il a la forme que depots.js accepte', D.jetonValide(jet));
t('... et il n’a aucun caractère à échapper dans une adresse', /^[A-Za-z0-9_-]+$/.test(jet));

// ── Le message ──────────────────────────────────────────────────────────────
console.log('\nLe SMS — un seul segment, quoi qu’il arrive');
const LIEN = 'https://pilot.pharmacie-mondeville.fr/o/' + jet;
t('le lien pèse 62 caractères sur les 160 du segment', LIEN.length === 62);

const PRENOMS = ['Marie', 'Jean-Baptiste', 'Anne-Charlotte', 'Éloïse', 'Ana', '',
                 'Maximilienne-Gabrielle'];
let tousUnSegment = true, aucunAccent = true;
Object.keys(OD_MOTIFS).forEach(function (m) {
  PRENOMS.forEach(function (p) {
    const txt = odTexteSms(m, p, LIEN);
    const s = smsSegments(txt);
    if (s.parts !== 1) { tousUnSegment = false; console.log('    ' + m + '/' + p + ' → ' + s.len); }
    if (s.uni) aucunAccent = false;
  });
});
t('les trois motifs tiennent en un segment, pour sept prénoms dont deux très longs', tousUnSegment);
t('aucun ne bascule en Unicode — donc jamais 70 caractères au lieu de 160', aucunAccent);

t('un prénom accentué est ramené à l’alphabet latin simple',
  odTexteSms('document', 'Éloïse', LIEN).indexOf('Eloise') > 0);
t('un prénom trop long est abandonné plutôt que de payer un second crédit',
  odTexteSms('document', 'Maximilienne-Gabrielle', LIEN).indexOf('Bonjour,') === 0);
t('... alors qu’un prénom court est bien utilisé',
  odTexteSms('document', 'Marie', LIEN).indexOf('Bonjour Marie,') === 0);
t('sans prénom, le message reste correct',
  odTexteSms('document', '', LIEN).indexOf('Bonjour,') === 0);

console.log('\nCe que le message ne dit pas');
const tous = Object.keys(OD_MOTIFS).map(m => odTexteSms(m, 'Marie', LIEN)).join(' ').toLowerCase();
['compte rendu', 'examen', 'analyse', 'resultat', 'biologie', 'specialiste', 'traitement']
  .forEach(function (mot) { if (tous.indexOf(mot) >= 0) { ko++; console.log('  ✗ le mot « ' + mot + ' » apparaît'); } });
t('aucun message ne nomme un examen, un résultat ou un traitement', true);
t('le motif « document » ne nomme rien du tout',
  odTexteSms('document', 'Marie', LIEN).indexOf('document') > 0);
t('un motif inconnu retombe sur le message neutre',
  odTexteSms('n’importe quoi', 'Marie', LIEN) === odTexteSms('document', 'Marie', LIEN));
t('le lien est dans le message', odTexteSms('ordonnance', 'Marie', LIEN).indexOf(LIEN) > 0);

// ── La demande en cours ─────────────────────────────────────────────────────
console.log('\nUne seule demande vivante à la fois');
const N = Date.now(), J = 86400000;
const LOT = [
  { id: 1, jeton: 'a'.repeat(22), cible: { type: 'location', ref: 5 }, demandeLe: N - 3600e3, expireLe: N + 5 * J },
  { id: 2, jeton: 'b'.repeat(22), cible: { type: 'location', ref: 9 }, demandeLe: N - 7200e3, expireLe: N - J },  // expirée
  { id: 3, jeton: 'c'.repeat(22), cible: { type: 'patient', ref: 3 },  demandeLe: N - 60e3,   expireLe: N + 6 * J, recuLe: N }, // déjà servie
  { id: 4, jeton: 'd'.repeat(22), cible: { type: 'patient', ref: 4 },  demandeLe: N - 10e3,   expireLe: N + 6 * J },
  { id: 5, ts: N, recuLe: N, fichiers: [{}] }                                                  // un dépôt ordinaire
];
const enCours = odDemandes(LOT);
t('une demande servie n’est plus en attente', !enCours.some(d => d.id === 3));
t('une demande expirée non plus', !enCours.some(d => d.id === 2));
t('un dépôt ordinaire n’est pas une demande', !enCours.some(d => d.id === 5));
t('il reste les deux demandes vivantes', enCours.length === 2);
t('la plus récente est en tête', enCours[0].id === 4);

console.log('\nLa cible');
t('deux références identiques sont la même cible',
  odMemeCible({ type: 'location', ref: 5 }, { type: 'location', ref: '5' }));
t('deux types différents ne le sont pas',
  !odMemeCible({ type: 'location', ref: 5 }, { type: 'patient', ref: 5 }));
t('une cible absente ne correspond à rien',
  !odMemeCible(null, { type: 'location', ref: 5 }) && !odMemeCible({ type: 'location', ref: 5 }, null));

console.log('\n' + (ok + ko) + ' vérifications, ' + ko + ' échec(s)\n');
process.exit(ko ? 1 : 0);
