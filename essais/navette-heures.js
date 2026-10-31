// LE DÉCOMPTE DES HEURES DE LA NAVETTE — ce qui se paie, et à quel taux.
// node essais/navette-heures.js
//
// Les deux règles viennent du modèle du cabinet comptable d'Olivier, recopiées
// mot pour mot de ses intitulés de lignes :
//
//   « Temps complet — heures supplémentaires à 125 %, au-delà de 35h00 et
//     jusqu'à la 43ème heure PAR SEMAINE » puis « à 150 % au-delà de la 43ème »
//   « Temps partiel — heures complémentaires jusqu'à 10 % de l'horaire
//     hebdomadaire contractuel » puis « au-delà de 10 % »
//
// CE QUI SE JOUE. Les deux se lisent À LA SEMAINE. Un décompte qui sommerait
// les heures du mois avant de les partager serait faux dans les deux sens :
// trois semaines à 38 h et une à 44 h valent 9 h à 125 % et 1 h à 150 %, alors
// que leurs 158 h mensuelles « moyennées » ne produiraient aucune heure à
// 150 %. C'est de la paie : l'erreur se retrouve sur un bulletin.
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'nv-module.js'), 'utf8');
const window = {};
eval(src);
const { nvSemaine, nvMois, nvTempsPlein, nvHeuresContractuelles, nvPeriodes, nvDuAu, nvSeuils } = window;

let ok = 0, ko = 0;
const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };
console.log('\nLE DÉCOMPTE DES HEURES DE LA NAVETTE\n');

// ── Les seuils ──────────────────────────────────────────────────────────────
console.log('Les seuils sont ceux que le cabinet écrit');
const S = nvSeuils();
t('la durée légale est 35 h', S.legale === 35);
t('le second taux commence à la 43ᵉ heure', S.seuil150 === 43);
t('le temps partiel bascule à 10 % de son horaire', S.compl === 0.10);
t('LA MENSUALISATION DONNE LES CHIFFRES DE LA NAVETTE',
  nvHeuresContractuelles(35) === 151.67 && nvHeuresContractuelles(27) === 117
  && nvHeuresContractuelles(31) === 134.33);

// ── Temps complet ───────────────────────────────────────────────────────────
console.log('\nTemps complet : 125 % jusqu’à la 43ᵉ heure, 150 % au-delà');
const p = (h) => nvSemaine(h, 35);
t('une semaine juste au contrat ne produit rien',
  p(35).t125 === 0 && p(35).t150 === 0);
t('une semaine courte non plus — on ne retire pas d’heures ici',
  p(28).t125 === 0 && p(28).t150 === 0);
t('trois heures en plus sont à 125 %', p(38).t125 === 3 && p(38).t150 === 0);
t('LA 43ᵉ HEURE EST ENCORE À 125 %', p(43).t125 === 8 && p(43).t150 === 0);
t('LA 44ᵉ BASCULE — et seule elle', p(44).t125 === 8 && p(44).t150 === 1);
t('une semaine de 48 h : huit heures à 125 %, cinq à 150 %',
  p(48).t125 === 8 && p(48).t150 === 5);
t('les demi-heures sont tenues', p(38.5).t125 === 3.5 && p(43.5).t150 === 0.5);
t('un temps complet n’a jamais d’heures complémentaires',
  p(48).c10 === 0 && p(48).cPlus === 0);
// UN CONTRAT A 37 H porte deux heures supplementaires structurelles : le
// cabinet compte a partir de 35, pas de la base. C'est ce qu'il ecrit.
t('UN CONTRAT À 37 H COMPTE À PARTIR DE 35, pas de sa propre base',
  nvSemaine(37, 37).t125 === 2);
t('... et quarante-quatre heures sur ce contrat donnent bien 8 et 1',
  nvSemaine(44, 37).t125 === 8 && nvSemaine(44, 37).t150 === 1);

// ── Temps partiel ───────────────────────────────────────────────────────────
console.log('\nTemps partiel : complémentaires jusqu’à 10 %, puis au-delà');
const q = (h) => nvSemaine(h, 27);       // 27 h → plafond à 2,7 h
t('une semaine au contrat ne produit rien', q(27).c10 === 0 && q(27).cPlus === 0);
t('deux heures en plus tiennent sous les 10 %', q(29).c10 === 2 && q(29).cPlus === 0);
t('LE PLAFOND EST À 2,7 H POUR UN CONTRAT DE 27 H',
  q(29.7).c10 === 2.7 && q(29.7).cPlus === 0);
t('AU-DELÀ, LE SURPLUS PASSE AU SECOND TAUX — et lui seul',
  q(31).c10 === 2.7 && q(31).cPlus === 1.3);
t('un temps partiel n’a jamais d’heures supplémentaires',
  q(31).t125 === 0 && q(31).t150 === 0);
t('un contrat de 31 h plafonne à 3,1 h',
  nvSemaine(34.1, 31).c10 === 3.1 && nvSemaine(34.1, 31).cPlus === 0);

// ── Ce qu'on ne décide pas tout seul ────────────────────────────────────────
console.log('\nCe qu’on ne décide pas tout seul');
t('UN TEMPS PARTIEL QUI DÉPASSE 35 H EST SIGNALÉ — la requalification n’est pas une affaire de tableur',
  nvSemaine(36, 27).anomalie === 'depassement');
t('... mais ses heures sont quand même comptées, pas perdues',
  nvSemaine(36, 27).c10 === 2.7 && nvSemaine(36, 27).cPlus === 6.3);
t('un contrat sans horaire ne produit aucun chiffre inventé',
  nvSemaine(40, 0).anomalie === 'base'
  && nvSemaine(40, 0).t125 === 0 && nvSemaine(40, 0).t150 === 0);
t('à 35 h pile, on est à temps complet',
  nvTempsPlein(35) === true && nvTempsPlein(34.9) === false);

// ── LE MOIS : la somme des semaines, pas la moyenne ────────────────────────
console.log('\nLe mois est la somme des semaines, jamais leur moyenne');
const MOIS = [{ lundi: '2026-10-05', faites: 38 }, { lundi: '2026-10-12', faites: 38 },
              { lundi: '2026-10-19', faites: 38 }, { lundi: '2026-10-26', faites: 44 }];
const m = nvMois(MOIS, 35);
t('les heures faites se totalisent', m.faites === 158);
// 3 + 3 + 3 + 8 heures au premier taux, et la seule 44ᵉ au second.
t('DIX-SEPT HEURES À 125 % ET UNE À 150 %', m.t125 === 17 && m.t150 === 1);
// La preuve par l'absurde. Les memes 158 heures partagees d'un seul coup
// donneraient 8 h a 125 % et CENT QUINZE a 150 % : un bulletin delirant, et
// pourtant c'est ce que produit tout decompte qui totalise avant de partager.
const ABSURDE = nvSemaine(158, 35);
t('ALORS QUE LE TOTAL MENSUEL PARTAGÉ D’UN COUP EN DONNERAIT CENT QUINZE',
  ABSURDE.t125 === 8 && ABSURDE.t150 === 115);
t('... soit sept fois le compte — l’erreur ne passerait pas inaperçue longtemps',
  ABSURDE.t150 > m.t150 * 100);
t('une semaine à zéro ne gêne personne',
  nvMois([{ faites: 0 }, { faites: 38 }], 35).t125 === 3);
t('le mois d’un temps partiel suit la même logique',
  nvMois([{ faites: 29 }, { faites: 31 }], 27).c10 === 4.7
  && nvMois([{ faites: 29 }, { faites: 31 }], 27).cPlus === 1.3);
t('les anomalies de la semaine remontent au mois, datées',
  nvMois([{ lundi: '2026-10-05', faites: 36 }], 27).anomalies[0].lundi === '2026-10-05');
t('un mois vide ne tombe pas', nvMois(null, 35).faites === 0 && nvMois([], 35).t125 === 0);

// ── Les périodes d'absence ─────────────────────────────────────────────────
// Règle d'Olivier (31/10) : « la période TOTALE est indiquée sur les navettes
// des deux mois concernés ». On ne découpe pas aux bornes du mois.
console.log('\nUne absence à cheval s’écrit en entier sur les deux mois');
const ABS = [
  { motif: 'cp',  debut: '2026-10-05', fin: '2026-10-09' },
  { motif: 'cp',  debut: '2026-10-27', fin: '2026-11-03' },
  { motif: 'mal', debut: '2026-09-28', fin: '2026-10-02' },
  { motif: 'cp',  debut: '2026-12-21', fin: '2026-12-31' }
];
const cpOct = nvPeriodes(ABS, '2026-10', 'cp');
t('les congés d’octobre sont retenus, décembre non', cpOct.length === 2);
t('... et rangés dans l’ordre', cpOct[0].debut === '2026-10-05');
t('UNE PÉRIODE QUI DÉBORDE SUR NOVEMBRE EST RETENUE PAR OCTOBRE',
  cpOct[1].fin === '2026-11-03');
t('... et novembre la retient aussi, en entier',
  nvPeriodes(ABS, '2026-11', 'cp')[0].debut === '2026-10-27');
t('un arrêt commencé en septembre compte pour octobre',
  nvPeriodes(ABS, '2026-10', 'mal').length === 1);
t('chaque motif a sa ligne', nvPeriodes(ABS, '2026-10', 'mal')[0].debut === '2026-09-28');

console.log('\nDeux périodes dans le même mois tiennent sur les lignes DU / AU');
const da = nvDuAu(cpOct);
t('LES DÉBUTS SUR LA LIGNE « DU »', da.du === '05/10/2026 et 27/10/2026');
t('LES FINS SUR LA LIGNE « AU », dans le même ordre', da.au === '09/10/2026 et 03/11/2026');
t('une seule période s’écrit simplement',
  nvDuAu([ABS[0]]).du === '05/10/2026' && nvDuAu([ABS[0]]).au === '09/10/2026');
t('aucune période ne laisse rien', nvDuAu([]).du === '' && nvDuAu(null).au === '');

// ── LA FENÊTRE : DU 20 AU 19, PAS LE MOIS CIVIL ────────────────────────────
// Olivier, le 31/10 : « la navette est éditée le 20 du mois pour être envoyée
// au cabinet afin qu'il prépare les bulletins ; les heures supplémentaires sont
// donc comptabilisées au réel du 20 du mois précédent au 20 du mois en cours »,
// puis, sur la borne exacte : DU 20 AU 19.
//
// CE QUI SE JOUE. Une borne « du 20 au 20 » ferait payer DEUX FOIS les heures
// du 20 — une fois en fin de navette, une fois au début de la suivante. Du 20
// au 19, aucun jour n'est compté deux fois et aucun n'est oublié : les fenêtres
// de deux mois consécutifs se touchent sans se chevaucher.
const { nvFenetre, nvMoisDecale, nvDimanche, nvSemaineRetenue, nvSemainesRetenues } = window;
console.log('\nLa fenêtre des heures va du 20 au 19, pas du 1ᵉʳ au 31');
t('la borne est le 20', nvSeuils().borne === 20);
const FO = nvFenetre('2026-10');
t('OCTOBRE COMMENCE LE 20 SEPTEMBRE', FO.debut === '2026-09-20');
t('... ET FINIT LE 19 OCTOBRE', FO.fin === '2026-10-19');
t('AUCUN JOUR N’EST COMPTÉ DEUX FOIS — novembre reprend le 20 octobre',
  nvFenetre('2026-11').debut === '2026-10-20');
t('... ni oublié : la veille est bien la fin d’octobre',
  nvFenetre('2026-11').debut > FO.fin
  && nvFenetre('2026-11').debut === '2026-10-20' && FO.fin === '2026-10-19');
t('JANVIER REMONTE SUR L’ANNÉE PRÉCÉDENTE', nvFenetre('2026-01').debut === '2025-12-20');
t('... et mars part de février, qui est court', nvFenetre('2026-03').debut === '2026-02-20');
t('le décalage de mois tient aux deux bouts de l’année',
  nvMoisDecale('2026-01', -1) === '2025-12' && nvMoisDecale('2026-12', 1) === '2027-01');
t('un mois illisible ne produit pas de fenêtre',
  nvFenetre('') === null && nvMoisDecale('n’importe quoi', -1) === null);

// ── LA SEMAINE PART OÙ ELLE FINIT ──────────────────────────────────────────
// Choix d'Olivier du 31/10. La semaine est l'unité du calcul : on ne la coupe
// pas au prorata, on paierait des fractions d'heure indéfendables devant un
// salarié. Elle part entière sur la navette dont la fenêtre contient son
// DIMANCHE.
console.log('\nUne semaine coupée par la borne part là où elle finit');
t('le dimanche se déduit du lundi', nvDimanche('2026-10-19') === '2026-10-25');
t('... y compris par-dessus un changement de mois', nvDimanche('2026-10-26') === '2026-11-01');
t('LA SEMAINE DU 19 OCTOBRE FINIT LE 25 : elle part sur NOVEMBRE',
  nvSemaineRetenue('2026-10-19', '2026-10') === false
  && nvSemaineRetenue('2026-10-19', '2026-11') === true);
t('LA SEMAINE DU 12 OCTOBRE FINIT LE 18 : elle reste sur OCTOBRE',
  nvSemaineRetenue('2026-10-12', '2026-10') === true
  && nvSemaineRetenue('2026-10-12', '2026-11') === false);
t('la semaine du 14 septembre finit le 20 : elle est la première d’octobre',
  nvSemaineRetenue('2026-09-14', '2026-10') === true
  && nvSemaineRetenue('2026-09-14', '2026-09') === false);
t('un lundi illisible n’est retenu nulle part',
  nvSemaineRetenue('', '2026-10') === false && nvSemaineRetenue('2026-10-12', '') === false);

// CHAQUE SEMAINE APPARTIENT A UNE NAVETTE ET UNE SEULE. C'est la propriete qui
// compte : une semaine comptee deux fois, ou aucune, se paie.
console.log('\nChaque semaine appartient à une navette et une seule');
const LUNDIS = [];
for (let d = new Date(Date.UTC(2026, 7, 3)); d <= new Date(Date.UTC(2027, 0, 25)); d.setUTCDate(d.getUTCDate() + 7)) {
  LUNDIS.push(d.toISOString().slice(0, 10));
}
const MOIS12 = ['2026-09', '2026-10', '2026-11', '2026-12', '2027-01'];
const compte = {};
LUNDIS.forEach(function (l) {
  compte[l] = MOIS12.filter(function (m) { return nvSemaineRetenue(l, m); }).length;
});
const dedans = LUNDIS.filter(function (l) {
  const dim = nvDimanche(l);
  return dim >= nvFenetre('2026-09').debut && dim <= nvFenetre('2027-01').fin;
});
t('les ' + dedans.length + ' semaines de la plage tombent dans exactement une navette',
  dedans.every(function (l) { return compte[l] === 1; }));
t('... et aucune n’est réclamée par deux navettes',
  LUNDIS.every(function (l) { return compte[l] <= 1; }));
t('le tri d’une liste de semaines ne retient que les bonnes',
  nvSemainesRetenues([{ lundi: '2026-10-12', faites: 38 }, { lundi: '2026-10-19', faites: 44 }],
    '2026-10').length === 1);
t('... et c’est bien celle qui finit avant la borne',
  nvSemainesRetenues([{ lundi: '2026-10-12', faites: 38 }, { lundi: '2026-10-19', faites: 44 }],
    '2026-10')[0].faites === 38);
t('une liste vide ne tombe pas', nvSemainesRetenues(null, '2026-10').length === 0);

// ── DEUX FENÊTRES DANS UN MÊME DOCUMENT ────────────────────────────────────
// « Les vacances sont déclarées du mois » (Olivier, 31/10) : les congés et les
// absences suivent le MOIS CIVIL, pas la fenêtre du 20 au 19. C'est
// contre-intuitif, et c'est voulu — d'où cet essai, qui fige la distinction.
console.log('\nLes congés suivent le mois civil, pas la fenêtre des heures');
const CP25 = [{ motif: 'cp', debut: '2026-10-25', fin: '2026-10-27' }];
t('UN CONGÉ DU 25 OCTOBRE EST SUR LA NAVETTE D’OCTOBRE',
  nvPeriodes(CP25, '2026-10', 'cp').length === 1);
t('... alors que les heures de ce jour-là partent sur novembre',
  nvSemaineRetenue('2026-10-19', '2026-11') === true);
t('et un congé du 15 septembre n’est pas sur octobre, lui',
  nvPeriodes([{ motif: 'cp', debut: '2026-09-15', fin: '2026-09-18' }], '2026-10', 'cp').length === 0);
t('un mois de 30 jours borne correctement',
  nvPeriodes([{ motif: 'cp', debut: '2026-11-30', fin: '2026-11-30' }], '2026-11', 'cp').length === 1);
t('... et février aussi',
  nvPeriodes([{ motif: 'cp', debut: '2026-02-28', fin: '2026-02-28' }], '2026-02', 'cp').length === 1);

// ── LE CYCLE : 36 H UNE SEMAINE, 34 L'AUTRE ────────────────────────────────
// Olivier, le 31/10 : « certains salariés ont des emplois du temps alternés,
// semaine à 36 h et semaine à 34 h : pas d'heure supplémentaire dans ce
// cas-là. »
//
// CE QUI SE JOUE. C'est le principe même du cycle : 36 puis 34 valent 35 de
// moyenne, le contrat est rempli, rien n'est dû en plus. Compter une heure
// supplémentaire la semaine à 36 reviendrait à payer DEUX FOIS ce que la
// semaine à 34 a déjà rendu — et à le payer majoré. Sur douze mois et quatre
// salariés en cycle, l'erreur se chiffre.
//
// La référence n'est donc pas 35 h : c'est ce que la TRAME prévoyait cette
// semaine-là. Une heure est supplémentaire quand elle dépasse à la fois ce qui
// était prévu ET la durée légale.
console.log('\nUn cycle 36 / 34 ne produit aucune heure supplémentaire');
t('LA SEMAINE À 36 H PRÉVUE ET FAITE NE DONNE RIEN',
  nvSemaine(36, 35, 36).t125 === 0 && nvSemaine(36, 35, 36).t150 === 0);
t('... et la semaine à 34 non plus', nvSemaine(34, 35, 34).t125 === 0);
t('LE CYCLE ENTIER EST À ZÉRO — c’était la demande',
  nvMois([{ faites: 36, prevues: 36 }, { faites: 34, prevues: 34 }], 35).t125 === 0);
t('... et quatre semaines de ce cycle aussi',
  nvMois([{ faites: 36, prevues: 36 }, { faites: 34, prevues: 34 },
          { faites: 36, prevues: 36 }, { faites: 34, prevues: 34 }], 35).t125 === 0);
// PROPRIETE : la borne du 20 coupe le cycle n'importe ou, et le total ne bouge
// pas. Une navette ne peut donc pas facturer une heure sup par accident de
// calendrier.
t('LE TOTAL NE DÉPEND PAS DE L’ENDROIT OÙ LA BORNE COUPE LE CYCLE',
  nvMois([{ faites: 34, prevues: 34 }, { faites: 36, prevues: 36 },
          { faites: 34, prevues: 34 }], 35).t125 === 0
  && nvMois([{ faites: 36, prevues: 36 }, { faites: 34, prevues: 34 },
             { faites: 36, prevues: 36 }], 35).t125 === 0);

console.log('\nMais ce qui dépasse vraiment la trame reste dû');
t('prévu 36, fait 40 : quatre heures', nvSemaine(40, 35, 36).t125 === 4);
// CINQ, PAS SIX. L'heure de 34 a 35 rattrape le cycle : elle n'est pas due.
// C'est la meme regle que deux lignes plus bas, et c'est celle qu'on oublie.
t('prévu 34, fait 40 : CINQ heures — celle de 34 à 35 rattrape le cycle',
  nvSemaine(40, 35, 34).t125 === 5);
// LA 35e HEURE D'UNE SEMAINE CREUSE RATTRAPE LE CYCLE : elle n'est pas due.
t('PRÉVU 34, FAIT 36 : UNE SEULE HEURE, celle qui dépasse 35',
  nvSemaine(36, 35, 34).t125 === 1);
t('... et prévu 34, fait 35 : rien du tout, la 35ᵉ rattrape le cycle',
  nvSemaine(35, 35, 34).t125 === 0);
t('le seuil ne descend jamais sous la durée légale',
  nvSemaine(35, 35, 30).t125 === 0 && nvSemaine(36, 35, 30).t125 === 1);
t('PRÉVU 36, FAIT 46 : dix heures, dont trois au-delà de la 43ᵉ',
  nvSemaine(46, 35, 36).t125 === 7 && nvSemaine(46, 35, 36).t150 === 3);
t('... le taux suit la place dans la semaine, la quantité suit l’écart à la trame',
  nvSemaine(46, 35, 36).t125 + nvSemaine(46, 35, 36).t150 === 10);
t('et le second taux ne dépasse jamais ce qui est dû',
  nvSemaine(46, 35, 44).t150 === 2 && nvSemaine(46, 35, 44).t125 === 0);
t('UNE TRAME AU-DELÀ DE LA 43ᵉ HEURE EST SIGNALÉE',
  nvSemaine(46, 35, 44).anomalie === 'trame_haute');

console.log('\nUn temps partiel en cycle suit la même règle');
t('prévu 28, fait 28, base 27 : rien', nvSemaine(28, 27, 28).c10 === 0);
t('... et la semaine creuse à 26 non plus', nvSemaine(26, 27, 26).c10 === 0);
t('LE CYCLE 28 / 26 D’UN CONTRAT À 27 H EST À ZÉRO',
  nvMois([{ faites: 28, prevues: 28 }, { faites: 26, prevues: 26 }], 27).c10 === 0);
t('prévu 28, fait 31 : trois heures, plafond des 10 % sur la BASE',
  nvSemaine(31, 27, 28).c10 === 2.7 && nvSemaine(31, 27, 28).cPlus === 0.3);
t('... le plafond se calcule sur 27 h (2,7), pas sur la semaine du cycle (2,8)',
  nvSemaine(31, 27, 28).c10 === 2.7);

console.log('\nSans trame connue, on retombe sur l’horaire fixe');
t('une semaine sans trame se lit comme avant',
  nvSemaine(38, 35).t125 === 3 && nvSemaine(38, 35, null).t125 === 3);
t('... et un mois mêlant les deux ne tombe pas',
  nvMois([{ faites: 38 }, { faites: 36, prevues: 36 }], 35).t125 === 3);

// ── LA COUTURE AVEC LE PLANNING ────────────────────────────────────────────
// CE QUI S'EST PASSÉ. `nvMois` lisait `s.heures`, un nom qui n'existait que
// dans ces essais-ci : le planning, lui, produit `{ lundi, prevues, faites }`.
// Tout tombait à zéro — heures faites, 125 %, 150 % — et PAS UNE des
// quatre-vingts vérifications ne s'en est aperçue, puisqu'elles fabriquaient
// elles-mêmes la forme qu'elles attendaient. C'est le navigateur, sur un vrai
// planning, qui l'a vu : une navette entièrement vide.
//
// La leçon tient en une ligne : un essai qui invente sa donnée d'entrée ne
// vérifie que sa propre invention. Celui-ci lit la forme DANS le module qui la
// produit.
console.log('\nLa forme que le planning produit est celle que le décompte lit');
const PLSRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'pl-module.js'), 'utf8');
t('LE PLANNING ÉMET BIEN { lundi, prevues, theorique, faites }',
  /out\.push\(\{ lundi: plIso\(d\),/.test(PLSRC)
  && /prevues: plHeuresSemaineTrame\(c, d\),/.test(PLSRC)
  && /theorique: plHeuresSemaineTheorique\(c, d\),/.test(PLSRC)
  && /faites: plHeuresSemaine\(c, d\) \}\);/.test(PLSRC));
// LA TRAME THEORIQUE ignore les absences : sans elle, une semaine de conges
// ferait croire a un contrat non tenu, puisque la trame y vaut zero.
t('... et la trame théorique ne retire pas les absences',
  /function plHeuresSemaineTheorique\(c, monday\) \{[\s\S]*?const sl = plSlotsTrame\(c, plAddD\(monday, k\)\);\n\s*if \(sl\[0\]\) tot \+= plDurOf\(sl\[0\]\);/.test(PLSRC));
t('... alors que la trame « prévue », elle, les retire bien',
  /const sl = plSlotsTrame\(c, d\), ab = plAbs\(c, iso\);/.test(PLSRC));
t('... et le décompte lit « faites », pas autre chose',
  /const h = nvNombre\(s && s\.faites\);/.test(src));
t('... et « prevues », du même nom', /s && s\.prevues != null \? s\.prevues : null/.test(src));
// La preuve par l'usage : on fabrique une semaine EXACTEMENT comme le planning
// l'ecrit, et on verifie qu'elle produit quelque chose.
const COMME_LE_PLANNING = [
  { lundi: '2026-09-14', prevues: 35, faites: 35 },
  { lundi: '2026-10-12', prevues: 35, faites: 38.5 }
];
const vrai = nvMois(COMME_LE_PLANNING, 35);
t('UNE SEMAINE AU FORMAT DU PLANNING PRODUIT BIEN SES HEURES', vrai.faites === 73.5);
t('... et ses heures supplémentaires', vrai.t125 === 3.5);
t('UN CHAMP MAL NOMMÉ NE PASSE PLUS POUR ZÉRO EN SILENCE',
  nvMois([{ lundi: '2026-10-12', prevues: 35, heures: 38.5 }], 35).faites === 0
  && vrai.faites !== 0);

// ── Les renforts ──────────────────────────────────────────────
// Un étudiant n'a pas de colonne : le cabinet l'attend sur la ligne
// « Étudiants », en texte libre, avec son total d'heures.
console.log('\nLes renforts ne prennent pas de colonne');
t('UN RENFORT EST RECONNU À SON GROUPE',
  /function nvEstRenfort\(c\) \{ return c && c\.grp === 'renfort'; \}/.test(src));
t('... le décompte le met à part, pas dans les colonnes',
  /lignes: toutes\.filter\(function \(l\) \{ return !l\.renfort; \}\)/.test(src)
  && /renforts: toutes\.filter\(function \(l\) \{ return l\.renfort; \}\)/.test(src));
t('... ET LA LIGNE « ÉTUDIANTS » SE REMPLIT TOUTE SEULE',
  /function nvEtudiantsAuto\(dec\)/.test(src)
  && /nom \+ ' : ' \+ nvAff\(r\.faites\) \+ ' heures'/.test(src));
t('... c’est elle que la génération envoie',
  /etudiants: dos\.etudiants \|\| nvEtudiantsAuto\(dec\)/.test(src));
// LA LIGNE QUE L'ON CORRIGE A LA MAIN GAGNE : si Olivier a écrit le texte des
// étudiants lui-même, l'automatique ne le recouvre pas.
t('... et le texte écrit à la main l’emporte sur l’automatique',
  /dos\.etudiants \|\| nvEtudiantsAuto/.test(src));

console.log('\n' + ok + ' vérifications, ' + ko + ' échec(s)\n');
process.exit(ko ? 1 : 0);
