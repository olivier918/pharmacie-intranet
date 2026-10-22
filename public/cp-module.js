/* ════════════════════════════════════════════════════════════════════════════
   Module COMMANDES À PASSER — le tableau qu'on tient, au-dessus de celui qu'on
   consulte.

   Le geste qu'il sert : au comptoir, une rupture se constate. Il faut commander
   chez le laboratoire. Entre ce constat et la boîte posée sur l'étagère, il y a
   trois personnes et deux jours — et c'est exactement là que les choses se
   perdent. Trois états, pas un de plus :

     à commander  →  commandée  →  reçue

   Qui constate écrit le laboratoire et ce qu'il faut. Qui passe la commande
   clique « commandé ». Qui réceptionne clique « reçu ». Chaque clic laisse un
   nom et une heure : la question « est-ce que quelqu'un l'a commandé ? » cesse
   de se poser à voix haute dans l'officine.

   LES RELIQUATS SONT AFFICHÉS, ET C'EST TOUT. Un laboratoire qui les gère
   renverra plus tard ce qui manquait ; un autre considère la commande soldée.
   Le module le DIT, il n'en déduit rien : c'est l'opérateur qui sait si la
   livraison était complète, et lui seul.

   LA SAISIE N'EST PAS DANS LA PARTIE REDESSINÉE (piège n°9). La boucle de
   resynchronisation redessine les listes toutes les huit secondes ; si le
   formulaire s'y trouvait, le nom du laboratoire qu'on est en train de taper
   disparaîtrait sous les doigts.

   Préfixe `cp` / `cp-` : rien ici ne touche à l'existant.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const E = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
  const pad = n => String(n).padStart(2, '0');

  // Les collections se lisent par `_collRef` ou par leur nom nu, jamais par
  // `window` (piège n°8 du dépôt).
  const cpListe = () => (typeof window._collRef === 'function' ? window._collRef('cmdPasser') : null) || [];
  const cpUser = () => (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null;
  const cpStaff = () => (typeof staffDB !== 'undefined' && Array.isArray(staffDB)) ? staffDB : [];
  const cpLabos = () => (typeof window._collRef === 'function' ? window._collRef('laboratoires') : null) || [];
  const cpSave = () => { try { if (typeof saveNow === 'function') saveNow(); } catch (e) {} };

  // QUATRE ÉTATS, TROIS ÉTAPES. « Reçue partiellement » n'est pas une étape de
  // plus : c'est une AUTRE FAÇON de franchir la dernière. Un quatrième rond
  // laisserait croire qu'on y passe toujours, alors que c'est l'exception.
  const CP_ETATS = ['a_passer', 'commande', 'recu_partiel', 'recu'];
  const CP_ETAPE = { a_passer: 0, commande: 1, recu_partiel: 2, recu: 2 };
  // Revenir en arrière, d'un cran et pas plus — comme sur les livraisons.
  const CP_AVANT = { commande: 'a_passer', recu_partiel: 'commande', recu: 'commande' };
  const CP_HISTO_JOURS = 30;

  function cpPrenom(id) {
    const s = cpStaff().find(x => x && x.id === id);
    return s ? (s.prenom || s.id) : (id || '—');
  }
  function cpQuand(ts) {
    const d = new Date(Number(ts) || Date.now());
    const h = pad(d.getHours()) + 'h' + pad(d.getMinutes());
    return (d.toDateString() === new Date().toDateString())
      ? h : pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + ' ' + h;
  }

  // ── L'état d'une ligne ────────────────────────────────────────────────────
  // LECTURE AU LIEU DE MIGRATION : une ligne sans `etat` est une ligne à
  // commander. On ne réécrit rien (piège n°7).
  function cpEtat(c) {
    return (c && CP_ETATS.indexOf(c.etat) >= 0) ? c.etat : 'a_passer';
  }
  function cpEtape(c) { return CP_ETAPE[cpEtat(c)] || 0; }
  function cpPartielle(c) { return cpEtat(c) === 'recu_partiel'; }
  // Une ligne est close quand tout est arrivé. Une réception partielle, non :
  // il reste quelque chose à attendre, ou à recommander.
  function cpClose(c) { return cpEtat(c) === 'recu'; }

  // Le laboratoire est retrouvé DANS LE RÉPERTOIRE À CHAQUE AFFICHAGE, et non
  // figé à la saisie : une fiche créée ce soir fera apparaître la pastille sur
  // les lignes posées ce matin, sans qu'on y retouche.
  function cpFiche(c) {
    if (!c || !c.labo || typeof window.lbParNom !== 'function') return null;
    try { return window.lbParNom(c.labo) || null; } catch (e) { return null; }
  }
  function cpReliquats(c) {
    const f = cpFiche(c);
    return (f && typeof window.lbReliquats === 'function') ? window.lbReliquats(f) : '';
  }

  function cpTrier(l) {
    return (l || []).slice().sort((a, b) => (b.ts || 0) - (a.ts || 0));
  }
  function cpParEtat(l, e) {
    return cpTrier((l || []).filter(c => c && cpEtat(c) === e));
  }
  // L'historique ne montre pas tout : trente jours suffisent à répondre à
  // « quand l'a-t-on reçu ? ». Rien n'est effacé pour autant — les lignes plus
  // anciennes sont comptées, pas jetées.
  function cpHistorique(l, maintenant) {
    const limite = (maintenant || Date.now()) - CP_HISTO_JOURS * 86400000;
    const recues = cpParEtat(l, 'recu').sort((a, b) => (b.recuLe || b.ts || 0) - (a.recuLe || a.ts || 0));
    return {
      recentes: recues.filter(c => Number(c.recuLe || c.ts || 0) >= limite),
      anciennes: recues.filter(c => Number(c.recuLe || c.ts || 0) < limite).length
    };
  }

  // ── Les gestes ────────────────────────────────────────────────────────────
  let cpHistoOuvert = false;

  function cpPar(c, etat, uid, maintenant) {
    const now = maintenant || Date.now();
    c.etat = etat;
    // CELUI QUI DÉFAIT UNE RÉCEPTION N'A PAS PASSÉ LA COMMANDE. En revenant de
    // « reçue » à « commandée », on ne resigne donc pas la commande : elle garde
    // le nom et l'heure de qui l'a réellement passée.
    if (etat === 'commande' && !c.commandeLe) { c.commandeLe = now; c.commandePar = uid; }
    if (etat === 'recu_partiel') { c.partielLe = now; c.partielPar = uid; c.recuLe = null; c.recuPar = null; }
    // COMPLÉTER NE RENIE PAS LA RÉCEPTION PARTIELLE : la ligne garde la trace
    // qu'une partie était arrivée avant le reste. C'est ce qu'on relit quand on
    // se demande si ce laboratoire livre complet.
    if (etat === 'recu') { c.recuLe = now; c.recuPar = uid; }
    // REVENIR EN ARRIÈRE EFFACE CE QUI N'EST PLUS VRAI. Une ligne remise « à
    // commander » qui garderait « commandée par Julie à 9h12 » ferait croire
    // que la commande est partie.
    if (etat === 'a_passer') {
      c.commandeLe = null; c.commandePar = null;
      c.partielLe = null; c.partielPar = null; c.recuLe = null; c.recuPar = null;
    }
    if (etat === 'commande') {
      c.partielLe = null; c.partielPar = null; c.recuLe = null; c.recuPar = null;
    }
    c.updatedAt = now;
    return c;
  }

  window.cpAjouter = function () {
    if (!cpUser()) { alert('Identifiez-vous avec votre code PIN.'); return; }
    const iL = document.getElementById('cp-labo'), iP = document.getElementById('cp-prod');
    const labo = String((iL && iL.value) || '').trim().slice(0, 80);
    if (!labo) { if (iL) iL.focus(); return; }
    const now = Date.now();
    cpListe().unshift({
      id: now,
      labo: labo,
      produits: String((iP && iP.value) || '').trim().slice(0, 300),
      etat: 'a_passer',
      par: cpUser().id, ts: now, updatedAt: now
    });
    if (iL) iL.value = ''; if (iP) iP.value = '';
    if (iL) iL.focus();
    cpSave(); window.cpRender();
  };

  window.cpMarquer = function (id, etat) {
    if (!cpUser()) { alert('Identifiez-vous avec votre code PIN.'); return; }
    if (CP_ETATS.indexOf(etat) < 0) return;
    const c = cpListe().find(x => x && x.id === id); if (!c) return;
    cpPar(c, etat, cpUser().id);
    cpSave(); window.cpRender();
  };

  window.cpRetirer = function (id) {
    const l = cpListe(), i = l.findIndex(x => x && x.id === id); if (i < 0) return;
    if (!confirm('Retirer « ' + (l[i].labo || '') + ' » du tableau ?')) return;
    // La pierre tombale AVANT le retrait : sans elle, le serveur fusionne par
    // identifiant et la ligne revient au premier envoi d'un autre poste.
    if (typeof markDeleted === 'function') markDeleted('cmdPasser', l[i].id);
    l.splice(i, 1);
    cpSave(); window.cpRender();
  };

  window.cpBasculerHisto = function () { cpHistoOuvert = !cpHistoOuvert; window.cpRender(); };

  // ── Rendu ─────────────────────────────────────────────────────────────────
  function cpPastille(c) {
    const r = cpReliquats(c);
    if (!r) {
      return cpFiche(c)
        ? '<span class="cp-rel cp-rel-x" title="Le répertoire ne dit pas si ce laboratoire gère les reliquats">reliquats ?</span>'
        : '';
    }
    return '<span class="cp-rel cp-rel-' + r + '">'
      + (r === 'oui' ? 'reliquats gérés' : 'pas de reliquats') + '</span>';
  }

  // ── L'ESCALIER, COMME SUR LES LIVRAISONS ──────────────────────────────────
  //
  // Les mêmes classes que le stepper des livraisons : le style vit dans
  // index.html, et les deux écrans se ressemblent sans qu'on ait rien recopié.
  // Quelqu'un qui sait lire une livraison sait lire une commande.
  //
  // ON N'AVANCE PAS EN CLIQUANT SUR UN ROND. Aller à la dernière étape
  // demanderait « complète ou partielle ? », et un rond ne pose pas de
  // question : ce sont les boutons de droite qui le font, en toutes lettres.
  // Le rond sert à REVENIR, d'un cran et pas plus — le reste est désactivé
  // plutôt que muet, pour qu'un clic sans effet ne soit jamais une surprise.
  const CP_PAS = [
    { e: 'a_passer', lbl: 'À commander', ico: 'rupture' },
    { e: 'commande', lbl: 'Commandée', ico: 'commandes' },
    { e: 'recu', lbl: 'Réceptionnée', ico: 'boite-reception' }
  ];
  function cpIco(n) {
    return (typeof ico === 'function') ? ico(n)
      : '<svg class="ico"><use href="#ic-' + n + '"></use></svg>';
  }
  function cpStepper(c) {
    const cur = cpEtape(c), part = cpPartielle(c);
    const retour = CP_AVANT[cpEtat(c)] || null;
    let h = '<div class="status-stepper is-readonly cp-step"><div class="status-stepper__track">';
    CP_PAS.forEach(function (p, i) {
      if (i) {
        const plein = (i <= cur) ? '100%' : '0';
        h += '<div class="status-stepper__connector">'
          + '<div class="status-stepper__connector-fill" style="width:' + plein + '"></div></div>';
      }
      // Le dernier rond porte la nuance : partielle, il est ambré et le dit.
      const dernier = (i === 2);
      const fait = (i < cur) || (i === cur && (!dernier || !part));
      const cls = fait ? 'is-done' : (i === cur + 1 ? 'is-next' : 'is-pending');
      const cible = retour && CP_PAS[i].e === retour;
      h += '<button type="button" class="status-stepper__step ' + cls
        + (dernier && part && i === cur ? ' cp-part' : '') + '"'
        + (cible ? ' onclick="cpMarquer(' + (+c.id) + ',\'' + retour + '\')"'
                   + ' title="Revenir à cette étape"'
                 : ' disabled')
        + '>'
        + '<span class="status-stepper__circle">' + cpIco(dernier && part ? 'alerte' : p.ico) + '</span>'
        + '<span class="status-stepper__label">'
        + E(dernier && part ? 'Partielle' : p.lbl) + '</span>'
        + '</button>';
    });
    return h + '</div></div>';
  }

  function cpActions(c) {
    const e = cpEtat(c);
    if (e === 'a_passer') {
      return '<button class="btn bp sm" onclick="cpMarquer(' + (+c.id) + ',\'commande\')">Commandé</button>';
    }
    if (e === 'commande') {
      return '<button class="btn bp sm" onclick="cpMarquer(' + (+c.id) + ',\'recu\')">Tout reçu</button>'
        + '<button class="btn bs sm" onclick="cpMarquer(' + (+c.id) + ',\'recu_partiel\')">Reçu en partie</button>';
    }
    if (e === 'recu_partiel') {
      // DEUX SORTIES, ET LA PASTILLE DIT LAQUELLE. Le laboratoire gère les
      // reliquats : le reste viendra seul, on complétera. Il ne les gère pas :
      // ce qui manque ne viendra jamais, il faut le recommander.
      return '<button class="btn bp sm" onclick="cpMarquer(' + (+c.id) + ',\'recu\')">Le reste est arrivé</button>'
        + '<button class="btn bs sm" onclick="cpMarquer(' + (+c.id) + ',\'a_passer\')">À recommander</button>';
    }
    return '';
  }

  function cpTrace(c) {
    const e = cpEtat(c);
    if (e === 'recu') {
      return 'reçu par ' + E(cpPrenom(c.recuPar)) + ' · ' + E(cpQuand(c.recuLe))
        + (c.partielLe ? ' · arrivé en deux fois' : '');
    }
    if (e === 'recu_partiel') {
      return 'reçu en partie par ' + E(cpPrenom(c.partielPar)) + ' · ' + E(cpQuand(c.partielLe));
    }
    if (e === 'commande') {
      return 'commandé par ' + E(cpPrenom(c.commandePar)) + ' · ' + E(cpQuand(c.commandeLe));
    }
    return 'noté par ' + E(cpPrenom(c.par)) + ' · ' + E(cpQuand(c.ts));
  }

  function cpLigne(c) {
    return '<div class="cp-l cp-l-' + cpEtat(c) + '">'
      + '<div class="cp-l-c">'
      +   '<div class="cp-l-h"><span class="cp-labo">' + E(c.labo || '') + '</span>' + cpPastille(c) + '</div>'
      +   (c.produits ? '<div class="cp-prod">' + E(c.produits) + '</div>' : '')
      +   '<div class="cp-trace">' + cpTrace(c) + '</div>'
      + '</div>'
      + cpStepper(c)
      + '<div class="cp-l-a">' + cpActions(c)
      +   '<button class="cp-x" onclick="cpRetirer(' + (+c.id) + ')" title="Retirer">✕</button>'
      + '</div></div>';
  }

  function cpBloc(titre, l, vide) {
    if (!l.length) return vide ? '<div class="cp-vide">' + vide + '</div>' : '';
    return '<div class="cp-h">' + titre + ' <b>' + l.length + '</b></div>'
      + l.map(cpLigne).join('');
  }

  window.cpRender = function () {
    const z = document.getElementById('cp-listes'); if (!z) return;
    const l = cpListe();
    const histo = cpHistorique(l);
    let h = cpBloc('À commander', cpParEtat(l, 'a_passer'),
      'Rien à commander. Une rupture constatée au comptoir se note ci-dessus, en deux mots.');
    h += cpBloc('Commandées, en attente de réception', cpParEtat(l, 'commande'), '');
    // SON PROPRE GROUPE, ET PAS LA FIN DE L'HISTORIQUE. Une réception partielle
    // reste un travail en cours : la ranger avec les lignes closes, c'est
    // oublier ce qui manque.
    h += cpBloc('Reçues en partie — reste à recevoir', cpParEtat(l, 'recu_partiel'), '');
    if (histo.recentes.length || histo.anciennes) {
      h += '<button type="button" class="cp-h cp-repli" onclick="cpBasculerHisto()">'
        + (cpHistoOuvert ? '▾' : '▸') + ' Déjà reçues <b>' + histo.recentes.length + '</b>'
        + (histo.anciennes ? '<span class="cp-vieux">+ ' + histo.anciennes + ' il y a plus de '
            + CP_HISTO_JOURS + ' jours</span>' : '')
        + '</button>';
      if (cpHistoOuvert) h += histo.recentes.map(cpLigne).join('');
    }
    z.innerHTML = h;
    cpRemplirAnnuaire();
  };

  // L'autocomplétion vient du répertoire des laboratoires — la même liste que
  // le back office. Une `datalist` plutôt qu'un menu : elle n'empêche pas de
  // saisir un laboratoire qui n'y est pas encore.
  function cpRemplirAnnuaire() {
    const dl = document.getElementById('cp-annuaire'); if (!dl) return;
    const noms = cpLabos().map(f => f && f.nom).filter(Boolean)
      .sort((a, b) => String(a).localeCompare(String(b), 'fr', { sensitivity: 'base' }));
    const sig = noms.join('\u0001');
    if (dl.dataset.sig === sig) return;      // rien de neuf : on ne touche pas au DOM
    dl.dataset.sig = sig;
    dl.innerHTML = noms.map(n => '<option value="' + E(n) + '">').join('');
  }

  // ── Gabarit ───────────────────────────────────────────────────────────────
  //
  // LA SAISIE EST ÉCRITE UNE FOIS, et `cpRender` n'y touche jamais : elle ne
  // redessine que `#cp-listes`. C'est le piège n°9 du dépôt — un formulaire
  // reconstruit toutes les huit secondes est un formulaire qu'on ne peut pas
  // remplir.
  const CP_SECTION =
    '<div class="card">'
  +   '<div class="ch"><span class="ct"><svg class="ico"><use href="#ic-commandes"></use></svg> '
  +     'Suivi des commandes à passer</span></div>'
  +   '<div class="cp-saisie">'
  +     '<input type="text" id="cp-labo" list="cp-annuaire" maxlength="80" autocomplete="off"'
  +       ' placeholder="Laboratoire — rupture constatée" onkeydown="if(event.key===\'Enter\')cpAjouter()">'
  +     '<input type="text" id="cp-prod" maxlength="300" autocomplete="off"'
  +       ' placeholder="Produits (facultatif)" onkeydown="if(event.key===\'Enter\')cpAjouter()">'
  +     '<button class="btn bp" onclick="cpAjouter()">Ajouter</button>'
  +     '<datalist id="cp-annuaire"></datalist>'
  +   '</div>'
  +   '<div id="cp-listes"></div>'
  + '</div>';

  const CP_CSS = [
    '.cp-saisie{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}',
    '.cp-saisie input{flex:1;min-width:180px;padding:10px 12px;font-size:.92rem;font-family:inherit;',
    '  border:1px solid var(--gray-300,#ccc);border-radius:8px}',
    '.cp-saisie input:focus{outline:none;border-color:var(--g-mid,#2E7D54)}',
    '.cp-h{font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;',
    '  color:var(--gray-500,#777);margin:16px 0 6px;display:flex;align-items:center;gap:7px}',
    '.cp-h b{color:var(--g-dark,#1D5C3A);font-size:.84rem}',
    '.cp-repli{width:100%;background:none;border:none;border-top:1px solid var(--gray-200,#e8e8e8);',
    '  padding:12px 2px 6px;cursor:pointer;font:inherit;font-size:.72rem;font-weight:700;',
    '  text-transform:uppercase;letter-spacing:.05em;color:var(--gray-500,#777);text-align:left}',
    '.cp-repli:hover{color:var(--g-dark,#1D5C3A)}',
    '.cp-vieux{margin-left:auto;font-weight:500;text-transform:none;letter-spacing:0;font-size:.74rem}',
    '.cp-l{display:flex;align-items:flex-start;gap:12px;padding:10px 2px;',
    '  border-top:1px solid var(--gray-200,#e8e8e8)}',
    '.cp-l-c{flex:1;min-width:0}',
    '.cp-l-h{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
    '.cp-labo{font-weight:700;font-size:.95rem}',
    '.cp-prod{font-size:.86rem;color:var(--gray-700,#444);margin-top:2px;line-height:1.5}',
    '.cp-trace{font-size:.74rem;color:var(--gray-500,#777);margin-top:3px}',
    '.cp-l-a{display:flex;align-items:center;gap:6px;flex:none;flex-wrap:wrap;justify-content:flex-end}',
    '.cp-step{flex:none;margin:0;padding:0;background:none;border:none;box-shadow:none}',
    '.cp-step .status-stepper__track{gap:0}',
    '.cp-step .status-stepper__step{width:62px}',
    '.cp-step .status-stepper__connector{min-width:14px}',
    '.cp-step .status-stepper__step[disabled]{cursor:default}',
    // LA RECEPTION PARTIELLE SE VOIT AU PREMIER COUP D OEIL. Ambre, comme toutes
    // les alertes douces de la maison : ce n est pas une faute, c est un reste.
    // La specificite compte : `.status-stepper__step.is-pending .circle` d'index.html
    // l'emporterait sur une regle plus courte, et le rond resterait gris.
    '.status-stepper__step.cp-part .status-stepper__circle{background:var(--amber-pale,#FFF3E0);',
    '  border-color:var(--amber,#E65100)}',
    '.status-stepper__step.cp-part .status-stepper__circle svg{color:var(--amber,#E65100)}',
    '.status-stepper__step.cp-part .status-stepper__label{color:var(--amber,#E65100);font-weight:700}',
    '.cp-l-recu_partiel{background:linear-gradient(90deg,var(--amber-pale,#FFF3E0) 0,rgba(255,255,255,0) 160px)}',
    '.cp-l-recu .cp-labo,.cp-l-recu .cp-prod{color:var(--gray-500,#777)}',
    '.cp-l-recu .cp-labo{text-decoration:line-through}',
    '.cp-rel{display:inline-block;font-size:.68rem;font-weight:700;border-radius:999px;',
    '  padding:2px 9px;white-space:nowrap}',
    '.cp-rel-oui{background:var(--g-pale,#E8F5E9);color:var(--g-dark,#1D5C3A)}',
    '.cp-rel-non{background:var(--amber-pale,#FFF3E0);color:var(--amber,#E65100)}',
    '.cp-rel-x{background:var(--gray-100,#f5f5f5);color:var(--gray-500,#777)}',
    '.cp-undo,.cp-x{background:none;border:none;cursor:pointer;color:var(--gray-300,#ccc);',
    '  font-size:1rem;padding:4px 6px;line-height:1}',
    '.cp-undo:hover{color:var(--g-dark,#1D5C3A)}',
    '.cp-x:hover{color:var(--red,#C62828)}',
    '.cp-vide{padding:18px 2px;color:var(--gray-500,#777);font-size:.88rem;line-height:1.6}',
    '@media(max-width:600px){.cp-l{flex-direction:column;gap:9px}',
    '  .cp-l-a{align-self:stretch;justify-content:flex-start}.cp-step{align-self:flex-start}}',
    '@media print{.cp-saisie,.cp-l-a,.cp-repli,.cp-step{display:none}.cp-l{break-inside:avoid}}'
  ].join('\n');

  // ── Injection ─────────────────────────────────────────────────────────────
  // `#cp-host` est posé par co-module.js, en tête de la rubrique Commandes.
  // Si la rubrique n'existe pas — poste sans accès au module — on ne fait rien.
  function cpInject() {
    if (document.getElementById('cp-css')) return;
    const hote = document.getElementById('cp-host'); if (!hote) return;
    const st = document.createElement('style');
    st.id = 'cp-css'; st.textContent = CP_CSS;
    document.head.appendChild(st);
    hote.innerHTML = CP_SECTION;
    window.cpRender();
  }
  // co-module.js s'injecte sur le même événement ; l'ordre des balises `script`
  // le place avant celui-ci, mais on réessaie une fois au cas où.
  function cpDemarrer() {
    cpInject();
    if (!document.getElementById('cp-css')) setTimeout(cpInject, 300);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', cpDemarrer);
  else cpDemarrer();

  // Exposé pour les essais, et pour qui voudrait compter ce qui reste à faire.
  window.cpEtat = cpEtat;
  window.cpParEtat = cpParEtat;
  window.cpHistorique = cpHistorique;
  window.cpPar = cpPar;
  window.CP_ETATS = CP_ETATS;
}());
