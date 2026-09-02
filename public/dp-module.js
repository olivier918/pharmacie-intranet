/* ════════════════════════════════════════════════════════════════════════════
   Module DÉPANNAGE — bons de commande de dépannage (Secours Pharma / Movianto)
   ────────────────────────────────────────────────────────────────────────────
   Le circuit réel : on appelle le service relation clients, la pharmacie complète
   le bon (produit, quantité, coordonnées, date, signature) et le retourne par
   e-mail au dépositaire, qui livre en 24 h si le bon part avant 15 h, 48 h sinon.

   Ce module reproduit ce bon entièrement pré-rempli — numéro de référence,
   produit habituel, coordonnées de l'officine, signature du pharmacien connecté :
   il ne reste que la QUANTITÉ à saisir. Il l'enregistre et l'envoie sur demande.
   Isolé sous le préfixe dp- : rien d'existant n'est modifié.
   Collection synchronisée : depannages[] (déclarée dans index.html).
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function E(s) { return (s == null ? '' : String(s)).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  // depannages est déclaré par `let` dans index.html : il n'est PAS sur window.
  // On le manipule donc par son nom nu (mutation en place ou réassignation),
  // comme l'exigent les règles de synchronisation multiposte.
  function L() {
    try { if (!Array.isArray(depannages)) depannages = []; return depannages; }
    catch (e) { if (!Array.isArray(window.depannages)) window.depannages = []; return window.depannages; }
  }
  function persist() { try { if (typeof schedSave === 'function') schedSave(); else if (typeof saveAll === 'function') saveAll(); } catch (e) { console.warn('dp save', e); } }
  function newId() { return 'dp:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function iso(d) { return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split('T')[0]; }
  function joli(i) { return i ? i.split('-').reverse().join('/') : ''; }

  // ── le dépositaire ──────────────────────────────────────────────────────────
  // Un seul circuit pour l'instant (choix d'Olivier). Pour en ajouter un autre,
  // dupliquer cet objet et proposer le choix dans le formulaire.
  const DP_FOURNISSEUR = {
    nom: 'Secours Pharma',
    labo: 'Amgen',
    depositaire: 'Movianto',
    mail: 'pharmacie@movianto.com',
    tel: '0969 363 363',
    horaires: 'du lundi au vendredi, 9h00-12h00 et 13h00-17h00',
    heureLimite: 15,       // au-delà, la livraison passe de 24 h à 48 h
    mention: "Votre commande ne sera prise en compte qu'après réception de ce bon dûment complété. Ce bon est à usage unique et ne pourra pas être réutilisé ultérieurement."
  };

  const DP_STATUTS = { brouillon: 'Brouillon', envoye: 'Envoyé', recu: 'Reçu', annule: 'Annulé' };
  // Produit habituellement dépanné par ce circuit : le bon s'ouvre déjà rempli,
  // il ne reste que la quantité à saisir. Modifiable ligne à ligne si besoin.
  const DP_PRODUIT_HABITUEL = { cip: '300.285.82', produit: 'REPATHA 140 mg Stylo pré-rempli Sureclick' };
  // Le numéro de référence de ce circuit ne change pas : il est pré-rempli, jamais à saisir.
  // S'il venait à changer, il suffit de le corriger une fois sur un bon : dpDernier() reprend
  // ensuite toujours la dernière valeur utilisée.
  const DP_REF = 'P260831014421';
  const DP_CHIFFRES = ['zéro', 'une', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix',
    'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf', 'vingt'];
  // « 3 » saisi au comptoir devient « 3 (trois) » et « Pour 3 patients », comme sur leur bon
  function dpQte(n) { return n + ' (' + (DP_CHIFFRES[n] || n) + ')'; }
  function dpPatients(n) { return 'Pour ' + n + ' patient' + (n > 1 ? 's' : ''); }
  // horaires d'ouverture portés sur le bon (le formulaire les demande)
  const DP_HORAIRES = '9h00-12h30 / 14h00-19h30, du lundi au samedi';
  // dernière valeur saisie pour un champ qui ne change jamais : on la propose d'office
  function dpDernier(champ, defaut) {
    const v = L().find(r => r && r[champ]);
    return (v && v[champ]) || defaut;
  }

  // ── styles ──────────────────────────────────────────────────────────────────
  const DP_CSS = `
  #sec-depannage{padding:0}
  .dp-wrap{padding:18px 20px 30px}
  .dp-head{display:flex;align-items:flex-end;gap:14px;flex-wrap:wrap;margin-bottom:16px}
  .dp-head h2{margin:0;font-size:1.15rem}
  .dp-head .dp-sub{color:var(--gray-500,#6b6b6b);font-size:12.5px;margin-top:3px}
  .dp-grow{flex:1}
  .dp-card{background:#fff;border:1px solid var(--gray-200,#e6e6e6);border-radius:14px;padding:16px 18px;margin-bottom:14px;
    box-shadow:0 1px 3px rgba(0,0,0,.04)}
  .dp-card>b{font-size:14px}
  .dp-form{display:flex;flex-wrap:wrap;gap:12px;margin-top:12px}
  .dp-form label{display:flex;flex-direction:column;gap:4px;font-size:11.5px;font-weight:600;color:var(--gray-500,#6b6b6b)}
  .dp-inp{font:inherit;font-size:13.5px;height:36px;padding:0 10px;border:1px solid var(--gray-300,#d5d5d5);border-radius:8px;background:#fff}
  .dp-inp:focus{outline:none;border-color:#1D5C3A;box-shadow:0 0 0 2px rgba(29,92,58,.14)}
  .dp-lig{width:100%;border-collapse:collapse;font-size:13px;margin-top:6px}
  .dp-lig th{font-size:10.5px;text-transform:uppercase;letter-spacing:.4px;color:var(--gray-500,#6b6b6b);text-align:left;padding:6px 8px;border-bottom:2px solid var(--gray-200,#e6e6e6)}
  .dp-lig td{padding:5px 8px;border-bottom:1px solid var(--gray-200,#e6e6e6);vertical-align:middle}
  .dp-lig .dp-inp{height:32px;width:100%}
  .dp-qte{text-align:center;font-weight:700;font-size:15px!important}
  .dp-qte:placeholder-shown{font-weight:400;color:#9aa0a0}
  .dp-mini{padding:4px 10px;font-size:12px;border-radius:7px}
  .dp-note{font-size:11.5px;color:var(--gray-500,#6b6b6b);line-height:1.55;margin-top:10px}
  .dp-alerte{background:#FFF6E5;border:1px solid #F0DCB0;border-left:4px solid #B8821C;border-radius:10px;
    padding:9px 13px;font-size:12.5px;color:#6E5210;margin-top:12px}
  .dp-ok{background:#E9F5EE;border-color:#C7E4D4;border-left-color:#1D5C3A;color:#1D5C3A}
  .dp-st{display:inline-block;font-size:10.5px;font-weight:700;border-radius:6px;padding:2px 8px}
  .dp-st.brouillon{background:#EFEFEF;color:#555}
  .dp-st.envoye{background:#E3F2FD;color:#0D47A1}
  .dp-st.recu{background:#E9F5EE;color:#1D5C3A}
  .dp-st.annule{background:#FBE9E7;color:#B23A2F}
  .dp-vide{color:var(--gray-500,#6b6b6b);font-size:13px;padding:14px 2px}
  .dp-prod{font-weight:600}
  .dp-cip{font-variant-numeric:tabular-nums;color:var(--gray-500,#6b6b6b);font-size:12px}
  `;

  // ── écran ───────────────────────────────────────────────────────────────────
  const DP_SECTION = `
  <div class="dp-wrap">
    <div class="dp-head">
      <div>
        <h2>Dépannage</h2>
        <div class="dp-sub">Bons de commande ${E(DP_FOURNISSEUR.nom)} — retour à ${E(DP_FOURNISSEUR.mail)}</div>
      </div>
      <span class="dp-grow"></span>
      <div class="dp-sub" style="text-align:right">Service relation clients<br><b style="font-size:15px;color:#1D5C3A">${E(DP_FOURNISSEUR.tel)}</b><br>${E(DP_FOURNISSEUR.horaires)}</div>
    </div>
    <div id="dp-body"></div>
  </div>`;

  // ── PDF : reproduction fidèle du bon, pré-rempli ────────────────────────────
  // Les positions reprennent celles du formulaire d'origine (page A4, mesures
  // relevées sur leur PDF puis converties en millimètres). Seul le logo du
  // laboratoire n'est pas reproduit : la marque reste la leur.
  function dpPdf(rec) {
    const JP = window.jspdf && window.jspdf.jsPDF;
    if (!JP) return null;
    const d = new JP({ unit: 'mm', format: 'a4' });
    let F = 'helvetica';
    try {
      if (window.GOTHAM_FONT_B64) {
        d.addFileToVFS('Gotham.ttf', window.GOTHAM_FONT_B64);
        ['normal', 'bold', 'italic', 'bolditalic'].forEach(st => d.addFont('Gotham.ttf', 'gotham', st));
        F = 'gotham';
      }
    } catch (e) { }
    const P = 0.3528;                    // point → millimètre
    const X = pt => pt * P;              // abscisse
    const Y = pt => (pt + 8) * P;        // ordonnée : le relevé donne le haut du texte, jsPDF la ligne de base
    const OF = (typeof OFFICINE !== 'undefined') ? OFFICINE : { nom: '', adresse: '', cp: '', ville: '', tel: '', mail: '' };
    const noir = () => d.setTextColor(20, 20, 20);
    const gris = () => d.setTextColor(90, 90, 90);

    // ── en-tête : référence et date, alignées à droite comme sur l'original ──
    d.setFont(F, 'normal'); d.setFontSize(10); noir();
    d.text('N° ref : ' + (rec.ref || ''), X(284), Y(31));
    d.text('Date : ' + joli(rec.dateBon || rec.date), X(317), Y(43));

    // ── identité du service (le logo du laboratoire n'est pas reproduit) ──
    d.setFont(F, 'bold'); d.setFontSize(13); d.setTextColor(0, 92, 156);
    d.text('SECOURS PHARMA', X(34), Y(28));
    d.setFont(F, 'normal'); d.setFontSize(8.5); gris();
    d.text(DP_FOURNISSEUR.labo + ' · dépositaire ' + DP_FOURNISSEUR.depositaire, X(34), Y(44));

    // ── bandeau « Service relation clients » ──
    d.setFont(F, 'bold'); d.setFontSize(11); noir();
    d.text('"Service relation clients"', X(196), Y(141));
    // encadré du numéro
    const bx = X(170), by = Y(141) + 2.5, bw = X(340) - bx, bh = 9;
    d.setFillColor(232, 240, 250); d.setDrawColor(90, 130, 180); d.setLineWidth(0.5);
    d.roundedRect(bx, by, bw, bh, 2.2, 2.2, 'FD');
    d.setFont(F, 'bold'); d.setFontSize(10); d.setTextColor(0, 70, 130);
    d.text('N° tel', bx + 6, by + 6);
    d.setFontSize(13);
    d.text(DP_FOURNISSEUR.tel, bx + bw - 6, by + 6.4, { align: 'right' });
    d.setFont(F, 'normal'); d.setFontSize(7.5); gris();
    d.text("Prix d'un appel local", bx + bw / 2, by + bh + 3.4, { align: 'center' });
    d.setFontSize(8.5); noir();
    d.text('Disponible du lundi au vendredi de 9h00 à 12h00 et de 13h00 à 17h00', X(158), Y(199));

    // ── corps de la demande, mot pour mot ──
    d.setFontSize(9.5); noir();
    d.setFont(F, 'normal'); d.text('Madame, Monsieur,', X(34), Y(223));
    d.text('Merci de bien vouloir confirmer votre commande en retournant ce bon par email à', X(34), Y(236));
    d.setFont(F, 'bold'); d.text(DP_FOURNISSEUR.mail, X(34), Y(247));
    d.text("Votre commande ne sera prise en compte qu'après réception de ce bon dument", X(34), Y(259));
    d.text('complété.', X(34), Y(270));
    d.setFont(F, 'normal');
    d.text('Ce bon est à ', X(34), Y(283));
    let cx = X(34) + d.getTextWidth('Ce bon est à ');
    d.setFont(F, 'bold'); d.text('usage unique', cx, Y(283));
    cx += d.getTextWidth('usage unique');
    d.setFont(F, 'normal'); d.text(' et ne pourra pas être réutilisé ultérieurement.', cx, Y(283));

    // ── tableau des produits (mêmes colonnes que l'original) ──
    const c0 = X(33), c1 = X(102), c2 = X(404), c3 = X(494);
    let yT = X(316) / P * P;             // haut du tableau, en mm
    yT = 316 * P;
    const hEnt = 14 * P;
    d.setFillColor(224, 224, 224); d.setDrawColor(0, 0, 0); d.setLineWidth(0.4);
    d.rect(c0, yT, c1 - c0, hEnt, 'FD'); d.rect(c1, yT, c2 - c1, hEnt, 'FD'); d.rect(c2, yT, c3 - c2, hEnt, 'FD');
    d.setFont(F, 'bold'); d.setFontSize(9.5); noir();
    d.text('CIP', (c0 + c1) / 2, yT + hEnt - 1.6, { align: 'center' });
    d.text('Produits', (c1 + c2) / 2, yT + hEnt - 1.6, { align: 'center' });
    d.text('Quantités', (c2 + c3) / 2, yT + hEnt - 1.6, { align: 'center' });
    let yL = yT + hEnt;
    (rec.lignes || []).filter(l => l.produit || l.cip || l.qte).forEach(l => {
      const nom = d.splitTextToSize(String(l.produit || ''), (c2 - c1) - 4);
      const qte = d.splitTextToSize(String(l.qte || '') + (l.patients ? ' - ' + l.patients : ''), (c3 - c2) - 4);
      const h = Math.max(11, nom.length * 4.2 + 4, qte.length * 4.2 + 4);
      d.setDrawColor(0, 0, 0); d.setLineWidth(0.4);
      d.rect(c0, yL, c1 - c0, h, 'S'); d.rect(c1, yL, c2 - c1, h, 'S'); d.rect(c2, yL, c3 - c2, h, 'S');
      d.setFont(F, 'normal'); d.setFontSize(9.5); noir();
      d.text(String(l.cip || ''), (c0 + c1) / 2, yL + h / 2 + 1.4, { align: 'center' });
      d.text(nom, c1 + 2, yL + (h - nom.length * 4.2) / 2 + 3.4);
      d.text(qte, (c2 + c3) / 2, yL + (h - qte.length * 4.2) / 2 + 3.4, { align: 'center' });
      yL += h;
    });

    // Sur le bon d'origine le tableau ne fait qu'une ligne ; avec plusieurs produits
    // tout le bas de page descend d'autant, sans jamais chevaucher.
    const dY = Math.max(0, yL - 377 * P);
    const YB = pt => Y(pt) + dY;

    // ── coordonnées de la pharmacie, déjà remplies ──
    d.setFont(F, 'bold'); d.setFontSize(10); noir();
    d.text('Coordonnées de la pharmacie :', X(34), YB(394));
    d.setDrawColor(20, 20, 20); d.setLineWidth(0.4);
    d.line(X(34), YB(394) + 1.1, X(200), YB(394) + 1.1);
    d.setFont(F, 'normal'); d.setFontSize(6.5); gris();
    d.text('PARTIE A COMPLETER (ou cachet de la pharmacie)', X(34), YB(409));

    const champ = (lab, val, topPt) => {
      const y = YB(topPt);
      d.setFont(F, 'normal'); d.setFontSize(9.5); noir();
      let x = X(34);
      if (lab) { d.text(lab, x, y); x += d.getTextWidth(lab) + 2; }
      d.setDrawColor(120, 120, 120); d.setLineWidth(0.25);
      d.line(x, y + 1.2, X(478), y + 1.2);
      if (val) { d.setFont(F, 'bold'); d.text(String(val), x + 1.5, y); }
    };
    champ('Nom :', OF.nom, 444);
    champ('Adresse :', OF.adresse, 469);
    champ('', (OF.cp || '') + ' ' + (OF.ville || ''), 494);
    champ('', OF.finess ? 'FINESS ' + OF.finess : '', 519);
    champ('Tél :', OF.tel, 545);
    champ('Fax :', rec.fax || '', 570);

    // ── colonne de droite : date, lieu, signature ──
    d.setFont(F, 'normal'); d.setFontSize(9.5); noir();
    d.text('Fait le :', X(405), YB(394));
    d.setFont(F, 'bold'); d.text(joli(rec.date), X(405) + 16, YB(394));
    d.setFont(F, 'normal'); d.text('A :', X(405), YB(418));
    d.setFont(F, 'bold'); d.text(String(OF.ville || ''), X(405) + 16, YB(418));
    d.setFont(F, 'normal');
    d.text('Signature et Nom', X(405), YB(494));
    d.text('du pharmacien :', X(405), YB(519));
    if (rec.sig) { try { d.addImage(rec.sig, 'PNG', X(405), YB(528), 40, 17); } catch (e) { } }
    d.setFont(F, 'bold'); d.setFontSize(10);
    d.text(String(rec.pharmacien || ''), X(405), YB(586));

    // ── horaires d'ouverture ──
    d.setFont(F, 'normal'); d.setFontSize(9.5); noir();
    d.text("Horaires d'ouverture de la pharmacie :", X(34), YB(653));
    if (rec.horaires) {
      d.setFont(F, 'bold');
      d.text(String(rec.horaires), X(34) + d.getTextWidth("Horaires d'ouverture de la pharmacie : ") + 2, YB(653));
    }

    // ── rappels de fin de page, repris de leur formulaire ──
    const dF = Math.min(dY, Math.max(0, 800 * P - Y(751)));   // les rappels restent sur la page
    const YF = pt => Y(pt) + dF;
    const petit = (txt, topPt, style, taille) => {
      d.setFont(F, style || 'normal'); d.setFontSize(taille || 7.5); noir();
      d.text(txt, X(33), YF(topPt));
    };
    petit('Commande', 683, 'bolditalic', 7.5);
    d.setDrawColor(20, 20, 20); d.setLineWidth(0.25);
    d.line(X(33), YF(683) + 1, X(33) + d.getTextWidth('Commande'), YF(683) + 1);
    petit('. Prise de commande par téléphone au numéro ci-dessus', 694);
    petit(". Confirmation impérative de la commande à MOVIANTO par retour d'un bon de commande pré-rempli (par email)", 706);
    petit('Délais de livraison', 729, 'bolditalic', 7.5);
    d.line(X(33), YF(729) + 1, X(33) + d.getTextWidth('Délais de livraison'), YF(729) + 1);
    petit('. En 24 h pour toute commande passée et confirmée avant 15h (hors week-end et jours fériés)', 740);
    petit('. En 48 h pour toute commande passée et confirmée après 15h (hors week-end et jours fériés)', 751);
    return d;
  }

  /* Relit ce qui est RÉELLEMENT à l'écran avant de fabriquer le PDF.
     Un champ encore en cours de saisie (dont l'événement onchange n'est pas
     encore parti : on clique droit sur « Envoyer », on garde le curseur dans
     la case, le navigateur avale l'événement…) ne peut donc plus manquer
     sur le bon : ce qu'on voit est ce qui s'imprime. */
  function dpSyncDom(rec) {
    if (!rec) return rec;
    let chg = false;
    const g = k => { const e = document.getElementById('dp-f-' + rec.id + '-' + k); return e ? e.value : null; };
    ['ref', 'dateBon', 'date', 'pharmacien', 'fax', 'horaires'].forEach(c => {
      const v = g(c); if (v == null) return;
      const t = (c === 'dateBon' || c === 'date') ? v : v.trim();
      if ((rec[c] || '') !== t) { rec[c] = t; chg = true; }
    });
    (rec.lignes || []).forEach((l, i) => {
      const gl = k => { const e = document.getElementById('dp-l-' + rec.id + '-' + i + '-' + k); return e ? e.value : null; };
      const q = gl('nb');
      if (q != null) {
        const n = parseInt(String(q).replace(/\D+/g, ''), 10) || null;
        if ((l.nb || null) !== n) {
          l.nb = n; l.qte = n ? dpQte(n) : '';
          if (!l.patientsManuel) l.patients = n ? dpPatients(n) : '';
          chg = true;
        }
      }
      ['cip', 'produit', 'patients'].forEach(c => {
        const v = gl(c); if (v == null) return;
        const t = v.trim();
        if ((l[c] || '') !== t) { l[c] = t; chg = true; }
      });
    });
    if (chg) { rec.updatedAt = Date.now(); persist(); }
    return rec;
  }

  function dpNomFichier(rec) {
    return 'bon-depannage-' + String(rec.ref || 'sans-ref').replace(/[^\w.-]+/g, '-') + '.pdf';
  }

  window.dpApercu = function (id) {
    const rec = dpSyncDom(L().find(x => x.id === id)); if (!rec) return;
    const doc = dpPdf(rec);
    if (!doc) { alert("Le générateur de PDF n'est pas disponible sur ce poste."); return; }
    try { window.open(doc.output('bloburl'), '_blank'); }
    catch (e) { doc.save(dpNomFichier(rec)); }
  };
  window.dpTelecharger = function (id) {
    const rec = dpSyncDom(L().find(x => x.id === id)); if (!rec) return;
    const doc = dpPdf(rec); if (!doc) return;
    doc.save(dpNomFichier(rec));
  };

  // ── envoi au dépositaire ────────────────────────────────────────────────────
  window.dpEnvoyer = async function (id) {
    const rec = dpSyncDom(L().find(x => x.id === id)); if (!rec) return;
    if (!rec.lignes || !rec.lignes.length || !rec.lignes.some(l => l.produit)) { alert('Ajoutez au moins un produit avant d’envoyer.'); return; }
    if (!rec.ref) { alert('Le numéro de référence du bon est obligatoire : c’est lui qui identifie la commande.'); return; }
    const dest = DP_FOURNISSEUR.mail;
    const resume = (rec.lignes || []).filter(l => l.produit)
      .map(l => '· ' + (l.produit || '') + (l.cip ? ' (CIP ' + l.cip + ')' : '') + ' — ' + (l.qte || '') + (l.patients ? ' · ' + l.patients : '')).join('\n');
    if (!confirm('Envoyer le bon ' + rec.ref + ' à ' + dest + ' ?\n\n' + resume)) return;

    const doc = dpPdf(rec);
    if (!doc) { alert("Le générateur de PDF n'est pas disponible : téléchargez le bon et envoyez-le manuellement."); return; }
    const b64 = doc.output('datauristring').split(',')[1];
    const OF = (typeof OFFICINE !== 'undefined') ? OFFICINE : { nom: 'Pharmacie' };
    const corps = 'Bonjour,\n\nVeuillez trouver ci-joint le bon de commande de dépannage n° ' + rec.ref
      + ' dûment complété.\n\n' + resume + '\n\n'
      + OF.nom + '\n' + (OF.adresse || '') + '\n' + (OF.cp || '') + ' ' + (OF.ville || '')
      + '\nTél : ' + (OF.tel || '') + '\n' + (rec.pharmacien ? rec.pharmacien + '\n' : '');

    const btn = document.getElementById('dp-env-' + id);
    if (btn) { btn.disabled = true; btn.textContent = 'Envoi…'; }
    try {
      const r = await fetch('/api/send-mail', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: dest,
          subject: 'Bon de commande de dépannage n° ' + rec.ref + ' — ' + (OF.nom || ''),
          text: corps,
          attachments: [{ name: dpNomFichier(rec), content: b64 }]
        })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false) throw new Error(j.error || ('HTTP ' + r.status));
      rec.statut = 'envoye';
      rec.envoyeA = dest;
      rec.envoyeLe = Date.now();
      rec.updatedAt = Date.now();
      persist(); dpRender();
      alert('Bon envoyé à ' + dest + '.');
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = '✉ Envoyer'; }
      alert("L'envoi a échoué : " + (e && e.message ? e.message : 'erreur inconnue')
        + "\n\nLe bon reste enregistré : téléchargez-le et envoyez-le depuis votre messagerie.");
    }
  };

  // ── création / modification ─────────────────────────────────────────────────
  function dpMoi() {
    const u = (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null;
    return u ? { nom: (u.prenom || '') + ' ' + (u.nom || ''), sig: u.sig || '' } : { nom: '', sig: '' };
  }
  window.dpNouveau = function () {
    const now = new Date();
    const moi = dpMoi();
    const rec = {
      id: newId(), ref: dpDernier('ref', DP_REF), date: iso(now), dateBon: iso(now),
      heure: String(now.getHours()).padStart(2, '0') + 'h' + String(now.getMinutes()).padStart(2, '0'),
      lignes: [{ cip: DP_PRODUIT_HABITUEL.cip, produit: DP_PRODUIT_HABITUEL.produit, qte: '', patients: '' }],
      pharmacien: moi.nom, sig: moi.sig, statut: 'brouillon',
      fax: dpDernier('fax', ''), horaires: dpDernier('horaires', DP_HORAIRES),
      creePar: (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : null,
      updatedAt: Date.now()
    };
    L().unshift(rec);
    persist(); dpRender();
    setTimeout(() => { const e = document.getElementById('dp-l-' + rec.id + '-0-nb'); if (e) e.focus(); }, 60);
  };
  window.dpSet = function (id, champ, val) {
    const rec = L().find(x => x.id === id); if (!rec) return;
    rec[champ] = val; rec.updatedAt = Date.now(); persist();
    if (champ === 'statut') dpRender();
  };
  window.dpSetLigne = function (id, i, champ, val) {
    const rec = L().find(x => x.id === id); if (!rec || !rec.lignes || !rec.lignes[i]) return;
    rec.lignes[i][champ] = val; rec.updatedAt = Date.now(); persist();
  };
  // saisie de la quantité en chiffres : on écrit la mention en lettres et le nombre de patients
  window.dpSetQte = function (id, i, val) {
    const rec = L().find(x => x.id === id); if (!rec || !rec.lignes || !rec.lignes[i]) return;
    const n = parseInt(String(val).replace(/\D+/g, ''), 10);
    const l = rec.lignes[i];
    if (!n) { l.nb = null; l.qte = ''; if (!l.patientsManuel) l.patients = ''; }
    else {
      l.nb = n; l.qte = dpQte(n);
      if (!l.patientsManuel) l.patients = dpPatients(n);
    }
    rec.updatedAt = Date.now(); persist(); dpRender();
  };
  window.dpSetPatients = function (id, i, val) {
    const rec = L().find(x => x.id === id); if (!rec || !rec.lignes || !rec.lignes[i]) return;
    const l = rec.lignes[i];
    l.patients = val;
    l.patientsManuel = !!val && val !== dpPatients(l.nb || 0);
    rec.updatedAt = Date.now(); persist();
  };
  window.dpAddLigne = function (id) {
    const rec = L().find(x => x.id === id); if (!rec) return;
    if (!Array.isArray(rec.lignes)) rec.lignes = [];
    rec.lignes.push({ cip: '', produit: '', qte: '', patients: '' });
    rec.updatedAt = Date.now(); persist(); dpRender();
  };
  window.dpDelLigne = function (id, i) {
    const rec = L().find(x => x.id === id); if (!rec || !rec.lignes) return;
    rec.lignes.splice(i, 1);
    if (!rec.lignes.length) rec.lignes.push({ cip: DP_PRODUIT_HABITUEL.cip, produit: DP_PRODUIT_HABITUEL.produit, qte: '', patients: '' });
    rec.updatedAt = Date.now(); persist(); dpRender();
  };
  window.dpSupprimer = function (id) {
    const arr = L(); const i = arr.findIndex(x => x.id === id); if (i < 0) return;
    const rec = arr[i];
    if (rec.statut === 'envoye' && !confirm('Ce bon a déjà été envoyé. Le supprimer de l’historique ?')) return;
    if (rec.statut !== 'envoye' && !confirm('Supprimer ce bon ?')) return;
    if (typeof markDeleted === 'function') markDeleted('depannages', id);
    arr.splice(i, 1); persist(); dpRender();
  };
  // reprendre un bon passé : même produits, nouvelle référence à saisir
  window.dpRefaire = function (id) {
    const src = L().find(x => x.id === id); if (!src) return;
    const now = new Date(), moi = dpMoi();
    const rec = {
      id: newId(), ref: src.ref || dpDernier('ref', DP_REF), date: iso(now), dateBon: iso(now),
      heure: String(now.getHours()).padStart(2, '0') + 'h' + String(now.getMinutes()).padStart(2, '0'),
      lignes: (src.lignes || []).map(l => ({ cip: l.cip, produit: l.produit, qte: l.qte, patients: '' })),
      pharmacien: moi.nom, sig: moi.sig, statut: 'brouillon',
      fax: src.fax || dpDernier('fax', ''), horaires: src.horaires || dpDernier('horaires', DP_HORAIRES),
      creePar: (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : null,
      updatedAt: Date.now()
    };
    L().unshift(rec); persist(); dpRender();
    setTimeout(() => { const e = document.getElementById('dp-l-' + rec.id + '-0-nb'); if (e) e.focus(); }, 60);
  };

  // ── rendu ───────────────────────────────────────────────────────────────────
  function dpDelai(rec) {
    // 24 h si le bon part avant l'heure limite, 48 h sinon (hors week-end et fériés)
    const t = rec.envoyeLe ? new Date(rec.envoyeLe) : new Date();
    const avant = t.getHours() < DP_FOURNISSEUR.heureLimite;
    let j = avant ? 1 : 2, d = new Date(t);
    while (j > 0) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) j--; }
    return { texte: avant ? '24 h' : '48 h', le: iso(d), avant: avant };
  }

  window.dpRender = function () {
    const host = document.getElementById('dp-body'); if (!host) return;
    const arr = L().slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const brouillons = arr.filter(r => r.statut === 'brouillon');
    // Un brouillon ouvert avant le pré-remplissage (ligne entièrement vide) reçoit
    // le produit habituel : on ne laisse jamais un bon partir sans sa ligne produit.
    brouillons.forEach(rec => {
      if (!rec.ref) rec.ref = dpDernier('ref', DP_REF);
      const l = rec.lignes && rec.lignes.length === 1 ? rec.lignes[0] : null;
      if (l && !l.cip && !l.produit && !l.qte) { l.cip = DP_PRODUIT_HABITUEL.cip; l.produit = DP_PRODUIT_HABITUEL.produit; }
    });
    const suite = arr.filter(r => r.statut !== 'brouillon');
    let H = '';

    H += '<div style="margin-bottom:14px"><button class="btn bp" onclick="dpNouveau()">'
      + '<svg class="ico"><use href="#ic-document"></use></svg> Nouveau bon de dépannage</button></div>';

    // bons en cours de saisie
    brouillons.forEach(rec => {
      const d = dpDelai(rec);
      H += '<div class="dp-card">'
        + '<b>Bon en préparation</b>'
        + '<div class="dp-form">'
        + '<label style="flex:1 1 210px">N° de référence <span style="font-weight:400">— toujours le même, déjà rempli</span>'
        + '<input class="dp-inp" id="dp-f-' + rec.id + '-ref" value="' + E(rec.ref) + '" placeholder="P26-0831014421" onchange="dpSet(\'' + rec.id + '\',\'ref\',this.value.trim())"></label>'
        + '<label>Date du bon<input type="date" class="dp-inp" id="dp-f-' + rec.id + '-dateBon" value="' + E(rec.dateBon) + '" onchange="dpSet(\'' + rec.id + '\',\'dateBon\',this.value)"></label>'
        + '<label>Fait le<input type="date" class="dp-inp" id="dp-f-' + rec.id + '-date" value="' + E(rec.date) + '" onchange="dpSet(\'' + rec.id + '\',\'date\',this.value)"></label>'
        + '<label style="flex:1 1 200px">Pharmacien signataire'
        + '<input class="dp-inp" id="dp-f-' + rec.id + '-pharmacien" value="' + E(rec.pharmacien) + '" onchange="dpSet(\'' + rec.id + '\',\'pharmacien\',this.value)"></label>'
        + '<label style="flex:1 1 150px">Fax <span style="font-weight:400">— si vous en avez un</span>'
        + '<input class="dp-inp" id="dp-f-' + rec.id + '-fax" value="' + E(rec.fax || '') + '" placeholder="—" onchange="dpSet(\'' + rec.id + '\',\'fax\',this.value.trim())"></label>'
        + '<label style="flex:1 1 260px">Horaires d’ouverture <span style="font-weight:400">— demandés sur le bon</span>'
        + '<input class="dp-inp" id="dp-f-' + rec.id + '-horaires" value="' + E(rec.horaires || '') + '" onchange="dpSet(\'' + rec.id + '\',\'horaires\',this.value.trim())"></label>'
        + '</div>'
        + '<table class="dp-lig"><tr><th style="width:120px">CIP</th><th>Produit</th><th style="width:90px">Quantité</th><th style="width:170px">Mention sur le bon</th><th style="width:36px"></th></tr>'
        + (rec.lignes || []).map((l, i) => '<tr>'
          + '<td><input class="dp-inp" id="dp-l-' + rec.id + '-' + i + '-cip" value="' + E(l.cip) + '" onchange="dpSetLigne(\'' + rec.id + '\',' + i + ',\'cip\',this.value.trim())"></td>'
          + '<td><input class="dp-inp" id="dp-l-' + rec.id + '-' + i + '-produit" value="' + E(l.produit) + '" onchange="dpSetLigne(\'' + rec.id + '\',' + i + ',\'produit\',this.value.trim())"></td>'
          + '<td><input class="dp-inp dp-qte" id="dp-l-' + rec.id + '-' + i + '-nb" type="number" min="1" max="20" value="' + (l.nb != null ? l.nb : '') + '" placeholder="3"'
          + ' title="Nombre de boîtes — la mention en lettres et le nombre de patients se remplissent tout seuls"'
          + ' oninput="dpSetQte(\'' + rec.id + '\',' + i + ',this.value)"></td>'
          + '<td><input class="dp-inp" id="dp-l-' + rec.id + '-' + i + '-patients" value="' + E(l.patients) + '" onchange="dpSetPatients(\'' + rec.id + '\',' + i + ',this.value.trim())"></td>'
          + '<td><button class="btn bs sm dp-mini" title="Retirer cette ligne" onclick="dpDelLigne(\'' + rec.id + '\',' + i + ')">✕</button></td></tr>').join('')
        + '</table>'
        + '<div style="margin-top:8px"><button class="btn bs sm dp-mini" onclick="dpAddLigne(\'' + rec.id + '\')">＋ Ajouter un produit</button></div>'
        + (rec.sig ? '' : '<div class="dp-alerte">Aucune signature enregistrée pour vous : le bon partira sans signature. Back Office → Collaborateurs → bouton Signature.</div>')
        + '<div class="dp-alerte ' + (d.avant ? 'dp-ok' : '') + '">'
        + (d.avant
          ? 'Envoyé maintenant, ce bon est annoncé en <b>24 h</b> — livraison attendue le <b>' + joli(d.le) + '</b>.'
          : 'Il est plus de ' + DP_FOURNISSEUR.heureLimite + 'h : le délai annoncé passe à <b>48 h</b> — livraison attendue le <b>' + joli(d.le) + '</b>.')
        + '</div>'
        + '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">'
        + '<button class="btn bp" id="dp-env-' + rec.id + '" onclick="dpEnvoyer(\'' + rec.id + '\')">✉ Envoyer</button>'
        + '<button class="btn bs" onclick="dpApercu(\'' + rec.id + '\')">Aperçu du bon</button>'
        + '<button class="btn bs" onclick="dpTelecharger(\'' + rec.id + '\')">Télécharger</button>'
        + '<span class="dp-grow"></span>'
        + '<button class="btn bs" onclick="dpSupprimer(\'' + rec.id + '\')">Supprimer</button>'
        + '</div></div>';
    });

    // historique
    H += '<div class="dp-card"><b>Bons envoyés</b>';
    if (!suite.length) {
      H += '<div class="dp-vide">Aucun bon envoyé pour le moment.</div>';
    } else {
      H += '<table class="dp-lig"><tr><th>Référence</th><th>Produits</th><th>Envoyé le</th><th>Statut</th><th></th></tr>'
        + suite.slice(0, 120).map(rec => {
          const prods = (rec.lignes || []).filter(l => l.produit).map(l =>
            '<div><span class="dp-prod">' + E(l.produit) + '</span>'
            + (l.qte ? ' — ' + E(l.qte) : '')
            + (l.cip ? '<br><span class="dp-cip">CIP ' + E(l.cip) + '</span>' : '') + '</div>').join('');
          return '<tr><td><b>' + E(rec.ref || '—') + '</b><br><span class="dp-cip">bon du ' + joli(rec.dateBon) + '</span></td>'
            + '<td>' + (prods || '—') + '</td>'
            + '<td>' + (rec.envoyeLe ? joli(iso(new Date(rec.envoyeLe))) : '—') + '</td>'
            + '<td><select class="dp-inp" style="height:30px;font-size:12px" onchange="dpSet(\'' + rec.id + '\',\'statut\',this.value)">'
            + Object.keys(DP_STATUTS).map(k => '<option value="' + k + '"' + (rec.statut === k ? ' selected' : '') + '>' + DP_STATUTS[k] + '</option>').join('')
            + '</select></td>'
            + '<td style="white-space:nowrap">'
            + '<button class="btn bs sm dp-mini" onclick="dpApercu(\'' + rec.id + '\')">Voir</button> '
            + '<button class="btn bs sm dp-mini" title="Repartir des mêmes produits pour une nouvelle commande" onclick="dpRefaire(\'' + rec.id + '\')">Refaire</button> '
            + '<button class="btn bs sm dp-mini" onclick="dpSupprimer(\'' + rec.id + '\')">✕</button></td></tr>';
        }).join('') + '</table>';
    }
    H += '<div class="dp-note">Le bon est reproduit à l’identique du formulaire ' + E(DP_FOURNISSEUR.nom)
      + ', pré-rempli avec les coordonnées de l’officine et la signature du pharmacien connecté, puis envoyé en pièce jointe à '
      + E(DP_FOURNISSEUR.mail) + '. Le numéro de référence est à usage unique : une nouvelle commande demande un nouvel appel au '
      + E(DP_FOURNISSEUR.tel) + '.</div></div>';

    host.innerHTML = H;
  };

  // ── injection dans l'intranet ───────────────────────────────────────────────
  function dpInject() {
    if (document.getElementById('dp-css')) return;
    const st = document.createElement('style'); st.id = 'dp-css'; st.textContent = DP_CSS; document.head.appendChild(st);
    const navRef = document.querySelector('.sb-item[data-sec="preparations"]')
      || document.querySelector('.sb-item[data-sec="livraisons"]');
    if (navRef && !document.querySelector('.sb-item[data-sec="depannage"]')) {
      const b = document.createElement('button');
      b.className = 'sb-item'; b.setAttribute('data-sec', 'depannage');
      b.setAttribute('onclick', "showSec('depannage',this); if(window.dpRender) dpRender();");
      b.innerHTML = '<svg class="ico sb-ico"><use href="#ic-recommande"></use></svg><span class="sb-label">Dépannage</span>';
      navRef.insertAdjacentElement('afterend', b);
    }
    const secRef = document.getElementById('sec-livraisons');
    if (secRef && !document.getElementById('sec-depannage')) {
      const sec = document.createElement('section');
      sec.id = 'sec-depannage'; sec.className = 'sec'; sec.innerHTML = DP_SECTION;
      secRef.parentNode.appendChild(sec);
      window.dpRender();
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', dpInject);
  else dpInject();
  setTimeout(function () { try { dpRender(); } catch (e) { } }, 500);
})();
