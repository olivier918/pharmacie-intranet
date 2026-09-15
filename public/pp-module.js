/* ═══════════════════════════════════════════════════════════════════════════
   PILOT — Planning des préparations
   ---------------------------------------------------------------------------
   Remplace le tableur Google « Préparations », dupliqué et réinitialisé à la
   main chaque semaine. Cadrage : projet Claude, « Module Préparations —
   planning des créneaux ».

   TROIS PARTIS PRIS, ET ILS EXPLIQUENT TOUT LE FICHIER
   -----------------------------------------------------
   1. NE PAS DÉPAYSER. L'écran reprend la disposition du tableur : jours
      empilés de haut en bas, bandeau de jour plein, lignes numérotées 1-2-3,
      mêmes colonnes dans le même ordre, journée fermée en gris avec son motif.
      L'équipe s'en sert depuis des mois ; ce qui change doit être ce qu'on lui
      demande de faire, pas ce qu'elle regarde.

   2. UNE TRAME, PAS UNE SAISIE HEBDOMADAIRE. La semaine type est décrite une
      fois ; on ne saisit plus que les écarts (`prepExceptions`). Le mardi
      grisé du tableur devient une ligne d'exception. Plus rien à réinitialiser.

   3. LE REPORT NE RÉÉCRIT PAS LA DATE PRÉVUE. Une préparation encore en cours
      dont le jour est passé s'AFFICHE sur le premier jour ouvert suivant et y
      occupe une place — mais `p.jour` garde ce qui avait été promis au
      patient. Sans cela, chaque matin remettrait le compteur de retard à zéro
      et un dossier glisserait trois semaines sans jamais paraître en retard.
      Un report est un calcul d'affichage, jamais une écriture nocturne.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const G = (typeof window !== 'undefined') ? window : globalThis;
  const E = s => String(s == null ? '' : s).replace(/[&<>"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // Dimanche = 0, comme Date.getDay(). L'identifiant sert de cle de fusion :
  // sept lignes fixes, jamais supprimees, donc pas de pierre tombale a gerer.
  const PP_CLEFS = ['j0', 'j1', 'j2', 'j3', 'j4', 'j5', 'j6'];
  const PP_NOMS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const PP_HORIZON = 5;                 // jours ouvres affiches au comptoir
  // Seules les preparations faites ICI consomment une place. Kerangal a son
  // propre delai, suivi par le fil de la demande : il n'occupe personne.
  const PP_TYPE = 'realisation-pharmacie';

  // ── Dates ─────────────────────────────────────────────────────────────────
  // Tout se joue en chaines 'AAAA-MM-JJ' : comparables entre elles, insensibles
  // au fuseau, et deja le format de `p.date`. Les objets Date ne servent qu'a
  // avancer d'un jour — a midi, pour ne pas trebucher sur les changements
  // d'heure de mars et d'octobre.
  function ppISO(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
      + '-' + String(d.getDate()).padStart(2, '0');
  }
  function ppDate(iso) { const p = String(iso || '').split('-'); return new Date(+p[0], +p[1] - 1, +p[2], 12, 0, 0); }
  function ppAujourdhui() { return ppISO(new Date()); }
  function ppClef(iso) { return PP_CLEFS[ppDate(iso).getDay()]; }
  function ppNomJour(iso) { return PP_NOMS[ppDate(iso).getDay()]; }
  function ppJJMM(iso) { const p = String(iso || '').split('-'); return p[2] + '/' + p[1]; }
  function ppPlusJours(iso, n) { const d = ppDate(iso); d.setDate(d.getDate() + n); return ppISO(d); }

  // ── Capacité ──────────────────────────────────────────────────────────────
  function ppLigneTrame(iso, trame) {
    const c = ppClef(iso);
    return (trame || []).find(x => x && x.id === c) || null;
  }
  function ppException(iso, exceptions) {
    return (exceptions || []).find(e => e && e.date === iso) || null;
  }
  // Ce que la trame prevoit, sans tenir compte des ecarts : dit si le jour est
  // un jour de production EN PRINCIPE. C'est ce qui decide de l'AFFICHER —
  // un mardi ferme se montre en gris, un dimanche ne se montre pas du tout.
  function ppTravaille(iso, trame) {
    const t = ppLigneTrame(iso, trame);
    return !!(t && (+t.places || 0) > 0);
  }
  function ppPlaces(iso, trame, exceptions) {
    const e = ppException(iso, exceptions);
    if (e && e.places !== null && e.places !== undefined && e.places !== '') return Math.max(0, +e.places || 0);
    const t = ppLigneTrame(iso, trame);
    return t ? Math.max(0, +t.places || 0) : 0;
  }
  function ppResp(iso, trame, exceptions) {
    const e = ppException(iso, exceptions);
    if (e && e.resp) return e.resp;
    const t = ppLigneTrame(iso, trame);
    return (t && t.resp) || null;
  }
  function ppMotif(iso, trame, exceptions) {
    const e = ppException(iso, exceptions);
    return (e && e.motif) ? e.motif : null;
  }

  // Les jours a afficher : les prochains jours OUVRABLES selon la trame, a
  // partir d'aujourd'hui. Un jour ferme par exception y figure quand meme —
  // c'est le mardi gris du tableur, et le comptoir doit le voir pour savoir
  // quoi repondre au patient.
  function ppJours(depuis, trame, combien) {
    const n = combien || PP_HORIZON, out = [];
    let iso = depuis;
    for (let i = 0; i < 90 && out.length < n; i++) {
      if (ppTravaille(iso, trame)) out.push(iso);
      iso = ppPlusJours(iso, 1);
    }
    return out;
  }
  function ppPremierOuvert(depuis, trame, exceptions) {
    let iso = depuis;
    for (let i = 0; i < 90; i++) {
      if (ppPlaces(iso, trame, exceptions) > 0) return iso;
      iso = ppPlusJours(iso, 1);
    }
    return depuis;
  }

  // ── Report ────────────────────────────────────────────────────────────────
  // « Encore a faire » = la production n'a pas eu lieu. Des que la preparation
  // passe a « prete », le travail est fait : elle reste sur sa journee et ne
  // compte plus comme un retard, meme si elle n'est pas encore delivree.
  function ppAFaire(p) {
    return !!(p && p.type === PP_TYPE && (p.status === 'en cours' || p.status === 'attente devis'));
  }
  function ppJourEffectif(p, auj, trame, exceptions) {
    if (!p || !p.jour) return null;
    if (!ppAFaire(p)) return p.jour;        // faite, delivree, abandonnee : sur sa date
    if (p.jour >= auj) return p.jour;       // pas encore passee
    return ppPremierOuvert(auj, trame, exceptions);
  }
  function ppEnRetard(p, auj) { return !!(ppAFaire(p) && p.jour && p.jour < auj); }
  function ppJoursRetard(p, auj) {
    if (!ppEnRetard(p, auj)) return 0;
    return Math.round((ppDate(auj) - ppDate(p.jour)) / 86400000);
  }
  function ppRetards(preps, auj) {
    return (preps || []).filter(p => ppEnRetard(p, auj));
  }

  // ── Occupation d'une journée ──────────────────────────────────────────────
  // Les reportees en tete : ce sont elles qui doivent partir en premier, et
  // les voir en haut de la journee evite qu'on les oublie sous les nouvelles.
  function ppDuJour(iso, preps, auj, trame, exceptions) {
    return (preps || [])
      .filter(p => p && p.type === PP_TYPE && p.status !== 'abandonnée'
        && ppJourEffectif(p, auj, trame, exceptions) === iso)
      .sort(function (a, b) {
        const ra = ppEnRetard(a, auj) ? 0 : 1, rb = ppEnRetard(b, auj) ? 0 : 1;
        if (ra !== rb) return ra - rb;
        if (ra === 0) return String(a.jour).localeCompare(String(b.jour));
        return (a.id || 0) - (b.id || 0);
      });
  }
  function ppLibres(iso, preps, auj, trame, exceptions) {
    return Math.max(0, ppPlaces(iso, trame, exceptions) - ppDuJour(iso, preps, auj, trame, exceptions).length);
  }

  G.ppISO = ppISO; G.ppAujourdhui = ppAujourdhui; G.ppClef = ppClef;
  G.ppNomJour = ppNomJour; G.ppJJMM = ppJJMM; G.ppPlusJours = ppPlusJours;
  G.ppTravaille = ppTravaille; G.ppPlaces = ppPlaces; G.ppResp = ppResp;
  G.ppMotif = ppMotif; G.ppJours = ppJours; G.ppPremierOuvert = ppPremierOuvert;
  G.ppAFaire = ppAFaire; G.ppJourEffectif = ppJourEffectif; G.ppEnRetard = ppEnRetard;
  G.ppJoursRetard = ppJoursRetard; G.ppRetards = ppRetards;
  G.ppDuJour = ppDuJour; G.ppLibres = ppLibres;
  G.PP_CLEFS = PP_CLEFS; G.PP_NOMS = PP_NOMS; G.PP_HORIZON = PP_HORIZON; G.PP_TYPE = PP_TYPE;
})();

/* ═══════════════════════════════════════════════════════════════════════════
   AFFICHAGE — le tableau du comptoir, et la carte du Back Office
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const E = s => String(s == null ? '' : s).replace(/[&<>"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const T = () => (typeof prepTrame !== 'undefined' && Array.isArray(prepTrame)) ? prepTrame : [];
  const X = () => (typeof prepExceptions !== 'undefined' && Array.isArray(prepExceptions)) ? prepExceptions : [];
  const P = () => (typeof preps !== 'undefined' && Array.isArray(preps)) ? preps : [];
  const nom = id => (typeof staffName === 'function' && id) ? staffName(id) : (id || '');

  const STYLE = `
  .pp-t{width:100%;border-collapse:collapse;font-size:.82rem;table-layout:fixed}
  .pp-t th{background:var(--gray-100);color:var(--gray-600);font-size:.7rem;text-transform:uppercase;
           letter-spacing:.5px;font-weight:700;padding:7px 9px;text-align:left;border-bottom:1px solid var(--gray-200)}
  .pp-t td{padding:8px 9px;border-bottom:1px solid var(--gray-200);vertical-align:middle;
           overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .pp-t .c1{width:42px;text-align:center;color:var(--gray-500);font-weight:700}
  .pp-t .c2{width:56px;text-align:center}
  .pp-t .c5{width:80px;text-align:center}
  .pp-t .c6{width:120px;text-align:center;font-weight:700;color:var(--gray-700);background:#fff}
  /* Le bandeau de jour du tableur, dans sa teinte : c'est le repere visuel qui
     permet a l'equipe de retrouver son tableau du premier coup d'oeil. */
  .pp-j td{background:#4E7D8C;color:#fff;font-weight:700;font-size:.86rem;padding:8px 11px;border-bottom:none}
  .pp-j .pp-auj{background:#fff;color:#2E7D32;border-radius:999px;padding:1px 9px;font-size:.68rem;margin-left:8px}
  .pp-j .pp-n{float:right;font-weight:600;font-size:.78rem;opacity:.95}
  .pp-j .pp-plus{float:right;margin-left:10px;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.45);
                 color:#fff;border-radius:999px;padding:1px 10px;font-size:.72rem;font-weight:700;cursor:pointer;font-family:inherit}
  .pp-j .pp-plus:hover{background:rgba(255,255,255,.3)}
  .pp-ferme td{background:#6E6E6E;color:#fff;font-weight:700;font-size:.86rem;padding:8px 11px;border-bottom:none}
  .pp-barre td{background:repeating-linear-gradient(45deg,#DEDEDE,#DEDEDE 9px,#CFCFCF 9px,#CFCFCF 18px);height:26px}
  .pp-libre td{color:var(--gray-400);font-style:italic}
  .pp-add{border:1px dashed var(--gray-300);background:#fff;border-radius:8px;padding:3px 12px;font-size:.78rem;
          font-weight:700;color:var(--gray-600);cursor:pointer;font-family:inherit}
  .pp-add:hover{border-color:var(--g-border);background:var(--g-pale);color:var(--g-dark)}
  .pp-ret{background:#FFF3E0}
  .pp-ret .c1{color:#B45309}
  .pp-etiq{display:inline-block;background:#FFE0B2;color:#8a4b00;border-radius:999px;padding:0 8px;
           font-size:.68rem;font-weight:700;margin-left:6px}
  .pp-vide{text-align:center;color:var(--gray-500);padding:1.4rem;font-size:.86rem}
  .pp-retenu{background:#E8F5E9;border:1px solid #A5D6A7;border-radius:9px;padding:7px 12px;
             font-size:.82rem;color:#1D5C3A;font-weight:600}
  `;
  function ppStyle() {
    if (document.getElementById('pp-style')) return;
    const s = document.createElement('style'); s.id = 'pp-style'; s.textContent = STYLE;
    document.head.appendChild(s);
  }

  // Les gestionnaires ne recoivent qu'un INDICE : la regle du depot, et ici
  // elle evite qu'une date ou un motif saisi se retrouve dans un attribut.
  let ppAffiches = [];
  window.ppJourRetenu = null;

  window.ppRendPlanning = function () {
    const el = document.getElementById('pp-planning'); if (!el) return;
    ppStyle();
    const trame = T(), exc = X(), lp = P(), auj = window.ppAujourdhui();
    if (!trame.some(t => t && (+t.places || 0) > 0)) {
      ppAffiches = [];
      el.innerHTML = '<div class="pp-vide">Aucune capacité de production définie.'
        + '<br>Back Office → <b>Préparations — capacité</b>.</div>';
      return;
    }
    const jours = window.ppJours(auj, trame, window.PP_HORIZON);
    ppAffiches = jours;
    let h = '<table class="pp-t"><thead><tr>'
      + '<th class="c1"></th><th class="c2">OP</th><th>Patient</th><th>Prép</th>'
      + '<th class="c5">Fait par</th><th class="c6">Responsable</th></tr></thead><tbody>';

    jours.forEach(function (iso, idx) {
      const places = window.ppPlaces(iso, trame, exc);
      const duJour = window.ppDuJour(iso, lp, auj, trame, exc);
      const libres = Math.max(0, places - duJour.length);
      const resp = window.ppResp(iso, trame, exc);
      const motif = window.ppMotif(iso, trame, exc);
      const titre = window.ppNomJour(iso) + ' ' + window.ppJJMM(iso);

      // Journee fermee : le gris du tableur, et le motif en clair. Le comptoir
      // doit pouvoir repondre au patient sans aller demander a personne.
      if (places === 0 && !duJour.length) {
        h += '<tr class="pp-ferme"><td colspan="6">' + E(titre)
          + (iso === auj ? '<span class="pp-auj">aujourd’hui</span>' : '')
          + '<span class="pp-n">FERMÉ' + (motif ? ' — ' + E(motif) : '') + '</span></td></tr>'
          + '<tr class="pp-barre"><td colspan="6"></td></tr>';
        return;
      }

      h += '<tr class="pp-j"><td colspan="6">' + E(titre)
        + (iso === auj ? '<span class="pp-auj">aujourd’hui</span>' : '')
        + (typeof isAdmin === 'function' && isAdmin()
            ? '<button class="pp-plus" onclick="ppPlusUnePlace(' + idx + ')" title="Ouvrir une place de plus ce jour-là">+ 1 place</button>' : '')
        + '<span class="pp-n">' + (libres ? libres + ' place' + (libres > 1 ? 's' : '') : 'complet') + '</span>'
        + '</td></tr>';

      const lignes = Math.max(places, duJour.length, 1);
      for (let i = 0; i < lignes; i++) {
        const p = duJour[i] || null;
        const retard = p ? window.ppEnRetard(p, auj) : false;
        const jr = retard ? window.ppJoursRetard(p, auj) : 0;
        h += '<tr' + (retard ? ' class="pp-ret"' : (p ? '' : ' class="pp-libre"')) + '>'
          + '<td class="c1">' + (retard ? '⚠' : (i + 1)) + '</td>'
          + '<td class="c2">' + (p ? E(p.by || '') : '') + '</td>'
          + '<td>' + (p
              ? E((p.nom || '') + ' ' + (p.prenom || ''))
                + (retard ? '<span class="pp-etiq">prévue le ' + E(window.ppJJMM(p.jour))
                    + ' · ' + jr + ' j de retard</span>' : '')
              : (libres
                  ? '<button class="pp-add" onclick="ppChoisirJour(' + idx + ')">+ ajouter</button>'
                  : '')) + '</td>'
          + '<td>' + (p ? E(p.prep || '') : '') + '</td>'
          + '<td class="c5">' + (p && p.faitPar ? E(nom(p.faitPar)) : '') + '</td>'
          + (i === 0 ? '<td class="c6" rowspan="' + lignes + '">' + E(resp ? nom(resp) : '—') + '</td>' : '')
          + '</tr>';
      }
    });
    el.innerHTML = h + '</tbody></table>';
  };

  // Retenir un jour, puis descendre au formulaire : le geste du tableur, ou
  // l'on cliquait dans la cellule du jour voulu avant de taper.
  window.ppChoisirJour = function (i) {
    const iso = ppAffiches[i]; if (!iso) return;
    window.ppJourRetenu = iso;
    const t = document.getElementById('p-type');
    if (t) t.value = window.PP_TYPE;
    window.ppRendChampJour();
    const n = document.getElementById('p-nom');
    if (n) { n.scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(function () { n.focus(); }, 350); }
  };

  // Le jour retenu, affiche dans le formulaire. Sans selection explicite, c'est
  // la premiere place libre — au cas nominal il n'y a donc rien a decider.
  window.ppJourPourNouvelle = function () {
    const trame = T(), exc = X(), auj = window.ppAujourdhui();
    if (!trame.some(t => t && (+t.places || 0) > 0)) return null;
    if (window.ppJourRetenu && window.ppLibres(window.ppJourRetenu, P(), auj, trame, exc) > 0) return window.ppJourRetenu;
    const jours = window.ppJours(auj, trame, 60);
    for (const iso of jours) if (window.ppLibres(iso, P(), auj, trame, exc) > 0) return iso;
    return null;
  };

  window.ppRendChampJour = function () {
    const z = document.getElementById('pp-jour-champ'); if (!z) return;
    const t = document.getElementById('p-type');
    if (!t || t.value !== window.PP_TYPE) { z.innerHTML = ''; z.style.display = 'none'; return; }
    z.style.display = '';
    const iso = window.ppJourPourNouvelle();
    z.innerHTML = '<label>Jour de production</label>'
      + (iso
          ? '<div class="pp-retenu">' + E(window.ppNomJour(iso) + ' ' + window.ppJJMM(iso))
            + (iso === window.ppJourRetenu ? '' : ' · première place libre') + '</div>'
          : '<div class="pp-retenu" style="background:#FFEBEE;border-color:#EF9A9A;color:#B71C1C">'
            + 'Aucune place libre. Ouvrez une place sur une journée ci-dessus.</div>');
  };
})();

/* ═══════════════════════════════════════════════════════════════════════════
   BACK OFFICE — la trame, et les écarts
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const E = s => String(s == null ? '' : s).replace(/[&<>"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const T = () => (typeof prepTrame !== 'undefined' && Array.isArray(prepTrame)) ? prepTrame : [];
  const X = () => (typeof prepExceptions !== 'undefined' && Array.isArray(prepExceptions)) ? prepExceptions : [];
  const P = () => (typeof preps !== 'undefined' && Array.isArray(preps)) ? preps : [];
  const nom = id => (typeof staffName === 'function' && id) ? staffName(id) : (id || '');
  const ORDRE = [1, 2, 3, 4, 5, 6, 0];        // lundi d'abord, dimanche en dernier
  const BO_SEMAINES = 6;

  function enregistrer() {
    if (typeof schedSave === 'function') schedSave();
    if (typeof window.ppRendPlanning === 'function') window.ppRendPlanning();
    window.ppRendCapacite();
  }
  // Sept lignes fixes, creees a la premiere ouverture de la carte. Valeurs de
  // depart : la semaine du tableur — trois places du lundi au vendredi.
  function assurerTrame() {
    if (typeof prepTrame === 'undefined' || !Array.isArray(prepTrame)) return false;
    let neuf = false;
    ORDRE.forEach(function (d) {
      const id = window.PP_CLEFS[d];
      if (!prepTrame.some(x => x && x.id === id)) {
        prepTrame.push({ id: id, places: (d >= 1 && d <= 5) ? 3 : 0, resp: null, updatedAt: Date.now() });
        neuf = true;
      }
    });
    return neuf;
  }
  function optionsStaff(sel) {
    const l = (typeof staffDB !== 'undefined' && Array.isArray(staffDB)) ? staffDB : [];
    return '<option value="">—</option>' + l.filter(s => s && s.id).map(function (s) {
      return '<option value="' + E(s.id) + '"' + (sel === s.id ? ' selected' : '') + '>'
        + E((s.prenom || '') + ' ' + (s.nom || '')) + '</option>';
    }).join('');
  }

  let boJours = [];

  window.ppRendCapacite = function () {
    const el = document.getElementById('pp-capacite'); if (!el) return;
    if (assurerTrame() && typeof schedSave === 'function') schedSave();
    const trame = T(), exc = X(), auj = window.ppAujourdhui();

    let h = '<div style="font-size:.72rem;text-transform:uppercase;letter-spacing:.6px;font-weight:700;'
      + 'color:var(--gray-500);margin-bottom:.5rem">La semaine type</div>'
      + '<table class="pp-t"><thead><tr><th>Jour</th><th class="c5">Places</th><th>Responsable</th></tr></thead><tbody>';
    ORDRE.forEach(function (d) {
      const id = window.PP_CLEFS[d];
      const t = trame.find(x => x && x.id === id) || { id: id, places: 0, resp: null };
      h += '<tr><td style="text-transform:capitalize;font-weight:600">' + E(window.PP_NOMS[d]) + '</td>'
        + '<td class="c5"><input type="number" min="0" max="12" value="' + (+t.places || 0) + '"'
        + ' style="width:56px;text-align:center" onchange="ppTramePlaces(' + d + ',this.value)"></td>'
        + '<td><select onchange="ppTrameResp(' + d + ',this.value)"'
        + ((+t.places || 0) ? '' : ' disabled') + '>' + optionsStaff(t.resp) + '</select></td></tr>';
    });
    h += '</tbody></table>'
      + '<div style="font-size:.78rem;color:var(--gray-500);margin-top:6px;line-height:1.5">'
      + '<b>0 place</b> = jour sans production, il n’apparaît pas au comptoir. '
      + 'La trame ne se ressaisit jamais : seuls les écarts ci-dessous se déclarent.</div>';

    // ── Les écarts ──
    boJours = window.ppJours(auj, trame, BO_SEMAINES * 5);
    h += '<div style="font-size:.72rem;text-transform:uppercase;letter-spacing:.6px;font-weight:700;'
      + 'color:var(--gray-500);margin:1.1rem 0 .5rem">Les écarts — ' + BO_SEMAINES + ' prochaines semaines</div>'
      + '<table class="pp-t"><thead><tr><th>Jour</th><th class="c5">Places</th><th>Responsable</th>'
      + '<th>Motif</th><th class="c5"></th></tr></thead><tbody>';
    boJours.forEach(function (iso, i) {
      const e = exc.find(x => x && x.date === iso) || null;
      const places = window.ppPlaces(iso, trame, exc);
      const pris = window.ppDuJour(iso, P(), auj, trame, exc).length;
      h += '<tr' + (e ? ' style="background:#FFF8E1"' : '') + '>'
        + '<td style="text-transform:capitalize">' + E(window.ppNomJour(iso) + ' ' + window.ppJJMM(iso)) + '</td>'
        + '<td class="c5"><input type="number" min="0" max="12" value="' + places + '"'
        + ' style="width:56px;text-align:center" onchange="ppEcartPlaces(' + i + ',this.value)"></td>'
        + '<td><select onchange="ppEcartResp(' + i + ',this.value)">'
        + optionsStaff(window.ppResp(iso, trame, exc)) + '</select></td>'
        + '<td><input type="text" value="' + E((e && e.motif) || '') + '" placeholder="Pas assez de monde…"'
        + ' style="width:100%" onchange="ppEcartMotif(' + i + ',this.value)"></td>'
        + '<td class="c5">' + (pris ? '<span style="font-size:.72rem;color:var(--gray-500)">' + pris + ' prévue' + (pris > 1 ? 's' : '') + '</span>' : '')
        + (e ? ' <button class="pp-add" onclick="ppEcartRetirer(' + i + ')" title="Revenir à la trame">↩</button>' : '')
        + '</td></tr>';
    });
    el.innerHTML = h + '</tbody></table>';
  };

  function ecartPour(iso) {
    if (typeof prepExceptions === 'undefined' || !Array.isArray(prepExceptions)) return null;
    let e = prepExceptions.find(x => x && x.date === iso);
    if (!e) { e = { id: Date.now() + Math.floor(Math.random() * 1000), date: iso, places: null, resp: null, motif: '', updatedAt: Date.now() }; prepExceptions.push(e); }
    return e;
  }

  window.ppTramePlaces = function (d, v) {
    const id = window.PP_CLEFS[d];
    const t = T().find(x => x && x.id === id); if (!t) return;
    t.places = Math.max(0, Math.min(12, parseInt(v, 10) || 0)); t.updatedAt = Date.now();
    enregistrer();
  };
  window.ppTrameResp = function (d, v) {
    const id = window.PP_CLEFS[d];
    const t = T().find(x => x && x.id === id); if (!t) return;
    t.resp = v || null; t.updatedAt = Date.now();
    enregistrer();
  };

  // On ne descend JAMAIS la capacite sous ce qui est deja reserve. Sans cette
  // regle, des preparations deviendraient orphelines sans que personne ne soit
  // prevenu — et ca se decouvre le jour ou le patient se presente.
  window.ppEcartPlaces = function (i, v) {
    const iso = boJours[i]; if (!iso) return;
    const n = Math.max(0, Math.min(12, parseInt(v, 10) || 0));
    const pris = window.ppDuJour(iso, P(), window.ppAujourdhui(), T(), X()).length;
    if (n < pris) {
      alert(pris + ' préparation' + (pris > 1 ? 's sont' : ' est') + ' déjà prévue' + (pris > 1 ? 's' : '')
        + ' ce jour-là.\n\nDéplacez-la' + (pris > 1 ? 's' : '') + ' avant de réduire la capacité à ' + n + '.');
      window.ppRendCapacite(); return;
    }
    const e = ecartPour(iso); if (!e) return;
    e.places = n; e.updatedAt = Date.now();
    enregistrer();
  };
  window.ppEcartResp = function (i, v) {
    const iso = boJours[i]; if (!iso) return;
    const e = ecartPour(iso); if (!e) return;
    e.resp = v || null; e.updatedAt = Date.now();
    enregistrer();
  };
  window.ppEcartMotif = function (i, v) {
    const iso = boJours[i]; if (!iso) return;
    const e = ecartPour(iso); if (!e) return;
    e.motif = String(v || '').slice(0, 80); e.updatedAt = Date.now();
    enregistrer();
  };
  window.ppEcartRetirer = function (i) {
    const iso = boJours[i]; if (!iso) return;
    const e = X().find(x => x && x.date === iso); if (!e) return;
    if (typeof markDeleted === 'function') markDeleted('prepExceptions', e.id);
    if (typeof prepExceptions !== 'undefined') prepExceptions = prepExceptions.filter(x => x !== e);
    enregistrer();
  };

  // La soupape. Une interdiction stricte sans issue legitime se contourne par
  // un post-it ; celle-ci se voit, porte un nom et laisse une trace.
  window.ppPlusUnePlace = function (i) {
    if (typeof isAdmin === 'function' && !isAdmin()) { alert('Réservé aux administrateurs.'); return; }
    const jours = window.ppJours(window.ppAujourdhui(), T(), window.PP_HORIZON);
    const iso = jours[i]; if (!iso) return;
    const actuel = window.ppPlaces(iso, T(), X());
    if (!confirm('Ouvrir une place de plus le ' + window.ppNomJour(iso) + ' ' + window.ppJJMM(iso)
      + ' ?\n\n' + actuel + ' → ' + (actuel + 1) + ' places.')) return;
    const e = ecartPour(iso); if (!e) return;
    e.places = actuel + 1; e.updatedAt = Date.now();
    if (typeof schedSave === 'function') schedSave();
    if (typeof window.ppRendPlanning === 'function') window.ppRendPlanning();
  };
})();
