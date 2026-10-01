/* ═══════════════════════════════════════════════════════════════════════════
   LECTURE DES SYNTHÈSES ASCA — aucune dépendance

   ASCA envoie chaque matin huit PDF. Deux d'entre eux disent quoi commander,
   un troisième ce qui est commandé mais toujours en rupture. Ce fichier les
   lit et rend une liste consolidée par laboratoire.

   POURQUOI PAS DE BIBLIOTHÈQUE PDF. Le dépôt a deux dépendances, `express` et
   `pg`, et en ajouter une de dix mégaoctets pour lire quatre tableaux serait
   disproportionné. Surtout : ces PDF sont d'une simplicité rare. Leurs flux de
   contenu ne contiennent QUE l'opérateur `BT x y Td (texte) Tj ET` — pas un
   seul tableau `TJ`, pas une seule matrice `Tm`, aucune police à encodage
   exotique. Chaque morceau de texte porte donc ses coordonnées absolues, et
   `zlib`, qui est dans Node, suffit à les décompresser.

   Ce choix a un prix, qu'il faut connaître : le jour où ASCA changerait de
   générateur de PDF, ce lecteur ne comprendrait plus rien. C'est pourquoi
   `verifier()` existe — voir plus bas, elle refuse une lecture douteuse au
   lieu de rendre une liste trop courte.

   ON LIT LES MOTS AVEC LEUR ABSCISSE, on ne découpe pas aux espaces. Plusieurs
   colonnes sont vides une ligne sur deux (Code, CIP13, Stock) : un découpage
   aux espaces décalerait tout le reste de la ligne, en silence.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';
const zlib = require('zlib');

// ── 1. Du fichier aux morceaux de texte ──────────────────────────────────────

// Décompresse les flux du document et les rend UN PAR UN, dans l'ordre.
//
// LES METTRE BOUT À BOUT PERDRAIT LES PAGES. L'ordonnée repart de 750 en haut
// de chaque page : triées ensemble, les lignes du bas de la page 1 passeraient
// après celles du haut de la page 2, et chaque produit se retrouverait rattaché
// au laboratoire d'une autre page. L'écran afficherait alors, sans la moindre
// erreur, des produits sous le mauvais nom de laboratoire.
//
// Un flux illisible est ignoré : il porte une image ou un trait, jamais du texte.
function fluxTexte(buf) {
  const s = buf.toString('latin1');
  let out = [], i = 0;
  for (;;) {
    const d = s.indexOf('stream', i);
    if (d < 0) break;
    let a = d + 6;
    if (s[a] === '\r') a++;
    if (s[a] === '\n') a++;
    const f = s.indexOf('endstream', a);
    if (f < 0) break;
    try { out.push(zlib.inflateSync(Buffer.from(s.slice(a, f), 'latin1')).toString('latin1')); }
    catch (e) { /* flux non textuel */ }
    i = f + 9;
  }
  return out;
}

// Les échappements du format PDF. `\(` et `\)` protègent les parenthèses, et
// `\350` est un caractère accentué écrit en octal — « à Cder », « Réserve ».
function detexte(s) {
  return s.replace(/\\([0-7]{1,3})|\\(.)/g, function (_, oct, car) {
    if (oct) return Buffer.from([parseInt(oct, 8) & 0xff]).toString('latin1');
    return car === 'n' ? '\n' : car === 'r' ? '' : car === 't' ? ' ' : car;
  });
}

const RE_TEXTE = /BT\s+(-?[\d.]+)\s+(-?[\d.]+)\s+Td\s+(?:-?[\d.]+\s+Ts\s+)?\(((?:\\.|[^\\()])*)\)\s*Tj\s+ET/g;

// LE FAUX GRAS D'ASCA. Les noms de laboratoires n'ont pas de police grasse :
// ils sont imprimés DEUX FOIS, au même endroit exactement. Sans ce filtre, un
// extracteur qui fusionne les caractères voisins rend « AABBOOCCAA » pour
// ABOCA — et le laboratoire devient introuvable.
function morceaux(flux) {
  const pages = Array.isArray(flux) ? flux : [flux];
  const out = [];
  pages.forEach(function (p, np) {
    const vus = new Set();
    let m;
    RE_TEXTE.lastIndex = 0;
    while ((m = RE_TEXTE.exec(p))) {
      const t = detexte(m[3]).trim();
      if (!t) continue;
      const x = Math.round(parseFloat(m[1]) * 10) / 10;
      const y = Math.round(parseFloat(m[2]) * 10) / 10;
      const cle = x + '|' + y + '|' + t;
      if (vus.has(cle)) continue;
      vus.add(cle);
      out.push({ p: np, x: x, y: y, t: t });
    }
  });
  return out;
}

// ON REGROUPE PAR PROXIMITÉ, PAS PAR ARRONDI. Deux mots d'une même ligne
// peuvent avoir des ordonnées de 741.8 et 740.6 : arrondis, ils tombent de
// part et d'autre d'une frontière, la ligne se coupe en deux, et il ne reste
// que le code produit — sans la moindre erreur.
const LIGNE_TOL = 3.5;
function lignes(mx) {
  const l = mx.slice().sort(function (a, b) {
    return (a.p - b.p) || (b.y - a.y) || (a.x - b.x);
  });
  const out = [];
  let cour = null;
  for (let i = 0; i < l.length; i++) {
    if (!cour || cour.p !== l[i].p || Math.abs(cour.y - l[i].y) > LIGNE_TOL) {
      cour = { p: l[i].p, y: l[i].y, mots: [] };
      out.push(cour);
    }
    cour.mots.push(l[i]);
  }
  out.forEach(function (r) { r.mots.sort(function (a, b) { return a.x - b.x; }); });
  return out;
}

// ── 2. Des morceaux aux colonnes ─────────────────────────────────────────────

// Les abscisses de départ sont relevées sur la LIGNE D'EN-TÊTE du document, et
// non écrites en dur : ASCA les déplace d'un tableau à l'autre.
function colonnes(ligne, noms) {
  const col = {};
  ligne.mots.forEach(function (m) {
    noms.forEach(function (n) {
      if (col[n] === undefined && m.t.replace(/\s+/g, ' ').indexOf(n) === 0) col[n] = m.x;
    });
  });
  return col;
}

const MARGE = 12;   // un chiffre aligné à droite déborde un peu sur sa gauche
function decouper(ligne, col, noms) {
  const b = noms.filter(function (n) { return col[n] !== undefined; })
                .map(function (n) { return { x: col[n], n: n }; })
                .sort(function (a, c) { return a.x - c.x; });
  const out = {};
  b.forEach(function (z) { out[z.n] = []; });
  ligne.mots.forEach(function (m) {
    let cible = b[0].n;
    for (let i = 0; i < b.length; i++) {
      if (m.x >= b[i].x - MARGE) cible = b[i].n; else break;
    }
    out[cible].push(m.t);
  });
  const d = {};
  Object.keys(out).forEach(function (n) { d[n] = out[n].join(' ').replace(/\s+/g, ' ').trim(); });
  // LE SIGNE MOINS EST UN GLYPHE À PART. Un stock de −6 sort « - 6 », avec une
  // espace. Un parseFloat naïf lit « vide », donc zéro : un stock très négatif
  // passerait pour un stock nul, soit exactement l'inverse d'une urgence.
  Object.keys(d).forEach(function (n) { d[n] = d[n].replace(/^-\s+(?=\d)/, '-'); });
  return d;
}

const RE_CODE = /^\d{7,14}$/;
const RE_NOMBRE = /^-?\d+([.,]\d+)?$/;

// Une ligne de laboratoire ne porte ni code ni nombre : rien que du texte, en
// capitales. Les lignes de pied de page en portent le nom de l'officine.
function estLabo(ligne) {
  const t = ligne.mots.map(function (m) { return m.t; });
  if (!t.length) return false;
  if (t.some(function (x) { return RE_CODE.test(x) || RE_NOMBRE.test(x); })) return false;
  const j = t.join(' ').trim();
  if (!j || j.length < 2) return false;
  if (/Page\s*\d|^Pharmacie\b|^Liste\b|^Code$|^HIT PARADE/i.test(j)) return false;
  return j === j.toUpperCase();
}

function estPied(ligne) {
  const j = ligne.mots.map(function (m) { return m.t; }).join(' ');
  return /Page\s+\d+\s*$|^\s*Pharmacie\b/.test(j);
}

// ── 3. Les trois tableaux ────────────────────────────────────────────────────

const SCHEMAS = {
  sansCommande: { cle: 'Etiquette',
    noms: ['Code', 'EAN', 'CIP13', 'Produit', 'Forme', 'Etiquette', 'Stock', 'Dern.Vte', 'depuis', 'Moy.Vte'] },
  risque15: { cle: 'Stk',
    noms: ['Code', 'EAN', 'CIP13', 'Produit', 'Stk', 'à Cder', 'Moy.Vte'] },
  avecCommande: { cle: 'Dt.Liv',
    noms: ['Code', 'Produit', 'Dern.Vte', 'Stock', 'Dt.Liv', 'En Cde', 'Moy.Vte'] }
};

const MOIS = { janv: 1, févr: 2, mars: 3, avr: 4, mai: 5, juin: 6, juil: 7,
               août: 8, sept: 9, oct: 10, nov: 11, déc: 12 };

// La date est dans le PIED DE PAGE de chaque PDF : « au lun 28 sept 2026 à
// 09:00 ». Déposer les PDF suffit donc — ni le courriel ni une saisie.
function dateSynthese(flux) {
  const t = morceaux(flux).map(function (m) { return m.t; }).join(' ');
  const m = /au\s+\w+\.?\s+(\d{1,2})\s+([a-zéûôA-Z]+)\.?\s+(\d{4})\s+à\s+(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return null;
  const mo = MOIS[m[2].toLowerCase().slice(0, 4).replace(/\.$/, '')]
          || MOIS[m[2].toLowerCase().slice(0, 3)];
  if (!mo) return null;
  return m[3] + '-' + String(mo).padStart(2, '0') + '-' + m[1].padStart(2, '0')
       + 'T' + m[4].padStart(2, '0') + ':' + m[5];
}

function analyser(buf, quoi) {
  const sch = SCHEMAS[quoi];
  if (!sch) throw new Error('tableau inconnu : ' + quoi);
  const flux = fluxTexte(buf);
  const res = { date: dateSynthese(flux), lignes: [], nonLues: [] };
  let col = null, labo = null;
  lignes(morceaux(flux)).forEach(function (l) {
    const t = l.mots.map(function (m) { return m.t; });
    // L'en-tête se répète à chaque page : on le relit, on ne le compte jamais
    // comme une ligne de produit.
    if (t.indexOf('Produit') >= 0 && t.some(function (x) { return x.indexOf(sch.cle) === 0; })) {
      col = colonnes(l, sch.noms); return;
    }
    if (!col || estPied(l)) return;
    if (estLabo(l)) { labo = t.join(' ').trim(); return; }
    if (!t.some(function (x) { return RE_CODE.test(x) || RE_NOMBRE.test(x); })) return;
    const d = decouper(l, col, sch.noms);
    // « 24 j » se coupe en deux et le « j » déborde sur la colonne suivante ;
    // « 5j » ne se coupe pas. Les deux formes existent dans le même tableau.
    if (typeof d['Moy.Vte'] === 'string' && /^j\s/.test(d['Moy.Vte'])) {
      d.depuis = ((d.depuis || '') + 'j').trim();
      d['Moy.Vte'] = d['Moy.Vte'].slice(2).trim();
    }
    if (d.depuis) d.depuis = d.depuis.replace(/\s|j/g, '');
    d.labo = labo;
    if (!d.Produit) { res.nonLues.push(t.join(' ')); return; }
    res.lignes.push(d);
  });
  return res;
}

// ── 4. Le contrôle qui refuse une lecture douteuse ───────────────────────────
//
// Le corps du courriel annonce ses totaux. Le PDF « sans commande » contient
// plus de lignes que l'indicateur, parce que celui-ci ne compte que les
// produits à plus d'une vente par mois — il le dit lui-même. Ces deux
// égalités sont donc vérifiables, et elles doivent l'être :
//
// UNE LISTE DE COMMANDES TROP COURTE RESSEMBLE À UNE BONNE NOUVELLE. Le jour
// où ASCA changerait son format, le lecteur rendrait quelques lignes au lieu
// de rien, et personne ne s'en apercevrait avant la rupture.
function verifier(lu, attendu) {
  const e = [];
  if (attendu.sansCommande != null) {
    const n = lu.sansCommande.lignes.filter(function (x) { return nombre(x['Moy.Vte']) > 1; }).length;
    if (n !== attendu.sansCommande)
      e.push('ruptures sans commande : ' + n + ' lues, ' + attendu.sansCommande + ' annoncées');
  }
  if (attendu.avecCommande != null && lu.avecCommande.lignes.length !== attendu.avecCommande)
    e.push('ruptures avec commande : ' + lu.avecCommande.lignes.length
           + ' lues, ' + attendu.avecCommande + ' annoncées');
  return e;
}

function nombre(v) {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(',', '.').replace(/\s/g, ''));
  return isNaN(n) ? null : n;
}

// ── 4 bis. Les totaux annoncés par le corps du courriel ──────────────────────
//
// Le courriel annonce ses propres comptes. C'est la seule source extérieure qui
// permette de dire « la lecture est juste » — et elle n'arrive QUE par la voie
// automatique : quand on dépose les PDF à la main, ce contrôle ne peut pas
// jouer.
//
// LE TEXTE EST SALE, ET IL FAUT LE PRENDRE AINSI. Deux nombres par ligne sans
// séparateur (« 33 57 » = 33 aujourd'hui, 57 en moyenne), des lignes coupées en
// plein milieu, des accents tantôt présents tantôt perdus au passage d'un
// client de messagerie. Les expressions ci-dessous sont volontairement lâches ;
// une ligne illisible rend `null`, et `null` n'est pas zéro.
function sansAccent(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function lireIndicateurs(texte) {
  const t = sansAccent(texte).replace(/[ \t]+/g, ' ');
  const prendre = function (re) {
    const m = re.exec(t);
    return m ? { jour: parseInt(m[1], 10), moyenne: m[2] != null ? parseInt(m[2], 10) : null } : null;
  };
  const avec = prendre(/Produits en rupture avec une commande\s*(\d+)(?:\s+(\d+))?/i);
  const sans = prendre(/Produits en rupture \(pas de reserve,? pas de commande\)\s*(\d+)(?:\s+(\d+))?/i);
  const reas = prendre(/Produits en rupture avec une reserve[^\n]*?\s(\d+)(?:\s+(\d+))?/i);
  const serveur = /Etat du serveur de mise a jour\s+([^\n]+)/i.exec(t);
  const piles = /Nombre d'etiquettes dont la pile est faible\s*(\d+)/i.exec(t);
  return {
    sansCommande: sans ? sans.jour : null,
    avecCommande: avec ? avec.jour : null,
    reassort:     reas ? reas.jour : null,
    moyennes: { sansCommande: sans ? sans.moyenne : null,
                avecCommande: avec ? avec.moyenne : null },
    serveur: serveur ? serveur[1].trim() : null,
    pilesFaibles: piles ? parseInt(piles[1], 10) : null
  };
}

// L'EXPEDITEUR D'ORIGINE SE LIT DANS LE CORPS, pas dans l'en-tête : le courriel
// arrive TRANSFERE depuis la boîte de la pharmacie, donc son `From` est celui
// de la pharmacie. Un filtre posé sur l'en-tête n'aurait jamais rien laissé
// passer — ou pire, aurait laissé passer n'importe quel transfert.
const ASCA_EXPEDITEUR = 'SyntheseAscaEtiq@noreply.asca-pharma.com';
function vientDAsca(texte, expediteur) {
  const t = sansAccent(texte).toLowerCase();
  const a = ASCA_EXPEDITEUR.toLowerCase();
  return t.indexOf(a) >= 0 || String(expediteur || '').toLowerCase().indexOf(a) >= 0;
}

// ── 4 ter. Les laboratoires qui n'en font qu'un ──────────────────────────────
//
// ASCA écrit le laboratoire tel qu'il l'a en base, et il l'écrit parfois de deux
// façons : « HALEON GLAXOSMITHKLINE » un jour, « HALEON GLAXOSMITHKLINE SANTE
// GP » le lendemain. Deux cartes pour un seul interlocuteur, c'est deux appels.
//
// ON NE FUSIONNE JAMAIS TOUT SEUL. « PIERRE FABRE MEDICAMENT » et « PIERRE
// FABRE ORAL CARE » se ressemblent autant que les deux précédents, et ce sont
// pourtant peut-être deux services, deux commandes, deux numéros. Rapprocher
// sur la ressemblance ferait appeler le mauvais service — tous les jours, et
// sans que rien ne le dise. Le module PROPOSE, quelqu'un tranche, et la
// réponse est retenue pour toujours : c'est déjà ce que font les patients et
// les médecins avec leurs alias.
function cleLabo(nom) {
  return sansAccent(nom).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Deux noms sont PROPOSÉS au rapprochement quand l'un commence par l'autre.
// C'est la forme qu'ont toutes les variantes d'ASCA : un nom, puis le même
// nom suivi d'une précision. En dessous de cinq caractères communs, on se
// tait : « AVENE » et « AVENIR » n'ont rien à voir.
const LABO_MIN = 5;
function rapprochements(noms, refus) {
  const nie = new Set((refus || []).map(function (r) {
    return [cleLabo(r[0]), cleLabo(r[1])].sort().join('|');
  }));
  const l = [...new Set((noms || []).filter(Boolean))]
    .map(function (n) { return { nom: n, cle: cleLabo(n) }; })
    .filter(function (x) { return x.cle.length >= LABO_MIN; })
    .sort(function (a, b) { return a.cle.length - b.cle.length; });
  const out = [];
  for (let i = 0; i < l.length; i++) {
    for (let j = i + 1; j < l.length; j++) {
      if (l[i].cle === l[j].cle) continue;
      if (l[j].cle.indexOf(l[i].cle) !== 0) continue;
      if (nie.has([l[i].cle, l[j].cle].sort().join('|'))) continue;
      // Le plus court est propose comme nom retenu : c'est le tronc commun,
      // et c'est celui qu'on reconnait d'un coup d'oeil sur une carte.
      out.push({ garde: l[i].nom, absorbe: l[j].nom });
    }
  }
  return out;
}

// Le nom retenu pour un nom lu dans un PDF. La traduction se fait À LA LECTURE
// (piège #7) : on ne réécrit jamais les lignes déjà enregistrées, sans quoi
// défaire un rapprochement deviendrait impossible.
function nomRetenu(nom, labos) {
  if (!nom) return nom;
  const c = cleLabo(nom);
  const l = labos || [];
  for (let i = 0; i < l.length; i++) {
    if (cleLabo(l[i].nom) === c) return l[i].nom;
    const a = l[i].alias || [];
    for (let j = 0; j < a.length; j++) if (cleLabo(a[j]) === c) return l[i].nom;
  }
  return nom;
}

// ── 5. De trois tableaux à une liste par laboratoire ─────────────────────────

// LES SEUILS SONT EN VENTES PAR MOIS. `Moy.Vte` est un rythme MENSUEL, établi
// par recoupement avec le Hit Parade : le Délical riz au lait, Moy.Vte 41,08,
// a fait 35 ventes en 30 jours. Des seuils écrits en unités par jour seraient
// faux d'un facteur trente — et ne trieraient rien.
//
// CES VALEURS ONT ÉTÉ CALIBRÉES SUR DE VRAIES DONNÉES, et il le fallait. Une
// première règle — orange dès 2 ventes par mois, et tout le « risque 15 jours »
// d'office — donnait 57 laboratoires orange sur 66 : une page qui ne trie rien
// est une page qu'on cesse de lire. La médiane des ventes est à 2,09 par mois.
const SEUILS = { urgent: 8, commander: 4 };

function jours(a, b) { return Math.round((a - b) / 86400000); }

// « 12/09/26 » — le siècle est sous-entendu, et il n'y a pas d'ambiguïté : ces
// dates sont des dates de vente ou de livraison, toujours récentes.
function dateFr(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(String(s || '').trim());
  return m ? new Date(2000 + (+m[3]), (+m[2]) - 1, +m[1]) : null;
}

// Un produit est rassemblé depuis les trois tableaux : il peut figurer dans
// deux d'entre eux, et il ne doit compter qu'une fois, au niveau le plus
// urgent. La clé est le Code — le seul identifiant présent partout.
function rassembler(lu) {
  const prod = new Map();
  function poser(l, cat, champs) {
    (l || []).forEach(function (x) {
      if (!x.Code) return;
      const p = prod.get(x.Code) || { code: x.Code, nom: x.Produit, labo: x.labo,
                                      cats: new Set(), moy: null, d: {} };
      p.cats.add(cat);
      if (x.labo) p.labo = x.labo;
      if (!p.nom) p.nom = x.Produit;
      const m = nombre(x['Moy.Vte']);
      if (m != null) p.moy = (p.moy == null) ? m : Math.max(p.moy, m);
      champs.forEach(function (c) { if (x[c[0]]) p.d[c[1]] = x[c[0]]; });
      prod.set(x.Code, p);
    });
  }
  poser(lu.sansCommande && lu.sansCommande.lignes, 'sansCde', [['depuis', 'depuis'], ['Stock', 'stock']]);
  poser(lu.risque15 && lu.risque15.lignes, 'risque', [['à Cder', 'aCder'], ['Stk', 'stk']]);
  poser(lu.avecCommande && lu.avecCommande.lignes, 'avecCde',
        [['Dt.Liv', 'dtLiv'], ['En Cde', 'enCde'], ['Stock', 'stock']]);
  return [...prod.values()];
}

// UN PRODUIT COMMANDÉ N'EST PAS UN PRODUIT À COMMANDER. S'il est déjà en
// commande et pas revenu en rupture sèche, il ne va pas dans la liste des
// commandes : il va dans les relances. Les confondre ferait commander deux
// fois — et c'est le reproche le plus sûr qu'un laboratoire puisse faire.
function urgence(p, seuils, hit) {
  const s = seuils || SEUILS;
  const m = p.moy || 0;
  if (p.cats.has('avecCde') && !p.cats.has('sansCde')) return 'relance';
  if (p.cats.has('sansCde') && (m >= s.urgent || (hit && hit.has(p.code)))) return 'rouge';
  if ((p.cats.has('sansCde') || p.cats.has('risque')) && m >= s.commander) return 'orange';
  return 'gris';
}

const ORDRE = { rouge: 0, orange: 1, gris: 2, relance: 3 };

// UNE CARTE PAR LABORATOIRE, à l'urgence de son produit le plus pressé : on
// passe UN appel par laboratoire, pas un par produit. Un labo qui a un rouge
// et trois oranges est rouge.
function consolider(lu, options) {
  const o = options || {};
  const seuils = o.seuils || SEUILS;
  const auj = o.aujourdhui ? new Date(o.aujourdhui) : new Date();
  const prods = rassembler(lu).map(function (p) {
    p.urgence = urgence(p, seuils, o.hitParade);
    const d = dateFr(p.d.dtLiv);
    if (d) p.retard = jours(auj, d);
    p.stock = nombre(p.d.stock);
    return p;
  });
  const par = new Map();
  prods.forEach(function (p) {
    const k = p.labo || null;
    if (!par.has(k)) par.set(k, []);
    par.get(k).push(p);
  });
  const out = [];
  par.forEach(function (l, labo) {
    l.sort(function (a, b) { return (ORDRE[a.urgence] - ORDRE[b.urgence]) || ((b.moy || 0) - (a.moy || 0)); });
    out.push({ labo: labo, urgence: l[0].urgence, produits: l });
  });
  out.sort(function (a, b) {
    return (ORDRE[a.urgence] - ORDRE[b.urgence]) || (b.produits.length - a.produits.length)
        || String(a.labo).localeCompare(String(b.labo));
  });
  return out;
}

module.exports = { fluxTexte, detexte, morceaux, lignes, colonnes, decouper,
                   estLabo, estPied, dateSynthese, analyser, verifier, nombre,
                   SCHEMAS, LIGNE_TOL, SEUILS, ORDRE,
                   rassembler, urgence, consolider, dateFr, jours,
                   lireIndicateurs, vientDAsca, sansAccent, ASCA_EXPEDITEUR,
                   cleLabo, rapprochements, nomRetenu, LABO_MIN };
