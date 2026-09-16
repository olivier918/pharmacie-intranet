/* ═══════════════════════════════════════════════════════════════════════════
   RÉPERTOIRE DES LABORATOIRES

   Le nom du laboratoire est écrit EN TEXTE LIBRE dans les litiges depuis le
   premier jour. Les vingt-six dossiers repris du tableau Excel disent « mkl »
   et « MKL », « Eurodep / Panda Tea » et « Eurodep », « La rosee » et
   « La Rosée ». Tant que ce texte reste la seule identité du laboratoire, on
   ne peut ni compter ce qu'on lui doit, ni lui écrire.

   D'OÙ LE PRINCIPE DE CE MODULE : on ne réécrit JAMAIS les dossiers. La fiche
   du laboratoire absorbe les orthographes rencontrées sous forme d'ALIAS, et
   c'est la fiche qui va au-devant du texte, pas l'inverse. Une reprise écrite
   dans la base serait rejouée par chaque poste resté sur l'ancienne version et
   se battrait avec elle-même à la fusion (piège n° 7 du CLAUDE.md).

   ET LE SECOND : les rapprochements sont SIGNALÉS, jamais faits d'office.
   « SVR » et « SVP » se ressemblent et ne sont pas le même fournisseur ; deux
   fiches fusionnées à tort emportent avec elles l'historique des litiges de
   l'une des deux, et personne ne le voit.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const E = s => String(s == null ? '' : s).replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ── La clé d'identité ─────────────────────────────────────────────────────
  // On met à plat ce qui relève de la frappe — casse, accents, ponctuation,
  // espaces — et RIEN d'autre. Réduire davantage (retirer les chiffres, par
  // exemple) confondrait « 3M » et « M ».
  function lbPlat(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toUpperCase()
      .replace(/['’`]/g, ' ')
      .replace(/[^A-Z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  const lbClef = nom => lbPlat(nom);

  const lbListe = () => (typeof laboratoires !== 'undefined' && Array.isArray(laboratoires)) ? laboratoires : [];
  const lbAdmin = () => (typeof isAdmin === 'function') ? isAdmin() : false;
  const lbUser = () => (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null;
  const lbSave = () => { if (typeof saveNow === 'function') saveNow(); };
  const ico = n => (typeof window.ico === 'function') ? window.ico(n)
    : '<svg class="ico"><use href="#ic-' + n + '"></use></svg>';

  // Index clef → fiche, nom officiel ET alias. C'est l'index qui fait tout le
  // travail : sans les alias, un litige saisi « mkl » ne retrouverait jamais la
  // fiche « MKL Distribution », et l'outil de rapprochement serait cosmétique.
  function lbIndex() {
    const idx = new Map();
    lbListe().forEach(function (f) {
      if (!f) return;
      const poser = c => { if (c && !idx.has(c)) idx.set(c, f); };
      poser(lbClef(f.nom));
      (f.alias || []).forEach(a => poser(lbClef(a)));
    });
    return idx;
  }
  function lbParNom(nom, idx) { return (idx || lbIndex()).get(lbClef(nom)) || null; }
  function lbParId(id) { return lbListe().find(f => f && f.id === id) || null; }

  // La fiche d'un dossier : le lien explicite d'abord, le nom écrit ensuite.
  // L'ordre compte — un dossier rattaché à la main ne doit pas être défait par
  // une orthographe.
  function lbDuDossier(r, idx) {
    if (!r) return null;
    return (r.laboId ? lbParId(r.laboId) : null) || lbParNom(r.labo, idx);
  }
  window.lbDuDossier = lbDuDossier;
  window.lbParNom = lbParNom;
  window.lbClef = lbClef;

  // Le contact à qui on écrit pour un litige : celui qui est marqué, sinon le
  // premier qui a une adresse, sinon l'adresse générale du laboratoire.
  function lbContactLitige(f) {
    if (!f) return null;
    const c = (f.contacts || []);
    return c.find(x => x && x.litiges && x.mail)
        || c.find(x => x && x.litiges)
        || c.find(x => x && x.mail)
        || c[0] || null;
  }
  function lbMailLitige(f) {
    const c = lbContactLitige(f);
    return (c && c.mail) || (f && f.mail) || '';
  }
  window.lbContactLitige = lbContactLitige;
  window.lbMailLitige = lbMailLitige;

  // ── Ce que les dossiers connaissent comme laboratoires ────────────────────
  function lbDossiers() {
    const a = (typeof litiges !== 'undefined' && Array.isArray(litiges)) ? litiges : [];
    const b = (typeof facturesManq !== 'undefined' && Array.isArray(facturesManq)) ? facturesManq : [];
    return a.concat(b);
  }
  // Les noms écrits dans les dossiers, regroupés par clé : combien de dossiers,
  // et l'orthographe la plus fréquente — c'est elle qu'on proposera comme nom
  // de fiche, pas la première rencontrée.
  function lbNomsDesDossiers(dossiers) {
    const m = new Map();
    (dossiers || []).forEach(function (r) {
      if (!r || !r.labo) return;
      const c = lbClef(r.labo); if (!c) return;
      if (!m.has(c)) m.set(c, { clef: c, n: 0, formes: {}, dossiers: [] });
      const e = m.get(c);
      e.n++; e.dossiers.push(r);
      const t = String(r.labo).trim();
      e.formes[t] = (e.formes[t] || 0) + 1;
    });
    m.forEach(function (e) {
      e.texte = Object.keys(e.formes).sort((a, b) => e.formes[b] - e.formes[a] || a.localeCompare(b, 'fr'))[0] || '';
    });
    return m;
  }
  // Ceux qu'aucune fiche ne reconnaît. Triés par nombre de dossiers : on
  // commence par ceux qui pèsent.
  function lbARattacher(dossiers, idx) {
    const out = [];
    lbNomsDesDossiers(dossiers).forEach(function (e) {
      if (!idx.has(e.clef)) out.push(e);
    });
    return out.sort((a, b) => b.n - a.n || a.texte.localeCompare(b.texte, 'fr'));
  }

  // ── Les doublons du répertoire lui-même ───────────────────────────────────
  // Deux degrés seulement, et aucun ne fusionne tout seul.
  //   certain  — même clé : « La Rosée » et « la rosee »
  //   probable — l'un commence par l'autre : « Pierre Fabre » / « Pierre Fabre Dermo »
  //   probable — une seule lettre d'écart sur un nom assez long
  function lbDistance(a, b) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > 1) return 2;   // au-delà, inutile de compter
    const l = [];
    for (let i = 0; i <= a.length; i++) l[i] = [i];
    for (let j = 0; j <= b.length; j++) l[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        l[i][j] = Math.min(l[i - 1][j] + 1, l[i][j - 1] + 1,
          l[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
    }
    return l[a.length][b.length];
  }
  function lbProches(a, b) {
    const ka = lbClef(a), kb = lbClef(b);
    if (!ka || !kb) return null;
    if (ka === kb) return 'certain';
    // « M.K.L » et « MKL ». On le SIGNALE, sans jamais le reconnaître tout
    // seul : la clé d'identité reste stricte, parce qu'elle rattache des
    // dossiers sans que personne ne relise. Ici, un humain valide.
    if (ka.replace(/ /g, '') === kb.replace(/ /g, '')) return 'probable';
    const court = ka.length < kb.length ? ka : kb, long = ka.length < kb.length ? kb : ka;
    // « SVR » et « SVR INTERNATIONAL » : oui. Mais un préfixe de trois lettres
    // sur un nom long attrape n'importe quoi.
    if (court.length >= 4 && long.indexOf(court + ' ') === 0) return 'probable';
    if (court.length >= 6 && lbDistance(ka, kb) === 1) return 'probable';
    return null;
  }
  function lbDoublons(liste) {
    const l = (liste || []).filter(Boolean);
    const vus = {}, groupes = [];
    for (let i = 0; i < l.length; i++) {
      if (vus[l[i].id]) continue;
      const g = { fiches: [l[i]], degre: null };
      for (let j = i + 1; j < l.length; j++) {
        if (vus[l[j].id]) continue;
        const d = lbProches(l[i].nom, l[j].nom);
        if (d) {
          g.fiches.push(l[j]); vus[l[j].id] = 1;
          g.degre = (g.degre === 'certain' || d === 'certain') ? 'certain' : 'probable';
        }
      }
      if (g.fiches.length > 1) { vus[l[i].id] = 1; groupes.push(g); }
    }
    return groupes;
  }
  window.lbProches = lbProches;
  window.lbDoublons = lbDoublons;
  window.lbARattacher = lbARattacher;
  window.lbNomsDesDossiers = lbNomsDesDossiers;

  // ── L'écran ───────────────────────────────────────────────────────────────
  let lbVue = 'fiches';
  let lbEdite = null;          // id en cours de modification, 0 pour un nouveau
  let lbBrouillon = null;      // la fiche en cours de saisie

  window.lbOnglet = function (v) { lbVue = v; lbRendBO(); };

  window.lbRendBO = function () {
    const el = document.getElementById('lb-bo'); if (!el) return;
    const idx = lbIndex();
    const dossiers = lbDossiers();
    const rat = lbARattacher(dossiers, idx);
    const dbl = lbDoublons(lbListe());
    const q = ((document.getElementById('lb-q') || {}).value || '').trim().toLowerCase();

    const ong = (k, lbl, n, alerte) => '<button class="lb-ong' + (lbVue === k ? ' sel' : '') + '" onclick="lbOnglet(\'' + k + '\')">'
      + lbl + (n ? '<span class="n' + (alerte ? ' rouge' : '') + '">' + n + '</span>' : '') + '</button>';

    el.innerHTML = '<div class="lb-ongs">'
      + ong('fiches', 'Fiches', lbListe().length)
      + ong('rattacher', 'À rattacher', rat.length, rat.length)
      + ong('doublons', 'Doublons', dbl.length, dbl.some(g => g.degre === 'certain'))
      + '</div>'
      + (lbVue === 'fiches' ? lbVueFiches(q, idx, dossiers)
         : lbVue === 'rattacher' ? lbVueRattacher(rat)
         : lbVueDoublons(dbl));
  };

  function lbCompte(f, dossiers, idx) {
    return (dossiers || []).filter(r => lbDuDossier(r, idx) === f).length;
  }

  function lbVueFiches(q, idx, dossiers) {
    let h = lbEdite !== null ? lbFormulaire() : (lbAdmin()
      ? '<div style="margin:0 0 14px"><button class="btn bp" onclick="lbNouveau()">+ Nouveau laboratoire</button></div>'
      : '');
    h += '<div class="lb-barre"><input type="text" id="lb-q" placeholder="Rechercher un laboratoire, un délégué…" '
      + 'value="' + E(q) + '" oninput="lbRendBO()"></div>';
    const l = lbListe().filter(function (f) {
      if (!q) return true;
      const c = (f.contacts || []).map(x => (x.nom || '') + ' ' + (x.prenom || '') + ' ' + (x.mail || '')).join(' ');
      return ((f.nom || '') + ' ' + (f.ville || '') + ' ' + (f.mail || '') + ' ' + (f.alias || []).join(' ') + ' ' + c)
        .toLowerCase().includes(q);
    }).sort((a, b) => String(a.nom || '').localeCompare(String(b.nom || ''), 'fr', { sensitivity: 'base' }));

    if (!l.length) {
      return h + '<div class="lb-vide">' + (lbListe().length
        ? 'Aucun laboratoire ne correspond à la recherche.'
        : 'Le répertoire est vide. L’onglet « À rattacher » liste les laboratoires déjà cités dans vos litiges : c’est le plus court chemin pour le remplir.') + '</div>';
    }
    return h + '<div class="twrap"><table><thead><tr>'
      + '<th>Laboratoire</th><th>Ville</th><th>Téléphone</th><th>Contact litiges</th><th>Dossiers</th><th></th>'
      + '</tr></thead><tbody>'
      + l.map(function (f) {
          const c = lbContactLitige(f);
          const n = lbCompte(f, dossiers, idx);
          return '<tr><td><strong>' + E(f.nom || '') + '</strong>'
            + ((f.alias || []).length ? '<div class="lb-alias">aussi écrit : ' + E(f.alias.join(', ')) + '</div>' : '')
            + '</td>'
            + '<td>' + E(f.ville || '—') + '</td>'
            + '<td>' + E(f.tel || '—') + '</td>'
            + '<td>' + (c ? E(((c.prenom || '') + ' ' + (c.nom || '')).trim() || c.mail || '—')
                  + (c.mail ? '<div class="lb-alias">' + E(c.mail) + '</div>' : '')
                : (f.mail ? E(f.mail) : '<span class="lb-manque">aucun</span>')) + '</td>'
            + '<td>' + (n || '—') + '</td>'
            + '<td style="white-space:nowrap">'
            + '<button class="btn bs btn-ico" onclick="lbEditer(' + f.id + ')" title="Modifier">' + ico('modifier') + '</button>'
            + (lbAdmin() ? '<button class="btn bd btn-ico" onclick="lbSupprimer(' + f.id + ')" title="Supprimer">' + ico('corbeille') + '</button>' : '')
            + '</td></tr>';
        }).join('')
      + '</tbody></table></div>';
  }

  function lbVueRattacher(rat) {
    if (!rat.length) return '<div class="lb-vide">Tous les laboratoires cités dans vos dossiers ont une fiche.</div>';
    return '<p class="lb-expl">Ces noms sont écrits dans vos litiges et factures manquantes, et aucune fiche ne les reconnaît. '
      + '<b>Rattacher</b> ajoute l’orthographe à une fiche existante : les dossiers ne sont pas modifiés, c’est la fiche qui les rejoint.</p>'
      + '<div class="twrap"><table><thead><tr><th>Nom écrit dans les dossiers</th><th>Dossiers</th><th></th></tr></thead><tbody>'
      + rat.map(function (e) {
          return '<tr><td><strong>' + E(e.texte) + '</strong></td>'
            + '<td>' + e.n + '</td>'
            + '<td style="white-space:nowrap">'
            + '<button class="btn bp sm" onclick="lbCreerDepuis(\'' + E(e.clef) + '\')">Créer la fiche</button> '
            + lbChoixFiche(e.clef)
            + '</td></tr>';
        }).join('')
      + '</tbody></table></div>';
  }
  // Le gestionnaire ne reçoit pas le nom écrit dans le dossier : il reçoit la
  // clé mise à plat, et va rechercher le texte lui-même.
  function lbChoixFiche(clef) {
    const l = lbListe().slice().sort((a, b) => String(a.nom || '').localeCompare(String(b.nom || ''), 'fr'));
    if (!l.length) return '';
    return '<select class="lb-sel" onchange="lbRattacher(\'' + E(clef) + '\',this.value);this.value=\'\'">'
      + '<option value="">Rattacher à une fiche…</option>'
      + l.map(f => '<option value="' + f.id + '">' + E(f.nom || '') + '</option>').join('')
      + '</select>';
  }

  function lbVueDoublons(dbl) {
    if (!dbl.length) return '<div class="lb-vide">Aucun doublon repéré dans le répertoire.</div>';
    return '<p class="lb-expl">Rapprochements <b>signalés, jamais faits d’office</b> : deux fiches fusionnées à tort '
      + 'emportent l’historique de l’une des deux, et personne ne le voit. Choisissez la fiche à <b>conserver</b>.</p>'
      + dbl.map(function (g) {
          return '<div class="lb-grp"><div class="lb-grp-h">'
            + (g.degre === 'certain' ? 'Même nom à la casse près' : 'Noms très proches') + '</div>'
            + g.fiches.map(function (f) {
                const autres = g.fiches.filter(x => x !== f);
                return '<div class="lb-grp-l"><span><strong>' + E(f.nom || '') + '</strong>'
                  + (f.ville ? ' · ' + E(f.ville) : '') + '</span>'
                  + (lbAdmin()
                      ? '<select class="lb-sel" onchange="lbFusionner(' + f.id + ',this.value);this.value=\'\'">'
                        + '<option value="">Absorber ici…</option>'
                        + autres.map(x => '<option value="' + x.id + '">' + E(x.nom || '') + '</option>').join('')
                        + '</select>'
                      : '')
                  + '</div>';
              }).join('')
            + '</div>';
        }).join('');
  }

  // ── Le formulaire ─────────────────────────────────────────────────────────
  function lbVide() {
    return { id: 0, nom: '', adresse: '', cp: '', ville: '', tel: '', mail: '', alias: [], contacts: [], note: '' };
  }
  window.lbNouveau = function () { lbEdite = 0; lbBrouillon = lbVide(); lbRendBO(); lbFocus(); };
  window.lbCreerDepuis = function (clef) {
    const e = lbNomsDesDossiers(lbDossiers()).get(clef);
    lbEdite = 0; lbBrouillon = lbVide();
    if (e) lbBrouillon.nom = e.texte;
    lbVue = 'fiches'; lbRendBO(); lbFocus();
  };
  window.lbEditer = function (id) {
    const f = lbParId(id); if (!f) return;
    lbEdite = id;
    lbBrouillon = JSON.parse(JSON.stringify(f));
    lbBrouillon.alias = lbBrouillon.alias || [];
    lbBrouillon.contacts = lbBrouillon.contacts || [];
    lbVue = 'fiches'; lbRendBO(); lbFocus();
  };
  window.lbAnnuler = function () { lbEdite = null; lbBrouillon = null; lbRendBO(); };
  function lbFocus() { setTimeout(function () { const e = document.getElementById('lb-f-nom'); if (e) e.focus(); }, 60); }

  function lbFormulaire() {
    const b = lbBrouillon || lbVide();
    const ch = (id, lbl, val, type, ph) => '<div class="fg"><label>' + lbl + '</label>'
      + '<input type="' + (type || 'text') + '" id="' + id + '" value="' + E(val || '') + '"'
      + (ph ? ' placeholder="' + E(ph) + '"' : '') + '></div>';
    return '<div class="card lb-form">'
      + '<div class="ch"><span class="ct">' + (lbEdite ? 'Modifier — ' + E(b.nom || '') : 'Nouveau laboratoire') + '</span></div>'
      + '<div class="fgrid">'
      + ch('lb-f-nom', 'Nom du laboratoire', b.nom, 'text', 'Pierre Fabre…')
      + ch('lb-f-tel', 'Téléphone', b.tel, 'tel', '01 23 45 67 89')
      + ch('lb-f-mail', 'E-mail général', b.mail, 'email', 'service.client@…')
      + ch('lb-f-adresse', 'Adresse', b.adresse, 'text', 'Rue, bâtiment…')
      + ch('lb-f-cp', 'Code postal', b.cp, 'text', '14000')
      + ch('lb-f-ville', 'Ville', b.ville, 'text', 'Caen')
      + '</div>'
      + '<div class="lb-sh">Contacts</div>'
      + '<p class="lb-expl" style="margin-top:0">Le délégué, et tous ceux à qui l’on écrit : ADV, service litiges, transporteur. '
      + 'Celui qui est coché est l’interlocuteur proposé par défaut sur un litige.</p>'
      + '<div id="lb-contacts">' + lbContactsHtml(b.contacts) + '</div>'
      + '<button class="btn bs sm" style="margin-top:8px" onclick="lbContactAjouter()">+ Ajouter un contact</button>'
      + ((b.alias || []).length ? '<div class="lb-sh">Aussi écrit</div>'
          + '<div class="lb-alias-l">' + b.alias.map(function (a, i) {
              return '<span class="lb-tag">' + E(a) + '<button onclick="lbAliasRetirer(' + i + ')" title="Retirer">✕</button></span>';
            }).join('') + '</div>'
          + '<p class="lb-expl">Orthographes rencontrées dans les dossiers. Les retirer défait le rattachement.</p>' : '')
      + '<div class="fg" style="margin-top:12px"><label>Note</label>'
      + '<input type="text" id="lb-f-note" value="' + E(b.note || '') + '" placeholder="Conditions, particularités…"></div>'
      + '<div style="margin-top:14px;display:flex;gap:8px">'
      + '<button class="btn bp" onclick="lbEnregistrer()">' + ico('valider') + ' Enregistrer</button>'
      + '<button class="btn bs" onclick="lbAnnuler()">Annuler</button>'
      + '</div></div>';
  }
  function lbContactsHtml(l) {
    if (!(l || []).length) return '<div class="lb-vide" style="padding:.8rem">Aucun contact pour l’instant.</div>';
    return l.map(function (c, i) {
      return '<div class="lb-ct">'
        + '<input placeholder="NOM" value="' + E(c.nom || '') + '" oninput="lbContactMaj(' + i + ',\'nom\',this.value)">'
        + '<input placeholder="Prénom" value="' + E(c.prenom || '') + '" oninput="lbContactMaj(' + i + ',\'prenom\',this.value)">'
        + '<input placeholder="Fonction (délégué, ADV…)" value="' + E(c.fonction || '') + '" oninput="lbContactMaj(' + i + ',\'fonction\',this.value)">'
        + '<input placeholder="Mobile" value="' + E(c.mobile || '') + '" oninput="lbContactMaj(' + i + ',\'mobile\',this.value)">'
        + '<input placeholder="E-mail" value="' + E(c.mail || '') + '" oninput="lbContactMaj(' + i + ',\'mail\',this.value)">'
        + '<label class="lb-cb" title="Interlocuteur proposé pour les litiges">'
        + '<input type="checkbox"' + (c.litiges ? ' checked' : '') + ' onchange="lbContactLitigesMaj(' + i + ',this.checked)"> litiges</label>'
        + '<button class="lb-x" onclick="lbContactRetirer(' + i + ')" title="Retirer ce contact">✕</button>'
        + '</div>';
    }).join('');
  }
  // La saisie vit dans le brouillon, pas dans le DOM : redessiner la liste des
  // contacts ne doit pas perdre ce qui vient d'être tapé ailleurs.
  window.lbContactMaj = function (i, champ, val) {
    if (!lbBrouillon || !lbBrouillon.contacts[i]) return;
    lbBrouillon.contacts[i][champ] = val;
  };
  window.lbContactLitigesMaj = function (i, on) {
    if (!lbBrouillon) return;
    // Un seul interlocuteur par défaut : deux cases cochées ne diraient plus à
    // qui écrire.
    lbBrouillon.contacts.forEach(function (c, j) { if (c) c.litiges = on && j === i; });
    document.getElementById('lb-contacts').innerHTML = lbContactsHtml(lbBrouillon.contacts);
  };
  window.lbContactAjouter = function () {
    if (!lbBrouillon) return;
    lbBrouillon.contacts.push({ nom: '', prenom: '', fonction: '', mobile: '', mail: '', litiges: !lbBrouillon.contacts.length });
    document.getElementById('lb-contacts').innerHTML = lbContactsHtml(lbBrouillon.contacts);
  };
  window.lbContactRetirer = function (i) {
    if (!lbBrouillon) return;
    lbBrouillon.contacts.splice(i, 1);
    document.getElementById('lb-contacts').innerHTML = lbContactsHtml(lbBrouillon.contacts);
  };
  window.lbAliasRetirer = function (i) {
    if (!lbBrouillon) return;
    lbBrouillon.alias.splice(i, 1); lbRendBO();
  };

  function lbChampsDuDom(b) {
    const v = id => { const e = document.getElementById(id); return e ? e.value.trim() : ''; };
    b.nom = v('lb-f-nom'); b.tel = v('lb-f-tel'); b.mail = v('lb-f-mail');
    b.adresse = v('lb-f-adresse'); b.cp = v('lb-f-cp'); b.ville = v('lb-f-ville');
    b.note = v('lb-f-note');
    return b;
  }

  window.lbEnregistrer = function () {
    if (!lbUser()) { alert('Identifiez-vous avec votre code PIN.'); return; }
    const b = lbChampsDuDom(lbBrouillon || lbVide());
    if (!b.nom) { alert('Le nom du laboratoire est nécessaire.'); return; }
    b.contacts = (b.contacts || []).filter(c => c && ((c.nom || '') + (c.prenom || '') + (c.mail || '') + (c.mobile || '')).trim());
    // Un nom déjà pris par une AUTRE fiche : on refuse, plutôt que de créer le
    // doublon qu'on demandera ensuite de résoudre.
    const dejaLa = lbParNom(b.nom);
    if (dejaLa && dejaLa.id !== lbEdite) {
      alert('« ' + dejaLa.nom + ' » existe déjà dans le répertoire.');
      return;
    }
    const now = Date.now();
    if (lbEdite) {
      const f = lbParId(lbEdite); if (!f) return;
      Object.assign(f, b, { id: f.id, updatedAt: now });
    } else {
      b.id = lbListe().reduce((m, x) => (x && x.id > m ? x.id : m), 0) + 1;
      b.ts = now; b.updatedAt = now;
      lbListe().push(b);
    }
    if (typeof logAction === 'function') logAction(lbEdite ? 'Laboratoire modifié' : 'Laboratoire ajouté', b.nom);
    lbEdite = null; lbBrouillon = null;
    lbSave(); lbRendBO();
  };

  window.lbSupprimer = function (id) {
    if (!lbAdmin()) { alert('Seuls les administrateurs suppriment une fiche.'); return; }
    const f = lbParId(id); if (!f) return;
    const n = lbCompte(f, lbDossiers(), lbIndex());
    if (!confirm('Supprimer « ' + (f.nom || '') + ' » ?'
      + (n ? '\n\n' + n + ' dossier' + (n > 1 ? 's y sont rattachés' : ' y est rattaché')
           + ' : ils ne seront pas supprimés, mais ils repasseront « à rattacher ».' : ''))) return;
    if (typeof markDeleted === 'function') markDeleted('laboratoires', id);
    const l = lbListe(), i = l.findIndex(x => x && x.id === id);
    if (i >= 0) l.splice(i, 1);
    if (typeof logAction === 'function') logAction('Laboratoire supprimé', f.nom || '');
    lbSave(); lbRendBO();
  };

  // ── Rattacher et fusionner ────────────────────────────────────────────────
  // Rattacher, c'est ajouter l'orthographe à la fiche. Les dossiers ne sont pas
  // touchés : c'est tout le principe.
  window.lbRattacher = function (clef, ficheId) {
    const f = lbParId(parseInt(ficheId, 10)); if (!f) return;
    const e = lbNomsDesDossiers(lbDossiers()).get(clef); if (!e) return;
    f.alias = f.alias || [];
    if (f.alias.some(a => lbClef(a) === clef) || lbClef(f.nom) === clef) { lbRendBO(); return; }
    f.alias.push(e.texte);
    f.updatedAt = Date.now();
    if (typeof logAction === 'function') logAction('Laboratoire rattaché', e.texte + ' → ' + f.nom);
    lbSave(); lbRendBO();
  };

  // Absorber : la fiche conservée hérite du nom de l'autre EN ALIAS, sans quoi
  // les dossiers écrits sous l'autre orthographe seraient perdus de vue.
  window.lbFusionner = function (gardeId, absorbeId) {
    const g = lbParId(parseInt(gardeId, 10)), a = lbParId(parseInt(absorbeId, 10));
    if (!g || !a || g === a) return;
    if (!confirm('Conserver « ' + g.nom + ' » et y verser « ' + a.nom + ' » ?\n\n'
      + '« ' + a.nom + ' » disparaît du répertoire ; son nom reste sur la fiche conservée '
      + 'pour que ses dossiers continuent de la retrouver.')) return;
    lbAbsorber(g, a);
    if (typeof markDeleted === 'function') markDeleted('laboratoires', a.id);
    const l = lbListe(), i = l.findIndex(x => x && x.id === a.id);
    if (i >= 0) l.splice(i, 1);
    if (typeof logAction === 'function') logAction('Laboratoires fusionnés', a.nom + ' → ' + g.nom);
    lbSave(); lbRendBO();
  };
  // Le geste lui-même, isolé de la confirmation et de la suppression : c'est
  // lui qu'on éprouve.
  function lbAbsorber(g, a) {
    g.alias = g.alias || [];
    const poser = n => {
      if (n && lbClef(n) !== lbClef(g.nom) && !g.alias.some(x => lbClef(x) === lbClef(n))) g.alias.push(n);
    };
    poser(a.nom);
    (a.alias || []).forEach(poser);
    // Ce que la fiche conservée n'a pas, elle le prend. Ce qu'elle a, elle le
    // garde : c'est elle qu'on a choisi de conserver.
    ['adresse', 'cp', 'ville', 'tel', 'mail', 'note'].forEach(function (k) {
      if (!g[k] && a[k]) g[k] = a[k];
    });
    g.contacts = (g.contacts || []).concat((a.contacts || []).filter(function (c) {
      return c && !(g.contacts || []).some(x => x && ((x.mail && x.mail === c.mail)
        || (lbClef(x.nom) === lbClef(c.nom) && lbClef(x.prenom) === lbClef(c.prenom))));
    }));
    // Deux contacts « litiges » après fusion ne diraient plus à qui écrire.
    let vu = false;
    g.contacts.forEach(function (c) { if (c && c.litiges) { if (vu) c.litiges = false; else vu = true; } });
    g.updatedAt = Date.now();
    return g;
  }
  window.lbAbsorber = lbAbsorber;

  // ── Style ─────────────────────────────────────────────────────────────────
  const LB_CSS = `
  .lb-ongs{display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap}
  .lb-ong{border:1px solid var(--gray-200);background:#fff;border-radius:20px;padding:5px 13px;font:inherit;font-size:.8rem;font-weight:700;color:var(--gray-700);cursor:pointer;display:inline-flex;align-items:center;gap:6px}
  .lb-ong.sel{background:var(--g-pale);border-color:var(--g-mid);color:var(--g-dark)}
  .lb-ong .n{background:var(--gray-200);color:var(--gray-700);border-radius:9px;padding:0 6px;font-size:.7rem}
  .lb-ong .n.rouge{background:var(--red);color:#fff}
  .lb-barre{margin-bottom:10px}
  .lb-barre input{width:100%;max-width:340px;border:1px solid var(--gray-200);border-radius:8px;padding:7px 11px;font:inherit;font-size:.85rem}
  .lb-vide{padding:1.4rem 1rem;text-align:center;color:var(--gray-500);font-size:.85rem}
  .lb-expl{font-size:.8rem;color:var(--gray-500);line-height:1.55;margin:0 0 12px}
  .lb-alias{font-size:.72rem;color:var(--gray-500);margin-top:2px}
  .lb-manque{color:var(--red);font-size:.78rem}
  .lb-sel{border:1px solid var(--gray-200);border-radius:7px;padding:5px 8px;font:inherit;font-size:.78rem;background:#fff}
  .lb-sh{font-size:.76rem;font-weight:800;text-transform:uppercase;letter-spacing:.8px;color:var(--gray-700);margin:16px 0 6px}
  .lb-ct{display:grid;grid-template-columns:1fr 1fr 1.2fr .9fr 1.4fr auto auto;gap:6px;align-items:center;margin-bottom:6px}
  .lb-ct input{border:1px solid var(--gray-200);border-radius:7px;padding:6px 9px;font:inherit;font-size:.82rem;min-width:0;width:100%}
  .lb-cb{display:inline-flex;align-items:center;gap:4px;font-size:.74rem;color:var(--gray-700);white-space:nowrap}
  .lb-cb input{width:auto;border:none}
  .lb-x{border:none;background:none;color:var(--gray-500);cursor:pointer;font-size:.9rem;padding:0 4px}
  @media(max-width:820px){.lb-ct{grid-template-columns:1fr 1fr;gap:5px}}
  .lb-tag{display:inline-flex;align-items:center;gap:5px;background:var(--gray-100);border:1px solid var(--gray-200);border-radius:20px;padding:3px 9px;font-size:.78rem;margin:0 6px 6px 0}
  .lb-tag button{border:none;background:none;cursor:pointer;color:var(--gray-500);font-size:.8rem;padding:0}
  .lb-alias-l{display:flex;flex-wrap:wrap}
  .lb-grp{border:1px solid var(--gray-200);border-radius:11px;margin-bottom:10px;overflow:hidden}
  .lb-grp-h{background:var(--gray-100);padding:6px 12px;font-size:.74rem;font-weight:800;text-transform:uppercase;letter-spacing:.7px;color:var(--gray-700)}
  .lb-grp-l{display:flex;align-items:center;gap:10px;padding:8px 12px;border-top:1px solid var(--gray-200);font-size:.86rem}
  .lb-grp-l select{margin-left:auto}
  `;
  const st = document.createElement('style'); st.textContent = LB_CSS; document.head.appendChild(st);
}());
