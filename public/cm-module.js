/* ════════════════════════════════════════════════════════════════
   Module COMMANDE DE MONNAIE — additif dans la Caisse
   - Inventaire du fond de caisse de monnaie (état actuel par dénomination)
   - Calcul des besoins pour reconstituer le fond fixe (cible - état)
   - Mail récapitulatif de commande à la banque (via /api/send-mail existant)
   - Fond cible modifiable (paramètres), historique des commandes
   - Banque (nom + mail) configurable dans l'onglet « Sous-traitants »
   Isolé : préfixe cm / cm-. N'écrase aucune fonction existante.
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // Dénominations : valeur, valeur d'une unité (rouleau pour les pièces / billet pour le 5€), libellé, type
  const CM_DEN = [
    { k: '5',    unit: 5,   type: 'billet',  lbl: '5 €' },
    { k: '2',    unit: 50,  type: 'rouleau', lbl: '2 €' },
    { k: '1',    unit: 25,  type: 'rouleau', lbl: '1 €' },
    { k: '0.5',  unit: 20,  type: 'rouleau', lbl: '0,50 €' },
    { k: '0.2',  unit: 8,   type: 'rouleau', lbl: '0,20 €' },
    { k: '0.1',  unit: 4,   type: 'rouleau', lbl: '0,10 €' },
    { k: '0.05', unit: 2.5, type: 'rouleau', lbl: '0,05 €' },
    { k: '0.02', unit: 1,   type: 'rouleau', lbl: '0,02 €' },
    { k: '0.01', unit: 0.5, type: 'rouleau', lbl: '0,01 €' }
  ];
  const CM_FOND_DEFAULT = { '5': 80, '2': 12, '1': 12, '0.5': 12, '0.2': 6, '0.1': 10, '0.05': 10, '0.02': 5, '0.01': 4 };

  const cmEuro = (n) => (typeof euro === 'function') ? euro(n) : ((Number(n) || 0).toFixed(2).replace('.', ',') + ' €');
  const cmNum = (v) => { const n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isNaN(n) ? 0 : n; };
  const cmDen = (k) => CM_DEN.find(d => d.k === k);
  const cmUnitLbl = (d, n) => d.type === 'billet' ? (n > 1 ? 'billets' : 'billet') : (n > 1 ? 'rouleaux' : 'rouleau');
  let cmEtat = {};   // inventaire courant (en mémoire, non persisté tant qu'aucune commande n'est enregistrée)

  // ─── Accès stockage (dans l'objet caisse déjà persisté + synchronisé) ───
  function cmEnsure() {
    if (typeof caisse === 'undefined' || !caisse) return;
    caisse.monnaie = caisse.monnaie || {};
    caisse.monnaie.fond = Object.assign({}, CM_FOND_DEFAULT, caisse.monnaie.fond || {});
    caisse.commandesMonnaie = caisse.commandesMonnaie || [];
  }
  function cmFond(k) { cmEnsure(); const v = caisse.monnaie.fond[k]; return v == null ? (CM_FOND_DEFAULT[k] || 0) : cmNum(v); }

  // ─── Injection de l'interface ───
  function cmInject() {
    // 1) Bouton d'entrée dans l'écran Caisse + modale (masquée par défaut)
    const sec = document.getElementById('sec-caisse');
    if (sec && !document.getElementById('cm-entry')) {
      const stats = document.getElementById('caisse-stats');
      const entry = document.createElement('div');
      entry.id = 'cm-entry';
      entry.style.margin = '0 0 1.1rem';
      entry.innerHTML = '<button class="btn bp" onclick="cmOpen()"><svg class="ico"><use href="#ic-euro"></use></svg> Commande de monnaie</button>';
      if (stats && stats.parentNode === sec) stats.insertAdjacentElement('afterend', entry);
      else sec.insertBefore(entry, sec.firstChild);
    }
    if (!document.getElementById('cm-modal')) {
      const mod = document.createElement('div');
      mod.className = 'overlay';
      mod.id = 'cm-modal';
      mod.innerHTML = '<div class="mbox" id="cm-card" style="max-width:780px">' + cmCardHTML() + '</div>';
      document.body.appendChild(mod);
    }
    // 2) Carte « Banque » dans l'onglet Sous-traitants
    const bo = document.getElementById('bo-labo');
    if (bo && !document.getElementById('cm-banque-card')) {
      const bc = document.createElement('div');
      bc.className = 'card';
      bc.id = 'cm-banque-card';
      bc.innerHTML = ''
        + '<div class="ch"><span class="ct"><svg class="ico"><use href="#ic-euro"></use></svg> Banque — commande de monnaie</span></div>'
        + '<div style="font-size:.8rem;color:var(--gray-500);margin-bottom:.9rem;line-height:1.5">Destinataire du mail de commande de monnaie. Vous pouvez le remplacer temporairement (par ex. votre propre adresse) pour tester l\'envoi.</div>'
        + '<div class="fgrid">'
        + '  <div class="fg"><label>Nom de la banque</label><input type="text" id="cm-banque-nom" placeholder="Ma banque"></div>'
        + '  <div class="fg"><label>E-mail destinataire des commandes</label><input type="email" id="cm-banque-mail" placeholder="agence@mabanque.fr"></div>'
        + '</div>'
        + '<button class="btn bp" style="margin-top:.9rem" onclick="cmSaveBanque()"><svg class="ico"><use href="#ic-valider"></use></svg> Enregistrer</button>'
        + '<span id="cm-banque-saved" style="display:none;margin-left:.6rem;color:#2E7D32;font-size:.85rem">Enregistré</span>';
      bo.appendChild(bc);
    }
    cmFillBanque();
  }

  function cmCardHTML() {
    let rows = '';
    CM_DEN.forEach(d => {
      rows += ''
        + '<tr>'
        + '<td style="font-weight:700">' + d.lbl + '</td>'
        + '<td style="text-align:right;color:var(--gray-500)">' + cmEuro(d.unit) + '</td>'
        + '<td style="text-align:center"><input type="number" min="0" step="1" id="cm-cible-' + d.k + '" class="cm-in" disabled></td>'
        + '<td style="text-align:center"><input type="number" min="0" step="1" id="cm-etat-' + d.k + '" class="cm-in" placeholder="0" oninput="cmRecalc()"></td>'
        + '<td style="text-align:center;font-weight:700" id="cm-cmd-' + d.k + '">0</td>'
        + '<td style="text-align:right;font-weight:700" id="cm-val-' + d.k + '">' + cmEuro(0) + '</td>'
        + '</tr>';
    });
    return ''
      + '<style>'
      + '#cm-card .cm-tbl{width:100%;border-collapse:collapse;font-size:.86rem}'
      + '#cm-card .cm-tbl th,#cm-card .cm-tbl td{padding:7px 9px;border-bottom:1px solid var(--gray-200)}'
      + '#cm-card .cm-tbl th{text-align:left;font-size:.72rem;letter-spacing:.3px;text-transform:uppercase;color:var(--gray-500)}'
      + '#cm-card .cm-in{width:74px;border:1px solid var(--gray-200);border-radius:7px;padding:6px 8px;font-size:.85rem;text-align:center}'
      + '#cm-card .cm-in:disabled{background:var(--gray-100);color:var(--gray-700)}'
      + '#cm-card .cm-foot td{font-weight:800;border-top:2px solid var(--gray-200);border-bottom:none}'
      + '</style>'
      + '<div class="ch"><span class="ct"><svg class="ico"><use href="#ic-euro"></use></svg> Commande de monnaie</span>'
      + '<span style="display:flex;gap:6px">'
      + '<button class="btn bs sm" id="cm-fond-edit-btn" onclick="cmToggleFond()">Modifier le fond cible</button>'
      + '<button class="btn bs sm" onclick="cmClose()">Fermer</button></span></div>'
      + '<div style="font-size:.8rem;color:var(--gray-500);margin-bottom:.7rem;line-height:1.5">Saisissez l\'état actuel du fond de caisse (nombre de rouleaux/billets restants). Le besoin pour reconstituer le fond fixe et la valeur à commander se calculent automatiquement.</div>'
      + '<div class="twrap"><table class="cm-tbl">'
      + '<thead><tr><th>Devise</th><th style="text-align:right">Valeur unité</th><th style="text-align:center">Fond cible</th><th style="text-align:center">État actuel</th><th style="text-align:center">À commander</th><th style="text-align:right">Valeur</th></tr></thead>'
      + '<tbody>' + rows + '</tbody>'
      + '<tfoot><tr class="cm-foot"><td colspan="2">Totaux</td>'
      + '<td style="text-align:center;color:var(--gray-500)" id="cm-fond-val">' + cmEuro(0) + '</td>'
      + '<td></td>'
      + '<td style="text-align:center" id="cm-total-cmd">0</td>'
      + '<td style="text-align:right;color:var(--g-dark)" id="cm-total-val">' + cmEuro(0) + '</td></tr></tfoot>'
      + '</table></div>'
      + '<div style="display:flex;gap:8px;margin-top:1rem;flex-wrap:wrap">'
      + '  <button class="btn bp" onclick="cmPrepareMail()"><svg class="ico"><use href="#ic-envoyer"></use></svg> Préparer le mail à la banque</button>'
      + '  <button class="btn bs" onclick="cmResetEtat()">Réinitialiser la saisie</button>'
      + '  <button class="btn bs" id="cm-fond-save-btn" style="display:none" onclick="cmSaveFond()"><svg class="ico"><use href="#ic-valider"></use></svg> Enregistrer le fond cible</button>'
      + '</div>'
      + '<div id="cm-hist" style="margin-top:1.3rem"></div>';
  }

  // ─── Rendu / calculs ───
  function cmRender() {
    cmEnsure();
    if (!document.getElementById('cm-card')) return;
    CM_DEN.forEach(d => {
      const ci = document.getElementById('cm-cible-' + d.k);
      const ei = document.getElementById('cm-etat-' + d.k);
      if (ci) ci.value = cmFond(d.k);
      if (ei && cmEtat[d.k] != null) ei.value = cmEtat[d.k];
    });
    cmRecalc();
    cmRenderHist();
  }

  function cmRecalc() {
    let totCmd = 0, totVal = 0, fondVal = 0;
    CM_DEN.forEach(d => {
      const cible = cmNum((document.getElementById('cm-cible-' + d.k) || {}).value);
      const etat = cmNum((document.getElementById('cm-etat-' + d.k) || {}).value);
      cmEtat[d.k] = (document.getElementById('cm-etat-' + d.k) || {}).value || '';
      const cmd = Math.max(0, cible - etat);
      const val = cmd * d.unit;
      fondVal += cible * d.unit;
      totCmd += cmd; totVal += val;
      const cc = document.getElementById('cm-cmd-' + d.k);
      const vc = document.getElementById('cm-val-' + d.k);
      if (cc) cc.textContent = cmd;
      if (vc) vc.textContent = cmEuro(val);
    });
    const a = document.getElementById('cm-total-cmd'); if (a) a.textContent = totCmd;
    const b = document.getElementById('cm-total-val'); if (b) b.textContent = cmEuro(totVal);
    const f = document.getElementById('cm-fond-val'); if (f) f.textContent = cmEuro(fondVal);
    return { totCmd, totVal };
  }
  window.cmRecalc = cmRecalc;   // appelé depuis les handlers oninput du tableau

  function cmLines() {
    const out = [];
    CM_DEN.forEach(d => {
      const cible = cmFond(d.k);
      const etat = cmNum((document.getElementById('cm-etat-' + d.k) || {}).value);
      const cmd = Math.max(0, cible - etat);
      out.push({ k: d.k, lbl: d.lbl, type: d.type, unit: d.unit, cible, etat, cmd, val: cmd * d.unit });
    });
    return out;
  }

  // ─── Fond cible (édition) ───
  window.cmToggleFond = function () {
    const on = document.getElementById('cm-cible-5') && document.getElementById('cm-cible-5').disabled;
    CM_DEN.forEach(d => { const ci = document.getElementById('cm-cible-' + d.k); if (ci) ci.disabled = !on; });
    const sb = document.getElementById('cm-fond-save-btn'); if (sb) sb.style.display = on ? '' : 'none';
    const eb = document.getElementById('cm-fond-edit-btn'); if (eb) eb.textContent = on ? 'Annuler' : 'Modifier le fond cible';
    if (!on) cmRender(); // annulation : on recharge les valeurs enregistrées
  };
  window.cmSaveFond = function () {
    cmEnsure();
    CM_DEN.forEach(d => { caisse.monnaie.fond[d.k] = cmNum((document.getElementById('cm-cible-' + d.k) || {}).value); });
    CM_DEN.forEach(d => { const ci = document.getElementById('cm-cible-' + d.k); if (ci) ci.disabled = true; });
    const sb = document.getElementById('cm-fond-save-btn'); if (sb) sb.style.display = 'none';
    const eb = document.getElementById('cm-fond-edit-btn'); if (eb) eb.textContent = 'Modifier le fond cible';
    if (typeof schedSave === 'function') schedSave();
    cmRecalc();
  };
  window.cmResetEtat = function () {
    cmEtat = {};
    CM_DEN.forEach(d => { const ei = document.getElementById('cm-etat-' + d.k); if (ei) ei.value = ''; });
    cmRecalc();
  };

  // ─── Banque (sous-traitant) ───
  function cmFillBanque() {
    if (typeof banque === 'undefined') return;
    const n = document.getElementById('cm-banque-nom'); if (n) n.value = banque.nom || '';
    const m = document.getElementById('cm-banque-mail'); if (m) m.value = banque.mail || '';
  }
  window.cmSaveBanque = function () {
    if (typeof banque === 'undefined') window.banque = { nom: '', mail: '' };
    banque.nom = (document.getElementById('cm-banque-nom') || {}).value || '';
    banque.mail = (document.getElementById('cm-banque-mail') || {}).value || '';
    if (typeof schedSave === 'function') schedSave();
    const s = document.getElementById('cm-banque-saved'); if (s) { s.style.display = ''; setTimeout(() => { s.style.display = 'none'; }, 2500); }
  };

  // ─── Mail de commande ───
  function cmBody(lines, total) {
    const items = lines.filter(l => l.cmd > 0);
    let t = 'Bonjour,\n\nMerci de bien vouloir préparer la commande de monnaie suivante pour la Pharmacie du Centre :\n\n';
    items.forEach(l => { t += '- ' + l.lbl + ' : ' + l.cmd + ' ' + cmUnitLbl(cmDen(l.k), l.cmd) + ' (' + cmEuro(l.val) + ')\n'; });
    t += '\nMontant total de la commande : ' + cmEuro(total) + '\n\nCordialement,\nLa Pharmacie du Centre';
    return t;
  }
  window.cmPrepareMail = function () {
    cmEnsure();
    const lines = cmLines();
    const items = lines.filter(l => l.cmd > 0);
    const total = items.reduce((s, l) => s + l.val, 0);
    if (!items.length) { cmModalInfo('Aucune commande', 'Le fond de caisse est complet : aucune monnaie à commander.'); return; }
    const dest = (typeof banque !== 'undefined' && banque.mail) ? banque.mail : '';
    const subject = 'Commande de monnaie — Pharmacie du Centre';
    const body = cmBody(lines, total);
    const destTxt = dest ? (dest + (banque.nom ? ' (' + banque.nom + ')' : '')) : '⚠ Aucune banque configurée (onglet Sous-traitants)';
    cmShowMailModal(subject, body, destTxt, total, items, lines);
  };

  function cmShowMailModal(subject, body, destTxt, total, items, lines) {
    let m = document.getElementById('cm-mail-modal');
    if (!m) {
      m = document.createElement('div');
      m.id = 'cm-mail-modal';
      m.className = 'overlay';
      m.innerHTML = '<div class="mbox" style="max-width:560px">'
        + '<h3><svg class="ico"><use href="#ic-envoyer"></use></svg> Envoi de la commande de monnaie</h3>'
        + '<div id="cm-mail-body"></div>'
        + '<div id="cm-mail-foot" style="display:flex;gap:8px;margin-top:1rem;flex-wrap:wrap"></div></div>';
      document.body.appendChild(m);
    }
    const canSend = (typeof banque !== 'undefined' && banque.mail);
    document.getElementById('cm-mail-body').innerHTML = ''
      + '<div style="font-size:.85rem;color:var(--gray-700);margin-bottom:.7rem">Destinataire : <strong>' + destTxt + '</strong></div>'
      + '<div style="font-size:.85rem;color:var(--gray-700);margin-bottom:.4rem">Objet : <strong>' + subject + '</strong></div>'
      + '<textarea id="cm-mail-text" style="width:100%;min-height:210px;border:1px solid var(--gray-200);border-radius:9px;padding:10px;font-size:.83rem;font-family:inherit">' + body + '</textarea>'
      + '<div style="margin-top:.6rem;font-weight:700">Total : ' + cmEuro(total) + '</div>'
      + (canSend ? '' : '<div style="margin-top:.7rem;color:var(--red);font-size:.83rem">Renseignez le nom et l\'e-mail de la banque dans l\'onglet « Sous-traitants » avant d\'envoyer.</div>');
    document.getElementById('cm-mail-foot').innerHTML = ''
      + '<button class="btn bs" onclick="cmCloseMail()">Annuler</button>'
      + (canSend ? '<button class="btn bp" id="cm-send-btn" onclick="cmConfirmSend()"><svg class="ico"><use href="#ic-envoyer"></use></svg> Confirmer l\'envoi</button>' : '');
    // mémorise le contexte pour l'envoi
    m._ctx = { subject, total, lines };
    if (typeof openModal === 'function') openModal('cm-mail-modal'); else m.style.display = 'flex';
  }
  window.cmCloseMail = function () { const m = document.getElementById('cm-mail-modal'); if (typeof closeModal === 'function') closeModal('cm-mail-modal'); else if (m) m.style.display = 'none'; };

  window.cmConfirmSend = async function () {
    const m = document.getElementById('cm-mail-modal'); if (!m || !m._ctx) return;
    if (typeof banque === 'undefined' || !banque.mail) return;
    const btn = document.getElementById('cm-send-btn'); if (btn) { btn.disabled = true; btn.textContent = 'Envoi…'; }
    const subject = m._ctx.subject;
    const body = (document.getElementById('cm-mail-text') || {}).value || cmBody(m._ctx.lines, m._ctx.total);
    let ok = false, errMsg = '';
    try {
      const r = await fetch('/api/send-mail', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: banque.mail, subject, text: body }) });
      let j = null; try { j = await r.json(); } catch (e) {}
      ok = r.ok && (!j || j.ok !== false);
      if (!ok) errMsg = (j && (j.error || j.message)) || ('Erreur ' + r.status);
    } catch (e) { errMsg = e.message; }
    if (ok) {
      cmEnsure();
      const items = m._ctx.lines.filter(l => l.cmd > 0);
      caisse.commandesMonnaie.unshift({
        id: Date.now(), date: (typeof todayStr === 'function' ? todayStr() : new Date().toISOString().slice(0, 10)),
        operateur: (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : '?',
        lignes: items.map(l => ({ k: l.k, lbl: l.lbl, cible: l.cible, etat: l.etat, cmd: l.cmd, val: l.val })),
        total: m._ctx.total, banqueNom: banque.nom || '', banqueMail: banque.mail, mailSent: new Date().toISOString()
      });
      if (typeof schedSave === 'function') schedSave();
      cmCloseMail(); cmResetEtat(); cmRenderHist();
      cmModalInfo('Commande envoyée', 'Le mail de commande a été envoyé à ' + banque.mail + '.');
    } else {
      const foot = document.getElementById('cm-mail-foot');
      if (foot) foot.insertAdjacentHTML('afterbegin', '<div style="color:var(--red);font-size:.82rem;margin-bottom:.5rem">Échec de l\'envoi : ' + errMsg + '</div>');
      if (btn) { btn.disabled = false; btn.innerHTML = '<svg class="ico"><use href="#ic-envoyer"></use></svg> Réessayer'; }
    }
  };

  // ─── Historique ───
  function cmRenderHist() {
    const el = document.getElementById('cm-hist'); if (!el) return;
    cmEnsure();
    const list = caisse.commandesMonnaie || [];
    if (!list.length) { el.innerHTML = '<div style="font-size:.8rem;color:var(--gray-500)">Aucune commande enregistrée pour le moment.</div>'; return; }
    let h = '<div class="ch" style="margin-bottom:.5rem"><span class="ct" style="font-size:.9rem">Historique des commandes</span></div>';
    h += '<div class="twrap"><table style="width:100%;border-collapse:collapse;font-size:.83rem">';
    h += '<thead><tr><th style="text-align:left;padding:6px 8px;color:var(--gray-500);font-size:.72rem;text-transform:uppercase">Date</th><th style="text-align:left;padding:6px 8px;color:var(--gray-500);font-size:.72rem;text-transform:uppercase">Banque</th><th style="text-align:right;padding:6px 8px;color:var(--gray-500);font-size:.72rem;text-transform:uppercase">Total</th><th style="padding:6px 8px"></th></tr></thead><tbody>';
    list.slice(0, 30).forEach(c => {
      const dt = c.date ? new Date(c.date + 'T12:00:00').toLocaleDateString('fr-FR') : '';
      h += '<tr style="border-top:1px solid var(--gray-200)">'
        + '<td style="padding:6px 8px">' + dt + (c.operateur ? ' · ' + c.operateur : '') + '</td>'
        + '<td style="padding:6px 8px">' + (c.banqueNom || c.banqueMail || '') + '</td>'
        + '<td style="padding:6px 8px;text-align:right;font-weight:700">' + cmEuro(c.total || 0) + '</td>'
        + '<td style="padding:6px 8px;text-align:right"><button class="btn bs sm" onclick="cmViewCmd(' + c.id + ')">Détail</button></td>'
        + '</tr>';
    });
    h += '</tbody></table></div>';
    el.innerHTML = h;
  }
  window.cmViewCmd = function (id) {
    cmEnsure();
    const c = (caisse.commandesMonnaie || []).find(x => x.id === id); if (!c) return;
    let b = '<div style="font-size:.85rem;color:var(--gray-700);margin-bottom:.6rem">Envoyée à <strong>' + (c.banqueNom || '') + '</strong> (' + (c.banqueMail || '') + ')'
      + (c.mailSent ? ' le ' + new Date(c.mailSent).toLocaleString('fr-FR') : '') + '</div>';
    b += '<div class="twrap"><table style="width:100%;border-collapse:collapse;font-size:.84rem">';
    b += '<thead><tr><th style="text-align:left;padding:6px 8px">Devise</th><th style="text-align:center;padding:6px 8px">Cible</th><th style="text-align:center;padding:6px 8px">État</th><th style="text-align:center;padding:6px 8px">Commandé</th><th style="text-align:right;padding:6px 8px">Valeur</th></tr></thead><tbody>';
    (c.lignes || []).forEach(l => {
      b += '<tr style="border-top:1px solid var(--gray-200)"><td style="padding:6px 8px;font-weight:700">' + l.lbl + '</td><td style="text-align:center;padding:6px 8px">' + l.cible + '</td><td style="text-align:center;padding:6px 8px">' + l.etat + '</td><td style="text-align:center;padding:6px 8px;font-weight:700">' + l.cmd + '</td><td style="text-align:right;padding:6px 8px">' + cmEuro(l.val) + '</td></tr>';
    });
    b += '</tbody></table></div><div style="margin-top:.6rem;font-weight:800;text-align:right">Total : ' + cmEuro(c.total || 0) + '</div>';
    cmModalInfo('Commande du ' + (c.date ? new Date(c.date + 'T12:00:00').toLocaleDateString('fr-FR') : ''), b);
  };

  // ─── Petite modale info générique ───
  function cmModalInfo(title, html) {
    let m = document.getElementById('cm-info-modal');
    if (!m) {
      m = document.createElement('div'); m.id = 'cm-info-modal'; m.className = 'overlay';
      m.innerHTML = '<div class="mbox" style="max-width:560px"><h3 id="cm-info-title"></h3><div id="cm-info-body"></div><div style="display:flex;gap:8px;margin-top:1rem"><button class="btn bp" onclick="cmCloseInfo()">Fermer</button></div></div>';
      document.body.appendChild(m);
    }
    document.getElementById('cm-info-title').textContent = title;
    document.getElementById('cm-info-body').innerHTML = html;
    if (typeof openModal === 'function') openModal('cm-info-modal'); else m.style.display = 'flex';
  }
  window.cmCloseInfo = function () { const m = document.getElementById('cm-info-modal'); if (typeof closeModal === 'function') closeModal('cm-info-modal'); else if (m) m.style.display = 'none'; };

  // ─── Hooks : injecter au chargement, rendre à l'ouverture de la Caisse et des Sous-traitants ───
  // Ouverture / fermeture de la modale
  window.cmOpen = function () {
    cmInject();
    cmRender();
    if (typeof openModal === 'function') openModal('cm-modal');
    else { const m = document.getElementById('cm-modal'); if (m) m.classList.add('open'); }
  };
  window.cmClose = function () {
    if (typeof closeModal === 'function') closeModal('cm-modal');
    else { const m = document.getElementById('cm-modal'); if (m) m.classList.remove('open'); }
  };

  function cmInit() {
    cmInject();
    // repeupler le formulaire banque quand on ouvre l'onglet Sous-traitants
    if (typeof window.boTab === 'function') {
      const ob = window.boTab;
      window.boTab = function (t) { ob.apply(this, arguments); if (t === 'labo') { cmInject(); cmFillBanque(); } };
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', cmInit);
  else cmInit();
})();
