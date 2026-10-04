/* ═══════════════════════════════════════════════════════════════════════════
   SUIVI RH — la fiche de chaque collaborateur

   TROIS CHOSES QUE CET ÉCRAN DOIT FAIRE, dans cet ordre :

   1. RAPPELER CE QU'ON ÉCRIT. Sous chaque champ de saisie, le prénom de la
      personne et une phrase : si elle demandait son dossier demain, cette
      ligne lui serait remise. Ce n'est pas une précaution juridique, c'est ce
      qui transforme « souvent en retard » en « arrivée 9 h 20 le 12/09 ».

   2. MONTRER L'ÉQUILIBRE. On consigne les écarts, jamais la normale : sans
      compteur, une fiche ne contient que du négatif au bout d'un an.

   3. MONTRER LE SILENCE. Celui dont on n'a rien écrit depuis trois mois est
      celui qui n'aura rien à entendre à son entretien. C'est l'alerte la plus
      utile de la page.

   AUCUNE DONNÉE RH NE PASSE PAR LE BLOB. Tout vient de /api/rh/*, que le
   serveur refuse à qui n'est pas titulaire. Le menu cache l'onglet aux autres,
   mais c'est le serveur qui décide — un menu caché n'a jamais rien protégé.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const TON = {
    positif:  { ico: '▲', lbl: 'Positif',    cls: 'pos' },
    neutre:   { ico: '●', lbl: 'Neutre',     cls: 'neu' },
    corriger: { ico: '▼', lbl: 'À corriger', cls: 'cor' }
  };
  const TAGS = {
    fiabilite: 'Fiabilité', relation: 'Relation client', initiative: 'Initiative',
    qualite: 'Qualité', securite: 'Sécurité', equipe: 'Équipe', formation: 'Formation'
  };
  const TYPE = { point: 'Point individuel', parcours: 'Entretien de parcours', bilan: 'Bilan à 8 ans' };

  let rhEquipe = null, rhFiche = null, rhUid = null, rhEdite = null;

  function E(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  const pad = n => String(n).padStart(2, '0');
  function rhIso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function rhFr(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return m ? m[3] + '/' + m[2] + '/' + m[1] : '—';
  }
  function rhStaff() {
    return (typeof staffDB !== 'undefined' && Array.isArray(staffDB)) ? staffDB : [];
  }
  function rhNom(uid) {
    const s = rhStaff().find(x => x && x.id === uid);
    if (!s) return uid || '—';
    return ((s.prenom || '') + ' ' + (s.nom || '')).trim() || s.id;
  }
  // ON NE TIENT PAS DE FICHE SUR SOI-MEME. Sa propre carte, au milieu de celles
  // de l'equipe, n'apporte rien et donne a l'ecran un air de miroir.
  function rhMoi() {
    return (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : null;
  }
  function rhPrenom(uid) {
    const s = rhStaff().find(x => x && x.id === uid);
    return s ? (s.prenom || s.id) : (uid || '');
  }
  function rhMsg(t, err) {
    const z = document.getElementById('rh-msg'); if (!z) return;
    z.textContent = t; z.className = 'rh-msg' + (err ? ' ko' : ' ok');
    setTimeout(function () { if (z.textContent === t) { z.textContent = ''; z.className = 'rh-msg'; } }, 6000);
  }

  async function rhGet(url) {
    const r = await fetch(url, { cache: 'no-store' });
    const j = await r.json();
    if (!j || !j.ok) throw new Error((j && j.error) || 'lecture refusée');
    return j;
  }
  async function rhPost(url, charge) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                 body: JSON.stringify(charge) });
    const j = await r.json();
    if (!j || !j.ok) throw new Error((j && j.error) || 'refusé');
    return j;
  }

  // ── L'ÉCRAN D'ÉQUIPE ──────────────────────────────────────────────────────
  // Une carte par personne. ON LISTE TOUTE L'ÉQUIPE, pas seulement ceux qui ont
  // déjà une fiche : une carte vide est précisément l'information qui manque.
  window.rhRendreEquipe = async function () {
    const z = document.getElementById('rh-host'); if (!z) return;
    try { rhEquipe = await rhGet('/api/rh/equipe'); }
    catch (e) {
      z.innerHTML = '<div class="rh-vide">Suivi RH indisponible : ' + E(e.message) + '</div>';
      return;
    }
    const par = {};
    (rhEquipe.fiches || []).forEach(function (f) { par[f.uid] = f; });
    const moi = rhMoi();
    const gens = rhStaff().filter(function (x) { return x && x.id && x.id !== moi; })
      .sort(function (a, b) {
        return String(a.prenom || '').localeCompare(String(b.prenom || ''));
      });
    if (!gens.length) {
      z.innerHTML = '<div class="rh-vide">L’équipe n’est pas encore chargée.</div>';
      return;
    }
    z.innerHTML = '<div class="rh-tete"><h2>Suivi de l’équipe</h2>'
      + '<p>Un fait daté vaut mieux qu’un souvenir. Ce qui est écrit ici peut être demandé '
      + 'par la personne concernée : on écrit des faits, jamais des jugements.</p></div>'
      + '<div id="rh-msg" class="rh-msg"></div>'
      + '<div class="rh-grille">'
      + gens.map(function (s) { return rhCarte(s, par[s.id]); }).join('')
      + '</div>';
  };

  function rhCarte(s, f) {
    const eq = (f && f.equilibre) || { positif: 0, neutre: 0, corriger: 0, total: 0 };
    const si = (f && f.silence) || { muet: true, jours: null, dernier: null };
    const ech = (f && f.echeances) || [];
    const hab = (f && f.habilitations) || [];
    const due = ech.filter(function (e) { return !e.inconnu && e.dans != null && e.dans <= 60; });
    const alertes = [];
    if (si.muet) {
      alertes.push('<span class="rh-al rh-al-muet">'
        + (si.dernier ? 'rien depuis ' + si.jours + ' jours' : 'aucun fait consigné') + '</span>');
    }
    due.forEach(function (e) {
      alertes.push('<span class="rh-al rh-al-ech">'
        + (e.type === 'parcours' ? 'entretien de parcours' : 'bilan à 8 ans')
        + (e.dans < 0 ? ' en retard' : ' dans ' + e.dans + ' j') + '</span>');
    });
    hab.slice(0, 2).forEach(function (h) {
      alertes.push('<span class="rh-al rh-al-hab">' + E(h.libelle)
        + (h.perimee ? ' périmée' : ' dans ' + h.dans + ' j') + '</span>');
    });
    if (eq.total >= 5 && eq.positif === 0) {
      alertes.push('<span class="rh-al rh-al-desq">que du négatif</span>');
    }
    const pastille = function (k) {
      return '<span class="rh-c rh-c-' + TON[k].cls + '" title="' + TON[k].lbl + '">'
        + TON[k].ico + ' ' + eq[k] + '</span>';
    };
    return '<button type="button" class="rh-carte' + (si.muet ? ' muet' : '') + '"'
      + ' onclick="rhOuvrir(\'' + E(s.id) + '\')">'
      + '<span class="rh-ca-n">' + E(((s.prenom || '') + ' ' + (s.nom || '')).trim() || s.id) + '</span>'
      + '<span class="rh-ca-p">' + E(s.poste || '') + '</span>'
      + '<span class="rh-cs">' + pastille('positif') + pastille('neutre') + pastille('corriger') + '</span>'
      + (alertes.length ? '<span class="rh-als">' + alertes.join('') + '</span>' : '')
      + '</button>';
  }

  // ── UNE FICHE ─────────────────────────────────────────────────────────────
  window.rhOuvrir = async function (uid) {
    rhUid = uid; rhEdite = null;
    const z = document.getElementById('rh-host'); if (!z) return;
    z.innerHTML = '<div class="rh-vide">Ouverture de la fiche…</div>';
    try { rhFiche = await rhGet('/api/rh/fiche?uid=' + encodeURIComponent(uid)); }
    catch (e) { z.innerHTML = '<div class="rh-vide">Fiche indisponible : ' + E(e.message) + '</div>'; return; }
    rhRendreFiche();
  };
  window.rhRetour = function () { rhUid = null; rhFiche = null; window.rhRendreEquipe(); };

  function rhRendreFiche() {
    const z = document.getElementById('rh-host'); if (!z || !rhFiche) return;
    const f = rhFiche;
    z.innerHTML = ''
      + '<div class="rh-fh">'
      +   '<button type="button" class="rh-ret" onclick="rhRetour()">← L’équipe</button>'
      +   '<h2>' + E(rhNom(f.uid)) + '</h2>'
      +   '<div class="rh-fh-a">'
      +     '<button type="button" class="rh-b rh-bp" onclick="rhPreparer()">Préparer le point</button>'
      +     '<button type="button" class="rh-b" onclick="rhDossier()">Éditer le dossier complet</button>'
      +   '</div>'
      + '</div>'
      + '<div id="rh-msg" class="rh-msg"></div>'
      + rhBandeau(f.equilibre, f.silence, f)
      + rhSaisie()
      + rhListeFaits(f.faits)
      + rhBlocEntretiens(f)
      + rhBlocHabilitations(f);
    rhMajCompteur();
  }

  function rhBandeau(eq, si, f) {
    let h = '<div class="rh-kpis">'
      + '<div class="rh-k"><b>' + eq.positif + '</b><span>positifs</span></div>'
      + '<div class="rh-k"><b>' + eq.neutre + '</b><span>neutres</span></div>'
      + '<div class="rh-k"><b>' + eq.corriger + '</b><span>à corriger</span></div>'
      + '<div class="rh-k"><b>' + (si.dernier ? rhFr(si.dernier) : '—') + '</b><span>dernier fait</span></div>'
      + '</div>';
    // L'AVERTISSEMENT QUI COMPTE LE PLUS, et qui s'adresse à nous, pas à elle.
    if (si.muet) {
      h += '<div class="rh-note rh-note-muet">'
        + (si.dernier
            ? 'Rien n’a été consigné depuis <b>' + si.jours + ' jours</b>.'
            : '<b>Aucun fait n’est consigné.</b>')
        + ' Le jour de l’entretien, il n’y aura rien à dire — ni dans un sens, ni dans l’autre.</div>';
    }
    if (eq.total >= 5 && eq.positif === 0) {
      h += '<div class="rh-note rh-note-desq">Cette fiche ne contient que du négatif. '
        + 'On consigne les écarts et jamais la normale : c’est un biais de l’outil, pas un portrait.</div>';
    }
    (f.echeances || []).forEach(function (e) {
      if (e.inconnu) {
        h += '<div class="rh-note">Date d’embauche inconnue : les échéances d’entretien ne peuvent pas être '
          + 'calculées. <button type="button" class="rh-lien" onclick="rhEmbauche()">La renseigner</button></div>';
        return;
      }
      if (e.dans != null && e.dans <= 60) {
        h += '<div class="rh-note rh-note-ech">'
          + (e.type === 'parcours' ? 'Entretien de parcours professionnel' : 'Bilan récapitulatif')
          + ' attendu le <b>' + rhFr(e.du) + '</b>'
          + (e.dans < 0 ? ' — <b>en retard de ' + (-e.dans) + ' jours</b>.' : ' — dans ' + e.dans + ' jours.')
          + '</div>';
      }
    });
    return h;
  }

  // ── LA SAISIE ─────────────────────────────────────────────────────────────
  // Un seul champ, et le rappel juste dessous.
  function rhSaisie() {
    const e = rhEdite;
    return '<div class="rh-saisie">'
      + '<div class="rh-s-h">' + (e ? 'Corriger ce fait' : 'Consigner un fait') + '</div>'
      + '<textarea id="rh-texte" rows="3" oninput="rhMajCompteur()" placeholder="'
      +   'Quoi, quand, et quel effet. « Arrivée à 9 h 20 le 12/09 pour un créneau de 9 h, '
      +   'le rideau est resté baissé. »">' + E(e ? e.texte : '') + '</textarea>'
      + '<div class="rh-garde" id="rh-garde"></div>'
      + '<div class="rh-s-l">'
      +   '<div class="rh-tons">'
      +     Object.keys(TON).map(function (k) {
            return '<label class="rh-ton rh-ton-' + TON[k].cls + '">'
              + '<input type="radio" name="rh-ton" value="' + k + '"'
              + ((e ? e.ton : 'neutre') === k ? ' checked' : '') + '> '
              + TON[k].ico + ' ' + TON[k].lbl + '</label>';
          }).join('')
      +   '</div>'
      +   '<input type="date" id="rh-le" value="' + E(e ? e.le : rhIso(new Date())) + '">'
      +   '<select id="rh-tag"><option value="">Sans étiquette</option>'
      +     Object.keys(TAGS).map(function (k) {
            return '<option value="' + k + '"' + (e && e.tag === k ? ' selected' : '') + '>'
              + TAGS[k] + '</option>';
          }).join('')
      +   '</select>'
      +   '<button type="button" class="rh-b rh-bp" onclick="rhEnregistrer()">'
      +     (e ? 'Enregistrer la correction' : 'Consigner') + '</button>'
      +   (e ? '<button type="button" class="rh-b" onclick="rhAnnulerEdition()">Annuler</button>' : '')
      + '</div></div>';
  }

  // LE RAPPEL. Il nomme la personne : « un collaborateur » n'engage personne,
  // « Sophie » engage celui qui écrit.
  window.rhMajCompteur = function () {
    const z = document.getElementById('rh-garde'); if (!z) return;
    const t = String((document.getElementById('rh-texte') || {}).value || '').trim();
    let h = 'Si ' + E(rhPrenom(rhUid)) + ' demandait son dossier demain, cette ligne lui serait remise.';
    if (t.length > 0 && t.length < 25) {
      h += ' <b>C’est très court</b> — un fait tient rarement en trois mots.';
    }
    h += '<br><span class="rh-garde-i">Jamais : santé, arrêt de travail, grossesse, vie privée, '
      + 'convictions, origine, activité syndicale.</span>';
    z.innerHTML = h;
  };

  window.rhAnnulerEdition = function () { rhEdite = null; rhRendreFiche(); };

  window.rhEnregistrer = async function () {
    const t = String((document.getElementById('rh-texte') || {}).value || '').trim();
    if (!t) { rhMsg('Le texte est vide.', true); return; }
    const ton = (document.querySelector('input[name="rh-ton"]:checked') || {}).value || 'neutre';
    const le = String((document.getElementById('rh-le') || {}).value || '');
    const tag = String((document.getElementById('rh-tag') || {}).value || '');
    try {
      if (rhEdite) {
        await rhPost('/api/rh/fait-modifier', { id: rhEdite.id, texte: t, ton: ton, le: le, tag: tag });
        rhEdite = null;
        rhMsg('Fait corrigé.', false);
      } else {
        await rhPost('/api/rh/fait', { uid: rhUid, texte: t, ton: ton, le: le, tag: tag });
        rhMsg('Fait consigné.', false);
      }
      await rhOuvrir(rhUid);
    } catch (e) { rhMsg('Enregistrement impossible : ' + e.message, true); }
  };

  function rhListeFaits(faits) {
    if (!faits || !faits.length) {
      return '<div class="rh-vide">Aucun fait consigné pour l’instant.</div>';
    }
    return '<div class="rh-liste">' + faits.map(function (f, i) {
      return '<div class="rh-f rh-f-' + TON[f.ton].cls + '">'
        + '<div class="rh-f-d">' + rhFr(f.le)
        +   (f.tag ? ' · <span class="rh-tag">' + E(TAGS[f.tag] || f.tag) + '</span>' : '')
        +   ' · <i>' + E(rhPrenom(f.par)) + '</i>'
        +   (f.maj ? ' · <i>corrigé</i>' : '')
        + '</div>'
        + '<div class="rh-f-t">' + E(f.texte) + '</div>'
        + '<div class="rh-f-a">'
        +   '<button type="button" onclick="rhCorriger(' + i + ')" title="Corriger">✎</button>'
        +   '<button type="button" onclick="rhRetirer(' + i + ')" title="Retirer">✕</button>'
        + '</div></div>';
    }).join('') + '</div>';
  }

  window.rhCorriger = function (i) {
    const f = (rhFiche && rhFiche.faits) ? rhFiche.faits[i] : null; if (!f) return;
    rhEdite = f; rhRendreFiche();
    const t = document.getElementById('rh-texte');
    if (t) { t.focus(); t.scrollIntoView({ block: 'center' }); }
  };
  window.rhRetirer = async function (i) {
    const f = (rhFiche && rhFiche.faits) ? rhFiche.faits[i] : null; if (!f) return;
    if (!confirm('Retirer définitivement ce fait du ' + rhFr(f.le) + ' ?')) return;
    try { await rhPost('/api/rh/fait-retirer', { id: f.id }); await rhOuvrir(rhUid); rhMsg('Fait retiré.', false); }
    catch (e) { rhMsg('Suppression impossible : ' + e.message, true); }
  };

  // ── LES ENTRETIENS ────────────────────────────────────────────────────────
  function rhBlocEntretiens(f) {
    const l = f.entretiens || [];
    return '<div class="rh-bloc"><div class="rh-bloc-h">Entretiens'
      + '<button type="button" class="rh-b" onclick="rhEntretien()">+ Noter un entretien</button></div>'
      + (l.length ? l.map(function (e, i) {
          return '<div class="rh-e"><div class="rh-e-h"><b>' + E(TYPE[e.type] || e.type) + '</b>'
            + '<span>' + rhFr(e.le) + '</span>'
            + '<button type="button" onclick="rhEntretien(' + i + ')" title="Modifier">✎</button>'
            + '<button type="button" onclick="rhEntretienRetirer(' + i + ')" title="Retirer">✕</button></div>'
            + (e.notes ? '<div class="rh-e-t">' + E(e.notes) + '</div>' : '')
            + (e.suites ? '<div class="rh-e-s"><b>Décidé :</b> ' + E(e.suites) + '</div>' : '')
            + '</div>';
        }).join('')
      : '<div class="rh-vide">Aucun entretien noté.</div>')
      + '</div>';
  }

  window.rhEntretien = function (i) {
    const e = (i != null && rhFiche && rhFiche.entretiens) ? rhFiche.entretiens[i] : null;
    rhModale('Entretien — ' + rhNom(rhUid),
        '<label>Type</label><select id="rh-e-type">'
      +   Object.keys(TYPE).map(function (k) {
            return '<option value="' + k + '"' + (e && e.type === k ? ' selected' : '') + '>'
              + TYPE[k] + '</option>';
          }).join('') + '</select>'
      + '<label>Date</label><input type="date" id="rh-e-le" value="'
      +   E(e ? e.le : rhIso(new Date())) + '">'
      + '<label>Ce qui s’est dit</label><textarea id="rh-e-notes" rows="4">' + E(e ? e.notes : '') + '</textarea>'
      + '<label>Ce qui a été décidé</label><textarea id="rh-e-suites" rows="3">' + E(e ? e.suites : '') + '</textarea>'
      + '<div class="rh-garde">L’entretien de parcours professionnel ne porte pas sur la performance : '
      +   'compétences, besoins de formation, perspectives.</div>',
      async function () {
        const v = id => String((document.getElementById(id) || {}).value || '');
        await rhPost('/api/rh/entretien', {
          id: e ? e.id : null, uid: rhUid, type: v('rh-e-type'), le: v('rh-e-le'),
          notes: v('rh-e-notes'), suites: v('rh-e-suites')
        });
        await rhOuvrir(rhUid); rhMsg('Entretien enregistré.', false);
      });
  };
  window.rhEntretienRetirer = async function (i) {
    const e = (rhFiche && rhFiche.entretiens) ? rhFiche.entretiens[i] : null; if (!e) return;
    if (!confirm('Retirer cet entretien du ' + rhFr(e.le) + ' ?')) return;
    try { await rhPost('/api/rh/entretien-retirer', { id: e.id }); await rhOuvrir(rhUid); }
    catch (x) { rhMsg('Suppression impossible : ' + x.message, true); }
  };

  // ── LES HABILITATIONS ─────────────────────────────────────────────────────
  function rhBlocHabilitations(f) {
    const l = f.habilitations || [];
    const auj = rhIso(new Date());
    const dans60 = rhIso(new Date(Date.now() + 60 * 86400e3));
    return '<div class="rh-bloc"><div class="rh-bloc-h">Formations et habilitations'
      + '<button type="button" class="rh-b" onclick="rhHab()">+ Ajouter</button></div>'
      + (l.length ? '<div class="rh-habs">' + l.map(function (h, i) {
          const perimee = h.echeance && h.echeance < auj;
          const proche = h.echeance && !perimee && h.echeance <= dans60;
          return '<div class="rh-h' + (perimee ? ' perimee' : proche ? ' proche' : '') + '">'
            + '<span class="rh-h-l">' + E(h.libelle) + '</span>'
            + '<span class="rh-h-d">' + (h.echeance ? (perimee ? 'périmée le ' : 'jusqu’au ') + rhFr(h.echeance)
                                                    : 'sans échéance') + '</span>'
            + '<button type="button" onclick="rhHab(' + i + ')" title="Modifier">✎</button>'
            + '<button type="button" onclick="rhHabRetirer(' + i + ')" title="Retirer">✕</button>'
            + '</div>';
        }).join('') + '</div>'
      : '<div class="rh-vide">Aucune formation enregistrée.</div>')
      + '</div>';
  }
  window.rhHab = function (i) {
    const h = (i != null && rhFiche && rhFiche.habilitations) ? rhFiche.habilitations[i] : null;
    rhModale('Formation — ' + rhNom(rhUid),
        '<label>Intitulé</label><input type="text" id="rh-h-lib" maxlength="120" value="'
      +   E(h ? h.libelle : '') + '" placeholder="Vaccination grippe, TROD angine, DPC…">'
      + '<label>Obtenue le</label><input type="date" id="rh-h-obt" value="' + E(h ? h.obtenue : '') + '">'
      + '<label>Valable jusqu’au</label><input type="date" id="rh-h-ech" value="' + E(h ? h.echeance : '') + '">'
      + '<label>Notes</label><input type="text" id="rh-h-notes" maxlength="500" value="' + E(h ? h.notes : '') + '">'
      + '<div class="rh-garde">Laisser l’échéance vide pour une formation qui ne périme pas.</div>',
      async function () {
        const v = id => String((document.getElementById(id) || {}).value || '');
        await rhPost('/api/rh/habilitation', {
          id: h ? h.id : null, uid: rhUid, libelle: v('rh-h-lib'),
          obtenue: v('rh-h-obt'), echeance: v('rh-h-ech'), notes: v('rh-h-notes')
        });
        await rhOuvrir(rhUid); rhMsg('Formation enregistrée.', false);
      });
  };
  window.rhHabRetirer = async function (i) {
    const h = (rhFiche && rhFiche.habilitations) ? rhFiche.habilitations[i] : null; if (!h) return;
    if (!confirm('Retirer « ' + h.libelle + ' » ?')) return;
    try { await rhPost('/api/rh/habilitation-retirer', { id: h.id }); await rhOuvrir(rhUid); }
    catch (x) { rhMsg('Suppression impossible : ' + x.message, true); }
  };

  window.rhEmbauche = function () {
    rhModale('Date d’embauche — ' + rhNom(rhUid),
        '<label>Entrée dans l’équipe</label><input type="date" id="rh-emb" value="'
      +   E((rhFiche && rhFiche.embauche) || '') + '">'
      + '<div class="rh-garde">C’est elle qui fait courir la première échéance d’entretien : '
      +   'dans l’année qui suit l’embauche, puis tous les quatre ans.</div>',
      async function () {
        await rhPost('/api/rh/embauche', { uid: rhUid,
          embauche: String((document.getElementById('rh-emb') || {}).value || '') });
        await rhOuvrir(rhUid);
      });
  };

  // ── PRÉPARER LE POINT ─────────────────────────────────────────────────────
  // Ce qui transforme un tas de notes en conversation. Imprimable : on arrive au
  // point avec une feuille, pas avec un écran entre soi et l'autre.
  window.rhPreparer = function () {
    const p = (rhFiche && rhFiche.preparer) || null;
    if (!p) return;
    const bloc = function (titre, l) {
      if (!l.length) return '';
      return '<h4>' + titre + '</h4><ul>' + l.map(function (f) {
        return '<li><b>' + rhFr(f.le) + '</b> — ' + E(f.texte)
          + (f.tag ? ' <i>(' + E(TAGS[f.tag] || f.tag) + ')</i>' : '') + '</li>';
      }).join('') + '</ul>';
    };
    const corps = p.total
      ? bloc('À saluer', p.positif) + bloc('À évoquer', p.neutre) + bloc('À corriger', p.corriger)
      : '<p><b>Rien n’a été consigné depuis le dernier point.</b> Ce n’est pas forcément que rien '
        + 'ne s’est passé — c’est peut-être qu’on n’a rien noté.</p>';
    rhModale('Préparer le point — ' + rhNom(rhUid),
      '<div class="rh-prep" id="rh-prep">'
      + '<p class="rh-prep-s">'
      +   (p.depuis ? 'Depuis le dernier entretien du ' + rhFr(p.depuis)
                      + ' (' + p.jours + ' jours) · ' + p.total + ' fait(s).'
                    : 'Aucun entretien noté à ce jour · ' + p.total + ' fait(s) en tout.')
      + '</p>' + corps + '</div>'
      + '<div class="rh-garde">Cette feuille rassemble ce qui a été écrit sur ' + E(rhPrenom(rhUid))
      +   '. Elle est faite pour être lue avec elle, pas sur elle.</div>',
      null, 'Imprimer', function () { rhImprimer('rh-prep', 'Point individuel — ' + rhNom(rhUid)); });
  };

  // Le dossier complet, pour répondre à une demande d'accès (article 15 RGPD).
  window.rhDossier = async function () {
    try {
      const d = await rhGet('/api/rh/dossier?uid=' + encodeURIComponent(rhUid));
      const li = function (x) { return '<li>' + x + '</li>'; };
      const corps = '<div class="rh-prep" id="rh-doss">'
        + '<h3>Dossier de suivi — ' + E(rhNom(rhUid)) + '</h3>'
        + '<p class="rh-prep-s">Édité le ' + rhFr(rhIso(new Date()))
        +   ' · remis à la personne concernée sur sa demande.</p>'
        + '<h4>Faits consignés</h4>'
        + (d.faits.length ? '<ul>' + d.faits.map(function (f) {
            return li('<b>' + rhFr(String(f.le).slice(0, 10)) + '</b> — ' + E(f.texte)
              + ' <i>(' + E(TON[f.ton] ? TON[f.ton].lbl : f.ton) + ')</i>');
          }).join('') + '</ul>' : '<p>Aucun.</p>')
        + '<h4>Entretiens</h4>'
        + (d.entretiens.length ? '<ul>' + d.entretiens.map(function (e) {
            return li('<b>' + rhFr(String(e.le).slice(0, 10)) + '</b> — ' + E(TYPE[e.type] || e.type)
              + (e.notes ? ' : ' + E(e.notes) : '')
              + (e.suites ? ' <i>Décidé : ' + E(e.suites) + '</i>' : ''));
          }).join('') + '</ul>' : '<p>Aucun.</p>')
        + '<h4>Formations et habilitations</h4>'
        + (d.habilitations.length ? '<ul>' + d.habilitations.map(function (h) {
            return li(E(h.libelle) + (h.echeance ? ' — jusqu’au ' + rhFr(String(h.echeance).slice(0, 10)) : ''));
          }).join('') + '</ul>' : '<p>Aucune.</p>')
        + '</div>';
      rhModale('Dossier complet', corps, null, 'Imprimer',
        function () { rhImprimer('rh-doss', 'Dossier — ' + rhNom(rhUid)); });
    } catch (e) { rhMsg('Édition impossible : ' + e.message, true); }
  };

  function rhImprimer(id, titre) {
    const z = document.getElementById(id); if (!z) return;
    const w = window.open('', '_blank');
    if (!w) { rhMsg('Le navigateur a bloqué la fenêtre d’impression.', true); return; }
    w.document.write('<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>'
      + E(titre) + '</title><style>'
      + 'body{font:12pt/1.5 Georgia,serif;margin:22mm 18mm;color:#111}'
      + 'h3{margin:0 0 4px}h4{margin:18px 0 6px;font-size:11pt;text-transform:uppercase;letter-spacing:.05em}'
      + 'ul{margin:0;padding-left:18px}li{margin-bottom:5px}'
      + '.rh-prep-s{color:#555;font-size:10pt;margin:0 0 14px}'
      + '</style></head><body>' + z.innerHTML
      + '<script>setTimeout(function(){window.print();},200);<\/script></body></html>');
    w.document.close();
  }

  // ── Une modale, une seule ─────────────────────────────────────────────────
  let rhValider = null, rhExtra = null;
  function rhModale(titre, corps, onOk, lblExtra, onExtra) {
    rhValider = onOk; rhExtra = onExtra || null;
    let ov = document.getElementById('rh-ov');
    if (!ov) { ov = document.createElement('div'); ov.id = 'rh-ov'; document.body.appendChild(ov); }
    ov.className = 'rh-ov on';
    ov.innerHTML = '<div class="rh-ov-b" role="dialog" aria-label="' + E(titre) + '">'
      + '<div class="rh-ov-h"><b>' + E(titre) + '</b>'
      +   '<button type="button" class="rh-ov-x" onclick="rhFermer()" aria-label="Fermer">×</button></div>'
      + '<div class="rh-ov-c">' + corps + '</div>'
      + '<div class="rh-ov-a">'
      +   '<button type="button" class="rh-b" onclick="rhFermer()">Fermer</button>'
      +   (onExtra ? '<button type="button" class="rh-b" onclick="rhOvExtra()">' + E(lblExtra) + '</button>' : '')
      +   (onOk ? '<button type="button" class="rh-b rh-bp" onclick="rhOvOk()">Enregistrer</button>' : '')
      + '</div></div>';
    ov.onmousedown = function (ev) { if (ev.target === ov) rhFermer(); };
    document.addEventListener('keydown', rhEchap, true);
  }
  function rhEchap(ev) { if (ev.key === 'Escape') { ev.stopPropagation(); rhFermer(); } }
  window.rhFermer = function () {
    const ov = document.getElementById('rh-ov');
    if (ov) { ov.className = 'rh-ov'; ov.innerHTML = ''; }
    document.removeEventListener('keydown', rhEchap, true);
    rhValider = null; rhExtra = null;
  };
  window.rhOvExtra = function () { if (rhExtra) rhExtra(); };
  window.rhOvOk = async function () {
    if (!rhValider) return;
    try { await rhValider(); rhFermer(); }
    catch (e) { rhMsg('Enregistrement impossible : ' + e.message, true); }
  };

  // ── Style ─────────────────────────────────────────────────────────────────
  const RH_CSS = `
  #rh-host{padding:18px 22px;max-width:940px}
  .rh-tete h2{margin:0 0 6px;font-size:1.2rem;color:var(--accent)}
  .rh-tete p{margin:0 0 16px;color:var(--mut);font-size:.84rem;line-height:1.55;max-width:640px}
  .rh-msg{font-size:.85rem;min-height:0;margin-bottom:8px}
  .rh-msg.ok{color:var(--accent)}
  .rh-msg.ko{color:var(--crit);font-weight:600}
  .rh-grille{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:11px}
  .rh-carte{display:flex;flex-direction:column;gap:3px;align-items:flex-start;text-align:left;
    background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:13px 15px;
    cursor:pointer;font:inherit;color:inherit}
  .rh-carte:hover{border-color:var(--accent);box-shadow:0 2px 10px rgba(52,132,102,.12)}
  .rh-carte.muet{border-left:4px solid var(--warn)}
  .rh-ca-n{font-weight:700;font-size:.95rem}
  .rh-ca-p{font-size:.74rem;color:var(--mut)}
  .rh-cs{display:flex;gap:7px;margin-top:7px}
  .rh-c{font-size:.76rem;font-weight:700;border-radius:999px;padding:1px 8px;border:1px solid var(--line)}
  .rh-c-pos{color:var(--ok);background:var(--accent-soft);border-color:#cfe6d6}
  .rh-c-neu{color:var(--mut)}
  .rh-c-cor{color:var(--crit);background:#FDEDEC;border-color:#f0cbc7}
  .rh-als{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}
  .rh-al{font-size:.7rem;border-radius:6px;padding:2px 7px}
  .rh-al-muet{background:#FFF4DF;color:#7a5508}
  .rh-al-ech{background:#FDEDEC;color:#8c2f26}
  .rh-al-hab{background:#EEF2F6;color:#41576e}
  .rh-al-desq{background:var(--accent-soft);color:#1f5c45}
  .rh-fh{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px}
  .rh-fh h2{margin:0;font-size:1.25rem;flex:1;min-width:0}
  .rh-fh-a{display:flex;gap:7px}
  .rh-ret{background:none;border:none;color:var(--accent);font:inherit;font-weight:600;cursor:pointer;padding:0}
  .rh-b{font:inherit;font-size:.83rem;font-weight:600;color:var(--ink);background:var(--surface);
    border:1px solid var(--line);border-radius:9px;padding:7px 13px;cursor:pointer}
  .rh-b:hover{border-color:var(--accent);color:var(--accent)}
  .rh-bp{background:var(--accent);border-color:var(--accent);color:#fff}
  .rh-bp:hover{color:#fff;filter:brightness(1.07)}
  .rh-kpis{display:flex;gap:9px;flex-wrap:wrap;margin-bottom:11px}
  .rh-k{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:9px 15px;min-width:92px}
  .rh-k b{display:block;font-size:1.1rem}
  .rh-k span{font-size:.72rem;color:var(--mut)}
  .rh-note{border-radius:10px;padding:10px 13px;font-size:.84rem;line-height:1.55;margin-bottom:9px;
    background:#EEF2F6;color:#41576e}
  .rh-note-muet{background:#FFF4DF;color:#7a5508;border-left:4px solid var(--warn)}
  .rh-note-desq{background:var(--accent-soft);color:#1f5c45;border-left:4px solid var(--accent)}
  .rh-note-ech{background:#FDEDEC;color:#8c2f26;border-left:4px solid var(--crit)}
  .rh-lien{background:none;border:none;color:inherit;font:inherit;text-decoration:underline;cursor:pointer;padding:0}
  .rh-saisie{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin:14px 0}
  .rh-s-h{font-size:.74rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
    color:var(--mut);margin-bottom:8px}
  .rh-saisie textarea{width:100%;font:inherit;font-size:.92rem;border:1px solid var(--line);
    border-radius:9px;padding:10px 12px;resize:vertical;box-sizing:border-box}
  .rh-saisie textarea:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
  /* LE RAPPEL. Il est sous le champ, pas dans une aide qu'on n'ouvre jamais. */
  .rh-garde{font-size:.76rem;color:var(--mut);line-height:1.5;margin-top:7px}
  .rh-garde-i{color:var(--crit)}
  .rh-s-l{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:11px}
  .rh-tons{display:flex;gap:5px}
  .rh-ton{display:flex;align-items:center;gap:4px;font-size:.8rem;border:1px solid var(--line);
    border-radius:999px;padding:5px 11px;cursor:pointer;background:var(--surface)}
  .rh-ton input{margin:0;accent-color:var(--accent)}
  .rh-ton:has(input:checked){font-weight:700;border-color:currentColor}
  .rh-ton-pos:has(input:checked){color:var(--ok);background:var(--accent-soft)}
  .rh-ton-cor:has(input:checked){color:var(--crit);background:#FDEDEC}
  .rh-s-l input[type=date],.rh-s-l select{font:inherit;font-size:.83rem;border:1px solid var(--line);
    border-radius:9px;padding:7px 10px;background:var(--surface)}
  .rh-liste{display:flex;flex-direction:column;gap:7px}
  .rh-f{display:grid;grid-template-columns:1fr auto;gap:2px 10px;background:var(--surface);
    border:1px solid var(--line);border-left-width:4px;border-radius:10px;padding:10px 13px}
  .rh-f-pos{border-left-color:var(--ok)}
  .rh-f-neu{border-left-color:var(--line)}
  .rh-f-cor{border-left-color:var(--crit)}
  .rh-f-d{font-size:.74rem;color:var(--mut)}
  .rh-f-d i{font-style:normal}
  .rh-tag{background:var(--accent-soft);color:#1f5c45;border-radius:5px;padding:1px 6px}
  .rh-f-t{font-size:.9rem;grid-column:1;white-space:pre-wrap}
  .rh-f-a{grid-row:1/3;grid-column:2;display:flex;gap:3px;align-items:flex-start}
  .rh-f-a button,.rh-e-h button,.rh-h button{border:none;background:none;color:#c3ccc8;cursor:pointer;
    font-size:.86rem;padding:2px 5px;border-radius:6px}
  .rh-f-a button:hover,.rh-e-h button:hover,.rh-h button:hover{color:var(--accent);background:var(--accent-soft)}
  .rh-bloc{margin-top:20px}
  .rh-bloc-h{display:flex;align-items:center;gap:10px;font-size:.74rem;font-weight:700;
    text-transform:uppercase;letter-spacing:.06em;color:var(--mut);margin-bottom:9px}
  .rh-bloc-h button{margin-left:auto;text-transform:none;letter-spacing:0}
  .rh-e{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:11px 13px;margin-bottom:7px}
  .rh-e-h{display:flex;align-items:center;gap:9px;font-size:.86rem}
  .rh-e-h span{color:var(--mut);font-size:.78rem;margin-right:auto}
  .rh-e-t{font-size:.86rem;margin-top:6px;white-space:pre-wrap}
  .rh-e-s{font-size:.84rem;margin-top:5px;color:#41576e}
  .rh-habs{display:flex;flex-direction:column;gap:5px}
  .rh-h{display:flex;align-items:center;gap:9px;background:var(--surface);border:1px solid var(--line);
    border-radius:9px;padding:8px 12px;font-size:.86rem}
  .rh-h-l{font-weight:600;flex:1;min-width:0}
  .rh-h-d{font-size:.76rem;color:var(--mut)}
  .rh-h.proche{border-color:var(--warn)}
  .rh-h.proche .rh-h-d{color:#7a5508;font-weight:600}
  .rh-h.perimee{border-color:var(--crit)}
  .rh-h.perimee .rh-h-d{color:var(--crit);font-weight:700}
  .rh-vide{padding:18px 4px;color:var(--mut);font-size:.86rem;line-height:1.6}
  .rh-ov{display:none;position:fixed;inset:0;background:rgba(17,24,20,.5);z-index:1000;
    align-items:center;justify-content:center;padding:18px}
  .rh-ov.on{display:flex}
  .rh-ov-b{background:var(--surface);border-radius:14px;padding:18px 20px;width:min(560px,96vw);
    max-height:90vh;display:flex;flex-direction:column;box-shadow:0 20px 50px rgba(0,0,0,.3)}
  .rh-ov-h{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}
  .rh-ov-c{overflow:auto}
  .rh-ov-x{background:none;border:none;font-size:1.5rem;line-height:1;cursor:pointer;color:var(--mut)}
  .rh-ov-c label{display:block;font-size:.72rem;font-weight:700;text-transform:uppercase;
    letter-spacing:.05em;color:var(--mut);margin:11px 0 4px}
  .rh-ov-c input,.rh-ov-c textarea,.rh-ov-c select{width:100%;font:inherit;font-size:.9rem;
    border:1px solid var(--line);border-radius:9px;padding:9px 11px;box-sizing:border-box}
  .rh-ov-c input:focus,.rh-ov-c textarea:focus{outline:none;border-color:var(--accent)}
  .rh-ov-a{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}
  .rh-prep h4{font-size:.74rem;text-transform:uppercase;letter-spacing:.06em;color:var(--mut);margin:14px 0 6px}
  .rh-prep ul{margin:0;padding-left:18px}
  .rh-prep li{margin-bottom:5px;font-size:.88rem;line-height:1.5}
  .rh-prep-s{color:var(--mut);font-size:.8rem;margin:0}
  `;

  function rhInjecter() {
    if (document.getElementById('rh-css')) return;
    const st = document.createElement('style');
    st.id = 'rh-css'; st.textContent = RH_CSS;
    document.head.appendChild(st);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', rhInjecter);
  else rhInjecter();
}());
