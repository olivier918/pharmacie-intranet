// CE QUI EST LU RESTE LU, ET UNE IDÉE ABOUTIE SE VOIT.
// node essais/lecture-et-idees.js
//
// Trois corrections demandées par Olivier le 28/10/2026, et reproduites une à
// une dans l'application réelle avant d'être écrites :
//
//   1. « Les messages restent en non lus même quand ils sont lus. »
//   2. « Dans la boîte à idées, quand on veut changer le module concerné, ça
//      plante le formulaire. »
//   3. « Une fois les idées gérées par un admin, elles sont archivées pour tous
//      les opérateurs. »
//
// La première était la plus grave, et la plus invisible : une donnée PAR
// PERSONNE (qui a lu quoi) logée dans un enregistrement PARTAGÉ (la
// conversation), que la fusion remplace en entier.
const fs = require('fs'), path = require('path');
const lire = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const srv = lire('server.js');
const html = lire('public/index.html');
const dm = lire('public/dm-module.js');
const mp = lire('public/mp-module.js');

function tirer(src, depart, fin) {
  const d = src.indexOf(depart);
  if (d < 0) throw new Error('introuvable : ' + depart);
  const f = src.indexOf(fin, d);
  if (f < 0) throw new Error('fin introuvable : ' + depart);
  return src.slice(d, f + fin.length);
}

let ok = 0, ko = 0;
const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };
console.log('\nCE QUI EST LU RESTE LU\n');

// ── 1. La carte des lectures ────────────────────────────────────────────────
// `vu` est une carte { identifiant : horodatage du dernier message lu }. Elle
// NE RECULE JAMAIS : un horodatage de lecture ne fait que monter, et deux
// personnes n'écrivent jamais la même case. D'où la fusion case par case.
console.log('La carte des lectures se recolle, elle ne se remplace pas');
eval(tirer(srv, 'function fusionnerVu(', '\n}'));
t('deux cartes se réunissent',
  JSON.stringify(fusionnerVu({ vu: { OF: 10 } }, { vu: { CB: 20 } }).vu) === '{"OF":10,"CB":20}');
t('LA PLUS RÉCENTE L’EMPORTE, case par case',
  fusionnerVu({ vu: { OF: 10 } }, { vu: { OF: 30 } }).vu.OF === 30);
t('... et une lecture ne recule jamais',
  fusionnerVu({ vu: { OF: 30 } }, { vu: { OF: 10 } }).vu.OF === 30);
t('UNE CARTE VIDE N’EFFACE RIEN — c’était exactement le défaut',
  fusionnerVu({ vu: {} }, { vu: { OF: 3000 } }).vu.OF === 3000);
t('un enregistrement sans carte traverse sans dommage',
  fusionnerVu({ id: 'a' }, { id: 'a' }).id === 'a'
  && fusionnerVu({ id: 'a' }, { id: 'a', vu: { OF: 5 } }).vu.OF === 5);
t('une carte absente du perdant laisse le gagnant intact',
  fusionnerVu({ vu: { OF: 7 } }, { id: 'a' }).vu.OF === 7);
t('ON NE MODIFIE PAS LES ENREGISTREMENTS D’ORIGINE', (function () {
  const a = { vu: { OF: 1 } }, b = { vu: { OF: 9 } };
  fusionnerVu(a, b);
  return a.vu.OF === 1 && b.vu.OF === 9;
})());
t('une valeur qui n’est pas un horodatage est ignorée',
  fusionnerVu({ vu: { OF: 5 } }, { vu: { OF: 'bidon', CB: null } }).vu.OF === 5);
t('rien ne tombe sur un enregistrement manquant',
  fusionnerVu(null, { vu: {} }) === null && fusionnerVu({ vu: {} }, null).vu !== undefined);

// LES DEUX CÔTÉS SE RECOLLENT, pas seulement le gagnant : la lecture du
// perdant compte autant que la sienne.
console.log('\nLes deux côtés de la fusion se recollent');
const FUS = tirer(srv, 'function mergeById(', '\n  return out;\n}');
t('la fusion par identifiant appelle le recollage dans les deux sens',
  /\? fusionnerVu\(i, r\) : fusionnerVu\(r, i\)/.test(FUS));
t('... et un enregistrement absent de l’envoi est toujours conservé',
  /if \(!i\) \{ out\.push\(r\); return; \}/.test(FUS));

// ── 2. Le scénario de l'officine, joué en entier ───────────────────────────
// Quatre postes ouverts toute la journée, et chacun renvoie TOUT le dossier à
// chaque enregistrement. Le poste du préparatoire, qui n'a rien fait, a une
// copie plus ancienne de la conversation avec le MÊME `updatedAt` : à égalité
// l'entrant gagnait, et sa carte vide effaçait la lecture faite au comptoir.
console.log('\nLe scénario de l’officine : quatre postes, une conversation');
eval(tirer(srv, 'function mergeById(', '\n  return out;\n}'));
const SERVEUR = [{ id: 'cv1', titre: 'Commande CERP', vu: {}, updatedAt: 1000 }];
const COMPTOIR = [{ id: 'cv1', titre: 'Commande CERP', vu: { OF: 3000 }, updatedAt: 1000 }];
const PREPA    = [{ id: 'cv1', titre: 'Commande CERP', vu: {}, updatedAt: 1000 }];
let base = mergeById(SERVEUR, COMPTOIR);
t('le comptoir enregistre : sa lecture arrive au serveur', base[0].vu.OF === 3000);
base = mergeById(base, PREPA);
t('LE PRÉPARATOIRE ENREGISTRE À SON TOUR, ET N’EFFACE PLUS RIEN', base[0].vu.OF === 3000);
base = mergeById(base, [{ id: 'cv1', titre: 'Commande CERP', vu: { CB: 4000 }, updatedAt: 5000 }]);
t('Céline lit à son tour : les deux lectures cohabitent',
  base[0].vu.OF === 3000 && base[0].vu.CB === 4000);
t('... et son titre, lui, a bien été repris', base[0].updatedAt === 5000);
// UN MESSAGE NE SE PERD TOUJOURS PAS. C'etait la raison de ne pas rehausser
// `updatedAt` en marquant lu, et cette raison tient encore.
base = mergeById(base, [{ id: 'cv1', titre: 'Ancien titre', vu: { OF: 9000 }, updatedAt: 1000 }]);
t('UN POSTE EN RETARD N’ÉCRASE TOUJOURS PAS LE CONTENU',
  base[0].titre === 'Commande CERP' && base[0].updatedAt === 5000);
t('... mais sa lecture, elle, est quand même retenue', base[0].vu.OF === 9000);

// ── 3. Côté navigateur ──────────────────────────────────────────────────────
// Marquer lu n'écrit pas tout de suite : `schedSave` groupe pendant 600 ms. Une
// resynchronisation qui passe dans cet intervalle remplaçait la collection par
// celle du serveur, qui ne connaît pas encore la lecture.
console.log('\nLa resynchronisation n’efface plus une lecture toute fraîche');
eval(tirer(html, 'function fusionnerVus(', '\n}'));
const local = [{ id: 'cv1', vu: { OF: 3000 } }];
const distant = [{ id: 'cv1', vu: {} }, { id: 'cv2', vu: { CB: 10 } }];
const fusion = fusionnerVus(local, distant);
t('CE QU’ON SAIT DÉJÀ SE RECOLLE SUR CE QUI ARRIVE', fusion[0].vu.OF === 3000);
t('... et ce qu’on ne connaissait pas arrive intact', fusion[1].vu.CB === 10);
t('une lecture plus récente côté serveur gagne',
  fusionnerVus([{ id: 'a', vu: { OF: 1 } }], [{ id: 'a', vu: { OF: 9 } }])[0].vu.OF === 9);
t('rien ne tombe sur des listes vides ou absentes',
  fusionnerVus(null, distant) === distant && fusionnerVus([], distant) === distant
  && fusionnerVus(local, null) === null);
t('LES DEUX COLLECTIONS CONCERNÉES Y PASSENT, au chargement et à la resynchro',
  (html.match(/convos=fusionnerVus\(convos,/g) || []).length === 2
  && (html.match(/demandes=fusionnerVus\(demandes,/g) || []).length === 2);
t('... et ce sont bien celles qui portent une carte par personne',
  /c\.vu\[u\.id\] = d\.ts;/.test(mp) && /d\.vu\[u\.id\] = d\.majAt/.test(dm));

// ── 4. Le formulaire de la boîte à idées ───────────────────────────────────
// « Module concerné » est l'avant-dernier champ. Sur un téléphone, le cadre
// était à sa hauteur maximale : il fallait faire défiler À L'INTÉRIEUR pour
// l'atteindre, et un doigt qui sortait du cadre en fin de geste valait un clic
// sur le fond — qui refermait tout. Rouvrir remettait le formulaire à zéro : la
// phrase écrite était perdue, sans un mot.
console.log('\nLe formulaire de dépôt ne se referme plus par accident');
t('LE CLIC SUR LE FOND NE REFERME PLUS LE FORMULAIRE DE DÉPÔT',
  /if \(o\.id === 'dm-ov-form'\) return;/.test(dm));
t('... mais les autres fenêtres gardent ce confort',
  /o\.addEventListener\('click', function \(e\) \{ if \(e\.target === o\) o\.classList\.remove\('open'\); \}\);/.test(dm));
t('ANNULER DEMANDE CONFIRMATION quand quelque chose est écrit',
  /function dmFormRempli\(\)/.test(dm)
  && /if \(!force && dmFormRempli\(\)\n\s*&& !confirm\('Abandonner cette demande/.test(dm));
t('... et la confirmation dit ce qu’on perd', /Ce qui est écrit sera perdu/.test(dm));
t('une capture jointe compte comme du travail à ne pas jeter',
  /return !!\(t\.trim\(\) \|\| dmForm\.image\);/.test(dm));
t('ENVOYER NE REDEMANDE RIEN — on vient de dire oui',
  /dmFermerForm\(true\); dmRender\(\);/.test(dm));
// C'EST LA FENETRE QUI DEFILE, plus le cadre : sur telephone on atteint les
// derniers champs sans jamais avoir a faire defiler une zone interieure.
t('LE CADRE NE DÉFILE PLUS TOUT SEUL — c’est la fenêtre entière qui défile',
  /\.dm-ov\{[^}]*overflow-y:auto/.test(dm)
  && /\.dm-modal\{[^}]*padding:1\.4rem;margin:auto\}/.test(dm));
t('... et il n’est plus bridé en hauteur',
  !/\.dm-modal\{[^}]*max-height/.test(dm));
t('il se cale en haut, pour que le défilement ait un sens',
  /\.dm-ov\{[^}]*align-items:flex-start/.test(dm));

// ── 5. « Fait » veut dire archivé ──────────────────────────────────────────
// Olivier, le 28/10 : « la boîte à idées doit archiver toutes les idées avec le
// statut "fait" ; quand on filtre sur Accepté, il ne faut pas les voir. »
//
// « Acceptées » doit montrer ce qui RESTE À FAIRE. Une idée sortie n'y a plus
// sa place : elle est dans l'archive, et son auteur a été prévenu par un
// message — c'est le message qui fait le retour, pas la présence au tableau.
console.log('\n« Fait » veut dire archivé');
eval(tirer(dm, '  function dmEtat(', '\n  }'));
eval(tirer(dm, '  const DM_ETATS = {', '\n  };').replace(/^\s*const /, 'globalThis.'));
eval(tirer(dm, '  const DM_ETAPES = {', '\n  };').replace(/^\s*const /, 'globalThis.'));
eval(tirer(dm, '  const DM_LEGACY = {', '\n  };').replace(/^\s*const /, 'globalThis.'));
eval(tirer(dm, '  function dmArchivee(', '\n  }'));
const FAITE   = { id: 1, statut: 'acceptee', etape: 'fait',    archiveAt: Date.now() };
const ENCOURS = { id: 2, statut: 'acceptee', etape: 'encours' };
const AFAIRE  = { id: 3, statut: 'acceptee', etape: 'afaire' };
const NEUVE   = { id: 4, statut: 'nouveau' };
t('UNE IDÉE FAITE EST ARCHIVÉE, tout de suite', dmArchivee(FAITE) === true);
t('une idée en cours ne l’est pas', dmArchivee(ENCOURS) === false);
t('une idée à faire non plus', dmArchivee(AFAIRE) === false);
t('une idée toute neuve non plus', dmArchivee(NEUVE) === false);
// ON LIT L'ETAT, pas seulement la date : une demande faite avant que
// `archiveAt` n'existe, ou marquee faite par un autre chemin, l'est aussi —
// sans rien reecrire en base (piege n°7).
t('UNE IDÉE FAITE SANS DATE D’ARCHIVAGE L’EST AUSSI — on lit l’état',
  dmArchivee({ id: 5, statut: 'acceptee', etape: 'fait' }) === true);
t('... et aucune migration n’a été écrite pour autant',
  /const e = dmEtat\(d\);\n\s*return e\.st === 'acceptee' && e\.et === 'fait';/.test(dm));
t('rien ne tombe sur un enregistrement absent', dmArchivee(null) === false);
t('un retour en arrière la ramène au tableau',
  /else if \(d\.archiveAt\) \{ d\.archiveAt = null; \}/.test(dm)
  && dmArchivee({ id: 6, statut: 'acceptee', etape: 'encours', archiveAt: null }) === false);

// LE FILTRE, joue tel qu'il est ecrit dans le module.
console.log('\nLe filtre « Acceptées » ne montre que ce qui reste à faire');
eval(tirer(dm, '  const DM_FILTRES = [', '\n  ];').replace(/^\s*const /, 'globalThis.'));
function passe(d, cle, q) {
  const f = DM_FILTRES.find(x => x.cle === cle);
  if (dmArchivee(d) !== !!f.archives && !(q && dmArchivee(d))) return false;
  if (!f.test(d) && !f.archives) return false;
  return true;
}
t('ACCEPTÉES NE MONTRE PLUS CE QUI EST FAIT — c’était la demande',
  passe(FAITE, 'acceptee') === false);
t('... mais montre bien ce qui est en cours et à faire',
  passe(ENCOURS, 'acceptee') === true && passe(AFAIRE, 'acceptee') === true);
t('« Toutes » ne la montre pas non plus', passe(FAITE, 'toutes') === false);
t('ELLE EST DANS « ARCHIVÉES », et elle y est seule de son espèce',
  passe(FAITE, 'archive') === true && passe(ENCOURS, 'archive') === false);
t('et la recherche la retrouve quand même, où qu’elle soit',
  passe(FAITE, 'toutes', 'recherche') === true);
t('une idée neuve reste sous « Nouveau »', passe(NEUVE, 'nouveau') === true);
// LE RETOUR A L'AUTEUR NE PASSE PAS PAR LE TABLEAU : il est prevenu par un
// message au moment ou sa demande aboutit, et c'est ce qui le fait revenir en
// deposer une autre.
t('L’AUTEUR EST PRÉVENU PAR UN MESSAGE au moment où sa demande aboutit',
  /if \(et === 'fait'\) \{ dmMessageFait\(d\); d\.archiveAt = Date\.now\(\); \}/.test(dm));

console.log('\n' + ok + ' vérifications, ' + ko + ' échec(s)\n');
process.exit(ko ? 1 : 0);
