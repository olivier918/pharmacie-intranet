/* ════════════════════════════════════════════════════════════════════════════
   Module CONTRÔLE DE COMMANDE — la couture entre celui qui pointe la facture
   et celui qui recontrôle le prix de vente.

   LE GESTE QU'IL SERT. La responsable logistique réceptionne, pointe la
   facture, et constate — ou non — un écart : une remise qui manque, une UG
   oubliée, une quantité fausse, un prix qui n'est pas celui du tarif. Elle note
   le numéro de la commande contrôlée, coche ce qui cloche, et l'adresse à
   Anouck ou à Olivier. L'un des deux recontrôle le prix de vente et marque
   « vu ».

   Sans ce module, cette couture tient dans un carnet et dans la mémoire de
   deux personnes : la question « est-ce que quelqu'un a regardé la commande
   170412 ? » se pose à voix haute, et la réponse est souvent « je crois ».

   TOUT PASSE PAR LE DESTINATAIRE, MÊME SANS PROBLÈME COCHÉ. C'est le choix
   d'Olivier : une commande contrôlée sans écart est une information, pas un
   silence. Elle s'affiche en vert et se liquide d'un clic.

   UNE LIGNE PAR CONTRÔLE, et chaque clic laisse un nom et une heure — même
   raison que partout ici : le serveur fusionne enregistrement par
   enregistrement, et deux personnes qui marquent « vu » sur deux lignes
   différentes dans la même fenêtre de huit secondes ne doivent pas s'écraser.

   Préfixe `cc` / `cc-` : rien ici ne touche à l'existant.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const E = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
  const pad = n => String(n).padStart(2, '0');

  // Les collections se lisent par `_collRef` ou par leur nom nu, jamais par
  // `window` (piège n°8 du dépôt).
  const ccListe = () => (typeof window._collRef === 'function' ? window._collRef('ccControles') : null) || [];
  const ccUser = () => (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null;
  const ccStaff = () => (typeof staffDB !== 'undefined' && Array.isArray(staffDB)) ? staffDB : [];
  const ccSave = () => { try { if (typeof saveNow === 'function') saveNow(); } catch (e) {} };
  const ccAdmin = () => { try { return typeof isAdmin === 'function' ? !!isAdmin() : false; } catch (e) { return false; } };

  // Les quatre écarts du pointage, dans l'ordre où la responsable les rencontre.
  const CC_PROBS = [
    { k: 'remise',   lbl: 'Remise' },
    { k: 'ug',       lbl: 'UG' },
    { k: 'quantite', lbl: 'Quantité' },
    { k: 'prix',     lbl: 'Prix' }
  ];
  const CC_HISTO_JOURS = 30;

  let ccHistoOuvert = false;

  // ── Le numéro de commande ─────────────────────────────────────────────────
  // Six chiffres, et ceux d'aujourd'hui commencent par 17. On NE REFUSE PAS un
  // numéro qui ne commence pas par 17 : la numérotation finira par franchir
  // 179999, et un module qui refuserait ce jour-là serait un module qu'on
  // contourne. On demande confirmation, ce qui attrape la faute de frappe sans
  // interdire l'avenir.
  function ccNumCanon(n) {
    return String(n == null ? '' : n).replace(/\D/g, '').slice(0, 6);
  }
  function ccNumValide(n) {
    return /^\d{6}$/.test(ccNumCanon(n));
  }
  function ccNumAttendu(n) {
    return /^17\d{4}$/.test(ccNumCanon(n));
  }

  // ── Ce qui cloche ─────────────────────────────────────────────────────────
  function ccProbs(c) {
    return CC_PROBS.filter(p => c && c[p.k] === true);
  }
  function ccSansProbleme(c) {
    return ccProbs(c).length === 0;
  }

  // ── Qui recontrôle ────────────────────────────────────────────────────────
  // Les destinataires sont les ADMINISTRATEURS, pas deux identifiants écrits en
  // dur. Anouck et Olivier le sont ; le jour où la répartition change, la liste
  // suit toute seule au lieu de mentir.
  function ccDestinataires(staff) {
    const l = Array.isArray(staff) ? staff : [];
    const marques = l.filter(function (s) {
      if (!s) return false;
      if (typeof staffIsAdmin === 'function') { try { return !!staffIsAdmin(s); } catch (e) {} }
      return s.admin === true;
    });
    if (marques.length) return marques;
    // Le repli du dépôt quand personne n'est encore marqué administrateur.
    return l.filter(s => s && (s.id === 'OF' || s.id === 'AF'));
  }

  // ── L'état d'une ligne ────────────────────────────────────────────────────
  function ccVu(c) {
    return !!(c && c.vuLe);
  }
  // LECTURE AU LIEU DE MIGRATION (piège n°7) : une ligne sans destinataire est
  // une ligne adressée à personne. On ne lui en invente pas un.
  function ccPour(c) {
    return (c && c.pour) ? String(c.pour) : '';
  }
  function ccEstPourMoi(c, uid) {
    return !!uid && ccPour(c) === uid;
  }
  // Le bouton « Vu » n'appartient qu'au destinataire, et aux administrateurs
  // pour qu'une absence ne bloque pas la liste. Les autres lisent.
  function ccPeutMarquer(c, uid, admin) {
    return !!c && (ccEstPourMoi(c, uid) || !!admin);
  }

  function ccMarquer(c, uid, maintenant) {
    if (!c) return;
    const now = Number(maintenant) || Date.now();
    if (ccVu(c)) { c.vuLe = null; c.vuPar = ''; }
    else { c.vuLe = now; c.vuPar = uid || ''; }
    c.updatedAt = now;
  }

  // ── Le classement ─────────────────────────────────────────────────────────
  function ccTrier(l) {
    return (Array.isArray(l) ? l : []).slice().sort((a, b) => (Number(b && b.le) || 0) - (Number(a && a.le) || 0));
  }
  // À REVOIR : les miennes d'abord. Celui qui ouvre l'écran vient y chercher ce
  // qu'on attend de lui, pas l'état général du service.
  function ccARevoir(liste, uid) {
    const l = ccTrier((Array.isArray(liste) ? liste : []).filter(c => c && !ccVu(c)));
    return { miennes: l.filter(c => ccEstPourMoi(c, uid)),
             autres: l.filter(c => !ccEstPourMoi(c, uid)) };
  }
  function ccHistorique(liste, maintenant) {
    const now = Number(maintenant) || Date.now();
    const seuil = now - CC_HISTO_JOURS * 86400000;
    const vues = ccTrier((Array.isArray(liste) ? liste : []).filter(ccVu))
      .sort((a, b) => (Number(b.vuLe) || 0) - (Number(a.vuLe) || 0));
    return { recentes: vues.filter(c => (Number(c.vuLe) || 0) >= seuil),
             anciennes: vues.filter(c => (Number(c.vuLe) || 0) < seuil).length };
  }
  // Un même numéro saisi deux fois n'est pas interdit — une commande peut être
  // recontrôlée. Mais tant que le premier contrôle n'a pas été vu, c'est plus
  // probablement une saisie en double, et on le demande.
  function ccDoublon(liste, num) {
    const n = ccNumCanon(num);
    return (Array.isArray(liste) ? liste : []).find(c => c && ccNumCanon(c.num) === n && !ccVu(c)) || null;
  }
  function ccCompteurPour(liste, uid) {
    return (Array.isArray(liste) ? liste : []).filter(c => c && !ccVu(c) && ccEstPourMoi(c, uid)).length;
  }

  // ── Les gens et les heures ────────────────────────────────────────────────
  function ccInitiales(id) {
    const s = ccStaff().find(x => x && x.id === id);
    if (!s) return String(id || '').slice(0, 3).toUpperCase();
    const p = String(s.prenom || '').trim(), n = String(s.nom || '').trim();
    if (p || n) return ((p[0] || '') + (n[0] || '')).toUpperCase() || String(s.id || '');
    return String(s.id || '');
  }
  function ccPrenom(id) {
    const s = ccStaff().find(x => x && x.id === id);
    return s ? (s.prenom || s.id) : (id || '—');
  }
  function ccCouleur(id) {
    const s = ccStaff().find(x => x && x.id === id);
    return (s && s.col) ? s.col : '#8a8f98';
  }
  function ccQuand(ts) {
    if (!ts) return '';
    const d = new Date(Number(ts));
    const h = pad(d.getHours()) + 'h' + pad(d.getMinutes());
    return (d.toDateString() === new Date().toDateString())
      ? h : pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + ' ' + h;
  }
  // Le mois local, sans toISOString (piège n°3 : minuit rend la veille).
  function ccMoisDe(d) {
    const x = (d instanceof Date) ? d : new Date();
    return x.getFullYear() + '-' + pad(x.getMonth() + 1);
  }

  /* ══════════════════════════════════════════════════════════════════════════
     ÉCRITURES
     ══════════════════════════════════════════════════════════════════════════ */

  window.ccEnregistrer = function () {
    const lu = id => String((document.getElementById(id) || {}).value || '').trim();
    const coche = id => !!(document.getElementById(id) || {}).checked;
    const champ = document.getElementById('cc-num');
    const num = ccNumCanon(lu('cc-num'));

    if (!ccNumValide(num)) {
      alert('Le numéro de commande fait six chiffres.\n\nPar exemple 170412.');
      if (champ) champ.focus(); return;
    }
    if (!ccNumAttendu(num)
        && !confirm('Le numéro ' + num + ' ne commence pas par 17.\n\n'
                  + 'C\'est peut-être une faute de frappe. On l\'enregistre quand même ?')) {
      if (champ) champ.focus(); return;
    }
    const dest = lu('cc-pour');
    if (!dest) { alert('À qui s\'adresse cette commande ?'); return; }

    const deja = ccDoublon(ccListe(), num);
    if (deja && !confirm('La commande ' + num + ' a déjà été contrôlée le '
        + ccQuand(deja.le) + ' par ' + ccPrenom(deja.par) + ', et personne ne l\'a encore vue.\n\n'
        + 'Enregistrer un second contrôle ?')) return;

    const u = ccUser(), now = Date.now();
    ccListe().push({
      id: 'cc' + now.toString(36) + Math.random().toString(36).slice(2, 7),
      num: num, mois: ccMoisDe(new Date()),
      remise: coche('cc-p-remise'), ug: coche('cc-p-ug'),
      quantite: coche('cc-p-quantite'), prix: coche('cc-p-prix'),
      note: lu('cc-note').slice(0, 300), pour: dest,
      par: u ? u.id : '', le: now,
      vuPar: '', vuLe: null, updatedAt: now
    });

    // On vide la saisie, on garde le destinataire : la responsable enchaîne
    // souvent plusieurs commandes pour la même personne.
    if (champ) { champ.value = ''; champ.focus(); }
    CC_PROBS.forEach(function (p) {
      const e = document.getElementById('cc-p-' + p.k); if (e) e.checked = false;
    });
    const n = document.getElementById('cc-note'); if (n) n.value = '';

    ccSave(); ccRender();
    try { if (typeof logAction === 'function') logAction('Contrôle de commande', num + ' → ' + ccPrenom(dest)); } catch (e) {}
  };

  window.ccVoir = function (id) {
    const c = ccListe().find(x => x && x.id === id);
    if (!c) return;
    const u = ccUser();
    if (!ccPeutMarquer(c, u ? u.id : '', ccAdmin())) {
      alert('Cette commande est adressée à ' + ccPrenom(ccPour(c)) + '.'); return;
    }
    ccMarquer(c, u ? u.id : '', Date.now());
    ccSave(); ccRender();
  };

  window.ccSupprimer = function (id) {
    const l = ccListe();
    const i = l.findIndex(x => x && x.id === id);
    if (i < 0) return;
    const u = ccUser();
    // Celui qui a saisi peut défaire sa saisie ; un administrateur aussi.
    if (!ccAdmin() && !(u && l[i].par === u.id)) {
      alert('Seul l\'auteur de la saisie, ou un administrateur, peut la retirer.'); return;
    }
    if (!confirm('Retirer le contrôle de la commande ' + (l[i].num || '') + ' ?')) return;
    // La pierre tombale AVANT le retrait : sans elle, la ligne revient à la
    // prochaine resynchronisation, reposée par un autre poste.
    if (typeof markDeleted === 'function') markDeleted('ccControles', l[i].id);
    l.splice(i, 1);
    ccSave(); ccRender();
  };

  window.ccHistoBasculer = function () { ccHistoOuvert = !ccHistoOuvert; ccRender(true); };

  window.ccNumMasque = function (e) {
    if (e) e.value = ccNumCanon(e.value);
  };

  /* ══════════════════════════════════════════════════════════════════════════
     RENDU
     ══════════════════════════════════════════════════════════════════════════ */

  function ccLigne(c, uid, admin) {
    const probs = ccProbs(c);
    const ras = !probs.length;
    const vu = ccVu(c);
    return '<div class="cc-l' + (ras ? ' cc-ras' : '') + (vu ? ' cc-vue' : '') + '">'
      + '<div class="cc-l-h">'
      +   '<span class="cc-num">' + E(c.num || '') + '</span>'
      +   (ras ? '<span class="cc-ok">rien à signaler</span>'
              : '<span class="cc-pp">' + probs.map(p => '<span class="cc-p">' + E(p.lbl) + '</span>').join('') + '</span>')
      +   '<span class="cc-pour" title="Adressée à ' + E(ccPrenom(ccPour(c))) + '">'
      +     '<svg class="ico cc-fl"><use href="#ic-envoyer"></use></svg> ' + E(ccPrenom(ccPour(c))) + '</span>'
      + '</div>'
      + (c.note ? '<div class="cc-note">' + E(c.note) + '</div>' : '')
      + '<div class="cc-l-p">'
      +   '<span class="cc-qui" style="background:' + E(ccCouleur(c.par)) + '">' + E(ccInitiales(c.par)) + '</span>'
      +   '<span class="cc-t">contrôlée le ' + E(ccQuand(c.le)) + '</span>'
      +   (vu
            ? '<span class="cc-t cc-vt">vu par ' + E(ccPrenom(c.vuPar)) + ' · ' + E(ccQuand(c.vuLe)) + '</span>'
              + (ccPeutMarquer(c, uid, admin)
                  ? '<button class="cc-b cc-b-d" onclick="ccVoir(\'' + E(c.id) + '\')">Annuler « vu »</button>' : '')
            : (ccPeutMarquer(c, uid, admin)
                ? '<button class="cc-b cc-b-v" onclick="ccVoir(\'' + E(c.id) + '\')">Vu</button>'
                : '<span class="cc-t cc-att">en attente de ' + E(ccPrenom(ccPour(c))) + '</span>'))
      +   ((admin || (uid && c.par === uid))
            ? '<button class="cc-b cc-x" title="Retirer" onclick="ccSupprimer(\'' + E(c.id) + '\')">×</button>' : '')
      + '</div>'
      + '</div>';
  }

  // LE RENDU NE TOUCHE QU'AUX LISTES. La saisie vit à côté, posée une seule
  // fois à l'injection : ce qu'on y tape ne peut pas être effacé par la
  // resynchronisation des huit secondes (piège n°9).
  window.ccRender = function (delibere) {
    const z = document.getElementById('cc-listes');
    if (!z) return;
    const u = ccUser(), uid = u ? u.id : '';
    const admin = ccAdmin();
    const l = ccListe();
    const av = ccARevoir(l, uid);
    const h = ccHistorique(l, Date.now());

    let s = '';
    if (av.miennes.length) {
      s += '<div class="cc-g cc-g-moi">Pour vous — ' + av.miennes.length + ' à revoir</div>'
        + av.miennes.map(c => ccLigne(c, uid, admin)).join('');
    }
    if (av.autres.length) {
      s += '<div class="cc-g">' + (av.miennes.length ? 'Pour les autres' : 'À revoir')
        + ' — ' + av.autres.length + '</div>'
        + av.autres.map(c => ccLigne(c, uid, admin)).join('');
    }
    if (!av.miennes.length && !av.autres.length) {
      s += '<div class="cc-vide">Aucune commande en attente de relecture.</div>';
    }
    if (h.recentes.length || h.anciennes) {
      s += '<div class="cc-h"><button class="cc-h-t" onclick="ccHistoBasculer()">'
        + (ccHistoOuvert ? '▾' : '▸') + ' Déjà vues'
        + '<span class="cc-h-n">' + h.recentes.length + '</span></button>';
      if (ccHistoOuvert) {
        s += '<div class="cc-h-c">' + h.recentes.map(c => ccLigne(c, uid, admin)).join('')
          + (h.anciennes ? '<div class="cc-vide">' + h.anciennes + ' contrôle'
              + (h.anciennes > 1 ? 's' : '') + ' de plus de trente jours, conservé'
              + (h.anciennes > 1 ? 's' : '') + ' mais non affiché'
              + (h.anciennes > 1 ? 's' : '') + '.</div>' : '')
          + '</div>';
      }
      s += '</div>';
    }
    z.innerHTML = s;

    // La pastille du menu : combien de commandes attendent CETTE personne.
    const b = document.getElementById('cc-navb');
    if (b) {
      const n = ccCompteurPour(l, uid);
      b.textContent = n ? String(n) : '';
      b.style.display = n ? '' : 'none';
    }
  };

  // Le choix du destinataire se repose à chaque ouverture : la liste des
  // administrateurs peut avoir changé depuis le chargement de la page.
  window.ccOuvrir = function () {
    const sel = document.getElementById('cc-pour');
    if (sel) {
      const avant = sel.value;
      const dests = ccDestinataires(ccStaff());
      sel.innerHTML = '<option value="">À qui ?</option>'
        + dests.map(s => '<option value="' + E(s.id) + '">' + E(s.prenom || s.id) + '</option>').join('');
      if (avant && dests.some(s => s.id === avant)) sel.value = avant;
    }
    ccRender(true);
  };

  /* ══════════════════════════════════════════════════════════════════════════
     INJECTION
     ══════════════════════════════════════════════════════════════════════════ */

  const CC_SECTION =
    '<div class="card">'
    + '<div class="ch"><span class="ct">'
    +   '<svg class="ico"><use href="#ic-valider"></use></svg> Contrôle de commande</span></div>'
    + '<p class="cc-intro">La responsable note la commande qu\'elle vient de contrôler, coche ce qui '
    +   'cloche, et l\'adresse à qui recontrôlera le prix de vente.</p>'
    + '<div id="cc-saisie" class="cc-saisie">'
    +   '<div class="cc-s-1">'
    +     '<label class="cc-f"><span>N° de commande</span>'
    +       '<input type="text" id="cc-num" inputmode="numeric" maxlength="6" placeholder="170412" '
    +         'oninput="ccNumMasque(this)" '
    +         'onkeydown="if(event.key===\'Enter\'){event.preventDefault();ccEnregistrer();}"></label>'
    +     '<label class="cc-f"><span>Pour</span><select id="cc-pour"><option value="">À qui ?</option></select></label>'
    +   '</div>'
    +   '<div class="cc-s-2"><span class="cc-s-l">Ce qui cloche</span>'
    +     CC_PROBS.map(p => '<label class="cc-c"><input type="checkbox" id="cc-p-' + p.k + '">'
    +       '<span>' + p.lbl + '</span></label>').join('')
    +   '</div>'
    +   '<div class="cc-s-3">'
    +     '<input type="text" id="cc-note" maxlength="300" placeholder="Précision (facultatif) — remise à 24 % au lieu de 30 %…" '
    +       'onkeydown="if(event.key===\'Enter\'){event.preventDefault();ccEnregistrer();}">'
    +     '<button class="btn bp" onclick="ccEnregistrer()">Enregistrer le contrôle</button>'
    +   '</div>'
    + '</div>'
    + '<div id="cc-listes"></div>'
    + '</div>';

  const CC_CSS = `
  .cc-intro{color:var(--gray-500,#7a8089);font-size:.84rem;margin:-4px 0 14px}
  .cc-saisie{border:1px solid var(--gray-200,#e7eaee);border-radius:11px;padding:13px 15px;
             margin-bottom:18px;background:var(--gray-50,#fafbfc)}
  .cc-s-1{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:11px}
  .cc-f{display:flex;flex-direction:column;gap:3px;font-size:.73rem;color:var(--gray-500,#7a8089);font-weight:600}
  .cc-f input,.cc-f select{padding:8px 11px;border:1px solid var(--gray-300,#d7dade);border-radius:8px;font-size:.95rem}
  #cc-num{width:7.5rem;font-variant-numeric:tabular-nums;letter-spacing:.09em;font-weight:700}
  .cc-s-2{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-bottom:11px}
  .cc-s-l{font-size:.73rem;color:var(--gray-500,#7a8089);font-weight:600;margin-right:4px}
  .cc-c{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--gray-300,#d7dade);
        background:#fff;border-radius:20px;padding:5px 12px 5px 9px;font-size:.84rem;cursor:pointer}
  .cc-c:hover{border-color:var(--g-mid,#2E7D54)}
  .cc-c input{width:15px;height:15px;cursor:pointer}
  .cc-c:has(input:checked){background:#FDECEA;border-color:#e8a9a2;color:#8a2a22;font-weight:600}
  .cc-s-3{display:flex;gap:9px;flex-wrap:wrap}
  .cc-s-3 input{flex:1 1 300px;min-width:200px;padding:8px 11px;border:1px solid var(--gray-300,#d7dade);
                border-radius:8px;font-size:.88rem}
  .cc-g{font-size:.72rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase;
        color:var(--gray-500,#7a8089);margin:18px 0 8px;padding-bottom:4px;
        border-bottom:1px solid var(--gray-200,#e7eaee)}
  .cc-g-moi{color:var(--g-dark,#1D5C3A);border-bottom-color:var(--g-mid,#2E7D54)}
  .cc-l{border:1px solid var(--gray-200,#e7eaee);border-left:3px solid #C79A00;border-radius:9px;
        padding:10px 13px;margin-bottom:8px;background:#fff}
  .cc-ras{border-left-color:var(--g-mid,#2E7D54)}
  .cc-vue{opacity:.62;border-left-color:var(--gray-300,#d7dade)}
  .cc-l-h{display:flex;align-items:center;gap:11px;flex-wrap:wrap}
  .cc-num{font-size:1.05rem;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:.06em}
  .cc-pp{display:flex;gap:5px;flex-wrap:wrap}
  .cc-p{background:#FDECEA;color:#8a2a22;border:1px solid #f3c9c5;border-radius:20px;
        padding:2px 9px;font-size:.72rem;font-weight:700}
  .cc-ok{background:#E6F2EA;color:var(--g-dark,#1D5C3A);border-radius:20px;padding:2px 10px;
         font-size:.72rem;font-weight:600}
  .cc-pour{margin-left:auto;font-size:.76rem;color:var(--gray-600,#5b6169);display:inline-flex;
           align-items:center;gap:5px;white-space:nowrap}
  .cc-fl{width:13px;height:13px;opacity:.55}
  .cc-note{margin:7px 0 0;font-size:.86rem;color:var(--gray-700,#3f454c);
           border-left:2px solid var(--gray-200,#e7eaee);padding-left:9px}
  .cc-l-p{display:flex;align-items:center;gap:9px;margin-top:9px;flex-wrap:wrap}
  .cc-qui{display:inline-flex;align-items:center;justify-content:center;min-width:26px;height:21px;
          padding:0 6px;border-radius:20px;color:#fff;font-size:.66rem;font-weight:800}
  .cc-t{font-size:.74rem;color:var(--gray-500,#7a8089)}
  .cc-vt{color:var(--g-dark,#1D5C3A);font-weight:600}
  .cc-att{font-style:italic}
  .cc-b{margin-left:auto;border-radius:7px;padding:5px 14px;font-size:.8rem;font-weight:700;
        cursor:pointer;border:1px solid transparent}
  .cc-b-v{background:var(--g-mid,#2E7D54);color:#fff}
  .cc-b-v:hover{background:var(--g-dark,#1D5C3A)}
  .cc-b-d{background:#fff;border-color:var(--gray-300,#d7dade);color:var(--gray-600,#5b6169);font-weight:600}
  .cc-x{margin-left:0;background:transparent;border-color:transparent;color:var(--gray-400,#9aa0a8);
        padding:4px 9px;font-size:1rem}
  .cc-x:hover{color:#B3261E;border-color:#f3c9c5;background:#fff}
  .cc-vide{padding:18px 4px;color:var(--gray-500,#7a8089);font-size:.88rem}
  .cc-h{margin-top:22px;border-top:1px solid var(--gray-200,#e7eaee);padding-top:12px}
  .cc-h-t{background:transparent;border:none;font-size:.8rem;font-weight:700;color:var(--gray-600,#5b6169);
          cursor:pointer;padding:4px 0;display:flex;align-items:center;gap:8px}
  .cc-h-n{background:var(--gray-100,#f2f4f6);border-radius:20px;padding:1px 9px;font-size:.72rem}
  .cc-h-c{margin-top:10px}
  @media print{.cc-saisie,.cc-b,.cc-x,.cc-h-t{display:none}}
  `;

  function ccInject() {
    if (document.getElementById('cc-css')) return;
    const st = document.createElement('style');
    st.id = 'cc-css'; st.textContent = CC_CSS;
    document.head.appendChild(st);

    // SOUS-ENTRÉE DE « SUIVI ADMINISTRATIF ». `data-parent` suffit : c'est
    // `ordonnerSidebar` qui ramène la ligne sous son parent à chaque passage,
    // et qui la masque si le parent l'est.
    const ref = document.querySelector('.sb-item[data-sec="suiviadmin"]');
    if (ref && !document.querySelector('.sb-item[data-sec="ctrlcmd"]')) {
      const b = document.createElement('button');
      b.className = 'sb-item sb-sub';
      b.setAttribute('data-sec', 'ctrlcmd');
      b.setAttribute('data-parent', 'suiviadmin');
      b.setAttribute('onclick', "showSec('ctrlcmd',this)");
      b.innerHTML = '<svg class="ico sb-ico"><use href="#ic-valider"></use></svg>'
        + '<span class="sb-label">Contrôle de commande</span>'
        + '<span class="sb-badge" id="cc-navb" style="display:none"></span>';
      ref.insertAdjacentElement('afterend', b);
    }

    const secRef = document.getElementById('sec-livraisons');
    if (secRef && !document.getElementById('sec-ctrlcmd')) {
      const sec = document.createElement('section');
      sec.id = 'sec-ctrlcmd'; sec.className = 'sec';
      sec.innerHTML = CC_SECTION;
      secRef.parentNode.appendChild(sec);
      window.ccOuvrir();
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ccInject);
  else ccInject();
}());
