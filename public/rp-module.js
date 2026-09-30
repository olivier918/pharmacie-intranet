/* ═══════════════════════════════════════════════════════════════════════════
   RUPTURES — la liste qu'on gratte deux fois par jour

   Des médicaments introuvables, et des grossistes qu'il faut rappeler matin et
   après-midi pour voir s'il en est retombé. Le geste tient en une ligne :
   j'appelle, je coche, ça disparaît. Au créneau suivant, tout revient.

   CE N'EST PAS UNE LISTE DE TÂCHES QU'ON COCHE UNE FOIS. C'est un rituel à deux
   temps : la coche vaut pour UN créneau, pas pour la journée ni pour toujours.
   D'où le seul vrai calcul de ce module — `rpCreneau()`, qui dit dans quelle
   demi-journée on se trouve. Tout le reste en découle.

   LA CROIX EST LE SEUL GESTE DÉFINITIF. Cocher fait disparaître jusqu'à
   14 heures ; la croix efface le produit pour de bon. Les deux ne doivent
   jamais se ressembler, sous peine de perdre une ligne qu'on gratte depuis
   trois semaines.

   LA DONNÉE VIT DANS LE BLOB. Une dizaine de produits et deux coches par jour :
   c'est petit, et c'est fait pour être vu par tous les postes à la seconde où
   quelqu'un décroche — exactement ce que la fusion multiposte donne.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ── LE CRÉNEAU ────────────────────────────────────────────────────────────
  //
  // Bascule à 14 h. Avant, on est le matin ; après, l'après-midi. L'heure est
  // lue à PARIS et non sur l'horloge du poste : un navigateur mal réglé, ou
  // un serveur en UTC, ferait basculer la liste à 15 h ou à 16 h — et la
  // tournée de l'après-midi n'apparaîtrait jamais au bon moment.
  const RP_BASCULE = 14;

  function rpCreneau(quand) {
    const d = quand ? new Date(quand) : new Date();
    const f = new Intl.DateTimeFormat('fr-CA', {
      timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', hour12: false
    }).formatToParts(d);
    const p = {};
    f.forEach(function (x) { p[x.type] = x.value; });
    const h = parseInt(p.hour, 10);
    return p.year + '-' + p.month + '-' + p.day + (h < RP_BASCULE ? '-matin' : '-aprem');
  }
  function rpLibelleCreneau(c) {
    return /matin$/.test(String(c || '')) ? 'ce matin' : 'cet après-midi';
  }

  // ── Accès ─────────────────────────────────────────────────────────────────
  const rpListe = () => (typeof window._collRef === 'function' ? window._collRef('ruptures') : null) || [];
  const rpUser  = () => (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null;
  function rpSave() {
    // Cocher est rare et voulu : on n'attend pas les 600 ms du report.
    if (typeof saveNow === 'function') saveNow();
    else if (typeof schedSave === 'function') schedSave();
  }
  function E(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }
  function rpPrenom(id) {
    const l = (typeof window._collRef === 'function' ? window._collRef('staffDB') : null) || [];
    const s = l.find(function (x) { return x && x.id === id; });
    return s ? (s.prenom || s.id) : (id || '');
  }

  // ── Les deux listes ───────────────────────────────────────────────────────
  //
  // À FAIRE en premier, et dans l'ordre d'ANCIENNETÉ : le produit qu'on
  // cherche depuis trois semaines passe devant celui d'hier. C'est lui qui
  // risque de manquer au comptoir, et lui qu'on finit par ne plus voir.
  function rpAFaire(l, creneau) {
    return (l || []).filter(function (r) { return r && r.dernier !== creneau; })
      .slice().sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
  }
  function rpFaits(l, creneau) {
    return (l || []).filter(function (r) { return r && r.dernier === creneau; })
      .slice().sort(function (a, b) { return (b.dernierLe || 0) - (a.dernierLe || 0); });
  }

  // « demandé 14 fois depuis le 12/09 » : c'est ce qui fait décider d'arrêter
  // de gratter et de chercher une alternative. Sans lui, un produit
  // introuvable depuis six semaines encombre la liste sans jamais le dire.
  function rpAnciennete(r, maintenant) {
    const j = Math.floor(((+new Date(maintenant || Date.now())) - (r.ts || 0)) / 86400000);
    const n = r.demandes || 0;
    if (!n && j <= 0) return 'ajouté à l’instant';
    const d = new Date(r.ts || Date.now());
    const date = String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');
    return (n ? n + ' demande' + (n > 1 ? 's' : '') : 'jamais demandé')
         + ' depuis le ' + date + (j >= 14 ? ' · ' + j + ' jours' : '');
  }

  // ── Les gestes ────────────────────────────────────────────────────────────
  window.rpAjouter = function () {
    const u = rpUser(); if (!u) return;
    const i = document.getElementById('rp-nom');
    const nom = String((i && i.value) || '').trim();
    if (!nom) { rpMsg('Un médicament sans nom ne se cherche pas.', true); return; }
    const l = rpListe();
    const deja = l.find(function (r) {
      return r && String(r.nom || '').toLowerCase() === nom.toLowerCase();
    });
    // DEUX FOIS LE MÊME PRODUIT, c'est deux appels pour rien. On le dit plutôt
    // que d'ajouter en silence une ligne qui fera doublon toute la semaine.
    if (deja) { rpMsg('« ' + deja.nom +' » est déjà dans la liste.', true); if (i) i.value = ''; return; }
    const now = Date.now();
    l.push({ id: now, nom: nom.slice(0, 120), par: u.id, ts: now,
             demandes: 0, dernier: null, dernierLe: null, dernierPar: null, updatedAt: now });
    if (i) { i.value = ''; i.focus(); }
    rpSave(); window.rpRender();
  };

  window.rpToucheAjout = function (ev) { if (ev && ev.key === 'Enter') { ev.preventDefault(); window.rpAjouter(); } };

  window.rpInterroger = function (id) {
    const u = rpUser(); if (!u) return;
    const r = rpListe().find(function (x) { return x && x.id === id; });
    if (!r) return;
    const c = rpCreneau();
    const now = Date.now();
    if (r.dernier === c) {
      // Se raviser : on avait coché par erreur. On rend la ligne au créneau,
      // et on reprend la demande qu'on venait de compter.
      r.dernier = null; r.dernierLe = null; r.dernierPar = null;
      r.demandes = Math.max(0, (r.demandes || 0) - 1);
    } else {
      r.dernier = c; r.dernierLe = now; r.dernierPar = u.id;
      r.demandes = (r.demandes || 0) + 1;
    }
    r.updatedAt = now;
    rpSave(); window.rpRender();
  };

  // LA CROIX EFFACE POUR DE BON. Elle demande confirmation, et elle est la
  // seule à le faire : cocher est un geste de tous les jours, effacer non.
  window.rpRetirer = function (id) {
    const u = rpUser(); if (!u) return;
    const l = rpListe();
    const i = l.findIndex(function (x) { return x && x.id === id; });
    if (i < 0) return;
    if (!confirm('Retirer « ' + l[i].nom + ' » de la liste des ruptures ?\n\n'
               + 'Il ne reviendra plus aux prochains créneaux.')) return;
    // Sans pierre tombale, un poste resté en arrière le ferait réapparaître.
    if (typeof markDeleted === 'function') markDeleted('ruptures', l[i].id);
    l.splice(i, 1);
    rpSave(); window.rpRender();
  };

  function rpMsg(t, err) {
    const z = document.getElementById('rp-msg'); if (!z) return;
    z.textContent = t; z.className = 'rp-msg' + (err ? ' ko' : '');
    setTimeout(function () { if (z.textContent === t) { z.textContent = ''; z.className = 'rp-msg'; } }, 5000);
  }

  // ── L'écran ───────────────────────────────────────────────────────────────
  function rpLigne(r, fait, maintenant) {
    return '<div class="rp-l' + (fait ? ' fait' : '') + '" data-id="' + (+r.id) + '">'
      + '<button type="button" class="rp-c" onclick="rpInterroger(' + (+r.id) + ')" title="'
      +   (fait ? 'Annuler : le remettre à interroger' : 'J’ai interrogé le grossiste') + '">'
      +   (fait ? '✓' : '') + '</button>'
      + '<div class="rp-t"><div class="rp-n">' + E(r.nom) + '</div>'
      +   '<div class="rp-d">' + E(rpAnciennete(r, maintenant))
      +   (fait && r.dernierPar ? ' · ' + E(rpPrenom(r.dernierPar)) : '') + '</div></div>'
      + '<button type="button" class="rp-x" onclick="rpRetirer(' + (+r.id) + ')"'
      +   ' title="Retirer définitivement" aria-label="Retirer définitivement">✕</button>'
      + '</div>';
  }

  window.rpRender = function () {
    const z = document.getElementById('rp-liste'); if (!z) return;
    const c = rpCreneau(), l = rpListe(), now = Date.now();
    const a = rpAFaire(l, c), f = rpFaits(l, c);

    const t = document.getElementById('rp-creneau');
    if (t) {
      t.innerHTML = a.length
        ? '<b>' + a.length + '</b> à interroger ' + rpLibelleCreneau(c)
        : (l.length ? '<b>Tout est fait</b> pour ' + rpLibelleCreneau(c)
                    + ' — la liste revient ' + (/matin$/.test(c) ? 'à 14 h' : 'demain matin') + '.'
                    : 'Aucun médicament en rupture suivi.');
    }
    z.innerHTML = a.length ? a.map(function (r) { return rpLigne(r, false, now); }).join('')
      : (l.length ? '' : '<div class="rp-vide">La liste est vide. Ajoutez un médicament '
          + 'ci-dessus : il reviendra chaque matin et chaque après-midi tant qu’il n’est pas retrouvé.</div>');

    const zf = document.getElementById('rp-faits');
    const hf = document.getElementById('rp-faits-h');
    if (hf) hf.style.display = f.length ? '' : 'none';
    if (hf) hf.innerHTML = 'Interrogés ' + rpLibelleCreneau(c) + ' · ' + f.length;
    if (zf) zf.innerHTML = f.map(function (r) { return rpLigne(r, true, now); }).join('');
    rpPastille(a.length);
  };

  // La pastille de la barre : une liste qu'il faut PENSER à ouvrir ne s'ouvre
  // pas. C'est elle qui fait que la tournée de l'après-midi a lieu.
  function rpPastille(n) {
    const b = document.getElementById('navb-rp'); if (!b) return;
    b.textContent = n > 0 ? n : '';
    b.className = 'sb-badge' + (n > 0 ? ' on orange' : '');
  }

  // Le créneau change à 14 h, sans que personne ne recharge la page. Sans ce
  // réveil, l'écran resterait « tout est fait » jusqu'au lendemain.
  let rpDernierVu = rpCreneau();
  setInterval(function () {
    const c = rpCreneau();
    if (c !== rpDernierVu) { rpDernierVu = c; if (document.getElementById('rp-liste')) window.rpRender(); }
  }, 60e3);

  const RP_SECTION =
    '<div class="card">'
  +   '<div class="ch"><span class="ct"><svg class="ico"><use href="#ic-rupture"></use></svg> '
  +     'Ruptures — à gratter chez les grossistes</span></div>'
  +   '<div class="rp-ajout">'
  +     '<input type="text" id="rp-nom" data-rc="neuf" maxlength="120" autocomplete="off"'
  +       ' placeholder="Nom du médicament introuvable…" onkeydown="rpToucheAjout(event)">'
  +     '<button class="btn bp" onclick="rpAjouter()">Ajouter</button>'
  +   '</div>'
  +   '<div id="rp-msg" class="rp-msg"></div>'
  +   '<div id="rp-creneau" class="rp-creneau"></div>'
  +   '<div id="rp-liste"></div>'
  +   '<div id="rp-faits-h" class="rp-faits-h" style="display:none"></div>'
  +   '<div id="rp-faits" class="rp-faits"></div>'
  +   '<div class="rp-pied">Cocher fait disparaître le médicament jusqu’au créneau suivant '
  +     '(14 h, puis le lendemain matin). La croix le retire définitivement.</div>'
  + '</div>';

  const RP_CSS = `
  .rp-ajout{display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap}
  .rp-ajout input{flex:1;min-width:200px;padding:11px 13px;border:1px solid var(--gray-200,#e5e7eb);
    border-radius:10px;font:inherit;font-size:.92rem}
  .rp-ajout input:focus{outline:none;border-color:var(--g-mid,#2E7D54);
    box-shadow:0 0 0 3px var(--g-pale,#E8F5E9)}
  .rp-msg{font-size:.84rem;color:var(--gray-500,#6b7280);min-height:0}
  .rp-msg.ko{color:#C62828;font-weight:600}
  .rp-creneau{font-size:.9rem;color:var(--gray-700,#374151);margin:10px 0 12px}
  .rp-creneau b{color:var(--g-dark,#1D5C3A);font-size:1.05rem}
  .rp-l{display:flex;align-items:center;gap:12px;background:#fff;border:1px solid #e7ece9;
    border-radius:12px;padding:11px 13px;margin-bottom:8px}
  .rp-l:hover{border-color:#cdd8d1}
  .rp-t{flex:1;min-width:0}
  .rp-n{font-weight:600;font-size:.95rem}
  .rp-d{font-size:.76rem;color:var(--gray-500,#6b7280);margin-top:2px}
  /* La coche est large : on la vise le téléphone dans une main, l'autre sur
     le combiné. */
  .rp-c{flex:none;width:30px;height:30px;border:1.8px solid #c3d0c8;border-radius:9px;background:#fff;
    cursor:pointer;color:#fff;font-size:15px;font-weight:800;line-height:1;padding:0}
  .rp-c:hover{border-color:var(--g-dark,#1D5C3A)}
  .rp-c:focus-visible{outline:2px solid var(--g-mid,#2E7D54);outline-offset:2px}
  .rp-l.fait .rp-c{background:#2E7D52;border-color:#2E7D52}
  .rp-l.fait{background:#F7F9F8;border-color:#e9eeeb}
  .rp-l.fait .rp-n{color:var(--gray-500,#6b7280);text-decoration:line-through}
  /* La croix reste pâle et à l'écart de la coche : c'est le seul geste
     définitif, il ne doit pas se cliquer par élan. */
  .rp-x{flex:none;border:none;background:none;color:#ccd6d0;font-size:1rem;cursor:pointer;
    padding:6px 4px;line-height:1;border-radius:6px}
  .rp-x:hover{color:#C62828;background:#FFEBEE}
  .rp-x:focus-visible{outline:2px solid #C62828;outline-offset:1px}
  .rp-faits-h{font-size:.74rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;
    color:var(--gray-500,#6b7280);margin:18px 0 8px}
  .rp-vide{padding:24px 8px;text-align:center;color:var(--gray-500,#6b7280);
    font-size:.88rem;line-height:1.6}
  .rp-pied{margin-top:18px;font-size:.78rem;color:var(--gray-500,#6b7280);line-height:1.55}
  @media print{.rp-ajout,.rp-c,.rp-x,.rp-pied{display:none}}
  `;

  function rpInject() {
    if (document.getElementById('rp-css')) return;
    const st = document.createElement('style');
    st.id = 'rp-css'; st.textContent = RP_CSS;
    document.head.appendChild(st);

    const ref = document.querySelector('.sb-item[data-sec="preparations"]')
             || document.querySelector('.sb-item[data-sec="livraisons"]');
    if (ref && !document.querySelector('.sb-item[data-sec="ruptures"]')) {
      const b = document.createElement('button');
      b.className = 'sb-item';
      b.setAttribute('data-sec', 'ruptures');
      b.setAttribute('onclick', "showSec('ruptures',this)");
      b.innerHTML = '<svg class="ico sb-ico"><use href="#ic-rupture"></use></svg>'
        + '<span class="sb-label">Ruptures</span><span class="sb-badge" id="navb-rp"></span>';
      ref.insertAdjacentElement('afterend', b);
    }

    const secRef = document.getElementById('sec-livraisons');
    if (secRef && !document.getElementById('sec-ruptures')) {
      const sec = document.createElement('section');
      sec.id = 'sec-ruptures'; sec.className = 'sec';
      sec.innerHTML = RP_SECTION;
      secRef.parentNode.appendChild(sec);
      window.rpRender();
      if (typeof window.rcInfobulles === 'function') window.rcInfobulles();
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', rpInject);
  else rpInject();

  window.rpCreneau = rpCreneau;
  window.rpAFaire = rpAFaire;
  window.rpFaits = rpFaits;
  window.rpAnciennete = rpAnciennete;
}());
