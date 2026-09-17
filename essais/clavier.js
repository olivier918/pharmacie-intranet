// Le clavier dans les listes de suggestion. Ce qui se joue ici : on doit
// pouvoir descendre dans les propositions et en prendre une SANS la souris,
// et surtout pouvoir n'en prendre AUCUNE — un nom inconnu se valide tel quel,
// c'est ainsi qu'une fiche patient se cree. Le vrai fichier est charge et
// execute contre un DOM de poche ; rien n'est recopie.
// node essais/clavier.js
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'kb-module.js'), 'utf8');

// ── Un DOM de poche ─────────────────────────────────────────────────────────
// Juste ce que le module touche : des enfants, des classes, des attributs, et
// une visibilite qui depend de style.display comme dans un navigateur.
let compteurId = 0;
class El {
  constructor(tag, opts) {
    opts = opts || {};
    this.tagName = String(tag).toUpperCase();
    this.nodeType = 1;
    this.id = opts.id || '';
    this.type = opts.type || (this.tagName === 'INPUT' ? 'text' : undefined);
    this.value = opts.value !== undefined ? opts.value : '';
    this.children = [];
    this.parentElement = null;
    this.style = { display: opts.display || '' };
    this.attrs = Object.assign({}, opts.attrs);
    this.classes = new Set((opts.cls || '').split(/\s+/).filter(Boolean));
    this.dataset = {};
    this.scrollTop = 0;
    this._ordre = ++compteurId;
    this._oninput = opts.oninput || null;
    this.recu = [];                       // les gestes recus, pour les essais
    const self = this;
    this.classList = {
      add: function () { [].slice.call(arguments).forEach(c => self.classes.add(c)); },
      remove: function () { [].slice.call(arguments).forEach(c => self.classes.delete(c)); },
      contains: c => self.classes.has(c)
    };
  }
  get className() { return [...this.classes].join(' '); }
  ajouter(...els) { els.forEach(e => { e.parentElement = this; this.children.push(e); }); return this; }
  getAttribute(n) { return this.attrs[n] === undefined ? null : this.attrs[n]; }
  setAttribute(n, v) { this.attrs[n] = String(v); }
  removeAttribute(n) { delete this.attrs[n]; }
  get offsetWidth() { return this._visible() ? 120 : 0; }
  get offsetHeight() { return this._visible() ? 18 : 0; }
  _visible() {
    let n = this;
    while (n) { if (n.style && n.style.display === 'none') return false; n = n.parentElement; }
    return true;
  }
  contains(o) { let n = o; while (n) { if (n === this) return true; n = n.parentElement; } return false; }
  closest(sel) { let n = this; while (n) { if (correspond(n, sel)) return n; n = n.parentElement; } return null; }
  querySelector(sel) { return descendants(this).find(e => correspond(e, sel)) || null; }
  querySelectorAll(sel) { return descendants(this).filter(e => correspond(e, sel)); }
  getBoundingClientRect() { return { top: 0, bottom: 100, left: 0, right: 100, height: 100, width: 100 }; }
  compareDocumentPosition(o) { return o._ordre > this._ordre ? 4 : 2; }   // FOLLOWING : 4
  dispatchEvent(ev) {
    this.recu.push(ev.type);
    if (ev.type === 'input' && this._oninput) this._oninput(this);
    return true;
  }
  click() { this.recu.push('click'); }
  appendChild(e) { this.ajouter(e); }
}
function descendants(el) {
  const out = [];
  (function walk(n) { n.children.forEach(c => { out.push(c); walk(c); }); })(el);
  return out;
}
// Un moteur de selecteurs volontairement etroit : exactement les formes que le
// module ecrit, et rien de plus. Un moteur complet se tromperait en silence.
function correspond(el, sel) {
  return String(sel).split(',').map(s => s.trim()).filter(Boolean).some(function (t) {
    if (t[0] === '.') return el.classes.has(t.slice(1));
    const m = /^\[id\$="(.+)"\]$/.exec(t);
    if (m) return String(el.id || '').endsWith(m[1]);
    return el.tagName === t.toUpperCase();
  });
}

const racine = new El('body');
let ecouteurs = {};
const document = {
  addEventListener: (t, f) => { (ecouteurs[t] = ecouteurs[t] || []).push(f); },
  querySelectorAll: sel => racine.querySelectorAll(sel),
  querySelector: sel => racine.querySelector(sel),
  createElement: t => new El(t),
  head: new El('head'),
  body: racine
};
const window = {};
const Node = { DOCUMENT_POSITION_FOLLOWING: 4 };
class Evt { constructor(t, o) { this.type = t; Object.assign(this, o || {}); } }

// ── On execute le VRAI module contre ce DOM ────────────────────────────────
new Function('window', 'document', 'Node', 'MouseEvent', 'Event', src)
  (window, document, Node, Evt, Evt);
const auClavier = (ecouteurs.keydown || [])[0];
if (typeof auClavier !== 'function') throw new Error('le module n a pose aucun gestionnaire de touches');

// ── Un formulaire d essai : un champ patient, un champ medecin, chacun sa liste
function ligne(handler) { return new El('div', { cls: 'ac-item', attrs: { onmousedown: handler } }); }
function monter(nomsPatient, nomsMedecin) {
  racine.children.length = 0;
  const form = new El('div');
  const fgP = new El('div');
  const champP = new El('input', {
    id: 'lc-nom', value: 'mar',
    oninput: function () { listeP.style.display = 'block'; }
  });
  const listeP = new El('div', { id: 'lc-pat-ac', cls: 'ac-drop', display: 'none' });
  nomsPatient.forEach((n, i) => listeP.ajouter(ligne('fillPatient(' + i + ')')));
  fgP.ajouter(champP, listeP);

  const fgM = new El('div');
  const champM = new El('input', { id: 'lc-prescripteur', value: 'tim' });
  const listeM = new El('div', { id: 'lc-med-ac', cls: 'ac-drop', display: 'none' });
  nomsMedecin.forEach((n, i) => listeM.ajouter(ligne('fillMedecin(' + i + ')')));
  fgM.ajouter(champM, listeM);

  form.ajouter(fgP, fgM);
  racine.ajouter(form);
  return { champP, listeP, champM, listeM };
}
function ouvrir(l) { l.style.display = 'block'; }
function frappe(cible, key, opts) {
  const ev = new Evt('keydown', Object.assign({ key: key, target: cible }, opts || {}));
  ev.defaut = false; ev.stoppe = false;
  ev.preventDefault = () => { ev.defaut = true; };
  ev.stopPropagation = () => { ev.stoppe = true; };
  auClavier(ev);
  return ev;
}
const surlignee = l => l.children.findIndex(c => c.classes.has('kb-sel'));
const gestes = l => l.children.map(c => c.recu.join('+')).filter(Boolean);

// ── Les essais ──────────────────────────────────────────────────────────────
let ok = 0, ko = 0;
function v(titre, attendu, obtenu) {
  const bon = JSON.stringify(attendu) === JSON.stringify(obtenu);
  if (bon) { ok++; } else { ko++; console.log('  ECHEC ' + titre + '\n    attendu ' + JSON.stringify(attendu) + '\n    obtenu  ' + JSON.stringify(obtenu)); }
}

// 1. Descendre
let d = monter(['a', 'b', 'c'], ['x']); ouvrir(d.listeP);
frappe(d.champP, 'ArrowDown');
v('fleche bas : la premiere ligne se surligne', 0, surlignee(d.listeP));
frappe(d.champP, 'ArrowDown');
v('fleche bas : on descend d une ligne', 1, surlignee(d.listeP));
frappe(d.champP, 'ArrowUp');
v('fleche haut : on remonte', 0, surlignee(d.listeP));
frappe(d.champP, 'ArrowUp');
v('fleche haut depuis la premiere : on boucle en bas', 2, surlignee(d.listeP));
frappe(d.champP, 'ArrowDown');
v('fleche bas depuis la derniere : on boucle en haut', 0, surlignee(d.listeP));
v('la fleche ne laisse pas defiler la page', true, frappe(d.champP, 'ArrowDown').defaut);

// 2. Choisir
d = monter(['a', 'b', 'c'], ['x']); ouvrir(d.listeP);
frappe(d.champP, 'ArrowDown'); frappe(d.champP, 'ArrowDown');
let ev = frappe(d.champP, 'Entree'.replace('Entree', 'Enter'));
v('entree prend la ligne surlignee, et elle seule', ['mousedown'], gestes(d.listeP));
v('entree qui choisit ne valide pas le formulaire', true, ev.defaut);
v('la ligne prise n est plus surlignee', -1, surlignee(d.listeP));

// 3. Ne rien choisir : le nom inconnu qu on est en train de creer
d = monter(['MARTIN', 'MARTINEZ'], ['x']); ouvrir(d.listeP);
ev = frappe(d.champP, 'Enter');
v('entree sans surlignage ne prend aucune ligne', [], gestes(d.listeP));
v('entree sans surlignage laisse valider la saisie', false, ev.defaut);
v('entree sans surlignage referme la liste', 'none', d.listeP.style.display);

// 4. Tabulation
d = monter(['a', 'b'], ['x']); ouvrir(d.listeP);
frappe(d.champP, 'ArrowDown');
ev = frappe(d.champP, 'Tab');
v('tabulation sur une ligne surlignee la prend', ['mousedown'], gestes(d.listeP));
v('tabulation passe quand meme au champ suivant', false, ev.defaut);
d = monter(['a', 'b'], ['x']); ouvrir(d.listeP);
ev = frappe(d.champP, 'Tab');
v('tabulation sans surlignage ne prend rien', [], gestes(d.listeP));
v('tabulation sans surlignage referme la liste', 'none', d.listeP.style.display);

// 5. Echap
d = monter(['a', 'b'], ['x']); ouvrir(d.listeP);
frappe(d.champP, 'ArrowDown');
ev = frappe(d.champP, 'Escape');
v('echap referme la liste', 'none', d.listeP.style.display);
v('echap n efface pas la saisie', 'mar', d.champP.value);
v('echap ne remonte pas fermer la fenetre derriere', true, ev.stoppe);

// 6. F4 : derouler et replier
d = monter(['a', 'b'], ['x']);
v('au depart la liste est repliee', 'none', d.listeP.style.display);
frappe(d.champP, 'F4');
v('F4 deroule la liste en refaisant jouer la recherche du champ', 'block', d.listeP.style.display);
frappe(d.champP, 'F4');
v('F4 sur une liste deroulee la replie', 'none', d.listeP.style.display);
d = monter(['a', 'b'], ['x']);
frappe(d.champP, 'ArrowDown', { altKey: true });
v('Alt+fleche bas deroule aussi', 'block', d.listeP.style.display);

// 7. Fleche bas sur une liste refermee : on redemande les propositions
d = monter(['a', 'b'], ['x']);
ev = frappe(d.champP, 'ArrowDown');
v('fleche bas rouvre une liste refermee', 'block', d.listeP.style.display);
v('et surligne directement la premiere ligne', 0, surlignee(d.listeP));
d = monter(['a', 'b'], ['x']); d.champP.value = '';
frappe(d.champP, 'ArrowDown');
v('fleche bas sur un champ vide ne force rien', 'none', d.listeP.style.display);

// 8. Chacun sa liste
d = monter(['a', 'b'], ['x', 'y']); ouvrir(d.listeP); ouvrir(d.listeM);
frappe(d.champM, 'ArrowDown');
v('le champ medecin pilote la liste du medecin', 0, surlignee(d.listeM));
v('et laisse celle du patient tranquille', -1, surlignee(d.listeP));
frappe(d.champM, 'Enter');
v('la ligne prise est celle du medecin', ['mousedown'], gestes(d.listeM));
v('rien n a ete pris chez le patient', [], gestes(d.listeP));

// 9. Une ligne de texte sans geste ne se surligne pas
d = monter(['a'], ['x']); ouvrir(d.listeP);
d.listeP.ajouter(new El('div', { cls: 'ac-item rn-neuf' }));   // « Aucun patient connu »
frappe(d.champP, 'ArrowDown'); frappe(d.champP, 'ArrowDown');
v('le clavier saute la ligne qui n est que du texte', 0, surlignee(d.listeP));

// 10. Taper autre chose annule la selection
d = monter(['a', 'b'], ['x']); ouvrir(d.listeP);
frappe(d.champP, 'ArrowDown');
frappe(d.champP, 'e');
v('une lettre de plus annule le surlignage', -1, surlignee(d.listeP));
frappe(d.champP, 'ArrowDown');
frappe(d.champP, 'Backspace');
v('une correction aussi', -1, surlignee(d.listeP));

// 11. Ce que le module ne doit PAS intercepter
d = monter(['a', 'b'], ['x']); ouvrir(d.listeP);
const caseAcocher = new El('input', { type: 'checkbox' });
racine.ajouter(caseAcocher);
ev = frappe(caseAcocher, 'ArrowDown');
v('les fleches d une case a cocher ne sont pas detournees', false, ev.defaut);
const champDate = new El('input', { type: 'date' });
racine.ajouter(champDate);
ev = frappe(champDate, 'ArrowDown');
v('les fleches d un champ date non plus', false, ev.defaut);
ev = frappe(d.champP, 'ArrowDown', { ctrlKey: true });
v('Ctrl+fleche reste un raccourci du navigateur', false, ev.defaut);

// 12. Aucune liste ouverte nulle part : le clavier redevient ordinaire
d = monter([], ['x']);
d.champP.value = '';
ev = frappe(d.champP, 'Enter');
v('entree sans liste ne bloque rien', false, ev.defaut);

// 13. L autre forme du depot : le champ dans son bloc, la liste a cote du bloc
// (c'est celle de la recherche patient du formulaire de livraison).
racine.children.length = 0;
(function () {
  const bloc = new El('div');
  const fg = new El('div', { cls: 'fg' });
  const liste = new El('div', { id: 'ps-sugg', display: 'none' });
  const champ = new El('input', { id: 'ps-q', value: 'dup', oninput: function () { liste.style.display = 'block'; } });
  fg.ajouter(new El('label'), champ);
  bloc.ajouter(fg, liste);
  racine.ajouter(bloc);
  liste.ajouter(ligne('fillP(0)'), ligne('fillP(1)'));
  liste.style.display = 'block';
  frappe(champ, 'ArrowDown');
  v('la liste rangee a cote du bloc du champ est bien trouvee', 0, surlignee(liste));
  frappe(champ, 'Enter');
  v('et sa ligne se prend au clavier', ['mousedown'], gestes(liste));
}());

// 14. La grille de champs : un voisin ne pilote pas la liste d un autre.
// Dans le formulaire de location, nom, prescripteur, telephone et courriel
// sont dans la meme grille ; une fleche bas tapee dans le telephone ne doit
// pas descendre dans la liste des patients restee ouverte deux cases plus haut.
racine.children.length = 0;
(function () {
  const grille = new El('div', { cls: 'fgrid' });
  const fgP = new El('div', { cls: 'fg' });
  const liste = new El('div', { id: 'lc-pat-ac', cls: 'ac-drop' });
  const champP = new El('input', { id: 'lc-nom', value: 'mar' });
  fgP.ajouter(champP, liste);
  liste.ajouter(ligne('fillPatient(0)'));
  const fgT = new El('div', { cls: 'fg' });
  const champT = new El('input', { id: 'lc-tel', value: '0601' });
  fgT.ajouter(champT);
  grille.ajouter(fgP, fgT);
  racine.ajouter(grille);
  const e = frappe(champT, 'ArrowDown');
  v('le champ telephone ne pilote pas la liste du patient', -1, surlignee(liste));
  v('et sa fleche bas reste une fleche bas', false, e.defaut);
  frappe(champP, 'ArrowDown');
  v('le champ patient, lui, la pilote toujours', 0, surlignee(liste));
}());

console.log((ok + ko) + ' vérifications, ' + ko + ' échec(s)');
process.exit(ko ? 1 : 0);
