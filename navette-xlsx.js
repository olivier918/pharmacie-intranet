/* ════════════════════════════════════════════════════════════════════════════
   NAVETTE DES SALAIRES — écriture du fichier du cabinet

   Le cabinet comptable lit un classeur à SA mise en page : salariés en
   colonnes B à Q, rubriques en lignes, des largeurs et des fusions précises.
   La reconstruire serait la trahir — au premier mois où une bordure change de
   place, c'est eux qui perdent du temps.

   ON PART DONC DE LEUR FICHIER. `modeles/navette-modele.xlsx` est leur classeur
   d'octobre dont on a vidé les 338 cellules variables : les intitulés, les
   styles, les fusions, jusqu'aux réglages d'impression sont intacts, octet pour
   octet. Générer un mois, c'est rouvrir ce ZIP, réécrire les valeurs dans
   `xl/worksheets/sheet1.xml`, et refermer.

   AUCUNE DEPENDANCE. Un .xlsx est un ZIP de XML, et node sait faire les deux :
   `zlib` pour la compression, une trentaine de lignes pour le conteneur. Ce
   dépôt a deux dépendances en tout, et ce n'est pas un décompte d'heures
   mensuel qui doit en ajouter une troisième.
   ════════════════════════════════════════════════════════════════════════════ */
'use strict';
const zlib = require('zlib');

// ── CRC32, exigé par le format ZIP ─────────────────────────────────────────
const CRC_TABLE = (function () {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// ── Lecture d'un ZIP ───────────────────────────────────────────────────────
// On passe par le RÉPERTOIRE CENTRAL, pas par les en-têtes locaux : c'est lui
// qui fait foi, et lui seul porte les tailles quand un en-tête local les
// renvoie à un descripteur placé après les données.
function lireZip(buf) {
  let fin = buf.length - 22;
  while (fin >= 0 && buf.readUInt32LE(fin) !== 0x06054b50) fin--;
  if (fin < 0) throw new Error('ZIP : répertoire central introuvable');
  const nb = buf.readUInt16LE(fin + 10);
  let p = buf.readUInt32LE(fin + 16);
  const out = [];
  for (let i = 0; i < nb; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP : entrée ' + i + ' illisible');
    const methode = buf.readUInt16LE(p + 10);
    const lnom = buf.readUInt16LE(p + 28), lex = buf.readUInt16LE(p + 30), lcom = buf.readUInt16LE(p + 32);
    const taille = buf.readUInt32LE(p + 20);          // compressée
    const offset = buf.readUInt32LE(p + 42);
    const nom = buf.toString('utf8', p + 46, p + 46 + lnom);
    // en-tête local : ses propres longueurs de nom et d'extra, qui diffèrent
    const lnomL = buf.readUInt16LE(offset + 26), lexL = buf.readUInt16LE(offset + 28);
    const deb = offset + 30 + lnomL + lexL;
    const brut = buf.slice(deb, deb + taille);
    out.push({ nom: nom, contenu: methode === 8 ? zlib.inflateRawSync(brut) : brut });
    p += 46 + lnom + lex + lcom;
  }
  return out;
}

// ── Écriture d'un ZIP ──────────────────────────────────────────────────────
function ecrireZip(entrees) {
  const locaux = [], centraux = [];
  let offset = 0;
  entrees.forEach(function (e) {
    const nom = Buffer.from(e.nom, 'utf8');
    const brut = Buffer.isBuffer(e.contenu) ? e.contenu : Buffer.from(e.contenu, 'utf8');
    const comp = zlib.deflateRawSync(brut, { level: 9 });
    const crc = crc32(brut);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6);
    h.writeUInt16LE(8, 8);                                   // deflate
    h.writeUInt16LE(0, 10); h.writeUInt16LE(0x21, 12);       // date neutre : 1980-01-01
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(brut.length, 22);
    h.writeUInt16LE(nom.length, 26); h.writeUInt16LE(0, 28);
    locaux.push(h, nom, comp);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt16LE(0, 12); c.writeUInt16LE(0x21, 14);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(brut.length, 24);
    c.writeUInt16LE(nom.length, 28); c.writeUInt32LE(offset, 42);
    centraux.push(c, nom);
    offset += 30 + nom.length + comp.length;
  });
  const central = Buffer.concat(centraux);
  const q = Buffer.alloc(22);
  q.writeUInt32LE(0x06054b50, 0);
  q.writeUInt16LE(entrees.length, 8); q.writeUInt16LE(entrees.length, 10);
  q.writeUInt32LE(central.length, 12); q.writeUInt32LE(offset, 16);
  return Buffer.concat([Buffer.concat(locaux), central, q]);
}

// ── Écriture d'une cellule ─────────────────────────────────────────────────
function echapper(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
// LE STYLE DE LA CELLULE EST CONSERVÉ. C'est lui qui porte la bordure, la
// police et le format de nombre voulus par le cabinet : on remplace la valeur,
// jamais l'habillage.
function ecrireCellule(xml, ref, valeur) {
  const i = xml.indexOf('<c r="' + ref + '"');
  if (i < 0) return xml;                       // cellule absente du gabarit
  const t = xml.indexOf('>', i);
  const fin = xml[t - 1] === '/' ? t + 1 : xml.indexOf('</c>', t) + 4;
  const ouvrante = xml.slice(i, t + 1);
  const st = /\ss="(\d+)"/.exec(ouvrante);
  const style = st ? ' s="' + st[1] + '"' : '';
  let neuf;
  if (valeur == null || valeur === '') {
    neuf = '<c r="' + ref + '"' + style + '/>';
  } else if (typeof valeur === 'number' && isFinite(valeur)) {
    neuf = '<c r="' + ref + '"' + style + '><v>' + valeur + '</v></c>';
  } else {
    // Chaîne EN LIGNE : on ne touche pas à sharedStrings.xml, dont les index
    // sont partagés par toute la feuille. Une insertion là-dedans décalerait
    // silencieusement des libellés qu'on n'a pas écrits.
    neuf = '<c r="' + ref + '"' + style + ' t="inlineStr"><is><t xml:space="preserve">'
      + echapper(valeur) + '</t></is></c>';
  }
  return xml.slice(0, i) + neuf + xml.slice(fin);
}

// ── La carte des lignes, telle que le cabinet l'a écrite ───────────────────
const LIGNES = {
  contract: 8,     // heures contractuelles
  c10:      9,     // temps partiel — complémentaires jusqu'à 10 %
  cPlus:   10,     // temps partiel — complémentaires au-delà de 10 %
  t125:    11,     // temps complet — supplémentaires à 125 %
  t150:    12,     // temps complet — supplémentaires à 150 %
  cpDu:    14,     // congés payés : premier jour d'absence
  cpAu:    15,     // congés payés : veille du retour
  mal:     17,     // maladie
  autorisees: 18,
  nonJustifiees: 19,
  autres:  20,
  primes:  22,
  frais:   23,
  acompte: 24,
  epargne: 25
};
const COLONNES = ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q'];
const MOIS_FR = ['JANVIER', 'FEVRIER', 'MARS', 'AVRIL', 'MAI', 'JUIN', 'JUILLET',
                 'AOUT', 'SEPTEMBRE', 'OCTOBRE', 'NOVEMBRE', 'DECEMBRE'];

// ── Des colonnes au-delà de Q ──────────────────────────────────
// Leur classeur s'arrête à la colonne Q : seize salariés. Nous en déclarons
// autant que nous en employons, et ce n'est pas au cabinet de nous redessiner
// une colonne chaque fois qu'on embauche. On PROLONGE donc la feuille, et
// chaque colonne neuve est une COPIE DE Q : le style de chaque cellule, ligne
// par ligne, la largeur, les bandeaux fusionnés qui courent jusqu'au bord, la
// plage de la feuille. Rien n'est inventé — on duplique la dernière colonne
// que le cabinet a dessinée, celle qui porte déjà toutes ses bordures.
function lettre(n) {                      // 1 → A, 17 → Q, 27 → AA
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - r - 1) / 26; }
  return s;
}
function etendre(xml, nb) {
  const dernierPrevu = COLONNES.length + 1;        // 17, la colonne Q
  const dernier = nb + 1;                          // la dernière colonne qu'il nous faut
  if (dernier <= dernierPrevu) return { xml: xml, colonnes: COLONNES.slice() };
  const modele = lettre(dernierPrevu), bord = lettre(dernier);
  const neuves = [];
  for (let i = dernierPrevu + 1; i <= dernier; i++) neuves.push(lettre(i));

  // 1. Les cellules. Dans chaque ligne, on recopie celle de Q, avec son style.
  xml = xml.replace(/<row [^>]*>[\s\S]*?<\/row>/g, function (ligne) {
    const r = /<row r="(\d+)"/.exec(ligne);
    if (!r) return ligne;
    const num = r[1];
    let out = ligne.replace(/spans="(\d+):\d+"/, 'spans="$1:' + dernier + '"');
    const i = out.indexOf('<c r="' + modele + num + '"');
    if (i < 0) return out;                         // ligne qui n'allait pas jusqu'à Q
    const t = out.indexOf('>', i);
    const fin = out[t - 1] === '/' ? t + 1 : out.indexOf('</c>', t) + 4;
    const st = /\ss="(\d+)"/.exec(out.slice(i, t + 1));
    const style = st ? ' s="' + st[1] + '"' : '';
    const ajout = neuves.map(function (c) { return '<c r="' + c + num + '"' + style + '/>'; }).join('');
    return out.slice(0, fin) + ajout + out.slice(fin);
  });

  // 2. La largeur. Pas celle de Q, qui est ajustée à la longueur d'UN nom :
  // celle que le cabinet a donnée au plus grand nombre de ses colonnes. C'est
  // la largeur d'une colonne de salarié ordinaire, et les nôtres le sont.
  const compte = {};
  let largeur = '20.7109375';
  const colRe = /<col min="(\d+)" max="(\d+)"[^>]*?width="([0-9.]+)"/g;
  let mc;
  while ((mc = colRe.exec(xml))) {
    const min = +mc[1], max = +mc[2];
    if (min < 2 || min > dernierPrevu) continue;        // la colonne A porte les intitulés
    compte[mc[3]] = (compte[mc[3]] || 0) + (Math.min(max, dernierPrevu) - min + 1);
  }
  Object.keys(compte).forEach(function (w) { if (compte[w] > (compte[largeur] || 0)) largeur = w; });
  xml = xml.replace('</cols>', '<col min="' + (dernierPrevu + 1) + '" max="' + dernier
    + '" width="' + largeur + '" customWidth="1"/></cols>');

  // 3. La plage de la feuille, et les bandeaux qui vont jusqu'au bord.
  xml = xml.replace(/<dimension ref="([A-Z]+\d+):[A-Z]+(\d+)"\/>/,
    '<dimension ref="$1:' + bord + '$2"/>');
  xml = xml.replace(/<mergeCells[\s\S]*?<\/mergeCells>/, function (bloc) {
    return bloc.replace(new RegExp(':' + modele + '(\\d+)"', 'g'), ':' + bord + '$1"');
  });
  return { xml: xml, colonnes: COLONNES.concat(neuves) };
}

// `donnees` : { mois:'2026-10', colonnes:[{nom, contract, t125, ...}], etudiants:'…' }
function remplir(gabarit, donnees) {
  const entrees = lireZip(gabarit);
  const feuille = entrees.find(function (e) { return e.nom === 'xl/worksheets/sheet1.xml'; });
  if (!feuille) throw new Error('gabarit : xl/worksheets/sheet1.xml introuvable');
  let xml = feuille.contenu.toString('utf8');

  const an = parseInt(String(donnees.mois).slice(0, 4), 10);
  const m = parseInt(String(donnees.mois).slice(5, 7), 10);
  xml = ecrireCellule(xml, 'B4', MOIS_FR[m - 1] || '');
  xml = ecrireCellule(xml, 'C4', an);

  const cols = donnees.colonnes || [];
  // Au-delà de seize salariés, la feuille s'allonge d'elle-même.
  const etendu = etendre(xml, cols.length);
  xml = etendu.xml;
  etendu.colonnes.forEach(function (col, i) {
    const c = cols[i] || null;
    xml = ecrireCellule(xml, col + '7', c ? c.nom : '');
    Object.keys(LIGNES).forEach(function (k) {
      const v = c ? c[k] : '';
      // Un zéro ne s'écrit pas : une case vide se lit mieux qu'une colonne de
      // zéros, et c'est ainsi que le cabinet remplit la sienne.
      xml = ecrireCellule(xml, col + LIGNES[k], (v === 0 || v == null) ? '' : v);
    });
  });
  xml = ecrireCellule(xml, 'B27', donnees.etudiants || '');

  feuille.contenu = Buffer.from(xml, 'utf8');
  return ecrireZip(entrees);
}

module.exports = { remplir, lireZip, ecrireZip, crc32, etendre, lettre, LIGNES, COLONNES, MOIS_FR };
