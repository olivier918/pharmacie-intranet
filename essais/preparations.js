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
  const zone = { innerHTML: '' };
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

console.log('\n' + ok + ' réussi(s), ' + ko + ' échec(s)\n');
process.exit(ko ? 1 : 0);
