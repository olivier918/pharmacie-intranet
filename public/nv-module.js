/* ════════════════════════════════════════════════════════════════════════════
   Module NAVETTE DES SALAIRES — le décompte mensuel transmis au cabinet

   Ce fichier ne calcule qu'une chose, mais il la calcule juste : combien
   d'heures chacun a faites dans le mois, et comment elles se répartissent
   entre le contractuel, les heures supplémentaires et les heures
   complémentaires. Tout le reste — la mise en page du fichier, l'écran de
   relecture — s'appuie dessus.

   LES DEUX RÈGLES VIENNENT DU MODÈLE DU CABINET, mot pour mot :
     « Temps complet — heures supplémentaires à 125 %, au-delà de 35h00 et
       jusqu'à la 43ème heure par semaine »
     « Temps complet — heures supplémentaires à 150 %, au-delà de la 43ème
       heure par semaine »
     « Temps partiel — heures complémentaires jusqu'à 10 % de l'horaire
       hebdomadaire contractuel » puis « au-delà de 10 % »

   ELLES SE LISENT À LA SEMAINE, JAMAIS SUR LE MOIS. Trois semaines à 38 h et
   une à 44 h ne donnent pas le même bulletin que 158 h ramenées à une moyenne :
   la première combinaison vaut 9 h à 125 % et 1 h à 150 %, la seconde n'existe
   pas. Un décompte mensuel qui moyennerait serait faux dans les deux sens.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ── Les seuils, tels que le cabinet les écrit ────────────────────────────
  const NV_DUREE_LEGALE = 35;    // au-delà : heures supplémentaires
  const NV_SEUIL_150    = 43;    // au-delà : second taux
  const NV_PART_COMPL   = 0.10;  // temps partiel : 10 % de l'horaire contractuel
  // 52 semaines sur 12 mois : la mensualisation d'un horaire hebdomadaire.
  // 35 h donnent 151,67 ; 27 h donnent 117,00 — les deux chiffres de la navette.
  const NV_SEM_PAR_MOIS = 52 / 12;

  function nvNombre(x) { const n = parseFloat(String(x == null ? '' : x).replace(',', '.')); return isNaN(n) ? 0 : n; }
  function nvArrondi(x) { return Math.round((nvNombre(x) + Number.EPSILON) * 100) / 100; }

  // UN TEMPS COMPLET EST CELUI QUI ATTEINT LA DURÉE LÉGALE. En dessous, le
  // salarié est à temps partiel et ses heures en plus sont COMPLÉMENTAIRES,
  // pas supplémentaires — ce ne sont ni les mêmes lignes ni les mêmes taux.
  function nvTempsPlein(base) { return nvNombre(base) >= NV_DUREE_LEGALE; }

  // Les heures mensualisées d'un horaire hebdomadaire.
  function nvHeuresContractuelles(base) { return nvArrondi(nvNombre(base) * NV_SEM_PAR_MOIS); }

  // ═══ LE PARTAGE D'UNE SEMAINE ═════════════════════════════════════════════
  // Olivier, le 31/10 : « certains salariés ont des emplois du temps alternés,
  // semaine à 36 h et semaine à 34 h : pas d'heure supplémentaire dans ce
  // cas-là. » Et il a raison — c'est tout le principe du cycle. Deux semaines
  // qui font 36 puis 34 valent 35 de moyenne : le contrat est rempli, rien
  // n'est dû en plus. Compter 1 h supplémentaire la semaine à 36 reviendrait
  // à payer deux fois ce que la semaine à 34 a déjà rendu.
  //
  // LA RÉFÉRENCE N'EST DONC PAS 35 H, C'EST CE QUE LA TRAME PRÉVOYAIT cette
  // semaine-là. PILOT la connaît : c'est la semaine type du cycle, celle-là
  // même qui sert déjà au compte-temps.
  //
  // UNE HEURE EST SUPPLÉMENTAIRE QUAND ELLE EST À LA FOIS au-delà de ce qui
  // était prévu ET au-delà de la durée légale. Les deux conditions comptent :
  //   · prévu 36, fait 36  → rien : la semaine est celle du cycle ;
  //   · prévu 34, fait 36  → 1 h seulement, celle qui dépasse 35 ;
  //                           la 35ᵉ rattrape le cycle, elle n'est pas due ;
  //   · prévu 36, fait 40  → 4 h ;
  //   · prévu 36, fait 46  → 10 h, dont 3 au-delà de la 43ᵉ.
  // Le TAUX, lui, dépend de la place de l'heure dans la semaine — 125 %
  // jusqu'à la 43ᵉ, 150 % au-delà — pendant que la QUANTITÉ dépend de l'écart
  // à la trame. Les deux ne se confondent pas.
  //
  // Propriété heureuse : une semaine travaillée comme prévu ne produit rien,
  // quel que soit son rang dans le cycle. La navette donne donc le même total
  // où que tombe la borne du 20 — ce que l'essai vérifie.
  //
  // `prevues` absent (ancien appel, ou trame inconnue) : on retombe sur la
  // durée légale, c'est-à-dire sur le comportement d'un horaire fixe à 35 h.
  function nvSemaine(faites, base, prevues) {
    const h = Math.max(0, nvNombre(faites)), b = nvNombre(base);
    const out = { t125: 0, t150: 0, c10: 0, cPlus: 0, anomalie: null };
    if (!b) { out.anomalie = 'base'; return out; }      // contrat sans horaire : on ne devine pas
    const pr = (prevues == null || prevues === '') ? null : Math.max(0, nvNombre(prevues));

    if (nvTempsPlein(b)) {
      // Le seuil : le plus haut des deux. Jamais en dessous de la durée légale
      // — une heure sous 35 h n'est pas supplémentaire, même si elle dépasse
      // une semaine creuse du cycle.
      const seuil = Math.max(NV_DUREE_LEGALE, pr == null ? NV_DUREE_LEGALE : pr);
      const sup = Math.max(0, h - seuil);
      // Au-delà de la 43ᵉ, mais sans jamais dépasser ce qui est dû.
      out.t150 = nvArrondi(Math.min(Math.max(0, h - NV_SEUIL_150), sup));
      out.t125 = nvArrondi(sup - out.t150);
      // UNE TRAME QUI PRÉVOIT PLUS DE 43 H n'est pas un cycle ordinaire : on le
      // dit plutôt que de laisser des heures passer silencieusement à 125 %.
      if (pr != null && pr > NV_SEUIL_150) out.anomalie = 'trame_haute';
      return out;
    }

    // Temps partiel : même raisonnement, la durée contractuelle tenant lieu de
    // durée légale. Le plafond des 10 %, lui, se calcule toujours sur la BASE
    // du contrat — c'est elle que le cabinet écrit, pas la semaine du cycle.
    const seuil = Math.max(b, pr == null ? b : pr);
    const sup = Math.max(0, h - seuil);
    const plafond = b * NV_PART_COMPL;
    out.c10 = nvArrondi(Math.min(sup, plafond));
    out.cPlus = nvArrondi(Math.max(0, sup - plafond));
    // UN TEMPS PARTIEL QUI DÉPASSE LA DURÉE LÉGALE n'est plus un temps partiel :
    // la requalification ne se décide pas dans un tableur. On le signale.
    if (h > NV_DUREE_LEGALE) out.anomalie = 'depassement';
    return out;
  }

  // ═══ LE MOIS ══════════════════════════════════════════════════════════════
  // La somme des semaines, chacune partagée selon ses propres heures. On NE
  // somme PAS les heures du mois pour partager ensuite : ce serait moyenner.
  function nvMois(semaines, base) {
    const tot = { t125: 0, t150: 0, c10: 0, cPlus: 0, faites: 0, anomalies: [] };
    (semaines || []).forEach(function (s) {
      const h = nvNombre(s && s.heures != null ? s.heures : s);
      // `prevues` : les heures de la trame pour CETTE semaine du cycle.
      const r = nvSemaine(h, base, s && s.prevues != null ? s.prevues : null);
      tot.t125 += r.t125; tot.t150 += r.t150; tot.c10 += r.c10; tot.cPlus += r.cPlus;
      tot.faites += h;
      if (r.anomalie) tot.anomalies.push({ lundi: (s && s.lundi) || null, quoi: r.anomalie, heures: h });
    });
    ['t125', 't150', 'c10', 'cPlus', 'faites'].forEach(function (k) { tot[k] = nvArrondi(tot[k]); });
    return tot;
  }

  // ═══ LA FENÊTRE DES HEURES : DU 20 AU 19 ═════════════════════════════════
  // Olivier, le 31/10 : « la navette est éditée le 20 du mois pour être envoyée
  // au cabinet afin qu'il prépare les bulletins ; les heures supplémentaires
  // sont donc comptabilisées au réel du 20 du mois précédent au 20 du mois en
  // cours », puis, sur la borne : DU 20 AU 19.
  //
  // La navette d'octobre couvre donc le 20 septembre au 19 octobre INCLUS, et
  // celle de novembre reprend au 20 octobre. Aucun jour compté deux fois,
  // aucun oublié — ce qui n'a rien d'évident : une borne « du 20 au 20 »
  // ferait payer deux fois les heures du 20.
  //
  // CE N'EST PAS LE MOIS CIVIL, et c'est tout le piège de ce module : les
  // congés, eux, se déclarent au mois civil (voir plus bas). Deux fenêtres
  // cohabitent donc dans un même document, et les confondre se voit sur un
  // bulletin.
  const NV_BORNE = 20;   // premier jour de la fenêtre, dans le mois précédent

  function nvMoisDecale(mois, n) {
    const a = parseInt(String(mois).slice(0, 4), 10), m = parseInt(String(mois).slice(5, 7), 10);
    if (!a || !m) return null;
    const d = new Date(Date.UTC(a, m - 1 + n, 1));
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
  }
  function nvFenetre(mois) {
    const pre = nvMoisDecale(mois, -1);
    if (!pre) return null;
    const j = String(NV_BORNE).padStart(2, '0');
    return { debut: pre + '-' + j, fin: mois + '-' + String(NV_BORNE - 1).padStart(2, '0') };
  }

  // ═══ UNE SEMAINE APPARTIENT À LA NAVETTE OÙ ELLE FINIT ═══════════════════
  // Choix d'Olivier du 31/10. La semaine est l'unité du calcul — on ne la coupe
  // pas en deux pour la répartir au prorata : on paierait des fractions d'heure
  // impossibles à défendre devant un salarié. Elle part donc entière sur la
  // navette dont la fenêtre contient son DIMANCHE.
  function nvDimanche(lundi) {
    const d = new Date(String(lundi).slice(0, 10) + 'T12:00:00Z');
    if (isNaN(d)) return '';
    d.setUTCDate(d.getUTCDate() + 6);
    return d.toISOString().slice(0, 10);
  }
  function nvSemaineRetenue(lundi, mois) {
    const f = nvFenetre(mois); if (!f) return false;
    const dim = nvDimanche(lundi); if (!dim) return false;
    return dim >= f.debut && dim <= f.fin;
  }
  function nvSemainesRetenues(semaines, mois) {
    return (semaines || []).filter(function (s) {
      return s && nvSemaineRetenue(s.lundi, mois);
    });
  }

  // ═══ LES PÉRIODES D'ABSENCE ═══════════════════════════════════════════════
  // DEUXIÈME FENÊTRE, ET C'EST VOULU : « les vacances sont déclarées du mois »
  // (Olivier, 31/10). Les congés et les absences suivent le MOIS CIVIL, pas la
  // fenêtre du 20 au 19 qui ne vaut que pour les heures. Un document, deux
  // fenêtres — c'est contre-intuitif, et c'est pour cela que l'écran les
  // affiche toutes les deux en toutes lettres.
  //
  // Règle d'Olivier (31/10) : « la période TOTALE est indiquée sur les navettes
  // des deux mois concernés ». Un congé du 28/10 au 06/11 s'écrit donc
  // « 28/10 → 06/11 » sur octobre ET sur novembre — on ne découpe pas aux
  // bornes du mois. Vaut pour les congés comme pour les arrêts maladie.
  function nvChevauche(a, mois) {
    if (!a || !a.debut || !a.fin || !mois) return false;
    const d1 = mois + '-01', d2 = mois + '-31';   // comparaison de chaînes ISO,
    // « -31 » majore sans risque : aucune date réelle du mois ne lui est supérieure.
    return a.debut <= d2 && a.fin >= d1;
  }
  function nvPeriodes(absences, mois, motif) {
    return (absences || [])
      .filter(function (a) { return a && a.motif === motif && nvChevauche(a, mois); })
      .slice().sort(function (a, b) { return a.debut < b.debut ? -1 : a.debut > b.debut ? 1 : 0; });
  }
  function nvJoliJour(iso) {
    const p = String(iso || '').slice(0, 10).split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : '';
  }
  // Deux périodes distinctes dans le même mois tiennent sur les mêmes lignes
  // DU / AU, séparées par « et » (choix d'Olivier du 31/10) : les débuts sur la
  // ligne DU, les fins sur la ligne AU, dans le même ordre.
  function nvDuAu(periodes) {
    const l = periodes || [];
    return { du: l.map(function (a) { return nvJoliJour(a.debut); }).join(' et '),
             au: l.map(function (a) { return nvJoliJour(a.fin); }).join(' et ') };
  }

  // ── exposé pour les essais et pour l'écran ───────────────────────────────
  window.nvSemaine = nvSemaine;
  window.nvMois = nvMois;
  window.nvTempsPlein = nvTempsPlein;
  window.nvHeuresContractuelles = nvHeuresContractuelles;
  window.nvPeriodes = nvPeriodes;
  window.nvDuAu = nvDuAu;
  window.nvFenetre = nvFenetre;
  window.nvMoisDecale = nvMoisDecale;
  window.nvDimanche = nvDimanche;
  window.nvSemaineRetenue = nvSemaineRetenue;
  window.nvSemainesRetenues = nvSemainesRetenues;
  window.nvSeuils = function () {
    return { legale: NV_DUREE_LEGALE, seuil150: NV_SEUIL_150, compl: NV_PART_COMPL,
             semParMois: NV_SEM_PAR_MOIS, borne: NV_BORNE };
  };
})();
