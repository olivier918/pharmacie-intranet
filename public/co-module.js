/* ═══════════════════════════════════════════════════════════════════════════
   COMMANDES À PASSER — l'écran du matin

   On ouvre PILOT, on regarde chez qui il faut appeler, et on appelle. Rien
   d'autre. C'est pourquoi la page est classée PAR LABORATOIRE et non par
   produit : on passe un appel par laboratoire, pas un par référence.

   LA PAGE EST OUVERTE À TOUTE L'ÉQUIPE, et marquer « commande passée » aussi.
   Le nom est enregistré — c'est une trace, pour savoir qui a appelé, pas un
   droit qu'on retirerait à quelqu'un.

   AUCUNE COMMANDE N'EST JAMAIS PASSÉE D'ICI. Le module dit chez qui appeler et
   à quel point c'est pressé. Le reste est un geste humain, au téléphone.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const ICO = { rouge: '🔴', orange: '🟠', gris: '⚪', relance: '🔁' };
  const MOT = { rouge: 'urgent', orange: 'à commander', gris: 'pas pressé', relance: 'à relancer' };
  const ORDRE = ['rouge', 'orange', 'gris', 'relance'];

  // coAutres reste a null tant que personne n'a touche au replieur : on en
  // deduit l'etat d'ouverture au moment du rendu, selon qu'on a ou non des
  // laboratoires a soi.
  let coEtat = null, coFiltre = '', coUrgence = '', coAutres = null;

  function E(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }
  function coUser() { return (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null; }
  function coAdmin() { return typeof isAdmin === 'function' ? isAdmin() : false; }
  function coNb(v) { const n = Number(v); return isFinite(n) ? n : null; }

  function coDateCourte(d) {
    return new Date(d).toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long' });
  }

  // ── Le chargement ─────────────────────────────────────────────────────────
  async function coCharger() {
    const r = await fetch('/api/commandes/courant', { cache: 'no-store' });
    const j = await r.json();
    if (!j || !j.ok) throw new Error((j && j.error) || 'liste indisponible');
    coEtat = j.synthese;
  }

  // ── L'en-tête ─────────────────────────────────────────────────────────────
  //
  // UNE SYNTHÈSE VIEILLE AFFICHÉE SEREINEMENT EST PIRE QU'UNE PAGE VIDE. Si le
  // courriel du matin n'est pas arrivé, on regarderait les ruptures d'avant-
  // hier en croyant voir celles du jour — et on commanderait à côté.
  const PERIME_H = 36;
  function coEntete() {
    if (!coEtat) return '';
    const d = new Date(coEtat.date);
    const age = (Date.now() - (+d)) / 3600e3;
    const n = {};
    coEtat.labos.forEach(function (l) { n[l.urgence] = (n[l.urgence] || 0) + 1; });
    const prod = coEtat.labos.reduce(function (t, l) { return t + l.produits.length; }, 0);

    let h = '<div class="co-tete">'
      + '<div><div class="co-t-d">Synthèse ASCA du ' + E(coDateCourte(coEtat.date)) + '</div>'
      + '<div class="co-t-s">' + coEtat.labos.length + ' laboratoires · ' + prod + ' produits</div></div>'
      + '<div class="co-puces">' + ORDRE.map(function (u) {
          return '<button type="button" class="co-puce' + (coUrgence === u ? ' on' : '')
               + ' co-p-' + u + '" onclick="coFiltrerUrgence(\'' + u + '\')">'
               + ICO[u] + ' <b>' + (n[u] || 0) + '</b> <span>' + MOT[u] + '</span></button>';
        }).join('') + '</div></div>';

    if (age > PERIME_H) {
      h += '<div class="co-alerte">⚠ Cette synthèse a ' + Math.round(age / 24) + ' jour(s). '
         + 'Le courriel du matin n’est peut-être pas arrivé — <b>ce ne sont pas les ruptures '
         + 'd’aujourd’hui</b>.</div>';
    }
    const ctrl = (coEtat.erreurs || []).filter(function (e) { return e.controle; });
    if (ctrl.length) {
      h += '<div class="co-alerte">⚠ Le compte ne correspond pas à ce qu’annonce le courriel : '
         + ctrl.map(function (e) { return E(e.controle); }).join(' · ')
         + '. <b>La liste est peut-être incomplète</b> — le format d’ASCA a pu changer.</div>';
    }
    const nl = (coEtat.erreurs || []).filter(function (e) { return e.ligne; });
    if (nl.length) h += '<div class="co-avert">' + nl.length + ' ligne(s) non lue(s) dans les PDF.</div>';
    return h;
  }

  // ── Une carte de laboratoire ──────────────────────────────────────────────
  function coCarte(l) {
    const faits = l.produits.filter(function (p) { return p.statut === 'commandee'; }).length;
    const tous = faits === l.produits.length;
    return '<div class="co-l co-l-' + l.urgence + (tous ? ' fait' : '') + '">'
      + '<div class="co-l-h"><span class="co-l-u">' + ICO[l.urgence] + '</span>'
      +   '<span class="co-l-n">' + E(l.labo || '❓ Laboratoire à identifier') + '</span>'
      +   coBadgeOps(l.labo)
      +   coContact(l.labo)
      +   '<button type="button" class="co-fiche" onclick="coFiche(' + coIndex(l.labo) + ')"'
      +     ' title="Fiche du laboratoire">✎</button>'
      +   '<span class="co-l-c">' + l.produits.length + '</span></div>'
      + l.produits.map(coProduit).join('')
      + '</div>';
  }

  function coProduit(p) {
    const d = [];
    if (p.moy != null) d.push(p.moy.toFixed(2).replace('.', ',') + '/mois');
    if (p.d && p.d.aCder) d.push('ASCA suggère ' + E(p.d.aCder));
    if (p.stock != null && p.stock < 0) d.push('stock ' + p.stock);
    if (p.urgence === 'relance') {
      d.push('livraison prévue ' + E((p.d && p.d.dtLiv) || '?')
           + (p.retard > 0 ? ' · <b>' + p.retard + ' j de retard</b>' : ''));
    }
    const st = p.statut === 'commandee' ? ' cmd' : p.statut === 'ignoree' ? ' ign' : '';
    return '<div class="co-p' + st + '" data-code="' + E(p.code) + '">'
      + '<div class="co-p-c"><div class="co-p-n">' + E(p.nom) + '</div>'
      +   '<div class="co-p-d">' + ICO[p.urgence] + ' ' + d.join(' · ')
      +   (p.statut === 'commandee' ? ' · <b>commandé par ' + E(coPrenom(p.statutPar)) + '</b>' : '')
      +   (p.statut === 'ignoree' ? ' · ignoré' : '') + '</div></div>'
      + '<div class="co-p-a">'
      +   '<button type="button" class="co-b' + (p.statut === 'commandee' ? ' on' : '') + '"'
      +     ' onclick="coMarquer(\'' + E(p.code) + '\',\'commandee\')"'
      +     ' title="Commande passée">✓</button>'
      +   '<button type="button" class="co-b' + (p.statut === 'ignoree' ? ' on' : '') + '"'
      +     ' onclick="coMarquer(\'' + E(p.code) + '\',\'ignoree\')" title="Ignorer">–</button>'
      + '</div></div>';
  }

  function coEquipe() {
    return (typeof window._collRef === 'function' ? window._collRef('staffDB') : null) || [];
  }
  function coPrenom(id) {
    const s = coEquipe().find(function (x) { return x && x.id === id; });
    return s ? (s.prenom || s.id) : (id || '');
  }

  // ── QUI APPELLE CE LABORATOIRE ────────────────────────────────────────────
  //
  // Un laboratoire sans opérateur n'est pas orphelin : il revient aux
  // administrateurs — décision d'Olivier. Mais la carte le dit en orange
  // plutôt que de le taire, pour qu'on finisse par vider cette liste.
  function coOps(labo) {
    const f = (coEtat && coEtat.fiches) ? coEtat.fiches[labo] : null;
    return (f && Array.isArray(f.operateurs)) ? f.operateurs : [];
  }
  function coAMoi(labo) {
    const u = coUser(); if (!u) return false;
    const o = coOps(labo);
    return o.length ? o.indexOf(u.id) >= 0 : coAdmin();
  }
  function coBadgeOps(labo) {
    const o = coOps(labo);
    if (!o.length) return '<span class="co-op0" title="Personne n’est désigné : '
      + 'c’est aux administrateurs">à attribuer</span>';
    return '<span class="co-opn">' + o.map(function (x) { return E(coPrenom(x)); }).join(' · ')
      + '</span>';
  }

  // ── Les laboratoires : rapprocher, et savoir qui appeler ──────────────────
  //
  // ON NE FUSIONNE JAMAIS TOUT SEUL. Le module propose, quelqu'un tranche, et
  // la réponse — fusion comme refus — est retenue pour toujours. Un
  // rapprochement automatique ferait appeler le mauvais service tous les jours,
  // sans que rien ne le dise.
  function coIndex(labo) {
    const i = (coEtat && coEtat.labos ? coEtat.labos : []).findIndex(function (g) { return g.labo === labo; });
    return i;
  }

  // Le numéro est cliquable : au comptoir, on ouvre la page et on appelle. Un
  // numéro qu'il faut recopier à la main n'est pas un numéro.
  function coContact(labo) {
    const f = (coEtat && coEtat.fiches) ? coEtat.fiches[labo] : null;
    if (!f || (!f.tel && !f.contact)) return '';
    const t = f.tel ? '<a class="co-tel" href="tel:' + E(String(f.tel).replace(/[^0-9+]/g, ''))
                    + '" onclick="event.stopPropagation()">' + E(f.tel) + '</a>' : '';
    return '<span class="co-ct">' + (f.contact ? E(f.contact) + (t ? ' · ' : '') : '') + t + '</span>';
  }

  function coRendreRapprochements() {
    const z = document.getElementById('co-rappr'); if (!z) return;
    const p = (coEtat && coEtat.propositions) || [];
    if (!p.length) { z.innerHTML = ''; return; }
    z.innerHTML = '<div class="co-rappr-t">Ces noms d\u2019ASCA d\u00e9signent-ils le m\u00eame laboratoire&nbsp;?</div>'
      + p.map(function (x, i) {
          return '<div class="co-rp"><div class="co-rp-n"><b>' + E(x.garde) + '</b>'
            + '<span>et</span><b>' + E(x.absorbe) + '</b></div>'
            + '<div class="co-rp-a">'
            + '<button type="button" class="btn bp sm" onclick="coFusionner(' + i + ')">'
            +   'Oui, un seul</button>'
            + '<button type="button" class="btn bs sm" onclick="coDistincts(' + i + ')">'
            +   'Non, deux</button></div></div>';
        }).join('')
      + '<div class="co-rappr-p">Une fois tranch\u00e9, la question ne reviendra plus \u2014 '
      + 'dans un sens comme dans l\u2019autre.</div>';
  }

  window.coFusionner = async function (i) {
    const x = (coEtat.propositions || [])[i]; if (!x) return;
    await coEnvoyer('/api/commandes/labo-fusion', { garde: x.garde, absorbe: x.absorbe },
      '« ' + x.absorbe + ' » rejoint « ' + x.garde + ' ».');
  };
  window.coDistincts = async function (i) {
    const x = (coEtat.propositions || [])[i]; if (!x) return;
    await coEnvoyer('/api/commandes/labo-distincts', { a: x.garde, b: x.absorbe },
      'Ce sont bien deux laboratoires. On ne le redemandera plus.');
  };

  async function coPost(url, charge) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                 body: JSON.stringify(charge) });
    const j = await r.json();
    if (!j || !j.ok) throw new Error((j && j.error) || 'refusé');
    return j;
  }

  async function coEnvoyer(url, charge, mot) {
    try {
      await coPost(url, charge);
      await coCharger(); window.coRender();
      coMsg(mot, false);
      return true;
    } catch (e) { coMsg('Enregistrement impossible : ' + e.message, true); return false; }
  }

  // ── La fiche : de quoi appeler ────────────────────────────────────────────
  window.coFiche = function (i) {
    const g = (coEtat.labos || [])[i]; if (!g || !g.labo) return;
    const f = (coEtat.fiches && coEtat.fiches[g.labo]) || {};
    let ov = document.getElementById('co-ov');
    if (!ov) { ov = document.createElement('div'); ov.id = 'co-ov'; document.body.appendChild(ov); }
    ov.className = 'co-ov on';
    ov.innerHTML = '<div class="co-ov-b" role="dialog" aria-label="Fiche du laboratoire">'
      + '<div class="co-ov-h"><b>' + E(g.labo) + '</b>'
      +   '<button type="button" class="co-ov-x" onclick="coFicheFermer()" aria-label="Fermer">×</button></div>'
      + '<label>Interlocuteur</label><input type="text" id="co-f-contact" maxlength="300" value="'
      +   E(f.contact || '') + '" placeholder="Nom de la personne à demander">'
      + '<label>Téléphone</label><input type="tel" id="co-f-tel" maxlength="300" value="'
      +   E(f.tel || '') + '" placeholder="02 31 …">'
      + '<label>Courriel</label><input type="email" id="co-f-mail" maxlength="300" value="'
      +   E(f.mail || '') + '" placeholder="commandes@…">'
      + '<label>Notes</label><textarea id="co-f-notes" maxlength="300" rows="3"'
      +   ' placeholder="Jours de commande, franco, particularités…">' + E(f.notes || '') + '</textarea>'
      + coFicheOps(f)
      + '<div class="co-ov-a"><button class="btn bs" onclick="coFicheFermer()">Annuler</button>'
      +   '<button class="btn bp" onclick="coFicheEnregistrer(' + i + ')">Enregistrer</button></div>'
      + '</div>';
    ov.onmousedown = function (ev) { if (ev.target === ov) coFicheFermer(); };
    document.addEventListener('keydown', coFicheEchap, true);
    const c = document.getElementById('co-f-contact'); if (c) c.focus();
  };
  // QUI APPELLE : des cases à cocher pour les administrateurs, une phrase pour
  // les autres. On ne grise pas des cases qu'on ne peut pas cocher — une case
  // inerte invite à cliquer et n'explique rien.
  function coFicheOps(f) {
    const o = Array.isArray(f.operateurs) ? f.operateurs : [];
    if (!coAdmin()) {
      return '<label>Qui appelle</label><div class="co-op-lu">'
        + (o.length ? o.map(function (x) { return E(coPrenom(x)); }).join(' · ')
                    : 'Personne n’est désigné : c’est aux administrateurs.')
        + '</div>';
    }
    const eq = coEquipe().filter(function (x) { return x && x.id; });
    return '<label>Qui appelle ce laboratoire</label><div id="co-f-ops" class="co-ops">'
      + (eq.length ? eq.map(function (x) {
            return '<label class="co-op"><input type="checkbox" data-uid="' + E(x.id) + '"'
              + (o.indexOf(x.id) >= 0 ? ' checked' : '') + '> '
              + E(x.prenom || x.id) + '</label>';
          }).join('')
        : '<div class="co-op-lu">L’équipe n’est pas encore chargée.</div>')
      + '</div><div class="co-ops-p">Si personne n’est coché, le laboratoire reste '
      + 'aux administrateurs et la carte affiche « à attribuer ».</div>';
  }

  function coFicheEchap(ev) { if (ev.key === 'Escape') { ev.stopPropagation(); coFicheFermer(); } }
  window.coFicheFermer = function () {
    const ov = document.getElementById('co-ov');
    if (ov) { ov.className = 'co-ov'; ov.innerHTML = ''; }
    document.removeEventListener('keydown', coFicheEchap, true);
  };
  window.coFicheEnregistrer = async function (i) {
    const g = (coEtat.labos || [])[i]; if (!g) return;
    const v = function (id) { const e = document.getElementById(id); return e ? e.value : ''; };
    try {
      await coPost('/api/commandes/labo-fiche', {
        nom: g.labo, contact: v('co-f-contact'), tel: v('co-f-tel'),
        mail: v('co-f-mail'), notes: v('co-f-notes')
      });
      // Les cases ne portent pas de texte saisi, seulement des identifiants de
      // collaborateur : c'est la règle de la maison, un gestionnaire ne reçoit
      // jamais ce que quelqu'un a tapé.
      const z = document.getElementById('co-f-ops');
      if (coAdmin() && z) {
        const ops = [...z.querySelectorAll('input[type=checkbox]')]
          .filter(function (c) { return c.checked; })
          .map(function (c) { return c.getAttribute('data-uid'); });
        await coPost('/api/commandes/labo-operateurs', { nom: g.labo, operateurs: ops });
      }
      await coCharger(); window.coRender();
      coMsg('Fiche de « ' + g.labo + ' » enregistrée.', false);
      coFicheFermer();
    } catch (e) { coMsg('Enregistrement impossible : ' + e.message, true); }
  };

  // ── Le rendu ──────────────────────────────────────────────────────────────
  window.coRender = function () {
    const z = document.getElementById('co-liste');
    if (!z) return;
    document.getElementById('co-entete').innerHTML = coEntete();
    if (!coEtat) {
      z.innerHTML = '<div class="co-vide">Aucune synthèse importée.<br>'
        + 'Déposez les PDF du courriel ASCA ci-dessus — la date est dans les fichiers, '
        + 'il n’y a rien à saisir.</div>';
      return;
    }
    coRendreRapprochements();
    const q = coFiltre.trim().toLowerCase();
    const l = coEtat.labos.filter(function (g) {
      if (coUrgence && g.urgence !== coUrgence) return false;
      if (!q) return true;
      return String(g.labo || '').toLowerCase().indexOf(q) >= 0
          || g.produits.some(function (p) { return String(p.nom || '').toLowerCase().indexOf(q) >= 0; });
    });
    if (!l.length) {
      z.innerHTML = '<div class="co-vide">Rien ne correspond à cette recherche.</div>';
      return;
    }
    // CHERCHER, C'EST VOULOIR TOUT VOIR. Une recherche ou un filtre d'urgence
    // donne une liste à plat : on cherche un laboratoire précis, pas sa tournée.
    if (coFiltre.trim() || coUrgence || !coUser()) { z.innerHTML = l.map(coCarte).join(''); return; }
    z.innerHTML = coGroupes(l);
  };

  // ── MA TOURNÉE D'ABORD, LE RESTE DERRIÈRE ─────────────────────────────────
  //
  // On arrive sur ses propres laboratoires : c'est ce qu'on va appeler dans
  // l'heure. MAIS RIEN D'URGENT NE SE CACHE DERRIÈRE UN REPLI. Si un
  // laboratoire pressé appartient à quelqu'un d'autre — en congé, en formation,
  // au comptoir — une ligne le dit au-dessus du repli. C'est le prix de cette
  // vue, et il se paie ici.
  function coGroupes(l) {
    const miens = l.filter(function (g) { return coAMoi(g.labo); });
    const autres = l.filter(function (g) { return !coAMoi(g.labo); });
    const presse = autres.filter(function (g) { return g.urgence === 'rouge' || g.urgence === 'relance'; });
    const ouvert = (coAutres === null) ? (miens.length === 0) : coAutres;

    let h = '<div class="co-grp">Mes laboratoires <b>' + miens.length + '</b></div>';
    h += miens.length ? miens.map(coCarte).join('')
       : '<div class="co-vide">Aucun laboratoire ne vous est attribué pour l’instant.</div>';
    if (!autres.length) return h;

    if (presse.length && !ouvert) {
      h += '<div class="co-ailleurs">' + ICO.rouge + ' <b>' + presse.length
         + '</b> laboratoire(s) pressé(s) ne sont pas à vous : '
         + presse.slice(0, 4).map(function (g) { return E(g.labo); }).join(', ')
         + (presse.length > 4 ? '…' : '')
         + ' <button type="button" class="co-voir" onclick="coVoirAutres()">Voir</button></div>';
    }
    h += '<button type="button" class="co-grp co-repli" onclick="coVoirAutres()">'
       + (ouvert ? '▾' : '▸') + ' Les autres laboratoires <b>' + autres.length + '</b>'
       + (presse.length ? '<span class="co-grp-u">dont ' + presse.length + ' pressé(s)</span>' : '')
       + '</button>';
    if (ouvert) h += autres.map(coCarte).join('');
    return h;
  }

  window.coVoirAutres = function () {
    const l = coEtat ? coEtat.labos.filter(function (g) { return coAMoi(g.labo); }) : [];
    coAutres = (coAutres === null) ? (l.length !== 0) : !coAutres;
    window.coRender();
  };

  window.coFiltrerUrgence = function (u) { coUrgence = (coUrgence === u) ? '' : u; window.coRender(); };
  window.coChercher = function () {
    const i = document.getElementById('co-q');
    coFiltre = i ? i.value : '';
    window.coRender();
  };

  // ── Marquer ───────────────────────────────────────────────────────────────
  // Recliquer sur un marquage le retire : c'est la seule façon de revenir sur
  // une erreur, et elle doit être aussi simple que le geste lui-même.
  window.coMarquer = async function (code, statut) {
    if (!coUser()) return;
    let p = null;
    coEtat.labos.forEach(function (l) {
      l.produits.forEach(function (x) { if (x.code === code) p = x; });
    });
    if (!p) return;
    const neuf = (p.statut === statut) ? 'a_faire' : statut;
    try {
      const r = await fetch('/api/commandes/statut', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code, statut: neuf, syntheseId: coEtat.id })
      });
      const j = await r.json();
      if (!j.ok) { coMsg(j.error || 'refusé', true); return; }
      p.statut = neuf === 'a_faire' ? null : neuf;
      p.statutPar = neuf === 'a_faire' ? null : (coUser() || {}).id;
      window.coRender();
    } catch (e) { coMsg('Enregistrement impossible : ' + e.message, true); }
  };

  function coMsg(t, err) {
    const z = document.getElementById('co-msg');
    if (!z) return;
    z.textContent = t; z.className = 'co-msg' + (err ? ' ko' : ' ok');
    setTimeout(function () { if (z.textContent === t) { z.textContent = ''; z.className = 'co-msg'; } }, 6000);
  }

  // ── L'import ──────────────────────────────────────────────────────────────
  //
  // LES PDF PARTENT EN BASE64 DANS LE CORPS JSON. Pas de traitement multipart,
  // donc pas de dépendance de plus : ces fichiers pèsent cinquante kilooctets.
  // On envoie les huit pièces jointes sans trier — le serveur reconnaît les
  // trois qu'il sait lire par leur nom, et ignore les autres.
  window.coImporter = async function (input) {
    const f = [...(input.files || [])];
    if (!f.length) return;
    coMsg('Lecture de ' + f.length + ' fichier(s)…', false);
    try {
      const fichiers = await Promise.all(f.map(function (x) {
        return new Promise(function (ok, ko) {
          const r = new FileReader();
          r.onload = function () { ok({ nom: x.name, b64: String(r.result).split(',')[1] }); };
          r.onerror = function () { ko(new Error('illisible : ' + x.name)); };
          r.readAsDataURL(x);
        });
      }));
      const r = await fetch('/api/commandes/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fichiers: fichiers })
      });
      const j = await r.json();
      if (!j.ok) { coMsg(j.error || 'import refusé', true); return; }
      await coCharger(); window.coRender();
      coMsg('Synthèse du ' + new Date(j.resultat.date).toLocaleDateString('fr-FR')
          + ' importée — ' + j.resultat.lignes + ' lignes.', false);
    } catch (e) { coMsg('Import impossible : ' + e.message, true); }
    finally { input.value = ''; }
  };

  // ── L'export : ce qu'on emporte au téléphone ──────────────────────────────
  window.coCopier = function () {
    if (!coEtat) return;
    const t = coEtat.labos.filter(function (l) { return l.urgence !== 'gris'; }).map(function (l) {
      return ICO[l.urgence] + ' ' + (l.labo || 'à identifier') + ' — '
           + l.produits.filter(function (p) { return p.urgence !== 'gris'; })
               .map(function (p) { return p.nom; }).join(', ');
    }).join('\n');
    try { navigator.clipboard.writeText(t); coMsg('Liste copiée.', false); }
    catch (e) { coMsg('Copie impossible sur ce poste.', true); }
  };

  // ON N'IMPRIME PAS UNE LISTE TRONQUÉE. Le repli est une commodité d'écran ;
  // sur papier, les laboratoires des autres doivent y être, sinon la feuille
  // qu'on emporte au téléphone mentirait par omission.
  window.addEventListener('beforeprint', function () {
    if (coAutres !== true) { coAutres = true; window.coRender(); }
  });

  window.coRafraichir = async function () {
    try { await coCharger(); window.coRender(); }
    catch (e) {
      const z = document.getElementById('co-liste');
      if (z) z.innerHTML = '<div class="co-vide">Liste indisponible : ' + E(e.message) + '</div>';
    }
  };

  const CO_SECTION =
    '<div class="card">'
  +   '<div class="ch"><span class="ct"><svg class="ico"><use href="#ic-commandes"></use></svg> '
  +     'Commandes à passer</span>'
  +     '<div style="display:flex;gap:7px;flex-wrap:wrap">'
  +       '<label class="btn bs sm no-print" style="cursor:pointer;margin:0">'
  +         'Importer les PDF ASCA'
  +         '<input type="file" accept="application/pdf,.pdf" multiple hidden onchange="coImporter(this)">'
  +       '</label>'
  +       '<button class="btn bs sm no-print" onclick="coCopier()">Copier la liste</button>'
  +       '<button class="btn bs sm no-print" onclick="window.print()">Imprimer</button>'
  +     '</div></div>'
  +   '<div id="co-msg" class="co-msg"></div>'
  +   '<div id="co-entete"></div>'
  +   '<div id="co-rappr" class="co-rappr"></div>'
  +   '<div class="fbar"><input type="text" id="co-q" class="ctl-search" data-rc="recherche"'
  +     ' placeholder="Rechercher un laboratoire ou un produit…" oninput="coChercher()"'
  +     ' style="flex:1;min-width:200px"></div>'
  +   '<div id="co-liste"></div>'
  + '</div>';

  const CO_CSS = `
  .co-tete{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;
    flex-wrap:wrap;margin-bottom:12px}
  /* « capitalize » mettrait une majuscule a CHAQUE mot : « Du Lundi 28
     Septembre ». Seule la premiere lettre doit changer. */
  .co-t-d{font-size:1.02rem;font-weight:700;color:var(--g-dark,#1D5C3A)}
  .co-t-d::first-letter{text-transform:uppercase}
  .co-t-s{font-size:.82rem;color:var(--gray-500,#6b7280);margin-top:2px}
  .co-puces{display:flex;gap:7px;flex-wrap:wrap}
  .co-puce{border:1px solid var(--gray-200,#e5e7eb);background:#fff;border-radius:999px;
    padding:6px 13px;font:inherit;font-size:.82rem;cursor:pointer;display:flex;align-items:center;gap:5px}
  .co-puce b{font-size:.95rem}
  .co-puce span{color:var(--gray-500,#6b7280)}
  .co-puce:hover{border-color:#cdd8d1}
  .co-puce.on{background:var(--g-pale,#E8F5E9);border-color:var(--g-mid,#2E7D54);font-weight:700}
  .co-alerte{background:#FFF3E0;border:1px solid #E65100;border-left-width:5px;border-radius:9px;
    padding:10px 13px;font-size:.86rem;color:#7c3a00;margin-bottom:10px;line-height:1.5}
  .co-avert{font-size:.8rem;color:var(--gray-500,#6b7280);margin-bottom:10px}
  .co-msg{font-size:.85rem;min-height:0;margin-bottom:6px}
  .co-msg.ok{color:var(--g-dark,#1D5C3A)}
  .co-msg.ko{color:#C62828;font-weight:600}
  .co-vide{padding:26px 8px;text-align:center;color:var(--gray-500,#6b7280);font-size:.88rem;line-height:1.6}
  .co-l{border:1px solid #e7ece9;border-radius:12px;margin-bottom:10px;overflow:hidden}
  .co-l-rouge{border-left:5px solid #C62828}
  .co-l-orange{border-left:5px solid #E65100}
  .co-l-gris{border-left:5px solid #cdd8d1}
  .co-l-relance{border-left:5px solid #6A1B9A}
  .co-l.fait{opacity:.55}
  .co-l-h{display:flex;align-items:center;gap:9px;padding:10px 13px;background:#fafbfa;
    border-bottom:1px solid #eef2f0}
  .co-l-n{font-weight:700;font-size:.95rem;flex:1;min-width:0}
  /* Le bloc de rapprochement se pose en haut, et il disparait des qu'il n'y a
     plus rien a trancher : une question posee une fois ne doit pas devenir un
     meuble. */
  .co-rappr:not(:empty){background:#FFF8E1;border:1px solid #E6C34A;border-radius:11px;
    padding:13px 15px;margin-bottom:12px}
  .co-rappr-t{font-size:.88rem;font-weight:700;color:#6b4e00;margin-bottom:10px}
  .co-rp{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:7px 0;
    border-top:1px solid #f0e2b4}
  .co-rp:first-of-type{border-top:none}
  .co-rp-n{flex:1;min-width:200px;font-size:.86rem;display:flex;gap:7px;flex-wrap:wrap;align-items:baseline}
  .co-rp-n span{color:#8a7a4a;font-style:italic}
  .co-rp-a{display:flex;gap:6px;flex:none}
  .co-rappr-p{margin-top:10px;font-size:.76rem;color:#8a7a4a}
  /* Qui appelle. « a attribuer » est orange : c'est un manque a combler, pas un
     etat de repos. */
  .co-op0{font-size:.7rem;font-weight:700;color:#7c3a00;background:#FFF3E0;
    border:1px solid #E6B07A;border-radius:999px;padding:1px 8px;flex:none}
  .co-opn{font-size:.72rem;color:var(--g-dark,#1D5C3A);background:var(--g-pale,#E8F5E9);
    border:1px solid #cfe6d6;border-radius:999px;padding:1px 8px;flex:none}
  .co-grp{display:flex;align-items:center;gap:8px;width:100%;margin:16px 0 8px;
    font-size:.78rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;
    color:var(--gray-500,#6b7280);background:none;border:none;padding:0;font-family:inherit}
  .co-grp:first-child{margin-top:4px}
  .co-grp b{font-size:.9rem;color:var(--g-dark,#1D5C3A);letter-spacing:0}
  .co-repli{cursor:pointer;text-align:left}
  .co-repli:hover b{text-decoration:underline}
  .co-grp-u{text-transform:none;letter-spacing:0;font-weight:600;color:#C62828}
  /* RIEN D'URGENT NE SE CACHE DERRIERE UN REPLI : cette ligne est la rancon de
     la vue « mes laboratoires d'abord ». */
  .co-ailleurs{background:#FFEBEE;border:1px solid #C62828;border-left-width:5px;
    border-radius:9px;padding:9px 13px;font-size:.84rem;color:#7f1d1d;line-height:1.5;
    margin:4px 0 2px}
  .co-voir{background:#C62828;color:#fff;border:none;border-radius:7px;padding:3px 10px;
    font:inherit;font-size:.8rem;font-weight:600;cursor:pointer;margin-left:4px}
  .co-ops{display:flex;flex-wrap:wrap;gap:6px}
  .co-op{display:flex;align-items:center;gap:5px;font-size:.84rem;border:1px solid var(--gray-200,#e5e7eb);
    border-radius:999px;padding:5px 11px;cursor:pointer;background:#fff;text-transform:none;
    letter-spacing:0;font-weight:400;color:inherit;margin:0}
  .co-op:has(input:checked){background:var(--g-pale,#E8F5E9);border-color:var(--g-mid,#2E7D54);font-weight:700}
  .co-op input{margin:0;accent-color:var(--g-mid,#2E7D54)}
  .co-op-lu{font-size:.86rem;color:var(--gray-500,#6b7280)}
  .co-ops-p{font-size:.74rem;color:var(--gray-500,#6b7280);margin-top:7px;line-height:1.5}
  /* L'interlocuteur et son numero vivent dans l'en-tete de la carte : c'est la
     qu'on regarde au moment de decrocher. */
  .co-ct{font-size:.76rem;color:var(--gray-500,#6b7280);flex:none}
  .co-tel{color:var(--g-dark,#1D5C3A);font-weight:600;text-decoration:none}
  .co-tel:hover{text-decoration:underline}
  .co-fiche{flex:none;border:none;background:none;color:#ccd6d0;cursor:pointer;
    font-size:.86rem;padding:3px 5px;border-radius:6px;line-height:1}
  .co-fiche:hover{color:var(--g-dark,#1D5C3A);background:var(--g-pale,#E8F5E9)}
  .co-fiche:focus-visible{outline:2px solid var(--g-mid,#2E7D54);outline-offset:1px}
  .co-ov{display:none;position:fixed;inset:0;background:rgba(17,24,20,.5);z-index:1000;
    align-items:center;justify-content:center;padding:18px}
  .co-ov.on{display:flex}
  .co-ov-b{background:#fff;border-radius:14px;padding:20px 22px;width:min(440px,94vw);
    max-height:88vh;overflow:auto;box-shadow:0 20px 50px rgba(0,0,0,.3)}
  .co-ov-h{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}
  .co-ov-h b{font-size:1rem}
  .co-ov-x{background:none;border:none;font-size:1.5rem;line-height:1;cursor:pointer;
    color:var(--gray-500,#6b7280);padding:0 4px}
  .co-ov-b label{display:block;font-size:.74rem;font-weight:700;letter-spacing:.04em;
    text-transform:uppercase;color:var(--gray-500,#6b7280);margin:12px 0 4px}
  .co-ov-b input,.co-ov-b textarea{width:100%;padding:10px 12px;border:1px solid var(--gray-200,#e5e7eb);
    border-radius:9px;font:inherit;font-size:.9rem;box-sizing:border-box}
  .co-ov-b input:focus,.co-ov-b textarea:focus{outline:none;border-color:var(--g-mid,#2E7D54);
    box-shadow:0 0 0 3px var(--g-pale,#E8F5E9)}
  .co-ov-a{display:flex;gap:8px;justify-content:flex-end;margin-top:18px}
  @media print{.co-rappr,.co-fiche,.co-ov{display:none}}
  .co-l-c{font-size:.75rem;color:var(--gray-500,#6b7280);background:#fff;border:1px solid #e7ece9;
    border-radius:999px;padding:1px 8px}
  .co-p{display:flex;align-items:center;gap:10px;padding:9px 13px;border-bottom:1px solid #f2f5f3}
  .co-p:last-child{border-bottom:none}
  .co-p-c{flex:1;min-width:0}
  .co-p-n{font-size:.89rem;font-weight:600}
  .co-p-d{font-size:.76rem;color:var(--gray-500,#6b7280);margin-top:2px}
  .co-p.cmd .co-p-n{text-decoration:line-through;color:var(--gray-500,#6b7280)}
  .co-p.ign{opacity:.5}
  .co-p-a{flex:none;display:flex;gap:5px}
  .co-b{width:30px;height:30px;border:1px solid #d8e2dc;background:#fff;border-radius:8px;
    cursor:pointer;font:inherit;font-size:.9rem;font-weight:700;color:#9bb0a4;line-height:1}
  .co-b:hover{border-color:var(--g-mid,#2E7D54);color:var(--g-dark,#1D5C3A)}
  .co-b.on{background:var(--g-mid,#2E7D54);border-color:var(--g-mid,#2E7D54);color:#fff}
  .co-b:focus-visible{outline:2px solid var(--g-mid,#2E7D54);outline-offset:1px}
  @media print{.co-puces,.co-p-a,.fbar,.co-msg,.co-voir{display:none}.co-l{break-inside:avoid}}
  `;

  function coInject() {
    if (document.getElementById('co-css')) return;
    const st = document.createElement('style');
    st.id = 'co-css'; st.textContent = CO_CSS;
    document.head.appendChild(st);

    // LA BARRE EST RECLASSÉE PAR ORDRE ALPHABÉTIQUE après l'injection : le point
    // d'insertion ne décide de rien, « Commandes » se rangera entre « Caisse »
    // et « Contrôle lits ». On s'accroche tout de même à Livraisons plutôt qu'à
    // la fin de la liste, pour que l'entrée existe même si le reclassement ne
    // passait pas — une entrée mal placée se trouve, une entrée absente, non.
    const ref = document.querySelector('.sb-item[data-sec="livraisons"]');
    if (ref && !document.querySelector('.sb-item[data-sec="commandes"]')) {
      const b = document.createElement('button');
      b.className = 'sb-item';
      b.setAttribute('data-sec', 'commandes');
      b.setAttribute('onclick', "showSec('commandes',this)");
      b.innerHTML = '<svg class="ico sb-ico"><use href="#ic-commandes"></use></svg>'
        + '<span class="sb-label">Commandes</span>';
      ref.insertAdjacentElement('afterend', b);
    }

    const secRef = document.getElementById('sec-livraisons');
    if (secRef && !document.getElementById('sec-commandes')) {
      const sec = document.createElement('section');
      sec.id = 'sec-commandes'; sec.className = 'sec';
      sec.innerHTML = CO_SECTION;
      secRef.parentNode.appendChild(sec);
      window.coRafraichir();
      if (typeof window.rcInfobulles === 'function') window.rcInfobulles();
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', coInject);
  else coInject();
}());
