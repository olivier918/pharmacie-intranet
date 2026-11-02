/* ════════════════════════════════════════════════════════════════════════════
   PERFADOM — LA FICHE DE PRISE EN CHARGE ET SA FACTURATION

   Reprend la fiche papier que la pharmacie remplissait à la main, et lui
   ajoute ce qu'une feuille ne sait pas faire : déduire les forfaits, poser
   l'échéancier, et revenir réclamer la facturation au bon jour.

   LE PARTAGE DES RÔLES. Tout ce qui est règle de facturation vit dans
   `pf-moteur.js`, qui ne connaît ni le DOM ni PILOT et s'éprouve sans
   navigateur. Ce fichier-ci ne fait que montrer, saisir et enregistrer.

   CE QUI VA AILLEURS. L'échéance de facturation s'affiche dans la liste
   « À préparer » du module Renouvellement : c'est la liste que l'équipe ouvre
   le matin, et une alerte dans un écran qu'on n'ouvre pas n'est pas une
   alerte. Le module Renouvellement ne connaît pas PERFADOM pour autant — il
   appelle `window.pfDues()` et affiche ce qu'on lui rend.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const M = window.pfMoteur;
  if (!M) { console.warn('pf-module : moteur absent'); return; }

  function E(s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function g(id) { return document.getElementById(id); }
  function v(id) { const e = g(id); return e ? String(e.value || '').trim() : ''; }
  function ch(id) { const e = g(id); return !!(e && e.checked); }
  // LA COLLECTION EST CELLE DE LA PAGE, PAS UNE A NOUS. `perfadom` est
  // declaree en `let` dans index.html : une variable `let` de premier niveau
  // n'est PAS une propriete de `window`. Ecrire dans `window.perfadom`
  // creerait un second tableau, invisible de `saveAll` — les fiches
  // s'afficheraient, et rien ne partirait jamais au serveur. On passe donc par
  // le nom nu, qui se resout sur la declaration de la page.
  function pfListe() {
    if (typeof perfadom === 'undefined' || !Array.isArray(perfadom)) window.perfadom = [];
    return perfadom;
  }
  // POSER UNE FICHE DANS LA COLLECTION, PAR SON IDENTIFIANT. Jamais `push`
  // tout court : toutes les huit secondes, la resynchronisation REMPLACE le
  // tableau par celui du serveur. L'objet qu'on tient a l'ecran n'est alors
  // plus celui de la liste, et un `push` y ajouterait un deuxieme
  // enregistrement portant le meme identifiant — deux fiches pour un patient,
  // et la fusion par id qui en garde une au hasard.
  function pfPoser(f) {
    const l = pfListe(), i = l.findIndex(x => x && x.id === f.id);
    if (i >= 0) l[i] = f; else l.push(f);
    return f;
  }
  // La fiche TELLE QU'ELLE EST DANS LA COLLECTION maintenant. Noter une
  // facturation sur un objet perime reviendrait a effacer celle qu'un autre
  // poste vient d'enregistrer.
  function pfFraiche(id) { return pfListe().find(x => x && x.id === id) || null; }
  function pfUser() { return (typeof currentUser !== 'undefined' && currentUser) ? currentUser : { id: '?' }; }
  function pfPersist() { try { if (typeof saveAll === 'function') saveAll(); } catch (e) { console.warn('pf save', e); } }
  function pfAujourdhui() { return M.pfIso(new Date()); }
  function euro(n) { return (Math.round((n || 0) * 100) / 100).toFixed(2).replace('.', ',') + ' €'; }

  // Les consommables de la fiche d'origine, semaine par semaine. Ils ne se
  // facturent pas à part — ils sont DANS le forfait — mais on les note :
  // c'est ce qu'on prépare, ce qu'on livre, et ce qu'on retrouve si l'on
  // demande un jour ce qui a été fourni.
  const PF_CONSO = [
    ['set', 'Set de perfusion'], ['setci', 'Set pour chambre implantable'],
    ['perfuseur', 'Perfuseur'], ['catheter', 'Cathéter'],
    ['butterfly', 'Butterfly'], ['tegaderm', 'Tegaderm']
  ];
  // Le matériel à fournir, celui qu'on sort du tiroir en plus des
  // consommables. Olivier en a dicté la liste.
  const PF_MATERIEL = [
    ['pied', 'Pied à sérum'], ['aclasta', 'Kit Aclasta'], ['mediset', 'Mediset']
  ];
  // Les prestations du forfait d'installation. Elles ne rapportent rien de
  // plus : elles sont la contrepartie du forfait 6. La case cochée, datée et
  // signée est ce qui répond en cas de contrôle.
  const PF_MODALITES = [
    ['livraison', 'Livraison du matériel nécessaire au soin'],
    ['pied', 'Livraison d’un pied à sérum'],
    ['demo', 'Démonstration du matériel'],
    ['conseil', 'Conseil au patient ou à son entourage'],
    ['livret', 'Remise du livret au patient'],
    ['liaison', 'Liaison avec l’infirmière']
  ];

  const PF_CSS = `
  .pf-wrap{padding:0}
  .pf-tabs{display:inline-flex;background:#e7efe9;border-radius:9px;padding:3px;margin-bottom:12px}
  .pf-tab{border:none;background:none;padding:6px 12px;border-radius:7px;font-size:13px;font-weight:600;color:#4a5a52;cursor:pointer}
  .pf-tab.pf-act{background:#fff;color:#1D5C3A;box-shadow:0 1px 2px rgba(0,0,0,.08)}
  .pf-card{border:1px solid var(--gray-200,#e4e7e5);border-left:4px solid #1D5C3A;border-radius:10px;padding:11px 13px;margin-bottom:9px;background:#fff;display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap}
  .pf-card.pf-fini{border-left-color:#b9c3bd;opacity:.75}
  .pf-card .pf-qui{font-weight:700;font-size:15px}
  .pf-meta{font-size:12.5px;color:#6b7a72;margin-top:3px}
  .pf-tag{display:inline-block;padding:1px 7px;border-radius:9px;font-size:11.5px;font-weight:600;background:#e7efe9;color:#1D5C3A;margin-right:5px}
  .pf-tag.pf-du{background:#FDECEA;color:#B23A2F}
  .pf-tag.pf-ok{background:#E8F3EC;color:#1D5C3A}
  .pf-acts{margin-left:auto;display:flex;gap:6px;flex-wrap:wrap}
  .pf-btn{border:1px solid var(--gray-200,#e4e7e5);background:#fff;border-radius:7px;padding:5px 10px;font-size:12.5px;font-weight:600;cursor:pointer;color:#2c3a33}
  .pf-btn.pf-pri{background:#1D5C3A;border-color:#1D5C3A;color:#fff}
  .pf-btn:hover{filter:brightness(.97)}
  .pf-sec{border:1px solid var(--gray-200,#e4e7e5);border-radius:10px;padding:13px;margin-bottom:12px}
  .pf-sec > h3{margin:0 0 9px;font-size:12px;letter-spacing:.07em;text-transform:uppercase;color:#8AA89A}
  .pf-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px}
  .pf-f label{display:block;font-size:12px;font-weight:600;color:#53625a;margin-bottom:3px}
  .pf-f input[type=text],.pf-f input[type=number],.pf-f input[type=date],.pf-f select{width:100%;padding:7px 9px;border:1px solid var(--gray-200,#e4e7e5);border-radius:7px;font-size:13.5px;font-family:inherit}
  .pf-cbs{display:flex;flex-wrap:wrap;gap:8px 16px}
  .pf-cb{display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer}
  .pf-tbl{width:100%;border-collapse:collapse;font-size:12.5px}
  .pf-tbl th,.pf-tbl td{border:1px solid var(--gray-200,#e4e7e5);padding:4px 6px;text-align:center}
  .pf-tbl th:first-child,.pf-tbl td:first-child{text-align:left;font-weight:600}
  .pf-tbl input{width:46px;padding:3px;border:1px solid var(--gray-200,#e4e7e5);border-radius:5px;text-align:center;font-family:inherit}
  .pf-ctrl{border-radius:8px;padding:8px 11px;margin-bottom:7px;font-size:13px;line-height:1.45}
  .pf-ctrl.bloc{background:#FDECEA;color:#8A2B22;border-left:3px solid #B23A2F}
  .pf-ctrl.alerte{background:#FEF6E7;color:#7A5A12;border-left:3px solid #D79C27}
  .pf-ctrl.info{background:#EEF3F7;color:#3C5668;border-left:3px solid #7FA3BD}
  .pf-ech{width:100%;border-collapse:collapse;font-size:13px}
  .pf-ech th{text-align:left;font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:#8AA89A;padding:5px 7px;border-bottom:1px solid var(--gray-200,#e4e7e5)}
  .pf-ech td{padding:7px;border-bottom:1px solid #f0f2f1;vertical-align:top}
  .pf-ech tr.pf-fait{color:#8d9b94}
  .pf-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;background:#f2f5f3;border-radius:5px;padding:1px 6px}
  .pf-vide{text-align:center;color:#8d9b94;padding:22px;font-size:13.5px}
  .pf-note{font-size:12px;color:#7d8c84;line-height:1.5;margin-top:6px}
  `;

  const PF_SECTION = `
  <div class="card">
    <div class="ch">
      <span class="ct"><svg class="ico"><use href="#ic-ordonnance"></use></svg> Perfusions à domicile — PERFADOM</span>
      <button class="btn bp sm" onclick="pfNouvelle()">+ Nouvelle prise en charge</button>
    </div>
    <div class="pf-wrap">
      <div class="pf-tabs">
        <button class="pf-tab pf-act" id="pf-tab-cours" onclick="pfVue('cours')">En cours</button>
        <button class="pf-tab" id="pf-tab-fact" onclick="pfVue('fact')">À facturer</button>
        <button class="pf-tab" id="pf-tab-fini" onclick="pfVue('fini')">Terminées</button>
      </div>
      <div id="pf-liste"></div>
    </div>
  </div>
  <div class="card" id="pf-fiche" style="display:none"></div>`;

  // ── Injection ────────────────────────────────────────────────────────────
  function pfInject() {
    if (document.getElementById('pf-css')) return;
    const st = document.createElement('style'); st.id = 'pf-css'; st.textContent = PF_CSS;
    document.head.appendChild(st);
    const ref = document.querySelector('.sb-item[data-sec="renouvellement"]')
             || document.querySelector('.sb-item[data-sec="preparations"]');
    if (ref && !document.querySelector('.sb-item[data-sec="perfadom"]')) {
      const b = document.createElement('button');
      b.className = 'sb-item'; b.setAttribute('data-sec', 'perfadom');
      b.setAttribute('onclick', "showSec('perfadom',this)");
      b.innerHTML = '<svg class="ico sb-ico"><use href="#ic-ordonnance"></use></svg>'
        + '<span class="sb-label">Perfusions</span><span class="sb-badge" id="navb-pf" title="Forfaits à facturer"></span>';
      ref.insertAdjacentElement('afterend', b);
    }
    const sec = document.getElementById('sec-livraisons');
    if (sec && !document.getElementById('sec-perfadom')) {
      const s = document.createElement('section');
      s.id = 'sec-perfadom'; s.className = 'sec'; s.innerHTML = PF_SECTION;
      sec.parentNode.appendChild(s);
    }
  }

  // ── La liste ─────────────────────────────────────────────────────────────
  let pfVueCourante = 'cours';
  window.pfVue = function (x) {
    pfVueCourante = x;
    ['cours', 'fact', 'fini'].forEach(k => {
      const t = g('pf-tab-' + k); if (t) t.classList.toggle('pf-act', k === x);
    });
    pfRender();
  };

  function pfEnCours(f) {
    const fin = M.pfFin(f);
    return f.statut !== 'annulee' && (!fin || M.pfEcart(pfAujourdhui(), fin) >= 0);
  }
  function pfResteAFacturer(f) {
    const faites = f.facturees || {};
    return M.pfEcheancier(f).filter(e => !faites[e.no]).length;
  }

  window.pfRender = function () {
    pfInject();
    const el = g('pf-liste'); if (!el) return;
    const toutes = pfListe().filter(f => f && f.statut !== 'annulee');
    let l;
    if (pfVueCourante === 'cours') l = toutes.filter(pfEnCours);
    else if (pfVueCourante === 'fact') l = toutes.filter(f => pfResteAFacturer(f) > 0);
    else l = toutes.filter(f => !pfEnCours(f));
    l = l.slice().sort((a, b) => String(b.debut || '').localeCompare(String(a.debut || '')));
    if (!l.length) {
      el.innerHTML = '<div class="pf-vide">'
        + (pfVueCourante === 'fact' ? 'Rien à facturer : tous les forfaits dus ont été saisis.'
           : pfVueCourante === 'fini' ? 'Aucune prise en charge terminée.'
           : 'Aucune perfusion en cours. Le bouton « Nouvelle prise en charge » ouvre une fiche.')
        + '</div>';
    } else {
      el.innerHTML = l.map(pfCarte).join('');
    }
    if (typeof window.updateNavBadges === 'function') window.updateNavBadges();
  };

  function pfCarte(f) {
    const reste = pfResteAFacturer(f);
    const dues = M.pfDues([f], pfAujourdhui(), 0).length;
    const fin = M.pfFin(f);
    const type = (M.PF_TYPES[f.type] || {}).lbl || f.typeAutre || '—';
    return '<div class="pf-card' + (pfEnCours(f) ? '' : ' pf-fini') + '">'
      + '<div style="min-width:220px;flex:1">'
      + '<div class="pf-qui">' + E(f.nom) + ' ' + E(f.prenom) + '</div>'
      + '<div class="pf-meta">' + E(type) + ' · ' + E((M.PF_VOIES[f.voie] || {}).lbl || '—')
      + ' · du ' + M.pfFr(f.debut) + (fin ? ' au ' + M.pfFr(fin) : '') + '</div>'
      + '<div class="pf-meta" style="margin-top:5px">'
      + (dues ? '<span class="pf-tag pf-du">' + dues + ' forfait(s) à facturer aujourd’hui</span>' : '')
      + (reste ? '<span class="pf-tag">' + reste + ' échéance(s) restante(s)</span>'
               : '<span class="pf-tag pf-ok">Tout est facturé</span>')
      + '</div></div>'
      + '<div class="pf-acts">'
      + '<button class="pf-btn pf-pri" onclick="pfOuvrir(\'' + E(f.id) + '\')">Ouvrir</button>'
      + '<button class="pf-btn" onclick="pfPdf(\'' + E(f.id) + '\')">PDF</button>'
      + '</div></div>';
  }

  // ── La fiche ─────────────────────────────────────────────────────────────
  let pfCourante = null;

  window.pfNouvelle = function () {
    pfCourante = { id: 'pf:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                   mode: 'gravite', voie: 'iv', type: '', debut: pfAujourdhui(),
                   amm: true, materiel: {}, conso: {}, modalites: {}, facturees: {},
                   creePar: pfUser().id, createdAt: Date.now() };
    pfFicheRender(true);
  };
  window.pfOuvrir = function (id) {
    const f = pfListe().find(x => x && x.id === id); if (!f) return;
    pfCourante = f; pfFicheRender(false);
  };
  window.pfFermer = function () {
    pfCourante = null;
    const el = g('pf-fiche'); if (el) { el.style.display = 'none'; el.innerHTML = ''; }
    pfRender();
  };

  // La fiche se redessine à chaque changement de champ pour recalculer les
  // forfaits — mais JAMAIS pendant qu'on tape : on relit les champs dans
  // l'objet d'abord, on redessine ensuite, et le focus revient où il était.
  window.pfChamp = function () {
    if (!pfCourante) return;
    pfLireChamps();
    pfFicheRender(false, document.activeElement && document.activeElement.id);
  };

  function pfLireChamps() {
    const f = pfCourante; if (!f) return;
    f.nom = v('pf-nom').toUpperCase(); f.prenom = v('pf-prenom');
    f.dob = (typeof dobIso === 'function' ? (dobIso(v('pf-dob')) || '') : v('pf-dob'));
    f.adresse = v('pf-adresse'); f.tel = v('pf-tel');
    f.priseEnCharge = v('pf-pec'); f.livraison = v('pf-livr');
    f.prescripteur = v('pf-presc'); f.traitant = v('pf-trait');
    f.ide = v('pf-ide'); f.ideTel = v('pf-idetel');
    f.voie = v('pf-voie'); f.type = v('pf-type'); f.typeAutre = v('pf-typeautre');
    f.mode = (f.type === 'entretien') ? 'entretien' : 'gravite';
    f.debut = v('pf-debut'); f.fin = v('pf-fin');
    f.duree = v('pf-duree');
    f.perfSemaine = v('pf-persem');
    f.nbPerfusions = v('pf-nbperf');
    f.rythme = v('pf-rythme');
    f.amm = ch('pf-amm');
    f.materiel = f.materiel || {};
    PF_MATERIEL.forEach(m => { f.materiel[m[0]] = ch('pf-mat-' + m[0]); });
    f.materiel.autre = v('pf-mat-autre');
    f.conso = f.conso || {};
    PF_CONSO.forEach(c => { for (let s = 1; s <= 6; s++) {
      const x = v('pf-c-' + c[0] + '-' + s); if (x) f.conso[c[0] + s] = x; else delete f.conso[c[0] + s];
    } });
    f.modalites = f.modalites || {};
    PF_MODALITES.forEach(m => { f.modalites[m[0]] = ch('pf-mod-' + m[0]); });
    f.notes = v('pf-notes');
    f.updatedAt = Date.now();
  }

  // Le rythme saisi propose un forfait. On ne l'écrase que si l'équipe n'a pas
  // choisi : un forfait retenu à la main se respecte, et le moteur le signale
  // s'il s'écarte du rythme.
  function pfForfaitPropose(f) {
    return M.pfSuggereRythme(f.perfSemaine) || '';
  }

  function pfFicheRender(neuve, focusId) {
    pfInject();
    const f = pfCourante; const el = g('pf-fiche'); if (!f || !el) return;
    if (!f.rythme && f.mode !== 'entretien') f.rythme = pfForfaitPropose(f);
    const propose = pfForfaitPropose(f);
    const ech = M.pfEcheancier(f);
    const ctrls = M.pfControles(f, pfListe());
    const bloque = ctrls.some(c => c.niveau === 'bloc');
    const dejaEnregistree = !!pfFraiche(f.id);

    el.style.display = 'block';
    el.innerHTML = ''
      + '<div class="ch"><span class="ct">' + (neuve ? 'Nouvelle prise en charge' : 'Fiche PERFADOM — ' + E(f.nom) + ' ' + E(f.prenom)) + '</span>'
      + '<div style="display:flex;gap:7px">'
      + '<button class="pf-btn" onclick="pfPdf(\'' + E(f.id) + '\')">PDF</button>'
      + (dejaEnregistree ? '<button class="pf-btn" onclick="pfSupprimer()">Supprimer</button>' : '')
      + '<button class="pf-btn pf-pri" onclick="pfEnregistrer()">Enregistrer</button>'
      + '<button class="pf-btn" onclick="pfFermer()">Fermer</button></div></div>'

      // PATIENT
      + '<div class="pf-sec"><h3>Patient</h3><div class="pf-grid">'
      + champTexte('pf-nom', 'Nom', f.nom, "acPatient('pf-nom','pf-prenom','pf-dob','pf-ac','pf-tel',null,'pf-adresse',null)")
      + '<div class="ac-drop" id="pf-ac" style="display:none"></div>'
      + champTexte('pf-prenom', 'Prénom', f.prenom)
      + champTexte('pf-dob', 'Date de naissance', (typeof dobFr === 'function' ? dobFr(f.dob) : f.dob), 'dobMasque(this)', 'JJ/MM/AAAA')
      + '<div class="pf-f"><label>Âge</label><input type="text" value="' + E(pfAge(f.dob)) + '" disabled></div>'
      + champTexte('pf-adresse', 'Adresse', f.adresse)
      + champTexte('pf-tel', 'Téléphone', f.tel)
      + champDate('pf-pec', 'Date de prise en charge', f.priseEnCharge)
      + champDate('pf-livr', 'Date de livraison', f.livraison)
      + '</div></div>'

      // PRESCRIPTEURS
      + '<div class="pf-sec"><h3>Prescripteur et soignants</h3><div class="pf-grid">'
      + champTexte('pf-presc', 'Médecin prescripteur', f.prescripteur)
      + champTexte('pf-trait', 'Médecin traitant', f.traitant)
      + champTexte('pf-ide', 'Infirmière', f.ide)
      + champTexte('pf-idetel', 'Téléphone de l’infirmière', f.ideTel)
      + '</div></div>'

      // VOIE ET TYPE
      + '<div class="pf-sec"><h3>Voie d’abord et type de perfusion</h3><div class="pf-grid">'
      + '<div class="pf-f"><label>Voie</label><select id="pf-voie" onchange="pfChamp()">'
      + '<optgroup label="Voie périphérique">'
      + opt('sc', M.PF_VOIES.sc.lbl, f.voie) + opt('iv', M.PF_VOIES.iv.lbl, f.voie) + '</optgroup>'
      + '<optgroup label="Voie veineuse centrale">'
      + opt('picc', M.PF_VOIES.picc.lbl, f.voie) + opt('chambre', M.PF_VOIES.chambre.lbl, f.voie)
      + opt('catheter', M.PF_VOIES.catheter.lbl, f.voie) + '</optgroup></select></div>'
      + '<div class="pf-f"><label>Type de perfusion</label><select id="pf-type" onchange="pfChamp()">'
      + '<option value="">— choisir —</option>'
      + Object.keys(M.PF_TYPES).map(k => opt(k, M.PF_TYPES[k].lbl, f.type)).join('')
      + '</select></div>'
      + (f.type === 'autre' ? champTexte('pf-typeautre', 'Préciser', f.typeAutre) : '')
      + '</div></div>'

      // PRESCRIPTION ET RYTHME
      + '<div class="pf-sec"><h3>Prescription</h3><div class="pf-grid">'
      + champDate('pf-debut', 'Première perfusion', f.debut)
      + champDate('pf-fin', 'Dernier jour de cure', f.fin)
      + champNombre('pf-duree', 'ou durée (jours)', f.duree)
      + champNombre('pf-persem', 'Perfusions par semaine', f.perfSemaine)
      + champNombre('pf-nbperf', 'Nombre total de perfusions (facultatif)', f.nbPerfusions)
      + (f.mode === 'entretien' ? '' :
         '<div class="pf-f"><label>Forfait de consommables retenu</label><select id="pf-rythme" onchange="pfChamp()">'
         + '<option value="">— selon le rythme —</option>'
         + Object.keys(M.PF_RYTHMES).map(k => opt(k, 'Forfait ' + M.PF_FORFAITS[M.PF_RYTHMES[k].forfait].num
             + ' — ' + M.PF_RYTHMES[k].lbl, f.rythme)).join('')
         + '</select>'
         + (propose && f.rythme !== propose
            ? '<div class="pf-note">PILOT proposait le forfait '
              + M.PF_FORFAITS[M.PF_RYTHMES[propose].forfait].num + '.</div>' : '')
         + '</div>')
      + '</div>'
      + '<div class="pf-cbs" style="margin-top:9px">'
      + cb('pf-amm', 'Prescription conforme à l’AMM', f.amm !== false)
      + '</div>'
      + '<div class="pf-note">Le rythme suffit : PILOT en déduit le forfait, et le forfait reste modifiable. '
      + 'Jusqu’à 6 perfusions par semaine, c’est le forfait 17, à la perfusion ; à partir d’une par jour, '
      + 'c’est un forfait hebdomadaire.</div></div>'

      // MATÉRIEL À FOURNIR
      + '<div class="pf-sec"><h3>Matériel à fournir</h3>'
      + '<div class="pf-cbs">'
      + PF_MATERIEL.map(m => cb('pf-mat-' + m[0], m[1], (f.materiel || {})[m[0]])).join('')
      + '</div>'
      + '<div class="pf-grid" style="margin-top:9px">'
      + champTexte('pf-mat-autre', 'Autre — préciser', (f.materiel || {}).autre) + '</div>'
      + '<div class="pf-note">Ce matériel est compris dans les forfaits : il ne se facture pas à part. '
      + 'On le note pour savoir ce qui a été livré.</div></div>'

      // CONSOMMABLES S1..S6
      + '<div class="pf-sec"><h3>Matériel fourni, semaine par semaine</h3>'
      + '<div style="overflow-x:auto"><table class="pf-tbl"><thead><tr><th>Consommable</th>'
      + [1, 2, 3, 4, 5, 6].map(s => '<th>S' + s + '</th>').join('') + '</tr></thead><tbody>'
      + PF_CONSO.map(c => '<tr><td>' + c[1] + '</td>'
          + [1, 2, 3, 4, 5, 6].map(s => '<td><input type="number" min="0" id="pf-c-' + c[0] + '-' + s
              + '" value="' + E((f.conso || {})[c[0] + s] || '') + '" onchange="pfChamp()"></td>').join('')
          + '</tr>').join('')
      + '</tbody></table></div></div>'

      // MODALITÉS DU FORFAIT
      + (f.mode === 'entretien' ? '' :
         '<div class="pf-sec"><h3>Prestations comprises dans le forfait d’installation</h3>'
         + '<div class="pf-cbs">'
         + PF_MODALITES.map(m => cb('pf-mod-' + m[0], m[1], (f.modalites || {})[m[0]])).join('')
         + '</div>'
         + '<div class="pf-note">Elles ne rapportent rien de plus : elles sont la contrepartie du forfait 6. '
         + 'Cochées et datées, elles sont ce qui répond en cas de contrôle.</div></div>')

      // ORDONNANCE
      + '<div class="pf-sec"><h3>Ordonnance</h3>'
      + (f.scanId
         ? '<div style="margin-bottom:8px"><a href="/api/images/' + E(f.scanId) + '" target="_blank" rel="noopener">Voir l’ordonnance</a> '
           + '<button class="pf-btn" onclick="pfScanRetirer()">Retirer</button></div>'
         : '<div class="pf-note" style="margin:0 0 7px">Aucun scan joint.</div>')
      + '<input type="file" id="pf-scan" accept="image/*,application/pdf" onchange="pfScanDepose(this)">'
      + '</div>'

      // NOTES
      + '<div class="pf-sec"><h3>Notes</h3>'
      + '<textarea id="pf-notes" style="width:100%;min-height:60px;padding:8px;border:1px solid var(--gray-200,#e4e7e5);border-radius:7px;font-family:inherit;font-size:13.5px" onchange="pfChamp()">'
      + E(f.notes || '') + '</textarea></div>'

      // FACTURATION
      + '<div class="pf-sec" style="border-color:#1D5C3A"><h3>Facturation</h3>'
      + ctrls.map(c => '<div class="pf-ctrl ' + c.niveau + '">' + E(c.texte) + '</div>').join('')
      + (bloque
         ? '<div class="pf-note">Tant qu’un point rouge reste, l’échéancier n’est pas calculé.</div>'
         : pfEchHtml(f, ech))
      + '</div>';

    if (focusId) { const e = g(focusId); if (e && e.focus) { try { e.focus(); } catch (x) {} } }
  }

  function pfEchHtml(f, ech) {
    if (!ech.length) return '<div class="pf-note">Rien à facturer pour cette fiche.</div>';
    const faites = f.facturees || {};
    const auj = pfAujourdhui();
    let total = 0, reste = 0;
    const lignes = ech.map(function (e) {
      total += e.total;
      const fait = faites[e.no];
      if (!fait) reste += e.total;
      const retard = M.pfEcart(auj, e.duLe);
      const etat = fait
        ? '<span class="pf-tag pf-ok">Facturé le ' + M.pfFr(String(fait.le || '').slice(0, 10)) + '</span>'
        : (retard < 0 ? '<span class="pf-tag pf-du">En retard de ' + (-retard) + ' j</span>'
           : retard === 0 ? '<span class="pf-tag pf-du">À facturer aujourd’hui</span>'
           : '<span class="pf-tag">Dans ' + retard + ' j</span>');
      return '<tr class="' + (fait ? 'pf-fait' : '') + '">'
        + '<td><b>' + (e.type === 'installation' ? 'Installation' : e.type === 'entretien' ? 'Entretien' : 'Semaine ' + e.no) + '</b>'
        + '<div class="pf-meta">' + M.pfFr(e.du) + (e.au !== e.du ? ' → ' + M.pfFr(e.au) : '')
        // « Semaine incomplete » n'a de sens que pour un forfait HEBDOMADAIRE,
        // ou l'on facture une semaine entiere pour quelques jours. A la
        // perfusion, la duree de la semaine n'entre pas dans le calcul.
        + (e.complete === false && e.lignes.some(l => l.unite === 'semaine')
             ? ' · semaine incomplète' : '') + '</div></td>'
        + '<td>' + M.pfFr(e.duLe) + '<div class="pf-meta">' + etat + '</div></td>'
        + '<td>' + e.lignes.map(l => '<span class="pf-code">' + l.code + '</span> forfait ' + l.num
            + (l.qte !== 1 ? ' × ' + l.qte : '') + '<div class="pf-meta">' + E(l.lbl) + '</div>').join('') + '</td>'
        + '<td style="text-align:right;white-space:nowrap">' + euro(e.total) + '</td>'
        + '<td style="text-align:right">' + (fait
            ? '<button class="pf-btn" onclick="pfDefacturer(' + e.no + ')">Annuler</button>'
            : '<button class="pf-btn pf-pri" onclick="pfFacturer(' + e.no + ')">Facturé</button>') + '</td></tr>';
    }).join('');
    return '<div style="overflow-x:auto"><table class="pf-ech"><thead><tr>'
      + '<th>Période</th><th>Exigible</th><th>À saisir dans le LGO</th><th style="text-align:right">Montant</th><th></th>'
      + '</tr></thead><tbody>' + lignes + '</tbody></table></div>'
      + '<div class="pf-note">Total de la prise en charge : <b>' + euro(total) + '</b> · reste à facturer : <b>'
      + euro(reste) + '</b>. Tarifs relevés au ' + M.PF_TARIFS_AU + ' — c’est le code qui se saisit, le montant '
      + 'n’est là que pour relire.</div>';
  }

  function pfAge(dob) {
    if (!dob) return '';
    const d = new Date(String(dob).slice(0, 10) + 'T12:00'), n = new Date();
    if (isNaN(d)) return '';
    let a = n.getFullYear() - d.getFullYear();
    const m = n.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && n.getDate() < d.getDate())) a--;
    return a >= 0 && a < 130 ? a + ' ans' : '';
  }
  function opt(k, lbl, cur) { return '<option value="' + E(k) + '"' + (cur === k ? ' selected' : '') + '>' + E(lbl) + '</option>'; }
  function cb(id, lbl, coche) {
    return '<label class="pf-cb"><input type="checkbox" id="' + id + '"' + (coche ? ' checked' : '')
      + ' onchange="pfChamp()"> ' + E(lbl) + '</label>';
  }
  function champTexte(id, lbl, val, oninput, ph) {
    return '<div class="pf-f"><label>' + E(lbl) + '</label><input type="text" id="' + id + '" value="' + E(val || '')
      + '"' + (ph ? ' placeholder="' + E(ph) + '"' : '')
      + (oninput ? ' oninput="' + oninput + '"' : '') + ' onchange="pfChamp()" autocomplete="off"></div>';
  }
  function champDate(id, lbl, val) {
    return '<div class="pf-f"><label>' + E(lbl) + '</label><input type="date" id="' + id + '" value="'
      + E(val || '') + '" onchange="pfChamp()"></div>';
  }
  function champNombre(id, lbl, val) {
    return '<div class="pf-f"><label>' + E(lbl) + '</label><input type="number" min="0" id="' + id + '" value="'
      + E(val || '') + '" onchange="pfChamp()"></div>';
  }

  // ── Enregistrer, facturer ────────────────────────────────────────────────
  window.pfEnregistrer = function () {
    if (!pfCourante) return;
    pfLireChamps();
    const f = pfCourante;
    if (!f.nom || !f.prenom) { alert('Le nom et le prénom sont obligatoires.'); return; }
    // LA DATE DE NAISSANCE EST EXIGÉE À LA CRÉATION, comme partout ailleurs :
    // c'est elle qui sépare deux homonymes, et ici elle sert aussi à retrouver
    // la cure précédente du même patient.
    if (typeof dobExigee === 'function') {
      const d = dobExigee('pf-dob', !!pfFraiche(f.id));
      if (d === null) return;
      if (d) f.dob = d;
    }
    f.updatedAt = Date.now();
    pfPoser(f);
    if (typeof upsertPatient === 'function')
      upsertPatient({ nom: f.nom, prenom: f.prenom, dob: f.dob, adresse: f.adresse, tel: f.tel });
    pfPersist(); pfRender(); pfFicheRender(false);
  };

  window.pfSupprimer = function () {
    if (!pfCourante) return;
    if (!confirm('Supprimer la fiche de ' + pfCourante.nom + ' ' + pfCourante.prenom + ' ?')) return;
    const l = pfListe(), i = l.findIndex(x => x.id === pfCourante.id);
    if (i >= 0) l.splice(i, 1);
    pfPersist(); pfFermer();
  };

  // FACTURER, C'EST NOTER QU'ON A SAISI DANS LE LGO. PILOT ne facture rien :
  // il dit quoi saisir, et retient que ça l'a été, par qui et quand.
  // On marque la facturation SUR LA FICHE DE LA COLLECTION, pas sur celle
  // qu'on tient a l'ecran : entre les deux, la resynchronisation a pu apporter
  // la semaine qu'un autre poste vient de facturer, et on ne l'efface pas.
  function pfNoter(id, no, valeur) {
    const cible = pfFraiche(id) || pfCourante;
    if (!cible) return null;
    cible.facturees = cible.facturees || {};
    if (valeur) cible.facturees[no] = valeur; else delete cible.facturees[no];
    cible.updatedAt = Date.now();
    pfPoser(cible);
    if (pfCourante && pfCourante.id === id && pfCourante !== cible) pfCourante = cible;
    pfPersist();
    return cible;
  }
  window.pfFacturer = function (no) {
    if (!pfCourante) return;
    pfNoter(pfCourante.id, no, { le: new Date().toISOString(), par: pfUser().id });
    pfFicheRender(false); pfRender();
  };
  window.pfDefacturer = function (no) {
    if (!pfCourante) return;
    pfNoter(pfCourante.id, no, null);
    pfFicheRender(false); pfRender();
  };
  // Depuis la liste « À préparer » du module Renouvellement : on ne passe pas
  // par la fiche ouverte, donc on vise la fiche par son identifiant.
  window.pfFacturerDepuis = function (ficheId, no) {
    if (!pfFraiche(ficheId)) return;
    pfNoter(ficheId, no, { le: new Date().toISOString(), par: pfUser().id });
    if (typeof window.rnRender === 'function') window.rnRender();
    // LA FICHE OUVERTE DOIT SUIVRE. Facturee depuis une autre liste, elle
    // resterait sinon a l'ecran avec son echeance encore due, et on la
    // facturerait une seconde fois.
    if (pfCourante && pfCourante.id === ficheId) pfFicheRender(false);
    pfRender();
  };

  // ── Le scan de l'ordonnance ──────────────────────────────────────────────
  // Il part dans le coffre à images (table chiffrée), comme les ordonnances
  // des autres modules : jamais dans le blob de données, qui part en clair à
  // chaque synchronisation.
  window.pfScanDepose = function (input) {
    const f = pfCourante; if (!f || !input || !input.files || !input.files[0]) return;
    const fic = input.files[0];
    const fr = new FileReader();
    fr.onload = function () {
      const envoyer = (typeof imgTeleverser === 'function') ? imgTeleverser : null;
      if (!envoyer) { alert('Dépôt d’image indisponible sur ce poste.'); return; }
      Promise.resolve(envoyer(fr.result)).then(function (id) {
        f.scanId = id; f.updatedAt = Date.now();
        if (pfFraiche(f.id)) { pfPoser(f); pfPersist(); }
        pfFicheRender(false);
      });
    };
    fr.readAsDataURL(fic);
  };
  window.pfScanRetirer = function () {
    const f = pfCourante; if (!f) return;
    delete f.scanId; f.updatedAt = Date.now();
    if (pfFraiche(f.id)) { pfPoser(f); pfPersist(); }
    pfFicheRender(false);
  };

  // ── Ce que le module Renouvellement vient chercher ───────────────────────
  // Une échéance due devient une ligne datée dans « À préparer ». Elle ne vit
  // pas dans `renouvellements` : elle est calculée à la volée, à partir des
  // fiches. Deux métiers, une seule liste — mais une seule source pour chacun.
  window.pfDues = function (jours) {
    try { return M.pfDues(pfListe(), pfAujourdhui(), jours == null ? 0 : jours); }
    catch (e) { console.warn('pfDues', e); return []; }
  };
  // Le compte de ce qui est dû AUJOURD'HUI, pour la pastille de la barre.
  window.pfDueCount = function () { try { return window.pfDues(0).length; } catch (e) { return 0; } };

  // ── Le PDF ───────────────────────────────────────────────────────────────
  // Même gabarit que les autres documents de l'officine : en-tête de la
  // pharmacie, pas de logo d'un fournisseur. La fiche appartient au dossier du
  // patient, pas à un catalogue.
  window.pfPdf = function (id) {
    const f = (id && pfListe().find(x => x && x.id === id)) || pfCourante;
    if (!f) return;
    const JP = window.jspdf && window.jspdf.jsPDF;
    if (!JP) { alert('Générateur PDF indisponible.'); return; }
    const d = new JP({ unit: 'mm', format: 'a4' });
    let FONT = 'helvetica';
    try {
      if (window.GOTHAM_FONT_B64) {
        d.addFileToVFS('Gotham.ttf', window.GOTHAM_FONT_B64);
        ['normal', 'bold', 'italic', 'bolditalic'].forEach(st => d.addFont('Gotham.ttf', 'gotham', st));
        FONT = 'gotham';
      }
    } catch (e) {}
    const O = (typeof OFFICINE !== 'undefined') ? OFFICINE : { nom: 'Pharmacie', adresse: '', cp: '', ville: '', tel: '', mail: '' };
    const M_ = 16, R = 210 - 16, W = R - M_;
    let y = 0;
    function entete() {
      try { if (window.NORMANDIE_LOGO) d.addImage(NORMANDIE_LOGO, 'PNG', M_, 13, 40, 40 * 682 / 1385); } catch (e) {}
      d.setFont(FONT, 'bold'); d.setFontSize(12.5); d.setTextColor(29, 92, 58);
      d.text(O.nom, R, 18, { align: 'right' });
      d.setFont(FONT, 'normal'); d.setFontSize(8.5); d.setTextColor(107, 107, 107);
      d.text((O.adresse || '') + ' · ' + (O.cp || '') + ' ' + (O.ville || ''), R, 23, { align: 'right' });
      d.text((O.tel || '') + ' · ' + (O.mail || ''), R, 27, { align: 'right' });
      d.setDrawColor(46, 125, 84); d.setLineWidth(0.6); d.line(M_, 33, R, 33);
      d.setDrawColor(207, 230, 216); d.setLineWidth(0.3); d.line(M_, 34.4, R, 34.4);
      y = 41;
    }
    function pied() {
      d.setDrawColor(236, 236, 236); d.setLineWidth(0.2); d.line(M_, 280, R, 280);
      d.setFont(FONT, 'normal'); d.setFontSize(7); d.setTextColor(176, 176, 176);
      d.text(O.nom + ' · ' + (O.adresse || '') + ', ' + (O.cp || '') + ' ' + (O.ville || '') + ' · Tél. ' + (O.tel || ''), M_, 285);
      d.setFontSize(6.6);
      d.text('Document interne de prise en charge d’une perfusion à domicile. Tarifs des forfaits relevés au '
        + M.PF_TARIFS_AU + ' — seuls les codes LPP font foi auprès de l’Assurance maladie.', M_, 289);
    }
    function place(h) { if (y + h > 272) { pied(); d.addPage(); entete(); } }
    function titre(t) {
      place(12); d.setFont(FONT, 'bold'); d.setFontSize(8); d.setTextColor(138, 168, 154);
      d.text(t.toUpperCase(), M_, y); y += 5.5;
    }
    function ligne(lbl, val) {
      place(6); d.setFont(FONT, 'normal'); d.setFontSize(9); d.setTextColor(120, 120, 120);
      d.text(lbl, M_, y);
      d.setFont(FONT, 'bold'); d.setTextColor(26, 26, 26);
      d.text(String(val == null || val === '' ? '—' : val), M_ + 52, y);
      y += 5.4;
    }

    entete();
    d.setFont(FONT, 'bold'); d.setFontSize(17); d.setTextColor(29, 92, 58);
    d.text('Perfusion à domicile', M_, y); y += 2.4;
    d.setFillColor(46, 125, 84); d.rect(M_, y, 24, 1.1, 'F'); y += 5.6;
    d.setFont(FONT, 'italic'); d.setFontSize(9.5); d.setTextColor(140, 140, 140);
    d.text('Fiche de prise en charge', M_, y); y += 9;

    titre('Patient');
    ligne('Nom et prénom', (f.nom || '') + ' ' + (f.prenom || ''));
    ligne('Né(e) le', (typeof dobFr === 'function' ? dobFr(f.dob) : f.dob) + (pfAge(f.dob) ? '   (' + pfAge(f.dob) + ')' : ''));
    ligne('Adresse', f.adresse); ligne('Téléphone', f.tel);
    ligne('Prise en charge le', M.pfFr(f.priseEnCharge)); ligne('Livraison le', M.pfFr(f.livraison));
    y += 3;
    titre('Prescripteur et soignants');
    ligne('Médecin prescripteur', f.prescripteur); ligne('Médecin traitant', f.traitant);
    ligne('Infirmière', (f.ide || '') + (f.ideTel ? ' — ' + f.ideTel : ''));
    y += 3;
    titre('Perfusion');
    ligne('Voie', (M.PF_VOIES[f.voie] || {}).lbl);
    ligne('Type', (M.PF_TYPES[f.type] || {}).lbl === 'Autre (à préciser)' ? (f.typeAutre || 'Autre') : (M.PF_TYPES[f.type] || {}).lbl);
    ligne('Cure', M.pfFr(f.debut) + ' → ' + M.pfFr(M.pfFin(f)));
    ligne('Rythme', (f.perfSemaine || '—') + ' perfusion(s) par semaine');
    const mat = PF_MATERIEL.filter(m => (f.materiel || {})[m[0]]).map(m => m[1])
      .concat((f.materiel || {}).autre ? [(f.materiel || {}).autre] : []);
    ligne('Matériel fourni', mat.length ? mat.join(', ') : 'Aucun');
    if (f.mode !== 'entretien') {
      const faites = PF_MODALITES.filter(m => (f.modalites || {})[m[0]]).length;
      ligne('Prestations faites', faites + ' sur ' + PF_MODALITES.length);
    }
    y += 3;

    titre('Forfaits');
    const ech = M.pfEcheancier(f);
    if (!ech.length) { place(6); d.setFont(FONT, 'normal'); d.setFontSize(9); d.setTextColor(120, 120, 120);
      d.text('Aucun forfait calculé : la fiche est incomplète.', M_, y); y += 6; }
    let total = 0;
    ech.forEach(function (e) {
      place(7);
      total += e.total;
      const fait = (f.facturees || {})[e.no];
      d.setFont(FONT, 'normal'); d.setFontSize(8.6); d.setTextColor(90, 90, 90);
      d.text((e.type === 'installation' ? 'Installation' : e.type === 'entretien' ? 'Entretien' : 'Semaine ' + e.no)
        + '  ' + M.pfFr(e.du) + (e.au !== e.du ? '→' + M.pfFr(e.au) : ''), M_, y);
      d.setTextColor(26, 26, 26);
      d.text(e.lignes.map(l => l.code + ' (F' + l.num + (l.qte !== 1 ? ' ×' + l.qte : '') + ')').join(' + '), M_ + 48, y);
      d.text('exigible le ' + M.pfFr(e.duLe), M_ + 104, y);
      d.text(euro(e.total), R, y, { align: 'right' });
      if (fait) { d.setTextColor(29, 92, 58); d.text('✓', M_ - 4, y); }
      y += 5.2;
    });
    place(8);
    d.setDrawColor(207, 230, 216); d.line(M_, y, R, y); y += 5;
    d.setFont(FONT, 'bold'); d.setFontSize(9.5); d.setTextColor(29, 92, 58);
    d.text('Total des forfaits', M_, y); d.text(euro(total), R, y, { align: 'right' });
    y += 9;

    if (f.notes) { titre('Notes'); d.setFont(FONT, 'normal'); d.setFontSize(9); d.setTextColor(70, 70, 70);
      const l = d.splitTextToSize(String(f.notes), W); place(l.length * 4.4); d.text(l, M_, y); y += l.length * 4.4; }

    pied();
    try { window.open(d.output('bloburl'), '_blank', 'noopener'); }
    catch (e) { d.save('perfadom-' + (f.nom || '') + '.pdf'); }
  };

  // ── Démarrage ────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pfInject);
  else pfInject();
}());
