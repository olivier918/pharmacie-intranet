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
  .tp-al-t{font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.8px;color:#5b5a53;margin-bottom:10px}
  .tp-al-g{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px}
  .tp-al-g label{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#888780;margin-bottom:3px}
  .tp-al-g input[type=text],.tp-al-g input[type=number]{border:1px solid #ddd9cc;border-radius:8px;padding:7px 10px;font:inherit;font-size:14px;width:150px}
  .tp-al-g input[type=number]{width:78px}
  .tp-al-cb{display:inline-flex;align-items:center;gap:6px;font-size:14px;padding-bottom:8px}
  .tp-al-msg{font-size:13px;margin-top:8px;line-height:1.5}
  .tp-al-ko{color:#b3261e}
  .tp-al-ok{color:#1D5C3A}
  .tp-al-ep{border:1px solid #ddd9cc;border-radius:9px;padding:8px 12px;margin-top:8px;font-size:13.5px;background:#fff6f5}
  .tp-al-muet{font-size:13px;color:#b3261e;font-weight:600;margin-top:8px}
  .tp-rv{position:fixed;inset:0;background:rgba(20,22,20,.62);z-index:99990;display:none;
         align-items:center;justify-content:center;padding:16px}
  .tp-rv.on{display:flex}
  .tp-rv-b{background:#fff;border-radius:16px;max-width:860px;width:100%;max-height:92vh;overflow:auto;
           box-shadow:0 18px 60px rgba(0,0,0,.3)}
  .tp-rv-h{padding:16px 20px 10px}
  .tp-rv-h b{font-size:17px}
  .tp-rv-h p{margin:6px 0 0;font-size:13.5px;color:#5b5a53;line-height:1.55}
  .tp-rv-c{padding:0 20px}
  .tp-rv-d{margin:12px 20px;border:1px solid #f0c8c4;background:#fff6f5;border-radius:11px;padding:10px 14px;font-size:13.5px;line-height:1.6}
  .tp-rv-d b{color:#b3261e}
  .tp-rv-f{padding:12px 20px 18px;border-top:1px solid #eeebe1;margin-top:12px}
  .tp-rv-f textarea{width:100%;border:1px solid #ddd9cc;border-radius:9px;padding:9px 11px;font:inherit;font-size:14px;resize:vertical}
  .tp-rv-f label{display:block;font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:#888780;margin-bottom:4px}
  .tp-rv-act{display:flex;gap:10px;align-items:center;margin-top:12px;flex-wrap:wrap}
  .tp-rv-sig{font-size:13px;color:#5b5a53;flex:1}
  .tp-rv-ko{color:#b3261e;font-size:13px;margin-top:8px}
  .tp-ar-h{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px}
  .tp-ar-h .tp-al-t{margin:0;flex:1}
  .tp-ar-r{display:block;width:100%;text-align:left;border:1px solid #e6e4dc;border-radius:10px;
    padding:10px 13px;margin-bottom:8px;background:#fff;cursor:pointer;font:inherit;color:inherit}
  .tp-ar-r:hover{border-color:#1D5C3A;background:#f6faf7}
  .tp-ar-r .l1{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;font-size:14px}
  .tp-ar-r .l1 b{color:#1a1a1a}
  .tp-ar-r .qui{color:#5b5a53}
  .tp-ar-r .l2{font-size:12.5px;color:#888780;margin-top:2px}
  .tp-ar-r .com{font-size:13px;color:#4a4a45;margin-top:5px;font-style:italic;
    overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
  .tp-ar-b{display:inline-block;border-radius:20px;padding:1px 9px;font-size:11.5px;font-weight:700}
  .tp-ar-b.ras{background:#E8F5E9;color:#1D5C3A}
  .tp-ar-b.dep{background:#fff6f5;color:#b3261e;border:1px solid #f0c8c4}
  .tp-ar-vide{color:#888780;font-size:13.5px;padding:8px 0 12px;line-height:1.55}
  .tp-ar-note{font-size:12px;color:#888780;margin-top:6px}
  @media print{.tp-ar-r{break-inside:avoid;border-color:#ccc}.tp-ar-r .com{-webkit-line-clamp:unset;display:block}}
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
    <div class="tp-carte" id="tp-alertes" style="margin-top:18px"></div>
    <div class="tp-carte" id="tp-archives" style="margin-top:18px"></div>
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
  // ── Le relevé quotidien signé ───────────────────────────────────
  // Le matin, à l'ouverture de session du premier pharmacien : la courbe depuis
  // la DERNIERE VALIDATION s'affiche, et il faut signer pour continuer. Après
  // un week-end, c'est le week-end entier qu'on relit — sans quoi le dimanche
  // ne serait jamais relu par personne.
  //
  // CE QUI NE DOIT PAS ARRIVER : bloquer quelqu'un à 8 h 30 parce que le
  // serveur a hoqueté. Si les données ne viennent pas, la fenêtre ne s'ouvre
  // pas du tout. Un relevé manqué se rattrape ; un comptoir bloqué, non.
  let tpRel = null;

  function tpEstPharmacien(u) {
    if (!u) return false;
    const p = String(u.poste || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    return p.indexOf('pharmacien') === 0;
  }
  function tpMemeJour(a, b) {
    const f = d => new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' }).format(d);
    return f(a) === f(b);
  }

  window.tpReleveDemander = async function (u) {
    try {
      if (!tpEstPharmacien(u)) return;
      const r = await fetch('/api/temp/releve', { cache: 'no-store' });
      const j = await r.json();
      if (!j || !j.ok) return;
      // Déjà signé aujourd'hui : on ne redemande pas au deuxième pharmacien.
      if (j.dernier && tpMemeJour(new Date(j.dernier.le), new Date())) return;
      tpRel = j;
      await tpReleveOuvrir(u);
    } catch (e) { /* le comptoir passe avant le relevé */ }
  };

  async function tpReleveOuvrir(u) {
    let ov = document.getElementById('tp-releve');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'tp-releve'; ov.className = 'tp-rv';
      document.body.appendChild(ov);
    }
    const depuis = new Date(tpRel.depuis);
    const dep = tpRel.depassements || [];
    const parPoint = {};
    dep.forEach(function (d) { (parPoint[d.point] = parPoint[d.point] || []).push(d); });

    // La courbe de la période, dessinée avec le même moteur que l'écran.
    let mesures = [];
    try {
      const rm = await fetch('/api/temp/mesures?debut=' + encodeURIComponent(tpRel.depuis)
        + '&fin=' + encodeURIComponent(new Date().toISOString()), { cache: 'no-store' });
      const jm = await rm.json();
      mesures = (jm && jm.mesures) || [];
    } catch (e) { mesures = []; }
    if (!mesures.length) return;   // rien à relire : on ne bloque personne

    ov.innerHTML = '<div class="tp-rv-b">'
      + '<div class="tp-rv-h"><b>Relévé des températures à valider</b>'
      + '<p>Période du <b>' + tpDateCourte(depuis) + ' à ' + tpHeure(depuis) + '</b> à maintenant'
      + (tpRel.dernier ? ' · dernier relévé signé par ' + tpEch(tpRel.dernier.nom || tpRel.dernier.par) : ' · premier relévé')
      + '.<br>Regardez les courbes, puis signez. Cette fenêtre ne se ferme qu’une fois le relévé validé.</p></div>'
      + '<div class="tp-rv-c"><div id="tp-rv-graphe"></div></div>'
      + (dep.length
          ? '<div class="tp-rv-d"><b>' + dep.length + ' relévé' + (dep.length > 1 ? 's' : '')
            + ' hors plage (' + tpRel.plage.min + '–' + tpRel.plage.max + ' °C)</b><br>'
            + Object.keys(parPoint).map(function (p) {
                const l = parPoint[p];
                const mini = Math.min.apply(null, l.map(function (x) { return Number(x.valeur); }));
                const maxi = Math.max.apply(null, l.map(function (x) { return Number(x.valeur); }));
                const d1 = new Date(l[0].ts);
                return '<b>' + tpEch(p) + '</b> · ' + l.length + ' relévé' + (l.length > 1 ? 's' : '')
                  + ', de ' + tpDeg(mini) + ' à ' + tpDeg(maxi) + ' °C, à partir du '
                  + tpDateCourte(d1) + ' à ' + tpHeure(d1);
              }).join('<br>')
            + '</div>'
          : '')
      + '<div class="tp-rv-f">'
      + '<label>' + (dep.length ? 'Commentaire — obligatoire : ce qui s’est passé, et ce qui a été fait' : 'Commentaire (facultatif)') + '</label>'
      + '<textarea id="tp-rv-com" rows="3" placeholder="'
      + (dep.length ? 'Porte du frigo 2 restée entrouverte, refermée à 9 h 10, produits contrôlés…' : 'Rien à signaler.')
      + '"></textarea>'
      + '<div class="tp-rv-act">'
      + '<span class="tp-rv-sig">Signé par <b>' + tpEch(((u.prenom || '') + ' ' + (u.nom || '')).trim()) + '</b></span>'
      + '<button class="tp-onglet" onclick="tpReleveValider()">J’ai vérifié — valider le relévé</button>'
      + '</div><div class="tp-rv-ko" id="tp-rv-ko"></div></div></div>';
    ov.classList.add('on');
    tpRelUser = u; tpRelDep = dep.length;

    // Le graphe de la période, avec la même réduction min/max que l'écran : une
    // moyenne effacerait le dépassement de vingt minutes, c'est-à-dire
    // exactement ce que le pharmacien doit voir.
    try { tpDessinerDans('tp-rv-graphe', mesures); } catch (e) {}
  }
  let tpRelUser = null, tpRelDep = 0;

  // Un graphe SIMPLE et sans interaction, pour la fenêtre de validation. On ne
  // réutilise pas celui de l'écran : ses poignées de survol sont accrochées à
  // des identifiants uniques, et deux graphes portant les mêmes identifiants se
  // voleraient le curseur. Ici on veut lire, pas explorer.
  //
  // Même réduction min/max que l'écran : une moyenne effacerait le dépassement
  // de vingt minutes, c'est-à-dire exactement ce que le pharmacien doit voir.
  function tpDessinerDans(idHote, mesures) {
    const hote = document.getElementById(idHote); if (!hote) return;
    const par = new Map();
    for (const m of mesures) {
      if (!par.has(m.point)) par.set(m.point, []);
      par.get(m.point).push({ t: new Date(m.ts).getTime(), v: Number(m.valeur) });
    }
    const noms = Array.from(par.keys()).sort();
    if (!noms.length) { hote.innerHTML = ''; return; }
    const series = noms.map(function (n, i) {
      return { nom: n, couleur: TP_COULEURS[i % TP_COULEURS.length],
               pts: tpReduire(par.get(n).sort(function (a, b) { return a.t - b.t; }), 900) };
    });
    let T0 = Infinity, T1 = -Infinity, vmin = TP_MIN, vmax = TP_MAX;
    series.forEach(function (s) {
      s.pts.forEach(function (p) {
        if (p.t < T0) T0 = p.t; if (p.t > T1) T1 = p.t;
        if (p.v < vmin) vmin = p.v; if (p.v > vmax) vmax = p.v;
      });
    });
    if (!(T1 > T0)) T1 = T0 + 1;
    vmin = Math.floor(vmin - 1); vmax = Math.ceil(vmax + 1);

    const L = 1000, H = 260, mg = { g: 40, d: 96, h: 12, b: 26 };
    const x0 = mg.g, x1 = L - mg.d, y0 = mg.h, y1 = H - mg.b;
    const X = function (t) { return x0 + (t - T0) / (T1 - T0) * (x1 - x0); };
    const Y = function (v) { return y1 - (v - vmin) / (vmax - vmin) * (y1 - y0); };

    let svg = '<svg viewBox="0 0 ' + L + ' ' + H + '" preserveAspectRatio="none" style="width:100%;height:230px;display:block">';
    // La bande de conformité : on lit d'un coup d'oeil « dedans / dehors ».
    svg += '<rect x="' + x0 + '" y="' + Y(TP_MAX) + '" width="' + (x1 - x0)
        + '" height="' + (Y(TP_MIN) - Y(TP_MAX)) + '" fill="#E8F5E9"/>';
    [TP_MIN, TP_MAX].forEach(function (v) {
      svg += '<line x1="' + x0 + '" y1="' + Y(v) + '" x2="' + x1 + '" y2="' + Y(v)
          + '" stroke="#A5D6A7" stroke-width="1"/>'
          + '<text x="' + (x0 - 6) + '" y="' + (Y(v) + 4) + '" text-anchor="end" font-size="11" fill="#888780">' + v + '°</text>';
    });
    series.forEach(function (s) {
      const d = s.pts.map(function (p, i) { return (i ? 'L' : 'M') + X(p.t).toFixed(1) + ' ' + Y(p.v).toFixed(1); }).join(' ');
      svg += '<path d="' + d + '" fill="none" stroke="' + s.couleur + '" stroke-width="1.6" stroke-linejoin="round"/>';
    });
    // Les etiquettes au bout des courbes, ecartees quand elles se chevauchent.
    // Deux armoires a la meme temperature ecrivaient leurs deux noms l'un sur
    // l'autre : illisibles tous les deux, ce qui est pire qu'un seul.
    const et = series.map(function (s) {
      const der = s.pts[s.pts.length - 1];
      return der ? { y: Y(der.v), nom: s.nom, couleur: s.couleur } : null;
    }).filter(Boolean).sort(function (a, b) { return a.y - b.y; });
    for (let i = 1; i < et.length; i++) {
      if (et[i].y - et[i - 1].y < 13) et[i].y = et[i - 1].y + 13;
    }
    et.forEach(function (e) {
      svg += '<text x="' + (x1 + 6) + '" y="' + (e.y + 4).toFixed(1) + '" font-size="11" fill="'
        + e.couleur + '">' + tpEch(e.nom) + '</text>';
    });
    const d0 = new Date(T0), d1 = new Date(T1);
    svg += '<text x="' + x0 + '" y="' + (H - 8) + '" font-size="11" fill="#888780">'
        + tpDateCourte(d0) + ' ' + tpHeure(d0) + '</text>'
        + '<text x="' + x1 + '" y="' + (H - 8) + '" text-anchor="end" font-size="11" fill="#888780">'
        + tpDateCourte(d1) + ' ' + tpHeure(d1) + '</text></svg>';
    hote.innerHTML = svg;
  }

  window.tpReleveValider = async function () {
    const c = document.getElementById('tp-rv-com');
    const ko = document.getElementById('tp-rv-ko');
    const com = c ? c.value.trim() : '';
    if (tpRelDep > 0 && com.length < 3) {
      if (ko) ko.textContent = 'Un dépassement doit être commenté : signer sans rien écrire, '
        + 'c’est signer qu’on n’a rien vu.';
      if (c) c.focus();
      return;
    }
    try {
      const r = await fetch('/api/temp/releve', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commentaire: com, depassements: tpRelDep,
          debut: tpRel && tpRel.depuis,
          nom: ((tpRelUser && tpRelUser.prenom) || '') + ' ' + ((tpRelUser && tpRelUser.nom) || '')
        })
      });
      const j = await r.json();
      if (!j.ok) { if (ko) ko.textContent = j.error || 'Validation refusée.'; return; }
      const ov = document.getElementById('tp-releve');
      if (ov) { ov.classList.remove('on'); ov.innerHTML = ''; }
      if (typeof logAction === 'function') logAction('Relévé des températures validé', com.slice(0, 120));
    } catch (e) { if (ko) ko.textContent = 'Validation impossible : ' + e.message; }
  };

  // ── Les alertes ───────────────────────────────────────────────
  // L'ecran dit toujours si le dispositif est arme ou non. Un ecran de
  // surveillance qui ne dit pas qu'il ne surveille rien est pire que pas
  // d'ecran du tout — c'est le principe de tout ce module.
  let tpReg = null, tpEpisodes = [];

  async function tpChargerAlertes() {
    const r = await fetch('/api/temp/reglages', { cache: 'no-store' });
    const j = await r.json();
    if (!j || !j.ok) throw new Error((j && j.error) || 'reglages indisponibles');
    tpReg = j.reglages; tpEpisodes = j.episodes || [];
  }

  function tpEch(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }
  function tpAdmin() { return typeof isAdmin === 'function' ? isAdmin() : false; }

  function tpRendreAlertes() {
    const z = document.getElementById('tp-alertes'); if (!z) return;
    if (!tpReg) { z.innerHTML = ''; return; }
    const r = tpReg;
    const enCours = tpEpisodes.filter(function (e) { return e; });
    let h = '<div class="tp-al-t">Alertes</div>';

    if (!r.actif) {
      h += '<div class="tp-al-muet">⚠ Les alertes sont éteintes. Les dépassements sont enregistrés, '
        + 'mais <b>aucun SMS ne partira</b>.</div>';
    } else {
      const n = (r.astreintes || []).filter(function (a) { return a.actif; }).length;
      h += '<div class="tp-al-ok" style="font-size:13px">✓ Armées — ' + n + ' destinataire'
        + (n > 1 ? 's' : '') + ', plage ' + r.vmin + '–' + r.vmax + ' °C. '
        + 'Trois relévés en journée, le premier la nuit et le dimanche.</div>';
    }

    if (enCours.length) {
      h += enCours.map(function (e) {
        const d = new Date(e.ouvert_le);
        return '<div class="tp-al-ep"><b>' + tpEch(e.point) + '</b> — '
          + (e.motif === 'panne' ? 'plus aucun relévé' : 'hors plage')
          + (e.valeur != null ? ' (' + tpDeg(Number(e.valeur)) + ' °C)' : '')
          + ' depuis le ' + tpDateCourte(d) + ' à ' + tpHeure(d)
          + ' · ' + (e.envois || 0) + ' SMS envoyé(s)</div>';
      }).join('');
    }

    if (tpAdmin()) {
      h += '<div class="tp-al-t" style="margin-top:16px">Qui est prévenu</div>'
        + '<div id="tp-astreintes">' + tpRendreAstreintes(r.astreintes || []) + '</div>'
        + '<button class="tp-onglet" onclick="tpAstreinteAjouter()" style="margin-top:6px">+ Ajouter une astreinte</button>'
        + '<div class="tp-al-g" style="margin-top:16px">'
        + '<div><label>Mini °C</label><input type="number" step="0.5" id="tp-vmin" value="' + r.vmin + '"></div>'
        + '<div><label>Maxi °C</label><input type="number" step="0.5" id="tp-vmax" value="' + r.vmax + '"></div>'
        + '<label class="tp-al-cb"><input type="checkbox" id="tp-actif"' + (r.actif ? ' checked' : '') + '> Armer</label>'
        + '<button class="tp-onglet" onclick="tpEnregistrerAlertes()" style="margin-bottom:6px">Enregistrer</button>'
        + '<button class="tp-onglet" onclick="tpTesterAlertes()" style="margin-bottom:6px">Évaluer maintenant</button>'
        + '</div>'
        + '<div class="tp-al-msg" id="tp-al-msg"></div>'
        + '<div class="tp-al-msg" style="color:#888780">Une seule astreinte est un point unique de '
        + 'défaillance : la nuit, si ce téléphone est en silencieux, l’alerte n’existe pas. '
        + 'Décocher une ligne met la personne en pause sans effacer son numéro.</div>';
    }
    z.innerHTML = h;
  }

  // La liste vit dans `tpAst` tant qu'on n'a pas enregistré : ajouter une
  // ligne redessine tout, et ce qui a été tapé ailleurs doit survivre.
  let tpAst = [];
  function tpRendreAstreintes(l) {
    tpAst = (l || []).map(function (a) { return { nom: a.nom || '', tel: a.tel || '', actif: a.actif !== false }; });
    return tpAstHtml();
  }
  function tpAstHtml() {
    if (!tpAst.length) {
      return '<div class="tp-al-muet">Personne n’est d’astreinte. Les alertes ne peuvent pas être armées.</div>';
    }
    return tpAst.map(function (a, i) {
      return '<div class="tp-al-g" style="margin-bottom:4px">'
        + '<div><label>Nom</label><input type="text" value="' + tpEch(a.nom) + '" placeholder="Olivier…" '
        + 'oninput="tpAstMaj(' + i + ',\'nom\',this.value)"></div>'
        + '<div><label>Mobile</label><input type="text" value="' + tpEch(a.tel) + '" placeholder="06 …" '
        + 'oninput="tpAstMaj(' + i + ',\'tel\',this.value)"></div>'
        + '<label class="tp-al-cb"><input type="checkbox"' + (a.actif ? ' checked' : '')
        + ' onchange="tpAstMaj(' + i + ',\'actif\',this.checked)"> prévenu</label>'
        + '<button class="tp-onglet" onclick="tpAstreinteRetirer(' + i + ')" '
        + 'style="margin-bottom:6px" title="Retirer">✕</button>'
        + '</div>';
    }).join('');
  }
  window.tpAstMaj = function (i, champ, val) { if (tpAst[i]) tpAst[i][champ] = val; };
  window.tpAstreinteAjouter = function () {
    tpAst.push({ nom: '', tel: '', actif: true });
    const z = document.getElementById('tp-astreintes'); if (z) z.innerHTML = tpAstHtml();
  };
  window.tpAstreinteRetirer = function (i) {
    tpAst.splice(i, 1);
    const z = document.getElementById('tp-astreintes'); if (z) z.innerHTML = tpAstHtml();
  };

  function tpMsg(txt, ko) {
    const m = document.getElementById('tp-al-msg'); if (!m) return;
    m.className = 'tp-al-msg ' + (ko ? 'tp-al-ko' : 'tp-al-ok');
    m.textContent = txt;
  }

  window.tpEnregistrerAlertes = async function () {
    const v = function (id) { const e = document.getElementById(id); return e ? e.value.trim() : ''; };
    try {
      // Les astreintes D'ABORD : armer se vérifie contre la liste enregistrée,
      // pas contre celle qui est encore à l'écran.
      const ra = await fetch('/api/temp/astreintes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ astreintes: tpAst })
      });
      const ja = await ra.json();
      if (!ja.ok) { tpMsg(ja.error || 'Astreintes refus\u00e9es.', true); return; }

      const r = await fetch('/api/temp/reglages', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actif: !!(document.getElementById('tp-actif') || {}).checked,
          vmin: parseFloat(v('tp-vmin')), vmax: parseFloat(v('tp-vmax'))
        })
      });
      const j = await r.json();
      if (!j.ok) {
        // Les astreintes sont enregistrées, l'armement non : on le dit, et on
        // réaffiche l'état réel plutôt que celui qu'on espérait.
        tpReg = ja.reglages; tpRendreAlertes();
        tpMsg('Astreintes enregistr\u00e9es, mais : ' + (j.error || 'armement refus\u00e9'), true);
        return;
      }
      tpReg = j.reglages; tpRendreAlertes();
      tpMsg('Enregistr\u00e9.', false);
    } catch (e) { tpMsg('Enregistrement impossible : ' + e.message, true); }
  };

  window.tpTesterAlertes = async function () {
    try {
      const r = await fetch('/api/temp/alerte-test', { method: 'POST' });
      const j = await r.json();
      if (!j.ok) { tpMsg(j.error || '\u00c9valuation refus\u00e9e.', true); return; }
      const d = (j.resultat && j.resultat.decisions) || [];
      const agit = d.filter(function (x) { return x.action !== 'rien'; });
      await tpChargerAlertes(); tpRendreAlertes();
      tpMsg(agit.length
        ? agit.map(function (x) { return x.point + ' : ' + x.action + ' (' + x.motif + ')'; }).join(' \u00b7 ')
        : '\u00c9valuation faite \u2014 rien \u00e0 signaler sur ' + d.length + ' point(s).', false);
    } catch (e) { tpMsg('\u00c9valuation impossible : ' + e.message, true); }
  };

  // ── L'archive des relevés signés ──────────────────────────────────────────
  // Signer un relevé ne sert à rien si personne ne peut le relire : la trace
  // existait en base depuis le premier jour, mais aucun écran ne la montrait.
  // Le jour où un inspecteur la demande, il faut pouvoir l'ouvrir, pas écrire
  // une requête SQL.
  //
  // ON NE STOCKE PAS D'IMAGE DE LA COURBE. Rouvrir un relevé redessine la
  // période depuis les mesures brutes, avec le même moteur que la fenêtre de
  // validation — donc ce qui s'affiche est la donnée, pas une capture qu'on
  // pourrait avoir retouchée. La contrepartie est honnête et l'écran la dit :
  // le jour où les mesures brutes seront purgées, la signature et le
  // commentaire resteront, la courbe non.
  let tpArchives = [], tpArTotal = 0, tpArDepuis = null, tpArLimite = 60;

  async function tpChargerArchives() {
    const r = await fetch('/api/temp/releves?limite=' + tpArLimite, { cache: 'no-store' });
    const j = await r.json();
    if (!j || !j.ok) throw new Error((j && j.error) || 'archives indisponibles');
    tpArchives = j.releves || [];
    tpArTotal = j.total || tpArchives.length;
    tpArDepuis = j.mesuresDepuis ? new Date(j.mesuresDepuis) : null;
  }

  function tpRendreArchives() {
    const z = document.getElementById('tp-archives'); if (!z) return;
    let h = '<div class="tp-ar-h"><div class="tp-al-t">Relevés signés</div>';
    if (tpArchives.length) {
      h += '<button class="tp-onglet no-print" onclick="window.print()">Imprimer</button>';
      if (tpArchives.length < tpArTotal)
        h += '<button class="tp-onglet no-print" onclick="tpArchivesTout()">Tout l’historique ('
          + tpArTotal + ')</button>';
    }
    h += '</div>';

    if (!tpArchives.length) {
      h += '<div class="tp-ar-vide">Aucun relevé signé pour l’instant. '
        + 'Le premier pharmacien qui se connecte le matin se voit présenter la courbe '
        + 'depuis la dernière validation, et doit la signer pour continuer.</div>';
      z.innerHTML = h; return;
    }

    h += tpArchives.map(function (a, i) {
      const le = new Date(a.le);
      const d1 = a.debut ? new Date(a.debut) : null;
      const d2 = new Date(a.fin || a.le);
      const n = Number(a.depassements) || 0;
      return '<button class="tp-ar-r" onclick="tpArchiveOuvrir(' + i + ')">'
        + '<div class="l1"><b>' + tpDateCourte(le) + ' à ' + tpHeure(le) + '</b>'
        + '<span class="qui">' + tpEch(a.nom || a.par) + '</span>'
        + '<span class="tp-ar-b ' + (n ? 'dep' : 'ras') + '">'
        + (n ? n + ' dépassement' + (n > 1 ? 's' : '') : 'Rien à signaler') + '</span></div>'
        + '<div class="l2">' + (d1
            ? 'Période du ' + tpDateCourte(d1) + ' ' + tpHeure(d1) + ' au ' + tpDateCourte(d2) + ' ' + tpHeure(d2)
            : 'Premier relevé, jusqu’au ' + tpDateCourte(d2) + ' ' + tpHeure(d2)) + '</div>'
        + (a.commentaire ? '<div class="com">« ' + tpEch(a.commentaire) + ' »</div>' : '')
        + '</button>';
    }).join('');

    if (tpArDepuis) h += '<div class="tp-ar-note">Les courbes sont redessinées depuis les mesures '
      + 'conservées, qui remontent au ' + tpDateCourte(tpArDepuis) + '. Au-delà, un relevé garde sa '
      + 'signature et son commentaire, mais plus sa courbe.</div>';
    z.innerHTML = h;
  }

  window.tpArchivesTout = async function () {
    tpArLimite = 400;
    try { await tpChargerArchives(); tpRendreArchives(); } catch (e) {}
  };

  // Une fenêtre de RELECTURE : elle se ferme, elle ne demande rien, et elle
  // n'offre aucun moyen de modifier ce qui a été signé.
  window.tpArchiveOuvrir = async function (i) {
    const a = tpArchives[i]; if (!a) return;
    let ov = document.getElementById('tp-archive');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'tp-archive'; ov.className = 'tp-rv';
      ov.addEventListener('click', function (e) { if (e.target === ov) tpArchiveFermer(); });
      document.body.appendChild(ov);
    }
    const le = new Date(a.le);
    const d2 = new Date(a.fin || a.le);
    const d1 = a.debut ? new Date(a.debut) : new Date(d2.getTime() - 24 * 3600e3);
    const n = Number(a.depassements) || 0;

    ov.innerHTML = '<div class="tp-rv-b">'
      + '<div class="tp-rv-h"><b>Relevé signé le ' + tpDateCourte(le) + ' à ' + tpHeure(le) + '</b>'
      + '<p>Par <b>' + tpEch(a.nom || a.par) + '</b> · période du ' + tpDateCourte(d1) + ' à ' + tpHeure(d1)
      + ' au ' + tpDateCourte(d2) + ' à ' + tpHeure(d2) + '.</p></div>'
      + '<div class="tp-rv-c"><div id="tp-ar-graphe"><div class="tp-vide">Lecture des mesures…</div></div></div>'
      + (n ? '<div class="tp-rv-d"><b>' + n + ' relevé' + (n > 1 ? 's' : '') + ' hors plage</b></div>' : '')
      + '<div class="tp-rv-f"><label>Commentaire du pharmacien</label>'
      + '<div style="font-size:14px;line-height:1.6;color:#1a1a1a">'
      + (a.commentaire ? tpEch(a.commentaire) : '<i style="color:#888780">Aucun commentaire.</i>')
      + '</div><div class="tp-rv-act"><span class="tp-rv-sig">Ce relevé ne peut pas être modifié.</span>'
      + '<button class="tp-onglet" onclick="tpArchiveFermer()">Fermer</button></div></div></div>';
    ov.classList.add('on');
    document.addEventListener('keydown', tpArchiveEchap, true);

    try {
      const rm = await fetch('/api/temp/mesures?debut=' + encodeURIComponent(d1.toISOString())
        + '&fin=' + encodeURIComponent(d2.toISOString()), { cache: 'no-store' });
      const jm = await rm.json();
      const mes = (jm && jm.mesures) || [];
      const hote = document.getElementById('tp-ar-graphe'); if (!hote) return;
      if (!mes.length) {
        hote.innerHTML = '<div class="tp-vide">Les mesures de cette période ne sont plus conservées. '
          + 'La signature et le commentaire ci-dessous restent, la courbe non.</div>';
        return;
      }
      hote.innerHTML = '';
      tpDessinerDans('tp-ar-graphe', mes);
    } catch (e) {
      const hote = document.getElementById('tp-ar-graphe');
      if (hote) hote.innerHTML = '<div class="tp-vide">Courbe indisponible : ' + tpEch(e.message) + '</div>';
    }
  };
  window.tpArchiveFermer = function () {
    const ov = document.getElementById('tp-archive');
    if (ov) { ov.classList.remove('on'); ov.innerHTML = ''; }
    document.removeEventListener('keydown', tpArchiveEchap, true);
  };
  function tpArchiveEchap(e) { if (e.key === 'Escape') tpArchiveFermer(); }

  async function tpRafraichir() {
    if (tpEnCours) return; tpEnCours = true;
    try {
      await tpCharger(); tpRendreBandeau(); tpRendreTuiles(); tpRendreGraphe();
      // Les alertes ne doivent pas faire tomber l'ecran : si leur lecture
      // echoue, les courbes restent lisibles et le panneau se tait.
      try { await tpChargerAlertes(); tpRendreAlertes(); } catch (e) {}
      try { await tpChargerArchives(); tpRendreArchives(); } catch (e) {}
    }
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
