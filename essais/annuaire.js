// Garde-fou de la dedoublonnage a la saisie. upsertPatient est extraite du
// fichier lui-meme : c'est le code reel qui est eprouve, pas une copie.
// node essais/annuaire.js
const fs=require('fs'), path=require('path');
const RACINE=path.join(__dirname,'..');
const G={}; global.window=G;
eval(fs.readFileSync(path.join(RACINE,'public','pt-module.js'),'utf8'));
global.ptClef=G.ptClef; global.ptNaiss=G.ptNaiss;
global.patients=[];
const page=fs.readFileSync(path.join(RACINE,'public','index.html'),'utf8');
eval(page.slice(page.indexOf('function upsertPatient(p){'), page.indexOf('\nfunction upsertMedecin(m){')));

let ok=0,ko=0; const t=(n,c)=>{c?(ok++,console.log('  ✓ '+n)):(ko++,console.log('  ✗ '+n));};
console.log('\nANNUAIRE — le système qui évite les doublons\n');

upsertPatient({nom:'MULLER',prenom:'Jérôme',dob:'1950-04-02',tel:'0600'});
upsertPatient({nom:'muller',prenom:'jerome'});
t('la même personne saisie autrement ne crée pas de seconde fiche', patients.length===1);
t('... et la fiche garde ses coordonnées', patients[0].tel==='0600');

upsertPatient({nom:'Müller',prenom:'Jérôme',adresse:'3 rue du Parc'});
t('une troisième variante complète au lieu de dupliquer',
  patients.length===1 && patients[0].adresse==='3 rue du Parc');

// Le cas qui justifie tout : deux homonymes de dates differentes.
upsertPatient({nom:'MARTIN',prenom:'Jean',dob:'1940-05-05'});
upsertPatient({nom:'MARTIN',prenom:'Jean',dob:'1972-11-30'});
t('deux homonymes de dates différentes font DEUX fiches', patients.length===3);
t('... avec des identifiants distincts',
  patients[1].id!==patients[2].id && /#1940-05-05$/.test(patients[1].id));

upsertPatient({nom:'martin',prenom:'JEAN',dob:'05/05/1940',tel:'0611'});
t('l’un des deux se complète sans toucher à l’autre',
  patients.length===3 && patients[1].tel==='0611' && !patients[2].tel);

// Sans date, on ne tranche pas entre homonymes.
const avant=patients.length;
upsertPatient({nom:'MARTIN',prenom:'Jean',tel:'0699'});
t('sans date, une saisie homonyme ne modifie AUCUNE des deux fiches',
  patients[1].tel==='0611' && !patients[2].tel);
t('... elle crée une fiche à part plutôt que de choisir au hasard', patients.length===avant+1);

// Une fiche sans date se laisse completer.
global.patients=[{id:'pt:DUPONT|MARIE',nom:'DUPONT',prenom:'Marie',dob:''}];
upsertPatient({nom:'DUPONT',prenom:'Marie',dob:'1960-02-02'});
t('une fiche sans date accueille la date qu’on lui apporte',
  patients.length===1 && patients[0].dob==='1960-02-02');

t('rien n’écrase une valeur existante par du vide',
  (upsertPatient({nom:'DUPONT',prenom:'Marie',tel:''}), patients[0].dob==='1960-02-02'));
t('upsertPatient rend la fiche concernée',
  upsertPatient({nom:'DUPONT',prenom:'Marie'}).id===patients[0].id);

console.log('\n'+ok+' réussi(s), '+ko+' échec(s)\n');
process.exit(ko?1:0);
