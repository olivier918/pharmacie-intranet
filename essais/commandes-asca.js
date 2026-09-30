// LA LECTURE DES SYNTHÈSES ASCA. Ce qui se joue ici n'est pas l'exactitude d'un
// tableau : c'est qu'une liste de commandes TROP COURTE ressemble à une bonne
// nouvelle. Le jour où ASCA change son format, personne ne verra les lignes
// manquantes — on verra une belle page verte, et une rupture trois jours après.
// Les fonctions viennent de commandes-asca.js, et les exemples sont les VRAIS
// PDF du 28/09/2026.
// node essais/commandes-asca.js
const A = require('../commandes-asca');
const fs = require('fs'), path = require('path');
const EX = path.join(__dirname, 'exemples', 'asca');

let ok = 0, ko = 0;
const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };
console.log('\nLES SYNTHÈSES ASCA — lire sans rien perdre\n');

const lu = {
  sansCommande: A.analyser(fs.readFileSync(path.join(EX, '2026-09-28-rupture-sans-commande.pdf')), 'sansCommande'),
  risque15:     A.analyser(fs.readFileSync(path.join(EX, '2026-09-28-risque-15-jours.pdf')), 'risque15'),
  avecCommande: A.analyser(fs.readFileSync(path.join(EX, '2026-09-28-rupture-avec-commande.pdf')), 'avecCommande')
};

// ── LE CONTRÔLE QUI PROUVE TOUT LE RESTE ────────────────────────────────────
// Le corps du courriel annonce 52 et 33. Ces deux égalités sont le test de
// non-régression du lecteur : si elles cassent, le format a changé.
console.log('Le compte annoncé par le courriel');
const fortes = lu.sansCommande.lignes.filter(x => A.nombre(x['Moy.Vte']) > 1).length;
t('52 ruptures sans commande à plus d’une vente par mois (lu : ' + fortes + ')', fortes === 52);
t('33 ruptures avec commande (lu : ' + lu.avecCommande.lignes.length + ')',
  lu.avecCommande.lignes.length === 33);
t('le contrôle ne signale rien quand tout concorde',
  A.verifier(lu, { sansCommande: 52, avecCommande: 33 }).length === 0);
t('... et il PARLE quand le compte n’y est pas — une liste trop courte ne doit '
  + 'jamais passer pour une bonne nouvelle',
  A.verifier(lu, { sansCommande: 60, avecCommande: 33 }).length === 1);
t('aucune ligne n’est restée illisible',
  Object.keys(lu).every(k => lu[k].nonLues.length === 0));

// ── LES PAGES ───────────────────────────────────────────────────────────────
// L'ordonnee repart de 750 en haut de chaque page. Trier tout le document
// ensemble rattacherait les produits du haut de la page 2 au laboratoire du
// bas de la page 1 — sans erreur, sans trace, et parfaitement faux.
console.log('\nLes pages ne se mélangent pas');
t('chaque produit porte un laboratoire, sur les trois tableaux',
  Object.keys(lu).every(k => lu[k].lignes.every(x => !!x.labo)));
t('le premier produit du fichier porte le premier laboratoire du fichier',
  lu.sansCommande.lignes[0].labo === 'A-DERMA');
t('un fichier de 2 pages rend bien ses 65 lignes', lu.sansCommande.lignes.length === 65);
t('un fichier de 3 pages rend bien ses 95 lignes', lu.risque15.lignes.length === 95);
t('l’en-tête, qui se répète à chaque page, n’est jamais pris pour un produit',
  !lu.sansCommande.lignes.some(x => x.Produit === 'Produit' || x.Code === 'Code'));
t('le pied de page non plus',
  !lu.sansCommande.lignes.some(x => /Pharmacie|Page \d/.test(x.Produit || '')));

// ── LES QUATRE PIÈGES D'EXTRACTION ──────────────────────────────────────────
console.log('\nLes pièges qu’on ne voit pas en ouvrant le PDF');

// 1. Le faux gras par surimpression : le nom du labo est imprimé DEUX FOIS, au
//    meme endroit. Sans deduplication, ABOCA devient AABBOOCCAA.
t('un nom de laboratoire imprimé deux fois au même endroit n’est lu qu’une fois',
  A.morceaux(['BT 32 741 Td (ASEPTA) Tj ET BT 32 741 Td (ASEPTA) Tj ET']).length === 1);
t('... mais deux textes identiques à des endroits DIFFÉRENTS restent deux',
  A.morceaux(['BT 32 741 Td (12) Tj ET BT 99 741 Td (12) Tj ET']).length === 2);
t('aucun laboratoire ne sort avec ses lettres doublées',
  !lu.sansCommande.lignes.some(x => /(.)\1(.)\2(.)\3/.test(x.labo || '')));

// 2. Le signe moins est un glyphe a part : « - 6 » et non « -6 ».
const neg = lu.avecCommande.lignes.filter(x => A.nombre(x.Stock) < 0);
t('un stock négatif est lu négatif, pas vide (' + neg.length + ' lignes)', neg.length === 4);
t('... et -6 ne devient pas 0 — ce serait l’inverse d’une urgence',
  neg.some(x => A.nombre(x.Stock) === -6));

// 3. Une ligne se coupe en deux si ses mots different d'un point d'ordonnee.
t('deux mots à 741.8 et 740.6 sont sur la MÊME ligne',
  A.lignes([{ p: 0, x: 10, y: 741.8, t: 'a' }, { p: 0, x: 90, y: 740.6, t: 'b' }]).length === 1);
t('... à 741.8 et 730.0, sur deux lignes',
  A.lignes([{ p: 0, x: 10, y: 741.8, t: 'a' }, { p: 0, x: 90, y: 730.0, t: 'b' }]).length === 2);
t('deux mots de même ordonnée sur des PAGES différentes ne se rejoignent pas',
  A.lignes([{ p: 0, x: 10, y: 741.8, t: 'a' }, { p: 1, x: 90, y: 741.8, t: 'b' }]).length === 2);

// 4. Les colonnes vides. Un decoupage aux espaces decalerait tout.
const sansCode = lu.sansCommande.lignes.filter(x => !x.Code);
t('une ligne sans Code garde son EAN à la bonne place',
  lu.sansCommande.lignes.every(x => !x.EAN || /^\d{8,14}$/.test(x.EAN)));
t('une ligne sans CIP13 ne décale pas le libellé',
  lu.sansCommande.lignes.filter(x => !x.CIP13).every(x => x.Produit && !/^\d+$/.test(x.Produit)));

// ── Le reste du texte ───────────────────────────────────────────────────────
console.log('\nCe que le format PDF déguise');
t('les parenthèses échappées reviennent telles quelles', A.detexte('\\(Duo/Gondole') === '(Duo/Gondole');
t('les accents écrits en octal sont rendus', A.detexte('R\\351serve') === 'Réserve');
t('« 24 j » ne laisse pas son « j » déborder sur les ventes',
  lu.sansCommande.lignes.every(x => !/^j/.test(x['Moy.Vte'] || '')));
t('... et « depuis » est un nombre de jours propre',
  lu.sansCommande.lignes.every(x => !x.depuis || /^\d+$/.test(x.depuis)));
t('une virgule décimale serait comprise comme un point', A.nombre('1,83') === 1.83);
t('un champ vide ne devient pas zéro', A.nombre('') === null && A.nombre(null) === null);

// LA DATE EST DANS LE PIED DE PAGE : deposer les PDF suffit, ni courriel ni saisie.
console.log('\nLa date se lit dans le fichier');
t('elle est la même sur les trois tableaux',
  lu.sansCommande.date === '2026-09-28T09:00' && lu.risque15.date === lu.sansCommande.date
  && lu.avecCommande.date === lu.sansCommande.date);

// ── L'urgence ───────────────────────────────────────────────────────────────
console.log('\nQui est pressé');
const P = (cats, moy, code) => ({ code: code || 'c1', nom: 'X', cats: new Set(cats), moy: moy, d: {} });
const S = A.SEUILS;
t('en rupture sèche et très vendu : rouge', A.urgence(P(['sansCde'], 12), S) === 'rouge');
t('en rupture sèche et peu vendu : gris', A.urgence(P(['sansCde'], 1), S) === 'gris');
t('sous les 15 jours de ventes et bien vendu : orange', A.urgence(P(['risque'], 5), S) === 'orange');
t('au Hit Parade, c’est rouge même sans atteindre le seuil',
  A.urgence(P(['sansCde'], 1, 'hp1'), S, new Set(['hp1'])) === 'rouge');
// UN PRODUIT COMMANDE N'EST PAS UN PRODUIT A COMMANDER.
t('déjà commandé et pas revenu en rupture sèche : relance, pas commande',
  A.urgence(P(['avecCde'], 20), S) === 'relance');
t('... mais commandé ET de nouveau en rupture sèche : il faut recommander',
  A.urgence(P(['avecCde', 'sansCde'], 20), S) === 'rouge');
t('un produit présent dans deux listes ne compte qu’une fois, au plus urgent',
  A.urgence(P(['sansCde', 'risque'], 12), S) === 'rouge');
t('les seuils se changent sans toucher au code',
  A.urgence(P(['sansCde'], 5), { urgent: 4, commander: 2 }) === 'rouge');
t('des ventes nulles ne cassent rien', A.urgence(P(['sansCde'], null), S) === 'gris');

// ── La consolidation ────────────────────────────────────────────────────────
console.log('\nUn appel par laboratoire, pas un par produit');
const c = A.consolider(lu, { aujourdhui: '2026-09-28' });
const n = {}; c.forEach(x => n[x.urgence] = (n[x.urgence] || 0) + 1);
t('66 laboratoires pour 128 produits (lu : ' + c.length + ')', c.length === 66);
t('le tri du matin sépare vraiment : ' + JSON.stringify(n),
  n.rouge === 4 && n.orange === 15 && n.gris === 42 && n.relance === 5);
t('les rouges d’abord, les relances en dernier',
  c[0].urgence === 'rouge' && c[c.length - 1].urgence === 'relance');
t('un laboratoire prend l’urgence de son produit le plus pressé',
  c.filter(l => l.urgence === 'rouge').every(l => l.produits.some(p => p.urgence === 'rouge')));
t('dans un laboratoire, le plus urgent est en tête',
  c.every(l => A.ORDRE[l.produits[0].urgence] === A.ORDRE[l.urgence]));
t('aucun produit n’apparaît sous deux laboratoires',
  (() => { const v = new Set(); return c.every(l => l.produits.every(p => !v.has(p.code) && v.add(p.code))); })());

// LA DATE DE LIVRAISON PREVUE : la relance n'a plus rien a deviner.
console.log('\nLes relances savent de combien elles sont en retard');
const asepta = c.find(l => l.labo === 'ASEPTA');
t('Asepta a 16 jours de retard sur une livraison attendue le 12/09',
  !!asepta && asepta.produits.every(p => p.retard === 16));
t('une livraison encore à venir n’est pas un retard',
  c.some(l => l.produits.some(p => p.retard != null && p.retard < 0)));
t('une date absente ne devient pas un retard de 0',
  c.every(l => l.produits.every(p => p.d.dtLiv || p.retard === undefined)));

console.log('\n' + ok + ' vérifications, ' + ko + ' échec(s)\n');
process.exit(ko ? 1 : 0);
