/* ════════════════════════════════════════════════════════════════════════════
   Module LITIGES — litiges fournisseurs et factures manquantes

   Reprend le tableau Excel « Factures / Litiges », deux onglets. Mais le
   constat qui a dicté ce module est ailleurs : à la reprise, 12 litiges sur 26
   étaient « en cours de traitement », certains depuis mars, et 14 sur 26
   n'avaient aucun montant. Un tableau enregistre ; il ne relance pas. C'est là
   que l'argent se perd.

   D'où les trois différences avec le tableau :
   - chaque dossier affiche son ÂGE depuis la dernière relance, et vire à
     l'orange puis au rouge ;
   - le commentaire unique devient un FIL DATÉ : « tel le 16 » dans une cellule
     n'est pas une chronologie ;
   - le montant est demandé à la création, avec « à chiffrer » comme réponse
     honnête — on sait alors ce qu'on ignore, au lieu de l'ignorer.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const LT_TYPES = {
    manquant:    { lbl: 'Manquant',      ico: '📦' },
    casse:       { lbl: 'Casse',         ico: '💔' },
    remise:      { lbl: 'Pb de remise',  ico: '％' },
    noncommande: { lbl: 'Non commandé',  ico: '↩' },
    autre:       { lbl: 'Autre',         ico: '•' }
  };
  // L'état dit où en est l'argent, jamais où en est la paperasse.
  const LT_ETATS = {
    encours:  { lbl: 'En cours',      col: '#B45309', bg: '#FAEEDA', ouvert: true },
    avoir:    { lbl: 'Avoir attendu', col: '#1565C0', bg: '#E3F2FD', ouvert: true },
    regle:    { lbl: 'Réglé',         col: '#0F6E56', bg: '#E1F5EE', ouvert: false },
    abandon:  { lbl: 'Abandon',       col: '#888780', bg: '#F1EFE8', ouvert: false }
  };
  const LT_FETATS = {
    manquante: { lbl: 'Manquante',    col: '#B91C1C', bg: '#FEE2E2', ouvert: true,  suite: 'demande' },
    demande:   { lbl: 'Demande faite', col: '#B45309', bg: '#FAEEDA', ouvert: true,  suite: 'recue' },
    recue:     { lbl: 'Reçue',        col: '#0F6E56', bg: '#E1F5EE', ouvert: false, suite: null }
  };

  // Seuils d'ancienneté, comptés depuis la dernière relance — ou depuis
  // l'ouverture si l'on n'a jamais relancé.
  const LT_TIEDE = 15, LT_FROID = 30;     // litiges
  const LT_FTIEDE = 10, LT_FFROID = 21;   // factures manquantes

  let ltOnglet = 'litiges';
  let ltFiltre = 'ouverts';
  let ltCherche = '';
  let ltOuvert = null;    // id du dossier affiché en détail

  // ── Utilitaires ───────────────────────────────────────────────────────────
  function ltId() { return 'lt:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function ltUser() { return (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null; }
  function ltNom() { const u = ltUser(); return u ? (u.prenom || u.nom || 'Opérateur') : 'Opérateur'; }
  function ltAdmin() { try { return typeof isAdmin === 'function' && isAdmin(ltUser()); } catch (e) { return false; } }

  // Jamais toISOString() pour une date du calendrier : à Paris, minuit local
  // bascule la veille en UTC (piège n°3 de CLAUDE.md).
  function ltAujourdhui() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function ltDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  function ltJoursDepuis(iso) {
    const d = ltDate(iso); if (!d) return null;
    return Math.floor((Date.now() - d.getTime()) / 86400e3);
  }
  function ltAffDate(iso) { const d = ltDate(iso); return d ? d.toLocaleDateString('fr-FR') : '—'; }
  function ltEuro(r) {
    if (r && r.aChiffrer) return '<span class="lt-chif">à chiffrer</span>';
    if (typeof r.montant !== 'number') return '—';
    return r.montant.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  }
  function ltEch(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  // Le repère d'ancienneté : la dernière relance, à défaut l'ouverture.
  function ltDepuis(r) {
    const rel = (r.relances || []);
    if (rel.length) return Math.floor((Date.now() - rel[rel.length - 1].ts) / 86400e3);
    return ltJoursDepuis(r.date);
  }
  function ltChaleur(r, tiede, froid) {
    const ouv = ltOnglet === 'litiges' ? (LT_ETATS[r.etat] || {}).ouvert : (LT_FETATS[r.etat] || {}).ouvert;
    if (!ouv) return '';
    const j = ltDepuis(r);
    if (j == null || j < 0) return 'douteux';
    return j >= froid ? 'froid' : (j >= tiede ? 'tiede' : '');
  }

  function ltColl() { return ltOnglet === 'litiges' ? litiges : facturesManq; }
  function ltTrouve(id) {
    return (litiges || []).find(r => r.id === id) || (facturesManq || []).find(r => r.id === id) || null;
  }
  function ltEstLitige(r) { return !!(r && LT_ETATS[r.etat]); }

  // ── Rendu ─────────────────────────────────────────────────────────────────
  function ltRender() {
    const z = document.getElementById('lt-liste'); if (!z) return;
    ltRenderStats();
    document.querySelectorAll('.lt-ong').forEach(b => b.classList.toggle('on', b.dataset.ong === ltOnglet));

    const tiede = ltOnglet === 'litiges' ? LT_TIEDE : LT_FTIEDE;
    const froid = ltOnglet === 'litiges' ? LT_FROID : LT_FFROID;
    const etats = ltOnglet === 'litiges' ? LT_ETATS : LT_FETATS;
    const q = ltCherche.toLowerCase();

    let lst = (ltColl() || []).filter(r => {
      if (ltFiltre === 'ouverts' && !(etats[r.etat] || {}).ouvert) return false;
      if (ltFiltre === 'chiffrer' && !r.aChiffrer) return false;
      if (ltFiltre === 'dormants' && ltChaleur(r, tiede, froid) === '') return false;
      if (q && !((r.labo || '') + ' ' + (r.cmd || '') + ' ' + (r.facture || '') + ' ' + (r.note || '')).toLowerCase().includes(q)) return false;
      return true;
    });
    // Les dossiers ouverts d'abord, et parmi eux les plus anciens en tête :
    // c'est l'ordre de ce qu'il faut traiter, pas l'ordre de saisie.
    lst.sort((a, b) => {
      const oa = (etats[a.etat] || {}).ouvert ? 0 : 1, ob = (etats[b.etat] || {}).ouvert ? 0 : 1;
      if (oa !== ob) return oa - ob;
      return (ltDepuis(b) || 0) - (ltDepuis(a) || 0);
    });

    if (!lst.length) {
      const vierge = !(ltColl() || []).length;
      z.innerHTML = '<div class="lt-vide">' + (vierge
        ? 'Aucun dossier enregistré.' + (ltAdmin() ? '<div style="margin-top:14px"><button class="btn bp" onclick="ltImporter()">Reprendre le tableau Excel</button></div><div class="lt-mini">26 litiges et 6 factures manquantes, repris une seule fois.</div>' : '')
        : 'Aucun dossier ne correspond à ce filtre.') + '</div>';
      return;
    }

    z.innerHTML = '<table class="lt-tbl"><thead><tr>'
      + '<th>Date</th><th>Laboratoire</th>'
      + (ltOnglet === 'litiges' ? '<th>Motif</th>' : '<th>Cde WP</th>')
      + '<th class="r">Montant</th><th>État</th><th>Depuis</th><th></th>'
      + '</tr></thead><tbody>'
      + lst.map(r => {
        const ch = ltChaleur(r, tiede, froid);
        const e = etats[r.etat] || { lbl: r.etat, col: '#888780', bg: '#F1EFE8' };
        const j = ltDepuis(r);
        const rel = (r.relances || []).length;
        return `<tr class="lt-l ${ch}" onclick="ltOuvrir('${r.id}')">
          <td class="lt-d">${ltAffDate(r.date)}</td>
          <td class="lt-labo">${ltEch(r.labo)}${r.note ? '<span class="lt-note">' + ltEch(r.note).slice(0, 70) + '</span>' : ''}</td>
          <td>${ltOnglet === 'litiges' ? ((LT_TYPES[r.type] || LT_TYPES.autre).lbl) : ltEch(r.cmd || '—')}</td>
          <td class="r">${ltEuro(r)}</td>
          <td><span class="lt-pill" style="color:${e.col};background:${e.bg}">${e.lbl}</span></td>
          <td class="lt-age">${j == null ? '—' : (j < 0 ? '<span title="Date postérieure à aujourd’hui">date ?</span>' : j + ' j')}${rel ? '<span class="lt-rel" title="' + rel + ' relance(s)">↻' + rel + '</span>' : ''}</td>
          <td class="lt-go">›</td></tr>`;
      }).join('') + '</tbody></table>';
  }

  function ltRenderStats() {
    const z = document.getElementById('lt-stats'); if (!z) return;
    const ouvL = (litiges || []).filter(r => (LT_ETATS[r.etat] || {}).ouvert);
    const ouvF = (facturesManq || []).filter(r => (LT_FETATS[r.etat] || {}).ouvert);
    const somme = ouvL.concat(ouvF).reduce((a, r) => a + (typeof r.montant === 'number' ? r.montant : 0), 0);
    const chif = ouvL.concat(ouvF).filter(r => r.aChiffrer).length;
    const dorm = ouvL.filter(r => (ltDepuis(r) || 0) >= LT_TIEDE).length
               + ouvF.filter(r => (ltDepuis(r) || 0) >= LT_FTIEDE).length;
    z.innerHTML = `
      <div class="lt-st"><div class="v">${ouvL.length + ouvF.length}</div><div class="k">dossiers ouverts</div></div>
      <div class="lt-st"><div class="v">${somme.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €</div>
        <div class="k">en jeu${chif ? ' — hors ' + chif + ' à chiffrer' : ''}</div></div>
      <div class="lt-st${dorm ? ' alerte' : ''}"><div class="v">${dorm}</div><div class="k">sans relance récente</div></div>`;
  }

  // ── Détail ────────────────────────────────────────────────────────────────
  window.ltOuvrir = function (id) {
    ltOuvert = id; const r = ltTrouve(id); if (!r) return;
    const lit = ltEstLitige(r);
    const etats = lit ? LT_ETATS : LT_FETATS;
    const c = document.getElementById('lt-det-corps');
    c.innerHTML = `
      <div class="lt-grille">
        <label>Date<input type="date" id="lt-f-date" value="${ltEch(r.date)}"></label>
        <label>Laboratoire<input id="lt-f-labo" value="${ltEch(r.labo)}"></label>
        <label>Téléphone<input id="lt-f-tel" value="${ltEch(r.tel)}"></label>
        <label>N° de facture ou BL<input id="lt-f-facture" value="${ltEch(r.facture)}"></label>
        <label>N° de commande WP<input id="lt-f-cmd" value="${ltEch(r.cmd)}"></label>
        ${lit ? `<label>Motif<select id="lt-f-type">${Object.keys(LT_TYPES).map(k =>
          `<option value="${k}"${r.type === k ? ' selected' : ''}>${LT_TYPES[k].lbl}</option>`).join('')}</select></label>` : ''}
        <label>Montant
          <div class="lt-mt">
            <input id="lt-f-montant" type="number" step="0.01" placeholder="0,00" value="${typeof r.montant === 'number' ? r.montant : ''}" ${r.aChiffrer ? 'disabled' : ''}>
            <label class="lt-cb"><input type="checkbox" id="lt-f-chiffrer" ${r.aChiffrer ? 'checked' : ''}
              onchange="document.getElementById('lt-f-montant').disabled=this.checked"> à chiffrer</label>
          </div></label>
        <label>État<select id="lt-f-etat">${Object.keys(etats).map(k =>
          `<option value="${k}"${r.etat === k ? ' selected' : ''}>${etats[k].lbl}</option>`).join('')}</select></label>
      </div>
      <label class="lt-plein">Résumé<input id="lt-f-note" value="${ltEch(r.note)}" placeholder="manque 1 colis, avoir attendu…"></label>
      <div class="lt-fil-t">Suivi du dossier</div>
      <div class="lt-fil" id="lt-fil">${ltFil(r)}</div>
      <div class="lt-ajout">
        <input id="lt-f-msg" placeholder="Appel, mail, réponse du labo…" onkeydown="if(event.key==='Enter')ltAjouterSuivi()">
        <button class="btn bs" onclick="ltAjouterSuivi()">Noter</button>
        <button class="btn bp" onclick="ltRelancer()" title="Inscrit la date du jour comme relance">J'ai relancé</button>
      </div>`;
    document.getElementById('lt-det-titre').textContent = (lit ? 'Litige — ' : 'Facture manquante — ') + (r.labo || '');
    document.getElementById('lt-supr').style.display = ltAdmin() ? '' : 'none';
    document.getElementById('lt-det').classList.add('open');
  };

  function ltFil(r) {
    const f = (r.fil || []).slice().sort((a, b) => a.ts - b.ts);
    if (!f.length) return '<div class="lt-mini">Rien de noté pour l’instant.</div>';
    return f.map(e => `<div class="lt-fl"><span class="q">${new Date(e.ts).toLocaleDateString('fr-FR')}</span>
      <span class="n">${ltEch(e.nom)}</span><span class="t">${ltEch(e.texte)}</span></div>`).join('');
  }

  window.ltFermer = function () { document.getElementById('lt-det').classList.remove('open'); ltOuvert = null; ltRender(); };

  function ltLire() {
    const v = id => { const e = document.getElementById(id); return e ? e.value.trim() : ''; };
    const chif = !!(document.getElementById('lt-f-chiffrer') || {}).checked;
    const m = parseFloat(v('lt-f-montant').replace(',', '.'));
    return {
      date: v('lt-f-date') || ltAujourdhui(), labo: v('lt-f-labo'), tel: v('lt-f-tel'),
      facture: v('lt-f-facture'), cmd: v('lt-f-cmd'), type: v('lt-f-type') || undefined,
      etat: v('lt-f-etat'), note: v('lt-f-note'),
      aChiffrer: chif, montant: chif ? null : (isFinite(m) ? Math.round(m * 100) / 100 : null)
    };
  }

  // Enregistre les champs saisis dans le dossier ouvert. Chaque mutation
  // estampille updatedAt, sans quoi la fusion multiposte la perdrait (piège n°1).
  function ltAppliquer() {
    const r = ltTrouve(ltOuvert); if (!r) return null;
    const d = ltLire();
    if (!d.labo) { alert('Le laboratoire est nécessaire.'); return null; }
    if (!d.aChiffrer && d.montant == null) { alert('Indiquez un montant, ou cochez « à chiffrer ».'); return null; }
    const avant = r.etat;
    Object.keys(d).forEach(k => { if (d[k] !== undefined) r[k] = d[k]; });
    if (avant !== r.etat) {
      r.fil = r.fil || [];
      const e = ltEstLitige(r) ? LT_ETATS : LT_FETATS;
      r.fil.push({ ts: Date.now(), nom: ltNom(), texte: '— état : ' + (e[r.etat] || {}).lbl });
    }
    r.updatedAt = Date.now();
    return r;
  }

  window.ltEnregistrer = function () {
    if (!ltAppliquer()) return;
    if (typeof saveNow === 'function') saveNow(); else schedSave();
    ltFermer();
  };

  window.ltAjouterSuivi = function () {
    const r = ltTrouve(ltOuvert); if (!r) return;
    const i = document.getElementById('lt-f-msg'); const t = i.value.trim(); if (!t) return;
    r.fil = r.fil || []; r.fil.push({ ts: Date.now(), nom: ltNom(), texte: t });
    r.updatedAt = Date.now(); i.value = '';
    document.getElementById('lt-fil').innerHTML = ltFil(r);
    if (typeof saveNow === 'function') saveNow();
  };

  window.ltRelancer = function () {
    const r = ltTrouve(ltOuvert); if (!r) return;
    r.relances = r.relances || []; r.relances.push({ ts: Date.now(), nom: ltNom() });
    r.fil = r.fil || []; r.fil.push({ ts: Date.now(), nom: ltNom(), texte: '— relance (' + r.relances.length + ')' });
    r.updatedAt = Date.now();
    document.getElementById('lt-fil').innerHTML = ltFil(r);
    if (typeof saveNow === 'function') saveNow();
    ltRender();
  };

  window.ltSupprimer = function () {
    const r = ltTrouve(ltOuvert); if (!r) return;
    if (!confirm('Supprimer définitivement ce dossier ' + (r.labo || '') + ' ?')) return;
    const lit = ltEstLitige(r);
    const arr = lit ? litiges : facturesManq;
    const i = arr.findIndex(x => x.id === r.id);
    if (i >= 0) arr.splice(i, 1);
    if (typeof saveNow === 'function') saveNow();
    ltFermer();
  };

  window.ltNouveau = function () {
    const lit = ltOnglet === 'litiges';
    const r = {
      id: ltId(), date: ltAujourdhui(), labo: '', tel: '', facture: '', cmd: '',
      montant: null, aChiffrer: true, etat: lit ? 'encours' : 'manquante',
      note: '', fil: [], relances: [], par: (ltUser() || {}).id || null,
      cree: Date.now(), updatedAt: Date.now()
    };
    if (lit) r.type = 'manquant';
    (lit ? litiges : facturesManq).push(r);
    if (typeof saveNow === 'function') saveNow();
    ltRender(); ltOuvrir(r.id);
    setTimeout(() => { const e = document.getElementById('lt-f-labo'); if (e) e.focus(); }, 60);
  };

  window.ltOngletChange = function (k) { ltOnglet = k; ltFiltre = 'ouverts'; ltRender(); ltMajFiltres(); };
  window.ltFiltreChange = function (k) { ltFiltre = k; ltRender(); ltMajFiltres(); };
  function ltMajFiltres() {
    document.querySelectorAll('.lt-fl-b').forEach(b => b.classList.toggle('on', b.dataset.f === ltFiltre));
  }
  window.ltChercher = function (v) { ltCherche = v; ltRender(); };

  // ── Reprise du tableau Excel, une seule fois ──────────────────────────────
  // Ce n'est pas une migration (piège n°7) : aucune donnée existante n'est
  // réécrite. C'est une saisie initiale, déclenchée par un humain, refusée si
  // la liste n'est pas vide.
  window.ltImporter = function () {
    if ((litiges || []).length || (facturesManq || []).length) {
      alert('La reprise ne peut se faire que sur des listes vides.'); return;
    }
    if (!confirm('Reprendre 26 litiges et 6 factures manquantes du tableau Excel ?')) return;
    const now = Date.now();
    LT_SEED_LITIGES.forEach((s, i) => litiges.push(Object.assign(
      { id: 'lt:x' + i.toString(36), tel: '', facture: '', cmd: '', montant: null, aChiffrer: false,
        note: '', fil: [], relances: [], repris: true, cree: now, updatedAt: now + i }, s)));
    LT_SEED_FACTURES.forEach((s, i) => {
      // Dans le tableau, la colonne libre servait à noter la référence reçue :
      // elle rejoint le champ « n° de facture ou BL ».
      const f = Object.assign({}, s); if (f.ref) { f.facture = f.ref; } delete f.ref;
      facturesManq.push(Object.assign(
        { id: 'lf:x' + i.toString(36), tel: '', facture: '', cmd: '', montant: null, aChiffrer: false,
          note: '', fil: [], relances: [], repris: true, cree: now, updatedAt: now + i }, f));
    });
    if (typeof saveNow === 'function') saveNow();
    ltRender();
  };

  const LT_CSS = `
  #sec-litiges{padding:0}
  .lt-wrap{padding:18px 22px 28px}
  .lt-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:16px}
  .lt-st{background:#fff;border:1px solid #e6e4dc;border-radius:12px;padding:12px 15px}
  .lt-st .v{font-size:25px;font-weight:600;color:#1a1a1a;letter-spacing:-.02em}
  .lt-st .k{font-size:11.5px;color:#888780;margin-top:2px}
  .lt-st.alerte{background:#FAEEDA;border-color:#F59E0B}
  .lt-st.alerte .v{color:#B45309}
  .lt-barre{display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap}
  .lt-ong,.lt-fl-b{border:1px solid #e6e4dc;background:#fff;border-radius:8px;padding:6px 14px;font-size:13px;
    color:#4a4a45;cursor:pointer;font-family:inherit}
  .lt-ong.on{background:#1D5C3A;border-color:#1D5C3A;color:#fff}
  .lt-fl-b.on{background:#F1EFE8;border-color:#c9c6ba;color:#1a1a1a}
  .lt-ch{border:1px solid #e6e4dc;border-radius:8px;padding:6px 11px;font-size:13px;font-family:inherit;min-width:150px}
  .lt-tbl{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e6e4dc;border-radius:12px;overflow:hidden}
  .lt-tbl th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#888780;
    font-weight:600;padding:10px 12px;border-bottom:1px solid #e6e4dc;background:#faf9f6}
  .lt-tbl th.r,.lt-tbl td.r{text-align:right}
  .lt-tbl td{padding:11px 12px;border-bottom:1px solid #f1efe8;font-size:13.5px;color:#1a1a1a;vertical-align:top}
  .lt-l{cursor:pointer}
  .lt-l:hover{background:#faf9f6}
  .lt-l.tiede{box-shadow:inset 3px 0 0 #F59E0B}
  .lt-l.froid{box-shadow:inset 3px 0 0 #C62828}
  .lt-l.douteux{box-shadow:inset 3px 0 0 #9a9a95}
  .lt-d{color:#6b7a72;white-space:nowrap}
  .lt-labo{font-weight:600}
  .lt-note{display:block;font-weight:400;font-size:11.5px;color:#888780;margin-top:2px}
  .lt-pill{display:inline-block;padding:2px 9px;border-radius:99px;font-size:11.5px;font-weight:600;white-space:nowrap}
  .lt-age{color:#6b7a72;white-space:nowrap}
  .lt-rel{margin-left:6px;color:#1565C0;font-size:11.5px}
  .lt-go{color:#c9c6ba;text-align:right;font-size:17px}
  .lt-chif{color:#B45309;font-size:12px;font-style:italic}
  .lt-vide{text-align:center;color:#888780;padding:48px 10px;font-size:14px;background:#fff;
    border:1px solid #e6e4dc;border-radius:12px}
  .lt-mini{font-size:11.5px;color:#888780;margin-top:6px}
  .lt-ov{position:fixed;inset:0;background:rgba(20,22,20,.42);display:none;align-items:center;
    justify-content:center;z-index:200;padding:18px}
  .lt-ov.open{display:flex}
  .lt-box{background:#fff;border-radius:14px;width:min(680px,100%);max-height:92vh;overflow:auto;padding:20px 22px}
  .lt-grille{display:grid;grid-template-columns:1fr 1fr;gap:11px 14px}
  .lt-box label{display:block;font-size:11.5px;color:#6b7a72;margin-bottom:9px}
  .lt-box input,.lt-box select{width:100%;border:1px solid #e6e4dc;border-radius:8px;padding:7px 10px;
    font-size:13.5px;font-family:inherit;margin-top:3px;background:#fff;color:#1a1a1a}
  .lt-box input:disabled{background:#f4f3ef;color:#9a9a95}
  .lt-plein{grid-column:1/-1}
  .lt-mt{display:flex;gap:10px;align-items:center}
  .lt-cb{display:flex;align-items:center;gap:5px;white-space:nowrap;margin:6px 0 0;color:#4a4a45;font-size:12px}
  .lt-cb input{width:auto;margin:0}
  .lt-fil-t{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#888780;font-weight:600;margin:16px 0 7px}
  .lt-fil{background:#faf9f6;border:1px solid #f1efe8;border-radius:10px;padding:10px 12px;max-height:210px;overflow:auto}
  .lt-fl{font-size:12.5px;line-height:1.6;display:flex;gap:8px}
  .lt-fl .q{color:#888780;white-space:nowrap}
  .lt-fl .n{color:#1D5C3A;font-weight:600;white-space:nowrap}
  .lt-ajout{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
  .lt-ajout input{flex:1;min-width:190px;border:1px solid #e6e4dc;border-radius:8px;padding:7px 10px;
    font-size:13.5px;font-family:inherit}
  .lt-pied{display:flex;gap:9px;margin-top:18px;align-items:center}
  @media(max-width:700px){.lt-wrap{padding:14px}.lt-grille{grid-template-columns:1fr}
    .lt-tbl td:nth-child(3),.lt-tbl th:nth-child(3){display:none}}
  `;

  const LT_SECTION = `
  <div class="lt-wrap">
    <div class="lt-stats" id="lt-stats"></div>
    <div class="lt-barre">
      <button class="lt-ong on" data-ong="litiges" onclick="ltOngletChange('litiges')">Litiges</button>
      <button class="lt-ong" data-ong="facturesManq" onclick="ltOngletChange('facturesManq')">Factures manquantes</button>
      <span style="width:14px"></span>
      <button class="lt-fl-b on" data-f="ouverts" onclick="ltFiltreChange('ouverts')">Ouverts</button>
      <button class="lt-fl-b" data-f="dormants" onclick="ltFiltreChange('dormants')">Sans relance</button>
      <button class="lt-fl-b" data-f="chiffrer" onclick="ltFiltreChange('chiffrer')">À chiffrer</button>
      <button class="lt-fl-b" data-f="tous" onclick="ltFiltreChange('tous')">Tous</button>
      <span style="flex:1"></span>
      <input class="lt-ch" placeholder="Rechercher…" oninput="ltChercher(this.value)">
      <button class="btn bp" onclick="ltNouveau()">+ Nouveau</button>
    </div>
    <div id="lt-liste"></div>
  </div>`;

  const LT_MODAL = `
  <div class="lt-ov" id="lt-det">
    <div class="lt-box">
      <h3 id="lt-det-titre">Dossier</h3>
      <div id="lt-det-corps"></div>
      <div class="lt-pied">
        <button class="btn bp" onclick="ltEnregistrer()">Enregistrer</button>
        <button class="btn bs" onclick="ltFermer()">Fermer</button>
        <span style="flex:1"></span>
        <button class="btn bs" id="lt-supr" onclick="ltSupprimer()" style="color:#C62828">Supprimer</button>
      </div>
    </div>
  </div>`;

  // ── Reprise du tableau Excel : les données telles qu'elles y figuraient ────
  // Deux dates (gsk vaccin, novo nordisk) sont postérieures à aujourd'hui dans
  // le fichier d'origine ; elles sont reprises telles quelles et signalées
  // « date ? » dans la liste plutôt que corrigées à l'aveugle.
  const LT_SEED_LITIGES = [{"date":"2026-03-18","labo":"modilac","facture":"5406254401","cmd":"156868","montant":580.86,"type":"manquant","etat":"regle","note":"1 colis refusé"},{"date":"2026-03-27","labo":"gaba","tel":"0472700310","facture":"2130610022","montant":80.14,"type":"manquant","etat":"regle","note":"non reçu"},{"date":"2026-02-06","labo":"sanofi","cmd":"154145","montant":610.97,"type":"noncommande","etat":"abandon","note":"reçu par erreur"},{"date":"2026-03-31","labo":"mkl","facture":"2000252","cmd":"158211","montant":447.92,"type":"casse","etat":"encours","note":"palette reçue abimée/ note sur bon transporteur"},{"date":"2026-03-30","labo":"directlog","tel":"0972722781","facture":"1525790","cmd":"158301","montant":276.79,"type":"manquant","etat":"encours"},{"date":"2026-04-10","labo":"Vichy","tel":"0183772301","facture":"3301237093","cmd":"146207","montant":905.9,"type":"remise","etat":"regle","note":"avoir et refacturation OK (nouv fact 3301251541)"},{"date":"2026-04-22","labo":"ineldea","facture":"90170682","cmd":"157759","montant":513.72,"type":"manquant","etat":"encours","note":"manque 5 isn fertilia"},{"date":"2026-04-22","labo":"LRP","facture":"3301418393","cmd":"156998","montant":1431.69,"type":"manquant","etat":"encours","note":"manque 1 colis"},{"date":"2025-12-31","labo":"cooper","facture":"500975607","cmd":"150058","montant":2780.94,"type":"autre","etat":"encours","note":"toujours en litige"},{"date":"2026-05-04","labo":"Pranarom","tel":"0320077515","facture":"BE02-002491718","cmd":"160949","aChiffrer":true,"type":"manquant","etat":"regle","note":"manque calmigem - 05/05 mail envoyé"},{"date":"2026-05-04","labo":"URGO","tel":"0380447121","facture":"23222156","cmd":"160973","aChiffrer":true,"type":"manquant","etat":"regle","note":"manque 12 urgoverrues - Livraison en cours"},{"date":"2026-05-04","labo":"Respire","facture":"PMO/OUT/91109 - 985002578","cmd":"160937","aChiffrer":true,"type":"manquant","etat":"regle","note":"manque stick fraîcheur - en rupture"},{"date":"2026-05-20","labo":"SVR","cmd":"159106","aChiffrer":true,"type":"remise","etat":"regle","note":"pdts mini facturés à 39% au lieu de 48% : attente avoir à 39% et refact à 48%"},{"date":"2026-06-10","labo":"Alliance","aChiffrer":true,"type":"remise","etat":"avoir","note":"suivre avoir de 4 paires de dynaven"},{"date":"2026-06-12","labo":"Eurodep / Panda Tea","facture":"FV26228394","cmd":"162128","montant":220.25,"type":"manquant","etat":"regle","note":"commande non reçue - facture reçue - litige fait par commercial chez Eurodep"},{"date":"2026-05-05","labo":"3m","facture":"9000226378","cmd":"161044","montant":198.67,"type":"manquant","etat":"encours","note":"manque 6 tegaderm"},{"date":"2026-06-16","labo":"mkl","facture":"220188","cmd":"164555","aChiffrer":true,"type":"manquant","etat":"encours","note":"manque 1 carton de lingette"},{"date":"2026-07-06","labo":"Eurodep / Panda Tea","tel":"0160948585","facture":"FV26288384","cmd":"162128","montant":284.78,"type":"remise","etat":"regle","note":"reclamation car remise manquante sur deux lignes"},{"date":"2026-07-16","labo":"directlog","facture":"bl 8276573","cmd":"167480","aChiffrer":true,"type":"manquant","etat":"encours","note":"tel le 16"},{"date":"2026-07-17","labo":"La rosee","facture":"1E10054615","aChiffrer":true,"type":"casse","etat":"encours","note":"mail envoyé le 17/07/26"},{"date":"2026-07-21","labo":"Expanscience","facture":"012978941","cmd":"167592","aChiffrer":true,"type":"remise","etat":"regle","note":"mail envoyé pr demande refacturation à 24% des solaires au lieu de19%"},{"date":"2026-07-22","labo":"gilbert","tel":"0231471503","facture":"3633237","cmd":"167997","aChiffrer":true,"type":"manquant","etat":"encours","note":"manque 1 colis litige ouvert avec transporteur"},{"date":"2026-07-22","labo":"sanofi","cmd":"168400","aChiffrer":true,"type":"casse","etat":"encours","note":"1 colis refusé"},{"date":"2026-07-22","labo":"uriage","tel":"0892052828","facture":"5075411363","cmd":"167803","aChiffrer":true,"type":"manquant","etat":"encours","note":"manque 1 colis reçu a la place un colis super u  appel noyon sans réponse - 04/09 : appel uriage, demande un passage transporteur pour reprendre le colis qui ne nous était pas destiné et demande de recherche du colis manquant, sinon relivraison"},{"date":"2026-08-03","labo":"thuasne","facture":"58530891","aChiffrer":true,"type":"autre","etat":"avoir","note":"attente avoir 4 paires"},{"date":"2026-08-31","labo":"mayoly","tel":"0177937200","facture":"69372700","cmd":"162121","aChiffrer":true,"type":"manquant","etat":"encours","note":"manque 3 smectalia"}];
  const LT_SEED_FACTURES = [{"date":"2026-12-01","cmd":"146678","labo":"gsk vaccin","montant":175.18,"etat":"demande","ref":"2130635251"},{"date":"2026-10-10","cmd":"142833","labo":"novo nordisk","montant":35.0,"etat":"demande","ref":"36466290"},{"date":"2026-06-05","cmd":"164248","labo":"movianto","montant":48.13,"etat":"manquante"},{"date":"2026-06-11","cmd":"164226","labo":"laphal","montant":100.55,"etat":"demande","ref":"liv2515762"},{"date":"2026-04-07","cmd":"158945","labo":"viatris","montant":8.38,"etat":"manquante"},{"date":"2026-06-12","cmd":"164653","labo":"viatris","montant":45.72,"etat":"manquante"}];

  // ── Injection ─────────────────────────────────────────────────────────────
  function ltInject() {
    if (document.getElementById('lt-css')) return;
    const st = document.createElement('style'); st.id = 'lt-css'; st.textContent = LT_CSS;
    document.head.appendChild(st);

    const navRef = document.querySelector('.sb-item[data-sec="backoffice"]');
    if (navRef && !document.querySelector('.sb-item[data-sec="litiges"]')) {
      const b = document.createElement('button');
      b.className = 'sb-item'; b.setAttribute('data-sec', 'litiges');
      b.setAttribute('onclick', "showSec('litiges',this); if(window.ltRender) ltRender();");
      b.innerHTML = '<svg class="ico sb-ico"><use href="#ic-devis"></use></svg>'
        + '<span class="sb-label">Litiges</span><span class="sb-badge" id="navb-lt"></span>';
      navRef.insertAdjacentElement('beforebegin', b);
    }
    const secRef = document.getElementById('sec-livraisons');
    if (secRef && !document.getElementById('sec-litiges')) {
      const sec = document.createElement('section');
      sec.id = 'sec-litiges'; sec.className = 'sec'; sec.innerHTML = LT_SECTION;
      secRef.parentNode.appendChild(sec);
      const w = document.createElement('div'); w.innerHTML = LT_MODAL;
      while (w.firstElementChild) document.body.appendChild(w.firstElementChild);
      const ov = document.getElementById('lt-det');
      if (ov) ov.addEventListener('click', e => { if (e.target === ov) ltFermer(); });
      ltRender();
    }
  }

  window.ltRender = ltRender;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ltInject);
  else ltInject();
  setTimeout(function () { try { ltInject(); ltRender(); } catch (e) {} }, 600);
})();
