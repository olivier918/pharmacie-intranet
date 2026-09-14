// Garde-fou du module Patients. La question testée n'est pas « est-ce que ça
// agrège », c'est « est-ce que ça refuse de rattacher quand il y a un doute ».
// node essais/patients.js
const fs=require('fs'), path=require('path');
const src=fs.readFileSync(path.join(__dirname,'..','public','pt-module.js'),'utf8');

let ok=0,ko=0; const t=(n,c)=>{c?(ok++,console.log('  ✓ '+n)):(ko++,console.log('  ✗ '+n));};

// Un faux navigateur : les collections sont des globales, comme dans PILOT.
const G={};
global.window=G;
function poser(etat){
  Object.keys(etat).forEach(k=>{ global[k]=etat[k]; G[k]=etat[k]; });
}
poser({patients:[],deliveries:[],preps:[],renouvellements:[],renouvArchives:[],
       credits:[],locations:[],bpmList:[],smsLog:[],controles:[],retours:[]});
eval(src);
const {ptClef,ptNaiss,ptRattacher,ptBalayer,ptDoublons,ptNomDeTexte}=G;
const idx=()=>{ const m=new Map(); global.patients.forEach(p=>{const c=ptClef(p.nom,p.prenom); if(!m.has(c))m.set(c,[]); m.get(c).push(p);}); return m; };

console.log('\nPATIENTS — l\'identité avant l\'agrégation\n');
console.log('La clé');
t('casse et accents se rejoignent', ptClef('Müller','Jérôme')===ptClef('MULLER','JEROME'));
t('les espaces parasites ne créent pas de fiche', ptClef('  DUPONT ',' Marie ')===ptClef('DUPONT','Marie'));
t('une apostrophe ne scinde plus la fiche', ptClef("O'Brien",'Sean')===ptClef('O BRIEN','Sean'));
t('un prénom composé reste distinct du simple', ptClef('MARTIN','Jean-Pierre')!==ptClef('MARTIN','Jean'));
t('deux personnes différentes ne se rejoignent pas', ptClef('MARTIN','Jean')!==ptClef('MARTIN','Jeanne'));

console.log('\nLa date de naissance');
t('les deux écritures donnent la même date', ptNaiss('25/03/1938')===ptNaiss('1938-03-25'));
t('« — » est une absence, pas une valeur', ptNaiss('—')===null && ptNaiss('')===null && ptNaiss(null)===null);

console.log('\nLe rattachement — ce qu’il accepte et ce qu’il refuse');
global.patients=[{id:'pt:A',nom:'MULLER',prenom:'Jérôme',dob:'1950-04-02'}];
G.patients=global.patients;
t('un nom qui correspond à une seule fiche est rattaché',
  ptRattacher({nom:'muller',prenom:'JEROME'},idx()).etat==='sur');
t('la même date confirme', ptRattacher({nom:'MULLER',prenom:'Jérôme',dob:'02/04/1950'},idx()).etat==='sur');
t('une date DIFFÉRENTE bloque, même à nom unique',
  ptRattacher({nom:'MULLER',prenom:'Jérôme',dob:'1961-01-01'},idx()).etat==='ecart');
t('un nom absent de l’annuaire n’invente rien',
  ptRattacher({nom:'INCONNU',prenom:'Paul'},idx()).etat==='inconnu');
t('un nom vide ne rattache pas', ptRattacher({nom:'',prenom:''},idx()).etat==='inconnu');

console.log('\nLes homonymes — le cas qui compte');
global.patients=[{id:'pt:1',nom:'MARTIN',prenom:'Jean',dob:'1940-05-05'},
                 {id:'pt:2',nom:'MARTIN',prenom:'Jean',dob:'1972-11-30'}];
G.patients=global.patients;
let v=ptRattacher({nom:'MARTIN',prenom:'Jean'},idx());
t('SANS date, deux homonymes ne sont JAMAIS départagés', v.etat==='homonyme');
t('... et les deux candidats sont proposés', v.candidats.length===2);
v=ptRattacher({nom:'MARTIN',prenom:'Jean',dob:'1972-11-30'},idx());
t('AVEC la date, le bon est désigné', v.etat==='sur' && v.patient.id==='pt:2');
v=ptRattacher({nom:'MARTIN',prenom:'Jean',dob:'1999-01-01'},idx());
t('une date qui ne colle à aucun reste un doute', v.etat==='homonyme');

console.log('\nL’agrégation');
global.patients=[{id:'pt:T',nom:'THOMAS',prenom:'Liliane',dob:'1938-03-25'},
                 {id:'pt:1',nom:'MARTIN',prenom:'Jean',dob:'1940-05-05'},
                 {id:'pt:2',nom:'MARTIN',prenom:'Jean',dob:'1972-11-30'}];
global.deliveries=[{id:1,nom:'THOMAS',prenom:'Liliane',date:'2026-09-10',lieu:'Domicile',status:'done',notes:'Alèses'},
                   {id:2,nom:'MARTIN',prenom:'Jean',date:'2026-09-11',lieu:'EHPAD',status:'wait'}];
global.preps=[{id:9,nom:'thomas',prenom:'LILIANE',dob:'1938-03-25',date:'2026-09-12',type:'realisation',prep:'Gélules'}];
global.smsLog=[{id:5,nom:'THOMAS',prenom:'Liliane',date:'2026-09-13T09:00:00Z',text:'Votre commande est prête'}];
global.controles=[{id:7,patient:'THOMAS Liliane',patientRef:{nom:'THOMAS',prenom:'Liliane'},date:'2026-08-01',num:12,serie:'X1'}];
Object.keys(global).forEach(k=>{ if(Array.isArray(global[k])) G[k]=global[k]; });

const r=ptBalayer();
const chrono=r.parPatient.get('pt:T')||[];
t('la fiche réunit livraison, préparation, SMS et contrôle', chrono.length===4);
t('la casse différente n’a pas scindé la fiche', chrono.some(e=>e.type==='preparation'));
t('la chronologie est du plus récent au plus ancien',
  chrono[0].type==='sms' && chrono[chrono.length-1].type==='controle');
t('la livraison d’un homonyme N’EST PAS attribuée au hasard',
  !(r.parPatient.get('pt:1')||[]).length && !(r.parPatient.get('pt:2')||[]).length);
t('... elle part dans la file « à rattacher », avec ses deux candidats',
  r.aRattacher.length===1 && r.aRattacher[0].etat==='homonyme' && r.aRattacher[0].candidats.length===2);

// L'identifiant posé à la saisie court-circuite tout : c'est la seule voie
// qui ne peut pas se tromper, et celle vers laquelle on veut aller.
global.deliveries.push({id:3,nom:'MARTIN',prenom:'Jean',patientId:'pt:2',date:'2026-09-12',lieu:'Domicile',status:'wait'});
G.deliveries=global.deliveries;
const r2=ptBalayer();
t('un enregistrement portant patientId est rattaché sans ambiguïté',
  (r2.parPatient.get('pt:2')||[]).length===1);
t('... et ne passe pas par la file', r2.aRattacher.length===1);

console.log('\nLes doublons de l’annuaire');
global.patients=[{id:'a',nom:'MULLER',prenom:'Jérôme',dob:'1950-04-02'},
                 {id:'b',nom:'Muller',prenom:'jerome',dob:'1950-04-02'},
                 {id:'c',nom:'MARTIN',prenom:'Jean',dob:'1940-05-05'},
                 {id:'d',nom:'MARTIN',prenom:'Jean',dob:'1972-11-30'}];
G.patients=global.patients;
const dbl=ptDoublons();
t('deux saisies de la même personne sont signalées comme doublon',
  dbl.some(g=>g.nature==='doublon probable' && g.fiches.length===2));
t('deux homonymes de dates différentes ne sont PAS un doublon',
  dbl.some(g=>g.nature==='homonymes distincts'));
t('rien n’est fusionné d’office', global.patients.length===4);

console.log('\nLe texte libre');
t('« THOMAS Liliane » se sépare au premier espace',
  ptNomDeTexte('THOMAS Liliane').nom==='THOMAS' && ptNomDeTexte('THOMAS Liliane').prenom==='Liliane');
t('un prénom composé reste entier', ptNomDeTexte('NDAO Papa Demba').prenom==='Papa Demba');

console.log('\nLes alias — ce qui rend une fusion utile');
// Sans alias, fusionner deux fiches ne ramene pas l'historique : il est
// rapproche PAR LE NOM. C'est le point qui fait la difference entre un outil
// de fusion reel et un outil cosmetique.
global.patients=[{id:'pt:M',nom:'MARTIN',prenom:'Marie',dob:'1970-01-01',
                  alias:[{nom:'DUPONT',prenom:'Marie'}]}];
global.deliveries=[{id:20,nom:'DUPONT',prenom:'Marie',date:'2026-03-01',lieu:'Domicile',status:'done'},
                   {id:21,nom:'MARTIN',prenom:'Marie',date:'2026-09-01',lieu:'Domicile',status:'done'}];
['preps','renouvellements','renouvArchives','credits','locations','bpmList','smsLog','controles','retours']
  .forEach(k=>{ global[k]=[]; G[k]=global[k]; });
G.patients=global.patients; G.deliveries=global.deliveries;
const ra=ptBalayer();
t('l’historique saisi sous le nom de jeune fille remonte sur la fiche fusionnée',
  (ra.parPatient.get('pt:M')||[]).length===2);
t('... et rien ne part dans la file', ra.aRattacher.length===0);

// Un alias ne doit pas non plus faire fusionner n'importe qui.
global.patients.push({id:'pt:D',nom:'DUPONT',prenom:'Marie',dob:'1990-05-05'});
G.patients=global.patients;
const rb=ptBalayer();
t('un vrai homonyme du nom aliasé redevient un doute, il n’est pas avalé',
  rb.aRattacher.length===1 && rb.aRattacher[0].etat==='homonyme');

console.log('\n'+ok+' réussi(s), '+ko+' échec(s)\n');
process.exit(ko?1:0);
