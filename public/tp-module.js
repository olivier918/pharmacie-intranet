/* ════════════════════════════════════════════════════════════════════════════
   Module TEMPÉRATURES — suivi des armoires réfrigérées

   La demande tenait en une phrase : « consulter plus simplement mes relevés
   avec quatre graphes superposés sur une seule page ». Tout part de là — une
   page, quatre courbes, pas de navigation entre quatre écrans.

   La règle qui gouverne l'affichage : le module doit dire bruyamment quand ses
   données sont vieilles, plutôt que d'afficher sereinement la dernière valeur
   connue. Une armoire non rafraîchie passe EN GRIS, jamais en vert. Un écran
   vert sur des données figées est plus dangereux que pas d'écran du tout.

   Les mesures ne sont pas dans le blob : elles arrivent par /api/temp/mesures.
   Ce fichier n'ajoute donc AUCUNE rubrique synchronisée (piège n°4).
   Cadrage : projet Claude, « Module Temperatures - cadrage ».
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ── Les seuils ────────────────────────────────────────────────────────────
  // 2 à 8 °C. Le seuil bas n'était pas dans la demande initiale : un frigo qui
  // descend vers 0 °C congèle les vaccins et les détruit en silence, sans
  // qu'aucune alarme de chaleur ne sonne.
  const TP_MIN = 2, TP_MAX = 8;

  // Palette vérifiée pour les daltonismes (protanopie, deutéranopie,
  // tritanopie) sur fond clair : écart minimal ΔE 13,8 entre voisines. Ne pas
  // la retoucher à l'œil — une paire indistinguable rend les quatre courbes
  // illisibles pour une personne sur douze.
  const TP_COULEURS = ['#1D4ED8', '#EA580C', '#0D9488', '#9333EA'];

  const TP_PLAGES = {
    '24h': { lbl: '24 heures', ms: 24 * 3600e3 },
    '7j':  { lbl: '7 jours',   ms: 7 * 24 * 3600e3 },
    '30j': { lbl: '30 jours',  ms: 30 * 24 * 3600e3 }
  };
  let tpPlage = '24h';
  let tpDonnees = null;      // { series:[{nom,couleur,pts:[{t,v}]}], debut, fin }
  let tpEtat = null;
  let tpSurvol = null;       // index temporel survolé

  // Au-delà de 45 minutes sans mesure, on ne prétend plus savoir.
  const TP_PERIME_MS = 45 * 60e3;

  const TP_CSS = `
  #sec-temperatures{padding:0}
  .tp-wrap{padding:18px 22px 28px}
  .tp-tuiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:18px}
  .tp-tuile{background:#fff;border:1px solid #e6e4dc;border-radius:12px;padding:12px 14px;position:relative}
  .tp-tuile .tp-nom{font-size:12px;color:#6b7a72;letter-spacing:.02em;display:flex;align-items:center;gap:7px}
  .tp-pastille{width:9px;height:9px;border-radius:50%;flex:0 0 auto}
  .tp-tuile .tp-val{font-size:27px;font-weight:600;color:#1a1a1a;margin-top:5px;letter-spacing:-.02em}
  .tp-tuile .tp-val .u{font-size:15px;font-weight:400;color:#888780;margin-left:2px}
  .tp-tuile .tp-hre{font-size:11px;color:#888780;margin-top:2px}
  .tp-tuile.vieux{background:#f4f3ef}
  .tp-tuile.vieux .tp-val{color:#9a9a95}
  .tp-tuile.hors .tp-val{color:#C62828}
  .tp-bandeau{display:flex;gap:10px;align-items:flex-start;background:#FFF3E0;border:1px solid #E65100;
    border-radius:10px;padding:11px 14px;margin-bottom:16px;font-size:13px;color:#7c3a00;line-height:1.5}
  .tp-bandeau.grave{background:#fee2e2;border-color:#b91c1c;color:#7f1d1d}
  .tp-barre{display:flex;gap:8px;align-items:center;margin-bottom:14px;flex-wrap:wrap}
  .tp-onglet{border:1px solid #e6e4dc;background:#fff;border-radius:8px;padding:6px 14px;font-size:13px;
    color:#4a4a45;cursor:pointer;font-family:inherit}
  .tp-onglet.on{background:#1D5C3A;border-color:#1D5C3A;color:#fff}
  .tp-carte{background:#fff;border:1px solid #e6e4dc;border-radius:12px;padding:16px 18px 10px}
  .tp-legende{display:flex;gap:18px;flex-wrap:wrap;margin:2px 0 12px;font-size:12.5px;color:#4a4a45}
  .tp-legende span.c{display:inline-block;width:11px;height:3px;border-radius:2px;vertical-align:middle;margin-right:6px}
  .tp-svg{width:100%;height:auto;display:block;overflow:visible}
  .tp-svg .grille{stroke:#eeece4;stroke-width:1}
  .tp-svg .axe{fill:#888780;font-size:11px;font-family:inherit}
  .tp-svg .bande{fill:#1D5C3A;opacity:.045}
  .tp-svg .lim{stroke:#c9c6ba;stroke-width:1;stroke-dasharray:3 3}
  .tp-svg .ligne{fill:none;stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
  .tp-svg .curseur{stroke:#9a9a95;stroke-width:1}
  .tp-svg .etiq{font-size:11.5px;font-family:inherit;font-weight:600}
  .tp-info{font-size:12px;color:#888780;margin:8px 0 4px}
  .tp-bulle{position:absolute;pointer-events:none;background:#1a1a1a;color:#fff;border-radius:8px;
    padding:8px 11px;font-size:12px;line-height:1.6;z-index:60;white-space:nowrap;opacity:0;transition:opacity .1s}
  .tp-bulle .l{display:flex;gap:8px;justify-content:space-between}
  .tp-bulle .l i{font-style:normal;opacity:.75}
  .tp-vide{text-align:center;color:#888780;padding:44px 10px;font-size:14px}
  @media(max-width:700px){.tp-wrap{padding:14px}.tp-legende{gap:12px}}
  `;

  const TP_SECTION = `
  <div class="tp-wrap">
    <div id="tp-bandeau"></div>
    <div class="tp-tuiles" id="tp-tuiles"></div>
    <div class="tp-barre">
      ${Object.keys(TP_PLAGES).map(k =>
        `<button class="tp-onglet${k === '24h' ? ' on' : ''}" data-plage="${k}" onclick="tpChangerPlage('${k}')">${TP_PLAGES[k].lbl}</button>`
      ).join('')}
      <span style="flex:1"></span>
      <button class="tp-onglet" onclick="tpRafraichir(true)">Actualiser</button>
    </div>
    <div class="tp-carte" style="position:relative">
      <div class="tp-legende" id="tp-legende"></div>
      <div id="tp-zone"></div>
      <div class="tp-bulle" id="tp-bulle"></div>
      <div class="tp-info" id="tp-info"></div>
    </div>
  </div>`;

  // ── Outils ────────────────────────────────────────────────────────────────
  function tpHeure(d) {
    return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
  function tpDateCourte(d) {
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  }
  function tpDeg(v) { return (Math.round(v * 10) / 10).toString().replace('.', ','); }

  // Réduction du nombre de points pour les longues plages.
  // On ne fait PAS de moyenne : elle effacerait exactement ce qu'on cherche.
  // Chaque tranche garde son minimum ET son maximum, dans l'ordre où ils sont
  // survenus — un dépassement de dix minutes reste visible sur trente jours.
  function tpReduire(pts, cible) {
    if (pts.length <= cible) return pts;
    const parTranche = Math.ceil(pts.length / (cible / 2));
    const out = [];
    for (let i = 0; i < pts.length; i += parTranche) {
      const tr = pts.slice(i, i + parTranche);
      let lo = tr[0], hi = tr[0];
      for (const p of tr) { if (p.v < lo.v) lo = p; if (p.v > hi.v) hi = p; }
      if (lo === hi) out.push(lo);
      else if (lo.t < hi.t) out.push(lo, hi);
      else out.push(hi, lo);
    }
    return out;
  }

  // ── Chargement ────────────────────────────────────────────────────────────
  async function tpCharger() {
    const fin = new Date();
    const deb = new Date(fin.getTime() - TP_PLAGES[tpPlage].ms);
    const [rm, re] = await Promise.all([
      fetch('/api/temp/mesures?debut=' + deb.toISOString() + '&fin=' + fin.toISOString()).then(r => r.json()),
      fetch('/api/temp/etat').then(r => r.json())
    ]);
    tpEtat = re && re.ok ? re : null;
    if (!rm || !rm.ok) { tpDonnees = null; return; }

    const par = new Map();
    for (const m of rm.mesures) {
      if (!par.has(m.point)) par.set(m.point, []);
      par.get(m.point).push({ t: new Date(m.ts).getTime(), v: Number(m.valeur) });
    }
    // Ordre d'affichage stable : la couleur suit l'armoire, jamais son rang.
    // Sans cela, masquer un point repeindrait les autres.
    const noms = Array.from(par.keys()).sort();
    const cible = tpPlage === '24h' ? 4000 : 900;
    tpDonnees = {
      debut: deb.getTime(), fin: fin.getTime(),
      series: noms.map((n, i) => ({
        nom: n, couleur: TP_COULEURS[i % TP_COULEURS.length],
        pts: tpReduire(par.get(n).sort((a, b) => a.t - b.t), cible)
      }))
    };
  }

  // ── Les tuiles et le bandeau ──────────────────────────────────────────────
  function tpRendreTuiles() {
    const z = document.getElementById('tp-tuiles'); if (!z) return;
    const pts = (tpEtat && tpEtat.points) || [];
    if (!pts.length) { z.innerHTML = ''; return; }
    const maintenant = Date.now();
    const ordre = pts.slice().sort((a, b) => a.point.localeCompare(b.point));
    z.innerHTML = ordre.map((p, i) => {
      const t = new Date(p.derniere).getTime();
      const vieux = (maintenant - t) > TP_PERIME_MS;
      const v = Number(p.valeur);
      const hors = !vieux && (v > TP_MAX || v < TP_MIN);
      const coul = TP_COULEURS[i % TP_COULEURS.length];
      return `<div class="tp-tuile${vieux ? ' vieux' : ''}${hors ? ' hors' : ''}">
        <div class="tp-nom"><span class="tp-pastille" style="background:${vieux ? '#c9c6ba' : coul}"></span>${p.point}</div>
        <div class="tp-val">${vieux ? '—' : tpDeg(v) + '<span class="u">°C</span>'}</div>
        <div class="tp-hre">${vieux ? 'Aucune mesure depuis ' + tpHeure(new Date(t)) : 'à ' + tpHeure(new Date(t))}</div>
      </div>`;
    }).join('');
  }

  function tpRendreBandeau() {
    const z = document.getElementById('tp-bandeau'); if (!z) return;
    if (!tpEtat) { z.innerHTML = ''; return; }
    if (!tpEtat.configure) {
      z.innerHTML = `<div class="tp-bandeau grave"><span>⛔</span><div><b>Le relevé automatique n'est pas configuré.</b>
        Les identifiants de lecture Saveris manquent côté serveur : aucune mesure n'est collectée.</div></div>`;
      return;
    }
    const der = tpEtat.dernierTirage;
    const pts = tpEtat.points || [];
    const plusRecent = pts.reduce((m, p) => Math.max(m, new Date(p.derniere).getTime()), 0);
    const age = Date.now() - plusRecent;
    if (der && der.ok === false) {
      z.innerHTML = `<div class="tp-bandeau grave"><span>⛔</span><div><b>La dernière interrogation des sondes a échoué.</b>
        Les valeurs ci-dessous datent d'avant l'incident et ne reflètent pas l'état actuel des armoires.
        <span style="opacity:.75">(${(der.detail || '').slice(0, 140)})</span></div></div>`;
    } else if (plusRecent && age > TP_PERIME_MS) {
      z.innerHTML = `<div class="tp-bandeau"><span>⚠</span><div><b>Aucune mesure depuis ${Math.round(age / 60e3)} minutes.</b>
        Les sondes envoient normalement toutes les 15 minutes. Vérifiez la liaison avant de vous fier à cet écran.</div></div>`;
    } else { z.innerHTML = ''; }
  }

  // ── Le graphe ─────────────────────────────────────────────────────────────
  function tpRendreGraphe() {
    const zone = document.getElementById('tp-zone'); if (!zone) return;
    const leg = document.getElementById('tp-legende');
    if (!tpDonnees || !tpDonnees.series.length) {
      zone.innerHTML = '<div class="tp-vide">Aucune mesure sur cette période.</div>';
      if (leg) leg.innerHTML = ''; return;
    }
    const S = tpDonnees.series;
    if (leg) leg.innerHTML = S.map(s =>
      `<span><span class="c" style="background:${s.couleur}"></span>${s.nom}</span>`).join('');

    const L = 1000, H = 340;
    const mg = { g: 42, d: 74, h: 14, b: 30 };   // marge droite : les étiquettes de courbe
    const x0 = mg.g, x1 = L - mg.d, y0 = mg.h, y1 = H - mg.b;

    let vmin = TP_MIN, vmax = TP_MAX;
    S.forEach(s => s.pts.forEach(p => { if (p.v < vmin) vmin = p.v; if (p.v > vmax) vmax = p.v; }));
    vmin = Math.floor(vmin - 1); vmax = Math.ceil(vmax + 1);

    const T0 = tpDonnees.debut, T1 = tpDonnees.fin;
    const X = t => x0 + (t - T0) / (T1 - T0) * (x1 - x0);
    const Y = v => y1 - (v - vmin) / (vmax - vmin) * (y1 - y0);

    let svg = `<svg class="tp-svg" viewBox="0 0 ${L} ${H}" preserveAspectRatio="none" id="tp-svg">`;
    // La bande de conformité en fond : on lit d'un coup d'œil « dedans / dehors ».
    svg += `<rect class="bande" x="${x0}" y="${Y(TP_MAX)}" width="${x1 - x0}" height="${Y(TP_MIN) - Y(TP_MAX)}"/>`;
    svg += `<line class="lim" x1="${x0}" y1="${Y(TP_MAX)}" x2="${x1}" y2="${Y(TP_MAX)}"/>`;
    svg += `<line class="lim" x1="${x0}" y1="${Y(TP_MIN)}" x2="${x1}" y2="${Y(TP_MIN)}"/>`;

    for (let v = Math.ceil(vmin); v <= vmax; v++) {
      if ((vmax - vmin) > 12 && v % 2) continue;
      svg += `<line class="grille" x1="${x0}" y1="${Y(v)}" x2="${x1}" y2="${Y(v)}"/>`;
      svg += `<text class="axe" x="${x0 - 8}" y="${Y(v) + 4}" text-anchor="end">${v}°</text>`;
    }
    const nbX = tpPlage === '24h' ? 6 : 5;
    for (let i = 0; i <= nbX; i++) {
      const t = T0 + (T1 - T0) * i / nbX, d = new Date(t);
      svg += `<text class="axe" x="${X(t)}" y="${y1 + 19}" text-anchor="middle">${tpPlage === '24h' ? tpHeure(d) : tpDateCourte(d)}</text>`;
    }

    S.forEach(s => {
      if (!s.pts.length) return;
      svg += `<path class="ligne" stroke="${s.couleur}" d="${s.pts.map((p, i) => (i ? 'L' : 'M') + X(p.t).toFixed(1) + ' ' + Y(p.v).toFixed(1)).join(' ')}"/>`;
      // Étiquette directe en bout de course : quatre séries ou moins, l'identité
      // ne repose jamais sur la seule couleur.
      const d = s.pts[s.pts.length - 1];
      svg += `<text class="etiq" fill="${s.couleur}" x="${x1 + 7}" y="${Y(d.v) + 4}">${s.nom}</text>`;
    });
    svg += `<line class="curseur" id="tp-curseur" x1="0" y1="${y0}" x2="0" y2="${y1}" style="display:none"/>`;
    svg += `</svg>`;
    zone.innerHTML = svg;

    const el = document.getElementById('tp-svg');
    el.addEventListener('mousemove', (e) => tpSurvoler(e, el, { x0, x1, T0, T1 }));
    el.addEventListener('mouseleave', () => {
      const c = document.getElementById('tp-curseur'); if (c) c.style.display = 'none';
      const b = document.getElementById('tp-bulle'); if (b) b.style.opacity = 0;
    });

    const inf = document.getElementById('tp-info');
    const n = S.reduce((a, s) => a + s.pts.length, 0);
    if (inf) inf.textContent = 'Bande verte : la plage de conformité, ' + TP_MIN + ' à ' + TP_MAX + ' °C. '
      + n + ' points affichés' + (tpPlage === '24h' ? '' : ' (minimums et maximums conservés, aucune moyenne)') + '.';
  }

  function tpSurvoler(e, svg, geo) {
    if (!tpDonnees) return;
    const r = svg.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width * 1000;
    if (px < geo.x0 || px > geo.x1) return;
    const t = geo.T0 + (px - geo.x0) / (geo.x1 - geo.x0) * (geo.T1 - geo.T0);
    const c = document.getElementById('tp-curseur');
    if (c) { c.setAttribute('x1', px); c.setAttribute('x2', px); c.style.display = ''; }

    const lignes = tpDonnees.series.map(s => {
      let best = null, dist = Infinity;
      for (const p of s.pts) { const d = Math.abs(p.t - t); if (d < dist) { dist = d; best = p; } }
      return best && dist < (geo.T1 - geo.T0) / 40
        ? `<div class="l"><i><span style="color:${s.couleur}">■</span> ${s.nom}</i><b>${tpDeg(best.v)} °C</b></div>` : '';
    }).filter(Boolean);

    const b = document.getElementById('tp-bulle');
    if (!b) return;
    if (!lignes.length) { b.style.opacity = 0; return; }
    const d = new Date(t);
    b.innerHTML = `<div style="opacity:.7;margin-bottom:3px">${tpDateCourte(d)} ${tpHeure(d)}</div>` + lignes.join('');
    b.style.opacity = 1;
    const dansCarte = e.clientX - svg.closest('.tp-carte').getBoundingClientRect().left;
    b.style.left = Math.min(dansCarte + 16, svg.closest('.tp-carte').clientWidth - b.offsetWidth - 10) + 'px';
    b.style.top = (e.clientY - svg.closest('.tp-carte').getBoundingClientRect().top + 14) + 'px';
  }

  // ── Pilotage ──────────────────────────────────────────────────────────────
  let tpEnCours = false;
  async function tpRafraichir() {
    if (tpEnCours) return; tpEnCours = true;
    try { await tpCharger(); tpRendreBandeau(); tpRendreTuiles(); tpRendreGraphe(); }
    catch (e) {
      const z = document.getElementById('tp-zone');
      if (z) z.innerHTML = '<div class="tp-vide">Relevés indisponibles : ' + (e.message || e) + '</div>';
    }
    finally { tpEnCours = false; }
  }
  window.tpRafraichir = tpRafraichir;

  window.tpChangerPlage = function (k) {
    tpPlage = k;
    document.querySelectorAll('.tp-onglet[data-plage]').forEach(b =>
      b.classList.toggle('on', b.getAttribute('data-plage') === k));
    tpRafraichir();
  };

  // ── Injection ─────────────────────────────────────────────────────────────
  function tpInject() {
    if (document.getElementById('tp-css')) return;
    const st = document.createElement('style'); st.id = 'tp-css'; st.textContent = TP_CSS;
    document.head.appendChild(st);

    const navRef = document.querySelector('.sb-item[data-sec="backoffice"]');
    if (navRef && !document.querySelector('.sb-item[data-sec="temperatures"]')) {
      const b = document.createElement('button');
      b.className = 'sb-item'; b.setAttribute('data-sec', 'temperatures');
      b.setAttribute('onclick', "showSec('temperatures',this); if(window.tpRafraichir) tpRafraichir();");
      b.innerHTML = '<svg class="ico sb-ico"><use href="#ic-frigo"></use></svg>'
        + '<span class="sb-label">Températures</span><span class="sb-badge" id="navb-tp"></span>';
      navRef.insertAdjacentElement('beforebegin', b);
    }
    const secRef = document.getElementById('sec-livraisons');
    if (secRef && !document.getElementById('sec-temperatures')) {
      const sec = document.createElement('section');
      sec.id = 'sec-temperatures'; sec.className = 'sec'; sec.innerHTML = TP_SECTION;
      secRef.parentNode.appendChild(sec);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tpInject);
  else tpInject();
  setTimeout(function () { try { tpInject(); } catch (e) {} }, 600);
})();
