// HARMONISER LES CONTRATS ET LES COLLABORATEURS.
// node essais/harmonisation-contrats.js
//
// CE QUI SE JOUE. Olivier, le 28/10/2026 : « on crée un nouvel opérateur dans
// pilot. une fois dans planning, on ajoute un contrat, on choisit un opérateur
// disponible et on édite son contrat : trame horaire, poste etc... » — un seul
// chemin, du compte intranet jusqu'aux horaires.
//
// Il y avait DEUX listes de métiers qui ne se recouvraient pas : six libellés
// en texte libre dans la fiche collaborateur, sept fonctions en code dans le
// planning. Trois conséquences, toutes muettes :
//
//   1. UN LOGISTICIEN DEVENAIT PRÉPARATEUR. La création d'un contrat ne
//      reconnaissait que « pharmacien » et mettait tout le reste en
//      préparateur — donc au comptoir, donc compté dans l'effectif. Personne
//      ne pouvait le voir : la ligne s'affichait au bon endroit.
//   2. LA « SOURCE DE VÉRITÉ » N'AVAIT AUCUN BOUTON. Le poste ne se choisissait
//      qu'à la création du compte et ne se corrigeait plus jamais.
//   3. SUPPRIMER UN COMPTE LAISSAIT SON CONTRAT — et les heures déjà comptées —
//      sans titulaire.
//
// La décision d'Olivier : la fiche collaborateur fait foi. Un seul réglage
// stocké, deux écrans pour le corriger, et ils ne peuvent plus se contredire.
const fs = require('fs'), path = require('path');
const lire = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const src = lire('public/pl-module.js');
const html = lire('public/index.html');

function extraire(nom) {
  const d = src.indexOf('  function ' + nom + '(');
  if (d < 0) throw new Error('fonction introuvable : ' + nom);
  const finLigne = src.indexOf('\n', d);
  if (src.slice(d, finLigne).trimEnd().endsWith('}')) return src.slice(d, finLigne);
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

let ok = 0, ko = 0;
const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };
console.log('\nHARMONISATION CONTRATS ⇄ COLLABORATEURS\n');

// ── 1. Un seul vocabulaire ──────────────────────────────────────────────────
console.log('Une seule liste de fonctions, pour les deux écrans');
eval(bloc('const PL_GRPS = {', '\n  };').replace(/^\s*const /, 'globalThis.'));
eval(bloc('const PL_ROT_DE_GRP =', "// tout le reste suit l'officine").replace(/^\s*const /, 'globalThis.'));
eval(bloc('const PL_ROT_DEFAUT =', "'rot:prep';").replace(/^\s*const /, 'globalThis.'));
eval(['plFonctionsOrdre', 'plRotCible', 'plEsc', 'plNorm'].map(extraire).join('\n'));

const CLES = plFonctionsOrdre();
t('les sept fonctions du planning sont là', CLES.length === 7);
t('CHACUNE A UN LIBELLÉ AU SINGULIER — on nomme une personne, pas un groupe',
  CLES.every(k => PL_GRPS[k].un && PL_GRPS[k].un.length > 2));
t('... et un pluriel pour le titre de son groupe',
  CLES.every(k => PL_GRPS[k].lbl && PL_GRPS[k].lbl.length > 2));
t('elles sont rangées dans l’ordre du planning',
  CLES[0] === 'ph' && CLES[1] === 'prep' && CLES[6] === 'renfort');
t('LA FICHE COLLABORATEUR SERT CETTE LISTE-LÀ, et pas une copie',
  /window\.plFonctionsListe = function/.test(src)
  && /plFonctionsOrdre\(\)\.map\(k => \(\{ k: k, lbl: PL_GRPS\[k\]\.un/.test(src));
t('... et l’intranet la demande au planning au lieu d’en écrire une',
  /window\.plFonctionsListe\?window\.plFonctionsListe\(\):null/.test(html));
t('L’ENTRETIEN EXISTE DES DEUX CÔTÉS — il manquait à la fiche',
  !!PL_GRPS.entretien && /<option>Entretien<\/option>/.test(html));

// ── 2. Lire le poste d'une ancienne fiche ───────────────────────────────────
// ON NE REECRIT RIEN EN BASE (piege n°7) : les fiches remplies avant la liste
// commune portent un libelle libre, qu'on traduit a la lecture.
console.log('\nLes anciennes fiches se lisent sans être réécrites');
eval(['plFonctionDuTexte', 'plFonctionDe', 'plFonctionExplicite', 'plNomDeStaff', 'plNomAccord'].map(extraire).join('\n'));
t('« Pharmacien » → pharmacien', plFonctionDuTexte('Pharmacien') === 'ph');
t('« Préparatrice » aussi, le féminin compris', plFonctionDuTexte('Préparatrice') === 'prep');
t('UN LOGISTICIEN EST UN LOGISTICIEN — c’était le défaut',
  plFonctionDuTexte('Logisticien') === 'logi');
t('« Secrétaire » → secrétariat', plFonctionDuTexte('Secrétaire') === 'secr');
t('« Esthéticienne » → poste avancé', plFonctionDuTexte('Esthéticienne') === 'avance');
t('« Entretien » → entretien', plFonctionDuTexte('Entretien') === 'entretien');
t('« Étudiant » → renfort', plFonctionDuTexte('Étudiant') === 'renfort');
t('un libellé qu’on ne reconnaît pas ne devine rien',
  plFonctionDuTexte('Chef de rayon') === null && plFonctionDuTexte('') === null
  && plFonctionDuTexte(null) === null);
t('LE CODE EXPLICITE GAGNE SUR LE LIBELLÉ — c’est lui qu’on a choisi',
  plFonctionDe({ fonction: 'logi', poste: 'Préparateur' }) === 'logi');
t('... et un code inconnu retombe sur le libellé',
  plFonctionDe({ fonction: 'nawak', poste: 'Préparateur' }) === 'prep');
t('une fiche touchée depuis est reconnue comme explicite',
  plFonctionExplicite({ fonction: 'prep' }) === true
  && plFonctionExplicite({ poste: 'Préparateur' }) === false
  && plFonctionExplicite(null) === false);

// ── 3. Le nom ───────────────────────────────────────────────────────────────
console.log('\nUn nom plus court n’est pas une contradiction');
t('le nom du compte se met en forme',
  plNomDeStaff({ prenom: 'Anouck', nom: 'FERRAN' }) === 'Anouck Ferran');
t('un compte sans nom de famille ne laisse pas d’espace',
  plNomDeStaff({ prenom: 'Lisa', nom: '' }) === 'Lisa');
t('« ANOUCK » ET « ANOUCK FERRAN » SONT D’ACCORD — la grille est étroite',
  plNomAccord('Anouck', { prenom: 'Anouck', nom: 'Ferran' }) === true);
t('... dans les deux sens',
  plNomAccord('Anouck Ferran', { prenom: 'Anouck', nom: 'Ferran' }) === true);
t('les accents et la casse ne font pas une divergence',
  plNomAccord('Celine Bourdon', { prenom: 'Céline', nom: 'BOURDON' }) === true);
t('DEUX NOMS QUI SE CONTREDISENT, SI',
  plNomAccord('Céline Bourdon', { prenom: 'Élodie', nom: 'Rivognac' }) === false);
t('un prénom qui en commence un autre ne passe pas pour lui',
  plNomAccord('Marion', { prenom: 'Marionne', nom: 'Dupont' }) === false);
t('sans compte relié, il n’y a rien à contredire',
  plNomAccord('Qui que ce soit', null) === true);

// ── 4. Un contrat neuf prend la fonction de la fiche ───────────────────────
console.log('\nUn contrat neuf prend la fonction de la fiche');
let CONTRATS = [], ROTS = [
  { id: 'rot:prep', lbl: 'Prép', longueur: 2 },
  { id: 'rot:ph', lbl: 'Ph', longueur: 3 }
];
let STAFF = [];
let SAUVE = 0;
globalThis.L = (n) => n === 'contrats' ? CONTRATS : n === 'rotations' ? ROTS : [];
globalThis.plContrats = CONTRATS;
globalThis.staffDB = STAFF;
globalThis.plStamp = (o) => { o.updatedAt = Date.now(); return o; };
globalThis.plPersist = () => { SAUVE++; };
globalThis.plNewId = (p) => p + ':' + (CONTRATS.length + 1);
eval(['plStaffList', 'plStaffOf', 'plContratDeStaff', 'plStaffLibres',
      'plContratNeuf', 'plAlignerContrats', 'plEcartsFiches'].map(extraire).join('\n'));

const cLogi = plContratNeuf({ id: 'BM', prenom: 'Brunilde', nom: 'MARTI', poste: 'Logisticien' });
t('UN LOGISTICIEN N’EST PLUS MIS EN PRÉPARATEUR — c’était le défaut',
  cLogi.grp === 'logi');
t('... donc il ne compte plus dans l’effectif comptoir sans qu’on le sache',
  cLogi.estPharmacien === false);
t('son nom vient du compte', cLogi.nom === 'Brunilde Marti');
t('son intitulé est proposé, pas laissé « À préciser »', cLogi.role === 'Logisticien');
t('son cycle est celui de l’officine', cLogi.rotationId === 'rot:prep');
t('sa trame est vide — c’est l’étape suivante', Object.keys(cLogi.sem).length === 0);
const cPh = plContratNeuf({ id: 'JP', prenom: 'Jules', nom: 'Palvadeau', fonction: 'ph' });
t('un pharmacien est marqué pharmacien et prend le cycle de trois semaines',
  cPh.grp === 'ph' && cPh.estPharmacien === true && cPh.rotationId === 'rot:ph');
t('sans fonction lisible, on retombe sur préparateur — le cas le plus courant',
  plContratNeuf({ id: 'XX', prenom: 'Sans', nom: 'Poste' }).grp === 'prep');

// ── 5. Les collaborateurs encore disponibles ───────────────────────────────
console.log('\nLes collaborateurs qu’on peut encore mettre au planning');
CONTRATS.length = 0; STAFF.length = 0;
STAFF.push({ id: 'AA', prenom: 'Ancien', nom: 'Un' },
           { id: 'BB', prenom: 'Parti', nom: 'Deux' },
           { id: 'CC', prenom: 'Dernier', nom: 'Créé' });
CONTRATS.push({ id: 'ct:1', nom: 'Ancien Un', grp: 'prep', staffId: 'AA', actif: true, sem: {} },
              { id: 'ct:2', nom: 'Parti Deux', grp: 'prep', staffId: 'BB', actif: false, sem: {} });
const libres = plStaffLibres();
t('celui qui a un contrat actif n’est pas proposé', !libres.some(x => x.id === 'AA'));
t('celui qui a été retiré du planning, SI — c’est ainsi qu’on le remet',
  libres.some(x => x.id === 'BB'));
t('LE DERNIER CRÉÉ ARRIVE EN TÊTE — c’est celui qu’on vient de saisir',
  libres[0] && libres[0].id === 'CC');
t('la liste ne retourne pas celle des collaborateurs au passage', STAFF[0].id === 'AA');
t('on retrouve l’ancien contrat d’une personne retirée',
  (plContratDeStaff('BB', true) || {}).id === 'ct:2'
  && plContratDeStaff('BB', false) === null);

// ── 6. L'alignement ─────────────────────────────────────────────────────────
// LA FICHE FAIT FOI, mais seulement quand elle a ete choisie dans la liste
// commune. Une fonction devinee d'un vieux libelle est signalee, jamais
// imposee : sinon le premier chargement deplacerait dix-neuf lignes tout seul.
console.log('\nLa fiche fait foi — mais seulement quand elle est explicite');
CONTRATS.length = 0; STAFF.length = 0; SAUVE = 0;
STAFF.push({ id: 'BM', prenom: 'Brunilde', nom: 'Marti', fonction: 'logi', poste: 'Logisticien' },
           { id: 'CB', prenom: 'Céline', nom: 'Bourdon', poste: 'Logisticien' },
           { id: 'JP', prenom: 'Jules', nom: 'Palvadeau', fonction: 'ph', poste: 'Pharmacien' },
           { id: 'ZZ', prenom: 'Partie', nom: 'Ailleurs', fonction: 'ph', poste: 'Pharmacien' });
CONTRATS.push(
  { id: 'c1', nom: 'Brunilde Marti', grp: 'prep', estPharmacien: false, rotationId: 'rot:prep', staffId: 'BM', actif: true, sem: {} },
  { id: 'c2', nom: 'Céline Bourdon', grp: 'prep', estPharmacien: false, rotationId: 'rot:prep', staffId: 'CB', actif: true, sem: {} },
  { id: 'c3', nom: 'Jules Palvadeau', grp: 'prep', estPharmacien: false, rotationId: 'rot:prep', staffId: 'JP', actif: true, sem: {} },
  { id: 'c4', nom: 'Partie Ailleurs', grp: 'prep', estPharmacien: false, rotationId: 'rot:prep', staffId: 'ZZ', actif: false, sem: {} });
t('un changement a bien eu lieu', plAlignerContrats() === true);
t('LA FONCTION EXPLICITE EST APPLIQUÉE', CONTRATS[0].grp === 'logi');
t('UNE FONCTION DEVINÉE N’EST PAS IMPOSÉE — rien ne bouge le premier jour',
  CONTRATS[1].grp === 'prep');
t('devenir pharmacien emporte le statut ET le cycle',
  CONTRATS[2].grp === 'ph' && CONTRATS[2].estPharmacien === true
  && CONTRATS[2].rotationId === 'rot:ph');
t('UN CONTRAT RETIRÉ N’EST PAS TOUCHÉ — on ne réveille pas ce qui dort',
  CONTRATS[3].grp === 'prep');
t('la sauvegarde n’a été demandée qu’une fois', SAUVE === 1);
t('ET L’ALIGNEMENT EST IDEMPOTENT — il tourne à chaque chargement',
  plAlignerContrats() === false && SAUVE === 1);
t('il tourne justement au chargement, après le rapprochement par le nom',
  /plLinkStaff\(\);\n\s*plAlignerContrats\(\);/.test(src));

console.log('\nCe que les deux écrans ne disent pas pareil est affiché');
t('la fonction devinée mais non appliquée est signalée',
  plEcartsFiches().some(x => x.cid === 'c2' && x.quoi === 'fonction' && x.dit === 'logi'));
t('un contrat retiré n’encombre pas la liste', !plEcartsFiches().some(x => x.cid === 'c4'));
CONTRATS[0].nom = 'Brunilde';
t('UN NOM RACCOURCI N’EST PAS SIGNALÉ', !plEcartsFiches().some(x => x.cid === 'c1'));
CONTRATS[0].nom = 'Quelqu’un d’autre';
t('un nom qui contredit le compte, si',
  plEcartsFiches().some(x => x.cid === 'c1' && x.quoi === 'nom' && x.dit === 'Brunilde Marti'));
t('LE NOM N’EST JAMAIS RÉÉCRIT TOUT SEUL — renommer une ligne en silence, non',
  !/c\.nom = plNomDeStaff\(st\)/.test(bloc('function plAlignerContrats()', '\n  }\n'))
  && /window\.plAlignerNom = function/.test(src));

// ── 7. Un seul réglage stocké ───────────────────────────────────────────────
console.log('\nLa fonction est le même réglage des deux côtés');
t('changer la fonction au planning écrit la fiche',
  /st\.fonction = grp; st\.poste = PL_GRPS\[grp\]\.un;/.test(src));
t('... et rafraîchit la carte du collaborateur', /typeof renderStaff === 'function'/.test(src));
t('CHANGER LE POSTE DANS LA FICHE PASSE PAR LE PLANNING, qui annonce les suites',
  /if\(ct&&typeof plSetGrp==='function'&&ct\.grp!==k\)\{ plSetGrp\(ct\.id,k\); renderStaff\(\); return; \}/.test(html));
t('... et sans contrat au planning, la fiche s’écrit seule',
  /s\.fonction=k; s\.poste=f\.lbl; s\.updatedAt=Date\.now\(\);\n\s*renderStaff\(\); schedSave\(\);/.test(html));
t('LA FICHE A ENFIN UN BOUTON — le poste se figeait après la création',
  /function posteHtml\(s, admin\)/.test(html) && /\$\{posteHtml\(s, admin\)\}/.test(html));
t('... réservé aux administrateurs',
  /if\(!isAdmin\(\)\)\{ alert\('Action réservée aux administrateurs\.'\); renderStaff\(\); return; \}/.test(html));
t('le poste enregistré à la création porte son code', /fonction:_lp\?_lp\.k:undefined/.test(html));
t('relier un compte accepte ce que sa fiche dit du poste',
  /c\.staffId = sid \|\| null; plStamp\(c\);[\s\S]{0,120}plAlignerContrats\(\);/.test(src));

// ── 8. Supprimer un compte encore au planning ──────────────────────────────
console.log('\nOn ne supprime pas un compte qui porte un contrat');
const delSrc = (function () {
  const d = html.indexOf('function deleteStaff(id){');
  return html.slice(d, html.indexOf('\n}', d));
})();
t('LA SUPPRESSION EST REFUSÉE tant que le contrat est actif',
  /plContrats\.find\(x=>x&&x\.staffId===id&&x\.actif!==false\)/.test(delSrc)
  && /if\(_ct\)\{/.test(delSrc));
t('... et elle dit où retirer la personne du planning',
  /Planning → Réglages → Contrats/.test(delSrc));
t('... en promettant que rien n’est détruit', /Rien n'est détruit/.test(delSrc));
t('LE REFUS ARRIVE AVANT LA FENÊTRE DE CONFIRMATION',
  delSrc.indexOf('if(_ct){') > 0
  && delSrc.indexOf('if(_ct){') < delSrc.indexOf("openModal('confirm-modal')"));

// ── 9. Remettre quelqu'un au planning ──────────────────────────────────────
console.log('\nRemettre quelqu’un : on demande avant de repartir de zéro');
t('reprendre l’ancien contrat le réactive sans rien recréer',
  /anc\.actif = true; plStamp\(anc\); plPersist\(\);/.test(src));
t('... et le dit : trame et compte-temps conservés',
  /contrat repris, trame et compte-temps conservés/.test(src));
t('REPARTIR DE ZÉRO EST UN SECOND BOUTON, jamais le résultat d’un Échap',
  /onclick="plFicheReprendre\(\)">Reprendre ce contrat/.test(src)
  && /onclick="plFicheNeuf\(\)">Repartir de zéro/.test(src));
t('... et on annonce ce qu’on laisserait derrière',
  /sa trame et son compte-temps ne reviendront pas/.test(src));
t('le choix s’appuie sur ce que l’ancien contrat contient vraiment',
  /const sem = Object\.keys\(anc\.sem \|\| \{\}\)\.length, sol = plSoldes\(anc\);/.test(src));

// ── 10. La fiche s'affiche vraiment ────────────────────────────────────────
// LE GARDE DU 28/10 : on EXECUTE le rendu contre un document de poche. Un
// `saOnglet is not defined` avait laisse un module entierement blanc, et aucun
// essai par expression reguliere ne l'avait vu.
console.log('\nLa fiche s’affiche — le rendu est exécuté, pas relu');
const ELS = {};
globalThis.document = {
  getElementById: (id) => ELS[id] || (ELS[id] = { id: id, innerHTML: '', textContent: '', style: {}, dataset: {}, classList: { add() { }, remove() { }, contains: () => false, toggle() { } } })
};
globalThis.plRotOf = (c) => ROTS.find(r => r.id === c.rotationId) || null;
globalThis.plHorsTemps = (c) => !!(c && c.horsTemps);
globalThis.plSoldes = () => ({ compte: -10, navette: 0, attente: 0 });
globalThis.plFmtH = (x) => (x == null ? '—' : String(x) + ' h');
globalThis.plFicheCid = null;
globalThis.plFicheSid = null;
eval(extraire('plFicheRender'));

CONTRATS.length = 0; STAFF.length = 0;
STAFF.push({ id: 'AA', prenom: 'Déjà', nom: 'Au planning', poste: 'Préparateur' },
           { id: 'BB', prenom: 'Revenante', nom: 'Marti', fonction: 'logi', poste: 'Logisticien' },
           { id: 'CC', prenom: 'Toute', nom: 'Neuve', fonction: 'prep', poste: 'Préparateur' });
CONTRATS.push({ id: 'c1', nom: 'Déjà Au planning', grp: 'prep', staffId: 'AA', actif: true, sem: { 1: {} }, rotationId: 'rot:prep' },
              { id: 'c2', nom: 'Revenante Marti', grp: 'logi', staffId: 'BB', actif: false, base: 35, sem: { 1: {}, 2: {} }, rotationId: 'rot:prep' });
plFicheRender();
let vu = ELS['pl-ct-corps'].innerHTML;
t('le rendu produit quelque chose', vu.length > 60);
t('le titre annonce l’ajout', /Ajouter un contrat/.test(ELS['pl-ct-titre'].textContent));
t('LA LISTE NE PROPOSE QUE LES COLLABORATEURS DISPONIBLES',
  /Toute Neuve/.test(vu) && !/Déjà Au planning —/.test(vu));
t('... en annonçant la fonction de chacun', /Toute Neuve — Préparateur/.test(vu));
t('LE DERNIER CRÉÉ EST EN PREMIER', vu.indexOf('Toute Neuve') < vu.indexOf('Revenante Marti'));
t('et on dit où créer quelqu’un qui n’y est pas encore',
  /Le dernier créé est en tête/.test(ELS['pl-ct-sub'].textContent));

plFicheSid = 'BB';
plFicheRender();
vu = ELS['pl-ct-corps'].innerHTML;
t('ON PRÉVIENT QU’IL Y AVAIT DÉJÀ UN CONTRAT', /a déjà eu un contrat au planning/.test(vu));
t('... et on dit ce qu’il contient',
  /2 semaines de trame remplies/.test(vu) && /base 35 h/.test(vu) && /compte-temps -10 h/.test(vu));
t('les deux issues sont offertes, aucune par défaut',
  /Reprendre ce contrat/.test(vu) && /Repartir de zéro/.test(vu));

plFicheCid = 'c1'; plFicheSid = null;
plFicheRender();
vu = ELS['pl-ct-corps'].innerHTML;
t('le titre porte le nom', /Fiche contrat — Déjà Au planning/.test(ELS['pl-ct-titre'].textContent));
t('le compte intranet est montré', /\(AA\)/.test(vu));
t('la fonction est un menu des sept',
  (vu.match(/<option value="(ph|prep|avance|secr|logi|entretien|renfort)"/g) || []).length === 7);
t('ON RÈGLE LA BASE HEBDOMADAIRE', /plSetBase\('c1'/.test(vu) && /Temps décompté/.test(vu));
t('ON RÈGLE LES HORAIRES — c’est l’étape suivante d’Olivier',
  /plEditTrame\('c1'\)/.test(vu) && /Régler les horaires/.test(vu));
t('... et on dit combien de semaines sont remplies', /1 semaine remplie/.test(vu));
t('le cycle est affiché, déduit de la fonction', /Prép/.test(vu) && /2 semaines/.test(vu));
t('on peut retirer la personne du planning depuis la fiche', /plContratRetirer\('c1'\)/.test(vu));

CONTRATS[0].sem = {};
plFicheRender();
t('UNE TRAME VIDE EST ANNONCÉE — sinon la ligne n’apparaît nulle part',
  /n’apparaîtra sur aucun planning/.test(ELS['pl-ct-corps'].innerHTML));

plFicheCid = 'disparu';
plFicheRender();
t('un contrat disparu entre-temps ne casse pas la fenêtre',
  /n’existe plus/.test(ELS['pl-ct-corps'].innerHTML));

// ── 11. Aucun bouton ne désigne une fonction fantôme ───────────────────────
// LE SECOND GARDE DU 28/10. `onclick="plX(…)"` fait lire la meme chaine par
// deux analyseurs : le notre, et celui du navigateur. Si `plX` n'est pas sur
// `window`, le clic ne fait rien — en silence.
console.log('\nAucun bouton ne désigne une fonction qui n’existe pas');
const EXPOSEES = new Set((src.match(/window\.(pl[A-Za-z]+)\s*=/g) || [])
  .map(m => /window\.(pl[A-Za-z]+)/.exec(m)[1]));
const CITEES = new Set((src.match(/(?:onclick|onchange|oninput|onkeydown|onmousedown)="[^"]*?\b(pl[A-Za-z]+)\(/g) || [])
  .map(m => /\b(pl[A-Za-z]+)\(/.exec(m)[1]));
const orphelines = [...CITEES].filter(f => !EXPOSEES.has(f));
t('les ' + CITEES.size + ' gestionnaires cités sont tous exposés sur window'
  + (orphelines.length ? ' — ORPHELINES : ' + orphelines.join(', ') : ''),
  orphelines.length === 0);
t('... et il y en a bien, sinon l’essai ne vérifierait rien', CITEES.size >= 20);
t('les nouveaux boutons de la fiche en font partie',
  ['plFicheNouveau', 'plFicheOuvrir', 'plFicheChoisir', 'plFicheReprendre',
   'plFicheNeuf', 'plAlignerNom', 'plSetNom'].every(f => EXPOSEES.has(f)));
t('et dans l’intranet, le menu de la fiche appelle une fonction déclarée',
  /function setStaffFonction\(id,k\)/.test(html)
  && /onchange="setStaffFonction\(/.test(html));

// ── 12. Le chemin complet est annoncé à l'écran ────────────────────────────
console.log('\nLe chemin est écrit là où on le cherche');
t('« ＋ Ajouter un contrat » est en tête de la liste des contrats',
  /onclick="plFicheNouveau\(\)">＋ Ajouter un contrat/.test(src));
t('un clic sur un nom rouvre sa fiche', /title="Ouvrir la fiche contrat de /.test(src));
t('le compte des collaborateurs sans contrat est affiché',
  /du site sans contrat au planning/.test(src));
t('les écarts avec les fiches sont comptés en haut',
  /avec les fiches du Back Office/.test(src));
t('la note du bas raconte le chemin, du Back Office aux horaires',
  /Un collaborateur se crée dans le Back Office, son contrat se crée ici/.test(src));
t('... et dit que la fonction est le même réglage des deux côtés',
  /La fonction est le même réglage des deux côtés/.test(src));

// ── 13. L'écran Contrats s'exécute, lui aussi ──────────────────────────────
// C'est l'ecran ou tout se joue, et celui ou l'on a le plus coupe dans les
// chaines. Une apostrophe mal echappee y laisserait une page blanche, et aucune
// expression reguliere ne le verrait.
console.log('\nL’écran Contrats s’exécute');
eval(bloc('const PL_JOURS =', '];').replace(/^\s*const /, 'globalThis.'));
eval(bloc('const PL_JOURS_FR =', '];').replace(/^\s*const /, 'globalThis.'));
eval(['plCmp', 'plTit'].map(extraire).join('\n'));
globalThis.plRegView = 'c';
globalThis.plVerForce = null;
globalThis.P = () => ({});
CONTRATS.length = 0; STAFF.length = 0;
STAFF.push({ id: 'CB', prenom: 'Céline', nom: 'Bourdon', fonction: 'prep', poste: 'Préparateur', col: '#4a7' },
           { id: 'BM', prenom: 'Brunilde', nom: 'Marti', poste: 'Logisticien', col: '#74a' },
           { id: 'ML', prenom: 'Marié', nom: 'Changé', fonction: 'prep', poste: 'Préparateur', col: '#aa4' },
           { id: 'NV', prenom: 'Toute', nom: 'Neuve', fonction: 'prep', poste: 'Préparateur', col: '#a47' });
CONTRATS.push(
  { id: 'c1', nom: 'Céline Bourdon', grp: 'prep', role: 'Préparatrice', base: 35, staffId: 'CB', actif: true, sem: { 1: {}, 2: {} }, rotationId: 'rot:prep' },
  { id: 'c2', nom: 'Brunilde Marti', grp: 'prep', role: 'Logistique', base: 35, staffId: 'BM', actif: true, sem: { 1: {} }, rotationId: 'rot:prep' },
  { id: 'c3', nom: 'Ancien Nom', grp: 'prep', role: 'Préparatrice', base: 28, staffId: 'ML', actif: true, sem: { 1: {} }, rotationId: 'rot:prep' },
  { id: 'c4', nom: 'Anouck', grp: 'ph', role: 'Pharmacienne titulaire', horsTemps: true, estPharmacien: true, actif: true, sem: {}, rotationId: 'rot:ph' });
eval(extraire('plRegRender'));
plRegRender();
const ec13 = ELS['pl-reg-body'].innerHTML;
t('l’écran produit une page, pas du vide', ec13.length > 2000);
t('« ＋ AJOUTER UN CONTRAT » EST LÀ, en tête', /＋ Ajouter un contrat/.test(ec13)
  && ec13.indexOf('＋ Ajouter un contrat') < ec13.indexOf('<table'));
t('chaque nom ouvre sa fiche', (ec13.match(/plFicheOuvrir\('c\d'\)/g) || []).length >= 4);
t('LE LOGISTICIEN EST SIGNALÉ — sa fiche et son contrat ne disent pas pareil',
  /la fiche dit « Logisticien »/.test(ec13));
t('UN NOM QUI A CHANGÉ EST SIGNALÉ, avec le bouton pour le reprendre',
  /compte : Marié Changé/.test(ec13) && /plAlignerNom\('c3'\)/.test(ec13));
t('« ANOUCK » N’EST PAS SIGNALÉE — nom court, pas de compte, rien à dire',
  !/plAlignerNom\('c4'\)/.test(ec13));
t('les écarts sont comptés en haut', /2 écarts avec les fiches du Back Office/.test(ec13));
t('et le collaborateur sans contrat est annoncé',
  /1 collaborateur du site sans contrat au planning/.test(ec13));
t('les fonctions s’affichent au singulier dans le menu',
  />Préparateur</.test(ec13) && />Logisticien</.test(ec13) && !/>Préparateurs</.test(ec13));
t('on peut encore régler les horaires et retirer la personne',
  /plEditTrame\('c1'\)/.test(ec13) && /plContratRetirer\('c1'\)/.test(ec13));

console.log('\n' + ok + ' vérifications, ' + ko + ' échec(s)\n');
process.exit(ko ? 1 : 0);
