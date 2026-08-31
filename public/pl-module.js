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
  function plIsAdmin() {
    try {
      if (typeof currentUser === 'undefined' || !currentUser) return false;
      if (currentUser.admin || currentUser.role === 'admin' || currentUser.plRole === 'titulaire' || currentUser.plRole === 'responsable') return true;
      // même repli que l'intranet : tant qu'aucun collaborateur ne porte le drapeau admin,
      // les titulaires (OF, AF) le sont d'office
      const staff = (typeof staffDB !== 'undefined' && Array.isArray(staffDB)) ? staffDB : [];
      if (!staff.some(s => s && s.admin === true)) return currentUser.id === 'OF' || currentUser.id === 'AF';
      return false;
    } catch (e) { return false; }
  }

  // accès sûrs aux globales (index.html les déclare ; garde-fou si module chargé isolément)
  function P() { if (typeof plParams === 'undefined' || !plParams || typeof plParams !== 'object') window.plParams = {}; return plParams; }
  function L(name) { /* liste globale par nom */
    switch (name) {
      case 'postes': if (!Array.isArray(plPostes)) plPostes = []; return plPostes;
      case 'rotations': if (!Array.isArray(plRotations)) plRotations = []; return plRotations;
      case 'contrats': if (!Array.isArray(plContrats)) plContrats = []; return plContrats;
      case 'trames': if (!Array.isArray(plTrames)) plTrames = []; return plTrames;
      case 'exceptions': if (!Array.isArray(plExceptions)) plExceptions = []; return plExceptions;
      case 'heuresSup': if (typeof plHeuresSup === 'undefined' || !Array.isArray(plHeuresSup)) window.plHeuresSup = []; return plHeuresSup;
      case 'absences': if (typeof plAbsences === 'undefined' || !Array.isArray(plAbsences)) window.plAbsences = []; return plAbsences;
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
  function plPosOf(c, rang, jour, hh, pos) {
    const P = pos !== undefined ? pos : c.pos;
    if (PL_POS_CHOIX[c.grp] && P && P[rang] && P[rang][jour] && P[rang][jour][hh]) return P[rang][jour][hh];
    return PL_POS_DEFAUT[c.grp] || 'C';
  }

  let plVerEdit = null;    // id de la version éditée dans l'écran Trames (null = trame de base)
  // ═══ VERSIONS DE TRAME ═══════════════════════════════════════════════════
  // Une modification de la semaine type ne doit pas réécrire le passé : chaque trame est
  // datée. Une version porte { debut, fin (ou null), typeDebut } et le contenu de toute
  // l'équipe. Une version « brouillon » n'est jamais lue par le planning : elle sert à
  // préparer une réorganisation, à la comparer, puis à la mettre en place à une date.
  // Stockage : collection plTrames (synchronisée, fusion par id + tombstones).
  function plVersions() { return L('trames').slice().sort((a, b) => String(a.debut || '').localeCompare(String(b.debut || ''))); }
  function plVerActives() { return plVersions().filter(v => v.statut !== 'brouillon' && v.debut); }
  function plVerBrouillons() { return plVersions().filter(v => v.statut === 'brouillon'); }
  // version en vigueur à une date donnée (la plus récente dont la fenêtre couvre la date)
  function plVerAt(date) {
    const iso = plIso(date);
    let best = null;
    plVerActives().forEach(v => {
      if (v.debut > iso) return;
      if (v.fin && v.fin < iso) return;
      if (!best || v.debut > best.debut) best = v;
    });
    return best;
  }
  function plVerData(v, cid) { return (v && v.data && v.data[cid]) || null; }
  function plVerEditObj() { return plVerEdit ? L('trames').find(v => v.id === plVerEdit) : null; }
  // sem/pos de la cible d'édition, créés à la volée depuis la trame de base
  function plEdSlot(c) {
    const v = plVerEditObj();
    if (!v) {
      if (!c.sem) c.sem = {};
      if (!c.pos) c.pos = {};
      return { sem: c.sem, pos: c.pos, obj: c };
    }
    if (!v.data) v.data = {};
    if (!v.data[c.id]) v.data[c.id] = { rang0: 1, sem: JSON.parse(JSON.stringify(c.sem || {})), pos: JSON.parse(JSON.stringify(c.pos || {})) };
    const d = v.data[c.id];
    if (!d.sem) d.sem = {};
    if (!d.pos) d.pos = {};
    return { sem: d.sem, pos: d.pos, obj: v };
  }
  // Hors de l'écran Trames, on ne doit JAMAIS lire un brouillon : le planning affiche
  // la version en vigueur à la date consultée.
  function plSemCtx(c) {
    const reg = document.getElementById('pl-ov-reg');
    if (reg && reg.classList.contains('pl-on') && plRegView === 't') return plEdSlot(c).sem;
    return plTrameAt(c, plAnchor || new Date()).sem;
  }
  function plVerLbl(v) {
    if (!v) return 'Trame de base';
    if (v.statut === 'brouillon') return 'Brouillon · ' + (v.nom || 'sans nom');
    return 'Depuis le ' + plJoli(v.debut) + (v.fin ? ' → ' + plJoli(v.fin) : '');
  }
  function plJoli(iso) { return iso ? iso.split('-').reverse().join('/') : ''; }
  // rang du cycle d'un contrat à une date, ancré sur la version en vigueur
  function plRangAt(c, date, v) {
    const rot = plRotOf(c), L2 = (rot && rot.longueur) || 1;
    if (v && v.debut) {
      const d0 = plVerData(v, c.id);
      const r0 = (d0 && d0.rang0) || 1;
      const w = plWeeksBetween(v.debut, date);
      return ((w % L2) + L2 + r0 - 1) % L2 + 1;
    }
    return plRang(rot, date);
  }
  // trame (sem/pos) applicable à un contrat à une date : version en vigueur, sinon trame de base
  let plVerForce = null;   // version en cours d'édition : l'écran Trames lit celle-là, pas la date
  function plTrameAt(c, date) {
    if (plVerForce) {
      const d1 = plVerData(plVerForce, c.id);
      return { v: plVerForce, sem: (d1 && d1.sem) || {}, pos: (d1 && d1.pos) || {}, rang: String(plRang(plRotOf(c), date)) };
    }
    const v = plVerAt(date);
    const d0 = plVerData(v, c.id);
    return { v: v, sem: (d0 && d0.sem) || c.sem || {}, pos: (d0 && d0.pos) || c.pos || {}, rang: String(plRangAt(c, date, d0 ? v : null)) };
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
  // horaires de la TRAME [matin, aprem] d'un contrat à une date (version en vigueur ce jour-là)
  function plSlotsTrame(c, date) {
    const t = plTrameAt(c, date);
    const sem = t.sem[t.rang] || t.sem['1'];
    if (!sem) return [null, null];
    const day = sem[plDayKey(date)];
    return Array.isArray(day) ? [day[0] || null, day[1] || null] : [null, null];
  }
  // exposés pour l'inspection et les tests (lecture seule)
  window.plSlotsTrame = plSlotsTrame; window.plVerAt = plVerAt; window.plTrameAt = plTrameAt;
  window.plAbs = plAbs; window.plSlots = plSlots; window.plEffectif = plEffectif;
  // exception d'horaire du jour (type 'horaire') pour une demi-journée : record ou null
  function plExOf(c, iso, demi) {
    return L('exceptions').find(x => x.contratId === c.id && x.date === iso && x.type === 'horaire' && x.demi === demi) || null;
  }
  // horaires EFFECTIFS : trame + exceptions du jour (départ anticipé, créneau ajouté/supprimé…)
  function plSlots(c, date) {
    const t = plSlotsTrame(c, date), iso = plIso(date);
    const out = [t[0], t[1]];
    ['M', 'AM'].forEach((demi, i) => {
      const ex = plExOf(c, iso, demi);
      if (ex) out[i] = ex.horaire || null;   // horaire vide = ne travaille pas ce jour-là
    });
    return out;
  }
  // position effective à une date (exception du jour > trame)
  function plPosEff(c, date, hh) {
    const ex = plExOf(c, plIso(date), hh ? 'AM' : 'M');
    if (ex && ex.pos) return ex.pos;
    const t = plTrameAt(c, date);
    return plPosOf(c, t.rang, plDayKey(date), hh, t.pos);
  }
  // absence validée (exception de type absence) pour un contrat à une date → {motif} ou null par demi-journée
  function plAbs(c, iso) {
    const out = [null, null];
    // périodes déclarées (congés, maternité, maladie, récupération, formation)
    L('absences').forEach(a => {
      if (a.contratId !== c.id || !a.debut || !a.fin || iso < a.debut || iso > a.fin) return;
      if (!(iso === a.debut && a.debutAM)) out[0] = a.motif || 'cp';
      if (!(iso === a.fin && a.finM)) out[1] = a.motif || 'cp';
    });
    // absences ponctuelles saisies au jour (exception de type absence)
    const e = L('exceptions').filter(x => x.contratId === c.id && x.date === iso && x.type === 'absence');
    const m = e.find(x => x.demi === 'M' || x.journee), a = e.find(x => x.demi === 'AM' || x.journee);
    if (m) out[0] = m.motif || 'cp';
    if (a) out[1] = a.motif || 'cp';
    return out;
  }
  const PL_MOTIFS = { cp: 'Congés', mat: 'Maternité', mal: 'Maladie', rec: 'Récup.', for: 'Formation' };
  const PL_MOTIFS_LONG = { cp: 'Vacances / congés payés', mat: 'Congé maternité', mal: 'Arrêt maladie', rec: 'Récupération', for: 'Formation' };
  // en formation, l'horaire habituel est conservé (il compte dans les heures) mais le
  // collaborateur est absent de la pharmacie : hors effectif, affiché en grisé
  function plHeuresConservees(motif) { return motif === 'for'; }

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
      if (sl[0] && (!ab[0] || plHeuresConservees(ab[0]))) tot += plDurOf(sl[0]);
      if (sl[1] && (!ab[1] || plHeuresConservees(ab[1]))) tot += plDurOf(sl[1]);
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
      const pos = plPosEff(c, date, h);
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
    --plrec:#8A63C9;--plrecb:#F0EAFA;--plfor:#B8821C;--plforb:#F8F0DE;--plmat:#C2559A;--plmatb:#F9E7F1}
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
  .pl-ch-mat{background:var(--plmatb);color:var(--plmat)}.pl-ch-mat i{background:var(--plmat)}
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
  /* colonne des collaborateurs figée : elle reste lisible quand on défile vers la droite */
  .pl-card .pl-who{position:sticky;left:0;z-index:3;background:#fff}
  .pl-card thead th.pl-who{z-index:5}
  .pl-grp td.pl-who{background:var(--placs)}
  .pl-grplbl{display:block;width:148px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pl-mo .pl-who,.pl-yr .pl-who{text-align:left}
  .pl-card .pl-cntrow td.pl-who{background:#FBFAF9}
  .pl-card .pl-who::after{content:'';position:absolute;top:0;right:0;bottom:0;width:6px;
    pointer-events:none;background:linear-gradient(90deg,rgba(70,40,55,.10),rgba(70,40,55,0));
    opacity:0;transition:opacity .15s}
  .pl-card.pl-scrolled .pl-who::after{opacity:1}
  .pl-who b{font-size:12.5px;display:block}
  .pl-who small{color:var(--plmut);font-size:10px;font-weight:500}
  .pl-hrs{margin-top:3px;font-size:10.5px;font-weight:600;font-variant-numeric:tabular-nums}
  .pl-hrs.good{color:var(--plok)}.pl-hrs.bad{color:var(--plcrit)}
  .pl-vide{font-size:9px;font-weight:600;color:transparent;text-align:center;border:1px dashed transparent;
    border-radius:6px;padding:1px 0;margin:1px 0;letter-spacing:.2px;transition:color .12s,border-color .12s}
  .pl-cell:hover .pl-vide{color:#B9C2BD;border-color:var(--plline)}
  .pl-cell .pl-vide:hover{border-color:var(--plac);color:var(--plac);background:var(--placs)}
  .pl-repos:hover .pl-restlbl{display:none}
  .pl-cyc2{font-size:9.5px;font-weight:600;color:var(--plmut);font-variant-numeric:tabular-nums}
  .pl-cyc2.good{color:var(--plok)}.pl-cyc2.bad{color:var(--plcrit)}
  .pl-grp td{background:var(--placs);padding:4px 14px;font-size:10.5px;
    font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:var(--plac)}
  .pl-cell{padding:5px 6px;min-height:50px}
  .pl-shift{background:var(--placs);border-left:3px solid var(--plac);border-radius:6px;padding:3px 7px;
    margin:2px 0;font-size:10.5px;font-weight:600;color:#0B5B44;font-variant-numeric:tabular-nums;white-space:nowrap}
  .pl-shift.early{border-left-color:var(--plrose);background:var(--plroses);color:var(--plrosei)}
  .pl-abs{border-radius:6px;padding:3px 7px;margin:2px 0;font-size:10px;font-weight:700;
    text-transform:uppercase;letter-spacing:.4px;white-space:nowrap}
  .pl-abs.cp{background:var(--plcpb);color:var(--plcp)}.pl-abs.mal{background:var(--plmalb);color:var(--plmal)}
  .pl-abs.rec{background:var(--plrecb);color:var(--plrec)}.pl-abs.for{background:var(--plforb);color:var(--plfor)}
  .pl-abs.mat{background:var(--plmatb);color:var(--plmat)}
  .pl-shift.pl-formation{background:#EDEDED;color:#8E9395;border-left-color:#B9BEC0;text-decoration:none}
  .pl-shift.pl-formation .pl-fortag{display:block;font-style:normal;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:var(--plfor);margin-top:1px}
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
  .pl-shift.pl-mod{box-shadow:inset 0 0 0 1.5px var(--plwarn)}
  .pl-exdot{position:absolute;left:-4px;top:-4px;width:9px;height:9px;border-radius:50%;background:var(--plwarn);
    border:1.5px solid #fff;font-style:normal}
  .pl-cell.pl-click{cursor:pointer}
  .pl-cell.pl-click:hover{background:#FBF8F6}
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
  .pl-yr .pl-who{border-right:1px solid var(--plline)}
  .pl-dd{display:flex;flex-direction:column;gap:2px;align-items:center;padding:5px 3px}
  .pl-tick{width:15px;height:8px;border-radius:3px;background:#EDF2EF}
  .pl-tick.on{background:var(--plac);opacity:.72}
  .pl-tick.cp{background:var(--plcp)}.pl-tick.mal{background:var(--plmal)}
  .pl-tick.rec{background:var(--plrec)}.pl-tick.for{background:var(--plfor)}.pl-tick.mat{background:var(--plmat)}
  .pl-wee{background:#F7F4F2}
  .pl-mnp{width:17px;margin:1px auto;border-radius:4px;font-size:8.5px;font-weight:800;line-height:12px;
    text-align:center;font-variant-numeric:tabular-nums}
  .pl-mnp-ok{background:#DDEFE4;color:var(--plok)}
  .pl-mnp-lim{background:#F5E9CC;color:var(--plwarn)}
  .pl-mnp-bad{background:#F6DAD6;color:var(--plcrit)}
  .pl-av{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px;vertical-align:baseline}
  /* année */
  .pl-yr td{padding:3px 6px}
  .pl-yr .pl-strip{display:flex;gap:1px}
  .pl-yr .pl-dt{width:3px;height:14px;border-radius:1px;background:#EFF3F0;flex:0 0 auto}
  .pl-yr .pl-dt.on{background:#CBDED3}
  .pl-yr .pl-dt.cp{background:var(--plcp)}.pl-yr .pl-dt.mal{background:var(--plmal)}
  .pl-yr .pl-dt.rec{background:var(--plrec)}.pl-yr .pl-dt.for{background:var(--plfor)}.pl-yr .pl-dt.mat{background:var(--plmat)}
  /* vue Année zoomable */
  .pl-anbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px}
  .pl-anlbl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--plmut)}
  .pl-anhint{font-size:10.5px;color:var(--plmut)}
  .pl-anseg button{font-size:11.5px;padding:4px 11px}
  .pl-anscroll{overflow-x:auto}
  .pl-anhead{display:flex;gap:1px}
  .pl-anm{flex:0 0 auto;font-size:10px;color:var(--plmut);border-left:1px solid var(--plline);padding-left:3px;
    overflow:hidden;white-space:nowrap}
  .pl-and{flex:0 0 auto;font-size:8.5px;color:var(--plmut);text-align:center;font-variant-numeric:tabular-nums}
  .pl-and.pl-dim{color:#C9CFCB}
  .pl-yr .pl-dt{cursor:pointer;display:inline-flex;align-items:center;justify-content:center;overflow:hidden}
  .pl-yr .pl-dt i{font-style:normal;font-size:8.5px;font-weight:700;color:#2A6A52}
  .pl-yr .pl-dt:hover{outline:1.5px solid var(--plac);outline-offset:0}
  .pl-yr .pl-dt.pl-dtex{box-shadow:inset 0 0 0 1.5px var(--plwarn)}
  .pl-ancol{flex:0 0 auto;display:flex;flex-direction:column;gap:1px;cursor:pointer}
  .pl-anc{height:9px;border-radius:1px;display:flex;align-items:center;justify-content:center;
    font-size:8px;font-weight:800;font-variant-numeric:tabular-nums}
  .pl-anc.ok{background:#DDEFE4;color:var(--plok)}
  .pl-anc.lim{background:#F5E9CC;color:var(--plwarn)}
  .pl-anc.bad{background:#F6DAD6;color:var(--plcrit)}
  .pl-ancol:hover .pl-anc{outline:1.5px solid var(--plac)}
  .pl-anfer{cursor:default}
  .pl-anfer:hover .pl-anc{outline:none}
  .pl-anc.pl-fer{background:repeating-linear-gradient(45deg,#F1F3F1,#F1F3F1 2px,#E7EAE8 2px,#E7EAE8 4px)}
  .pl-yr .pl-dt.pl-dtdim{background:#F4F6F5;cursor:default}
  .pl-yr .pl-dt.pl-dtdim:hover{outline:none}
  /* modales */
  .pl-ov{position:fixed;inset:0;z-index:11000;display:none;align-items:flex-start;justify-content:center;
    background:rgba(30,20,26,.45);padding:4vh 16px;overflow:auto}
  .pl-ov.pl-on{display:flex}
  .pl-box{background:#fff;border-radius:16px;box-shadow:0 22px 60px rgba(0,0,0,.35);padding:22px 24px;
    width:min(880px,96vw);max-height:90vh;overflow:auto}
  .pl-box h3{margin:0 0 4px;font-size:1.02rem}
  .pl-box .pl-sub{color:var(--plmut);font-size:12px;margin-bottom:14px}
  /* mode pleine page (exercice de trame : on a besoin de toute la largeur) */
  .pl-ov.pl-full{padding:0;background:var(--plbg);align-items:stretch}
  .pl-ov.pl-full>.pl-box{width:100vw;max-width:none;height:100vh;max-height:100vh;border-radius:0;
    box-shadow:none;padding:14px 22px 0;display:flex;flex-direction:column;overflow:hidden}
  .pl-hd{display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap}
  .pl-hd .pl-sub{margin-bottom:10px}
  .pl-ov.pl-full .pl-hd{align-items:center}
  .pl-ov.pl-full .pl-hd .pl-sub{margin:0;max-width:680px}
  .pl-ov.pl-full #pl-reg-body{flex:1;min-height:0;overflow:auto;margin:0 -22px;padding:0 22px 18px}
  .pl-ov.pl-full .pl-actions{display:none}
  .pl-ov.pl-full .pl-tt{font-size:12px}
  .pl-ov.pl-full .pl-shift{font-size:11px!important}
  .pl-verbar{display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding-bottom:8px}
  .pl-verlbl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--plmut)}
  .pl-verinfo{font-size:11px;color:var(--plmut);background:#FBFAF9;border:1px solid var(--plline);
    border-radius:9px;padding:6px 10px;margin-bottom:9px;line-height:1.45}
  .pl-verinfo.pl-br{background:var(--plforb);border-color:#EAD9AE;color:#7A5A10}
  .pl-verinfo.pl-ac{background:var(--placs);border-color:#CFE7DA;color:#1F5C46}
  .pl-trtop{background:#fff}
  .pl-ov.pl-full .pl-trtop{position:sticky;top:0;z-index:6;padding:8px 0 6px;
    box-shadow:0 6px 12px -10px rgba(70,40,55,.55)}
  .pl-ov.pl-full .pl-trgrid .pl-tt td:first-child,
  .pl-ov.pl-full .pl-trgrid .pl-tt th:first-child{position:sticky;left:0;z-index:2;background:#fff}
  /* sélecteur d'horaires (aucune saisie de texte : raccourcis + molettes début/fin) */
  .pl-pick{position:fixed;z-index:12000;background:#fff;border:1px solid var(--plline);border-radius:14px;
    box-shadow:0 18px 44px rgba(70,40,55,.28);padding:12px 13px;width:308px;display:none;font-size:12px}
  .pl-pick.pl-on{display:block}
  .pl-pick h4{margin:0 0 2px;font-size:12.5px;font-weight:700;color:var(--plink)}
  .pl-pick .pl-pk-sub{font-size:10.5px;color:var(--plmut);margin-bottom:9px}
  .pl-pk-lbl{font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--plmut);margin:9px 0 5px}
  .pl-pk-chips{display:flex;flex-wrap:wrap;gap:5px}
  .pl-pk-chip{border:1px solid var(--plline);background:#fff;border-radius:8px;padding:5px 9px;font-size:11.5px;
    font-weight:600;cursor:pointer;font-family:inherit;color:#2C3330;font-variant-numeric:tabular-nums}
  .pl-pk-chip:hover{border-color:var(--plac);background:var(--placs);color:var(--plac)}
  .pl-pk-chip.pl-act{background:var(--plac);border-color:var(--plac);color:#fff}
  .pl-pk-chip.pl-off{color:var(--plmut)}
  .pl-pk-chip.pl-off:hover{border-color:var(--plcrit);background:#FAE9E7;color:var(--plcrit)}
  .pl-pk-hm{display:flex;align-items:center;gap:7px}
  .pl-pk-hm select{flex:1 1 0;min-width:0;font-family:inherit;font-size:14px;font-weight:700;text-align:center;
    border:1px solid var(--plline);border-radius:9px;height:38px;background:#fff;color:var(--plac);
    font-variant-numeric:tabular-nums;cursor:pointer}
  .pl-pk-hm select:focus{outline:none;border-color:var(--plac);box-shadow:0 0 0 2px rgba(52,132,102,.18)}
  .pl-pk-ar{color:var(--plmut);font-weight:700}
  .pl-pk-dur{text-align:center;font-size:11px;color:var(--plmut);margin-top:7px}
  .pl-pk-dur b{color:var(--plac);font-size:13px;font-variant-numeric:tabular-nums}
  .pl-pk-pos{display:flex;gap:5px;margin-top:4px}
  .pl-pk-pos button{flex:1 1 0;border:1px solid var(--plline);background:#fff;border-radius:8px;padding:5px 0;
    font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;color:#2C3330}
  .pl-pk-pos button.pl-act{background:var(--plac);border-color:var(--plac);color:#fff}
  .pl-pk-ft{display:flex;gap:6px;margin-top:11px;padding-top:9px;border-top:1px solid var(--plline)}
  /* saisie directe des horaires dans la grille d'équipe */
  .pl-hrow{display:flex;align-items:center;gap:3px;margin:2px 0}
  .pl-hin{flex:1 1 auto;width:100%;min-width:0;font-family:inherit;font-size:11px;font-weight:600;text-align:center;
    border:1px solid transparent;border-left:3px solid var(--plac);border-radius:6px;padding:3px 2px;
    background:var(--placs);color:#1F5C46;font-variant-numeric:tabular-nums}
  .pl-hin::placeholder{color:#C6CFCA;font-weight:500}
  .pl-hin:placeholder-shown{background:transparent;border-left-color:transparent}
  .pl-hin:hover{border-color:var(--plline)}
  #pl-ov-reg .pl-hin:focus{outline:none;background:#fff;border-color:var(--plac);border-left-color:var(--plac);
    box-shadow:0 0 0 2px rgba(52,132,102,.18)}
  .pl-hin.pl-hB{border-left-color:#5B7BA8;background:#E9EFF6;color:#2C4A78}
  .pl-hin.pl-hA{border-left-color:var(--plrose);background:var(--plroses);color:var(--plrosei)}
  .pl-hin.pl-hpart{border-left-color:var(--plwarn);background:var(--plforb);color:#7A5A10}
  .pl-hin.pl-herr{border-color:var(--plcrit);background:#FAE9E7;color:var(--plcrit)}
  .pl-hin.pl-hB:placeholder-shown,.pl-hin.pl-hA:placeholder-shown,.pl-hin.pl-hpart:placeholder-shown{
    background:transparent;border-left-color:transparent}
  .pl-posb{font-style:normal;font-size:8.5px;font-weight:800;width:14px;height:16px;border-radius:4px;border:none;
    display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;padding:0;font-family:inherit}
  button.pl-posb{cursor:pointer}
  .pl-posv{background:none}
  .pl-tc{padding:2px 4px!important;min-width:92px}
  .pl-cyc{font-size:9px;font-weight:600;margin-top:2px;white-space:nowrap}
  .pl-cyc .pl-pill{padding:1px 6px;font-size:9px}
  .pl-ecarts{margin-top:2px;font-size:10.5px;display:flex;flex-wrap:wrap;gap:6px;align-items:center;
    padding:6px 9px;border-radius:9px;background:#FBFAF9;border:1px solid var(--plline)}
  .pl-ecarts.pl-ok{background:var(--placs);border-color:#CFE7DA;color:#1F5C46}
  .pl-ecarts.pl-ko{background:var(--plforb);border-color:#EAD9AE;color:#7A5A10}
  .pl-ecarts b{font-weight:700}
  .pl-hd-sp{flex:1 1 auto}
  .pl-hd .pl-btn,.pl-trtop .pl-btn{flex:0 0 auto;white-space:nowrap}
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
      <button class="pl-btn pl-ghost" onclick="plAbsOuvrir()">🏖 Déclarer une absence</button>
      <button class="pl-btn pl-rose" onclick="plOpenTrames()">🗓 Trames horaires</button>
      <button class="pl-btn pl-ghost" id="pl-btn-reg" onclick="plOpenReglages()">⚙ Réglages</button>
    </div>
    <div class="pl-legend">
      <span style="font-weight:700;color:var(--plink)">Motifs</span>
      <span class="pl-chip pl-ch-cp"><i></i>Congés</span>
      <span class="pl-chip pl-ch-mat"><i></i>Maternité</span>
      <span class="pl-chip pl-ch-mal"><i></i>Maladie</span>
      <span class="pl-chip pl-ch-rec"><i></i>Récupération</span>
      <span class="pl-chip pl-ch-for" title="Horaire habituel conservé, mais absent de la pharmacie"><i></i>Formation</span>
      <span class="pl-chip pl-ch-part"><i></i>Comptoir partiel</span>
      <span style="font-size:10.5px">Compteurs : <b>présents/seuil</b>, hors poste avancé</span>
      <span style="margin-left:auto" id="pl-info"></span>
    </div>
    <div id="pl-body"></div>
    <div class="pl-note">Planning théorique calculé depuis la trame type et les rotations. Un créneau <b>comptoir partiel</b> (ambre)
    ne couvre pas toute la plage d'ouverture (9h00-12h30 / 14h00-19h30) — typiquement une fin à 18h30.
    🚚 = aucun logisticien présent sur la fenêtre de livraisons (15h-18h) : désigner un responsable des livraisons ce jour-là.
    Une absence de plusieurs jours se déclare avec le bouton <b>Déclarer une absence</b> ; en <b>formation</b>, l'horaire habituel est conservé (il compte dans les heures) mais le collaborateur apparaît grisé et hors effectif.</div>
  </div>`;

  // ---------- modales (réglages + trame) ----------
  const PL_MODALS = `
  <div class="pl-ov pl-vars" id="pl-ov-reg"><div class="pl-box">
    <div class="pl-hd">
      <div>
        <h3 id="pl-reg-title">Réglages du planning</h3>
        <div class="pl-sub" id="pl-reg-sub">Rotations, seuils d'alerte et contrats. Les seuils déclenchent les alertes de couverture (règles R1 bis et R2 du cahier des charges).</div>
      </div>
      <span class="pl-hd-sp"></span>
      <button class="pl-btn pl-ghost pl-mini" onclick="plTramesOnglet()" title="Ouvrir un second onglet sur la trame">↗ Nouvel onglet</button>
      <button class="pl-btn pl-ghost pl-mini" id="pl-reg-full" onclick="plToggleFull()">⛶ Pleine page</button>
      <button class="pl-btn pl-ghost pl-mini" id="pl-reg-x" onclick="plClose('pl-ov-reg')" style="display:none">✕ Fermer</button>
    </div>
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
  <div class="pl-ov pl-vars" id="pl-ov-abs"><div class="pl-box" style="width:min(520px,96vw)">
    <h3>Déclarer une absence</h3>
    <div class="pl-sub">Congés, maternité, maladie, récupération ou formation, sur une ou plusieurs journées.</div>
    <div class="pl-form">
      <label style="flex:1 1 100%">Collaborateur<select id="pl-abs-cid" class="pl-inp"></select></label>
      <label style="flex:1 1 100%">Motif<select id="pl-abs-motif" class="pl-inp">
        <option value="cp">Vacances / congés payés</option><option value="mat">Congé maternité</option><option value="mal">Arrêt maladie</option>
        <option value="rec">Récupération</option><option value="for">Formation (horaire conservé, absent de la pharmacie)</option></select></label>
      <label style="flex:1 1 45%">Du<input type="date" id="pl-abs-debut" class="pl-inp"></label>
      <label style="flex:1 1 45%">Au<input type="date" id="pl-abs-fin" class="pl-inp"></label>
      <label style="flex:1 1 45%;flex-direction:row;align-items:center;gap:7px;font-weight:500"><input type="checkbox" id="pl-abs-debutam"> commence l'après-midi</label>
      <label style="flex:1 1 45%;flex-direction:row;align-items:center;gap:7px;font-weight:500"><input type="checkbox" id="pl-abs-finm"> se termine le midi</label>
      <label style="flex:1 1 100%">Commentaire (facultatif)<input type="text" id="pl-abs-com" class="pl-inp" placeholder="Ex. formation DPC à Caen"></label>
    </div>
    <div class="pl-sub" id="pl-abs-resume" style="margin-top:10px"></div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">
      <button class="pl-btn pl-ghost" onclick="plClose('pl-ov-abs')">Annuler</button>
      <button class="pl-btn pl-pri" onclick="plAbsEnregistrer()">Enregistrer</button>
    </div>
  </div></div>
  <div class="pl-ov pl-vars" id="pl-ov-imput"><div class="pl-box" style="width:min(480px,96vw)">
    <h3>Heures en plus de la trame</h3>
    <div class="pl-sub" id="pl-imput-sub">Ce créneau s'ajoute sur une demi-journée de repos.</div>
    <div style="display:flex;flex-direction:column;gap:9px;margin:14px 0 4px">
      <button class="pl-btn pl-pri" style="display:block;width:100%;padding:12px 14px;height:auto;text-align:left;line-height:1.35" onclick="plImputChoisir('hs')">
        <b>Heures supplémentaires</b><br><span style="font-weight:400;font-size:11.5px;opacity:.9">S'ajoutent aux heures habituelles, remontées sur la navette des salaires.</span></button>
      <button class="pl-btn pl-ghost" style="display:block;width:100%;padding:12px 14px;height:auto;text-align:left;line-height:1.35" onclick="plImputChoisir('compte')">
        <b>Compte-temps</b><br><span style="font-weight:400;font-size:11.5px;color:var(--plmut)">Créditées sur le compte-temps du collaborateur, à récupérer plus tard.</span></button>
    </div>
  </div></div>
  <div class="pl-ov pl-vars" id="pl-ov-jour"><div class="pl-box" style="width:min(560px,96vw)">
    <h3 id="pl-jr-title">Modifier ce jour</h3>
    <div class="pl-sub">Modification valable <b>ce jour uniquement</b> — la semaine type n'est pas touchée.
    Cliquez sur un horaire pour le choisir : créneaux habituels en un clic, ou début et fin au quart d'heure. « Repos » = ne travaille pas sur cette demi-journée.</div>
    <div id="pl-jr-body"></div>
    <div class="pl-actions">
      <button class="pl-btn pl-ghost" id="pl-jr-reset" onclick="plResetJour()">↩ Rétablir la trame</button>
      <span style="flex:1"></span>
      <button class="pl-btn pl-ghost" onclick="plClose('pl-ov-jour')">Annuler</button>
      <button class="pl-btn pl-pri" onclick="plSaveJour()">Enregistrer</button>
    </div>
  </div></div>
  <div class="pl-ov pl-vars" id="pl-ov-mep"><div class="pl-box" style="width:min(520px,96vw)">
    <h3>Mise en place de la trame</h3>
    <div class="pl-sub">La trame affichée ne s’appliquera qu’à partir de la date choisie. Les semaines antérieures gardent la trame précédente ; les modifications ponctuelles déjà saisies sur des journées ne sont pas touchées.</div>
    <div id="pl-mep-body"></div>
    <div class="pl-actions">
      <button class="pl-btn pl-ghost" onclick="plClose('pl-ov-mep')">Annuler</button>
      <button class="pl-btn pl-pri" onclick="plVerMepValider()">Mettre en place</button>
    </div>
  </div></div>
  <div class="pl-pick pl-vars" id="pl-pick">
    <h4 id="pl-pk-t">Horaires</h4>
    <div class="pl-pk-sub" id="pl-pk-s"></div>
    <div id="pl-pk-body"></div>
  </div>
  <div class="pl-toast" id="pl-toast"></div>`;

  // ---------- injection ----------
  function plInject() {
    if (document.getElementById('pl-css')) return;
    const st = document.createElement('style'); st.id = 'pl-css'; st.textContent = PL_CSS; document.head.appendChild(st);
    // Page dédiée /planning : un hôte est déjà en place, on s'y installe sans toucher au menu
    const host = document.getElementById('pl-host');
    if (host) {
      host.innerHTML = PL_SECTION;
      const fg2 = document.getElementById('pl-fgrp');
      if (fg2) Object.keys(PL_GRPS).forEach(g => { const o = document.createElement('option'); o.value = g; o.textContent = PL_GRPS[g].lbl; fg2.appendChild(o); });
      if (!document.getElementById('pl-ov-reg')) document.body.insertAdjacentHTML('beforeend', PL_MODALS);
      return;
    }
    // Intranet : le menu ouvre la page dédiée dans un nouvel onglet. Le planning est
    // devenu un métier à part entière (trames, congés, compteurs, navette) : il lui faut
    // son propre écran et son propre menu, sans celui des autres modules.
    const navRef = document.querySelector('.sb-item[data-sec="caisse"]') || document.querySelector('.sb-item[data-sec="livraisons"]');
    if (navRef && !document.querySelector('.sb-item[data-pl="1"]')) {
      const b = document.createElement('button');
      b.className = 'sb-item'; b.setAttribute('data-pl', '1');
      b.setAttribute('onclick', "window.open('/planning','_blank')");
      b.title = 'Ouvre le planning dans un nouvel onglet';
      b.innerHTML = '<svg class="ico sb-ico"><use href="#ic-calendrier"></use></svg><span class="sb-label">Planning ↗</span>';
      navRef.insertAdjacentElement('afterend', b);
    }
  }
  window.plOpen = function (id) { document.getElementById(id).classList.add('pl-on'); };
  window.plClose = function (id) { document.getElementById(id).classList.remove('pl-on'); try { plPkClose(); } catch (_e) { } };
  // Échap : ferme la fenêtre la plus haute, puis sort de la pleine page.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    const pk = document.getElementById('pl-pick');
    if (pk && pk.classList.contains('pl-on')) { plPkClose(); return; }
    const top = ['pl-ov-jour', 'pl-ov-trame'].find(id => {
      const n = document.getElementById(id); return n && n.classList.contains('pl-on');
    });
    if (top) { plClose(top); return; }
    const reg = document.getElementById('pl-ov-reg');
    if (reg && reg.classList.contains('pl-on')) plClose('pl-ov-reg');
  });

  // ---------- navigation ----------
  window.plSetView = function (v) {
    plView = v;
    document.querySelectorAll('#pl-seg button').forEach(b => b.classList.toggle('pl-act', b.dataset.v === v));
    plRender();
  };
  window.plNav = function (dir) {
    if (plView === 'sem') plAnchor = plAddD(plAnchor, dir * 7);
    else if (plView === 'mois') { const x = new Date(plAnchor); x.setMonth(x.getMonth() + dir); plAnchor = x; }
    else { const x = new Date(plAnchor); x.setMonth(x.getMonth() + dir * plAnMois); plAnchor = x; }
    plRender();
  };
  window.plToday = function () { plAnchor = plMonday(new Date()); plRender(); };
  window.plFiltre = function (g) { plFiltreGrp = g; plRender(); };

  // Ordre d'affichage commun à tous les écrans (trames, planning, contrats) :
  // par groupe, puis les titulaires en tête — Anouck d'abord, Olivier ensuite —,
  // puis par ordre alphabétique.
  function plTit(c) {
    if (c.id === 'ct:anouck') return 0;
    if (c.id === 'ct:olivier') return 1;
    return /titulaire/i.test(c.role || '') ? 2 : 3;
  }
  function plCmp(a, b) {
    return (PL_GRPS[a.grp] || { ord: 99 }).ord - (PL_GRPS[b.grp] || { ord: 99 }).ord
      || plTit(a) - plTit(b) || (a.nom || '').localeCompare(b.nom || '');
  }
  function plContratsVisibles() {
    return L('contrats')
      .filter(c => c.actif !== false)
      .filter(c => !plFiltreGrp || c.grp === plFiltreGrp)
      .sort(plCmp);
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
    plOmbreColonne();
  };
  // Ombre portée sur la colonne figée dès qu'on défile vers la droite : on voit qu'il y a
  // de la matière cachée sous la colonne des noms.
  function plOmbreColonne() {
    document.querySelectorAll('#pl-body .pl-card').forEach(card => {
      const maj = function () { card.classList.toggle('pl-scrolled', card.scrollLeft > 2); };
      card.addEventListener('scroll', maj, { passive: true });
      maj();
    });
  }

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
      if (c.grp !== lastGrp) { lastGrp = c.grp; h += '<tr class="pl-grp"><td class="pl-who"><span class="pl-grplbl" title="' + plEsc((PL_GRPS[c.grp] || { lbl: c.grp }).lbl) + '">' + plEsc((PL_GRPS[c.grp] || { lbl: c.grp }).lbl) + '</span></td><td colspan="6"></td></tr>'; }
      const planned = plHeuresSemaine(c, mon), base = plBase(c);
      // Sur un cycle de 2 à 4 semaines, une semaine seule n'a pas à tomber juste : c'est la
      // moyenne du cycle qui doit égaler le contrat. On affiche donc la semaine, puis le cycle.
      const ci = plCycleInfo(c, plTrameAt(c, mon).sem);
      const cls = (base == null || ci.ecart == null) ? '' : (ci.ecart === 0 ? 'good' : (Math.abs(ci.ecart) <= 0.25 ? '' : 'bad'));
      const cycHtml = (base == null) ? ''
        : '<div class="pl-cyc2 ' + cls + '" title="' + plEsc((ci.nb > 1 ? ci.tot.map((t, i) => 'S' + (i + 1) + ' ' + plFmtH(t)).join(' · ') + ' → moyenne ' + plFmtH(ci.moy) : 'semaine ' + plFmtH(ci.moy)) + ' pour un contrat de ' + plFmtH(base)) + '">'
          + (ci.ecart === 0 ? '✓ contrat ' + plFmtH(base) : 'contrat ' + plFmtH(base) + ' · ' + plEcartTxt(ci.ecart))
          + (ci.nb > 1 ? ' <span style="opacity:.75">sur ' + ci.nb + ' sem.</span>' : '') + '</div>';
      let cells = '';
      days.forEach(d => {
        const iso = plIso(d), sl = plSlots(c, d), ab = plAbs(c, iso);
        let cell = '';
        for (let hh = 0; hh < 2; hh++) {
          // chaque demi-journée est un point d'entrée : un clic ouvre le sélecteur d'horaires
          const clic = ' onclick="plJourPick(event,\'' + c.id + '\',\'' + iso + '\',' + hh + ')"';
          if (ab[hh] && plHeuresConservees(ab[hh]) && sl[hh]) cell += '<div class="pl-shift pl-formation" title="En formation — horaire habituel conservé (compte dans les heures), absent de la pharmacie">' + plEsc(sl[hh]) + '<i class="pl-fortag">' + (PL_MOTIFS[ab[hh]] || ab[hh]) + '</i></div>';
          else if (ab[hh] && !plHeuresConservees(ab[hh])) cell += '<div class="pl-abs ' + ab[hh] + '">' + (PL_MOTIFS[ab[hh]] || ab[hh]) + '</div>';
          else if (sl[hh]) {
            const pos = plPosEff(c, d, hh);
            const ex = plExOf(c, iso, hh ? 'AM' : 'M');
            const posBadge = (pos !== 'C' || PL_POS_CHOIX[c.grp]) ? '<i class="pl-pos pl-pos-' + pos + '" title="' + PL_POS_LBL[pos] + '">' + pos + '</i>' : '';
            const part = pos === 'C' && plPartiel(sl[hh], hh ? 'AM' : 'M');
            const tt = (ex ? 'Horaire modifié ce jour (trame : ' + (plSlotsTrame(c, d)[hh] || 'repos') + ') — ' : '')
              + (part ? plPartielTitle(sl[hh], hh ? 'AM' : 'M') + ' — ' : '')
              + PL_POS_LBL[pos] + ' · cliquer pour modifier ce jour';
            cell += '<div class="pl-shift pl-p' + pos + (part ? ' pl-part' : '') + (ex ? ' pl-mod' : '') + ' pl-click"' + clic + ' title="' + plEsc(tt) + '">' + plEsc(sl[hh]) + posBadge + (ex ? '<i class="pl-exdot" title="Exception du jour"></i>' : '') + '</div>';
          } else {
            const ex = plExOf(c, iso, hh ? 'AM' : 'M');
            if (ex) cell += '<div class="pl-off pl-mod pl-click"' + clic + ' style="border:1px dashed var(--plwarn);border-radius:6px" title="Créneau supprimé ce jour (trame : ' + plEsc(plSlotsTrame(c, d)[hh] || 'repos') + ')">absent<i class="pl-exdot"></i></div>';
            else cell += '<div class="pl-vide pl-click"' + clic + ' title="' + (hh ? 'Après-midi' : 'Matin') + ' — repos ; cliquer pour ajouter un créneau">' + (hh ? 'après-midi' : 'matin') + '</div>';
          }
        }
        // journée entièrement libre : on affiche « repos », et les deux demi-journées
        // n'apparaissent qu'au survol, pour rester cliquables sans alourdir la lecture
        const vide2 = (!ab[0] || plHeuresConservees(ab[0])) && (!ab[1] || plHeuresConservees(ab[1])) && !sl[0] && !sl[1] && !plExOf(c, iso, 'M') && !plExOf(c, iso, 'AM');
        cells += '<td class="pl-cell' + (vide2 ? ' pl-repos' : '') + '">'
          + (vide2 ? '<div class="pl-off pl-restlbl">repos</div>' : '') + cell + '</td>';
      });
      h += '<tr><td class="pl-who"><b>' + plEsc(c.nom) + '</b><small>' + plEsc(c.role || '') + '</small>'
        + '<div class="pl-hrs">' + plFmtH(planned) + '<span style="font-weight:500;color:var(--plmut)"> cette semaine</span></div>'
        + cycHtml + '</td>' + cells + '</tr>';
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
      if (c.grp !== lastGrp) { lastGrp = c.grp; h += '<tr class="pl-grp"><td class="pl-who"><span class="pl-grplbl" title="' + plEsc((PL_GRPS[c.grp] || { lbl: c.grp }).lbl) + '">' + plEsc((PL_GRPS[c.grp] || { lbl: c.grp }).lbl) + '</span></td><td colspan="' + nd + '"></td></tr>'; }
      h += '<tr><td class="pl-who"><b>' + plEsc(c.nom) + '</b><small>' + plEsc(c.role || '') + '</small></td>';
      for (let d = 1; d <= nd; d++) {
        const dt = new Date(y, m, d, 12), iso = plIso(dt);
        const sl = plSlots(c, dt), ab = plAbs(c, iso);
        let cell = '';
        for (let hh = 0; hh < 2; hh++) {
          let cls = 'pl-tick';
          if (ab[hh] && (!plHeuresConservees(ab[hh]) || sl[hh])) cls += ' ' + ab[hh];
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
          cell += '<div class="pl-mnp pl-mnp-' + k + '" title="' + PL_JOURS_FR[(dt.getDay() + 6) % 7] + ' ' + d + ' · ' + (demi === 'M' ? 'matin' : 'après-midi') + ' : ' + e.cpt + ' disponibles au comptoir / seuil ' + s2 + ' (hors poste avancé)">' + e.cpt + '</div>';
        });
      }
      h += '<td class="' + (dt.getDay() === 0 ? 'pl-wee' : '') + '" style="border-top:2px solid var(--plline)">' + cell + '</td>';
    }
    h += '</tr></tfoot></table></div>';
    document.getElementById('pl-body').innerHTML = h;
  }

  // ── vue Année ──
  // ── vue Année, zoomable : 12 / 6 / 3 / 1 mois. Plus la fenêtre est courte, plus la
  // bande s'élargit et plus on lit de détail (numéros de jour, effectif chiffré au comptoir).
  let plAnMois = 12;
  const PL_AN_W = { 12: 3, 6: 8, 3: 16, 1: 34 };   // largeur d'un jour en pixels selon le zoom
  window.plAnZoom = function (n) {
    plAnMois = n;
    plAnchor = (n === 12) ? new Date(plAnchor.getFullYear(), 0, 1, 12)
      : new Date(plAnchor.getFullYear(), plAnchor.getMonth(), 1, 12);
    plRender();
  };
  window.plAnGo = function (iso) {   // clic sur un jour : on bascule sur la semaine correspondante
    plAnchor = plMonday(new Date(iso + 'T12:00'));
    plSetView('sem');
  };
  function plRenderAn() {
    const w = PL_AN_W[plAnMois] || 4;
    const start = (plAnMois === 12) ? new Date(plAnchor.getFullYear(), 0, 1, 12)
      : new Date(plAnchor.getFullYear(), plAnchor.getMonth(), 1, 12);
    const end = new Date(start.getFullYear(), start.getMonth() + plAnMois, 1, 12);
    const finAff = plAddD(end, -1);
    document.getElementById('pl-lbl').textContent = plAnMois === 12 ? 'Année ' + start.getFullYear()
      : (plAnMois === 1 ? PL_MOIS_FR[start.getMonth()] + ' ' + start.getFullYear()
        : PL_MOIS_FR[start.getMonth()] + ' → ' + PL_MOIS_FR[finAff.getMonth()] + ' ' + finAff.getFullYear());
    document.getElementById('pl-info').textContent = 'Cliquer un jour ouvre sa semaine';

    // liste des jours de la fenêtre
    const jours = [];
    for (let d = new Date(start); d < end; d = plAddD(d, 1)) jours.push(new Date(d));

    // bandeau de zoom
    let h = '<div class="pl-anbar"><span class="pl-anlbl">Période affichée</span><div class="pl-seg pl-anseg">'
      + [[12, '12 mois'], [6, '6 mois'], [3, '3 mois'], [1, '1 mois']].map(z =>
        '<button class="' + (plAnMois === z[0] ? 'pl-act' : '') + '" onclick="plAnZoom(' + z[0] + ')">' + z[1] + '</button>').join('')
      + '</div><span class="pl-anhint">' + jours.length + ' jours affichés — zoomez pour lire le détail</span></div>';

    // en-tête : mois, et numéros de jour dès que la place le permet
    let heads = '<div class="pl-anhead" style="gap:' + (w >= 8 ? 1 : 0) + 'px">';
    let mm = -1, buf = 0, lblM = '';
    jours.forEach(d => {
      if (d.getMonth() !== mm) {
        if (mm !== -1) heads += '<span class="pl-anm" style="width:' + (buf * w) + 'px">' + lblM + '</span>';
        mm = d.getMonth(); buf = 0;
        lblM = plAnMois >= 6 ? PL_MOIS_FR[mm].slice(0, 4) : PL_MOIS_FR[mm] + (plAnMois === 12 ? '' : ' ' + d.getFullYear());
      }
      buf++;
    });
    heads += '<span class="pl-anm" style="width:' + (buf * w) + 'px">' + lblM + '</span></div>';
    if (w >= 16) {
      heads += '<div class="pl-anhead" style="gap:' + (w >= 8 ? 1 : 0) + 'px">' + jours.map(d =>
        '<span class="pl-and' + (d.getDay() === 0 ? ' pl-dim' : '') + '" style="width:' + w + 'px">'
        + (w >= 34 ? PL_JOURS_FR[(d.getDay() + 6) % 7].slice(0, 1) + ' ' : '') + d.getDate() + '</span>').join('') + '</div>';
    }

    const gap = w >= 8 ? 1 : 0;
    const largeur = jours.length * (w + gap);
    const stripSty = 'min-width:' + largeur + 'px;gap:' + gap + 'px';
    let t = '<table><thead><tr><th class="pl-who"></th><th style="padding:6px 6px 2px">' + heads + '</th></tr></thead><tbody>';

    // ── première ligne : effectif au comptoir, matin et après-midi ──
    let cpt = '';
    jours.forEach(d => {
      const iso = plIso(d);
      if (d.getDay() === 0) {   // dimanche : pharmacie fermée, pas d'alerte d'effectif
        cpt += '<span class="pl-ancol pl-anfer" style="width:' + w + 'px" title="Dimanche ' + d.getDate() + ' ' + PL_MOIS_FR[d.getMonth()] + ' — fermé">'
          + '<span class="pl-anc pl-fer"></span><span class="pl-anc pl-fer"></span></span>';
        return;
      }
      const eM = plEffectif(d, 'M'), eA = plEffectif(d, 'AM');
      const sM = plSeuilComptoir(d, 'M'), sA = plSeuilComptoir(d, 'AM');
      const kM = eM.cpt < sM ? 'bad' : (eM.cpt === sM ? 'lim' : 'ok');
      const kA = eA.cpt < sA ? 'bad' : (eA.cpt === sA ? 'lim' : 'ok');
      const tt = PL_JOURS_FR[(d.getDay() + 6) % 7] + ' ' + d.getDate() + ' ' + PL_MOIS_FR[d.getMonth()]
        + ' — comptoir matin ' + eM.cpt + '/' + sM + ', après-midi ' + eA.cpt + '/' + sA + ' (hors poste avancé)';
      const fs = w >= 34 ? ';font-size:11px;height:13px' : (w >= 16 ? ';font-size:9px;height:11px' : '');
      cpt += '<span class="pl-ancol" style="width:' + w + 'px" title="' + plEsc(tt) + '" onclick="plAnGo(\'' + iso + '\')">'
        + '<span class="pl-anc ' + kM + '" style="width:100%' + fs + '">' + (w >= 16 ? eM.cpt : '') + '</span>'
        + '<span class="pl-anc ' + kA + '" style="width:100%' + fs + '">' + (w >= 16 ? eA.cpt : '') + '</span></span>';
    });
    t += '<tr class="pl-cntrow"><td class="pl-who pl-cntlbl">Comptoir<br><span style="font-weight:500;text-transform:none;letter-spacing:0">matin / après-midi</span></td>'
      + '<td><div class="pl-strip" style="' + stripSty + '">' + cpt + '</div></td></tr>';

    // ── une bande par collaborateur ──
    let lastGrp = null;
    plContratsVisibles().forEach(c => {
      if (c.grp !== lastGrp) { lastGrp = c.grp; t += '<tr class="pl-grp"><td class="pl-who"><span class="pl-grplbl" title="' + plEsc((PL_GRPS[c.grp] || { lbl: c.grp }).lbl) + '">' + plEsc((PL_GRPS[c.grp] || { lbl: c.grp }).lbl) + '</span></td><td></td></tr>'; }
      let strip = '';
      jours.forEach(d => {
        const iso = plIso(d), sl = plSlots(c, d), ab = plAbs(c, iso);
        let cls = 'pl-dt';
        let tt = PL_JOURS_FR[(d.getDay() + 6) % 7] + ' ' + d.getDate() + ' ' + PL_MOIS_FR[d.getMonth()] + ' — ';
        const abv = [0, 1].map(k => ab[k] && (!plHeuresConservees(ab[k]) || sl[k]) ? ab[k] : null);
        if (abv[0] || abv[1]) { cls += ' ' + (abv[0] || abv[1]); tt += (PL_MOTIFS[abv[0] || abv[1]] || ''); }
        else if (sl[0] || sl[1]) { cls += ' on'; tt += [sl[0], sl[1]].filter(Boolean).join(' · '); }
        else tt += 'repos';
        if (plExOf(c, iso, 'M') || plExOf(c, iso, 'AM')) cls += ' pl-dtex';
        if (d.getDay() === 0) { cls += ' pl-dtdim'; tt = 'Dimanche ' + d.getDate() + ' ' + PL_MOIS_FR[d.getMonth()] + ' — fermé'; }
        strip += '<span class="' + cls + '" style="width:' + w + 'px" title="' + plEsc(tt) + '"'
          + (d.getDay() === 0 ? '' : ' onclick="plAnGo(\'' + iso + '\')"') + '>'
          + (w >= 34 && (sl[0] || sl[1]) ? '<i>' + plEsc((sl[0] || sl[1]).split('-')[0]) + '</i>' : '') + '</span>';
      });
      t += '<tr><td class="pl-who"><b>' + plEsc(c.nom) + '</b></td><td><div class="pl-strip" style="' + stripSty + '">' + strip + '</div></td></tr>';
    });
    t += '</tbody></table>';
    document.getElementById('pl-body').innerHTML = h + '<div class="pl-card pl-yr pl-anscroll">' + t + '</div>';
  }

  // ---------- réglages ----------
  let plRegView = 'c';
  let plTrRotSel = 'rot:prep', plTrRangSel = 1;
  let plRegFull = false;
  function plApplyFull() {
    const ov = document.getElementById('pl-ov-reg'); if (!ov) return;
    ov.classList.toggle('pl-full', plRegFull);
    const b = document.getElementById('pl-reg-full'), x = document.getElementById('pl-reg-x');
    if (b) b.textContent = plRegFull ? '⤡ Réduire' : '⛶ Pleine page';
    if (x) x.style.display = plRegFull ? '' : 'none';
  }
  window.plToggleFull = function () { plRegFull = !plRegFull; plApplyFull(); };
  // Ouvre l'intranet dans un second onglet, directement sur la trame (pour comparer deux écrans).
  window.plTramesOnglet = function () {
    window.open(location.origin + location.pathname + '#trames', '_blank');
  };
  // Un onglet ouvert sur #trames attend que la session soit ouverte, puis affiche la trame.
  function plHashWatch() {
    if (location.hash !== '#trames') return;
    let n = 0;
    const t = setInterval(function () {
      const app = document.getElementById('app');
      const pret = app && app.style.display !== 'none' && typeof window.showSec === 'function'
        && document.getElementById('sec-planning');
      if (pret) {
        clearInterval(t);
        try { history.replaceState(null, '', location.pathname); } catch (_e) { }
        try { window.showSec('planning', document.querySelector('.sb-item[data-sec="planning"]')); } catch (_e) { }
        setTimeout(function () { try { plOpenTrames(); } catch (_e) { } }, 250);
      } else if (++n > 300) clearInterval(t);   // 2 min d'attente maximum (le temps de se connecter)
    }, 400);
  }
  window.plOpenReglages = function () { plRegView = 'c'; plRegFull = false; plApplyFull(); plRegRender(); plOpen('pl-ov-reg'); };
  // La trame d'équipe s'ouvre en pleine page : c'est un exercice qui demande toute la largeur.
  window.plOpenTrames = function () { plRegView = 't'; plRegFull = true; plApplyFull(); plRegRender(); plOpen('pl-ov-reg'); };
  window.plRegTab = function (t) { plRegView = t; plRegRender(); };
  window.plTrSel = function (rid, rang) { if (rid) plTrRotSel = rid; plTrRangSel = +rang; plRegRender(); };
  // ---------- sélecteur d'horaires : on choisit, on ne tape pas ----------
  // Un clic sur un créneau ouvre une palette : raccourcis les plus utilisés dans la pharmacie,
  // puis deux menus début / fin par pas de 15 min. Aucune saisie de texte n'est nécessaire.
  let plPkAnc = null, plPkA = null, plPkB = null, plPkPos = null, plPkOnPos = null;
  let plPkSetV = null, plPkHh = 0, plPkGrp = null, plPkReset = null, plPkPosFixe = null;

  function plMinOf(s) {   // "14h30" → 870
    const m = String(s || '').match(/(\d{1,2})h?(\d{2})?/);
    return m ? (+m[1]) * 60 + (+(m[2] || 0)) : null;
  }
  function plHhOf(min) { const h = Math.floor(min / 60), m = min % 60; return h + 'h' + (m ? String(m).padStart(2, '0') : ''); }
  function plSplitSlot(s) {
    const m = String(s || '').match(/^(.+?)\s*[-–]\s*(.+)$/);
    return m ? [plMinOf(m[1]), plMinOf(m[2])] : [null, null];
  }
  // Raccourcis : les horaires réellement les plus utilisés par l'équipe sur cette demi-journée.
  function plTopSlots(hh, grp) {
    const cnt = {};
    L('contrats').forEach(c => {
      if (c.actif === false) return;
      const poids = (grp && c.grp === grp) ? 3 : 1;   // priorité aux collègues du même métier
      const sem0 = plSemCtx(c);
      Object.keys(sem0).forEach(w => {
        PL_JOURS.slice(0, 6).forEach(j => {
          const v = (sem0[w][j] || [])[hh];
          if (v) cnt[v] = (cnt[v] || 0) + poids;
        });
      });
    });
    const def = hh ? ['14h-19h30', '14h-18h30'] : ['9h-12h30'];
    def.forEach(v => { cnt[v] = (cnt[v] || 0) + 1; });
    const canon = {};
    Object.keys(cnt).forEach(v => {
      const p2 = plSplitSlot(v);
      if (p2[0] == null || p2[1] == null) return;
      const k = plHhOf(p2[0]) + '-' + plHhOf(p2[1]);
      canon[k] = (canon[k] || 0) + cnt[v];
    });
    return Object.keys(canon).sort((a, b) => canon[b] - canon[a] || plMinOf(a) - plMinOf(b)).slice(0, 6);
  }
  function plPkOpts(sel) {
    let o = '';
    for (let m = 360; m <= 1290; m += 15) o += '<option value="' + m + '"' + (m === sel ? ' selected' : '') + '>' + plHhOf(m) + '</option>';
    return o;
  }
  function plPkRender() {
    const hh = plPkHh, grp = plPkGrp;
    const cour = plPkA != null && plPkB != null ? plHhOf(plPkA) + '-' + plHhOf(plPkB) : '';
    const tops = plTopSlots(hh, grp);
    let h = '<div class="pl-pk-lbl">Créneaux habituels</div><div class="pl-pk-chips">'
      + tops.map(v => '<button class="pl-pk-chip' + (v === cour ? ' pl-act' : '') + '" onclick="plPkSet(\'' + v + '\')">' + v + '</button>').join('')
      + '<button class="pl-pk-chip pl-off" onclick="plPkSet(\'\')">Repos</button></div>'
      + '<div class="pl-pk-lbl">Ou choisir précisément</div>'
      + '<div class="pl-pk-hm"><select id="pl-pk-a" onchange="plPkBorne(0,this.value)">' + plPkOpts(plPkA == null ? (hh ? 840 : 540) : plPkA) + '</select>'
      + '<span class="pl-pk-ar">→</span>'
      + '<select id="pl-pk-b" onchange="plPkBorne(1,this.value)">' + plPkOpts(plPkB == null ? (hh ? 1170 : 750) : plPkB) + '</select></div>'
      + '<div class="pl-pk-dur">' + (plPkA != null && plPkB != null && plPkB > plPkA
        ? 'durée <b>' + plFmtH(Math.round((plPkB - plPkA) / 15) / 4) + '</b>'
        : (plPkA == null ? 'aucun horaire — <b>repos</b>' : '<span style="color:var(--plcrit)">la fin doit suivre le début</span>')) + '</div>';
    if (plPkOnPos) {
      h += '<div class="pl-pk-lbl">Poste</div><div class="pl-pk-pos">'
        + ['C', 'B', 'A'].map(p => '<button class="' + (p === plPkPos ? 'pl-act' : '') + '" onclick="plPkPoste(\'' + p + '\')">' + PL_POS_LBL[p] + '</button>').join('') + '</div>';
    } else if (plPkPosFixe) {
      h += '<div class="pl-pk-lbl">Poste</div><div style="font-size:11.5px;color:var(--plmut)">'
        + '<span class="pl-posb pl-pos-' + plPkPosFixe + '" style="display:inline-flex;vertical-align:-3px;margin-right:5px">' + plPkPosFixe + '</span>'
        + PL_POS_LBL[plPkPosFixe] + ' <span style="opacity:.75">— fixe pour ce métier</span></div>';
    }
    h += '<div class="pl-pk-ft">'
      + (plPkReset ? '<button class="pl-btn pl-ghost pl-mini" onclick="plPkDoReset()">↩ ' + plEsc(plPkReset.lbl) + '</button>' : '')
      + '<button class="pl-btn pl-ghost pl-mini" onclick="plPkClose()">Fermer</button>'
      + '<span style="flex:1"></span><span style="font-size:10px;color:var(--plmut);align-self:center">Échap</span></div>';
    document.getElementById('pl-pk-body').innerHTML = h;
  }
  function plPkApply() {
    if (!plPkSetV) return;
    const v = (plPkA != null && plPkB != null && plPkB > plPkA) ? plHhOf(plPkA) + '-' + plHhOf(plPkB) : '';
    plPkSetV(v);
    plPkRender();
  }
  window.plPkDoReset = function () { const r = plPkReset; plPkClose(); if (r) r.fn(); };
  window.plPkCur = function () {
    return (plPkA != null && plPkB != null && plPkB > plPkA) ? plHhOf(plPkA) + '-' + plHhOf(plPkB) : '';
  };
  window.plPkSet = function (v) {
    const p = plSplitSlot(v);
    plPkA = p[0]; plPkB = p[1];
    plPkApply();
    if (v) plPkClose();   // un raccourci = un seul geste
  };
  window.plPkBorne = function (i, val) {
    const m = +val;
    if (i === 0) { plPkA = m; if (plPkB == null || plPkB <= m) plPkB = Math.min(1290, m + 210); }
    else { plPkB = m; if (plPkA == null) plPkA = Math.max(360, m - 210); }
    plPkApply();
  };
  window.plPkPoste = function (p) { plPkPos = p; if (plPkOnPos) plPkOnPos(p); plPkRender(); };
  window.plPkClose = function () {
    const n = document.getElementById('pl-pick'); if (n) n.classList.remove('pl-on');
    plPkAnc = null; plPkOnPos = null; plPkSetV = null; plPkReset = null; plPkPosFixe = null;
  };
  // opts : {val, hh, grp, titre, sous, pos, posFixe, onSet, onPos, reset:{lbl,fn}}
  window.plPkOpen = function (anc, opts) {
    opts = opts || {};
    const n = document.getElementById('pl-pick'); if (!n || !anc) return;
    plPkAnc = anc;
    const estInput = anc.tagName === 'INPUT';
    const val = opts.val != null ? opts.val : (estInput ? anc.value : '');
    plPkSetV = opts.onSet || (estInput ? function (v) { anc.value = v; anc.dispatchEvent(new Event('change', { bubbles: true })); } : null);
    plPkHh = opts.hh != null ? opts.hh : (estInput ? +(anc.dataset.h || 0) : 0);
    plPkGrp = opts.grp != null ? opts.grp : (estInput ? anc.dataset.g : null);
    plPkReset = opts.reset || null; plPkPosFixe = opts.posFixe || null;
    const p = plSplitSlot(val);
    plPkA = p[0]; plPkB = p[1];
    plPkPos = opts.pos || null; plPkOnPos = opts.onPos || null;
    document.getElementById('pl-pk-t').textContent = opts.titre || 'Horaires';
    document.getElementById('pl-pk-s').textContent = opts.sous || '';
    plPkRender();
    n.classList.add('pl-on');
    // positionnement sous la case, en restant dans la fenêtre
    const r = anc.getBoundingClientRect(), b = n.getBoundingClientRect();
    let x = r.left + r.width / 2 - b.width / 2, y = r.bottom + 6;
    if (y + b.height > innerHeight - 8) y = Math.max(8, r.top - b.height - 6);
    n.style.left = Math.max(8, Math.min(x, innerWidth - b.width - 8)) + 'px';
    n.style.top = y + 'px';
  };
  document.addEventListener('mousedown', function (e) {
    const n = document.getElementById('pl-pick');
    if (!n || !n.classList.contains('pl-on')) return;
    if (n.contains(e.target) || (plPkAnc && plPkAnc.contains && plPkAnc.contains(e.target)) || e.target === plPkAnc) return;
    plPkClose();
  });

  // ---------- saisie directe des horaires dans la grille d'équipe ----------
  let plTrRef = null;   // lundi de la semaine type affichée (pour recalculer les compteurs)

  // Normalise une saisie libre en « 9h-12h30 » : 9-12h30, 9:00 12:30, 9h00 à 12h30…
  function plNormHoraire(v) {
    const s = String(v || '').trim();
    if (!s) return { val: null, ok: true };
    const m = s.match(/^(\d{1,2})\s*[h:.,]?\s*(\d{2})?\s*(?:[-–—]|à|a|\/)\s*(\d{1,2})\s*[h:.,]?\s*(\d{2})?$/i);
    if (!m) return { val: s, ok: false };
    const f = (h, mn) => (+h) + 'h' + (mn && +mn ? mn : '');
    const out = f(m[1], m[2]) + '-' + f(m[3], m[4]);
    return { val: out, ok: plDurOf(out) > 0 };
  }

  function plTrCntHtml(refDate) {
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
    return cnt + '</table>' + plEcartsHtml();
  }
  // Contrôle du temps contractuel : un cycle de 1 à 4 semaines doit retomber, EN MOYENNE,
  // sur la base hebdomadaire du contrat (ex. 34h30 + 35h30 sur 2 semaines = 35 h).
  function plCycleInfo(c, semSrc) {
    const rot = plRotOf(c), nb = rot ? rot.longueur : 1;
    const tot = [];
    const semC = semSrc || plSemCtx(c);
    for (let w = 1; w <= nb; w++) {
      const sem = semC[String(w)] || semC['1'] || {};
      let t = 0;
      PL_JOURS.slice(0, 6).forEach(j => { const d = sem[j] || [null, null]; t += plDurOf(d[0]) + plDurOf(d[1]); });
      tot.push(Math.round(t * 4) / 4);
    }
    const moy = Math.round((tot.reduce((a, b) => a + b, 0) / nb) * 4) / 4;
    const ecart = (c.base == null) ? null : Math.round((moy - c.base) * 4) / 4;
    return { nb: nb, tot: tot, moy: moy, ecart: ecart };
  }
  function plEcartKind(e) { return e === 0 ? 'ok' : (Math.abs(e) <= 0.25 ? 'lim' : 'bad'); }
  function plEcartTxt(e) {
    const a = Math.abs(e);
    return (e > 0 ? '+' : '−') + (a < 1 ? Math.round(a * 60) + ' min' : plFmtH(a));
  }
  function plRowTotHtml(c, rang) {
    const ci = plCycleInfo(c);
    const semTot = ci.tot[(+rang || 1) - 1] != null ? ci.tot[(+rang || 1) - 1] : 0;
    let h = '<div style="font-weight:700">' + plFmtH(semTot) + '</div>';
    if (c.base == null) {
      h += '<div class="pl-cyc" style="color:var(--plmut)">contrat non renseigné</div>';
    } else {
      const det = (ci.nb > 1 ? ci.tot.map((t, i) => 'S' + (i + 1) + ' ' + plFmtH(t)).join(' · ') + ' → moyenne ' + plFmtH(ci.moy) : 'semaine ' + plFmtH(ci.moy))
        + ' pour un contrat de ' + plFmtH(c.base);
      h += '<div class="pl-cyc"><span class="pl-pill ' + plEcartKind(ci.ecart) + '" title="' + plEsc(det) + '">'
        + (ci.ecart === 0 ? '✓ ' + plFmtH(c.base) : plEcartTxt(ci.ecart)) + '</span>'
        + (ci.nb > 1 ? '<span style="color:var(--plmut)"> sur ' + ci.nb + ' sem.</span>' : '') + '</div>';
    }
    return h;
  }
  function plEcartsHtml() {
    const ko = [];
    L('contrats').filter(c => c.actif !== false && c.base != null).forEach(c => {
      const ci = plCycleInfo(c);
      if (ci.ecart !== 0) ko.push({ c: c, e: ci.ecart, k: plEcartKind(ci.ecart) });
    });
    if (!ko.length) return '<div class="pl-ecarts pl-ok"><b>✓ Temps de travail contractuel respecté</b> — sur l’ensemble du cycle, chaque collaborateur retombe sur la base de son contrat.</div>';
    ko.sort((a, b) => Math.abs(b.e) - Math.abs(a.e));
    return '<div class="pl-ecarts pl-ko"><b>Écart avec le contrat sur le cycle</b> ('
      + ko.length + (ko.length > 1 ? ' collaborateurs' : ' collaborateur') + ') : '
      + ko.map(x => '<span class="pl-pill ' + x.k + '" style="padding:1px 6px" title="' + plEsc(x.c.nom + ' — contrat ' + plFmtH(x.c.base)) + '">'
        + plEsc(x.c.nom.split(' ')[0]) + ' ' + plEcartTxt(x.e) + '</span>').join(' ') + '</div>';
  }
  function plTrCntRefresh() {
    const el = document.getElementById('pl-trcnt');
    if (!el || !plTrRef) return;
    plVerForce = plVerEditObj();
    try { el.innerHTML = plTrCntHtml(plTrRef); } finally { plVerForce = null; }
  }
  // La ligne affichée peut retomber sur la semaine 1 quand le rang n'existe pas : on la matérialise avant d'écrire.
  function plSemOf(c, rang) {
    const e = plEdSlot(c);
    if (!e.sem[rang]) e.sem[rang] = JSON.parse(JSON.stringify(e.sem['1'] || {}));
    return e.sem[rang];
  }
  window.plGridPick = function (el) {
    const c = L('contrats').find(x => x.id === el.dataset.c); if (!c) return;
    const jr = el.dataset.j, hh = +el.dataset.h, rang = el.dataset.r;
    plPkOpen(el, {
      titre: c.nom.split(' ')[0] + ' · ' + PL_JOURS_FR[PL_JOURS.indexOf(jr)] + (hh ? ' après-midi' : ' matin'),
      sous: 'Semaine type ' + rang + ' du cycle — vaut pour toutes les semaines équivalentes',
      pos: PL_POS_CHOIX[c.grp] ? plPosOf(c, rang, jr, hh, plEdSlot(c).pos) : null,
      posFixe: PL_POS_CHOIX[c.grp] ? null : plPosOf(c, rang, jr, hh, plEdSlot(c).pos),
      onPos: PL_POS_CHOIX[c.grp] ? function (p) {
        const e = plEdSlot(c);
        if (!e.pos[rang]) e.pos[rang] = {};
        if (!e.pos[rang][jr]) e.pos[rang][jr] = ['C', 'C'];
        e.pos[rang][jr][hh] = p; plStamp(e.obj); plPersist();
        el.classList.remove('pl-hB', 'pl-hA', 'pl-hpart');
        if (p !== 'C') el.classList.add('pl-h' + p);
        else if (el.value && plPartiel(el.value, hh ? 'AM' : 'M')) el.classList.add('pl-hpart');
        const b = el.nextElementSibling;
        if (b && el.value) { b.outerHTML = '<button class="pl-posb pl-pos-' + p + '" title="' + PL_POS_LBL[p] + ' — cliquer pour changer de poste" onclick="plCyclePos(\'' + c.id + '\',\'' + rang + '\',\'' + jr + '\',' + hh + ')">' + p + '</button>'; }
        plTrCntRefresh(); plRender();
      } : null
    });
  };
  window.plGridSet = function (el) {
    const c = L('contrats').find(x => x.id === el.dataset.c); if (!c) return;
    const rang = el.dataset.r, jr = el.dataset.j, hh = +el.dataset.h;
    const n = plNormHoraire(el.value);
    el.classList.toggle('pl-herr', !n.ok);
    if (!n.ok) { plToast('Format attendu : 9h-12h30'); return; }
    el.value = n.val || '';
    const sem = plSemOf(c, rang);
    if (!sem[jr]) sem[jr] = [null, null];
    sem[jr][hh] = n.val;
    plStamp(plEdSlot(c).obj); plPersist();
    // mise à jour ciblée : on ne reconstruit pas la grille, la saisie continue au clavier
    const pos = plPosOf(c, rang, jr, hh, plEdSlot(c).pos);
    const part = n.val && pos === 'C' && plPartiel(n.val, hh ? 'AM' : 'M');
    el.classList.toggle('pl-hpart', !!part);
    // la pastille de poste suit la case : elle apparaît dès qu'un horaire est saisi (sans casser la frappe)
    const bEl = el.nextElementSibling;
    if (bEl) {
      if (!n.val) bEl.outerHTML = '<i class="pl-posb pl-posv"></i>';
      else if (bEl.classList.contains('pl-posv')) {
        bEl.outerHTML = PL_POS_CHOIX[c.grp]
          ? '<button class="pl-posb pl-pos-' + pos + '" title="' + PL_POS_LBL[pos] + ' — cliquer pour changer de poste"'
            + ' onclick="plCyclePos(\'' + c.id + '\',\'' + rang + '\',\'' + jr + '\',' + hh + ')">' + pos + '</button>'
          : (pos !== 'C' ? '<i class="pl-posb pl-pos-' + pos + '" title="' + PL_POS_LBL[pos] + '">' + pos + '</i>' : '<i class="pl-posb pl-posv"></i>');
      }
    }
    const tEl = document.getElementById('pl-trtot-' + c.id);
    if (tEl) tEl.innerHTML = plRowTotHtml(c, rang);
    plTrCntRefresh();
    plRender();
  };
  // Entrée / flèches : on circule dans la grille sans quitter le clavier.
  window.plGridKey = function (e, el) {
    if (e.key !== 'Enter' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const all = [...document.querySelectorAll('#pl-reg-body .pl-hin')];
    const i = all.indexOf(el);
    const next = all[i + (e.key === 'ArrowUp' ? -1 : 1)];
    el.blur();
    if (next) { next.focus(); next.select(); }
  };
  window.plRowCopy = function (cid, rang) {
    const c = L('contrats').find(x => x.id === cid); if (!c) return;
    const rot = plRotOf(c), nb = rot ? rot.longueur : 1;
    const src = plSemOf(c, rang), e = plEdSlot(c);
    for (let w = 1; w <= nb; w++) {
      if (String(w) === String(rang)) continue;
      e.sem[String(w)] = JSON.parse(JSON.stringify(src));
      if (e.pos[rang]) e.pos[String(w)] = JSON.parse(JSON.stringify(e.pos[rang]));
    }
    plStamp(e.obj); plPersist(); plToast(c.nom.split(' ')[0] + ' · semaine recopiée sur tout le cycle');
    plRegRender(); plRender();
  };

  // ---------- versions de trame : brouillons et mise en place ----------
  // Le contenu d'une version est un instantané de toute l'équipe : chaque contrat y a
  // sa semaine type et ses positions, plus rang0 = la semaine de son cycle à la date de début.
  function plSnapshot(rangType) {
    const data = {};
    L('contrats').filter(c => c.actif !== false).forEach(c => {
      const e = plEdSlot(c);
      data[c.id] = {
        rang0: rangType ? +rangType(c) : 1,
        sem: JSON.parse(JSON.stringify(e.sem)),
        pos: JSON.parse(JSON.stringify(e.pos))
      };
    });
    return data;
  }
  // semaine de référence d'un « Type » : sert à savoir dans quelle semaine de son cycle
  // se trouve chaque collaborateur au moment de la mise en place
  function plRefType(k) {
    const rots = L('rotations').filter(r => L('contrats').some(c => c.actif !== false && c.rotationId === r.id));
    const anc0 = rots.length ? rots.map(r => r.ancrage).sort()[0] : plIso(new Date());
    return plAddD(plMonday(new Date(anc0 + 'T12:00')), (k - 1) * 7);
  }
  function plNbTypes() {
    const rots = L('rotations').filter(r => L('contrats').some(c => c.actif !== false && c.rotationId === r.id));
    function pgcd(a, b) { return b ? pgcd(b, a % b) : a; }
    let n = 1; rots.forEach(r => { n = n * r.longueur / pgcd(n, r.longueur); });
    return Math.min(n, 12);
  }
  window.plVerSel = function (id) { plVerEdit = id; plRegRender(); };
  window.plVerBrouillon = function () {
    // pas de question au moment de créer : on nomme après, avec ✎ (le geste doit rester léger)
    const n = plVerBrouillons().length + 1;
    const nom = 'Brouillon ' + n + ' · ' + plJoli(plIso(new Date()));
    const v = { id: plNewId('tr'), nom: nom, statut: 'brouillon', debut: null, fin: null,
      typeDebut: plTrRangSel || 1, data: plSnapshot(null), updatedAt: Date.now() };
    plTrames.push(v);
    plVerEdit = v.id; plPersist();
    plToast('Brouillon créé — invisible dans le planning ; ✎ pour le renommer'); plRegRender();
  };
  window.plVerRenommer = function () {
    const v = plVerEditObj(); if (!v) return;
    const nom = prompt('Nom de cette version', v.nom || '');
    if (nom === null) return;
    v.nom = nom.trim(); plStamp(v); plPersist(); plRegRender();
  };
  window.plVerSuppr = function () {
    const v = plVerEditObj(); if (!v) return;
    if (!confirm(v.statut === 'brouillon'
      ? 'Supprimer le brouillon « ' + (v.nom || '') + ' » ?'
      : 'Supprimer la mise en place du ' + plJoli(v.debut) + ' ? Le planning repassera à la trame précédente sur cette période.')) return;
    const i = plTrames.findIndex(x => x.id === v.id);
    if (i >= 0) plTrames.splice(i, 1);
    plVerEdit = null; plPersist(); plToast('Version supprimée'); plRegRender(); plRender();
  };
  window.plVerMepOuvrir = function () {
    const v = plVerEditObj();
    const nb = plNbTypes();
    const lundiProchain = plIso(plMonday(plAddD(new Date(), 7)));
    const deb = (v && v.debut) || lundiProchain;
    let h = '<div class="pl-form" style="flex-direction:column;gap:14px">'
      + '<label style="width:100%">Date de mise en place <span style="font-weight:400">— la trame s’applique à partir de ce jour</span>'
      + '<input type="date" class="pl-inp" id="pl-mep-deb" value="' + deb + '"></label>'
      + '<label style="width:100%"><span style="display:flex;align-items:center;gap:8px">Date de fin'
      + '<input type="checkbox" id="pl-mep-sf" ' + (v && v.fin ? '' : 'checked') + ' onchange="document.getElementById(\'pl-mep-fin\').disabled=this.checked">'
      + '<span style="font-weight:400">pas de fin (jusqu’à nouvel ordre)</span></span>'
      + '<input type="date" class="pl-inp" id="pl-mep-fin" value="' + ((v && v.fin) || '') + '"' + (v && v.fin ? '' : ' disabled') + '></label>'
      + '<label style="width:100%">Semaine de début du cycle'
      + '<select class="pl-inp" id="pl-mep-type">';
    for (let k = 1; k <= nb; k++) {
      const dk = plRefType(k);
      const det = L('rotations').filter(r => L('contrats').some(c => c.actif !== false && c.rotationId === r.id))
        .map(r => plEsc(r.lbl) + ' S' + plRang(r, dk)).join(' · ');
      h += '<option value="' + k + '"' + ((v && v.typeDebut === k) || (!v && plTrRangSel === k) ? ' selected' : '') + '>Semaine type ' + k + (det ? ' — ' + det : '') + '</option>';
    }
    h += '</select><span style="font-weight:400;font-size:10.5px;margin-top:4px">La première semaine appliquée sera celle-ci ; le cycle se déroule ensuite normalement.</span></label></div>';
    document.getElementById('pl-mep-body').innerHTML = h;
    plOpen('pl-ov-mep');
  };
  window.plVerMepValider = function () {
    const deb = document.getElementById('pl-mep-deb').value;
    if (!deb) { plToast('Choisissez une date de mise en place'); return; }
    const sansFin = document.getElementById('pl-mep-sf').checked;
    const fin = sansFin ? null : (document.getElementById('pl-mep-fin').value || null);
    if (fin && fin < deb) { plToast('La date de fin doit suivre la date de mise en place'); return; }
    const k = +document.getElementById('pl-mep-type').value || 1;
    const refK = plRefType(k);
    const rangType = function (c) { return plRang(plRotOf(c), refK); };
    let v = plVerEditObj();
    if (v) {   // un brouillon (ou une version déjà datée) devient la trame en vigueur
      v.statut = 'actif'; v.debut = deb; v.fin = fin; v.typeDebut = k;
      const snap = plSnapshot(rangType);
      Object.keys(snap).forEach(cid => {
        if (!v.data[cid]) v.data[cid] = snap[cid];
        else v.data[cid].rang0 = snap[cid].rang0;
      });
      plStamp(v);
    } else {   // depuis la trame de base : on crée une version datée qui la reprend
      v = { id: plNewId('tr'), nom: 'Trame du ' + plJoli(deb), statut: 'actif', debut: deb, fin: fin,
        typeDebut: k, data: plSnapshot(rangType), updatedAt: Date.now() };
      plTrames.push(v);
    }
    // la version précédente s'arrête la veille, pour ne pas se chevaucher
    const veille = plIso(plAddD(new Date(deb + 'T12:00'), -1));
    plVerActives().forEach(o => {
      if (o.id === v.id) return;
      if (o.debut < v.debut && (!o.fin || o.fin >= v.debut)) { o.fin = veille; plStamp(o); }
    });
    plVerEdit = v.id; plPersist(); plClose('pl-ov-mep');
    plToast('Trame en place à partir du ' + plJoli(deb));
    plRegRender(); plRender();
  };

  function plRegRender() {
    ['t', 'c', 'r', 's'].forEach(t => { const b = document.getElementById('pl-rt-' + t); if (b) b.classList.toggle('pl-act', t === plRegView); });
    const rtT = document.getElementById('pl-reg-title'), rtS = document.getElementById('pl-reg-sub');
    if (rtT) rtT.textContent = plRegView === 't' ? 'Trames horaires — semaine type de l’équipe' : 'Réglages du planning';
    if (rtS) rtS.innerHTML = plRegView === 't'
      ? 'Construisez la semaine type de toute l’équipe : les compteurs du haut se recalculent à chaque modification.'
      : 'Rotations, seuils d’alerte et contrats. Les seuils déclenchent les alertes de couverture (règles R1 bis et R2 du cahier des charges).';
    const el = document.getElementById('pl-reg-body'); if (!el) return;
    const scrollY = el.scrollTop;
    setTimeout(function () { try { el.scrollTop = scrollY; } catch (_e) { } }, 0);
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
      const vEd = plVerEditObj();
      plVerForce = vEd;   // tout ce qui suit (compteurs compris) lit la version éditée
      // ── choix de la trame éditée : en vigueur, versions datées, brouillons ──
      let verHtml = '<div class="pl-trtop"><div class="pl-verbar">'
        + '<span class="pl-verlbl">Trame modifiée</span>'
        + '<button class="pl-btn ' + (!plVerEdit ? 'pl-pri' : 'pl-ghost') + ' pl-mini" onclick="plVerSel(null)">Trame de base</button>';
      plVerActives().forEach(v => {
        verHtml += '<button class="pl-btn ' + (plVerEdit === v.id ? 'pl-pri' : 'pl-ghost') + ' pl-mini" title="En vigueur ' + plEsc(plVerLbl(v)) + '" onclick="plVerSel(\'' + v.id + '\')">📅 ' + plJoli(v.debut) + (v.fin ? '→' + plJoli(v.fin) : '') + '</button>';
      });
      plVerBrouillons().forEach(v => {
        verHtml += '<button class="pl-btn ' + (plVerEdit === v.id ? 'pl-pri' : 'pl-ghost') + ' pl-mini" onclick="plVerSel(\'' + v.id + '\')">✎ ' + plEsc(v.nom || 'brouillon') + '</button>';
      });
      verHtml += '<span style="flex:1"></span>'
        + '<button class="pl-btn pl-ghost pl-mini" title="Copier la trame affichée dans un brouillon qui n’affecte pas le planning" onclick="plVerBrouillon()">＋ Nouveau brouillon</button>'
        + '<button class="pl-btn pl-rose pl-mini" title="Choisir la date à partir de laquelle cette trame s’applique" onclick="plVerMepOuvrir()">📅 Mise en place…</button>'
        + (vEd ? '<button class="pl-btn pl-ghost pl-mini" title="Renommer" onclick="plVerRenommer()">✎</button>'
          + '<button class="pl-btn pl-ghost pl-mini" title="Supprimer cette version" onclick="plVerSuppr()">🗑</button>' : '')
        + '</div>';
      verHtml += '<div class="pl-verinfo ' + (vEd && vEd.statut === 'brouillon' ? 'pl-br' : (vEd ? 'pl-ac' : '')) + '">'
        + (!vEd ? 'Vous modifiez la <b>trame de base</b> : elle s’applique à toutes les dates qu’aucune mise en place ne couvre. Pour qu’un changement ne vaille qu’à partir d’une date, passez par <b>Mise en place</b>.'
          : (vEd.statut === 'brouillon'
            ? '<b>Brouillon « ' + plEsc(vEd.nom || 'sans nom') + ' »</b> — rien de ceci n’apparaît dans le planning. Testez, comparez les compteurs, puis <b>Mise en place</b> quand c’est bon.'
            : 'Version en vigueur <b>à partir du ' + plJoli(vEd.debut) + '</b>' + (vEd.fin ? ' et jusqu’au <b>' + plJoli(vEd.fin) + '</b>' : ' (sans date de fin)') + '. Les semaines antérieures ne bougent pas.'))
        + '</div>';
      let selHtml = verHtml + '<div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;flex-wrap:wrap">'
        + '<span style="font-size:11.5px;font-weight:700;color:var(--plmut);text-transform:uppercase;letter-spacing:.4px">Semaine type :</span>';
      for (let k = 1; k <= nbTypes; k++) {
        const dk = plAddD(plMonday(new Date(anc0 + 'T12:00')), (k - 1) * 7);
        const det = rots.map(r => plEsc(r.lbl) + ' S' + plRang(r, dk)).join(' · ');
        selHtml += '<button class="pl-btn ' + (k === plTrRangSel ? 'pl-pri' : 'pl-ghost') + ' pl-mini" style="flex-direction:column;gap:0;line-height:1.25" onclick="plTrSel(null,' + k + ')">'
          + '<span>Type ' + k + '</span><span style="font-size:8.5px;font-weight:500;opacity:.8">' + det + '</span></button>';
      }
      selHtml += '<span style="font-size:10.5px;color:var(--plmut)">le motif complet se répète toutes les ' + nbTypes + ' semaines</span></div>';
      // compteurs de la semaine type (trame pure, sans absence) — rafraîchis à chaque frappe
      plTrRef = refDate;
      const cnt = '<div id="pl-trcnt">' + plTrCntHtml(refDate) + '</div></div>';   // fin .pl-trtop (bandeau collant)
      // grille équipe complète
      let h = selHtml + cnt + '<div class="pl-trgrid"><table class="pl-tt" style="font-size:11px"><tr><th style="text-align:left">Collaborateur</th>'
        + PL_JOURS_FR.slice(0, 6).map(j => '<th>' + j.slice(0, 3) + '</th>').join('')
        + '<th title="Total de la semaine affichée, et écart entre la moyenne du cycle et la base du contrat">Total<br><span style="font-weight:500;text-transform:none;letter-spacing:0">vs contrat</span></th></tr>';
      let lastG = null;
      L('contrats').filter(c => c.actif !== false)
        .sort(plCmp)
        .forEach(c => {
          if (c.grp !== lastG) { lastG = c.grp; h += '<tr><td colspan="8" style="text-align:left;background:linear-gradient(90deg,var(--placs),#FDF6F9);font-size:9.5px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--plac)">' + plEsc((PL_GRPS[c.grp] || { lbl: c.grp }).lbl) + '</td></tr>'; }
          const rang = rangDe(c);
          const edC = plEdSlot(c);
          const sem = edC.sem[rang] || edC.sem['1'] || {};
          const posEd = !!PL_POS_CHOIX[c.grp];
          let tot = 0, cells = '';
          PL_JOURS.slice(0, 6).forEach(jr => {
            const day = sem[jr] || [null, null];
            let cell = '';
            for (let hh = 0; hh < 2; hh++) {
              const v = day[hh] || '';
              tot += plDurOf(v);
              const pos = plPosOf(c, rang, jr, hh, edC.pos);
              const part = v && pos === 'C' && plPartiel(v, hh ? 'AM' : 'M');
              // pas d'horaire = pas de poste : la pastille ne s'affiche que sur un créneau travaillé
              const badge = !v ? '<i class="pl-posb pl-posv"></i>'
                : (posEd
                  ? '<button class="pl-posb pl-pos-' + pos + '" title="' + PL_POS_LBL[pos] + ' — cliquer pour changer de poste"'
                    + ' onclick="plCyclePos(\'' + c.id + '\',\'' + rang + '\',\'' + jr + '\',' + hh + ')">' + pos + '</button>'
                  : (pos !== 'C' ? '<i class="pl-posb pl-pos-' + pos + '" title="' + PL_POS_LBL[pos] + '">' + pos + '</i>' : '<i class="pl-posb pl-posv"></i>'));
              cell += '<div class="pl-hrow"><input class="pl-hin' + (pos !== 'C' ? ' pl-h' + pos : '') + (part ? ' pl-hpart' : '') + '"'
                + ' value="' + plEsc(v) + '" placeholder="—" spellcheck="false"'
                + ' data-c="' + c.id + '" data-r="' + rang + '" data-j="' + jr + '" data-h="' + hh + '" data-g="' + plEsc(c.grp) + '"'
                + ' title="' + (hh ? 'Après-midi' : 'Matin') + ' — cliquer pour choisir l\'horaire'
                + (part ? ' · ' + plEsc(plPartielTitle(v, hh ? 'AM' : 'M')) : '') + '"'
                + ' onclick="plGridPick(this)" onchange="plGridSet(this)" onkeydown="plGridKey(event,this)">' + badge + '</div>';
            }
            cells += '<td class="pl-tc">' + cell + '</td>';
          });
          const rot = plRotOf(c);
          h += '<tr><td style="text-align:left;white-space:nowrap"><b>' + plEsc(c.nom) + '</b> <span style="font-size:9px;color:var(--plmut)">' + (rot ? plEsc(rot.lbl) + ' S' + rang : '') + '</span><br>'
            + '<button class="pl-btn pl-ghost pl-mini" style="margin-top:2px" title="Voir et modifier toutes les semaines du cycle de ce collaborateur" onclick="plEditTrame(\'' + c.id + '\')">✎ cycle complet</button>'
            + (rot && rot.longueur > 1 ? ' <button class="pl-btn pl-ghost pl-mini" style="margin-top:2px" title="Recopier cette semaine sur les autres semaines du cycle" onclick="plRowCopy(\'' + c.id + '\',\'' + rang + '\')">⧉</button>' : '') + '</td>'
            + cells + '<td style="font-variant-numeric:tabular-nums;min-width:96px" id="pl-trtot-' + c.id + '">' + plRowTotHtml(c, rang) + '</td></tr>';
        });
      h += '</table></div><div class="pl-note"><b>Pour modifier un horaire :</b> cliquez sur la case — les créneaux habituels de l’équipe s’appliquent en un clic, sinon on règle le début et la fin au quart d’heure, et « Repos » vide la demi-journée. '
        + 'Les compteurs du haut se recalculent aussitôt. Au clavier, Entrée ou ↓ passe à la case suivante et on peut taper directement (<b>9h-12h30</b>). La pastille <i class="pl-posb pl-pos-C">C</i> à droite change le poste (préparateurs). '
        + '<b>⧉</b> recopie la semaine affichée sur les autres semaines du cycle, <b>✎ cycle complet</b> ouvre les 2 à 4 semaines d’un collaborateur côte à côte.<br>'
        + '<b>Colonne Total :</b> en haut le total de la semaine affichée, en dessous l’écart entre la <b>moyenne du cycle</b> et la base du contrat — un cycle de 2 à 4 semaines n’a pas besoin d’être équilibré semaine par semaine (34h30 + 35h30 = 35 h de moyenne), '
        + 'c’est la moyenne qui doit tomber juste. Le bandeau du haut récapitule les collaborateurs encore en écart.<br>'
        + 'Positions : <i class="pl-posb pl-pos-C">C</i> comptoir · <i class="pl-posb pl-pos-B">B</i> back-office · <i class="pl-posb pl-pos-A">A</i> poste avancé. '
        + 'Chaque ligne affiche la semaine du cycle propre au collaborateur (Prép sur 2 semaines pour l’alternance du samedi, Ph sur 3…) — la longueur des cycles se règle dans l’onglet Rotations (1 à 4 semaines). '
        + 'Les compteurs du haut se recalculent à chaque enregistrement : c’est ici qu’on vérifie que la trame met le bon nombre de personnes au bon endroit.</div>';
      el.innerHTML = h;
      plVerForce = null;
    } else if (plRegView === 'c') {

      const staff = plStaffList();
      let h = '<table class="pl-list"><tr><th>Collaborateur</th><th>Fonction</th><th>Compte intranet</th><th>Base hebdo</th><th>Rotation</th><th>Trame</th></tr>';
      L('contrats').filter(c => c.actif !== false).sort(plCmp).forEach(c => {
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
    const e = plEdSlot(c);
    if (!e.pos[rang]) e.pos[rang] = {};
    if (!e.pos[rang][jour]) e.pos[rang][jour] = ['C', 'C'];
    const cur = e.pos[rang][jour][hh] || 'C';
    const suite = { C: 'B', B: 'A', A: 'C' };
    e.pos[rang][jour][hh] = suite[cur] || 'C';
    const pos = e.pos[rang][jour][hh];
    plStamp(e.obj); plPersist();
    plToast(c.nom.split(' ')[0] + ' · ' + PL_JOURS_FR[PL_JOURS.indexOf(jour)] + ' ' + (hh ? 'après-midi' : 'matin') + ' → ' + PL_POS_LBL[pos]);
    plRender();
    // mise à jour ciblée de la grille (on garde la position de défilement et le focus)
    const inp = document.querySelector('#pl-reg-body .pl-hin[data-c="' + cid + '"][data-r="' + rang + '"][data-j="' + jour + '"][data-h="' + hh + '"]');
    if (inp) {
      const part = inp.value && pos === 'C' && plPartiel(inp.value, hh ? 'AM' : 'M');
      inp.classList.remove('pl-hB', 'pl-hA', 'pl-hpart');
      if (pos !== 'C') inp.classList.add('pl-h' + pos);
      if (part) inp.classList.add('pl-hpart');
      const b = inp.nextElementSibling;
      if (b) { b.className = 'pl-posb pl-pos-' + pos; b.textContent = pos; b.title = PL_POS_LBL[pos] + ' — cliquer pour changer de poste'; }
      plTrCntRefresh();
    } else {
      const reg = document.getElementById('pl-ov-reg');
      if (reg && reg.classList.contains('pl-on')) plRegRender();
    }
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

  // ---------- exception du jour (clic sur la vue Semaine) ----------
  let plJourCid = null, plJourIso = null;
  // Un clic sur une demi-journée de la vue Semaine : le sélecteur s'ouvre sur place.
  // Ce qui est choisi ne vaut QUE pour ce jour — la semaine type n'est pas touchée.
  window.plJourPick = function (ev, cid, iso, hh) {
    if (ev) ev.stopPropagation();
    const c = L('contrats').find(x => x.id === cid); if (!c) return;
    const anc = (ev && ev.currentTarget) || document.body;
    const d = new Date(iso + 'T12:00'), demi = hh ? 'AM' : 'M';
    const trame = plSlotsTrame(c, d), eff = plSlots(c, d);
    const tr = plTrameAt(c, d);
    const posTrame = plPosOf(c, tr.rang, plDayKey(d), hh, tr.pos);
    let posCour = plPosEff(c, d, hh);
    const ecrire = function (horaire, pos) {
      const memeH = (horaire || null) === (trame[hh] || null);
      const memeP = pos === posTrame;
      const ancienne = plExOf(c, iso, demi);
      plDropEx(c.id, iso, demi);
      if (!memeH || !memeP) {
        const ex = { id: plNewId('ex'), contratId: c.id, date: iso, demi: demi, type: 'horaire',
          horaire: horaire || null, pos: memeP ? null : pos,
          saisiPar: (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : null, updatedAt: Date.now() };
        if (ancienne && ancienne.imputation) ex.imputation = ancienne.imputation;
        plExceptions.push(ex);
        plImputSiBesoin(ex, c, trame[hh]);
      }
      plPersist(); plRender();
    };

    plPkOpen(anc, {
      val: eff[hh] || '', hh: hh, grp: c.grp,
      titre: c.nom.split(' ')[0] + ' · ' + PL_JOURS_FR[(d.getDay() + 6) % 7].toLowerCase() + ' ' + d.getDate() + ' ' + PL_MOIS_FR[d.getMonth()] + (hh ? ' après-midi' : ' matin'),
      sous: 'Ce jour uniquement — semaine type : ' + (trame[hh] || 'repos'),
      // le poste ne se choisit que là où il a un sens (préparateurs) : un pharmacien est
      // toujours au comptoir, la logistique et le poste avancé sont fixes (règles R2/R3 du CDC)
      pos: PL_POS_CHOIX[c.grp] ? posCour : null,
      posFixe: PL_POS_CHOIX[c.grp] ? null : posCour,
      onPos: PL_POS_CHOIX[c.grp] ? function (p) { posCour = p; ecrire(plPkCur(), p); } : null,
      onSet: function (v) { ecrire(v, posCour); },
      reset: { lbl: 'Semaine type', fn: function () { plDropEx(c.id, iso, demi); plPersist(); plToast('Semaine type rétablie'); plRender(); } }
    });
  };
  window.plEditJourModale = function (cid, iso) {
    const c = L('contrats').find(x => x.id === cid); if (!c) return;
    plJourCid = cid; plJourIso = iso;
    const d = new Date(iso + 'T12:00');
    document.getElementById('pl-jr-title').textContent = c.nom + ' — ' + PL_JOURS_FR[(d.getDay() + 6) % 7].toLowerCase() + ' ' + d.getDate() + ' ' + PL_MOIS_FR[d.getMonth()];
    const trame = plSlotsTrame(c, d), eff = plSlots(c, d);
    const posEditable = !!PL_POS_CHOIX[c.grp];
    let h = '<table class="pl-tt"><tr><th></th><th>Horaire du jour</th>' + (posEditable ? '<th>Position</th>' : '') + '<th>Trame</th></tr>';
    ['M', 'AM'].forEach((demi, hh) => {
      const posCur = plPosEff(c, d, hh);
      h += '<tr><th>' + (demi === 'M' ? 'Matin' : 'Après-midi') + '</th>'
        + '<td><input id="pl-jr-h-' + hh + '" class="pl-hin" style="width:120px;font-size:12.5px;padding:6px 2px" readonly'
          + ' value="' + plEsc(eff[hh] || '') + '" placeholder="repos — cliquer" data-h="' + hh + '" data-g="' + plEsc(c.grp) + '"'
          + ' title="Cliquer pour choisir l\'horaire" onclick="plJourPickModale(this,' + hh + ')"></td>'
        + (posEditable ? '<td><select id="pl-jr-p-' + hh + '" class="pl-inp" style="height:30px">'
          + ['C', 'B', 'A'].map(p => '<option value="' + p + '"' + (posCur === p ? ' selected' : '') + '>' + p + ' · ' + PL_POS_LBL[p] + '</option>').join('') + '</select></td>' : '')
        + '<td style="color:var(--plmut)">' + plEsc(trame[hh] || 'repos') + '</td></tr>';
    });
    h += '</table>';
    document.getElementById('pl-jr-body').innerHTML = h;
    window.plJourPickModale = function (el, hh2) {
      const pEl = document.getElementById('pl-jr-p-' + hh2);
      plPkOpen(el, {
        titre: c.nom.split(' ')[0] + (hh2 ? ' · après-midi' : ' · matin'),
        sous: 'Ce jour uniquement — trame : ' + (trame[hh2] || 'repos'),
        pos: pEl ? pEl.value : null,
        onPos: pEl ? function (p) { pEl.value = p; } : null
      });
    };
    const hasEx = plExOf(c, iso, 'M') || plExOf(c, iso, 'AM');
    document.getElementById('pl-jr-reset').style.display = hasEx ? '' : 'none';
    plOpen('pl-ov-jour');
  };
  function plDropEx(cid, iso, demi) {
    const arr = L('exceptions');
    for (let i = arr.length - 1; i >= 0; i--) {
      const x = arr[i];
      if (x.contratId === cid && x.date === iso && x.type === 'horaire' && x.demi === demi) arr.splice(i, 1);
    }
  }
  window.plSaveJour = function () {
    const c = L('contrats').find(x => x.id === plJourCid); if (!c) return;
    const d = new Date(plJourIso + 'T12:00'), trame = plSlotsTrame(c, d);
    const tr2 = plTrameAt(c, d);
    ['M', 'AM'].forEach((demi, hh) => {
      const hEl = document.getElementById('pl-jr-h-' + hh); if (!hEl) return;
      const val = hEl.value.trim() || null;
      const pEl = document.getElementById('pl-jr-p-' + hh);
      const posTrame = plPosOf(c, tr2.rang, plDayKey(d), hh, tr2.pos);
      const posVal = pEl ? pEl.value : posTrame;
      const memeHoraire = (val || null) === (trame[hh] || null);
      const memePos = posVal === posTrame;
      const ancienne = plExOf(c, plJourIso, demi);
      plDropEx(c.id, plJourIso, demi);
      if (!memeHoraire || !memePos) {
        const ex = { id: plNewId('ex'), contratId: c.id, date: plJourIso, demi: demi, type: 'horaire',
          horaire: val, pos: (pEl && !memePos) ? posVal : null,
          saisiPar: (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : null, updatedAt: Date.now() };
        if (ancienne && ancienne.imputation) ex.imputation = ancienne.imputation;
        plExceptions.push(ex);
        plImputSiBesoin(ex, c, trame[hh]);
      }
    });
    plPersist(); plClose('pl-ov-jour');
    plToast('Journée du ' + plJourIso.split('-').reverse().join('/') + ' enregistrée pour ' + c.nom.split(' ')[0]);
    plRender();
  };
  window.plResetJour = function () {
    const c = L('contrats').find(x => x.id === plJourCid); if (!c) return;
    plDropEx(c.id, plJourIso, 'M'); plDropEx(c.id, plJourIso, 'AM');
    plPersist(); plClose('pl-ov-jour'); plToast('Trame rétablie'); plRender();
  };

  // ═══════════ ABSENCES DE PLUSIEURS JOURS ═══════════
  // plAbsences[] : { id, contratId, motif (cp|mat|mal|rec|for), debut, fin (ISO), debutAM, finM,
  //                  commentaire, saisiPar, updatedAt }. Lues par plAbs() demi-journée par demi-journée.
  function plAbsPeut(c) {
    if (plIsAdmin()) return true;
    const moi = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : null;
    return !!(c && moi && c.staffId === moi);
  }
  function plAbsJours(a) {
    // journées ouvrées (hors dimanche) couvertes, en demi-journées / 2
    let n = 0;
    for (let d = new Date(a.debut + 'T12:00'); plIso(d) <= a.fin; d = plAddD(d, 1)) {
      if (d.getDay() === 0) continue;
      const iso = plIso(d);
      n += (iso === a.debut && a.debutAM) ? 0 : 1;
      n += (iso === a.fin && a.finM) ? 0 : 1;
    }
    return n / 2;
  }
  function plAbsChevauche(a, saufId) {
    return L('absences').find(b => b.id !== saufId && b.contratId === a.contratId && b.debut <= a.fin && b.fin >= a.debut) || null;
  }
  window.plAbsOuvrir = function (cid) {
    const admin = plIsAdmin();
    const moi = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : null;
    const monC = moi ? L('contrats').find(c => c.actif !== false && c.staffId === moi) : null;
    const liste = L('contrats').filter(c => c.actif !== false && (admin || (monC && c.id === monC.id))).sort(plCmp);
    if (!liste.length) { plToast(admin ? 'Aucun contrat de planning' : 'Votre compte n\'est rattaché à aucun contrat de planning'); return; }
    const sel = document.getElementById('pl-abs-cid');
    const cour = cid || (monC && monC.id) || liste[0].id;
    sel.innerHTML = liste.map(c => '<option value="' + plEsc(c.id) + '"' + (c.id === cour ? ' selected' : '') + '>' + plEsc(c.nom) + '</option>').join('');
    const auj = plIso(new Date());
    document.getElementById('pl-abs-debut').value = auj; document.getElementById('pl-abs-fin').value = auj;
    document.getElementById('pl-abs-debutam').checked = false; document.getElementById('pl-abs-finm').checked = false;
    document.getElementById('pl-abs-com').value = ''; document.getElementById('pl-abs-motif').value = 'cp';
    document.getElementById('pl-abs-resume').textContent = '';
    ['pl-abs-cid', 'pl-abs-motif', 'pl-abs-debut', 'pl-abs-fin', 'pl-abs-debutam', 'pl-abs-finm'].forEach(id => { document.getElementById(id).onchange = plAbsResume; });
    plAbsResume();
    plOpen('pl-ov-abs');
  };
  function plAbsLire() {
    return { contratId: document.getElementById('pl-abs-cid').value, motif: document.getElementById('pl-abs-motif').value,
      debut: document.getElementById('pl-abs-debut').value, fin: document.getElementById('pl-abs-fin').value,
      debutAM: document.getElementById('pl-abs-debutam').checked, finM: document.getElementById('pl-abs-finm').checked,
      commentaire: document.getElementById('pl-abs-com').value.trim() };
  }
  function plAbsResume() {
    const a = plAbsLire(), el = document.getElementById('pl-abs-resume'); if (!el) return;
    if (!a.debut || !a.fin || a.fin < a.debut) { el.textContent = ''; return; }
    if (a.debut === a.fin && a.debutAM && a.finM) { el.textContent = 'Sur une seule journée, cochez au plus une des deux cases.'; return; }
    const n = plAbsJours(a), ch = plAbsChevauche(a);
    el.innerHTML = '<b>' + (n % 1 ? n.toFixed(1).replace('.', ',') : n) + ' jour' + (n > 1 ? 's' : '') + '</b> ouvré' + (n > 1 ? 's' : '') + ' (hors dimanche)'
      + (a.motif === 'for' ? ' — horaire habituel conservé, absent de la pharmacie' : ' — hors planning, retiré des heures et de l\'effectif')
      + (ch ? '<div style="color:#C62828;margin-top:4px">Chevauche une absence déjà déclarée (' + PL_MOTIFS_LONG[ch.motif] + ' du ' + plJoliDate(ch.debut) + ' au ' + plJoliDate(ch.fin) + ').</div>' : '');
  }
  window.plAbsEnregistrer = function () {
    const a = plAbsLire();
    const c = L('contrats').find(x => x.id === a.contratId);
    if (!c) { plToast('Choisissez un collaborateur'); return; }
    if (!plAbsPeut(c)) { plToast('Vous ne pouvez déclarer que vos propres absences'); return; }
    if (!a.debut || !a.fin) { plToast('Indiquez les dates'); return; }
    if (a.fin < a.debut) { plToast('La date de fin précède la date de début'); return; }
    if (a.debut === a.fin && a.debutAM && a.finM) { plToast('Sur une seule journée, cochez au plus une des deux cases'); return; }
    const ch = plAbsChevauche(a);
    if (ch) { plToast('Chevauche une absence déjà déclarée pour ' + c.nom.split(' ')[0] + ' — supprimez-la d\'abord'); return; }
    a.id = plNewId('abs'); a.saisiPar = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : null; a.updatedAt = Date.now();
    L('absences').push(a); plPersist(); plClose('pl-ov-abs');
    plToast(PL_MOTIFS_LONG[a.motif] + ' — ' + c.nom.split(' ')[0] + ' du ' + plJoliDate(a.debut) + ' au ' + plJoliDate(a.fin));
    plRender(); plAbsRender();
  };
  window.plAbsSupprimer = function (id) {
    const arr = L('absences'); const i = arr.findIndex(x => x.id === id); if (i < 0) return;
    const c = L('contrats').find(x => x.id === arr[i].contratId);
    if (!plAbsPeut(c)) { plToast('Réservé aux administrateurs'); return; }
    if (!confirm('Supprimer cette absence ?')) return;
    arr.splice(i, 1); plPersist(); plRender(); plAbsRender();
  };
  // ── écran Congés & absences ──
  window.plAbsRender = function () {
    const host = document.getElementById('pl-abs-host'); if (!host) return;
    const admin = plIsAdmin(), auj = plIso(new Date());
    const moi = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : null;
    const monC = moi ? L('contrats').find(c => c.actif !== false && c.staffId === moi) : null;
    const toutes = L('absences').filter(a => admin || (monC && a.contratId === monC.id));
    const enCours = toutes.filter(a => a.debut <= auj && a.fin >= auj).sort((x, y) => x.fin.localeCompare(y.fin));
    const aVenir = toutes.filter(a => a.debut > auj).sort((x, y) => x.debut.localeCompare(y.debut));
    const passees = toutes.filter(a => a.fin < auj).sort((x, y) => y.fin.localeCompare(x.fin));
    const chip = m => '<span class="pl-chip pl-ch-' + m + '"><i></i>' + (PL_MOTIFS_LONG[m] || m) + '</span>';
    const table = (liste, vide) => liste.length
      ? '<table class="pl-tt"><tr><th style="text-align:left">Collaborateur</th><th>Motif</th><th>Du</th><th>Au</th><th>Jours</th><th>Commentaire</th><th>Saisi par</th><th></th></tr>'
        + liste.map(a => { const c = L('contrats').find(x => x.id === a.contratId); const n = plAbsJours(a);
          return '<tr><td style="text-align:left"><b>' + plEsc(c ? c.nom : '—') + '</b></td><td>' + chip(a.motif) + '</td>'
            + '<td>' + plJoliDate(a.debut) + (a.debutAM ? ' <small>ap.-midi</small>' : '') + '</td><td>' + plJoliDate(a.fin) + (a.finM ? ' <small>midi</small>' : '') + '</td>'
            + '<td>' + (n % 1 ? n.toFixed(1).replace('.', ',') : n) + '</td><td style="text-align:left">' + plEsc(a.commentaire || '') + '</td><td style="font-size:11px;color:var(--plmut)">' + plEsc(plQui(a.saisiPar)) + '</td>'
            + '<td>' + (plAbsPeut(c) ? '<button class="pl-btn pl-mini pl-ghost" onclick="plAbsSupprimer(\'' + a.id + '\')" title="Supprimer">✕</button>' : '') + '</td></tr>'; }).join('')
        + '</table>'
      : '<div class="pl-empty" style="padding:18px 12px">' + vide + '</div>';
    host.innerHTML = '<div class="pl-card" style="padding:16px 18px;margin-bottom:14px;display:flex;align-items:center;gap:14px;flex-wrap:wrap">'
      + '<div style="flex:1;min-width:260px"><b style="font-size:14px">Congés &amp; absences</b>'
      + '<div class="pl-sub" style="margin:4px 0 0">Vacances, congé maternité, arrêt maladie, récupération ou formation. En formation, l\'horaire habituel est conservé mais le collaborateur apparaît grisé et hors effectif dans le planning.</div></div>'
      + '<button class="pl-btn pl-pri" onclick="plAbsOuvrir()">🏖 Déclarer une absence</button></div>'
      + '<div class="pl-card" style="padding:16px 18px;margin-bottom:14px"><b style="font-size:14px">En cours</b>' + table(enCours, 'Personne n\'est absent aujourd\'hui.') + '</div>'
      + '<div class="pl-card" style="padding:16px 18px;margin-bottom:14px"><b style="font-size:14px">À venir</b>' + table(aVenir, 'Aucune absence à venir.') + '</div>'
      + '<div class="pl-card" style="padding:16px 18px"><b style="font-size:14px">Passées</b>' + table(passees.slice(0, 100), 'Aucune absence passée.') + '</div>';
  };

  // ═══════════ HEURES SUPPLÉMENTAIRES & COMPTE-TEMPS ═══════════
  // Deux sources d'heures en plus :
  //  · une DÉCLARATION du collaborateur (date, durée, motif) → l'admin la valide en
  //    l'affectant au compte-temps (à récupérer) ou en heures sup (navette), ou la refuse ;
  //  · un CRÉNEAU AJOUTÉ sur un repos dans le planning → l'imputation (hs / compte)
  //    est demandée au moment de l'ajout.
  // Le compte-temps d'un collaborateur = somme de ce qui lui a été crédité.
  const PL_HS_STATUT = { attente: 'À valider', validee: 'Validée', refusee: 'Refusée' };
  const PL_HS_AFFECT = { compte: 'Compte-temps', navette: 'Heures sup · navette' };
  const PL_IMPUT = { hs: 'Heures sup · navette', compte: 'Compte-temps' };

  // créneau ajouté là où la trame prévoyait un repos ?
  function plExEstAjout(ex, c) {
    if (!ex || ex.type !== 'horaire' || !ex.horaire) return false;
    c = c || L('contrats').find(x => x.id === ex.contratId); if (!c) return false;
    const d = new Date(ex.date + 'T12:00');
    const tr = plSlotsTrame(c, d);
    return !tr[ex.demi === 'AM' ? 1 : 0];
  }
  // file d'attente : une journée peut ajouter deux créneaux (matin + après-midi) d'un coup
  let plImputFile = [];
  function plImputOuvrir() {
    const ex = plImputFile[0]; if (!ex) return;
    const c = L('contrats').find(x => x.id === ex.contratId);
    const s = document.getElementById('pl-imput-sub');
    if (s) s.textContent = (c ? c.nom.split(' ')[0] : '') + ' — ' + ex.date.split('-').reverse().join('/')
      + (ex.demi === 'AM' ? ' après-midi' : ' matin') + ' · ' + ex.horaire + ' (' + plFmtH(plDurOf(ex.horaire)) + ') : comment compter ces heures ?';
    plOpen('pl-ov-imput');
  }
  function plImputSiBesoin(ex, c, horaireTrame) {
    if (horaireTrame || !ex.horaire) return;          // pas un ajout sur un repos
    if (ex.imputation) return;                          // déjà choisi (on rééditait le créneau)
    ex.imputation = 'hs';                               // défaut sûr : heures sup
    plImputFile.push(ex);
    if (plImputFile.length === 1) setTimeout(plImputOuvrir, 60);
  }
  window.plImputChoisir = function (v) {
    const cour = plImputFile.shift();
    const ex = cour && L('exceptions').find(x => x.id === cour.id);
    if (ex) { ex.imputation = v; plStamp(ex); plPersist(); }
    plClose('pl-ov-imput');
    plToast(v === 'compte' ? 'Créneau crédité sur le compte-temps' : 'Créneau compté en heures supplémentaires');
    plRender();
    if (document.getElementById('vue-compteurs') && document.getElementById('vue-compteurs').classList.contains('on')) plHsRender();
    if (plImputFile.length) setTimeout(plImputOuvrir, 120);
  };
  window.plImputChanger = function (exId, v) {
    const ex = L('exceptions').find(x => x.id === exId); if (!ex) return;
    ex.imputation = v; plStamp(ex); plPersist(); plHsRender();
  };

  function plContratDe(staffId) { return L('contrats').find(c => c.actif !== false && c.staffId === staffId) || null; }
  function plMonContrat() { return (typeof currentUser !== 'undefined' && currentUser) ? plContratDe(currentUser.id) : null; }
  function plNomC(c) { return c ? c.nom : '—'; }
  function plQui(sid) {
    const s = plStaffList().find(x => x.id === sid);
    return s ? (s.prenom + ' ' + (s.nom || '').charAt(0) + '.') : (sid || '—');
  }
  function plJoliDate(iso) { return iso ? iso.split('-').reverse().join('/') : '—'; }

  // créneaux ajoutés sur repos d'un contrat, avec durée et imputation
  function plAjoutsDe(c) {
    return L('exceptions').filter(ex => ex.contratId === c.id && plExEstAjout(ex, c))
      .map(ex => ({ ex: ex, h: plDurOf(ex.horaire), imp: ex.imputation || 'hs' }));
  }
  // soldes d'un contrat
  function plSoldes(c) {
    let compte = 0, navette = 0, attente = 0;
    L('heuresSup').forEach(d => {
      if (d.contratId !== c.id) return;
      if (d.statut === 'attente') attente += +d.heures || 0;
      if (d.statut === 'validee') { if (d.affectation === 'compte') compte += +d.heures || 0; else navette += +d.heures || 0; }
    });
    plAjoutsDe(c).forEach(a => { if (a.imp === 'compte') compte += a.h; else navette += a.h; });
    return { compte: compte, navette: navette, attente: attente };
  }
  // exposés pour l'inspection et les tests (lecture seule)
  window.plIsAdmin = plIsAdmin; window.plSoldes = plSoldes;
  function plHsMoisCourant(c) {
    const m = plIso(new Date()).slice(0, 7);
    let n = 0;
    L('heuresSup').forEach(d => { if (d.contratId === c.id && d.statut === 'validee' && d.affectation === 'navette' && (d.date || '').slice(0, 7) === m) n += +d.heures || 0; });
    plAjoutsDe(c).forEach(a => { if (a.imp === 'hs' && (a.ex.date || '').slice(0, 7) === m) n += a.h; });
    return n;
  }

  // ── déclaration ──
  window.plHsDeclarer = function () {
    const cidEl = document.getElementById('pl-hs-cid');
    const c = cidEl ? L('contrats').find(x => x.id === cidEl.value) : plMonContrat();
    if (!c) { plToast('Aucun contrat de planning rattaché à votre compte — voyez avec un administrateur'); return; }
    const date = (document.getElementById('pl-hs-date') || {}).value;
    const heures = parseFloat((document.getElementById('pl-hs-h') || {}).value);
    const motif = ((document.getElementById('pl-hs-motif') || {}).value || '').trim();
    if (!date) { plToast('Indiquez la date'); return; }
    if (!heures || heures <= 0) { plToast('Indiquez la durée'); return; }
    if (!motif) { plToast('Indiquez le motif'); return; }
    L('heuresSup').push({ id: plNewId('hs'), contratId: c.id, staffId: c.staffId || null, date: date, heures: heures, motif: motif,
      statut: 'attente', affectation: null,
      declarePar: (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : null, declareAt: plIso(new Date()), updatedAt: Date.now() });
    plPersist(); plToast(plFmtH(heures) + ' déclarée' + (heures > 1 ? 's' : '') + ' pour ' + c.nom.split(' ')[0] + ' — en attente de validation');
    const mEl = document.getElementById('pl-hs-motif'); if (mEl) mEl.value = '';
    plHsRender();
  };
  // ── décision admin ──
  window.plHsDecider = function (id, statut, affectation) {
    if (!plIsAdmin()) { plToast('Réservé aux administrateurs'); return; }
    const d = L('heuresSup').find(x => x.id === id); if (!d) return;
    if (statut === 'refusee') {
      const m = prompt('Motif du refus (facultatif) :', d.refusMotif || '');
      if (m === null) return;
      d.refusMotif = m.trim();
    }
    d.statut = statut; d.affectation = statut === 'validee' ? affectation : null;
    d.decidePar = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : null;
    d.decideAt = plIso(new Date()); plStamp(d); plPersist();
    plToast(statut === 'validee' ? ('Validée → ' + PL_HS_AFFECT[affectation]) : 'Déclaration refusée');
    plHsRender();
  };
  window.plHsSupprimer = function (id) {
    const d = L('heuresSup').find(x => x.id === id); if (!d) return;
    const moi = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : null;
    if (!plIsAdmin() && !(d.statut === 'attente' && d.declarePar === moi)) { plToast('Seule une déclaration en attente peut être retirée'); return; }
    if (!confirm('Retirer cette déclaration ?')) return;
    const arr = L('heuresSup'); const i = arr.findIndex(x => x.id === id); if (i >= 0) arr.splice(i, 1);
    plPersist(); plHsRender();
  };

  function plHsBadge() {
    const b = document.getElementById('pl-hs-badge'); if (!b) return;
    const n = plIsAdmin() ? L('heuresSup').filter(d => d.statut === 'attente').length : 0;
    b.textContent = n ? String(n) : ''; b.style.display = n ? '' : 'none';
    if (n) { b.style.background = '#E65100'; b.style.color = '#fff'; }
  }

  // ── écran ──
  window.plHsRender = function () {
    const host = document.getElementById('pl-hs-host'); if (!host) return;
    const admin = plIsAdmin();
    const moi = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : null;
    const monC = plMonContrat();
    const contrats = L('contrats').filter(c => c.actif !== false).sort(plCmp);
    const H = [];
    const chip = (txt, bg, col) => '<span class="pl-chip" style="background:' + bg + ';color:' + col + '">' + txt + '</span>';
    const statutChip = d => d.statut === 'attente' ? chip('À valider', '#FFF3E0', '#E65100')
      : d.statut === 'validee' ? chip('Validée · ' + PL_HS_AFFECT[d.affectation], d.affectation === 'compte' ? '#E3F2FD' : '#E8F5E9', d.affectation === 'compte' ? '#0D47A1' : '#1D5C3A')
      : chip('Refusée', '#FFEBEE', '#C62828');
    const durees = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8];

    // 1. Déclarer
    H.push('<div class="pl-card" style="padding:16px 18px;margin-bottom:14px"><b style="font-size:14px">Déclarer des heures supplémentaires</b>'
      + '<div class="pl-sub" style="margin:4px 0 12px">Notez les heures faites en plus de la trame : elles sont soumises à validation. '
      + 'Un administrateur les crédite ensuite sur le compte-temps (à récupérer) ou en heures supplémentaires sur la navette des salaires.</div>'
      + '<div class="pl-form" style="align-items:flex-end">'
      + (admin ? '<label style="display:flex;flex-direction:column;gap:4px;font-size:11px;color:var(--plmut)">Collaborateur<select id="pl-hs-cid" class="pl-inp" style="height:32px">'
          + contrats.map(c => '<option value="' + plEsc(c.id) + '"' + (monC && c.id === monC.id ? ' selected' : '') + '>' + plEsc(c.nom) + '</option>').join('') + '</select></label>'
        : (monC ? '<div style="font-size:12px;padding:6px 0"><b>' + plEsc(monC.nom) + '</b></div>' : '<div style="font-size:12px;color:#C62828">Votre compte n\'est rattaché à aucun contrat de planning.</div>'))
      + '<label style="display:flex;flex-direction:column;gap:4px;font-size:11px;color:var(--plmut)">Date<input type="date" id="pl-hs-date" class="pl-inp" style="height:32px" value="' + plIso(new Date()) + '"></label>'
      + '<label style="display:flex;flex-direction:column;gap:4px;font-size:11px;color:var(--plmut)">Durée<select id="pl-hs-h" class="pl-inp" style="height:32px">'
      + durees.map(x => '<option value="' + x + '"' + (x === 1 ? ' selected' : '') + '>' + plFmtH(x) + '</option>').join('') + '</select></label>'
      + '<label style="display:flex;flex-direction:column;gap:4px;font-size:11px;color:var(--plmut);flex:1;min-width:220px">Motif<input type="text" id="pl-hs-motif" class="pl-inp" style="height:32px" placeholder="Ex. fermeture tardive, inventaire, remplacement…"></label>'
      + '<button class="pl-btn pl-pri" style="height:32px" onclick="plHsDeclarer()">Déclarer</button>'
      + '</div></div>');

    // 2. À valider (admin)
    const attente = L('heuresSup').filter(d => d.statut === 'attente').sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    if (admin) {
      H.push('<div class="pl-card" style="padding:16px 18px;margin-bottom:14px"><b style="font-size:14px">À valider</b>'
        + (attente.length ? ' <span class="pl-chip" style="background:#FFF3E0;color:#E65100">' + attente.length + '</span>' : '')
        + '<div class="pl-sub" style="margin:4px 0 10px">Pour chaque déclaration : compte-temps (le collaborateur récupérera ces heures) ou heures sup (payées via la navette), ou refus.</div>'
        + (attente.length ? '<table class="pl-tt"><tr><th>Collaborateur</th><th>Date</th><th>Durée</th><th>Motif</th><th>Déclaré par</th><th></th></tr>'
          + attente.map(d => { const c = L('contrats').find(x => x.id === d.contratId);
            return '<tr><td><b>' + plEsc(plNomC(c)) + '</b></td><td>' + plJoliDate(d.date) + '</td><td><b>' + plFmtH(d.heures) + '</b></td><td style="text-align:left">' + plEsc(d.motif || '') + '</td><td>' + plEsc(plQui(d.declarePar)) + '</td>'
              + '<td style="white-space:nowrap"><button class="pl-btn pl-mini" style="background:#E3F2FD;color:#0D47A1" onclick="plHsDecider(\'' + d.id + '\',\'validee\',\'compte\')" title="Créditer le compte-temps">Compte-temps</button> '
              + '<button class="pl-btn pl-mini pl-pri" onclick="plHsDecider(\'' + d.id + '\',\'validee\',\'navette\')" title="Heures supplémentaires payées">Heures sup</button> '
              + '<button class="pl-btn pl-mini pl-ghost" style="color:#C62828" onclick="plHsDecider(\'' + d.id + '\',\'refusee\')">Refuser</button></td></tr>'; }).join('')
          + '</table>' : '<div class="pl-empty">Aucune déclaration en attente.</div>')
        + '</div>');
    }

    // 3. Compteurs
    const listeC = admin ? contrats : (monC ? [monC] : []);
    H.push('<div class="pl-card" style="padding:16px 18px;margin-bottom:14px"><b style="font-size:14px">Compteurs</b>'
      + '<div class="pl-sub" style="margin:4px 0 10px">Compte-temps = heures à récupérer. Heures sup = ce qui remonte sur la navette des salaires (déclarations validées + créneaux ajoutés sur un repos et comptés en heures sup).</div>'
      + '<table class="pl-tt"><tr><th style="text-align:left">Collaborateur</th><th>Compte-temps</th><th>Heures sup ce mois</th><th>Heures sup cumulées</th><th>En attente</th></tr>'
      + listeC.map(c => { const s = plSoldes(c);
          return '<tr><td style="text-align:left"><b>' + plEsc(c.nom) + '</b></td>'
            + '<td><b style="color:#0D47A1">' + plFmtH(s.compte) + '</b></td><td>' + plFmtH(plHsMoisCourant(c)) + '</td><td>' + plFmtH(s.navette) + '</td>'
            + '<td>' + (s.attente ? '<span style="color:#E65100;font-weight:700">' + plFmtH(s.attente) + '</span>' : '—') + '</td></tr>'; }).join('')
      + '</table></div>');

    // 4. Créneaux ajoutés sur un repos (imputation modifiable par l'admin)
    const ajouts = [];
    listeC.forEach(c => plAjoutsDe(c).forEach(a => ajouts.push({ c: c, a: a })));
    ajouts.sort((x, y) => (y.a.ex.date || '').localeCompare(x.a.ex.date || ''));
    if (ajouts.length) {
      H.push('<div class="pl-card" style="padding:16px 18px;margin-bottom:14px"><b style="font-size:14px">Créneaux ajoutés sur un repos</b>'
        + '<div class="pl-sub" style="margin:4px 0 10px">Saisis directement dans le planning. L\'imputation choisie à l\'ajout peut être changée ici' + (admin ? '' : ' par un administrateur') + '.</div>'
        + '<table class="pl-tt"><tr><th style="text-align:left">Collaborateur</th><th>Date</th><th>Créneau</th><th>Durée</th><th>Imputation</th></tr>'
        + ajouts.slice(0, 60).map(x => '<tr><td style="text-align:left"><b>' + plEsc(x.c.nom) + '</b></td><td>' + plJoliDate(x.a.ex.date) + (x.a.ex.demi === 'AM' ? ' ap.-midi' : ' matin') + '</td><td>' + plEsc(x.a.ex.horaire) + '</td><td>' + plFmtH(x.a.h) + '</td>'
          + '<td>' + (admin ? '<select class="pl-inp" style="height:26px;font-size:11.5px" onchange="plImputChanger(\'' + x.a.ex.id + '\',this.value)">'
              + Object.keys(PL_IMPUT).map(k => '<option value="' + k + '"' + (x.a.imp === k ? ' selected' : '') + '>' + PL_IMPUT[k] + '</option>').join('') + '</select>'
            : chip(PL_IMPUT[x.a.imp], x.a.imp === 'compte' ? '#E3F2FD' : '#E8F5E9', x.a.imp === 'compte' ? '#0D47A1' : '#1D5C3A')) + '</td></tr>').join('')
        + '</table></div>');
    }

    // 5. Historique des déclarations
    const hist = L('heuresSup').filter(d => admin || d.contratId === (monC && monC.id) || d.declarePar === moi)
      .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.updatedAt || 0) - (a.updatedAt || 0));
    H.push('<div class="pl-card" style="padding:16px 18px"><b style="font-size:14px">' + (admin ? 'Toutes les déclarations' : 'Mes déclarations') + '</b>'
      + (hist.length ? '<table class="pl-tt" style="margin-top:10px"><tr><th style="text-align:left">Collaborateur</th><th>Date</th><th>Durée</th><th>Motif</th><th>Statut</th><th>Décision</th><th></th></tr>'
        + hist.slice(0, 200).map(d => { const c = L('contrats').find(x => x.id === d.contratId);
            const peutRetirer = admin || (d.statut === 'attente' && d.declarePar === moi);
            return '<tr><td style="text-align:left"><b>' + plEsc(plNomC(c)) + '</b></td><td>' + plJoliDate(d.date) + '</td><td>' + plFmtH(d.heures) + '</td><td style="text-align:left">' + plEsc(d.motif || '') + (d.refusMotif ? '<div style="font-size:10.5px;color:#C62828">Refus : ' + plEsc(d.refusMotif) + '</div>' : '') + '</td>'
              + '<td>' + statutChip(d) + '</td><td style="font-size:11px;color:var(--plmut)">' + (d.decidePar ? plEsc(plQui(d.decidePar)) + ' · ' + plJoliDate(d.decideAt) : '—') + '</td>'
              + '<td>' + (peutRetirer ? '<button class="pl-btn pl-mini pl-ghost" onclick="plHsSupprimer(\'' + d.id + '\')" title="Retirer">✕</button>' : '') + '</td></tr>'; }).join('')
        + '</table>' : '<div class="pl-empty" style="margin-top:8px">Aucune déclaration.</div>')
      + '</div>');

    host.innerHTML = H.join('');
    plHsBadge();
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
      const sem = plEdSlot(c).sem[String(w)] || {};
      h += '<b style="font-size:12.5px;display:block;margin-top:' + (w > 1 ? '14px' : '0') + '">Semaine ' + w + ' du cycle'
        + (nb > 1 ? ' <button class="pl-btn pl-ghost pl-mini" onclick="plCopySem(' + w + ')">⧉ copier vers les autres</button>' : '') + '</b>';
      h += '<table class="pl-tt"><tr><th></th>' + PL_JOURS_FR.slice(0, 6).map(j => '<th>' + j + '</th>').join('') + '<th>Total</th></tr>';
      const posEditable = !!PL_POS_CHOIX[c.grp];
      const posSem = plEdSlot(c).pos[String(w)] || {};
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
    const eT = plEdSlot(c);
    if (eT.obj === c) c.sem = sem; else eT.obj.data[c.id].sem = sem;
    if (PL_POS_CHOIX[c.grp]) {
      const pos = {};
      document.querySelectorAll('#pl-tr-body select[data-pw]').forEach(sel => {
        const w = sel.dataset.pw, jr = sel.dataset.pj, hh = +sel.dataset.ph;
        if (!pos[w]) pos[w] = {};
        if (!pos[w][jr]) pos[w][jr] = ['C', 'C'];
        pos[w][jr][hh] = sel.value;
      });
      if (eT.obj === c) c.pos = pos; else eT.obj.data[c.id].pos = pos;
    }
    plStamp(eT.obj); plPersist();
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
  function plInit() { try { plInject(); plHashWatch(); } catch (e) { console.warn('pl init', e); } }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', plInit);
  else plInit();
  // premier rendu quand la section devient visible (showSec ne notifie pas : on rend à l'injection + à chaque sync)
  setTimeout(function () { try { plRender(); } catch (e) { console.warn('pl render', e); } }, 400);
})();
