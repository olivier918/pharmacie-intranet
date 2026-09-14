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
  //
  // LES ALIAS. Fusionner deux fiches ne suffirait pas : l'historique est
  // rapproché PAR LE NOM, et une livraison saisie au nom de jeune fille ne
  // remonterait jamais sur la fiche au nom marital. La fiche survivante garde
  // donc le nom de celle qu'elle absorbe, et l'index la range sous les deux.
  // Sans cela, l'outil de fusion serait cosmétique.
  function ptIndex() {
    const idx = new Map();
    const ranger = (c, p) => { if (!idx.has(c)) idx.set(c, []); if (idx.get(c).indexOf(p) < 0) idx.get(c).push(p); };
    ptAnnuaire().forEach(function (p) {
      ranger(ptClef(p.nom, p.prenom), p);
      (p.alias || []).forEach(function (a) { if (a) ranger(ptClef(a.nom, a.prenom), p); });
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
      if (liste.length < 2) return;
      // UNE DATE ABSENTE N'EST PAS UNE DATE DIFFÉRENTE. La première version
      // comptait « ? » comme une valeur : une fiche datée et une fiche sans
      // date passaient pour deux personnes distinctes, et le bouton de fusion
      // disparaissait au moment précis où il servait. Seules les dates CONNUES
      // séparent.
      const connues = new Set();
      liste.forEach(function (p) { const d = ptNaiss(p.dob); if (d) connues.add(d); });
      const nature = connues.size > 1 ? 'homonymes distincts'
                   : connues.size === 1 ? 'doublon probable'
                   : 'a verifier';   // aucune date nulle part : l'humain tranche
      groupes.push({ clef: clef, fiches: liste, nature: nature, dates: connues.size });
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
//  L'ÉCRAN — une seule liste, maître à gauche, détail à droite
// ═══════════════════════════════════════════════════════════════════════════
//
//  Pas de fenêtre : une fiche qu'on consulte en travaillant ne doit pas
//  recouvrir le reste. On choisit à gauche, on lit à droite, on passe au
//  suivant sans rien fermer.
// ═══════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const E = s => (typeof hEsc === 'function' ? hEsc(s) : String(s == null ? '' : s));
  const g = id => document.getElementById(id);
  let cache = null, liste = [], choisi = null, vue = 'fiches', onglet = 'tout';
  let fusionDe = null;                 // fiche retenue pour une fusion

  function injecter() {
    if (g('pt-styles')) return;
    const st = document.createElement('style');
    st.id = 'pt-styles';
    st.textContent = `
      .pt-ecran{display:grid;grid-template-columns:290px 1fr;gap:16px;align-items:start}
      @media(max-width:820px){.pt-ecran{grid-template-columns:1fr}}
      .pt-gauche{display:flex;flex-direction:column;gap:9px;min-width:0}
      .pt-recherche{border:1px solid var(--gray-200);border-radius:8px;padding:8px 12px;font-size:.88rem;width:100%}
      .pt-onglets{display:flex;gap:5px;flex-wrap:wrap}
      .pt-onglets .btn{padding:4px 9px;font-size:.76rem}
      .pt-liste{max-height:62vh;overflow:auto;border:1px solid var(--gray-200);border-radius:10px}
      .pt-l{padding:8px 11px;border-bottom:1px solid var(--gray-200);cursor:pointer;font-size:.85rem;line-height:1.35}
      .pt-l:last-child{border-bottom:0}
      .pt-l:hover{background:var(--gray-100)}
      .pt-l.pt-sel{background:var(--g-pale);border-left:3px solid var(--g-mid);padding-left:8px}
      .pt-l b{font-weight:700}
      .pt-l span{display:block;font-size:.74rem;color:var(--gray-500)}
      .pt-droite{min-width:0}
      .pt-bloc{border:1px solid var(--gray-200);border-radius:11px;padding:.85rem 1rem;margin-bottom:12px}
      .pt-coord{display:flex;flex-wrap:wrap;gap:7px 18px;font-size:.85rem}
      .pt-coord div{min-width:150px}
      .pt-coord label{display:block;font-size:.7rem;text-transform:uppercase;letter-spacing:.5px;color:var(--gray-500)}
      .pt-ctx{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:.7rem}
      .pt-ctx button{font:inherit;font-size:.78rem;padding:3px 10px;border-radius:20px;cursor:pointer;
        border:1px solid var(--gray-200);background:#fff;color:var(--gray-700)}
      .pt-ctx button.on{background:var(--g-mid);border-color:var(--g-mid);color:#fff;font-weight:600}
      .pt-ev{display:grid;grid-template-columns:86px 24px 1fr;gap:0 10px;padding:8px 2px;
        border-top:1px solid var(--gray-200);align-items:start}
      .pt-ev-date{font-size:.75rem;color:var(--gray-500);white-space:nowrap;font-variant-numeric:tabular-nums}
      .pt-ev-t{font-weight:600;font-size:.86rem}
      .pt-ev-d{font-size:.78rem;color:var(--gray-600);line-height:1.45}
      .pt-vide{text-align:center;color:var(--gray-500);padding:1.4rem;font-size:.86rem}
      .pt-alerte{background:#FFF3E0;border-radius:9px;padding:.7rem .9rem;font-size:.82rem;line-height:1.55;margin-bottom:.8rem}
      .pt-cand{display:inline-block;font-size:.76rem;border:1px solid var(--gray-200);border-radius:7px;
        padding:2px 9px;margin:3px 4px 0 0;background:var(--gray-100)}
      .pt-alias{display:inline-block;font-size:.72rem;border-radius:20px;padding:1px 8px;margin-left:5px;
        background:var(--g-pale);color:var(--g-dark)}
    `;
    document.head.appendChild(st);
  }

  function fr(d) { const n = window.ptNaiss(d); return n ? n.split('-').reverse().join('/') : null; }
  function dateFr(d) {
    const x = new Date(String(d).length <= 10 ? String(d) + 'T12:00' : d);
    return isNaN(x) ? String(d) : x.toLocaleDateString('fr-FR');
  }
  const TYPES = () => window.PT_SOURCES.filter((s, i, a) => a.findIndex(x => x.type === s.type) === i);

  // ── Rendu ────────────────────────────────────────────────────────────────
  window.ptRender = function () {
    injecter();
    if (!g('pt-zone')) return;
    cache = window.ptBalayer();
    const dbl = window.ptDoublons();
    const nRatt = cache.aRattacher.length;
    // Le compteur annonce ce qu'il y a A FAIRE, donc les groupes fusionnables —
    // pas seulement les certains. Des homonymes distincts ne demandent rien.
    const nDbl = dbl.filter(x => x.nature !== 'homonymes distincts').length;

    g('pt-onglets').innerHTML =
      bt('fiches', 'Fiches') + bt('rattacher', 'À rattacher', nRatt) + bt('doublons', 'Doublons', nDbl);

    if (vue === 'fiches') rendreListe(); else g('pt-zone').innerHTML = '';
    const d = g('pt-detail');
    if (vue === 'rattacher') return vueRattacher(d);
    if (vue === 'doublons') return vueDoublons(d, dbl);
    rendreDetail(d);
  };
  function bt(v, lbl, n) {
    return '<button class="btn ' + (vue === v ? 'bp' : 'bs') + '" onclick="ptSetVue(\'' + v + '\')">' + lbl
      + (n ? ' <b style="color:' + (vue === v ? '#fff' : '#B45309') + '">' + n + '</b>' : '') + '</button>';
  }
  window.ptSetVue = function (v) { vue = v; window.ptRender(); };

  function rendreListe() {
    const q = (g('pt-q') && g('pt-q').value || '').toLowerCase().trim();
    liste = (typeof patients !== 'undefined' ? patients : [])
      .filter(p => (((p.nom || '') + ' ' + (p.prenom || '')) + ' '
        + (p.alias || []).map(a => a.nom + ' ' + a.prenom).join(' ')).toLowerCase().includes(q))
      .sort((a, b) => String(a.nom || '').localeCompare(String(b.nom || ''), 'fr'));
    if (choisi && !liste.some(p => p.id === choisi)) choisi = null;
    if (!choisi && liste.length) choisi = liste[0].id;
    g('pt-zone').innerHTML = liste.length ? liste.map(function (p, i) {
      const n = (cache.parPatient.get(p.id) || []).length;
      return '<div class="pt-l' + (p.id === choisi ? ' pt-sel' : '') + '" onclick="ptChoisir(' + i + ')">'
        + '<b>' + E(p.nom) + ' ' + E(p.prenom) + '</b>'
        + '<span>' + (fr(p.dob) || 'date de naissance manquante') + ' · ' + n + ' événement(s)'
        + ((p.alias || []).length ? ' · ' + p.alias.length + ' autre(s) nom(s)' : '') + '</span></div>';
    }).join('') : '<div class="pt-vide">Aucun patient' + (q ? ' ne correspond' : '') + '.</div>';
  }
  window.ptChoisir = function (i) {
    const p = liste[i]; if (!p) return;
    choisi = p.id; onglet = 'tout';
    if (typeof tracer === 'function') tracer('consultation', 'patient', p.id, 'Fiche patient ouverte');
    window.ptRender();
  };
  window.ptOnglet = function (t) { onglet = t; rendreDetail(g('pt-detail')); };

  // ── Le détail ────────────────────────────────────────────────────────────
  function rendreDetail(hote) {
    if (!hote) return;
    const p = (typeof patients !== 'undefined' ? patients : []).find(x => x.id === choisi);
    if (!p) { hote.innerHTML = '<div class="pt-vide">Choisissez un patient dans la liste.</div>'; return; }
    const ev = (cache && cache.parPatient.get(p.id)) || [];
    const parType = {}; ev.forEach(e => { parType[e.type] = (parType[e.type] || 0) + 1; });

    const coord = [['Né(e) le', fr(p.dob)], ['Adresse', p.adresse], ['Commune', p.commune],
                   ['Téléphone', p.tel], ['E-mail', p.mail]];
    const filtre = onglet === 'tout' ? ev : ev.filter(e => e.type === onglet);

    hote.innerHTML =
      // ── En haut : qui est-ce ──
      '<div class="pt-bloc">'
      + '<div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:.6rem">'
      + '<span style="font-weight:700;font-size:1.05rem;color:var(--g-dark)">' + E(p.nom) + ' ' + E(p.prenom) + '</span>'
      + (p.alias || []).map(a => '<span class="pt-alias">aussi ' + E(a.nom) + ' ' + E(a.prenom) + '</span>').join('')
      + '<span style="margin-left:auto;display:flex;gap:6px">'
      + (fusionDe && fusionDe !== p.id
          ? '<button class="btn bp sm" onclick="ptFusionner()">Fusionner ici</button>'
            + '<button class="btn bs sm" onclick="ptFusionAnnuler()">Annuler</button>'
          : '<button class="btn bs sm" onclick="ptFusionDepuis()">Fusionner cette fiche…</button>')
      + '</span></div>'
      + '<div class="pt-coord">' + coord.map(c => '<div><label>' + c[0] + '</label>'
          + (c[1] ? E(c[1]) : '<span style="color:var(--gray-400)">—</span>') + '</div>').join('') + '</div>'
      + (!p.dob ? '<div style="color:#B45309;font-size:.79rem;margin-top:.55rem">Sans date de naissance, cette fiche '
          + 'ne peut pas être départagée d\'un homonyme : ses livraisons partiront dans « À rattacher ».</div>' : '')
      + (fusionDe === p.id ? '<div class="pt-alerte" style="margin:.7rem 0 0">Fiche retenue pour la fusion. '
          + 'Choisissez maintenant dans la liste la fiche <b>à conserver</b>, puis « Fusionner ici ».</div>' : '')
      + '</div>'

      // ── En bas : ce qui s'est passé, par menu contextuel ──
      + '<div class="pt-bloc">'
      + '<div class="pt-ctx">'
      + '<button class="' + (onglet === 'tout' ? 'on' : '') + '" onclick="ptOnglet(\'tout\')">Tout (' + ev.length + ')</button>'
      + TYPES().filter(s => parType[s.type]).map(s =>
          '<button class="' + (onglet === s.type ? 'on' : '') + '" onclick="ptOnglet(\'' + s.type + '\')">'
          + s.ico + ' ' + E(s.lbl) + ' (' + parType[s.type] + ')</button>').join('')
      + '</div>'
      + (filtre.length ? filtre.map(e =>
          '<div class="pt-ev"><span class="pt-ev-date">' + (e.quand ? E(dateFr(e.quand)) : 'sans date') + '</span>'
          + '<span title="' + E(e.lbl) + '">' + e.ico + '</span>'
          + '<span><span class="pt-ev-t">' + E(e.titre) + '</span>'
          + (e.detail ? '<div class="pt-ev-d">' + E(e.detail) + '</div>' : '') + '</span></div>').join('')
        : '<div class="pt-vide">Aucune activité' + (onglet !== 'tout' ? ' de ce type' : '') + ' rattachée à ce patient.</div>')
      + '</div>';
  }

  // ── La fusion ────────────────────────────────────────────────────────────
  // Le seul geste de ce module qui ÉCRIT. Trois garde-fous :
  //   1. deux dates de naissance connues et différentes : refus net, ce sont
  //      deux personnes et les réunir mélangerait leurs ordonnances ;
  //   2. la fiche absorbée laisse son NOM en alias — sans quoi son historique,
  //      rapproché par le nom, disparaîtrait de la fiche survivante ;
  //   3. rien n'est écrasé : on ne comble que les champs vides.
  // Le geste lui-meme, isole : il sert la fusion piece a piece depuis une
  // fiche, et la fusion d'un groupe depuis l'ecran des doublons. Un seul
  // endroit ou les garde-fous sont ecrits.
  function absorber(src, cib) {
    const dS = window.ptNaiss(src.dob), dC = window.ptNaiss(cib.dob);
    if (dS && dC && dS !== dC) return { ok: false, motif: 'dates de naissance différentes' };
    ['dob', 'adresse', 'commune', 'tel', 'mail'].forEach(function (k) { if (!cib[k] && src[k]) cib[k] = src[k]; });
    cib.alias = cib.alias || [];
    const clefC = window.ptClef(cib.nom, cib.prenom);
    [{ nom: src.nom, prenom: src.prenom }].concat(src.alias || []).forEach(function (a) {
      if (!a || !a.nom) return;
      const k = window.ptClef(a.nom, a.prenom);
      if (k === clefC) return;
      if (cib.alias.some(x => window.ptClef(x.nom, x.prenom) === k)) return;
      cib.alias.push({ nom: a.nom, prenom: a.prenom });
    });
    cib.updatedAt = Date.now();
    patients.splice(patients.indexOf(src), 1);
    if (typeof logAction === 'function') logAction('Fusion de fiches patients', src.nom + ' ' + src.prenom + ' → ' + cib.nom + ' ' + cib.prenom);
    if (typeof tracer === 'function') tracer('modification', 'patient', cib.id, 'Fusion de deux fiches patients');
    return { ok: true };
  }
  // Laquelle survit ? La plus renseignee, et a egalite celle qui porte le plus
  // d'historique. Choisir au hasard ferait perdre des coordonnees.
  function laPlusComplete(fiches) {
    return fiches.slice().sort(function (a, b) {
      const remplis = p => ['dob', 'adresse', 'commune', 'tel', 'mail'].filter(k => p[k]).length;
      const ev = p => ((cache && cache.parPatient.get(p.id)) || []).length;
      return (remplis(b) - remplis(a)) || (ev(b) - ev(a));
    })[0];
  }

  // Fusion d'un groupe entier, depuis l'ecran des doublons.
  window.ptFusionGroupe = function (clef) {
    if (typeof isAdmin === 'function' && !isAdmin()) { alert('Réservé aux administrateurs.'); return; }
    const fiches = (typeof patients !== 'undefined' ? patients : [])
      .filter(p => window.ptClef(p.nom, p.prenom) === clef);
    if (fiches.length < 2) { window.ptRender(); return; }
    const cib = laPlusComplete(fiches);
    const autres = fiches.filter(p => p !== cib);
    const nEv = fiches.reduce((n, p) => n + ((cache && cache.parPatient.get(p.id)) || []).length, 0);

    if (!confirm('Réunir ' + fiches.length + ' fiches en une seule ?\n\n'
      + 'Fiche conservée : ' + cib.nom + ' ' + cib.prenom + (fr(cib.dob) ? ' (' + fr(cib.dob) + ')' : '')
      + ' — la plus renseignée.\n'
      + 'Absorbée(s) : ' + autres.map(p => p.nom + ' ' + p.prenom).join(', ') + '\n\n'
      + 'Les champs vides de la fiche conservée seront comblés ; aucun ne sera écrasé.\n'
      + 'Les noms absorbés sont gardés comme autres noms, pour que l\'historique saisi sous '
      + 'ces noms-là continue d\'y remonter'
      + (nEv ? ' (' + nEv + ' événement(s) concerné(s))' : '') + '.')) return;

    let faits = 0; const refus = [];
    autres.forEach(function (src) {
      const r = absorber(src, cib);
      if (r.ok) faits++; else refus.push(src.nom + ' ' + src.prenom + ' : ' + r.motif);
    });
    if (faits && typeof saveNow === 'function') saveNow();
    else if (faits && typeof schedSave === 'function') schedSave();
    if (refus.length) alert('Fusion partielle.\n\nNon fusionnée(s) :\n• ' + refus.join('\n• '));
    choisi = cib.id;
    window.ptRender();
  };

  window.ptFusionDepuis = function () { fusionDe = choisi; window.ptRender(); };
  window.ptFusionAnnuler = function () { fusionDe = null; window.ptRender(); };
  window.ptFusionner = function () {
    if (typeof isAdmin === 'function' && !isAdmin()) { alert('Réservé aux administrateurs.'); return; }
    const src = patients.find(x => x.id === fusionDe);
    const cib = patients.find(x => x.id === choisi);
    if (!src || !cib || src === cib) { fusionDe = null; return; }

    const dS = window.ptNaiss(src.dob), dC = window.ptNaiss(cib.dob);
    if (dS && dC && dS !== dC) {
      alert('Fusion refusée.\n\n' + src.nom + ' ' + src.prenom + ' est né(e) le ' + fr(src.dob)
        + ', et ' + cib.nom + ' ' + cib.prenom + ' le ' + fr(cib.dob) + '.\n\n'
        + 'Deux dates de naissance différentes désignent deux personnes. Les réunir mélangerait '
        + 'leurs ordonnances.\n\nSi l\'une des deux dates est fausse, corrigez-la d\'abord.');
      return;
    }
    const nEv = ((cache && cache.parPatient.get(src.id)) || []).length;
    if (!confirm('Fusionner « ' + src.nom + ' ' + src.prenom + ' » dans « ' + cib.nom + ' ' + cib.prenom + ' » ?\n\n'
      + 'La fiche conservée est « ' + cib.nom + ' ' + cib.prenom + ' ».\n'
      + 'Elle gardera « ' + src.nom + ' ' + src.prenom + ' » comme autre nom, pour que l\'historique saisi '
      + 'sous ce nom-là continue d\'y remonter'
      + (nEv ? ' (' + nEv + ' événement(s) concerné(s))' : '') + '.\n\n'
      + 'Les champs vides de la fiche conservée seront comblés ; aucun ne sera écrasé.')) return;

    if (!absorber(src, cib).ok) return;
    if (typeof saveNow === 'function') saveNow(); else if (typeof schedSave === 'function') schedSave();
    fusionDe = null; choisi = cib.id;
    window.ptRender();
  };

  // ── Les deux vues de contrôle ────────────────────────────────────────────
  function vueRattacher(hote) {
    const f = cache.aRattacher;
    hote.innerHTML = '<div class="pt-bloc">'
      + '<div class="pt-alerte"><b>Ce que PILOT a refusé de rattacher.</b> Un enregistrement n\'apparaît sur une '
      + 'fiche que si l\'identité est certaine — attribuer l\'ordonnance d\'un patient à un autre serait pire que '
      + 'de ne rien afficher.<br>La correction se fait à la source : compléter une date de naissance, corriger '
      + 'une orthographe, ou fusionner deux fiches.</div>'
      + (f.length ? f.map(function (x) {
          const raison = x.etat === 'homonyme' ? 'Homonymes — ' + E(x.motif)
                      : x.etat === 'ecart' ? 'Date de naissance différente de la fiche'
                      : 'Ce nom n\'est pas dans l\'annuaire';
          return '<div class="pt-ev"><span class="pt-ev-date">' + (x.ev.quand ? E(dateFr(x.ev.quand)) : '—') + '</span>'
            + '<span>' + x.ev.ico + '</span><span>'
            + '<span class="pt-ev-t">' + E(x.nom) + ' ' + E(x.prenom)
            + (x.dob ? ' · ' + E(x.dob.split('-').reverse().join('/')) : '') + '</span>'
            + '<div class="pt-ev-d">' + E(x.ev.lbl) + ' — ' + E(x.ev.titre) + '</div>'
            + '<div style="font-size:.77rem;color:#B45309;font-weight:600">' + raison + '</div>'
            + (x.candidats.length ? '<div>' + x.candidats.map(c => '<span class="pt-cand">' + E(c.nom) + ' '
                + E(c.prenom) + ' · ' + (fr(c.dob) || '?') + '</span>').join('') + '</div>' : '')
            + '</span></div>';
        }).join('') : '<div class="pt-vide">Rien en attente : chaque enregistrement a trouvé son patient.</div>')
      + '</div>';
  }
  function vueDoublons(hote, dbl) {
    hote.innerHTML = '<div class="pt-bloc">'
      + '<div class="pt-alerte"><b>Deux fiches, une seule personne ?</b> Rien n\'est fusionné automatiquement : '
      + 'un nom de jeune fille et un nom marital, cela se tranche en connaissant la personne. '
      + 'Les fiches de dates différentes sont deux personnes distinctes — affichées ici pour que '
      + 'personne ne les fusionne par erreur.</div>'
      + (dbl.length ? dbl.map(function (gp) {
          const al = gp.nature !== 'homonymes distincts';   // fusionnable
          const sur = gp.nature === 'doublon probable';
          // Le bouton n'apparait que sur les doublons probables : sur des
          // homonymes distincts, il ne ferait que declencher un refus, et un
          // bouton qui refuse toujours apprend a ignorer les refus.
          const garde = al ? laPlusComplete(gp.fiches) : null;
          return '<div class="pt-ev"><span class="pt-ev-date">' + (al ? '⚠️' : '') + '</span><span></span><span>'
            + '<div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">'
            + '<span class="pt-ev-t">' + E(gp.clef.replace('|', ' ')) + '</span>'
            + (al ? '<button class="btn bp sm" style="margin-left:auto" onclick="ptFusionGroupe(\''
                + E(gp.clef).replace(/'/g, '&#39;') + '\')">Réunir en une fiche</button>' : '')
            + '</div>'
            + '<div style="font-size:.77rem;font-weight:600;color:' + (al ? '#B45309' : 'var(--gray-500)') + '">'
            + (sur ? 'Doublon probable — même nom, et rien ne les sépare'
               : al ? 'À vérifier — aucune date de naissance pour départager'
               : 'Homonymes distincts — dates de naissance différentes') + '</div>'
            + '<div>' + gp.fiches.map(c => '<span class="pt-cand"'
                + (garde === c ? ' style="border-color:var(--g-mid);background:var(--g-pale);font-weight:600"' : '')
                + '>' + E(c.nom) + ' ' + E(c.prenom) + ' · ' + (fr(c.dob) || '?')
                + (garde === c ? ' — conservée' : '') + '</span>').join('') + '</div></span></div>';
        }).join('') : '<div class="pt-vide">Aucun nom n\'apparaît deux fois dans l\'annuaire.</div>')
      + '</div>';
  }
})();
