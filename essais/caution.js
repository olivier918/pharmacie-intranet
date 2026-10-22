// LA CAUTION — ce que le contrat promet au patient.
// node essais/caution.js
//
// CE QUI SE JOUE. Le contrat de location part à l'impression en DEUX
// exemplaires, et le patient en signe un. Ce qu'il dit de la caution l'engage,
// et nous engage : le texte disait « encaissée à la remise du matériel », alors
// que la pharmacie ne l'encaisse pas — elle garde le chèque en garantie, ou
// bloque la somme sur la carte sans la débiter.
//
// Deux moyens, donc, et ils n'appellent pas les mêmes gestes au retour : un
// chèque se REND, une préautorisation se LIBÈRE. Le dossier retient lequel a
// été pris, et c'est ce que cet essai garde — avec la promesse faite au
// patient, mot pour mot.
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

// Les fonctions sont extraites du fichier lui-même : un essai qui recopierait
// le texte du contrat ne vérifierait que sa propre copie.
function extraire(nom) {
  const d = src.indexOf('function ' + nom + '(');
  if (d < 0) throw new Error('fonction introuvable : ' + nom);
  const f = src.indexOf('\n}', d);
  if (f < 0) throw new Error('fin introuvable : ' + nom);
  return src.slice(d, f + 2);
}
const LOC_TYPES = { lit: { lbl: 'Lit médicalisé', caution: 300 }, autre: { lbl: 'Autre' } };
eval(extraire('locCautionMontant'));
eval(extraire('locCautionMode'));
eval(extraire('locCautionContrat'));

let ok = 0, ko = 0;
const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };
console.log('\nLA CAUTION — ce que le contrat promet\n');

// ── Le moyen retenu ─────────────────────────────────────────────────────────
console.log('Quel moyen de garantie');
t('un dossier qui dit « carte » est garanti par carte',
  locCautionMode({ cautionMode: 'cb' }) === 'cb');
t('un dossier qui dit « chèque » l’est par chèque',
  locCautionMode({ cautionMode: 'cheque' }) === 'cheque');
// AUCUNE MIGRATION N'EST ÉCRITE DANS LES DONNÉES (piège n°7). Les dossiers
// ouverts avant cette version n'ont pas de `cautionMode` : ils datent de
// l'époque où il n'y avait que le chèque, et c'est ce qu'on répond pour eux.
t('UN DOSSIER D’AVANT N’A PAS DE MOYEN — on répond « chèque », sans rien réécrire',
  locCautionMode({ id: 1, caution: true }) === 'cheque');
t('une valeur inattendue ne devient pas une carte bancaire',
  locCautionMode({ cautionMode: 'virement' }) === 'cheque');
t('un dossier absent ne fait pas tomber la lecture', locCautionMode(null) === 'cheque');

// ── Le montant ──────────────────────────────────────────────────────────────
console.log('\nLe montant');
t('le montant figé dans le dossier prime',
  locCautionContrat({ cautionMontant: 250 }).cellule.indexOf('250,00 €') === 0);
t('à défaut, celui du type de matériel',
  locCautionContrat({ type: 'lit' }).cellule.indexOf('300,00 €') === 0);
t('à défaut encore, la valeur de repli',
  locCautionContrat({ type: 'autre' }).cellule.indexOf('200,00 €') === 0);
t('la virgule décimale, pas le point — c’est un document français',
  !/\d\.\d\d €/.test(locCautionContrat({ cautionMontant: 250 }).cellule));

// ── Ce qui est promis, chèque ───────────────────────────────────────────────
console.log('\nPar chèque');
const ch = locCautionContrat({ cautionMontant: 300, cautionMode: 'cheque' });
t('LE CHÈQUE N’EST PAS ENCAISSÉ, et le contrat le dit',
  /n’est pas\s*<\/strong>?|n'est pas/.test(ch.clause) && /pas[\s\S]{0,30}encaiss/.test(ch.clause));
t('... il est conservé en garantie', /garantie/.test(ch.clause));
t('... et restitué au retour du matériel', /restitu/.test(ch.clause) && /bon état/.test(ch.clause));
t('LES CAS OÙ IL PEUT L’ÊTRE SONT DITS — sans eux la garantie n’en est pas une',
  /ne pourra être encaissé qu’en cas de|ne pourra être encaissé qu'en cas de/.test(ch.clause)
  && /non-restitution/.test(ch.clause) && /détérioration/.test(ch.clause));
t('la période non couverte par l’Assurance Maladie en fait partie',
  /Assurance Maladie/.test(ch.clause));
t('le tableau dit la même chose en trois mots',
  /chèque conservé, non encaissé/.test(ch.cellule));

// ── Ce qui est promis, carte ────────────────────────────────────────────────
console.log('\nPar préautorisation bancaire');
const cb = locCautionContrat({ cautionMontant: 300, cautionMode: 'cb' });
t('la somme est bloquée', /bloqué/.test(cb.clause));
t('... ET PAS DÉBITÉE — c’est toute la différence avec un paiement',
  /n’est pas débitée|n'est pas débitée/.test(cb.clause));
t('... l’autorisation est libérée au retour', /libérée/.test(cb.clause) && /bon état/.test(cb.clause));
// UNE PRÉAUTORISATION EXPIRE. La banque la limite dans le temps, souvent bien
// avant la fin d'une location de huit semaines. Promettre un blocage « pendant
// toute la durée de la location » serait une promesse qu'on ne tient pas.
t('LA DURÉE LIMITÉE EST ANNONCÉE, et le renouvellement prévu',
  /durée[\s\S]{0,40}limitée/.test(cb.clause) && /renouvellement/.test(cb.clause));
t('... on ne promet donc pas un blocage pendant toute la location',
  !/toute la durée de la location/.test(cb.clause));
t('les cas de débit sont dits', /ne pourra être débitée qu’en cas de|ne pourra être débitée qu'en cas de/.test(cb.clause));
t('le tableau dit la même chose en trois mots',
  /préautorisation bancaire/.test(cb.cellule) && /non débitée/.test(cb.cellule));

console.log('\nLes deux textes ne se confondent pas');
t('le chèque ne parle pas de carte', !/carte bancaire/.test(ch.clause));
t('la carte ne parle pas de chèque', !/chèque/.test(cb.clause));
t('L’ANCIENNE PHRASE A DISPARU DU DÉPÔT — « encaissée à la remise du matériel »',
  !/encaissée à la remise du matériel/.test(src));

// ── Le contrat et les écrans s’appuient dessus ──────────────────────────────
console.log('\nUn seul endroit décide du texte');
t('le tableau du contrat appelle la fonction',
  /<td>Caution<\/td><td>\$\{l\.caution\?locCautionContrat\(l\)\.cellule/.test(src));
t('les conditions générales aussi',
  /\$\{l\.caution\?locCautionContrat\(l\)\.clause:''\}/.test(src));
t('... il n’y a donc pas deux textes à faire diverger',
  (src.match(/locCautionContrat\(/g) || []).length === 3);

console.log('\nLe dossier retient le moyen');
t('le dossier créé le porte', /cautionEtat:lcCautionChoisie\(\),\n\s*cautionMode:lcCautionMode\(\),\n\s*status:'nouveau'/.test(src));
t('le contrat imprimé avant enregistrement aussi — sinon il mentirait',
  /cautionEtat:lcCautionChoisie\(\),\n\s*cautionMode:lcCautionMode\(\),\n\s*\};\n\s*printContrat\(l\);/.test(src));
t('le choix n’apparaît que si une caution est due',
  /const due=lcCautionChoisie\(\)!=='non';/.test(src)
  && /m\.style\.display=due\?'':'none';/.test(src));

console.log('\nAu retour, le bon geste');
t('un chèque se REND', /Oui, chèque rendu au patient/.test(src));
t('une préautorisation se LIBÈRE', /Oui, préautorisation libérée/.test(src));
t('... et la question posée distingue les deux',
  /parCb\?'Préautorisation de ':'Chèque de caution de '/.test(src));

console.log('\nÀ la livraison');
t('IL N’Y A PAS DE CHÈQUE À RÉCUPÉRER SUR UNE CARTE — la case disparaît',
  /const cb=lcCautionMode\(\)==='cb';/.test(src)
  && /l\.style\.display=\(due&&!cb\)\?'':'none';/.test(src));
t('... et elle est décochée, pour qu’aucune livraison ne parte la réclamer',
  /if\(c&&\(cb\|\|!due\)\) c\.checked=false;/.test(src));

console.log('\n' + ok + ' vérifications, ' + ko + ' échec(s)\n');
process.exit(ko ? 1 : 0);
