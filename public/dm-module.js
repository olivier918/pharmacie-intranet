/* ════════════════════════════════════════════════════════════════════════════
   Module DEMANDES — boîte à idées et anomalies

   Deux façons de tuer une boîte à idées : rendre le dépôt pénible, ou laisser
   les demandes sans réponse. Tout ce fichier découle de ces deux écueils.
   - Dépôt : trois champs, le reste est deviné (module, auteur, version).
   - Réponse : « Pas retenu » exige un motif écrit, contrôlé par le formulaire.
   Cadrage complet : projet Claude, « Module Demandes - cadrage ».
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const DM_STATUTS = {
    recu:     { lbl: 'Reçu',        col: '#6b7a72', bg: '#eef2f0', colonne: 'demande' },
    preciser: { lbl: 'À préciser',  col: '#E65100', bg: '#FFF3E0', colonne: 'demande' },
    retenu:   { lbl: 'Retenu',      col: '#1565C0', bg: '#E3F2FD', colonne: 'demande' },
    encours:  { lbl: 'En cours',    col: '#6A1B9A', bg: '#F3E5F5', colonne: 'cours'   },
    fait:     { lbl: 'Fait',        col: '#2E7D32', bg: '#E8F5E9', colonne: 'fait'    },
    refuse:   { lbl: 'Pas retenu',  col: '#C62828', bg: '#FFEBEE', colonne: 'refuse'  }
  };
  const DM_NATURES = {
    bug:      { lbl: 'Ça ne marche pas', ico: '⚠' },
    idee:     { lbl: 'J’aimerais que…',  ico: '💡' },
    question: { lbl: 'Une question',     ico: '?' }
  };
  // Gêne exprimée en impact vécu, jamais en priorité P1/P2 : un opérateur sait
  // dire si quelque chose le bloque, pas si c'est une priorité de niveau 2.
  const DM_GENES = {
    bloque: { lbl: 'Ça me bloque',    rang: 3, col: '#C62828' },
    agace:  { lbl: 'Ça m’agace',      rang: 2, col: '#E65100' },
    mieux:  { lbl: 'Ce serait mieux', rang: 1, col: '#6b7a72' }
  };
  const DM_FAIT_JOURS = 45;   // durée d'affichage dans la colonne « Fait récemment »

  // ── Ordre d'affichage ───────────────────────────────────────────────────
  // Trois signaux, un seul score. Les soutiens priment (un « moi aussi » est un
  // vote collectif, la gêne n'est qu'un ressenti individuel), mais une demande
  // toute neuve part avec une avance qui fond en deux semaines : sans cela elle
  // naîtrait sous la pile et personne ne la verrait jamais pour la soutenir.
  // Une décote continue plutôt qu'un seuil : à J+8 une demande ne doit pas
  // dégringoler d'un coup alors que rien ne s'est passé.
  const DM_NEUF_JOURS  = 7;    // durée du badge « Nouveau »
  const DM_GRACE_JOURS = 14;   // durée sur laquelle l'avance de fraîcheur fond
  const DM_GRACE_PTS   = 3;    // avance de départ, en équivalent soutiens
  function dmNeuve(d) { return d && (Date.now() - (d.ts || 0)) < DM_NEUF_JOURS * 86400000; }
  function dmScore(d) {
    const soutiens = Array.isArray(d.soutiens) ? d.soutiens.length : 0;
    const gene = { bloque: 2, agace: 1, mieux: 0 }[d.gene] || 0;
    const age = (Date.now() - (d.ts || 0)) / 86400000;
    const frais = Math.max(0, DM_GRACE_PTS * (1 - age / DM_GRACE_JOURS));
    return soutiens + gene + frais;
  }

  const E = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const dmListe = () => (typeof demandes !== 'undefined' && Array.isArray(demandes)) ? demandes : [];
  const dmUser = () => (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null;
  const dmAdmin = () => (typeof isAdmin === 'function') ? isAdmin() : false;
  const dmSave = () => { try { if (typeof schedSave === 'function') schedSave(); } catch (e) {} };
  const dmNom = u => { const x = dmUser(); return x ? ((x.prenom || '') + ' ' + (x.nom || '')).trim() || x.id : '?'; };
  function dmDate(ts) { const d = new Date(ts); return d.toLocaleDateString('fr-FR') + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); }
  function dmJour(ts) { return new Date(ts).toLocaleDateString('fr-FR'); }

  // Titre : la premiere phrase, coupee a 60 signes. Derive, jamais saisi — un
  // champ de plus au depot, c'est un depot de moins ; la cible reste 30 s.
  function dmTitre(d) {
    const t = String((d && d.texte) || '').trim().replace(/\s+/g, ' ');
    if (!t) return '(sans texte)';
    const fin = t.search(/[.!?\n]/);
    let x = (fin > 0 ? t.slice(0, fin) : t).trim();
    if (x.length > 60) x = x.slice(0, 59).replace(/\s+\S*$/, '') + '…';
    return x;
  }
  // Age relatif : dans un tableau, « 3 j » se compare d'un coup d'oeil la ou
  // une date absolue demande un calcul mental a chaque ligne.
  function dmAge(ts) {
    const j = Math.floor((Date.now() - (ts || 0)) / 86400000);
    if (j <= 0) return "Aujourd'hui";
    if (j === 1) return 'Hier';
    if (j < 7) return j + ' j';
    if (j < 31) return Math.round(j / 7) + ' sem';
    if (j < 365) return Math.round(j / 30) + ' mois';
    return Math.floor(j / 365) + ' an' + (j >= 730 ? 's' : '');
  }

  // ── Non lu ────────────────────────────────────────────────────────────────
  // Une demande « bouge » quand son état change ou qu'un message s'y ajoute.
  // Ne sont alertés que ceux qu'elle concerne : son auteur, ceux qui l'ont
  // soutenue, et les administrateurs. Alerter tout le monde ferait de la
  // pastille un bruit permanent, donc un signal qu'on cesse de regarder.
  function dmConcerne(d) {
    const u = dmUser(); if (!u || !d) return false;
    return dmAdmin() || d.auteur === u.id || (Array.isArray(d.soutiens) && d.soutiens.indexOf(u.id) >= 0);
  }
  function dmNonLue(d) {
    const u = dmUser(); if (!u || !d || !dmConcerne(d)) return false;
    const vu = (d.vu && d.vu[u.id]) || 0;
    return (d.majAt || 0) > vu;
  }
  window.dmNonLues = function () { return dmListe().filter(dmNonLue).length; };
  function dmMarquerLue(d) {
    const u = dmUser(); if (!u || !d) return;
    d.vu = d.vu || {};
    // Volontairement SANS updatedAt : rehausser ce champ ferait qu'un poste qui
    // se contente d'OUVRIR une demande écrase, lors de la fusion serveur, un
    // message qu'un autre poste vient d'y écrire. Au pire une pastille
    // réapparaît ; perdre un message serait autrement plus grave.
    if (d.vu[u.id] !== (d.majAt || 0)) d.vu[u.id] = d.majAt || Date.now();
  }
  function dmTouche(d) { d.majAt = Date.now(); d.updatedAt = Date.now(); }

  // ── CSS ───────────────────────────────────────────────────────────────────
  const DM_CSS = `
  #sec-demandes{padding:0}
  .dm-bar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:16px}
  .dm-grow{flex:1}
  .dm-cols{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;align-items:start}
  @media(max-width:900px){.dm-cols{grid-template-columns:1fr}}
  .dm-col{background:#fff;border:1px solid var(--gray-200);border-radius:12px;overflow:hidden}
  .dm-col-h{padding:9px 14px;font-size:.76rem;font-weight:800;text-transform:uppercase;letter-spacing:.9px;display:flex;align-items:center;gap:8px;border-bottom:1px solid var(--gray-200)}
  .dm-col-n{margin-left:auto;background:var(--gray-100);color:var(--gray-700);border-radius:10px;padding:1px 9px;font-size:.72rem;letter-spacing:0}
  .dm-card{padding:11px 14px;border-bottom:1px solid var(--gray-200);cursor:pointer;transition:background .12s}
  .dm-card:last-child{border-bottom:none}
  .dm-card:hover{background:var(--gray-100)}
  .dm-card.neuve{background:#FFF5F5;border-left:3px solid var(--red)}
  .dm-t1{display:flex;align-items:center;gap:7px;margin-bottom:3px}
  .dm-num{font-size:.7rem;color:var(--gray-500);font-weight:700}
  .dm-txt{font-size:.88rem;font-weight:600;line-height:1.35;color:var(--gray-900)}
  .dm-meta{font-size:.72rem;color:var(--gray-500);margin-top:5px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .dm-tag{border-radius:9px;padding:1px 8px;font-size:.68rem;font-weight:700}
  .dm-vide{padding:1.4rem;text-align:center;color:var(--gray-500);font-size:.83rem}
  /* Tableau : une seule liste ordonnee. Le classement par votes n'a de sens
     que dans une colonne unique — reparti en trois colonnes d'etat, il ne se
     lit plus. L'etat devient donc une pastille de ligne. */
  .dm-tbl{background:#fff;border:1px solid var(--gray-200);border-radius:12px;overflow:hidden}
  .dm-tbl table{width:100%;border-collapse:collapse}
  .dm-tbl th{font-size:.7rem;font-weight:800;text-transform:uppercase;letter-spacing:.8px;color:var(--gray-500);text-align:left;padding:10px 12px;border-bottom:1px solid var(--gray-200);background:var(--gray-100);white-space:nowrap}
  .dm-tbl td{padding:11px 12px;border-bottom:1px solid var(--gray-200);vertical-align:top;font-size:.86rem}
  .dm-tbl tr:last-child td{border-bottom:none}
  .dm-tbl tbody tr{cursor:pointer;transition:background .12s}
  .dm-tbl tbody tr:hover{background:var(--gray-100)}
  .dm-tbl tr.neuve td:first-child{box-shadow:inset 3px 0 0 var(--red)}
  .dm-c-num{font-size:.74rem;color:var(--gray-500);font-weight:700;white-space:nowrap}
  .dm-c-txt{font-weight:600;color:var(--gray-900);line-height:1.35}
  .dm-c-sub{font-size:.72rem;color:var(--gray-500);margin-top:4px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;font-weight:400}
  .dm-c-date{white-space:nowrap;color:var(--gray-500);font-size:.78rem}
  /* Le vote se donne depuis la liste : demander d'ouvrir la fiche pour
     soutenir, c'est perdre la moitie des votes en route. */
  .dm-vote{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--gray-200);background:#fff;border-radius:999px;padding:4px 11px;font-size:.82rem;font-weight:800;cursor:pointer;font-family:inherit;color:var(--gray-700);white-space:nowrap}
  .dm-vote:hover{border-color:var(--g-border);background:var(--g-pale)}
  .dm-vote.on{background:var(--g-pale);border-color:var(--g-border);color:var(--g-dark)}
  .dm-vue{display:flex;gap:2px;background:var(--gray-100);border-radius:9px;padding:2px}
  .dm-vue button{border:none;background:none;border-radius:7px;padding:5px 11px;font-size:.8rem;font-weight:700;cursor:pointer;font-family:inherit;color:var(--gray-700)}
  .dm-vue button.sel{background:#fff;color:var(--g-dark);box-shadow:0 1px 3px rgba(0,0,0,.1)}
  .dm-chips{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}
  .dm-chip{border:1px solid var(--gray-200);background:#fff;border-radius:999px;padding:5px 13px;font-size:.81rem;font-weight:700;cursor:pointer;font-family:inherit;color:var(--gray-700)}
  .dm-chip:hover{border-color:var(--g-border)}
  .dm-chip.sel{background:var(--g-pale);border-color:var(--g-border);color:var(--g-dark)}
  .dm-chip .n{opacity:.65;font-weight:600;margin-left:5px}
  .dm-moi{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--gray-200);background:#fff;border-radius:14px;padding:2px 10px;font-size:.72rem;font-weight:700;color:var(--gray-700);cursor:pointer}
  .dm-moi.on{background:var(--g-pale);border-color:var(--g-border);color:var(--g-dark)}
  .dm-ov{position:fixed;inset:0;background:rgba(0,0,0,.5);display:none;align-items:center;justify-content:center;z-index:600;padding:1rem}
  .dm-ov.open{display:flex}
  .dm-modal{background:#fff;border-radius:14px;width:min(760px,96vw);max-height:92vh;overflow:auto;padding:1.4rem}
  .dm-modal h3{font-size:1.05rem;color:var(--g-dark);margin-bottom:.2rem}
  .dm-fg{margin-bottom:13px}
  .dm-fg label{display:block;font-size:.78rem;font-weight:700;color:var(--gray-700);margin-bottom:5px}
  .dm-inp{font-family:inherit;font-size:14px;border:1px solid #dfe8e2;border-radius:9px;background:#fff;width:100%;color:#222;padding:10px 12px}
  textarea.dm-inp{min-height:90px;resize:vertical}
  .dm-choix{display:flex;gap:8px;flex-wrap:wrap}
  .dm-choix button{border:1px solid var(--gray-200);background:#fff;border-radius:10px;padding:9px 13px;font-size:.85rem;font-weight:600;cursor:pointer;font-family:inherit;color:var(--gray-700)}
  .dm-choix button.sel{background:var(--g-pale);border-color:var(--g-border);color:var(--g-dark)}
  .dm-fil{margin-top:1rem;border-top:1px solid var(--gray-200);padding-top:.9rem}
  .dm-msg{background:var(--gray-100);border-radius:10px;padding:9px 12px;margin-bottom:8px}
  .dm-msg .qui{font-size:.72rem;color:var(--gray-500);margin-bottom:3px}
  .dm-msg .txt{font-size:.87rem;white-space:pre-wrap;line-height:1.45}
  .dm-img{max-width:100%;border-radius:10px;border:1px solid var(--gray-200);margin-top:.6rem;display:block}
  .dm-foot{display:flex;gap:8px;flex-wrap:wrap;margin-top:1.2rem;align-items:center}
  .dm-neuf{background:#E3F2FD;color:#1565C0;border-radius:999px;padding:1px 8px;font-size:.68rem;font-weight:800;letter-spacing:.02em}
  .dm-motif{background:#FFEBEE;color:#C62828;border-left:3px solid #C62828;border-radius:0 8px 8px 0;padding:6px 9px;margin-top:7px;font-size:.79rem;line-height:1.4}
  `;

  // ── Section ───────────────────────────────────────────────────────────────
  const DM_SECTION = `
  <div class="stitle"><svg class="ico"><use href="#ic-idee"></use></svg> Boîte à idées</div>
  <div class="dm-bar">
    <button class="btn bp" onclick="dmOuvrirForm()"><svg class="ico"><use href="#ic-ajouter"></use></svg> Nouvelle demande</button>
    <input type="text" id="dm-q" class="dm-inp" placeholder="Rechercher…" style="max-width:220px" oninput="dmRender()">
    <select id="dm-f-nature" class="dm-inp" style="max-width:170px" onchange="dmRender()">
      <option value="">Toutes natures</option>
      <option value="bug">Ça ne marche pas</option>
      <option value="idee">J’aimerais que…</option>
      <option value="question">Une question</option>
    </select>
    <select id="dm-f-gene" class="dm-inp" style="max-width:160px" onchange="dmRender()">
      <option value="">Toutes gênes</option>
      <option value="bloque">Ça me bloque</option>
      <option value="agace">Ça m’agace</option>
      <option value="mieux">Ce serait mieux</option>
    </select>
    <select id="dm-f-moi" class="dm-inp" style="max-width:170px" onchange="dmRender()">
      <option value="">Tout le monde</option>
      <option value="mien">Les miennes</option>
      <option value="soutenu">Celles que je soutiens</option>
    </select>
    <span class="dm-grow"></span>
    <div class="dm-vue">
      <button id="dm-v-tbl" class="sel" onclick="dmVue('tableau')">Tableau</button>
      <button id="dm-v-col" onclick="dmVue('colonnes')">Colonnes</button>
    </div>
  </div>
  <div class="dm-chips" id="dm-chips"></div>
  <div class="dm-cols" id="dm-cols"></div>`;

  // ── Rendu ─────────────────────────────────────────────────────────────────
  // Vue par defaut : le tableau. Les colonnes restent accessibles — la colonne
  // « Fait recemment » est ce qui montre que les idees sortent, et c'est elle
  // qui donne envie de continuer a en deposer.
  let dmVueCourante = 'tableau';
  // Filtre d'etat. Par defaut « Toutes » = tout sauf les non retenues : celles-ci
  // sont archivees, mais les demandes faites restent visibles — voir ses idees
  // sortir est ce qui donne envie d'en deposer d'autres.
  let dmFiltre = 'vives';
  const DM_FILTRES = [
    { cle: 'vives',    lbl: 'Toutes',        test: d => d.statut !== 'refuse' },
    { cle: 'preciser', lbl: 'À préciser',    test: d => d.statut === 'preciser' },
    { cle: 'retenu',   lbl: 'Retenues',      test: d => d.statut === 'retenu' || d.statut === 'encours' },
    { cle: 'fait',     lbl: 'Faites',        test: d => d.statut === 'fait' },
    { cle: 'refuse',   lbl: 'Non retenues',  test: d => d.statut === 'refuse' }
  ];
  window.dmFiltrer = function (c) { dmFiltre = c; dmRender(); };
  window.dmVue = function (v) {
    dmVueCourante = v;
    const a = document.getElementById('dm-v-tbl'), b = document.getElementById('dm-v-col');
    if (a) a.className = (v === 'tableau' ? 'sel' : '');
    if (b) b.className = (v === 'colonnes' ? 'sel' : '');
    dmRender();
  };

  window.dmRender = function () {
    const el = document.getElementById('dm-cols'); if (!el) return;
    const q = ((document.getElementById('dm-q') || {}).value || '').toLowerCase();
    const avecRefus = (dmFiltre === 'refuse');
    const fEtat = DM_FILTRES.find(function (f) { return f.cle === dmFiltre; }) || DM_FILTRES[0];
    const fNature = ((document.getElementById('dm-f-nature') || {}).value || '');
    const fGene   = ((document.getElementById('dm-f-gene')   || {}).value || '');
    const fMoi    = ((document.getElementById('dm-f-moi')    || {}).value || '');
    const moi = (dmUser() || {}).id;
    const limite = Date.now() - DM_FAIT_JOURS * 86400000;

    let l = dmListe().filter(function (d) {
      if (!d) return false;
      if (!fEtat.test(d)) return false;
      if (d.statut === 'fait' && (d.majAt || d.ts || 0) < limite && !q) return false;
      if (fNature && d.nature !== fNature) return false;
      if (fGene && d.gene !== fGene) return false;
      if (fMoi === 'mien' && d.auteur !== moi) return false;
      if (fMoi === 'soutenu' && !(Array.isArray(d.soutiens) && d.soutiens.indexOf(moi) >= 0)) return false;
      if (!q) return true;
      return ((d.texte || '') + ' ' + (d.auteurNom || '') + ' ' + (d.module || '') + ' ' + (d.motif || '')).toLowerCase().includes(q);
    });
    // Tri par score décroissant (soutiens + gêne + avance de fraîcheur), puis
    // le plus ancien : à score égal, une demande déposée il y a trois semaines
    // ne doit pas se faire doubler indéfiniment par une arrivante.
    l.sort(function (a, b) {
      return dmScore(b) - dmScore(a) || (a.ts || 0) - (b.ts || 0);
    });

    // Compteurs des pastilles : calcules avant le filtre d'etat, sinon chaque
    // pastille afficherait le compte de la selection courante, pas le sien.
    const ch = document.getElementById('dm-chips');
    if (ch) {
      const base = dmListe().filter(function (d) { return !!d; });
      ch.innerHTML = DM_FILTRES.map(function (f) {
        const n = base.filter(f.test).length;
        if (f.cle === 'refuse' && !n) return '';
        return '<button class="dm-chip' + (dmFiltre === f.cle ? ' sel' : '') + '" onclick="dmFiltrer(\'' + f.cle + '\')">'
          + E(f.lbl) + '<span class="n">' + n + '</span></button>';
      }).join('');
    }

    if (dmVueCourante === 'colonnes') {
      const cols = [
        { cle: 'demande', lbl: 'Demandé',        col: '#6b7a72' },
        { cle: 'cours',   lbl: 'En cours',       col: '#6A1B9A' },
        { cle: 'fait',    lbl: 'Fait récemment', col: '#2E7D32' }
      ];
      if (avecRefus) cols.push({ cle: 'refuse', lbl: 'Non retenues', col: '#C62828' });
      el.style.display = 'grid';
      el.style.gridTemplateColumns = 'repeat(' + Math.min(cols.length, 4) + ',1fr)';
      el.innerHTML = cols.map(function (c) {
        const items = l.filter(function (d) { return (DM_STATUTS[d.statut] || DM_STATUTS.recu).colonne === c.cle; });
        return '<div class="dm-col"><div class="dm-col-h" style="color:' + c.col + '">' + E(c.lbl)
          + '<span class="dm-col-n">' + items.length + '</span></div>'
          + (items.length ? items.map(dmCarte).join('') : '<div class="dm-vide">Rien ici</div>')
          + '</div>';
      }).join('');
    } else {
      el.style.display = 'block';
      el.innerHTML = l.length
        ? '<div class="dm-tbl"><table><thead><tr>'
          + '<th style="width:52px">N°</th><th>Demande</th><th style="width:130px">État</th>'
          + '<th style="width:110px">Déposée</th><th style="width:96px">Votes</th></tr></thead><tbody>'
          + l.map(dmLigne).join('') + '</tbody></table></div>'
        : '<div class="dm-tbl"><div class="dm-vide">Aucune demande ne correspond.</div></div>';
    }
    if (typeof updateNavBadges === 'function') updateNavBadges();
  };

  // Une ligne du tableau. Le vote est un bouton a part : son clic ne doit pas
  // ouvrir la fiche, d'ou le stopPropagation.
  function dmLigne(d) {
    const st = DM_STATUTS[d.statut] || DM_STATUTS.recu;
    const na = DM_NATURES[d.nature] || DM_NATURES.idee;
    const ge = DM_GENES[d.gene];
    const u = dmUser();
    const n = Array.isArray(d.soutiens) ? d.soutiens.length : 0;
    const vote = !!(u && Array.isArray(d.soutiens) && d.soutiens.indexOf(u.id) >= 0);
    return '<tr class="' + (dmNonLue(d) ? 'neuve' : '') + '" onclick="dmOuvrir(' + d.id + ')">'
      + '<td class="dm-c-num">#' + (d.num || '?') + '</td>'
      + '<td><div class="dm-c-txt">' + na.ico + ' ' + E(dmTitre(d)) + '</div>'
        + '<div class="dm-c-sub">'
        + (dmNeuve(d) && d.statut !== 'fait' && d.statut !== 'refuse' ? '<span class="dm-neuf">Nouveau</span>' : '')
        + (ge ? '<span style="color:' + ge.col + ';font-weight:700">' + ge.lbl + '</span>' : '')
        + (d.module ? '<span>· ' + E(d.module) + '</span>' : '')
        + '<span>· ' + E(d.auteurNom || '') + '</span>'
        + (Array.isArray(d.fil) && d.fil.length ? '<span>· 💬 ' + d.fil.length + '</span>' : '')
        + (d.image ? '<span>· 📷</span>' : '')
        + '</div>'
        + (d.statut === 'refuse' && d.motif ? '<div class="dm-motif">Non retenue : ' + E(d.motif)
            + (d.refusePar ? ' — ' + E(d.refusePar) : '') + '</div>' : '')
        + '</td>'
      + '<td><span class="dm-tag" style="background:' + st.bg + ';color:' + st.col + '">' + st.lbl + '</span></td>'
      + '<td class="dm-c-date" title="' + E(dmJour(d.ts)) + '">' + dmAge(d.ts) + '</td>'
      + '<td><button class="dm-vote' + (vote ? ' on' : '') + '" onclick="event.stopPropagation();dmSoutenir(' + d.id + ')">'
        + (vote ? '★' : '☆') + ' ' + n + '</button></td>'
      + '</tr>';
  }

  function dmCarte(d) {
    const st = DM_STATUTS[d.statut] || DM_STATUTS.recu;
    const na = DM_NATURES[d.nature] || DM_NATURES.idee;
    const ge = DM_GENES[d.gene];
    const n = Array.isArray(d.soutiens) ? d.soutiens.length : 0;
    return '<div class="dm-card' + (dmNonLue(d) ? ' neuve' : '') + '" onclick="dmOuvrir(' + d.id + ')">'
      + '<div class="dm-t1"><span>' + na.ico + '</span><span class="dm-num">#' + (d.num || '?') + '</span>'
      + '<span class="dm-tag" style="background:' + st.bg + ';color:' + st.col + '">' + st.lbl + '</span>'
      + (dmNeuve(d) && d.statut !== 'fait' && d.statut !== 'refuse' ? '<span class="dm-neuf">Nouveau</span>' : '')
      + '</div>'
      + '<div class="dm-txt">' + E(dmTitre(d)) + '</div>'
      + (d.statut === 'refuse' && d.motif ? '<div class="dm-motif">Non retenue : ' + E(d.motif) + '</div>' : '')
      + '<div class="dm-meta">'
      + (ge ? '<span style="color:' + ge.col + ';font-weight:700">' + ge.lbl + '</span>' : '')
      + (d.module ? '<span>· ' + E(d.module) + '</span>' : '')
      + '<span>· ' + E(d.auteurNom || '') + '</span>'
      + '<span>· ' + dmJour(d.ts) + '</span>'
      + (n ? '<span>· ★ ' + n + '</span>' : '')
      + (Array.isArray(d.fil) && d.fil.length ? '<span>· 💬 ' + d.fil.length + '</span>' : '')
      + (d.image ? '<span>· 📷</span>' : '')
      + '</div></div>';
  }

  // ── Dépôt ─────────────────────────────────────────────────────────────────
  let dmForm = { nature: 'bug', gene: 'agace', image: null };

  window.dmOuvrirForm = function () {
    dmForm = { nature: 'bug', gene: 'agace', image: null };
    // Le module d'où l'on vient est deviné : c'est autant de moins à saisir, et
    // autant d'allers-retours en moins pour savoir de quel écran on parle.
    const actif = document.querySelector('.sidebar .sb-item.active .sb-label');
    const mod = actif ? actif.textContent.trim() : '';
    const g = i => document.getElementById(i);
    g('dm-f-texte').value = '';
    g('dm-f-module').value = mod;
    g('dm-f-img').value = '';
    g('dm-f-apercu').innerHTML = '';
    dmMajChoix();
    document.getElementById('dm-ov-form').classList.add('open');
    setTimeout(function () { g('dm-f-texte').focus(); }, 60);
  };
  window.dmFermerForm = function () { document.getElementById('dm-ov-form').classList.remove('open'); };
  window.dmChoix = function (champ, val) { dmForm[champ] = val; dmMajChoix(); };
  function dmMajChoix() {
    document.querySelectorAll('#dm-ov-form [data-champ]').forEach(function (b) {
      const c = b.getAttribute('data-champ'), v = b.getAttribute('data-val');
      b.classList.toggle('sel', dmForm[c] === v);
    });
  }

  // Redimensionnement avant enregistrement : une capture d'écran brute pèse
  // plusieurs mégaoctets et partirait telle quelle dans la base ET dans les 300
  // instantanés d'historique. 1280 px de large en JPEG suffisent largement à
  // montrer un défaut d'affichage.
  window.dmImage = function (input) {
    const f = input.files && input.files[0]; if (!f) return;
    const img = new Image(), lecteur = new FileReader();
    lecteur.onload = function (e) { img.src = e.target.result; };
    img.onload = function () {
      const max = 1280, r = Math.min(1, max / img.width);
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      dmForm.image = c.toDataURL('image/jpeg', 0.7);
      const ko = Math.round(dmForm.image.length * 0.75 / 1024);
      document.getElementById('dm-f-apercu').innerHTML =
        '<img src="' + dmForm.image + '" class="dm-img" style="max-height:170px">'
        + '<div style="font-size:.75rem;color:var(--gray-500);margin-top:4px">' + ko + ' Ko · '
        + '<span style="cursor:pointer;text-decoration:underline" onclick="dmRetirerImage()">retirer</span></div>';
    };
    lecteur.readAsDataURL(f);
  };
  window.dmRetirerImage = function () {
    dmForm.image = null;
    document.getElementById('dm-f-apercu').innerHTML = '';
    const i = document.getElementById('dm-f-img'); if (i) i.value = '';
  };

  window.dmEnvoyer = function () {
    const u = dmUser(); if (!u) { alert('Identifiez-vous avec votre code PIN.'); return; }
    const texte = (document.getElementById('dm-f-texte').value || '').trim();
    if (texte.length < 5) { alert('Décrivez la demande en une phrase.'); return; }
    const l = dmListe();
    const num = l.reduce(function (m, d) { return Math.max(m, d.num || 0); }, 0) + 1;
    const now = Date.now();
    l.unshift({
      id: now, num: num, ts: now, majAt: now, updatedAt: now,
      auteur: u.id, auteurNom: dmNom(),
      nature: dmForm.nature, gene: dmForm.gene,
      module: (document.getElementById('dm-f-module').value || '').trim(),
      texte: texte, statut: 'recu', motif: '',
      soutiens: [], fil: [],
      // L'auteur a evidemment deja vu ce qu'il vient d'ecrire : sans cette ligne,
      // deposer une demande allumerait une pastille rouge chez soi-meme.
      vu: (function () { const v = {}; v[u.id] = now; return v; })(),
      image: dmForm.image || null,
      // Version déployée : sur une anomalie, savoir sur quelle version elle a
      // été vue évite de chercher un défaut déjà corrigé.
      version: (window.APP_CONFIG && window.APP_CONFIG.version) || ''
    });
    dmSave();
    if (typeof logAction === 'function') logAction('Demande déposée', '#' + num);
    dmFermerForm(); dmRender();
    dmToast('Demande #' + num + ' enregistrée. Vous serez prévenu dès qu’elle avance.');
  };

  function dmToast(t) {
    let e = document.getElementById('dm-toast');
    if (!e) {
      e = document.createElement('div'); e.id = 'dm-toast';
      e.style.cssText = 'position:fixed;left:50%;bottom:26px;transform:translateX(-50%);background:#1D5C3A;color:#fff;padding:11px 18px;border-radius:11px;font-size:.87rem;z-index:900;box-shadow:0 8px 24px rgba(0,0,0,.25);max-width:90vw;text-align:center';
      document.body.appendChild(e);
    }
    e.textContent = t; e.style.display = '';
    clearTimeout(e._t); e._t = setTimeout(function () { e.style.display = 'none'; }, 4000);
  }

  // ── Fiche d'une demande ───────────────────────────────────────────────────
  let dmCur = null;

  window.dmOuvrir = function (id) {
    const d = dmListe().find(function (x) { return x.id === id; }); if (!d) return;
    dmCur = id;
    dmMarquerLue(d); dmSave();
    const st = DM_STATUTS[d.statut] || DM_STATUTS.recu;
    const na = DM_NATURES[d.nature] || DM_NATURES.idee;
    const ge = DM_GENES[d.gene];
    const u = dmUser();
    const soutenu = u && Array.isArray(d.soutiens) && d.soutiens.indexOf(u.id) >= 0;
    const n = Array.isArray(d.soutiens) ? d.soutiens.length : 0;
    const admin = dmAdmin();

    let H = '<h3>Demande #' + (d.num || '?') + ' — ' + E(na.lbl) + '</h3>'
      + '<div style="font-size:.78rem;color:var(--gray-500);margin-bottom:1rem">'
      + E(d.auteurNom || '') + ' · ' + dmDate(d.ts)
      + (d.module ? ' · module ' + E(d.module) : '')
      + (d.version ? ' · version ' + E(String(d.version).slice(0, 7)) : '') + '</div>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:1rem">'
      + '<span class="dm-tag" style="background:' + st.bg + ';color:' + st.col + ';font-size:.78rem;padding:3px 11px">' + st.lbl + '</span>'
      + (ge ? '<span class="dm-tag" style="background:#fff;border:1px solid var(--gray-200);color:' + ge.col + ';font-size:.78rem;padding:3px 11px">' + ge.lbl + '</span>' : '')
      + '<span class="dm-moi' + (soutenu ? ' on' : '') + '" onclick="dmSoutenir(' + d.id + ')">'
      + (soutenu ? '★ Je soutiens' : '☆ Moi aussi') + (n ? ' · ' + n + ' vote' + (n > 1 ? 's' : '') : '') + '</span>'
      + '</div>'
      + '<div style="font-size:.93rem;line-height:1.5;white-space:pre-wrap">' + E(d.texte) + '</div>'
      + (d.image ? '<img src="' + d.image + '" class="dm-img">' : '');

    if (d.statut === 'refuse' && d.motif) {
      H += '<div style="margin-top:1rem;background:#FFEBEE;border:1px solid #ffcdd2;border-radius:10px;padding:11px 14px">'
        + '<div style="font-size:.72rem;font-weight:700;color:#C62828;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Pourquoi cette demande n’a pas été retenue</div>'
        + '<div style="font-size:.87rem;line-height:1.45;white-space:pre-wrap">' + E(d.motif) + '</div>'
        + (d.refusePar ? '<div style="font-size:.72rem;color:var(--gray-500);margin-top:6px">' + E(d.refusePar) + (d.refuseAt ? ' — ' + dmJour(d.refuseAt) : '') + '</div>' : '')
        + '</div>';
    }

    // ── Fil ──
    H += '<div class="dm-fil"><div style="font-size:.75rem;font-weight:700;color:var(--gray-500);text-transform:uppercase;letter-spacing:.6px;margin-bottom:.6rem">Échanges</div>';
    H += (Array.isArray(d.fil) && d.fil.length)
      ? d.fil.map(function (m) {
          return '<div class="dm-msg"><div class="qui">' + E(m.nom || m.uid) + ' · ' + dmDate(m.ts) + '</div>'
            + '<div class="txt">' + E(m.texte) + '</div></div>';
        }).join('')
      : '<div style="font-size:.83rem;color:var(--gray-500);margin-bottom:.6rem">Aucun échange pour l’instant.</div>';
    H += '<textarea class="dm-inp" id="dm-rep" placeholder="Répondre, préciser, poser une question…" style="min-height:70px"></textarea>'
      + '<button class="btn bs sm" style="margin-top:6px" onclick="dmRepondre(' + d.id + ')">Envoyer</button></div>';

    // ── Actions administrateur ──
    if (admin) {
      H += '<div style="margin-top:1.3rem;border-top:1px solid var(--gray-200);padding-top:1rem">'
        + '<div style="font-size:.75rem;font-weight:700;color:var(--gray-500);text-transform:uppercase;letter-spacing:.6px;margin-bottom:.6rem">Suite donnée</div>'
        + '<div class="dm-choix">'
        + Object.keys(DM_STATUTS).map(function (k) {
            return '<button' + (d.statut === k ? ' class="sel"' : '') + ' onclick="dmStatut(' + d.id + ',\'' + k + '\')">' + DM_STATUTS[k].lbl + '</button>';
          }).join('')
        + '</div>'
        + '<button class="btn bs sm" style="margin-top:.9rem" onclick="dmExport(' + d.id + ')">Préparer pour le développement</button>'
        + '</div>';
    }

    H += '<div class="dm-foot"><button class="btn bs" onclick="dmFermer()">Fermer</button>'
      + (admin || (u && d.auteur === u.id && d.statut === 'recu')
          ? '<button class="btn bd" onclick="dmSupprimer(' + d.id + ')">Supprimer</button>' : '')
      + '</div>';

    document.getElementById('dm-fiche').innerHTML = H;
    document.getElementById('dm-ov-fiche').classList.add('open');
    dmRender();
  };
  window.dmFermer = function () { document.getElementById('dm-ov-fiche').classList.remove('open'); dmCur = null; dmRender(); };

  window.dmSoutenir = function (id) {
    const d = dmListe().find(function (x) { return x.id === id; }); const u = dmUser();
    if (!d || !u) return;
    d.soutiens = Array.isArray(d.soutiens) ? d.soutiens : [];
    const i = d.soutiens.indexOf(u.id);
    if (i >= 0) d.soutiens.splice(i, 1); else d.soutiens.push(u.id);
    d.updatedAt = Date.now();   // pas majAt : un soutien n'a pas à sonner chez tout le monde
    dmSave(); dmOuvrir(id);
  };

  window.dmRepondre = function (id) {
    const d = dmListe().find(function (x) { return x.id === id; }); const u = dmUser();
    if (!d || !u) return;
    const t = (document.getElementById('dm-rep').value || '').trim(); if (!t) return;
    d.fil = Array.isArray(d.fil) ? d.fil : [];
    d.fil.push({ ts: Date.now(), uid: u.id, nom: dmNom(), texte: t });
    dmTouche(d); dmMarquerLue(d);
    dmSave();
    if (typeof logAction === 'function') logAction('Réponse à une demande', '#' + (d.num || ''));
    dmOuvrir(id);
  };

  window.dmStatut = function (id, st) {
    if (!dmAdmin()) { alert('Réservé aux administrateurs.'); return; }
    const d = dmListe().find(function (x) { return x.id === id; }); if (!d || !DM_STATUTS[st]) return;
    // Refuser en silence est ce qui tue une boîte à idées pour de bon : le motif
    // est donc exigé par le formulaire, pas seulement recommandé.
    if (st === 'refuse') {
      const m = prompt('Pourquoi cette demande n’est-elle pas retenue ?\n\nCe motif sera lu par son auteur et par l’équipe.', d.motif || '');
      if (m === null) return;
      if (!m.trim()) { alert('Un motif est nécessaire pour ne pas retenir une demande.'); return; }
      d.motif = m.trim();
      d.refusePar = dmNom(); d.refuseAt = Date.now();
    }
    if (d.statut === st) return;
    d.statut = st;
    d.fil = Array.isArray(d.fil) ? d.fil : [];
    d.fil.push({ ts: Date.now(), uid: (dmUser() || {}).id || '?', nom: dmNom(), texte: '— état : ' + DM_STATUTS[st].lbl + (st === 'refuse' ? ' (' + d.motif + ')' : '') });
    dmTouche(d); dmMarquerLue(d);
    dmSave();
    if (typeof logAction === 'function') logAction('Demande → ' + DM_STATUTS[st].lbl, '#' + (d.num || ''));
    dmOuvrir(id);
  };

  window.dmSupprimer = function (id) {
    const d = dmListe().find(function (x) { return x.id === id; }); if (!d) return;
    if (!confirm('Supprimer définitivement la demande #' + (d.num || '') + ' ?')) return;
    if (typeof markDeleted === 'function') markDeleted('demandes', id);
    const l = dmListe(), i = l.findIndex(function (x) { return x.id === id; });
    if (i >= 0) l.splice(i, 1);
    dmSave(); dmFermer(); dmRender();
  };

  // Produit un texte prêt à coller en début de session de développement : le
  // backlog alimente les séances sans avoir à tout réexpliquer.
  window.dmExport = function (id) {
    const d = dmListe().find(function (x) { return x.id === id; }); if (!d) return;
    const L = [];
    L.push('DEMANDE #' + (d.num || '') + ' — ' + (DM_NATURES[d.nature] || {}).lbl);
    L.push('Déposée par ' + (d.auteurNom || '') + ' le ' + dmDate(d.ts));
    if (d.module) L.push('Module : ' + d.module);
    if (d.gene) L.push('Gêne : ' + (DM_GENES[d.gene] || {}).lbl);
    if (d.version) L.push('Version vue : ' + d.version);
    const n = Array.isArray(d.soutiens) ? d.soutiens.length : 0;
    if (n) L.push('Soutenue par ' + n + ' personne(s)');
    L.push(''); L.push(d.texte); L.push('');
    if (Array.isArray(d.fil) && d.fil.length) {
      L.push('ÉCHANGES');
      d.fil.forEach(function (m) { L.push('- ' + (m.nom || m.uid) + ' : ' + m.texte); });
      L.push('');
    }
    if (d.image) L.push('(une capture d’écran est jointe à la demande dans l’intranet)');
    const t = L.join('\n');
    try { navigator.clipboard.writeText(t); dmToast('Copié — collez-le en début de session de développement.'); }
    catch (e) { prompt('Copiez ce texte :', t); }
  };

  // ── Fenêtres ──────────────────────────────────────────────────────────────
  const DM_MODALS = `
  <div class="dm-ov" id="dm-ov-form"><div class="dm-modal">
    <h3>Nouvelle demande</h3>
    <div style="font-size:.82rem;color:var(--gray-500);margin-bottom:1.1rem;line-height:1.5">
      Une anomalie, une idée, une question : tout se dit ici. Votre nom est joint pour qu’on puisse
      revenir vers vous, et vous serez prévenu dès que la demande avance.
    </div>
    <div class="dm-fg"><label>De quoi s’agit-il ?</label><div class="dm-choix">
      <button data-champ="nature" data-val="bug" onclick="dmChoix('nature','bug')">⚠ Ça ne marche pas</button>
      <button data-champ="nature" data-val="idee" onclick="dmChoix('nature','idee')">💡 J’aimerais que…</button>
      <button data-champ="nature" data-val="question" onclick="dmChoix('nature','question')">? Une question</button>
    </div></div>
    <div class="dm-fg"><label>En une phrase</label>
      <textarea class="dm-inp" id="dm-f-texte" placeholder="Ex. : quand je valide une livraison depuis le téléphone, le bouton reste gris et il faut recharger la page."></textarea></div>
    <div class="dm-fg"><label>À quel point cela vous gêne</label><div class="dm-choix">
      <button data-champ="gene" data-val="bloque" onclick="dmChoix('gene','bloque')">Ça me bloque</button>
      <button data-champ="gene" data-val="agace" onclick="dmChoix('gene','agace')">Ça m’agace</button>
      <button data-champ="gene" data-val="mieux" onclick="dmChoix('gene','mieux')">Ce serait mieux</button>
    </div></div>
    <div class="dm-fg"><label>Module concerné</label><input type="text" class="dm-inp" id="dm-f-module" placeholder="Rempli automatiquement"></div>
    <div class="dm-fg"><label>Capture d’écran (facultatif)</label>
      <input type="file" id="dm-f-img" accept="image/*" onchange="dmImage(this)" style="font-size:.85rem">
      <div style="font-size:.75rem;color:var(--gray-500);margin-top:5px;line-height:1.45">
        Très utile sur un défaut d’affichage. Ne capturez que la zone concernée : les demandes sont visibles
        par toute l’équipe, inutile d’y faire figurer des noms de patients.
      </div>
      <div id="dm-f-apercu"></div></div>
    <div class="dm-foot">
      <button class="btn bp" onclick="dmEnvoyer()">Envoyer la demande</button>
      <button class="btn bs" onclick="dmFermerForm()">Annuler</button>
    </div>
  </div></div>

  <div class="dm-ov" id="dm-ov-fiche"><div class="dm-modal" id="dm-fiche"></div></div>`;

  // ── Injection ─────────────────────────────────────────────────────────────
  function dmInject() {
    if (document.getElementById('dm-css')) return;
    const st = document.createElement('style'); st.id = 'dm-css'; st.textContent = DM_CSS;
    document.head.appendChild(st);

    const navRef = document.querySelector('.sb-item[data-sec="backoffice"]');
    if (navRef && !document.querySelector('.sb-item[data-sec="demandes"]')) {
      const b = document.createElement('button');
      b.className = 'sb-item'; b.setAttribute('data-sec', 'demandes');
      b.setAttribute('onclick', "showSec('demandes',this); if(window.dmRender) dmRender();");
      b.innerHTML = '<svg class="ico sb-ico"><use href="#ic-idee"></use></svg>'
        + '<span class="sb-label">Boîte à idées</span><span class="sb-badge" id="navb-dm"></span>';
      navRef.insertAdjacentElement('beforebegin', b);
    }
    const secRef = document.getElementById('sec-livraisons');
    if (secRef && !document.getElementById('sec-demandes')) {
      const sec = document.createElement('section');
      sec.id = 'sec-demandes'; sec.className = 'sec'; sec.innerHTML = DM_SECTION;
      secRef.parentNode.appendChild(sec);
      const w = document.createElement('div'); w.innerHTML = DM_MODALS;
      while (w.firstElementChild) document.body.appendChild(w.firstElementChild);
      dmRender();
    }
    // Fermeture au clic sur le fond, comme les autres fenêtres de l'appli.
    document.querySelectorAll('.dm-ov').forEach(function (o) {
      o.addEventListener('click', function (e) { if (e.target === o) o.classList.remove('open'); });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', dmInject);
  else dmInject();
  setTimeout(function () { try { dmInject(); dmRender(); } catch (e) {} }, 600);
})();
