/* ════════════════════════════════════════════════════════════════
   Module RENOUVELLEMENT — préparation anticipée des ordonnances
   Intégré à l'intranet Pharmacie du Centre. Isolé (préfixe rn / rn-)
   pour ne rien casser dans l'existant.
   Réutilise : patients + acPatient/upsertPatient (annuaire),
   currentUser (préparateur connecté), deliveries (bascule livraison),
   /api/send-mail (email patient via Brevo), saveAll (persistance).
   Données : globales renouvellements[] et renouvArchives[] (rubriques).
   ════════════════════════════════════════════════════════════════ */
(function () {
  // ---------- utilitaires ----------
  // Date CALENDAIRE locale. Surtout pas toISOString() : celui-ci convertit en UTC,
  // or rnToday() renvoie minuit HEURE DE PARIS — soit 22 h (ou 23 h l'hiver) la VEILLE
  // en UTC. La date produite reculait donc d'un jour, et la livraison créée depuis un
  // renouvellement était datée d'hier : invisible dans le module Livraisons, qui filtre
  // sur le jour affiché.
  function rnIso(d) { const p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
  function rnToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  function rnAddDays(base, n) { const d = new Date(base); d.setDate(d.getDate() + n); return d; }
  function rnFmtFr(iso) { if (!iso) return ''; const p = String(iso).slice(0, 10).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : iso; }
  const RN_SOON_DAYS = 7;   // fenêtre « à préparer » avant la date prévue
  function rnDayDiff(iso) { const d = new Date(String(iso).slice(0, 10) + 'T12:00'); d.setHours(0, 0, 0, 0); return Math.round((d - rnToday()) / 86400000); }
  function rnEsc(s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  window.rnOpen = function (id) { document.getElementById(id).classList.add('rn-on'); };
  window.rnClose = function (id) { document.getElementById(id).classList.remove('rn-on'); };
  function rnToast(msg) { let t = document.getElementById('rn-toast'); t.textContent = msg; t.classList.add('rn-on'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('rn-on'), 2600); }
  function rnUser() { return (typeof currentUser !== 'undefined' && currentUser) ? currentUser : { id: '?', prenom: '', nom: '', col: '#777' }; }
  function rnList() { if (typeof renouvellements === 'undefined' || !Array.isArray(renouvellements)) window.renouvellements = []; return renouvellements; }
  function rnArch() { if (typeof renouvArchives === 'undefined' || !Array.isArray(renouvArchives)) window.renouvArchives = []; return renouvArchives; }
  function rnPersist() { try { if (typeof schedSave === 'function') schedSave(); else if (typeof saveAll === 'function') saveAll(); } catch (e) { console.warn('rn save', e); } }

  let rnView = 'todo';
  let rnCurId = null, rnEditId = null, rnPendingNext = null, rnNextId = 1;
  function rnNewId() { const arr = rnList().concat(rnArch()); let max = 0; arr.forEach(x => { if (x.id > max) max = x.id; }); return Math.max(max, rnNextId++) + 1; }

  // ---------- CSS (scopé rn-) ----------
  const RN_CSS = `
  #sec-renouvellement{padding:0}
  .rn-wrap{max-width:1060px;margin:0 auto}
  .rn-bar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:16px}
  .rn-count{font-size:13px;color:#6b7a72}
  .rn-grow{flex:1}
  .rn-tabnb{display:inline-block;min-width:17px;padding:0 5px;margin-left:4px;border-radius:9px;
    background:#B23A2F;color:#fff;font-size:11px;font-weight:800;line-height:17px;text-align:center}
  .rn-b-okpat{background:#E8F5E9;color:#2E7D32}
  .rn-b-reppat{background:#E3F2FD;color:#1565C0}
  .rn-b-stoppat{background:#FBE9E7;color:#B23A2F}
  .rn-b-attpat{background:#F3F1EC;color:#7a6f5d}
  .rn-tabs{display:inline-flex;background:#e7efe9;border-radius:9px;padding:3px}
  .rn-tab{border:none;background:none;padding:6px 12px;border-radius:7px;font-size:13px;font-weight:600;color:#4a5a52;cursor:pointer}
  .rn-tab.rn-act{background:#fff;color:#1D5C3A;box-shadow:0 1px 2px rgba(0,0,0,.08)}
  .rn-btn{border:none;border-radius:9px;padding:9px 14px;font-size:13.5px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
  .rn-btn.rn-pri{background:#1D5C3A;color:#fff}
  .rn-btn.rn-blue{background:#1565C0;color:#fff}
  .rn-btn.rn-amber{background:#E65100;color:#fff}
  .rn-btn.rn-ghost{background:#fff;border:1px solid #dfe8e2;color:#222}
  .rn-btn.rn-mini{padding:6px 10px;font-size:12.5px}
  .rn-inp{font-family:inherit;font-size:14px;border:1px solid #dfe8e2;border-radius:9px;outline:none;background:#fff;width:100%;color:#222}
  input.rn-inp,select.rn-inp{height:42px;padding:0 12px}
  textarea.rn-inp{padding:9px 12px;min-height:60px;resize:vertical}
  .rn-inp:focus{border-color:#1D5C3A}
  .rn-search{max-width:210px}
  .rn-daygroup{margin-bottom:16px}
  .rn-dayhead{display:flex;align-items:center;gap:10px;margin:6px 2px 8px}
  .rn-dayhead .rn-d{font-weight:700;font-size:14px}
  .rn-taglbl{font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px}
  .rn-t-retard{background:#FDECEC;color:#c62828}
  .rn-t-jour{background:#E8F5E9;color:#2E7D32}
  .rn-t-avenir{background:#E3F2FD;color:#1565C0}
  .rn-card{background:#fff;border:1px solid #e2ebe5;border-radius:12px;padding:9px 12px;margin-bottom:6px;display:flex;gap:12px;align-items:center;box-shadow:0 1px 2px rgba(0,0,0,.03)}
  .rn-card.rn-retard{border-left:4px solid #c62828}
  .rn-card.rn-jour{border-left:4px solid #2E7D32}
  .rn-card.rn-avenir{border-left:4px solid #1565C0}
  .rn-card .rn-main{flex:1;min-width:0}
  .rn-who{font-weight:700;font-size:15px}
  .rn-who .rn-dob{font-weight:400;color:#6b7a72;font-size:12.5px;margin-left:6px}
  .rn-lib{font-size:13.5px;font-weight:400;color:#37474F;margin-left:10px;padding-left:10px;border-left:1px solid #dfe8e2}
  .rn-meta{font-size:12.5px;color:#6b7a72;display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-top:3px}
  .rn-badge{font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px;display:inline-block}
  .rn-b-liv{background:#EDE7F6;color:#5E35B1}.rn-b-comp{background:#E0F2F1;color:#00695C}
  .rn-b-last{background:#FFF3E0;color:#E65100}.rn-b-frigo{background:#E1F5FE;color:#0277BD}
  .rn-b-newordo{background:#FFEBEE;color:#c62828}
  .rn-b-due{background:#C62828;color:#fff;box-shadow:0 0 0 2px rgba(198,40,40,.14)}
  .rn-b-soon{background:#EF6C00;color:#fff;box-shadow:0 0 0 2px rgba(239,108,0,.13)}
  .rn-chip{color:#fff;font-size:11px;font-weight:700;padding:2px 9px;border-radius:20px;display:inline-block}
  .rn-acts{display:flex;flex-direction:row;gap:5px;align-items:flex-start;flex:none}
  /* Boutons réduits à leur icône : une ligne d'ordonnance tient sur trois lignes
     de texte au lieu de cinq boutons empilés. Le libellé reste au survol (title). */
  .rn-ib{width:32px;height:32px;padding:0;border:1px solid #dfe8e2;background:#fff;border-radius:9px;
    font-size:15px;line-height:1;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}
  .rn-ib:hover{border-color:#1D5C3A;background:#f6faf8}
  .rn-ib.rn-ib-pri{background:#1D5C3A;border-color:#1D5C3A;color:#fff}
  .rn-ib.rn-ib-pri:hover{background:#164a2e}
  .rn-ib.rn-ib-del:hover{border-color:#c62828;background:#fdf1f1}
  .rn-ib.rn-ib-on{border-color:#a5d6a7;background:#e8f5e9}
  .rn-ib.rn-ib-att{border-color:#e0d7c3;background:#faf7f0}
  .rn-empty{color:#6b7a72;text-align:center;padding:40px;background:#fff;border:1px dashed #dfe8e2;border-radius:12px}
  .rn-ov{position:fixed;inset:0;background:rgba(0,0,0,.42);display:none;align-items:center;justify-content:center;padding:16px;z-index:10000}
  .rn-ov.rn-on{display:flex}
  .rn-modal{background:#fff;border-radius:14px;max-width:560px;width:100%;max-height:92vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.3)}
  .rn-modal h3{margin:0;padding:16px 18px;border-bottom:1px solid #e2ebe5;font-size:16px;color:#1D5C3A}
  .rn-body{padding:16px 18px}.rn-foot{padding:12px 18px;border-top:1px solid #e2ebe5;display:flex;justify-content:flex-end;gap:9px;background:#fafcfb;flex-wrap:wrap}
  .rn-fg{margin-bottom:13px;position:relative}
  .rn-fg label{display:block;font-size:12.5px;font-weight:600;color:#44524b;margin-bottom:5px;min-height:16px;line-height:1.3}
  .rn-req{color:#c62828}
  .rn-row2{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:end}
  .rn-hint{font-size:12px;color:#6b7a72;margin-top:4px}
  .rn-mailbox{white-space:pre-wrap;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px;background:#f6f8f7;border:1px solid #e2ebe5;border-radius:9px;padding:12px;max-height:240px;overflow:auto}
  .rn-note{background:#FFF3E0;border:1px solid #ffcc80;color:#8a4b00;border-radius:9px;padding:10px 12px;font-size:13px;margin-top:8px}
  .rn-chk{display:flex;align-items:flex-start;gap:8px}.rn-chk input{width:auto;height:auto;margin-top:3px}
  .rn-drop{position:absolute;left:0;right:0;top:100%;background:#fff;border:1px solid #dfe8e2;border-top:none;border-radius:0 0 9px 9px;box-shadow:0 8px 20px rgba(0,0,0,.12);z-index:5;display:none;max-height:220px;overflow:auto}
  .rn-drop .ac-item{padding:8px 12px;cursor:pointer;border-bottom:1px solid #eef3f0;display:flex;flex-direction:column}
  .rn-drop .ac-item:hover{background:#f2f6f3}
  .rn-toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#222;color:#fff;padding:11px 18px;border-radius:10px;font-size:13.5px;opacity:0;transition:opacity .25s;z-index:10001;pointer-events:none}
  .rn-toast.rn-on{opacity:1}
  `;

  // ---------- gabarits HTML ----------
  const RN_SECTION = `
  <div class="rn-wrap">
    <div class="rn-bar">
      <button class="rn-btn rn-pri" onclick="rnOpenForm()">＋ Nouvelle ordonnance</button>
      <div class="rn-tabs">
        <button class="rn-tab rn-act" id="rn-tab-todo" onclick="rnSetView('todo')">À préparer</button>
        <button class="rn-tab" id="rn-tab-all" onclick="rnSetView('all')">Programmés</button>
        <button class="rn-tab" id="rn-tab-check" onclick="rnSetView('check')">À vérifier</button>
        <button class="rn-tab" id="rn-tab-arch" onclick="rnSetView('arch')">Archives</button>
      </div>
      <span class="rn-count" id="rn-count"></span>
      <span class="rn-grow"></span>
      <input class="rn-inp rn-search" id="rn-search" placeholder="Rechercher un patient…" oninput="rnRender()">
    </div>
    <div id="rn-listwrap"></div>
  </div>`;

  const RN_MODALS = `
  <div class="rn-ov" id="rn-ov-form"><div class="rn-modal">
    <h3 id="rn-form-title">Nouvelle ordonnance à préparer</h3>
    <div class="rn-body">
      <div class="rn-row2">
        <div class="rn-fg"><label>Nom <span class="rn-req">*</span></label>
          <input class="rn-inp" id="rn-nom" autocomplete="off" placeholder="NOM"
            oninput="acPatient('rn-nom','rn-prenom','rn-dob','rn-drop','rn-tel','rn-mail','rn-adresse','')">
          <div class="rn-drop" id="rn-drop"></div></div>
        <div class="rn-fg"><label>Prénom <span class="rn-req">*</span></label><input class="rn-inp" id="rn-prenom" placeholder="Prénom"></div>
      </div>
      <div class="rn-row2">
        <div class="rn-fg"><label>Date de naissance <span class="rn-req">*</span></label><input class="rn-inp" id="rn-dob" type="date"></div>
        <div class="rn-fg"><label>Téléphone</label><input class="rn-inp" id="rn-tel" placeholder="06 …"></div>
      </div>
      <div class="rn-row2">
        <div class="rn-fg"><label>Email patient (pour « c'est prêt »)</label><input class="rn-inp" id="rn-mail" type="email" placeholder="facultatif"></div>
        <div class="rn-fg"><label>Adresse</label><input class="rn-inp" id="rn-adresse" placeholder="N° et rue"></div>
      </div>
      <div class="rn-fg"><label>Ce qu'il faut renouveler <span class="rn-req">*</span></label>
        <textarea class="rn-inp" id="rn-lib" rows="2" placeholder="Ex. : pilulier 28 j — traitement de fond + CNO"></textarea></div>
      <div class="rn-row2">
        <div class="rn-fg"><label>Date de prochaine préparation <span class="rn-req">*</span></label><input class="rn-inp" id="rn-date" type="date"></div>
        <div class="rn-fg"><label>Cycle (jours)</label><input class="rn-inp" id="rn-cycle" type="number" value="28" min="1"></div>
      </div>
      <div class="rn-row2">
        <div class="rn-fg"><label>Prescripteur</label><input class="rn-inp" id="rn-presc" placeholder="Dr …"></div>
        <div class="rn-fg"><label>Remise</label><select class="rn-inp" id="rn-remise"><option value="comptoir">Retrait au comptoir</option><option value="livraison">Livraison</option></select></div>
      </div>
      <div class="rn-fg"><label>Notes</label><input class="rn-inp" id="rn-notes" placeholder="Ex. : frigo, appeler avant…"></div>
      <div class="rn-fg rn-chk"><input type="checkbox" id="rn-flast"><label style="margin:0" for="rn-flast">Dernier renouvellement possible (une nouvelle ordonnance sera à fournir avant le prochain renouvellement)</label></div>
    </div>
    <div class="rn-foot"><button class="rn-btn rn-ghost" onclick="rnClose('rn-ov-form')">Annuler</button><button class="rn-btn rn-pri" onclick="rnSaveForm()">Enregistrer</button></div>
  </div></div>

  <div class="rn-ov" id="rn-ov-prep"><div class="rn-modal">
    <h3>Préparation de l'ordonnance</h3>
    <div class="rn-body">
      <div id="rn-prep-who" style="font-weight:700"></div>
      <div id="rn-prep-lib" style="font-size:13px;color:#6b7a72;margin-bottom:4px"></div>
      <div id="rn-prep-remise" style="font-size:12px;margin-bottom:14px"></div>
      <div id="rn-prep-next" class="rn-fg"><label>Date de prochain renouvellement <span style="color:#6b7a72;font-weight:400">(modifiable)</span></label>
        <input class="rn-inp" id="rn-prep-date" type="date"><div class="rn-hint">Proposée : jour de préparation + cycle. Modifiable.</div></div>
      <div class="rn-fg rn-chk"><input type="checkbox" id="rn-prep-last" onchange="rnPrepExcl('last')"><label style="margin:0" for="rn-prep-last">Dernier renouvellement possible <span style="color:#6b7a72;font-weight:400">— on conserve et reprogramme ; nouvelle ordonnance à fournir</span></label></div>
      <div class="rn-fg rn-chk"><input type="checkbox" id="rn-prep-nomore" onchange="rnPrepExcl('nomore')"><label style="margin:0" for="rn-prep-nomore">Plus de renouvellement après cette préparation <span style="color:#6b7a72;font-weight:400">— clôturer (fin du traitement)</span></label></div>
      <div id="rn-prep-note" class="rn-note" style="display:none"></div>
    </div>
    <div class="rn-foot" id="rn-prep-foot" style="flex-wrap:wrap;gap:9px"></div>
  </div></div>

  <div class="rn-ov" id="rn-ov-notify"><div class="rn-modal">
    <h3>Prévenir le patient <span style="font-weight:400;font-size:13px;color:#6b7a72">— facultatif</span></h3>
    <div class="rn-body">
      <div id="rn-notify-done" class="rn-note" style="display:block;background:#E9F5EE;border-color:#C7E4D4;color:#1D5C3A"></div>
      <div id="rn-notify-who" style="font-weight:700;margin-top:12px"></div>
      <div id="rn-notify-contact" style="font-size:13px;color:#6b7a72;margin:7px 0 15px;line-height:1.5"></div>
      <div style="display:flex;flex-direction:column;gap:9px">
        <button class="rn-btn rn-pri" id="rn-notify-mail" onclick="rnNotifyMail()">✉️ Par email</button>
        <button class="rn-btn rn-blue" id="rn-notify-sms" onclick="rnNotifySms()">💬 Par SMS</button>
      </div>
      <div class="rn-hint" style="margin-top:13px">L'ordonnance est déjà validée et reprogrammée : prévenir le patient ne change plus rien au dossier.</div>
    </div>
    <div class="rn-foot">
      <button class="rn-btn rn-ghost" onclick="rnNotifyNone()">Fermer sans prévenir</button>
    </div>
  </div></div>

  <div class="rn-ov" id="rn-ov-mail"><div class="rn-modal">
    <h3>Email au patient — aperçu</h3>
    <div class="rn-body">
      <div id="rn-mail-nomail" style="display:none">
        <div class="rn-fg"><label>Ce patient n'a pas d'email. Saisir une adresse (enregistrée dans sa fiche) :</label><input class="rn-inp" id="rn-mail-new" type="email" placeholder="prenom.nom@email.fr"></div>
        <div style="display:flex;gap:9px;justify-content:flex-end;margin-bottom:8px">
          <button class="rn-btn rn-ghost" onclick="rnSkipMail()">Pas de mail</button>
          <button class="rn-btn rn-blue" onclick="rnUseNewMail()">Utiliser cet email</button></div>
        <hr style="border:none;border-top:1px solid #e2ebe5">
      </div>
      <div id="rn-mail-preview"><div class="rn-mailbox" id="rn-mail-body"></div></div>
    </div>
    <div class="rn-foot" id="rn-mail-foot">
      <button class="rn-btn rn-ghost" onclick="rnClose('rn-ov-mail')">Ne pas envoyer</button>
      <button class="rn-btn rn-pri" id="rn-mail-send" onclick="rnConfirmSend()">Confirmer l'envoi</button>
    </div>
  </div></div>

  <div class="rn-ov" id="rn-ov-liv"><div class="rn-modal">
    <h3>Nouvelle livraison (pré-remplie)</h3>
    <div class="rn-body">
      <div class="rn-row2"><div class="rn-fg"><label>Patient</label><input class="rn-inp" id="rn-l-nom" readonly></div>
        <div class="rn-fg"><label>Téléphone</label><input class="rn-inp" id="rn-l-tel"></div></div>
      <div class="rn-fg"><label>Adresse</label><input class="rn-inp" id="rn-l-adr" placeholder="N° et rue"></div>
      <div class="rn-row2"><div class="rn-fg"><label>Lieu</label><select class="rn-inp" id="rn-l-lieu"><option>Domicile</option><option>EHPAD</option><option>IDE</option></select></div>
        <div class="rn-fg"><label>Montant (€)</label><input class="rn-inp" id="rn-l-montant" type="number" value="0"></div></div>
      <div class="rn-fg rn-chk"><input type="checkbox" id="rn-l-frigo"><label style="margin:0" for="rn-l-frigo">Produit au frigo</label></div>
      <div class="rn-fg"><label>Notes</label><input class="rn-inp" id="rn-l-notes"></div>
      <div class="rn-hint">À la validation, l'ordonnance part dans le module Livraisons à l'état « préparé ».</div>
    </div>
    <div class="rn-foot"><button class="rn-btn rn-ghost" onclick="rnClose('rn-ov-liv')">Annuler</button><button class="rn-btn rn-blue" onclick="rnConfirmLiv()">Envoyer en livraison</button></div>
  </div></div>

  <div class="rn-ov" id="rn-ov-report"><div class="rn-modal">
    <h3>Reporter / Annuler l'ordonnance</h3>
    <div class="rn-body">
      <div id="rn-rep-who" style="font-weight:700;margin-bottom:12px"></div>
      <div class="rn-fg"><label>Nouvelle date de préparation</label><input class="rn-inp" id="rn-rep-date" type="date"></div>
      <div class="rn-fg"><label>Motif (facultatif)</label><input class="rn-inp" id="rn-rep-motif" placeholder="Ex. : le patient a encore des boîtes"></div>
    </div>
    <div class="rn-foot" style="justify-content:space-between;flex-wrap:wrap;gap:9px">
      <button class="rn-btn rn-ghost" style="color:#c62828;border-color:#f0cccc" onclick="rnCancelOrdo()">🗑 Annuler l'ordonnance</button>
      <span style="display:flex;gap:9px;justify-content:flex-end"><button class="rn-btn rn-ghost" onclick="rnClose('rn-ov-report')">Fermer</button><button class="rn-btn rn-amber" onclick="rnConfirmReport()">📅 Reporter</button></span>
    </div>
  </div></div>

  <div class="rn-toast" id="rn-toast"></div>`;

  // ---------- injection dans le DOM ----------
  function rnInject() {
    if (document.getElementById('rn-css')) return;
    const st = document.createElement('style'); st.id = 'rn-css'; st.textContent = RN_CSS; document.head.appendChild(st);
    // bouton de navigation (après Livraisons)
    const navRef = document.querySelector('.sb-item[data-sec="preparations"]') || document.querySelector('.sb-item[data-sec="livraisons"]');
    if (navRef && !document.querySelector('.sb-item[data-sec="renouvellement"]')) {
      const b = document.createElement('button');
      b.className = 'sb-item'; b.setAttribute('data-sec', 'renouvellement');
      b.setAttribute('onclick', "showSec('renouvellement',this)");
      b.innerHTML = '<svg class="ico sb-ico"><use href="#ic-renouvellement"></use></svg><span class="sb-label">Renouvellement</span><span class="sb-badge" id="navb-rn" title="Ordonnances \u00e0 pr\u00e9parer"></span>';
      navRef.insertAdjacentElement('afterend', b);
    }
    // section
    const secRef = document.getElementById('sec-livraisons');
    if (secRef && !document.getElementById('sec-renouvellement')) {
      const sec = document.createElement('section');
      sec.id = 'sec-renouvellement'; sec.className = 'sec'; sec.innerHTML = RN_SECTION;
      secRef.parentNode.appendChild(sec);
    }
    // modales
    if (!document.getElementById('rn-ov-form')) document.body.insertAdjacentHTML('beforeend', RN_MODALS);
  }

  // ---------- rendu ----------
  window.rnSetView = function (v) {
    rnView = v;
    document.getElementById('rn-tab-todo').classList.toggle('rn-act', v === 'todo');
    document.getElementById('rn-tab-all').classList.toggle('rn-act', v === 'all');
    document.getElementById('rn-tab-check').classList.toggle('rn-act', v === 'check');
    document.getElementById('rn-tab-arch').classList.toggle('rn-act', v === 'arch');
    rnRender();
  };
  // Une ordonnance passe « à préparer » 7 jours avant la date prévue.
  // Compteur = tout ce qui est à préparer (retards inclus).
  window.rnDueCount = function () {
    try { return rnList().filter(it => !it.pause && rnDayDiff(it.date) <= RN_SOON_DAYS).length; } catch (e) { return 0; }
  };
  // Niveau d'urgence de la pastille : 'red' dès qu'une ordonnance est due ou en retard,
  // 'orange' si tout tombe dans les 7 jours à venir, '' s'il n'y a rien à préparer.
  window.rnDueLevel = function () {
    try {
      const l = rnList().filter(it => !it.pause);
      if (l.some(it => rnDayDiff(it.date) <= 0)) return 'red';
      if (l.some(it => rnDayDiff(it.date) <= RN_SOON_DAYS)) return 'orange';
      return '';
    } catch (e) { return ''; }
  };
  window.rnRender = function () {
    rnInject();
    if (typeof window.updateNavBadges === 'function') window.updateNavBadges();
    rnMajOngletCheck();
    if (rnView === 'arch') return rnRenderArch();
    if (rnView === 'check') return rnRenderCheck();
    if (rnView === 'all') return rnRenderAll();
    const q = (document.getElementById('rn-search').value || '').trim().toLowerCase();
    const visible = rnList()
      .filter(it => !it.pause)                 // arrêt demandé par le patient : passé en « à vérifier »
      .filter(it => rnDayDiff(it.date) <= 7)
      .filter(it => !q || (it.nom + ' ' + it.prenom).toLowerCase().includes(q))
      .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
    document.getElementById('rn-count').textContent = visible.length ? visible.length + ' ordonnance' + (visible.length > 1 ? 's' : '') + ' à préparer (7 jours)' : '';
    const wrap = document.getElementById('rn-listwrap');
    if (!visible.length) { wrap.innerHTML = '<div class="rn-empty">Aucune ordonnance à préparer dans les 7 prochains jours.</div>'; return; }
    let html = '', last = null;
    for (const it of visible) {
      if (it.date !== last) {
        last = it.date; const diff = rnDayDiff(it.date);
        const cls = diff < 0 ? 'retard' : diff === 0 ? 'jour' : 'avenir';
        const lbl = diff < 0 ? 'En retard' : diff === 0 ? "Aujourd'hui" : 'Dans ' + diff + ' j';
        html += '<div class="rn-daygroup"><div class="rn-dayhead"><span class="rn-d">' + rnFmtFr(it.date) + '</span><span class="rn-taglbl rn-t-' + cls + '">' + lbl + '</span></div>';
      }
      html += rnCard(it);
    }
    html += '</div>';
    wrap.innerHTML = html;
  };
  function rnBadges(it) {
    const _d = rnDayDiff(it.date);
    const _tag = _d < 0 ? '<span class="rn-badge rn-b-due">\u25CF En retard \u2014 \u00e0 pr\u00e9parer</span> '
      : _d === 0 ? '<span class="rn-badge rn-b-due">\u25CF \u00c0 pr\u00e9parer aujourd\'hui</span> '
      : _d <= RN_SOON_DAYS ? '<span class="rn-badge rn-b-soon">\u25CF \u00c0 pr\u00e9parer \u2014 dans ' + _d + ' j</span> ' : '';
    return _tag +
      (it.remise === 'livraison' ? '<span class="rn-badge rn-b-liv">Livraison</span>' : '<span class="rn-badge rn-b-comp">Comptoir</span>') +
      (it.needsNewOrdo ? ' <span class="rn-badge rn-b-newordo">Nouvelle ordo à fournir</span>' : '') +
      (it.dernier && !it.needsNewOrdo ? ' <span class="rn-badge rn-b-last">Dernier renouv.</span>' : '') +
      (/frigo/i.test(it.notes || '') ? ' <span class="rn-badge rn-b-frigo">Frigo</span>' : '') +
      rnConfBadge(it);
  }
  // ---------- confirmation du patient par SMS ----------
  // Le patient reçoit un lien personnel ; sa réponse est appliquée par le serveur
  // (confirmation, report à la date choisie, ou mise en pause s'il n'a plus besoin
  // du traitement). Ici on ne fait qu'AFFICHER où en est la demande.
  function rnConfBadge(it) {
    const c = it.conf; if (!c) return '';
    if (c.choix === 'confirme') return ' <span class="rn-badge rn-b-okpat">✓ Confirmé par le patient</span>';
    if (c.choix === 'reporte') return ' <span class="rn-badge rn-b-reppat">📅 Reporté par le patient au ' + rnFmtFr(c.dateChoisie) + '</span>';
    if (c.choix === 'arret') return ' <span class="rn-badge rn-b-stoppat">✕ Arrêt demandé par le patient</span>';
    if (c.sentAt) return ' <span class="rn-badge rn-b-attpat">⧗ Demande envoyée le ' + rnFmtFr(c.sentAt.slice(0, 10)) + ' — sans réponse</span>';
    return '';
  }
  function rnMainHtml(it) {
    return '<div class="rn-who">' + rnEsc(it.nom) + ' ' + rnEsc(it.prenom) + '<span class="rn-dob">' + rnFmtFr(it.dob) + '</span>'
      + (it.lib ? '<span class="rn-lib">' + rnEsc(it.lib) + '</span>' : '') + '</div>' +
      '<div class="rn-meta">' + (it.presc ? '<span>👨‍⚕️ ' + rnEsc(it.presc) + '</span>' : '') + (it.tel ? '<span>📞 ' + rnEsc(it.tel) + '</span>' : '') + (it.notes ? '<span>📝 ' + rnEsc(it.notes) + '</span>' : '') + '<span>' + rnBadges(it) + '</span></div>';
  }
  // Fabrique un bouton réduit à son icône. Le libellé n'est pas perdu : il
  // s'affiche au survol, et l'icône seule suffit dès qu'on a fait le geste deux fois.
  function rnIb(fn, it, ico, titre, cls) {
    return '<button class="rn-ib' + (cls ? ' ' + cls : '') + '" title="' + rnEsc(titre)
      + '" onclick="' + fn + '(' + it.id + ')">' + ico + '</button>';
  }
  // Demande de confirmation : l'état se lit à la couleur du bouton — vert quand le
  // patient a répondu, sable quand on attend encore.
  function rnIbConf(it) {
    const c = it.conf;
    const cls = (c && c.choix) ? 'rn-ib-on' : (c && c.sentAt) ? 'rn-ib-att' : '';
    const t = (c && c.choix) ? 'Le patient a répondu — sa décision est définitive'
      : (c && c.sentAt) ? 'Demande envoyée le ' + rnFmtFr(c.sentAt.slice(0, 10)) + ' — sans réponse'
        : 'Demander confirmation au patient (SMS)';
    return rnIb('rnDemandeConf', it, '\u2709', t, cls);
  }
  function rnIbLien(it) {
    if (!it.conf || !it.conf.token) return '';
    return rnIb('rnVoirLien', it, '\uD83D\uDD17', 'Ouvrir la page que voit le patient — sans envoyer de SMS');
  }

  function rnCard(it) {
    const diff = rnDayDiff(it.date); const cls = diff < 0 ? 'retard' : diff === 0 ? 'jour' : 'avenir';
    return '<div class="rn-card rn-' + cls + '"><div class="rn-main">' + rnMainHtml(it) +
      '</div><div class="rn-acts">' +
      rnIb('rnPrep', it, '\u2713', 'Préparer l’ordonnance', 'rn-ib-pri') +
      rnIbConf(it) +
      rnIbLien(it) +
      rnIb('rnReport', it, '\uD83D\uDCC5', 'Reporter ou annuler') +
      rnIb('rnOpenForm', it, '\u270E', 'Modifier') +
      '</div></div>';
  }
  // Vue « Programmés » : TOUS les renouvellements, sans filtre de date,
  // avec modification / report / suppression possibles à tout moment.
  function rnRenderAll() {
    const q = (document.getElementById('rn-search').value || '').trim().toLowerCase();
    const all = rnList()
      .filter(it => !q || (it.nom + ' ' + it.prenom).toLowerCase().includes(q))
      .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
    document.getElementById('rn-count').textContent = all.length ? all.length + ' renouvellement' + (all.length > 1 ? 's' : '') + ' programmé' + (all.length > 1 ? 's' : '') : '';
    const wrap = document.getElementById('rn-listwrap');
    if (!all.length) { wrap.innerHTML = '<div class="rn-empty">Aucun renouvellement programmé.</div>'; return; }
    let html = '', last = null;
    for (const it of all) {
      if (it.date !== last) {
        last = it.date; const diff = rnDayDiff(it.date);
        const cls = diff < 0 ? 'retard' : diff === 0 ? 'jour' : 'avenir';
        const lbl = diff < 0 ? 'En retard' : diff === 0 ? "Aujourd'hui" : 'Dans ' + diff + ' j';
        html += '<div class="rn-daygroup"><div class="rn-dayhead"><span class="rn-d">' + rnFmtFr(it.date) + '</span><span class="rn-taglbl rn-t-' + cls + '">' + lbl + '</span></div>';
      }
      html += rnCardAll(it);
    }
    html += '</div>';
    wrap.innerHTML = html;
  }
  function rnCardAll(it) {
    const diff = rnDayDiff(it.date); const cls = diff < 0 ? 'retard' : diff === 0 ? 'jour' : 'avenir';
    return '<div class="rn-card rn-' + cls + '"><div class="rn-main">' + rnMainHtml(it) +
      '</div><div class="rn-acts">' +
      rnIb('rnPrep', it, '\u2713', 'Préparer l’ordonnance', 'rn-ib-pri') +
      rnIbConf(it) +
      rnIbLien(it) +
      rnIb('rnReport', it, '\uD83D\uDCC5', 'Reporter') +
      rnIb('rnOpenForm', it, '\u270E', 'Modifier') +
      rnIb('rnDelete', it, '\uD83D\uDDD1', 'Supprimer', 'rn-ib-del') +
      '</div></div>';
  }
  window.rnDelete = function (id) {
    const it = rnList().find(x => x.id === id); if (!it) return;
    if (!confirm('Supprimer définitivement le renouvellement programmé de ' + it.nom + ' ' + it.prenom + ' ?')) return;
    { const _l = rnList(), _i = _l.findIndex(x => x.id === id); if (_i >= 0) _l.splice(_i, 1); }
    rnToast('Renouvellement supprimé.'); rnPersist(); rnRender();
  };
  function rnRenderArch() {
    const q = (document.getElementById('rn-search').value || '').trim().toLowerCase();
    const a = rnArch().filter(x => !q || (x.nom + ' ' + x.prenom).toLowerCase().includes(q));
    document.getElementById('rn-count').textContent = a.length ? a.length + ' préparation' + (a.length > 1 ? 's' : '') + ' archivée' + (a.length > 1 ? 's' : '') : '';
    const wrap = document.getElementById('rn-listwrap');
    if (!a.length) { wrap.innerHTML = '<div class="rn-empty">Aucune préparation archivée pour l\'instant.</div>'; return; }
    wrap.innerHTML = '<div class="rn-daygroup">' + a.map(rnArchCard).join('') + '</div>';
  }
  function rnArchCard(x) {
    return '<div class="rn-card" style="border-left:4px solid #9fb0a6"><div class="rn-main">' +
      '<div class="rn-who">' + rnEsc(x.nom) + ' ' + rnEsc(x.prenom) + '<span class="rn-dob">' + rnFmtFr(x.dob) + '</span></div>' +
      '<div class="rn-lib">' + rnEsc(x.lib) + '</div>' +
      '<div class="rn-meta"><span>📅 Préparée le <b>' + rnFmtFr(x.prepDate) + '</b></span>' +
      '<span>👤 <span class="rn-chip" style="background:' + (x.byCol || '#777') + '">' + rnEsc(x.byName) + '</span></span>' +
      (x.remise === 'livraison' ? '<span class="rn-badge rn-b-liv">Livraison</span>' : '<span class="rn-badge rn-b-comp">Comptoir</span>') +
      (x.notif ? '<span class="rn-badge rn-b-okpat">' + (x.notif.canal === 'sms' ? '💬 patient prévenu par SMS' : '✉️ patient prévenu par email') + '</span>' : '') +
      '<span style="color:#6b7a72">' + rnEsc(x.outcome) + '</span></div>' +
      '</div>' +
      (x.undo ? '<div class="rn-acts"><button class="rn-btn rn-ghost rn-mini" onclick="rnUnprepare(' + x.id + ')">↩ Repasser en « à préparer »</button></div>' : '') +
      '</div>';
  }
  // Annule une préparation : ré-active l'ordonnance à sa date d'origine
  // et retire la livraison créée (si elle n'a pas déjà été livrée).
  window.rnUnprepare = function (archId) {
    const x = rnArch().find(a => a.id === archId); if (!x) return;
    if (!x.undo) { rnToast('Préparation trop ancienne pour être annulée automatiquement.'); return; }
    if (!confirm('Repasser l’ordonnance de ' + x.nom + ' ' + x.prenom + ' en « à préparer » ? La livraison créée sera retirée.')) return;
    // 1. retirer la livraison liée (sauf si déjà livrée)
    let note = '';
    if (x.undo.delivId && typeof deliveries !== 'undefined' && Array.isArray(deliveries)) {
      const d = deliveries.find(dd => dd.id === x.undo.delivId);
      if (d && d.status === 'done') { note = ' (livraison déjà effectuée : conservée)'; }
      else if (d) { if (typeof markDeleted === 'function') markDeleted('deliveries', x.undo.delivId); const _i = deliveries.findIndex(dd => dd.id === x.undo.delivId); if (_i >= 0) deliveries.splice(_i, 1); note = ' (livraison retirée)'; try { if (typeof renderD === 'function') renderD(); } catch (e) {} }
    }
    // 2. restaurer l'ordonnance active à sa date d'origine
    const src = Object.assign({}, x.undo.src); src.date = x.undo.prevDate || src.date; src.needsNewOrdo = false;
    const existing = rnList().find(it => it.id === src.id);
    // updatedAt = maintenant : une réactivation (désarchivage) doit battre un éventuel ancien tombstone de clôture.
    if (existing) { existing.date = src.date; existing.needsNewOrdo = false; existing.updatedAt = Date.now(); }
    else { src.updatedAt = Date.now(); rnList().push(src); }
    // 3. retirer l'entrée d'archive (mutation en place pour mettre à jour le binding lu par la sauvegarde/détection)
    { const _a = rnArch(), _i = _a.findIndex(a => a.id === archId); if (_i >= 0) _a.splice(_i, 1); }
    rnPersist(); rnSetView('todo');
    rnToast('Repassée en « à préparer »' + note + '.');
  };

  // ---------- saisie ----------
  window.rnOpenForm = function (id) {
    rnInject(); rnEditId = id || null;
    const it = id ? rnList().find(x => x.id === id) : null;
    document.getElementById('rn-form-title').textContent = it ? "Modifier l'ordonnance" : 'Nouvelle ordonnance à préparer';
    const g = i => document.getElementById(i); const v = (k, d = '') => it ? (it[k] == null ? d : it[k]) : d;
    g('rn-nom').value = v('nom'); g('rn-prenom').value = v('prenom'); g('rn-dob').value = v('dob'); g('rn-tel').value = v('tel');
    g('rn-mail').value = v('mail'); g('rn-adresse').value = v('adresse'); g('rn-lib').value = v('lib');
    g('rn-date').value = it ? it.date : rnIso(rnAddDays(rnToday(), 28)); g('rn-cycle').value = it ? it.cycle : 28;
    g('rn-presc').value = v('presc'); g('rn-remise').value = v('remise', 'comptoir'); g('rn-notes').value = v('notes');
    g('rn-flast').checked = it ? !!it.dernier : false; g('rn-drop').style.display = 'none';
    rnOpen('rn-ov-form');
  };
  window.rnSaveForm = function () {
    const g = i => document.getElementById(i);
    if (!g('rn-nom').value.trim() || !g('rn-prenom').value.trim() || !g('rn-dob').value || !g('rn-lib').value.trim() || !g('rn-date').value) { rnToast('Nom, prénom, date de naissance, libellé et date sont obligatoires.'); return; }
    const obj = {
      nom: g('rn-nom').value.trim().toUpperCase(), prenom: g('rn-prenom').value.trim(), dob: g('rn-dob').value,
      tel: g('rn-tel').value.trim(), mail: g('rn-mail').value.trim(), adresse: g('rn-adresse').value.trim(),
      lib: g('rn-lib').value.trim(), date: g('rn-date').value, cycle: parseInt(g('rn-cycle').value || '28', 10),
      presc: g('rn-presc').value.trim(), remise: g('rn-remise').value, notes: g('rn-notes').value.trim(), dernier: g('rn-flast').checked
    };
    // updatedAt : indispensable pour que la fusion serveur (mergeById) sache quelle version est la plus récente.
    if (rnEditId) { const _it = rnList().find(x => x.id === rnEditId); if (_it) { Object.assign(_it, obj); _it.updatedAt = Date.now(); } rnToast('Ordonnance modifiée.'); }
    else { obj.id = rnNewId(); obj.updatedAt = Date.now(); rnList().push(obj); rnToast('Ordonnance ajoutée.'); }
    // enregistrement dans l'annuaire patients central
    try { if (typeof upsertPatient === 'function') upsertPatient({ nom: obj.nom, prenom: obj.prenom, dob: obj.dob, adresse: obj.adresse, tel: obj.tel, mail: obj.mail }); } catch (e) {}
    rnClose('rn-ov-form'); rnPersist(); rnRender();
  };

  // ---------- préparation ----------
  window.rnPrep = function (id) {
    const it = rnList().find(x => x.id === id); rnCurId = id;
    document.getElementById('rn-prep-who').textContent = it.nom + ' ' + it.prenom;
    document.getElementById('rn-prep-lib').textContent = it.lib;
    document.getElementById('rn-prep-remise').innerHTML = 'Remise prévue : ' + (it.remise === 'livraison' ? '<b style="color:#5E35B1">Livraison</b>' : '<b style="color:#00695C">Retrait au comptoir</b>');
    document.getElementById('rn-prep-date').value = rnIso(rnAddDays(rnToday(), it.cycle || 28));
    document.getElementById('rn-prep-last').checked = !!it.dernier;
    document.getElementById('rn-prep-nomore').checked = false;
    // Le geste principal dépend du mode de remise : au comptoir on valide, et
    // prévenir le patient vient après ; en livraison on valide et la livraison
    // se crée dans la foulée — le patient sera prévenu par le livreur.
    const liv = (it.remise === 'livraison');
    document.getElementById('rn-prep-foot').innerHTML =
      '<button class="rn-btn rn-ghost" onclick="rnClose(\'rn-ov-prep\')">Annuler</button>' +
      (liv
        ? '<button class="rn-btn rn-blue" onclick="rnValiderLivraison()">\uD83D\uDE9A Valider et envoyer en livraison</button>'
        : '<button class="rn-btn rn-pri" onclick="rnValider()">\u2713 Valider</button>');
    rnPrepToggle(); rnOpen('rn-ov-prep');
  };
  window.rnPrepExcl = function (which) {
    if (which === 'last' && document.getElementById('rn-prep-last').checked) document.getElementById('rn-prep-nomore').checked = false;
    if (which === 'nomore' && document.getElementById('rn-prep-nomore').checked) document.getElementById('rn-prep-last').checked = false;
    rnPrepToggle();
  };
  function rnPrepToggle() {
    const last = document.getElementById('rn-prep-last').checked, nomore = document.getElementById('rn-prep-nomore').checked;
    document.getElementById('rn-prep-next').style.display = nomore ? 'none' : 'block';
    const n = document.getElementById('rn-prep-note');
    if (last) { n.style.display = 'block'; n.textContent = "Dernier renouvellement sur l'ordonnance actuelle : la fiche est conservée et reprogrammée (pas de ressaisie). Le patient devra fournir une nouvelle ordonnance avant le prochain renouvellement (email d'invitation)."; }
    else if (nomore) { n.style.display = 'block'; n.textContent = "Ordonnance clôturée après cette préparation (fin du traitement). Aucune nouvelle échéance."; }
    else n.style.display = 'none';
  }
  function rnCompute() {
    const it = rnList().find(x => x.id === rnCurId);
    const last = document.getElementById('rn-prep-last').checked, nomore = document.getElementById('rn-prep-nomore').checked;
    it._close = nomore; it._newOrdo = last;
    rnPendingNext = it._close ? null : (document.getElementById('rn-prep-date').value || rnIso(rnAddDays(rnToday(), it.cycle || 28)));
  }
  // ---------- validation ----------
  // La validation est le geste qui compte : l'ordonnance est reprogrammée et
  // archivée immédiatement. Ce qui suit (prévenir le patient, créer la livraison)
  // ne peut plus la faire échouer — et si le poste se ferme entre les deux, rien
  // n'est perdu.
  let rnNotifSnap = null;   // qui prévenir, une fois le dossier déjà clos

  window.rnValider = function () {
    const it = rnList().find(x => x.id === rnCurId); if (!it) return;
    rnCompute();
    const snap = {
      id: it.id, nom: it.nom, prenom: it.prenom, dob: it.dob,
      mail: it.mail || '', tel: it.tel || '', lib: it.lib || '',
      remise: 'comptoir', newOrdo: !!it._newOrdo, close: !!it._close,
      prochaine: rnPendingNext
    };
    rnClose('rn-ov-prep');
    rnFinish('comptoir');                       // reprogrammée + archivée
    snap.archId = (rnArch()[0] || {}).id || null;
    rnNotifSnap = snap;
    rnProposerNotif(snap);
  };

  window.rnValiderLivraison = function () {
    const it = rnList().find(x => x.id === rnCurId); if (!it) return;
    rnCompute(); rnClose('rn-ov-prep'); rnOpenLiv(it);
  };

  // ---------- prévenir le patient : proposé APRÈS validation, jamais bloquant ----------
  function rnProposerNotif(snap) {
    document.getElementById('rn-notify-done').textContent =
      '\u2713 Ordonnance validée' + (snap.close
        ? ' et clôturée (fin du traitement).'
        : ' \u2014 prochain renouvellement le ' + rnFmtFr(snap.prochaine) + '.');
    document.getElementById('rn-notify-who').textContent = snap.nom + ' ' + snap.prenom + (snap.lib ? ' \u2014 ' + snap.lib : '');
    document.getElementById('rn-notify-contact').innerHTML =
      (snap.mail ? '\u2709\uFE0F ' + rnEsc(snap.mail) : '\u2709\uFE0F <i>pas d\u2019email enregistr\u00e9</i>') + '<br>' +
      (snap.tel ? '\uD83D\uDCDE ' + rnEsc(snap.tel) : '\uD83D\uDCDE <i>pas de t\u00e9l\u00e9phone enregistr\u00e9</i>');
    rnOpen('rn-ov-notify');
  }
  // Trace du message sur la préparation archivée, pour savoir plus tard si le
  // patient a été prévenu et comment.
  function rnNoterNotif(canal, info) {
    if (!rnNotifSnap || !rnNotifSnap.archId) return;
    const a = rnArch().find(x => x.id === rnNotifSnap.archId); if (!a) return;
    a.notif = Object.assign({ canal: canal, at: new Date().toISOString(), by: rnUser().id }, info || {});
    a.updatedAt = Date.now();
    rnPersist(); rnRender();
  }
  window.rnNotifyMail = function () {
    if (!rnNotifSnap) return;
    rnClose('rn-ov-notify'); rnOpenMail(rnNotifSnap);
  };
  window.rnNotifySms = function () {
    const snap = rnNotifSnap; if (!snap) return;
    if (typeof window.openRenouvSms !== 'function') { rnToast('Module SMS indisponible.'); return; }
    rnClose('rn-ov-notify');
    window.openRenouvSms({
      nom: snap.nom, prenom: snap.prenom, tel: snap.tel || '', lib: snap.lib || '', dateFr: rnFmtFr(snap.prochaine),
      onSent: function (r) {
        // Numéro saisi à la volée : on le garde dans la fiche patient et, si
        // l'ordonnance vit encore (reprogrammée), sur l'ordonnance.
        const saisi = ((r && r.raw) || '').trim();
        if (saisi && saisi !== (snap.tel || '')) {
          snap.tel = saisi;
          const vivant = rnList().find(x => x.id === snap.id);
          if (vivant) { vivant.tel = saisi; vivant.updatedAt = Date.now(); }
          try { if (typeof upsertPatient === 'function') upsertPatient({ nom: snap.nom, prenom: snap.prenom, dob: snap.dob, tel: saisi }); } catch (e) {}
        }
        rnNoterNotif('sms', { smsId: (r && r.id) || null, manuel: !!(r && r.manual) });
        rnToast((r && r.manual) ? 'SMS not\u00e9 sur la pr\u00e9paration.' : 'SMS envoy\u00e9 au patient.');
      }
    });
  };
  window.rnNotifyNone = function () {
    rnClose('rn-ov-notify');
    rnToast('Ordonnance valid\u00e9e \u2014 patient non pr\u00e9venu.');
  };

  // ---------- email ----------
  function rnMailBody(it, addNewOrdo) {
    return 'Bonjour ' + it.prenom + ' ' + it.nom + ',\n\n' +
      'Votre ordonnance a été préparée et est prête' + (it.remise === 'livraison' ? ' (elle vous sera livrée)' : ' à être récupérée à la pharmacie') + '.\n\n' +
      (addNewOrdo ? 'Important : il s\'agit du dernier renouvellement possible sur votre ordonnance actuelle. Merci de nous faire parvenir une nouvelle ordonnance de votre médecin avant votre prochain renouvellement.\n\n' : '') +
      'Cordialement,\nPharmacie du Centre — Mondeville\n48 Rue Chapron, 14120 Mondeville · 02 31 52 15 71';
  }
  window.rnOpenMail = function (it) {
    const noMail = !it.mail;
    document.getElementById('rn-mail-nomail').style.display = noMail ? 'block' : 'none';
    document.getElementById('rn-mail-preview').style.display = noMail ? 'none' : 'block';
    document.getElementById('rn-mail-foot').style.display = noMail ? 'none' : 'flex';
    document.getElementById('rn-mail-new').value = '';
    if (!noMail) document.getElementById('rn-mail-body').textContent =
      'À : ' + it.mail + '\nObjet : Votre traitement est prêt\n\n' + rnMailBody(it, it.newOrdo);
    rnOpen('rn-ov-mail');
  };
  window.rnUseNewMail = function () {
    const snap = rnNotifSnap; if (!snap) return;
    const m = document.getElementById('rn-mail-new').value.trim();
    if (!m) { rnToast('Saisir un email ou choisir « Pas de mail ».'); return; }
    snap.mail = m;
    const vivant = rnList().find(x => x.id === snap.id);
    if (vivant) { vivant.mail = m; vivant.updatedAt = Date.now(); }
    try { if (typeof upsertPatient === 'function') upsertPatient({ nom: snap.nom, prenom: snap.prenom, dob: snap.dob, mail: m }); } catch (e) {}
    rnPersist();
    rnOpenMail(snap);
  };
  window.rnSkipMail = function () { rnClose('rn-ov-mail'); rnToast('Ordonnance validée — pas de mail (prévenir par téléphone).'); };
  window.rnConfirmSend = async function () {
    const it = rnNotifSnap; if (!it) return;
    const btn = document.getElementById('rn-mail-send');
    btn.disabled = true; btn.textContent = 'Envoi…';
    let ok = false, err = '';
    try {
      const st = await (await fetch('/api/mail-status')).json();
      if (!st.configured) { err = 'service email non configuré'; }
      else {
        const r = await fetch('/api/send-mail', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: it.mail, subject: 'Votre traitement est prêt', text: rnMailBody(it, it.newOrdo) }) });
        const j = await r.json(); ok = !!j.ok; err = j.error || '';
      }
    } catch (e) { err = e.message; }
    btn.disabled = false; btn.textContent = "Confirmer l'envoi";
    rnClose('rn-ov-mail');
    rnNoterNotif('email', { ok: ok, erreur: ok ? null : err });
    rnToast(ok ? 'Email envoyé au patient.' : 'Email NON envoyé (' + err + ') — l’ordonnance reste validée.');
  };

  // ---------- livraison ----------
  window.rnOpenLiv = function (it) {
    document.getElementById('rn-l-nom').value = it.nom + ' ' + it.prenom;
    document.getElementById('rn-l-tel').value = it.tel || ''; document.getElementById('rn-l-adr').value = it.adresse || '';
    document.getElementById('rn-l-frigo').checked = /frigo/i.test(it.notes || ''); document.getElementById('rn-l-notes').value = it.notes || '';
    document.getElementById('rn-l-montant').value = 0; document.getElementById('rn-l-lieu').value = 'Domicile';
    rnOpen('rn-ov-liv');
  };
  window.rnConfirmLiv = function () {
    const it = rnList().find(x => x.id === rnCurId); const u = rnUser();
    // bascule dans le module Livraisons à l'état « préparé »
    try {
      if (typeof deliveries !== 'undefined' && Array.isArray(deliveries)) {
        const dId = Date.now();
        deliveries.unshift({
          id: dId, nom: it.nom, prenom: it.prenom, adresse: document.getElementById('rn-l-adr').value.trim(), commune: it.commune || '',
          tel: document.getElementById('rn-l-tel').value.trim(), lieu: document.getElementById('rn-l-lieu').value,
          montant: parseFloat(document.getElementById('rn-l-montant').value) || 0, date: rnIso(rnToday()),
          frigo: document.getElementById('rn-l-frigo').checked, promis: true, ordo: true,
          notes: 'Renouvellement — ' + it.lib + (document.getElementById('rn-l-notes').value.trim() ? ' · ' + document.getElementById('rn-l-notes').value.trim() : ''),
          status: 'prep', prepBy: u.id, livrBy: null, cold: document.getElementById('rn-l-frigo').checked,
          createdBy: u.id, createdAt: (typeof nowStamp === 'function' ? nowStamp() : null), updatedAt: Date.now()
        });
        it._delivId = dId; // pour pouvoir retirer cette livraison si on annule la préparation
      }
    } catch (e) { console.warn('rn->deliveries', e); }
    rnClose('rn-ov-liv'); rnFinish('livraison');
    rnToast('Validée et envoyée en livraison — la ligne de livraison est créée.');
  };

  // ---------- finalisation + archivage ----------
  function rnArchive(it, outcome, mode, undo) {
    const u = rnUser();
    rnArch().unshift({ id: rnNewId(), nom: it.nom, prenom: it.prenom, dob: it.dob, lib: it.lib, remise: mode || it.remise, prepDate: rnIso(rnToday()), byName: (u.prenom + ' ' + u.nom).trim() || u.id, byCol: u.col, outcome, undo: undo || null, updatedAt: Date.now() });
  }
  window.rnFinish = function (mode) {
    const it = rnList().find(x => x.id === rnCurId); if (!it) return;
    // Instantané de l'ordonnance AVANT préparation, pour pouvoir revenir en arrière.
    const src = Object.assign({}, it); delete src._close; delete src._newOrdo; delete src._delivId;
    const undo = { src: src, prevDate: it.date, closed: !!it._close, delivId: it._delivId || null };
    let base;
    if (it._close) { const _l = rnList(), _i = _l.findIndex(x => x.id === rnCurId); if (_i >= 0) _l.splice(_i, 1); base = 'clôturée — plus de renouvellement'; }
    else { it.date = rnPendingNext; it.needsNewOrdo = !!it._newOrdo; it.updatedAt = Date.now(); base = (it._newOrdo ? 'dernier de l’ordonnance (nouvelle ordonnance à fournir) — ' : '') + 'prochain renouvellement le ' + rnFmtFr(rnPendingNext); delete it._delivId; }
    rnArchive(it, (mode === 'livraison' ? 'Livraison — ' : 'Comptoir — ') + base, mode, undo);
    rnCurId = null; rnPendingNext = null; rnPersist(); rnRender();
  };

  // Le SMS libre au patient a été retiré des lignes : il fait doublon avec
  // « Prévenir le patient », proposé au moment de la préparation, qui envoie le
  // bon message au bon moment. Restent ici la demande de confirmation (avant
  // préparation) et la page patient.


  // Le nombre de dossiers en attente de vérification s'affiche sur l'onglet :
  // une demande d'arrêt ne doit pas rester invisible dans un onglet qu'on n'ouvre pas.
  function rnMajOngletCheck() {
    const t = document.getElementById('rn-tab-check'); if (!t) return;
    const n = rnList().filter(it => it.pause).length;
    t.innerHTML = 'À vérifier' + (n ? ' <span class="rn-tabnb">' + n + '</span>' : '');
  }

  // ---------- demande de confirmation au patient (SMS + page personnelle) ----------
  // Un jeton aléatoire est tiré sur le poste, écrit sur l'ordonnance, puis glissé
  // dans le SMS sous forme de lien. La réponse du patient est enregistrée par le
  // serveur sur cette même ordonnance : elle revient ici à la synchronisation.
  // Adresse sous laquelle on construit les liens envoyes aux patients. Un
  // sous-domaine dedie (renouvellement.pharmacie-mondeville.fr) inspire plus
  // confiance dans un SMS que le nom du back-office, et ne revele pas l'outil
  // interne. Repli sur l'adresse courante : le lien fonctionne dans tous les cas.
  function rnBaseLien() {
    const b = window.APP_CONFIG && window.APP_CONFIG.renouvBase;
    return (typeof b === 'string' && /^https?:\/\//i.test(b)) ? b.replace(/\/+$/, '') : location.origin;
  }
  function rnJeton() {
    try {
      const a = new Uint8Array(16); crypto.getRandomValues(a);
      return Array.from(a).map(b => b.toString(36)).join('').replace(/[^a-z0-9]/g, '').slice(0, 14);
    } catch (e) {
      return (Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).slice(0, 14);
    }
  }
  function rnConfBtnStyle(it) {
    const c = it.conf;
    if (c && c.choix) return ' style="border-color:#a5d6a7;background:#e8f5e9"';
    if (c && c.sentAt) return ' style="border-color:#e0d7c3;background:#faf7f0"';
    return '';
  }
  window.rnDemandeConf = function (id) {
    const it = rnList().find(x => x.id === id); if (!it) return;
    if (it.conf && it.conf.choix) { rnToast('Le patient a déjà répondu — sa décision est définitive.'); return; }
    if (typeof window.openSmsModal !== 'function') { rnToast('Module SMS indisponible.'); return; }
    if (it.conf && it.conf.sentAt && !confirm('Une demande a déjà été envoyée le ' + rnFmtFr(it.conf.sentAt.slice(0, 10))
      + ' et le patient n’a pas répondu.\n\nRenvoyer la demande ?')) return;

    // Le lien reste valable tant que le patient n'a pas répondu : on garde le
    // jeton déjà émis pour qu'un premier SMS conservé sur le téléphone marche encore.
    // Le jeton est ENREGISTRÉ TOUT DE SUITE : s'il n'existait qu'en mémoire jusqu'à
    // l'envoi, un rafraîchissement (toutes les 8 s) l'effacerait et le lien du SMS
    // ouvrirait sur « lien non valable ».
    if (!it.conf || !it.conf.token) {
      it.conf = Object.assign({}, it.conf, { token: rnJeton() });
      it.updatedAt = Date.now();
      rnPersist();
    }
    const lien = rnBaseLien() + '/r/' + it.conf.token;
    const texte = rnTexteSms(it, lien);

    window.openSmsModal({
      titre: 'Demande de confirmation au patient',
      tel: it.tel || '', nom: it.nom, prenom: it.prenom, source: 'renouvellement', tag: 'confirmation',
      info: '<strong>' + rnEsc(it.nom || '') + ' ' + rnEsc(it.prenom || '') + '</strong>'
        + (it.lib ? ' · ' + rnEsc(it.lib) : '')
        + '<div style="font-size:.78rem;color:var(--gray-500);margin-top:4px">Échéance : ' + rnFmtFr(it.date)
        + ' · le lien ouvre une page où le patient confirme, reporte ou arrête. Sa réponse est définitive.</div>',
      text: texte,
      onSent: function (r) {
        it.conf.sentAt = new Date().toISOString();
        it.conf.sentBy = rnUser().id;
        it.conf.smsId = (r && r.id) || null;
        it.conf.envois = (it.conf.envois || 0) + 1;
        it.updatedAt = Date.now();
        rnToast('Demande envoyée à ' + it.prenom + ' ' + it.nom + '.');
        rnPersist(); rnRender();
      }
    });
  };
  // Deux SMS ne sont jamais rigoureusement identiques : le prénom, et la mention
  // « rappel » à partir du deuxième envoi, les distinguent — utile face aux filtres
  // anti-doublon des opérateurs, et plus clair pour le patient. Le prénom est ramené
  // à l'alphabet latin simple : un seul caractère accentué exotique ferait basculer
  // tout le message en Unicode, donc de 160 à 70 caractères par SMS.
  function rnAscii(t) {
    return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9 '\-]/g, '').trim();
  }
  function rnTexteSms(it, lien) {
    const rappel = (it.conf && it.conf.envois > 0);
    const faire = p => 'Pharmacie du Centre : ' + (p ? p + ', ' : '')
      + (rappel ? 'rappel, ' : '') + 'merci de confirmer votre renouvellement : ' + lien;
    const avec = faire(rnAscii(it.prenom));
    // Un prénom long ferait basculer le message sur deux SMS : dans ce cas on
    // s'en passe plutôt que de facturer un SMS de plus à chaque envoi.
    return avec.length <= 160 ? avec : faire('');
  }

  // Vérifier le lien soi-même, sans envoyer de SMS : indispensable pour lever un
  // doute (« le patient dit que ça ne marche pas ») en deux secondes.
  window.rnVoirLien = function (id) {
    const it = rnList().find(x => x.id === id); if (!it) return;
    if (!it.conf || !it.conf.token) { rnToast('Aucune demande envoyée pour l’instant.'); return; }
    window.open(rnBaseLien() + '/r/' + it.conf.token, '_blank');
  };

  // Copie du lien : utile si le patient n'a pas de mobile mais consulte ses mails,
  // ou pour le lui dicter au téléphone.
  window.rnCopierLien = function (id) {
    const it = rnList().find(x => x.id === id); if (!it) return;
    if (!it.conf || !it.conf.token) { it.conf = Object.assign({}, it.conf, { token: rnJeton() }); it.updatedAt = Date.now(); rnPersist(); }
    const lien = rnBaseLien() + '/r/' + it.conf.token;
    try { navigator.clipboard.writeText(lien); rnToast('Lien copié.'); }
    catch (e) { prompt('Lien personnel du patient :', lien); }
  };

  // ---------- vue « À vérifier » : ce que le patient a demandé d'arrêter ----------
  function rnRenderCheck() {
    const q = (document.getElementById('rn-search').value || '').trim().toLowerCase();
    const l = rnList()
      .filter(it => it.pause)
      .filter(it => !q || (it.nom + ' ' + it.prenom).toLowerCase().includes(q))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    document.getElementById('rn-count').textContent = l.length
      ? l.length + ' ordonnance' + (l.length > 1 ? 's' : '') + ' à vérifier' : '';
    const wrap = document.getElementById('rn-listwrap');
    if (!l.length) { wrap.innerHTML = '<div class="rn-empty">Rien à vérifier : aucun patient n’a demandé d’arrêter son traitement.</div>'; return; }
    wrap.innerHTML = '<div class="rn-daygroup">' + l.map(it =>
      '<div class="rn-card" style="border-left:4px solid #B23A2F"><div class="rn-main">' + rnMainHtml(it) +
      '<div class="rn-meta" style="margin-top:6px;color:#8A2B22">Le patient a répondu « je n’ai plus besoin de ce traitement »'
      + (it.conf && it.conf.at ? ' le ' + rnFmtFr(it.conf.at.slice(0, 10)) : '')
      + '. Appelez-le ou son médecin, puis clôturez ou remettez l’ordonnance en service.</div>' +
      '</div><div class="rn-acts">' +
      '<button class="rn-btn rn-pri rn-mini" onclick="rnCloturerArret(' + it.id + ')">✓ Clôturer</button>' +
      '<button class="rn-btn rn-ghost rn-mini" onclick="rnReprendre(' + it.id + ')">↩ Remettre en service</button>' +
      '<button class="rn-btn rn-ghost rn-mini" onclick="rnOpenForm(' + it.id + ')">✎ Modifier</button>' +
      '</div></div>').join('') + '</div>';
  }
  window.rnCloturerArret = function (id) {
    const it = rnList().find(x => x.id === id); if (!it) return;
    if (!confirm('Clôturer l’ordonnance de ' + it.nom + ' ' + it.prenom + ' ? Elle part dans les archives.')) return;
    rnArchive(it, 'Arrêt demandé par le patient' + (it.conf && it.conf.at ? ' le ' + rnFmtFr(it.conf.at.slice(0, 10)) : ''), 'comptoir', null);
    { const _l = rnList(), _i = _l.findIndex(x => x.id === id); if (_i >= 0) _l.splice(_i, 1); }
    rnToast('Ordonnance clôturée.'); rnPersist(); rnRender();
  };
  window.rnReprendre = function (id) {
    const it = rnList().find(x => x.id === id); if (!it) return;
    it.pause = false;
    if (it.conf) { it.conf.leve = new Date().toISOString(); it.conf.leveBy = rnUser().id; }
    it.updatedAt = Date.now();
    rnToast('Ordonnance remise en service.'); rnPersist(); rnRender();
  };

  // ---------- report / annulation ----------
  window.rnReport = function (id) {
    const it = rnList().find(x => x.id === id); rnCurId = id;
    document.getElementById('rn-rep-who').textContent = it.nom + ' ' + it.prenom + ' — actuellement le ' + rnFmtFr(it.date);
    document.getElementById('rn-rep-date').value = it.date; document.getElementById('rn-rep-motif').value = '';
    rnOpen('rn-ov-report');
  };
  window.rnConfirmReport = function () {
    const it = rnList().find(x => x.id === rnCurId); const d = document.getElementById('rn-rep-date').value;
    if (!d) { rnToast('Choisir une date.'); return; }
    it.date = d; it.updatedAt = Date.now(); rnClose('rn-ov-report'); rnToast('Reporté au ' + rnFmtFr(d) + '.'); rnCurId = null; rnPersist(); rnRender();
  };
  window.rnCancelOrdo = function () {
    const it = rnList().find(x => x.id === rnCurId);
    if (!confirm('Annuler (supprimer) l\'ordonnance de ' + it.nom + ' ' + it.prenom + ' ?')) return;
    { const _l = rnList(), _i = _l.findIndex(x => x.id === rnCurId); if (_i >= 0) _l.splice(_i, 1); }
    rnClose('rn-ov-report'); rnToast('Ordonnance annulée (supprimée).'); rnCurId = null; rnPersist(); rnRender();
  };

  // injection dès que possible
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', rnInject);
  else rnInject();
})();
