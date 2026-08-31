/* ══════════════════════════════════════════════════════════════════════════
   pl-core.js — noyau de données de la page Planning (/planning)
   ──────────────────────────────────────────────────────────────────────────
   La page Planning est un CLIENT INDÉPENDANT de la même base : elle lit tout
   l'état par GET /api/data mais n'envoie QUE ses propres rubriques. Le serveur
   fusionne rubrique par rubrique (mergeState), donc rien de ce que cette page
   n'envoie pas ne peut être écrasé : livraisons, crédits, caisse, PIN des
   collaborateurs… restent intacts même si cet onglet reste ouvert des heures.

   Règles de synchronisation (identiques à l'intranet, à respecter absolument) :
   · mutations EN PLACE (splice/push) ou réassignation du nom nu — jamais window.x =
   · updatedAt = Date.now() à CHAQUE mutation d'un enregistrement
   · suppression = tombstone {c, id, t} pour qu'un poste en retard ne ressuscite pas
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ── état partagé avec pl-module.js (déclarations globales de la page) ──
  window.plParams = {};
  window.plPostes = []; window.plRotations = []; window.plContrats = []; window.plTrames = [];
  window.plExceptions = []; window.plDemandes = []; window.plReels = []; window.plNotifs = []; window.plClotures = [];
  window.plHeuresSup = [];      // heures supplémentaires déclarées par les collaborateurs (validation admin)
  window.plAbsences = [];       // périodes d'absence (congés, maternité, maladie, récupération, formation)
  window.plEchanges = [];       // échanges de jours entre collaborateurs (ou permutation de ses propres jours)
  window.staffDB = [];          // lecture seule ici : sert aux noms et à l'identification par PIN
  window.currentUser = null;
  window.ADMIN = { mail: 'admin@pharmacie-mondeville.fr', pw: 'pharma2026' };
  window.tombstones = [];

  // Rubriques que CETTE page a le droit d'écrire. Ne jamais y ajouter une rubrique
  // d'un autre module : ce qui n'est pas dans cette liste n'est jamais envoyé.
  const PL_COLLS = ['plPostes', 'plRotations', 'plContrats', 'plTrames', 'plExceptions',
    'plDemandes', 'plReels', 'plNotifs', 'plClotures', 'plHeuresSup', 'plAbsences', 'plEchanges'];
  const PLPARAMS_SUBS = ['periodes', 'seuilsComptoir', 'seuilsPharmaciens', 'seuilsPostes', 'motifsAbsence'];

  function ref(n) { return window[n]; }

  let _loadedOK = false;     // true seulement après une lecture réussie (anti-écrasement)
  let _suppressSave = false; // pendant un rafraîchissement : on ne réécrit pas ce qu'on vient de lire
  let _savePending = false;  // une modification locale attend d'être persistée
  let _saveTimer = null;
  let _idSnap = {};

  function _idsOf(a) { const s = new Set(); if (Array.isArray(a)) a.forEach(r => { if (r && r.id != null) s.add(r.id); }); return s; }
  function snapIds() {
    PL_COLLS.forEach(n => { _idSnap[n] = _idsOf(ref(n)); });
    PLPARAMS_SUBS.forEach(s => { _idSnap['plParams.' + s] = _idsOf(window.plParams && window.plParams[s]); });
  }
  function diffTombstones() {
    const now = Date.now();
    PL_COLLS.forEach(n => {
      const prev = _idSnap[n]; if (!prev) return;
      const cur = _idsOf(ref(n));
      prev.forEach(id => { if (!cur.has(id)) window.tombstones.push({ c: n, id: id, t: now }); });
    });
    PLPARAMS_SUBS.forEach(s => {
      const prev = _idSnap['plParams.' + s]; if (!prev) return;
      const cur = _idsOf(window.plParams && window.plParams[s]);
      prev.forEach(id => { if (!cur.has(id)) window.tombstones.push({ c: 'plParams.' + s, id: id, t: now }); });
    });
  }

  window.schedSave = function () {
    if (!_loadedOK || _suppressSave) return;
    _savePending = true;
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(window.saveAll, 600);
  };

  window.saveAll = async function () {
    if (!_loadedOK) return;
    diffTombstones();
    const payload = { plParams: window.plParams, tombstones: window.tombstones };
    PL_COLLS.forEach(n => { payload[n] = ref(n); });
    try {
      const r = await fetch('/api/data', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (r.ok) { _savePending = false; snapIds(); plCoreEtat('ok'); }
      else plCoreEtat('err');
    } catch (e) { plCoreEtat('err'); }
  };

  // Lecture : on remplit les rubriques du planning + staffDB/ADMIN (lecture seule).
  // maj = rafraîchissement périodique ; on ne touche à rien si une modification locale attend.
  window.loadAll = async function (maj) {
    try {
      const r = await fetch('/api/data', { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      if (maj && _savePending) return false;   // priorité à la modification locale non persistée
      _suppressSave = true;
      if (d.plParams) window.plParams = d.plParams;
      PL_COLLS.forEach(n => { if (Array.isArray(d[n])) window[n] = d[n]; });
      if (Array.isArray(d.staffDB)) {
        window.staffDB = d.staffDB;
        if (window.currentUser) {
          const u = window.staffDB.find(x => x.id === window.currentUser.id);
          if (u) window.currentUser = u;
        }
      }
      if (d.ADMIN) Object.assign(window.ADMIN, d.ADMIN);
      if (Array.isArray(d.tombstones)) window.tombstones = d.tombstones;
      _loadedOK = true;
      snapIds();
      _suppressSave = false;
      plCoreEtat('ok');
      return true;
    } catch (e) {
      console.warn('planning · lecture', e);
      plCoreEtat('err');
      return false;
    }
  };

  // Indicateur discret de synchronisation dans la barre latérale
  function plCoreEtat(k) {
    const el = document.getElementById('pl-sync');
    if (!el) return;
    el.className = 'pl-sync ' + k;
    el.title = k === 'ok' ? 'Synchronisé avec l’intranet' : 'Synchronisation interrompue — les modifications repartiront dès le retour du réseau';
  }

  // ── boucle de synchronisation : mêmes 8 secondes que l'intranet ──
  window.plCoreSync = function () {
    setInterval(async function () {
      const ok = await window.loadAll(true);
      if (ok && typeof window.plRender === 'function') { try { window.plRender(); } catch (e) { } }
    }, 8000);
  };

  // ── session : même clé que l'intranet, donc un onglet ouvert depuis l'intranet
  //    hérite de la session du jour et n'a pas à se reconnecter ──
  const SESSION_KEY = 'pharma_admin_day';
  function today() { return new Date().toISOString().split('T')[0]; }
  window.plSessionValide = function () { try { return sessionStorage.getItem(SESSION_KEY) === today(); } catch (e) { return false; } };
  window.plSessionOuvrir = function () { try { sessionStorage.setItem(SESSION_KEY, today()); } catch (e) { } };
  window.plSessionFermer = function () { try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { } };
})();
