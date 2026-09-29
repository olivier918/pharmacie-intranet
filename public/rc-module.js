/* ═══════════════════════════════════════════════════════════════════════════
   LES RACCOURCIS CLAVIER

   Au comptoir, la main quitte le clavier pour attraper la souris, viser une
   entrée de menu, revenir. Trente fois par jour. Ce module rend les gestes
   les plus fréquents à la seule main qui tape.

   POURQUOI ALT ET PAS LES TOUCHES F. Une touche F est plus rapide — une seule
   frappe, sans regarder. Mais F1 est la touche d'aide du navigateur, F11 et
   F12 lui appartiennent et ne se reprennent pas, et une touche F partie au
   milieu d'une saisie remplace un nom de patient par un écran qui s'ouvre.
   Alt + lettre n'entre en collision avec rien, se retient (L comme livraison),
   et surtout PEUT servir pendant qu'on tape : Alt n'écrit pas de texte.

   ON LIT `e.code`, JAMAIS `e.key`. Sur le Mac d'Anouck, Option+L ne produit
   pas « l » mais « ¬ ». Un raccourci écrit sur `e.key` marche sur les PC du
   comptoir et nulle part ailleurs — et personne ne saurait dire pourquoi.

   ON IGNORE TOUT CE QUI PORTE `ctrlKey`. Sur un clavier AZERTY, AltGr EST
   Ctrl+Alt : taper « € » dans un montant, ou « @ » dans un courriel, lèverait
   sinon un raccourci en pleine saisie.

   IL NE CONNAÎT AUCUN MODULE. Les boutons se déclarent eux-mêmes :
   `data-rc="neuf"` sur ce qui crée une fiche, `data-rc="recherche"` sur le
   champ de recherche. Le raccourci cherche l'attribut DANS LA SECTION OUVERTE
   et s'en sert. Un module ajouté demain gagne ses raccourcis en posant un
   attribut — sans que ce fichier soit rouvert.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // Les lettres évitées, et pourquoi : Chrome garde Alt+D (barre d'adresse),
  // Alt+E et Alt+F (son menu), Alt+Début et Alt+Flèches (l'historique). Les
  // reprendre donnerait un raccourci qui marche un jour sur deux.
  const RC_INTERDITES = ['KeyD', 'KeyE', 'KeyF'];

  // Les modules du quotidien. L'ordre est celui de la liste d'aide.
  const RC_SECTIONS = [
    ['KeyA', 'accueil',      'Accueil'],
    ['KeyL', 'livraisons',   'Livraisons'],
    ['KeyP', 'preparations', 'Préparations'],
    ['KeyC', 'messagerie',   'Cahier de transmission'],
    ['KeyM', 'mp',           'Messagerie'],
    ['KeyS', 'sms',          'SMS patients'],
    ['KeyB', 'depots',       'Boîte de réception'],
    ['KeyO', 'locations',    'Locations'],
    ['KeyT', 'temperatures', 'Températures']
  ];

  function rcVisible(el) { return !!el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length); }

  // La section réellement affichée. Tout ce que font Alt+N et Alt+R s'y limite.
  function rcSection() {
    const l = document.querySelectorAll('.sec.active');
    for (let i = 0; i < l.length; i++) if (rcVisible(l[i])) return l[i];
    return null;
  }

  // UNE FENÊTRE OUVERTE SUSPEND TOUT. Changer de module pendant qu'un pavé est
  // ouvert, c'est perdre une saisie sans comprendre pourquoi — et le pavé,
  // lui, resterait ouvert derrière. Seule l'aide reste accessible.
  function rcFenetreOuverte() {
    const l = document.querySelectorAll('.overlay,.tp-rv,.pt-ov,#son-popup,.rc-aide');
    for (let i = 0; i < l.length; i++) {
      if (l[i].classList.contains('rc-aide')) continue;
      const c = getComputedStyle(l[i]);
      if (c.display !== 'none' && c.visibility !== 'hidden' && rcVisible(l[i])) return true;
    }
    return false;
  }

  // Le module est-il ouvert à CETTE personne ? Les entrées de menu sont
  // masquées poste par poste : un raccourci qui ouvrirait une section interdite
  // contournerait ce réglage sans le dire.
  function rcEntree(sec) {
    const b = document.querySelector('.sb-item[data-sec="' + sec + '"]');
    return rcVisible(b) ? b : null;
  }

  function rcCible(role) {
    const s = rcSection();
    if (!s) return null;
    const l = s.querySelectorAll('[data-rc="' + role + '"]');
    for (let i = 0; i < l.length; i++) if (rcVisible(l[i])) return l[i];
    return null;
  }

  // Un bouton se clique ; un formulaire déjà ouvert — les préparations n'ont
  // pas de bouton « nouvelle », leur pavé est toujours là — se prend par son
  // premier champ. Les deux sont « commencer une fiche ».
  function rcDeclencher(el) {
    if (!el) return false;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
      el.focus();
      if (el.select) try { el.select(); } catch (e) { /* select() n'existe pas sur tous les types */ }
    } else {
      el.click();
    }
    return true;
  }

  // ── Le mot qui dit ce qui vient de se passer ──────────────────────────────
  // Sans lui, Alt+N dans une section sans création ne fait RIEN, et on
  // recommence en appuyant plus fort.
  let rcMotTimer = null;
  function rcMot(txt) {
    let z = document.getElementById('rc-mot');
    if (!z) { z = document.createElement('div'); z.id = 'rc-mot'; document.body.appendChild(z); }
    z.textContent = txt;
    z.classList.add('on');
    clearTimeout(rcMotTimer);
    rcMotTimer = setTimeout(function () { z.classList.remove('on'); }, 1900);
  }

  // ── L'aide-mémoire ────────────────────────────────────────────────────────
  // UN RACCOURCI QU'ON NE PEUT PAS DÉCOUVRIR N'EXISTE PAS. Julie ne devinera
  // pas Alt+L. La liste ne montre que les modules qui lui sont ouverts : une
  // aide qui annonce des touches inertes est pire que pas d'aide.
  function rcAideBasculer() {
    const ouv = document.querySelector('.rc-aide');
    if (ouv) { ouv.remove(); return; }
    const dispo = RC_SECTIONS.filter(function (r) { return !!rcEntree(r[1]); });
    const ov = document.createElement('div');
    ov.className = 'rc-aide';
    ov.innerHTML = '<div class="rc-aide-b" role="dialog" aria-label="Raccourcis clavier">'
      + '<div class="rc-aide-h"><b>Raccourcis clavier</b>'
      + '<button type="button" class="rc-aide-x" aria-label="Fermer">×</button></div>'
      + '<div class="rc-aide-s">Dans la section ouverte</div>'
      + '<div class="rc-aide-l">'
      + '<div><kbd>Alt</kbd>+<kbd>N</kbd><span>Commencer une fiche</span></div>'
      + '<div><kbd>Alt</kbd>+<kbd>R</kbd><span>Aller dans la recherche</span></div>'
      + '<div><kbd>Alt</kbd>+<kbd>H</kbd><span>Cette liste</span></div>'
      + '</div>'
      + (dispo.length ? '<div class="rc-aide-s">Changer de module</div><div class="rc-aide-l">'
          + dispo.map(function (r) {
              return '<div><kbd>Alt</kbd>+<kbd>' + r[0].slice(3) + '</kbd><span>' + r[2] + '</span></div>';
            }).join('') + '</div>' : '')
      + '<div class="rc-aide-p">Les raccourcis se taisent tant qu’une fenêtre est ouverte.</div></div>';
    ov.addEventListener('mousedown', function (ev) {
      if (ev.target === ov || (ev.target.classList && ev.target.classList.contains('rc-aide-x'))) ov.remove();
    });
    document.body.appendChild(ov);
  }

  // ── La touche ─────────────────────────────────────────────────────────────
  function rcClavier(ev) {
    if (!ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
    const code = ev.code || '';
    if (RC_INTERDITES.indexOf(code) >= 0) return;

    if (code === 'KeyH') { ev.preventDefault(); ev.stopPropagation(); rcAideBasculer(); return; }
    if (rcFenetreOuverte()) return;

    if (code === 'KeyN') {
      ev.preventDefault(); ev.stopPropagation();
      if (!rcDeclencher(rcCible('neuf'))) rcMot('Rien à créer dans cette section.');
      return;
    }
    if (code === 'KeyR') {
      ev.preventDefault(); ev.stopPropagation();
      if (!rcDeclencher(rcCible('recherche'))) rcMot('Pas de recherche dans cette section.');
      return;
    }
    for (let i = 0; i < RC_SECTIONS.length; i++) {
      if (RC_SECTIONS[i][0] !== code) continue;
      ev.preventDefault(); ev.stopPropagation();
      const b = rcEntree(RC_SECTIONS[i][1]);
      if (b) b.click();
      else rcMot(RC_SECTIONS[i][2] + ' n’est pas ouvert sur ce poste.');
      return;
    }
  }

  // En capture, comme la couche des listes de suggestion : les fenêtres qui
  // écoutent Échap ne doivent pas avaler la frappe avant nous.
  document.addEventListener('keydown', rcClavier, true);
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') { const a = document.querySelector('.rc-aide'); if (a) a.remove(); }
  }, true);

  const RC_CSS = `
  #rc-mot{position:fixed;left:50%;bottom:26px;transform:translateX(-50%) translateY(150%);
    z-index:9600;background:#1D5C3A;color:#fff;padding:11px 18px;border-radius:11px;
    font-size:.88rem;font-weight:600;box-shadow:0 10px 26px rgba(0,0,0,.24);
    transition:transform .25s cubic-bezier(.2,.9,.3,1.2);max-width:92vw;text-align:center}
  #rc-mot.on{transform:translateX(-50%) translateY(0)}
  .rc-aide{position:fixed;inset:0;z-index:1200;background:rgba(17,24,20,.5);
    display:flex;align-items:center;justify-content:center;padding:20px}
  .rc-aide-b{background:#fff;border-radius:15px;padding:22px 26px;width:min(460px,94vw);
    max-height:86vh;overflow:auto;box-shadow:0 22px 56px rgba(0,0,0,.3)}
  .rc-aide-h{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px}
  .rc-aide-h b{font-size:1.05rem}
  .rc-aide-x{background:none;border:none;font-size:1.5rem;line-height:1;cursor:pointer;
    color:var(--gray-500,#6b7280);padding:0 4px}
  .rc-aide-s{font-size:.72rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;
    color:var(--gray-500,#6b7280);margin:16px 0 7px}
  .rc-aide-l>div{display:flex;align-items:center;gap:10px;padding:5px 0;font-size:.9rem}
  .rc-aide-l span{color:var(--gray-700,#374151)}
  .rc-aide kbd{display:inline-block;min-width:26px;text-align:center;font:inherit;font-size:.78rem;
    font-weight:700;padding:3px 7px;border-radius:6px;background:var(--g-pale,#E8F5E9);
    color:var(--g-dark,#1D5C3A);border:1px solid var(--g-border,#C8E6C9);
    box-shadow:0 1px 0 var(--g-border,#C8E6C9)}
  .rc-aide-p{margin-top:18px;font-size:.78rem;color:var(--gray-500,#6b7280);line-height:1.5}
  @media print{#rc-mot,.rc-aide{display:none}}
  `;
  const st = document.createElement('style'); st.textContent = RC_CSS; document.head.appendChild(st);

  // LE RACCOURCI S'ANNONCE SUR LE BOUTON LUI-MEME. Une liste d'aide ne se
  // consulte que si l'on sait deja qu'elle existe ; une infobulle se lit en
  // passant, au moment ou l'on allait cliquer. C'est la seule facon qu'a
  // Julie d'apprendre Alt+N sans que personne le lui dise.
  // On le fait a l'execution, sur l'attribut data-rc : un bouton etiquete
  // demain gagne son infobulle sans qu'on y pense.
  function rcInfobulles() {
    const l = document.querySelectorAll('[data-rc="neuf"],[data-rc="recherche"]');
    for (let i = 0; i < l.length; i++) {
      const el = l[i];
      const t = el.getAttribute('data-rc') === 'neuf' ? 'Alt+N' : 'Alt+R';
      const d = el.getAttribute('title') || el.getAttribute('aria-label')
             || el.getAttribute('placeholder') || '';
      if ((el.getAttribute('title') || '').indexOf(t) >= 0) continue;
      el.setAttribute('title', (d ? d + ' — ' : '') + t);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', rcInfobulles);
  else rcInfobulles();
  window.rcInfobulles = rcInfobulles;

  window.rcAideBasculer = rcAideBasculer;
  window.rcCible = rcCible;
  window.rcSection = rcSection;
}());
