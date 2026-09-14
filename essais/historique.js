// Garde-fou de la retention de l'historique. Une regle de retention qui n'est
// pas eprouvee est une perte de donnees en attente.
// node essais/historique.js
const maint=require('../maintenance');
let ok=0,ko=0; const t=(n,c)=>{c?(ok++,console.log('  ✓ '+n)):(ko++,console.log('  ✗ '+n));};

const T=Date.parse('2026-09-14T18:00:00Z');
const H=3600000, J=24*H;
// Une officine qui ecrit toutes les 5 minutes, dix heures par jour, pendant
// huit mois : c'est le regime reel, pas un cas d'ecole.
const lignes=[]; let id=1;
for(let jour=0; jour<240; jour++){
  for(let min=0; min<600; min+=5){
    lignes.push({id:id++, created_at:new Date(T - jour*J + min*60000 - 600*60000).toISOString()});
  }
}
const garde=new Set(lignes.map(l=>l.id));
maint.elagage(lignes,T).forEach(x=>garde.delete(x));
const restants=lignes.filter(l=>garde.has(l.id)).map(l=>({id:l.id,t:Date.parse(l.created_at)}));
const dans=(h1,h2)=>restants.filter(r=>{const a=(T-r.t)/H; return a>=h1&&a<h2;}).length;

console.log('\nHISTORIQUE — une durée, pas un nombre\n');
console.log('Régime réel : une écriture toutes les 5 min, 10 h/jour, sur 8 mois');
console.log('  ' + lignes.length + ' instantanés pris · ' + restants.length + ' conservés');

t('l’ancien réglage (300) ne couvrait que deux jours et demi',
  Math.round(300/120*10)/10 <= 2.6);
t('le nouveau réglage conserve nettement moins d’instantanés', restants.length < 300);
t('... tout en couvrant six mois', (T-Math.min(...restants.map(r=>r.t)))/J > 150);

console.log('\nLa résolution se relâche en vieillissant');
t('les 6 dernières heures sont conservées intégralement', dans(0,6)>=60);
// Une officine est fermee la nuit : entre 6 h et 48 h en arriere, il n'y a
// d'ecriture que sur les heures ouvrees (4 h de la veille + 10 h de l'avant-
// veille dans ce regime). « Un par heure » veut dire un par heure OU IL S'EST
// PASSE QUELQUE CHOSE — la regle ne fabrique pas d'instantane pour les heures
// creuses, et c'est bien ainsi.
t('entre 6 h et 2 jours : un par heure ouvrée, jamais plus',
  dans(6,48)>=10 && dans(6,48)<=42);
t('entre 2 et 30 jours : environ un par jour', dans(48,24*30)>=20 && dans(48,24*30)<=40);
t('au-delà d’un mois : environ un par semaine', dans(24*30,24*180)>=15 && dans(24*30,24*180)<=30);
t('rien ne subsiste au-delà de six mois', dans(24*180,1e9)===0);

console.log('\nLe cas qui a motivé tout ça');
// Le 13/09, les scans ont ete retrouves parce que la perte a ete vue le
// lendemain. Un probleme du vendredi decouvert le lundi, avec 300 instantanes,
// n'aurait plus rien trouve.
const vendrediDernier=restants.filter(r=>{const a=(T-r.t)/J; return a>=3&&a<4;}).length;
t('un problème vieux de trois jours a encore des instantanés', vendrediDernier>0);
const unMois=restants.filter(r=>{const a=(T-r.t)/J; return a>=28&&a<31;}).length;
t('un problème vieux d’un mois aussi', unMois>0);

console.log('\nLes garde-fous');
t('une base presque vide n’est pas élaguée',
  maint.elagage([{id:1,created_at:new Date(T-H).toISOString()}],T).length===0);
const vieux=Array.from({length:8},(_,i)=>({id:100+i,created_at:new Date(T-400*J-i*H).toISOString()}));
t('même très anciens, les douze derniers survivent toujours',
  maint.elagage(vieux,T).length===0);
t('une date illisible ne fait pas tomber l’élagage',
  maint.elagage([{id:1,created_at:'jamais'},{id:2,created_at:new Date(T).toISOString()}],T).length===0);
t('la fonction ne modifie pas ce qu’on lui passe',
  (()=>{ const l=[{id:1,created_at:new Date(T-400*J).toISOString()}]; maint.elagage(l,T); return l.length===1; })());

console.log('\n'+ok+' réussi(s), '+ko+' échec(s)\n');
process.exit(ko?1:0);
