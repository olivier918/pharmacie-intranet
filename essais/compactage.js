// Garde-fou du compactage. Le nom d'une table ne peut PAS etre passe en
// parametre a PostgreSQL : il finit concatene dans le texte de la requete.
// C'est donc le seul endroit de l'application ou une chaine venue du
// navigateur pourrait atterrir dans du SQL. La liste fermee est la protection,
// et une protection sans garde-fou se fait retirer un jour par distraction.
// node essais/compactage.js
const maint = require('../maintenance');

let ok=0,ko=0; const t=(n,c)=>{c?(ok++,console.log('  ✓ '+n)):(ko++,console.log('  ✗ '+n));};
console.log('\nCOMPACTAGE — ce qui a le droit d’entrer dans la requête\n');

t('une table connue est acceptée', maint.tableCompactable('app_data_history')==='app_data_history');
t('les espaces autour ne gênent pas', maint.tableCompactable('  app_data  ')==='app_data');

t('une table inconnue est refusée', maint.tableCompactable('pg_authid')===null);
t('vide refusé', maint.tableCompactable('')===null);
t('absent refusé', maint.tableCompactable(undefined)===null && maint.tableCompactable(null)===null);

// Le coeur du sujet : ce qui rendrait la concatenation dangereuse.
t('injection par point-virgule refusée', maint.tableCompactable('app_data; DROP TABLE app_data')===null);
t('injection par commentaire refusée', maint.tableCompactable('app_data --')===null);
t('injection collée à un nom valide refusée', maint.tableCompactable('app_data_history, app_data')===null);
t('guillemets refusés', maint.tableCompactable('"app_data"')===null);
t('la casse ne suffit pas à passer', maint.tableCompactable('APP_DATA')===null);
t('un objet ne devient pas un nom de table', maint.tableCompactable({toString:()=>'app_data'})===null);

// Ce qui sort n'est jamais la chaine recue : c'est la valeur de la liste.
const recu = ' app_data_history ';
const rendu = maint.tableCompactable(recu);
t('ce qui est rendu vient de la liste, pas de l’entrée',
  rendu !== recu && maint.TABLES_COMPACTABLES.indexOf(rendu) !== -1);

t('toutes les tables de la liste sont acceptées',
  maint.TABLES_COMPACTABLES.every(x => maint.tableCompactable(x)===x));

console.log('\n'+ok+' réussi(s), '+ko+' échec(s)\n');
process.exit(ko?1:0);
