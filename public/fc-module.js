/* ════════════════════════════════════════════════════════════════
   Module FICHES CONSEIL — impression rapide de fiches par thématique.
   Isolé (préfixe fc / fc-) pour ne rien casser dans l'existant.
   Les fiches sont des PDF servis depuis public/documents/fiches/.
   Ajouter une série = déposer les PDF + ajouter un objet dans FC_THEMES.
   ════════════════════════════════════════════════════════════════ */
(function () {
  function fcEsc(s) { return (s == null ? '' : String(s)).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  // ---------- Configuration des thématiques ----------
  // serie  : PDF regroupant toutes les fiches (impression en un clic). Optionnel.
  // fiches : file = chemin du PDF ; tone = couleur de la vignette.
  const FC_THEMES = [
    {
      id: 'aod', label: 'Entretiens AOD', sub: 'Anticoagulant oral direct',
      serie: 'documents/fiches/aod-entretiens.pdf',
      fiches: [
        { n: '1', titre: 'Évaluation et observance', desc: 'Prise du traitement, carte anticoagulant, vigilance au quotidien.', file: 'documents/fiches/aod-1.pdf', tone: 'green' },
        { n: '2', titre: 'Effets du traitement', desc: 'Signes de sur et sous-dosage, risque hémorragique, alerte 15.', file: 'documents/fiches/aod-2.pdf', tone: 'amber' },
        { n: '3', titre: 'Surveillance et vie quotidienne', desc: 'Fonction rénale, poids, déshydratation, points de vigilance.', file: 'documents/fiches/aod-3.pdf', tone: 'blue' }
      ]
    }
    // À venir : Entretiens AVK · Entretiens Asthme · Relevé de mesure tensionnelle
    //           · Fiches allaitement · Fièvre de l'enfant …
  ];
  const FC_TONES = {
    green: { bg: '#EAF3DE', fg: '#3B6D11' }, amber: { bg: '#FAEEDA', fg: '#854F0B' },
    blue: { bg: '#E6F1FB', fg: '#185FA5' }, teal: { bg: '#E1F5EE', fg: '#0F6E56' },
    pink: { bg: '#FBEAF0', fg: '#993556' }, purple: { bg: '#EEEDFE', fg: '#534AB7' }
  };

  // ---------- CSS (scopé fc-) ----------
  const FC_CSS = `
  #sec-fiches{padding:0}
  .fc-wrap{max-width:1060px;margin:0 auto}
  .fc-bar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:16px}
  .fc-title{display:flex;align-items:center;gap:8px;font-size:18px;font-weight:700;color:#1D5C3A}
  .fc-grow{flex:1}
  .fc-inp{font-family:inherit;font-size:14px;border:1px solid #dfe8e2;border-radius:9px;outline:none;background:#fff;height:40px;padding:0 12px;max-width:230px;width:100%;color:#222}
  .fc-inp:focus{border-color:#1D5C3A}
  .fc-theme{margin-bottom:22px}
  .fc-thead{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;background:#f4f8f5;border:1px solid #e2ebe5;border-radius:12px;padding:11px 15px;margin-bottom:12px}
  .fc-tlabel{font-weight:700;font-size:15px;color:#1D5C3A}
  .fc-tsub{font-size:12.5px;color:#6b7a72;margin-top:2px}
  .fc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(215px,1fr));gap:12px}
  .fc-card{background:#fff;border:1px solid #e2ebe5;border-radius:12px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 1px 2px rgba(0,0,0,.03)}
  .fc-thumb{padding:12px}
  .fc-page{background:#fff;border-radius:6px;padding:10px 11px;min-height:82px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
  .fc-pn{font-size:10px;font-weight:700;letter-spacing:.4px}
  .fc-pt{font-size:11.5px;font-weight:600;color:#37413d;margin-top:3px}
  .fc-body{padding:11px 13px;display:flex;flex-direction:column;gap:8px;flex:1}
  .fc-ft{font-size:14px;font-weight:700;color:#222}
  .fc-fd{font-size:12.5px;color:#6b7a72;line-height:1.45;flex:1}
  .fc-acts{display:flex;gap:7px}
  .fc-btn{border:none;border-radius:8px;font-family:inherit;font-size:12.8px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:8px 11px}
  .fc-btn .ico{width:16px;height:16px}
  .fc-pri{background:#1D5C3A;color:#fff;flex:1}
  .fc-pri:hover{background:#164a2f}
  .fc-gh{background:#fff;border:1px solid #dfe8e2;color:#333;padding:8px 10px}
  .fc-gh:hover{background:#f2f6f3}
  .fc-serie{background:#1D5C3A;color:#fff}
  .fc-serie:hover{background:#164a2f}
  .fc-empty{color:#6b7a72;text-align:center;padding:40px;background:#fff;border:1px dashed #dfe8e2;border-radius:12px}
  `;

  // ---------- impression / aperçu ----------
  // Impression directe (un clic) via un iframe caché, même origine que le PDF.
  function fcPrint(url) {
    let f = document.getElementById('fc-print-frame');
    if (!f) { f = document.createElement('iframe'); f.id = 'fc-print-frame'; f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'; document.body.appendChild(f); }
    let done = false;
    f.onload = function () {
      if (done) return; done = true;
      setTimeout(function () { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { window.open(url, '_blank'); } }, 250);
    };
    if (f.getAttribute('src') === url) { f.onload(); } else { f.src = url; }
  }
  window.fcPrint = fcPrint;
  window.fcView = function (url) { window.open(url, '_blank'); };
  window.fcPrintSerie = function (id) { const t = FC_THEMES.find(x => x.id === id); if (t && t.serie) fcPrint(t.serie); };

  // ---------- rendu ----------
  function fcCard(f) {
    const c = FC_TONES[f.tone] || FC_TONES.green;
    return '<div class="fc-card">' +
      '<div class="fc-thumb" style="background:' + c.bg + '">' +
      '<div class="fc-page"><div class="fc-pn" style="color:' + c.fg + '">FICHE CONSEIL N°' + fcEsc(f.n) + '</div>' +
      '<div class="fc-pt">Mon traitement par AOD</div></div></div>' +
      '<div class="fc-body"><div class="fc-ft">' + fcEsc(f.titre) + '</div>' +
      '<div class="fc-fd">' + fcEsc(f.desc) + '</div>' +
      '<div class="fc-acts">' +
      '<button class="fc-btn fc-pri" onclick="fcPrint(\'' + f.file + '\')"><svg class="ico"><use href="#ic-imprimer"></use></svg> Imprimer</button>' +
      '<button class="fc-btn fc-gh" title="Aperçu" onclick="fcView(\'' + f.file + '\')"><svg class="ico"><use href="#ic-voir"></use></svg></button>' +
      '</div></div></div>';
  }
  function fcThemeHtml(t) {
    return '<div class="fc-theme"><div class="fc-thead">' +
      '<div><div class="fc-tlabel">' + fcEsc(t.label) + '</div><div class="fc-tsub">' + fcEsc(t.sub) + ' · ' + t.fiches.length + ' fiche' + (t.fiches.length > 1 ? 's' : '') + '</div></div>' +
      (t.serie ? '<button class="fc-btn fc-serie" onclick="fcPrintSerie(\'' + t.id + '\')"><svg class="ico"><use href="#ic-imprimer"></use></svg> Imprimer la série</button>' : '') +
      '</div><div class="fc-grid">' + t.fiches.map(fcCard).join('') + '</div></div>';
  }
  window.fcRender = function () {
    const wrap = document.getElementById('fc-listwrap'); if (!wrap) return;
    const el = document.getElementById('fc-search');
    const q = (el && el.value || '').trim().toLowerCase();
    const themes = FC_THEMES.map(t => {
      if (!q) return t;
      if (t.label.toLowerCase().includes(q)) return t;
      const fiches = t.fiches.filter(f => (f.titre + ' ' + f.desc).toLowerCase().includes(q));
      return fiches.length ? Object.assign({}, t, { fiches }) : null;
    }).filter(Boolean);
    wrap.innerHTML = themes.length ? themes.map(fcThemeHtml).join('') : '<div class="fc-empty">Aucune fiche ne correspond.</div>';
  };

  // ---------- gabarit + injection ----------
  const FC_SECTION = '<div class="fc-wrap">' +
    '<div class="fc-bar"><div class="fc-title"><svg class="ico"><use href="#ic-document"></use></svg> Fiches Conseil</div>' +
    '<span class="fc-grow"></span>' +
    '<input class="fc-inp" id="fc-search" placeholder="Rechercher une fiche…" oninput="fcRender()"></div>' +
    '<div id="fc-listwrap"></div></div>';

  function fcInject() {
    if (document.getElementById('fc-css')) return;
    const st = document.createElement('style'); st.id = 'fc-css'; st.textContent = FC_CSS; document.head.appendChild(st);
    // bouton de navigation (après Renouvellement, sinon Préparations / Livraisons)
    const navRef = document.querySelector('.sb-item[data-sec="renouvellement"]') || document.querySelector('.sb-item[data-sec="preparations"]') || document.querySelector('.sb-item[data-sec="livraisons"]');
    if (navRef && !document.querySelector('.sb-item[data-sec="fiches"]')) {
      const b = document.createElement('button');
      b.className = 'sb-item'; b.setAttribute('data-sec', 'fiches');
      b.setAttribute('onclick', "showSec('fiches',this)");
      b.innerHTML = '<svg class="ico sb-ico"><use href="#ic-document"></use></svg><span class="sb-label">Fiches Conseil</span>';
      navRef.insertAdjacentElement('afterend', b);
    }
    // section
    const secRef = document.getElementById('sec-livraisons');
    if (secRef && !document.getElementById('sec-fiches')) {
      const sec = document.createElement('section');
      sec.id = 'sec-fiches'; sec.className = 'sec'; sec.innerHTML = FC_SECTION;
      secRef.parentNode.appendChild(sec);
      window.fcRender();
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fcInject);
  else fcInject();
})();
