// PERFADOM — les forfaits, l'échéancier, et ce qui se facture.
// node essais/perfadom.js
//
// CE QUI SE JOUE. Une perfusion à domicile se facture en forfaits, à terme
// échu, semaine par semaine. Se tromper coûte deux fois : un forfait oublié ne
// se rattrape pas, un forfait de trop revient en indu. Les règles ne sont pas
// compliquées, elles sont NOMBREUSES — et c'est exactement ce qu'une machine
// tient mieux qu'une tête, à condition qu'on les ait écrites quelque part.
//
// Ce fichier est ce quelque part. Chaque vérification porte le cas réel qu'elle
// défend : l'Aclasta annuel, l'antibiothérapie de quatorze jours, l'entretien
// de PICC line, la cure qui revient trop tôt.
const path = require('path');
const M = require(path.join(__dirname, '..', 'public', 'pf-moteur.js'));

let ok = 0, ko = 0;
const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };
const codes = e => e.lignes.map(l => l.num).join('+');

console.log('\nPERFADOM — FORFAITS ET ÉCHÉANCIER\n');

// ── Le calendrier ──────────────────────────────────────────────────────────
console.log('La semaine court à partir de la première perfusion');
t('une cure de 14 jours fait deux semaines pleines',
  M.pfSemaines({ debut: '2026-11-02', fin: '2026-11-15' }).length === 2);
t('... la première du 02 au 08', M.pfSemaines({ debut: '2026-11-02', fin: '2026-11-15' })[0].au === '2026-11-08');
t('... la seconde du 09 au 15', M.pfSemaines({ debut: '2026-11-02', fin: '2026-11-15' })[1].du === '2026-11-09');
t('une cure de 10 jours fait une semaine pleine et une semaine de 3 jours', (function () {
  const s = M.pfSemaines({ debut: '2026-11-02', fin: '2026-11-11' });
  return s.length === 2 && s[0].complete && !s[1].complete && s[1].jours === 3;
})());
t('UNE DURÉE EN JOURS VAUT UNE DATE DE FIN', M.pfFin({ debut: '2026-11-02', duree: 14 }) === '2026-11-15');
t('... et la date de fin l’emporte sur la durée, puisque c’est elle que le médecin a écrite',
  M.pfFin({ debut: '2026-11-02', duree: 99, fin: '2026-11-15' }) === '2026-11-15');

// ── Le rythme désigne le forfait ───────────────────────────────────────────
console.log('\nLe rythme désigne le forfait, pas l’inverse');
t('une perfusion par semaine → forfait à la perfusion', M.pfSuggereRythme(1) === 'unite');
t('six par semaine aussi — c’est la borne', M.pfSuggereRythme(6) === 'unite');
t('SEPT PAR SEMAINE, SOIT UNE PAR JOUR → forfait 18', M.pfSuggereRythme(7) === 'j1');
t('quatorze → forfait 19', M.pfSuggereRythme(14) === 'j2');
t('davantage → forfait 20', M.pfSuggereRythme(21) === 'j3');
t('rien saisi, rien proposé', M.pfSuggereRythme(0) === null && M.pfSuggereRythme('') === null);

// ── L'ACLASTA : une perfusion, une fois ────────────────────────────────────
// C'est le cas le plus fréquent en officine, et le plus facile à mal facturer :
// on oublie le forfait d'installation, ou on facture une semaine de
// consommables pour une perfusion unique.
console.log('\nUn Aclasta : une perfusion, un seul jour');
const ACLASTA = { mode: 'gravite', voie: 'iv', type: 'aclasta', debut: '2026-11-02', duree: 1,
                  perfSemaine: 1, nbPerfusions: 1, rythme: 'unite',
                  modalites: { livraison: 1, pied: 1, demo: 1, conseil: 1, livret: 1, liaison: 1 } };
const eA = M.pfEcheancier(ACLASTA);
t('deux échéances : l’installation et la perfusion', eA.length === 2);
t('L’INSTALLATION EST DUE LE JOUR DE LA POSE', eA[0].type === 'installation' && eA[0].duLe === '2026-11-02');
t('... c’est le forfait 6, qui emporte le suivi', codes(eA[0]) === '6' && eA[0].lignes[0].code === '1172619');
t('... et AUCUN forfait de suivi ne s’y ajoute : c’est la première erreur du métier',
  eA.every(e => e.lignes.every(l => l.num !== 7 && l.num !== 8)));
t('la perfusion est facturée à l’unité, une seule fois', codes(eA[1]) === '17' && eA[1].lignes[0].qte === 1);
t('... et pas une semaine de plus', eA.filter(e => e.type === 'semaine').length === 1);
t('le total de la prise en charge tient en 56,59 €',
  Math.round((eA[0].total + eA[1].total) * 100) / 100 === 56.59);

// ── L'ANTIBIOTHÉRAPIE : une par jour, quatorze jours ───────────────────────
console.log('\nUne antibiothérapie : une perfusion par jour, quatorze jours');
const ATB = { mode: 'gravite', voie: 'iv', type: 'atb', debut: '2026-11-02', fin: '2026-11-15',
              perfSemaine: 7, rythme: 'j1',
              modalites: { livraison: 1, pied: 1, demo: 1, conseil: 1, livret: 1, liaison: 1 } };
const eB = M.pfEcheancier(ATB);
t('trois échéances : l’installation et deux semaines', eB.length === 3);
t('LA PREMIÈRE SEMAINE SE FACTURE À J+6, PAS À J', eB[1].duLe === '2026-11-08');
t('... et la deuxième à J+13', eB[2].duLe === '2026-11-15');
t('chaque semaine porte un forfait 18, une fois',
  codes(eB[1]) === '18' && eB[1].lignes[0].qte === 1 && codes(eB[2]) === '18');
t('... au tarif de la nomenclature', eB[1].total === 76.02);
t('la semaine couverte est annoncée', eB[1].du === '2026-11-02' && eB[1].au === '2026-11-08');

// ── LA SEMAINE INCOMPLÈTE ──────────────────────────────────────────────────
// On ne facture pas un service qui n'a pas été rendu : si la cure s'arrête un
// mercredi, l'échéance tombe ce mercredi-là, et pas le dimanche suivant.
console.log('\nUne cure qui s’arrête en milieu de semaine');
const COURT = { mode: 'gravite', voie: 'iv', debut: '2026-11-02', fin: '2026-11-11',
                perfSemaine: 7, rythme: 'j1', modalites: {} };
const eC = M.pfEcheancier(COURT);
t('la dernière échéance tombe le dernier jour de la cure', eC[2].duLe === '2026-11-11');
t('... et elle est signalée incomplète', eC[2].complete === false);
t('... elle ne déborde jamais la prescription', eC.every(e => e.au <= '2026-11-11'));

// ── L'ENTRETIEN DE VOIE ────────────────────────────────────────────────────
console.log('\nUn entretien de voie centrale');
const PICC = { mode: 'entretien', voie: 'picc', debut: '2026-11-02', duree: 28, perfSemaine: 1 };
const eP = M.pfEcheancier(PICC);
t('quatre entretiens pour quatre semaines', eP.length === 4);
t('LE PICC LINE RELÈVE DU FORFAIT 22, pas du 21', codes(eP[0]) === '22' && eP[0].lignes[0].code === '1170419');
t('une chambre implantable relève du 21',
  codes(M.pfEcheancier({ mode: 'entretien', voie: 'chambre', debut: '2026-11-02', duree: 7 })[0]) === '21');
t('... et AUCUNE INSTALLATION ne s’y ajoute : un entretien n’est pas une cure',
  eP.every(e => e.type !== 'installation'));
t('une voie périphérique ne donne droit à aucun entretien',
  M.pfEcheancier({ mode: 'entretien', voie: 'iv', debut: '2026-11-02', duree: 7 }).length === 0);

// ── CE QUI NE SE FACTURE PAS ───────────────────────────────────────────────
console.log('\nCe que le moteur refuse de mettre dans l’échéancier');
t('UNE SEMAINE SANS PERFUSION N’APPARAÎT PAS', (function () {
  // Trois perfusions au total, une par semaine : la quatrième semaine est vide.
  const f = { mode: 'gravite', voie: 'iv', debut: '2026-11-02', duree: 28,
              perfSemaine: 1, nbPerfusions: 3, rythme: 'unite', modalites: {} };
  const e = M.pfEcheancier(f).filter(x => x.type === 'semaine');
  return e.length === 3 && e.every(x => x.lignes[0].qte === 1);
})());
t('une fiche sans date ne produit rien', M.pfEcheancier({ mode: 'gravite', voie: 'iv' }).length === 0);
t('une fin antérieure au début non plus',
  M.pfEcheancier({ mode: 'gravite', voie: 'iv', debut: '2026-11-10', fin: '2026-11-02', perfSemaine: 7, rythme: 'j1' }).length === 0);

// ── LES CONTRÔLES ──────────────────────────────────────────────────────────
console.log('\nCe que le moteur dit avant de laisser facturer');
const bloque = f => M.pfControles(f, []).some(c => c.niveau === 'bloc');
const textes = (f, h) => M.pfControles(f, h || []).map(c => c.texte).join(' | ');
t('pas de date de fin : on ne facture pas', bloque({ mode: 'gravite', voie: 'iv', debut: '2026-11-02', perfSemaine: 7, rythme: 'j1' }));
t('pas de rythme : on ne facture pas', bloque({ mode: 'gravite', voie: 'iv', debut: '2026-11-02', duree: 7 }));
t('HORS AMM : ON NE FACTURE PAS — les forfaits associés ne sont pas remboursables',
  bloque(Object.assign({}, ATB, { amm: false })));
t('un entretien sur voie périphérique : on ne facture pas',
  bloque({ mode: 'entretien', voie: 'sc', debut: '2026-11-02', duree: 7 }));
t('une fiche complète ne bloque rien', !bloque(ACLASTA));

// LES SIX SEMAINES ENTRE DEUX CURES. C'est la règle qu'on ne peut pas deviner
// au comptoir : elle porte sur une cure d'il y a plus d'un mois.
console.log('\nLes six semaines entre deux cures');
const ANCIENNE = { id: 'a1', mode: 'gravite', voie: 'iv', nom: 'MARTIN', prenom: 'Jean', dob: '1948-03-12',
                   debut: '2026-09-20', fin: '2026-10-10', perfSemaine: 7, rythme: 'j1' };
const TROP_TOT = { id: 'a2', mode: 'gravite', voie: 'iv', nom: 'MARTIN', prenom: 'Jean', dob: '1948-03-12',
                   debut: '2026-10-20', fin: '2026-10-27', perfSemaine: 7, rythme: 'j1', modalites: {} };
t('LA CURE PRÉCÉDENTE EST RETROUVÉE', (M.pfCurePrecedente(TROP_TOT, [ANCIENNE]) || {}).ecart === 10);
t('... et dix jours plus tard, l’alerte tombe', /six semaines/.test(textes(TROP_TOT, [ANCIENNE])));
const ASSEZ_TARD = Object.assign({}, TROP_TOT, { debut: '2026-12-01', fin: '2026-12-08' });
t('... passé six semaines, plus d’alerte', !/six semaines/.test(textes(ASSEZ_TARD, [ANCIENNE])));
t('... mais le rappel des 26 semaines reste', /26 derni/.test(textes(ASSEZ_TARD, [ANCIENNE])));
t('UN HOMONYME N’EST PAS LE MÊME PATIENT',
  M.pfCurePrecedente(Object.assign({}, TROP_TOT, { dob: '1951-07-04' }), [ANCIENNE]) === null);
t('une cure postérieure n’est pas une cure antérieure',
  M.pfCurePrecedente(ANCIENNE, [TROP_TOT]) === null);

// LES PRESTATIONS DU FORFAIT. Les oublier n'est pas un manque à gagner : c'est
// facturer un forfait dont une partie n'a pas été rendue.
console.log('\nLes prestations comprises dans le forfait');
t('six prestations non cochées, l’alerte le dit',
  /prestation\(s\) du forfait/.test(textes(Object.assign({}, ATB, { modalites: {} }))));
t('... toutes cochées, elle se tait',
  !/prestation\(s\) du forfait/.test(textes(ATB)));
t('un entretien n’est pas concerné',
  !/prestation\(s\) du forfait/.test(textes(PICC)));

// LE FORFAIT CHOISI À LA MAIN. Il reste possible — l'ordonnance est sous les
// yeux de l'équipe — mais il ne passe pas en silence.
t('UN FORFAIT RETENU CONTRE LE RYTHME SAISI EST SIGNALÉ',
  /retenu à la main/.test(textes(Object.assign({}, ATB, { rythme: 'unite' }))));

// ── CE QUI EST DÛ ──────────────────────────────────────────────────────────
console.log('\nCe qui est dû, et quand');
const FICHES = [Object.assign({ id: 'f1', nom: 'MARTIN', prenom: 'Jean' }, ATB)];
t('le jour de la pose, l’installation est due', M.pfDues(FICHES, '2026-11-02', 0).length === 1);
t('... et six jours plus tard, la première semaine l’est aussi',
  M.pfDues(FICHES, '2026-11-08', 0).length === 2);
t('UNE ÉCHÉANCE FACTURÉE DISPARAÎT', (function () {
  const f = [Object.assign({}, FICHES[0], { facturees: { 0: { le: '2026-11-02' } } })];
  return M.pfDues(f, '2026-11-08', 0).length === 1;
})());
t('la fenêtre à sept jours montre ce qui arrive', M.pfDues(FICHES, '2026-11-02', 7).length === 2);
t('... mais pas ce qui vient après', M.pfDues(FICHES, '2026-11-02', 7).every(d => d.date <= '2026-11-09'));
t('LE RETARD EST COMPTÉ', M.pfDues(FICHES, '2026-11-12', 0).find(d => d.echeance.no === 1).retard === 4);
t('les échéances sortent dans l’ordre des dates', (function () {
  const d = M.pfDues(FICHES, '2026-12-31', 0);
  for (let i = 1; i < d.length; i++) if (d[i - 1].date > d[i].date) return false;
  return d.length === 3;
})());
t('une fiche annulée ne doit plus rien',
  M.pfDues([Object.assign({}, FICHES[0], { statut: 'annulee' })], '2026-12-31', 0).length === 0);

// ── LES CODES, QUI SONT CE QU'ON SAISIT ────────────────────────────────────
console.log('\nLes codes de la nomenclature');
const C = M.PF_FORFAITS;
t('forfait 6 — installation et suivi gravité', C.F6.code === '1172619' && C.F6.pu === 45.79);
t('forfait 17 — à la perfusion', C.F17.code === '1185160' && C.F17.unite === 'perfusion');
t('forfait 18 — une par jour', C.F18.code === '1121326');
t('forfait 19 — deux par jour', C.F19.code === '1143279');
t('forfait 20 — plus de deux par jour', C.F20.code === '1153616');
t('forfait 21 — entretien voie centrale', C.F21.code === '1103392');
t('forfait 22 — entretien PICC line', C.F22.code === '1170419');
t('LES TARIFS PORTENT LEUR DATE DE RELEVÉ', /^\d{2}\/\d{2}\/\d{4}$/.test(M.PF_TARIFS_AU));

// ── LE BRANCHEMENT ─────────────────────────────────────────────
// Une collection synchronisee se declare en SIX endroits. En oublier un ne
// casse rien tout de suite : la fiche s'enregistre, puis la resynchronisation
// de huit secondes la remplace par du vide, et elle disparait sous les doigts
// de celui qui vient de la saisir. C'est le piege n°4 du depot, et il ne se
// voit qu'au bout de huit secondes.
const fs2 = require('fs');
const lire = f => fs2.readFileSync(path.join(__dirname, '..', f), 'utf8');
const ix = lire('public/index.html'), srv = lire('server.js');
const pfm = lire('public/pf-module.js'), rn = lire('public/rn-module.js');
console.log('\nLa collection est declaree partout');
t('1. elle existe comme variable de la page', /renouvArchives=\[\], perfadom=\[\]/.test(ix));
t('2. elle est dans SYNCED_COLLS, cote navigateur', /'renouvArchives','perfadom'/.test(ix));
t('3. _collRef sait la rendre', /case 'perfadom':return perfadom;/.test(ix));
t('4. elle part au serveur dans saveAll', /renouvArchives,perfadom,smsLog/.test(ix));
t('5. le premier chargement la lit', /if\(data\.perfadom\)perfadom=data\.perfadom;/.test(ix));
t('6. LA RESYNCHRONISATION AUSSI — celle qui efface tout si on l’oublie',
  /if\(d\.perfadom\)perfadom=d\.perfadom;/.test(ix));
t('... et le serveur la fusionne par enregistrement', /'perfadom', 'patients'/.test(srv));
t('les deux fichiers sont charges, le moteur avant le module',
  ix.indexOf('pf-moteur.js') > 0 && ix.indexOf('pf-moteur.js') < ix.indexOf('pf-module.js'));
t('la rubrique se dessine quand on l’ouvre', /if\(name==='perfadom'&&window\.pfRender\)pfRender\(\);/.test(ix));

// LE PIEGE DU `let`. `perfadom` est declaree en `let` : ce n'est PAS une
// propriete de `window`. Un module qui ecrirait dans `window.perfadom`
// travaillerait sur un second tableau, invisible de saveAll — les fiches
// s'afficheraient, et rien ne partirait jamais au serveur.
console.log('\nLe module ecrit dans la collection de la page');
t('pfListe passe par le nom nu, pas par window',
  /return perfadom;\n\s*\}/.test(pfm) && !/return window\.perfadom;/.test(pfm));
t('... et ne repousse jamais une fiche a l’aveugle',
  !/pfListe\(\)\.push\(/.test(pfm) && /function pfPoser\(f\)/.test(pfm));
t('une facturation se note sur la fiche FRAICHE, pas sur celle de l’ecran',
  /function pfNoter\(id, no, valeur\)/.test(pfm) && /const cible = pfFraiche\(id\)/.test(pfm));

console.log('\nL’echeance remonte dans la liste du matin');
t('le module Renouvellement va chercher ce qui est du', /function rnPerfadom\(q\)/.test(rn)
  && /window\.pfDues\(7\)/.test(rn));
t('... sur sept jours, comme les ordonnances', /window\.pfDues\(7\)/.test(rn));
t('... il l’affiche avec une carte a lui', /function rnCartePf\(it\)/.test(rn)
  && /PERFADOM — à facturer/.test(rn));
t('... et le bouton note la facturation sans quitter la liste',
  /window\.rnPfFacture = function/.test(rn) && /pfFacturerDepuis/.test(rn));
t('RIEN N’EST ECRIT DANS LES RENOUVELLEMENTS : deux metiers, une liste',
  !/renouvellements\.push/.test(rn.slice(rn.indexOf('function rnPerfadom'), rn.indexOf('function rnRenderAll'))));
t('la pastille compte ce que la liste montre',
  /window\.pfDueCount === 'function'/.test(rn));
// CHAQUE onclick DOIT AVOIR SA FONCTION. Un bouton qui appelle une fonction
// inexistante ne dit rien : il ne fait rien.
console.log('\nChaque bouton appelle une fonction qui existe');
t('... dans le module Perfusions', (function () {
  const appels = new Set();
  (pfm.match(/onclick="(\w+)\(/g) || []).forEach(m => appels.add(m.slice(9, -1)));
  (pfm.match(/onchange="(\w+)\(/g) || []).forEach(m => appels.add(m.slice(10, -1)));
  const manquants = [...appels].filter(f => !new RegExp('window\\.' + f + ' = function').test(pfm)
    && !/^(acPatient|dobMasque|pfChamp)$/.test(f) && !new RegExp('function ' + f + '\\(').test(pfm));
  if (manquants.length) console.log('      manquants :', manquants.join(', '));
  return manquants.length === 0;
})());

console.log('\n' + ok + ' vérifications, ' + ko + ' échec(s)\n');
process.exit(ko ? 1 : 0);
