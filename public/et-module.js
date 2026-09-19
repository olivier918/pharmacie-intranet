/* ═══════════════════════════════════════════════════════════════════════════
   MOTEUR D'ÉTIQUETTES — les préparations, sur la Zebra ZD230

   Une préparation sort du préparatoire dans un flacon ou un pot qui, jusqu'ici,
   portait une étiquette écrite à la main. Ce module l'imprime.

   POURQUOI PAS DE ZPL. La ZD230 parle ZPL, et on pourrait lui envoyer des
   commandes brutes — mais aucun navigateur ne sait ouvrir un port
   d'imprimante. Il faudrait un logiciel de plus sur chaque poste, à installer,
   à maintenir, à réinstaller le jour où le poste change. On imprime donc une
   PAGE, dont la taille est exactement celle de l'étiquette, par le pilote
   Windows de la ZD230 comme n'importe quelle imprimante. Ce que l'aperçu
   montre est ce qui sort.

   CE QUI DOIT FIGURER SUR L'ÉTIQUETTE n'est pas un choix de présentation :
   l'article R. 5121-146-2 du code de la santé publique l'impose — composition,
   numéro de lot, numéro d'enregistrement à l'ordonnancier, date limite
   d'utilisation, précautions de conservation, nom et adresse de la pharmacie.
   PILOT ne portait aucun de ces champs : ils sont demandés à l'impression et
   restent sur la fiche, de sorte qu'on sache plus tard ce qui a été collé sur
   le flacon.

   LE FORMAT EST UNE DONNÉE, PAS DU CODE. Les rouleaux changent, et un format
   créé au comptoir doit exister au préparatoire : `etiqFormats` est une
   collection synchronisée comme les autres.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const E = s => String(s == null ? '' : s).replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const etUser = () => (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null;
  const etAdmin = () => (typeof isAdmin === 'function') ? !!isAdmin() : false;
  const etPreps = () => (typeof preps !== 'undefined' && Array.isArray(preps)) ? preps : [];
  const etListe = () => {
    if (typeof window._collRef === 'function') {
      const l = window._collRef('etiqFormats');
      if (Array.isArray(l)) return l;
    }
    return (typeof etiqFormats !== 'undefined' && Array.isArray(etiqFormats)) ? etiqFormats : [];
  };
  const etSave = (now) => {
    try {
      if (now && typeof saveNow === 'function') saveNow();
      else if (typeof schedSave === 'function') schedSave();
    } catch (e) {}
  };

  // ── Les formats livrés ─────────────────────────────────────────────────────
  // `marge` est la marge blanche interne, en millimètres. `police` la taille de
  // base du corps, en points : le moteur la REDUIT si le texte déborde, il ne
  // l'augmente jamais — une étiquette trop pleine se lit mal, une étiquette
  // trop vide se lit très bien.
  const ET_DEFAUT = [
    { id: 'et:57x32',  lbl: '57 × 32 mm',  w: 57,  h: 32, marge: 2,   police: 7,  defaut: true },
    { id: 'et:57x76',  lbl: '57 × 76 mm',  w: 57,  h: 76, marge: 2.5, police: 8 },
    { id: 'et:100x50', lbl: '100 × 50 mm', w: 100, h: 50, marge: 3,   police: 9 }
  ];
  const ET_PRUDENCE = 'Ne pas laisser à la portée des enfants.';

  // Les formats livrés COMPLETENT la liste enregistrée, ils ne la remplacent
  // pas — et un format que quelqu'un a supprimé exprès ne ressuscite pas.
  // Même mécanique que les modèles de SMS, pour la même raison : sans elle, un
  // nouveau format d'usine n'apparaîtrait jamais sur une base déjà remplie.
  function etAssurer() {
    const l = etListe();
    const presents = new Set(l.map(f => f && f.id));
    const enterres = new Set((typeof tombstones !== 'undefined' && Array.isArray(tombstones) ? tombstones : [])
      .filter(x => x && x.c === 'etiqFormats').map(x => x.id));
    let neuf = false;
    ET_DEFAUT.forEach(function (f) {
      if (presents.has(f.id) || enterres.has(f.id)) return;
      l.push(Object.assign({}, f, { updatedAt: Date.now() }));
      neuf = true;
    });
    if (neuf) etSave(false);
    return l;
  }
  function etFormat(id) {
    const l = etAssurer();
    return l.find(f => f && f.id === id) || l.find(f => f && f.defaut) || l[0] || ET_DEFAUT[0];
  }
  window.etFormats = etAssurer;

  // ── Dates ─────────────────────────────────────────────────────────────────
  const pad = n => String(n).padStart(2, '0');
  function etIso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function etFr(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m ? m[3] + '/' + m[2] + '/' + m[1] : '';
  }
  // Une DLU se pose en mois, pas en jours : « trois mois » est ce qu'on dit et
  // ce qu'on écrit au registre.
  function etPlusMois(iso, n) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date();
    const j = d.getDate();
    d.setMonth(d.getMonth() + n);
    // 31 janvier + 1 mois : le 31 février n'existe pas, le navigateur glisse au
    // 3 mars. On recule au dernier jour du mois visé, qui est la bonne réponse.
    if (d.getDate() !== j) d.setDate(0);
    return etIso(d);
  }

  // Un numéro de lot qui se tient : la date, puis le rang de la préparation
  // étiquetée ce jour-là. Deux préparations du même jour ne portent jamais le
  // même lot, et le lot dit quand elle a été faite.
  function etLotPropose(l, aujourdhui) {
    const j = String(aujourdhui || '').replace(/-/g, '');
    let n = 0;
    (l || []).forEach(function (p) {
      const e = p && p.etiq;
      if (e && typeof e.lot === 'string' && e.lot.indexOf(j + '-') === 0) {
        const k = parseInt(e.lot.slice(j.length + 1), 10);
        if (k > n) n = k;
      }
    });
    return j + '-' + (n + 1);
  }
  window.etLotPropose = etLotPropose;

  // ── Le contenu de l'étiquette ─────────────────────────────────────────────
  // Rendue en HTML plutôt qu'en ZPL : c'est la même chaîne qui sert à l'aperçu
  // et à l'impression, donc l'aperçu ne peut pas mentir.
  function etOfficine() {
    const o = (typeof OFFICINE !== 'undefined' && OFFICINE) ? OFFICINE : {};
    return {
      nom: o.nom || 'Pharmacie',
      adr: [o.adresse, [o.cp, o.ville].filter(Boolean).join(' ')].filter(Boolean).join(' · '),
      tel: o.tel || ''
    };
  }
  function etCorps(p, c) {
    const o = etOfficine();
    const qui = ((p && p.nom) || '') + ' ' + ((p && p.prenom) || '');
    const lignes = [];
    if (c.lot)  lignes.push('Lot ' + c.lot);
    if (c.ordo) lignes.push('Ordo n° ' + c.ordo);
    const trace = lignes.join(' · ');
    return ''
      + '<div class="et-h"><b>' + E(o.nom) + '</b><span>' + E(o.adr)
      +   (o.tel ? ' · ' + E(o.tel) : '') + '</span></div>'
      + (c.nonOral ? '<div class="et-avaler">NE PAS AVALER</div>' : '')
      + '<div class="et-qui">' + E(qui.trim()) + (p && p.dob ? ' <i>' + E(etFr(p.dob)) + '</i>' : '') + '</div>'
      + '<div class="et-c">' + E(c.compo || '') + '</div>'
      + (c.poso ? '<div class="et-l"><b>Posologie :</b> ' + E(c.poso) + '</div>' : '')
      + (c.cons ? '<div class="et-l">' + E(c.cons) + '</div>' : '')
      + (c.dlu ? '<div class="et-l"><b>À utiliser avant le ' + E(etFr(c.dlu)) + '</b></div>' : '')
      + (trace ? '<div class="et-t">' + E(trace) + '</div>' : '')
      + (c.mention ? '<div class="et-p">' + E(c.mention) + '</div>' : '');
  }

  // Le style d'une étiquette, en millimètres. Tout y est exprimé par rapport à
  // la taille de base : réduire la police réduit l'étiquette entière.
  function etCss(f) {
    return `
    *{box-sizing:border-box;margin:0;padding:0}
    .et{width:${f.w}mm;height:${f.h}mm;padding:${f.marge}mm;overflow:hidden;
        font-family:Arial,Helvetica,sans-serif;color:#000;background:#fff;
        display:flex;flex-direction:column;gap:.35em;line-height:1.22}
    .et-h{font-size:.92em;border-bottom:.2mm solid #000;padding-bottom:.25em}
    .et-h b{display:block;font-size:1.05em;letter-spacing:.01em}
    .et-h span{display:block;font-size:.82em}
    .et-avaler{background:#000;color:#fff;font-weight:bold;text-align:center;
               padding:.1em 0;font-size:.95em;letter-spacing:.06em}
    .et-qui{font-weight:bold;font-size:1.05em}
    .et-qui i{font-style:normal;font-weight:normal;font-size:.82em}
    .et-c{font-size:1em;white-space:pre-wrap;word-break:break-word;flex:0 1 auto}
    .et-l{font-size:.9em}
    .et-t{font-size:.86em;margin-top:auto}
    .et-p{font-size:.78em;font-style:italic}`;
  }

  // ── LE MOTEUR : faire tenir le texte ──────────────────────────────────────
  // Une formule de préparation fait trois mots ou six lignes, et le rouleau ne
  // change pas de taille entre les deux. On part de la police du format et on
  // la RÉDUIT tant que ça déborde, par pas d'un demi-point, jusqu'à 4 pt. En
  // dessous, plus personne ne lit : on s'arrête là et l'aperçu le dit.
  // SANS FERMETURE. Cette fonction est recopiee telle quelle dans la fenetre
  // d'impression, par toString() : toute constante du module qu'elle citerait
  // y serait introuvable. Elle l'a ete — ET_MIN n'existait pas la-bas, l'ajuste-
  // ment se plantait en silence, et l'etiquette sortait coupee. Le minimum est
  // donc un parametre avec sa valeur par defaut.
  function etAjuster(boite, min) {
    if (!boite) return null;
    var bas = min || 4;
    var t = parseFloat(boite.dataset.police || '8');
    boite.style.fontSize = t + 'pt';
    while (t > bas && boite.scrollHeight > boite.clientHeight + 1) {
      t = Math.round((t - 0.5) * 10) / 10;
      boite.style.fontSize = t + 'pt';
    }
    return { police: t, deborde: boite.scrollHeight > boite.clientHeight + 1 };
  }
  window.etAjuster = etAjuster;

  // ── La fenêtre d'impression ───────────────────────────────────────────────
  let etPrep = null, etFmtId = null;

  window.etOuvrir = function (id) {
    const p = etPreps().find(x => x && x.id === id);
    if (!p) return;
    etPrep = p;
    const l = etAssurer();
    const e = p.etiq || {};
    etFmtId = (e.fmt && l.some(f => f.id === e.fmt)) ? e.fmt : etFormat(null).id;

    let ov = document.getElementById('et-ov');
    if (!ov) {
      ov = document.createElement('div');
      ov.className = 'overlay'; ov.id = 'et-ov';
      document.body.appendChild(ov);
    }
    const auj = etIso(new Date());
    ov.innerHTML = '<div class="mbox" style="max-width:820px">'
      + '<div class="mbox-h"><b>Étiquette — ' + E(((p.nom || '') + ' ' + (p.prenom || '')).trim()) + '</b>'
      +   '<button class="x" onclick="etFermer()">✕</button></div>'
      + '<div class="mbox-b et-grid">'
      +   '<div class="et-form">'
      +     '<div class="et-lbl">Format</div><div class="et-seg" id="et-seg"></div>'
      +     '<div class="et-fg" style="margin-top:14px"><label for="et-compo">Composition · ce qui est écrit sur le flacon</label>'
      +       '<textarea id="et-compo" rows="3" oninput="etRedessiner()"></textarea></div>'
      +     '<div class="et-2">'
      +       '<div class="et-fg"><label for="et-lot">N° de lot</label>'
      +         '<input id="et-lot" oninput="etRedessiner()"></div>'
      +       '<div class="et-fg"><label for="et-ordo">N° d’ordonnancier</label>'
      +         '<input id="et-ordo" oninput="etRedessiner()"></div>'
      +     '</div>'
      +     '<div class="et-fg"><label for="et-poso">Posologie</label>'
      +       '<input id="et-poso" oninput="etRedessiner()" placeholder="1 application matin et soir"></div>'
      +     '<div class="et-fg"><label for="et-dlu">À utiliser avant le</label>'
      +       '<div class="et-dlu"><input type="date" id="et-dlu" oninput="etRedessiner()">'
      +         '<button class="btn bs sm" onclick="etDlu(1)">+1 mois</button>'
      +         '<button class="btn bs sm" onclick="etDlu(3)">+3</button>'
      +         '<button class="btn bs sm" onclick="etDlu(6)">+6</button>'
      +         '<button class="btn bs sm" onclick="etDlu(12)">+12</button></div></div>'
      +     '<div class="et-fg"><label for="et-cons">Conservation</label>'
      +       '<input id="et-cons" oninput="etRedessiner()" placeholder="À conserver à l’abri de la lumière"></div>'
      +     '<label class="cbl"><input type="checkbox" id="et-nonoral" onchange="etRedessiner()"> '
      +       'Voie autre qu’orale — imprimer « NE PAS AVALER »</label>'
      +     '<div class="et-2" style="margin-top:12px;align-items:end">'
      +       '<div class="et-fg"><label for="et-nb">Nombre d’étiquettes</label>'
      +         '<input type="number" id="et-nb" min="1" max="50" value="1"></div>'
      +       '<button class="btn bp" onclick="etImprimer()" style="height:40px">'
      +         '<svg class="ico"><use href="#ic-document"></use></svg> Imprimer</button>'
      +     '</div>'
      +   '</div>'
      +   '<div class="et-cote">'
      +     '<div class="et-lbl">Aperçu · taille réelle</div>'
      +     '<div id="et-apercu" class="et-ap"></div>'
      +     '<div class="et-info" id="et-info"></div>'
      +     '<div class="et-lbl" style="margin-top:16px">Formats enregistrés</div>'
      +     '<div id="et-gest"></div>'
      +   '</div>'
      + '</div></div>';

    const g = (i, v) => { const el = document.getElementById(i); if (el) el.value = v || ''; };
    g('et-compo', e.compo || p.prep || '');
    g('et-lot', e.lot || etLotPropose(etPreps(), auj));
    g('et-ordo', e.ordo || '');
    g('et-poso', e.poso || '');
    g('et-dlu', e.dlu || '');
    g('et-cons', e.cons || '');
    const no = document.getElementById('et-nonoral'); if (no) no.checked = !!e.nonOral;
    ov.classList.add('open');
    etRendFormats(); etRendGest(); etRedessiner();
  };
  window.etFermer = function () {
    const ov = document.getElementById('et-ov'); if (ov) ov.classList.remove('open');
    etPrep = null;
  };
  window.etDlu = function (n) {
    const d = document.getElementById('et-dlu'); if (!d) return;
    d.value = etPlusMois(d.value || etIso(new Date()), n);
    etRedessiner();
  };

  // Un gestionnaire ne reçoit qu'un indice, jamais un libellé saisi.
  let etSeg = [];
  function etRendFormats() {
    const z = document.getElementById('et-seg'); if (!z) return;
    etSeg = etAssurer().slice();
    z.innerHTML = etSeg.map(function (f, i) {
      return '<button type="button" class="' + (f.id === etFmtId ? 'on' : '') + '"'
        + ' onclick="etChoisirFormat(' + i + ')">' + E(f.lbl || f.id) + '</button>';
    }).join('');
  }
  window.etChoisirFormat = function (i) {
    const f = etSeg[i]; if (!f) return;
    etFmtId = f.id; etRendFormats(); etRedessiner();
  };

  function etChamps() {
    const v = i => String((document.getElementById(i) || {}).value || '').trim();
    const f = etFormat(etFmtId);
    return {
      compo: v('et-compo'), lot: v('et-lot'), ordo: v('et-ordo'),
      poso: v('et-poso'), dlu: v('et-dlu'), cons: v('et-cons'),
      nonOral: !!(document.getElementById('et-nonoral') || {}).checked,
      mention: (f.mention === undefined ? ET_PRUDENCE : f.mention),
      fmt: f.id
    };
  }

  window.etRedessiner = function () {
    const z = document.getElementById('et-apercu'); if (!z || !etPrep) return;
    const f = etFormat(etFmtId);
    const c = etChamps();
    z.innerHTML = '<style>' + etCss(f) + '</style>'
      + '<div class="et" id="et-boite" data-police="' + f.police + '">' + etCorps(etPrep, c) + '</div>';
    const r = etAjuster(document.getElementById('et-boite'));
    const info = document.getElementById('et-info');
    if (info) {
      info.className = 'et-info' + (r && r.deborde ? ' ko' : '');
      info.textContent = r && r.deborde
        ? 'Le texte déborde même en ' + r.police + ' pt : raccourcissez la composition, ou prenez un format plus grand.'
        : f.w + ' × ' + f.h + ' mm · corps ' + (r ? r.police : f.police) + ' pt'
          + (r && r.police < f.police ? ' (réduit pour tenir)' : '');
    }
  };

  window.etImprimer = function () {
    if (!etPrep) return;
    const f = etFormat(etFmtId);
    const c = etChamps();
    if (!c.compo) { alert('La composition est vide : une étiquette sans composition ne dit rien.'); return; }
    const nb = Math.max(1, Math.min(50, parseInt((document.getElementById('et-nb') || {}).value, 10) || 1));

    // Ce qui a été imprimé reste sur la fiche : six mois plus tard, la question
    // « quel lot y avait-il sur ce flacon ? » doit avoir une réponse.
    etPrep.etiq = Object.assign({}, c, {
      nb: nb, imprimeLe: Date.now(), imprimePar: (etUser() || {}).id || null
    });
    etPrep.updatedAt = Date.now();
    if (typeof logAction === 'function') logAction('Étiquette de préparation imprimée', c.lot || '');
    etSave(true);

    const corps = etCorps(etPrep, c);
    const une = '<div class="et" data-police="' + f.police + '">' + corps + '</div>';
    const html = '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">'
      + '<title>Étiquette</title><style>'
      + '@page{size:' + f.w + 'mm ' + f.h + 'mm;margin:0}'
      + 'html,body{margin:0;padding:0;background:#fff}'
      + '.et{page-break-after:always;break-after:page}'
      + '.et:last-child{page-break-after:auto;break-after:auto}'
      + etCss(f) + '</style></head><body>'
      + new Array(nb).fill(une).join('')
      + '<script>' + etAjuster.toString() + ';'
      + 'document.querySelectorAll(".et").forEach(function(e){etAjuster(e);});'
      + 'setTimeout(function(){window.print();},250);<\/script>'
      + '</body></html>';
    const w = window.open('', '_blank');
    if (!w) { alert('Le navigateur a bloqué la fenêtre d’impression. Autorisez les fenêtres pour PILOT.'); return; }
    w.document.write(html); w.document.close();
    etFermer();
    if (typeof renderPreps === 'function') renderPreps();
  };

  // ── Enregistrer un format ─────────────────────────────────────────────────
  function etRendGest() {
    const z = document.getElementById('et-gest'); if (!z) return;
    z.innerHTML = etAssurer().map(function (f, i) {
      // Les dimensions ne sont repetees que si le nom ne les dit pas deja :
      // « 57 × 32 mm  57×32 mm » se lit deux fois pour rien.
      const dims = f.w + '×' + f.h;
      const ditDeja = String(f.lbl || '').replace(/\s|×|x/g, '') .indexOf(dims.replace(/\s|×/g, '')) >= 0;
      return '<div class="et-g">'
        + '<span class="et-g-n">' + E(f.lbl || f.id) + (f.defaut ? ' <i>par défaut</i>' : '') + '</span>'
        + (ditDeja ? '' : '<span class="et-g-d">' + dims + ' mm</span>')
        + (etAdmin() ? '<button class="et-g-x" title="Supprimer ce format" onclick="etSupprimerFormat(' + i + ')">✕</button>' : '')
        + '</div>';
    }).join('')
      + '<div class="et-neuf">'
      +   '<input id="et-n-lbl" class="et-n-lbl" placeholder="Nom du format (facultatif)">'
      +   '<input id="et-n-w" type="number" min="10" max="104" step="0.5" placeholder="Largeur mm">'
      +   '<input id="et-n-h" type="number" min="10" max="300" step="0.5" placeholder="Hauteur mm">'
      +   '<button class="btn bs sm" onclick="etAjouterFormat()">Ajouter</button>'
      + '</div>'
      + '<div class="et-aide">Largeur en millimètres, 104 mm au maximum sur la ZD230. '
      +   'Un format créé ici est partagé avec les autres postes.</div>';
  }
  window.etAjouterFormat = function () {
    const lbl = String((document.getElementById('et-n-lbl') || {}).value || '').trim();
    const w = parseFloat((document.getElementById('et-n-w') || {}).value);
    const h = parseFloat((document.getElementById('et-n-h') || {}).value);
    if (!(w > 0) || !(h > 0)) { alert('Indiquez la largeur et la hauteur, en millimètres.'); return; }
    if (w > 104) { alert('La ZD230 imprime 104 mm de large au maximum.'); return; }
    const l = etAssurer();
    let id = 'et:' + Date.now();
    while (l.some(f => f && f.id === id)) id += 'x';
    l.push({ id: id, lbl: lbl || (w + ' × ' + h + ' mm'), w: w, h: h,
             marge: Math.min(3, Math.max(1.5, Math.round(w / 25 * 10) / 10)),
             police: (w >= 80 ? 9 : (h >= 60 ? 8 : 7)), updatedAt: Date.now() });
    etSave(true);
    etFmtId = id;
    etRendFormats(); etRendGest(); etRedessiner();
  };
  window.etSupprimerFormat = function (i) {
    const l = etAssurer(), f = l[i]; if (!f) return;
    if (l.length <= 1) { alert('C’est le dernier format : il en faut au moins un.'); return; }
    if (!confirm('Supprimer le format « ' + (f.lbl || f.id) + ' » ?')) return;
    if (typeof markDeleted === 'function') markDeleted('etiqFormats', f.id);
    l.splice(i, 1);
    if (etFmtId === f.id) etFmtId = etFormat(null).id;
    etSave(true);
    etRendFormats(); etRendGest(); etRedessiner();
  };

  // ── Style de la fenêtre ───────────────────────────────────────────────────
  const ET_CSS = `
  .et-grid{display:grid;grid-template-columns:1fr 300px;gap:22px;align-items:start}
  @media(max-width:760px){.et-grid{grid-template-columns:1fr}}
  .et-lbl{font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
    color:var(--gray-500);margin-bottom:8px}
  .et-seg{display:flex;gap:6px;flex-wrap:wrap}
  .et-seg button{font:inherit;font-size:.85rem;font-weight:600;color:var(--gray-700);background:#fff;
    border:1.5px solid #e7ece9;border-radius:9px;padding:8px 12px;cursor:pointer}
  .et-seg button:hover{border-color:#9ccbb2;background:#F7FBF9}
  .et-seg button.on{border-color:#1D5C3A;background:#1D5C3A;color:#fff}
  .et-fg{margin-bottom:10px}
  .et-fg label{display:block;font-size:.72rem;font-weight:700;text-transform:uppercase;
    letter-spacing:.05em;color:var(--gray-500);margin-bottom:4px}
  .et-fg input,.et-fg textarea{width:100%;font:inherit;font-size:.9rem;border:1px solid var(--gray-200);
    border-radius:9px;padding:8px 10px;box-sizing:border-box;resize:vertical}
  .et-fg input:focus,.et-fg textarea:focus{outline:none;border-color:#1D5C3A}
  .et-2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .et-dlu{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
  .et-dlu input{flex:1 1 150px}
  .et-cote{border-left:1px solid var(--gray-200);padding-left:20px}
  @media(max-width:760px){.et-cote{border-left:none;padding-left:0;border-top:1px solid var(--gray-200);padding-top:16px}}
  .et-ap{background:repeating-conic-gradient(#f3f3f3 0% 25%,#fff 0% 50%) 50%/12px 12px;
    padding:10px;border-radius:10px;display:flex;justify-content:center}
  .et-ap .et{box-shadow:0 1px 6px rgba(0,0,0,.22)}
  .et-info{font-size:.76rem;color:var(--gray-500);margin-top:8px;line-height:1.45}
  .et-info.ko{color:#b3261e;font-weight:600}
  .et-g{display:flex;align-items:center;gap:8px;font-size:.84rem;padding:5px 0;
    border-bottom:1px solid var(--gray-100)}
  .et-g-n{font-weight:600}
  .et-g-n i{font-style:normal;font-weight:400;font-size:.74rem;color:var(--g-dark)}
  .et-g-d{margin-left:auto;color:var(--gray-500);font-size:.78rem;white-space:nowrap}
  .et-g-x{border:none;background:none;color:var(--gray-500);cursor:pointer;font-size:.9rem;padding:0 2px}
  .et-g-x:hover{color:#b3261e}
  .et-neuf{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:10px}
  .et-neuf .et-n-lbl{grid-column:1/-1}
  .et-neuf input{font:inherit;font-size:.82rem;border:1px solid var(--gray-200);border-radius:8px;
    padding:6px 8px;width:100%;box-sizing:border-box}
  .et-aide{font-size:.72rem;color:var(--gray-500);margin-top:8px;line-height:1.45}`;

  function etInject() {
    if (document.getElementById('et-css')) return;
    const st = document.createElement('style');
    st.id = 'et-css'; st.textContent = ET_CSS;
    document.head.appendChild(st);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', etInject);
  else etInject();
}());
