/* ════════════════════════════════════════════════════════════════════════════
   Module SUIVI ADMINISTRATIF — ce qu'on doit faire, et ce que ça donne.

   Deux sous-modules, parce que ce sont deux gestes différents :

     • TO-DO LIST — ce qui est à faire ce mois-ci. Tout le monde y coche.
     • INDICATEURS — ce que le mois a donné, en chiffres. Administrateurs seuls.

   LA LISTE SE RENOUVELLE TOUTE SEULE. Le 1er du mois, le mois écoulé devient
   une archive et PILOT regénère les tâches récurrentes. Ce qui n'était pas fait
   repart dans le mois suivant, marqué « en retard depuis septembre » : une
   relance d'impayés oubliée continue de se voir, au lieu de disparaître avec la
   page qu'on tourne.

   UNE LIGNE PAR TÂCHE ET PAR MOIS, jamais un objet qui les contiendrait toutes.
   Le serveur fusionne enregistrement par enregistrement : si les vingt tâches
   du mois vivaient dans une seule ligne, deux personnes qui cochent deux tâches
   différentes dans la même fenêtre de huit secondes en perdraient une, sans
   message et sans trace. C'est la règle « une collection à part » du dépôt.

   LES IDENTIFIANTS SONT CALCULÉS, PAS TIRÉS AU SORT. Deux postes qui ouvrent
   le module le 1er à la même seconde génèrent tous les deux le mois — avec les
   mêmes identifiants, donc la fusion n'en garde qu'un exemplaire. Un identifiant
   aléatoire aurait donné deux listes superposées.

   LA SAISIE N'EST PAS DANS LA PARTIE REDESSINÉE (piège n°9).

   Préfixe `sa` / `sa-` : rien ici ne touche à l'existant.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const E = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
  const pad = n => String(n).padStart(2, '0');

  // Les collections se lisent par `_collRef` ou par leur nom nu, jamais par
  // `window` (piège n°8 du dépôt).
  const saModeles = () => (typeof window._collRef === 'function' ? window._collRef('saModeles') : null) || [];
  const saTaches = () => (typeof window._collRef === 'function' ? window._collRef('saTaches') : null) || [];
  const saIndics = () => (typeof window._collRef === 'function' ? window._collRef('saIndics') : null) || [];
  const saUser = () => (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null;
  const saStaff = () => (typeof staffDB !== 'undefined' && Array.isArray(staffDB)) ? staffDB : [];
  const saSave = () => { try { if (typeof saveNow === 'function') saveNow(); } catch (e) {} };
  const saAdmin = () => { try { return typeof isAdmin === 'function' ? !!isAdmin() : false; } catch (e) { return false; } };

  const SA_ETATS = ['a_faire', 'en_cours', 'fait'];
  const SA_MOIS_LBL = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
                       'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const SA_MOIS_COURT = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin',
                         'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc'];
  // Les rubriques du tableau papier, dans son ordre. Une tâche sans rubrique
  // se range en tête : c'est là que vivent les deux lignes d'en-tête.
  const SA_GROUPES = ['', 'Grossistes', 'Clients en compte', 'Trades et mises en avant',
                      'Relation Cabinet comptable'];

  let saVue = 'todo';         // 'todo' | 'indic'
  let saMois = null;          // le mois affiché, 'AAAA-MM'
  let saAnnee = null;         // l'année affichée par la grille
  let saVueAnnee = false;     // la to-do list montre-t-elle la grille annuelle
  let saModeleOuvert = false; // le panneau « tâches récurrentes » est-il déplié
  let saSousDe = null;        // id de la tâche sous laquelle on ajoute une sous-action

  // ── Le calendrier, sans toISOString ───────────────────────────────────────
  // `toISOString()` sur une Date à minuit locale rend la veille (piège n°3).
  function saMoisDe(d) {
    const x = (d instanceof Date) ? d : new Date();
    return x.getFullYear() + '-' + pad(x.getMonth() + 1);
  }
  function saMoisValide(m) {
    return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(m || ''));
  }
  function saMoisDecale(m, n) {
    if (!saMoisValide(m)) return null;
    const a = +m.slice(0, 4), mo = +m.slice(5, 7);
    const t = (a * 12 + (mo - 1)) + Number(n || 0);
    return Math.floor(t / 12) + '-' + pad((t % 12) + 1);
  }
  function saMoisLbl(m) {
    if (!saMoisValide(m)) return '';
    return SA_MOIS_LBL[+m.slice(5, 7) - 1] + ' ' + m.slice(0, 4);
  }

  // ── La périodicité, dite par les mois eux-mêmes ───────────────────────────
  // UN SEUL CONCEPT : la liste des mois où la tâche est due. « Mensuelle » est
  // une liste de douze, « annuelle » une liste d'un. Une périodicité stockée à
  // côté de la liste aurait fini par la contredire.
  function saMoisDuModele(mod) {
    const l = (mod && Array.isArray(mod.mois)) ? mod.mois : null;
    if (!l || !l.length) return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    return l.map(Number).filter(n => n >= 1 && n <= 12).sort((a, b) => a - b);
  }
  function saDuMois(mod, mois) {
    if (!mod || mod.actif === false || !saMoisValide(mois)) return false;
    return saMoisDuModele(mod).indexOf(+mois.slice(5, 7)) >= 0;
  }
  function saPeriodeLbl(mod) {
    const l = saMoisDuModele(mod);
    if (l.length === 12) return 'Tous les mois';
    if (l.length === 1) return 'Une fois par an — ' + SA_MOIS_LBL[l[0] - 1];
    if (l.length === 4) return 'Trimestriel — ' + l.map(n => SA_MOIS_COURT[n - 1]).join(', ');
    return l.map(n => SA_MOIS_COURT[n - 1]).join(', ');
  }

  // ── L'état d'une tâche ────────────────────────────────────────────────────
  // LECTURE AU LIEU DE MIGRATION (piège n°7) : ce qui n'est pas un état connu
  // est une tâche à faire. On ne réécrit rien en base.
  function saEtat(t) {
    return (t && SA_ETATS.indexOf(t.etat) >= 0) ? t.etat : 'a_faire';
  }
  function saEtatSuivant(e) {
    const i = SA_ETATS.indexOf(e);
    return SA_ETATS[(i < 0 ? 0 : (i + 1) % SA_ETATS.length)];
  }

  // ── Les identifiants calculés ─────────────────────────────────────────────
  // Deux postes qui génèrent le même mois au même instant doivent produire les
  // MÊMES identifiants : la fusion par id n'en garde alors qu'un exemplaire.
  function saIdModele(mois, modeleId) {
    return 'sa:' + mois + ':m:' + String(modeleId);
  }
  function saIdReport(mois, origineId) {
    return 'sa:' + mois + ':r:' + String(origineId);
  }

  // L'origine d'une tâche : la toute première de la chaîne de reports. Sans
  // elle, un report de report porterait un identifiant qui s'allonge à chaque
  // mois et finirait par ne plus rien désigner.
  function saOrigine(t) {
    if (!t) return null;
    return t.origine || t.id || null;
  }

  // ── La génération d'un mois ───────────────────────────────────────────────
  // Rendue PURE pour être éprouvée : elle ne lit rien, n'écrit rien, elle rend
  // la liste des tâches à créer. Le reste du module s'occupe de les poser.
  function saAGenerer(modeles, taches, mois, maintenant) {
    if (!saMoisValide(mois)) return [];
    const t = Array.isArray(taches) ? taches : [];
    // LE MOIS DÉJÀ COMMENCÉ NE SE REGÉNÈRE PAS. S'il porte une seule tâche,
    // c'est qu'il a été généré — regénérer ressusciterait ce qu'on a supprimé.
    if (t.some(x => x && x.mois === mois)) return [];
    const now = Number(maintenant) || Date.now();
    const prec = saMoisDecale(mois, -1);
    const neuves = [];

    (Array.isArray(modeles) ? modeles : []).forEach(function (mod, i) {
      if (!saDuMois(mod, mois)) return;
      // En retard depuis quand ? On remonte la chaîne des mois précédents tant
      // que l'instance du modèle existe et n'est pas faite.
      let retard = null, m = prec, garde = 0;
      while (m && garde++ < 24) {
        const anc = t.find(x => x && x.mois === m && x.modeleId === mod.id);
        if (!anc || saEtat(anc) === 'fait') break;
        retard = m; m = saMoisDecale(m, -1);
      }
      neuves.push({
        id: saIdModele(mois, mod.id), mois: mois, modeleId: mod.id, parent: null,
        titre: String(mod.titre || ''), groupe: String(mod.groupe || ''),
        ordre: Number(mod.ordre) || (i + 1) * 10,
        etat: 'a_faire', par: '', le: null, reportDe: retard,
        origine: null, cree: now, creePar: '', updatedAt: now
      });
    });

    // Les tâches ponctuelles non faites suivent, elles aussi. Une tâche créée à
    // la main pour un cas précis ne disparaît pas parce qu'on a changé de page.
    t.forEach(function (x) {
      if (!x || x.mois !== prec || x.modeleId || x.parent) return;
      if (saEtat(x) === 'fait') return;
      const org = saOrigine(x);
      neuves.push({
        id: saIdReport(mois, org), mois: mois, modeleId: null, parent: null,
        titre: String(x.titre || ''), groupe: String(x.groupe || ''),
        ordre: Number(x.ordre) || 900,
        etat: 'a_faire', par: '', le: null,
        reportDe: x.reportDe || prec, origine: org,
        cree: now, creePar: x.creePar || '', updatedAt: now
      });
    });

    return neuves;
  }

  // ── Le tri et les groupes ─────────────────────────────────────────────────
  function saTrier(l) {
    return (Array.isArray(l) ? l.slice() : []).sort(function (a, b) {
      const oa = Number(a && a.ordre) || 0, ob = Number(b && b.ordre) || 0;
      if (oa !== ob) return oa - ob;
      return String((a && a.titre) || '').localeCompare(String((b && b.titre) || ''), 'fr');
    });
  }
  function saDuMoisListe(taches, mois) {
    return saTrier((Array.isArray(taches) ? taches : [])
      .filter(t => t && t.mois === mois && !t.parent));
  }
  function saSousActions(taches, parentId) {
    return saTrier((Array.isArray(taches) ? taches : [])
      .filter(t => t && t.parent === parentId));
  }
  function saGroupes(liste) {
    const vus = [];
    (Array.isArray(liste) ? liste : []).forEach(function (t) {
      const g = String((t && t.groupe) || '');
      if (vus.indexOf(g) < 0) vus.push(g);
    });
    // L'ordre du tableau papier d'abord, les rubriques inventées ensuite.
    return vus.sort(function (a, b) {
      const ia = SA_GROUPES.indexOf(a), ib = SA_GROUPES.indexOf(b);
      if (ia >= 0 && ib >= 0) return ia - ib;
      if (ia >= 0) return -1;
      if (ib >= 0) return 1;
      return a.localeCompare(b, 'fr');
    });
  }

  // ── L'avancement d'un mois ────────────────────────────────────────────────
  function saAvancement(liste) {
    const l = Array.isArray(liste) ? liste : [];
    const fait = l.filter(t => saEtat(t) === 'fait').length;
    const cours = l.filter(t => saEtat(t) === 'en_cours').length;
    const retard = l.filter(t => t && t.reportDe && saEtat(t) !== 'fait').length;
    return { total: l.length, fait: fait, cours: cours, retard: retard,
             pct: l.length ? Math.round(fait * 100 / l.length) : 0 };
  }

  // ── Les chiffres ──────────────────────────────────────────────────────────
  // CE QUI SE CALCULE NE SE SAISIT PAS. L'encours total est la somme de ses
  // deux lignes, et chaque pourcentage est un rapport : les demander à la
  // saisie, c'est accepter qu'ils finissent par ne plus correspondre.
  const SA_INDICS = [
    { k: 'encoursSecu',     lbl: 'En cours sécu à 30 jours',             grp: 'encours' },
    { k: 'encoursMut',      lbl: 'En cours mutuelles à 30 jours',        grp: 'encours' },
    { k: 'encoursTotal',    lbl: 'Encours total à 30 jours',             grp: 'encours', somme: ['encoursSecu', 'encoursMut'] },
    { k: 'rejets30',        lbl: 'Rejets Sécu/Mut (18 mois à 30 jours)', grp: 'rejets' },
    { k: 'rejetsMenacants', lbl: 'Rejets menaçants (12 à 18 mois)',      grp: 'rejets' },
    { k: 'rejetsMorts',     lbl: 'Rejets morts (+ de 18 mois)',          grp: 'rejets' },
    { k: 'vaTotal',         lbl: 'VA total',                             grp: 'va' },
    { k: 'va30',            lbl: 'VA > 30 jours',                        grp: 'va',    pct: 'vaTotal' },
    { k: 'vaMorts',         lbl: 'VA > 12 mois morts',                   grp: 'va',    pct: 'vaTotal' },
    { k: 'diffTotal',       lbl: 'Différés total',                       grp: 'diff' },
    { k: 'diff30',          lbl: 'Différés > 30 jours',                  grp: 'diff',  pct: 'diffTotal' },
    { k: 'diffMorts',       lbl: 'Différés > 12 mois morts',             grp: 'diff',  pct: 'diffTotal' },
    { k: 'attTotal',        lbl: 'Attentes totales',                     grp: 'att' },
    { k: 'att30',           lbl: 'Attentes > 30 jours',                  grp: 'att',   pct: 'attTotal' },
    { k: 'attMorts',        lbl: 'Attentes > 12 mois morts',             grp: 'att',   pct: 'attTotal' },
    { k: 'cec30',           lbl: 'Clients en compte à 30 jours',         grp: 'cec' },
    { k: 'stockTotal',      lbl: 'Stock total',                          grp: 'stock' },
    { k: 'stockTva21',      lbl: 'Stock TVA 2,1 %',                      grp: 'stock', pct: 'stockTotal' }
  ];

  // Une saisie française : « 40 987,22 », « 40987.22 », « 1 234 € ». L'espace
  // insécable des milliers vient du copier-coller d'un tableur, il compte.
  function saNombre(txt) {
    if (typeof txt === 'number') return isFinite(txt) ? txt : null;
    let s = String(txt == null ? '' : txt).replace(/[\s  €]/g, '').trim();
    if (!s) return null;
    s = s.replace(/,/g, '.');
    if (!/^-?\d*\.?\d+$/.test(s)) return null;
    const n = parseFloat(s);
    return isFinite(n) ? n : null;
  }
  function saEuro(n) {
    if (n == null || !isFinite(n)) return '';
    const neg = n < 0, x = Math.abs(Number(n));
    const ent = Math.floor(x).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    const dec = Math.round((x - Math.floor(x)) * 100);
    return (neg ? '-' : '') + ent + ',' + pad(dec) + ' €';
  }
  function saValeur(rel, cle) {
    const def = SA_INDICS.find(d => d.k === cle);
    if (!def) return null;
    const v = (rel && rel.v) ? rel.v : {};
    if (def.somme) {
      let t = null;
      def.somme.forEach(function (k) {
        const x = saNombre(v[k]);
        if (x != null) t = (t == null ? 0 : t) + x;
      });
      return t;
    }
    return saNombre(v[cle]);
  }
  function saPct(rel, cle) {
    const def = SA_INDICS.find(d => d.k === cle);
    if (!def || !def.pct) return null;
    const part = saValeur(rel, cle), tout = saValeur(rel, def.pct);
    if (part == null || tout == null || !tout) return null;
    return Math.round(part * 100 / tout);
  }
  function saReleve(liste, mois) {
    return (Array.isArray(liste) ? liste : []).find(r => r && r.mois === mois) || null;
  }

  // ── Les initiales ─────────────────────────────────────────────────────────
  function saInitiales(id) {
    const s = saStaff().find(x => x && x.id === id);
    if (!s) return String(id || '').slice(0, 3).toUpperCase();
    const p = String(s.prenom || '').trim(), n = String(s.nom || '').trim();
    if (p || n) return ((p[0] || '') + (n[0] || '')).toUpperCase() || String(s.id || '');
    return String(s.id || '');
  }
  function saCouleur(id) {
    const s = saStaff().find(x => x && x.id === id);
    return (s && s.col) ? s.col : '#8a8f98';
  }
  function saQuand(ts) {
    if (!ts) return '';
    const d = new Date(Number(ts));
    return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + ' ' + pad(d.getHours()) + 'h' + pad(d.getMinutes());
  }

  /* ══════════════════════════════════════════════════════════════════════════
     ÉCRITURES
     ══════════════════════════════════════════════════════════════════════════ */

  function saJournal(act, det) {
    try { if (typeof logAction === 'function') logAction(act, det); } catch (e) {}
  }

  // La clôture n'est pas un bouton : c'est une conséquence du calendrier. Elle
  // s'exécute à l'ouverture du module, et elle est sans effet si le mois est
  // déjà là. Deux postes peuvent la lancer en même temps sans dégât.
  function saCloturer() {
    const mois = saMoisDe(new Date());
    const l = saTaches();
    const neuves = saAGenerer(saModeles(), l, mois, Date.now());
    if (!neuves.length) return 0;
    neuves.forEach(t => l.push(t));
    saSave();
    saJournal('Suivi admin — nouveau mois', saMoisLbl(mois) + ' : ' + neuves.length + ' tâche(s)');
    return neuves.length;
  }

  function saModifiable(mois) {
    // Le mois en cours appartient à tout le monde. Un mois archivé ne se
    // retouche que par un administrateur : la trace de ce qui a été fait, et
    // quand, vaut mieux qu'une correction discrète six semaines plus tard.
    return mois === saMoisDe(new Date()) || saAdmin();
  }

  window.saBasculer = function (id) {
    const l = saTaches();
    const t = l.find(x => x && x.id === id);
    if (!t) return;
    if (!saModifiable(t.mois)) { alert('Ce mois est archivé. Seul un administrateur peut encore y toucher.'); return; }
    const u = saUser();
    t.etat = saEtatSuivant(saEtat(t));
    if (t.etat === 'a_faire') { t.par = ''; t.le = null; }
    else { t.par = u ? u.id : ''; t.le = Date.now(); }
    t.updatedAt = Date.now();
    saSave(); saRender();
  };

  window.saAjouter = function () {
    const champ = document.getElementById('sa-t-titre');
    const grp = document.getElementById('sa-t-groupe');
    const titre = String((champ && champ.value) || '').trim();
    if (!titre) { if (champ) champ.focus(); return; }
    if (!saModifiable(saMois)) { alert('Ce mois est archivé.'); return; }
    const u = saUser(), now = Date.now();
    saTaches().push({
      id: 'sa' + now.toString(36) + Math.random().toString(36).slice(2, 7),
      mois: saMois, modeleId: null, parent: null,
      titre: titre, groupe: String((grp && grp.value) || ''),
      ordre: 900, etat: 'a_faire', par: '', le: null, reportDe: null, origine: null,
      cree: now, creePar: u ? u.id : '', updatedAt: now
    });
    if (champ) { champ.value = ''; champ.focus(); }
    saSave(); saRender();
    saJournal('Suivi admin — action ajoutée', titre);
  };

  window.saSousOuvrir = function (id) { saSousDe = id; saRender(true); };
  window.saSousFermer = function () { saSousDe = null; saRender(true); };

  window.saSousAjouter = function () {
    const champ = document.getElementById('sa-s-titre');
    const titre = String((champ && champ.value) || '').trim();
    const l = saTaches();
    const parent = l.find(x => x && x.id === saSousDe);
    if (!titre || !parent) { if (champ) champ.focus(); return; }
    const u = saUser(), now = Date.now();
    l.push({
      id: 'sa' + now.toString(36) + Math.random().toString(36).slice(2, 7),
      mois: parent.mois, modeleId: null, parent: parent.id,
      titre: titre, groupe: parent.groupe || '',
      ordre: (Number(parent.ordre) || 0) + saSousActions(l, parent.id).length + 1,
      etat: 'a_faire', par: '', le: null, reportDe: null, origine: null,
      cree: now, creePar: u ? u.id : '', updatedAt: now
    });
    if (champ) { champ.value = ''; champ.focus(); }
    saSave(); saRender(true);
  };

  window.saSupprimer = function (id) {
    const l = saTaches();
    const i = l.findIndex(x => x && x.id === id);
    if (i < 0) return;
    const t = l[i];
    if (!saModifiable(t.mois)) { alert('Ce mois est archivé.'); return; }
    if (!confirm('Supprimer « ' + (t.titre || '') + ' » ?\n\nSes sous-actions partent avec elle.')) return;
    // LA PIERRE TOMBALE AVANT LE RETRAIT : sans elle, la ligne revient à la
    // prochaine resynchronisation, posée par un autre poste.
    saSousActions(l, t.id).forEach(function (s) {
      const j = l.findIndex(x => x && x.id === s.id);
      if (j >= 0) { if (typeof markDeleted === 'function') markDeleted('saTaches', l[j].id); l.splice(j, 1); }
    });
    const k = l.findIndex(x => x && x.id === id);
    if (k >= 0) { if (typeof markDeleted === 'function') markDeleted('saTaches', l[k].id); l.splice(k, 1); }
    saSave(); saRender(true);
  };

  /* ── Le modèle des tâches récurrentes ───────────────────────────────────── */

  // Les vingt lignes du tableau papier, proposées UNE FOIS, à la demande. Rien
  // ne se sème tout seul : une tâche supprimée exprès ne doit pas réapparaître
  // au prochain déploiement.
  const SA_DEPART = [
    ['', 'Réalisation du tableau de bord mensuel', null],
    ['', 'Impression des fiches de VA, Attentes, Différés', null],
    ['Grossistes', 'Contrôle et relance des avoirs grossistes', null],
    ['Grossistes', 'Classement récaps CERP dans le Classeur Grossiste', null],
    ['Grossistes', 'Tableau des remises CERP', null],
    ['Clients en compte', 'Transmission des factures de fin de mois des CeC', null],
    ['Clients en compte', 'Transmission des factures EHPAD', null],
    ['Clients en compte', 'Pointage du paiement des CeC', null],
    ['Clients en compte', 'Contrôle des paiements SMS', null],
    ['Clients en compte', 'Relance des impayés', null],
    ['Trades et mises en avant', 'Mise en place des promos (WP)', null],
    ['Trades et mises en avant', 'Réalisation des affiches', null],
    ['Trades et mises en avant', 'Actualisation des écrans, promos et campagnes', null],
    ['Trades et mises en avant', 'Réalisation des photos du mois en cours', null],
    ['Trades et mises en avant', 'Envoi des demandes de compensation des trades passés', null],
    ['Trades et mises en avant', 'Suivi des paiements des opérations', null],
    ['Relation Cabinet comptable', 'Déclaration TVA sur DIGI', null],
    ['Relation Cabinet comptable', 'Envoi des relevés bancaires sur DIGI', null],
    ['Relation Cabinet comptable', 'Pointage des factures manquantes (tableau Brunilde + suivi LCR)', null],
    ['Relation Cabinet comptable', 'Organisation de la transmission mensuelle avec Olivier & Anouck', null]
  ];

  window.saInstallerDepart = function () {
    if (!saAdmin()) { alert('Action réservée aux administrateurs.'); return; }
    const l = saModeles();
    if (l.length) { alert('Le modèle contient déjà des tâches.'); return; }
    if (!confirm('Installer les ' + SA_DEPART.length + ' tâches du tableau papier ?\n\n'
      + 'Elles seront toutes mensuelles ; chacune se règle ensuite ligne par ligne.')) return;
    const now = Date.now();
    SA_DEPART.forEach(function (d, i) {
      l.push({
        id: 'sam' + now.toString(36) + i.toString(36),
        groupe: d[0], titre: d[1], mois: d[2], ordre: (i + 1) * 10,
        actif: true, cree: now, updatedAt: now + i
      });
    });
    saSave(); saRender(true);
    saJournal('Suivi admin — modèle installé', SA_DEPART.length + ' tâches récurrentes');
  };

  window.saModeleAjouter = function () {
    if (!saAdmin()) return;
    const champ = document.getElementById('sa-m-titre');
    const grp = document.getElementById('sa-m-groupe');
    const titre = String((champ && champ.value) || '').trim();
    if (!titre) { if (champ) champ.focus(); return; }
    const l = saModeles(), now = Date.now();
    l.push({
      id: 'sam' + now.toString(36) + Math.random().toString(36).slice(2, 7),
      groupe: String((grp && grp.value) || ''), titre: titre, mois: null,
      ordre: (l.length + 1) * 10, actif: true, cree: now, updatedAt: now
    });
    if (champ) { champ.value = ''; champ.focus(); }
    saSave(); saRender(true);
  };

  window.saModeleMois = function (id, n) {
    if (!saAdmin()) return;
    const mod = saModeles().find(x => x && x.id === id);
    if (!mod) return;
    const cur = saMoisDuModele(mod);
    const i = cur.indexOf(Number(n));
    if (i >= 0) cur.splice(i, 1); else cur.push(Number(n));
    // AUCUN MOIS COCHÉ N'A PAS DE SENS : la tâche ne reviendrait jamais. On
    // interprète la liste vide comme « tous les mois », et on le dit à l'écran.
    mod.mois = cur.length === 12 ? null : cur.slice().sort((a, b) => a - b);
    mod.updatedAt = Date.now();
    saSave(); saRender(true);
  };

  window.saModeleTous = function (id) {
    if (!saAdmin()) return;
    const mod = saModeles().find(x => x && x.id === id);
    if (!mod) return;
    mod.mois = null; mod.updatedAt = Date.now();
    saSave(); saRender(true);
  };

  window.saModeleActif = function (id) {
    if (!saAdmin()) return;
    const mod = saModeles().find(x => x && x.id === id);
    if (!mod) return;
    mod.actif = (mod.actif === false);
    mod.updatedAt = Date.now();
    saSave(); saRender(true);
  };

  window.saModeleSupprimer = function (id) {
    if (!saAdmin()) return;
    const l = saModeles();
    const i = l.findIndex(x => x && x.id === id);
    if (i < 0) return;
    if (!confirm('Retirer « ' + (l[i].titre || '') + ' » des tâches récurrentes ?\n\n'
      + 'Les mois déjà passés gardent leur trace ; elle ne reviendra plus les mois suivants.')) return;
    if (typeof markDeleted === 'function') markDeleted('saModeles', l[i].id);
    l.splice(i, 1);
    saSave(); saRender(true);
  };

  window.saModeleBasculer = function () { saModeleOuvert = !saModeleOuvert; saRender(true); };

  /* ── Les indicateurs ────────────────────────────────────────────────────── */

  window.saIndicSaisir = function (mois) {
    if (!saAdmin()) { alert('Les indicateurs sont réservés aux administrateurs.'); return; }
    const rel = saReleve(saIndics(), mois);
    const v = (rel && rel.v) ? rel.v : {};
    const host = document.getElementById('sa-ind-form');
    if (!host) return;
    host.innerHTML =
      '<div class="sa-if-t">Relevé de ' + E(saMoisLbl(mois)) + '</div>'
      + '<div class="sa-if-d"><label>Date du relevé'
      + '<input type="text" id="sa-i-releve" inputmode="numeric" maxlength="10" placeholder="JJ/MM/AAAA" '
      +   'value="' + E(saDateFr((rel && rel.releve) || '')) + '" oninput="saDateMasque(this)"></label></div>'
      + '<div class="sa-if-g">'
      + SA_INDICS.filter(d => !d.somme).map(function (d) {
          return '<label class="sa-if-l"><span>' + E(d.lbl) + '</span>'
            + '<input type="text" inputmode="decimal" id="sa-i-' + d.k + '" '
            + 'value="' + E(v[d.k] == null ? '' : String(v[d.k]).replace('.', ',')) + '" placeholder="—"></label>';
        }).join('')
      + '</div>'
      + '<div class="sa-if-b">'
      +   '<button class="btn bp" onclick="saIndicEnregistrer(\'' + E(mois) + '\')">Enregistrer le relevé</button>'
      +   '<button class="btn bs" onclick="saIndicFermer()">Annuler</button>'
      + '</div>';
    host.style.display = '';
    try { if (typeof formEnVue === 'function') formEnVue(host); } catch (e) {}
  };

  window.saIndicFermer = function () {
    const host = document.getElementById('sa-ind-form');
    if (host) { host.style.display = 'none'; host.innerHTML = ''; }
    saRender(true);
  };

  window.saIndicEnregistrer = function (mois) {
    if (!saAdmin()) return;
    const lu = k => String((document.getElementById('sa-i-' + k) || {}).value || '').trim();
    const v = {};
    let faute = null;
    SA_INDICS.filter(d => !d.somme).forEach(function (d) {
      const brut = lu(d.k);
      if (!brut) return;
      const n = saNombre(brut);
      if (n == null) { if (!faute) faute = d.lbl; return; }
      v[d.k] = n;
    });
    if (faute) { alert('« ' + faute + ' » ne se lit pas comme un nombre.\n\nÉcrivez par exemple 40 987,22.'); return; }
    const releve = saDateIso(lu('releve'));
    if (lu('releve') && !releve) { alert('Date du relevé : écrivez-la en JJ/MM/AAAA.'); return; }
    const l = saIndics();
    let rel = saReleve(l, mois);
    const u = saUser(), now = Date.now();
    if (!rel) { rel = { id: 'sai:' + mois, mois: mois, cree: now }; l.push(rel); }
    rel.v = v; rel.releve = releve || '';
    rel.par = u ? u.id : ''; rel.updatedAt = now;
    saSave();
    saJournal('Suivi admin — relevé enregistré', saMoisLbl(mois));
    window.saIndicFermer();
  };

  // Dates au format de la maison : JJ/MM/AAAA. Les helpers d'index.html ne sont
  // pas supposés présents ici — ce module doit pouvoir vivre seul.
  function saDateFr(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m ? (m[3] + '/' + m[2] + '/' + m[1]) : '';
  }
  function saDateIso(fr) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(fr || '').trim());
    if (!m) return null;
    const j = +m[1], mo = +m[2], a = +m[3];
    if (mo < 1 || mo > 12 || j < 1 || j > 31 || a < 2000 || a > 2100) return null;
    const d = new Date(a, mo - 1, j, 12, 0, 0);
    if (d.getFullYear() !== a || d.getMonth() !== mo - 1 || d.getDate() !== j) return null;
    return a + '-' + pad(mo) + '-' + pad(j);
  }
  window.saDateMasque = function (e) {
    if (!e) return;
    const n = String(e.value || '').replace(/\D/g, '').slice(0, 8);
    e.value = n.replace(/^(\d{2})(\d)/, '$1/$2').replace(/^(\d{2}\/\d{2})(\d)/, '$1/$2');
  };

  /* ── Navigation ─────────────────────────────────────────────────────────── */

  window.saAllerOnglet = function (n) {
    if (n === 'indic' && !saAdmin()) return;
    saVue = n; saVueAnnee = false; saRender(true);
  };
  window.saMoisAller = function (n) {
    saMois = saMoisDecale(saMois, n) || saMois;
    saAnnee = +saMois.slice(0, 4);
    saRender(true);
  };
  window.saAnneeAller = function (n) { saAnnee = (saAnnee || new Date().getFullYear()) + Number(n); saRender(true); };
  window.saVueBasculer = function () { saVueAnnee = !saVueAnnee; saRender(true); };

  /* ══════════════════════════════════════════════════════════════════════════
     RENDU
     ══════════════════════════════════════════════════════════════════════════ */

  function saPastille(t) {
    const e = saEtat(t);
    const titre = e === 'fait' ? 'Fait — cliquer pour revenir à « à faire »'
                : e === 'en_cours' ? 'En cours — cliquer pour marquer fait'
                : 'À faire — cliquer pour marquer en cours';
    return '<button class="sa-p sa-p-' + e + '" title="' + E(titre) + '" '
      + 'onclick="saBasculer(\'' + E(t.id) + '\')" aria-label="' + E(titre) + '"></button>';
  }

  function saQui(t) {
    if (!t || !t.par) return '';
    return '<span class="sa-qui" style="background:' + E(saCouleur(t.par)) + '" '
      + 'title="' + E(saInitiales(t.par) + (t.le ? ' — ' + saQuand(t.le) : '')) + '">'
      + E(saInitiales(t.par)) + '</span>';
  }

  function saLigne(t, sous) {
    const e = saEtat(t);
    const retard = (t.reportDe && e !== 'fait')
      ? '<span class="sa-retard" title="Reportée depuis ' + E(saMoisLbl(t.reportDe)) + '">en retard depuis '
        + E(SA_MOIS_LBL[+String(t.reportDe).slice(5, 7) - 1]) + '</span>' : '';
    return '<div class="sa-l sa-l-' + e + (sous ? ' sa-l-s' : '') + '">'
      + saPastille(t)
      + '<span class="sa-t">' + E(t.titre || '') + retard + '</span>'
      + saQui(t)
      + (sous ? '' : '<button class="sa-mini" title="Ajouter une sous-action" onclick="saSousOuvrir(\'' + E(t.id) + '\')">+</button>')
      + (t.modeleId ? '' : '<button class="sa-mini sa-x" title="Supprimer" onclick="saSupprimer(\'' + E(t.id) + '\')">×</button>')
      + '</div>';
  }

  function saVueMois() {
    const l = saDuMoisListe(saTaches(), saMois);
    const tous = saTaches();
    const av = saAvancement(l);
    if (!l.length) {
      return '<div class="sa-vide">'
        + (saModeles().length
            ? 'Aucune tâche pour ' + E(saMoisLbl(saMois)) + '.'
            : 'Le modèle des tâches récurrentes est vide — ouvrez « Tâches récurrentes » ci-dessous pour partir du tableau papier.')
        + '</div>';
    }
    let h = '<div class="sa-bar"><div class="sa-jauge"><i style="width:' + av.pct + '%"></i></div>'
      + '<span class="sa-cpt">' + av.fait + ' / ' + av.total + ' fait' + (av.fait > 1 ? 's' : '')
      + (av.retard ? ' · <b class="sa-r">' + av.retard + ' en retard</b>' : '') + '</span></div>';

    saGroupes(l).forEach(function (g) {
      const dans = l.filter(t => String(t.groupe || '') === g);
      if (!dans.length) return;
      if (g) h += '<div class="sa-g">' + E(g) + '</div>';
      dans.forEach(function (t) {
        h += saLigne(t, false);
        saSousActions(tous, t.id).forEach(function (s) { h += saLigne(s, true); });
        if (saSousDe === t.id) {
          h += '<div class="sa-l sa-l-s sa-saisie-s" id="sa-sous-saisie">'
            + '<input type="text" id="sa-s-titre" maxlength="120" placeholder="Sous-action…" '
            +   'onkeydown="if(event.key===\'Enter\'){event.preventDefault();saSousAjouter();}'
            +   'if(event.key===\'Escape\'){saSousFermer();}">'
            + '<button class="btn bp sm" onclick="saSousAjouter()">Ajouter</button>'
            + '<button class="btn bs sm" onclick="saSousFermer()">Fermer</button>'
            + '</div>';
        }
      });
    });
    return h;
  }

  function saVueGrille() {
    const an = saAnnee || new Date().getFullYear();
    const tous = saTaches();
    const mods = saTrier(saModeles());
    // Les lignes de la grille : les modèles, plus les titres ponctuels vus
    // dans l'année. Une tâche créée à la main en mars doit s'y lire aussi.
    const lignes = mods.map(m => ({ cle: 'm:' + m.id, titre: m.titre, groupe: m.groupe || '', mod: m }));
    const vus = {};
    tous.forEach(function (t) {
      if (!t || t.parent || t.modeleId || String(t.mois || '').slice(0, 4) !== String(an)) return;
      const c = 'p:' + String(t.titre || '').toLowerCase();
      if (vus[c]) return;
      vus[c] = true;
      lignes.push({ cle: c, titre: t.titre, groupe: t.groupe || '', mod: null });
    });
    if (!lignes.length) return '<div class="sa-vide">Rien à montrer pour ' + an + '.</div>';

    let h = '<table class="sa-grid"><thead><tr><th class="sa-gh"></th>'
      + SA_MOIS_COURT.map(m => '<th>' + m + '</th>').join('') + '</tr></thead><tbody>';
    saGroupes(lignes).forEach(function (g) {
      const dans = lignes.filter(x => String(x.groupe || '') === g);
      if (!dans.length) return;
      if (g) h += '<tr class="sa-grp"><td colspan="13">' + E(g) + '</td></tr>';
      dans.forEach(function (ln) {
        h += '<tr><td class="sa-gh">' + E(ln.titre || '') + '</td>';
        for (let i = 1; i <= 12; i++) {
          const mois = an + '-' + pad(i);
          const t = ln.mod
            ? tous.find(x => x && x.mois === mois && x.modeleId === ln.mod.id)
            : tous.find(x => x && x.mois === mois && !x.parent && !x.modeleId
                             && String(x.titre || '').toLowerCase() === ln.cle.slice(2));
          const due = ln.mod ? saDuMois(ln.mod, mois) : !!t;
          const e = t ? saEtat(t) : null;
          h += '<td class="sa-c' + (due ? '' : ' sa-c-na') + '" title="' + E((ln.titre || '') + ' — ' + saMoisLbl(mois)) + '">'
            + (e === 'fait' ? '<span class="sa-ok" title="' + E(t.par ? saInitiales(t.par) + ' — ' + saQuand(t.le) : '') + '">×</span>'
             : e === 'en_cours' ? '<span class="sa-mi">◐</span>'
             : (due && t) ? '<span class="sa-no">·</span>' : '')
            + '</td>';
        }
        h += '</tr>';
      });
    });
    return h + '</tbody></table>';
  }

  function saVueModele() {
    if (!saAdmin()) return '';
    const l = saTrier(saModeles());
    let h = '<div class="sa-mod">'
      + '<button class="sa-mod-t" onclick="saModeleBasculer()">'
      +   (saModeleOuvert ? '▾' : '▸') + ' Tâches récurrentes'
      +   '<span class="sa-mod-n">' + l.length + '</span></button>';
    if (!saModeleOuvert) return h + '</div>';

    h += '<div class="sa-mod-c">';
    if (!l.length) {
      h += '<div class="sa-vide">Aucune tâche récurrente. '
        + '<button class="btn bp sm" onclick="saInstallerDepart()">Partir du tableau papier (' + SA_DEPART.length + ' tâches)</button>'
        + '</div>';
    } else {
      l.forEach(function (m) {
        const mois = saMoisDuModele(m);
        h += '<div class="sa-mr' + (m.actif === false ? ' sa-mr-off' : '') + '">'
          + '<div class="sa-mr-h"><b>' + E(m.titre || '') + '</b>'
          + (m.groupe ? '<span class="sa-mr-g">' + E(m.groupe) + '</span>' : '')
          + '<span class="sa-mr-p">' + E(saPeriodeLbl(m)) + '</span>'
          + '<button class="sa-mini" title="' + (m.actif === false ? 'Réactiver' : 'Suspendre') + '" '
          +   'onclick="saModeleActif(\'' + E(m.id) + '\')">' + (m.actif === false ? '▷' : '❙❙') + '</button>'
          + '<button class="sa-mini sa-x" title="Retirer" onclick="saModeleSupprimer(\'' + E(m.id) + '\')">×</button>'
          + '</div><div class="sa-mr-m">';
        for (let i = 1; i <= 12; i++) {
          h += '<button class="sa-mm' + (mois.indexOf(i) >= 0 ? ' on' : '') + '" '
            + 'onclick="saModeleMois(\'' + E(m.id) + '\',' + i + ')">' + SA_MOIS_COURT[i - 1] + '</button>';
        }
        h += '<button class="sa-mm sa-mm-all" onclick="saModeleTous(\'' + E(m.id) + '\')">Tous</button>';
        h += '</div></div>';
      });
    }
    h += '<div class="sa-mr-add">'
      + '<input type="text" id="sa-m-titre" maxlength="120" placeholder="Nouvelle tâche récurrente…" '
      +   'onkeydown="if(event.key===\'Enter\'){event.preventDefault();saModeleAjouter();}">'
      + '<select id="sa-m-groupe">' + SA_GROUPES.map(g =>
          '<option value="' + E(g) + '">' + E(g || 'Sans rubrique') + '</option>').join('') + '</select>'
      + '<button class="btn bp sm" onclick="saModeleAjouter()">Ajouter</button>'
      + '</div></div></div>';
    return h;
  }

  function saVueIndic() {
    if (!saAdmin()) return '<div class="sa-vide">Les indicateurs sont réservés aux administrateurs.</div>';
    const an = saAnnee || new Date().getFullYear();
    const l = saIndics();
    const relevés = [];
    for (let i = 1; i <= 12; i++) relevés.push(saReleve(l, an + '-' + pad(i)));

    let h = '<table class="sa-ind"><thead><tr><th class="sa-ih"></th>';
    for (let i = 1; i <= 12; i++) {
      const r = relevés[i - 1];
      h += '<th><div class="sa-im">' + SA_MOIS_COURT[i - 1] + '</div>'
        + '<div class="sa-id">' + E(r && r.releve ? saDateFr(r.releve) : '') + '</div>'
        + '<button class="sa-mini" title="Saisir le relevé de ' + E(SA_MOIS_LBL[i - 1]) + '" '
        +   'onclick="saIndicSaisir(\'' + an + '-' + pad(i) + '\')">' + (r ? '✎' : '+') + '</button></th>';
    }
    h += '</tr></thead><tbody>';
    let grp = null;
    SA_INDICS.forEach(function (d) {
      const nouveau = d.grp !== grp; grp = d.grp;
      h += '<tr class="sa-ir sa-ir-' + d.grp + (nouveau ? ' sa-ir-top' : '') + (d.somme ? ' sa-ir-calc' : '') + '">'
        + '<td class="sa-ih">' + E(d.lbl) + (d.somme ? ' <i>calculé</i>' : '') + '</td>';
      for (let i = 1; i <= 12; i++) {
        const r = relevés[i - 1];
        const v = saValeur(r, d.k);
        const p = saPct(r, d.k);
        h += '<td class="sa-iv">' + (v == null ? '<span class="sa-iv-0">—</span>' : E(saEuro(v)))
          + (p == null ? '' : '<span class="sa-ip">' + p + '%</span>') + '</td>';
      }
      h += '</tr>';
    });
    return h + '</tbody></table>';
  }

  // LE RENDU NE TOUCHE QU'AU CORPS. Les champs de saisie du haut sont posés une
  // seule fois, à l'injection ; le formulaire de relevé vit dans son propre
  // hôte, que la resynchronisation ne traverse jamais.
  window.saRender = function (delibere) {
    const corps = document.getElementById('sa-corps');
    if (!corps) return;

    // Piège n°9 : la saisie en cours appartient à qui écrit. Un redessin
    // délibéré (changer d'onglet, de mois, ajouter une ligne) passe la garde.
    if (!delibere && document.getElementById('sa-sous-saisie')) return;
    if (!delibere && document.getElementById('sa-i-vaTotal')) return;

    if (!saMois) saMois = saMoisDe(new Date());
    if (!saAnnee) saAnnee = +saMois.slice(0, 4);
    if (saVue === 'indic' && !saAdmin()) saVue = 'todo';

    const ong = document.getElementById('sa-onglets');
    if (ong) {
      ong.innerHTML =
        '<button class="sa-o' + (saVue === 'todo' ? ' on' : '') + '" onclick="saAllerOnglet(\'todo\')">To-do list</button>'
        + (saAdmin() ? '<button class="sa-o' + (saVue === 'indic' ? ' on' : '') + '" onclick="saAllerOnglet(\'indic\')">Indicateurs</button>' : '');
    }

    const nav = document.getElementById('sa-nav');
    if (nav) {
      if (saVue === 'indic' || saVueAnnee) {
        nav.innerHTML = '<button class="sa-nb" onclick="saAnneeAller(-1)">‹</button>'
          + '<span class="sa-nt">' + (saAnnee || '') + '</span>'
          + '<button class="sa-nb" onclick="saAnneeAller(1)">›</button>'
          + (saVue === 'todo' ? '<button class="btn bs sm" onclick="saVueBasculer()">Revenir au mois</button>' : '');
      } else {
        const courant = saMois === saMoisDe(new Date());
        nav.innerHTML = '<button class="sa-nb" onclick="saMoisAller(-1)">‹</button>'
          + '<span class="sa-nt">' + E(saMoisLbl(saMois)) + '</span>'
          + '<button class="sa-nb" onclick="saMoisAller(1)">›</button>'
          + (courant ? '<span class="sa-arch sa-arch-on">mois en cours</span>'
                     : '<span class="sa-arch">archivé' + (saAdmin() ? ' — modifiable (admin)' : ' — lecture seule') + '</span>')
          + '<button class="btn bs sm" onclick="saVueBasculer()">Vue de l’année</button>';
      }
    }

    const sais = document.getElementById('sa-saisie');
    if (sais) sais.style.display = (saVue === 'todo' && !saVueAnnee && saModifiable(saMois)) ? '' : 'none';

    corps.innerHTML = saVue === 'indic' ? saVueIndic()
                    : (saVueAnnee ? saVueGrille() : saVueMois() + saVueModele());
  };

  /* ══════════════════════════════════════════════════════════════════════════
     INJECTION
     ══════════════════════════════════════════════════════════════════════════ */

  const SA_SECTION =
    '<div class="card">'
    + '<div class="sa-head"><h2 class="ttl">Suivi administratif</h2>'
    +   '<div id="sa-onglets" class="sa-ongs"></div></div>'
    + '<div id="sa-nav" class="sa-nav"></div>'
    + '<div id="sa-saisie" class="sa-saisie">'
    +   '<input type="text" id="sa-t-titre" maxlength="120" placeholder="Ajouter une action pour ce mois…" '
    +     'onkeydown="if(event.key===\'Enter\'){event.preventDefault();saAjouter();}">'
    +   '<select id="sa-t-groupe">' + SA_GROUPES.map(g =>
          '<option value="' + g.replace(/"/g, '&quot;') + '">' + (g || 'Sans rubrique') + '</option>').join('') + '</select>'
    +   '<button class="btn bp sm" onclick="saAjouter()">Ajouter</button>'
    + '</div>'
    + '<div id="sa-ind-form" class="sa-if" style="display:none"></div>'
    + '<div id="sa-corps"></div>'
    + '</div>';

  const SA_CSS = `
  .sa-head{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
  .sa-ongs{display:flex;gap:6px}
  .sa-o{background:#fff;border:1px solid var(--gray-300,#d7dade);color:var(--gray-600,#5b6169);
        border-radius:8px;padding:6px 14px;font-size:.86rem;font-weight:600;cursor:pointer}
  .sa-o.on{background:var(--g-mid,#2E7D54);border-color:var(--g-mid,#2E7D54);color:#fff}
  .sa-nav{display:flex;align-items:center;gap:8px;margin:14px 0 10px;flex-wrap:wrap}
  .sa-nb{background:#fff;border:1px solid var(--gray-300,#d7dade);border-radius:8px;width:30px;height:30px;
         font-size:1.1rem;line-height:1;cursor:pointer;color:var(--gray-600,#5b6169)}
  .sa-nb:hover{border-color:var(--g-mid,#2E7D54);color:var(--g-dark,#1D5C3A)}
  .sa-nt{font-weight:700;font-size:1.02rem;min-width:9.5rem;text-transform:capitalize}
  .sa-arch{font-size:.74rem;color:var(--gray-500,#7a8089);background:var(--gray-100,#f2f4f6);
           padding:3px 10px;border-radius:20px}
  .sa-arch-on{color:#1D5C3A;background:#E6F2EA}
  .sa-saisie{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap}
  .sa-saisie input{flex:1 1 280px;min-width:200px;padding:8px 11px;border:1px solid var(--gray-300,#d7dade);border-radius:8px;font-size:.9rem}
  .sa-saisie select{padding:8px 10px;border:1px solid var(--gray-300,#d7dade);border-radius:8px;font-size:.86rem}
  .sa-bar{display:flex;align-items:center;gap:12px;margin:4px 0 14px}
  .sa-jauge{flex:1;height:6px;background:var(--gray-200,#e7eaee);border-radius:4px;overflow:hidden}
  .sa-jauge i{display:block;height:100%;background:var(--g-mid,#2E7D54);border-radius:4px;transition:width .3s}
  .sa-cpt{font-size:.78rem;color:var(--gray-500,#7a8089);white-space:nowrap}
  .sa-r{color:#B3261E}
  .sa-g{font-size:.72rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase;
        color:var(--gray-500,#7a8089);margin:16px 0 6px;padding-bottom:4px;border-bottom:1px solid var(--gray-200,#e7eaee)}
  .sa-l{display:flex;align-items:center;gap:10px;padding:7px 2px;border-bottom:1px solid var(--gray-100,#f2f4f6)}
  .sa-l-s{padding-left:30px}
  .sa-l-s .sa-t{font-size:.85rem;color:var(--gray-600,#5b6169)}
  .sa-l-fait .sa-t{color:var(--gray-400,#9aa0a8);text-decoration:line-through}
  .sa-t{flex:1;font-size:.92rem}
  .sa-p{width:17px;height:17px;border-radius:50%;border:2px solid var(--gray-300,#c9ced4);
        background:#fff;cursor:pointer;flex:0 0 auto;padding:0}
  .sa-p:hover{border-color:var(--g-mid,#2E7D54)}
  .sa-p-en_cours{border-color:#C79A00;background:linear-gradient(90deg,#F5C518 50%,#fff 50%)}
  .sa-p-fait{border-color:var(--g-mid,#2E7D54);background:var(--g-mid,#2E7D54)}
  .sa-retard{margin-left:9px;font-size:.7rem;font-weight:700;color:#B3261E;background:#FDECEA;
             padding:2px 8px;border-radius:20px;white-space:nowrap}
  .sa-qui{display:inline-flex;align-items:center;justify-content:center;min-width:26px;height:22px;
          padding:0 6px;border-radius:20px;color:#fff;font-size:.68rem;font-weight:800;letter-spacing:.03em}
  .sa-mini{background:transparent;border:1px solid transparent;border-radius:6px;width:24px;height:24px;
           color:var(--gray-400,#9aa0a8);cursor:pointer;font-size:.95rem;line-height:1;padding:0}
  .sa-mini:hover{border-color:var(--gray-300,#d7dade);color:var(--gray-700,#3f454c);background:#fff}
  .sa-x:hover{color:#B3261E;border-color:#f3c9c5}
  .sa-saisie-s{gap:6px}
  .sa-saisie-s input{flex:1;padding:5px 9px;border:1px solid var(--g-mid,#2E7D54);border-radius:7px;font-size:.85rem}
  .sa-vide{padding:22px 4px;color:var(--gray-500,#7a8089);font-size:.9rem}
  .sa-mod{margin-top:22px;border-top:1px solid var(--gray-200,#e7eaee);padding-top:12px}
  .sa-mod-t{background:transparent;border:none;font-size:.8rem;font-weight:700;color:var(--gray-600,#5b6169);
            cursor:pointer;padding:4px 0;display:flex;align-items:center;gap:8px}
  .sa-mod-n{background:var(--gray-100,#f2f4f6);border-radius:20px;padding:1px 9px;font-size:.72rem}
  .sa-mod-c{margin-top:10px}
  .sa-mr{border:1px solid var(--gray-200,#e7eaee);border-radius:9px;padding:9px 11px;margin-bottom:7px;background:#fff}
  .sa-mr-off{opacity:.5}
  .sa-mr-h{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
  .sa-mr-h b{font-size:.88rem;flex:1}
  .sa-mr-g{font-size:.7rem;color:var(--gray-500,#7a8089);background:var(--gray-100,#f2f4f6);padding:2px 8px;border-radius:20px}
  .sa-mr-p{font-size:.7rem;color:var(--g-dark,#1D5C3A);background:#E6F2EA;padding:2px 8px;border-radius:20px}
  .sa-mr-m{display:flex;gap:3px;margin-top:7px;flex-wrap:wrap}
  .sa-mm{border:1px solid var(--gray-300,#d7dade);background:#fff;color:var(--gray-500,#7a8089);
         border-radius:6px;padding:2px 7px;font-size:.7rem;cursor:pointer}
  .sa-mm.on{background:var(--g-mid,#2E7D54);border-color:var(--g-mid,#2E7D54);color:#fff}
  .sa-mm-all{font-weight:700;color:var(--g-dark,#1D5C3A)}
  .sa-mr-add{display:flex;gap:7px;margin-top:10px;flex-wrap:wrap}
  .sa-mr-add input{flex:1 1 240px;padding:7px 10px;border:1px solid var(--gray-300,#d7dade);border-radius:8px;font-size:.86rem}
  .sa-mr-add select{padding:7px 9px;border:1px solid var(--gray-300,#d7dade);border-radius:8px;font-size:.82rem}
  .sa-grid,.sa-ind{width:100%;border-collapse:collapse;font-size:.78rem}
  .sa-grid th,.sa-ind th{font-weight:700;color:var(--gray-500,#7a8089);padding:5px 3px;text-align:center;
                         border-bottom:2px solid var(--gray-200,#e7eaee)}
  .sa-gh,.sa-ih{text-align:left!important;color:var(--gray-800,#2b3035)!important;font-weight:600;
                padding:5px 9px 5px 2px!important;white-space:nowrap;max-width:330px;overflow:hidden;text-overflow:ellipsis}
  .sa-grid td,.sa-ind td{border-bottom:1px solid var(--gray-100,#f2f4f6);padding:4px 3px;text-align:center}
  .sa-grp td{background:var(--gray-100,#f2f4f6);font-weight:800;font-size:.7rem;text-transform:uppercase;
             letter-spacing:.05em;text-align:left!important;padding:5px 8px!important;color:var(--gray-600,#5b6169)}
  .sa-c-na{background:repeating-linear-gradient(45deg,#fafbfc,#fafbfc 4px,#f2f4f6 4px,#f2f4f6 8px)}
  .sa-ok{color:var(--g-mid,#2E7D54);font-weight:900;font-size:1rem}
  .sa-mi{color:#C79A00;font-size:.9rem}
  .sa-no{color:var(--gray-300,#d7dade)}
  .sa-im{font-size:.78rem}
  .sa-id{font-size:.63rem;font-weight:500;color:var(--gray-400,#9aa0a8);min-height:.8rem}
  .sa-ir-top td{border-top:2px solid var(--gray-200,#e7eaee)}
  .sa-ir-calc{background:#fbfcfd;font-weight:700}
  .sa-ir-calc .sa-ih i{font-size:.66rem;font-weight:400;color:var(--gray-400,#9aa0a8);font-style:normal}
  .sa-iv{text-align:right!important;white-space:nowrap;font-variant-numeric:tabular-nums;padding-right:7px!important}
  .sa-iv-0{color:var(--gray-300,#d7dade)}
  .sa-ip{display:inline-block;margin-left:7px;font-size:.66rem;color:var(--gray-400,#9aa0a8);min-width:2.1rem}
  .sa-ir-encours{background:#FFFBF0}.sa-ir-rejets{background:#FDF3EC}.sa-ir-va{background:#EFF4FC}
  .sa-ir-diff{background:#F3F1FA}.sa-ir-att{background:#FAF0F4}.sa-ir-cec{background:#FAF1EE}
  .sa-ir-stock{background:#F0F7F1}
  .sa-if{border:1px solid var(--g-mid,#2E7D54);border-radius:11px;padding:15px;margin-bottom:14px;background:#fff}
  .sa-if-t{font-weight:800;font-size:.98rem;color:var(--g-dark,#1D5C3A);margin-bottom:11px;text-transform:capitalize}
  .sa-if-d{margin-bottom:12px}
  .sa-if-d label,.sa-if-l{display:flex;flex-direction:column;gap:3px;font-size:.76rem;color:var(--gray-600,#5b6169)}
  .sa-if-d input,.sa-if-l input{padding:7px 10px;border:1px solid var(--gray-300,#d7dade);border-radius:8px;
                                font-size:.88rem;max-width:220px}
  .sa-if-l input{text-align:right;font-variant-numeric:tabular-nums;max-width:none}
  .sa-if-g{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px}
  .sa-if-b{display:flex;gap:8px;margin-top:15px}
  @media(max-width:700px){.sa-grid,.sa-ind{font-size:.68rem}.sa-gh,.sa-ih{max-width:130px}}
  @media print{.sa-ongs,.sa-nav,.sa-saisie,.sa-mod,.sa-mini,.sa-p{display:none}}
  `;

  function saInject() {
    if (document.getElementById('sa-css')) return;
    const st = document.createElement('style');
    st.id = 'sa-css'; st.textContent = SA_CSS;
    document.head.appendChild(st);

    const ref = document.querySelector('.sb-item[data-sec="caisse"]')
             || document.querySelector('.sb-item[data-sec="livraisons"]');
    if (ref && !document.querySelector('.sb-item[data-sec="suiviadmin"]')) {
      const b = document.createElement('button');
      b.className = 'sb-item';
      b.setAttribute('data-sec', 'suiviadmin');
      b.setAttribute('onclick', "showSec('suiviadmin',this)");
      b.innerHTML = '<svg class="ico sb-ico"><use href="#ic-realisation"></use></svg>'
        + '<span class="sb-label">Suivi administratif</span>';
      ref.insertAdjacentElement('afterend', b);
    }

    const secRef = document.getElementById('sec-livraisons');
    if (secRef && !document.getElementById('sec-suiviadmin')) {
      const sec = document.createElement('section');
      sec.id = 'sec-suiviadmin'; sec.className = 'sec';
      sec.innerHTML = SA_SECTION;
      secRef.parentNode.appendChild(sec);
    }
  }

  // L'ouverture de la rubrique clôture le mois écoulé si c'est encore à faire,
  // puis dessine. `showSec` appelle `saOuvrir` (index.html).
  window.saOuvrir = function () {
    try { saCloturer(); } catch (e) {}
    saMois = saMoisDe(new Date());
    saAnnee = +saMois.slice(0, 4);
    saRender(true);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', saInject);
  else saInject();
}());
