/* ════════════════════════════════════════════════════════════════════════════
   PERFADOM — LE MOTEUR DES FORFAITS ET DE L'ÉCHÉANCIER

   Ce fichier ne touche à rien : il ne lit pas le DOM, n'écrit pas en base, et
   ne connaît pas PILOT. Il prend une fiche de prise en charge et rend ce qu'il
   faut facturer, quand, et ce qui cloche. C'est la partie qu'on peut éprouver
   sans navigateur — et celle qui coûte cher si elle se trompe.

   CE QUE DIT L'ASSURANCE MALADIE (circulaires CIR-6/2021 et CIR-12/2016,
   nomenclature des perfusions à domicile) :

   — L'installation se facture le jour de la pose. En GRAVITÉ, le forfait 6
     couvre l'installation ET le suivi : il n'y a pas de forfait de suivi à
     ajouter, et en ajouter un est la première erreur de facturation du métier.
   — Les consommables se facturent CHAQUE SEMAINE, À TERME ÉCHU. La semaine
     court à partir de la première perfusion ; la première facturation tombe
     donc à J+6, la deuxième à J+13, et ainsi de suite.
   — L'unité est la semaine de 7 jours, SAUF pour le forfait 17, qui se
     facture à la perfusion.
   — Une semaine sans perfusion ne se facture pas. Une interruption de 7 jours
     ou plus entre deux perfusions ne se facture pas non plus.
   — Une nouvelle cure par gravité n'est prise en charge qu'après SIX SEMAINES
     depuis le dernier jour de la cure précédente.
   — En gravité seule, on ne facture pas plus de 3 perfusions par jour.
   — Les forfaits d'entretien d'une voie centrale (21 et 22) se facturent quand
     la voie n'a pas été mobilisée pendant au moins 7 jours, et ne se cumulent
     pas avec des consommables sur cette même voie.

   LES TARIFS SONT INDICATIFS. Ils bougent ; les codes, beaucoup moins. PILOT
   affiche les deux, mais c'est le CODE qu'on saisit dans le LGO — le montant
   n'est là que pour relire la facture d'un œil.
   ════════════════════════════════════════════════════════════════════════════ */
(function (racine) {
  'use strict';

  // Tarifs TTC relevés au 28/10/2024. La date est affichée à l'écran : un
  // chiffre sans date de relevé finit par être cru plus longtemps qu'il ne
  // mérite.
  const PF_TARIFS_AU = '28/10/2024';
  const PF_FORFAITS = {
    F6:  { num: 6,  code: '1172619', pu: 45.79,
           lbl: 'Installation et suivi — perfusion par gravité', unite: 'cure' },
    F17: { num: 17, code: '1185160', pu: 10.80,
           lbl: 'Consommables gravité — moins de 15 perfusions par 28 jours', unite: 'perfusion' },
    F18: { num: 18, code: '1121326', pu: 76.02,
           lbl: 'Consommables gravité — 1 perfusion par jour', unite: 'semaine' },
    F19: { num: 19, code: '1143279', pu: 143.80,
           lbl: 'Consommables gravité — 2 perfusions par jour', unite: 'semaine' },
    F20: { num: 20, code: '1153616', pu: 204.24,
           lbl: 'Consommables gravité — plus de 2 perfusions par jour', unite: 'semaine' },
    F21: { num: 21, code: '1103392', pu: 9.16,
           lbl: 'Entretien de voie veineuse centrale (chambre implantable, cathéter central)', unite: 'entretien' },
    F22: { num: 22, code: '1170419', pu: 17.86,
           lbl: 'Entretien de voie veineuse centrale insérée par voie périphérique (PICC line)', unite: 'entretien' }
  };

  // Les voies, et ce qu'elles entraînent. Le forfait d'entretien dépend de la
  // voie et de rien d'autre : un PICC line n'est pas une chambre implantable.
  const PF_VOIES = {
    sc:       { lbl: 'Voie sous-cutanée',      groupe: 'peripherique', entretien: null },
    iv:       { lbl: 'Voie veineuse',          groupe: 'peripherique', entretien: null },
    picc:     { lbl: 'PICC line',              groupe: 'centrale',     entretien: 'F22' },
    chambre:  { lbl: 'Chambre implantable',    groupe: 'centrale',     entretien: 'F21' },
    catheter: { lbl: 'Cathéter central',       groupe: 'centrale',     entretien: 'F21' }
  };

  // Le type de perfusion ne décide d'aucun forfait — il décide de ce qu'on
  // prépare, de ce qu'on livre, et de la tête que doit avoir le rythme. Un
  // Aclasta qui arriverait en « 1 perfusion par jour » est une faute de saisie.
  const PF_TYPES = {
    aclasta:    { lbl: 'Aclasta (acide zolédronique)', rythme: 'unite',     perfusions: 1 },
    g5:         { lbl: 'G5 / sérum physiologique',     rythme: null },
    atb:        { lbl: 'Antibiothérapie',              rythme: null },
    immuno:     { lbl: 'Immunoglobulines',             rythme: null },
    entretien:  { lbl: 'Entretien de voie (PICC line, chambre)', rythme: 'entretien' },
    autre:      { lbl: 'Autre (à préciser)',           rythme: null }
  };

  // Les rythmes, tels que la nomenclature les découpe. On ne demande pas à
  // l'équipe de choisir un code : on lui demande à quel rythme le patient est
  // perfusé, et le code en découle.
  const PF_RYTHMES = {
    unite: { lbl: 'Moins de 15 perfusions par 28 jours (facturation à la perfusion)', forfait: 'F17' },
    j1:    { lbl: '1 perfusion par jour',          forfait: 'F18', parJour: 1 },
    j2:    { lbl: '2 perfusions par jour',         forfait: 'F19', parJour: 2 },
    j3:    { lbl: 'Plus de 2 perfusions par jour', forfait: 'F20', parJour: 3 }
  };

  // ── Dates ────────────────────────────────────────────────────────────────
  // Tout se passe à midi. Une date lue à minuit bascule la veille dès qu'un
  // fuseau s'en mêle, et une échéance de facturation datée d'hier est une
  // échéance qu'on croit en retard.
  function pfD(iso) { return new Date(String(iso).slice(0, 10) + 'T12:00:00'); }
  function pfIso(d) {
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function pfPlus(iso, n) { const d = pfD(iso); d.setDate(d.getDate() + n); return pfIso(d); }
  function pfEcart(a, b) { return Math.round((pfD(b) - pfD(a)) / 86400000); }
  function pfFr(iso) {
    const p = String(iso || '').slice(0, 10).split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : (iso || '');
  }
  function pfValide(iso) { return /^\d{4}-\d{2}-\d{2}$/.test(String(iso || '')); }

  // ── La fin de cure ───────────────────────────────────────────────────────
  // Elle est donnée, ou déduite d'une durée. Pas les deux : une durée qui
  // contredit une date de fin se tranche en faveur de la date, qui est celle
  // que le médecin a écrite.
  function pfFin(f) {
    if (pfValide(f && f.fin)) return f.fin;
    const d = parseInt((f && f.duree) || 0, 10);
    if (pfValide(f && f.debut) && d > 0) return pfPlus(f.debut, d - 1);
    return null;
  }

  // ── Le forfait de consommables, déduit du rythme ─────────────────────────
  function pfForfaitRythme(f) {
    const r = PF_RYTHMES[f && f.rythme];
    return r ? r.forfait : null;
  }

  // CE QUE PILOT PROPOSE, À PARTIR D'UN SEUL CHIFFRE : le nombre de perfusions
  // par semaine. On ne demande pas à l'équipe de choisir un code dans une
  // nomenclature — on lui demande à quel rythme le patient est perfusé, ce
  // qu'elle lit sur l'ordonnance, et le forfait en découle :
  //
  //   jusqu'à 6 par semaine → forfait 17, à la perfusion (c'est la borne des
  //       « 6 perfusions sur 7 jours » de la circulaire, et la formulation
  //       « moins de 6 perfusions par semaine » des tableaux du métier) ;
  //   7 par semaine, soit une par jour → forfait 18 ;
  //   jusqu'à 14, soit deux par jour → forfait 19 ;
  //   au-delà → forfait 20.
  //
  // LA PROPOSITION N'EST PAS UNE DÉCISION : le forfait retenu reste
  // modifiable d'un clic, et c'est lui qui est enregistré. L'ordonnance est
  // sous les yeux de l'équipe, pas sous les nôtres.
  function pfSuggereRythme(perfSemaine) {
    const n = parseFloat(perfSemaine);
    if (!(n > 0)) return null;
    if (n <= 6) return 'unite';
    if (n <= 7) return 'j1';
    if (n <= 14) return 'j2';
    return 'j3';
  }

  // ── Les semaines de la cure ──────────────────────────────────────────────
  // La semaine court à partir de la PREMIÈRE PERFUSION, pas du lundi. C'est la
  // règle, et c'est aussi la seule qui tienne : deux patients installés des
  // jours différents n'ont pas la même semaine.
  function pfSemaines(f) {
    const fin = pfFin(f);
    if (!pfValide(f && f.debut) || !pfValide(fin) || pfEcart(f.debut, fin) < 0) return [];
    const out = [];
    let du = f.debut, no = 1;
    while (pfEcart(du, fin) >= 0 && no < 200) {
      const au = (pfEcart(du, fin) >= 6) ? pfPlus(du, 6) : fin;
      out.push({ no: no, du: du, au: au,
                 jours: pfEcart(du, au) + 1,
                 complete: pfEcart(du, au) === 6 });
      du = pfPlus(du, 7); no++;
    }
    return out;
  }

  // Combien de perfusions dans cette semaine-là, pour le forfait 17 qui se
  // facture à la perfusion. Deux cas :
  //   — un nombre total est déclaré (un Aclasta, c'est UNE perfusion, et pas
  //     une par semaine jusqu'à la fin du monde) : on sert les semaines dans
  //     l'ordre jusqu'à épuisement ;
  //   — sinon, le rythme hebdomadaire s'applique, proraté sur une semaine
  //     incomplète.
  // La quantité reste modifiable au moment de facturer : c'est le réel qui
  // fait foi, pas la prévision.
  function pfPerfusionsSemaine(f, sem, dejaPlacees) {
    const parSem = parseFloat((f && f.perfSemaine) || 0);
    if (!(parSem > 0)) return 0;
    const total = parseInt((f && f.nbPerfusions) || 0, 10);
    const voulu = sem.complete ? Math.round(parSem)
                               : Math.ceil(parSem * sem.jours / 7);
    if (total > 0) return Math.max(0, Math.min(voulu, total - (dejaPlacees || 0)));
    return voulu;
  }

  // ── L'échéancier ─────────────────────────────────────────────────────────
  // Une échéance = une ligne de travail : « le tant, facturer ceci ». Elle
  // porte sa date d'exigibilité (duLe), la période qu'elle couvre, et les
  // lignes à saisir dans le LGO.
  function pfLigne(cle, qte) {
    const F = PF_FORFAITS[cle];
    const q = Math.max(0, Math.round((qte || 0) * 100) / 100);
    return { forfait: cle, num: F.num, code: F.code, lbl: F.lbl, unite: F.unite,
             qte: q, pu: F.pu, total: Math.round(q * F.pu * 100) / 100 };
  }
  function pfTotal(lignes) {
    return Math.round(lignes.reduce((s, l) => s + l.total, 0) * 100) / 100;
  }

  function pfEcheancier(f) {
    if (!f) return [];
    const fin = pfFin(f);
    // UNE CURE QUI FINIT AVANT DE COMMENCER N'EST PAS UNE CURE. On ne facture
    // pas même l'installation : la fiche est à corriger d'abord.
    if (!pfValide(f.debut) || !pfValide(fin) || pfEcart(f.debut, fin) < 0) return [];
    const out = [];

    // L'ENTRETIEN DE VOIE N'EST PAS UNE CURE. Il n'y a ni installation ni
    // consommables : un acte, un forfait, et la règle des 7 jours sans
    // mobilisation de la voie.
    if (f.mode === 'entretien') {
      const cle = (PF_VOIES[f.voie] || {}).entretien;
      if (!cle) return [];
      pfSemaines(f).forEach(function (s) {
        out.push({ no: s.no, type: 'entretien', du: s.du, au: s.au,
                   duLe: s.au, complete: s.complete,
                   lignes: [pfLigne(cle, 1)], total: PF_FORFAITS[cle].pu });
      });
      return out;
    }

    // Gravité. L'installation d'abord, le jour de la pose : elle est due, et
    // elle emporte le suivi.
    if (!f.sansInstallation) {
      out.push({ no: 0, type: 'installation', du: f.debut, au: f.debut, duLe: f.debut,
                 complete: true, lignes: [pfLigne('F6', 1)], total: PF_FORFAITS.F6.pu });
    }

    const cle = pfForfaitRythme(f);
    if (!cle) return out;
    let placees = 0;
    pfSemaines(f).forEach(function (s) {
      const n = pfPerfusionsSemaine(f, s, placees);
      // UNE SEMAINE SANS PERFUSION NE SE FACTURE PAS. On ne l'affiche même
      // pas : une échéance à zéro euro est une invitation à la facturer.
      if (n <= 0) return;
      const ligne = (cle === 'F17') ? pfLigne('F17', n) : pfLigne(cle, 1);
      placees += (cle === 'F17') ? n : 0;
      out.push({ no: s.no, type: 'semaine', du: s.du, au: s.au,
                 // À TERME ÉCHU : le dernier jour de la semaine couverte. Pour
                 // une cure qui s'arrête en milieu de semaine, c'est le dernier
                 // jour de la cure — on ne facture pas un service pas rendu.
                 duLe: s.au, complete: s.complete,
                 perfusions: n, lignes: [ligne], total: ligne.total });
    });
    return out;
  }

  // ── Les contrôles ────────────────────────────────────────────────────────
  // Trois niveaux, et la distinction compte : « bloc » empêche de facturer,
  // « alerte » demande qu'on regarde, « info » rappelle une vérification qui
  // ne se fait pas depuis PILOT. Tout mettre en rouge revient à ne rien dire.
  function pfControles(f, historique) {
    const out = [], fin = pfFin(f || {});
    const dire = (niveau, texte) => out.push({ niveau: niveau, texte: texte });
    if (!f) return out;

    if (!pfValide(f.debut)) dire('bloc', 'Sans date de première perfusion, rien ne peut être facturé.');
    if (!pfValide(fin)) dire('bloc', 'Il manque la fin de cure, ou sa durée en jours.');
    if (pfValide(f.debut) && pfValide(fin) && pfEcart(f.debut, fin) < 0)
      dire('bloc', 'La fin de cure précède la première perfusion.');
    if (f.mode !== 'entretien' && !pfForfaitRythme(f))
      dire('bloc', 'Le rythme des perfusions n’est pas renseigné : aucun forfait de consommables ne peut en être déduit.');
    if (f.mode === 'entretien' && !(PF_VOIES[f.voie] || {}).entretien)
      dire('bloc', 'L’entretien ne se facture que sur une voie veineuse centrale (PICC line, chambre implantable, cathéter central).');
    // HORS AMM : pas de remboursement des forfaits associés. La case est au
    // formulaire, et son absence arrête la facturation plutôt que de la laisser
    // partir à l'aveugle.
    if (f.amm === false)
      dire('bloc', 'Prescription signalée hors AMM : les forfaits PERFADOM associés ne sont pas remboursables.');

    const parSem = parseFloat(f.perfSemaine || 0);
    if (f.mode !== 'entretien' && !(parSem > 0))
      dire('bloc', 'Le nombre de perfusions par semaine n’est pas renseigné : c’est lui qui désigne le forfait.');
    if (parSem > 21)
      dire('alerte', 'En gravité seule, la prise en charge s’arrête à 3 perfusions par jour, soit 21 par semaine.');
    // LE FORFAIT RETENU NE SUIT PLUS LE RYTHME SAISI. Cela peut être voulu —
    // l'ordonnance est sous les yeux de l'équipe — mais cela se dit.
    const propose = pfSuggereRythme(parSem);
    if (f.mode !== 'entretien' && propose && f.rythme && f.rythme !== propose)
      dire('alerte', 'Le rythme saisi (' + parSem + ' perfusion(s) par semaine) désignerait plutôt le forfait '
        + PF_FORFAITS[PF_RYTHMES[propose].forfait].num + '. Le forfait '
        + PF_FORFAITS[PF_RYTHMES[f.rythme].forfait].num + ' a été retenu à la main.');
    // La borne des 15 perfusions sur 28 jours, pour le forfait à la perfusion.
    if (f.rythme === 'unite' && parSem * 4 >= 15)
      dire('alerte', 'À ' + parSem + ' perfusions par semaine, le cumul dépasse 15 perfusions sur 28 jours : '
        + 'vérifiez que le forfait 17 reste le bon.');
    // NON-CUMUL : l'entretien d'une voie et les consommables sur cette même
    // voie ne se facturent pas ensemble.
    if (f.mode !== 'entretien' && (PF_VOIES[f.voie] || {}).groupe === 'centrale' && f.entretienAussi)
      dire('alerte', 'Entretien et consommables ne se cumulent pas sur la même voie.');

    // LES SIX SEMAINES ENTRE DEUX CURES. PILOT sait ce qu'il a lui-même
    // enregistré, et le dit ; il ne sait rien de ce qui s'est passé ailleurs.
    const ante = pfCurePrecedente(f, historique);
    if (ante && ante.ecart < 42)
      dire('alerte', 'Cure par gravité terminée le ' + pfFr(ante.fin) + ', il y a ' + ante.ecart
        + ' jours : une nouvelle cure n’est prise en charge qu’après six semaines (42 jours).');
    if (ante && ante.ecart >= 42 && ante.ecart < 182)
      dire('info', 'Ce patient a déjà eu une cure à domicile le ' + pfFr(ante.fin)
        + '. Vérifiez qu’aucune autre cure ni NPAD n’a eu lieu ailleurs dans les 26 dernières semaines.');
    if (!ante)
      dire('info', 'Vérifiez auprès du patient ou de l’hôpital qu’il n’a pas eu de perfusion à domicile '
        + 'ou de nutrition parentérale dans les 26 dernières semaines.');

    // LES PRESTATIONS SONT DANS LE FORFAIT. Les oublier, ce n'est pas perdre
    // de l'argent : c'est facturer un forfait dont une partie n'a pas été
    // rendue. En cas de contrôle, c'est la fiche qui répond.
    const m = f.modalites || {};
    const duesF6 = ['livraison', 'pied', 'demo', 'conseil', 'livret', 'liaison'];
    const manque = duesF6.filter(k => !m[k]).length;
    if (f.mode !== 'entretien' && manque)
      dire('alerte', manque + ' prestation(s) du forfait d’installation non cochée(s) : elles sont comprises '
        + 'dans le forfait 6 et doivent être faites — livraison, pied à sérum, démonstration, conseil, livret, liaison avec l’infirmière.');
    return out;
  }

  // La cure antérieure la plus récente du même patient, parmi ce que PILOT
  // connaît. On compare sur nom + prénom + date de naissance : c'est la règle
  // de la maison pour désigner une personne.
  function pfMemePatient(a, b) {
    const n = s => String(s || '').trim().toUpperCase();
    if (n(a.nom) !== n(b.nom) || n(a.prenom) !== n(b.prenom)) return false;
    if (a.dob && b.dob) return String(a.dob).slice(0, 10) === String(b.dob).slice(0, 10);
    return true;
  }
  function pfCurePrecedente(f, historique) {
    if (!Array.isArray(historique) || !pfValide(f && f.debut)) return null;
    let best = null;
    historique.forEach(function (x) {
      if (!x || x === f || x.id === f.id) return;
      if (x.mode === 'entretien' || !pfMemePatient(f, x)) return;
      const fx = pfFin(x);
      if (!pfValide(fx) || pfEcart(fx, f.debut) < 0) return;      // cure postérieure : hors sujet
      const e = pfEcart(fx, f.debut);
      if (!best || e < best.ecart) best = { fin: fx, ecart: e, fiche: x };
    });
    return best;
  }

  // ── Ce qui est dû ────────────────────────────────────────────────────────
  // Une échéance est due quand sa date est atteinte et qu'elle n'a pas été
  // facturée. `jours` ouvre une fenêtre vers l'avant : la liste « à préparer »
  // du module Renouvellement regarde sept jours devant elle.
  function pfDues(fiches, aujourdhui, jours) {
    const auj = pfValide(aujourdhui) ? aujourdhui : pfIso(new Date());
    const fen = (jours == null) ? 0 : jours;
    const out = [];
    (fiches || []).forEach(function (f) {
      if (!f || f.statut === 'annulee') return;
      const faites = f.facturees || {};
      pfEcheancier(f).forEach(function (e) {
        if (faites[e.no]) return;
        const d = pfEcart(auj, e.duLe);
        if (d > fen) return;
        out.push({ ficheId: f.id, nom: f.nom, prenom: f.prenom, dob: f.dob,
                   echeance: e, retard: -d, date: e.duLe });
      });
    });
    out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    return out;
  }

  const api = { PF_FORFAITS, PF_VOIES, PF_TYPES, PF_RYTHMES, PF_TARIFS_AU,
                pfD, pfIso, pfPlus, pfEcart, pfFr, pfValide, pfFin,
                pfForfaitRythme, pfSuggereRythme, pfSemaines, pfPerfusionsSemaine,
                pfLigne, pfTotal, pfEcheancier, pfControles, pfCurePrecedente, pfDues };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else racine.pfMoteur = api;
}(typeof window !== 'undefined' ? window : globalThis));
