// ═══════════════════════════════════════════════════════════════════════════
//  PATIENTS — la fiche qui raconte, et l'identité qui la porte
// ═══════════════════════════════════════════════════════════════════════════
//
//  LA DIFFICULTÉ N'EST PAS D'AGRÉGER, C'EST D'IDENTIFIER. Douze collections
//  stockent le nom du patient en TEXTE LIBRE, recopié à la saisie. Rapprocher,
//  c'est donc décider que deux chaînes désignent la même personne — et se
//  tromper là n'est pas un désagrément.
//
//  Une fiche qui OUBLIE une livraison se corrige. Une fiche qui ATTRIBUE à un
//  patient l'ordonnance d'un autre est une faute grave, et personne ne la voit
//  puisqu'elle s'affiche comme un fait. Tout ce qui suit découle de cette
//  asymétrie : dans le doute, on ne rattache pas, on signale.
//
//  LECTURE SEULE. Ce module ne modifie aucune collection métier. Si le
//  rapprochement se trompe, on corrige le code — jamais les données.
// ═══════════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ── La clé d'identité ────────────────────────────────────────────────────
  // MULLER, Müller et muller sont la même personne ; MARTIN Jean et MARTIN
  // Jean-Pierre ne le sont pas. On met à plat ce qui relève de la saisie —
  // casse, accents, ponctuation, espaces — et RIEN d'autre : réduire davantage
  // (ignorer les tirets d'un prénom composé, par exemple) ferait fusionner des
  // gens différents, ce qui est l'erreur qu'on refuse.
  function ptPlat(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // accents
      .toUpperCase()
      .replace(/['’`]/g, ' ')                              // O'BRIEN = O BRIEN
      .replace(/[^A-Z0-9-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  function ptClef(nom, prenom) { return ptPlat(nom) + '|' + ptPlat(prenom); }

  // Une date de naissance peut arriver en ISO, en français, ou pas du tout.
  // « — », chaîne vide, date invalide : autant d'absences, jamais une valeur.
  function ptNaiss(v) {
    const s = String(v == null ? '' : v).trim();
    if (!s || s === '—' || s === '-') return null;
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (m) return m[3] + '-' + m[2] + '-' + m[1];
    return null;
  }

  function ptAnnuaire() { return (typeof patients !== 'undefined' && Array.isArray(patients)) ? patients : []; }

  // Index clé → fiches. Reconstruit à chaque rendu : l'annuaire se remplit tout
  // seul depuis les modules métier, et un index mis en cache mentirait vite.
  function ptIndex() {
    const idx = new Map();
    ptAnnuaire().forEach(function (p) {
      const c = ptClef(p.nom, p.prenom);
      if (!idx.has(c)) idx.set(c, []);
      idx.get(c).push(p);
    });
    return idx;
  }

  // ── Le rattachement ──────────────────────────────────────────────────────
  // Rend toujours un verdict explicite. « sur » est le seul qui autorise à
  // afficher l'enregistrement sur une fiche ; tout le reste part dans la file.
  //
  //   sur      — un seul patient possible, rien ne le contredit
  //   homonyme — plusieurs patients portent ce nom, rien ne les départage
  //   ecart    — un seul patient, mais les dates de naissance divergent
  //   inconnu  — ce nom n'existe pas dans l'annuaire
  function ptRattacher(enr, idx) {
    const clef = ptClef(enr.nom, enr.prenom);
    if (clef === '|') return { etat: 'inconnu', clef: clef, candidats: [] };
    const cands = idx.get(clef) || [];
    const dEnr = ptNaiss(enr.dob);

    if (!cands.length) return { etat: 'inconnu', clef: clef, candidats: [] };

    if (cands.length === 1) {
      const dCand = ptNaiss(cands[0].dob);
      // Deux dates connues qui divergent : ce sont deux personnes, et le fait
      // qu'une seule fiche existe ne prouve rien — il en manque une.
      if (dEnr && dCand && dEnr !== dCand) {
        return { etat: 'ecart', clef: clef, candidats: cands, motif: 'date de naissance différente' };
      }
      return { etat: 'sur', clef: clef, patient: cands[0], candidats: cands };
    }

    // Homonymes. La date de naissance est le SEUL arbitre admis : deux MARTIN
    // Jean dans une officine qui sert 450 patients par jour, ce n'est pas une
    // hypothèse d'école.
    if (dEnr) {
      const exacts = cands.filter(function (p) { return ptNaiss(p.dob) === dEnr; });
      if (exacts.length === 1) return { etat: 'sur', clef: clef, patient: exacts[0], candidats: cands };
    }
    return { etat: 'homonyme', clef: clef, candidats: cands,
             motif: cands.length + ' patients portent ce nom' };
  }

  // ── Ce qu'on va chercher, et où ──────────────────────────────────────────
  // Chaque source dit comment lire un nom, une date et un libellé. Ajouter une
  // collection, c'est ajouter une ligne ici — pas toucher au reste.
  const SOURCES = [
    { coll: 'deliveries', type: 'livraison', lbl: 'Livraison', ico: '🚚', col: '#1D4ED8',
      quand: d => d.date, titre: d => 'Livraison — ' + (d.lieu || 'lieu non précisé'),
      detail: d => [d.notes, d.montant ? Number(d.montant).toFixed(2) + ' €' : '', DSTAT[d.status] || d.status].filter(Boolean).join(' · ') },
    { coll: 'preps', type: 'preparation', lbl: 'Préparation', ico: '⚗️', col: '#7C3AED',
      quand: p => p.date, titre: p => (p.type === 'devis' ? 'Devis' : 'Préparation') + (p.prep ? ' — ' + p.prep : ''),
      detail: p => [p.med, p.status].filter(Boolean).join(' · ') },
    { coll: 'renouvellements', type: 'renouvellement', lbl: 'Renouvellement', ico: '🔄', col: '#0D9488',
      quand: r => r.date, titre: r => r.lib || 'Ordonnance à préparer',
      detail: r => [r.presc, r.remise === 'livraison' ? 'livraison' : 'retrait comptoir'].filter(Boolean).join(' · ') },
    { coll: 'renouvArchives', type: 'renouvellement', lbl: 'Renouvellement (archive)', ico: '🔄', col: '#0D9488',
      quand: r => r.date, titre: r => r.lib || 'Ordonnance préparée', detail: r => r.presc || '' },
    { coll: 'credits', type: 'credit', lbl: 'Crédit', ico: '💶', col: '#B45309',
      quand: c => c.saisieAt || c.date, titre: c => (c.montant > 0 ? Number(c.montant).toFixed(2) + ' €' : 'Produit avancé'),
      detail: c => [c.motif, c.status].filter(Boolean).join(' · ') },
    { coll: 'locations', type: 'location', lbl: 'Matériel', ico: '🛏️', col: '#6A1B9A',
      quand: l => l.dateDebut || l.date, titre: l => 'Location — ' + (l.type || 'matériel'),
      detail: l => [l.num ? 'n° ' + l.num : '', l.status].filter(Boolean).join(' · ') },
    { coll: 'bpmList', type: 'bpm', lbl: 'BPM', ico: '📋', col: '#166534',
      quand: b => b.date || null, titre: b => 'Bilan partagé de médication',
      detail: b => [b.med, b.status, b.nb ? b.nb + ' médicaments' : ''].filter(Boolean).join(' · ') },
    { coll: 'smsLog', type: 'sms', lbl: 'SMS', ico: '📱', col: '#0277BD',
      quand: s => s.date, titre: s => 'SMS envoyé',
      detail: s => (s.erreur ? '⚠️ ' + s.erreur + ' · ' : '') + (s.text || '').slice(0, 120) }
  ];
  const DSTAT = { wait: 'à préparer', prep: 'en préparation', done: 'livrée', retrait: 'à retirer' };

  // `controles` et `retours` portent un patientRef structuré depuis leur
  // formulaire : quand il est là, on s'en sert plutôt que de relire le texte.
  const SOURCES_REF = [
    { coll: 'controles', type: 'controle', lbl: 'Contrôle lit', ico: '🔧', col: '#B91C1C',
      nom: c => (c.patientRef && c.patientRef.nom) || ptNomDeTexte(c.patient).nom,
      prenom: c => (c.patientRef && c.patientRef.prenom) || ptNomDeTexte(c.patient).prenom,
      quand: c => c.date, titre: c => 'Contrôle de lit médicalisé' + (c.num ? ' n° ' + c.num : ''),
      detail: c => [c.serie, c.controleur].filter(Boolean).join(' · ') },
    { coll: 'retours', type: 'retour', lbl: 'Retour matériel', ico: '↩️', col: '#6B7280',
      nom: r => (r.patientRef && r.patientRef.nom) || ptNomDeTexte(r.patient).nom,
      prenom: r => (r.patientRef && r.patientRef.prenom) || ptNomDeTexte(r.patient).prenom,
      quand: r => r.date, titre: r => 'Retour de matériel' + (r.num ? ' n° ' + r.num : ''),
      detail: r => [r.parc ? 'parc ' + r.parc : '', r.operateur].filter(Boolean).join(' · ') }
  ];

  // Un champ « patient » en texte libre : « THOMAS Liliane ». On sépare au
  // premier espace, le nom d'abord — c'est la convention de saisie de la
  // maison. Une séparation douteuse produira un « inconnu », pas un faux
  // rattachement, et c'est le comportement voulu.
  function ptNomDeTexte(txt) {
    const parts = String(txt || '').trim().split(/\s+/);
    if (!parts[0]) return { nom: '', prenom: '' };
    return { nom: parts[0], prenom: parts.slice(1).join(' ') };
  }

  function ptColl(nom) {
    try { const v = window[nom]; return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }

  // ── L'agrégation ─────────────────────────────────────────────────────────
  // Un seul balayage produit TOUT : la chronologie de chaque patient et la
  // file de ce qui n'a pas pu être rattaché. Deux parcours risqueraient de
  // diverger — et un compteur qui ment sur ce sujet, on a déjà donné.
  function ptBalayer() {
    const idx = ptIndex();
    const parPatient = new Map();   // id patient -> [evenements]
    const aRattacher = [];

    function verser(src, enr, nom, prenom, dob) {
      const quand = src.quand(enr) || null;
      const ev = { type: src.type, lbl: src.lbl, ico: src.ico, col: src.col,
                   quand: quand, titre: src.titre(enr) || src.lbl,
                   detail: src.detail(enr) || '', coll: src.coll, ref: enr.id };
      // Un identifiant patient posé à la saisie court-circuite tout le
      // rapprochement : c'est la seule voie qui ne peut pas se tromper.
      if (enr.patientId) {
        const direct = ptAnnuaire().find(function (p) { return p.id === enr.patientId; });
        if (direct) {
          if (!parPatient.has(direct.id)) parPatient.set(direct.id, []);
          parPatient.get(direct.id).push(ev);
          return;
        }
      }
      const v = ptRattacher({ nom: nom, prenom: prenom, dob: dob }, idx);
      if (v.etat === 'sur') {
        if (!parPatient.has(v.patient.id)) parPatient.set(v.patient.id, []);
        parPatient.get(v.patient.id).push(ev);
      } else {
        aRattacher.push({ ev: ev, nom: nom, prenom: prenom, dob: ptNaiss(dob),
                          etat: v.etat, motif: v.motif || '', candidats: v.candidats || [] });
      }
    }

    SOURCES.forEach(function (src) {
      ptColl(src.coll).forEach(function (enr) {
        if (!enr) return;
        verser(src, enr, enr.nom, enr.prenom, enr.dob);
      });
    });
    SOURCES_REF.forEach(function (src) {
      ptColl(src.coll).forEach(function (enr) {
        if (!enr) return;
        verser(src, enr, src.nom(enr), src.prenom(enr), enr.dob);
      });
    });

    // Chronologie : le plus récent d'abord. Les enregistrements sans date
    // arrivent en fin de liste plutôt que d'être jetés.
    parPatient.forEach(function (liste) {
      liste.sort(function (a, b) {
        if (!a.quand) return 1;
        if (!b.quand) return -1;
        return String(b.quand).localeCompare(String(a.quand));
      });
    });
    aRattacher.sort(function (a, b) { return String(b.ev.quand || '').localeCompare(String(a.ev.quand || '')); });

    return { parPatient: parPatient, aRattacher: aRattacher, index: idx };
  }

  // ── Les doublons de l'annuaire lui-même ──────────────────────────────────
  // Signalés, jamais fusionnés d'office : un nom de jeune fille et un nom
  // marital, ça se tranche en connaissant la personne.
  function ptDoublons() {
    const groupes = [];
    ptIndex().forEach(function (liste, clef) {
      if (liste.length > 1) {
        const dates = new Set(liste.map(function (p) { return ptNaiss(p.dob) || '?'; }));
        groupes.push({ clef: clef, fiches: liste,
          // Mêmes dates ou dates absentes : probablement la même personne
          // saisie deux fois. Dates différentes : deux personnes, et c'est sain.
          nature: dates.size === 1 ? 'doublon probable' : 'homonymes distincts' });
      }
    });
    return groupes;
  }

  window.ptPlat = ptPlat;
  window.ptClef = ptClef;
  window.ptNaiss = ptNaiss;
  window.ptRattacher = ptRattacher;
  window.ptBalayer = ptBalayer;
  window.ptDoublons = ptDoublons;
  window.ptNomDeTexte = ptNomDeTexte;
  window.PT_SOURCES = SOURCES.concat(SOURCES_REF);
})();

// ═══════════════════════════════════════════════════════════════════════════
//  L'ÉCRAN — liste, fiche, file à rattacher
// ═══════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const E = s => (typeof hEsc === 'function' ? hEsc(s) : String(s == null ? '' : s));
  const g = id => document.getElementById(id);
  let ptCache = null;              // dernier balayage
  let ptResListe = [];             // fiches affichées, pour l'accès par indice
  let ptVue = 'fiches';

  function ptInjecter() {
    if (g('pt-styles')) return;
    const st = document.createElement('style');
    st.id = 'pt-styles';
    st.textContent = `
      .pt-onglets{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:1rem}
      .pt-carte{border:1px solid var(--gray-200);border-radius:10px;padding:.7rem .9rem;margin-bottom:7px;
        display:flex;gap:12px;align-items:center;flex-wrap:wrap;cursor:pointer;background:#fff}
      .pt-carte:hover{border-color:var(--g-mid);box-shadow:0 2px 10px -6px rgba(0,0,0,.3)}
      .pt-nom{font-weight:700;font-size:.95rem;flex:1;min-width:170px}
      .pt-cpt{display:flex;gap:5px;flex-wrap:wrap}
      .pt-pastille{font-size:.72rem;padding:1px 8px;border-radius:20px;color:#fff;white-space:nowrap}
      .pt-vide{text-align:center;color:var(--gray-500);padding:1.6rem;font-size:.88rem}
      .pt-ev{display:grid;grid-template-columns:88px 26px 1fr;gap:0 10px;padding:9px 2px;
        border-top:1px solid var(--gray-200);align-items:start}
      .pt-ev-date{font-size:.76rem;color:var(--gray-500);white-space:nowrap;font-variant-numeric:tabular-nums}
      .pt-ev-t{font-weight:600;font-size:.87rem}
      .pt-ev-d{font-size:.79rem;color:var(--gray-600);line-height:1.45}
      .pt-alerte{background:#FFF3E0;border-radius:9px;padding:.7rem .9rem;font-size:.83rem;line-height:1.55;margin-bottom:.9rem}
      .pt-cand{display:inline-block;font-size:.76rem;border:1px solid var(--gray-200);border-radius:7px;
        padding:2px 9px;margin:3px 4px 0 0;background:var(--gray-100)}
    `;
    document.head.appendChild(st);
  }

  // ── Vue liste ────────────────────────────────────────────────────────────
  window.ptRender = function () {
    ptInjecter();
    const hote = g('pt-zone'); if (!hote) return;
    ptCache = window.ptBalayer();
    const q = (g('pt-q') && g('pt-q').value || '').toLowerCase().trim();

    const nRatt = ptCache.aRattacher.length;
    const dbl = window.ptDoublons();
    const nDbl = dbl.filter(x => x.nature === 'doublon probable').length;

    g('pt-onglets').innerHTML =
      bouton('fiches', 'Fiches patients', (typeof patients !== 'undefined' ? patients.length : 0))
      + bouton('rattacher', 'À rattacher', nRatt, nRatt ? '#B45309' : null)
      + bouton('doublons', 'Doublons', nDbl, nDbl ? '#B45309' : null);

    if (ptVue === 'rattacher') return ptVueRattacher(hote);
    if (ptVue === 'doublons') return ptVueDoublons(hote, dbl);

    const liste = (typeof patients !== 'undefined' ? patients : [])
      .filter(p => ((p.nom || '') + ' ' + (p.prenom || '')).toLowerCase().includes(q))
      .sort((a, b) => String(a.nom || '').localeCompare(String(b.nom || ''), 'fr'));
    ptResListe = liste;

    hote.innerHTML = liste.length ? liste.map(function (p, i) {
      const ev = ptCache.parPatient.get(p.id) || [];
      const parType = {};
      ev.forEach(e => { parType[e.type] = (parType[e.type] || 0) + 1; });
      const pastilles = window.PT_SOURCES
        .filter((s, j, arr) => arr.findIndex(x => x.type === s.type) === j)
        .filter(s => parType[s.type])
        .map(s => '<span class="pt-pastille" style="background:' + s.col + '">' + s.ico + ' ' + parType[s.type] + '</span>')
        .join('');
      return '<div class="pt-carte" onclick="ptFiche(' + i + ')">'
        + '<span class="pt-nom">' + E(p.nom) + ' ' + E(p.prenom)
        + (p.dob ? '<span style="font-weight:400;color:var(--gray-500);font-size:.8rem"> · ' + E(ptFr(p.dob)) + '</span>'
                 : '<span style="font-weight:400;color:#B45309;font-size:.78rem"> · date de naissance manquante</span>') + '</span>'
        + '<span class="pt-cpt">' + (pastilles || '<span style="font-size:.76rem;color:var(--gray-500)">aucune activité</span>') + '</span>'
        + '</div>';
    }).join('') : '<div class="pt-vide">Aucun patient' + (q ? ' ne correspond à la recherche' : '') + '.</div>';
  };

  function bouton(v, lbl, n, col) {
    return '<button class="btn ' + (ptVue === v ? 'bp' : 'bs') + '" onclick="ptSetVue(\'' + v + '\')">' + lbl
      + (n ? ' <span style="display:inline-block;min-width:18px;padding:0 5px;border-radius:20px;font-size:.74rem;'
             + 'background:' + (ptVue === v ? 'rgba(255,255,255,.28)' : (col || 'var(--gray-200)')) + ';'
             + 'color:' + (ptVue === v ? '#fff' : (col ? '#fff' : 'var(--gray-700)')) + '">' + n + '</span>' : '') + '</button>';
  }
  window.ptSetVue = function (v) { ptVue = v; window.ptRender(); };
  function ptFr(d) { const n = window.ptNaiss(d); return n ? n.split('-').reverse().join('/') : '—'; }

  // ── La fiche ─────────────────────────────────────────────────────────────
  window.ptFiche = function (i) {
    const p = ptResListe[i]; if (!p) return;
    const ev = (ptCache && ptCache.parPatient.get(p.id)) || [];
    // Ouvrir une fiche patient, c'est consulter des données de santé
    // rassemblées. Le journal des accès l'enregistre, comme le reste.
    if (typeof tracer === 'function') tracer('consultation', 'patient', p.id, 'Fiche patient ouverte');

    g('pt-fiche-titre').textContent = (p.nom || '') + ' ' + (p.prenom || '');
    const coord = [p.dob ? 'Né(e) le ' + ptFr(p.dob) : null, p.adresse, p.commune, p.tel, p.mail].filter(Boolean);
    g('pt-fiche-corps').innerHTML =
      '<div style="background:var(--g-pale);border-radius:9px;padding:.75rem .95rem;margin-bottom:1rem;font-size:.85rem;line-height:1.6">'
      + (coord.length ? coord.map(E).join(' · ') : '<span style="color:var(--gray-500)">Aucune coordonnée enregistrée.</span>')
      + (!p.dob ? '<div style="color:#B45309;margin-top:5px;font-size:.8rem">Sans date de naissance, cette fiche ne peut pas être départagée d\'un homonyme.</div>' : '')
      + '</div>'
      + (ev.length
          ? '<div style="font-size:.72rem;text-transform:uppercase;letter-spacing:.6px;font-weight:700;color:var(--gray-500);margin-bottom:.3rem">'
            + ev.length + ' événement(s)</div>'
            + ev.map(e =>
              '<div class="pt-ev">'
              + '<span class="pt-ev-date">' + (e.quand ? E(ptDateFr(e.quand)) : 'sans date') + '</span>'
              + '<span title="' + E(e.lbl) + '">' + e.ico + '</span>'
              + '<span><span class="pt-ev-t">' + E(e.titre) + '</span>'
              + (e.detail ? '<div class="pt-ev-d">' + E(e.detail) + '</div>' : '') + '</span></div>').join('')
          : '<div class="pt-vide">Aucune activité rattachée à ce patient.</div>');
    g('pt-ov').classList.add('pt-on');
  };
  window.ptFermer = function () { const o = g('pt-ov'); if (o) o.classList.remove('pt-on'); };
  function ptDateFr(d) {
    const x = new Date(String(d).length <= 10 ? String(d) + 'T12:00' : d);
    return isNaN(x) ? String(d) : x.toLocaleDateString('fr-FR');
  }

  // ── La file « à rattacher » ──────────────────────────────────────────────
  function ptVueRattacher(hote) {
    const f = ptCache.aRattacher;
    hote.innerHTML =
      '<div class="pt-alerte"><b>Ce que PILOT a refusé de rattacher.</b> Un enregistrement n\'apparaît sur une fiche '
      + 'que si l\'identité est certaine. Ici, elle ne l\'est pas — et attribuer l\'ordonnance d\'un patient à un autre '
      + 'serait pire que de ne rien afficher.<br>'
      + 'La correction se fait à la source : compléter la date de naissance de la fiche, ou corriger l\'orthographe '
      + 'dans le module concerné.</div>'
      + (f.length ? f.map(function (x) {
          const raison = x.etat === 'homonyme' ? 'Homonymes — ' + E(x.motif)
                      : x.etat === 'ecart' ? 'Date de naissance différente de la fiche'
                      : 'Ce nom n\'est pas dans l\'annuaire';
          return '<div class="pt-carte" style="cursor:default;align-items:flex-start">'
            + '<span style="width:26px">' + x.ev.ico + '</span>'
            + '<span style="flex:1;min-width:220px">'
            + '<span class="pt-ev-t">' + E(x.nom) + ' ' + E(x.prenom) + (x.dob ? ' · ' + E(x.dob.split('-').reverse().join('/')) : '') + '</span>'
            + '<div class="pt-ev-d">' + E(x.ev.lbl) + ' — ' + E(x.ev.titre)
            + (x.ev.quand ? ' · ' + E(ptDateFr(x.ev.quand)) : '') + '</div>'
            + '<div style="font-size:.78rem;color:#B45309;font-weight:600;margin-top:3px">' + raison + '</div>'
            + (x.candidats.length ? '<div>' + x.candidats.map(c =>
                '<span class="pt-cand">' + E(c.nom) + ' ' + E(c.prenom) + ' · ' + E(ptFr(c.dob)) + '</span>').join('') + '</div>' : '')
            + '</span></div>';
        }).join('')
        : '<div class="pt-vide">Rien en attente : chaque enregistrement a trouvé son patient.</div>');
  }

  // ── Les doublons de l'annuaire ───────────────────────────────────────────
  function ptVueDoublons(hote, dbl) {
    hote.innerHTML =
      '<div class="pt-alerte"><b>Deux fiches, une seule personne ?</b> Rien n\'est fusionné automatiquement : '
      + 'un nom de jeune fille et un nom marital, cela se tranche en connaissant la personne. '
      + 'Les fiches de dates de naissance différentes sont, elles, deux personnes bien distinctes — '
      + 'c\'est sain, et c\'est affiché pour que personne ne les fusionne par erreur.</div>'
      + (dbl.length ? dbl.map(function (gp) {
          const alerte = gp.nature === 'doublon probable';
          return '<div class="pt-carte" style="cursor:default;align-items:flex-start">'
            + '<span style="flex:1;min-width:220px">'
            + '<span class="pt-ev-t">' + E(gp.clef.replace('|', ' ')) + '</span>'
            + '<div style="font-size:.78rem;font-weight:600;margin-top:2px;color:' + (alerte ? '#B45309' : 'var(--gray-500)') + '">'
            + (alerte ? 'Doublon probable — mêmes nom, prénom et date' : 'Homonymes distincts — dates de naissance différentes') + '</div>'
            + '<div>' + gp.fiches.map(c => '<span class="pt-cand">' + E(c.nom) + ' ' + E(c.prenom) + ' · ' + E(ptFr(c.dob)) + '</span>').join('') + '</div>'
            + '</span></div>';
        }).join('')
        : '<div class="pt-vide">Aucun nom n\'apparaît deux fois dans l\'annuaire.</div>');
  }
})();
