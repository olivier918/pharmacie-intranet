/* ════════════════════════════════════════════════════════════════════════════
   Module RÉUNION D'ÉQUIPE — l'ordre du jour de la prochaine réunion.

   Le principe : entre deux réunions, un sujet se pense au comptoir et se perd
   avant le soir. Le module sert à le poser en trois secondes, avec de quoi
   l'étayer — un commentaire, une pièce jointe — pour que la réunion parte
   d'une liste écrite plutôt que de ce dont on se souvient.

   Qui voit le module peut y écrire : le cercle se règle en back office, dans
   l'écran d'accès aux modules, comme pour tous les autres. Pas de deuxième
   liste à tenir à jour, donc pas de deuxième liste à oublier.

   Un thème se coche « abordé » au fil de la réunion. Ce qui reste décoché
   reste à l'ordre du jour de la suivante — c'est exactement ce qu'on veut :
   un sujet qu'on n'a pas eu le temps de traiter n'a pas disparu.

   Préfixe `re` / `re-` : rien ici ne touche à l'existant.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const E = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  const reUser  = () => (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null;
  const reAdmin = () => (typeof isAdmin === 'function') ? isAdmin() : false;
  const reStaff = () => (typeof staffDB !== 'undefined' && Array.isArray(staffDB)) ? staffDB : [];
  const reThemes = () => (typeof reunionThemes !== 'undefined' && Array.isArray(reunionThemes)) ? reunionThemes : [];
  const reSeances = () => (typeof reunions !== 'undefined' && Array.isArray(reunions)) ? reunions : [];
  const reSave = (now) => {
    try {
      if (now && typeof saveNow === 'function') saveNow();
      else if (typeof schedSave === 'function') schedSave();
    } catch (e) {}
  };
  function rePrenom(id) {
    const s = reStaff().find(x => x.id === id);
    return s ? (s.prenom || s.id) : (id || '');
  }

  // ── Dates ─────────────────────────────────────────────────────────────────
  // Jamais toISOString() : sur une date à minuit, la conversion UTC renvoie la
  // veille en heure de Paris. On construit la chaîne à la main, en local.
  const pad = n => String(n).padStart(2, '0');
  function reIso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function reAujourdhui() { return reIso(new Date()); }
  // Midi, et non minuit : un changement d'heure ne peut pas faire basculer la
  // date d'un jour.
  function reDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m ? new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0) : null;
  }
  const RE_JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const RE_MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  function reLibelleDate(iso) {
    const d = reDate(iso); if (!d) return '';
    return RE_JOURS[d.getDay()] + ' ' + d.getDate() + ' ' + RE_MOIS[d.getMonth()];
  }
  function reJours(a, b) {
    const da = reDate(a), db = reDate(b);
    if (!da || !db) return null;
    return Math.round((db - da) / 86400000);
  }
  // « dans 12 jours » se comprend sans calcul ; une date seule oblige à la
  // comparer à celle du jour.
  function reDelai(iso, auj) {
    const n = reJours(auj, iso);
    if (n == null) return '';
    if (n < 0) return n === -1 ? 'hier' : 'il y a ' + (-n) + ' jours';
    if (n === 0) return "aujourd'hui";
    if (n === 1) return 'demain';
    if (n < 14) return 'dans ' + n + ' jours';
    if (n < 21) return 'dans deux semaines';
    return 'dans ' + Math.round(n / 7) + ' semaines';
  }

  // ── Lecture des données ───────────────────────────────────────────────────
  // La séance à venir : la plus proche parmi celles qui ne sont pas passées.
  // Celles d'hier restent en base — elles ne sont pas fausses, elles ont eu
  // lieu — mais ne s'affichent plus.
  function reProchaine(l, auj) {
    const a = String(auj || '');
    return (l || [])
      .filter(r => r && r.date && String(r.date) >= a)
      .sort((x, y) => String(x.date).localeCompare(String(y.date)))[0] || null;
  }
  // L'ordre du jour : l'ordre d'arrivée, jusqu'à ce que quelqu'un en décide
  // autrement. Un thème reçoit alors un `rang`, et c'est lui qui prime.
  //
  // AUCUNE MIGRATION N'EST ÉCRITE DANS LES DONNÉES. Les thèmes posés avant
  // cette version n'ont pas de `rang`, et n'en auront jamais tant qu'on ne
  // touche pas à l'ordre : ils se rangent à leur date d'arrivée, comme avant.
  // La traduction se fait à la LECTURE, pas en réécrivant le fichier de
  // données — une migration qui traverse le réseau toutes les huit secondes
  // n'a pas sa place ici.
  //
  // Un thème posé APRÈS un classement à la main n'a pas de rang non plus :
  // il se met à la fin. C'est ce qu'on attend d'un sujet ajouté la veille au
  // soir — il ne doit pas s'insérer au milieu d'un ordre du jour déjà réglé.
  const RE_SANS_RANG = Number.MAX_SAFE_INTEGER;
  function reRang(t) {
    return (t && typeof t.rang === 'number' && isFinite(t.rang)) ? t.rang : RE_SANS_RANG;
  }
  function reOrdreDuJour(l) {
    return (l || []).filter(t => t && !t.aborde).slice()
      .sort((a, b) => (reRang(a) - reRang(b)) || ((a.ts || 0) - (b.ts || 0)));
  }

  // L'échange de deux voisins. Fonction pure : elle rend la liste telle qu'elle
  // sera, ou `null` quand il n'y a rien à faire — en haut on ne monte pas.
  function reEchanger(jour, id, sens) {
    const l = (jour || []).slice();
    const i = l.findIndex(t => t && t.id === id);
    if (i < 0) return null;
    const j = i + (sens < 0 ? -1 : 1);
    if (j < 0 || j >= l.length) return null;
    const t = l[i]; l[i] = l[j]; l[j] = t;
    return l;
  }
  // Les thèmes traités, du plus récemment coché au plus ancien.
  function reAbordes(l) {
    return (l || []).filter(t => t && t.aborde)
      .slice().sort((a, b) => (b.abordeLe || b.ts || 0) - (a.abordeLe || a.ts || 0));
  }
  // Un thème se modifie et se retire par son auteur, ou par un administrateur.
  // Le cocher, en revanche, est ouvert à tous : c'est un geste de réunion, pas
  // une prise de pouvoir sur le texte de quelqu'un.
  function rePeutToucher(t, moi, admin) {
    if (!t || !moi) return false;
    return admin === true || String(t.par) === String(moi);
  }

  // ── Pièces jointes ────────────────────────────────────────────────────────
  const RE_TYPES = {
    'application/pdf': 'PDF',
    'image/jpeg': 'image', 'image/png': 'image', 'image/gif': 'image', 'image/webp': 'image',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
    'application/msword': 'Word', 'application/vnd.ms-excel': 'Excel'
  };
  const RE_ACCEPT = '.pdf,.jpg,.jpeg,.png,.gif,.webp,.docx,.xlsx,.doc,.xls';
  const RE_MAX = 8 * 1024 * 1024;
  function reTaille(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' o';
    if (n < 1024 * 1024) return Math.round(n / 1024) + ' Ko';
    return (n / 1048576).toFixed(1).replace('.', ',') + ' Mo';
  }
  // Le type déclaré par le navigateur est parfois vide (Windows, fichier sans
  // association). On retombe alors sur l'extension : mieux vaut un envoi qui
  // passe qu'un refus incompréhensible au comptoir.
  const RE_EXT = {
    pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', webp: 'image/webp',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    doc: 'application/msword', xls: 'application/vnd.ms-excel'
  };
  function reMime(fichier) {
    const t = String((fichier && fichier.type) || '');
    if (RE_TYPES[t]) return t;
    const nom = String((fichier && fichier.name) || '');
    const ext = (nom.split('.').pop() || '').toLowerCase();
    return RE_EXT[ext] || null;
  }

  let reFichier = null;            // le fichier choisi, pas encore envoyé
  window.reChoisirFichier = function (input) {
    const f = input && input.files && input.files[0];
    const el = document.getElementById('re-fich-nom');
    if (!f) { reFichier = null; if (el) el.textContent = ''; return; }
    if (!reMime(f)) {
      alert('Type de fichier non accepté.\n\nAcceptés : PDF, images, Word (.docx) et Excel (.xlsx).');
      input.value = ''; reFichier = null; if (el) el.textContent = ''; return;
    }
    if (f.size > RE_MAX) {
      alert('Fichier trop lourd : ' + reTaille(f.size) + '. La limite est de 8 Mo.');
      input.value = ''; reFichier = null; if (el) el.textContent = ''; return;
    }
    reFichier = f;
    if (el) el.textContent = f.name + ' · ' + reTaille(f.size);
  };

  function reLireBase64(f) {
    return new Promise(function (ok, ko) {
      const r = new FileReader();
      r.onload = () => {
        const v = String(r.result || '');
        const m = v.match(/^data:[^;]*;base64,(.+)$/);
        m ? ok(m[1]) : ko(new Error('illisible'));
      };
      r.onerror = () => ko(new Error('illisible'));
      r.readAsDataURL(f);
    });
  }
  async function reDeposer(f) {
    const mime = reMime(f); if (!mime) return null;
    let data;
    try { data = await reLireBase64(f); }
    catch (e) { alert('Le fichier n’a pas pu être lu.'); return null; }
    try {
      const r = await fetch('/api/images', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mime: mime, data: data })
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j || !j.ok) {
        alert('La pièce jointe n’a pas pu être enregistrée : ' + ((j && j.error) || ('erreur ' + r.status)));
        return null;
      }
      return { fichId: j.id, fichNom: String(f.name || 'fichier').slice(0, 120), fichMime: mime, fichTaille: f.size };
    } catch (e) {
      alert('La pièce jointe n’a pas pu être enregistrée : serveur injoignable.');
      return null;
    }
  }

  // ── Écriture ──────────────────────────────────────────────────────────────
  window.reAjouter = async function () {
    const u = reUser(); if (!u || u.id == null) return;
    const iT = document.getElementById('re-titre');
    const iC = document.getElementById('re-comm');
    const titre = String((iT && iT.value) || '').trim();
    if (!titre) { alert('Donnez un titre au thème.'); if (iT) iT.focus(); return; }
    const btn = document.getElementById('re-ajout-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Enregistrement…'; }
    let piece = null;
    if (reFichier) {
      piece = await reDeposer(reFichier);
      if (!piece) { if (btn) { btn.disabled = false; btn.textContent = 'Ajouter à l’ordre du jour'; } return; }
    }
    const now = Date.now();
    reThemes().push(Object.assign({
      id: now, ts: now, par: u.id,
      titre: titre.slice(0, 120),
      comm: String((iC && iC.value) || '').trim().slice(0, 2000),
      aborde: false, abordeLe: null, abordePar: null,
      updatedAt: now
    }, piece || {}));
    if (iT) iT.value = ''; if (iC) iC.value = '';
    const iF = document.getElementById('re-fich'); if (iF) iF.value = '';
    reFichier = null;
    const nf = document.getElementById('re-fich-nom'); if (nf) nf.textContent = '';
    if (btn) { btn.disabled = false; btn.textContent = 'Ajouter à l’ordre du jour'; }
    if (typeof logAction === 'function') logAction('Thème de réunion ajouté', '');
    reSave(true); window.reRender();
  };

  // Cocher est ouvert à tous ceux qui voient le module : en réunion, c'est
  // celui qui tient le clavier qui coche, pas l'auteur du thème.
  window.reCocher = function (id) {
    const u = reUser(); if (!u) return;
    const t = reThemes().find(x => x && x.id === id); if (!t) return;
    const now = Date.now();
    if (t.aborde) { t.aborde = false; t.abordeLe = null; t.abordePar = null; }
    else { t.aborde = true; t.abordeLe = now; t.abordePar = u.id; }
    t.updatedAt = now;
    reSave(true); window.reRender();
  };

  // Déplacer un thème d'une place à une autre, où qu'elle soit. La souris s'en
  // sert pour poser une carte n'importe où ; les flèches, pour la décaler d'un
  // cran. Fonction pure : elle rend la liste telle qu'elle sera, ou `null`.
  function reInserer(jour, id, place) {
    const l = (jour || []).slice();
    const i = l.findIndex(t => t && t.id === id);
    if (i < 0) return null;
    let j = Math.max(0, Math.min(l.length - 1, place | 0));
    if (i === j) return null;
    l.splice(j, 0, l.splice(i, 1)[0]);
    return l;
  }

  // LE SEUL ENDROIT QUI ÉCRIT UN ORDRE. Les flèches et le glisser-déposer
  // passent tous deux par ici : deux chemins vers deux renumérotations
  // différentes finiraient par diverger, et l'un des deux perdrait le
  // classement sans qu'on sache lequel.
  function reAppliquerOrdre(neuf) {
    if (!neuf) return false;
    const now = Date.now();
    // ON RENUMÉROTE TOUT, PAS SEULEMENT LES DEUX ÉCHANGÉS. Deux raisons, et la
    // seconde est celle qui fait perdre un ordre du jour : au premier
    // classement, aucun thème n'a de rang, donc n'en donner qu'à deux laisserait
    // les autres à la fin. Et chaque fiche touchée doit recevoir un `updatedAt`
    // neuf : la fusion garde la version la plus récente id par id, et un poste
    // resté en arrière repousserait sinon ses propres copies — sans rang —
    // par-dessus le classement qu'on vient de faire.
    let bouge = 0;
    neuf.forEach(function (t, i) {
      if (t.rang === i) return;
      t.rang = i; t.updatedAt = now; bouge++;
    });
    if (!bouge) return false;
    reSave(true); window.reRender(); return true;
  }

  // Monter ou descendre d'un cran. Réservé aux administrateurs, comme poser la
  // date : c'est un geste de personne qui anime la réunion, pas une reprise sur
  // le texte de quelqu'un — que son auteur, lui, reste seul à pouvoir modifier.
  // LES FLÈCHES RESTENT, MÊME AVEC LE GLISSER-DÉPOSER. Elles marchent au doigt
  // sans viser, au clavier, et pour qui ne peut pas tenir un geste continu.
  window.reDeplacer = function (id, sens) {
    const u = reUser(); if (!u || !reAdmin()) return;
    reAppliquerOrdre(reEchanger(reOrdreDuJour(reThemes()), id, sens));
  };

  // Poser un thème à une place donnée — ce que rend le glisser-déposer.
  window.rePoser = function (id, place) {
    const u = reUser(); if (!u || !reAdmin()) return false;
    return reAppliquerOrdre(reInserer(reOrdreDuJour(reThemes()), id, place));
  };

  window.reModifier = function (id) {
    const u = reUser(); if (!u) return;
    const t = reThemes().find(x => x && x.id === id); if (!t) return;
    if (!rePeutToucher(t, u.id, reAdmin())) return;
    const titre = prompt('Le thème', t.titre || '');
    if (titre == null) return;
    if (!String(titre).trim()) { alert('Un thème sans titre ne se lit pas.'); return; }
    const comm = prompt('Précisions (laisser vide pour aucune)', t.comm || '');
    if (comm == null) return;
    t.titre = String(titre).trim().slice(0, 120);
    t.comm = String(comm).trim().slice(0, 2000);
    t.majAt = Date.now(); t.updatedAt = t.majAt;
    reSave(true); window.reRender();
  };

  window.reRetirer = function (id) {
    const u = reUser(); if (!u) return;
    const l = reThemes(), i = l.findIndex(x => x && x.id === id);
    if (i < 0) return;
    if (!rePeutToucher(l[i], u.id, reAdmin())) return;
    if (!confirm('Retirer « ' + (l[i].titre || '') + ' » de l’ordre du jour ?')) return;
    if (typeof markDeleted === 'function') markDeleted('reunionThemes', id);
    l.splice(i, 1);
    reSave(true); window.reRender();
  };

  // ── La date de la prochaine réunion ───────────────────────────────────────
  // Une LISTE de séances, pas une date unique, et pour une raison précise : la
  // base est un seul bloc, et une valeur simple envoyée par un poste écrase
  // celle du serveur. Un poste ouvert depuis ce matin annulerait sans le savoir
  // la date posée à midi. Les collections à identifiant, elles, fusionnent.
  let reEditDate = false;
  window.reFormDate = function () { if (!reAdmin()) return; reEditDate = true; reRendDate(); };
  window.reFermerDate = function () { reEditDate = false; reRendDate(); };

  window.reEnregistrerDate = function () {
    if (!reAdmin()) return;
    const iD = document.getElementById('re-d-date');
    const iH = document.getElementById('re-d-heure');
    const iL = document.getElementById('re-d-lieu');
    const date = String((iD && iD.value) || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { alert('Choisissez une date.'); return; }
    const now = Date.now();
    const p = reProchaine(reSeances(), reAujourdhui());
    const champs = {
      date: date,
      heure: String((iH && iH.value) || '').trim(),
      lieu: String((iL && iL.value) || '').trim().slice(0, 80),
      updatedAt: now
    };
    if (p) Object.assign(p, champs);
    else reSeances().push(Object.assign({ id: now, ts: now }, champs));
    reEditDate = false;
    reSave(true); window.reRender();
  };

  window.reRetirerDate = function () {
    if (!reAdmin()) return;
    const p = reProchaine(reSeances(), reAujourdhui()); if (!p) return;
    if (!confirm('Retirer la date de la prochaine réunion ?')) return;
    const l = reSeances(), i = l.findIndex(x => x && x.id === p.id);
    if (i < 0) return;
    if (typeof markDeleted === 'function') markDeleted('reunions', p.id);
    l.splice(i, 1);
    reEditDate = false;
    reSave(true); window.reRender();
  };

  // ── Rendu ─────────────────────────────────────────────────────────────────
  function reRendDate() {
    const el = document.getElementById('re-date'); if (!el) return;
    const p = reProchaine(reSeances(), reAujourdhui());

    // Le formulaire ne s'ouvre que par reFormDate(), reservee aux admins ; on le
    // reverifie ici, pour qu'une perte de droits en cours de session referme la
    // saisie au lieu de la laisser ouverte.
    if (reEditDate && reAdmin()) {
      el.className = 're-date re-date-edit';
      el.innerHTML =
        '<div class="re-d-f">'
        + '<label>Date<input type="date" id="re-d-date" value="' + E(p ? p.date : '') + '"></label>'
        + '<label>Heure<input type="time" id="re-d-heure" value="' + E(p ? (p.heure || '') : '') + '"></label>'
        + '<label><span>Lieu <span class="re-fac">facultatif</span></span>'
        + '<input type="text" id="re-d-lieu" maxlength="80" placeholder="Arrière-boutique" value="' + E(p ? (p.lieu || '') : '') + '"></label>'
        + '<div class="re-d-b">'
        + '<button class="re-btn" onclick="reEnregistrerDate()">Enregistrer</button>'
        + '<button class="re-lien" onclick="reFermerDate()">Annuler</button>'
        + (p ? '<button class="re-lien re-sup" onclick="reRetirerDate()">Retirer la date</button>' : '')
        + '</div></div>';
      return;
    }

    if (!p) {
      el.className = 're-date re-date-vide';
      el.innerHTML = '<span>Aucune réunion programmée.</span>'
        + (reAdmin() ? '<button class="re-lien" onclick="reFormDate()">Poser une date</button>' : '');
      return;
    }
    const delai = reDelai(p.date, reAujourdhui());
    el.className = 're-date';
    el.innerHTML = '<div class="re-d-t">Prochaine réunion</div>'
      + '<div class="re-d-v">' + E(reLibelleDate(p.date))
      + (p.heure ? ' · ' + E(p.heure.replace(':', 'h')) : '')
      + (p.lieu ? ' · ' + E(p.lieu) : '') + '</div>'
      + '<div class="re-d-d">' + E(delai) + '</div>'
      + (reAdmin() ? '<button class="re-lien re-d-m" onclick="reFormDate()">Modifier</button>' : '');
  }

  function reCarte(t, moi, admin, i, n) {
    const mien = rePeutToucher(t, moi, admin);
    // Les flèches n'ont de sens que dans l'ordre du jour : un thème abordé est
    // dans l'historique, et l'historique se lit du plus récent, pas à la main.
    const range = admin && !t.aborde && typeof i === 'number' && n > 1;
    const quand = (typeof acDepuis === 'function') ? '' : '';
    const d = new Date(t.ts || Date.now());
    const jour = pad(d.getDate()) + '/' + pad(d.getMonth() + 1);
    return '<div class="re-t' + (t.aborde ? ' fait' : '')
      + (range ? ' re-prise' : '') + '" data-id="' + (+t.id) + '">'
      + (range ? '<span class="re-dd" title="Glisser pour classer" aria-hidden="true">\u283f</span>' : '')
      + '<button class="re-coche" onclick="reCocher(' + (+t.id) + ')" title="'
        + (t.aborde ? 'Remettre à l’ordre du jour' : 'Marquer comme abordé') + '">'
        + (t.aborde ? '✓' : '') + '</button>'
      + '<div class="re-t-c">'
      +   '<div class="re-t-h">' + E(t.titre || '') + '</div>'
      +   '<div class="re-t-m">' + E(rePrenom(t.par)) + ' · ' + E(jour)
      +     (t.aborde && t.abordePar ? ' · abordé, coché par ' + E(rePrenom(t.abordePar)) : '')
      +   '</div>'
      +   (t.comm ? '<div class="re-t-x">' + E(t.comm) + '</div>' : '')
      +   (t.fichId ? '<a class="re-pj" href="/api/images/' + E(t.fichId) + '"'
            + ' download="' + E(t.fichNom || 'piece-jointe') + '" target="_blank" rel="noopener">'
            + '<span class="re-pj-i">' + E(RE_TYPES[t.fichMime] || 'fichier') + '</span>'
            + E(t.fichNom || 'pièce jointe')
            + (t.fichTaille ? ' · ' + E(reTaille(t.fichTaille)) : '') + '</a>' : '')
      + '</div>'
      + (range ? '<div class="re-t-r">'
          + '<button type="button" class="re-fl" onclick="reDeplacer(' + (+t.id) + ',-1)"'
          +   (i === 0 ? ' disabled' : '') + ' title="Monter" aria-label="Monter ce thème">▴</button>'
          + '<button type="button" class="re-fl" onclick="reDeplacer(' + (+t.id) + ',1)"'
          +   (i === n - 1 ? ' disabled' : '') + ' title="Descendre" aria-label="Descendre ce thème">▾</button>'
          + '</div>' : '')
      + (mien ? '<div class="re-t-o">'
          + '<span onclick="reModifier(' + (+t.id) + ')" title="Modifier">✎</span>'
          + '<span onclick="reRetirer(' + (+t.id) + ')" title="Retirer">✕</span>'
          + '</div>' : '')
      + '</div>';
  }

  // ── LE GLISSER-DÉPOSER ────────────────────────────────────
  //
  // POURQUOI LES ÉVÉNEMENTS POINTEUR ET PAS LE GLISSER-DÉPOSER DU NAVIGATEUR.
  // Le HTML5 `draggable` est fait pour déposer un fichier dans une page, pas
  // pour réorganiser une liste : il ne fonctionne pas au doigt sur téléphone,
  // on ne maîtrise ni l'image traînée ni le défilement. Les événements
  // pointeur traitent la souris, le doigt et le stylet de la même manière.
  //
  // ON NE PREND QUE PAR LA POIGNÉE. Rendre toute la carte saisissable au doigt
  // obligerait à y poser `touch-action:none` — et l'ordre du jour ne se
  // ferait plus défiler du tout. La poignée porte seule cette contrainte.
  //
  // LES FLÈCHES RESTENT. Un geste continu se rate : on relâche trop tôt, la
  // main tremble, l'écran tactile saute une image. Et il n'existe pas au
  // clavier. Le glisser-déposer est le confort ; les flèches sont le recours.
  let reDD = null;
  const RE_DD_BORD = 90, RE_DD_PAS = 14;   // défilement quand on approche du bord

  function reDDListe() { return document.getElementById('re-liste'); }

  function reDDDebut(ev) {
    if (!reAdmin() || reDD) return;
    if (ev.button != null && ev.button !== 0) return;      // clic droit, molette
    const prise = ev.target.closest ? ev.target.closest('.re-dd') : null;
    if (!prise) return;
    const el = prise.closest('.re-t');
    const liste = reDDListe();
    if (!el || !liste || el.parentNode !== liste) return;

    const r = el.getBoundingClientRect();
    const ph = document.createElement('div');
    ph.className = 're-ph';
    ph.style.height = r.height + 'px';
    liste.insertBefore(ph, el);

    reDD = { el: el, ph: ph, liste: liste, id: Number(el.dataset.id),
             dx: ev.clientX - r.left, dy: ev.clientY - r.top,
             l: r.width, prise: prise, pid: ev.pointerId, defile: 0 };
    el.classList.add('re-drag');
    el.style.width = r.width + 'px';
    el.style.left = r.left + 'px';
    el.style.top = r.top + 'px';
    document.body.classList.add('re-dd-on');
    try { prise.setPointerCapture(ev.pointerId); } catch (e) { /* capture indisponible */ }
    ev.preventDefault();
    reDDDefiler();
  }

  function reDDBouger(ev) {
    if (!reDD || ev.pointerId !== reDD.pid) return;
    reDD.y = ev.clientY;
    reDD.el.style.left = (ev.clientX - reDD.dx) + 'px';
    reDD.el.style.top = (ev.clientY - reDD.dy) + 'px';
    reDDPlacerFantome(ev.clientY);
    ev.preventDefault();
  }

  // Le fantôme se pose avant la première carte dont on a dépassé le milieu.
  // Comparer au milieu, et non au bord, évite le clignotement d'une carte qui
  // s'échange sans arrêt quand le pointeur reste sur la frontière.
  function reDDPlacerFantome(y) {
    const freres = [].slice.call(reDD.liste.children)
      .filter(c => c !== reDD.el && c !== reDD.ph && c.classList.contains('re-t'));
    let avant = null;
    for (let i = 0; i < freres.length; i++) {
      const r = freres[i].getBoundingClientRect();
      if (y < r.top + r.height / 2) { avant = freres[i]; break; }
    }
    if (avant) { if (reDD.ph.nextSibling !== avant) reDD.liste.insertBefore(reDD.ph, avant); }
    else if (reDD.liste.lastChild !== reDD.ph) reDD.liste.appendChild(reDD.ph);
  }

  // Un ordre du jour peut dépasser l'écran : sans cela, on ne pourrait pas
  // remonter un thème au-dessus de ce qui est visible.
  function reDDDefiler() {
    if (!reDD) return;
    reDD.defile = requestAnimationFrame(reDDDefiler);
    const y = reDD.y;
    if (y == null) return;
    let d = 0;
    if (y < RE_DD_BORD) d = -RE_DD_PAS;
    else if (y > window.innerHeight - RE_DD_BORD) d = RE_DD_PAS;
    if (!d) return;
    const avant = window.pageYOffset;
    window.scrollBy(0, d);
    if (window.pageYOffset !== avant) reDDPlacerFantome(y);
  }

  function reDDDefaire() {
    if (!reDD) return null;
    const d = reDD;
    cancelAnimationFrame(d.defile);
    try { d.prise.releasePointerCapture(d.pid); } catch (e) { /* déjà relâchée */ }
    d.el.classList.remove('re-drag');
    d.el.style.width = d.el.style.left = d.el.style.top = '';
    document.body.classList.remove('re-dd-on');
    reDD = null;
    return d;
  }

  function reDDFin(ev) {
    if (!reDD || (ev && ev.pointerId !== reDD.pid)) return;
    // La place visée se lit dans le DOM, AVANT de retirer quoi que ce soit :
    // c'est exactement ce que la personne voit à l'instant où elle relâche.
    const ordre = [].slice.call(reDD.liste.children)
      .filter(c => c === reDD.ph || (c.classList.contains('re-t') && c !== reDD.el));
    const place = ordre.indexOf(reDD.ph);
    const id = reDD.id;
    const ph = reDD.ph;
    reDDDefaire();
    if (ph.parentNode) ph.parentNode.removeChild(ph);
    // rePoser redessine quand l'ordre change ; sinon la carte est déjà
    // revenue à sa place toute seule, et redessiner ne ferait que clignoter.
    if (place >= 0) window.rePoser(id, place);
  }

  // Échap pendant le geste : on repose la carte où elle était. Un classement
  // commencé par erreur doit pouvoir s'abandonner sans rien changer.
  function reDDAnnuler() {
    if (!reDD) return;
    const ph = reDD.ph;
    reDDDefaire();
    if (ph.parentNode) ph.parentNode.removeChild(ph);
    window.reRender();
  }

  document.addEventListener('pointerdown', reDDDebut, true);
  document.addEventListener('pointermove', reDDBouger, true);
  document.addEventListener('pointerup', reDDFin, true);
  document.addEventListener('pointercancel', reDDAnnuler, true);
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && reDD) { ev.preventDefault(); ev.stopPropagation(); reDDAnnuler(); }
  }, true);

  let rePliAbordes = true;
  window.reBasculerAbordes = function () { rePliAbordes = !rePliAbordes; window.reRender(); };

  window.reRender = function () {
    if (!document.getElementById('sec-reunion')) return;
    reRendDate();
    const u = reUser(), moi = u ? u.id : null, admin = reAdmin();
    const f = document.getElementById('re-form');
    if (f) f.style.display = moi != null ? '' : 'none';

    const jour = reOrdreDuJour(reThemes());
    const el = document.getElementById('re-liste');
    if (el) {
      el.innerHTML = jour.length
        ? jour.map((t, i) => reCarte(t, moi, admin, i, jour.length)).join('')
        : '<div class="re-vide">L’ordre du jour est vide. Le premier thème posé sera le premier abordé.</div>';
    }
    const n = document.getElementById('re-n');
    if (n) n.textContent = jour.length ? '· ' + jour.length : '';

    const faits = reAbordes(reThemes());
    const hA = document.getElementById('re-h-abordes');
    if (hA) hA.style.display = faits.length ? '' : 'none';
    const nA = document.getElementById('re-na');
    if (nA) nA.textContent = faits.length ? '· ' + faits.length : '';
    const cv = document.getElementById('re-chev');
    if (cv) cv.textContent = rePliAbordes ? '▸' : '▾';
    const bA = document.getElementById('re-abordes');
    if (bA) {
      bA.style.display = (faits.length && !rePliAbordes) ? '' : 'none';
      if (!rePliAbordes) bA.innerHTML = faits.map(t => reCarte(t, moi, admin)).join('');
    }
  };

  // ── CSS (tout est préfixé re-) ────────────────────────────────────────────
  const RE_CSS = `
  #sec-reunion{padding:0}
  .re-wrap{max-width:900px;margin:0 auto}
  .re-bar{display:flex;align-items:center;gap:10px;margin-bottom:16px}
  .re-title{display:flex;align-items:center;gap:8px;font-size:18px;font-weight:700;color:#1D5C3A}

  .re-date{position:relative;background:linear-gradient(135deg,#1D5C3A 0%,#2E7D52 100%);color:#fff;
    border-radius:14px;padding:16px 20px;margin-bottom:18px}
  .re-d-t{font-size:.74rem;text-transform:uppercase;letter-spacing:.06em;opacity:.8}
  .re-d-v{font-size:1.28rem;font-weight:800;margin-top:3px}
  /* Une capitale partout frapperait chaque mot : Mardi 29 Septembre Arriere-Boutique. */
  .re-d-v::first-letter{text-transform:uppercase}
  .re-d-d{font-size:.84rem;opacity:.9;margin-top:2px}
  .re-d-m{position:absolute;top:14px;right:16px;color:#fff !important;opacity:.85}
  .re-date-vide{background:#F4F7F5;color:var(--gray-500);border:1px dashed #cfdbd3;
    display:flex;align-items:center;gap:14px;justify-content:center;font-size:.9rem}
  .re-date-vide .re-lien{color:#1D5C3A !important}
  .re-date-edit{background:#F4F7F5;color:#222;border:1px solid #dfe8e2}
  .re-d-f{display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end}
  .re-d-f label{display:flex;flex-direction:column;gap:4px;font-size:.76rem;color:var(--gray-500);font-weight:600}
  .re-d-f input{font-family:inherit;font-size:14px;border:1px solid #dfe8e2;border-radius:9px;
    height:38px;padding:0 10px;background:#fff;color:#222}
  .re-d-f input:focus{outline:none;border-color:#1D5C3A}
  .re-d-b{display:flex;align-items:center;gap:12px;margin-left:auto}
  .re-fac{font-weight:400;opacity:.7}

  .re-form{background:#fff;border:1px solid #e7ece9;border-radius:13px;padding:15px;margin-bottom:20px}
  .re-form input[type=text],.re-form textarea{width:100%;box-sizing:border-box;font-family:inherit;
    font-size:14px;border:1px solid #dfe8e2;border-radius:9px;padding:9px 11px;background:#fff;color:#222}
  .re-form input[type=text]:focus,.re-form textarea:focus{outline:none;border-color:#1D5C3A}
  .re-form textarea{margin-top:9px;min-height:62px;resize:vertical}
  .re-pied{display:flex;align-items:center;gap:14px;margin-top:11px;flex-wrap:wrap}
  .re-fich-l{display:inline-flex;align-items:center;gap:7px;font-size:.83rem;color:#1D5C3A;
    font-weight:600;cursor:pointer}
  .re-fich-l input{display:none}
  .re-fich-nom{font-size:.8rem;color:var(--gray-500);font-weight:400}
  .re-btn{margin-left:auto;background:#1D5C3A;color:#fff;border:none;border-radius:9px;
    padding:9px 16px;font-family:inherit;font-size:.86rem;font-weight:700;cursor:pointer}
  .re-btn:disabled{opacity:.6;cursor:default}
  .re-lien{background:none;border:none;color:#1D5C3A;font-family:inherit;font-size:.83rem;
    font-weight:600;cursor:pointer;padding:0}
  .re-sup{color:#B3261E}

  .re-h{display:flex;align-items:center;gap:8px;font-size:.78rem;font-weight:700;
    text-transform:uppercase;letter-spacing:.05em;color:var(--gray-500);margin:0 0 10px 2px}
  .re-h.re-pli{cursor:pointer;margin-top:22px}
  .re-h.re-pli:hover{color:#1D5C3A}

  .re-t{display:flex;gap:13px;align-items:flex-start;background:#fff;border:1px solid #e7ece9;
    border-radius:12px;padding:13px 15px;margin-bottom:9px}
  .re-t:hover{border-color:#cdd8d1}
  .re-t.fait{background:#F7F9F8;border-color:#e9eeeb}
  .re-coche{flex:none;width:23px;height:23px;margin-top:1px;border:1.8px solid #c3d0c8;border-radius:7px;
    background:#fff;cursor:pointer;color:#fff;font-size:13px;font-weight:800;line-height:1;padding:0}
  .re-coche:hover{border-color:#1D5C3A}
  .re-t.fait .re-coche{background:#2E7D52;border-color:#2E7D52}
  .re-t-c{flex:1;min-width:0}
  .re-t-h{font-weight:700;font-size:.97rem;color:#1a2b22;word-wrap:break-word}
  .re-t.fait .re-t-h{color:var(--gray-500);text-decoration:line-through}
  .re-t-m{font-size:.76rem;color:var(--gray-500);margin-top:2px}
  .re-t-x{font-size:.87rem;color:#3d4a44;margin-top:7px;white-space:pre-wrap;word-wrap:break-word}
  .re-pj{display:inline-flex;align-items:center;gap:7px;margin-top:9px;font-size:.81rem;
    color:#1D5C3A;text-decoration:none;font-weight:600;background:#F1F6F3;border:1px solid #dfe8e2;
    border-radius:8px;padding:5px 10px}
  .re-pj:hover{border-color:#1D5C3A}
  .re-pj-i{font-size:.68rem;text-transform:uppercase;letter-spacing:.04em;background:#1D5C3A;
    color:#fff;border-radius:4px;padding:1px 5px;font-weight:800}
  .re-t-o{flex:none;display:flex;gap:9px;color:#b6c2ba;font-size:.92rem}
  /* Les flèches restent pâles : elles servent une fois par semaine, et un ordre
     du jour se lit avant de se réorganiser. Elles s'affirment au survol. */
  .re-t-r{flex:none;display:flex;flex-direction:column;gap:1px;margin-right:2px}
  /* LA POIGNÉE PORTE SEULE touch-action:none. Posée sur la carte entière,
     elle empêcherait l'ordre du jour de défiler au doigt. */
  .re-dd{flex:none;align-self:center;cursor:grab;touch-action:none;color:#cdd8d1;
    font-size:.95rem;line-height:1;padding:6px 3px;margin:-6px 0 -6px -4px;user-select:none}
  .re-t:hover .re-dd{color:#9bb0a4}
  .re-prise.re-drag .re-dd,.re-dd:active{cursor:grabbing}
  /* La carte saisie quitte le flux et suit le pointeur. Un léger soulèvement
     dit qu'elle est en main ; sans lui on ne sait pas ce qu'on déplace. */
  .re-t.re-drag{position:fixed;z-index:1100;margin:0;pointer-events:none;
    box-shadow:0 16px 34px rgba(0,0,0,.18);border-color:#bcd2c4;opacity:.98}
  /* Le fantôme montre OÙ la carte se posera. Sans lui, on déplace à l'aveugle
     et l'on découvre le résultat en relâchant. */
  .re-ph{border:2px dashed #bcd2c4;background:var(--g-pale,#E8F5E9);border-radius:12px;
    margin-bottom:9px;box-sizing:border-box}
  body.re-dd-on{user-select:none;cursor:grabbing}
  @media print{.re-dd,.re-ph{display:none}}
  .re-fl{border:none;background:none;cursor:pointer;color:#b6c2ba;font-size:.82rem;
    line-height:1;padding:3px 5px;border-radius:5px;transition:background .12s,color .12s}
  .re-fl:hover:not(:disabled){background:var(--g-pale,#E8F5E9);color:var(--g-dark,#1D5C3A)}
  .re-fl:focus-visible{outline:2px solid var(--g-mid,#2E7D54);outline-offset:1px}
  /* En bout de liste, la flèche ne disparaît pas : elle s'éteint. Un bouton qui
     s'efface fait sauter les deux autres lignes à chaque déplacement. */
  .re-fl:disabled{opacity:.25;cursor:default}
  @media print{.re-t-r{display:none}}
  .re-t-o span{cursor:pointer}
  .re-t-o span:hover{color:#1D5C3A}
  .re-vide{padding:1.6rem 1rem;text-align:center;color:var(--gray-500);font-size:.86rem;
    background:#fff;border:1px dashed #e0e7e3;border-radius:12px}
  @media(max-width:640px){
    .re-d-b{margin-left:0;width:100%}
    .re-btn{margin-left:0;width:100%}
  }`;

  // ── Gabarit + injection ───────────────────────────────────────────────────
  const RE_SECTION =
    '<div class="re-wrap">'
    + '<div class="re-bar"><div class="re-title">'
    +   '<svg class="ico"><use href="#ic-collaborateurs"></use></svg> Réunion d’équipe</div></div>'
    + '<div class="re-date" id="re-date"></div>'
    + '<div class="re-form" id="re-form">'
    +   '<input type="text" id="re-titre" maxlength="120" placeholder="Le thème à aborder en réunion">'
    +   '<textarea id="re-comm" maxlength="2000" placeholder="Précisions, contexte, ce que vous proposez… (facultatif)"></textarea>'
    +   '<div class="re-pied">'
    +     '<label class="re-fich-l">📎 Joindre un fichier'
    +       '<input type="file" id="re-fich" accept="' + RE_ACCEPT + '" onchange="reChoisirFichier(this)">'
    +     '</label>'
    +     '<span class="re-fich-nom" id="re-fich-nom"></span>'
    +     '<button class="re-btn" id="re-ajout-btn" onclick="reAjouter()">Ajouter à l’ordre du jour</button>'
    +   '</div>'
    + '</div>'
    + '<div class="re-h">Ordre du jour <span id="re-n"></span></div>'
    + '<div id="re-liste"></div>'
    + '<div class="re-h re-pli" id="re-h-abordes" onclick="reBasculerAbordes()" style="display:none">'
    +   'Déjà abordés <span id="re-na"></span> <span id="re-chev">▸</span></div>'
    + '<div id="re-abordes" style="display:none"></div>'
    + '</div>';

  function reInject() {
    if (document.getElementById('re-css')) return;
    const st = document.createElement('style');
    st.id = 're-css'; st.textContent = RE_CSS;
    document.head.appendChild(st);

    const navRef = document.querySelector('.sb-item[data-sec="messagerie"]')
      || document.querySelector('.sb-item[data-sec="livraisons"]');
    if (navRef && !document.querySelector('.sb-item[data-sec="reunion"]')) {
      const b = document.createElement('button');
      b.className = 'sb-item';
      b.setAttribute('data-sec', 'reunion');
      b.setAttribute('onclick', "showSec('reunion',this)");
      b.innerHTML = '<svg class="ico sb-ico"><use href="#ic-collaborateurs"></use></svg>'
        + '<span class="sb-label">Réunion d’équipe</span>';
      navRef.insertAdjacentElement('afterend', b);
    }

    const secRef = document.getElementById('sec-livraisons');
    if (secRef && !document.getElementById('sec-reunion')) {
      const sec = document.createElement('section');
      sec.id = 'sec-reunion'; sec.className = 'sec';
      sec.innerHTML = RE_SECTION;
      secRef.parentNode.appendChild(sec);
      window.reRender();
    }
  }

  // Ce que l'accueil affiche : une pastille avec la date, à côté des autres.
  // Elle ne s'affiche que pour ceux qui ont le module — la barre latérale est
  // déjà filtrée par les droits, on s'appuie dessus plutôt que de recalculer.
  window.reAlerteAccueil = function () {
    if (!document.querySelector('.sb-item[data-sec="reunion"]')) return '';
    const p = reProchaine(reSeances(), reAujourdhui());
    if (!p) return '';
    const n = reOrdreDuJour(reThemes()).length;
    return '<button class="ac-al" onclick="showSec(\'reunion\')"><span class="ac-pt"></span>'
      + 'Réunion ' + E(reDelai(p.date, reAujourdhui()))
      + (n ? ' · ' + n + ' thème' + (n > 1 ? 's' : '') : '')
      + '</button>';
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', reInject);
  else reInject();
})();
