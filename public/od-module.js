/* ════════════════════════════════════════════════════════════════════════════
   Module DÉPÔTS — la boîte de réception des ordonnances envoyées par les
   patients depuis /o (voir depots.js et public/depot.html).

   Ce que le collaborateur fait ici, dans l'ordre où il le fait :
     1. il voit arriver un dépôt, avec son numéro (« D-47 ») ;
     2. il l'ouvre, le redresse et le détoure — au comptoir, sur grand écran,
        pas sur le téléphone du patient : c'est lui qui sait ce qui compte ;
     3. il le COPIE, et le colle directement dans le LGO. Un clic, un collage.
        Le téléchargement reste là pour les cas où le collage ne passe pas.
     4. soit il le rattache à un dossier — il devient alors une pièce de ce
        dossier et se conserve — soit il ne fait rien, et le dépôt s'efface
        tout seul au bout de sept jours.

   La règle de rétention tient en une phrase : RATTACHER, C'EST CONSERVER.
   Personne n'a de classification à retenir.

   Préfixe `od` / `od-` : rien ici ne touche à l'existant.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const E = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  const odUser = () => (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null;
  const odAdmin = () => (typeof isAdmin === 'function') ? isAdmin() : false;
  const odListe = () => (typeof depots !== 'undefined' && Array.isArray(depots)) ? depots : [];
  const odLocs = () => (typeof locations !== 'undefined' && Array.isArray(locations)) ? locations : [];
  const odRenouv = () => (typeof renouvellements !== 'undefined' && Array.isArray(renouvellements)) ? renouvellements : [];
  const odSave = (now) => {
    try {
      if (now && typeof saveNow === 'function') saveNow();
      else if (typeof schedSave === 'function') schedSave();
    } catch (e) {}
  };

  const OD_JOURS = 7;
  const pad = n => String(n).padStart(2, '0');

  // ── Lecture ───────────────────────────────────────────────────────────────
  function odRattache(d) {
    return !!(d && d.lien && d.lien.type && d.lien.ref != null);
  }
  // La boîte : ce qui attend une décision. Le plus récent en tête — au comptoir
  // on cherche presque toujours celui qui vient d'arriver.
  function odEnBoite(l) {
    return (l || []).filter(d => d && !odRattache(d) && d.recuLe)
      .slice().sort((a, b) => (b.ts || 0) - (a.ts || 0));
  }
  function odClasses(l) {
    return (l || []).filter(d => d && odRattache(d))
      .slice().sort((a, b) => (b.ts || 0) - (a.ts || 0));
  }
  // Combien de jours avant l'effacement. Zéro ou moins : il part au prochain
  // passage de la purge.
  function odRestant(d, maintenant) {
    if (!d || odRattache(d)) return null;
    const fin = Number(d.ts || 0) + OD_JOURS * 86400000;
    return Math.ceil((fin - (maintenant || Date.now())) / 86400000);
  }
  function odMotRestant(n) {
    if (n == null) return '';
    if (n <= 0) return 'effacé aujourd’hui';
    if (n === 1) return 'effacé demain';
    return 'effacé dans ' + n + ' jours';
  }
  function odQuand(ts) {
    const d = new Date(Number(ts) || Date.now());
    const h = pad(d.getHours()) + 'h' + pad(d.getMinutes());
    const auj = new Date();
    const memeJour = d.toDateString() === auj.toDateString();
    return memeJour ? h : pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + ' ' + h;
  }
  // De qui est cette ordonnance. Sans jeton, le patient l'a saisi lui-meme ;
  // avec un jeton, elle etait deja rattachee a un dossier, qui porte le nom.
  function odIdentite(d) {
    if (!d) return '';
    const n = ((d.nom || '') + ' ' + (d.prenom || '')).trim();
    if (n) return n + (d.naissance ? ' \u00b7 n\u00e9(e) le ' + odJour(d.naissance) : '');
    if (odRattache(d)) return odNomDossier(d.lien);
    return 'sans nom';
  }
  function odJour(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m ? m[3] + '/' + m[2] + '/' + m[1] : String(iso || '');
  }
  function odNomDossier(lien) {
    if (!lien) return '';
    if (lien.type === 'location') {
      const l = odLocs().find(x => x && String(x.id) === String(lien.ref));
      return l ? ((l.nom || '') + ' ' + (l.prenom || '')).trim() : 'dossier introuvable';
    }
    const r = odRenouv().find(x => x && String(x.id) === String(lien.ref));
    return r ? ((r.nom || '') + ' ' + (r.prenom || '')).trim() : 'dossier introuvable';
  }

  // ── Le visualiseur : redresser, détourer, corriger la perspective ─────────
  //
  // Le détourage n'est PAS un rectangle mais un QUADRILATÈRE à quatre coins.
  // Une ordonnance photographiée de biais n'est jamais un rectangle à l'écran ;
  // un cadre rectangulaire obligeait soit à couper dans le document, soit à
  // garder du comptoir autour. Les quatre coins épousent la feuille, et la
  // sortie est redressée par une homographie — l'image finale est plate,
  // comme si elle avait été posée sur une vitre de scanner.
  //
  // Le rectangle n'a pas disparu : c'est le cas particulier où les quatre coins
  // forment un rectangle, et le code s'en aperçoit tout seul.
  let odVue = null;   // { depot, index, img, rot, quad:[{x,y}x4], apercu }

  window.odOuvrirFichier = function (depotId, i) {
    const d = odListe().find(x => x && x.id === depotId); if (!d) return;
    const f = (d.fichiers || [])[i]; if (!f) return;
    if (f.fichMime === 'application/pdf') { window.open('/api/images/' + f.fichId, '_blank', 'noopener'); return; }
    odVue = { depot: d, index: i, img: null, rot: 0, quad: null, apercu: false };
    document.getElementById('od-ov-vue').classList.add('open');
    document.getElementById('od-v-etat').textContent = 'Chargement…';
    const img = new Image();
    img.onload = function () { odVue.img = img; odVue.quad = null; odRendVue(); };
    img.onerror = function () { document.getElementById('od-v-etat').textContent = 'Image illisible.'; };
    img.src = '/api/images/' + f.fichId;
  };
  window.odFermerVue = function () {
    document.getElementById('od-ov-vue').classList.remove('open');
    odVue = null;
  };

  // La rotation d'abord, les coins ensuite : ils sont toujours exprimés dans
  // l'image REDRESSÉE, sans quoi pivoter les enverrait ailleurs.
  function odCanvasRedresse() {
    const v = odVue; if (!v || !v.img) return null;
    const w = v.img.naturalWidth, h = v.img.naturalHeight;
    const droit = (v.rot % 180) === 0;
    const c = document.createElement('canvas');
    c.width = droit ? w : h; c.height = droit ? h : w;
    const ctx = c.getContext('2d');
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate(v.rot * Math.PI / 180);
    ctx.drawImage(v.img, -w / 2, -h / 2);
    return c;
  }
  function odQuadPlein(base) {
    return [{ x: 0, y: 0 }, { x: base.width, y: 0 },
            { x: base.width, y: base.height }, { x: 0, y: base.height }];
  }
  function odQuad(base) {
    if (!odVue.quad) odVue.quad = odQuadPlein(base);
    return odVue.quad;
  }
  // Les quatre coins sont-ils encore ceux de l'image ? Si oui, rien à faire :
  // pas de rééchantillonnage, donc pas une once de qualité perdue.
  function odQuadIntact(q, base) {
    const p = odQuadPlein(base);
    for (let i = 0; i < 4; i++) {
      if (Math.abs(q[i].x - p[i].x) > 0.5 || Math.abs(q[i].y - p[i].y) > 0.5) return false;
    }
    return true;
  }

  // ── L'homographie ─────────────────────────────────────────────────────────
  // On cherche la matrice qui envoie le RECTANGLE de sortie sur le
  // QUADRILATÈRE de la photo : c'est le sens inverse du redressement, et c'est
  // celui dont on a besoin, puisqu'on balaie les pixels de la sortie pour aller
  // chercher leur couleur dans la source.
  // Huit inconnues, huit équations, un pivot de Gauss. Aucune bibliothèque.
  function odHomographie(dst, src) {
    const A = [], B = [];
    for (let i = 0; i < 4; i++) {
      const x = dst[i].x, y = dst[i].y, u = src[i].x, v = src[i].y;
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); B.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); B.push(v);
    }
    for (let c = 0; c < 8; c++) {
      let p = c;
      for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      if (Math.abs(A[p][c]) < 1e-12) return null;          // quadrilatère dégénéré
      const tA = A[c]; A[c] = A[p]; A[p] = tA;
      const tB = B[c]; B[c] = B[p]; B[p] = tB;
      for (let r = 0; r < 8; r++) {
        if (r === c) continue;
        const k = A[r][c] / A[c][c];
        if (!k) continue;
        for (let j = c; j < 8; j++) A[r][j] -= k * A[c][j];
        B[r] -= k * B[c];
      }
    }
    const h = [];
    for (let i = 0; i < 8; i++) h.push(B[i] / A[i][i]);
    h.push(1);
    return h;
  }
  const odDist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  // Le redressement. Bilinéaire : une ordonnance rééchantillonnée au plus
  // proche voisin devient illisible sur les petits caractères.
  function odRedresser(base, q) {
    const l = Math.round(Math.max(odDist(q[0], q[1]), odDist(q[3], q[2])));
    const h = Math.round(Math.max(odDist(q[0], q[3]), odDist(q[1], q[2])));
    if (l < 8 || h < 8) return null;
    // On borne la sortie : au-delà, on fabrique des pixels sans rien apprendre.
    const f = Math.min(1, 2400 / Math.max(l, h));
    const L = Math.max(8, Math.round(l * f)), H = Math.max(8, Math.round(h * f));
    const M = odHomographie([{ x: 0, y: 0 }, { x: L, y: 0 }, { x: L, y: H }, { x: 0, y: H }], q);
    if (!M) return null;

    const sc = base.getContext('2d').getImageData(0, 0, base.width, base.height);
    const sd = sc.data, sw = base.width, sh = base.height;
    const out = new ImageData(L, H), od = out.data;
    let k = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < L; x++, k += 4) {
        const w = M[6] * x + M[7] * y + M[8];
        const sx = (M[0] * x + M[1] * y + M[2]) / w;
        const sy = (M[3] * x + M[4] * y + M[5]) / w;
        if (sx < 0 || sy < 0 || sx > sw - 1 || sy > sh - 1) {
          od[k] = od[k + 1] = od[k + 2] = 255; od[k + 3] = 255; continue;
        }
        const x0 = sx | 0, y0 = sy | 0;
        const x1 = x0 + 1 < sw ? x0 + 1 : x0, y1 = y0 + 1 < sh ? y0 + 1 : y0;
        const ax = sx - x0, ay = sy - y0;
        const i00 = (y0 * sw + x0) * 4, i10 = (y0 * sw + x1) * 4;
        const i01 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4;
        for (let c = 0; c < 3; c++) {
          const haut = sd[i00 + c] + (sd[i10 + c] - sd[i00 + c]) * ax;
          const bas  = sd[i01 + c] + (sd[i11 + c] - sd[i01 + c]) * ax;
          od[k + c] = haut + (bas - haut) * ay;
        }
        od[k + 3] = 255;
      }
    }
    const c = document.createElement('canvas');
    c.width = L; c.height = H;
    c.getContext('2d').putImageData(out, 0, 0);
    return c;
  }

  // CE QUI SORT. Rien d'autre ne doit jamais être copié ni téléchargé : ni le
  // canevas d'affichage, ni ses repères.
  function odCanvasFinal() {
    const base = odCanvasRedresse(); if (!base) return null;
    const q = odQuad(base);
    if (odQuadIntact(q, base)) return base;
    return odRedresser(base, q) || base;
  }

  // ── Rendu ─────────────────────────────────────────────────────────────────
  // DEUX canevas superposés, et c'est délibéré : le cadre et les poignées ne
  // sont JAMAIS dessinés sur l'image. Quoi qu'il arrive — un clic droit sur la
  // photo, une capture, un presse-papiers resté sur un essai précédent — ce
  // qu'on peut prendre de cet écran reste une ordonnance propre.
  function odRendVue() {
    const v = odVue; if (!v || !v.img) return;
    const cv = document.getElementById('od-v-canvas');
    const rp = document.getElementById('od-v-repere');
    const ctx = cv.getContext('2d'), rc = rp.getContext('2d');

    // Le mode APERÇU montre exactement ce qui partira dans le presse-papiers.
    // C'est la réponse à « qu'est-ce que je copie au juste ? » : on le voit.
    const base = odCanvasRedresse();
    const q = odQuad(base);
    const montre = v.apercu ? (odCanvasFinal() || base) : base;
    const f = Math.min(1, 1040 / montre.width, (window.innerHeight - 200) / montre.height);
    const L = Math.round(montre.width * f), H = Math.round(montre.height * f);
    cv.width = L; cv.height = H;
    rp.width = L; rp.height = H;
    rp.style.width = L + 'px'; rp.style.height = H + 'px';
    rp.dataset.f = f;
    ctx.drawImage(montre, 0, 0, L, H);

    rc.clearRect(0, 0, L, H);
    if (!v.apercu) {
      const chemin = () => {
        rc.beginPath();
        rc.moveTo(q[0].x * f, q[0].y * f);
        for (let i = 1; i < 4; i++) rc.lineTo(q[i].x * f, q[i].y * f);
        rc.closePath();
      };
      if (!odQuadIntact(q, base)) {
        // Assombrir hors du document : le « trou » se fait par pair-impair.
        rc.save();
        rc.beginPath();
        rc.rect(0, 0, L, H);
        rc.moveTo(q[0].x * f, q[0].y * f);
        for (let i = 3; i >= 1; i--) rc.lineTo(q[i].x * f, q[i].y * f);
        rc.closePath();
        rc.fillStyle = 'rgba(16,26,21,.60)';
        rc.fill('evenodd');
        rc.restore();
      }
      chemin();
      rc.strokeStyle = '#7ED9A8'; rc.lineWidth = 2; rc.stroke();
      for (let i = 0; i < 4; i++) {
        rc.beginPath();
        rc.arc(q[i].x * f, q[i].y * f, 10, 0, 6.2832);
        rc.fillStyle = '#fff'; rc.fill();
        rc.strokeStyle = '#1D5C3A'; rc.lineWidth = 3; rc.stroke();
      }
    }

    const fin = odCanvasFinal();
    const redresse = !odQuadIntact(q, base);
    odDerniereTaille = fin.width + ' × ' + fin.height;
    document.getElementById('od-v-etat').textContent =
      odDerniereTaille + ' px'
      + (redresse ? ' · redressé' : '')
      + (v.rot ? ' · pivoté de ' + v.rot + '°' : '');
    document.getElementById('od-v-tout').style.display = redresse ? '' : 'none';
    const a = document.getElementById('od-v-apercu');
    a.textContent = v.apercu ? 'Revenir aux coins' : 'Voir ce qui sera copié';
    a.classList[v.apercu ? 'add' : 'remove']('od-ok');
  }
  let odDerniereTaille = '';

  window.odPivoter = function (sens) {
    if (!odVue) return;
    odVue.rot = ((odVue.rot + sens * 90) % 360 + 360) % 360;
    odVue.quad = null; odVue.apercu = false;   // les coins n'ont plus de sens
    odRendVue();
  };
  window.odToutPrendre = function () {
    if (!odVue) return;
    odVue.quad = null; odVue.apercu = false; odRendVue();
  };
  window.odBasculerApercu = function () {
    if (!odVue) return;
    odVue.apercu = !odVue.apercu;
    odRendVue();
  };

  // ── Déplacer les coins ────────────────────────────────────────────────────
  // Souris et doigt, même code. Les coins sont mémorisés en coordonnées de
  // l'IMAGE : un redimensionnement de fenêtre ne doit pas les déplacer.
  function odBrancherCadre() {
    const cv = document.getElementById('od-v-repere'); if (!cv) return;
    let saisi = -1;
    const pos = (ev) => {
      const r = cv.getBoundingClientRect();
      const t = (ev.touches && ev.touches[0]) || ev;
      const f = Number(cv.dataset.f) || 1;
      return { x: (t.clientX - r.left) * (cv.width / r.width) / f,
               y: (t.clientY - r.top) * (cv.height / r.height) / f };
    };
    const debut = (ev) => {
      if (!odVue || !odVue.img || odVue.apercu) return;
      const base = odCanvasRedresse(); const q = odQuad(base);
      const p = pos(ev);
      // Le doigt est gros : on accepte large, proportionnellement à l'image.
      const seuil = Math.max(26, Math.min(base.width, base.height) / 14);
      let d = seuil, k = -1;
      for (let i = 0; i < 4; i++) {
        const dd = odDist(p, q[i]);
        if (dd < d) { d = dd; k = i; }
      }
      if (k < 0) return;
      ev.preventDefault(); saisi = k;
    };
    const bouge = (ev) => {
      if (saisi < 0 || !odVue) return;
      ev.preventDefault();
      const base = odCanvasRedresse(); const q = odQuad(base);
      const p = pos(ev);
      q[saisi] = { x: Math.max(0, Math.min(base.width, p.x)),
                   y: Math.max(0, Math.min(base.height, p.y)) };
      odRendVue();
    };
    const fin = () => { saisi = -1; };
    cv.addEventListener('mousedown', debut);
    window.addEventListener('mousemove', bouge);
    window.addEventListener('mouseup', fin);
    cv.addEventListener('touchstart', debut, { passive: false });
    cv.addEventListener('touchmove', bouge, { passive: false });
    cv.addEventListener('touchend', fin);
  }

  // ── Sortir l'image : copier, ou télécharger ───────────────────────────────
  // Le presse-papiers n'accepte que le PNG — Chrome refuse le JPEG, et Safari
  // exige que le ClipboardItem soit construit avec une PROMESSE de blob, dans
  // le geste de l'utilisateur. D'où cette forme, qui marche partout.
  window.odCopier = async function () {
    const c = odCanvasFinal(); if (!c) return;
    const b = document.getElementById('od-v-copier');
    const avant = b.textContent;
    try {
      if (!navigator.clipboard || !window.ClipboardItem) throw new Error('presse-papiers indisponible');
      const png = new Promise(function (ok) { c.toBlob(ok, 'image/png'); });
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      b.textContent = '✓ Copié · ' + odDerniereTaille;
      b.classList.add('od-ok');
      setTimeout(function () { b.textContent = avant; b.classList.remove('od-ok'); }, 1800);
    } catch (e) {
      // Pas de drame : on bascule sur le téléchargement, en le disant.
      odTelecharger();
      alert('Votre navigateur ne permet pas la copie directe.\n\n'
        + 'L’image a été téléchargée : vous pouvez l’insérer dans le logiciel depuis le dossier Téléchargements.');
    }
  };

  window.odTelecharger = function () {
    const c = odCanvasFinal(); if (!c || !odVue) return;
    const d = odVue.depot;
    const nom = 'ordonnance-D' + (d.num || '') + (odVue.index ? '-' + (odVue.index + 1) : '') + '.jpg';
    c.toBlob(function (b) {
      if (!b) return;
      const u = URL.createObjectURL(b);
      const a = document.createElement('a');
      a.href = u; a.download = nom;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
    }, 'image/jpeg', 0.92);
  };

  // Enregistrer le redressement et le détourage DANS le dépôt : utile avant de
  // rattacher à un dossier, pour que la pièce conservée soit la bonne.
  window.odEnregistrerRecadrage = async function () {
    const v = odVue; if (!v) return;
    const c = odCanvasFinal(); if (!c) return;
    const b = document.getElementById('od-v-garder');
    b.disabled = true; b.textContent = 'Enregistrement…';
    try {
      const data = c.toDataURL('image/jpeg', 0.9).split(',')[1];
      const r = await fetch('/api/images', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mime: 'image/jpeg', data: data })
      });
      const j = await r.json().catch(function () { return null; });
      if (!r.ok || !j || !j.ok) { alert('Enregistrement refusé : ' + ((j && j.error) || r.status)); return; }
      const f = (v.depot.fichiers || [])[v.index];
      if (f) { f.fichId = j.id; f.fichMime = 'image/jpeg'; f.fichTaille = Math.round(data.length * 3 / 4); }
      v.depot.updatedAt = Date.now();
      odSave(true);
      odFermerVue(); window.odRender();
    } catch (e) {
      alert('Enregistrement impossible : ' + e.message);
    } finally { b.disabled = false; b.textContent = 'Enregistrer le recadrage'; }
  };

  // ── Rattacher à un dossier ────────────────────────────────────────────────
  let odRattId = null;
  window.odFormRattacher = function (id) {
    odRattId = id;
    document.getElementById('od-r-q').value = '';
    odRendRattacher();
    document.getElementById('od-ov-ratt').classList.add('open');
  };
  window.odFermerRattacher = function () { document.getElementById('od-ov-ratt').classList.remove('open'); };

  window.odRendRattacher = function () {
    const q = String((document.getElementById('od-r-q') || {}).value || '').trim().toLowerCase();
    const cand = [];
    odLocs().forEach(function (l) {
      if (!l || l.id == null) return;
      cand.push({ type: 'location', ref: l.id, qui: ((l.nom || '') + ' ' + (l.prenom || '')).trim(),
                  quoi: 'Location' + (l.num ? ' n° ' + l.num : '') });
    });
    odRenouv().forEach(function (r) {
      if (!r || r.id == null) return;
      cand.push({ type: 'renouvellement', ref: r.id, qui: ((r.nom || '') + ' ' + (r.prenom || '')).trim(),
                  quoi: 'Renouvellement' });
    });
    const l = cand.filter(function (c) { return !q || c.qui.toLowerCase().indexOf(q) >= 0; }).slice(0, 40);
    const el = document.getElementById('od-r-liste');
    el.innerHTML = l.length
      ? l.map(function (c, i) {
          return '<button class="od-r-item" onclick="odRattacherA(' + i + ')">'
            + '<span class="od-r-qui">' + E(c.qui || '(sans nom)') + '</span>'
            + '<span class="od-r-quoi">' + E(c.quoi) + '</span></button>';
        }).join('')
      : '<div class="od-vide">Aucun dossier ne correspond.</div>';
    odRattCand = l;   // un gestionnaire ne reçoit qu'un indice, jamais un nom
  };
  let odRattCand = [];
  window.odRattacherA = function (i) {
    const c = odRattCand[i]; if (!c) return;
    const d = odListe().find(function (x) { return x && x.id === odRattId; }); if (!d) return;
    d.lien = { type: c.type, ref: c.ref };
    d.rattacheLe = Date.now(); d.rattachePar = (odUser() || {}).id || null;
    d.updatedAt = Date.now();
    if (typeof logAction === 'function') logAction('Dépôt rattaché', 'D-' + (d.num || ''));
    odSave(true); odFermerRattacher(); window.odRender();
  };
  window.odDetacher = function (id) {
    const d = odListe().find(function (x) { return x && x.id === id; }); if (!d) return;
    if (!confirm('Détacher ce dépôt de son dossier ?\n\nIl repartira dans la boîte, et sera effacé sept jours après son arrivée.')) return;
    d.lien = null; d.updatedAt = Date.now();
    odSave(true); window.odRender();
  };

  // ── Traité / supprimé ─────────────────────────────────────────────────────
  // « Traité » est la marche normale : l'ordonnance est saisie dans le LGO, elle
  // n'a plus rien à faire ici. On n'attend pas les sept jours.
  window.odTraite = function (id) {
    const l = odListe(), i = l.findIndex(function (x) { return x && x.id === id; }); if (i < 0) return;
    if (!confirm('Le dépôt D-' + (l[i].num || '') + ' est saisi dans le logiciel ?\n\n'
      + 'Il sera effacé de PILOT immédiatement, avec son image.')) return;
    if (typeof markDeleted === 'function') markDeleted('depots', id);
    if (typeof logAction === 'function') logAction('Dépôt traité et effacé', 'D-' + (l[i].num || ''));
    l.splice(i, 1);
    odSave(true); window.odRender();
  };

  // ── Rendu de la boîte ─────────────────────────────────────────────────────
  function odVignettes(d) {
    return (d.fichiers || []).map(function (f, i) {
      if (!f || !f.fichId) return '';
      const pdf = f.fichMime === 'application/pdf';
      return '<button class="od-vig' + (pdf ? ' pdf' : '') + '" onclick="odOuvrirFichier(' + (+d.id) + ',' + i + ')" '
        + 'title="' + (pdf ? 'Ouvrir le PDF' : 'Ouvrir, redresser, détourer') + '">'
        + (pdf ? '<span>PDF</span>' : '<img src="/api/images/' + E(f.fichId) + '" alt="" loading="lazy">')
        + '</button>';
    }).join('');
  }

  function odCarte(d, dansBoite) {
    const n = odRestant(d);
    const urgent = n != null && n <= 2;
    return '<div class="od-c' + (urgent ? ' urgent' : '') + '">'
      + '<div class="od-c-h">'
      +   '<span class="od-num">D-' + E(String(d.num == null ? '?' : d.num)) + '</span>'
      +   '<span class="od-qui">' + E(odIdentite(d)) + '</span>'
      +   '<span class="od-meta">'
      +     (d.origine === 'comptoir' ? 'Déposée au comptoir'
              : 'Envoyée par lien' + (d.prenom ? ' par ' + E(d.prenom) : ''))
      +     ' · ' + E(odQuand(d.ts))
      +   '</span>'
      +   (dansBoite
          ? '<span class="od-reste' + (urgent ? ' urgent' : '') + '">' + E(odMotRestant(n)) + '</span>'
          : '<span class="od-lie">' + E(odNomDossier(d.lien)) + ' · conservée</span>')
      + '</div>'
      + '<div class="od-c-v">' + odVignettes(d) + '</div>'
      + '<div class="od-c-a">'
      + (dansBoite
          ? '<button class="btn bp sm" onclick="odFormRattacher(' + (+d.id) + ')">Rattacher à un dossier</button>'
            + '<button class="btn bs sm" onclick="odTraite(' + (+d.id) + ')">Traité, effacer</button>'
          : '<button class="btn bs sm" onclick="odDetacher(' + (+d.id) + ')">Détacher</button>')
      + '</div></div>';
  }

  window.odRender = function () {
    if (!document.getElementById('sec-depots')) return;
    const boite = odEnBoite(odListe());
    const classes = odClasses(odListe());

    const nb = document.getElementById('od-nb');
    if (nb) nb.textContent = boite.length ? '· ' + boite.length : '';

    const el = document.getElementById('od-boite');
    if (el) {
      el.innerHTML = boite.length
        ? boite.map(function (d) { return odCarte(d, true); }).join('')
        : '<div class="od-vide">Aucune ordonnance en attente.<br>'
          + '<span class="od-vide-s">Celles que les patients envoient depuis l’affiche arrivent ici.</span></div>';
    }
    const hc = document.getElementById('od-h-classes');
    if (hc) hc.style.display = classes.length ? '' : 'none';
    const ec = document.getElementById('od-classes');
    if (ec) {
      ec.style.display = classes.length ? '' : 'none';
      ec.innerHTML = classes.map(function (d) { return odCarte(d, false); }).join('');
    }
    // La pastille du menu : on ne découvre pas une ordonnance en attente en
    // ouvrant le module par hasard.
    const b = document.querySelector('.sb-item[data-sec="depots"]');
    if (b) {
      let p = b.querySelector('.od-pastille');
      if (boite.length) {
        if (!p) { p = document.createElement('span'); p.className = 'od-pastille'; b.appendChild(p); }
        p.textContent = boite.length;
      } else if (p) p.remove();
    }
  };

  // Pour l'accueil : une pastille à côté des autres.
  window.odAlerteAccueil = function () {
    if (!document.querySelector('.sb-item[data-sec="depots"]')) return '';
    const n = odEnBoite(odListe()).length;
    if (!n) return '';
    return '<button class="ac-al" onclick="showSec(\'depots\')"><span class="ac-pt"></span>'
      + n + ' ordonnance' + (n > 1 ? 's' : '') + ' déposée' + (n > 1 ? 's' : '') + ' à traiter</button>';
  };

  // ── Back office : l'interrupteur ──────────────────────────────────────────
  // La valeur n'est pas lue dans le bloc mais demandee au serveur : c'est LUI
  // qui decide s'il accepte un depot, et l'ecran doit montrer sa reponse, pas
  // une copie qui pourrait diverger.
  let odOuvert = null;
  window.odRendBO = async function () {
    const el = document.getElementById('od-bo'); if (!el) return;
    el.innerHTML = '<div style="color:var(--gray-500);font-size:.85rem">Lecture de l\u2019\u00e9tat\u2026</div>';
    try {
      const j = await (await fetch('/api/depot/etat', { cache: 'no-store' })).json();
      odOuvert = !!(j && j.ouvert);
    } catch (e) { odOuvert = null; }
    if (odOuvert === null) {
      el.innerHTML = '<div style="color:#B3261E;font-size:.85rem">\u00c9tat indisponible : serveur injoignable.</div>';
      return;
    }
    el.innerHTML =
      '<div class="od-bo-l">'
      + '<span class="od-pt' + (odOuvert ? ' on' : '') + '"></span>'
      + '<span class="od-bo-t">' + (odOuvert
          ? 'Le d\u00e9p\u00f4t est <b>ouvert</b> : les patients peuvent envoyer leur ordonnance.'
          : 'Le d\u00e9p\u00f4t est <b>ferm\u00e9</b> : la page affiche un message d\u2019indisponibilit\u00e9.') + '</span>'
      + (odAdmin()
          ? '<button class="btn ' + (odOuvert ? 'bs' : 'bp') + ' sm" id="od-bo-b" onclick="odBasculerOuverture()">'
            + (odOuvert ? 'Fermer le d\u00e9p\u00f4t' : 'Ouvrir le d\u00e9p\u00f4t') + '</button>'
          : '')
      + '</div>'
      + '<div style="font-size:.78rem;color:var(--gray-500);margin-top:9px;line-height:1.55">'
      + 'Fermer arr\u00eate imm\u00e9diatement les nouveaux d\u00e9p\u00f4ts, sans toucher \u00e0 ceux d\u00e9j\u00e0 re\u00e7us. '
      + 'C\u2019est la contrepartie d\u2019une adresse publique : si l\u2019affiche est photographi\u00e9e et que quelqu\u2019un '
      + 's\u2019amuse, on ferme en un clic, sans attendre un d\u00e9ploiement.</div>';
  };

  window.odBasculerOuverture = async function () {
    if (!odAdmin()) return;
    const vers = !odOuvert;
    if (!vers && !confirm('Fermer le d\u00e9p\u00f4t en ligne ?\n\n'
      + 'Les patients qui scannent l\u2019affiche verront un message d\u2019indisponibilit\u00e9, '
      + 'et les liens envoy\u00e9s par SMS ne fonctionneront plus.')) return;
    const b = document.getElementById('od-bo-b');
    if (b) { b.disabled = true; b.textContent = '\u2026'; }
    try {
      const r = await fetch('/api/depot/ouverture', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ouvert: vers })
      });
      const j = await r.json().catch(function () { return null; });
      if (!r.ok || !j || !j.ok) { alert('Refus\u00e9 : ' + ((j && j.error) || r.status)); }
      else if (typeof logAction === 'function') {
        logAction('D\u00e9p\u00f4t en ligne ' + (vers ? 'ouvert' : 'ferm\u00e9'), '');
      }
    } catch (e) { alert('Impossible : ' + e.message); }
    window.odRendBO();
  };

  // ── CSS ───────────────────────────────────────────────────────────────────
  const OD_CSS = `
  #sec-depots{padding:0}
  .od-wrap{max-width:980px;margin:0 auto}
  .od-bar{display:flex;align-items:center;gap:10px;margin-bottom:18px;flex-wrap:wrap}
  .od-title{display:flex;align-items:center;gap:8px;font-size:18px;font-weight:700;color:#1D5C3A}
  .od-grow{flex:1}
  .od-h{font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;
    color:var(--gray-500);margin:26px 0 10px 2px}

  .od-c{background:#fff;border:1px solid #e7ece9;border-radius:13px;padding:14px 16px;margin-bottom:11px}
  .od-c:hover{border-color:#cdd8d1}
  .od-c.urgent{border-color:#F3C9A0;background:#FFFBF6}
  .od-c-h{display:flex;align-items:center;gap:11px;flex-wrap:wrap}
  .od-num{background:#1D5C3A;color:#fff;border-radius:8px;padding:4px 11px;font-weight:800;
    font-size:.92rem;letter-spacing:.03em;font-variant-numeric:tabular-nums;flex:none}
  .od-qui{font-weight:700;font-size:.95rem;color:#1a2b22}
  .od-meta{font-size:.82rem;color:var(--gray-500)}
  .od-reste{margin-left:auto;font-size:.78rem;color:var(--gray-500)}
  .od-reste.urgent{color:#B35309;font-weight:700}
  .od-lie{margin-left:auto;font-size:.8rem;color:#1D5C3A;font-weight:600}
  .od-c-v{display:flex;gap:9px;flex-wrap:wrap;margin-top:12px}
  .od-vig{width:96px;height:124px;border:1px solid #dfe8e2;border-radius:9px;overflow:hidden;
    background:#fff;padding:0;cursor:zoom-in;flex:none;display:block}
  .od-vig img{width:100%;height:100%;object-fit:cover;display:block}
  .od-vig:hover{border-color:#1D5C3A}
  .od-vig.pdf{display:flex;align-items:center;justify-content:center;background:#F1F6F3;
    font-size:.74rem;font-weight:800;color:#1D5C3A;letter-spacing:.05em;cursor:pointer}
  .od-c-a{display:flex;gap:9px;margin-top:13px;flex-wrap:wrap}
  .od-vide{padding:2.2rem 1rem;text-align:center;color:var(--gray-500);font-size:.9rem;
    background:#fff;border:1px dashed #e0e7e3;border-radius:13px;line-height:1.7}
  .od-vide-s{font-size:.82rem}
  .od-bo-l{display:flex;align-items:center;gap:11px;flex-wrap:wrap}
  .od-bo-t{font-size:.9rem}
  .od-pt{width:10px;height:10px;border-radius:50%;background:#C62828;flex:none}
  .od-pt.on{background:#2E7D52}
  .od-bo-l .btn{margin-left:auto}
  .od-pastille{margin-left:auto;background:#C62828;color:#fff;border-radius:999px;
    min-width:19px;height:19px;padding:0 5px;font-size:.7rem;font-weight:800;
    display:inline-flex;align-items:center;justify-content:center}

  /* ── Le visualiseur ── */
  .od-ov{position:fixed;inset:0;background:rgba(16,26,21,.93);z-index:9000;
    display:none;flex-direction:column;align-items:center;padding:14px}
  .od-ov.open{display:flex}
  .od-v-tete{display:flex;align-items:baseline;gap:11px;width:100%;max-width:1100px;margin-bottom:8px}
  .od-v-bar{display:flex;align-items:center;gap:8px;width:100%;max-width:1100px;
    flex-wrap:wrap;justify-content:flex-end;margin-bottom:10px}
  .od-v-t{color:#fff;font-weight:700;font-size:1rem;flex:none}
  .od-v-etat{color:#9fb3a8;font-size:.8rem;font-variant-numeric:tabular-nums}
  .od-v-sp{flex:1}
  .od-b{font:inherit;font-size:.85rem;font-weight:600;cursor:pointer;border-radius:9px;
    padding:9px 13px;border:1px solid rgba(255,255,255,.28);background:transparent;color:#fff}
  .od-b:hover{background:rgba(255,255,255,.12)}
  .od-b.pri{background:#2E7D52;border-color:#2E7D52;font-weight:700}
  .od-b.pri:hover{background:#34936a}
  .od-b.od-ok{background:#1D5C3A;border-color:#1D5C3A}
  .od-b:disabled{opacity:.5;cursor:default}
  .od-v-zone{flex:1;overflow:auto;display:flex;align-items:flex-start;justify-content:center;width:100%}
  /* Deux calques : l'image dessous, les rep\u00e8res dessus. Ce qui se copie ne
     porte jamais de cadre. */
  .od-v-pile{position:relative;line-height:0}
  #od-v-canvas{display:block;border-radius:6px;background:#fff;box-shadow:0 8px 30px rgba(0,0,0,.4)}
  #od-v-repere{position:absolute;left:0;top:0;cursor:crosshair;touch-action:none}
  .od-v-aide{color:#9fb3a8;font-size:.78rem;margin-top:9px;text-align:center}

  /* ── Rattachement ── */
  .od-r-liste{max-height:48vh;overflow:auto;margin-top:12px}
  .od-r-item{display:flex;align-items:center;gap:10px;width:100%;text-align:left;
    font:inherit;background:#fff;border:1px solid #e7ece9;border-radius:10px;
    padding:11px 13px;margin-bottom:7px;cursor:pointer}
  .od-r-item:hover{border-color:#1D5C3A;background:#F7FBF9}
  .od-r-qui{font-weight:700;font-size:.92rem}
  .od-r-quoi{margin-left:auto;font-size:.78rem;color:var(--gray-500)}
  @media(max-width:640px){ .od-vig{width:78px;height:102px} }`;

  // ── Gabarit ───────────────────────────────────────────────────────────────
  const OD_SECTION =
    '<div class="od-wrap">'
    + '<div class="od-bar"><div class="od-title">'
    +   '<svg class="ico"><use href="#ic-ordonnance"></use></svg> Ordonnances déposées'
    +   ' <span id="od-nb" style="color:var(--gray-500);font-weight:600"></span></div>'
    + '<span class="od-grow"></span>'
    + '<a class="btn bs sm" href="/documents/affiche-depot-ordonnance.pdf" target="_blank" rel="noopener"'
    +   ' style="text-decoration:none">Affiche à imprimer</a></div>'
    + '<div id="od-boite"></div>'
    + '<div class="od-h" id="od-h-classes" style="display:none">Rattachées à un dossier</div>'
    + '<div id="od-classes" style="display:none"></div>'
    + '</div>';

  const OD_MODALES =
    '<div class="od-ov" id="od-ov-vue">'
    + '<div class="od-v-tete">'
    +   '<span class="od-v-t">Ordonnance déposée</span>'
    +   '<span class="od-v-etat" id="od-v-etat"></span>'
    +   '<span class="od-v-sp"></span>'
    +   '<button class="od-b" onclick="odFermerVue()">Fermer</button>'
    + '</div>'
    + '<div class="od-v-bar">'
    +   '<button class="od-b" onclick="odPivoter(-1)" title="Pivoter à gauche">⟲</button>'
    +   '<button class="od-b" onclick="odPivoter(1)" title="Pivoter à droite">⟳</button>'
    +   '<button class="od-b" id="od-v-tout" onclick="odToutPrendre()" style="display:none">Tout prendre</button>'
    +   '<button class="od-b" id="od-v-apercu" onclick="odBasculerApercu()">Voir ce qui sera copi\u00e9</button>'
    +   '<button class="od-b" id="od-v-garder" onclick="odEnregistrerRecadrage()">Enregistrer le recadrage</button>'
    +   '<button class="od-b" onclick="odTelecharger()">Télécharger</button>'
    +   '<button class="od-b pri" id="od-v-copier" onclick="odCopier()">Copier l’image</button>'
    + '</div>'
    + '<div class="od-v-zone" id="od-v-zone"><div class="od-v-pile">'
    +   '<canvas id="od-v-canvas"></canvas><canvas id="od-v-repere"></canvas></div></div>'
    + '<div class="od-v-aide">Déplacez les quatre coins sur ceux de l’ordonnance : elle sera redressée et détourée, même prise de biais. « Voir ce qui sera copié » montre le résultat exact.</div>'
    + '</div>'

    + '<div class="overlay" id="od-ov-ratt">'
    + '<div class="mbox" style="max-width:520px">'
    +   '<div class="mbox-h"><b>Rattacher à un dossier</b>'
    +     '<button class="x" onclick="odFermerRattacher()">✕</button></div>'
    +   '<div class="mbox-b">'
    +     '<input class="inp" id="od-r-q" placeholder="Nom du patient…" oninput="odRendRattacher()" autocomplete="off">'
    +     '<div class="od-r-liste" id="od-r-liste"></div>'
    +     '<div style="font-size:.78rem;color:var(--gray-500);margin-top:10px">'
    +       'Une ordonnance rattachée à un dossier est <b>conservée</b> et suit la rétention de ce dossier. '
    +       'Sans rattachement, elle est effacée sept jours après son arrivée.</div>'
    +   '</div>'
    + '</div></div>';

  function odInject() {
    if (document.getElementById('od-css')) return;
    const st = document.createElement('style');
    st.id = 'od-css'; st.textContent = OD_CSS;
    document.head.appendChild(st);

    const navRef = document.querySelector('.sb-item[data-sec="renouvellement"]')
      || document.querySelector('.sb-item[data-sec="preparations"]')
      || document.querySelector('.sb-item[data-sec="livraisons"]');
    if (navRef && !document.querySelector('.sb-item[data-sec="depots"]')) {
      const b = document.createElement('button');
      b.className = 'sb-item';
      b.setAttribute('data-sec', 'depots');
      b.setAttribute('onclick', "showSec('depots',this)");
      b.innerHTML = '<svg class="ico sb-ico"><use href="#ic-ordonnance"></use></svg>'
        + '<span class="sb-label">Ordonnances déposées</span>';
      navRef.insertAdjacentElement('afterend', b);
    }

    const secRef = document.getElementById('sec-livraisons');
    if (secRef && !document.getElementById('sec-depots')) {
      const sec = document.createElement('section');
      sec.id = 'sec-depots'; sec.className = 'sec';
      sec.innerHTML = OD_SECTION;
      secRef.parentNode.appendChild(sec);
      const m = document.createElement('div');
      m.innerHTML = OD_MODALES;
      while (m.firstChild) document.body.appendChild(m.firstChild);
      odBrancherCadre();
      window.odRender();
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', odInject);
  else odInject();
})();
