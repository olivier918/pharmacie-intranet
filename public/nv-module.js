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
  // Rend les quatre rubriques du modèle pour UNE semaine. `anomalie` signale
  // ce qu'on ne doit pas décider tout seul.
  function nvSemaine(faites, base) {
    const h = Math.max(0, nvNombre(faites)), b = nvNombre(base);
    const out = { t125: 0, t150: 0, c10: 0, cPlus: 0, anomalie: null };
    if (!b) { out.anomalie = 'base'; return out; }      // contrat sans horaire : on ne devine pas

    if (nvTempsPlein(b)) {
      // On compte à partir de la DURÉE LÉGALE, pas de la base du contrat :
      // c'est ce qu'écrit le cabinet, et c'est la règle. Un contrat à 37 h
      // porte donc deux heures supplémentaires structurelles chaque semaine.
      const sup = Math.max(0, h - NV_DUREE_LEGALE);
      out.t125 = nvArrondi(Math.min(sup, NV_SEUIL_150 - NV_DUREE_LEGALE));
      out.t150 = nvArrondi(Math.max(0, h - NV_SEUIL_150));
      return out;
    }

    const sup = Math.max(0, h - b);
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
      const r = nvSemaine(h, base);
      tot.t125 += r.t125; tot.t150 += r.t150; tot.c10 += r.c10; tot.cPlus += r.cPlus;
      tot.faites += h;
      if (r.anomalie) tot.anomalies.push({ lundi: (s && s.lundi) || null, quoi: r.anomalie, heures: h });
    });
    ['t125', 't150', 'c10', 'cPlus', 'faites'].forEach(function (k) { tot[k] = nvArrondi(tot[k]); });
    return tot;
  }

  // ═══ LES PÉRIODES D'ABSENCE ═══════════════════════════════════════════════
  // Règle d'Olivier (31/10) : « la période TOTALE est indiquée sur les navettes
  // des deux mois concernés ». Un congé du 28/10 au 06/11 s'écrit donc
  // « 28/10 → 06/11 » sur octobre ET sur novembre — on ne découpe pas aux
  // bornes du mois. Vaut pour les congés comme pour les arrêts maladie.
  function nvChevauche(a, mois) {
    if (!a || !a.debut || !a.fin || !mois) return false;
    const d1 = mois + '-01', d2 = mois + '-31';   // comparaison de chaînes ISO
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
  window.nvSeuils = function () {
    return { legale: NV_DUREE_LEGALE, seuil150: NV_SEUIL_150, compl: NV_PART_COMPL, semParMois: NV_SEM_PAR_MOIS };
  };
})();
