/* ═══════════════════════════════════════════════════════════════════════════
   PILOT — Page d'accueil
   ---------------------------------------------------------------------------
   Point d'entree de l'intranet : ce qui compte aujourd'hui, et de quoi donner
   envie d'ouvrir l'outil. Le module s'injecte comme les autres (bouton en tete
   de barre laterale + section), sans toucher au corps de index.html.

   Cadrage : projet Claude, « Cahier des charges — Page d'accueil PILOT ».
   Deux ecarts assumes, decides avec Olivier :
   - le « cahier de transmission » EST la messagerie existante (fils partages
     sur des sujets patient / medecin / medicament) ; il n'y a rien a creer ;
   - la messagerie individuelle, adressee, n'existe pas encore : son bloc est
     retire de l'accueil tant que le module n'est pas ecrit.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const E = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const acUser = () => (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null;
  const acAdmin = () => (typeof isAdmin === 'function') ? isAdmin() : false;
  const acStaff = () => (typeof staffDB !== 'undefined' && Array.isArray(staffDB)) ? staffDB : [];
  const acTodos = () => (typeof todoPerso !== 'undefined' && Array.isArray(todoPerso)) ? todoPerso : [];
  const acMoments = () => (typeof moments !== 'undefined' && Array.isArray(moments)) ? moments : [];
  const acAgenda = () => (typeof agenda !== 'undefined' && Array.isArray(agenda)) ? agenda : [];
  const acFils = () => (typeof threads !== 'undefined' && Array.isArray(threads)) ? threads : [];
  const acSave = (now) => {
    try {
      if (now && typeof saveNow === 'function') saveNow();
      else if (typeof schedSave === 'function') schedSave();
    } catch (e) {}
  };

  // Calendrier LOCAL, jamais toISOString() : sur une date a minuit, la
  // conversion UTC renvoie la veille en heure de Paris.
  const pad = n => String(n).padStart(2, '0');
  function acIso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function acMoisJour(d) { return pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet',
    'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const MOIS_CT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.',
    'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  const JOURS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

  const AC_MOMENT_JOURS = 7;     // duree de vie d'un moment
  const AC_MOMENT_MAX   = 6;     // nombre de moments affiches
  const AC_MOMENT_PX    = 640;   // largeur des photos : le blob est deja lourd
  const AC_MOMENT_Q     = 0.6;

  function acNom(id) {
    const s = acStaff().find(x => x.id === id);
    return s ? ((s.prenom || '') + ' ' + (s.nom || '')).trim() : (id || '');
  }
  function acPrenom(id) {
    const s = acStaff().find(x => x.id === id);
    return s ? (s.prenom || s.id) : (id || '');
  }

  // ── CSS ───────────────────────────────────────────────────────────────────
  const AC_CSS = `
  #sec-accueil{padding:0}
  .ac-hello{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:18px}
  .ac-hello h2{font-size:1.5rem;font-weight:800;color:var(--gray-900);margin:0}
  .ac-hello .d{font-size:.86rem;color:var(--gray-500)}
  .ac-grid{display:grid;gap:16px;align-items:start}
  .ac-2{grid-template-columns:minmax(0,1fr) minmax(0,1.6fr)}
  .ac-2e{grid-template-columns:repeat(2,minmax(0,1fr))}
  @media(max-width:900px){.ac-2,.ac-2e{grid-template-columns:1fr}}
  .ac-card{background:#fff;border:1px solid var(--gray-200);border-radius:14px;overflow:hidden;margin-bottom:16px}
  .ac-h{padding:11px 16px;border-bottom:1px solid var(--gray-200);display:flex;align-items:center;gap:9px;font-size:.78rem;font-weight:800;text-transform:uppercase;letter-spacing:.8px;color:var(--gray-700)}
  .ac-h .ico{width:17px;height:17px;flex:none}
  .ac-n{margin-left:auto;background:var(--gray-100);color:var(--gray-700);border-radius:10px;padding:1px 9px;font-size:.72rem;letter-spacing:0;font-weight:700}
  .ac-b{padding:14px 16px}
  .ac-vide{padding:1.3rem 1rem;text-align:center;color:var(--gray-500);font-size:.83rem}
  .ac-lien{padding:9px 16px;border-top:1px solid var(--gray-200);background:var(--gray-100);text-align:center}
  .ac-lien button{background:none;border:none;color:var(--g-dark);font-weight:700;font-size:.82rem;cursor:pointer;font-family:inherit}
  .ac-anniv{background:linear-gradient(135deg,#FCE4EC 0%,#F8BBD0 100%);border-color:#F48FB1}
  .ac-anniv .ac-h{border-bottom-color:rgba(0,0,0,.07);color:#AD1457}
  .ac-anniv-n{font-size:1.15rem;font-weight:800;color:#880E4F;margin-bottom:2px}
  .ac-anniv-d{font-size:.82rem;color:#AD1457}
  .ac-fete{font-size:1.7rem;line-height:1}
  .ac-mom-piste{display:flex;gap:12px;overflow-x:auto;scroll-behavior:smooth;padding:2px 2px 8px;scroll-snap-type:x mandatory}
  .ac-mom{flex:0 0 210px;scroll-snap-align:start;border:1px solid var(--gray-200);border-radius:12px;overflow:hidden;background:var(--gray-100)}
  .ac-mom-img{height:120px;background-size:cover;background-position:center}
  .ac-mom-txt{padding:9px 11px}
  .ac-mom-t{font-weight:700;font-size:.83rem;color:var(--gray-900);line-height:1.3}
  .ac-mom-s{font-size:.78rem;color:var(--gray-700);font-style:italic;margin-top:3px;line-height:1.35}
  .ac-mom-m{font-size:.7rem;color:var(--gray-500);margin-top:6px;display:flex;align-items:center;gap:7px}
  .ac-coeur{cursor:pointer;border:none;background:none;font-size:.72rem;font-weight:700;color:var(--gray-500);padding:0;font-family:inherit}
  .ac-coeur.on{color:#E91E63}
  .ac-dots{display:flex;gap:6px;justify-content:center;margin-top:4px}
  .ac-dot{width:7px;height:7px;border-radius:50%;background:var(--gray-300);border:none;padding:0;cursor:pointer}
  .ac-dot.on{background:var(--g-dark)}
  .ac-alertes{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px}
  .ac-al{display:flex;align-items:center;gap:8px;background:#fff;border:1px solid var(--gray-200);border-radius:11px;padding:9px 14px;font-size:.85rem;font-weight:600;color:var(--gray-700);cursor:pointer;font-family:inherit}
  .ac-al:hover{border-color:var(--g-border)}
  .ac-pt{width:8px;height:8px;border-radius:50%;background:var(--red);flex:none}
  .ac-al.calme{color:var(--gray-500);font-weight:500}
  .ac-al.calme .ac-pt{background:#66BB6A}
  .ac-fil{display:block;width:100%;text-align:left;border:none;font-family:inherit;border-left:3px solid var(--gray-300);padding:9px 13px;margin-bottom:8px;border-radius:0 9px 9px 0;background:var(--gray-100);cursor:pointer}
  .ac-fil:hover{background:#eef1ef}
  .ac-fil.muet{border-left-color:#C62828}
  .ac-fil.repondu{border-left-color:#2E7D32}
  .ac-fil-t{font-weight:700;font-size:.88rem;color:var(--gray-900);display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .ac-tag{border-radius:9px;padding:1px 8px;font-size:.67rem;font-weight:700}
  .ac-fil-s{font-size:.76rem;color:var(--gray-500);margin-top:3px}
  .ac-rac{display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:10px}
  .ac-rac button{display:flex;flex-direction:column;align-items:center;gap:6px;padding:14px 8px;border:1px solid var(--gray-200);background:#fff;border-radius:12px;cursor:pointer;font-family:inherit;font-size:.79rem;font-weight:700;color:var(--gray-700);line-height:1.25;text-align:center}
  .ac-rac button:hover{border-color:var(--g-border);background:var(--g-pale);color:var(--g-dark)}
  .ac-rac .ico{width:21px;height:21px}
  .ac-td{display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid var(--gray-200)}
  .ac-td:last-child{border-bottom:none}
  .ac-td input{width:18px;height:18px;margin-top:1px;flex:none;cursor:pointer}
  .ac-td-t{font-size:.87rem;color:var(--gray-900);line-height:1.35}
  .ac-td-e{font-size:.74rem;color:var(--gray-500);margin-left:6px}
  .ac-td-e.tard{color:var(--red);font-weight:700}
  .ac-ajout{display:flex;gap:8px;margin-top:11px;flex-wrap:wrap}
  .ac-inp{border:1px solid var(--gray-200);border-radius:9px;padding:8px 11px;font-size:.85rem;font-family:inherit;background:#fff;color:var(--gray-900)}
  #ac-td-txt{flex:1;min-width:120px}
  .ac-li{display:flex;align-items:baseline;gap:10px;padding:7px 0;border-bottom:1px solid var(--gray-200);font-size:.86rem}
  .ac-li:last-child{border-bottom:none}
  .ac-li .q{font-weight:800;color:var(--g-dark);flex:none;min-width:62px}
  .ac-li .t{color:var(--gray-900)}
  .ac-li.passe{opacity:.45}
  `;

  // ── Squelette de la section ───────────────────────────────────────────────
  const AC_SECTION = `
  <div class="ac-hello">
    <h2 id="ac-bonjour">Bonjour</h2>
    <span class="d" id="ac-date"></span>
  </div>
  <div class="ac-grid ac-2">
    <div class="ac-card" id="ac-anniv-c">
      <div class="ac-h"><svg class="ico"><use href="#ic-anniversaire"></use></svg> Anniversaire du jour</div>
      <div class="ac-b" id="ac-anniv"></div>
    </div>
    <div class="ac-card">
      <div class="ac-h"><svg class="ico"><use href="#ic-amical"></use></svg> Moments de l’équipe
        <span class="ac-n" id="ac-mom-n">0</span></div>
      <div class="ac-b">
        <div class="ac-mom-piste" id="ac-mom-piste"></div>
        <div class="ac-dots" id="ac-mom-dots"></div>
      </div>
      <div class="ac-lien"><button onclick="acFormMoment()">+ Partager un moment</button></div>
    </div>
  </div>

  <div class="ac-alertes" id="ac-alertes"></div>

  <div class="ac-card">
    <div class="ac-h"><svg class="ico"><use href="#ic-livre"></use></svg> Cahier de transmission
      <span class="ac-n" id="ac-fils-n">0</span></div>
    <div class="ac-b" id="ac-fils"></div>
    <div class="ac-lien"><button onclick="showSec('messagerie')">Ouvrir le cahier complet</button></div>
  </div>

  <div class="ac-grid ac-2e">
    <div class="ac-card">
      <div class="ac-h"><svg class="ico"><use href="#ic-valider"></use></svg> Ma todo
        <span class="ac-n" id="ac-td-n">0</span></div>
      <div class="ac-b">
        <div id="ac-todos"></div>
        <div class="ac-ajout">
          <input type="text" class="ac-inp" id="ac-td-txt" placeholder="Une tâche à ne pas oublier…"
                 onkeydown="if(event.key==='Enter')acAjouterTodo()">
          <input type="time" class="ac-inp" id="ac-td-h" style="max-width:104px" title="Échéance (facultative)">
          <button class="btn bp sm" onclick="acAjouterTodo()">Ajouter</button>
        </div>
      </div>
    </div>
    <div class="ac-card">
      <div class="ac-h"><svg class="ico"><use href="#ic-realisation"></use></svg> Raccourcis</div>
      <div class="ac-b"><div class="ac-rac" id="ac-rac"></div></div>
    </div>
  </div>

  <div class="ac-grid ac-2e">
    <div class="ac-card">
      <div class="ac-h"><svg class="ico"><use href="#ic-calendrier"></use></svg> Rendez-vous du mois</div>
      <div class="ac-b" id="ac-agenda"></div>
      <div class="ac-lien" id="ac-agenda-add"></div>
    </div>
    <div class="ac-card">
      <div class="ac-h"><svg class="ico"><use href="#ic-anniversaire"></use></svg> Anniversaires du mois</div>
      <div class="ac-b" id="ac-annivs"></div>
    </div>
  </div>`;

  // ── Raccourcis ────────────────────────────────────────────────────────────
  // Les cibles sont les vraies sections de l'application. Un raccourci qui
  // pointe dans le vide est pire que pas de raccourci.
  const AC_RACCOURCIS = [
    { sec: 'livraisons',     ico: 'ic-livraison',      lbl: 'Livraisons' },
    { sec: 'messagerie',     ico: 'ic-livre',          lbl: 'Cahier de transmission' },
    { sec: 'preparations',   ico: 'ic-realisation',    lbl: 'Préparations' },
    { sec: 'credits',        ico: 'ic-euro',           lbl: 'Crédits' },
    { sec: 'renouvellement', ico: 'ic-renouvellement', lbl: 'Renouvellements' },
    { sec: 'demandes',       ico: 'ic-idee',           lbl: 'Boîte à idées' }
  ];

  // ── Rendu ─────────────────────────────────────────────────────────────────
  window.acRender = function () {
    if (!document.getElementById('sec-accueil')) return;
    const u = acUser();
    const n = new Date();
    const b = document.getElementById('ac-bonjour');
    if (b) b.textContent = (n.getHours() < 18 ? 'Bonjour ' : 'Bonsoir ') + (u ? acPrenom(u.id) : '');
    const d = document.getElementById('ac-date');
    if (d) d.textContent = n.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    acRendAnniv(n);
    acRendMoments();
    acRendAlertes();
    acRendFils();
    acRendTodos();
    acRendRaccourcis();
    acRendAgenda(n);
    acRendAnnivsMois(n);
  };

  function acRendAnniv(n) {
    const el = document.getElementById('ac-anniv'); if (!el) return;
    const carte = document.getElementById('ac-anniv-c');
    const md = acMoisJour(n);
    const qui = acStaff().filter(s => s.anniv === md);
    if (!qui.length) {
      if (carte) carte.classList.remove('ac-anniv');
      el.innerHTML = '<div style="font-size:.85rem;color:var(--gray-500)">Personne ne fête son anniversaire aujourd’hui.</div>';
      return;
    }
    if (carte) carte.classList.add('ac-anniv');
    el.innerHTML = '<div style="display:flex;align-items:flex-start;gap:12px"><div style="flex:1">'
      + qui.map(s => '<div class="ac-anniv-n">' + E((s.prenom || '') + ' ' + (s.nom || '')) + '</div>').join('')
      + '<div class="ac-anniv-d">' + n.getDate() + ' ' + MOIS[n.getMonth()] + '</div></div>'
      + '<span class="ac-fete">🎉</span></div>';
  }

  // ── Moments ───────────────────────────────────────────────────────────────
  function acVivants() {
    const n = Date.now();
    return acMoments()
      .filter(m => m && (!m.expiresAt || m.expiresAt > n))
      .sort((a, b) => (b.ts || 0) - (a.ts || 0))
      .slice(0, AC_MOMENT_MAX);
  }
  function acRendMoments() {
    const el = document.getElementById('ac-mom-piste'); if (!el) return;
    const l = acVivants(), u = acUser();
    document.getElementById('ac-mom-n').textContent = l.length;
    if (!l.length) {
      el.innerHTML = '<div class="ac-vide" style="flex:1">Rien de partagé cette semaine. À vous de commencer.</div>';
      document.getElementById('ac-mom-dots').innerHTML = '';
      return;
    }
    el.innerHTML = l.map(function (m) {
      const aime = !!(u && Array.isArray(m.likes) && m.likes.indexOf(u.id) >= 0);
      const nb = Array.isArray(m.likes) ? m.likes.length : 0;
      return '<div class="ac-mom">'
        + (m.image
            ? '<div class="ac-mom-img" style="background-image:url(\'' + m.image + '\')"></div>'
            : '<div class="ac-mom-img" style="background:linear-gradient(135deg,var(--g-pale),#cfe3d6)"></div>')
        + '<div class="ac-mom-txt">'
        + (m.titre ? '<div class="ac-mom-t">' + E(m.titre) + '</div>' : '')
        + (m.texte ? '<div class="ac-mom-s">' + E(m.texte) + '</div>' : '')
        + '<div class="ac-mom-m"><span>' + E(m.auteurNom || acNom(m.auteur)) + '</span>'
        + '<button class="ac-coeur' + (aime ? ' on' : '') + '" onclick="acAimer(' + m.id + ')">'
        + (aime ? '♥' : '♡') + (nb ? ' ' + nb : '') + '</button>'
        + (u && (m.auteur === u.id || acAdmin())
            ? '<button class="ac-coeur" style="margin-left:auto" onclick="acRetirerMoment(' + m.id + ')" title="Retirer">✕</button>' : '')
        + '</div></div></div>';
    }).join('');
    document.getElementById('ac-mom-dots').innerHTML = l.length > 1
      ? l.map((m, i) => '<button class="ac-dot' + (i === 0 ? ' on' : '') + '" onclick="acGlisser(' + i + ')"></button>').join('')
      : '';
  }
  window.acGlisser = function (i) {
    const p = document.getElementById('ac-mom-piste'); if (!p || !p.children.length) return;
    p.scrollLeft = (p.children[0].offsetWidth + 12) * i;
    [].forEach.call(document.querySelectorAll('#ac-mom-dots .ac-dot'), (d, k) => d.classList.toggle('on', k === i));
  };
  window.acAimer = function (id) {
    const u = acUser(); if (!u) return;
    const m = acMoments().find(x => x.id === id); if (!m) return;
    m.likes = Array.isArray(m.likes) ? m.likes : [];
    const i = m.likes.indexOf(u.id);
    if (i >= 0) m.likes.splice(i, 1); else m.likes.push(u.id);
    m.updatedAt = Date.now();
    acSave(); acRendMoments();
  };
  window.acRetirerMoment = function (id) {
    const u = acUser(); if (!u) return;
    const l = acMoments(), i = l.findIndex(x => x.id === id);
    if (i < 0) return;
    if (l[i].auteur !== u.id && !acAdmin()) { alert('Seul l’auteur peut retirer son moment.'); return; }
    if (!confirm('Retirer ce moment ?')) return;
    if (typeof markDeleted === 'function') markDeleted('moments', id);
    l.splice(i, 1);
    acSave(true); acRendMoments();
  };

  // ── Alertes ───────────────────────────────────────────────────────────────
  function acRendAlertes() {
    const el = document.getElementById('ac-alertes'); if (!el) return;
    const parts = [];
    const muets = acFils().filter(t => t && t.status !== 'closed' && !(Array.isArray(t.msgs) && t.msgs.length)).length;
    parts.push(muets
      ? '<button class="ac-al" onclick="showSec(\'messagerie\')"><span class="ac-pt"></span>'
        + muets + ' transmission' + (muets > 1 ? 's' : '') + ' sans réponse</button>'
      : '<span class="ac-al calme"><span class="ac-pt"></span>Aucune transmission en attente</span>');
    if (typeof credits !== 'undefined' && Array.isArray(credits) && typeof CRED_FOLLOWUP_DAYS !== 'undefined') {
      const lim = Date.now() - CRED_FOLLOWUP_DAYS * 86400000;
      const rel = credits.filter(function (c) {
        if (!c || c.statut !== 'en cours') return false;
        const r = Array.isArray(c.relances) && c.relances.length ? c.relances[c.relances.length - 1] : null;
        const t = r ? new Date(r.date).getTime() : new Date(c.dateAvance || 0).getTime();
        return t && t < lim;
      }).length;
      if (rel) parts.push('<button class="ac-al" onclick="showSec(\'credits\')"><span class="ac-pt"></span>'
        + rel + ' crédit' + (rel > 1 ? 's' : '') + ' à relancer</button>');
    }
    el.innerHTML = parts.join('');
  }

  // ── Cahier de transmission ────────────────────────────────────────────────
  function acRendFils() {
    const el = document.getElementById('ac-fils'); if (!el) return;
    const l = acFils().filter(t => t && t.status !== 'closed')
      .sort((a, b) => (b.id || 0) - (a.id || 0)).slice(0, 5);
    document.getElementById('ac-fils-n').textContent = l.length;
    if (!l.length) { el.innerHTML = '<div class="ac-vide">Aucune transmission en cours.</div>'; return; }
    el.innerHTML = l.map(function (t) {
      const rep = Array.isArray(t.msgs) && t.msgs.length;
      const dern = rep ? t.msgs[t.msgs.length - 1] : null;
      const apercu = dern ? String(dern.txt || dern.texte || dern.msg || '') : '';
      return '<button class="ac-fil ' + (rep ? 'repondu' : 'muet') + '" onclick="acOuvrirFil(' + t.id + ')">'
        + '<div class="ac-fil-t">' + E(t.subj || '(sans sujet)')
        + '<span class="ac-tag" style="' + (rep ? 'background:#E8F5E9;color:#2E7D32' : 'background:#FFEBEE;color:#C62828') + '">'
        + (rep ? 'Répondu' : 'Sans réponse') + '</span></div>'
        + '<div class="ac-fil-s">' + E(t.type || '')
        + (t.patient && t.patient.med ? ' · ' + E(t.patient.med) : '')
        + (apercu ? ' · ' + E(apercu.slice(0, 60)) : '')
        + '</div></button>';
    }).join('');
  }
  window.acOuvrirFil = function (id) {
    showSec('messagerie');
    if (typeof openThread === 'function') { try { openThread(id); } catch (e) {} }
  };

  // ── Todo ──────────────────────────────────────────────────────────────────
  function acMesTodos() {
    const u = acUser(); if (!u) return [];
    return acTodos().filter(t => t && t.auteur === u.id && !t.fait)
      .sort((a, b) => (a.dueAt || Infinity) - (b.dueAt || Infinity) || (a.ts || 0) - (b.ts || 0));
  }
  function acRendTodos() {
    const el = document.getElementById('ac-todos'); if (!el) return;
    const l = acMesTodos();
    document.getElementById('ac-td-n').textContent = l.length;
    if (!l.length) { el.innerHTML = '<div class="ac-vide">Rien à faire d’ici ce soir.</div>'; return; }
    const n = Date.now();
    el.innerHTML = l.map(function (t) {
      const tard = t.dueAt && t.dueAt < n;
      const h = t.dueAt ? new Date(t.dueAt) : null;
      return '<label class="ac-td"><input type="checkbox" onchange="acCocher(' + t.id + ')">'
        + '<span class="ac-td-t">' + E(t.texte || '')
        + (h ? '<span class="ac-td-e' + (tard ? ' tard' : '') + '">' + pad(h.getHours()) + ':' + pad(h.getMinutes()) + '</span>' : '')
        + '</span></label>';
    }).join('');
  }
  window.acAjouterTodo = function () {
    const u = acUser(); if (!u) { alert('Identifiez-vous avec votre code PIN.'); return; }
    const i = document.getElementById('ac-td-txt');
    const texte = (i.value || '').trim();
    if (!texte) return;
    const hh = (document.getElementById('ac-td-h') || {}).value || '';
    let dueAt = 0;
    if (/^\d{2}:\d{2}$/.test(hh)) {
      const d = new Date(); d.setHours(+hh.slice(0, 2), +hh.slice(3, 5), 0, 0);
      dueAt = d.getTime();
    }
    const now = Date.now();
    acTodos().unshift({ id: now, ts: now, auteur: u.id, texte: texte, dueAt: dueAt, fait: false, updatedAt: now });
    i.value = ''; const e = document.getElementById('ac-td-h'); if (e) e.value = '';
    acSave(true); acRendTodos();
  };
  window.acCocher = function (id) {
    const t = acTodos().find(x => x.id === id); if (!t) return;
    // La tache cochee sort de la liste mais reste en base : une suppression se
    // propagerait mal entre postes, et on veut pouvoir dire qui a fait quoi.
    t.fait = true; t.faitAt = Date.now(); t.updatedAt = Date.now();
    acSave(true); acRendTodos();
  };

  // ── Raccourcis ────────────────────────────────────────────────────────────
  function acRendRaccourcis() {
    const el = document.getElementById('ac-rac'); if (!el) return;
    // On n'affiche que les modules reellement presents pour cet operateur : un
    // raccourci vers un module masque par son poste serait une impasse.
    el.innerHTML = AC_RACCOURCIS.filter(function (r) {
      const b = document.querySelector('.sb-item[data-sec="' + r.sec + '"]');
      return b && b.style.display !== 'none';
    }).map(function (r) {
      return '<button onclick="showSec(\'' + r.sec + '\')">'
        + '<svg class="ico"><use href="#' + r.ico + '"></use></svg>' + E(r.lbl) + '</button>';
    }).join('');
  }

  // ── Agenda ────────────────────────────────────────────────────────────────
  function acRendAgenda(n) {
    const el = document.getElementById('ac-agenda'); if (!el) return;
    const add = document.getElementById('ac-agenda-add');
    if (add) add.innerHTML = acAdmin() ? '<button onclick="acFormRdv()">+ Ajouter un rendez-vous</button>' : '';
    const mois = acIso(n).slice(0, 7), auj = acIso(n);
    const l = acAgenda().filter(r => r && String(r.date || '').slice(0, 7) === mois)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.h || '').localeCompare(String(b.h || '')));
    if (!l.length) { el.innerHTML = '<div class="ac-vide">Rien de prévu ce mois-ci.</div>'; return; }
    el.innerHTML = l.map(function (r) {
      const d = new Date(r.date + 'T12:00:00');
      return '<div class="ac-li' + (r.date < auj ? ' passe' : '') + '">'
        + '<span class="q">' + JOURS[d.getDay()] + ' ' + d.getDate() + '</span>'
        + '<span class="t">' + E(r.titre || '') + (r.h ? ' · ' + E(r.h) : '') + '</span>'
        + (acAdmin() ? '<button class="ac-coeur" style="margin-left:auto" onclick="acRetirerRdv(' + r.id + ')">✕</button>' : '')
        + '</div>';
    }).join('');
  }
  window.acFormRdv = function () {
    if (!acAdmin()) return;
    const titre = prompt('Quel rendez-vous ? (ex. Réunion d’équipe)'); if (!titre || !titre.trim()) return;
    const date = prompt('Quel jour ? (jj/mm)', ''); if (!date) return;
    const m = String(date).match(/^(\d{1,2})\D+(\d{1,2})$/);
    if (!m) { alert('Date attendue au format jj/mm.'); return; }
    const jour = +m[1], mo = +m[2];
    if (jour < 1 || jour > 31 || mo < 1 || mo > 12) { alert('Date invalide.'); return; }
    const n = new Date();
    const iso = n.getFullYear() + '-' + pad(mo) + '-' + pad(jour);
    const h = prompt('À quelle heure ? (facultatif, ex. 14h)', '') || '';
    const now = Date.now();
    acAgenda().push({ id: now, date: iso, h: h.trim(), titre: titre.trim(), par: (acUser() || {}).id, updatedAt: now });
    acSave(true); acRender();
  };
  window.acRetirerRdv = function (id) {
    if (!acAdmin()) return;
    const l = acAgenda(), i = l.findIndex(x => x.id === id); if (i < 0) return;
    if (!confirm('Retirer ce rendez-vous ?')) return;
    if (typeof markDeleted === 'function') markDeleted('agenda', id);
    l.splice(i, 1); acSave(true); acRender();
  };

  // ── Anniversaires du mois ─────────────────────────────────────────────────
  function acRendAnnivsMois(n) {
    const el = document.getElementById('ac-annivs'); if (!el) return;
    const m = pad(n.getMonth() + 1), auj = acMoisJour(n);
    const l = acStaff().filter(s => s.anniv && String(s.anniv).slice(0, 2) === m)
      .sort((a, b) => String(a.anniv).localeCompare(String(b.anniv)));
    if (!l.length) {
      el.innerHTML = '<div class="ac-vide">Aucun anniversaire ce mois-ci.'
        + (acAdmin() ? '<br><span style="font-size:.78rem">Les dates se renseignent dans le Back Office, fiche collaborateur.</span>' : '')
        + '</div>';
      return;
    }
    el.innerHTML = l.map(function (s) {
      const j = +String(s.anniv).slice(3);
      return '<div class="ac-li' + (String(s.anniv) < auj ? ' passe' : '') + '">'
        + '<span class="q">' + j + ' ' + MOIS_CT[n.getMonth()] + '</span>'
        + '<span class="t">' + E((s.prenom || '') + ' ' + (s.nom || '')) + '</span></div>';
    }).join('');
  }

  // ── Partager un moment ────────────────────────────────────────────────────
  let acImg = null;
  window.acFormMoment = function () {
    const u = acUser(); if (!u) { alert('Identifiez-vous avec votre code PIN.'); return; }
    acImg = null;
    document.getElementById('ac-mom-titre').value = '';
    document.getElementById('ac-mom-texte').value = '';
    document.getElementById('ac-mom-apercu').innerHTML = '';
    const f = document.getElementById('ac-mom-img'); if (f) f.value = '';
    document.getElementById('ac-ov-mom').classList.add('open');
  };
  window.acFermerMoment = function () { document.getElementById('ac-ov-mom').classList.remove('open'); };
  window.acPhoto = function (inp) {
    const f = inp.files && inp.files[0]; if (!f) return;
    // Photo volontairement legere : elle vit dans le blob que chaque poste
    // retelecharge en ENTIER toutes les 8 secondes. 640 px suffisent a une
    // vignette de carrousel, et six moments tiennent sous 500 Ko.
    const img = new Image(), lec = new FileReader();
    lec.onload = e => { img.src = e.target.result; };
    img.onload = function () {
      const r = Math.min(1, AC_MOMENT_PX / img.width);
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      acImg = c.toDataURL('image/jpeg', AC_MOMENT_Q);
      const ko = Math.round(acImg.length * 0.75 / 1024);
      document.getElementById('ac-mom-apercu').innerHTML =
        '<img src="' + acImg + '" style="max-width:100%;max-height:150px;border-radius:10px;display:block">'
        + '<div style="font-size:.74rem;color:var(--gray-500);margin-top:4px">' + ko + ' Ko · '
        + '<span style="cursor:pointer;text-decoration:underline" onclick="acRetirerPhoto()">retirer</span></div>';
    };
    lec.readAsDataURL(f);
  };
  window.acRetirerPhoto = function () {
    acImg = null;
    document.getElementById('ac-mom-apercu').innerHTML = '';
    const f = document.getElementById('ac-mom-img'); if (f) f.value = '';
  };
  window.acPublierMoment = function () {
    const u = acUser(); if (!u) return;
    const titre = (document.getElementById('ac-mom-titre').value || '').trim();
    const texte = (document.getElementById('ac-mom-texte').value || '').trim().slice(0, 200);
    if (!titre && !texte && !acImg) { alert('Ajoutez au moins un mot ou une photo.'); return; }
    const now = Date.now();
    acMoments().unshift({
      id: now, ts: now, auteur: u.id, auteurNom: acPrenom(u.id),
      titre: titre.slice(0, 60), texte: texte, image: acImg || null,
      likes: [], expiresAt: now + AC_MOMENT_JOURS * 86400000, updatedAt: now
    });
    acImg = null;
    acFermerMoment(); acSave(true); acRendMoments();
    if (typeof logAction === 'function') logAction('Moment partagé', '');
  };

  const AC_MODALE = '<div class="overlay" id="ac-ov-mom">'
    + '<div class="mbox" style="max-width:520px">'
    + '<div class="mbox-h"><b>Partager un moment</b><button class="x" onclick="acFermerMoment()">✕</button></div>'
    + '<div class="mbox-b">'
    + '<div class="fg"><label>Titre</label>'
    + '<input type="text" id="ac-mom-titre" maxlength="60" placeholder="Ex. Pot de départ de Mathilde"></div>'
    + '<div class="fg"><label>Un mot</label>'
    + '<textarea id="ac-mom-texte" rows="2" maxlength="200" placeholder="Une belle soirée !"></textarea></div>'
    + '<div class="fg"><label>Photo (facultative)</label>'
    + '<input type="file" id="ac-mom-img" accept="image/*" onchange="acPhoto(this)">'
    + '<div style="font-size:.74rem;color:var(--gray-500);margin-top:4px">'
    + 'Pas de patient sur la photo. Le moment disparaît au bout de ' + AC_MOMENT_JOURS + ' jours.</div>'
    + '<div id="ac-mom-apercu" style="margin-top:8px"></div></div>'
    + '</div>'
    + '<div class="mbox-f"><button class="btn bs" onclick="acFermerMoment()">Annuler</button>'
    + '<button class="btn bp" onclick="acPublierMoment()">Partager</button></div>'
    + '</div></div>';

  // ── Ouverture depuis l'exterieur (fin de saisie du code PIN) ──────────────
  window.acOuvrir = function () {
    if (!document.getElementById('sec-accueil')) return;
    if (typeof showSec === 'function') showSec('accueil');
  };

  // ── Injection ─────────────────────────────────────────────────────────────
  function acInstaller() {
    if (document.getElementById('sec-accueil')) return;

    const st = document.createElement('style'); st.textContent = AC_CSS;
    document.head.appendChild(st);

    const premier = document.querySelector('.sidebar .sb-item');
    if (premier && !document.querySelector('.sb-item[data-sec="accueil"]')) {
      const b = document.createElement('button');
      b.className = 'sb-item'; b.setAttribute('data-sec', 'accueil');
      b.setAttribute('onclick', "showSec('accueil',this); if(window.acRender) acRender();");
      b.innerHTML = '<svg class="ico sb-ico"><use href="#ic-patients"></use></svg>'
        + '<span class="sb-label">Accueil</span>';
      premier.parentNode.insertBefore(b, premier);
    }

    const ref = document.querySelector('.sec');
    if (ref) {
      const sec = document.createElement('section');
      sec.id = 'sec-accueil'; sec.className = 'sec'; sec.innerHTML = AC_SECTION;
      ref.parentNode.insertBefore(sec, ref);
    }

    const m = document.createElement('div'); m.innerHTML = AC_MODALE;
    if (m.firstElementChild) document.body.appendChild(m.firstElementChild);

    if (typeof SEC_LABEL === 'object' && SEC_LABEL) SEC_LABEL.accueil = 'Accueil';
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', acInstaller);
  else acInstaller();
})();
