// LE PLANNING REPRIS DU TABLEUR — six semaines qui n'en stockent que trois.
// node essais/planning-tableur.js
//
// CE QUI SE JOUE. Le tableur donne trois semaines de PRÉSENCES (S48, S49, S50
// de 2026) et pas une seule heure. Deux façons de se tromper, et les deux
// passent inaperçues jusqu'à ce que quelqu'un se présente le mauvais jour :
//
//   • L'ANCRAGE. Si la semaine 1 du cycle ne tombe pas sur la S48, tout le
//     monde est décalé d'une semaine — l'écran reste plausible, et c'est ça le
//     danger. Les préparateurs tournent sur deux semaines, les pharmaciens sur
//     trois : le motif de l'équipe ne se répète qu'au bout de six, mais on n'en
//     stocke jamais six. Chacun garde le cycle de sa rotation.
//
//   • LES HEURES INVENTÉES. Le fichier dit QUI travaille, pas QUAND. Reprendre
//     l'horaire déjà connu de chacun préserve « sauf une journée » et les
//     6h-13h30 des logisticiens. Ce qu'on ne sait pas doit être SIGNALÉ, jamais
//     comblé en silence.
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'pl-module.js'), 'utf8');

// Plusieurs helpers du planning tiennent sur UNE SEULE LIGNE. Chercher le
// prochain « \n  } » les ferait avaler tout ce qui suit — et le module
// redeclarerait PL_JOURS. On s'arrete donc a la fin de la ligne quand elle se
// referme toute seule.
function extraire(nom) {
  const d = src.indexOf('  function ' + nom + '(');
  if (d < 0) throw new Error('fonction introuvable : ' + nom);
  const finLigne = src.indexOf('\n', d);
  const ligne = src.slice(d, finLigne);
  if (ligne.trimEnd().endsWith('}')) return ligne;
  const f = src.indexOf('\n  }\n', d);
  if (f < 0) throw new Error('fin introuvable : ' + nom);
  return src.slice(d, f + 4);
}
function bloc(depart, fin) {
  const d = src.indexOf(depart);
  if (d < 0) throw new Error('bloc introuvable : ' + depart);
  const f = src.indexOf(fin, d);
  if (f < 0) throw new Error('fin de bloc introuvable : ' + fin);
  return src.slice(d, f + fin.length);
}
const global_ = (d, f) => eval(bloc(d, f).replace(/^\s*const /, 'globalThis.'));

global_("const PL_TAB_DEBUT =", "'2026-11-23';");
global_("const PL_TAB_DEF =", "'14h-19h30' };");
global_("const PL_TAB_JOURS =", "'sam'];");
global_("const PL_TAB_INCONNUS =", "'Enzo (seconde colonne)'];");
global_("const PL_TAB_SORTANTS =", "'ct:violette-gente'];");
global_("const PL_TAB_GRILLE = {", "\n  };");
eval(['plTabConnus', 'plTabHoraire', 'plTabSem'].map(extraire).join('\n'));

// Le calcul du rang : c'est lui qui décide quelle semaine type s'applique.
let ROTS = [];
globalThis.L = (quoi) => (quoi === 'rotations' ? ROTS : []);
eval(['plIso', 'plAddD', 'plMonday', 'plVerData', 'plRotOf', 'plWeeksBetween', 'plRang']
  .map(extraire).join('\n'));
eval(extraire('plRangAt'));

let ok = 0, ko = 0;
const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };
console.log('\nLE PLANNING REPRIS DU TABLEUR\n');

// ── La grille ───────────────────────────────────────────────────────────────
console.log('Ce que le tableur a donné');
const ids = Object.keys(PL_TAB_GRILLE);
t('dix-neuf collaborateurs ont une colonne exploitable', ids.length === 19);
t('chacun porte les trois semaines du fichier',
  ids.every(k => Array.isArray(PL_TAB_GRILLE[k]) && PL_TAB_GRILLE[k].length === 3));
t('six jours par semaine — du lundi au samedi, jamais le dimanche',
  ids.every(k => PL_TAB_GRILLE[k].every(m => m.length === 6)));
t('ON NE LIT QUE QUATRE ÉTATS : journée, matin, après-midi, repos',
  ids.every(k => PL_TAB_GRILLE[k].every(m => /^[Xma.]{6}$/.test(m))));
t('les identifiants sont ceux des contrats, et tous distincts',
  ids.every(k => /^ct:/.test(k)) && new Set(ids).size === ids.length);
t('les titulaires y sont', ids.indexOf('ct:anouck') >= 0 && ids.indexOf('ct:olivier') >= 0);
t('Violette sort du planning sans être détruite',
  PL_TAB_SORTANTS.join() === 'ct:violette-gente' && ids.indexOf('ct:violette-gente') < 0);
t('les quatre colonnes sans contrat sont nommées, pas ignorées en silence',
  PL_TAB_INCONNUS.length === 4 && PL_TAB_INCONNUS.indexOf('Lisa') >= 0);

// LE POINT QUI VALIDE LE CYCLE DE DEUX SEMAINES. Pour un préparateur, la
// semaine 50 doit répéter la 48 : c'est ce qui autorise à n'en garder que deux.
// Si une ligne y manque, c'est soit une coquille du tableur, soit quelqu'un qui
// n'est pas sur le cycle qu'on croit — dans les deux cas il faut le savoir.
console.log('\nLe cycle de deux semaines se vérifie sur le fichier lui-même');
const PREPS = ['ct:c-line-bourdon', 'ct:elodie-rivognac', 'ct:jean-claude-tran-van',
  'ct:marion-noy-e', 'ct:hortense-le-pont', 'ct:elise-lamy', 'ct:allison-courvalet',
  'ct:quentin-debons', 'ct:paloma-petit', 'ct:brunilde-marti', 'ct:mtigcvxb9hh62'];
const ecarts = PREPS.filter(k => PL_TAB_GRILLE[k] && PL_TAB_GRILLE[k][0] !== PL_TAB_GRILLE[k][2]);
t('la S50 répète la S48 pour tous les préparateurs vérifiés'
  + (ecarts.length ? ' — ÉCART : ' + ecarts.join(', ') : ''), ecarts.length === 0);
// JULIE EST LA SEULE EXCEPTION, et elle est connue : vendredi apres-midi
// travaille en S48, repos en S50. On retient la S48. C'est garde ici pour que
// la question se repose si le tableur change.
t('JULIE RESTE LA SEULE EXCEPTION — vendredi après-midi S48 ≠ S50',
  PL_TAB_GRILLE['ct:julie-nicolas'][0] === '..XXaX'
  && PL_TAB_GRILLE['ct:julie-nicolas'][2] === '..XX.X');
t('les deux congés maternité ont une semaine vide, et c’est voulu',
  PL_TAB_GRILLE['ct:hervine-lhullier'].every(m => m === '......')
  && PL_TAB_GRILLE['ct:mathilde-binet'].every(m => m === '......'));

// ── L'ancrage : la S48 est la semaine 1 ─────────────────────────────────────
console.log('\nL’ancrage — la semaine 1 tombe sur la S48');
ROTS = [{ id: 'rot:prep', longueur: 2, ancrage: '2026-09-07', rangAncrage: 1 },
        { id: 'rot:ph', longueur: 3, ancrage: '2026-09-07', rangAncrage: 1 }];
const V = { debut: PL_TAB_DEBUT, data: {} };
const prep = { id: 'ct:x', rotationId: 'rot:prep' };
const ph = { id: 'ct:y', rotationId: 'rot:ph' };
V.data['ct:x'] = { rang0: 1 }; V.data['ct:y'] = { rang0: 1 };
const rang = (c, iso) => plRangAt(c, new Date(iso + 'T12:00'), V);
t('S48 — un préparateur est en semaine 1', rang(prep, '2026-11-23') === 1);
t('S49 — il passe en semaine 2', rang(prep, '2026-11-30') === 2);
t('S50 — IL REVIENT EN SEMAINE 1, comme le dit le tableur', rang(prep, '2026-12-07') === 1);
t('S48 — un pharmacien est en semaine 1', rang(ph, '2026-11-23') === 1);
t('S49 — semaine 2', rang(ph, '2026-11-30') === 2);
t('S50 — semaine 3', rang(ph, '2026-12-07') === 3);
t('S51 — et il revient en semaine 1', rang(ph, '2026-12-14') === 1);
// LES SIX SEMAINES SONT UNE CONSEQUENCE, PAS UN STOCKAGE. On verifie que le
// couple (prep, ph) ne se repete qu'au bout de six semaines.
const couples = [];
for (let k = 0; k < 7; k++) {
  const d = plIso(plAddD(new Date(PL_TAB_DEBUT + 'T12:00'), k * 7));
  couples.push(rang(prep, d) + '/' + rang(ph, d));
}
t('LE MOTIF DE L’ÉQUIPE NE SE RÉPÈTE QU’AU BOUT DE SIX SEMAINES',
  new Set(couples.slice(0, 6)).size === 6 && couples[6] === couples[0]);

// ── Les heures ──────────────────────────────────────────────────────────────
console.log('\nLes heures viennent de PILOT, jamais du fichier');
const C = { id: 'ct:z', nom: 'Essai', rotationId: 'rot:prep', sem: {
  '1': { lun: ['9h-12h30', '14h-19h30'], mar: ['9h-12h30', '14h-18h30'], sam: ['9h-12h30', null] },
  '2': { lun: ['8h30-12h30', '14h-19h30'], mer: [null, '14h-17h30'] }
} };
const connus = plTabConnus(C);
t('on relit tout ce que le contrat sait déjà',
  connus.lun.m['1'] === '9h-12h30' && connus.lun.m['2'] === '8h30-12h30'
  && connus.mar.a['1'] === '14h-18h30' && connus.mer.a['2'] === '14h-17h30');
t('une demi-journée de repos n’entre pas dans les horaires connus',
  !connus.sam.a['1'] && !connus.mer.m['2']);
t('LE MÊME RANG PASSE D’ABORD', plTabHoraire(connus, 'lun', 'm', '2').h === '8h30-12h30');
t('... puis n’importe quel autre rang connu, plutôt qu’un horaire inventé',
  plTabHoraire(connus, 'mar', 'a', '2').h === '14h-18h30'
  && plTabHoraire(connus, 'mar', 'a', '2').pose === false);
t('UN JOUR INCONNU REÇOIT L’HORAIRE DE L’OFFICINE', plTabHoraire(connus, 'jeu', 'm', '1').h === '9h-12h30');
t('... ET LE SIGNALE — une demi-journée inventée doit être relue',
  plTabHoraire(connus, 'jeu', 'm', '1').pose === true);
t('« sauf une journée » survit : le mardi à 18h30 n’est pas écrasé',
  plTabHoraire(connus, 'mar', 'a', '1').h === '14h-18h30');

console.log('\nLa semaine type se construit à partir des deux');
const rapport = [];
const sem = plTabSem(C, ['XX.a.m', 'X.....'], 2, rapport);
t('deux rangs pour un cycle de deux semaines',
  Object.keys(sem).sort().join() === '1,2');
t('le rang 1 lit la S48, le rang 2 la S49',
  sem['1'].lun[0] === '9h-12h30' && sem['2'].mar[0] === null);
t('UNE JOURNÉE PLEINE PORTE SES DEUX HORAIRES',
  sem['1'].lun[0] === '9h-12h30' && sem['1'].lun[1] === '14h-19h30');
t('un matin seul laisse l’après-midi vide', sem['1'].sam[0] === '9h-12h30' && sem['1'].sam[1] === null);
t('UN APRÈS-MIDI SEUL LAISSE LE MATIN VIDE — c’est la forme que lit le module',
  sem['1'].jeu[0] === null && sem['1'].jeu[1] === '14h-19h30');
t('un repos est une journée à deux cases vides',
  sem['1'].mer[0] === null && sem['1'].mer[1] === null);
// Une seule demi-journee etait inconnue dans ce jeu d'essai : le jeudi
// apres-midi. Tout le reste etait deja dans la semaine type du contrat.
t('et le rapport nomme la seule demi-journée inventée',
  rapport.length === 1 && /Essai — S1 jeu après-midi/.test(rapport[0]));

console.log('\nUne semaine vide reste vide');
const vide = plTabSem({ id: 'v', nom: 'Congé', sem: {} }, ['......', '......'], 2, []);
t('aucun horaire n’est posé sur un congé',
  Object.keys(vide['1']).every(j => vide['1'][j][0] === null && vide['1'][j][1] === null));

console.log('\nCe que la reprise promet');
t('elle est réservée aux administrateurs',
  /if \(typeof isAdmin === 'function' && !isAdmin\(\)\) \{/.test(src));
t('elle demande confirmation avant d’écrire', /if \(!confirm\('Reprendre le planning du tableur/.test(src));
t('ELLE CRÉE UNE VERSION DATÉE — le passé n’est pas réécrit',
  /debut: PL_TAB_DEBUT, fin: null, typeDebut: 1/.test(src));
t('... et tout le monde y part en semaine 1 de son propre cycle',
  /rang0: 1, sem: plTabSem/.test(src));
t('la version précédente est close la veille, sans chevauchement',
  /if \(o\.debut < v\.debut && \(!o\.fin \|\| o\.fin >= v\.debut\)\) \{ o\.fin = veille;/.test(src));
t('UN CONTRAT SANS COLONNE GARDE SA SEMAINE — on ne la vide pas par omission',
  /sem: JSON\.parse\(JSON\.stringify\(c\.sem \|\| \{\}\)\)/.test(src));
t('un sortant est désactivé, jamais supprimé',
  /c\.actif = false; plStamp\(c\);/.test(src) && !/splice/.test(bloc('PL_TAB_SORTANTS.forEach', '});')));
t('le compte rendu dit combien de demi-journées ont été comblées',
  /demi-journée\(s\) sans horaire connu ont reçu/.test(src));


// ── Changer la fonction d'un collaborateur ──────────────────────────────────
// CE QUI SE JOUE. Le groupe n'est pas une étiquette. Il décide de la position
// par défaut — donc de l'effectif comptoir, celui qu'on compare aux seuils —,
// du statut de pharmacien, et de la rotation : deux semaines pour l'officine,
// trois pour les pharmaciens.
//
// Faire passer quelqu'un de « Préparateurs » à « Logistique » déplace donc
// TROIS choses d'un coup, et aucune ne se voit sur la ligne qu'on vient de
// modifier. On les annonce avant d'écrire ; c'est ce texte qui est gardé ici.
console.log('\nChanger la fonction : ce que ça entraîne');
global_('const PL_ROT_DE_GRP =', "'rot:ph' };");
global_('const PL_ROT_DEFAUT =', "'rot:prep';");
global_('const PL_GRPS = {', '\n  };');
global_('const PL_POS_DEFAUT =', "renfort: 'C' };");
global_('const PL_POS_LBL =', "A: 'Poste avancé' };");
eval(['plRotCible', 'plFonctionEffets'].map(extraire).join('\n'));

const ROTATIONS = [{ id: 'rot:prep', lbl: 'Prép', longueur: 2 },
                   { id: 'rot:ph', lbl: 'Ph', longueur: 3 }];
t('un pharmacien suit la rotation des pharmaciens', plRotCible('ph') === 'rot:ph');
t('TOUS LES AUTRES SUIVENT CELLE DE L’OFFICINE',
  ['prep', 'logi', 'secr', 'avance', 'entretien', 'renfort']
    .every(g => plRotCible(g) === 'rot:prep'));

const prepa = { nom: 'Essai', grp: 'prep', estPharmacien: false, rotationId: 'rot:prep',
                sem: { '1': {}, '2': {} } };
t('changer pour la même fonction n’annonce rien',
  plFonctionEffets(prepa, 'prep', ROTATIONS).length === 0);

const versLogi = plFonctionEffets(prepa, 'logi', ROTATIONS);
t('PASSER EN LOGISTIQUE SORT DE L’EFFECTIF COMPTOIR, et on le dit',
  versLogi.some(e => /Back-office/.test(e) && /ne compte plus dans l’effectif comptoir/.test(e)));
t('... et rien d’autre ne bouge : même rotation, toujours pas pharmacien',
  versLogi.length === 1);

const versPh = plFonctionEffets(prepa, 'ph', ROTATIONS);
t('passer pharmacien est annoncé', versPh.some(e => /devient pharmacien/.test(e)));
t('LE CYCLE PASSE DE DEUX À TROIS SEMAINES — c’est ce qu’on oublie',
  versPh.some(e => /son cycle passe à 3 semaines/.test(e)));
t('... et la position ne bouge pas : préparateur et pharmacien sont tous deux au comptoir',
  !versPh.some(e => /position par défaut/.test(e)));
// UNE SEMAINE TYPE TROP COURTE N'EST PAS UNE ERREUR, mais il faut le dire : le
// module retombe sur la semaine 1 tant que les suivantes sont vides, et
// personne ne s'en apercevrait en regardant l'ecran.
t('ON PRÉVIENT QUE LA SEMAINE TYPE NE COUVRE PAS LE NOUVEAU CYCLE',
  versPh.some(e => /n’en couvre que 2/.test(e) && /reprendront la première/.test(e)));

const pharmacien = { nom: 'X', grp: 'ph', estPharmacien: true, rotationId: 'rot:ph',
                     sem: { '1': {}, '2': {}, '3': {} } };
const versPrep = plFonctionEffets(pharmacien, 'prep', ROTATIONS);
t('dans l’autre sens, on cesse d’être pharmacien',
  versPrep.some(e => /n’est plus marqué pharmacien/.test(e)));
t('... et le cycle redescend à deux semaines',
  versPrep.some(e => /son cycle passe à 2 semaines/.test(e)));
t('UNE SEMAINE TYPE PLUS LONGUE QUE LE CYCLE NE FAIT PAS D’ALERTE — rien ne manque',
  !versPrep.some(e => /n’en couvre que/.test(e)));

const esth = { nom: 'Y', grp: 'prep', estPharmacien: false, rotationId: 'rot:prep', sem: {} };
t('vers le poste avancé : la position change, et la semaine vide n’alerte pas',
  plFonctionEffets(esth, 'avance', ROTATIONS).some(e => /Poste avancé/.test(e))
  && !plFonctionEffets(esth, 'avance', ROTATIONS).some(e => /n’en couvre que/.test(e)));
t('un contrat absent ne fait pas tomber la lecture',
  plFonctionEffets(null, 'ph', ROTATIONS).length === 0
  && plFonctionEffets(prepa, '', ROTATIONS).length === 0);
t('et une liste de rotations vide n’invente aucun cycle',
  !plFonctionEffets(prepa, 'ph', []).some(e => /cycle/.test(e)));

console.log('\nCe que l’écran promet');
t('les sept fonctions de la maison sont proposées', Object.keys(PL_GRPS).length === 7);
t('LA FONCTION EST MODIFIABLE — un menu, plus un simple texte affiché',
  /onchange="plSetGrp\(/.test(src) && !/\+ '<td>' \+ plEsc\(c\.role \|\| ''\) \+ '<\/td>'/.test(src));
t('l’intitulé du poste se corrige à côté, et ne décide de rien',
  /onchange="plSetRole\(/.test(src) && /L'INTITULE EST LIBRE, et il ne decide de rien/.test(src));
t('les deux sont réservés aux administrateurs',
  /plSetGrp = function \(cid, grp\) \{\n\s*if \(!plGarde\(\)\)/.test(src)
  && /plSetRole = function \(cid, v\) \{\n\s*if \(!plGarde\(\)\)/.test(src));
t('UN REFUS REDESSINE L’ÉCRAN — sinon le menu resterait sur un choix non appliqué',
  (src.match(/\{ plRegRender\(\); return; \}/g) || []).length >= 3);
t('le changement est confirmé, avec ses conséquences',
  /if \(!confirm\('Changer la fonction de ' \+ c\.nom/.test(src)
  && /Ce que cela entraîne/.test(src));
t('le statut de pharmacien suit la fonction, il ne se règle pas à part',
  /c\.estPharmacien = \(grp === 'ph'\);/.test(src));
t('... et la rotation aussi', /const rot = L\('rotations'\)\.find\(r => r\.id === plRotCible\(grp\)\);/.test(src));
t('l’intitulé est borné — une fiche n’est pas un carnet',
  /\.trim\(\)\.slice\(0, 60\)/.test(src));

console.log('\n' + ok + ' vérifications, ' + ko + ' échec(s)\n');
process.exit(ko ? 1 : 0);
