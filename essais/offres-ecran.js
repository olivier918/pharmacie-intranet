// L'ÉCRAN DES OFFRES, EXÉCUTÉ.
// node essais/offres-ecran.js
//
// CE QUI SE JOUE. Le module est une fonction immédiate qui parle au DOM : une
// fonction manquante dans un gabarit `${}` ou un `null` déréférencé ne se voit
// pas à la lecture, et l'écran reste blanc. On le fait donc TOURNER — contre un
// document de poche et un serveur de poche — et on regarde ce qu'il dessine,
// une fois en préparatrice, une fois en titulaire.
const fs = require('fs'), path = require('path');
let ok = 0, ko = 0;
const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };
console.log('\nL’ÉCRAN DES OFFRES\n');

// ── Le document de poche ───────────────────────────────────────────────────
function elt(id) {
  return { id, innerHTML: '', textContent: '', value: '', className: '', style: {},
           classList: { add(){}, remove(){}, contains(){ return false; } },
           children: [], title: '',
           appendChild(x){ this.children.push(x); return x; },
           querySelector(){ return null; },
           setAttribute(){}, insertAdjacentElement(){}, remove(){},
           scrollIntoView(){}, focus(){}, select(){} };
}
const hote = elt('of-host'), nav = elt('navb-of');
const boites = { 'of-host': hote, 'navb-of': nav };
global.document = {
  head: elt('head'),
  readyState: 'complete',
  getElementById: id => boites[id] || null,
  createElement: n => elt('neuf-' + n),
  querySelector: s => (/data-sec="offres"/.test(s) ? elt('sb-offres') : null),
  addEventListener(){}
};
global.location = { origin: 'https://pilot.pharmacie-mondeville.fr' };
global.localStorage = { getItem: () => null, setItem(){} };
global.staffDB = [{ id: 'JN', prenom: 'Jeanne', nom: 'Noel', poste: 'Préparateur' },
                  { id: 'OF', prenom: 'Olivier', nom: 'Ferran', poste: 'Pharmacien' }];
global.window = global;

// Le serveur de poche : on décide de la réponse, et on relit l'écran.
let REPONSE = null, ENVOYES = [];
global.fetch = async (url, opt) => {
  ENVOYES.push({ url, corps: opt && opt.body ? JSON.parse(opt.body) : null });
  return { ok: true, status: 200, json: async () => REPONSE };
};
global.confirm = () => true;
global.alert = () => {};
global.navigator = { clipboard: { writeText: async () => {} } };

require(path.join(__dirname, '..', 'public', 'of-module.js'));

const PUBLIEE = { code: 'avene', titre: 'Journee Avene -20%', mime: 'image/jpeg', taille: 4200,
  empreinte: 'aaaabbbbccccdddd', largeur: 800, hauteur: 1200,
  debut: '2026-11-01', fin: '2026-11-30', veille: false, vues: 12, statut: 'publiee' };
const MIENNE = { code: 'nuxe', titre: 'Semaine Nuxe -15%', mime: '', taille: 0,
  debut: '2026-12-01', fin: '2026-12-06', veille: false, vues: 0,
  statut: 'proposition', propose_par: 'JN' };
const AUTRE = { code: 'caudalie', titre: 'Caudalie', mime: 'image/jpeg', taille: 900,
  empreinte: 'eeeeffff00001111', veille: false, vues: 0,
  statut: 'proposition', propose_par: 'CB' };

async function voir(redacteur, moi, liste) {
  REPONSE = { ok: true, jour: '2026-11-20', redacteur, moi, base: null, offres: liste };
  await window.ofCharger();
  return hote.innerHTML;
}

(async function () {
  // ── La préparatrice ──────────────────────────────────────────────────────
  console.log('Ce que voit une préparatrice');
  let v = await voir(false, 'JN', [PUBLIEE, MIENNE, AUTRE]);
  t('L’ÉCRAN SE DESSINE', v.length > 200);
  t('ELLE PEUT PROPOSER — c’est tout l’objet', /Proposer une op/.test(v));
  t('... et le formulaire existe pour elle', /id="of-form-card"/.test(v));
  t('... sans champ d’adresse de lien', v.indexOf('id="of-code"') < 0);
  t('... sans case « image de veille »', v.indexOf('id="of-veille"') < 0);
  t('... et on lui dit qui finalisera', /part au titulaire/.test(v));
  t('les propositions ont leur carte', /Propositions de l/.test(v));
  t('... la sienne y est, à son nom', /Semaine Nuxe/.test(v) && /Jeanne Noel/.test(v));
  t('... celle d’une collègue aussi, à son nom', /Caudalie/.test(v));
  t('ELLE NE PUBLIE RIEN', v.indexOf('ofPublier') < 0);
  t('... et ne retire que la sienne',
    (v.match(/ofSupprimer\('nuxe'\)/g) || []).length === 1
    && v.indexOf("ofSupprimer('caudalie')") < 0);
  t('la proposition sans affiche dit ce qui manque', /il manque l’affiche/.test(v));
  t('... et montre un cadre vide plutôt qu’une image cassée', /of-l-vide/.test(v));
  t('AUCUNE PROPOSITION NE PASSE POUR L’AFFICHE EN LIGNE',
    /class="of-v-t">Journee Avene/.test(v));
  // La carte « Toutes les affiches » vient après celle des propositions : on
  // regarde DANS celle-là, pas dans la page entière, sinon la présence des
  // propositions plus haut suffirait à faire passer l'essai.
  const listePubs = v.slice(v.indexOf('Toutes les affiches'));
  t('... et la liste des affiches ne contient que les publiées',
    listePubs.indexOf('of-l-prop') < 0 && /Journee Avene/.test(listePubs)
    && listePubs.indexOf('Nuxe') < 0 && listePubs.indexOf('Caudalie') < 0);
  t('la pastille reste muette pour elle', nav.textContent === '');

  // ── Le titulaire ─────────────────────────────────────────────────────────
  console.log('\nCe que voit le titulaire');
  v = await voir(true, 'OF', [PUBLIEE, MIENNE, AUTRE]);
  t('il crée une affiche directement', /Nouvelle affiche/.test(v));
  t('il voit les deux propositions', /Semaine Nuxe/.test(v) && /Caudalie/.test(v));
  t('IL PUBLIE CELLE QUI EST COMPLÈTE', /ofPublier\('caudalie'\)/.test(v));
  t('... ET PAS CELLE À QUI IL MANQUE L’AFFICHE', v.indexOf("ofPublier('nuxe')") < 0);
  t('il peut corriger les deux',
    /ofOuvrirForm\('nuxe'\)/.test(v) && /ofOuvrirForm\('caudalie'\)/.test(v));
  t('la carte compte ce qui l’attend', /Propositions de l’équipe <span class="of-n">2</.test(v));
  t('LA PASTILLE LE LUI DIT SANS QU’IL VIENNE', nav.textContent === '2');
  t('... et dit quoi', /2 propositions à finaliser/.test(nav.title));

  console.log('\nLe formulaire du titulaire');
  window.ofOuvrirForm('nuxe');
  v = hote.innerHTML;
  t('il ouvre la proposition', /Modifier la proposition/.test(v));
  t('L’ADRESSE SE CHANGE ENCORE — aucun SMS ne la porte',
    /id="of-code"/.test(v) && !/id="of-code"[^>]*readonly/.test(v));
  t('... et « Publier » est là, à côté d’« Enregistrer »', /ofPublier\('nuxe'\)/.test(v));
  window.ofOuvrirForm('avene');
  v = hote.innerHTML;
  t('une affiche en ligne, elle, garde son adresse',
    /id="of-code"[^>]*readonly/.test(v));
  t('... et ne se « publie » pas deux fois', v.indexOf("ofPublier('avene')") < 0);

  console.log('\nCe qui part au serveur');
  ENVOYES = [];
  await window.ofPublier('caudalie');
  t('publier appelle la route faite pour ça',
    ENVOYES.some(x => x.url === '/api/offres/publier' && x.corps.code === 'caudalie'));

  console.log('\nQuand il n’y a rien');
  v = await voir(true, 'OF', []);
  t('l’écran tient debout', /Aucune affiche pour le moment/.test(v));
  t('... et la carte des propositions ne s’affiche pas vide',
    v.indexOf('Propositions de l') < 0);
  t('... la pastille non plus', nav.textContent === '');

  console.log('\n' + ok + ' vérifications, ' + ko + ' échec(s)\n');
  process.exit(ko ? 1 : 0);
})().catch(e => { console.error('ESSAI INTERROMPU :', e); process.exit(1); });
