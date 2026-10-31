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
  // LE CONTRAT AVEC LE PLANNING. Une semaine est { lundi, prevues, faites } —
  // c'est ce que `window.plNavette.semaines()` produit, et c'est le seul nom
  // que cette fonction lit. Elle a d'abord attendu `heures`, un nom qui
  // n'existait que dans ses propres essais : tout tombait a zero sans qu'une
  // seule verification ne s'en apercoive. L'essai « la forme que le planning
  // produit » garde cette couture.
  function nvMois(semaines, base) {
    const tot = { t125: 0, t150: 0, c10: 0, cPlus: 0, faites: 0, anomalies: [] };
    (semaines || []).forEach(function (s) {
      const h = nvNombre(s && s.faites);
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

  // ═══ LE DÉCOMPTE D'UN MOIS, SUR LES VRAIES DONNÉES ═══════════════════════
  // Rien n'est recalculé ici : les heures viennent du planning par son unique
  // point d'ouverture (window.plNavette), et le partage par les fonctions pures
  // du haut de ce fichier.
  function nvPL() { return (typeof window !== 'undefined' && window.plNavette) || null; }

  // Une ligne par salarié, telle que l'écran la montre et que le fichier la lit.
  function nvLigne(c, mois) {
    const pl = nvPL(), f = nvFenetre(mois);
    const base = nvNombre(c.base);
    const semTout = pl ? pl.semaines(c.id, f.debut, f.fin) : [];
    const sem = nvSemainesRetenues(semTout, mois);
    const m = nvMois(sem, base);
    const prevues = nvArrondi(sem.reduce(function (t, x) { return t + nvNombre(x.prevues); }, 0));
    // La trame SANS les absences : c'est elle qui dit si le contrat est tenu.
    const theorique = nvArrondi(sem.reduce(function (t, x) { return t + nvNombre(x.theorique); }, 0));
    const abs = pl ? pl.absences(c.id) : [];
    const cp = nvPeriodes(abs, mois, 'cp'), mal = nvPeriodes(abs, mois, 'mal');
    const mat = nvPeriodes(abs, mois, 'mat');
    const sol = pl ? pl.soldes(c.id) : { compte: 0 };
    return {
      id: c.id, nom: c.nom, role: c.role, base: base, grp: c.grp,
      renfort: nvEstRenfort(c),
      plein: nvTempsPlein(base),
      contract: nvHeuresContractuelles(base),
      faites: m.faites, prevues: prevues, theorique: theorique,
      nbSemaines: sem.length, semaines: sem,
      t125: m.t125, t150: m.t150, c10: m.c10, cPlus: m.cPlus,
      anomalies: m.anomalies,
      cp: nvDuAu(cp), mal: nvDuAu(mal), mat: nvDuAu(mat),
      cpPeriodes: cp, malPeriodes: mal, matPeriodes: mat,
      compte: sol.compte
    };
  }

  function nvEstRenfort(c) { return c && c.grp === 'renfort'; }
  function nvDecompte(mois) {
    const pl = nvPL();
    const cs = pl ? pl.contrats() : [];
    const toutes = cs.map(function (c) { return nvLigne(c, mois); });
    return { mois: mois, fenetre: nvFenetre(mois),
             lignes: toutes.filter(function (l) { return !l.renfort; }),
             renforts: toutes.filter(function (l) { return l.renfort; }),
             attente: pl ? pl.enAttente() : [] };
  }

  // LES CORRECTIONS A LA MAIN SURVIVENT AU RECALCUL. On ne remplace jamais une
  // valeur saisie : on la pose a cote de la valeur calculee, et l'ecran montre
  // les deux. Sans cela, « Tout recalculer » effacerait le travail de relecture.
  function nvAppliquer(ligne, corr) {
    const o = Object.assign({}, ligne, { calcule: {} });
    if (!corr) return o;
    ['base', 'contract', 't125', 't150', 'c10', 'cPlus'].forEach(function (k) {
      if (corr[k] == null || corr[k] === '') return;
      o.calcule[k] = ligne[k];
      o[k] = nvNombre(corr[k]);
    });
    ['cp', 'mal', 'mat'].forEach(function (k) {
      if (!corr[k]) return;
      o.calcule[k] = ligne[k];
      o[k] = { du: String(corr[k].du || ''), au: String(corr[k].au || '') };
    });
    return o;
  }

  // ── exposé pour les essais et pour l'écran ───────────────────────────────
  window.nvSemaine = nvSemaine;
  window.nvMois = nvMois;
  window.nvTempsPlein = nvTempsPlein;
  window.nvHeuresContractuelles = nvHeuresContractuelles;
  window.nvPeriodes = nvPeriodes;
  window.nvDuAu = nvDuAu;
  window.nvDecompte = nvDecompte;
  window.nvLigne = nvLigne;
  window.nvAppliquer = nvAppliquer;
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

/* ════════════════════════════════════════════════════════════════════════════
   L'ÉCRAN DE RELECTURE — ce qu'on lit avant d'envoyer au cabinet

   Un décompte juste qu'on envoie sans l'avoir lu reste un décompte qu'on
   n'a pas vérifié. Cet écran existe pour qu'on puisse corriger AVANT, pas
   s'excuser après : chaque chiffre est modifiable, et une valeur corrigée à la
   main garde la valeur calculée affichée dessous — sans quoi « Tout
   recalculer » effacerait le travail de relecture sans rien dire.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const NV_CSS = `
  .nv{--ac:#348466;--acs:#E6F1EB;--rosei:#B04A74;--ink:#25282A;--mut:#71787A;
    --line:#E9E2E1;--crit:#C4544A;--warn:#B8821C;--warns:#FBF3E2;--corr:#FFF6E0;--corrb:#E8CF95;
    padding:18px 22px;color:var(--ink);font-size:13px}
  .nv .bar{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:13px}
  .nv h1{font-size:19px;font-weight:800;margin:0;letter-spacing:-.3px}
  .nv h1 em{font-style:normal;color:var(--rosei)}
  .nv .sous{font-size:11.5px;color:var(--mut);margin-top:3px;line-height:1.5}
  .nv .grow{flex:1}
  .nv .mois{display:inline-flex;align-items:center;gap:4px;background:#fff;border:1px solid var(--line);
    border-radius:10px;padding:4px 6px;font-weight:700}
  .nv .mois button{border:none;background:none;cursor:pointer;color:var(--mut);font-size:15px;padding:0 6px;font-family:inherit}
  .nv .btn{border:none;border-radius:10px;padding:9px 15px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit}
  .nv .btn.pri{background:var(--ac);color:#fff}
  .nv .btn.gh{background:#fff;border:1px solid var(--line);color:var(--ink)}
  .nv .btn:disabled{opacity:.45;cursor:default}
  .nv .ctrl{background:var(--warns);border:1px solid #EBD9AE;border-left:4px solid var(--warn);
    border-radius:12px;padding:11px 14px;margin-bottom:13px;font-size:12.5px}
  .nv .ctrl b{color:#7A5A10}
  .nv .ctrl ul{margin:6px 0 0;padding-left:18px;line-height:1.7}
  .nv .ok{background:var(--acs);border:1px solid #CFE7DA;border-left:4px solid var(--ac);
    border-radius:12px;padding:10px 14px;margin-bottom:13px;font-size:12.5px;color:#2B5C48}
  .nv .carte{background:#fff;border:1px solid var(--line);border-radius:16px;padding:16px 18px;margin-bottom:13px}
  .nv .scroll{overflow-x:auto;margin:0 -18px;padding:0 18px}
  .nv table{border-collapse:separate;border-spacing:0;width:100%;font-size:12px}
  .nv .band th{font-size:8.5px;font-weight:800;letter-spacing:.8px;text-transform:uppercase;color:#fff;
    padding:4px 8px;text-align:center;border-radius:6px 6px 0 0}
  .nv .b-tt{background:#6B7A86}.nv .b-hs{background:var(--ac)}.nv .b-abs{background:var(--crit)}
  .nv thead th.h{font-size:8.5px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;color:var(--mut);
    padding:6px 5px 7px;text-align:center;vertical-align:bottom;border-bottom:1.5px solid var(--line);white-space:nowrap}
  .nv thead th.h.g{text-align:left}
  .nv tbody td{border-bottom:1px solid var(--line);padding:4px 4px;text-align:center;
    font-variant-numeric:tabular-nums;vertical-align:middle}
  .nv tbody td.g{text-align:left;padding-left:8px}
  .nv tr.grp td{background:var(--acs);font-size:8.5px;font-weight:800;letter-spacing:.9px;text-transform:uppercase;
    color:var(--ac);padding:4px 9px;text-align:left}
  .nv .qui b{font-size:12.5px;font-weight:700;display:block;line-height:1.2}
  .nv .qui span{font-size:9.5px;color:var(--mut)}
  .nv input.f{font-family:inherit;font-size:12px;font-weight:700;font-variant-numeric:tabular-nums;
    width:60px;text-align:center;border:1px solid transparent;border-radius:7px;padding:5px 3px;background:#fff;color:var(--ink)}
  .nv input.f:hover{border-color:var(--line);background:#FCFBFA}
  .nv input.f:focus{outline:none;border-color:var(--ac);box-shadow:0 0 0 2px rgba(52,132,102,.16)}
  .nv input.f.w{width:168px;font-weight:600;font-size:11.5px}
  .nv input.f.corr{background:var(--corr);border-color:var(--corrb)}
  .nv td.na{background:repeating-linear-gradient(135deg,#fff 0 5px,#F6F7F7 5px 10px)}
  .nv td.na span{color:#C3CAC6;font-size:11px}
  .nv .calc{display:block;font-size:8.5px;color:var(--mut);margin-top:1px}
  .nv .calc.c{color:var(--warn);font-weight:700}
  .nv .ro{color:var(--mut);font-weight:700}
  .nv tfoot td{padding:8px 4px;font-weight:800;background:var(--acs);border-top:2px solid var(--ac);
    text-align:center;font-variant-numeric:tabular-nums}
  .nv tfoot td.g{text-align:left;font-size:9.5px;letter-spacing:.5px;text-transform:uppercase;color:var(--ac)}
  .nv .legende{display:flex;gap:16px;flex-wrap:wrap;font-size:11px;color:var(--mut);margin-top:10px;
    padding-top:10px;border-top:1px solid var(--line)}
  .nv .legende i{font-style:normal;display:inline-block;width:13px;height:13px;border-radius:4px;
    vertical-align:-2px;margin-right:5px;border:1px solid var(--line)}
  .nv h2{font-size:11px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:var(--ac);
    margin:0 0 4px;display:flex;align-items:center;gap:10px}
  .nv h2::after{content:'';flex:1;height:1px;background:var(--line)}
  .nv .man{width:100%;border-collapse:collapse;font-size:12px}
  .nv .man th{font-size:8.5px;text-transform:uppercase;letter-spacing:.5px;color:var(--mut);
    text-align:left;padding:0 8px 5px;font-weight:800}
  .nv .man td{border-bottom:1px solid var(--line);padding:4px 8px;text-align:left}
  .nv .man input,.nv .man select{font-family:inherit;font-size:12px;width:100%;border:1px solid transparent;
    border-radius:7px;padding:6px 8px;background:#fff;color:var(--ink)}
  .nv .man input:hover,.nv .man select:hover{border-color:var(--line);background:#FCFBFA}
  .nv .man input:focus,.nv .man select:focus{outline:none;border-color:var(--ac);box-shadow:0 0 0 2px rgba(52,132,102,.16)}
  .nv .man td.lbl{font-weight:700;width:250px}
  .nv .man td.lbl span{display:block;font-weight:400;font-size:10px;color:var(--mut);margin-top:1px}
  .nv .x{background:none;border:none;color:var(--crit);cursor:pointer;font-size:14px;font-family:inherit}
  .nv .plus{background:none;border:1px dashed var(--line);border-radius:8px;color:var(--mut);
    padding:5px 11px;font-size:11.5px;cursor:pointer;font-family:inherit;margin-top:9px}
  .nv .pied{font-size:11px;color:var(--mut);line-height:1.6;margin-top:12px}
  `;

  function E(s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function nvNum(x) { const n = parseFloat(String(x == null ? '' : x).replace(',', '.')); return isNaN(n) ? 0 : n; }
  function nvAff(x) { return (x == null || x === '' || x === 0) ? '' : String(x).replace('.', ','); }
  const NV_MOIS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet',
                      'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  function nvMoisLbl(m) {
    const a = String(m).slice(0, 4), i = parseInt(String(m).slice(5, 7), 10) - 1;
    return (NV_MOIS_FR[i] || '?') + ' ' + a;
  }
  function nvJoli(iso) { const p = String(iso || '').slice(0, 10).split('-'); return p.length === 3 ? p[2] + '/' + p[1] : ''; }

  // ── L'enregistrement du mois : corrections et lignes manuelles ───────────
  // UNE NAVETTE PAR MOIS, identifiant calculé. Deux postes qui ouvriraient le
  // même mois en même temps écrivent le même enregistrement, pas deux.
  function nvColl() {
    if (typeof window.plNavettes === 'undefined' || !Array.isArray(window.plNavettes)) window.plNavettes = [];
    return window.plNavettes;
  }
  function nvDossier(mois, creer) {
    const id = 'nv:' + mois;
    let d = nvColl().find(function (x) { return x && x.id === id; });
    if (!d && creer) {
      d = { id: id, mois: mois, corrections: {}, manuelles: [], etudiants: '',
            genereLe: null, generePar: null, updatedAt: Date.now() };
      nvColl().push(d);
    }
    return d || { id: id, mois: mois, corrections: {}, manuelles: [], etudiants: '' };
  }
  function nvSauver() {
    try { if (typeof window.saveAll === 'function') window.saveAll(); } catch (e) { }
  }
  function nvToast(t) { try { if (typeof window.plToast === 'function') window.plToast(t); } catch (e) { } }

  let nvMoisVu = null;

  function nvMoisDuJour() {
    const d = new Date();
    // La navette du mois se prepare le 20 : avant cette date, c'est encore
    // celle du mois en cours qu'on regarde, et elle n'est pas finie.
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  window.nvAller = function (n) {
    nvMoisVu = window.nvMoisDecale(nvMoisVu || nvMoisDuJour(), n);
    nvRender();
  };

  // ── Les corrections ──────────────────────────────────────────────────────
  // ON NE REMPLACE JAMAIS UN CALCUL : on pose la correction a cote, et l'ecran
  // montre les deux. Effacer le champ rend la main au calcul.
  window.nvCorriger = function (cid, champ, valeur) {
    const d = nvDossier(nvMoisVu, true);
    d.corrections[cid] = d.corrections[cid] || {};
    const v = String(valeur == null ? '' : valeur).trim();
    if (v === '') delete d.corrections[cid][champ];
    else d.corrections[cid][champ] = (champ === 'cpDu' || champ === 'cpAu' || champ === 'mal'
      || champ === 'autorisees' || champ === 'nonJustifiees' || champ === 'autres') ? v : nvNum(v);
    if (!Object.keys(d.corrections[cid]).length) delete d.corrections[cid];
    d.updatedAt = Date.now();
    nvSauver(); nvRender();
  };
  window.nvEtudiants = function (v) {
    const d = nvDossier(nvMoisVu, true);
    d.etudiants = String(v || ''); d.updatedAt = Date.now(); nvSauver();
  };
  window.nvManuelle = function (i, champ, v) {
    const d = nvDossier(nvMoisVu, true);
    d.manuelles = Array.isArray(d.manuelles) ? d.manuelles : [];
    if (!d.manuelles[i]) d.manuelles[i] = { rubrique: 'primes', qui: '', texte: '' };
    d.manuelles[i][champ] = String(v || '');
    d.updatedAt = Date.now(); nvSauver();
  };
  window.nvManuelleAjout = function () {
    const d = nvDossier(nvMoisVu, true);
    d.manuelles = Array.isArray(d.manuelles) ? d.manuelles : [];
    d.manuelles.push({ rubrique: 'primes', qui: '', texte: '' });
    d.updatedAt = Date.now(); nvSauver(); nvRender();
  };
  window.nvManuelleRetirer = function (i) {
    const d = nvDossier(nvMoisVu, true);
    if (Array.isArray(d.manuelles)) d.manuelles.splice(i, 1);
    d.updatedAt = Date.now(); nvSauver(); nvRender();
  };

  // ── La ligne telle qu'elle partira, corrections comprises ───────────────
  const NV_CHAMPS = ['contract', 't125', 't150', 'c10', 'cPlus'];
  function nvFinale(l, corr) {
    const o = Object.assign({}, l, { corrige: {} });
    if (!corr) return o;
    NV_CHAMPS.forEach(function (k) {
      if (corr[k] == null) return;
      o.corrige[k] = l[k]; o[k] = nvNum(corr[k]);
    });
    if (corr.cpDu != null) { o.corrige.cpDu = l.cp.du; o.cp = { du: corr.cpDu, au: o.cp.au }; }
    if (corr.cpAu != null) { o.corrige.cpAu = l.cp.au; o.cp = { du: o.cp.du, au: corr.cpAu }; }
    ['mal', 'autorisees', 'nonJustifiees', 'autres'].forEach(function (k) {
      if (corr[k] != null) { o.corrige[k] = o[k]; o[k + 'Txt'] = corr[k]; }
    });
    return o;
  }

  // ── Le rendu ─────────────────────────────────────────────────────────────
  function nvChamp(cid, champ, valeur, calcule, large) {
    const corrige = calcule != null;
    return '<input class="f' + (large ? ' w' : '') + (corrige ? ' corr' : '') + '"'
      + ' value="' + E(large ? (valeur || '') : nvAff(valeur)) + '"'
      + ' onchange="nvCorriger(\'' + E(cid) + '\',\'' + champ + '\',this.value)">'
      + (corrige ? '<span class="calc c">calculé ' + E(large ? (calcule || '—') : (nvAff(calcule) || '0')) + '</span>' : '');
  }

  window.nvRender = function () {
    const el = document.getElementById('nv-host'); if (!el) return;
    if (!document.getElementById('nv-css')) {
      const st = document.createElement('style'); st.id = 'nv-css'; st.textContent = NV_CSS;
      document.head.appendChild(st);
    }
    if (!nvMoisVu) nvMoisVu = nvMoisDuJour();
    const mois = nvMoisVu;
    const dec = window.nvDecompte(mois);
    const dos = nvDossier(mois, false);
    const f = dec.fenetre;

    let h = '<div class="bar"><div>'
      + '<h1>Navette des salaires — <em>' + E(nvMoisLbl(mois)) + '</em></h1>'
      + '<div class="sous">Heures du <b>' + nvJoli(f.debut) + '</b> au <b>' + nvJoli(f.fin)
      + '</b> · congés et absences du mois civil · ' + dec.lignes.length + ' salariés au décompte</div>'
      + '</div><span class="grow"></span>'
      + '<div class="mois"><button onclick="nvAller(-1)" title="Mois précédent">‹</button> '
      + E(nvMoisLbl(mois)) + ' <button onclick="nvAller(1)" title="Mois suivant">›</button></div>'
      + (dos.genereLe ? '<span class="sous" style="text-align:right">Généré le '
          + nvJoli(dos.genereLe) + (dos.generePar ? '<br>par ' + E(dos.generePar) : '') + '</span>' : '')
      + '<button class="btn pri" onclick="nvGenerer()">Générer le fichier ▸</button></div>';

    // ── Ce qu'il faut regarder avant d'envoyer ──
    const soucis = [];
    if (dec.attente.length) {
      soucis.push('<b>' + dec.attente.length + ' déclaration' + (dec.attente.length > 1 ? 's' : '')
        + ' d’heures attend' + (dec.attente.length > 1 ? 'ent' : '') + ' une décision</b> — '
        + dec.attente.slice(0, 4).map(function (a) {
            return E(a.nom) + ' ' + a.heures + ' h' + (a.date ? ' (' + nvJoli(a.date) + ')' : ''); }).join(', ')
        + '. Elles ne sont pas comptées ci-dessous.');
    }
    dec.lignes.forEach(function (l) {
      if (!l.base) soucis.push('<b>' + E(l.nom) + ' n’a pas d’horaire contractuel</b> — '
        + 'aucune heure ne peut être décomptée tant que sa fiche contrat est vide.');
      (l.anomalies || []).forEach(function (a) {
        if (a.quoi === 'depassement') soucis.push('<b>' + E(l.nom) + ' dépasse 35 h</b> la semaine du '
          + nvJoli(a.lundi) + ' (' + a.heures + ' h) alors que son contrat est à temps partiel — '
          + 'ses heures sont comptées, mais la situation est à regarder.');
        if (a.quoi === 'trame_haute') soucis.push('<b>' + E(l.nom) + '</b> : la trame de la semaine du '
          + nvJoli(a.lundi) + ' dépasse 43 h.');
      });
      if (l.base && l.nbSemaines) {
        // ON COMPARE LA TRAME THEORIQUE, pas celle amputee des absences : sinon
        // une semaine de conges suffirait a crier au contrat non tenu.
        const moy = l.theorique / l.nbSemaines;
        if (Math.abs(moy - l.base) > 0.26) soucis.push('<b>' + E(l.nom)
          + ' : sa trame prévoit ' + nvAff(Math.round(moy * 100) / 100) + ' h par semaine '
          + 'pour un contrat de ' + l.base + ' h</b> — l’écart se répète chaque semaine et '
          + 'n’apparaît nulle part : ni en heures supplémentaires, puisque la trame est '
          + 'respectée, ni au compte-temps. À corriger dans la trame ou dans le contrat.');
      }
      if (l.cpPeriodes.length > 1) soucis.push('<b>' + E(l.nom) + ' a ' + l.cpPeriodes.length
        + ' périodes de congés ce mois</b> — elles tiennent sur les lignes « du / au », séparées par « et ». Relisez-les.');
    });
    h += soucis.length
      ? '<div class="ctrl"><b>' + soucis.length + ' point' + (soucis.length > 1 ? 's' : '')
        + ' à regarder avant de générer</b><ul><li>' + soucis.join('</li><li>') + '</li></ul></div>'
      : '<div class="ok">Rien à signaler : aucune déclaration en attente, aucun contrat sans horaire, aucune anomalie de semaine.</div>';

    // ── Le tableau ──
    const plein = dec.lignes.filter(function (l) { return l.plein; });
    const partiel = dec.lignes.filter(function (l) { return !l.plein; });
    h += '<div class="carte"><div class="scroll"><table>'
      + '<thead><tr class="band"><th></th><th class="b-tt" colspan="3">Temps de travail</th>'
      + '<th class="b-hs" colspan="2">Heures à payer en plus</th>'
      + '<th class="b-abs" colspan="4">Absences</th></tr>'
      + '<tr><th class="h g">Salarié</th>'
      + '<th class="h">Base<br>hebdo</th><th class="h">Heures<br>contractuelles</th>'
      + '<th class="h">Faites / prévues<br><span style="font-weight:500;text-transform:none">sur la fenêtre</span></th>'
      + '<th class="h" id="nv-h1">125 %<br><span style="font-weight:500;text-transform:none">ou ≤ 10 %</span></th>'
      + '<th class="h">150 %<br><span style="font-weight:500;text-transform:none">ou > 10 %</span></th>'
      + '<th class="h">Congés — du</th><th class="h">au</th>'
      + '<th class="h">Maladie</th><th class="h">Autres</th></tr></thead><tbody>';

    const tot = { contract: 0, faites: 0, prevues: 0, t125: 0, t150: 0, c10: 0, cPlus: 0 };
    function bloc(titre, liste, estPlein) {
      if (!liste.length) return '';
      let x = '<tr class="grp"><td colspan="10">' + titre + '</td></tr>';
      liste.forEach(function (l0) {
        const c = (dos.corrections || {})[l0.id] || null;
        const l = nvFinale(l0, c);
        tot.contract += l.contract; tot.faites += l.faites; tot.prevues += l.prevues;
        tot.t125 += l.t125; tot.t150 += l.t150; tot.c10 += l.c10; tot.cPlus += l.cPlus;
        const a = estPlein ? 't125' : 'c10', b = estPlein ? 't150' : 'cPlus';
        x += '<tr><td class="g qui"><b>' + E(l.nom) + '</b><span>' + E(l.role || '') + '</span></td>'
          + '<td><span class="ro">' + (l.base || '—') + '</span></td>'
          + '<td>' + nvChamp(l.id, 'contract', l.contract, l.corrige.contract) + '</td>'
          + '<td><span class="ro">' + (nvAff(l.faites) || '0') + ' / ' + (nvAff(l.prevues) || '0')
          + '</span><span class="calc">' + l.nbSemaines + ' semaines</span></td>'
          + '<td>' + nvChamp(l.id, a, l[a], l.corrige[a]) + '</td>'
          + '<td>' + nvChamp(l.id, b, l[b], l.corrige[b]) + '</td>'
          + '<td>' + nvChamp(l.id, 'cpDu', l.cp.du, l.corrige.cpDu, true) + '</td>'
          + '<td>' + nvChamp(l.id, 'cpAu', l.cp.au, l.corrige.cpAu, true) + '</td>'
          + '<td>' + nvChamp(l.id, 'mal', l.malTxt != null ? l.malTxt
              : (l.mal.du ? l.mal.du + ' au ' + l.mal.au : ''), l.corrige.mal, true) + '</td>'
          + '<td>' + nvChamp(l.id, 'autres', l.autresTxt != null ? l.autresTxt
              : (l.mat.du ? 'maternité ' + l.mat.du + ' au ' + l.mat.au : ''), l.corrige.autres, true) + '</td>'
          + '</tr>';
      });
      return x;
    }
    h += bloc('Temps complet — heures supplémentaires à 125 % puis 150 %', plein, true);
    h += bloc('Temps partiel — heures complémentaires jusqu’à 10 % puis au-delà', partiel, false);
    h += '</tbody><tfoot><tr><td class="g">Totaux</td><td></td>'
      + '<td>' + nvAff(Math.round(tot.contract * 100) / 100) + '</td>'
      + '<td>' + nvAff(Math.round(tot.faites * 100) / 100) + ' / '
      + nvAff(Math.round(tot.prevues * 100) / 100) + '</td>'
      + '<td>' + nvAff(Math.round((tot.t125 + tot.c10) * 100) / 100) + '</td>'
      + '<td>' + nvAff(Math.round((tot.t150 + tot.cPlus) * 100) / 100) + '</td>'
      + '<td colspan="4"></td></tr></tfoot></table></div>'
      + '<div class="legende">'
      + '<span><i style="background:#fff"></i>Calculé depuis le planning — modifiable</span>'
      + '<span><i style="background:#FFF6E0;border-color:#E8CF95"></i>Corrigé à la main — le calcul reste affiché dessous</span>'
      + '<span><i style="background:#F4F6F5"></i>Lecture seule — se corrige dans le planning</span>'
      + '<span>Vider un champ corrigé rend la main au calcul.</span></div></div>';

    // ── Les lignes que PILOT ne connaît pas ──
    const RUB = { primes: 'Primes', frais: 'Remboursement de frais', acompte: 'Acompte', epargne: 'Épargne salariale' };
    const man = Array.isArray(dos.manuelles) ? dos.manuelles : [];
    h += '<div class="carte"><h2>Lignes que PILOT ne connaît pas</h2>'
      + '<div class="sous" style="margin-bottom:10px">Primes, frais, acomptes, épargne : saisis ici, reportés tels quels '
      + 'dans le fichier. <b>Rien n’est repris du mois précédent</b> — une prime oubliée vaut mieux qu’une prime payée deux fois.</div>'
      + '<table class="man"><thead><tr><th style="width:230px">Rubrique</th><th style="width:230px">Salarié</th>'
      + '<th>Montant / précision</th><th style="width:34px"></th></tr></thead><tbody>';
    man.forEach(function (m, i) {
      h += '<tr><td><select onchange="nvManuelle(' + i + ',\'rubrique\',this.value)">'
        + Object.keys(RUB).map(function (k) {
            return '<option value="' + k + '"' + (m.rubrique === k ? ' selected' : '') + '>' + RUB[k] + '</option>'; }).join('')
        + '</select></td>'
        + '<td><select onchange="nvManuelle(' + i + ',\'qui\',this.value)"><option value="">— choisir —</option>'
        + dec.lignes.map(function (l) {
            return '<option value="' + E(l.nom) + '"' + (m.qui === l.nom ? ' selected' : '') + '>' + E(l.nom) + '</option>'; }).join('')
        + '</select></td>'
        + '<td><input value="' + E(m.texte || '') + '" placeholder="Ex. 286 euros — prime d’objectifs" '
        + 'onchange="nvManuelle(' + i + ',\'texte\',this.value)"></td>'
        + '<td><button class="x" title="Retirer" onclick="nvManuelleRetirer(' + i + ')">✕</button></td></tr>';
    });
    if (!man.length) h += '<tr><td colspan="4" style="color:var(--mut);padding:10px 8px">Aucune ligne ce mois-ci.</td></tr>';
    h += '</tbody></table><button class="plus" onclick="nvManuelleAjout()">＋ Ajouter une ligne</button>'
      + '<div style="margin-top:14px"><h2>Étudiants et renforts</h2>'
      + '<div class="sous" style="margin-bottom:7px">Ils ne prennent pas de colonne : le cabinet les attend '
      + 'sur une seule ligne, en bas du classeur. PILOT compte leurs heures et propose le texte — '
      + 'corrigez-le si besoin.</div>'
      + (dec.renforts.length
          ? '<div class="sous" style="margin-bottom:7px">Calculé sur la fenêtre : '
            + dec.renforts.map(function (r) { return '<b>' + E(r.nom) + '</b> ' + nvAff(r.faites) + ' h'; }).join(' · ')
            + (dos.etudiants ? '' : ' — repris ci-dessous.')
            + '</div>'
          : '')
      + '<input id="nv-etudiants" class="f w" style="width:100%;max-width:520px;text-align:left" value="'
      + E(dos.etudiants || nvEtudiantsAuto(dec))
      + '" placeholder="Ex. Lise Tison : 45 heures" onchange="nvEtudiants(this.value)"></div></div>';

    h += '<div class="pied"><b>Les heures contractuelles sont une mensualisation</b> (base × 52 ÷ 12) : '
      + 'c’est le chiffre que le cabinet attend, et il ne se compare pas aux heures faites, '
      + 'qui portent sur quatre ou cinq semaines selon le calendrier. La colonne « faites / prévues » '
      + 'compare, elle, ce qui se compare : le réalisé et la trame sur les mêmes semaines.<br>'
      + 'Le fichier produit reprend la mise en page exacte du cabinet — salariés en colonnes, '
      + 'rubriques en lignes. Les heures supplémentaires sont réparties <b>semaine par semaine</b> : une semaine '
      + 'travaillée comme la trame le prévoyait ne produit rien, même à 36 h, parce que le cycle retombe sur la base '
      + 'du contrat.</div>';

    el.className = 'nv';
    el.innerHTML = h;
  };

  // Le texte que PILOT propose pour la ligne « Etudiants », a partir des heures
  // qu'il a comptees. Il reste un texte : le cabinet y lit parfois autre chose
  // qu'un nombre d'heures, et on ne lui impose pas une forme.
  function nvEtudiantsAuto(dec) {
    return (dec.renforts || []).filter(function (r) { return r.faites; })
      .map(function (r) { return r.nom + ' : ' + nvAff(r.faites) + ' heures'; }).join(' · ');
  }
  window.nvEtudiantsAuto = nvEtudiantsAuto;

  // ── La génération ────────────────────────────────────────────────────────
  // ON ENVOIE CE QUI EST A L'ECRAN, corrections comprises : le fichier ne peut
  // pas differer de ce qui vient d'etre relu.
  window.nvGenerer = async function () {
    if (typeof window.plGarde === 'function' && !window.plGarde()) return;
    const mois = nvMoisVu || nvMoisDuJour();
    const dec = window.nvDecompte(mois);
    const dos = nvDossier(mois, true);
    const RUBL = { primes: 'primes', frais: 'frais', acompte: 'acompte', epargne: 'epargne' };

    const colonnes = dec.lignes.map(function (l0) {
      const l = nvFinale(l0, (dos.corrections || {})[l0.id] || null);
      const c = { nom: (l.nom || '').toUpperCase(), contract: l.contract };
      if (l.plein) { c.t125 = l.t125; c.t150 = l.t150; }
      else { c.c10 = l.c10; c.cPlus = l.cPlus; }
      c.cpDu = l.cp.du; c.cpAu = l.cp.au;
      c.mal = l.malTxt != null ? l.malTxt : (l.mal.du ? l.mal.du + ' au ' + l.mal.au : '');
      c.autres = l.autresTxt != null ? l.autresTxt
        : (l.mat.du ? 'maternité ' + l.mat.du + ' au ' + l.mat.au : '');
      c.autorisees = l.autoriseesTxt || '';
      c.nonJustifiees = l.nonJustifieesTxt || '';
      return c;
    });
    // Les lignes manuelles rejoignent la colonne de leur salarié.
    (dos.manuelles || []).forEach(function (m) {
      if (!m || !m.qui || !m.texte) return;
      const c = colonnes.find(function (x) { return x.nom === String(m.qui).toUpperCase(); });
      if (!c) return;
      const k = RUBL[m.rubrique] || 'primes';
      c[k] = c[k] ? (c[k] + ' ; ' + m.texte) : m.texte;
    });

    try {
      const r = await fetch('/api/navette', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mois: mois, colonnes: colonnes,
                             etudiants: dos.etudiants || nvEtudiantsAuto(dec) })
      });
      if (!r.ok) {
        const j = await r.json().catch(function () { return null; });
        return alert('Le fichier n’a pas pu être produit.\n\n' + ((j && j.error) || ('Erreur ' + r.status)));
      }
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = mois + ' NAVETTE SALAIRES-PHARMACIE FERRAN.xlsx';
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
      dos.genereLe = new Date().toISOString().slice(0, 10);
      dos.generePar = (window.currentUser && (window.currentUser.prenom + ' ' + window.currentUser.nom)) || '';
      dos.updatedAt = Date.now();
      nvSauver(); nvRender();
      nvToast('Navette de ' + nvMoisLbl(mois) + ' générée');
    } catch (e) {
      alert('Le fichier n’a pas pu être produit : ' + (e.message || e));
    }
  };
})();
