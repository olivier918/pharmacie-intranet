/* ═══════════════════════════════════════════════════════════════════════════
   PILOT — Page d'accueil
   ---------------------------------------------------------------------------
   Point d'entree de l'intranet : ce qui compte aujourd'hui, et de quoi donner
   envie d'ouvrir l'outil. Le module s'injecte comme les autres (bouton en tete
   de barre laterale + section), sans toucher au corps de index.html.

   Cadrage : projet Claude, « Cahier des charges — Page d'accueil PILOT ».
   Deux ecarts assumes, decides avec Olivier :
   - le « cahier de transmission » EST la messagerie existante (fils partages
     sur des sujets patient / medecin / medicament) ; il n'y a rien a creer ;
   - la messagerie individuelle, adressee, n'existe pas encore : son bloc est
     retire de l'accueil tant que le module n'est pas ecrit.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const E = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const acUser = () => (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null;
  const acAdmin = () => (typeof isAdmin === 'function') ? isAdmin() : false;
  const acStaff = () => (typeof staffDB !== 'undefined' && Array.isArray(staffDB)) ? staffDB : [];
  const acTodos = () => (typeof todoPerso !== 'undefined' && Array.isArray(todoPerso)) ? todoPerso : [];
  const acMoments = () => (typeof moments !== 'undefined' && Array.isArray(moments)) ? moments : [];
  const acAgenda = () => (typeof agenda !== 'undefined' && Array.isArray(agenda)) ? agenda : [];
  const acFils = () => (typeof threads !== 'undefined' && Array.isArray(threads)) ? threads : [];
  const acLiens = () => (typeof liens !== 'undefined' && Array.isArray(liens)) ? liens : [];
  const acSave = (now) => {
    try {
      if (now && typeof saveNow === 'function') saveNow();
      else if (typeof schedSave === 'function') schedSave();
    } catch (e) {}
  };

  // Calendrier LOCAL, jamais toISOString() : sur une date a minuit, la
  // conversion UTC renvoie la veille en heure de Paris.
  const pad = n => String(n).padStart(2, '0');
  function acIso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function acMoisJour(d) { return pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  // Depuis combien de temps. « il y a 20 min » se comprend sans calcul ; une
  // heure precise obligerait a la comparer a la sienne.
  function acAge(ts) {
    const m = Math.floor((Date.now() - (ts || 0)) / 60000);
    if (m < 2) return 'à l’instant';
    if (m < 60) return 'il y a ' + m + ' min';
    const h = Math.floor(m / 60);
    if (h < 24) return 'il y a ' + h + ' h';
    const j = Math.floor(h / 24);
    if (j === 1) return 'hier';
    if (j < 7) return 'il y a ' + j + ' j';
    return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  }

  const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet',
    'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const MOIS_CT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.',
    'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  const JOURS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

  const AC_MOMENT_JOURS = 7;      // duree de vie d'une publication
  const AC_MOMENT_MAX   = 8;      // publications affichees
  const AC_MOMENT_PX    = 640;    // largeur des photos rendues
  const AC_MOMENT_Q     = 0.6;
  // Les images ne vivent plus dans le blob : elles sont deposees sur /api/images
  // et l'enregistrement ne garde que leur identifiant. Le navigateur les charge
  // une fois et les met en cache pour de bon — l'identifiant etant le condensat
  // du contenu, l'adresse ne designe jamais autre chose. D'ou un plafond bien
  // plus large : le poids ne pese plus sur la synchro des huit secondes.
  const AC_GIF_MAX_KO   = 4096;   // 4 Mo — la route en accepte 8
  // Un GIF anime ne peut pas etre redimensionne : le passer par un canevas le
  // figerait sur sa premiere image. Il part donc tel quel.

  function acNom(id) {
    const s = acStaff().find(x => x.id === id);
    return s ? ((s.prenom || '') + ' ' + (s.nom || '')).trim() : (id || '');
  }
  function acPrenom(id) {
    const s = acStaff().find(x => x.id === id);
    return s ? (s.prenom || s.id) : (id || '');
  }

  // ── CSS ───────────────────────────────────────────────────────────────────
  const AC_CSS = `
  #sec-accueil{padding:0}
  .ac-hello{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:18px}
  .ac-hello h2{font-size:1.5rem;font-weight:800;color:var(--gray-900);margin:0}
  .ac-hello .d{font-size:.86rem;color:var(--gray-500)}
  .ac-grid{display:grid;gap:16px;align-items:start}
  .ac-2{grid-template-columns:minmax(0,1fr) minmax(0,1.6fr)}
  .ac-2e{grid-template-columns:repeat(2,minmax(0,1fr))}
  @media(max-width:900px){.ac-2,.ac-2e{grid-template-columns:1fr}}
  .ac-card{background:#fff;border:1px solid var(--gray-200);border-radius:14px;overflow:hidden;margin-bottom:16px}
  .ac-h{padding:11px 16px;border-bottom:1px solid var(--gray-200);display:flex;align-items:center;gap:9px;font-size:.78rem;font-weight:800;text-transform:uppercase;letter-spacing:.8px;color:var(--gray-700)}
  .ac-h .ico{width:17px;height:17px;flex:none}
  .ac-n{margin-left:auto;background:var(--gray-100);color:var(--gray-700);border-radius:10px;padding:1px 9px;font-size:.72rem;letter-spacing:0;font-weight:700}
  .ac-b{padding:14px 16px}
  .ac-vide{padding:1.3rem 1rem;text-align:center;color:var(--gray-500);font-size:.83rem}
  .ac-lien{padding:9px 16px;border-top:1px solid var(--gray-200);background:var(--gray-100);text-align:center}
  .ac-lien button{background:none;border:none;color:var(--g-dark);font-weight:700;font-size:.82rem;cursor:pointer;font-family:inherit}
  .ac-anniv{background:linear-gradient(135deg,#FCE4EC 0%,#F8BBD0 100%);border-color:#F48FB1}
  .ac-anniv .ac-h{border-bottom-color:rgba(0,0,0,.07);color:#AD1457}
  .ac-anniv-n{font-size:1.15rem;font-weight:800;color:#880E4F;margin-bottom:2px}
  .ac-anniv-d{font-size:.82rem;color:#AD1457}
  .ac-fete{font-size:1.7rem;line-height:1}
  .ac-mom-piste{display:flex;gap:12px;overflow-x:auto;scroll-behavior:smooth;padding:2px 2px 8px;scroll-snap-type:x mandatory}
  .ac-mom{flex:0 0 232px;scroll-snap-align:start;border:1px solid var(--gray-200);border-radius:12px;overflow:hidden;background:var(--gray-100)}
  .ac-mom-img{height:120px;background-size:cover;background-position:center}
  .ac-mom-anniv{border-color:#F48FB1}
  .ac-mom-anniv .ac-mom-txt{background:#FCE4EC}
  .ac-mom-anniv .ac-mom-t{color:#880E4F}
  .ac-mom-anniv .ac-mom-s{color:#AD1457;font-style:normal;font-weight:600}
  .ac-mom-anniv.cejour{border-color:#E91E63;box-shadow:0 0 0 2px rgba(233,30,99,.18)}
  .ac-mom-anniv.passe{opacity:.5}
  .ac-gateau{display:flex;align-items:center;justify-content:center;font-size:2.6rem;background:linear-gradient(135deg,#FCE4EC 0%,#F8BBD0 100%)}
  .ac-mom-txt{padding:9px 11px}
  .ac-mom-t{font-weight:700;font-size:.83rem;color:var(--gray-900);line-height:1.3}
  .ac-mom-s{font-size:.78rem;color:var(--gray-700);font-style:italic;margin-top:3px;line-height:1.35}
  .ac-mom-m{font-size:.7rem;color:var(--gray-500);margin-top:6px;display:flex;align-items:center;gap:7px}
  .ac-coeur{cursor:pointer;border:none;background:none;font-size:.72rem;font-weight:700;color:var(--gray-500);padding:0;font-family:inherit}
  .ac-coeur.on{color:#E91E63}
  .ac-dots{display:flex;gap:6px;justify-content:center;margin-top:4px}
  .ac-dot{width:7px;height:7px;border-radius:50%;background:var(--gray-300);border:none;padding:0;cursor:pointer}
  .ac-dot.on{background:var(--g-dark)}
  .ac-alertes{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px}
  .ac-al{display:flex;align-items:center;gap:8px;background:#fff;border:1px solid var(--gray-200);border-radius:11px;padding:9px 14px;font-size:.85rem;font-weight:600;color:var(--gray-700);cursor:pointer;font-family:inherit}
  .ac-al:hover{border-color:var(--g-border)}
  .ac-pt{width:8px;height:8px;border-radius:50%;background:var(--red);flex:none}
  .ac-al.calme{color:var(--gray-500);font-weight:500}
  .ac-al.calme .ac-pt{background:#66BB6A}
  .ac-fil{display:block;width:100%;text-align:left;border:none;font-family:inherit;border-left:3px solid var(--gray-300);padding:9px 13px;margin-bottom:8px;border-radius:0 9px 9px 0;background:var(--gray-100);cursor:pointer}
  .ac-fil:hover{background:#eef1ef}
  .ac-fil.muet{border-left-color:#C62828}
  .ac-fil.repondu{border-left-color:#2E7D32}
  .ac-fil-t{font-weight:700;font-size:.88rem;color:var(--gray-900);display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .ac-tag{border-radius:9px;padding:1px 8px;font-size:.67rem;font-weight:700}
  .ac-fil-s{font-size:.76rem;color:var(--gray-500);margin-top:3px}
  .ac-rac{display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:10px}
  .ac-rac button{display:flex;flex-direction:column;align-items:center;gap:6px;padding:14px 8px;border:1px solid var(--gray-200);background:#fff;border-radius:12px;cursor:pointer;font-family:inherit;font-size:.79rem;font-weight:700;color:var(--gray-700);line-height:1.25;text-align:center}
  .ac-rac button:hover{border-color:var(--g-border);background:var(--g-pale);color:var(--g-dark)}
  .ac-rac a{text-decoration:none}
  .ac-rac button{position:relative;min-height:88px;justify-content:center}
  .ac-fav{width:28px;height:28px;object-fit:contain;display:block}
  .ac-emo{font-size:1.35rem;line-height:1;display:block}
  .ac-outil{position:absolute;top:4px;font-size:.78rem;color:var(--gray-300);cursor:pointer;padding:2px 4px;line-height:1}
  .ac-outil:hover{color:var(--gray-700)}
  .ac-outil.g{right:22px}
  .ac-outil.d{right:5px}
  .ac-rac .ico{width:21px;height:21px}
  .ac-td{display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid var(--gray-200)}
  .ac-td:last-child{border-bottom:none}
  .ac-td input{width:18px;height:18px;margin-top:1px;flex:none;cursor:pointer}
  .ac-td-t{font-size:.87rem;color:var(--gray-900);line-height:1.35}
  .ac-td-e{font-size:.74rem;color:var(--gray-500);margin-left:6px}
  .ac-td-e.tard{color:var(--red);font-weight:700}
  .ac-ajout{display:flex;gap:8px;margin-top:11px;flex-wrap:wrap}
  .ac-ongs{display:flex;gap:4px;margin-bottom:10px}
  .ac-ongs:empty{display:none}
  .ac-ong{border:none;background:none;font-family:inherit;font-size:.83rem;font-weight:700;color:var(--gray-500);
    cursor:pointer;padding:5px 11px;border-radius:9px;display:inline-flex;align-items:center;gap:7px}
  .ac-ong:hover{background:var(--gray-100)}
  .ac-ong.sel{background:var(--g-pale);color:var(--g-dark)}
  .ac-ong .n{background:var(--gray-200);color:var(--gray-700);border-radius:9px;padding:0 6px;font-size:.7rem}
  .ac-ong.sel .n{background:#fff}
  .ac-ong .n.rouge{background:var(--red);color:#fff}
  /* Tache confiee : pas de case a cocher — ce n'est pas a moi de la faire. */
  .ac-conf{align-items:flex-start}
  .ac-conf.neuve{background:#E8F5E9;border-radius:9px;padding:8px 10px;border-bottom:none;margin-bottom:4px}
  .ac-etat{width:18px;flex:none;text-align:center;color:var(--gray-300);font-weight:800;margin-top:1px}
  .ac-etat.ok{color:#2E7D32}
  .ac-inp{border:1px solid var(--gray-200);border-radius:9px;padding:8px 11px;font-size:.85rem;font-family:inherit;background:#fff;color:var(--gray-900)}
  #ac-td-txt{flex:1;min-width:120px}
  .ac-li{display:flex;align-items:baseline;gap:10px;padding:7px 0;border-bottom:1px solid var(--gray-200);font-size:.86rem}
  .ac-li:last-child{border-bottom:none}
  .ac-li .q{font-weight:800;color:var(--g-dark);flex:none;min-width:62px}
  .ac-li .t{color:var(--gray-900)}
  .ac-li.passe{opacity:.45}
  `;

  // ── Squelette de la section ───────────────────────────────────────────────
  const AC_SECTION = `
  <div class="ac-hello">
    <h2 id="ac-bonjour">Bonjour</h2>
    <span class="d" id="ac-date"></span>
  </div>
  <div class="ac-card">
    <div class="ac-h"><svg class="ico"><use href="#ic-amical"></use></svg> Quoi de neuf ?
      <span class="ac-n" id="ac-mom-n">0</span></div>
    <div class="ac-b">
      <div class="ac-mom-piste" id="ac-mom-piste"></div>
      <div class="ac-dots" id="ac-mom-dots"></div>
    </div>
    <div class="ac-lien"><button onclick="acFormMoment()">+ Partager quelque chose</button></div>
  </div>

  <div class="ac-alertes" id="ac-alertes"></div>

  <div class="ac-card">
    <div class="ac-h"><svg class="ico"><use href="#ic-livre"></use></svg> Cahier de transmission
      <span class="ac-n" id="ac-fils-n">0</span></div>
    <div class="ac-b" id="ac-fils"></div>
    <div class="ac-lien"><button onclick="showSec('messagerie')">Ouvrir le cahier complet</button></div>
  </div>

  <div class="ac-card">
    <div class="ac-h"><svg class="ico"><use href="#ic-amical"></use></svg> Messagerie
      <span class="ac-n" id="ac-mp-n">0</span></div>
    <div class="ac-b" id="ac-mp"></div>
    <div class="ac-lien"><button onclick="showSec('mp'); if(window.mpRender) mpRender();">Ouvrir la messagerie</button></div>
  </div>

  <div class="ac-grid ac-2e">
    <div class="ac-card">
      <div class="ac-h"><svg class="ico"><use href="#ic-valider"></use></svg> Ma todo
        <span class="ac-n" id="ac-td-n">0</span></div>
      <div class="ac-b">
        <div class="ac-ongs" id="ac-td-onglets"></div>
        <div id="ac-todos"></div>
        <div class="ac-ajout" id="ac-td-ajout">
          <input type="text" class="ac-inp" id="ac-td-txt" placeholder="Une tâche à ne pas oublier…"
                 onkeydown="if(event.key==='Enter')acAjouterTodo()">
          <select class="ac-inp" id="ac-td-qui" style="max-width:170px;display:none"></select>
          <button class="btn bp sm" onclick="acAjouterTodo()">Ajouter</button>
        </div>
      </div>
    </div>
    <div class="ac-card">
      <div class="ac-h"><svg class="ico"><use href="#ic-realisation"></use></svg> Raccourcis</div>
      <div class="ac-b"><div class="ac-rac" id="ac-rac"></div></div>
      <div class="ac-lien" id="ac-rac-add"></div>
    </div>
  </div>

  <div class="ac-card">
    <div class="ac-h"><svg class="ico"><use href="#ic-calendrier"></use></svg> Rendez-vous du mois</div>
    <div class="ac-b" id="ac-agenda"></div>
    <div class="ac-lien" id="ac-agenda-add"></div>
  </div>`;

  // ── Rendu ─────────────────────────────────────────────────────────────────
  window.acRender = function () {
    if (!document.getElementById('sec-accueil')) return;
    const u = acUser();
    const n = new Date();
    const b = document.getElementById('ac-bonjour');
    if (b) b.textContent = (n.getHours() < 18 ? 'Bonjour ' : 'Bonsoir ') + (u ? acPrenom(u.id) : '');
    const d = document.getElementById('ac-date');
    if (d) d.textContent = n.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    acRendMoments();
    acRendAlertes();
    acRendFils();
    acRendMessagerie();
    acRendTodos();
    acRendRaccourcis();
    acRendAgenda(n);
  };

  // ── Quoi de neuf ? ────────────────────────────────────────────────────────
  // Un seul fil, deux natures d'evenement : ce que l'equipe publie, et les
  // anniversaires du mois, fabriques a la volee depuis staffDB. L'anniversaire
  // n'est pas stocke : seule l'image qu'on lui attache l'est, dans une
  // publication de type `anniv` reperee par une cle « id du collaborateur +
  // annee ». Ainsi la carte revient chaque annee sans qu'on ait rien a creer,
  // et la photo de l'an dernier ne resurgit pas.
  function acVivants() {
    const n = Date.now();
    return acMoments()
      .filter(m => m && m.type !== 'anniv' && (!m.expiresAt || m.expiresAt > n))
      .sort((a, b) => (b.ts || 0) - (a.ts || 0))
      .slice(0, AC_MOMENT_MAX);
  }
  function acCleAnniv(s, n) { return s.id + '-' + n.getFullYear() + '-' + s.anniv; }
  function acImageAnniv(cle) {
    const m = acMoments().find(x => x && x.type === 'anniv' && x.cle === cle);
    return m || null;
  }
  // Les anniversaires du mois, aujourd'hui d'abord.
  function acCartesAnniv(n) {
    const mois = pad(n.getMonth() + 1), auj = acMoisJour(n);
    return acStaff()
      .filter(s => s.anniv && String(s.anniv).slice(0, 2) === mois)
      .sort((a, b) => String(a.anniv).localeCompare(String(b.anniv)))
      .map(function (s) {
        const cle = acCleAnniv(s, n);
        const att = acImageAnniv(cle);
        return {
          anniv: true, cle: cle, staff: s, jour: +String(s.anniv).slice(3),
          cejour: s.anniv === auj, passe: String(s.anniv) < auj,
          image: att ? acUrlImage(att) : null, attId: att ? att.id : null,
          likes: att ? (att.likes || []) : []
        };
      });
  }
  function acFil(n) {
    const a = acCartesAnniv(n);
    // Aujourd'hui passe devant, puis ce que l'equipe a publie, puis le reste
    // du mois : le plus opportun d'abord, sans enterrer les publications.
    return a.filter(x => x.cejour)
      .concat(acVivants())
      .concat(a.filter(x => !x.cejour));
  }

  function acRendMoments() {
    const el = document.getElementById('ac-mom-piste'); if (!el) return;
    const l = acFil(new Date()), u = acUser();
    document.getElementById('ac-mom-n').textContent = l.length;
    if (!l.length) {
      el.innerHTML = '<div class="ac-vide" style="flex:1">Rien de neuf cette semaine. À vous de commencer.</div>';
      document.getElementById('ac-mom-dots').innerHTML = '';
      return;
    }
    el.innerHTML = l.map(m => m.anniv ? acCarteAnniv(m, u) : acCarteMoment(m, u)).join('');
    document.getElementById('ac-mom-dots').innerHTML = l.length > 1
      ? l.map((m, i) => '<button class="ac-dot' + (i === 0 ? ' on' : '') + '" onclick="acGlisser(' + i + ')"></button>').join('')
      : '';
  }

  function acCarteMoment(m, u) {
    const aime = !!(u && Array.isArray(m.likes) && m.likes.indexOf(u.id) >= 0);
    const nb = Array.isArray(m.likes) ? m.likes.length : 0;
    const src = acUrlImage(m);
    return '<div class="ac-mom">'
      + (src
          ? '<div class="ac-mom-img" style="background-image:url(\'' + src + '\')"></div>'
          : '<div class="ac-mom-img" style="background:linear-gradient(135deg,var(--g-pale),#cfe3d6)"></div>')
      + '<div class="ac-mom-txt">'
      + (m.titre ? '<div class="ac-mom-t">' + E(m.titre) + '</div>' : '')
      + (m.texte ? '<div class="ac-mom-s">' + E(m.texte) + '</div>' : '')
      + '<div class="ac-mom-m"><span>' + E(m.auteurNom || acNom(m.auteur)) + '</span>'
      + '<button class="ac-coeur' + (aime ? ' on' : '') + '" onclick="acAimer(' + m.id + ')">'
      + (aime ? '♥' : '♡') + (nb ? ' ' + nb : '') + '</button>'
      + (m.majAt && m.majAt > (m.ts || 0)
          ? '<span style="font-style:italic;opacity:.7">modifié</span>' : '')
      // Modifier : l'AUTEUR seul. Un administrateur peut retirer une publication
      // qui n'a rien a faire la, mais pas reecrire les mots de quelqu'un d'autre.
      + (u && m.auteur === u.id
          ? '<button class="ac-coeur" style="margin-left:auto" onclick="acFormMoment(' + m.id + ')" title="Modifier">✎</button>' : '')
      + (u && (m.auteur === u.id || acAdmin())
          ? '<button class="ac-coeur"' + (u && m.auteur === u.id ? '' : ' style="margin-left:auto"')
            + ' onclick="acRetirerMoment(' + m.id + ')" title="Retirer">✕</button>' : '')
      + '</div></div></div>';
  }

  function acCarteAnniv(a, u) {
    const aime = !!(u && a.likes.indexOf(u.id) >= 0);
    const nb = a.likes.length;
    const s = a.staff;
    return '<div class="ac-mom ac-mom-anniv' + (a.cejour ? ' cejour' : (a.passe ? ' passe' : '')) + '">'
      + (a.image
          ? '<div class="ac-mom-img" style="background-image:url(\'' + a.image + '\')"></div>'
          : '<div class="ac-mom-img ac-gateau">🎂</div>')
      + '<div class="ac-mom-txt">'
      + '<div class="ac-mom-t">' + E((s.prenom || '') + ' ' + (s.nom || '')) + '</div>'
      + '<div class="ac-mom-s">' + (a.cejour ? 'C’est aujourd’hui ! 🎉'
          : a.jour + ' ' + MOIS_CT[new Date().getMonth()]) + '</div>'
      + '<div class="ac-mom-m">'
      + (a.attId
          ? '<button class="ac-coeur' + (aime ? ' on' : '') + '" onclick="acAimer(' + a.attId + ')">'
            + (aime ? '♥' : '♡') + (nb ? ' ' + nb : '') + '</button>'
          : '<span style="opacity:.6">Anniversaire</span>')
      + '<button class="ac-coeur" style="margin-left:auto" onclick="acFormAnniv(\'' + a.cle + '\')" title="'
      + (a.image ? 'Changer l’image' : 'Ajouter une image ou un GIF') + '">'
      + (a.image ? '✎' : '+ image') + '</button>'
      + '</div></div></div>';
  }

  window.acGlisser = function (i) {
    const p = document.getElementById('ac-mom-piste'); if (!p || !p.children.length) return;
    p.scrollLeft = (p.children[0].offsetWidth + 12) * i;
    [].forEach.call(document.querySelectorAll('#ac-mom-dots .ac-dot'), (d, k) => d.classList.toggle('on', k === i));
  };
  window.acAimer = function (id) {
    const u = acUser(); if (!u) return;
    const m = acMoments().find(x => x.id === id); if (!m) return;
    m.likes = Array.isArray(m.likes) ? m.likes : [];
    const i = m.likes.indexOf(u.id);
    if (i >= 0) m.likes.splice(i, 1); else m.likes.push(u.id);
    m.updatedAt = Date.now();
    acSave(); acRendMoments();
  };
  window.acRetirerMoment = function (id) {
    const u = acUser(); if (!u) return;
    const l = acMoments(), i = l.findIndex(x => x.id === id);
    if (i < 0) return;
    if (l[i].auteur !== u.id && !acAdmin()) { alert('Seul l’auteur peut retirer sa publication.'); return; }
    if (!confirm('Retirer cette publication ?')) return;
    if (typeof markDeleted === 'function') markDeleted('moments', id);
    l.splice(i, 1);
    acSave(true); acRendMoments();
  };

  // ── Alertes ───────────────────────────────────────────────────────────────
  function acRendAlertes() {
    const el = document.getElementById('ac-alertes'); if (!el) return;
    const parts = [];
    const muets = acFils().filter(t => t && t.status !== 'closed' && !(Array.isArray(t.msgs) && t.msgs.length)).length;
    parts.push(muets
      ? '<button class="ac-al" onclick="showSec(\'messagerie\')"><span class="ac-pt"></span>'
        + muets + ' transmission' + (muets > 1 ? 's' : '') + ' sans réponse</button>'
      : '<span class="ac-al calme"><span class="ac-pt"></span>Aucune transmission en attente</span>');
    if (typeof credits !== 'undefined' && Array.isArray(credits) && typeof CRED_FOLLOWUP_DAYS !== 'undefined') {
      const lim = Date.now() - CRED_FOLLOWUP_DAYS * 86400000;
      const rel = credits.filter(function (c) {
        if (!c || c.statut !== 'en cours') return false;
        const r = Array.isArray(c.relances) && c.relances.length ? c.relances[c.relances.length - 1] : null;
        const t = r ? new Date(r.date).getTime() : new Date(c.dateAvance || 0).getTime();
        return t && t < lim;
      }).length;
      if (rel) parts.push('<button class="ac-al" onclick="showSec(\'credits\')"><span class="ac-pt"></span>'
        + rel + ' crédit' + (rel > 1 ? 's' : '') + ' à relancer</button>');
    }
    el.innerHTML = parts.join('');
  }

  // ── Cahier de transmission ────────────────────────────────────────────────
  function acRendFils() {
    const el = document.getElementById('ac-fils'); if (!el) return;
    const l = acFils().filter(t => t && t.status !== 'closed')
      .sort((a, b) => (b.id || 0) - (a.id || 0)).slice(0, 5);
    document.getElementById('ac-fils-n').textContent = l.length;
    if (!l.length) { el.innerHTML = '<div class="ac-vide">Aucune transmission en cours.</div>'; return; }
    el.innerHTML = l.map(function (t) {
      const rep = Array.isArray(t.msgs) && t.msgs.length;
      const dern = rep ? t.msgs[t.msgs.length - 1] : null;
      const apercu = dern ? String(dern.txt || dern.texte || dern.msg || '') : '';
      return '<button class="ac-fil ' + (rep ? 'repondu' : 'muet') + '" onclick="acOuvrirFil(' + t.id + ')">'
        + '<div class="ac-fil-t">' + E(t.subj || '(sans sujet)')
        + '<span class="ac-tag" style="' + (rep ? 'background:#E8F5E9;color:#2E7D32' : 'background:#FFEBEE;color:#C62828') + '">'
        + (rep ? 'Répondu' : 'Sans réponse') + '</span></div>'
        + '<div class="ac-fil-s">' + E(t.type || '')
        + (t.patient && t.patient.med ? ' · ' + E(t.patient.med) : '')
        + (apercu ? ' · ' + E(apercu.slice(0, 60)) : '')
        + '</div></button>';
    }).join('');
  }
  window.acOuvrirFil = function (id) {
    showSec('messagerie');
    if (typeof openThread === 'function') { try { openThread(id); } catch (e) {} }
  };

  // ── Messagerie ────────────────────────────────────────────────────────────
  // L'accueil ne recalcule rien : il affiche le resume que le module fabrique.
  // Si la messagerie est masquee pour ce poste, la carte disparait aussi —
  // montrer des conversations qu'on ne peut pas ouvrir n'a pas de sens.
  function acRendMessagerie() {
    const el = document.getElementById('ac-mp'); if (!el) return;
    const carte = el.closest('.ac-card');
    const bouton = document.querySelector('.sb-item[data-sec="mp"]');
    if (carte && (!bouton || bouton.style.display === 'none')) { carte.style.display = 'none'; return; }
    if (carte) carte.style.display = '';

    const l = (typeof mpResume === 'function') ? mpResume(4) : [];
    const n = l.reduce(function (t, c) { return t + (c.nonLus || 0); }, 0);
    const cpt = document.getElementById('ac-mp-n');
    if (cpt) cpt.textContent = n || l.length;
    if (!l.length) {
      el.innerHTML = '<div class="ac-vide">Aucune conversation. '
        + 'Écrivez à quelqu’un depuis la messagerie.</div>';
      return;
    }
    el.innerHTML = l.map(function (c) {
      const qui = c.moi ? 'Vous : ' : (c.groupe && c.auteur ? mpPrenom(c.auteur) + ' : ' : '');
      return '<button class="ac-fil ' + (c.nonLus ? 'muet' : 'repondu') + '" onclick="acOuvrirConvo(' + c.id + ')">'
        + '<div class="ac-fil-t">' + E(c.titre)
        + (c.nonLus ? '<span class="ac-tag" style="background:#FFEBEE;color:#C62828">'
            + c.nonLus + ' non lu' + (c.nonLus > 1 ? 's' : '') + '</span>' : '')
        + '<span style="margin-left:auto;font-size:.72rem;color:var(--gray-500);font-weight:500">'
        + (typeof mpQuand === 'function' ? mpQuand(c.quand) : '') + '</span></div>'
        + '<div class="ac-fil-s">' + E(qui + (c.apercu || 'Aucun message')).slice(0, 80) + '</div>'
        + '</button>';
    }).join('');
  }
  window.acOuvrirConvo = function (id) {
    showSec('mp');
    if (typeof mpOuvrir === 'function') { try { mpOuvrir(id); } catch (e) {} }
    else if (typeof mpRender === 'function') mpRender();
  };

  // ── Todo ──────────────────────────────────────────────────────────────────
  // `pour` = a qui la tache incombe, `par` = qui l'a inscrite. Les deux sont
  // identiques quand on s'inscrit une tache a soi-meme ; ils divergent quand un
  // admin en confie une. `auteur` est lu en repli pour les taches d'avant.
  //
  // Deux listes SEPAREES, dans deux onglets. Melangees, on ne sait plus ce
  // qu'on doit faire soi-meme : « Sortir les perimes » et « Alexis doit sortir
  // les perimes » ne se lisent pas de la meme facon, et la seconde n'a rien a
  // faire dans une liste de choses a faire.
  function acQui(t) { return t ? (t.pour || t.auteur) : null; }
  let acTodoVue = 'mien';

  function acMesTodos() {
    const u = acUser(); if (!u) return [];
    return acTodos().filter(t => t && acQui(t) === u.id && !t.fait)
      .sort((a, b) => (b.ts || 0) - (a.ts || 0));
  }
  // Ce que j'ai confie a quelqu'un d'autre. Les taches que je me suis inscrites
  // a moi-meme n'y figurent pas : elles sont deja dans l'autre onglet.
  function acConfiees() {
    const u = acUser(); if (!u) return [];
    return acTodos().filter(t => t && t.par === u.id && acQui(t) !== u.id && !t.classee)
      .sort(function (a, b) {
        // Ce qui vient d'etre fait remonte : c'est la seule chose qui appelle
        // une action de ma part.
        const af = (a.fait && !a.vuPar) ? 1 : 0, bf = (b.fait && !b.vuPar) ? 1 : 0;
        return bf - af || (b.ts || 0) - (a.ts || 0);
      });
  }
  // Taches confiees, faites, et que je n'ai pas encore vues passer.
  function acAFeliciter() {
    const u = acUser(); if (!u) return 0;
    return acTodos().filter(t => t && t.par === u.id && acQui(t) !== u.id
      && t.fait && !t.vuPar && !t.classee).length;
  }

  window.acTodoOnglet = function (v) {
    acTodoVue = v;
    // Ouvrir l'onglet vaut prise de connaissance : la pastille rouge s'eteint.
    // Sans cela elle resterait allumee jusqu'a ce qu'on classe chaque tache,
    // et une pastille qui ne s'eteint jamais cesse d'etre un signal.
    if (v === 'confiees' && acMarquerVues()) acSave();
    acRendTodos();
  };

  function acRendTodos() {
    const el = document.getElementById('ac-todos'); if (!el) return;
    const u = acUser();
    const mien = acMesTodos(), conf = acConfiees(), neuves = acAFeliciter();
    const cpt = document.getElementById('ac-td-n');
    if (cpt) cpt.textContent = mien.length;

    // Onglets : le second n'apparait que si l'on a confie quelque chose. Un
    // onglet vide en permanence n'apprend rien et prend de la place.
    const ong = document.getElementById('ac-td-onglets');
    if (ong) {
      if (!conf.length) { ong.innerHTML = ''; acTodoVue = 'mien'; }
      else {
        ong.innerHTML = '<button class="ac-ong' + (acTodoVue === 'mien' ? ' sel' : '') + '" onclick="acTodoOnglet(\'mien\')">'
          + 'À faire<span class="n">' + mien.length + '</span></button>'
          + '<button class="ac-ong' + (acTodoVue === 'confiees' ? ' sel' : '') + '" onclick="acTodoOnglet(\'confiees\')">'
          + 'Confiées<span class="n' + (neuves ? ' rouge' : '') + '">' + (neuves || conf.length) + '</span></button>';
      }
    }

    // Le choix du destinataire n'apparait que pour un admin, et seulement dans
    // l'onglet ou l'on ecrit.
    const sel = document.getElementById('ac-td-qui');
    const zoneAjout = document.getElementById('ac-td-ajout');
    if (zoneAjout) zoneAjout.style.display = (acTodoVue === 'mien') ? '' : 'none';
    if (sel) {
      if (acAdmin() && u) {
        const garde = sel.value;
        sel.style.display = '';
        sel.innerHTML = '<option value="' + E(u.id) + '">Pour moi</option>'
          + acStaff().filter(s => s.id !== u.id)
              .map(s => '<option value="' + E(s.id) + '">Pour ' + E(s.prenom || s.id) + '</option>').join('');
        if (garde) sel.value = garde;
      } else {
        sel.style.display = 'none';
      }
    }

    if (acTodoVue === 'confiees') { el.innerHTML = acListeConfiees(conf); return; }

    if (!mien.length) { el.innerHTML = '<div class="ac-vide">Rien à faire pour le moment.</div>'; return; }
    el.innerHTML = mien.map(function (t) {
      const confiee = t.par && t.par !== acQui(t);
      return '<label class="ac-td"><input type="checkbox" onchange="acCocher(' + t.id + ')">'
        + '<span class="ac-td-t">' + E(t.texte || '')
        + (confiee ? '<span class="ac-td-e">demandé par ' + E(acPrenom(t.par)) + '</span>' : '')
        + '</span></label>';
    }).join('');
  }

  function acListeConfiees(l) {
    if (!l.length) return '<div class="ac-vide">Vous n’avez rien confié.</div>';
    return l.map(function (t) {
      const fini = !!t.fait;
      const neuve = fini && !t.vuPar;
      return '<div class="ac-td ac-conf' + (neuve ? ' neuve' : '') + '">'
        + '<span class="ac-etat' + (fini ? ' ok' : '') + '">' + (fini ? '✓' : '·') + '</span>'
        + '<span class="ac-td-t">' + E(t.texte || '')
        + '<span class="ac-td-e">' + (fini
            ? 'fait par ' + E(acPrenom(acQui(t))) + (t.faitAt ? ' · ' + acAge(t.faitAt) : '')
            : 'en attente · ' + E(acPrenom(acQui(t)))) + '</span></span>'
        + (fini
            ? '<button class="ac-coeur" style="margin-left:auto" onclick="acClasser(' + t.id + ')" title="Retirer de la liste">✕</button>'
            : '<button class="ac-coeur" style="margin-left:auto" onclick="acAnnulerConfiee(' + t.id + ')" title="Annuler cette demande">✕</button>')
        + '</div>';
    }).join('');
  }

  // Ouvrir l'onglet vaut prise de connaissance : la pastille rouge s'eteint.
  // Le ✕ range definitivement la tache. Deux gestes distincts, parce que « j'ai
  // vu » et « c'est classe » ne sont pas la meme chose.
  function acMarquerVues() {
    const u = acUser(); if (!u) return false;
    let n = 0;
    acTodos().forEach(function (t) {
      if (t && t.par === u.id && acQui(t) !== u.id && t.fait && !t.vuPar && !t.classee) {
        t.vuPar = Date.now(); t.updatedAt = Date.now(); n++;
      }
    });
    return n > 0;
  }
  window.acClasser = function (id) {
    const t = acTodos().find(x => x.id === id); if (!t) return;
    t.classee = true; t.updatedAt = Date.now();
    acSave(true); acRendTodos();
  };
  window.acAnnulerConfiee = function (id) {
    const t = acTodos().find(x => x.id === id); if (!t) return;
    if (!confirm('Annuler « ' + (t.texte || '') + ' » ?\n\nLa tâche disparaîtra aussi de la liste de '
      + acPrenom(acQui(t)) + '.')) return;
    if (typeof markDeleted === 'function') markDeleted('todoPerso', id);
    const l = acTodos(), i = l.findIndex(x => x.id === id);
    if (i >= 0) l.splice(i, 1);
    acSave(true); acRendTodos();
  };

  window.acAjouterTodo = function () {
    const u = acUser(); if (!u) { alert('Identifiez-vous avec votre code PIN.'); return; }
    const i = document.getElementById('ac-td-txt');
    const texte = (i.value || '').trim();
    if (!texte) return;
    const sel = document.getElementById('ac-td-qui');
    const pour = (acAdmin() && sel && sel.value) ? sel.value : u.id;
    const now = Date.now();
    acTodos().unshift({ id: now, ts: now, pour: pour, par: u.id, texte: texte, fait: false, updatedAt: now });
    i.value = '';
    acSave(true); acRendTodos();
    if (pour !== u.id) acToast('Tâche confiée à ' + acPrenom(pour) + '.');
  };
  window.acCocher = function (id) {
    const t = acTodos().find(x => x.id === id); if (!t) return;
    // La tache cochee sort de la liste mais reste en base : une suppression se
    // propagerait mal entre postes, et celui qui l'a confiee doit apprendre
    // qu'elle est faite.
    t.fait = true; t.faitAt = Date.now(); t.parQui = (acUser() || {}).id; t.updatedAt = Date.now();
    acSave(true); acRendTodos();
  };
  function acToast(m) {
    const d = document.createElement('div');
    d.textContent = m;
    d.style.cssText = 'position:fixed;bottom:22px;left:50%;transform:translateX(-50%);background:#1D5C3A;color:#fff;padding:10px 18px;border-radius:10px;font-size:.86rem;z-index:99999;box-shadow:0 6px 20px rgba(0,0,0,.25)';
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 2600);
  }

  // ── Raccourcis ────────────────────────────────────────────────────────────
  // Des liens vers des sites externes — Ameli, le portail du grossiste, le
  // Vidal… — tenus par les administrateurs, communs a toute l'equipe.
  function acRendRaccourcis() {
    const el = document.getElementById('ac-rac'); if (!el) return;
    const add = document.getElementById('ac-rac-add');
    if (add) add.innerHTML = acAdmin() ? '<button onclick="acFormLien()">+ Ajouter un lien</button>' : '';
    const l = acLiens().slice().sort((a, b) => (a.ts || 0) - (b.ts || 0));
    if (!l.length) {
      el.innerHTML = '<div class="ac-vide" style="grid-column:1/-1">Aucun lien.'
        + (acAdmin() ? ' Ajoutez les sites que l’équipe ouvre tous les jours.' : '')
        + '</div>';
      return;
    }
    el.innerHTML = l.map(function (r) {
      // rel="noopener" : sans lui, la page ouverte peut manipuler la notre.
      return '<a href="' + E(r.url) + '" target="_blank" rel="noopener noreferrer"'
        + ' title="' + E(r.url) + '">'
        + '<button style="width:100%">'
        + acIconeLien(r)
        + '<span>' + E(r.lbl || r.url) + '</span>'
        + (acAdmin()
            ? '<span class="ac-outil g" onclick="event.preventDefault();event.stopPropagation();acFormIcone(' + r.id + ')" title="Changer l’icône">✎</span>'
              + '<span class="ac-outil d" onclick="event.preventDefault();event.stopPropagation();acRetirerLien(' + r.id + ')" title="Retirer">✕</span>'
            : '')
        + '</button></a>';
    }).join('');
  }

  // Trois niveaux, du plus voulu au plus sûr :
  //   1. l'icône déposée par un administrateur, si elle existe ;
  //   2. celle du site lui-même — demandée par le navigateur de l'opérateur,
  //      donc au site qu'il s'apprête à ouvrir : aucun tiers dans l'affaire ;
  //   3. l'emoji, quand le site n'en sert pas.
  // Le repli est câblé sur `onerror` : beaucoup de sites n'ont pas de
  // /favicon.ico, et une icône cassée serait pire qu'un emoji.
  function acIconeLien(r) {
    if (r.imgId) return '<img class="ac-fav" src="/api/images/' + E(r.imgId) + '" alt="">';
    let hote = '';
    try { hote = new URL(r.url).origin; } catch (e) {}
    const emo = '<span class="ac-emo">' + E(r.ico || '🔗') + '</span>';
    if (!hote) return emo;
    return '<img class="ac-fav" src="' + E(hote) + '/favicon.ico" alt="" '
      + 'onerror="acFaviconRate(this)"><span class="ac-emo" style="display:none">' + E(r.ico || '🔗') + '</span>';
  }
  window.acFaviconRate = function (img) {
    // Le site ne sert pas d'icône à cette adresse : on bascule sur l'emoji.
    img.style.display = 'none';
    const s = img.nextElementSibling;
    if (s && s.classList.contains('ac-emo')) s.style.display = '';
  };

  // Seuls http et https sont acceptes : une adresse « javascript: » collee ici
  // s'executerait dans la page, avec la session de celui qui clique.
  function acUrlSure(v) {
    let t = String(v || '').trim();
    if (!t) return null;
    if (!/^https?:\/\//i.test(t)) t = 'https://' + t;
    try {
      const u = new URL(t);
      return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : null;
    } catch (e) { return null; }
  }
  window.acFormLien = function () {
    if (!acAdmin()) return;
    const lbl = prompt('Nom du raccourci (ex. Ameli Pro)'); if (!lbl || !lbl.trim()) return;
    const brut = prompt('Adresse du site (ex. ameli.fr/pharmacien)'); if (!brut) return;
    const url = acUrlSure(brut);
    if (!url) { alert('Adresse invalide. Attendu : une adresse web commençant par http:// ou https://'); return; }
    const ico = (prompt('Un emoji de secours, si le site ne fournit pas d’icône', '🔗') || '🔗').trim().slice(0, 4);
    const now = Date.now();
    acLiens().push({ id: now, ts: now, lbl: lbl.trim().slice(0, 40), url: url, ico: ico, imgId: null, updatedAt: now });
    acSave(true); acRendRaccourcis();
  };

  // ── Icône déposée à la main ───────────────────────────────────────────────
  let acLienCourant = null;
  window.acFormIcone = function (id) {
    if (!acAdmin()) return;
    const r = acLiens().find(x => x.id === id); if (!r) return;
    acLienCourant = id; acImg = null;
    document.getElementById('ac-ico-nom').textContent = r.lbl || r.url;
    document.getElementById('ac-ico-apercu').innerHTML = r.imgId
      ? '<img src="/api/images/' + E(r.imgId) + '" style="width:48px;height:48px;object-fit:contain;border-radius:8px">'
        + '<div style="font-size:.74rem;color:var(--gray-500);margin-top:4px">Icône actuelle · '
        + '<span style="cursor:pointer;text-decoration:underline" onclick="acEffacerIcone()">revenir à celle du site</span></div>'
      : '<div style="font-size:.78rem;color:var(--gray-500)">Aucune icône déposée : celle du site est utilisée, '
        + 'et l’emoji si le site n’en fournit pas.</div>';
    const f = document.getElementById('ac-ico-img'); if (f) f.value = '';
    document.getElementById('ac-ov-ico').classList.add('open');
  };
  window.acFermerIcone = function () { document.getElementById('ac-ov-ico').classList.remove('open'); };
  window.acEffacerIcone = function () {
    const r = acLiens().find(x => x.id === acLienCourant); if (!r) return;
    r.imgId = null; r.updatedAt = Date.now();
    acSave(true); acFermerIcone(); acRendRaccourcis();
  };
  window.acPoserIcone = async function () {
    const r = acLiens().find(x => x.id === acLienCourant); if (!r) return;
    if (!acImg) { alert('Choisissez une image.'); return; }
    const id = await acDeposerImage(); if (!id) return;
    r.imgId = id; r.updatedAt = Date.now();
    acImg = null;
    acFermerIcone(); acSave(true); acRendRaccourcis();
  };

  window.acRetirerLien = function (id) {
    if (!acAdmin()) return;
    const l = acLiens(), i = l.findIndex(x => x.id === id); if (i < 0) return;
    if (!confirm('Retirer le raccourci « ' + (l[i].lbl || '') + ' » ?')) return;
    if (typeof markDeleted === 'function') markDeleted('liens', id);
    l.splice(i, 1); acSave(true); acRendRaccourcis();
  };

  // ── Agenda ────────────────────────────────────────────────────────────────
  function acRendAgenda(n) {
    const el = document.getElementById('ac-agenda'); if (!el) return;
    const add = document.getElementById('ac-agenda-add');
    if (add) add.innerHTML = acAdmin() ? '<button onclick="acFormRdv()">+ Ajouter un rendez-vous</button>' : '';
    const mois = acIso(n).slice(0, 7), auj = acIso(n);
    const l = acAgenda().filter(r => r && String(r.date || '').slice(0, 7) === mois)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.h || '').localeCompare(String(b.h || '')));
    if (!l.length) { el.innerHTML = '<div class="ac-vide">Rien de prévu ce mois-ci.</div>'; return; }
    el.innerHTML = l.map(function (r) {
      const d = new Date(r.date + 'T12:00:00');
      return '<div class="ac-li' + (r.date < auj ? ' passe' : '') + '">'
        + '<span class="q">' + JOURS[d.getDay()] + ' ' + d.getDate() + '</span>'
        + '<span class="t">' + E(r.titre || '') + (r.h ? ' · ' + E(r.h) : '') + '</span>'
        + (acAdmin() ? '<button class="ac-coeur" style="margin-left:auto" onclick="acRetirerRdv(' + r.id + ')">✕</button>' : '')
        + '</div>';
    }).join('');
  }
  window.acFormRdv = function () {
    if (!acAdmin()) return;
    const titre = prompt('Quel rendez-vous ? (ex. Réunion d’équipe)'); if (!titre || !titre.trim()) return;
    const date = prompt('Quel jour ? (jj/mm)', ''); if (!date) return;
    const m = String(date).match(/^(\d{1,2})\D+(\d{1,2})$/);
    if (!m) { alert('Date attendue au format jj/mm.'); return; }
    const jour = +m[1], mo = +m[2];
    if (jour < 1 || jour > 31 || mo < 1 || mo > 12) { alert('Date invalide.'); return; }
    const n = new Date();
    const iso = n.getFullYear() + '-' + pad(mo) + '-' + pad(jour);
    const h = prompt('À quelle heure ? (facultatif, ex. 14h)', '') || '';
    const now = Date.now();
    acAgenda().push({ id: now, date: iso, h: h.trim(), titre: titre.trim(), par: (acUser() || {}).id, updatedAt: now });
    acSave(true); acRender();
  };
  window.acRetirerRdv = function (id) {
    if (!acAdmin()) return;
    const l = acAgenda(), i = l.findIndex(x => x.id === id); if (i < 0) return;
    if (!confirm('Retirer ce rendez-vous ?')) return;
    if (typeof markDeleted === 'function') markDeleted('agenda', id);
    l.splice(i, 1); acSave(true); acRender();
  };

  // ── Partager un moment ────────────────────────────────────────────────────
  let acImg = null;
  // `acMomEdit` : identifiant de la publication en cours de modification, ou
  // null pour une nouvelle. `acImgEfface` distingue « je ne change pas
  // l'image » (acImg null) de « je veux la retirer » — sans quoi on ne pourrait
  // jamais enlever une photo une fois posee.
  let acMomEdit = null, acImgEfface = false;
  window.acFormMoment = function (id) {
    const u = acUser(); if (!u) { alert('Identifiez-vous avec votre code PIN.'); return; }
    acImg = null; acImgEfface = false; acMomEdit = null;
    let m = null;
    if (id != null) {
      m = acMoments().find(x => x && x.id === id);
      if (!m) return;
      if (m.auteur !== u.id) { alert('Seul l’auteur peut modifier sa publication.'); return; }
      acMomEdit = id;
    }
    document.getElementById('ac-mom-titre').value = m ? (m.titre || '') : '';
    document.getElementById('ac-mom-texte').value = m ? (m.texte || '') : '';
    const src = m ? acUrlImage(m) : null;
    document.getElementById('ac-mom-apercu').innerHTML = src
      ? '<img src="' + src + '" style="max-width:100%;max-height:150px;border-radius:10px;display:block">'
        + '<div style="font-size:.74rem;color:var(--gray-500);margin-top:4px">Image actuelle · '
        + '<span style="cursor:pointer;text-decoration:underline" onclick="acEffacerImageMoment()">la retirer</span></div>'
      : '';
    const f = document.getElementById('ac-mom-img'); if (f) f.value = '';
    const t = document.getElementById('ac-mom-h'); if (t) t.textContent = m ? 'Modifier la publication' : 'Quoi de neuf ?';
    const b = document.getElementById('ac-mom-ok'); if (b) b.textContent = m ? 'Enregistrer' : 'Partager';
    document.getElementById('ac-ov-mom').classList.add('open');
  };
  window.acEffacerImageMoment = function () {
    acImg = null; acImgEfface = true;
    document.getElementById('ac-mom-apercu').innerHTML =
      '<div style="font-size:.78rem;color:var(--gray-500)">L’image sera retirée à l’enregistrement.</div>';
    const f = document.getElementById('ac-mom-img'); if (f) f.value = '';
  };
  window.acFermerMoment = function () { document.getElementById('ac-ov-mom').classList.remove('open'); };
  // Adresse d'affichage : identifiant vers /api/images, sinon l'ancienne
  // dataURL pour les publications d'avant la bascule.
  function acUrlImage(m) {
    if (!m) return null;
    if (m.imgId) return '/api/images/' + m.imgId;
    return m.image || null;
  }
  // Depot de l'image choisie. Renvoie l'identifiant, ou null en cas d'echec.
  async function acDeposerImage() {
    if (!acImg) return null;
    const v = String(acImg);
    const m = v.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return null;
    try {
      const r = await fetch('/api/images', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mime: m[1], data: m[2] })
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j || !j.ok) {
        alert('L’image n’a pas pu être enregistrée : ' + ((j && j.error) || ('erreur ' + r.status)));
        return null;
      }
      return j.id;
    } catch (e) {
      alert('L’image n’a pas pu être enregistrée : serveur injoignable.');
      return null;
    }
  }
  window.acPhoto = function (inp) {
    const f = inp.files && inp.files[0]; if (!f) return;
    const cible = inp.getAttribute('data-cible') || 'ac-mom-apercu';
    const gif = /gif$/i.test(f.type || '') || /\.gif$/i.test(f.name || '');
    // Un PNG leger part tel quel : le redimensionnement le convertirait en
    // JPEG, qui n'a pas de transparence — un logo se retrouverait sur un fond
    // noir. Au-dela, la compression vaut le fond perdu.
    const pngLeger = /png$/i.test(f.type || '') && f.size <= 300 * 1024;

    if (gif || pngLeger) {
      // Un GIF anime ne passe pas par un canevas : il en ressortirait fige sur
      // sa premiere image. On garde le fichier tel quel, donc on borne sa taille.
      const ko = Math.round(f.size / 1024);
      if (gif && ko > AC_GIF_MAX_KO) {
        alert('Ce GIF pèse ' + (ko > 1024 ? (ko / 1024).toFixed(1) + ' Mo' : ko + ' Ko')
          + ', au-delà de la limite de ' + Math.round(AC_GIF_MAX_KO / 1024) + ' Mo.\n\n'
          + 'Choisissez-en un plus léger, ou une photo.');
        inp.value = ''; return;
      }
      const lec = new FileReader();
      lec.onload = function (e) { acImg = e.target.result; acApercu(cible, ko, gif); };
      lec.readAsDataURL(f);
      return;
    }

    const img = new Image(), lec = new FileReader();
    lec.onload = e => { img.src = e.target.result; };
    img.onload = function () {
      const r = Math.min(1, AC_MOMENT_PX / img.width);
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      acImg = c.toDataURL('image/jpeg', AC_MOMENT_Q);
      acApercu(cible, Math.round(acImg.length * 0.75 / 1024), false);
    };
    lec.readAsDataURL(f);
  };
  function acApercu(cible, ko, gif) {
    const el = document.getElementById(cible); if (!el) return;
    el.innerHTML = '<img src="' + acImg + '" style="max-width:100%;max-height:150px;border-radius:10px;display:block">'
      + '<div style="font-size:.74rem;color:var(--gray-500);margin-top:4px">' + ko + ' Ko'
      + (gif ? ' · GIF animé' : '') + ' · '
      + '<span style="cursor:pointer;text-decoration:underline" onclick="acRetirerPhoto()">retirer</span></div>';
  }
  window.acRetirerPhoto = function () {
    acImg = null;
    ['ac-mom-apercu', 'ac-anniv-apercu', 'ac-ico-apercu'].forEach(function (i) {
      const e = document.getElementById(i); if (e) e.innerHTML = '';
    });
    ['ac-mom-img', 'ac-anniv-img', 'ac-ico-img'].forEach(function (i) {
      const e = document.getElementById(i); if (e) e.value = '';
    });
  };
  window.acPublierMoment = async function () {
    const u = acUser(); if (!u) return;
    const titre = (document.getElementById('ac-mom-titre').value || '').trim();
    const texte = (document.getElementById('ac-mom-texte').value || '').trim().slice(0, 200);
    const m = acMomEdit != null ? acMoments().find(x => x && x.id === acMomEdit) : null;
    if (acMomEdit != null && !m) { acFermerMoment(); return; }
    // Modification : on verifie l'auteur ICI aussi. Le bouton n'apparait que
    // pour lui, mais un bouton n'est pas un verrou.
    if (m && m.auteur !== u.id) { alert('Seul l’auteur peut modifier sa publication.'); return; }
    const gardeImage = m && !acImgEfface && !acImg && (m.imgId || m.image);
    if (!titre && !texte && !acImg && !gardeImage) { alert('Ajoutez au moins un mot ou une image.'); return; }

    // L'image part AVANT l'enregistrement : si le depot echoue, rien n'est
    // ecrit, plutot qu'une publication renvoyant a une image absente.
    let imgId = null;
    if (acImg) { imgId = await acDeposerImage(); if (!imgId) return; }
    const now = Date.now();

    if (m) {
      m.titre = titre.slice(0, 60);
      m.texte = texte;
      if (imgId) { m.imgId = imgId; m.image = null; }
      else if (acImgEfface) { m.imgId = null; m.image = null; }
      m.majAt = now; m.updatedAt = now;
      if (typeof logAction === 'function') logAction('Publication modifiée', '');
    } else {
      acMoments().unshift({
        id: now, ts: now, auteur: u.id, auteurNom: acPrenom(u.id),
        titre: titre.slice(0, 60), texte: texte, imgId: imgId,
        likes: [], expiresAt: now + AC_MOMENT_JOURS * 86400000, updatedAt: now
      });
      if (typeof logAction === 'function') logAction('Publication « Quoi de neuf »', '');
    }
    acImg = null; acImgEfface = false; acMomEdit = null;
    acFermerMoment(); acSave(true); acRendMoments();
  };

  // Image attachee a un anniversaire. Elle est stockee comme une publication de
  // type `anniv` reperee par sa cle : l'anniversaire lui-meme reste calcule.
  let acCleCourante = null;
  window.acFormAnniv = function (cle) {
    const u = acUser(); if (!u) { alert('Identifiez-vous avec votre code PIN.'); return; }
    acCleCourante = cle; acImg = null;
    const a = acImageAnniv(cle);
    const dej = a ? acUrlImage(a) : null;
    document.getElementById('ac-anniv-apercu').innerHTML = dej
      ? '<img src="' + dej + '" style="max-width:100%;max-height:150px;border-radius:10px;display:block">'
        + '<div style="font-size:.74rem;color:var(--gray-500);margin-top:4px">Image actuelle · '
        + '<span style="cursor:pointer;text-decoration:underline" onclick="acEffacerAnniv()">l’enlever</span></div>'
      : '';
    const f = document.getElementById('ac-anniv-img'); if (f) f.value = '';
    document.getElementById('ac-ov-anniv').classList.add('open');
  };
  window.acFermerAnniv = function () { document.getElementById('ac-ov-anniv').classList.remove('open'); };
  window.acEffacerAnniv = function () {
    const a = acImageAnniv(acCleCourante); if (!a) return;
    const l = acMoments(), i = l.findIndex(x => x.id === a.id); if (i < 0) return;
    if (typeof markDeleted === 'function') markDeleted('moments', a.id);
    l.splice(i, 1);
    acSave(true); acFermerAnniv(); acRendMoments();
  };
  window.acPoserAnniv = async function () {
    const u = acUser(); if (!u || !acCleCourante) return;
    if (!acImg) { alert('Choisissez une image ou un GIF.'); return; }
    const imgId = await acDeposerImage(); if (!imgId) return;
    const now = Date.now();
    const a = acImageAnniv(acCleCourante);
    if (a) { a.imgId = imgId; a.image = null; a.updatedAt = now; }
    else {
      acMoments().unshift({
        id: now, ts: now, type: 'anniv', cle: acCleCourante,
        auteur: u.id, auteurNom: acPrenom(u.id), imgId: imgId,
        likes: [], updatedAt: now
      });
    }
    acImg = null;
    acFermerAnniv(); acSave(true); acRendMoments();
  };

  const AC_MODALE_ANNIV = '<div class="overlay" id="ac-ov-anniv">'
    + '<div class="mbox" style="max-width:460px">'
    + '<div class="mbox-h"><b>Image d’anniversaire</b><button class="x" onclick="acFermerAnniv()">✕</button></div>'
    + '<div class="mbox-b"><div class="fg"><label>Une photo ou un GIF</label>'
    + '<input type="file" id="ac-anniv-img" accept="image/*" data-cible="ac-anniv-apercu" onchange="acPhoto(this)">'
    + '<div style="font-size:.74rem;color:var(--gray-500);margin-top:4px">'
    + 'Les GIF animés sont acceptés jusqu’à ' + Math.round(AC_GIF_MAX_KO / 1024) + ' Mo. L’image reste tant que le mois dure.</div>'
    + '<div id="ac-anniv-apercu" style="margin-top:8px"></div></div></div>'
    + '<div class="mbox-f"><button class="btn bs" onclick="acFermerAnniv()">Annuler</button>'
    + '<button class="btn bp" onclick="acPoserAnniv()">Enregistrer</button></div>'
    + '</div></div>';

  const AC_MODALE_ICO = '<div class="overlay" id="ac-ov-ico">'
    + '<div class="mbox" style="max-width:420px">'
    + '<div class="mbox-h"><b>Icône du raccourci</b><button class="x" onclick="acFermerIcone()">✕</button></div>'
    + '<div class="mbox-b">'
    + '<div style="font-size:.86rem;font-weight:700;margin-bottom:.7rem" id="ac-ico-nom"></div>'
    + '<div class="fg"><label>Déposer une image</label>'
    + '<input type="file" id="ac-ico-img" accept="image/*" data-cible="ac-ico-apercu" onchange="acPhoto(this)">'
    + '<div style="font-size:.74rem;color:var(--gray-500);margin-top:4px">'
    + 'Utile quand le site ne fournit pas d’icône, ou qu’elle est illisible en petit.</div>'
    + '<div id="ac-ico-apercu" style="margin-top:10px"></div></div>'
    + '</div>'
    + '<div class="mbox-f"><button class="btn bs" onclick="acFermerIcone()">Annuler</button>'
    + '<button class="btn bp" onclick="acPoserIcone()">Enregistrer</button></div>'
    + '</div></div>';

  const AC_MODALE = '<div class="overlay" id="ac-ov-mom">'
    + '<div class="mbox" style="max-width:520px">'
    + '<div class="mbox-h"><b id="ac-mom-h">Quoi de neuf ?</b><button class="x" onclick="acFermerMoment()">✕</button></div>'
    + '<div class="mbox-b">'
    + '<div class="fg"><label>Titre</label>'
    + '<input type="text" id="ac-mom-titre" maxlength="60" placeholder="Ex. Pot de départ de Mathilde"></div>'
    + '<div class="fg"><label>Un mot</label>'
    + '<textarea id="ac-mom-texte" rows="2" maxlength="200" placeholder="Une belle soirée !"></textarea></div>'
    + '<div class="fg"><label>Photo ou GIF (facultatif)</label>'
    + '<input type="file" id="ac-mom-img" accept="image/*" data-cible="ac-mom-apercu" onchange="acPhoto(this)">'
    + '<div style="font-size:.74rem;color:var(--gray-500);margin-top:4px">'
    + 'Pas de patient sur l’image. GIF animés acceptés jusqu’à ' + Math.round(AC_GIF_MAX_KO / 1024) + ' Mo. '
    + 'La publication disparaît au bout de ' + AC_MOMENT_JOURS + ' jours.</div>'
    + '<div id="ac-mom-apercu" style="margin-top:8px"></div></div>'
    + '</div>'
    + '<div class="mbox-f"><button class="btn bs" onclick="acFermerMoment()">Annuler</button>'
    + '<button class="btn bp" id="ac-mom-ok" onclick="acPublierMoment()">Partager</button></div>'
    + '</div></div>';

  // ── Ouverture depuis l'exterieur (fin de saisie du code PIN) ──────────────
  window.acOuvrir = function () {
    if (!document.getElementById('sec-accueil')) return;
    if (typeof showSec === 'function') showSec('accueil');
  };

  // ── Injection ─────────────────────────────────────────────────────────────
  function acInstaller() {
    if (document.getElementById('sec-accueil')) return;

    const st = document.createElement('style'); st.textContent = AC_CSS;
    document.head.appendChild(st);

    const premier = document.querySelector('.sidebar .sb-item');
    if (premier && !document.querySelector('.sb-item[data-sec="accueil"]')) {
      const b = document.createElement('button');
      b.className = 'sb-item'; b.setAttribute('data-sec', 'accueil');
      b.setAttribute('onclick', "showSec('accueil',this); if(window.acRender) acRender();");
      b.innerHTML = '<svg class="ico sb-ico"><use href="#ic-patients"></use></svg>'
        + '<span class="sb-label">Accueil</span>';
      premier.parentNode.insertBefore(b, premier);
    }

    const ref = document.querySelector('.sec');
    if (ref) {
      const sec = document.createElement('section');
      sec.id = 'sec-accueil'; sec.className = 'sec'; sec.innerHTML = AC_SECTION;
      ref.parentNode.insertBefore(sec, ref);
    }

    [AC_MODALE, AC_MODALE_ANNIV, AC_MODALE_ICO].forEach(function (h) {
      const m = document.createElement('div'); m.innerHTML = h;
      if (m.firstElementChild) document.body.appendChild(m.firstElementChild);
    });

    if (typeof SEC_LABEL === 'object' && SEC_LABEL) SEC_LABEL.accueil = 'Accueil';
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', acInstaller);
  else acInstaller();
})();
