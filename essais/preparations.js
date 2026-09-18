// Garde-fou du planning des préparations. Tout ce qui décide — capacité,
// report, occupation d'une journée — est extrait de public/pp-module.js :
// c'est le code réel qui est éprouvé.
// node essais/preparations.js
const fs = require('fs'), path = require('path');
global.window = {};
global.document = { getElementById: () => null, head: { appendChild: () => {} }, createElement: () => ({}) };
eval(fs.readFileSync(path.join(__dirname, '..', 'public', 'pp-module.js'), 'utf8'));
const w = global.window;

let ok = 0, ko = 0; const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };
console.log('\nPRÉPARATIONS — capacité, report, occupation\n');

// Semaine type du tableur : trois places du lundi au vendredi.
const TR = [
  { id: 'j1', places: 3, resp: 'JC' }, { id: 'j2', places: 3, resp: 'HL' },
  { id: 'j3', places: 3, resp: 'HL' }, { id: 'j4', places: 3, resp: 'JN' },
  { id: 'j5', places: 3, resp: 'JC' }, { id: 'j6', places: 0 }, { id: 'j0', places: 0 }
];
// 2026-09-14 est un lundi ; 15 mardi, 16 mercredi, 19 samedi, 20 dimanche.
const EX = [{ date: '2026-09-15', places: 0, motif: 'Pas assez de monde' }];

console.log('La trame et ses écarts');
t('la trame donne les places du jour', w.ppPlaces('2026-09-14', TR, []) === 3);
t('une exception l’emporte sur la trame', w.ppPlaces('2026-09-15', TR, EX) === 0);
t('le samedi n’est pas un jour de production', w.ppTravaille('2026-09-19', TR) === false);
t('un jour FERMÉ par exception reste un jour de production en principe',
  w.ppTravaille('2026-09-15', TR) === true && w.ppPlaces('2026-09-15', TR, EX) === 0);
t('le responsable vient de la trame', w.ppResp('2026-09-17', TR, []) === 'JN');
t('une exception peut changer le responsable',
  w.ppResp('2026-09-17', TR, [{ date: '2026-09-17', resp: 'JC' }]) === 'JC');
t('une exception sans responsable ne l’efface pas',
  w.ppResp('2026-09-17', TR, [{ date: '2026-09-17', places: 1 }]) === 'JN');
t('le motif remonte pour le comptoir', w.ppMotif('2026-09-15', TR, EX) === 'Pas assez de monde');

console.log('\nLa rotation des responsables');
// Ancrage : le lundi 14/09, c'est au premier de la liste.
const TRR = TR.map(x => x.id === 'j1' ? { id: 'j1', places: 3, resp: 'AF', ancrage: '2026-09-14' } : x);
const ROT = [{ id: 'a', ordre: 0, resp: 'JC' }, { id: 'b', ordre: 1, resp: 'HL' }, { id: 'c', ordre: 2, resp: 'JN' }];
t('lundi de la semaine d’ancrage : le premier de la liste', w.ppResp('2026-09-14', TRR, [], ROT) === 'JC');
t('TOUTE la semaine revient à la même personne',
  w.ppResp('2026-09-18', TRR, [], ROT) === 'JC' && w.ppResp('2026-09-16', TRR, [], ROT) === 'JC');
t('la semaine suivante, le suivant', w.ppResp('2026-09-21', TRR, [], ROT) === 'HL');
t('puis le troisième', w.ppResp('2026-09-28', TRR, [], ROT) === 'JN');
t('puis la liste reprend au début', w.ppResp('2026-10-05', TRR, [], ROT) === 'JC');
// Le 25/10/2026, la France repasse a l'heure d'hiver : entre deux lundis il y
// a 7 j + 1 h. Une troncature ferait deriver la rotation a partir de la.
t('LE CHANGEMENT D’HEURE NE DÉCALE PAS LA ROTATION',
  w.ppResp('2026-11-02', TRR, [], ROT) === 'HL' && w.ppResp('2026-10-26', TRR, [], ROT) === 'JC');
t('une semaine antérieure à l’ancrage tourne aussi, sans reste négatif',
  w.ppResp('2026-09-07', TRR, [], ROT) === 'JN');
t('un écart du jour l’emporte sur le roulement',
  w.ppResp('2026-09-21', TRR, [{ date: '2026-09-21', resp: 'AF' }], ROT) === 'AF');
t('sans rotation, on retombe sur la semaine type',
  w.ppResp('2026-09-14', TRR, [], []) === 'AF');
t('une rotation d’une seule personne ne bouge jamais',
  w.ppResp('2026-09-14', TRR, [], [ROT[0]]) === 'JC' && w.ppResp('2026-12-21', TRR, [], [ROT[0]]) === 'JC');
t('l’ordre de la liste fait foi, pas l’ordre du tableau',
  w.ppResp('2026-09-21', TRR, [], [ROT[2], ROT[0], ROT[1]]) === 'HL');
t('le lundi d’une date se calcule juste',
  w.ppLundi('2026-09-20') === '2026-09-14' && w.ppLundi('2026-09-14') === '2026-09-14');

console.log('\nLa semaine flottante — 5 jours ouvrés');
const J = w.ppJours('2026-09-14', TR, 5);
t('cinq jours', J.length === 5);
t('le week-end est sauté', J.join(' ') === '2026-09-14 2026-09-15 2026-09-16 2026-09-17 2026-09-18');
t('la journée fermée figure quand même — c’est le mardi gris du tableur',
  J.indexOf('2026-09-15') !== -1);
const J2 = w.ppJours('2026-09-18', TR, 5);
t('le vendredi, on voit déjà la semaine suivante',
  J2[0] === '2026-09-18' && J2[1] === '2026-09-21');

console.log('\nLe report — ce qui bouge et ce qui ne bouge pas');
const AUJ = '2026-09-17';
const enRetard = { id: 1, type: 'realisation-pharmacie', status: 'en cours', jour: '2026-09-14' };
const aVenir = { id: 2, type: 'realisation-pharmacie', status: 'en cours', jour: '2026-09-18' };
const prete = { id: 3, type: 'realisation-pharmacie', status: 'prête', jour: '2026-09-14' };
t('une préparation à venir reste sur sa date',
  w.ppJourEffectif(aVenir, AUJ, TR, []) === '2026-09-18');
t('une préparation en cours dont le jour est passé se reporte à aujourd’hui',
  w.ppJourEffectif(enRetard, AUJ, TR, []) === AUJ);
t('LA DATE PRÉVUE N’EST PAS RÉÉCRITE', enRetard.jour === '2026-09-14');
t('le retard est donc mesurable', w.ppJoursRetard(enRetard, AUJ) === 3);
t('... et il ne repart pas de zéro le lendemain',
  w.ppJoursRetard(enRetard, '2026-09-18') === 4);
t('une préparation « prête » n’est plus en retard : la production a eu lieu',
  w.ppEnRetard(prete, AUJ) === false && w.ppJourEffectif(prete, AUJ, TR, []) === '2026-09-14');
t('si aujourd’hui est fermé, le report va au jour ouvert suivant',
  w.ppJourEffectif({ type: 'realisation-pharmacie', status: 'en cours', jour: '2026-09-11' },
    '2026-09-15', TR, EX) === '2026-09-16');

console.log('\nCe qui occupe une place, et ce qui n’en occupe pas');
const LP = [
  enRetard, aVenir,
  { id: 4, type: 'realisation-kerangal', status: 'en cours', jour: '2026-09-17' },
  { id: 5, type: 'realisation-pharmacie', status: 'abandonnée', jour: '2026-09-17' },
  { id: 6, type: 'realisation-pharmacie', status: 'en cours', jour: '2026-09-17' }
];
const duJour = w.ppDuJour('2026-09-17', LP, AUJ, TR, []);
t('Kerangal n’occupe aucune place', duJour.every(p => p.type === 'realisation-pharmacie'));
t('une préparation abandonnée rend sa place', duJour.every(p => p.status !== 'abandonnée'));
t('la reportée ET la prévue du jour occupent la journée', duJour.length === 2);
t('la reportée est affichée EN TÊTE — sinon elle se perd sous les nouvelles',
  duJour[0].id === 1);
t('il reste une place', w.ppLibres('2026-09-17', LP, AUJ, TR, []) === 1);

console.log('\nLes cas où un compteur pourrait mentir');
const troisTard = ['2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11'].map((d, i) =>
  ({ id: 10 + i, type: 'realisation-pharmacie', status: 'en cours', jour: d }));
t('quatre reportées sur une journée de trois places : jamais de place négative',
  w.ppLibres('2026-09-17', troisTard, AUJ, TR, []) === 0);
t('... et les quatre restent affichées, aucune n’est perdue',
  w.ppDuJour('2026-09-17', troisTard, AUJ, TR, []).length === 4);
t('le compteur de retards les voit toutes', w.ppRetards(troisTard, AUJ).length === 4);
t('une préparation sans jour ne casse rien',
  w.ppJourEffectif({ type: 'realisation-pharmacie', status: 'en cours' }, AUJ, TR, []) === null);
t('une trame vide ne produit aucun jour', w.ppJours(AUJ, [], 5).length === 0);

console.log('\nLa coche « fait »');
const faite = { id: 20, type: 'realisation-pharmacie', status: 'prête', jour: '2026-09-14', faitLe: '2026-09-17', faitPar: 'HL' };
t('une préparation prête est « faite »', w.ppFait(faite) === true);
t('une préparation délivrée aussi',
  w.ppFait({ status: 'délivrée' }) === true && w.ppFait({ status: 'en cours' }) === false);
t('COCHER NE LA FAIT PAS DISPARAÎTRE : elle s’affiche le jour où le travail a eu lieu',
  w.ppJourEffectif(faite, AUJ, TR, []) === '2026-09-17');
t('... et la date promise au patient reste intacte', faite.jour === '2026-09-14');
t('une fiche ancienne, sans faitLe, retombe sur sa date',
  w.ppJourEffectif({ type: 'realisation-pharmacie', status: 'prête', jour: '2026-09-14' }, AUJ, TR, []) === '2026-09-14');
t('une préparation faite n’est plus comptée en retard', w.ppRetards([faite], AUJ).length === 0);
t('elle occupe toujours sa place : le travail a bien eu lieu',
  w.ppDuJour('2026-09-17', [faite], AUJ, TR, []).length === 1);

console.log('\nLe rendu ne tombe pas, et dit ce qu’il doit dire');
(function () {
  // `style` : le repli montre puis cache ce conteneur. Un faux DOM sans style
  // n'est pas un defaut du code, c'est un faux DOM incomplet.
  const zone = { innerHTML: '', style: {} };
  global.document.getElementById = id => (id === 'pp-planning' ? zone : null);
  global.preps = [enRetard, { id: 30, type: 'realisation-pharmacie', status: 'en cours', jour: '2026-09-17', nom: 'MULLER', prenom: 'Jérôme' }, faite];
  global.prepTrame = TR;
  // L'exception doit tomber DANS la semaine affichee : EX ferme le 15,
  // qui est deja passe quand on est le 17. Un ecart dans le passe ne se
  // voit pas — et c'est normal, la semaine est flottante.
  global.prepExceptions = [{ date: '2026-09-18', places: 0, motif: 'Pas assez de monde' }];
  global.staffName = x => String(x || '');
  global.isAdmin = () => true;
  const vrai = w.ppAujourdhui; w.ppAujourdhui = () => AUJ;
  try {
    w.ppRendPlanning();
    const h = zone.innerHTML;
    t('le tableau est produit', /<table class="pp-t"/.test(h));
    t('les cinq colonnes du tableur sont là',
      /OP/.test(h) && /Patient/.test(h) && /Prép/.test(h) && /Fait par/.test(h) && /Responsable/.test(h));
    t('la journée fermée affiche son motif', /Pas assez de monde/.test(h));
    t('une coche « fait » est proposée', /ppCocherFait\(/.test(h));
    t('un bouton de déplacement est proposé', /ppDeplacer\(/.test(h));
    t('la reportée porte sa couleur et son étiquette',
      /pp-ret/.test(h) && /de retard/.test(h));
    t('les gestionnaires ne reçoivent que des indices, jamais de texte',
      !/onclick="pp[A-Za-z]+\('[^0-9]/.test(h));
  } finally { w.ppAujourdhui = vrai; }
})();

console.log('\nLe SMS proposé quand la préparation est faite');
// On éprouve le message avec les fonctions de l'application elle-même :
// smsPlain et smsSegments, extraites de public/index.html.
(function () {
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const bout = (n, fin) => { const d = page.indexOf('function ' + n + '('); return page.slice(d, page.indexOf(fin, d) + fin.length); };
  // smsSegments s'appuie sur les deux tables GSM-7 : on les prend aussi,
  // telles quelles. Recopier la table serait la meilleure facon de tester
  // autre chose que ce que l'application fait vraiment.
  const ligne = n => { const d = page.indexOf('const ' + n + '='); return page.slice(d, page.indexOf('\n', d)); };
  // `const` declare dans un eval ne sort pas de son eval : on les pose sur
  // l'objet global pour que smsSegments, evalé a part, les voie.
  eval(ligne('SMS_GSM7_EXT').replace('const ', 'global.'));
  eval(ligne('SMS_GSM7').replace('const ', 'global.'));
  eval(bout('smsPlain', '\n}'));
  eval(bout('smsSegments', '\n}'));

  const txt = w.ppTexteSmsPret('Marie-José');
  t('le prénom est repris', /Marie-José/.test(txt));
  t('sans prénom, la phrase reste correcte', /^Bonjour, votre/.test(w.ppTexteSmsPret('')));
  t('le numéro de la pharmacie y figure — l’expéditeur est alphanumérique, on ne peut pas répondre',
    /02 31 52 15 71/.test(txt));

  // Le piege a credits : un seul caractere hors GSM-7 fait basculer tout le
  // message en Unicode, 70 caracteres par segment au lieu de 160.
  t('AUCUN caractère hors GSM-7 : ê â î ô û œ et apostrophes typographiques',
    !/[êâîôûœ’…–—]/.test(txt));
  t('le texte ne change pas en passant par smsPlain — il est déjà propre',
    smsPlain(txt) === txt);
  const seg = smsSegments(txt);
  // `uni` est LE controle qui compte : c'est l'application elle-meme qui
  // declare le basculement en Unicode, pas ma liste de caracteres.
  t('le message reste en GSM-7 — pas de bascule Unicode', seg.uni === false);
  t('un seul SMS, donc un seul crédit (' + seg.len + ' caractères sur 160)', seg.parts === 1);
  const longue = smsSegments(w.ppTexteSmsPret('Anne-Charlotte'));
  t('même avec un prénom long, on reste à un SMS', longue.parts === 1 && longue.uni === false);
  // Le contre-exemple : un seul ê suffirait a doubler le cout.
  const piege = smsSegments(txt.replace('réalisée', 'prête'));
  t('CONTRE-ÉPREUVE : un seul ê ferait basculer le message en Unicode', piege.uni === true);

  // La regle du depot : jamais de nom de specialite dans un SMS. Ce message
  // ne doit parler que du FAIT que la preparation est prete.
  t('aucun nom de préparation ni de médicament',
    !/(mg\b|gélule|crème|suppositoire|solution|comprim|formule)/i.test(txt));
})();

// ── Modifier une demande pas encore realisee ────────────────────────────────
// Les regles viennent de public/index.html lui-meme : la limite de la
// modification, et le statut qui suit le changement de type.
(function () {
  const ix = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  function bloc(nom) {
    const d = ix.indexOf('\nfunction ' + nom + '(');
    if (d < 0) throw new Error('introuvable : ' + nom);
    const une = ix.slice(d + 1).split('\n')[0];
    if (/^function [^(]+\([^)]*\)\s*\{.*\}$/.test(une)) return une;
    const f = ix.indexOf('\n}\n', d);
    return ix.slice(d + 1, f + 2);
  }
  eval(/const PREP_TYPES=\{[\s\S]*?\n\};/.exec(ix)[0].replace('const', 'var'));
  eval(/const PREP_STATUSES=\[.*?\];/.exec(ix)[0].replace('const', 'var'));
  eval(bloc('prepModifiable'));

  console.log('\nModifier une demande — jusqu’où');
  t('une demande en cours se modifie', prepModifiable({ status: 'en cours' }));
  t('une demande en attente de devis aussi', prepModifiable({ status: 'attente devis' }));
  t('une demande PRÉPARÉE ne se modifie plus', !prepModifiable({ status: 'prête' }));
  t('une demande délivrée non plus', !prepModifiable({ status: 'délivrée' }));
  t('une demande abandonnée non plus', !prepModifiable({ status: 'abandonnée' }));
  t('rien du tout ne se modifie pas', !prepModifiable(null));
  // La limite est la REALISATION : passe cette etape, la fiche ne decrit plus
  // une intention mais ce qu'il y a dans le flacon.
  t('la limite est bien la réalisation, pas la délivrance',
    PREP_STATUSES.indexOf('prête') < PREP_STATUSES.indexOf('délivrée')
    && !prepModifiable({ status: 'prête' }));

  // Le statut suit le type : la regle telle qu'elle est ecrite dans savePrep.
  function statutApres(type, p) {
    if (PREP_TYPES[type].devis && !p.devisValideAt) return 'attente devis';
    if (!PREP_TYPES[type].devis && p.status === 'attente devis') return 'en cours';
    return p.status;
  }
  // ── Ce qui change une demande DOIT l'enregistrer ──────────────────────────
  // La resynchronisation des huit secondes remplace `preps` par la copie
  // serveur. Une action qui modifie la liste sans enregistrer ne survit donc
  // que si une AUTRE action de l'application enregistre entre-temps — ce qui
  // arrive souvent, et masque la faute jusqu'au jour ou ca n'arrive pas.
  // C'est ce garde-fou qui l'a trouvee sur trois fonctions d'un coup.
  console.log('\nRien ne change une demande sans l’enregistrer');
  [['savePrep', 'la création'], ['abandonPrep', 'l’abandon'], ['askPrepStep', 'le franchissement d’une étape']]
    .forEach(function (x) {
      t(x[1] + ' appelle saveNow()', /\bsaveNow\(\)/.test(bloc(x[0])));
    });

  console.log('\nChanger le type d’une demande');
  t('passer à un devis remet en attente du devis',
    statutApres('devis-kerangal', { status: 'en cours' }) === 'attente devis');
  t('sortir du devis remet en cours',
    statutApres('realisation-pharmacie', { status: 'attente devis' }) === 'en cours');
  t('un devis déjà validé ne se redemande pas',
    statutApres('devis-kerangal', { status: 'en cours', devisValideAt: '2026-09-10' }) === 'en cours');
  t('changer entre deux types sans devis ne touche à rien',
    statutApres('realisation-kerangal', { status: 'en cours' }) === 'en cours');
})();

console.log('\n' + ok + ' réussi(s), ' + ko + ' échec(s)\n');
process.exit(ko ? 1 : 0);
