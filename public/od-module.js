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
  // Le nom du dossier n'est repete que s'il DIFFERE de celui du depot : deux
  // fois le meme nom sur une carte est du bruit, et un nom different est au
  // contraire une information — le rattachement s'est peut-etre trompe.
  function odDossierCourt(d) {
    const dos = odNomDossier(d.lien);
    const moi = ((d.nom || '') + ' ' + (d.prenom || '')).trim();
    return (dos && dos !== moi) ? dos + ' \u00b7 conserv\u00e9e' : 'conserv\u00e9e';
  }
  function odPrenomDe(id) {
    const l = (typeof staffDB !== 'undefined' && Array.isArray(staffDB)) ? staffDB : [];
    const s = l.find(x => x && x.id === id);
    return s ? (s.prenom || s.id) : 'un collaborateur';
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
  // Un seul principe, et tout en découle : CE QUI EST À L'ÉCRAN EST CE QUI
  // SERA COPIÉ. Pas de mode, pas d'aperçu, pas de « valider » qui referme la
  // fenêtre en laissant douter. On travaille sur une image, on la voit changer,
  // on la copie.
  //
  // Les coins se posent d'un CLIC, un par coin, dans l'ordre. Le glisser-
  // déposer n'a été gardé que pour rectifier un coin déjà posé : au comptoir,
  // viser puis maintenir puis lâcher au bon endroit est un geste de trop.
  //
  // Le détourage n'est pas un rectangle mais un quadrilatère : une ordonnance
  // photographiée de biais n'est jamais un rectangle à l'écran. « Recadrer »
  // la redresse par une homographie — elle ressort plate, comme posée sur la
  // vitre d'un scanner.
  let odVue = null;   // { depot, index, orig, travail, pose:[], glisse }

  const OD_COINS = ['en haut à gauche', 'en haut à droite', 'en bas à droite', 'en bas à gauche'];

  window.odOuvrirFichier = function (depotId, i) {
    const d = odListe().find(x => x && x.id === depotId); if (!d) return;
    const f = (d.fichiers || [])[i]; if (!f) return;
    if (f.fichMime === 'application/pdf') { window.open('/api/images/' + f.fichId, '_blank', 'noopener'); return; }
    odVue = { depot: d, index: i, orig: null, travail: null, pose: [], glisse: -1 };
    document.getElementById('od-ov-vue').classList.add('open');
    document.getElementById('od-v-etat').textContent = 'Chargement…';
    const img = new Image();
    img.onload = function () {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      odVue.orig = c; odVue.travail = c; odVue.pose = [];
      odRendVue();
    };
    img.onerror = function () { document.getElementById('od-v-etat').textContent = 'Image illisible.'; };
    img.src = '/api/images/' + f.fichId;
  };
  window.odFermerVue = function () {
    document.getElementById('od-ov-vue').classList.remove('open');
    odVue = null;
  };

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

  // Le redressement. Bilinéaire : au plus proche voisin, les petits caractères
  // d'une posologie deviennent illisibles.
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

  // CE QUI SORT, toujours : l'image de travail, telle qu'elle est affichée.
  // Ni le canevas d'affichage, ni ses repères.
  function odCanvasFinal() { return odVue ? odVue.travail : null; }

  // ── Les actions ───────────────────────────────────────────────────────────
  window.odRecadrer = function () {
    const v = odVue; if (!v || v.pose.length !== 4) return;
    const c = odRedresser(v.travail, v.pose);
    if (!c) { alert('Les quatre coins ne forment pas une surface exploitable. Reprenez-les.'); return; }
    v.travail = c; v.pose = [];
    odRendVue();
  };
  window.odPivoter = function (sens) {
    const v = odVue; if (!v || !v.travail) return;
    const s = v.travail;
    const c = document.createElement('canvas');
    c.width = s.height; c.height = s.width;
    const ctx = c.getContext('2d');
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate(sens * 90 * Math.PI / 180);
    ctx.drawImage(s, -s.width / 2, -s.height / 2);
    v.travail = c; v.pose = [];
    odRendVue();
  };
  window.odRecommencer = function () {
    const v = odVue; if (!v) return;
    v.travail = v.orig; v.pose = [];
    odRendVue();
  };
  window.odDefaire = function () {
    const v = odVue; if (!v || !v.pose.length) return;
    v.pose.pop();
    odRendVue();
  };

  // ── Rendu ─────────────────────────────────────────────────────────────────
  // DEUX canevas superposés, et c'est délibéré : les coins et le cadre ne sont
  // JAMAIS dessinés sur l'image. Quoi qu'il arrive — un clic droit sur la
  // photo, une capture — ce qu'on prend de cet écran est une ordonnance propre.
  function odRendVue() {
    const v = odVue; if (!v || !v.travail) return;
    const cv = document.getElementById('od-v-canvas');
    const rp = document.getElementById('od-v-repere');
    const ctx = cv.getContext('2d'), rc = rp.getContext('2d');
    const t = v.travail;

    const f = Math.min(1, 1040 / t.width, (window.innerHeight - 210) / t.height);
    const L = Math.round(t.width * f), H = Math.round(t.height * f);
    cv.width = L; cv.height = H;
    rp.width = L; rp.height = H;
    rp.style.width = L + 'px'; rp.style.height = H + 'px';
    rp.dataset.f = f;
    ctx.drawImage(t, 0, 0, L, H);

    rc.clearRect(0, 0, L, H);
    const n = v.pose.length;
    if (n) {
      rc.save();
      if (n === 4) {
        // Assombrir hors du document : le « trou » se fait par pair-impair.
        rc.beginPath();
        rc.rect(0, 0, L, H);
        rc.moveTo(v.pose[0].x * f, v.pose[0].y * f);
        for (let i = 3; i >= 1; i--) rc.lineTo(v.pose[i].x * f, v.pose[i].y * f);
        rc.closePath();
        rc.fillStyle = 'rgba(16,26,21,.58)';
        rc.fill('evenodd');
      }
      rc.beginPath();
      rc.moveTo(v.pose[0].x * f, v.pose[0].y * f);
      for (let i = 1; i < n; i++) rc.lineTo(v.pose[i].x * f, v.pose[i].y * f);
      if (n === 4) rc.closePath();
      rc.strokeStyle = '#7ED9A8'; rc.lineWidth = 2; rc.stroke();
      for (let i = 0; i < n; i++) {
        rc.beginPath();
        rc.arc(v.pose[i].x * f, v.pose[i].y * f, 11, 0, 6.2832);
        rc.fillStyle = '#fff'; rc.fill();
        rc.strokeStyle = '#1D5C3A'; rc.lineWidth = 3; rc.stroke();
        rc.fillStyle = '#1D5C3A'; rc.font = 'bold 12px system-ui';
        rc.textAlign = 'center'; rc.textBaseline = 'middle';
        rc.fillText(String(i + 1), v.pose[i].x * f, v.pose[i].y * f + 1);
      }
      rc.restore();
    }

    odDerniereTaille = t.width + ' × ' + t.height;
    document.getElementById('od-v-etat').textContent = odDerniereTaille + ' px';
    // La consigne dit TOUJOURS quel geste vient ensuite. C'est ce qui remplace
    // un mode d'emploi.
    document.getElementById('od-v-aide').textContent = n === 0
      ? 'Cliquez le coin ' + OD_COINS[0] + ' de l’ordonnance — ou copiez l’image telle quelle.'
      : n < 4
        ? 'Cliquez maintenant le coin ' + OD_COINS[n] + '.'
        : 'Les quatre coins sont posés. « Recadrer » redresse l’ordonnance ; un coin mal placé se rattrape en le déplaçant.';
    const b = document.getElementById('od-v-recadrer');
    b.style.display = n === 4 ? '' : 'none';
    document.getElementById('od-v-defaire').style.display = (n > 0 && n < 4) ? '' : 'none';
    document.getElementById('od-v-reprendre').style.display =
      (v.travail !== v.orig || n) ? '' : 'none';
  }
  let odDerniereTaille = '';

  // ── Poser et rectifier les coins ──────────────────────────────────────────
  // Un CLIC pose le coin suivant. Une fois les quatre posés, un clic près d'un
  // coin le reprend et le glisse : c'est le seul cas où il faut maintenir.
  function odBrancherCadre() {
    const cv = document.getElementById('od-v-repere'); if (!cv) return;
    const pos = (ev) => {
      const r = cv.getBoundingClientRect();
      const t = (ev.touches && ev.touches[0]) || (ev.changedTouches && ev.changedTouches[0]) || ev;
      const f = Number(cv.dataset.f) || 1;
      return { x: (t.clientX - r.left) * (cv.width / r.width) / f,
               y: (t.clientY - r.top) * (cv.height / r.height) / f };
    };
    const proche = (p) => {
      const v = odVue;
      // Le doigt est gros, et l'écran du comptoir n'est pas un écran de
      // graphiste : on accepte large, proportionnellement à l'image.
      const seuil = Math.max(24, Math.min(v.travail.width, v.travail.height) / 16);
      let d = seuil, k = -1;
      for (let i = 0; i < v.pose.length; i++) {
        const dd = odDist(p, v.pose[i]);
        if (dd < d) { d = dd; k = i; }
      }
      return k;
    };
    const debut = (ev) => {
      const v = odVue; if (!v || !v.travail) return;
      ev.preventDefault();
      const p = pos(ev);
      const k = proche(p);
      if (k >= 0) { v.glisse = k; return; }      // rectification d'un coin posé
      if (v.pose.length < 4) {
        v.pose.push({ x: Math.max(0, Math.min(v.travail.width, p.x)),
                      y: Math.max(0, Math.min(v.travail.height, p.y)) });
        odRendVue();
      }
    };
    const bouge = (ev) => {
      const v = odVue; if (!v || v.glisse < 0) return;
      ev.preventDefault();
      const p = pos(ev);
      v.pose[v.glisse] = { x: Math.max(0, Math.min(v.travail.width, p.x)),
                           y: Math.max(0, Math.min(v.travail.height, p.y)) };
      odRendVue();
    };
    const fin = () => { if (odVue) odVue.glisse = -1; };
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
    const propre = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
    const nom = 'ordonnance-' + (propre(d.nom + '-' + d.prenom) || 'depot')
      + (odVue.index ? '-' + (odVue.index + 1) : '') + '.jpg';
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
      // On ne referme PAS : refermer apres un enregistrement donne
      // l'impression que le travail a ete perdu. On le dit, on reste.
      const f2 = (v.depot.fichiers || [])[v.index];
      v.orig = v.travail;
      b.textContent = '\u2713 Remplac\u00e9'; b.classList.add('od-ok');
      setTimeout(function () { b.textContent = 'Remplacer dans le d\u00e9p\u00f4t'; b.classList.remove('od-ok'); }, 1800);
      window.odRender();
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
    if (typeof logAction === 'function') logAction('Dépôt rattaché', '');
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
    if (!confirm('L’ordonnance de ' + odIdentite(l[i]) + ' est saisie dans le logiciel ?\n\n'
      + 'Il sera effacé de PILOT immédiatement, avec son image.')) return;
    if (typeof markDeleted === 'function') markDeleted('depots', id);
    if (typeof logAction === 'function') logAction('Dépôt traité et effacé', '');
    l.splice(i, 1);
    odSave(true); window.odRender();
  };

  // ── Importer une ordonnance déjà reçue ────────────────────────────────────
  // Une ordonnance arrivée par mail, ou déjà dans un dossier du poste, n'a
  // aucune raison d'être privée de l'outil de redressement. On l'importe, elle
  // rejoint la boîte comme les autres, et elle suit la même règle : sept jours
  // si personne ne la rattache.
  let odImpFichiers = [];

  window.odFormImporter = function () {
    odImpFichiers = [];
    document.getElementById('od-i-nom').value = '';
    document.getElementById('od-i-prenom').value = '';
    document.getElementById('od-i-f').value = '';
    document.getElementById('od-i-liste').innerHTML = '';
    document.getElementById('od-ov-imp').classList.add('open');
    setTimeout(function () { document.getElementById('od-i-nom').focus(); }, 60);
  };
  window.odFermerImporter = function () { document.getElementById('od-ov-imp').classList.remove('open'); };

  window.odImpChoisir = function (input) {
    // `input.files` est une liste VIVANTE et le champ est vidé juste après :
    // sans cette copie, tout ce qui suit le premier `await` porte sur une liste
    // devenue vide. (Piège n° 5 du CLAUDE.md.)
    odImpFichiers = Array.prototype.slice.call(input.files || []).slice(0, 6);
    input.value = '';
    document.getElementById('od-i-liste').innerHTML = odImpFichiers.length
      ? odImpFichiers.map(function (f) {
          return '<div class="od-i-f">' + E(f.name) + ' <span>' + odPoids(f.size) + '</span></div>';
        }).join('')
      : '';
  };
  function odPoids(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' o';
    if (n < 1048576) return Math.round(n / 1024) + ' Ko';
    return (n / 1048576).toFixed(1).replace('.', ',') + ' Mo';
  }
  const OD_IMP_TYPES = {
    'image/jpeg': 1, 'image/png': 1, 'image/webp': 1, 'image/gif': 1, 'application/pdf': 1
  };
  function odLireB64(f) {
    return new Promise(function (ok, ko) {
      const r = new FileReader();
      r.onload = function () {
        const v = String(r.result || ''), i = v.indexOf(',');
        i > 0 ? ok(v.slice(i + 1)) : ko(new Error('illisible'));
      };
      r.onerror = function () { ko(new Error('illisible')); };
      r.readAsDataURL(f);
    });
  }

  window.odImporter = async function () {
    const nom = String(document.getElementById('od-i-nom').value || '').trim();
    const prenom = String(document.getElementById('od-i-prenom').value || '').trim();
    if (!nom || !prenom) { alert('Le nom et le prénom du patient sont nécessaires.'); return; }
    if (!odImpFichiers.length) { alert('Choisissez au moins un fichier.'); return; }
    const b = document.getElementById('od-i-ok');
    b.disabled = true; b.textContent = 'Import…';
    try {
      const poses = [];
      for (const f of odImpFichiers) {
        const mime = OD_IMP_TYPES[f.type] ? f.type : (/\.pdf$/i.test(f.name) ? 'application/pdf' : null);
        if (!mime) { alert('« ' + f.name + ' » n’est ni une image ni un PDF.'); return; }
        if (f.size > 8 * 1024 * 1024) { alert('« ' + f.name + ' » dépasse 8 Mo.'); return; }
        const data = await odLireB64(f);
        const r = await fetch('/api/images', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mime: mime, data: data })
        });
        const j = await r.json().catch(function () { return null; });
        if (!r.ok || !j || !j.ok) { alert('Import refusé : ' + ((j && j.error) || r.status)); return; }
        poses.push({ fichId: j.id, fichMime: mime, fichNom: String(f.name || '').slice(0, 120), fichTaille: f.size });
      }
      const now = Date.now();
      odListe().push({
        id: now, ts: now, origine: 'import',
        nom: nom.toUpperCase(), prenom: prenom, naissance: null,
        fichiers: poses, recuLe: now, lien: null, archiveLe: null,
        parQui: (odUser() || {}).id || null, updatedAt: now
      });
      if (typeof logAction === 'function') logAction('Ordonnance importée', '');
      odSave(true); odFermerImporter(); window.odRender();
    } catch (e) {
      alert('Import impossible : ' + e.message);
    } finally { b.disabled = false; b.textContent = 'Importer'; }
  };

  // ── L'ordonnance récupérée pendant une livraison ──────────────────────────
  //
  // Une livraison cochée « ordonnance à récupérer » : au moment où le
  // préparateur la marque livrée, l'appareil photo s'ouvre. Il est chez le
  // patient, dans PILOT, sur son téléphone — il n'y a donc RIEN à saisir : le
  // nom, le prénom et la date de naissance sont dans la tâche de livraison et
  // dans l'annuaire.
  //
  // À l'enregistrement, deux choses d'un coup : l'ordonnance rejoint la boîte
  // de réception, et un dossier « € À facturer » s'ouvre dans les
  // renouvellements. L'ordonnance a été rapportée ; ce qui reste à faire, c'est
  // la facturer.
  let odLiv = null;   // { liv, photos:[{data, apercu, octets}] }

  // La date de naissance n'est pas sur la livraison : elle est dans l'annuaire,
  // qui est la seule source dont on soit sûr.
  function odNaissanceDe(nom, prenom) {
    const l = (typeof patients !== 'undefined' && Array.isArray(patients)) ? patients : [];
    const clef = (n, p) => (typeof ptClef === 'function')
      ? ptClef(n, p) : ((n || '').toUpperCase() + '|' + (p || '').toLowerCase());
    const c = clef(nom, prenom);
    const m = l.filter(x => x && clef(x.nom, x.prenom) === c);
    // Deux homonymes avec des dates différentes : on ne tranche pas à la place
    // du préparateur, on laisse vide plutôt que d'inventer.
    if (m.length !== 1) return null;
    return m[0].dob || null;
  }

  window.odCapturerLivraison = function (livId) {
    const l = (typeof deliveries !== 'undefined' && Array.isArray(deliveries)) ? deliveries : [];
    const liv = l.find(x => x && x.id === livId); if (!liv) return;
    odLiv = { liv: liv, photos: [] };
    const dob = odNaissanceDe(liv.nom, liv.prenom);
    document.getElementById('od-l-qui').textContent =
      (liv.nom || '') + ' ' + (liv.prenom || '')
      + (dob ? ' · né(e) le ' + odJour(dob) : '');
    document.getElementById('od-l-ou').textContent =
      [liv.adresse, liv.commune].filter(Boolean).join(', ');
    document.getElementById('od-l-liste').innerHTML = '';
    document.getElementById('od-l-f').value = '';
    odLivBoutons();
    document.getElementById('od-ov-liv').classList.add('open');
  };
  window.odFermerLivraison = function () {
    document.getElementById('od-ov-liv').classList.remove('open');
    odLiv = null;
  };
  function odLivBoutons() {
    const n = odLiv ? odLiv.photos.length : 0;
    document.getElementById('od-l-ok').style.display = n ? '' : 'none';
    document.getElementById('od-l-ok').textContent = n > 1
      ? 'Enregistrer les ' + n + ' pages' : 'Enregistrer l’ordonnance';
    document.getElementById('od-l-plus').textContent = n ? 'Ajouter une page' : 'Photographier l’ordonnance';
  }

  // Le même filtre que sur la page patient : une photo prise sur un pas de
  // porte porte l'ombre de la main et la lumière de l'entrée. On estime le fond
  // par une moyenne locale, puis on divise — l'ombre part, le trait reste.
  // On ne binarise pas : un seuil trop franc efface une posologie au crayon.
  function odFiltreDoc(src) {
    const w = src.width, h = src.height, d = src.data;
    const g = new Float32Array(w * h);
    for (var i = 0, p = 0; i < d.length; i += 4, p++) {
      g[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    }
    const S = new Float64Array((w + 1) * (h + 1));
    for (var y = 0; y < h; y++) {
      var ligne = 0;
      for (var x = 0; x < w; x++) {
        ligne += g[y * w + x];
        S[(y + 1) * (w + 1) + (x + 1)] = S[y * (w + 1) + (x + 1)] + ligne;
      }
    }
    const r = Math.max(8, Math.round(Math.min(w, h) / 12));
    const out = new Uint8ClampedArray(d.length);
    for (var y2 = 0; y2 < h; y2++) {
      const y0 = Math.max(0, y2 - r), y1 = Math.min(h - 1, y2 + r);
      for (var x2 = 0; x2 < w; x2++) {
        const x0 = Math.max(0, x2 - r), x1 = Math.min(w - 1, x2 + r);
        const n = (x1 - x0 + 1) * (y1 - y0 + 1);
        const somme = S[(y1 + 1) * (w + 1) + (x1 + 1)] - S[y0 * (w + 1) + (x1 + 1)]
                    - S[(y1 + 1) * (w + 1) + x0] + S[y0 * (w + 1) + x0];
        const fond = somme / n;
        const q = y2 * w + x2;
        var v = fond > 1 ? (g[q] / fond) * 255 : 255;
        v = v <= 140 ? v * 0.55 : v >= 250 ? 255 : 77 + (v - 140) * ((255 - 77) / (250 - 140));
        const k = q * 4;
        out[k] = out[k + 1] = out[k + 2] = v; out[k + 3] = 255;
      }
    }
    return new ImageData(out, w, h);
  }

  window.odLivPhoto = function (input) {
    // `input.files` est une liste VIVANTE, vidée juste après : on la copie.
    const fichiers = Array.prototype.slice.call(input.files || []);
    input.value = '';
    if (!fichiers.length || !odLiv) return;
    const f = fichiers[0];
    const b = document.getElementById('od-l-plus');
    const avant = b.textContent; b.textContent = 'Traitement…';
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = function () {
      try {
        const k = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * k);
        c.height = Math.round(img.naturalHeight * k);
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, c.width, c.height);
        ctx.putImageData(odFiltreDoc(ctx.getImageData(0, 0, c.width, c.height)), 0, 0);
        const u = c.toDataURL('image/jpeg', 0.82);
        const data = u.split(',')[1] || '';
        odLiv.photos.push({ data: data, apercu: u, octets: Math.round(data.length * 3 / 4) });
        odLivRendre();
      } catch (e) {
        alert('La photo n’a pas pu être traitée. Réessayez.');
      }
      URL.revokeObjectURL(url);
      b.textContent = avant; odLivBoutons();
    };
    img.onerror = function () {
      URL.revokeObjectURL(url); b.textContent = avant;
      alert('Photo illisible. Réessayez.');
    };
    img.src = url;
  };
  window.odLivRetirer = function (i) {
    if (!odLiv) return;
    odLiv.photos.splice(i, 1); odLivRendre(); odLivBoutons();
  };
  function odLivRendre() {
    const el = document.getElementById('od-l-liste');
    el.innerHTML = odLiv.photos.map(function (p, i) {
      return '<div class="od-l-p"><img src="' + p.apercu + '" alt="">'
        + '<span>Page ' + (i + 1) + '</span>'
        + '<button onclick="odLivRetirer(' + i + ')" aria-label="Retirer">✕</button></div>';
    }).join('');
  }

  window.odLivEnregistrer = async function () {
    if (!odLiv || !odLiv.photos.length) return;
    const liv = odLiv.liv;
    const b = document.getElementById('od-l-ok');
    b.disabled = true; b.textContent = 'Enregistrement…';
    try {
      const poses = [];
      for (const p of odLiv.photos) {
        const r = await fetch('/api/images', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mime: 'image/jpeg', data: p.data })
        });
        const j = await r.json().catch(function () { return null; });
        if (!r.ok || !j || !j.ok) { alert('Enregistrement refusé : ' + ((j && j.error) || r.status)); return; }
        poses.push({ fichId: j.id, fichMime: 'image/jpeg', fichTaille: p.octets });
      }
      const now = Date.now();
      const dob = odNaissanceDe(liv.nom, liv.prenom);

      // Le dossier à facturer. `facturation` existe déjà dans le module des
      // renouvellements : badge « € À facturer », onglet « À préparer ». Rien
      // de nouveau à expliquer à l'équipe.
      let rid = null;
      if (typeof renouvellements !== 'undefined' && Array.isArray(renouvellements)) {
        const arch = (typeof renouvArchives !== 'undefined' && Array.isArray(renouvArchives)) ? renouvArchives : [];
        rid = renouvellements.concat(arch).reduce((m, x) => (x && x.id > m ? x.id : m), 0) + 1;
        renouvellements.push({
          id: rid,
          nom: String(liv.nom || '').toUpperCase(), prenom: String(liv.prenom || ''),
          dob: dob || '', tel: liv.tel || '', adresse: liv.adresse || '',
          date: odAujourdhui(), cycle: 0, ponctuel: true, nature: 'facturation',
          notes: 'Ordonnance récupérée lors de la livraison du ' + odJourFr(odAujourdhui()) + '.',
          updatedAt: now
        });
      }

      odListe().push({
        id: now, ts: now, origine: 'livraison',
        nom: String(liv.nom || '').toUpperCase(), prenom: String(liv.prenom || ''),
        naissance: dob || null,
        livraisonId: liv.id,
        fichiers: poses, recuLe: now,
        lien: rid ? { type: 'renouvellement', ref: rid } : null,   // rattaché = conservé
        archiveLe: null, parQui: (odUser() || {}).id || null, updatedAt: now
      });
      liv.ordoRecupereeLe = now; liv.updatedAt = now;

      if (typeof logAction === 'function') logAction('Ordonnance récupérée en livraison', '');
      odSave(true);
      odFermerLivraison();
      if (typeof renderD === 'function') renderD();
      if (typeof rnRender === 'function' && document.getElementById('sec-renouvellement')) rnRender();
      window.odRender();
      odToast('Ordonnance enregistrée · dossier « à facturer » ouvert.');
    } catch (e) {
      alert('Enregistrement impossible : ' + e.message);
    } finally { b.disabled = false; odLivBoutons(); }
  };

  function odAujourdhui() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
      + '-' + String(d.getDate()).padStart(2, '0');
  }
  function odJourFr(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m ? m[3] + '/' + m[2] + '/' + m[1] : String(iso || '');
  }
  function odToast(m) {
    const d = document.createElement('div');
    d.textContent = m;
    d.style.cssText = 'position:fixed;bottom:22px;left:50%;transform:translateX(-50%);'
      + 'background:#1D5C3A;color:#fff;padding:11px 20px;border-radius:10px;font-size:.88rem;'
      + 'z-index:99999;box-shadow:0 6px 20px rgba(0,0,0,.25)';
    document.body.appendChild(d);
    setTimeout(function () { d.remove(); }, 3200);
  }

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
      +   '<span class="od-qui">' + E(odIdentite(d)) + '</span>'
      +   '<span class="od-meta">'
      +     (d.origine === 'comptoir' ? 'Déposée depuis l’affiche'
              : d.origine === 'import' ? 'Importée par ' + E(odPrenomDe(d.parQui))
              : d.origine === 'recuperation' ? 'Récupérée chez le patient'
              : 'Envoyée par lien')
      +     ' · ' + E(odQuand(d.ts))
      +   '</span>'
      +   (dansBoite
          ? '<span class="od-reste' + (urgent ? ' urgent' : '') + '">' + E(odMotRestant(n)) + '</span>'
          : '<span class="od-lie">' + E(odDossierCourt(d)) + '</span>')
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
  .od-i-choisir{display:block;margin-top:14px;padding:13px;border:1px dashed #cfdbd3;
    border-radius:11px;text-align:center;font-size:.88rem;font-weight:600;
    color:#1D5C3A;cursor:pointer;background:#F7FBF9}
  .od-i-choisir:hover{border-color:#1D5C3A}
  .od-i-choisir input{display:none}
  .od-i-f{font-size:.82rem;padding:7px 10px;border:1px solid #e7ece9;border-radius:8px;
    margin-top:7px;display:flex;gap:8px}
  .od-i-f span{margin-left:auto;color:var(--gray-500);font-variant-numeric:tabular-nums}
  .od-l-qui{font-size:1.05rem;font-weight:700;color:#1a2b22}
  .od-l-ou{font-size:.84rem;color:var(--gray-500);margin-top:2px}
  /* Le bouton est pris sur un pas de porte, parfois d'une seule main : il
     occupe toute la largeur et se vise sans regarder. */
  .od-l-btn{display:block;margin-top:18px;padding:20px 16px;border-radius:13px;
    background:#1D5C3A;color:#fff;text-align:center;font-size:1.02rem;font-weight:700;
    cursor:pointer}
  .od-l-btn:hover{background:#17492e}
  .od-l-btn input{display:none}
  .od-l-liste{display:flex;gap:9px;flex-wrap:wrap;margin-top:12px}
  .od-l-p{position:relative;width:84px}
  .od-l-p img{width:84px;height:108px;object-fit:cover;border-radius:8px;
    border:1px solid #dfe8e2;display:block;background:#fff}
  .od-l-p span{font-size:.72rem;color:var(--gray-500);display:block;text-align:center;margin-top:3px}
  .od-l-p button{position:absolute;top:-7px;right:-7px;width:22px;height:22px;border-radius:50%;
    border:none;background:#C62828;color:#fff;font-size:.72rem;cursor:pointer;font-family:inherit}
  .od-r-quoi{margin-left:auto;font-size:.78rem;color:var(--gray-500)}
  @media(max-width:640px){ .od-vig{width:78px;height:102px} }`;

  // ── Gabarit ───────────────────────────────────────────────────────────────
  const OD_SECTION =
    '<div class="od-wrap">'
    + '<div class="od-bar"><div class="od-title">'
    +   '<svg class="ico"><use href="#ic-ordonnance"></use></svg> Ordonnances déposées'
    +   ' <span id="od-nb" style="color:var(--gray-500);font-weight:600"></span></div>'
    + '<span class="od-grow"></span>'
    + '<button class="btn bs sm" onclick="odFormImporter()">'
    +   '<svg class="ico"><use href="#ic-joindre"></use></svg> Importer une ordonnance</button>'
    + '<a class="btn bs sm" href="/documents/affiche-depot-ordonnance.pdf" target="_blank" rel="noopener"'
    +   ' style="text-decoration:none">Affiche</a></div>'
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
    +   '<button class="od-b" id="od-v-defaire" onclick="odDefaire()" style="display:none">Annuler le dernier coin</button>'
    +   '<button class="od-b" id="od-v-reprendre" onclick="odRecommencer()" style="display:none">Repartir de l’original</button>'
    +   '<button class="od-b pri" id="od-v-recadrer" onclick="odRecadrer()" style="display:none">Recadrer</button>'
    +   '<button class="od-b" id="od-v-garder" onclick="odEnregistrerRecadrage()" title="Remplace la pi\u00e8ce dans le d\u00e9p\u00f4t par l\u2019image ci-dessus">Remplacer dans le d\u00e9p\u00f4t</button>'
    +   '<button class="od-b" onclick="odTelecharger()">Télécharger</button>'
    +   '<button class="od-b pri" id="od-v-copier" onclick="odCopier()">Copier l’image</button>'
    + '</div>'
    + '<div class="od-v-zone" id="od-v-zone"><div class="od-v-pile">'
    +   '<canvas id="od-v-canvas"></canvas><canvas id="od-v-repere"></canvas></div></div>'
    + '<div class="od-v-aide" id="od-v-aide"></div>'
    + '</div>'

    + '<div class="overlay" id="od-ov-imp">'
    + '<div class="mbox" style="max-width:520px">'
    +   '<div class="mbox-h"><b>Importer une ordonnance</b>'
    +     '<button class="x" onclick="odFermerImporter()">✕</button></div>'
    +   '<div class="mbox-b">'
    +     '<p style="font-size:.82rem;color:var(--gray-500);margin:0 0 14px;line-height:1.55">'
    +       'Pour une ordonnance re\u00e7ue par mail ou d\u00e9j\u00e0 pr\u00e9sente sur ce poste. Elle rejoint la bo\u00eete '
    +       'et passe par le m\u00eame outil de redressement.</p>'
    +     '<div style="display:flex;gap:10px">'
    +       '<label style="flex:1;font-size:.78rem;font-weight:600;color:var(--gray-500)">Nom'
    +         '<input class="inp" id="od-i-nom" autocomplete="off"></label>'
    +       '<label style="flex:1;font-size:.78rem;font-weight:600;color:var(--gray-500)">Pr\u00e9nom'
    +         '<input class="inp" id="od-i-prenom" autocomplete="off"></label>'
    +     '</div>'
    +     '<label class="od-i-choisir">\uD83D\uDCCE Choisir le ou les fichiers'
    +       '<input type="file" id="od-i-f" accept="image/*,application/pdf" multiple onchange="odImpChoisir(this)">'
    +     '</label>'
    +     '<div id="od-i-liste"></div>'
    +     '<div style="display:flex;gap:10px;margin-top:16px">'
    +       '<button class="btn bp" id="od-i-ok" onclick="odImporter()">Importer</button>'
    +       '<button class="btn bs" onclick="odFermerImporter()">Annuler</button>'
    +     '</div>'
    +   '</div>'
    + '</div></div>'

    + '<div class="overlay" id="od-ov-liv">'
    + '<div class="mbox" style="max-width:520px">'
    +   '<div class="mbox-h"><b>Ordonnance \u00e0 r\u00e9cup\u00e9rer</b>'
    +     '<button class="x" onclick="odFermerLivraison()">✕</button></div>'
    +   '<div class="mbox-b">'
    +     '<div class="od-l-qui" id="od-l-qui"></div>'
    +     '<div class="od-l-ou" id="od-l-ou"></div>'
    +     '<label class="od-l-btn" id="od-l-plus-w">'
    +       '<span id="od-l-plus">Photographier l\u2019ordonnance</span>'
    +       '<input type="file" id="od-l-f" accept="image/*" capture="environment" onchange="odLivPhoto(this)">'
    +     '</label>'
    +     '<div class="od-l-liste" id="od-l-liste"></div>'
    +     '<button class="btn bp" id="od-l-ok" onclick="odLivEnregistrer()" style="display:none;width:100%;margin-top:14px;justify-content:center"></button>'
    +     '<button class="btn bs" onclick="odFermerLivraison()" style="width:100%;margin-top:8px;justify-content:center">Plus tard</button>'
    +     '<div style="font-size:.76rem;color:var(--gray-500);margin-top:12px;line-height:1.5">'
    +       'L\u2019ordonnance rejoint la bo\u00eete de r\u00e9ception, et un dossier '
    +       '<b>\u00ab \u20AC \u00c0 facturer \u00bb</b> s\u2019ouvre dans les renouvellements.</div>'
    +   '</div>'
    + '</div></div>'

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
