// LA BARRE LATÉRALE — les familles, et le pli.
// node essais/barre-laterale.js
//
// CE QUI SE JOUE. La barre s'est mise à porter des familles : Logistique
// abrite Commandes, Contrôle de commande et Litiges. Trois mécaniques s'y
// superposent désormais, et chacune écrit dans le même `style.display` :
// les droits de l'opérateur, l'appartenance à un parent masqué, et le pli.
//
// Quand trois choses écrivent au même endroit, l'ordre et les exceptions ne
// se devinent pas. Deux d'entre elles sont contre-intuitives, et c'est
// précisément pour ça qu'elles sont gardées ici :
//
//   • replié veut dire replié : RIEN ne dépasse, pas même la page ouverte —
//     une seule sous-entrée laissée sous un groupe fermé se lit comme un pli
//     raté. On doit toujours savoir où l'on est, et c'est le GROUPE qui porte
//     alors la marque de la page ouverte ;
//   • replier ne doit JAMAIS déclencher la bascule de secours qui ramène au
//     premier module visible. Masquer par droits, c'est retirer un module ;
//     replier, c'est ranger. Se faire éjecter parce qu'on a rangé serait
//     absurde.
const fs = require('fs'), path = require('path');
const ix = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

// Les fonctions de la barre sont au premier niveau d'index.html, sans
// indentation : l'extracteur des modules ne convient pas.
function extraire(nom) {
  const d = ix.indexOf('function ' + nom + '(');
  if (d < 0) throw new Error('fonction introuvable : ' + nom);
  const f = ix.indexOf('\n}\n', d);
  if (f < 0) throw new Error('fin introuvable : ' + nom);
  return ix.slice(d, f + 3);
}
function bloc(depart, fin) {
  const d = ix.indexOf(depart);
  if (d < 0) throw new Error('bloc introuvable : ' + depart);
  return ix.slice(d, ix.indexOf(fin, d) + fin.length);
}

let ok = 0, ko = 0;
const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };
console.log('\nLA BARRE LATÉRALE\n');

// ── Le pli, éprouvé sur un localStorage de poche ────────────────────────────
let STORE = {};
globalThis.localStorage = {
  getItem: k => (k in STORE ? STORE[k] : null),
  setItem: (k, v) => { STORE[k] = String(v); }
};
let rendus = 0;
globalThis.appliquerModules = () => { rendus++; };
eval(bloc("const SB_PLI_CLE = 'pilot_sb_replies';", "'pilot_sb_replies';").replace(/^const /, 'globalThis.'));
eval(['sbReplies', 'sbEcrirePlis', 'sbReplie', 'sbDeplier', 'sbBasculerPli'].map(extraire).join('\n'));

console.log('Le pli se retient, par poste');
t('rien n’est replié au départ', sbReplies().length === 0 && !sbReplie('logistique'));
sbBasculerPli('logistique', null);
t('un clic replie', sbReplie('logistique'));
t('... et la barre est redessinée', rendus === 1);
t('... et c’est écrit dans le navigateur, pas dans la base',
  STORE['pilot_sb_replies'].indexOf('logistique') > 0);
sbBasculerPli('logistique', null);
t('un second clic déplie', !sbReplie('logistique'));
sbBasculerPli('logistique', null);
sbBasculerPli('suiviadmin', null);
t('deux familles peuvent être repliées en même temps',
  sbReplie('logistique') && sbReplie('suiviadmin'));
sbDeplier('logistique');
t('on peut déplier sans basculer', !sbReplie('logistique') && sbReplie('suiviadmin'));
sbDeplier('logistique');
t('... et déplier ce qui l’est déjà ne casse rien', !sbReplie('logistique'));

console.log('\nLe chevron n’ouvre pas la rubrique');
// Sans cette coupure, replier Logistique vous emmenerait dans Commandes au
// passage : le chevron vit DANS le bouton, et le clic remonterait jusqu'a lui.
let stoppe = 0;
sbBasculerPli('x', { stopPropagation: () => { stoppe++; } });
t('IL COUPE LA PROPAGATION DU CLIC', stoppe === 1);
t('un évènement absent ne fait pas tomber le geste',
  (function () { try { sbBasculerPli('y'); return true; } catch (e) { return false; } }()));

console.log('\nUn navigateur qui refuse d’écrire ne casse pas la barre');
// Navigation privee, stockage bloque : `localStorage` jette au lieu de rendre.
// La barre doit alors s'afficher TOUT DEPLIE, ce qui est le pire cas acceptable
// — jamais une barre vide dont on ne saurait pas sortir.
globalThis.localStorage = {
  getItem: () => { throw new Error('bloqué'); },
  setItem: () => { throw new Error('bloqué'); }
};
t('la lecture rend « rien n’est replié »', sbReplies().length === 0);
t('... et l’écriture échoue sans bruit',
  (function () { try { sbBasculerPli('logistique'); return true; } catch (e) { return false; } }()));
globalThis.localStorage = { getItem: k => (k in STORE ? STORE[k] : null), setItem: (k, v) => { STORE[k] = String(v); } };
STORE['pilot_sb_replies'] = '{"pas":"un tableau"}';
t('UNE VALEUR ABÎMÉE EST IGNORÉE, pas recopiée', sbReplies().length === 0);
STORE['pilot_sb_replies'] = 'n’importe quoi';
t('... et un contenu illisible non plus', sbReplies().length === 0);

// ── Ce que le code promet ───────────────────────────────────────────────────
console.log('\nLes deux exceptions qui ne se devinent pas');
// REPLIÉ VEUT DIRE REPLIÉ. Le groupe fermé ne laisse rien dépasser, pas même
// la page ouverte : c'est lui qu'on voit, c'est donc lui qui s'allume.
t('UN GROUPE REPLIÉ NE LAISSE RIEN DÉPASSER',
  /else if\(sbReplie\(k\)\)\{\n\s*b\.style\.display = 'none';/.test(ix)
  && !/sbReplie\(k\) && !b\.classList\.contains\('active'\)/.test(ix));
t('... et il porte lui-même la page ouverte, sinon la barre s’éteindrait',
  /famillePorteuse\[k\] = 1;/.test(ix)
  && /p\.classList\.toggle\('sb-porte', !!famillePorteuse\[p\.getAttribute\('data-sec'\)\]\);/.test(ix)
  && /\.sb-item\.sb-porte\{background:var\(--g-pale\)/.test(ix));
t('... y compris quand on navigue dans une famille repliée',
  /if\(p && sbReplie\(sbBtn\.getAttribute\('data-parent'\)\)\) p\.classList\.add\('sb-porte'\);/.test(ix));
t('... et la marque s’efface dès qu’on sort de la famille',
  /b\.classList\.remove\('sb-porte'\);/.test(ix));
t('REPLIER NE DÉCLENCHE PAS LA BASCULE DE SECOURS — seul un masquage le fait',
  /if\(p && p\.style\.display === 'none'\)\{\n\s*b\.style\.display = 'none';\n\s*if\(b\.classList\.contains\('active'\)\) actifMasque = true;/.test(ix));
t('... et le code dit pourquoi', /replier, c'est ranger/.test(ix));

console.log('\nLe chevron et le groupe');
t('il n’est posé que sur les items qui ont des sous-entrées',
  /if\(!c \|\| !parents\[c\] \|\| b\.getAttribute\('data-parent'\)\)\{/.test(ix));
t('... et retiré de ceux qui n’en ont plus',
  /e\.parentNode\.removeChild\(e\)/.test(ix));
t('il se repose à chaque classement de la barre',
  ix.indexOf('rangerSousEntrees(bar);\n  sbChevrons();') > 0);
t('OUVRIR UN GROUPE REPLIÉ LE DÉPLIE D’ABORD — sinon le clic ne ferait rien',
  /sbDeplier\(cle\);\n  appliquerModules\(\);\n  const enfants/.test(ix));
t('la barre réduite en icônes n’affiche pas de chevron',
  /#app\.sb-collapsed \.sb-chev\{display:none\}/.test(ix));

console.log('\nLes trois familles de la barre');
t('Logistique est un groupe sans page',
  /data-sec="logistique" onclick="ouvrirGroupe\('logistique'\)"/.test(ix)
  && !/id="sec-logistique"/.test(ix));
const fam = f => new RegExp("setAttribute\\('data-parent', '" + f + "'\\)");
t('Commandes, Contrôle de commande et Litiges sont ses trois sous-dossiers',
  fam('logistique').test(fs.readFileSync(path.join(__dirname, '..', 'public', 'co-module.js'), 'utf8'))
  && fam('logistique').test(fs.readFileSync(path.join(__dirname, '..', 'public', 'cc-module.js'), 'utf8'))
  && fam('logistique').test(fs.readFileSync(path.join(__dirname, '..', 'public', 'lt-module.js'), 'utf8')));

console.log('\n' + ok + ' vérifications, ' + ko + ' échec(s)\n');
process.exit(ko ? 1 : 0);
