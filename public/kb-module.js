/* ═══════════════════════════════════════════════════════════════════════════
   LE CLAVIER DANS LES LISTES DE SUGGESTION

   On tape trois lettres, le nom du patient apparaît juste en dessous — et il
   fallait lâcher le clavier, attraper la souris, viser une ligne de huit
   pixels de haut, revenir au clavier. Au comptoir, avec quelqu'un en face, ce
   demi-geste se paie à chaque saisie de la journée.

   POURQUOI UNE SEULE COUCHE POUR TOUTES LES LISTES, et pas une correction
   dans chacune. Il y a une quinzaine de champs à suggestions dans PILOT
   (livraisons, locations, crédits, bons, questionnaires, retours, renouvelle-
   ments, médecins…), écrits à des mois d'intervalle mais tous bâtis pareil :
   un champ, une boîte juste à côté, et dans la boîte des lignes qui portent
   leur propre `onmousedown`. Une couche unique qui lit cette forme les traite
   toutes — y compris celles qui n'existent pas encore.

   ELLE N'APPELLE JAMAIS LA FONCTION DE REMPLISSAGE. Elle ne sait pas si la
   ligne choisie remplit un patient, un médecin ou un laboratoire : elle
   déclenche le geste que la ligne attendait déjà de la souris. Rien à
   déclarer, rien à tenir à jour.

   AUCUNE LIGNE N'EST PRÉSÉLECTIONNÉE. Beaucoup de ces champs acceptent aussi
   un nom INCONNU — c'est ainsi qu'on crée une fiche. Surligner d'office la
   première proposition ferait rattacher au premier homonyme venu le patient
   qu'on était en train de créer, sur une simple touche Entrée.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // Les boîtes de suggestion du dépôt. Les trois premières classes sont
  // explicites ; les suffixes d'identifiant rattrapent les boîtes écrites au
  // fil de l'eau avec un style en ligne (`ps-sugg`, `ctl-psugg`, `lc-pat-ac`…).
  const KB_LISTES = '.ac-drop,.rn-drop,.kb-liste,[id$="sugg"],[id$="-ac"],[id$="-drop"]';

  const kbVisible = el => !!el && !!(el.offsetWidth || el.offsetHeight);

  // Un champ de saisie texte, et rien d'autre : ni case à cocher, ni date, ni
  // menu déroulant natif — qui ont déjà leur propre usage des flèches.
  function kbChamp(el) {
    if (!el || el.tagName !== 'INPUT') return false;
    const t = (el.type || 'text').toLowerCase();
    return t === 'text' || t === 'search' || t === 'tel' || t === 'email';
  }

  // La liste qui appartient à CE champ. On remonte d'un cran à la fois et on
  // s'arrête au premier ancêtre qui contient une liste ouverte.
  //
  // LA CONDITION QUI COMPTE EST LA SECONDE : cet ancêtre ne doit contenir
  // qu'UN champ de saisie. Le formulaire de location aligne le nom du patient,
  // le prescripteur, le téléphone et le courriel dans une même grille ; sans
  // cette condition, une flèche bas tapée dans le champ téléphone piloterait
  // la liste des patients restée ouverte deux cases plus haut. Mieux vaut un
  // clavier inerte qu'un clavier qui remplit la mauvaise case.
  function kbListeDe(inp) {
    const ouvertes = [].slice.call(document.querySelectorAll(KB_LISTES)).filter(kbVisible);
    if (!ouvertes.length) return null;
    let n = inp;
    for (let k = 0; k < 4 && n && n.parentElement; k++) {
      n = n.parentElement;
      const dedans = ouvertes.filter(l => n.contains(l) && !l.contains(inp));
      if (!dedans.length) continue;
      if (dedans.length > 1) return null;
      return kbUnSeulChamp(n, inp) ? dedans[0] : null;
    }
    return null;
  }
  function kbUnSeulChamp(n, inp) {
    const ch = [].slice.call(n.querySelectorAll('input')).filter(kbChamp);
    return ch.length <= 1 && (!ch.length || ch[0] === inp);
  }

  // Une ligne choisissable est une ligne qui attend déjà un geste de souris.
  // Les autres — « Aucun patient connu à ce nom » — sont du texte, et le
  // clavier doit les sauter comme l'œil les saute.
  function kbLignes(liste) {
    return [].slice.call(liste.children).filter(function (c) {
      return c.nodeType === 1
        && (c.getAttribute('onmousedown') || c.getAttribute('onclick') || c.dataset.kbOk)
        && (c.offsetWidth || c.offsetHeight);
    });
  }

  function kbSel(liste) { return liste.querySelector('.kb-sel'); }

  function kbSurligner(liste, i) {
    const l = kbLignes(liste);
    l.forEach(function (x) { x.classList.remove('kb-sel'); x.removeAttribute('aria-selected'); });
    if (i < 0 || i >= l.length) return null;
    const it = l[i];
    it.classList.add('kb-sel');
    it.setAttribute('aria-selected', 'true');
    // La boîte a une hauteur maximale : sans cela, la sélection descend hors
    // de la partie visible et on pilote une liste qu'on ne voit plus.
    const hb = liste.getBoundingClientRect(), hi = it.getBoundingClientRect();
    if (hi.bottom > hb.bottom) liste.scrollTop += hi.bottom - hb.bottom;
    else if (hi.top < hb.top) liste.scrollTop -= hb.top - hi.top;
    return it;
  }

  function kbIndex(liste) {
    const l = kbLignes(liste), s = kbSel(liste);
    return s ? l.indexOf(s) : -1;
  }

  function kbDeplacer(liste, pas) {
    const l = kbLignes(liste);
    if (!l.length) return false;
    const i = kbIndex(liste);
    // Le premier appui descend sur la première ligne ; ensuite on tourne en
    // boucle, parce qu'une liste de six noms se reparcourt sans y penser.
    let n = (i < 0) ? (pas > 0 ? 0 : l.length - 1) : (i + pas);
    if (n < 0) n = l.length - 1;
    if (n >= l.length) n = 0;
    kbSurligner(liste, n);
    return true;
  }

  // On ne sait pas ce que fait la ligne — et on n'a pas à le savoir. On
  // déclenche le geste qu'elle attendait de la souris.
  function kbChoisir(liste) {
    const it = kbSel(liste);
    if (!it) return false;
    it.classList.remove('kb-sel');
    if (it.getAttribute('onmousedown')) {
      it.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    } else {
      it.click();
    }
    return true;
  }

  function kbFermer(liste) {
    const s = kbSel(liste); if (s) s.classList.remove('kb-sel');
    liste.style.display = 'none';
  }

  // Rouvrir une liste refermée : on refait jouer la recherche du champ
  // lui-même plutôt que d'appeler une fonction nommée. C'est ce que fait F4
  // sur un menu déroulant, et ce que fait Flèche bas sur une liste de
  // complétion partout ailleurs.
  function kbRouvrir(inp) {
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    return kbListeDe(inp);
  }

  function kbClavier(ev) {
    const inp = ev.target;
    if (!kbChamp(inp)) return;
    if (ev.ctrlKey || ev.metaKey) return;

    const k = ev.key;
    const derouler = (k === 'F4') || (ev.altKey && k === 'ArrowDown');
    if (ev.altKey && !derouler) return;

    let liste = kbListeDe(inp);

    if (derouler) {
      if (liste) kbFermer(liste); else kbRouvrir(inp);
      ev.preventDefault(); ev.stopPropagation();
      return;
    }

    if (!liste) {
      // Flèche bas sur un champ déjà rempli : on redemande les propositions.
      if (k === 'ArrowDown' && (inp.value || '').trim().length >= 1) {
        liste = kbRouvrir(inp);
        if (liste && kbDeplacer(liste, +1)) { ev.preventDefault(); ev.stopPropagation(); }
      }
      return;
    }

    if (k === 'ArrowDown') { kbDeplacer(liste, +1); ev.preventDefault(); ev.stopPropagation(); return; }
    if (k === 'ArrowUp')   { kbDeplacer(liste, -1); ev.preventDefault(); ev.stopPropagation(); return; }
    if (k === 'PageDown')  { kbDeplacer(liste, +5); ev.preventDefault(); ev.stopPropagation(); return; }
    if (k === 'PageUp')    { kbDeplacer(liste, -5); ev.preventDefault(); ev.stopPropagation(); return; }

    if (k === 'Enter') {
      // Rien de surligné : la personne a fini de taper un nom qui n'est pas
      // dans la liste. On la laisse valider SA saisie — c'est comme cela
      // qu'une fiche se crée.
      if (kbSel(liste) && kbChoisir(liste)) { ev.preventDefault(); ev.stopPropagation(); }
      else kbFermer(liste);
      return;
    }

    if (k === 'Tab') {
      // Tabulation sur une ligne surlignée : on la prend ET on continue vers
      // le champ suivant. Deux gestes en un, c'est le geste attendu.
      if (kbSel(liste)) kbChoisir(liste); else kbFermer(liste);
      return;   // pas de preventDefault : la tabulation doit faire son travail
    }

    if (k === 'Escape') {
      // Ferme la liste sans rien effacer — et sans fermer la fenêtre derrière,
      // ce que ferait une touche Échap laissée remonter.
      kbFermer(liste);
      ev.preventDefault(); ev.stopPropagation();
      return;
    }

    // Toute autre frappe modifie la recherche : la sélection ne désigne plus
    // rien et ne doit pas survivre à la ligne qu'elle montrait.
    if (k.length === 1 || k === 'Backspace' || k === 'Delete') {
      const s = kbSel(liste); if (s) s.classList.remove('kb-sel');
    }
  }

  // En capture : les champs concernés n'ont pas de gestionnaire de touches à
  // eux, mais les fenêtres qui les contiennent en ont un pour Échap.
  document.addEventListener('keydown', kbClavier, true);

  // La souris reprend la main : deux lignes actives en même temps — celle que
  // le clavier a laissée, celle que la souris survole — et on ne sait plus
  // laquelle Entrée validerait.
  document.addEventListener('mouseover', function (ev) {
    const t = ev.target;
    if (!t || !t.closest) return;
    const l = t.closest(KB_LISTES);
    if (!l) return;
    const s = kbSel(l);
    if (s && !s.contains(t)) s.classList.remove('kb-sel');
  }, true);

  const KB_CSS = `
  .kb-sel{background:var(--g-pale,#E8F5E9)!important;box-shadow:inset 3px 0 0 var(--g-mid,#2E7D54)}
  .kb-sel strong,.kb-sel b{color:var(--g-dark,#1D5C3A)}
  `;
  const st = document.createElement('style'); st.textContent = KB_CSS; document.head.appendChild(st);

  window.kbListeDe   = kbListeDe;
  window.kbLignes    = kbLignes;
  window.kbDeplacer  = kbDeplacer;
  window.kbChoisir   = kbChoisir;
  window.kbSurligner = kbSurligner;
}());
