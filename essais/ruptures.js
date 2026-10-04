// LA LISTE DES RUPTURES. Ce qui se joue ici n'est pas une case a cocher : c'est
// qu'un medicament introuvable revienne se faire reclamer deux fois par jour, et
// qu'il ne disparaisse JAMAIS sans qu'on l'ait voulu. Les fonctions sont
// extraites de public/rp-module.js lui-meme.
// node essais/ruptures.js
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'rp-module.js'), 'utf8');
const ix  = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const sv  = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

function extraire(nom) {
  const d = src.indexOf('  function ' + nom + '(');
  if (d < 0) throw new Error('fonction introuvable : ' + nom);
  const f = src.indexOf('\n  }\n', d);
  return src.slice(d, f + 4);
}
const RP_BASCULE = 14;
eval(extraire('rpCreneau'));
eval(extraire('rpAFaire'));
eval(extraire('rpFaits'));
eval(extraire('rpAnciennete'));

let ok = 0, ko = 0;
const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };
console.log('\nRUPTURES — la liste qu’on gratte deux fois par jour\n');

// ── LE CRENEAU ──────────────────────────────────────────────────────────────
// C'est le seul vrai calcul du module : tout le reste en decoule. Les instants
// sont ECRITS EN UTC, pour que l'essai dise quelque chose du vrai monde.
console.log('Le créneau, à l’heure de Paris');
const U = s => new Date(s);
t('13 h 59 à Paris, c’est encore le matin',      rpCreneau(U('2026-09-30T11:59:00Z')) === '2026-09-30-matin');
t('14 h 01, c’est l’après-midi',                 rpCreneau(U('2026-09-30T12:01:00Z')) === '2026-09-30-aprem');
t('8 h du matin',                                rpCreneau(U('2026-09-30T06:00:00Z')) === '2026-09-30-matin');
t('19 h, la liste de l’après-midi court encore', rpCreneau(U('2026-09-30T17:00:00Z')) === '2026-09-30-aprem');
// L'HIVER, PARIS EST A UTC+1 : une bascule calculee sur l'heure du serveur se
// tromperait d'une heure six mois par an.
t('en hiver aussi, 13 h 59 est le matin',        rpCreneau(U('2026-01-15T12:59:00Z')) === '2026-01-15-matin');
t('... et 14 h 01 l’après-midi',                 rpCreneau(U('2026-01-15T13:01:00Z')) === '2026-01-15-aprem');
t('le jour change à minuit heure de Paris, pas à minuit UTC',
  rpCreneau(U('2026-09-30T22:30:00Z')) === '2026-10-01-matin');
t('... et le 30 septembre 23 h 30 UTC est déjà le 1er octobre',
  rpCreneau(U('2026-09-30T23:30:00Z')) === '2026-10-01-matin');
t('le créneau est lu sur Europe/Paris, jamais sur l’horloge du poste',
  /timeZone: 'Europe\/Paris'/.test(src));
t('la bascule est une constante, pas un 14 perdu dans le code',
  /const RP_BASCULE = 14/.test(src) && /h < RP_BASCULE/.test(src));

// ── LES DEUX LISTES ─────────────────────────────────────────────────────────
console.log('\nCe qui reste à faire, et ce qui est fait');
const C = '2026-09-30-aprem';
const R = (id, dernier, ts, dernierLe) => ({ id, nom: 'M' + id, dernier, ts: ts || id, dernierLe });
const l = [R(3, null, 300), R(1, C, 100, 500), R(2, null, 200), R(4, '2026-09-30-matin', 400)];
const ids = x => x.map(r => r.id).join(',');
t('coché au créneau courant : le produit sort de la liste', ids(rpAFaire(l, C)) === '2,3,4');
// LE CŒUR DU RITUEL : une coche du MATIN ne vaut pas pour l'apres-midi.
t('coché ce matin, il revient cet après-midi', rpAFaire(l, C).some(r => r.id === 4));
t('les plus anciens d’abord — c’est celui qu’on gratte depuis trois semaines '
  + 'qui risque de manquer au comptoir', ids(rpAFaire(l, C)) === '2,3,4');
t('la liste des faits ne contient que le créneau courant', ids(rpFaits(l, C)) === '1');
t('elle montre le dernier coché en tête',
  ids(rpFaits([R(1, C, 1, 100), R(2, C, 2, 900)], C)) === '2,1');
t('une liste vide ne casse rien', rpAFaire(null, C).length === 0 && rpFaits(undefined, C).length === 0);
t('une ligne abîmée non plus', rpAFaire([null, R(1, null, 1)], C).length === 1);

// ── L'ANCIENNETE ────────────────────────────────────────────────────────────
// Sans elle, un produit introuvable depuis six semaines encombre la liste sans
// jamais le dire, et personne ne decide d'arreter de gratter.
console.log('\nDepuis combien de temps on le gratte');
const N = Date.parse('2026-09-30T10:00:00Z');
const il_y_a = j => N - j * 86400000;
t('un ajout du jour le dit simplement',
  /ajouté à l’instant/.test(rpAnciennete({ ts: N, demandes: 0 }, N)));
t('les demandes se comptent', /14 demandes depuis le/.test(rpAnciennete({ ts: il_y_a(20), demandes: 14 }, N)));
t('une seule demande reste au singulier', /1 demande depuis/.test(rpAnciennete({ ts: il_y_a(3), demandes: 1 }, N)));
t('au-delà de deux semaines, les jours s’affichent — c’est le signal d’arrêter',
  /· 30 jours/.test(rpAnciennete({ ts: il_y_a(30), demandes: 9 }, N)));
t('... mais pas pour un produit ajouté hier',
  !/jours/.test(rpAnciennete({ ts: il_y_a(1), demandes: 2 }, N)));
t('un produit jamais demandé le dit', /jamais demandé/.test(rpAnciennete({ ts: il_y_a(2), demandes: 0 }, N)));

// ── CE QU'ON NE DOIT PAS PERDRE ─────────────────────────────────────────────
console.log('\nCe qu’un geste ne doit jamais faire perdre');
t('la croix demande confirmation — c’est le SEUL geste définitif',
  /function \(id\) \{[\s\S]{0,400}confirm\('Retirer/.test(src));
t('... et elle dit ce qu’elle fait : il ne reviendra plus',
  /Il ne reviendra plus aux prochains créneaux/.test(src));
t('cocher, lui, ne demande rien : c’est un geste de tous les jours',
  !/window\.rpInterroger[\s\S]{0,300}confirm\(/.test(src));
t('une suppression laisse une pierre tombale, sinon un poste en retard la ressuscite',
  /markDeleted\('ruptures'/.test(src));
t('l’enregistrement est immédiat, pas différé', /saveNow/.test(src));
t('un doublon est refusé et annoncé, pas ajouté en silence',
  /est déjà dans la liste/.test(src));
t('se raviser reprend la demande comptée — sinon le compteur ment',
  /Math\.max\(0, \(r\.demandes \|\| 0\) - 1\)/.test(src));

// ── LE BRANCHEMENT ──────────────────────────────────────────────────────────
// Piege #4 : une rubrique oubliee quelque part donne une liste qui ne quitte
// jamais le navigateur — « ca marche, puis ca disparait au rechargement ».
//
// CES VERIFICATIONS NE NOMMENT PAS LE VOISIN. Elles l'ont fait, et le jour ou
// une rubrique s'est glissee entre « etiqFormats » et « ruptures », trois
// echecs sont apparus alors que le branchement etait juste. On verifie que la
// rubrique est la, pas ou elle est assise.
console.log('\nLa rubrique est déclarée aux cinq endroits (piège #4)');
t('1. la variable',        /let ruptures=\[\];/.test(ix));
t('2. SYNCED_COLLS côté écran', /const SYNCED_COLLS=\[[^\]]*'ruptures'/.test(ix));
t('3. _collRef',          /case 'ruptures':return ruptures;/.test(ix));
t('4. le corps de saveAll', /JSON\.stringify\(\{staffDB[\s\S]{0,2000}\bruptures\b/.test(ix));
t('5a. loadAll',          /if\(Array\.isArray\(data\.ruptures\)\) ruptures=data\.ruptures;/.test(ix));
t('5b. la resynchronisation de 8 s redessine l’écran',
  /if\(Array\.isArray\(d\.ruptures\)\)\{ ruptures=d\.ruptures; if\(window\.rpRender\)rpRender\(\); \}/.test(ix));
t('et SYNCED_COLLS côté serveur',  /'ruptures'\]/.test(sv));
t('le module lit la collection par _collRef — piège #8', /_collRef\('ruptures'\)/.test(src));
t('le module est chargé par index.html', /<script src="rp-module\.js"><\/script>/.test(ix));
t('l’icône existe dans le sprite', /id="ic-rupture"/.test(ix));
t('la pastille de la barre compte ce qui reste — une liste qu’il faut penser à '
  + 'ouvrir ne s’ouvre pas', /id="navb-rp"/.test(src) && /function rpPastille/.test(src));
t('le passage de 14 h redessine l’écran sans recharger la page',
  /setInterval\([\s\S]{0,260}rpDernierVu/.test(src));
t('le champ d’ajout se déclare au clavier — data-rc, rien de plus',
  /data-rc="neuf"/.test(src));

// ── LE DEPANNAGE A BIEN DISPARU ─────────────────────────────────────────────
console.log('\nLe module dépannage ne laisse rien derrière lui');
t('plus aucune trace dans index.html', !/depannages|dp-module/.test(ix));
t('plus rien dans SYNCED_COLLS du serveur', !/'depannages'/.test(sv));
t('le fichier du module est supprimé',
  !fs.existsSync(path.join(__dirname, '..', 'public', 'dp-module.js')));

console.log('\n' + ok + ' vérifications, ' + ko + ' échec(s)\n');
process.exit(ko ? 1 : 0);
