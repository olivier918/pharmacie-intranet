/* ═══════════════════════════════════════════════════════════════════════════
   COMMANDES À PASSER — l'écran du matin

   On ouvre PILOT, on regarde chez qui il faut appeler, et on appelle. Rien
   d'autre. C'est pourquoi la page est classée PAR LABORATOIRE et non par
   produit : on passe un appel par laboratoire, pas un par référence.

   LA PAGE EST OUVERTE À TOUTE L'ÉQUIPE, et marquer « commande passée » aussi.
   Le nom est enregistré — c'est une trace, pour savoir qui a appelé, pas un
   droit qu'on retirerait à quelqu'un.

   AUCUNE COMMANDE N'EST JAMAIS PASSÉE D'ICI. Le module dit chez qui appeler et
   à quel point c'est pressé. Le reste est un geste humain, au téléphone.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const ICO = { rouge: '🔴', orange: '🟠', gris: '⚪', relance: '🔁' };
  const MOT = { rouge: 'urgent', orange: 'à commander', gris: 'pas pressé', relance: 'à relancer' };
  const ORDRE = ['rouge', 'orange', 'gris', 'relance'];

  let coEtat = null, coFiltre = '', coUrgence = '';

  function E(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }
  function coUser() { return (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null; }
  function coAdmin() { return typeof isAdmin === 'function' ? isAdmin() : false; }
  function coNb(v) { const n = Number(v); return isFinite(n) ? n : null; }

  function coDateCourte(d) {
    return new Date(d).toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long' });
  }

  // ── Le chargement ─────────────────────────────────────────────────────────
  async function coCharger() {
    const r = await fetch('/api/commandes/courant', { cache: 'no-store' });
    const j = await r.json();
    if (!j || !j.ok) throw new Error((j && j.error) || 'liste indisponible');
    coEtat = j.synthese;
  }

  // ── L'en-tête ─────────────────────────────────────────────────────────────
  //
  // UNE SYNTHÈSE VIEILLE AFFICHÉE SEREINEMENT EST PIRE QU'UNE PAGE VIDE. Si le
  // courriel du matin n'est pas arrivé, on regarderait les ruptures d'avant-
  // hier en croyant voir celles du jour — et on commanderait à côté.
  const PERIME_H = 36;
  function coEntete() {
    if (!coEtat) return '';
    const d = new Date(coEtat.date);
    const age = (Date.now() - (+d)) / 3600e3;
    const n = {};
    coEtat.labos.forEach(function (l) { n[l.urgence] = (n[l.urgence] || 0) + 1; });
    const prod = coEtat.labos.reduce(function (t, l) { return t + l.produits.length; }, 0);

    let h = '<div class="co-tete">'
      + '<div><div class="co-t-d">Synthèse ASCA du ' + E(coDateCourte(coEtat.date)) + '</div>'
      + '<div class="co-t-s">' + coEtat.labos.length + ' laboratoires · ' + prod + ' produits</div></div>'
      + '<div class="co-puces">' + ORDRE.map(function (u) {
          return '<button type="button" class="co-puce' + (coUrgence === u ? ' on' : '')
               + ' co-p-' + u + '" onclick="coFiltrerUrgence(\'' + u + '\')">'
               + ICO[u] + ' <b>' + (n[u] || 0) + '</b> <span>' + MOT[u] + '</span></button>';
        }).join('') + '</div></div>';

    if (age > PERIME_H) {
      h += '<div class="co-alerte">⚠ Cette synthèse a ' + Math.round(age / 24) + ' jour(s). '
         + 'Le courriel du matin n’est peut-être pas arrivé — <b>ce ne sont pas les ruptures '
         + 'd’aujourd’hui</b>.</div>';
    }
    const ctrl = (coEtat.erreurs || []).filter(function (e) { return e.controle; });
    if (ctrl.length) {
      h += '<div class="co-alerte">⚠ Le compte ne correspond pas à ce qu’annonce le courriel : '
         + ctrl.map(function (e) { return E(e.controle); }).join(' · ')
         + '. <b>La liste est peut-être incomplète</b> — le format d’ASCA a pu changer.</div>';
    }
    const nl = (coEtat.erreurs || []).filter(function (e) { return e.ligne; });
    if (nl.length) h += '<div class="co-avert">' + nl.length + ' ligne(s) non lue(s) dans les PDF.</div>';
    return h;
  }

  // ── Une carte de laboratoire ──────────────────────────────────────────────
  function coCarte(l) {
    const faits = l.produits.filter(function (p) { return p.statut === 'commandee'; }).length;
    const tous = faits === l.produits.length;
    return '<div class="co-l co-l-' + l.urgence + (tous ? ' fait' : '') + '">'
      + '<div class="co-l-h"><span class="co-l-u">' + ICO[l.urgence] + '</span>'
      +   '<span class="co-l-n">' + E(l.labo || '❓ Laboratoire à identifier') + '</span>'
      +   '<span class="co-l-c">' + l.produits.length + '</span></div>'
      + l.produits.map(coProduit).join('')
      + '</div>';
  }

  function coProduit(p) {
    const d = [];
    if (p.moy != null) d.push(p.moy.toFixed(2).replace('.', ',') + '/mois');
    if (p.d && p.d.aCder) d.push('ASCA suggère ' + E(p.d.aCder));
    if (p.stock != null && p.stock < 0) d.push('stock ' + p.stock);
    if (p.urgence === 'relance') {
      d.push('livraison prévue ' + E((p.d && p.d.dtLiv) || '?')
           + (p.retard > 0 ? ' · <b>' + p.retard + ' j de retard</b>' : ''));
    }
    const st = p.statut === 'commandee' ? ' cmd' : p.statut === 'ignoree' ? ' ign' : '';
    return '<div class="co-p' + st + '" data-code="' + E(p.code) + '">'
      + '<div class="co-p-c"><div class="co-p-n">' + E(p.nom) + '</div>'
      +   '<div class="co-p-d">' + ICO[p.urgence] + ' ' + d.join(' · ')
      +   (p.statut === 'commandee' ? ' · <b>commandé par ' + E(coPrenom(p.statutPar)) + '</b>' : '')
      +   (p.statut === 'ignoree' ? ' · ignoré' : '') + '</div></div>'
      + '<div class="co-p-a">'
      +   '<button type="button" class="co-b' + (p.statut === 'commandee' ? ' on' : '') + '"'
      +     ' onclick="coMarquer(\'' + E(p.code) + '\',\'commandee\')"'
      +     ' title="Commande passée">✓</button>'
      +   '<button type="button" class="co-b' + (p.statut === 'ignoree' ? ' on' : '') + '"'
      +     ' onclick="coMarquer(\'' + E(p.code) + '\',\'ignoree\')" title="Ignorer">–</button>'
      + '</div></div>';
  }

  function coPrenom(id) {
    const l = (typeof window._collRef === 'function' ? window._collRef('staffDB') : null) || [];
    const s = l.find(function (x) { return x && x.id === id; });
    return s ? (s.prenom || s.id) : (id || '');
  }

  // ── Le rendu ──────────────────────────────────────────────────────────────
  window.coRender = function () {
    const z = document.getElementById('co-liste');
    if (!z) return;
    document.getElementById('co-entete').innerHTML = coEntete();
    if (!coEtat) {
      z.innerHTML = '<div class="co-vide">Aucune synthèse importée.<br>'
        + 'Déposez les PDF du courriel ASCA ci-dessus — la date est dans les fichiers, '
        + 'il n’y a rien à saisir.</div>';
      return;
    }
    const q = coFiltre.trim().toLowerCase();
    const l = coEtat.labos.filter(function (g) {
      if (coUrgence && g.urgence !== coUrgence) return false;
      if (!q) return true;
      return String(g.labo || '').toLowerCase().indexOf(q) >= 0
          || g.produits.some(function (p) { return String(p.nom || '').toLowerCase().indexOf(q) >= 0; });
    });
    z.innerHTML = l.length ? l.map(coCarte).join('')
      : '<div class="co-vide">Rien ne correspond à cette recherche.</div>';
  };

  window.coFiltrerUrgence = function (u) { coUrgence = (coUrgence === u) ? '' : u; window.coRender(); };
  window.coChercher = function () {
    const i = document.getElementById('co-q');
    coFiltre = i ? i.value : '';
    window.coRender();
  };

  // ── Marquer ───────────────────────────────────────────────────────────────
  // Recliquer sur un marquage le retire : c'est la seule façon de revenir sur
  // une erreur, et elle doit être aussi simple que le geste lui-même.
  window.coMarquer = async function (code, statut) {
    if (!coUser()) return;
    let p = null;
    coEtat.labos.forEach(function (l) {
      l.produits.forEach(function (x) { if (x.code === code) p = x; });
    });
    if (!p) return;
    const neuf = (p.statut === statut) ? 'a_faire' : statut;
    try {
      const r = await fetch('/api/commandes/statut', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code, statut: neuf, syntheseId: coEtat.id })
      });
      const j = await r.json();
      if (!j.ok) { coMsg(j.error || 'refusé', true); return; }
      p.statut = neuf === 'a_faire' ? null : neuf;
      p.statutPar = neuf === 'a_faire' ? null : (coUser() || {}).id;
      window.coRender();
    } catch (e) { coMsg('Enregistrement impossible : ' + e.message, true); }
  };

  function coMsg(t, err) {
    const z = document.getElementById('co-msg');
    if (!z) return;
    z.textContent = t; z.className = 'co-msg' + (err ? ' ko' : ' ok');
    setTimeout(function () { if (z.textContent === t) { z.textContent = ''; z.className = 'co-msg'; } }, 6000);
  }

  // ── L'import ──────────────────────────────────────────────────────────────
  //
  // LES PDF PARTENT EN BASE64 DANS LE CORPS JSON. Pas de traitement multipart,
  // donc pas de dépendance de plus : ces fichiers pèsent cinquante kilooctets.
  // On envoie les huit pièces jointes sans trier — le serveur reconnaît les
  // trois qu'il sait lire par leur nom, et ignore les autres.
  window.coImporter = async function (input) {
    const f = [...(input.files || [])];
    if (!f.length) return;
    coMsg('Lecture de ' + f.length + ' fichier(s)…', false);
    try {
      const fichiers = await Promise.all(f.map(function (x) {
        return new Promise(function (ok, ko) {
          const r = new FileReader();
          r.onload = function () { ok({ nom: x.name, b64: String(r.result).split(',')[1] }); };
          r.onerror = function () { ko(new Error('illisible : ' + x.name)); };
          r.readAsDataURL(x);
        });
      }));
      const r = await fetch('/api/commandes/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fichiers: fichiers })
      });
      const j = await r.json();
      if (!j.ok) { coMsg(j.error || 'import refusé', true); return; }
      await coCharger(); window.coRender();
      coMsg('Synthèse du ' + new Date(j.resultat.date).toLocaleDateString('fr-FR')
          + ' importée — ' + j.resultat.lignes + ' lignes.', false);
    } catch (e) { coMsg('Import impossible : ' + e.message, true); }
    finally { input.value = ''; }
  };

  // ── L'export : ce qu'on emporte au téléphone ──────────────────────────────
  window.coCopier = function () {
    if (!coEtat) return;
    const t = coEtat.labos.filter(function (l) { return l.urgence !== 'gris'; }).map(function (l) {
      return ICO[l.urgence] + ' ' + (l.labo || 'à identifier') + ' — '
           + l.produits.filter(function (p) { return p.urgence !== 'gris'; })
               .map(function (p) { return p.nom; }).join(', ');
    }).join('\n');
    try { navigator.clipboard.writeText(t); coMsg('Liste copiée.', false); }
    catch (e) { coMsg('Copie impossible sur ce poste.', true); }
  };

  window.coRafraichir = async function () {
    try { await coCharger(); window.coRender(); }
    catch (e) {
      const z = document.getElementById('co-liste');
      if (z) z.innerHTML = '<div class="co-vide">Liste indisponible : ' + E(e.message) + '</div>';
    }
  };

  const CO_SECTION =
    '<div class="card">'
  +   '<div class="ch"><span class="ct"><svg class="ico"><use href="#ic-commandes"></use></svg> '
  +     'Commandes à passer</span>'
  +     '<div style="display:flex;gap:7px;flex-wrap:wrap">'
  +       '<label class="btn bs sm no-print" style="cursor:pointer;margin:0">'
  +         'Importer les PDF ASCA'
  +         '<input type="file" accept="application/pdf,.pdf" multiple hidden onchange="coImporter(this)">'
  +       '</label>'
  +       '<button class="btn bs sm no-print" onclick="coCopier()">Copier la liste</button>'
  +       '<button class="btn bs sm no-print" onclick="window.print()">Imprimer</button>'
  +     '</div></div>'
  +   '<div id="co-msg" class="co-msg"></div>'
  +   '<div id="co-entete"></div>'
  +   '<div class="fbar"><input type="text" id="co-q" class="ctl-search" data-rc="recherche"'
  +     ' placeholder="Rechercher un laboratoire ou un produit…" oninput="coChercher()"'
  +     ' style="flex:1;min-width:200px"></div>'
  +   '<div id="co-liste"></div>'
  + '</div>';

  const CO_CSS = `
  .co-tete{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;
    flex-wrap:wrap;margin-bottom:12px}
  /* « capitalize » mettrait une majuscule a CHAQUE mot : « Du Lundi 28
     Septembre ». Seule la premiere lettre doit changer. */
  .co-t-d{font-size:1.02rem;font-weight:700;color:var(--g-dark,#1D5C3A)}
  .co-t-d::first-letter{text-transform:uppercase}
  .co-t-s{font-size:.82rem;color:var(--gray-500,#6b7280);margin-top:2px}
  .co-puces{display:flex;gap:7px;flex-wrap:wrap}
  .co-puce{border:1px solid var(--gray-200,#e5e7eb);background:#fff;border-radius:999px;
    padding:6px 13px;font:inherit;font-size:.82rem;cursor:pointer;display:flex;align-items:center;gap:5px}
  .co-puce b{font-size:.95rem}
  .co-puce span{color:var(--gray-500,#6b7280)}
  .co-puce:hover{border-color:#cdd8d1}
  .co-puce.on{background:var(--g-pale,#E8F5E9);border-color:var(--g-mid,#2E7D54);font-weight:700}
  .co-alerte{background:#FFF3E0;border:1px solid #E65100;border-left-width:5px;border-radius:9px;
    padding:10px 13px;font-size:.86rem;color:#7c3a00;margin-bottom:10px;line-height:1.5}
  .co-avert{font-size:.8rem;color:var(--gray-500,#6b7280);margin-bottom:10px}
  .co-msg{font-size:.85rem;min-height:0;margin-bottom:6px}
  .co-msg.ok{color:var(--g-dark,#1D5C3A)}
  .co-msg.ko{color:#C62828;font-weight:600}
  .co-vide{padding:26px 8px;text-align:center;color:var(--gray-500,#6b7280);font-size:.88rem;line-height:1.6}
  .co-l{border:1px solid #e7ece9;border-radius:12px;margin-bottom:10px;overflow:hidden}
  .co-l-rouge{border-left:5px solid #C62828}
  .co-l-orange{border-left:5px solid #E65100}
  .co-l-gris{border-left:5px solid #cdd8d1}
  .co-l-relance{border-left:5px solid #6A1B9A}
  .co-l.fait{opacity:.55}
  .co-l-h{display:flex;align-items:center;gap:9px;padding:10px 13px;background:#fafbfa;
    border-bottom:1px solid #eef2f0}
  .co-l-n{font-weight:700;font-size:.95rem;flex:1;min-width:0}
  .co-l-c{font-size:.75rem;color:var(--gray-500,#6b7280);background:#fff;border:1px solid #e7ece9;
    border-radius:999px;padding:1px 8px}
  .co-p{display:flex;align-items:center;gap:10px;padding:9px 13px;border-bottom:1px solid #f2f5f3}
  .co-p:last-child{border-bottom:none}
  .co-p-c{flex:1;min-width:0}
  .co-p-n{font-size:.89rem;font-weight:600}
  .co-p-d{font-size:.76rem;color:var(--gray-500,#6b7280);margin-top:2px}
  .co-p.cmd .co-p-n{text-decoration:line-through;color:var(--gray-500,#6b7280)}
  .co-p.ign{opacity:.5}
  .co-p-a{flex:none;display:flex;gap:5px}
  .co-b{width:30px;height:30px;border:1px solid #d8e2dc;background:#fff;border-radius:8px;
    cursor:pointer;font:inherit;font-size:.9rem;font-weight:700;color:#9bb0a4;line-height:1}
  .co-b:hover{border-color:var(--g-mid,#2E7D54);color:var(--g-dark,#1D5C3A)}
  .co-b.on{background:var(--g-mid,#2E7D54);border-color:var(--g-mid,#2E7D54);color:#fff}
  .co-b:focus-visible{outline:2px solid var(--g-mid,#2E7D54);outline-offset:1px}
  @media print{.co-puces,.co-p-a,.fbar,.co-msg{display:none}.co-l{break-inside:avoid}}
  `;

  function coInject() {
    if (document.getElementById('co-css')) return;
    const st = document.createElement('style');
    st.id = 'co-css'; st.textContent = CO_CSS;
    document.head.appendChild(st);

    // LA BARRE EST RECLASSÉE PAR ORDRE ALPHABÉTIQUE après l'injection : le point
    // d'insertion ne décide de rien, « Commandes » se rangera entre « Caisse »
    // et « Contrôle lits ». On s'accroche tout de même à Livraisons plutôt qu'à
    // la fin de la liste, pour que l'entrée existe même si le reclassement ne
    // passait pas — une entrée mal placée se trouve, une entrée absente, non.
    const ref = document.querySelector('.sb-item[data-sec="livraisons"]');
    if (ref && !document.querySelector('.sb-item[data-sec="commandes"]')) {
      const b = document.createElement('button');
      b.className = 'sb-item';
      b.setAttribute('data-sec', 'commandes');
      b.setAttribute('onclick', "showSec('commandes',this)");
      b.innerHTML = '<svg class="ico sb-ico"><use href="#ic-commandes"></use></svg>'
        + '<span class="sb-label">Commandes</span>';
      ref.insertAdjacentElement('afterend', b);
    }

    const secRef = document.getElementById('sec-livraisons');
    if (secRef && !document.getElementById('sec-commandes')) {
      const sec = document.createElement('section');
      sec.id = 'sec-commandes'; sec.className = 'sec';
      sec.innerHTML = CO_SECTION;
      secRef.parentNode.appendChild(sec);
      window.coRafraichir();
      if (typeof window.rcInfobulles === 'function') window.rcInfobulles();
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', coInject);
  else coInject();
}());
