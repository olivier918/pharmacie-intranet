/* ═══════════════════════════════════════════════════════════════════════════
   ANNUAIRE DES MÉDECINS

   Le prescripteur est écrit EN TEXTE LIBRE dans quatre endroits — les
   locations, les préparations, les bilans partagés, le cahier de transmission
   — et il y est écrit comme on l'a lu sur une ordonnance : « Dr Timsit »,
   « Dr TIMSIT Liliane », « Dr Liliane Timsit », « timsit ».

   TROIS DIFFICULTÉS, ET ELLES NE SE RESSEMBLENT PAS.

   1. LE NOM SEUL. La plupart des prescripteurs sont notés sans prénom. Un nom
      seul suffit tant qu'un seul médecin le porte ; dès qu'ils sont deux, il
      ne désigne plus personne. On rattache alors RIEN et on le signale — la
      doctrine du module patients, pour la même raison : une erreur de
      rattachement s'affiche comme un fait et personne ne la voit.

   2. L'ORDRE. « Dr TIMSIT Liliane » et « Dr Liliane Timsit » désignent la même
      personne. Plutôt que de deviner lequel des deux mots est le nom — ce que
      l'ancien code faisait, en prenant toujours le dernier, alors que
      l'autocomplétion écrit le nom en premier — on compare des ENSEMBLES de
      mots. L'ordre cesse d'être une question.

   3. L'HISTORIQUE. Corriger une fiche ne doit pas la vider de ses dossiers.
      Les orthographes rencontrées entrent en ALIAS, et c'est la fiche qui va
      au-devant du texte. On ne réécrit jamais les dossiers (piège n° 7).
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const E = s => (typeof hEsc === 'function' ? hEsc(s)
    : String(s == null ? '' : s).replace(/[&<>"]/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));
  const ico = n => (typeof window.ico === 'function') ? window.ico(n)
    : '<svg class="ico"><use href="#ic-' + n + '"></use></svg>';

  const mdListe = () => (typeof medecins !== 'undefined' && Array.isArray(medecins)) ? medecins : [];
  const mdAdmin = () => (typeof isAdmin === 'function') ? isAdmin() : false;
  const mdUser = () => (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null;
  const mdSave = () => { if (typeof saveNow === 'function') saveNow(); };

  // ── Mettre à plat, et retirer le titre ────────────────────────────────────
  // « Dr », « Dr. », « Docteur », « Pr » ne distinguent personne : deux fiches
  // qui ne différeraient que par là seraient la même.
  function mdPlat(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toUpperCase()
      .replace(/['’`]/g, ' ')
      .replace(/[^A-Z0-9-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  const MD_TITRES = { DR: 1, DRE: 1, DOCTEUR: 1, PR: 1, PROFESSEUR: 1, MME: 1, MR: 1, M: 1 };
  // Les mots qui restent une fois le titre retiré, sans ordre.
  function mdMots(s) {
    return mdPlat(s).split(' ').filter(function (m) { return m && !MD_TITRES[m]; });
  }
  // La signature d'un texte : ses mots, triés. « TIMSIT LILIANE » et
  // « LILIANE TIMSIT » ont la même. C'est ce qui règle la question de l'ordre.
  function mdSignature(s) {
    return mdMots(s).slice().sort().join(' ');
  }
  function mdSignatureFiche(f) {
    return f ? mdSignature((f.nom || '') + ' ' + (f.prenom || '')) : '';
  }
  window.mdMots = mdMots;
  window.mdSignature = mdSignature;

  // ── L'index ───────────────────────────────────────────────────────────────
  // Trois entrées, et elles ne servent pas à la même chose :
  //   signatures — l'ensemble complet des mots : c'est le rattachement sûr ;
  //   noms       — le nom seul, qui ne suffit QUE s'il est unique ;
  //   alias      — les orthographes déjà reconnues à la main.
  function mdIndex() {
    const signatures = new Map(), noms = new Map(), alias = new Map();
    const ranger = (m, c, f) => { if (!c) return; if (!m.has(c)) m.set(c, []); if (m.get(c).indexOf(f) < 0) m.get(c).push(f); };
    mdListe().forEach(function (f) {
      if (!f) return;
      ranger(signatures, mdSignatureFiche(f), f);
      ranger(noms, mdPlat(f.nom), f);
      (f.alias || []).forEach(function (a) {
        if (!a) return;
        ranger(alias, mdSignature(a), f);
      });
    });
    return { signatures: signatures, noms: noms, alias: alias };
  }

  // Rend toujours un verdict explicite. « sur » est le seul qui autorise à
  // afficher le médecin sur un dossier ; tout le reste part dans la file.
  //   sur      — un seul médecin possible
  //   homonyme — plusieurs portent ce nom, rien ne les départage
  //   inconnu  — personne ne porte ce nom
  function mdRattacher(texte, idx) {
    const sig = mdSignature(texte);
    if (!sig) return { etat: 'inconnu', sig: '', candidats: [] };

    const parAlias = idx.alias.get(sig) || [];
    if (parAlias.length === 1) return { etat: 'sur', sig: sig, medecin: parAlias[0], candidats: parAlias };

    const exacts = idx.signatures.get(sig) || [];
    if (exacts.length === 1) return { etat: 'sur', sig: sig, medecin: exacts[0], candidats: exacts };
    if (exacts.length > 1) return { etat: 'homonyme', sig: sig, candidats: exacts };

    // Un seul mot : c'est un nom de famille sans prénom, le cas le plus
    // fréquent. Il ne vaut que s'il ne désigne qu'une personne.
    const mots = mdMots(texte);
    if (mots.length === 1) {
      const c = idx.noms.get(mots[0]) || [];
      if (c.length === 1) return { etat: 'sur', sig: sig, medecin: c[0], candidats: c };
      if (c.length > 1) return { etat: 'homonyme', sig: sig, candidats: c };
    }
    return { etat: 'inconnu', sig: sig, candidats: [] };
  }
  window.mdRattacher = mdRattacher;
  window.mdIndex = mdIndex;

  // Le médecin d'un dossier, pour le reste de l'application.
  window.mdDuTexte = function (texte, idx) {
    const v = mdRattacher(texte, idx || mdIndex());
    return v.etat === 'sur' ? v.medecin : null;
  };

  // ── Où les prescripteurs sont écrits ──────────────────────────────────────
  // Ajouter une source, c'est ajouter une ligne ici — pas toucher au reste.
  function mdSources() {
    // Par le resolveur de la page : les collections sont declarees avec `let`
    // et ne sont pas des proprietes de `window`.
    const tab = function (n) {
      if (typeof window._collRef === 'function') {
        const v = window._collRef(n);
        if (Array.isArray(v)) return v;
      }
      return Array.isArray(window[n]) ? window[n] : [];
    };
    const out = [];
    tab('locations').forEach(l => { if (l && l.prescripteur) out.push({ texte: l.prescripteur, ou: 'location' }); });
    tab('preps').forEach(p => { if (p && p.med) out.push({ texte: p.med, ou: 'préparation' }); });
    tab('bpmList').forEach(b => { if (b && b.med) out.push({ texte: b.med, ou: 'bilan partagé' }); });
    tab('threads').forEach(t => {
      if (t && t.patient && t.patient.med) out.push({ texte: t.patient.med, ou: 'cahier' });
    });
    return out;
  }
  // Les écritures rencontrées, regroupées par signature : combien de dossiers,
  // et l'orthographe la plus fréquente — c'est elle qu'on proposera.
  function mdEcritures(sources) {
    const m = new Map();
    (sources || []).forEach(function (s) {
      const sig = mdSignature(s.texte); if (!sig) return;
      if (!m.has(sig)) m.set(sig, { sig: sig, n: 0, formes: {}, ou: {} });
      const e = m.get(sig);
      e.n++;
      const t = String(s.texte).trim();
      e.formes[t] = (e.formes[t] || 0) + 1;
      e.ou[s.ou] = (e.ou[s.ou] || 0) + 1;
    });
    m.forEach(function (e) {
      e.texte = Object.keys(e.formes).sort((a, b) => e.formes[b] - e.formes[a] || a.localeCompare(b, 'fr'))[0] || '';
    });
    return m;
  }
  // Ce qu'aucune fiche ne reconnaît sûrement : les inconnus ET les homonymes.
  // Un homonyme est un travail à faire, pas un dossier réglé.
  function mdARattacher(sources, idx) {
    const out = [];
    mdEcritures(sources).forEach(function (e) {
      const v = mdRattacher(e.texte, idx);
      if (v.etat !== 'sur') { e.etat = v.etat; e.candidats = v.candidats; out.push(e); }
    });
    return out.sort((a, b) => b.n - a.n || a.texte.localeCompare(b.texte, 'fr'));
  }
  window.mdARattacher = mdARattacher;
  window.mdEcritures = mdEcritures;
  window.mdSources = mdSources;

  // ── Les doublons de l'annuaire lui-même ───────────────────────────────────
  //   certain  — même ensemble de mots : « TIMSIT Liliane » et « Liliane TIMSIT »
  //   probable — même nom, et l'un des deux n'a pas de prénom
  function mdProches(a, b) {
    const sa = mdSignatureFiche(a), sb = mdSignatureFiche(b);
    if (!sa || !sb) return null;
    if (sa === sb) return 'certain';
    const na = mdPlat(a.nom), nb = mdPlat(b.nom);
    if (na && na === nb && (!mdPlat(a.prenom) || !mdPlat(b.prenom))) return 'probable';
    return null;
  }
  function mdDoublons(liste) {
    const l = (liste || []).filter(Boolean);
    const vus = {}, groupes = [];
    for (let i = 0; i < l.length; i++) {
      if (vus[i]) continue;
      const g = { fiches: [l[i]], degre: null };
      for (let j = i + 1; j < l.length; j++) {
        if (vus[j]) continue;
        const d = mdProches(l[i], l[j]);
        if (d) {
          g.fiches.push(l[j]); vus[j] = 1;
          g.degre = (g.degre === 'certain' || d === 'certain') ? 'certain' : 'probable';
        }
      }
      if (g.fiches.length > 1) { vus[i] = 1; groupes.push(g); }
    }
    return groupes;
  }
  window.mdProches = mdProches;
  window.mdDoublons = mdDoublons;

  // ── L'écran ───────────────────────────────────────────────────────────────
  const MD_CANAUX = ['', 'Doctolib', 'MSSanté', 'Apicrypt', 'Autre'];
  let mdVue = 'fiches';
  // null : pas de formulaire ouvert. '' : un nouveau. Sinon l'identifiant de
  // la fiche modifiée. Un identifiant de médecin est une chaîne (« md:TIMSIT »),
  // jamais 0 : la distinction tient.
  let mdEdite = null;
  let mdBrouillon = null;

  window.mdOnglet = function (v) { mdVue = v; mdRender(); };

  window.mdRender = function () {
    const el = document.getElementById('md-bo'); if (!el) return;
    const idx = mdIndex();
    const sources = mdSources();
    const rat = mdARattacher(sources, idx);
    const dbl = mdDoublons(mdListe());
    const q = ((document.getElementById('md-q') || {}).value || '').trim().toLowerCase();

    const ong = (k, lbl, n, alerte) => '<button class="md-ong' + (mdVue === k ? ' sel' : '') + '" onclick="mdOnglet(\'' + k + '\')">'
      + lbl + (n ? '<span class="n' + (alerte ? ' rouge' : '') + '">' + n + '</span>' : '') + '</button>';

    el.innerHTML = '<div class="md-ongs">'
      + ong('fiches', 'Fiches', mdListe().length)
      + ong('rattacher', 'À rattacher', rat.length, rat.length)
      + ong('doublons', 'Doublons', dbl.length, dbl.some(g => g.degre === 'certain'))
      + '</div>'
      + (mdVue === 'fiches' ? mdVueFiches(q, idx, sources)
         : mdVue === 'rattacher' ? mdVueRattacher(rat)
         : mdVueDoublons(dbl));
  };

  function mdCompte(f, sources, idx) {
    return (sources || []).filter(function (s) {
      const v = mdRattacher(s.texte, idx);
      return v.etat === 'sur' && v.medecin === f;
    }).length;
  }

  function mdVueFiches(q, idx, sources) {
    let h = mdEdite !== null ? mdFormulaire() : '<div style="margin:0 0 14px"><button class="btn bp" onclick="mdNouveau()">+ Nouveau médecin</button></div>';
    h += '<div class="md-barre"><input type="text" id="md-q" placeholder="Rechercher un médecin, une spécialité…" '
      + 'value="' + E(q) + '" oninput="mdRender()"></div>';
    const l = mdListe().filter(function (f) {
      if (!q) return true;
      return ((f.nom || '') + ' ' + (f.prenom || '') + ' ' + (f.spec || '') + ' ' + (f.cabinet || '')
        + ' ' + (f.alias || []).join(' ')).toLowerCase().includes(q);
    }).sort((a, b) => String(a.nom || '').localeCompare(String(b.nom || ''), 'fr', { sensitivity: 'base' }));

    if (!l.length) {
      return h + '<div class="md-vide">' + (mdListe().length
        ? 'Aucun médecin ne correspond à la recherche.'
        : 'L’annuaire est vide. L’onglet « À rattacher » liste les prescripteurs déjà cités dans vos dossiers : c’est le plus court chemin pour le remplir.') + '</div>';
    }
    return h + '<div class="twrap"><table><thead><tr>'
      + '<th>Médecin</th><th>Spécialité</th><th>Cabinet</th><th>Téléphone</th><th>Messagerie</th><th>Dossiers</th><th></th>'
      + '</tr></thead><tbody>'
      + l.map(function (f) {
          const n = mdCompte(f, sources, idx);
          return '<tr><td><strong>' + E(f.nom || '') + '</strong> ' + E(f.prenom || '')
            + ((f.alias || []).length ? '<div class="md-alias">aussi écrit : ' + E(f.alias.join(', ')) + '</div>' : '')
            + (f.note ? '<div class="md-alias">' + E(f.note) + '</div>' : '')
            + '</td>'
            + '<td>' + E(f.spec || '—') + '</td>'
            + '<td>' + E(f.cabinet || '—') + '</td>'
            + '<td>' + E(f.tel || '—') + '</td>'
            + '<td>' + (f.msgCanal ? E(f.msgCanal) + (f.msgId ? '<div class="md-alias">' + E(f.msgId) + '</div>' : '') : '<span class="md-manque">—</span>') + '</td>'
            + '<td>' + (n || '—') + '</td>'
            + '<td style="white-space:nowrap">'
            + '<button class="btn bs btn-ico" onclick="mdIntervertir(' + mdIdJs(f) + ')" title="Intervertir le nom et le prénom">⇄</button>'
            + '<button class="btn bs btn-ico" onclick="mdEditer(' + mdIdJs(f) + ')" title="Modifier">' + ico('modifier') + '</button>'
            + (mdAdmin() ? '<button class="btn bd btn-ico" onclick="mdSupprimer(' + mdIdJs(f) + ')" title="Supprimer">' + ico('corbeille') + '</button>' : '')
            + '</td></tr>';
        }).join('')
      + '</tbody></table></div>';
  }
  // Les identifiants de medecin sont des chaines (« md:TIMSIT ») : on passe
  // l'INDICE dans la liste, jamais le texte, et le gestionnaire va le lire.
  function mdIdJs(f) { return mdListe().indexOf(f); }
  function mdParIndice(i) { return mdListe()[i] || null; }

  function mdVueRattacher(rat) {
    if (!rat.length) return '<div class="md-vide">Tous les prescripteurs cités dans vos dossiers sont reconnus.</div>';
    return '<p class="md-expl">Ces écritures sont dans vos locations, préparations, bilans et le cahier de transmission, '
      + 'et aucune fiche ne les reconnaît <b>avec certitude</b>. <b>Rattacher</b> ajoute l’écriture à une fiche : '
      + 'les dossiers ne sont pas modifiés, c’est la fiche qui les rejoint.</p>'
      + '<div class="twrap"><table><thead><tr><th>Écrit dans les dossiers</th><th>Dossiers</th><th>Pourquoi</th><th></th></tr></thead><tbody>'
      + rat.map(function (e, i) {
          const ou = Object.keys(e.ou).map(k => e.ou[k] + ' ' + k + (e.ou[k] > 1 ? 's' : '')).join(', ');
          return '<tr><td><strong>' + E(e.texte) + '</strong><div class="md-alias">' + E(ou) + '</div></td>'
            + '<td>' + e.n + '</td>'
            + '<td>' + (e.etat === 'homonyme'
                ? '<span class="md-homo">' + e.candidats.length + ' médecins portent ce nom</span>'
                : '<span class="md-alias">aucune fiche</span>') + '</td>'
            + '<td style="white-space:nowrap">'
            + '<button class="btn bp sm" onclick="mdCreerDepuis(' + i + ')">Créer la fiche</button> '
            + mdChoixFiche(i)
            + '</td></tr>';
        }).join('')
      + '</tbody></table></div>';
  }
  // Le gestionnaire ne reçoit ni l'écriture ni l'identifiant : deux indices,
  // et il va lire le reste lui-même.
  function mdChoixFiche(i) {
    const l = mdListe();
    if (!l.length) return '';
    const ordre = l.map((f, k) => ({ f: f, k: k }))
      .sort((a, b) => String(a.f.nom || '').localeCompare(String(b.f.nom || ''), 'fr'));
    return '<select class="md-sel" onchange="mdRattacherA(' + i + ',this.value);this.value=\'\'">'
      + '<option value="">Rattacher à une fiche…</option>'
      + ordre.map(o => '<option value="' + o.k + '">' + E((o.f.nom || '') + ' ' + (o.f.prenom || '')) + '</option>').join('')
      + '</select>';
  }

  function mdVueDoublons(dbl) {
    if (!dbl.length) return '<div class="md-vide">Aucun doublon repéré dans l’annuaire.</div>';
    return '<p class="md-expl">Rapprochements <b>signalés, jamais faits d’office</b>. Choisissez la fiche à <b>conserver</b> : '
      + 'l’autre y verse son nom en alias, pour que ses dossiers continuent de la retrouver.</p>'
      + dbl.map(function (g) {
          return '<div class="md-grp"><div class="md-grp-h">'
            + (g.degre === 'certain' ? 'Mêmes nom et prénom' : 'Même nom, un prénom manquant') + '</div>'
            + g.fiches.map(function (f) {
                const autres = g.fiches.filter(x => x !== f);
                return '<div class="md-grp-l"><span><strong>' + E(f.nom || '') + '</strong> ' + E(f.prenom || '')
                  + (f.spec ? ' · ' + E(f.spec) : '') + '</span>'
                  + (mdAdmin()
                      ? '<select class="md-sel" onchange="mdFusionner(' + mdIdJs(f) + ',this.value);this.value=\'\'">'
                        + '<option value="">Absorber ici…</option>'
                        + autres.map(x => '<option value="' + mdIdJs(x) + '">' + E((x.nom || '') + ' ' + (x.prenom || '')) + '</option>').join('')
                        + '</select>'
                      : '')
                  + '</div>';
              }).join('')
            + '</div>';
        }).join('');
  }

  // ── Le formulaire ─────────────────────────────────────────────────────────
  function mdVide() {
    return { nom: '', prenom: '', spec: '', cabinet: '', tel: '', adresse: '',
             msgCanal: '', msgId: '', note: '', alias: [] };
  }
  window.mdNouveau = function () { mdEdite = ''; mdBrouillon = mdVide(); mdVue = 'fiches'; mdRender(); mdFocus(); };
  window.mdCreerDepuis = function (i) {
    const rat = mdARattacher(mdSources(), mdIndex());
    const e = rat[i];
    mdEdite = ''; mdBrouillon = mdVide();
    if (e) {
      // Le nom sans le titre. Un seul mot : c'est un nom de famille, le prénom
      // reste à remplir. Deux mots ou plus : on ne devine pas lequel est le
      // nom, on met tout dans le champ « nom » et l'on corrige d'un clic sur
      // « ⇄ » si l'on s'est trompé.
      const mots = String(e.texte || '').trim().split(/\s+/)
        .filter(m => !MD_TITRES[mdPlat(m)]);
      if (mots.length === 1) { mdBrouillon.nom = mots[0].toUpperCase(); }
      else if (mots.length > 1) {
        mdBrouillon.nom = mots[0].toUpperCase();
        mdBrouillon.prenom = mots.slice(1).join(' ');
      }
      // L'écriture rencontrée devient un alias : elle peut différer de ce
      // qu'on saisit ici, et ce sont les dossiers qui la portent.
      mdBrouillon.alias = [String(e.texte || '').trim()];
    }
    mdVue = 'fiches'; mdRender(); mdFocus();
  };
  window.mdEditer = function (i) {
    const f = mdParIndice(i); if (!f) return;
    // Une fiche ancienne peut n'avoir jamais reçu d'identifiant : on lui en
    // donne un avant de la modifier, sinon l'enregistrement en créerait une
    // seconde à côté.
    if (!f.id) f.id = (typeof medNouvelId === 'function') ? medNouvelId(f.nom) : ('md:' + (f.nom || ''));
    mdEdite = f.id;
    mdBrouillon = JSON.parse(JSON.stringify(f));
    mdBrouillon.alias = mdBrouillon.alias || [];
    mdVue = 'fiches'; mdRender(); mdFocus();
  };
  window.mdAnnuler = function () { mdEdite = null; mdBrouillon = null; mdRender(); };
  function mdFocus() { setTimeout(function () { const e = document.getElementById('md-f-nom'); if (e) e.focus(); }, 60); }
  function mdCourant() {
    if (!mdEdite) return null;
    return mdListe().find(f => f && f.id === mdEdite) || null;
  }

  function mdFormulaire() {
    const b = mdBrouillon || mdVide();
    const ch = (id, lbl, val, type, ph) => '<div class="fg"><label>' + lbl + '</label>'
      + '<input type="' + (type || 'text') + '" id="' + id + '" value="' + E(val || '') + '"'
      + (ph ? ' placeholder="' + E(ph) + '"' : '') + '></div>';
    return '<div class="card md-form">'
      + '<div class="ch"><span class="ct">' + (mdEdite ? 'Modifier — ' + E((b.nom || '') + ' ' + (b.prenom || '')) : 'Nouveau médecin') + '</span></div>'
      + '<div class="fgrid">'
      + ch('md-f-nom', 'Nom', b.nom, 'text', 'TIMSIT')
      + ch('md-f-prenom', 'Prénom', b.prenom, 'text', 'Liliane')
      + ch('md-f-spec', 'Spécialité', b.spec, 'text', 'Généraliste, Cardiologue…')
      + ch('md-f-cabinet', 'Cabinet / Structure', b.cabinet, 'text', 'Maison de santé…')
      + ch('md-f-tel', 'Téléphone', b.tel, 'tel', '02 31 …')
      + ch('md-f-adresse', 'Adresse', b.adresse, 'text', 'Adresse du cabinet')
      + '<div class="fg"><label>Messagerie sécurisée</label>'
      + '<select id="md-f-canal">' + MD_CANAUX.map(c =>
          '<option value="' + E(c) + '"' + (b.msgCanal === c ? ' selected' : '') + '>' + (c || '— aucune —') + '</option>').join('')
      + '</select></div>'
      + ch('md-f-msgid', 'Identifiant / adresse sur cette messagerie', b.msgId, 'text', 'Comment on le joint')
      + '</div>'
      + '<div class="fg" style="margin-top:12px"><label>Note</label>'
      + '<input type="text" id="md-f-note" value="' + E(b.note || '') + '" placeholder="Ne répond jamais au téléphone, passer par Doctolib…"></div>'
      + ((b.alias || []).length ? '<div class="md-sh">Aussi écrit</div>'
          + '<div class="md-alias-l">' + b.alias.map(function (a, i) {
              return '<span class="md-tag">' + E(a) + '<button onclick="mdAliasRetirer(' + i + ')" title="Retirer">✕</button></span>';
            }).join('') + '</div>'
          + '<p class="md-expl">Écritures rencontrées dans les dossiers. Les retirer défait le rattachement.</p>' : '')
      + '<div style="margin-top:14px;display:flex;gap:8px">'
      + '<button class="btn bp" onclick="mdEnregistrer()">' + ico('valider') + ' Enregistrer</button>'
      + '<button class="btn bs" onclick="mdAnnuler()">Annuler</button>'
      + '</div></div>';
  }
  window.mdAliasRetirer = function (i) {
    if (!mdBrouillon) return;
    mdBrouillon.alias.splice(i, 1); mdRender();
  };

  window.mdEnregistrer = function () {
    if (!mdUser()) { alert('Identifiez-vous avec votre code PIN.'); return; }
    const v = id => { const e = document.getElementById(id); return e ? e.value.trim() : ''; };
    const b = mdBrouillon || mdVide();
    b.nom = v('md-f-nom').toUpperCase(); b.prenom = v('md-f-prenom');
    b.spec = v('md-f-spec'); b.cabinet = v('md-f-cabinet');
    b.tel = v('md-f-tel'); b.adresse = v('md-f-adresse');
    b.msgCanal = v('md-f-canal'); b.msgId = v('md-f-msgid');
    b.note = v('md-f-note');
    if (!b.nom) { alert('Le nom du médecin est nécessaire.'); return; }
    const now = Date.now();
    const f = mdCourant();
    if (f) {
      Object.assign(f, b, { id: f.id, updatedAt: now });
    } else {
      b.id = (typeof medNouvelId === 'function') ? medNouvelId(b.nom) : ('md:' + b.nom);
      b.updatedAt = now;
      mdListe().push(b);
    }
    if (typeof logAction === 'function') logAction(f ? 'Médecin modifié' : 'Médecin ajouté', b.nom + ' ' + b.prenom);
    mdEdite = null; mdBrouillon = null;
    mdSave(); mdRender();
  };

  window.mdSupprimer = function (i) {
    if (!mdAdmin()) { alert('Seuls les administrateurs suppriment une fiche.'); return; }
    const f = mdParIndice(i); if (!f) return;
    const n = mdCompte(f, mdSources(), mdIndex());
    if (!confirm('Supprimer « ' + (f.nom || '') + ' ' + (f.prenom || '') + ' » ?'
      + (n ? '\n\n' + n + ' dossier(s) le citent : ils ne seront pas supprimés, mais ils repasseront « à rattacher ».' : ''))) return;
    if (typeof markDeleted === 'function') markDeleted('medecins', f.id);
    const l = mdListe(), k = l.indexOf(f);
    if (k >= 0) l.splice(k, 1);
    if (typeof logAction === 'function') logAction('Médecin supprimé', (f.nom || '') + ' ' + (f.prenom || ''));
    mdSave(); mdRender();
  };

  // Le geste d'inversion, déjà écrit pour les deux annuaires.
  window.mdIntervertir = function (i) {
    const f = mdParIndice(i); if (!f) return;
    const inv = (typeof nomInverse === 'function') ? nomInverse(f.nom, f.prenom) : null;
    if (!inv) { alert('Cette fiche n’a pas de prénom : il n’y a rien à intervertir.'); return; }
    const avant = (f.nom || '') + ' ' + (f.prenom || '');
    // L'ordre ne change pas la signature d'une fiche : ses dossiers la
    // retrouvent quoi qu'il arrive. Aucun alias à poser ici.
    f.nom = inv.nom; f.prenom = inv.prenom; f.updatedAt = Date.now();
    if (typeof logAction === 'function') logAction('Nom et prénom intervertis (médecin)', avant + ' → ' + f.nom + ' ' + f.prenom);
    mdSave(); mdRender();
  };

  // ── Rattacher et fusionner ────────────────────────────────────────────────
  window.mdRattacherA = function (iEcriture, iFiche) {
    const f = mdParIndice(parseInt(iFiche, 10)); if (!f) return;
    const e = mdARattacher(mdSources(), mdIndex())[iEcriture]; if (!e) return;
    f.alias = f.alias || [];
    if (mdSignature(f.nom + ' ' + f.prenom) !== e.sig
        && !f.alias.some(a => mdSignature(a) === e.sig)) {
      f.alias.push(e.texte);
    }
    f.updatedAt = Date.now();
    if (typeof logAction === 'function') logAction('Prescripteur rattaché', e.texte + ' → ' + f.nom + ' ' + f.prenom);
    mdSave(); mdRender();
  };

  window.mdFusionner = function (iGarde, iAbsorbe) {
    const g = mdParIndice(parseInt(iGarde, 10)), a = mdParIndice(parseInt(iAbsorbe, 10));
    if (!g || !a || g === a) return;
    if (!confirm('Conserver « ' + g.nom + ' ' + g.prenom + ' » et y verser « ' + a.nom + ' ' + a.prenom + ' » ?\n\n'
      + 'Son écriture reste sur la fiche conservée, pour que ses dossiers continuent de la retrouver.')) return;
    mdAbsorber(g, a);
    if (typeof markDeleted === 'function') markDeleted('medecins', a.id);
    const l = mdListe(), k = l.indexOf(a);
    if (k >= 0) l.splice(k, 1);
    if (typeof logAction === 'function') logAction('Médecins fusionnés', a.nom + ' → ' + g.nom);
    mdSave(); mdRender();
  };
  // Le geste lui-même, isolé de la confirmation et de la suppression.
  function mdAbsorber(g, a) {
    g.alias = g.alias || [];
    const sigG = mdSignatureFiche(g);
    const poser = n => {
      const s = mdSignature(n);
      if (s && s !== sigG && !g.alias.some(x => mdSignature(x) === s)) g.alias.push(n);
    };
    poser(((a.nom || '') + ' ' + (a.prenom || '')).trim());
    (a.alias || []).forEach(poser);
    // Ce que la fiche conservée n'a pas, elle le prend. Ce qu'elle a, elle le
    // garde : c'est elle qu'on a choisi de conserver.
    ['prenom', 'spec', 'cabinet', 'tel', 'adresse', 'msgCanal', 'msgId', 'note'].forEach(function (k) {
      if (!g[k] && a[k]) g[k] = a[k];
    });
    g.updatedAt = Date.now();
    return g;
  }
  window.mdAbsorber = mdAbsorber;

  // ── Style ─────────────────────────────────────────────────────────────────
  // Volontairement jumeau de celui du répertoire des laboratoires : deux
  // annuaires qui se ressemblent s'apprennent une seule fois. Les classes sont
  // distinctes pour que l'un ne casse pas l'autre.
  const MD_CSS = `
  .md-ongs{display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap}
  .md-ong{border:1px solid var(--gray-200);background:#fff;border-radius:20px;padding:5px 13px;font:inherit;font-size:.8rem;font-weight:700;color:var(--gray-700);cursor:pointer;display:inline-flex;align-items:center;gap:6px}
  .md-ong.sel{background:var(--g-pale);border-color:var(--g-mid);color:var(--g-dark)}
  .md-ong .n{background:var(--gray-200);color:var(--gray-700);border-radius:9px;padding:0 6px;font-size:.7rem}
  .md-ong .n.rouge{background:var(--red);color:#fff}
  .md-barre{margin-bottom:10px}
  .md-barre input{width:100%;max-width:340px;border:1px solid var(--gray-200);border-radius:8px;padding:7px 11px;font:inherit;font-size:.85rem}
  .md-vide{padding:1.4rem 1rem;text-align:center;color:var(--gray-500);font-size:.85rem}
  .md-expl{font-size:.8rem;color:var(--gray-500);line-height:1.55;margin:0 0 12px}
  .md-alias{font-size:.72rem;color:var(--gray-500);margin-top:2px}
  .md-manque{color:var(--gray-400)}
  .md-homo{color:#E65100;font-size:.78rem;font-weight:600}
  .md-sel{border:1px solid var(--gray-200);border-radius:7px;padding:5px 8px;font:inherit;font-size:.78rem;background:#fff}
  .md-sh{font-size:.76rem;font-weight:800;text-transform:uppercase;letter-spacing:.8px;color:var(--gray-700);margin:16px 0 6px}
  .md-tag{display:inline-flex;align-items:center;gap:5px;background:var(--gray-100);border:1px solid var(--gray-200);border-radius:20px;padding:3px 9px;font-size:.78rem;margin:0 6px 6px 0}
  .md-tag button{border:none;background:none;cursor:pointer;color:var(--gray-500);font-size:.8rem;padding:0}
  .md-alias-l{display:flex;flex-wrap:wrap}
  .md-grp{border:1px solid var(--gray-200);border-radius:11px;margin-bottom:10px;overflow:hidden}
  .md-grp-h{background:var(--gray-100);padding:6px 12px;font-size:.74rem;font-weight:800;text-transform:uppercase;letter-spacing:.7px;color:var(--gray-700)}
  .md-grp-l{display:flex;align-items:center;gap:10px;padding:8px 12px;border-top:1px solid var(--gray-200);font-size:.86rem}
  .md-grp-l select{margin-left:auto}
  `;
  const st = document.createElement('style'); st.textContent = MD_CSS; document.head.appendChild(st);
}());
