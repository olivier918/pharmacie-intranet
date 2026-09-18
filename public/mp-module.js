/* ═══════════════════════════════════════════════════════════════════════════
   PILOT — Messagerie personnelle
   ---------------------------------------------------------------------------
   Messages adresses : a une personne ou a plusieurs, selon le sujet ou le
   projet. Distincte du Cahier de transmission, qui est un fil partage par
   toute l'equipe sur des sujets patient, medecin ou medicament.

   Deux collections : `convos` (qui parle avec qui) et `messages` (ce qui est
   dit). Les messages sont a part parce que dans un fil, deux personnes ecrivent
   en meme temps : une fusion au niveau de la conversation en perdrait un.

   Ce que l'outil ne fait pas : le secret. Les donnees de PILOT sont servies a
   tous les postes connectes ; un message est ADRESSE, il n'est pas chiffre.
   Decide avec Olivier, pour des echanges professionnels sans rien de sensible.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const E = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const mpUser = () => (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null;
  const mpStaff = () => (typeof staffDB !== 'undefined' && Array.isArray(staffDB)) ? staffDB : [];
  const mpConvos = () => (typeof convos !== 'undefined' && Array.isArray(convos)) ? convos : [];
  const mpMsgs = () => (typeof messages !== 'undefined' && Array.isArray(messages)) ? messages : [];
  const mpSave = (now) => {
    try {
      if (now && typeof saveNow === 'function') saveNow();
      else if (typeof schedSave === 'function') schedSave();
    } catch (e) {}
  };
  const pad = n => String(n).padStart(2, '0');

  function mpPrenom(id) {
    const s = mpStaff().find(x => x.id === id);
    return s ? (s.prenom || s.id) : (id || '?');
  }
  function mpCouleur(id) {
    const s = mpStaff().find(x => x.id === id);
    return (s && s.col) || '#6b7a72';
  }
  // Date relative : dans une liste de conversations, « 14:32 » et « hier » se
  // lisent d'un coup la ou une date complete demande un effort a chaque ligne.
  function mpQuand(ts) {
    if (!ts) return '';
    const d = new Date(ts), n = new Date();
    const jour = d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
    const auj = n.getFullYear() + '-' + n.getMonth() + '-' + n.getDate();
    if (jour === auj) return pad(d.getHours()) + ':' + pad(d.getMinutes());
    const hier = new Date(n.getTime() - 86400000);
    if (jour === hier.getFullYear() + '-' + hier.getMonth() + '-' + hier.getDate()) return 'hier';
    if (n - d < 7 * 86400000) return ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'][d.getDay()];
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  }
  function mpHeure(ts) { const d = new Date(ts); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }

  // ── Mise en forme ─────────────────────────────────────────────────────────
  // Le texte est ECHAPPE d'abord, puis on reintroduit deux balises et deux
  // seules. Faire l'inverse — accepter du HTML et tenter de le nettoyer —
  // c'est ouvrir une porte qu'on ne referme jamais completement.
  function mpFormat(t) {
    let h = E(t || '');
    h = h.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
    h = h.replace(/__([^_\n]+)__/g, '<u>$1</u>');
    return h.replace(/\n/g, '<br>');
  }

  const MP_EMOJIS = ['👍', '🙏', '😊', '😅', '🎉', '💊', '📦', '⚠️', '✅', '❓'];
  const MP_FICHIER_MAX = 8 * 1024 * 1024;

  // ── Qui voit quoi ─────────────────────────────────────────────────────────
  function mpMiennes() {
    const u = mpUser(); if (!u) return [];
    return mpConvos().filter(c => c && Array.isArray(c.membres) && c.membres.indexOf(u.id) >= 0);
  }
  function mpDeConvo(cid) {
    return mpMsgs().filter(m => m && m.convoId === cid).sort((a, b) => (a.ts || 0) - (b.ts || 0));
  }
  function mpDernier(cid) {
    const l = mpDeConvo(cid);
    return l.length ? l[l.length - 1] : null;
  }
  function mpNonLus(c) {
    const u = mpUser(); if (!u || !c) return 0;
    const vu = (c.vu && c.vu[u.id]) || 0;
    return mpMsgs().filter(m => m && m.convoId === c.id && (m.ts || 0) > vu && m.uid !== u.id).length;
  }
  window.mpTotalNonLus = function () {
    return mpMiennes().reduce((t, c) => t + mpNonLus(c), 0);
  };
  // Resume pour la page d'accueil. C'est la messagerie qui le fabrique, pas
  // l'accueil : dupliquer le calcul des non-lus et du dernier message ailleurs,
  // c'est se garantir deux comportements divergents a la premiere evolution.
  window.mpResume = function (max) {
    const u = mpUser(); if (!u) return [];
    return mpMiennes().map(function (c) {
      const d = mpDernier(c.id);
      return {
        id: c.id,
        titre: mpTitre(c),
        groupe: (c.membres || []).length > 2,
        auteur: d ? d.uid : null,
        moi: d ? (d.uid === u.id) : false,
        apercu: d ? (d.txt ? String(d.txt).replace(/[*_]/g, '')
                           : (d.fichier ? '📎 ' + (d.fichier.nom || 'fichier') : '')) : '',
        quand: d ? (d.ts || 0) : (c.ts || 0),
        nonLus: mpNonLus(c)
      };
    }).sort(function (a, b) { return b.quand - a.quand; }).slice(0, max || 4);
  };
  window.mpQuand = mpQuand;
  window.mpPrenom = mpPrenom;
  window.mpCouleur = mpCouleur;

  // Retrouve le groupe auquel une conversation est adressée : celui dont les
  // membres sont EXACTEMENT les destinataires choisis. Si l'on a ajouté ou
  // retiré quelqu'un après avoir cliqué sur le groupe, ce n'est plus lui — et
  // étiqueter « PDA » une conversation où quelqu'un d'extérieur lit serait un
  // mensonge, pas un raccourci.
  function mpGroupeDe(choisis, uid) {
    if (!Array.isArray(choisis) || choisis.length < 2) return null;
    const veut = choisis.slice().sort().join('|');
    return mpGroupes().find(function (g) {
      if (!g || !Array.isArray(g.membres)) return false;
      // Un groupe peut inclure celui qui écrit : il est dans la conversation
      // de toute façon, sa présence dans la liste ne change rien.
      const m = g.membres.filter(x => x !== uid);
      return m.length === choisis.length && m.slice().sort().join('|') === veut;
    }) || null;
  }
  window.mpGroupeDe = mpGroupeDe;

  function mpTitre(c) {
    const u = mpUser();
    if (c.titre) return c.titre;
    // Adressée à un groupe de l'officine : c'est le nom du groupe qui dit de
    // quoi il s'agit. « Marie, Claire, Julien, Paul, Sophie » n'apprend rien
    // et déborde dès la quatrième personne.
    if (c.groupeNom) return c.groupeNom;
    const autres = (c.membres || []).filter(x => x !== (u && u.id));
    if (!autres.length) return 'Moi';
    // Les conversations d'AVANT cette fonction n'ont pas de nom recopié. On le
    // retrouve à la lecture plutôt que d'écrire une migration : les postes ne
    // sont pas tous sur la même version, et une migration écrite se bat avec
    // elle-même à la fusion (piège n° 7). `groupeNom` à vide, lui, veut dire
    // « déjà cherché, ce n'est pas un groupe » : on ne recommence pas.
    if (c.groupeNom === undefined && autres.length > 1) {
      const g = mpGroupeDe(autres, u && u.id);
      if (g) return g.nom;
    }
    return autres.map(mpPrenom).join(', ');
  }

  // ── CSS ───────────────────────────────────────────────────────────────────
  const MP_CSS = `
  #sec-mp{padding:0}
  .mp-wrap{display:grid;grid-template-columns:minmax(0,300px) minmax(0,1fr);gap:16px;align-items:stretch;height:calc(100vh - 190px);min-height:420px}
  @media(max-width:820px){.mp-wrap{grid-template-columns:1fr;height:auto}.mp-vue-fil .mp-liste{display:none}.mp-vue-liste .mp-fil{display:none}}
  .mp-liste,.mp-fil{background:#fff;border:1px solid var(--gray-200);border-radius:14px;display:flex;flex-direction:column;overflow:hidden;min-height:0}
  .mp-h{padding:11px 15px;border-bottom:1px solid var(--gray-200);display:flex;align-items:center;gap:9px;font-size:.78rem;font-weight:800;text-transform:uppercase;letter-spacing:.8px;color:var(--gray-700);flex:none}
  .mp-h .ico{width:17px;height:17px}
  .mp-defile{overflow-y:auto;flex:1;min-height:0}
  .mp-c{display:flex;gap:11px;padding:11px 14px;border-bottom:1px solid var(--gray-200);cursor:pointer;align-items:flex-start;width:100%;text-align:left;background:none;border-left:none;border-right:none;border-top:none;font-family:inherit}
  .mp-c:hover{background:var(--gray-100)}
  .mp-c.sel{background:var(--g-pale)}
  .mp-pastille{width:34px;height:34px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:.76rem}
  .mp-c-txt{flex:1;min-width:0}
  .mp-c-t{font-weight:700;font-size:.87rem;color:var(--gray-900);display:flex;align-items:center;gap:7px}
  .mp-c-t .q{margin-left:auto;font-size:.7rem;color:var(--gray-500);font-weight:500;flex:none}
  .mp-c-a{font-size:.78rem;color:var(--gray-500);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px}
  .mp-n{background:var(--red);color:#fff;border-radius:10px;padding:0 7px;font-size:.7rem;font-weight:800;flex:none}
  .mp-msgs{overflow-y:auto;flex:1;min-height:0;padding:14px;display:flex;flex-direction:column;gap:9px;background:var(--gray-100)}
  .mp-m{max-width:74%;padding:8px 12px;border-radius:13px;background:#fff;border:1px solid var(--gray-200);align-self:flex-start}
  .mp-m.moi{align-self:flex-end;background:var(--g-pale);border-color:var(--g-border)}
  .mp-m-qui{font-size:.71rem;font-weight:800;margin-bottom:3px}
  .mp-m-txt{font-size:.88rem;line-height:1.45;white-space:pre-wrap;word-break:break-word}
  .mp-m-q{font-size:.68rem;color:var(--gray-500);text-align:right;margin-top:3px}
  .mp-m-ed{font-style:italic}
  .mp-m{position:relative}
  /* A COTE de la bulle, jamais dessus : pose au-dessus, la pastille recouvrait
     la premiere ligne du message — on masquait le texte qu'on vient corriger. */
  .mp-m-act{position:absolute;top:50%;transform:translateY(-50%);display:flex;gap:2px;background:#fff;
    border:1px solid var(--gray-200);border-radius:20px;padding:2px;box-shadow:0 2px 8px rgba(0,0,0,.10);
    opacity:0;transition:opacity .12s;left:calc(100% + 6px)}
  .mp-m.moi .mp-m-act{left:auto;right:calc(100% + 6px)}
  .mp-m:hover .mp-m-act,.mp-m:focus-within .mp-m-act{opacity:1}
  /* Sur un ecran tactile il n'y a pas de survol : les boutons restent la. */
  @media(hover:none){.mp-m-act{opacity:1}}
  .mp-m-act button{border:none;background:none;color:var(--gray-500);cursor:pointer;
    padding:4px 6px;border-radius:50%;display:inline-flex;align-items:center}
  .mp-m-act button:hover{background:var(--gray-100);color:var(--g-dark)}
  /* En modification, la bulle s'elargit : une zone de saisie a la largeur du
     texte d'origine ne laisse pas la place de le reecrire. */
  .mp-m.edit{max-width:92%;width:420px}
  .mp-m-ed-z{display:flex;flex-direction:column;gap:6px}
  .mp-m-ed-z textarea{font:inherit;font-size:.88rem;border:1px solid var(--g-border);border-radius:9px;
    padding:7px 9px;resize:vertical;min-height:58px;width:100%;box-sizing:border-box}
  .mp-m-ed-a{display:flex;gap:6px;justify-content:flex-end}
  .mp-m-f{display:flex;align-items:center;gap:8px;margin-top:6px;padding:7px 10px;background:var(--gray-100);border-radius:9px;font-size:.79rem;text-decoration:none;color:var(--g-dark);font-weight:600}
  .mp-m-f:hover{background:var(--gray-200)}
  .mp-m-img{max-width:100%;border-radius:9px;margin-top:6px;display:block;cursor:pointer}
  .mp-jour{align-self:center;font-size:.71rem;color:var(--gray-500);background:#fff;border:1px solid var(--gray-200);border-radius:20px;padding:2px 12px;margin:4px 0}
  .mp-ecrire{border-top:1px solid var(--gray-200);padding:10px 12px;flex:none;background:#fff}
  .mp-outils{display:flex;gap:5px;align-items:center;margin-bottom:7px;flex-wrap:wrap}
  .mp-outils button{border:1px solid var(--gray-200);background:#fff;border-radius:8px;padding:3px 9px;font-size:.8rem;cursor:pointer;font-family:inherit;color:var(--gray-700);line-height:1.5}
  .mp-outils button:hover{border-color:var(--g-border);background:var(--g-pale)}
  .mp-outils .emo{padding:3px 6px;font-size:.95rem}
  .mp-saisie{display:flex;gap:8px;align-items:flex-end}
  .mp-saisie textarea{flex:1;min-width:0;border:1px solid var(--gray-200);border-radius:11px;padding:9px 12px;font-family:inherit;font-size:.88rem;resize:none;max-height:130px;color:var(--gray-900)}
  .mp-piece{font-size:.78rem;color:var(--gray-500);margin-top:6px;display:flex;align-items:center;gap:8px}
  .mp-vide{padding:2.2rem 1rem;text-align:center;color:var(--gray-500);font-size:.85rem;line-height:1.6}
  .mp-membres{font-size:.72rem;color:var(--gray-500);font-weight:500;text-transform:none;letter-spacing:0}
  /* Grille a cases EGALES. L'ancienne version alignait des etiquettes de
     largeurs differentes au fil du texte : autant de lignes bancales, et un
     oeil qui ne sait plus ou se poser. Une grille se parcourt. */
  .mp-choix{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:8px}
  .mp-choix label{display:flex;flex-direction:column;align-items:center;gap:6px;border:1px solid var(--gray-200);
    border-radius:11px;padding:11px 6px;cursor:pointer;font-size:.8rem;font-weight:600;color:var(--gray-700);
    text-align:center;line-height:1.25;position:relative;transition:border-color .12s,background .12s}
  .mp-choix label:hover{border-color:var(--g-border)}
  .mp-choix label.on{background:var(--g-pale);border-color:var(--g-dark);color:var(--g-dark);box-shadow:inset 0 0 0 1px var(--g-dark)}
  .mp-choix input{position:absolute;opacity:0;pointer-events:none}
  .mp-lot.mp-lot-neuf{border-style:dashed;color:var(--g-dark);font-weight:700}
  .mp-lot.mp-lot-neuf:hover{border-style:solid;background:var(--g-pale)}
  .mp-choix .coche{position:absolute;top:5px;right:6px;font-size:.72rem;color:var(--g-dark);opacity:0}
  .mp-choix label.on .coche{opacity:1}
  /* Groupes et postes : des pastilles, pas des cases — on clique pour ajouter,
     pas pour cocher un etat. */
  .mp-lots{display:flex;flex-wrap:wrap;gap:7px}
  .mp-lot{border:1px solid var(--gray-200);background:#fff;border-radius:999px;padding:6px 13px;font-size:.81rem;
    font-weight:700;cursor:pointer;font-family:inherit;color:var(--gray-700);display:inline-flex;align-items:center;gap:7px}
  .mp-lot:hover{border-color:var(--g-border);background:var(--g-pale);color:var(--g-dark)}
  .mp-lot .n{opacity:.6;font-weight:600}
  .mp-lot .x{opacity:.45;font-weight:700}
  /* Les deux raccourcis se tiennent dans un meme encadre : ils repondent a la
     meme question — « a qui ? » — et se lisent ensemble. */
  .mp-raccourcis{border:1px solid var(--gray-200);border-radius:12px;padding:.9rem 1rem;
    background:#fbfcfb;margin-bottom:1rem}
  .mp-fac{font-weight:500;text-transform:none;letter-spacing:0;color:var(--gray-500);font-size:.72rem}
  .mp-lot .x:hover{opacity:1;color:var(--red)}
  /* La ligne de comptage devient une barre d'etat : elle porte le nombre
     choisi et les deux gestes qui s'y rapportent, au lieu de flotter sous la
     grille comme une note de bas de page. */
  .mp-compte{font-size:.81rem;color:var(--gray-600);margin-top:.7rem;display:flex;align-items:center;
    gap:9px;flex-wrap:wrap;background:var(--gray-100);border-radius:9px;padding:.5rem .75rem}
  .mp-compte b{color:var(--g-dark)}
  .mp-compte span:first-child{flex:1;min-width:0}
  .mp-compte button{border:1px solid var(--gray-200);background:#fff;border-radius:7px;padding:3px 10px;
    font-family:inherit;font-size:.78rem;font-weight:600;color:var(--gray-700);cursor:pointer}
  .mp-compte button:hover{border-color:var(--g-border);background:var(--g-pale);color:var(--g-dark)}
  .mp-retour{display:none;border:none;background:none;font-family:inherit;font-size:.8rem;color:var(--g-dark);font-weight:700;cursor:pointer;padding:0}
  @media(max-width:820px){.mp-retour{display:inline}}
  `;

  const MP_SECTION = `
  <div class="stitle"><svg class="ico"><use href="#ic-messagerie"></use></svg> Messagerie</div>
  <div class="mp-wrap mp-vue-liste" id="mp-wrap">
    <div class="mp-liste">
      <div class="mp-h"><svg class="ico"><use href="#ic-collaborateurs"></use></svg> Conversations
        <button class="btn bp sm" style="margin-left:auto" onclick="mpNouvelle()">+ Nouvelle</button></div>
      <div class="mp-defile" id="mp-liste"></div>
    </div>
    <div class="mp-fil">
      <div class="mp-h" id="mp-fil-h"><span>Choisissez une conversation</span></div>
      <div class="mp-msgs" id="mp-msgs"></div>
      <div class="mp-ecrire" id="mp-ecrire" style="display:none">
        <div class="mp-outils">
          <button onclick="mpEntoure('**')" title="Gras"><b>G</b></button>
          <button onclick="mpEntoure('__')" title="Souligné"><u>S</u></button>
          <span style="width:1px;height:18px;background:var(--gray-200)"></span>
          ${MP_EMOJIS.map(e => '<button class="emo" onclick="mpEmoji(\'' + e + '\')">' + e + '</button>').join('')}
          <span style="flex:1"></span>
          <button onclick="document.getElementById('mp-f').click()" title="Joindre un fichier">📎 Joindre</button>
          <input type="file" id="mp-f" style="display:none" accept="image/*,application/pdf" onchange="mpFichier(this)">
        </div>
        <div class="mp-saisie">
          <textarea id="mp-txt" rows="1" placeholder="Votre message…"
            oninput="mpGrandir(this)" onkeydown="mpTouche(event)"></textarea>
          <button class="btn bp" onclick="mpEnvoyer()"><svg class="ico"><use href="#ic-envoyer"></use></svg></button>
        </div>
        <div class="mp-piece" id="mp-piece"></div>
      </div>
    </div>
  </div>`;

  // ── Rendu ─────────────────────────────────────────────────────────────────
  let mpCourante = null;   // id de la conversation ouverte
  let mpPiece = null;      // fichier joint en attente

  window.mpRender = function () {
    if (!document.getElementById('sec-mp')) return;
    mpRendListe();
    mpRendFil();
    if (typeof updateNavBadges === 'function') updateNavBadges();
  };

  function mpRendListe() {
    const el = document.getElementById('mp-liste'); if (!el) return;
    const u = mpUser();
    const l = mpMiennes().map(function (c) {
      const d = mpDernier(c.id);
      return { c: c, d: d, quand: d ? (d.ts || 0) : (c.ts || 0) };
    }).sort((a, b) => b.quand - a.quand);

    if (!l.length) {
      el.innerHTML = '<div class="mp-vide">Aucune conversation.<br>'
        + '« Nouvelle » pour écrire à quelqu’un.</div>';
      return;
    }
    el.innerHTML = l.map(function (x) {
      const c = x.c, n = mpNonLus(c);
      const autres = (c.membres || []).filter(y => y !== (u && u.id));
      const seul = autres.length === 1;
      const etiq = c.titre || c.groupeNom;
      const ini = etiq ? etiq.slice(0, 2).toUpperCase()
        : (seul ? autres[0] : (autres.length + 1) + '');
      const fond = seul ? mpCouleur(autres[0]) : '#6b7a72';
      const apercu = x.d
        ? ((x.d.uid === (u && u.id) ? 'Vous : ' : (c.membres.length > 2 ? mpPrenom(x.d.uid) + ' : ' : ''))
           + (x.d.txt ? x.d.txt.replace(/[*_]/g, '') : (x.d.fichier ? '📎 ' + (x.d.fichier.nom || 'fichier') : '')))
        : 'Aucun message';
      return '<button class="mp-c' + (mpCourante === c.id ? ' sel' : '') + '"'
        + (autres.length > 1 ? ' title="' + E(autres.map(mpPrenom).join(', ')) + '"' : '')
        + ' onclick="mpOuvrir(' + c.id + ')">'
        + '<span class="mp-pastille" style="background:' + fond + '">' + E(ini) + '</span>'
        + '<span class="mp-c-txt">'
        + '<span class="mp-c-t">' + E(mpTitre(c))
        + (n ? '<span class="mp-n">' + n + '</span>' : '')
        + '<span class="q">' + mpQuand(x.quand) + '</span></span>'
        + '<span class="mp-c-a">' + E(apercu.slice(0, 60)) + '</span>'
        + '</span></button>';
    }).join('');
  }

  function mpRendFil() {
    const h = document.getElementById('mp-fil-h');
    const z = document.getElementById('mp-msgs');
    const e = document.getElementById('mp-ecrire');
    if (!h || !z) return;
    const u = mpUser();
    const c = mpCourante ? mpConvos().find(x => x.id === mpCourante) : null;
    if (!c) {
      h.innerHTML = '<span>Choisissez une conversation</span>';
      z.innerHTML = '<div class="mp-vide">Vos messages apparaîtront ici.</div>';
      if (e) e.style.display = 'none';
      return;
    }
    const autres = (c.membres || []).filter(x => x !== (u && u.id));
    h.innerHTML = '<button class="mp-retour" onclick="mpFermerFil()">‹ Retour</button>'
      + '<span>' + E(mpTitre(c)) + '</span>'
      + (c.membres.length > 2
          ? '<span class="mp-membres">' + E(autres.map(mpPrenom).join(', ')) + '</span>' : '')
      + '<button class="btn bs sm" style="margin-left:auto" onclick="mpQuitter(' + c.id + ')">Quitter</button>';
    if (e) e.style.display = '';

    const l = mpDeConvo(c.id);
    if (!l.length) {
      z.innerHTML = '<div class="mp-vide">Rien encore. À vous d’écrire.</div>';
      return;
    }
    let jour = '';
    z.innerHTML = l.map(function (m) {
      const d = new Date(m.ts || 0);
      const j = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
      let sep = '';
      if (j !== jour) { jour = j; sep = '<div class="mp-jour">' + E(j) + '</div>'; }
      const moi = m.uid === (u && u.id);
      const f = m.fichier;
      const estImg = f && /^image\//.test(f.type || '');
      return sep + '<div class="mp-m' + (moi ? ' moi' : '') + (m.id === mpEdite ? ' edit' : '') + '">'
        + (!moi && c.membres.length > 2
            ? '<div class="mp-m-qui" style="color:' + mpCouleur(m.uid) + '">' + E(mpPrenom(m.uid)) + '</div>' : '')
        + (m.id === mpEdite
            ? '<div class="mp-m-ed-z"><textarea id="mp-ed-txt" onkeydown="mpToucheEdit(event)">'
              + E(m.txt || '') + '</textarea><div class="mp-m-ed-a">'
              + '<button class="btn bs sm" onclick="mpAnnulerEdit()">Annuler</button>'
              + '<button class="btn bp sm" onclick="mpEnregistrerEdit()">Enregistrer</button></div></div>'
            : (m.txt ? '<div class="mp-m-txt">' + mpFormat(m.txt) + '</div>' : ''))
        + (f ? (estImg
            ? '<img class="mp-m-img" src="/api/images/' + E(f.id) + '" onclick="window.open(\'/api/images/' + E(f.id) + '\')">'
            : '<a class="mp-m-f" href="/api/images/' + E(f.id) + '" target="_blank" rel="noopener">📎 ' + E(f.nom || 'Fichier') + '</a>')
          : '')
        + '<div class="mp-m-q">'
        +   (m.editeLe ? '<span class="mp-m-ed" title="Ce message a été modifié">modifié</span> · ' : '')
        +   mpHeure(m.ts) + '</div>'
        + (mpPeutToucher(m) && m.id !== mpEdite
            ? '<div class="mp-m-act no-print">'
              + '<button title="Modifier" onclick="mpModifier(' + m.id + ')">'
              +   '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"'
              +   ' stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'
              +   '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></button>'
              + '<button title="Supprimer" onclick="mpSupprimer(' + m.id + ')">'
              +   '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"'
              +   ' stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'
              +   '<path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M6.5 7l1 13h9l1-13"/></svg></button>'
              + '</div>'
            : '')
        + (window.rxBarre ? window.rxBarre('msg', m.id) : '')
        + '</div>';
    }).join('');
    z.scrollTop = z.scrollHeight;
    mpMarquerLu(c);
  }

  // ── Modifier, supprimer ───────────────────────────────────────────────────
  //
  // QUI. L'auteur du message, et un administrateur. Un administrateur parce
  // qu'il faut pouvoir retirer une betise le jour ou son auteur est en conge,
  // et que quelqu'un doit repondre de ce qui traine dans l'outil.
  //
  // SUPPRIMER EFFACE POUR DE BON — c'est le choix retenu, contre l'usage des
  // messageries qui laissent « message supprime ». La contrepartie est reelle
  // et il faut la connaitre : un fil relu plus tard peut devenir incomprehensible
  // sans que rien ne dise qu'il manque quelque chose. En echange, ce qui est
  // efface l'est vraiment, chez tout le monde.
  //
  // LA PIERRE TOMBALE EST OBLIGATOIRE. Sans elle, un poste en retard d'une
  // resynchronisation renverrait le message a la fusion suivante, et il
  // reapparaitrait. Les reactions posees dessus partent avec lui : orphelines,
  // elles se rattacheraient a un identifiant qui n'existe plus.
  function mpPeutToucher(m) {
    const u = mpUser();
    if (!u || !m) return false;
    return m.uid === u.id || mpAdmin();
  }
  window.mpPeutToucher = mpPeutToucher;

  // Les reactions d'UN message de la messagerie. Le canal compte autant que
  // l'identifiant : le cahier de transmission pose les siennes sous 'th', et un
  // identifiant numerique peut exister des deux cotes. Filtrer sur le seul
  // identifiant effacerait les reactions d'un message du cahier.
  function mpRxDuMessage(l, id) {
    return (l || []).filter(function (r) {
      return r && r.c === 'msg' && String(r.r) === String(id);
    });
  }
  window.mpRxDuMessage = mpRxDuMessage;

  let mpEdite = null;
  window.mpModifier = function (id) {
    const m = mpMsgs().find(x => x && x.id === id);
    if (!m || !mpPeutToucher(m)) return;
    if (!m.txt) { alert('Un message qui ne porte qu’une pièce jointe ne se modifie pas — supprimez-le et renvoyez-la.'); return; }
    mpEdite = id;
    mpRendFil();
    const t = document.getElementById('mp-ed-txt');
    if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); }
  };
  window.mpAnnulerEdit = function () { mpEdite = null; mpRendFil(); };
  window.mpEnregistrerEdit = function () {
    const m = mpMsgs().find(x => x && x.id === mpEdite);
    const t = document.getElementById('mp-ed-txt');
    if (!m || !t || !mpPeutToucher(m)) { mpEdite = null; mpRendFil(); return; }
    const v = String(t.value || '').trim();
    if (!v) { alert('Un message vide se supprime, il ne s’enregistre pas.'); return; }
    if (v !== m.txt) {
      m.txt = v.slice(0, 4000);
      m.editeLe = Date.now();
      m.editePar = (mpUser() || {}).id || null;
      m.updatedAt = Date.now();
      if (typeof logAction === 'function') logAction('Message modifié (messagerie)', '');
      mpSave(true);
    }
    mpEdite = null;
    mpRendFil();
  };
  // Entree enregistre, Maj+Entree passe a la ligne : le meme geste que la
  // zone d'ecriture juste en dessous.
  window.mpToucheEdit = function (ev) {
    if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); window.mpEnregistrerEdit(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); window.mpAnnulerEdit(); }
  };

  window.mpSupprimer = function (id) {
    const l = mpMsgs();
    const i = l.findIndex(x => x && x.id === id);
    if (i < 0 || !mpPeutToucher(l[i])) return;
    if (!confirm('Supprimer ce message ?\n\nIl disparaîtra pour tout le monde, définitivement.')) return;
    if (typeof markDeleted === 'function') markDeleted('messages', id);
    l.splice(i, 1);
    // Les reactions posees dessus n'ont plus de cible.
    if (typeof reactions !== 'undefined' && Array.isArray(reactions)) {
      mpRxDuMessage(reactions, id).forEach(function (r) {
        if (typeof markDeleted === 'function') markDeleted('reactions', r.id);
        const k = reactions.indexOf(r);
        if (k >= 0) reactions.splice(k, 1);
      });
    }
    if (mpEdite === id) mpEdite = null;
    if (typeof logAction === 'function') logAction('Message supprimé (messagerie)', '');
    mpSave(true);
    mpRender();
  };

  // Marquer lu SANS toucher a updatedAt : la conversation elle-meme n'a pas
  // change, et deux personnes qui lisent en meme temps s'ecraseraient l'une
  // l'autre a la fusion.
  function mpMarquerLu(c) {
    const u = mpUser(); if (!u || !c) return;
    const d = mpDernier(c.id); if (!d) return;
    c.vu = c.vu || {};
    if (c.vu[u.id] === d.ts) return;
    c.vu[u.id] = d.ts;
    mpSave();
    mpRendListe();
    if (typeof updateNavBadges === 'function') updateNavBadges();
  }

  window.mpOuvrir = function (id) {
    mpCourante = id;
    const w = document.getElementById('mp-wrap');
    if (w) { w.classList.remove('mp-vue-liste'); w.classList.add('mp-vue-fil'); }
    mpRender();
    const t = document.getElementById('mp-txt'); if (t && window.innerWidth > 820) t.focus();
  };
  window.mpFermerFil = function () {
    const w = document.getElementById('mp-wrap');
    if (w) { w.classList.remove('mp-vue-fil'); w.classList.add('mp-vue-liste'); }
  };

  // ── Écrire ────────────────────────────────────────────────────────────────
  window.mpGrandir = function (t) {
    t.style.height = 'auto';
    t.style.height = Math.min(t.scrollHeight, 130) + 'px';
  };
  window.mpTouche = function (ev) {
    // Entrée envoie, Maj+Entrée passe à la ligne — la convention que tout le
    // monde connaît déjà.
    if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); mpEnvoyer(); }
  };
  window.mpEntoure = function (marque) {
    const t = document.getElementById('mp-txt'); if (!t) return;
    const a = t.selectionStart, b = t.selectionEnd, v = t.value;
    const sel = v.slice(a, b) || 'texte';
    t.value = v.slice(0, a) + marque + sel + marque + v.slice(b);
    t.focus();
    t.setSelectionRange(a + marque.length, a + marque.length + sel.length);
    mpGrandir(t);
  };
  window.mpEmoji = function (e) {
    const t = document.getElementById('mp-txt'); if (!t) return;
    const a = t.selectionStart, v = t.value;
    t.value = v.slice(0, a) + e + v.slice(t.selectionEnd);
    t.focus(); t.setSelectionRange(a + e.length, a + e.length);
    mpGrandir(t);
  };
  window.mpFichier = function (inp) {
    const f = inp.files && inp.files[0]; if (!f) return;
    if (f.size > MP_FICHIER_MAX) {
      alert('Ce fichier pèse ' + (f.size / 1024 / 1024).toFixed(1) + ' Mo, au-delà de la limite de 8 Mo.');
      inp.value = ''; return;
    }
    const lec = new FileReader();
    lec.onload = function (ev) {
      mpPiece = { dataUrl: ev.target.result, nom: f.name, type: f.type, taille: f.size };
      document.getElementById('mp-piece').innerHTML =
        '📎 ' + E(f.name) + ' (' + Math.round(f.size / 1024) + ' Ko) · '
        + '<span style="cursor:pointer;text-decoration:underline" onclick="mpRetirerPiece()">retirer</span>';
    };
    lec.onerror = function () { alert('Lecture du fichier impossible.'); inp.value = ''; };
    lec.readAsDataURL(f);
  };
  window.mpRetirerPiece = function () {
    mpPiece = null;
    const p = document.getElementById('mp-piece'); if (p) p.innerHTML = '';
    const f = document.getElementById('mp-f'); if (f) f.value = '';
  };

  window.mpEnvoyer = async function () {
    const u = mpUser(); if (!u) { alert('Identifiez-vous avec votre code PIN.'); return; }
    const c = mpConvos().find(x => x.id === mpCourante); if (!c) return;
    const t = document.getElementById('mp-txt');
    const txt = (t.value || '').trim();
    if (!txt && !mpPiece) return;

    // Le fichier part AVANT le message : si le dépôt échoue, rien n'est
    // enregistré, plutôt qu'un message renvoyant à une pièce jointe absente.
    let fichier = null;
    if (mpPiece) {
      const m = String(mpPiece.dataUrl).match(/^data:([^;]+);base64,(.+)$/);
      if (!m) { alert('Fichier illisible.'); return; }
      try {
        const r = await fetch('/api/images', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mime: m[1], data: m[2] }) });
        const j = await r.json().catch(() => null);
        if (!r.ok || !j || !j.ok) { alert('Pièce jointe refusée : ' + ((j && j.error) || ('erreur ' + r.status))); return; }
        fichier = { id: j.id, nom: mpPiece.nom, type: mpPiece.type, taille: mpPiece.taille };
      } catch (e) { alert('Pièce jointe : serveur injoignable.'); return; }
    }

    const now = Date.now();
    mpMsgs().push({ id: now, convoId: c.id, ts: now, uid: u.id, txt: txt, fichier: fichier, updatedAt: now });
    c.vu = c.vu || {}; c.vu[u.id] = now;
    t.value = ''; mpGrandir(t); mpRetirerPiece();
    mpSave(true);
    mpRender();
  };

  // ── Nouvelle conversation ─────────────────────────────────────────────────
  const mpGroupes = () => (typeof groupesMsg !== 'undefined' && Array.isArray(groupesMsg)) ? groupesMsg : [];

  window.mpNouvelle = function () {
    const u = mpUser(); if (!u) { alert('Identifiez-vous avec votre code PIN.'); return; }
    const autres = mpStaff().filter(s => s.id !== u.id);
    if (!autres.length) { alert('Aucun autre collaborateur enregistré.'); return; }
    document.getElementById('mp-n-titre').value = '';
    document.getElementById('mp-n-qui').innerHTML = autres.map(function (s) {
      return '<label onclick="setTimeout(mpMajChoix,0)">'
        + '<input type="checkbox" value="' + E(s.id) + '">'
        + '<span class="coche">✓</span>'
        + '<span class="mp-pastille" style="background:' + (s.col || '#6b7a72') + '">' + E(s.id) + '</span>'
        + E(s.prenom || s.id) + '</label>';
    }).join('');
    mpRendLots();
    mpMajChoix();
    document.getElementById('mp-ov-n').classList.add('open');
  };

  // Deux façons d'ajouter plusieurs personnes d'un coup. Les POSTES sont
  // gratuits : ils existent déjà dans les fiches collaborateurs. Les GROUPES
  // sont ceux de l'officine — Comptoir, Logistique — qui ne recoupent aucun
  // poste et qu'il faut donc composer à la main, une fois pour toutes.
  function mpRendLots() {
    const u = mpUser(); if (!u) return;
    const autres = mpStaff().filter(s => s.id !== u.id);

    const parPoste = {};
    autres.forEach(function (s) {
      const p = (s.poste || '').trim(); if (!p) return;
      (parPoste[p] = parPoste[p] || []).push(s.id);
    });
    const zp = document.getElementById('mp-n-postes');
    if (zp) {
      const cles = Object.keys(parPoste).sort();
      zp.innerHTML = cles.length
        ? cles.map(function (p) {
            return '<button class="mp-lot" onclick="mpAjouterLot(\'' + E(p).replace(/'/g, '&#39;') + '\')">'
              + E(p) + '<span class="n">' + parPoste[p].length + '</span></button>';
          }).join('')
        : '<span style="font-size:.8rem;color:var(--gray-500)">Aucun poste renseigné.</span>';
    }
    mpPostesCache = parPoste;

    const zg = document.getElementById('mp-n-groupes');
    if (zg) {
      const g = mpGroupes();
      zg.innerHTML = (g.length
        ? g.map(function (x) {
            const dispo = (x.membres || []).filter(m => m !== u.id).length;
            return '<button class="mp-lot" onclick="mpAjouterGroupe(' + x.id + ')">'
              + E(x.nom) + '<span class="n">' + dispo + '</span>'
              + (mpAdmin() ? '<span class="x" onclick="event.stopPropagation();mpFormGroupe(' + x.id + ')" title="Modifier ce groupe">✎</span>' : '')
              + '</button>';
          }).join('')
        : '<span style="font-size:.8rem;color:var(--gray-500)">Aucun groupe pour l’instant.</span>')
        // Un bouton TOUJOURS visible : la creation n'apparaissait qu'une fois
        // deux personnes cochees, dans une ligne de comptage. Personne ne l'a
        // jamais trouvee — une fonction introuvable n'existe pas.
        + (mpAdmin() ? '<button class="mp-lot mp-lot-neuf" onclick="mpFormGroupe(null)">＋ Nouveau groupe</button>' : '');
    }
  }
  let mpPostesCache = {};
  const mpAdmin = () => (typeof isAdmin === 'function') ? isAdmin() : false;

  function mpCases() { return [].slice.call(document.querySelectorAll('#mp-n-qui input')); }
  function mpCocher(ids) {
    const set = {}; (ids || []).forEach(i => { set[i] = 1; });
    mpCases().forEach(function (c) { if (set[c.value]) c.checked = true; });
    mpMajChoix();
  }
  window.mpAjouterLot = function (poste) { mpCocher(mpPostesCache[poste] || []); };
  window.mpAjouterGroupe = function (id) {
    const g = mpGroupes().find(x => x.id === id); if (!g) return;
    mpCocher(g.membres || []);
  };
  window.mpToutDecocher = function () {
    mpCases().forEach(function (c) { c.checked = false; });
    mpMajChoix();
  };
  // ── Composer un groupe ──────────────────────────────────────────────────
  // Un groupe est une liste de l'officine — PDA, oncologie, comptoir — qui ne
  // recoupe aucun poste. Il se compose une fois, et sert ensuite a tous.
  //
  // Il peut contenir SON AUTEUR. C'etait le defaut de la premiere version : la
  // liste des cases excluait la personne connectee (on ne s'ecrit pas a
  // soi-meme), et un groupe « PDA » compose par le pharmacien responsable ne
  // contenait donc pas le pharmacien responsable. Quand quelqu'un d'autre s'en
  // servait ensuite, il manquait precisement la personne concernee.
  let mpGrpEdit = null;
  window.mpFormGroupe = function (id) {
    if (!mpAdmin()) { alert('Seuls les administrateurs composent les groupes.'); return; }
    mpGrpEdit = id || null;
    const g = id ? mpGroupes().find(x => x.id === id) : null;
    const membres = g ? (g.membres || []) : mpCases().filter(c => c.checked).map(c => c.value);
    document.getElementById('mp-g-h').textContent = g ? 'Modifier le groupe' : 'Nouveau groupe de destinataires';
    document.getElementById('mp-g-nom').value = g ? (g.nom || '') : '';
    document.getElementById('mp-g-supr').style.display = g ? '' : 'none';
    document.getElementById('mp-g-qui').innerHTML = mpStaff().map(function (s) {
      const on = membres.indexOf(s.id) >= 0;
      return '<label' + (on ? ' class="on"' : '') + ' onclick="setTimeout(mpGrpMaj,0)">'
        + '<input type="checkbox" value="' + E(s.id) + '"' + (on ? ' checked' : '') + '>'
        + '<span class="coche">✓</span>'
        + '<span class="mp-pastille" style="background:' + (s.col || '#6b7a72') + '">' + E(s.id) + '</span>'
        + E(s.prenom || s.id) + '</label>';
    }).join('');
    mpGrpMaj();
    document.getElementById('mp-ov-g').classList.add('open');
  };
  window.mpGrpMaj = function () {
    const cases = [].slice.call(document.querySelectorAll('#mp-g-qui input'));
    cases.forEach(function (c) { c.closest('label').classList.toggle('on', c.checked); });
    const n = cases.filter(c => c.checked).length;
    const z = document.getElementById('mp-g-compte');
    if (z) z.textContent = n ? n + ' personne' + (n > 1 ? 's' : '') + ' dans ce groupe' : 'Personne de sélectionné.';
  };
  window.mpFermerGroupe = function () { document.getElementById('mp-ov-g').classList.remove('open'); mpGrpEdit = null; };
  window.mpEnregistrerGroupe = function () {
    const nom = (document.getElementById('mp-g-nom').value || '').trim();
    const choisis = [].slice.call(document.querySelectorAll('#mp-g-qui input:checked')).map(c => c.value);
    if (!nom) { alert('Donnez un nom au groupe (ex. PDA, Oncologie, Comptoir).'); return; }
    if (choisis.length < 2) { alert('Un groupe compte au moins deux personnes.'); return; }
    const now = Date.now();
    if (mpGrpEdit) {
      const g = mpGroupes().find(x => x.id === mpGrpEdit);
      if (g) { g.nom = nom.slice(0, 30); g.membres = choisis; g.updatedAt = now; }
    } else {
      mpGroupes().push({ id: now, nom: nom.slice(0, 30), membres: choisis, par: (mpUser() || {}).id, updatedAt: now });
      if (typeof logAction === 'function') logAction('Groupe de destinataires créé', nom);
    }
    mpFermerGroupe(); mpSave(true); mpRendLots();
  };
  window.mpSupprimerGroupeForm = function () {
    if (!mpGrpEdit) return;
    const id = mpGrpEdit; mpFermerGroupe(); mpSupprimerGroupe(id);
  };

  window.mpSupprimerGroupe = function (id) {
    if (!mpAdmin()) return;
    const l = mpGroupes(), i = l.findIndex(x => x.id === id); if (i < 0) return;
    if (!confirm('Supprimer le groupe « ' + l[i].nom + ' » ?\n\nLes conversations déjà créées ne changent pas.')) return;
    if (typeof markDeleted === 'function') markDeleted('groupesMsg', id);
    l.splice(i, 1);
    mpSave(true); mpRendLots();
  };

  window.mpMajChoix = function () {
    const cases = mpCases();
    cases.forEach(i => i.parentNode.classList.toggle('on', i.checked));
    const n = cases.filter(i => i.checked).length;
    // Le titre ne sert qu'a un groupe : a deux, le nom de l'autre suffit.
    document.getElementById('mp-n-titre-bloc').style.display = n > 1 ? '' : 'none';
    const z = document.getElementById('mp-n-compte');
    if (z) {
      z.innerHTML = n
        ? '<span><b>' + n + '</b> personne' + (n > 1 ? 's' : '') + ' sélectionnée' + (n > 1 ? 's' : '') + '</span>'
          + '<button onclick="mpToutDecocher()">tout décocher</button>'
          + (n > 1 && mpAdmin() ? '<button onclick="mpFormGroupe(null)">en faire un groupe</button>' : '')
        : '<span>Personne de sélectionné.</span>';
    }
  };
  window.mpFermerNouvelle = function () { document.getElementById('mp-ov-n').classList.remove('open'); };
  window.mpCreer = function () {
    const u = mpUser(); if (!u) return;
    const choisis = [].slice.call(document.querySelectorAll('#mp-n-qui input:checked')).map(i => i.value);
    if (!choisis.length) { alert('Choisissez au moins une personne.'); return; }
    const membres = [u.id].concat(choisis);
    const titre = choisis.length > 1 ? (document.getElementById('mp-n-titre').value || '').trim().slice(0, 50) : '';

    // A deux, on ne cree pas un second fil avec la meme personne : on rouvre
    // celui qui existe. Sinon l'historique se disperse en doublons.
    if (choisis.length === 1) {
      const deja = mpConvos().find(function (c) {
        return c && !c.titre && Array.isArray(c.membres) && c.membres.length === 2
          && c.membres.indexOf(u.id) >= 0 && c.membres.indexOf(choisis[0]) >= 0;
      });
      if (deja) { mpFermerNouvelle(); mpOuvrir(deja.id); return; }
    }
    // Le nom du groupe n'est retenu QUE si l'on n'a pas écrit de titre à la
    // main et qu'on dépasse deux personnes : à deux, le nom de l'autre reste
    // plus clair que « PDA ».
    const grp = (!titre && choisis.length > 1) ? mpGroupeDe(choisis, u.id) : null;
    const now = Date.now();
    const vu = {}; vu[u.id] = now;
    // Le nom est recopié, pas seulement référencé : un groupe renommé ou
    // supprimé ne doit pas réécrire l'en-tête d'une conversation déjà tenue.
    // C'est ce que promet déjà la suppression d'un groupe.
    mpConvos().unshift({ id: now, ts: now, par: u.id, membres: membres, titre: titre,
      groupeId: grp ? grp.id : null, groupeNom: grp ? grp.nom : '', vu: vu, updatedAt: now });
    mpFermerNouvelle();
    mpSave(true);
    mpOuvrir(now);
    if (typeof logAction === 'function') logAction('Conversation créée', membres.length + ' participants');
  };
  window.mpQuitter = function (id) {
    const u = mpUser(); if (!u) return;
    const c = mpConvos().find(x => x.id === id); if (!c) return;
    if (!confirm('Quitter « ' + mpTitre(c) + ' » ?\n\nVous ne verrez plus cette conversation. Les autres la conservent.')) return;
    c.membres = (c.membres || []).filter(x => x !== u.id);
    c.updatedAt = Date.now();
    // Plus personne dedans : la conversation et ses messages n'ont plus de
    // lecteur possible, on les retire pour de bon.
    if (!c.membres.length) {
      if (typeof markDeleted === 'function') markDeleted('convos', c.id);
      const lc = mpConvos(), i = lc.findIndex(x => x.id === c.id);
      if (i >= 0) lc.splice(i, 1);
      const lm = mpMsgs();
      for (let k = lm.length - 1; k >= 0; k--) {
        if (lm[k] && lm[k].convoId === id) {
          if (typeof markDeleted === 'function') markDeleted('messages', lm[k].id);
          lm.splice(k, 1);
        }
      }
    }
    mpCourante = null;
    mpSave(true); mpFermerFil(); mpRender();
  };

  const MP_MODALE_G = '<div class="overlay" id="mp-ov-g">'
    + '<div class="mbox" style="max-width:560px">'
    + '<div class="mbox-h"><b id="mp-g-h">Nouveau groupe de destinataires</b>'
    + '<button class="x" onclick="mpFermerGroupe()">✕</button></div>'
    + '<div class="mbox-b">'
    + '<div class="fg"><label>Nom du groupe</label>'
    + '<input type="text" id="mp-g-nom" maxlength="30" placeholder="Ex. PDA, Oncologie, Comptoir"></div>'
    + '<div class="fg"><label>Qui en fait partie</label><div class="mp-choix" id="mp-g-qui"></div>'
    + '<div class="mp-compte" id="mp-g-compte"></div></div>'
    + '<div style="font-size:.76rem;color:var(--gray-500);line-height:1.5">'
    + 'Le groupe sert à composer une conversation en un clic. Vous pouvez vous y inclure : '
    + 'il servira aussi à vos collègues, et c’est souvent vous qu’ils voudront joindre.</div>'
    + '</div>'
    + '<div class="mbox-f"><button class="btn bp" onclick="mpEnregistrerGroupe()">Enregistrer</button>'
    + '<button class="btn bs" onclick="mpFermerGroupe()">Annuler</button>'
    + '<span style="flex:1"></span>'
    + '<button class="btn bs" id="mp-g-supr" style="color:#C62828" onclick="mpSupprimerGroupeForm()">Supprimer</button></div>'
    + '</div></div>';

  const MP_MODALE = '<div class="overlay" id="mp-ov-n">'
    + '<div class="mbox" style="max-width:620px">'
    + '<div class="mbox-h"><b>Nouveau message</b><button class="x" onclick="mpFermerNouvelle()" title="Fermer">✕</button></div>'
    + '<div class="mbox-b">'
    // Deux raccourcis d'abord, la liste complete ensuite : on compose presque
    // toujours avec un groupe ou un poste, et rarement personne par personne.
    + '<div class="mp-raccourcis">'
    + '<div class="fg"><label>Groupes de l’officine</label><div class="mp-lots" id="mp-n-groupes"></div></div>'
    + '<div class="fg" style="margin-bottom:0"><label>Par poste</label><div class="mp-lots" id="mp-n-postes"></div></div>'
    + '</div>'
    + '<div class="fg"><label>Ou choisir une à une</label><div class="mp-choix" id="mp-n-qui"></div>'
    + '<div class="mp-compte" id="mp-n-compte"></div></div>'
    + '<div class="fg" id="mp-n-titre-bloc" style="display:none"><label>Nom de la conversation <span class="mp-fac">facultatif</span></label>'
    + '<input type="text" id="mp-n-titre" maxlength="50" placeholder="Ex. Préparation de la vitrine"></div>'
    + '</div>'
    + '<div class="mbox-f"><button class="btn bp" onclick="mpCreer()">Ouvrir la conversation</button>'
    + '<button class="btn bs" onclick="mpFermerNouvelle()">Annuler</button></div>'
    + '</div></div>';

  // ── Injection ─────────────────────────────────────────────────────────────
  function mpInstaller() {
    if (document.getElementById('sec-mp')) return;

    const st = document.createElement('style'); st.textContent = MP_CSS;
    document.head.appendChild(st);

    // Juste apres le Cahier de transmission : les deux se ressemblent assez
    // pour qu'on les cherche au meme endroit.
    const ref = document.querySelector('.sb-item[data-sec="messagerie"]');
    if (ref && !document.querySelector('.sb-item[data-sec="mp"]')) {
      const b = document.createElement('button');
      b.className = 'sb-item'; b.setAttribute('data-sec', 'mp');
      b.setAttribute('onclick', "showSec('mp',this); if(window.mpRender) mpRender();");
      b.innerHTML = '<svg class="ico sb-ico"><use href="#ic-amical"></use></svg>'
        + '<span class="sb-label">Messagerie</span><span class="sb-badge" id="navb-mp"></span>';
      ref.parentNode.insertBefore(b, ref.nextSibling);
    }

    const sref = document.querySelector('.sec');
    if (sref) {
      const sec = document.createElement('section');
      sec.id = 'sec-mp'; sec.className = 'sec'; sec.innerHTML = MP_SECTION;
      sref.parentNode.insertBefore(sec, sref);
    }
    [MP_MODALE, MP_MODALE_G].forEach(function (h) {
      const m = document.createElement('div'); m.innerHTML = h;
      if (m.firstElementChild) document.body.appendChild(m.firstElementChild);
    });

    if (typeof SEC_LABEL === 'object' && SEC_LABEL) SEC_LABEL.mp = 'Messagerie';
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mpInstaller);
  else mpInstaller();
})();
