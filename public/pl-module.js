/* ════════════════════════════════════════════════════════════════
   Module PLANNING — Lot 1 (socle)
   Intranet Pharmacie du Centre. Isolé (préfixe pl / pl-) sur le
   modèle de rn-module.js : injecte sa navigation, sa section et ses
   modales ; ne touche à rien d'existant.

   Réutilise : schedSave/saveAll (persistance), currentUser, ADMIN.
   Données (globales index.html, synchronisées + tombstones) :
     plParams   — conteneur (fusion fine serveur, sous-listes à id)
     plPostes[], plRotations[], plContrats[], plTrames[]
     plExceptions[], plDemandes[], plReels[], plNotifs[], plClotures[]
   Règles de sync (voir CDC §9.2) : mutations EN PLACE ou réassignation
   du bareword (jamais window.x=), updatedAt=Date.now() à CHAQUE
   mutation, suppressions par splice (tombstones via diffTombstones).
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ---------- utilitaires ----------
  function plEsc(s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function plIso(d) { const x = new Date(d); x.setHours(12, 0, 0, 0); return x.toISOString().slice(0, 10); }
  function plMonday(d) { const x = new Date(d); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
  function plAddD(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  const PL_JOURS = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];
  const PL_JOURS_FR = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
  const PL_MOIS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  function plDayKey(d) { return PL_JOURS[(d.getDay() + 6) % 7]; }
  function plFmtH(x) { if (x == null) return '—'; const h = Math.floor(x), m = Math.round((x - h) * 60); return m ? h + 'h' + String(m).padStart(2, '0') : h + ' h'; }
  // "9h-12h30" → durée en heures (0 si illisible ou négative — protège des fautes de saisie type "14h-1h30")
  function plDurOf(s) {
    if (!s) return 0;
    const m = String(s).match(/(\d{1,2})h(\d*)\s*[-–]\s*(\d{1,2})h(\d*)/);
    if (!m) return 0;
    let a = +m[1] + (+m[2] || 0) / 60, b = +m[3] + (+m[4] || 0) / 60;
    if (b < a) b += 12;
    return Math.max(0, Math.round((b - a) * 4) / 4);
  }
  function plToast(msg) {
    let t = document.getElementById('pl-toast');
    if (!t) return;
    t.textContent = msg; t.classList.add('pl-on');
    clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('pl-on'), 2600);
  }
  function plPersist() { try { if (typeof schedSave === 'function') schedSave(); else if (typeof saveAll === 'function') saveAll(); } catch (e) { console.warn('pl save', e); } }
  function plStamp(o) { o.updatedAt = Date.now(); return o; }
  function plNewId(pfx) { return pfx + ':' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function plIsAdmin() { try { return !!(typeof currentUser !== 'undefined' && currentUser && (currentUser.admin || currentUser.role === 'admin' || currentUser.plRole === 'titulaire' || currentUser.plRole === 'responsable')); } catch (e) { return false; } }

  // accès sûrs aux globales (index.html les déclare ; garde-fou si module chargé isolément)
  function P() { if (typeof plParams === 'undefined' || !plParams || typeof plParams !== 'object') window.plParams = {}; return plParams; }
  function L(name) { /* liste globale par nom */
    switch (name) {
      case 'postes': if (!Array.isArray(plPostes)) plPostes = []; return plPostes;
      case 'rotations': if (!Array.isArray(plRotations)) plRotations = []; return plRotations;
      case 'contrats': if (!Array.isArray(plContrats)) plContrats = []; return plContrats;
      case 'trames': if (!Array.isArray(plTrames)) plTrames = []; return plTrames;
      case 'exceptions': if (!Array.isArray(plExceptions)) plExceptions = []; return plExceptions;
    }
    return [];
  }

  // ---------- groupes (fonctions) ----------
  const PL_GRPS = {
    ph: { lbl: 'Pharmaciens', ord: 1 }, prep: { lbl: 'Préparateurs', ord: 2 },
    avance: { lbl: 'Esthéticienne — poste avancé', ord: 3 }, secr: { lbl: 'Secrétariat', ord: 4 },
    logi: { lbl: 'Logistique', ord: 5 }, entretien: { lbl: 'Entretien', ord: 6 },
    renfort: { lbl: 'Étudiants · renforts', ord: 7 }
  };
  // Position d'une demi-journée travaillée : C = comptoir, B = back-office, A = poste avancé.
  // Règles d'Olivier (28/08/2026) : pharmaciens TOUJOURS comptoir ; préparateurs C/B/A au choix
  // (B et A = pas comptés au comptoir) ; esthéticienne toujours A quand présente ; secrétaire et
  // logistique toujours back-office ; entretien hors effectif ; étudiants viennent pour le comptoir.
  const PL_POS_DEFAUT = { ph: 'C', prep: 'C', avance: 'A', secr: 'B', logi: 'B', entretien: 'B', renfort: 'C' };
  const PL_POS_CHOIX = { prep: ['C', 'B', 'A'] };   // seuls les préparateurs choisissent leur position
  const PL_POS_LBL = { C: 'Comptoir', B: 'Back-office', A: 'Poste avancé' };
  function plPosOf(c, rang, jour, hh) {
    if (PL_POS_CHOIX[c.grp] && c.pos && c.pos[rang] && c.pos[rang][jour] && c.pos[rang][jour][hh]) return c.pos[rang][jour][hh];
    return PL_POS_DEFAUT[c.grp] || 'C';
  }
  // migration douce des anciens groupes du seed initial (dermo→secr, pda→logi)
  // + ajout des titulaires Anouck et Olivier s'ils manquent (idempotent par id)
  function plMigrate() {
    let ch = false;
    L('contrats').forEach(c => {
      if (c.grp === 'dermo') { c.grp = 'secr'; c.role = 'Secrétaire'; plStamp(c); ch = true; }
      if (c.grp === 'pda') { c.grp = 'logi'; c.role = 'Logistique'; plStamp(c); ch = true; }
    });
    if (L('contrats').length) {
      [{ id: 'ct:anouck', nom: 'Anouck', role: 'Pharmacienne titulaire' },
       { id: 'ct:olivier', nom: 'Olivier', role: 'Pharmacien titulaire' }].forEach(t => {
        if (!L('contrats').some(c => c.id === t.id)) {
          plContrats.push({ id: t.id, nom: t.nom, grp: 'ph', role: t.role, estPharmacien: true,
            base: null, tempsPartiel: false, rotationId: 'rot:ph', sem: {}, actif: true, updatedAt: Date.now() });
          ch = true;
        }
      });
      // l'entretien ne fait pas partie du planning (demande d'Olivier du 28/08/2026)
      L('contrats').forEach(c => { if (c.grp === 'entretien' && c.actif !== false) { c.actif = false; plStamp(c); ch = true; } });
    }
    if (ch) plPersist();
    plLinkStaff();
  }

  // ── lien avec la liste des collaborateurs du Back Office (staffDB) ──
  function plNorm(x) { return String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]+/g, ' ').trim(); }
  function plStaffList() { return (typeof staffDB !== 'undefined' && Array.isArray(staffDB)) ? staffDB : []; }
  function plStaffOf(c) { return plStaffList().find(s => s.id === c.staffId) || null; }
  // rapprochement automatique : « Prénom Nom » identique, sinon prénom unique. Idempotent.
  function plLinkStaff() {
    const staff = plStaffList(); if (!staff.length) return;
    let ch = false;
    L('contrats').forEach(c => {
      if (c.staffId && staff.some(s => s.id === c.staffId)) return;
      const n = plNorm(c.nom);
      let m = staff.find(s => plNorm(s.prenom + ' ' + s.nom) === n || plNorm(s.nom + ' ' + s.prenom) === n);
      if (!m) { const cand = staff.filter(s => plNorm(s.prenom) === n || n.indexOf(plNorm(s.prenom)) === 0 && plNorm(s.prenom)); m = (staff.filter(s => plNorm(s.prenom) === n.split(' ')[0]).length === 1) ? staff.find(s => plNorm(s.prenom) === n.split(' ')[0]) : null; }
      if (m) { c.staffId = m.id; plStamp(c); ch = true; }
    });
    if (ch) plPersist();
  }
  window.plSetStaff = function (cid, sid) {
    const c = L('contrats').find(x => x.id === cid); if (!c) return;
    c.staffId = sid || null; plStamp(c); plPersist(); plRegRender(); plRender();
  };
  // créer un contrat pour un collaborateur du site qui n'en a pas encore
  window.plCreateFromStaff = function (sid) {
    const st = plStaffList().find(s => s.id === sid); if (!st) return;
    const grp = /pharmacien/i.test(st.poste || '') ? 'ph' : 'prep';
    plContrats.push({
      id: plNewId('ct'), nom: (st.prenom || '') + ' ' + (st.nom ? st.nom.charAt(0) + st.nom.slice(1).toLowerCase() : ''),
      grp: grp, role: st.poste || 'À préciser', estPharmacien: grp === 'ph',
      base: null, tempsPartiel: false, rotationId: grp === 'ph' ? 'rot:ph' : 'rot:prep',
      sem: {}, staffId: st.id, actif: true, updatedAt: Date.now()
    });
    plPersist(); plToast('Contrat créé pour ' + st.prenom + ' — complétez sa trame et sa base'); plRegRender(); plRender();
  };

  // ---------- moteur : rotation → semaine de cycle → horaires ----------
  function plRotOf(c) { return L('rotations').find(r => r.id === c.rotationId) || null; }
  function plWeeksBetween(isoA, dateB) {
    const a = plMonday(new Date(isoA + 'T12:00')), b = plMonday(dateB);
    return Math.round((b - a) / (7 * 86400000));
  }
  // rang du cycle (1..longueur) d'une rotation à une date
  function plRang(rot, date) {
    if (!rot || !rot.longueur) return 1;
    const w = plWeeksBetween(rot.ancrage, date);
    return ((w % rot.longueur) + rot.longueur + (rot.rangAncrage || 1) - 1) % rot.longueur + 1;
  }
  // horaires théoriques [matin, aprem] d'un contrat à une date (trame seule — Lot 1)
  function plSlots(c, date) {
    const rot = plRotOf(c);
    const rang = String(plRang(rot, date));
    const sem = (c.sem && (c.sem[rang] || c.sem['1'])) || null;
    if (!sem) return [null, null];
    const day = sem[plDayKey(date)];
    return Array.isArray(day) ? [day[0] || null, day[1] || null] : [null, null];
  }
  // absence validée (exception de type absence) pour un contrat à une date → {motif} ou null par demi-journée
  function plAbs(c, iso) {
    const e = L('exceptions').filter(x => x.contratId === c.id && x.date === iso && x.type === 'absence');
    if (!e.length) return [null, null];
    const m = e.find(x => x.demi === 'M' || x.journee), a = e.find(x => x.demi === 'AM' || x.journee);
    return [m ? (m.motif || 'cp') : null, a ? (a.motif || 'cp') : null];
  }
  const PL_MOTIFS = { cp: 'Congés', mal: 'Maladie', rec: 'Récup.', for: 'Formation' };

  // ── amplitude d'ouverture (par défaut : 9h00-12h30 / 14h00-19h30, lundi-samedi) ──
  // surchargée par plParams.ouverture = { M:[540,750], AM:[840,1170] } (minutes depuis minuit)
  function plOuverture(demi) {
    const o = (P().ouverture) || {};
    return demi === 'M' ? (o.M || [540, 750]) : (o.AM || [840, 1170]);
  }
  function plParseSlot(str) {
    const m = String(str || '').match(/(\d{1,2})h(\d*)\s*[-–]\s*(\d{1,2})h(\d*)/);
    if (!m) return null;
    let a = (+m[1]) * 60 + (+m[2] || 0), b = (+m[3]) * 60 + (+m[4] || 0);
    if (b < a) b += 720;
    return { a: a, b: b };
  }
  // présence partielle AU COMPTOIR : le créneau ne couvre pas toute la plage d'ouverture
  // (ex. fin à 18h30 alors que la pharmacie ferme à 19h30, ou arrivée après l'ouverture)
  function plPartiel(slotStr, demi) {
    const t = plParseSlot(slotStr); if (!t) return false;
    const o = plOuverture(demi);
    return t.a > o[0] || t.b < o[1];
  }
  // Les livraisons arrivent entre 15h et 18h (~1h). Si aucun logisticien n'est présent
  // sur cette fenêtre, le jour est signalé : il faut désigner un responsable des livraisons.
  function plLivraisonsCouvertes(date) {
    const p = P(); const fen = p.fenetreLivraisons || [900, 1080];   // minutes : 15h00 → 18h00
    return L('contrats').some(c => {
      if (c.actif === false || c.grp !== 'logi') return false;
      const sl = plSlots(c, date), ab = plAbs(c, plIso(date));
      if (!sl[1] || ab[1]) return false;
      const t = plParseSlot(sl[1]); if (!t) return false;
      return Math.max(t.a, fen[0]) < Math.min(t.b, fen[1]);
    });
  }
  function plPartielTitle(slotStr, demi) {
    const o = plOuverture(demi);
    const f = mn => Math.floor(mn / 60) + 'h' + (mn % 60 ? String(mn % 60).padStart(2, '0') : '');
    return 'Présence partielle au comptoir : ' + slotStr + ' (ouverture ' + f(o[0]) + '-' + f(o[1]) + ')';
  }

  // heures planifiées d'une semaine (lun→dim) pour un contrat
  function plHeuresSemaine(c, monday) {
    let tot = 0;
    for (let k = 0; k < 7; k++) {
      const d = plAddD(monday, k), iso = plIso(d);
      const sl = plSlots(c, d), ab = plAbs(c, iso);
      if (sl[0] && !ab[0]) tot += plDurOf(sl[0]);
      if (sl[1] && !ab[1]) tot += plDurOf(sl[1]);
    }
    return Math.round(tot * 4) / 4;
  }
  // base contractuelle applicable (moyenne du cycle si elle varie — cf. J-Claude 34,5/35,5)
  function plBase(c) { return c.base != null ? c.base : null; }

  // ---------- couverture ----------
  function plSeuilComptoir(date, demi) {
    const p = P(); const arr = p.seuilsComptoir || [];
    const jr = plDayKey(date);
    const s = arr.find(x => x.jour === jr && (x.demi === demi || !x.demi));
    return s ? s.mini : (p.seuilComptoirDefaut != null ? p.seuilComptoirDefaut : 6);
  }
  function plSeuilPh(date, demi) {
    const p = P(); const arr = p.seuilsPharmaciens || [];
    const jr = plDayKey(date);
    const s = arr.find(x => x.jour === jr && x.demi === demi);
    return s ? s.mini : 1;
  }
  // effectifs présents une demi-journée, par POSITION : {cpt, back, logi, ph, avOk}
  // cpt = disponibles au comptoir (pharmaciens + préparateurs en C + étudiants) ;
  // back = back-office (préparateurs en B, secrétariat) ; logi = logisticiens (compteur à part) ;
  // entretien hors effectif.
  function plEffectif(date, demi) {
    const iso = plIso(date); const h = demi === 'M' ? 0 : 1;
    let cpt = 0, back = 0, logi = 0, ph = 0, avPresent = false;
    L('contrats').forEach(c => {
      if (c.actif === false) return;
      const sl = plSlots(c, date), ab = plAbs(c, iso);
      if (!sl[h] || ab[h]) return;                       // pas présent cette demi-journée
      const rot = plRotOf(c), rang = String(plRang(rot, date));
      const pos = plPosOf(c, rang, plDayKey(date), h);
      if (c.estPharmacien) { ph++; cpt++; return; }      // pharmacien : toujours comptoir
      if (c.grp === 'entretien') return;                 // hors effectif
      if (c.grp === 'logi') { logi++; return; }          // logistique : compteur dédié
      if (pos === 'A') { avPresent = true; return; }     // poste avancé : jamais compté comptoir
      if (pos === 'B') { back++; return; }               // back-office : pas disponible comptoir
      cpt++;                                             // position C
    });
    // R3 : esthéticienne (ou position A) absente → une préparatrice couvre le poste avancé,
    // automatiquement décomptée du comptoir (généralisation de SI(Allison=0 ; nb−1 ; nb)).
    const avContrat = L('contrats').find(c => c.grp === 'avance' && c.actif !== false);
    let avCouvert = avPresent;
    if (avContrat && !avPresent && cpt > 0) { cpt -= 1; avCouvert = true; }
    return { cpt: cpt, back: back, logi: logi, ph: ph, avOk: avCouvert };
  }

  // ---------- état ----------
  let plView = 'sem';
  let plAnchor = plMonday(new Date());
  let plFiltreGrp = '';

  // ---------- CSS (scopé pl-) — charte « douceur officinale » ----------
  const PL_CSS = `
  #sec-planning{padding:0}
  .pl-wrap{max-width:1240px;margin:0 auto}
  .pl-vars{--plbg:#F8F5F4;--plink:#25282A;--plmut:#71787A;--plline:#E9E2E1;
    --plac:#348466;--placs:#E6F1EB;--plrose:#D26E96;--plroses:#FAEAF1;--plrosei:#B04A74;
    --plok:#2E8564;--plwarn:#B8821C;--plcrit:#C4544A;
    --plcp:#4173AC;--plcpb:#E8EFF7;--plmal:#C4544A;--plmalb:#FAE9E7;
    --plrec:#8A63C9;--plrecb:#F0EAFA;--plfor:#B8821C;--plforb:#F8F0DE}
  .pl-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px}
  .pl-title{font-size:1.05rem;font-weight:700;margin-right:4px}
  .pl-title .t2{color:var(--plrosei)}
  .pl-seg{display:inline-flex;background:#EFECEA;border-radius:9px;padding:3px}
  .pl-seg button{border:none;background:none;padding:6px 14px;border-radius:7px;font-size:13px;
    font-weight:600;color:#5A615F;cursor:pointer;font-family:inherit}
  .pl-seg button.pl-act{background:#fff;color:var(--plac);box-shadow:0 1px 3px rgba(70,40,55,.14)}
  .pl-nav{display:flex;align-items:center;gap:5px}
  .pl-nav button{border:1px solid var(--plline);background:#fff;border-radius:7px;width:29px;height:29px;
    color:var(--plmut);font-weight:700;cursor:pointer;font-family:inherit}
  .pl-nav .pl-lbl{font-weight:700;font-size:.95rem;min-width:205px;text-align:center}
  .pl-grow{flex:1}
  .pl-btn{border:none;border-radius:9px;padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer;
    display:inline-flex;align-items:center;gap:6px;font-family:inherit}
  .pl-btn.pl-pri{background:var(--plac);color:#fff}
  .pl-btn.pl-rose{background:var(--plrose);color:#fff}
  .pl-btn.pl-ghost{background:#fff;border:1px solid var(--plline);color:#333}
  .pl-sel{font-family:inherit;font-size:13px;border:1px solid var(--plline);border-radius:8px;
    background:#fff;height:34px;padding:0 9px;color:#222}
  .pl-legend{display:flex;gap:12px;align-items:center;margin:0 0 12px;font-size:11.5px;color:var(--plmut);flex-wrap:wrap}
  .pl-chip{display:inline-flex;align-items:center;gap:5px;font-weight:600;padding:2px 10px;border-radius:20px;font-size:11px}
  .pl-chip i{width:7px;height:7px;border-radius:50%;display:inline-block}
  .pl-ch-cp{background:var(--plcpb);color:var(--plcp)}.pl-ch-cp i{background:var(--plcp)}
  .pl-ch-mal{background:var(--plmalb);color:var(--plmal)}.pl-ch-mal i{background:var(--plmal)}
  .pl-ch-rec{background:var(--plrecb);color:var(--plrec)}.pl-ch-rec i{background:var(--plrec)}
  .pl-ch-for{background:var(--plforb);color:var(--plfor)}.pl-ch-for i{background:var(--plfor)}
  .pl-card{background:#fff;border:1px solid var(--plline);border-radius:16px;overflow:auto;
    box-shadow:0 2px 10px rgba(70,40,55,.05)}
  .pl-card table{width:100%;border-collapse:collapse;font-size:12.5px}
  .pl-card th,.pl-card td{border-bottom:1px solid var(--plline);padding:0;text-align:left;vertical-align:top}
  .pl-card thead th{background:#fff;padding:9px 10px;border-bottom:2px solid var(--plline)}
  .pl-dayn{font-weight:700;font-size:12.5px}
  .pl-dayd{color:var(--plmut);font-weight:500;font-size:10.5px}
  .pl-cnt{display:flex;gap:4px;margin-top:5px;flex-wrap:wrap}
  .pl-pill{border-radius:6px;padding:1px 7px;font-size:10.5px;font-weight:700;font-variant-numeric:tabular-nums;
    display:inline-flex;align-items:center;gap:4px}
  .pl-pill.ok{background:#E1F1E7;color:var(--plok)}
  .pl-pill.lim{background:#F8F0DE;color:var(--plwarn)}
  .pl-pill.bad{background:#FAE3E0;color:var(--plcrit)}
  .pl-dotph{width:7px;height:7px;border-radius:50%;display:inline-block}
  .pl-dotph.ok{background:var(--plok)}.pl-dotph.bad{background:var(--plcrit)}
  .pl-who{padding:8px 10px 8px 14px;width:172px;min-width:172px}
  .pl-who b{font-size:12.5px;display:block}
  .pl-who small{color:var(--plmut);font-size:10px;font-weight:500}
  .pl-hrs{margin-top:3px;font-size:10.5px;font-weight:600;font-variant-numeric:tabular-nums}
  .pl-hrs.good{color:var(--plok)}.pl-hrs.bad{color:var(--plcrit)}
  .pl-grp td{background:linear-gradient(90deg,var(--placs),#FDF6F9);padding:4px 14px;font-size:10.5px;
    font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:var(--plac)}
  .pl-cell{padding:5px 6px;min-height:50px}
  .pl-shift{background:var(--placs);border-left:3px solid var(--plac);border-radius:6px;padding:3px 7px;
    margin:2px 0;font-size:10.5px;font-weight:600;color:#0B5B44;font-variant-numeric:tabular-nums;white-space:nowrap}
  .pl-shift.early{border-left-color:var(--plrose);background:var(--plroses);color:var(--plrosei)}
  .pl-abs{border-radius:6px;padding:3px 7px;margin:2px 0;font-size:10px;font-weight:700;
    text-transform:uppercase;letter-spacing:.4px;white-space:nowrap}
  .pl-abs.cp{background:var(--plcpb);color:var(--plcp)}.pl-abs.mal{background:var(--plmalb);color:var(--plmal)}
  .pl-abs.rec{background:var(--plrecb);color:var(--plrec)}.pl-abs.for{background:var(--plforb);color:var(--plfor)}
  .pl-off{color:#C3CDC7;font-size:10px;padding:6px 7px}
  .pl-cntrow td{background:#FBFAF9;border-bottom:2px solid var(--plline);padding:5px 6px}
  .pl-cntlbl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--plmut)}
  .pl-pill.nt{background:#EDF0F4;color:#4A5B74}
  .pl-pill.lg{background:#EAF0E6;color:#4F6B3F}
  .pl-pill b{font-variant-numeric:tabular-nums}
  .pl-shift{position:relative;padding-right:20px}
  .pl-shift.pl-pB{border-left-color:#5B7BA8;background:#E9EFF6;color:#2C4A78}
  .pl-shift.pl-pA{border-left-color:var(--plrose);background:var(--plroses);color:var(--plrosei)}
  .pl-pos{position:absolute;right:3px;top:50%;transform:translateY(-50%);font-style:normal;font-size:8.5px;
    font-weight:800;width:13px;height:13px;border-radius:4px;display:inline-flex;align-items:center;justify-content:center}
  .pl-pos-C{background:#CFE7DA;color:#0B5B44}.pl-pos-B{background:#C9D8EC;color:#2C4A78}.pl-pos-A{background:#F2CBDC;color:var(--plrosei)}
  .pl-shift.pl-part{border-left-color:var(--plwarn);background:var(--plforb);color:#7A5A10}
  .pl-shift.pl-click{cursor:pointer}
  .pl-shift.pl-click:hover{filter:brightness(.94);box-shadow:0 1px 4px rgba(70,40,55,.18)}
  .pl-chip.pl-ch-part{background:var(--plforb);color:var(--plwarn)}.pl-chip.pl-ch-part i{background:var(--plwarn)}
  .pl-empty{color:var(--plmut);text-align:center;padding:44px 12px;line-height:1.6}
  .pl-empty b{font-size:1rem;color:var(--plink)}
  /* mois */
  .pl-mo th{font-size:10px;color:var(--plmut);padding:6px 2px 4px;font-weight:600;min-width:25px;text-align:center}
  .pl-mo th b{display:block;font-size:11px;color:var(--plink)}
  .pl-mo td{text-align:center}
  .pl-mo .pl-who{border-right:1px solid var(--plline)}
  .pl-dd{display:flex;flex-direction:column;gap:2px;align-items:center;padding:5px 3px}
  .pl-tick{width:15px;height:8px;border-radius:3px;background:#EDF2EF}
  .pl-tick.on{background:var(--plac);opacity:.72}
  .pl-tick.cp{background:var(--plcp)}.pl-tick.mal{background:var(--plmal)}
  .pl-tick.rec{background:var(--plrec)}.pl-tick.for{background:var(--plfor)}
  .pl-wee{background:#F7F4F2}
  .pl-mini{width:17px;margin:1px auto;border-radius:4px;font-size:8.5px;font-weight:800;line-height:12px;
    text-align:center;font-variant-numeric:tabular-nums}
  .pl-mini-ok{background:#DDEFE4;color:var(--plok)}
  .pl-mini-lim{background:#F5E9CC;color:var(--plwarn)}
  .pl-mini-bad{background:#F6DAD6;color:var(--plcrit)}
  .pl-av{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px;vertical-align:baseline}
  /* année */
  .pl-yr td{padding:3px 6px}
  .pl-yr .pl-strip{display:flex;gap:1px}
  .pl-yr .pl-dt{width:3px;height:14px;border-radius:1px;background:#EFF3F0;flex:0 0 auto}
  .pl-yr .pl-dt.on{background:#CBDED3}
  .pl-yr .pl-dt.cp{background:var(--plcp)}.pl-yr .pl-dt.mal{background:var(--plmal)}
  .pl-yr .pl-dt.rec{background:var(--plrec)}.pl-yr .pl-dt.for{background:var(--plfor)}
  /* modales */
  .pl-ov{position:fixed;inset:0;z-index:11000;display:none;align-items:flex-start;justify-content:center;
    background:rgba(30,20,26,.45);padding:4vh 16px;overflow:auto}
  .pl-ov.pl-on{display:flex}
  .pl-box{background:#fff;border-radius:16px;box-shadow:0 22px 60px rgba(0,0,0,.35);padding:22px 24px;
    width:min(880px,96vw);max-height:90vh;overflow:auto}
  .pl-box h3{margin:0 0 4px;font-size:1.02rem}
  .pl-box .pl-sub{color:var(--plmut);font-size:12px;margin-bottom:14px}
  .pl-form{display:flex;flex-wrap:wrap;gap:10px}
  .pl-form label{display:flex;flex-direction:column;gap:4px;font-size:11.5px;color:var(--plmut);font-weight:600}
  .pl-inp{font-family:inherit;font-size:13px;border:1px solid var(--plline);border-radius:8px;background:#fff;
    height:36px;padding:0 10px;color:#222}
  .pl-inp:focus{border-color:var(--plac);outline:none}
  .pl-tt{width:100%;border-collapse:collapse;font-size:12px;margin-top:8px}
  .pl-tt th,.pl-tt td{border:1px solid var(--plline);padding:4px 6px;text-align:center}
  .pl-tt th{background:var(--placs);font-size:10.5px;text-transform:uppercase;letter-spacing:.4px;color:var(--plac)}
  .pl-tt input{width:86px;border:none;font-family:inherit;font-size:12px;text-align:center;outline:none;
    font-variant-numeric:tabular-nums}
  .pl-tt input:focus{background:var(--plroses)}
  .pl-actions{display:flex;gap:9px;justify-content:flex-end;margin-top:16px;flex-wrap:wrap}
  .pl-toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%) translateY(120px);z-index:12000;
    background:#25282A;color:#fff;border-radius:10px;padding:10px 18px;font-size:13px;font-weight:600;
    transition:transform .25s;box-shadow:0 8px 26px rgba(0,0,0,.3)}
  .pl-toast.pl-on{transform:translateX(-50%) translateY(0)}
  .pl-note{font-size:11px;color:var(--plmut);margin-top:10px;line-height:1.5}
  .pl-tabsC{display:inline-flex;background:#EFECEA;border-radius:9px;padding:3px;margin-bottom:12px}
  .pl-tabsC button{border:none;background:none;padding:6px 13px;border-radius:7px;font-size:12.5px;
    font-weight:600;color:#5A615F;cursor:pointer;font-family:inherit}
  .pl-tabsC button.pl-act{background:#fff;color:var(--plac);box-shadow:0 1px 3px rgba(70,40,55,.14)}
  .pl-list{width:100%;border-collapse:collapse;font-size:12.5px}
  .pl-list th{font-size:10.5px;text-transform:uppercase;letter-spacing:.4px;color:var(--plmut);
    text-align:left;padding:7px 8px;border-bottom:2px solid var(--plline)}
  .pl-list td{padding:7px 8px;border-bottom:1px solid var(--plline)}
  .pl-mini{padding:3px 9px;font-size:11px;border-radius:7px}
  `;

  // ---------- section ----------
  const PL_SECTION = `
  <div class="pl-wrap pl-vars">
    <div class="pl-bar">
      <span class="pl-title"><span style="color:var(--plac)">Plan</span><span class="t2">ning</span></span>
      <div class="pl-seg" id="pl-seg">
        <button data-v="sem" class="pl-act" onclick="plSetView('sem')">Semaine</button>
        <button data-v="mois" onclick="plSetView('mois')">Mois</button>
        <button data-v="an" onclick="plSetView('an')">Année</button>
      </div>
      <div class="pl-nav">
        <button onclick="plNav(-1)">‹</button><span class="pl-lbl" id="pl-lbl"></span><button onclick="plNav(1)">›</button>
        <button style="width:auto;padding:0 10px;font-size:12px" onclick="plToday()">Aujourd'hui</button>
      </div>
      <span class="pl-grow"></span>
      <select class="pl-sel" id="pl-fgrp" onchange="plFiltre(this.value)"><option value="">Toute l'équipe</option></select>
      <button class="pl-btn pl-rose" onclick="plOpenTrames()">🗓 Trames horaires</button>
      <button class="pl-btn pl-ghost" id="pl-btn-reg" onclick="plOpenReglages()">⚙ Réglages</button>
    </div>
    <div class="pl-legend">
      <span style="font-weight:700;color:var(--plink)">Motifs</span>
      <span class="pl-chip pl-ch-cp"><i></i>Congés</span>
      <span class="pl-chip pl-ch-mal"><i></i>Maladie</span>
      <span class="pl-chip pl-ch-rec"><i></i>Récupération</span>
      <span class="pl-chip pl-ch-for"><i></i>Formation</span>
      <span class="pl-chip pl-ch-part"><i></i>Comptoir partiel</span>
      <span style="font-size:10.5px">Compteurs : <b>présents/seuil</b>, hors poste avancé</span>
      <span style="margin-left:auto" id="pl-info"></span>
    </div>
    <div id="pl-body"></div>
    <div class="pl-note">Planning théorique calculé depuis la trame type et les rotations. Un créneau <b>comptoir partiel</b> (ambre)
    ne couvre pas toute la plage d'ouverture (9h00-12h30 / 14h00-19h30) — typiquement une fin à 18h30.
    🚚 = aucun logisticien présent sur la fenêtre de livraisons (15h-18h) : désigner un responsable des livraisons ce jour-là.
    Les absences, demandes de congés et compteurs arrivent aux lots suivants.</div>
  </div>`;

  // ---------- modales (réglages + trame) ----------
  const PL_MODALS = `
  <div class="pl-ov pl-vars" id="pl-ov-reg"><div class="pl-box">
    <h3>Réglages du planning</h3>
    <div class="pl-sub">Rotations, seuils d'alerte et contrats. Les seuils déclenchent les alertes de couverture (règles R1 bis et R2 du cahier des charges).</div>
    <div class="pl-tabsC">
      <button id="pl-rt-t" onclick="plRegTab('t')">Trames horaires</button>
      <button id="pl-rt-c" class="pl-act" onclick="plRegTab('c')">Contrats</button>
      <button id="pl-rt-r" onclick="plRegTab('r')">Rotations</button>
      <button id="pl-rt-s" onclick="plRegTab('s')">Seuils d'alerte</button>
    </div>
    <div id="pl-reg-body"></div>
    <div class="pl-actions"><button class="pl-btn pl-ghost" onclick="plClose('pl-ov-reg')">Fermer</button></div>
  </div></div>
  <div class="pl-ov pl-vars" id="pl-ov-trame"><div class="pl-box">
    <h3 id="pl-tr-title">Trame</h3>
    <div class="pl-sub">Horaires type par demi-journée (format <b>9h-12h30</b>). Laisser vide = repos. Le total se recalcule en direct.</div>
    <div id="pl-tr-body"></div>
    <div class="pl-actions">
      <button class="pl-btn pl-ghost" onclick="plClose('pl-ov-trame')">Annuler</button>
      <button class="pl-btn pl-pri" onclick="plSaveTrame()">Enregistrer la trame</button>
    </div>
  </div></div>
  <div class="pl-toast" id="pl-toast"></div>`;

  // ---------- injection ----------
  function plInject() {
    if (document.getElementById('pl-css')) return;
    const st = document.createElement('style'); st.id = 'pl-css'; st.textContent = PL_CSS; document.head.appendChild(st);
    const navRef = document.querySelector('.sb-item[data-sec="caisse"]') || document.querySelector('.sb-item[data-sec="livraisons"]');
    if (navRef && !document.querySelector('.sb-item[data-sec="planning"]')) {
      const b = document.createElement('button');
      b.className = 'sb-item'; b.setAttribute('data-sec', 'planning');
      b.setAttribute('onclick', "showSec('planning',this)");
      b.innerHTML = '<svg class="ico sb-ico"><use href="#ic-calendrier"></use></svg><span class="sb-label">Planning</span>';
      navRef.insertAdjacentElement('afterend', b);
    }
    const secRef = document.getElementById('sec-livraisons');
    if (secRef && !document.getElementById('sec-planning')) {
      const sec = document.createElement('section');
      sec.id = 'sec-planning'; sec.className = 'sec'; sec.innerHTML = PL_SECTION;
      secRef.parentNode.appendChild(sec);
      const fg = document.getElementById('pl-fgrp');
      Object.keys(PL_GRPS).forEach(g => { const o = document.createElement('option'); o.value = g; o.textContent = PL_GRPS[g].lbl; fg.appendChild(o); });
    }
    if (!document.getElementById('pl-ov-reg')) document.body.insertAdjacentHTML('beforeend', PL_MODALS);
  }
  window.plOpen = function (id) { document.getElementById(id).classList.add('pl-on'); };
  window.plClose = function (id) { document.getElementById(id).classList.remove('pl-on'); };

  // ---------- navigation ----------
  window.plSetView = function (v) {
    plView = v;
    document.querySelectorAll('#pl-seg button').forEach(b => b.classList.toggle('pl-act', b.dataset.v === v));
    plRender();
  };
  window.plNav = function (dir) {
    if (plView === 'sem') plAnchor = plAddD(plAnchor, dir * 7);
    else if (plView === 'mois') { const x = new Date(plAnchor); x.setMonth(x.getMonth() + dir); plAnchor = x; }
    else plAnchor = new Date(plAnchor.getFullYear() + dir, 0, 5);
    plRender();
  };
  window.plToday = function () { plAnchor = plMonday(new Date()); plRender(); };
  window.plFiltre = function (g) { plFiltreGrp = g; plRender(); };

  function plTit(c) { return /titulaire/i.test(c.role || '') ? 0 : 1; }
  function plContratsVisibles() {
    return L('contrats')
      .filter(c => c.actif !== false)
      .filter(c => !plFiltreGrp || c.grp === plFiltreGrp)
      .sort((a, b) => (PL_GRPS[a.grp] || { ord: 99 }).ord - (PL_GRPS[b.grp] || { ord: 99 }).ord
        || plTit(a) - plTit(b) || (a.nom || '').localeCompare(b.nom || ''));
  }

  // ---------- rendu principal ----------
  window.plRender = function () {
    plInject();
    plMigrate();
    const body = document.getElementById('pl-body');
    if (!body) return;
    if (!L('contrats').length) {
      body.innerHTML = '<div class="pl-card"><div class="pl-empty"><b>Le planning n’est pas encore initialisé.</b><br>'
        + 'Importez la trame type du 1er septembre 2026 (18 collaborateurs, rotations et seuils) pour démarrer.<br><br>'
        + '<button class="pl-btn pl-pri" onclick="plSeed()">Importer la trame du 01/09/2026</button></div></div>';
      document.getElementById('pl-lbl').textContent = '';
      return;
    }
    if (plView === 'sem') plRenderSem();
    else if (plView === 'mois') plRenderMois();
    else plRenderAn();
  };

  // ── vue Semaine ──
  function plRenderSem() {
    const mon = plMonday(plAnchor);
    document.getElementById('pl-lbl').textContent = 'Semaine du ' + mon.getDate() + ' ' + PL_MOIS_FR[mon.getMonth()] + ' ' + mon.getFullYear();
    const days = []; for (let k = 0; k < 6; k++) days.push(plAddD(mon, k));
    const rotL = L('rotations').map(r => r.lbl + ' S' + plRang(r, mon)).join(' · ');
    document.getElementById('pl-info').textContent = rotL;
    let h = '<div class="pl-card"><table><thead><tr><th class="pl-who"></th>';
    days.forEach(d => {
      const eM = plEffectif(d, 'M'), eA = plEffectif(d, 'AM');
      const sM = plSeuilComptoir(d, 'M'), sA = plSeuilComptoir(d, 'AM');
      const pM = plSeuilPh(d, 'M'), pA = plSeuilPh(d, 'AM');
      function pill(e, s, p, lbl) {
        const k = (e.cpt < s || e.ph < 1) ? 'bad' : (e.cpt === s || e.ph < p) ? 'lim' : 'ok';
        return '<span class="pl-pill ' + k + '" title="' + e.cpt + ' disponibles au comptoir / seuil ' + s + ' (hors poste avancé) · pharmaciens ' + e.ph + '/' + p + (e.avOk ? '' : ' · poste avancé non tenu') + '">'
          + '<span class="pl-dotph ' + (e.ph > 0 ? 'ok' : 'bad') + '"></span>' + lbl + ' ' + e.cpt + '/' + s + '</span>';
      }
      h += '<th><div class="pl-dayn">' + PL_JOURS_FR[(d.getDay() + 6) % 7] + '</div>'
        + '<div class="pl-dayd">' + d.getDate() + ' ' + PL_MOIS_FR[d.getMonth()] + '</div>'
        + '<div class="pl-cnt">' + pill(eM, sM, pM, 'M') + pill(eA, sA, pA, 'AM') + '</div></th>';
    });
    h += '</tr></thead><tbody>';
    // ── compteurs par demi-journée (repris d'OffiPlanning) : disponibles COMPTOIR + BACK-OFFICE ──
    h += '<tr class="pl-cntrow"><td class="pl-who pl-cntlbl">Comptoir</td>';
    days.forEach(d => {
      const eM = plEffectif(d, 'M'), eA = plEffectif(d, 'AM');
      const sM = plSeuilComptoir(d, 'M'), sA = plSeuilComptoir(d, 'AM');
      function cp(e, s, lbl) {
        const k = e.cpt < s ? 'bad' : (e.cpt === s ? 'lim' : 'ok');
        const tt = e.cpt + ' disponibles au comptoir (pharmaciens + préparateurs en position comptoir, HORS poste avancé) pour un seuil de ' + s
          + (e.avOk ? '' : ' — poste avancé non tenu');
        return '<span class="pl-pill ' + k + '" title="' + tt + '">' + lbl + ' <b>' + e.cpt + '</b>/' + s + '</span>';
      }
      h += '<td><div class="pl-cnt">' + cp(eM, sM, 'M') + cp(eA, sA, 'AM') + '</div></td>';
    });
    h += '</tr><tr class="pl-cntrow"><td class="pl-who pl-cntlbl">Back-office</td>';
    days.forEach(d => {
      const eM = plEffectif(d, 'M'), eA = plEffectif(d, 'AM');
      h += '<td><div class="pl-cnt"><span class="pl-pill nt">M <b>' + eM.back + '</b></span><span class="pl-pill nt">AM <b>' + eA.back + '</b></span>'
        + (eM.avOk && eA.avOk ? '' : '<span class="pl-pill bad">poste avancé ?</span>') + '</div></td>';
    });
    h += '</tr><tr class="pl-cntrow"><td class="pl-who pl-cntlbl">Logistique</td>';
    days.forEach(d => {
      const eM = plEffectif(d, 'M'), eA = plEffectif(d, 'AM');
      const liv = plLivraisonsCouvertes(d);
      h += '<td><div class="pl-cnt"><span class="pl-pill lg">M <b>' + eM.logi + '</b></span><span class="pl-pill lg">AM <b>' + eA.logi + '</b></span>'
        + (liv ? '' : '<span class="pl-pill bad" title="Livraisons 15h-18h : aucun logisticien présent sur la fenêtre — désigner un responsable des livraisons">🚚 resp. ?</span>')
        + '</div></td>';
    });
    h += '</tr>';
    let lastGrp = null;
    plContratsVisibles().forEach(c => {
      if (c.grp !== lastGrp) { lastGrp = c.grp; h += '<tr class="pl-grp"><td colspan="7">' + plEsc((PL_GRPS[c.grp] || { lbl: c.grp }).lbl) + '</td></tr>'; }
      const planned = plHeuresSemaine(c, mon), base = plBase(c);
      const cls = base == null ? '' : (Math.abs(planned - base) < 0.26 ? 'good' : 'bad');
      let cells = '';
      days.forEach(d => {
        const iso = plIso(d), sl = plSlots(c, d), ab = plAbs(c, iso);
        const rotC = plRotOf(c), rangC = String(plRang(rotC, d));
        let cell = '';
        for (let hh = 0; hh < 2; hh++) {
          if (ab[hh]) cell += '<div class="pl-abs ' + ab[hh] + '">' + (PL_MOTIFS[ab[hh]] || ab[hh]) + '</div>';
          else if (sl[hh]) {
            const pos = plPosOf(c, rangC, plDayKey(d), hh);
            const posBadge = (pos !== 'C' || PL_POS_CHOIX[c.grp]) ? '<i class="pl-pos pl-pos-' + pos + '" title="' + PL_POS_LBL[pos] + '">' + pos + '</i>' : '';
            const part = pos === 'C' && plPartiel(sl[hh], hh ? 'AM' : 'M');
            const clic = PL_POS_CHOIX[c.grp]
              ? ' pl-click" onclick="plCyclePos(\'' + c.id + '\',\'' + rangC + '\',\'' + plDayKey(d) + '\',' + hh + ')" title="'
                + plEsc((part ? plPartielTitle(sl[hh], hh ? 'AM' : 'M') + ' — ' : '') + PL_POS_LBL[pos] + ' · cliquer pour changer de position (semaine type)') + '"'
              : (part ? '" title="' + plEsc(plPartielTitle(sl[hh], hh ? 'AM' : 'M')) + '"' : '"');
            cell += '<div class="pl-shift pl-p' + pos + (part ? ' pl-part' : '') + clic + '>' + plEsc(sl[hh]) + posBadge + '</div>';
          }
        }
        cells += '<td class="pl-cell">' + (cell || '<div class="pl-off">repos</div>') + '</td>';
      });
      h += '<tr><td class="pl-who"><b>' + plEsc(c.nom) + '</b><small>' + plEsc(c.role || '') + '</small>'
        + '<div class="pl-hrs ' + cls + '">' + plFmtH(planned) + (base != null ? ' / ' + plFmtH(base) : '') + '</div></td>' + cells + '</tr>';
    });
    h += '</tbody></table></div>';
    document.getElementById('pl-body').innerHTML = h;
  }

  // ── vue Mois ──
  function plRenderMois() {
    const y = plAnchor.getFullYear(), m = plAnchor.getMonth();
    const lbl = PL_MOIS_FR[m]; document.getElementById('pl-lbl').textContent = lbl.charAt(0).toUpperCase() + lbl.slice(1) + ' ' + y;
    document.getElementById('pl-info').textContent = '';
    const nd = new Date(y, m + 1, 0).getDate();
    let h = '<div class="pl-card pl-mo"><table><thead><tr><th class="pl-who"></th>';
    for (let d = 1; d <= nd; d++) { const dt = new Date(y, m, d); h += '<th class="' + (dt.getDay() === 0 ? 'pl-wee' : '') + '">' + PL_JOURS_FR[(dt.getDay() + 6) % 7].slice(0, 2).toLowerCase() + '<b>' + d + '</b></th>'; }
    h += '</tr></thead><tbody>';
    let lastGrp = null;
    plContratsVisibles().forEach(c => {
      if (c.grp !== lastGrp) { lastGrp = c.grp; h += '<tr class="pl-grp"><td colspan="' + (nd + 1) + '">' + plEsc((PL_GRPS[c.grp] || { lbl: c.grp }).lbl) + '</td></tr>'; }
      h += '<tr><td class="pl-who"><b>' + plEsc(c.nom) + '</b><small>' + plEsc(c.role || '') + '</small></td>';
      for (let d = 1; d <= nd; d++) {
        const dt = new Date(y, m, d, 12), iso = plIso(dt);
        const sl = plSlots(c, dt), ab = plAbs(c, iso);
        let cell = '';
        for (let hh = 0; hh < 2; hh++) {
          let cls = 'pl-tick';
          if (ab[hh]) cls += ' ' + ab[hh];
          else if (sl[hh]) cls += ' on';
          cell += '<span class="' + cls + '"></span>';
        }
        h += '<td class="' + (dt.getDay() === 0 ? 'pl-wee' : '') + '"><div class="pl-dd">' + cell + '</div></td>';
      }
      h += '</tr>';
    });
    // ── compteur Comptoir par jour (M/AM vs seuil, hors poste avancé) ──
    h += '</tbody><tfoot><tr><td class="pl-who pl-cntlbl" style="border-top:2px solid var(--plline)">Comptoir</td>';
    for (let d = 1; d <= nd; d++) {
      const dt = new Date(y, m, d, 12);
      let cell = '';
      if (dt.getDay() !== 0) {
        ['M', 'AM'].forEach(demi => {
          const e = plEffectif(dt, demi), s2 = plSeuilComptoir(dt, demi);
          const k = e.cpt < s2 ? 'bad' : (e.cpt === s2 ? 'lim' : 'ok');
          cell += '<div class="pl-mini pl-mini-' + k + '" title="' + PL_JOURS_FR[(dt.getDay() + 6) % 7] + ' ' + d + ' · ' + (demi === 'M' ? 'matin' : 'après-midi') + ' : ' + e.cpt + ' disponibles au comptoir / seuil ' + s2 + ' (hors poste avancé)">' + e.cpt + '</div>';
        });
      }
      h += '<td class="' + (dt.getDay() === 0 ? 'pl-wee' : '') + '" style="border-top:2px solid var(--plline)">' + cell + '</td>';
    }
    h += '</tr></tfoot></table></div>';
    document.getElementById('pl-body').innerHTML = h;
  }

  // ── vue Année ──
  function plRenderAn() {
    const y = plAnchor.getFullYear();
    document.getElementById('pl-lbl').textContent = 'Année ' + y;
    document.getElementById('pl-info').textContent = 'Les absences ressortent en couleur de motif';
    const start = new Date(y, 0, 1, 12), end = new Date(y + 1, 0, 1, 12);
    let heads = '<div style="display:flex">';
    for (let mm = 0; mm < 12; mm++) { const ndm = new Date(y, mm + 1, 0).getDate(); heads += '<span style="width:' + (ndm * 4) + 'px;flex:0 0 auto;font-size:10px;color:#71787A">' + PL_MOIS_FR[mm].slice(0, 4) + '</span>'; }
    heads += '</div>';
    let h = '<div class="pl-card pl-yr"><table><thead><tr><th class="pl-who"></th><th style="padding:6px 6px 2px">' + heads + '</th></tr></thead><tbody>';
    let lastGrp = null;
    plContratsVisibles().forEach(c => {
      if (c.grp !== lastGrp) { lastGrp = c.grp; h += '<tr class="pl-grp"><td colspan="2">' + plEsc((PL_GRPS[c.grp] || { lbl: c.grp }).lbl) + '</td></tr>'; }
      let strip = '', d = new Date(start);
      while (d < end) {
        const sl = plSlots(c, d), ab = plAbs(c, plIso(d));
        let cls = 'pl-dt';
        if (ab[0] || ab[1]) cls += ' ' + (ab[0] || ab[1]);
        else if (sl[0] || sl[1]) cls += ' on';
        strip += '<span class="' + cls + '"></span>';
        d = plAddD(d, 1);
      }
      h += '<tr><td class="pl-who"><b>' + plEsc(c.nom) + '</b></td><td><div class="pl-strip">' + strip + '</div></td></tr>';
    });
    h += '</tbody></table></div>';
    document.getElementById('pl-body').innerHTML = h;
  }

  // ---------- réglages ----------
  let plRegView = 'c';
  let plTrRotSel = 'rot:prep', plTrRangSel = 1;
  window.plOpenReglages = function () { plRegView = 'c'; plRegRender(); plOpen('pl-ov-reg'); };
  window.plOpenTrames = function () { plRegView = 't'; plRegRender(); plOpen('pl-ov-reg'); };
  window.plRegTab = function (t) { plRegView = t; plRegRender(); };
  window.plTrSel = function (rid, rang) { if (rid) plTrRotSel = rid; plTrRangSel = +rang; plRegRender(); };
  function plRegRender() {
    ['t', 'c', 'r', 's'].forEach(t => { const b = document.getElementById('pl-rt-' + t); if (b) b.classList.toggle('pl-act', t === plRegView); });
    const el = document.getElementById('pl-reg-body'); if (!el) return;
    if (plRegView === 't') {
      // ── Trames horaires : TOUTE l'équipe sur une même semaine type, avec les compteurs ──
      // Les cycles diffèrent (Prép 2 sem, Ph 3 sem...) : le motif complet se répète sur le
      // plus petit multiple commun des cycles actifs. Chaque « semaine type k » montre, pour
      // chacun, la semaine de SON cycle qui tombe cette semaine-là — équipe complète, pour
      // vérifier qu'on a le bon nombre de personnes au bon endroit avant de valider la trame.
      const rots = L('rotations').filter(r => L('contrats').some(c => c.actif !== false && c.rotationId === r.id));
      function pgcd(a, b) { return b ? pgcd(b, a % b) : a; }
      let nbTypes = 1;
      rots.forEach(r => { nbTypes = nbTypes * r.longueur / pgcd(nbTypes, r.longueur); });
      nbTypes = Math.min(nbTypes, 12);
      if (plTrRangSel > nbTypes) plTrRangSel = 1;
      const anc0 = rots.length ? rots.map(r => r.ancrage).sort()[0] : plIso(new Date());
      const refDate = plAddD(plMonday(new Date(anc0 + 'T12:00')), (plTrRangSel - 1) * 7);
      function rangDe(c) { return String(plRang(plRotOf(c), refDate)); }
      let selHtml = '<div style="display:flex;gap:6px;align-items:center;margin-bottom:10px;flex-wrap:wrap">'
        + '<span style="font-size:11.5px;font-weight:700;color:var(--plmut);text-transform:uppercase;letter-spacing:.4px">Semaine type :</span>';
      for (let k = 1; k <= nbTypes; k++) {
        const dk = plAddD(plMonday(new Date(anc0 + 'T12:00')), (k - 1) * 7);
        const det = rots.map(r => plEsc(r.lbl) + ' S' + plRang(r, dk)).join(' · ');
        selHtml += '<button class="pl-btn ' + (k === plTrRangSel ? 'pl-pri' : 'pl-ghost') + ' pl-mini" style="flex-direction:column;gap:0;line-height:1.25" onclick="plTrSel(null,' + k + ')">'
          + '<span>Type ' + k + '</span><span style="font-size:8.5px;font-weight:500;opacity:.8">' + det + '</span></button>';
      }
      selHtml += '<span style="font-size:10.5px;color:var(--plmut)">le motif complet se répète toutes les ' + nbTypes + ' semaines</span></div>';
      // compteurs de la semaine type (trame pure, sans absence)
      let cnt = '<table class="pl-tt" style="font-size:10.5px;margin-bottom:8px"><tr><th style="text-align:left">Disponibles</th>'
        + PL_JOURS_FR.slice(0, 6).map(j => '<th colspan="2">' + j.slice(0, 3) + '</th>').join('') + '</tr>'
        + '<tr><th style="text-align:left"></th>' + PL_JOURS.slice(0, 6).map(() => '<th style="font-size:9px">M</th><th style="font-size:9px">AM</th>').join('') + '</tr>';
      ['Comptoir', 'Back-office', 'Logistique'].forEach(lbl => {
        cnt += '<tr><th style="text-align:left">' + lbl + '</th>';
        for (let k = 0; k < 6; k++) {
          const d = plAddD(refDate, k);
          ['M', 'AM'].forEach(demi => {
            const e = plEffectif(d, demi);
            if (lbl === 'Comptoir') {
              const seuil = plSeuilComptoir(d, demi);
              const kk = e.cpt < seuil ? 'bad' : (e.cpt === seuil ? 'lim' : 'ok');
              cnt += '<td><span class="pl-pill ' + kk + '" style="padding:1px 5px"><b>' + e.cpt + '</b>/' + seuil + '</span></td>';
            } else if (lbl === 'Back-office') {
              cnt += '<td><span class="pl-pill nt" style="padding:1px 5px"><b>' + e.back + '</b></span></td>';
            } else {
              const livOk = demi === 'M' ? true : plLivraisonsCouvertes(d);
              cnt += '<td><span class="pl-pill lg" style="padding:1px 5px"><b>' + e.logi + '</b></span>'
                + (livOk ? '' : '<div><span class="pl-pill bad" style="padding:0 4px;font-size:8.5px" title="Livraisons 15h-18h : aucun logisticien — désigner un responsable">🚚?</span></div>') + '</td>';
            }
          });
        }
        cnt += '</tr>';
      });
      cnt += '</table>';
      // grille équipe complète
      let h = selHtml + cnt + '<table class="pl-tt" style="font-size:11px"><tr><th style="text-align:left">Collaborateur</th>'
        + PL_JOURS_FR.slice(0, 6).map(j => '<th>' + j.slice(0, 3) + '</th>').join('') + '<th>Total</th></tr>';
      let lastG = null;
      L('contrats').filter(c => c.actif !== false)
        .sort((a, b) => (PL_GRPS[a.grp] || { ord: 99 }).ord - (PL_GRPS[b.grp] || { ord: 99 }).ord || (a.nom || '').localeCompare(b.nom || ''))
        .forEach(c => {
          if (c.grp !== lastG) { lastG = c.grp; h += '<tr><td colspan="8" style="text-align:left;background:linear-gradient(90deg,var(--placs),#FDF6F9);font-size:9.5px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--plac)">' + plEsc((PL_GRPS[c.grp] || { lbl: c.grp }).lbl) + '</td></tr>'; }
          const rang = rangDe(c);
          const sem = (c.sem && (c.sem[rang] || c.sem['1'])) || {};
          let tot = 0, cells = '';
          PL_JOURS.slice(0, 6).forEach(jr => {
            const day = sem[jr] || [null, null];
            let cell = '';
            for (let hh = 0; hh < 2; hh++) {
              if (day[hh]) {
                tot += plDurOf(day[hh]);
                const pos = plPosOf(c, rang, jr, hh);
                const part = pos === 'C' && plPartiel(day[hh], hh ? 'AM' : 'M');
                const clicT = PL_POS_CHOIX[c.grp]
                  ? ' pl-click" onclick="plCyclePos(\'' + c.id + '\',\'' + rang + '\',\'' + jr + '\',' + hh + ')"'
                  : '"';
                cell += '<div class="pl-shift pl-p' + pos + (part ? ' pl-part' : '') + clicT + ' style="font-size:9.5px;padding:1px 4px;padding-right:16px;margin:1px 0"'
                  + ' title="' + plEsc((part ? plPartielTitle(day[hh], hh ? 'AM' : 'M') + ' — ' : '') + PL_POS_LBL[pos] + (PL_POS_CHOIX[c.grp] ? ' · cliquer pour changer' : '')) + '">' + plEsc(day[hh])
                  + ((pos !== 'C' || PL_POS_CHOIX[c.grp]) ? '<i class="pl-pos pl-pos-' + pos + '">' + pos + '</i>' : '') + '</div>';
              }
            }
            cells += '<td style="padding:2px 3px;min-width:74px">' + (cell || '<span style="color:#C3CDC7;font-size:9px">—</span>') + '</td>';
          });
          const rot = plRotOf(c);
          h += '<tr><td style="text-align:left;white-space:nowrap"><b>' + plEsc(c.nom) + '</b> <span style="font-size:9px;color:var(--plmut)">' + (rot ? plEsc(rot.lbl) + ' S' + rang : '') + '</span><br>'
            + '<button class="pl-btn pl-ghost pl-mini" style="margin-top:2px" onclick="plEditTrame(\'' + c.id + '\')">✎ modifier</button></td>'
            + cells + '<td style="font-weight:700;font-variant-numeric:tabular-nums">' + plFmtH(Math.round(tot * 4) / 4) + '</td></tr>';
        });
      h += '</table><div class="pl-note">Positions : <i class="pl-pos pl-pos-C">C</i> comptoir · <i class="pl-pos pl-pos-B">B</i> back-office · <i class="pl-pos pl-pos-A">A</i> poste avancé. '
        + 'Chaque ligne affiche la semaine du cycle propre au collaborateur (Prép sur 2 semaines pour l’alternance du samedi, Ph sur 3…) — la longueur des cycles se règle dans l’onglet Rotations (1 à 4 semaines). '
        + 'Les compteurs du haut se recalculent à chaque enregistrement : c’est ici qu’on vérifie que la trame met le bon nombre de personnes au bon endroit.</div>';
      el.innerHTML = h;
    } else if (plRegView === 'c') {

      const staff = plStaffList();
      let h = '<table class="pl-list"><tr><th>Collaborateur</th><th>Fonction</th><th>Compte intranet</th><th>Base hebdo</th><th>Rotation</th><th>Trame</th></tr>';
      L('contrats').filter(c => c.actif !== false).sort((a, b) => (PL_GRPS[a.grp] || { ord: 99 }).ord - (PL_GRPS[b.grp] || { ord: 99 }).ord).forEach(c => {
        const rot = plRotOf(c), st = plStaffOf(c);
        let lien;
        if (st) lien = '<span class="pl-av" style="background:' + plEsc(st.col || '#888') + '"></span>' + plEsc(st.prenom + ' ' + st.nom)
          + ' <button class="pl-btn pl-ghost pl-mini" title="Délier" onclick="plSetStaff(\'' + c.id + '\',null)">✕</button>';
        else lien = '<select class="pl-inp" style="height:30px;max-width:170px" onchange="plSetStaff(\'' + c.id + '\',this.value)">'
          + '<option value="">— à relier —</option>'
          + staff.map(s2 => '<option value="' + plEsc(s2.id) + '">' + plEsc(s2.prenom + ' ' + s2.nom) + '</option>').join('') + '</select>';
        h += '<tr><td><b>' + plEsc(c.nom) + '</b>' + (c.estPharmacien ? ' <span class="pl-chip pl-ch-cp" style="font-size:9.5px">Pharmacien</span>' : '') + '</td>'
          + '<td>' + plEsc(c.role || '') + '</td>'
          + '<td>' + lien + '</td>'
          + '<td><input class="pl-inp" style="width:70px;height:30px" value="' + (c.base != null ? c.base : '') + '" onchange="plSetBase(\'' + c.id + '\',this.value)"> h</td>'
          + '<td>' + (rot ? plEsc(rot.lbl) + ' (' + rot.longueur + ' sem)' : '—') + '</td>'
          + '<td><button class="pl-btn pl-ghost pl-mini" onclick="plEditTrame(\'' + c.id + '\')">✎ Horaires</button></td></tr>';
      });
      h += '</table>';
      const sansContrat = staff.filter(s2 => !L('contrats').some(c => c.actif !== false && c.staffId === s2.id));
      if (sansContrat.length) {
        h += '<div style="margin-top:12px"><b style="font-size:12px">Collaborateurs du site sans contrat au planning</b><div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:6px">';
        sansContrat.forEach(s2 => {
          h += '<button class="pl-btn pl-ghost pl-mini" onclick="plCreateFromStaff(\'' + plEsc(s2.id) + '\')">'
            + '<span class="pl-av" style="background:' + plEsc(s2.col || '#888') + '"></span>＋ ' + plEsc(s2.prenom + ' ' + s2.nom) + '</button>';
        });
        h += '</div></div>';
      }
      h += '<div class="pl-note">Le lien avec la liste des collaborateurs du Back Office est fait automatiquement par le nom ; corrigez-le ici si besoin. La pastille reprend la couleur du compte intranet. La base hebdo sert de référence au total de la semaine (vert = conforme, rouge = écart) ; pour un cycle à bases variables (ex. 34,5 / 35,5), saisir la moyenne.</div>';
      el.innerHTML = h;
    } else if (plRegView === 'r') {
      let h = '<table class="pl-list"><tr><th>Rotation</th><th>Cycle</th><th>Semaine en cours</th><th>Ancrage</th></tr>';
      L('rotations').forEach(r => {
        h += '<tr><td><b>' + plEsc(r.lbl) + '</b></td>'
          + '<td><select class="pl-inp" style="height:30px;width:130px" onchange="plSetLongueur(\'' + r.id + '\',this.value)">'
          + [1, 2, 3, 4].map(n => '<option value="' + n + '"' + (r.longueur === n ? ' selected' : '') + '>' + n + ' semaine' + (n > 1 ? 's' : '') + '</option>').join('')
          + '</select></td>'
          + '<td>Semaine ' + plRang(r, new Date()) + '</td>'
          + '<td><input type="date" class="pl-inp" style="height:30px" value="' + plEsc(r.ancrage) + '" onchange="plSetAncrage(\'' + r.id + '\',this.value)"> = semaine ' + (r.rangAncrage || 1) + '</td></tr>';
      });
      h += '</table><div class="pl-note">Le cycle se règle de 1 à 4 semaines : 2 pour l’alternance du samedi des préparateurs, 3 pour les pharmaciens. La semaine en cours est calculée depuis l’ancrage — plus rien à recopier à la main (ancrage importé : semaine du 07/09/2026 = Prép S1 · Ph S1 · PDA S4).</div>';
      el.innerHTML = h;
    } else {
      const p = P();
      let h = '<b style="font-size:12.5px">Effectif comptoir minimal (pharmaciens + préparateurs)</b>';
      h += '<table class="pl-tt"><tr><th></th>' + PL_JOURS_FR.slice(0, 6).map(j => '<th>' + j + '</th>').join('') + '</tr>';
      ['M', 'AM'].forEach(demi => {
        h += '<tr><th>' + (demi === 'M' ? 'Matin' : 'Après-midi') + '</th>';
        PL_JOURS.slice(0, 6).forEach(jr => {
          const s = (p.seuilsComptoir || []).find(x => x.jour === jr && x.demi === demi);
          h += '<td><input type="number" min="0" max="15" value="' + (s ? s.mini : 6) + '" onchange="plSetSeuil(\'seuilsComptoir\',\'' + jr + '\',\'' + demi + '\',this.value)"></td>';
        });
        h += '</tr>';
      });
      h += '</table>';
      h += '<b style="font-size:12.5px;display:block;margin-top:14px">Pharmaciens requis (seuil d’alerte — règle R1 bis)</b>';
      h += '<table class="pl-tt"><tr><th></th>' + PL_JOURS_FR.slice(0, 6).map(j => '<th>' + j + '</th>').join('') + '</tr>';
      ['M', 'AM'].forEach(demi => {
        h += '<tr><th>' + (demi === 'M' ? 'Matin' : 'Après-midi') + '</th>';
        PL_JOURS.slice(0, 6).forEach(jr => {
          const s = (p.seuilsPharmaciens || []).find(x => x.jour === jr && x.demi === demi);
          h += '<td><input type="number" min="0" max="8" value="' + (s ? s.mini : 1) + '" onchange="plSetSeuil(\'seuilsPharmaciens\',\'' + jr + '\',\'' + demi + '\',this.value)"></td>';
        });
        h += '</tr>';
      });
      h += '</table><div class="pl-note">Le minimum légal (au moins 1 pharmacien présent pendant l’ouverture) reste contrôlé quoi qu’il arrive. Ces seuils sont vos objectifs d’organisation : en dessous, la pastille du jour passe à l’orange ou au rouge.</div>';
      el.innerHTML = h;
    }
  }
  // clic sur une plage horaire d'un préparateur : fait tourner la position C → B → A.
  // La modification s'applique à la SEMAINE TYPE (elle vaut pour toutes les semaines de ce rang).
  window.plCyclePos = function (cid, rang, jour, hh) {
    const c = L('contrats').find(x => x.id === cid); if (!c || !PL_POS_CHOIX[c.grp]) return;
    if (!c.pos) c.pos = {};
    if (!c.pos[rang]) c.pos[rang] = {};
    if (!c.pos[rang][jour]) c.pos[rang][jour] = ['C', 'C'];
    const cur = c.pos[rang][jour][hh] || 'C';
    const suite = { C: 'B', B: 'A', A: 'C' };
    c.pos[rang][jour][hh] = suite[cur] || 'C';
    plStamp(c); plPersist();
    plToast(c.nom.split(' ')[0] + ' · ' + PL_JOURS_FR[PL_JOURS.indexOf(jour)] + ' ' + (hh ? 'après-midi' : 'matin') + ' → ' + PL_POS_LBL[c.pos[rang][jour][hh]]);
    plRender();
    const reg = document.getElementById('pl-ov-reg');
    if (reg && reg.classList.contains('pl-on')) plRegRender();
  };
  window.plSetBase = function (cid, v) {
    const c = L('contrats').find(x => x.id === cid); if (!c) return;
    const n = parseFloat(String(v).replace(',', '.'));
    c.base = isNaN(n) ? null : n; plStamp(c); plPersist(); plRender();
  };
  window.plSetLongueur = function (rid, v) {
    const r = L('rotations').find(x => x.id === rid); if (!r) return;
    const n = Math.max(1, Math.min(4, parseInt(v, 10) || 1));
    r.longueur = n; if ((r.rangAncrage || 1) > n) r.rangAncrage = 1;
    plStamp(r); plPersist(); plRegRender(); plRender();
  };
  window.plSetAncrage = function (rid, v) {
    const r = L('rotations').find(x => x.id === rid); if (!r || !v) return;
    r.ancrage = v; plStamp(r); plPersist(); plRegRender(); plRender();
  };
  window.plSetSeuil = function (listName, jour, demi, v) {
    const p = P(); if (!Array.isArray(p[listName])) p[listName] = [];
    let s = p[listName].find(x => x.jour === jour && x.demi === demi);
    if (!s) { s = { id: listName + ':' + jour + ':' + demi, jour: jour, demi: demi }; p[listName].push(s); }
    s.mini = Math.max(0, parseInt(v, 10) || 0); plStamp(s); plStamp(p); plPersist(); plRender();
  };

  // ---------- éditeur de trame ----------
  let plTrEditId = null;
  window.plEditTrame = function (cid) {
    const c = L('contrats').find(x => x.id === cid); if (!c) return;
    plTrEditId = cid;
    const rot = plRotOf(c); const nb = rot ? rot.longueur : 1;
    document.getElementById('pl-tr-title').textContent = 'Horaires type — ' + c.nom;
    let h = '';
    for (let w = 1; w <= nb; w++) {
      const sem = (c.sem && c.sem[String(w)]) || {};
      h += '<b style="font-size:12.5px;display:block;margin-top:' + (w > 1 ? '14px' : '0') + '">Semaine ' + w + ' du cycle'
        + (nb > 1 ? ' <button class="pl-btn pl-ghost pl-mini" onclick="plCopySem(' + w + ')">⧉ copier vers les autres</button>' : '') + '</b>';
      h += '<table class="pl-tt"><tr><th></th>' + PL_JOURS_FR.slice(0, 6).map(j => '<th>' + j + '</th>').join('') + '<th>Total</th></tr>';
      const posEditable = !!PL_POS_CHOIX[c.grp];
      const posSem = (c.pos && c.pos[String(w)]) || {};
      ['M', 'AM'].forEach((demi, hh) => {
        h += '<tr><th>' + (demi === 'M' ? 'Matin' : 'Après-midi') + '</th>';
        PL_JOURS.slice(0, 6).forEach(jr => {
          const v = (sem[jr] && sem[jr][hh]) || '';
          let posSel = '';
          if (posEditable) {
            const cur = (posSem[jr] && posSem[jr][hh]) || 'C';
            posSel = '<br><select data-pw="' + w + '" data-pj="' + jr + '" data-ph="' + hh + '" style="font-size:9.5px;border:1px solid var(--plline);border-radius:5px;margin-top:2px">'
              + ['C', 'B', 'A'].map(p => '<option value="' + p + '"' + (cur === p ? ' selected' : '') + '>' + p + ' · ' + PL_POS_LBL[p] + '</option>').join('') + '</select>';
          }
          h += '<td><input data-w="' + w + '" data-j="' + jr + '" data-h="' + hh + '" value="' + plEsc(v) + '" placeholder="—" oninput="plTrTotal()">' + posSel + '</td>';
        });
        h += (hh === 0 ? '<td rowspan="2" style="font-weight:700;font-variant-numeric:tabular-nums" id="pl-tr-tot-' + w + '"></td>' : '') + '</tr>';
      });
      h += '</table>';
    }
    document.getElementById('pl-tr-body').innerHTML = h;
    plTrTotal();
    plOpen('pl-ov-trame');
  };
  window.plTrTotal = function () {
    const inputs = document.querySelectorAll('#pl-tr-body input');
    const tot = {};
    inputs.forEach(i => { tot[i.dataset.w] = (tot[i.dataset.w] || 0) + plDurOf(i.value); });
    Object.keys(tot).forEach(w => { const el = document.getElementById('pl-tr-tot-' + w); if (el) el.textContent = plFmtH(Math.round(tot[w] * 4) / 4); });
  };
  window.plCopySem = function (fromW) {
    const inputs = [...document.querySelectorAll('#pl-tr-body input')];
    const src = {};
    inputs.filter(i => +i.dataset.w === fromW).forEach(i => { src[i.dataset.j + '|' + i.dataset.h] = i.value; });
    inputs.filter(i => +i.dataset.w !== fromW).forEach(i => { i.value = src[i.dataset.j + '|' + i.dataset.h] || ''; });
    plTrTotal();
  };
  window.plSaveTrame = function () {
    const c = L('contrats').find(x => x.id === plTrEditId); if (!c) return;
    const sem = {};
    document.querySelectorAll('#pl-tr-body input').forEach(i => {
      const w = i.dataset.w, jr = i.dataset.j, hh = +i.dataset.h;
      if (!sem[w]) sem[w] = {};
      if (!sem[w][jr]) sem[w][jr] = [null, null];
      const v = i.value.trim();
      sem[w][jr][hh] = v || null;
    });
    c.sem = sem;
    if (PL_POS_CHOIX[c.grp]) {
      const pos = {};
      document.querySelectorAll('#pl-tr-body select[data-pw]').forEach(sel => {
        const w = sel.dataset.pw, jr = sel.dataset.pj, hh = +sel.dataset.ph;
        if (!pos[w]) pos[w] = {};
        if (!pos[w][jr]) pos[w][jr] = ['C', 'C'];
        pos[w][jr][hh] = sel.value;
      });
      c.pos = pos;
    }
    plStamp(c); plPersist();
    plClose('pl-ov-trame'); plToast('Trame de ' + c.nom + ' enregistrée'); plRender();
    if (document.getElementById('pl-ov-reg').classList.contains('pl-on')) plRegRender();
  };

  // ---------- seed : trame du 01/09/2026 ----------
  const PL_SEED = [{"nom": "Anouck", "grp": "ph", "role": "Pharmacienne titulaire", "ph": true, "base": null, "sem": {}}, {"nom": "Olivier", "grp": "ph", "role": "Pharmacien titulaire", "ph": true, "base": null, "sem": {}}, {"nom": "Hervine Lhullier", "grp": "ph", "role": "Pharmacienne adjointe", "ph": true, "base": 27.0, "sem": {"1": {"lun": ["9h-12h30", "14h-19h30"], "mar": ["9h-12h30", "14h-19h30"], "mer": [null, null], "jeu": [null, null], "ven": ["9h-12h30", "14h-19h30"], "sam": [null, null]}, "2": {"lun": ["9h-12h30", "14h-19h30"], "mar": ["9h-12h30", "14h-19h30"], "mer": ["9h-12h30", "14h-19h30"], "jeu": [null, null], "ven": [null, null], "sam": [null, null]}, "3": {"lun": ["9h-12h30", "14h-19h30"], "mar": ["9h-12h30", "14h-19h30"], "mer": [null, null], "jeu": [null, null], "ven": [null, null], "sam": ["9h-12h30", "14h-19h30"]}}}, {"nom": "Alexis Baguelin", "grp": "ph", "role": "Pharmacien adjoint", "ph": true, "base": 35.0, "sem": {"1": {"lun": [null, null], "mar": [null, null], "mer": ["9h-12h30", "14h-19h30"], "jeu": ["9h-12h30", "14h-18h30"], "ven": ["9h-12h30", "14h-18h30"], "sam": ["9h-12h30", "14h-19h30"]}, "2": {"lun": ["9h-12h30", "14h-19h30"], "mar": [null, null], "mer": ["9h-12h30", "14h-19h30"], "jeu": ["9h-12h30", "14h-18h30"], "ven": ["9h-12h30", "14h-18h30"], "sam": [null, null]}, "3": {"lun": ["9h-12h30", "14h-19h30"], "mar": [null, null], "mer": ["9h-12h30", "14h-19h30"], "jeu": ["9h-12h30", "14h-19h30"], "ven": ["9h-12h30", "14h-18h30"], "sam": [null, null]}}}, {"nom": "Jules Palvadeau", "grp": "ph", "role": "Pharmacien adjoint", "ph": true, "base": 35.0, "sem": {"1": {"lun": ["9h-12h30", "14h-19h30"], "mar": ["9h-12h30", "14h-19h30"], "mer": ["9h-12h30", "14h-19h30"], "jeu": ["9h-12h30", "14h-18h30"], "ven": [null, null], "sam": [null, null]}, "2": {"lun": [null, null], "mar": ["9h-12h30", "14h-19h30"], "mer": [null, null], "jeu": ["9h-12h30", "14h-18h30"], "ven": ["9h-12h30", "14h-19h30"], "sam": ["9h-12h30", "14h-19h30"]}, "3": {"lun": [null, null], "mar": ["9h-12h30", "14h-19h30"], "mer": ["9h-12h30", "14h-19h30"], "jeu": ["9h-12h30", "14h-18h30"], "ven": ["9h-12h30", "14h-19h30"], "sam": [null, null]}}}, {"nom": "Enzo Doré", "grp": "ph", "role": "Pharmacien adjoint", "ph": true, "base": 35.0, "sem": {"1": {"lun": ["9h-12h30", "14h-19h30"], "mar": ["9h-12h30", "14h-18h30"], "mer": ["9h-12h30", "14h-19h30"], "jeu": [null, null], "ven": ["9h-12h30", "14h-19h30"], "sam": [null, null]}, "2": {"lun": ["9h-12h30", "14h-19h30"], "mar": ["9h-12h30", "14h-18h30"], "mer": ["9h-12h30", "14h-19h30"], "jeu": [null, null], "ven": ["9h-12h30", "14h-19h30"], "sam": ["9h-12h30", "14h-19h30"]}, "3": {"lun": ["9h-12h30", "14h-19h30"], "mar": ["9h-12h30", "14h-18h30"], "mer": ["9h-12h30", "14h-19h30"], "jeu": [null, null], "ven": ["9h-12h30", "14h-19h30"], "sam": [null, null]}}}, {"nom": "Céline Bourdon", "grp": "prep", "role": "Préparatrice", "ph": false, "base": 35.0, "sem": {"1": {"lun": ["9h-12h30", "14h-19h30"], "mar": ["9h-12h30", "14h-19h30"], "mer": [null, null], "jeu": [null, null], "ven": ["9h-12h30", "14h-18h30"], "sam": ["9h-12h30", "14h-19h30"]}, "2": {"lun": ["9h-12h30", "14h-19h30"], "mar": ["9h-12h30", "14h-19h30"], "mer": ["9h-12h30", "14h-19h30"], "jeu": [null, null], "ven": ["9h-12h30", "14h-18h30"], "sam": [null, null]}}}, {"nom": "Elodie Rivognac", "grp": "prep", "role": "Préparatrice", "ph": false, "base": 27.0, "sem": {"1": {"lun": [null, null], "mar": [null, null], "mer": [null, null], "jeu": ["9h-12h30", "14h-19h30"], "ven": ["9h-12h30", "14h-19h30"], "sam": ["9h-12h30", "14h-19h30"]}, "2": {"lun": [null, null], "mar": ["9h-12h30", "14h-19h30"], "mer": [null, null], "jeu": ["9h-12h30", "14h-19h30"], "ven": ["9h-12h30", "14h-19h30"], "sam": [null, null]}}}, {"nom": "Mathilde Binet", "grp": "prep", "role": "Préparatrice", "ph": false, "base": 16.0, "sem": {"1": {"lun": ["9h-12h30", null], "mar": [null, "14h-19h30"], "mer": [null, null], "jeu": ["9h-12h30", null], "ven": ["9h-12h30", null], "sam": [null, null]}, "2": {"lun": ["9h-12h30", null], "mar": [null, "14h-19h30"], "mer": [null, null], "jeu": ["9h-12h30", null], "ven": ["9h-12h30", null], "sam": [null, null]}}}, {"nom": "Jean-Claude Tran Van", "grp": "prep", "role": "Préparateur", "ph": false, "base": 35.0, "sem": {"1": {"lun": ["9h-12h30", "14h-19h30"], "mar": ["9h-12h30", "14h-18h00"], "mer": [null, null], "jeu": ["9h-12h30", "14h-19h30"], "ven": ["9h-12h30", "14h-19h30"], "sam": [null, null]}, "2": {"lun": ["9h-12h30", "14h-19h30"], "mar": [null, null], "mer": [null, null], "jeu": ["9h-12h30", "14h-19h30"], "ven": ["9h-12h30", "14h-19h15"], "sam": ["9h-12h30", "14h-19h30"]}}}, {"nom": "Marion Noyée", "grp": "prep", "role": "Préparatrice", "ph": false, "base": 35.0, "sem": {"1": {"lun": [null, null], "mar": ["9h-12h30", "14h-19h30"], "mer": [null, null], "jeu": ["9h-12h30", "14h-18h15"], "ven": ["9h-12h30", "14h-19h15"], "sam": ["9h-12h30", "14h-19h30"]}, "2": {"lun": ["9h-12h30", "14h-19h30"], "mar": [null, null], "mer": ["9h-12h30", "14h-19h30"], "jeu": ["9h-12h30", "14h-18h45"], "ven": ["9h-12h30", "14h-19h30"], "sam": [null, null]}}}, {"nom": "Julie Nicolas", "grp": "prep", "role": "Préparatrice", "ph": false, "base": 32.75, "sem": {"1": {"lun": ["9h-12h30", "14h-19h30"], "mar": [null, null], "mer": ["9h-12h30", "14h-19h30"], "jeu": [null, "14h-18h30"], "ven": ["9h-12h30", "14h-18h30"], "sam": [null, null]}, "2": {"lun": [null, null], "mar": [null, null], "mer": ["9h-12h30", "14h-19h30"], "jeu": [null, "14h-19h30"], "ven": ["9h-12h30", "14h-18h30"], "sam": ["8h30-12h30", "14h-19h"]}}}, {"nom": "Hortense Le Pont", "grp": "prep", "role": "Préparatrice", "ph": false, "base": 35.0, "sem": {"1": {"lun": ["9h-12h30", "14h-19h30"], "mar": ["9h-12h30", "14h-18h30"], "mer": ["9h-12h30", "14h-19h30"], "jeu": ["9h-12h30", "14h-19h30"], "ven": [null, null], "sam": [null, null]}, "2": {"lun": [null, null], "mar": ["9h-12h30", "14h-18h30"], "mer": ["9h-12h30", "14h-19h30"], "jeu": ["9h-12h30", "14h-19h30"], "ven": [null, null], "sam": ["9h-12h30", "14h-19h30"]}}}, {"nom": "Elise Lamy", "grp": "prep", "role": "Préparatrice", "ph": false, "base": 35.0, "sem": {"1": {"lun": [null, null], "mar": [null, null], "mer": ["9h-12h30", "14h-18h30"], "jeu": ["9h-12h30", "14h-19h30"], "ven": ["9h-12h30", "14h-19h30"], "sam": ["9h-12h30", "14h-19h30"]}, "2": {"lun": [null, null], "mar": ["9h-12h30", "14h-19h30"], "mer": ["9h-12h30", "14h-18h30"], "jeu": ["9h-12h30", "14h-19h30"], "ven": ["9h-12h30", "14h-19h30"], "sam": [null, null]}}}, {"nom": "Violette Gente", "grp": "renfort", "role": "Étudiante", "ph": false, "base": 9.0, "sem": {"1": {"lun": [null, null], "mar": [null, null], "mer": [null, null], "jeu": [null, null], "ven": [null, null], "sam": ["9h-12h30", "14h-19h30"]}, "2": {"lun": [null, null], "mar": [null, null], "mer": [null, null], "jeu": [null, null], "ven": [null, null], "sam": ["9h-12h30", "14h-19h30"]}}}, {"nom": "Allison Courvalet", "grp": "avance", "role": "Esthéticienne", "ph": false, "base": 35.0, "sem": {"1": {"lun": ["9h-12h30", "14h-19h30"], "mar": ["9h-12h30", "14h-19h30"], "mer": ["9h-12h30", "14h-18h30"], "jeu": [null, null], "ven": ["9h-12h30", "14h-19h30"], "sam": [null, null]}, "2": {"lun": ["9h-12h30", "14h-19h30"], "mar": [null, null], "mer": ["9h-12h30", "14h-18h30"], "jeu": [null, null], "ven": ["9h-12h30", "14h-19h30"], "sam": ["9h-12h30", "14h-19h30"]}}}, {"nom": "Paloma Petit", "grp": "secr", "role": "Secrétaire", "ph": false, "base": 28.0, "sem": {"1": {"lun": ["9h-12h30", "14h-17h30"], "mar": ["9h-12h30", "14h-17h30"], "mer": [null, null], "jeu": ["9h-12h30", "14h-17h30"], "ven": ["9h-12h30", "14h-17h30"], "sam": [null, null]}, "2": {"lun": ["9h-12h30", "14h-17h30"], "mar": ["9h-12h30", "14h-17h30"], "mer": [null, null], "jeu": ["9h-12h30", "14h-17h30"], "ven": ["9h-12h30", "14h-17h30"], "sam": [null, null]}}}, {"nom": "Brunilde Marti", "grp": "logi", "role": "Logistique", "ph": false, "base": 35.0, "sem": {"1": {"lun": ["6h-13h30", null], "mar": ["6h-13h30", null], "mer": ["6h-11h", null], "jeu": ["6h-13h30", null], "ven": ["6h-13h30", null], "sam": [null, null]}, "2": {"lun": ["6h-13h30", null], "mar": ["6h-13h30", null], "mer": ["6h-11h", null], "jeu": ["6h-13h30", null], "ven": ["6h-13h30", null], "sam": [null, null]}}}, {"nom": "Quentin Debons", "grp": "logi", "role": "Logistique", "ph": false, "base": 35.0, "sem": {"1": {"lun": ["9h-12h30", "13h30-18h"], "mar": ["9h30-12h30", "13h30-18h"], "mer": ["9h-12h30", "13h30-18h"], "jeu": [null, "13h30-18h30"], "ven": ["9h30-12h30", "13h30-18h"], "sam": ["8h30-11h", null]}, "2": {"lun": [null, "13h30-18h"], "mar": ["9h30-12h30", "13h30-18h"], "mer": ["9h-12h30", "13h30-18h"], "jeu": [null, "13h30-18h30"], "ven": ["9h30-12h30", "13h30-18h"], "sam": [null, null]}}}, {"nom": "Corinne Porey", "grp": "entretien", "role": "Entretien", "ph": false, "base": 12.5, "sem": {"1": {"lun": ["6h-8h30", null], "mar": ["6h-8h30", null], "mer": ["6h-8h30", null], "jeu": ["6h-8h30", null], "ven": ["6h-8h30", null], "sam": [null, null]}, "2": {"lun": ["6h-8h30", null], "mar": ["6h-8h30", null], "mer": ["6h-8h30", null], "jeu": ["6h-8h30", null], "ven": ["6h-8h30", null], "sam": [null, null]}}, "inactif": true}];
  window.plSeed = function () {
    if (L('contrats').length) { plToast('Des contrats existent déjà.'); return; }
    const now = Date.now();
    // rotations — ancrage : semaine du 07/09/2026 = Prép S1 · Ph S1 · PDA S4 (planning 2026)
    [{ id: 'rot:prep', lbl: 'Prép', longueur: 2, ancrage: '2026-09-07', rangAncrage: 1 },
     { id: 'rot:ph', lbl: 'Ph', longueur: 3, ancrage: '2026-09-07', rangAncrage: 1 },
     { id: 'rot:pda', lbl: 'PDA', longueur: 4, ancrage: '2026-09-07', rangAncrage: 4 }].forEach(r => { r.updatedAt = now; plRotations.push(r); });
    // postes
    [{ id: 'po:comptoir', lbl: 'Comptoir', compteComptoir: true },
     { id: 'po:avance', lbl: 'Poste avancé', compteComptoir: false },
     { id: 'po:backoffice', lbl: 'Back-office / PDA', compteComptoir: false },
     { id: 'po:logistique', lbl: 'Logistique', compteComptoir: false },
     { id: 'po:entretien', lbl: 'Entretien', compteComptoir: false }].forEach(p => { p.updatedAt = now; plPostes.push(p); });
    // contrats + trames individuelles
    PL_SEED.forEach(s => {
      plContrats.push({
        id: 'ct:' + s.nom.toLowerCase().replace(/[^a-z]+/g, '-'),
        nom: s.nom, grp: s.grp, role: s.role, estPharmacien: !!s.ph,
        base: s.base, tempsPartiel: s.base != null && s.base < 35,
        rotationId: s.ph ? 'rot:ph' : 'rot:prep',
        sem: s.sem, actif: !s.inactif, updatedAt: now
      });
    });
    // seuils par défaut : comptoir 6 (5 le samedi), pharmaciens = ligne 13 de la trame
    const p = P();
    p.seuilsComptoir = []; p.seuilsPharmaciens = [];
    PL_JOURS.slice(0, 6).forEach(jr => ['M', 'AM'].forEach(demi => {
      p.seuilsComptoir.push({ id: 'seuilsComptoir:' + jr + ':' + demi, jour: jr, demi: demi, mini: jr === 'sam' ? 5 : 6, updatedAt: now });
    }));
    const lignePh = { lun: [3, 3], mar: [2, 2], mer: [4, 4], jeu: [3, 3], ven: [5, 3], sam: [4, 3] };
    Object.keys(lignePh).forEach(jr => ['M', 'AM'].forEach((demi, i) => {
      p.seuilsPharmaciens.push({ id: 'seuilsPharmaciens:' + jr + ':' + demi, jour: jr, demi: demi, mini: lignePh[jr][i], updatedAt: now });
    }));
    p.updatedAt = now;
    plPersist(); plToast('Trame du 01/09/2026 importée — 18 collaborateurs'); plRender();
  };

  // ---------- init ----------
  function plInit() { try { plInject(); } catch (e) { console.warn('pl init', e); } }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', plInit);
  else plInit();
  // premier rendu quand la section devient visible (showSec ne notifie pas : on rend à l'injection + à chaque sync)
  setTimeout(function () { try { plRender(); } catch (e) { console.warn('pl render', e); } }, 400);
})();
