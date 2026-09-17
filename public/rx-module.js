/* ═══════════════════════════════════════════════════════════════════════════
   RÉACTIONS — répondre à un message sans écrire un message

   Dans le cahier de transmission, un message lu par toute l'équipe appelle
   quatre « ok » qui n'apprennent rien à personne et noient le dossier. Une
   réaction dit la même chose sans ajouter de ligne.

   POURQUOI UNE COLLECTION À PART, et pas un champ sur le message.
   La fusion serveur remplace un enregistrement ENTIER par le plus récemment
   modifié (`mergeById`). Si les réactions vivaient sur le message, deux
   personnes qui réagissent au même message dans la même fenêtre de huit
   secondes s'écraseraient l'une l'autre — et c'est précisément le cas normal
   ici : un message que tout le monde lit reçoit plusieurs pouces en même
   temps. Chaque réaction porte donc son propre identifiant, et deux réactions
   simultanées sont deux enregistrements qui survivent tous les deux.

   C'est le même raisonnement qui a mis `messages` à part de `convos`.

   UNE SEULE RÉACTION PAR PERSONNE ET PAR MESSAGE. Appuyer sur un autre emoji
   remplace le sien ; appuyer sur le même le retire. Comme sur un téléphone.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // Six, et pas un clavier entier. Au comptoir, sur un téléphone, entre deux
  // patients, six choix se prennent d'un geste — et six colonnes se lisent
  // d'un coup d'œil quand l'équipe a répondu.
  const RX_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
  const RX_NOMS = ['Pouce', 'Cœur', 'Rire', 'Surprise', 'Tristesse', 'Merci'];

  const rxListe = () => (typeof reactions !== 'undefined' && Array.isArray(reactions)) ? reactions : [];
  const rxUser = () => (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null;
  const rxSave = () => { if (typeof saveNow === 'function') saveNow(); };
  function rxPrenom(uid) {
    if (typeof staffDB !== 'undefined' && Array.isArray(staffDB)) {
      const s = staffDB.find(x => x && x.id === uid);
      if (s) return s.prenom || s.id;
    }
    return uid;
  }

  // Une référence est toujours comparée en texte : l'identifiant d'un message
  // de la messagerie est un nombre, celui d'un message du cahier est
  // « dossier-horodatage » (ses messages n'ont pas d'identifiant à eux).
  const rxRef = r => String(r == null ? '' : r);

  function rxDe(c, r) {
    const rr = rxRef(r);
    return rxListe().filter(x => x && x.c === c && rxRef(x.r) === rr);
  }
  // Regroupe par emoji, dans l'ordre de la palette — pas dans l'ordre d'arrivée,
  // sinon les pastilles changent de place à chaque clic et on ne reconnaît plus
  // la sienne.
  function rxGroupes(c, r, moiId) {
    const l = rxDe(c, r);
    const par = {};
    l.forEach(function (x) {
      if (!x.e) return;
      if (!par[x.e]) par[x.e] = { e: x.e, uids: [], moi: false };
      par[x.e].uids.push(x.uid);
      if (moiId && x.uid === moiId) par[x.e].moi = true;
    });
    return Object.keys(par)
      .sort(function (a, b) {
        const ia = RX_EMOJIS.indexOf(a), ib = RX_EMOJIS.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      })
      .map(function (e) { return par[e]; });
  }
  // Ce que la personne a posé sur ce message, s'il y a quelque chose.
  function rxMienne(c, r, uid) {
    const rr = rxRef(r);
    return rxListe().find(x => x && x.c === c && rxRef(x.r) === rr && x.uid === uid) || null;
  }
  window.rxDe = rxDe;
  window.rxGroupes = rxGroupes;
  window.rxMienne = rxMienne;
  window.RX_EMOJIS = RX_EMOJIS;

  // ── Ce qui s'affiche sous un message ──────────────────────────────────────
  // `data-rx` porte la cible : c'est lui qui permet de redessiner UNE barre
  // après un clic, ou toutes après une resynchronisation, sans reconstruire la
  // conversation (ce qui la ferait sauter en haut de l'écran).
  window.rxBarre = function (c, r) {
    const u = rxUser();
    const pleine = rxGroupes(c, r, u && u.id).length > 0;
    return '<div class="rx' + (pleine ? ' pleine' : '') + '" data-rx="' + c + '|' + rxRef(r) + '">'
      + rxContenu(c, r) + '</div>';
  };
  function rxContenu(c, r) {
    const u = rxUser();
    const g = rxGroupes(c, r, u && u.id);
    const pastilles = g.map(function (x) {
      const qui = x.uids.map(rxPrenom).join(', ');
      return '<button class="rx-p' + (x.moi ? ' moi' : '') + '" title="' + rxEch(qui) + '"'
        + ' onclick="rxBasculer(this,' + RX_EMOJIS.indexOf(x.e) + ')">'
        + x.e + '<span>' + x.uids.length + '</span></button>';
    }).join('');
    return pastilles
      + '<button class="rx-plus" title="Réagir" onclick="rxOuvrir(this)">'
      + '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">'
      + '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.7"/>'
      + '<circle cx="9" cy="10" r="1.1" fill="currentColor"/><circle cx="15" cy="10" r="1.1" fill="currentColor"/>'
      + '<path d="M8.5 14.2a4.2 4.2 0 0 0 7 0" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'
      + '</svg><span class="t">Réagir</span></button>';
  }
  function rxEch(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  // La cible n'est pas passée au gestionnaire : elle est lue sur la barre qui
  // contient le bouton. Un gestionnaire ne reçoit qu'un index de palette.
  function rxCible(el) {
    const b = el && el.closest ? el.closest('[data-rx]') : null;
    if (!b) return null;
    const v = String(b.getAttribute('data-rx') || '');
    const i = v.indexOf('|');
    return i < 0 ? null : { c: v.slice(0, i), r: v.slice(i + 1), boite: b };
  }

  window.rxBasculer = function (el, i) {
    const cible = rxCible(el); if (!cible) return;
    const e = RX_EMOJIS[i]; if (!e) return;
    const u = rxUser();
    if (!u) { alert('Identifiez-vous avec votre code PIN pour réagir.'); return; }
    rxFermerChoix();
    const geste = rxAppliquer(rxListe(), cible.c, cible.r, u.id, e, Date.now());
    // Une suppression doit laisser une pierre tombale, sinon un poste en
    // retard ferait revenir la réaction à la resynchronisation.
    if (geste.retire != null && typeof markDeleted === 'function') markDeleted('reactions', geste.retire);
    rxSave();
    // On redessine LA BARRE DU MESSAGE, pas l'élément cliqué : quand le clic
    // vient de la bulle flottante, celle-ci porte la même cible mais disparaît
    // aussitôt — la réaction était enregistrée et ne s'affichait pas.
    rxRedessinerCible(cible.c, cible.r);
  };

  // Le geste lui-même, sans DOM ni enregistrement : c'est lui qu'on éprouve.
  // Trois cas et trois seulement — le même emoji retire, un autre remplace,
  // aucun ajoute. Rendre { retire } quand un enregistrement a disparu.
  function rxAppliquer(l, c, r, uid, e, now) {
    const rr = rxRef(r);
    const mienne = l.find(x => x && x.c === c && rxRef(x.r) === rr && x.uid === uid) || null;
    if (mienne && mienne.e === e) {
      const k = l.findIndex(x => x && x.id === mienne.id);
      if (k >= 0) l.splice(k, 1);
      return { geste: 'retire', retire: mienne.id };
    }
    if (mienne) {
      mienne.e = e; mienne.updatedAt = now;
      return { geste: 'remplace', retire: null, id: mienne.id };
    }
    // Les identifiants sont des horodatages : à plusieurs dans la même
    // milliseconde, on enjambe ceux qui sont pris plutôt que d'écraser.
    let id = now;
    const pris = {}; l.forEach(x => { if (x) pris[x.id] = 1; });
    while (pris[id]) id++;
    l.push({ id: id, c: c, r: rr, uid: uid, e: e, ts: now, updatedAt: now });
    return { geste: 'ajoute', retire: null, id: id };
  }
  window.rxAppliquer = rxAppliquer;

  function rxRedessinerCible(c, r) {
    const sel = '[data-rx="' + (c + '|' + rxRef(r)).replace(/"/g, '') + '"]';
    [].slice.call(document.querySelectorAll(sel)).forEach(function (b) {
      if (!b.classList.contains('rx-pop')) rxRedessiner(b);
    });
  }
  function rxRedessiner(boite) {
    const v = String(boite.getAttribute('data-rx') || '');
    const i = v.indexOf('|');
    if (i < 0) return;
    const c = v.slice(0, i), r = v.slice(i + 1);
    const u = rxUser();
    boite.classList.toggle('pleine', rxGroupes(c, r, u && u.id).length > 0);
    boite.innerHTML = rxContenu(c, r);
  }
  // Après une resynchronisation : les barres à l'écran se remettent à jour
  // sans reconstruire la conversation, qui sauterait en haut de l'écran.
  window.rxRafraichir = function () {
    [].slice.call(document.querySelectorAll('[data-rx]')).forEach(rxRedessiner);
  };

  // ── Le choix des six ──────────────────────────────────────────────────────
  let rxPop = null;
  window.rxOuvrir = function (el) {
    const cible = rxCible(el); if (!cible) return;
    if (rxPop && rxPop._pour === el) { rxFermerChoix(); return; }
    rxFermerChoix();
    const p = document.createElement('div');
    p.className = 'rx-pop';
    p._pour = el;
    p.innerHTML = RX_EMOJIS.map(function (e, i) {
      return '<button title="' + rxEch(RX_NOMS[i] || '') + '" onclick="rxChoisir(this,' + i + ')">' + e + '</button>';
    }).join('');
    // La cible est recopiée sur la bulle flottante : elle est posée sur le
    // corps du document, hors de la barre, et ne la retrouverait plus.
    p.setAttribute('data-rx', cible.c + '|' + cible.r);
    document.body.appendChild(p);
    const r = el.getBoundingClientRect();
    const w = p.offsetWidth || 230, h = p.offsetHeight || 44;
    let x = r.left + r.width / 2 - w / 2;
    x = Math.max(8, Math.min(x, window.innerWidth - w - 8));
    // Au-dessus si la place manque en dessous : sur un téléphone, une bulle
    // sortie de l'écran est une fonction qui n'existe pas.
    const y = (r.bottom + h + 10 > window.innerHeight) ? (r.top - h - 6) : (r.bottom + 6);
    p.style.left = Math.round(x) + 'px';
    p.style.top = Math.round(Math.max(8, y)) + 'px';
    rxPop = p;
    setTimeout(function () {
      document.addEventListener('click', rxDehors, true);
      document.addEventListener('keydown', rxEchap, true);
    }, 0);
  };
  window.rxChoisir = function (el, i) { rxBasculer(el, i); };
  function rxFermerChoix() {
    if (!rxPop) return;
    document.removeEventListener('click', rxDehors, true);
    document.removeEventListener('keydown', rxEchap, true);
    rxPop.remove(); rxPop = null;
  }
  function rxDehors(ev) {
    if (rxPop && !rxPop.contains(ev.target)) rxFermerChoix();
  }
  function rxEchap(ev) { if (ev.key === 'Escape') rxFermerChoix(); }
  window.rxFermerChoix = rxFermerChoix;

  // ── Style ─────────────────────────────────────────────────────────────────
  const RX_CSS = `
  .rx{display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin-top:3px}
  /* La police est nommee explicitement : herite de la bulle, l'emoji retombait
     sur un glyphe monochrome faute de police couleur dans la pile heritee. */
  .rx-p,.rx-pop button{font-family:"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",system-ui,sans-serif}
  .rx-p{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--gray-200);background:#fff;
        border-radius:20px;padding:1px 8px 1px 6px;font-size:.82rem;line-height:1.5;cursor:pointer}
  .rx-p span{font-family:inherit;font-size:.7rem;font-weight:700;color:var(--gray-500)}
  .rx-p.moi{background:var(--g-pale);border-color:var(--g-mid)}
  .rx-p.moi span{color:var(--g-dark)}
  /* Le bouton reste VISIBLE. Cache jusqu'au survol, il n'etait decouvert par
     personne — et sur un ecran tactile il n'y a pas de survol du tout. Il est
     discret (gris clair, petit) mais present, et il se colore au contact. */
  .rx-plus{border:1px solid var(--gray-200);background:#fff;color:var(--gray-500);cursor:pointer;
           border-radius:20px;padding:2px 8px;display:inline-flex;align-items:center;gap:4px;
           font-size:.7rem;font-weight:600;line-height:1.5;transition:background .12s,color .12s,border-color .12s}
  .rx-plus .t{letter-spacing:.2px}
  .rx-plus:hover,.rx-plus:focus{background:var(--g-pale);border-color:var(--g-mid);color:var(--g-dark)}
  /* Une fois que quelqu'un a reagi, les pastilles portent le sens : le bouton
     se reduit a son icone pour ne pas encombrer la ligne. */
  .rx.pleine .rx-plus .t{display:none}
  .rx.pleine .rx-plus{padding:2px 6px}
  .rx-pop{position:fixed;z-index:99998;background:#fff;border:1px solid var(--gray-200);border-radius:22px;
          box-shadow:0 8px 26px rgba(0,0,0,.18);padding:4px 6px;display:flex;gap:2px}
  .rx-pop button{border:none;background:none;font-size:1.32rem;line-height:1;padding:5px 6px;border-radius:50%;
                 cursor:pointer;transition:transform .1s,background .1s}
  .rx-pop button:hover{background:var(--gray-100);transform:scale(1.18)}
  `;
  const st = document.createElement('style'); st.textContent = RX_CSS; document.head.appendChild(st);
}());
