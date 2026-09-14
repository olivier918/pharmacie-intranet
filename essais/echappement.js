// Garde-fou du constat #17. À relancer après toute modification d'une
// autocomplétion : node essais/echappement.js
const fs=require('fs');
const path=require('path');
const SRC=path.join(__dirname,'..','public','index.html');
const src=fs.readFileSync(SRC,'utf8');
let ok=0,ko=0; const t=(n,c)=>{c?(ok++,console.log('  ✓ '+n)):(ko++,console.log('  ✗ '+n));};

// L'echappeur, extrait du fichier lui-meme.
const ligne=src.match(/function hEsc\(s\)\{[^\n]*\}/)[0];
const hEsc=new Function(ligne+'; return hEsc;')();

console.log('\nÉCHAPPEMENT — constat #17\n');
console.log('L\'échappeur');
t('les cinq caractères dangereux sont couverts',
  hEsc(`&<>"'`)==='&amp;&lt;&gt;&quot;&#39;');
t('un nom en apostrophe passe sans casser', hEsc("O'Brien")==='O&#39;Brien');
t('une adresse en guillemets ne peut plus fermer un attribut',
  hEsc('Résidence "Les Tilleuls"').indexOf('"')<0);
t('une balise devient du texte', hEsc('<img src=x onerror=alert(1)>').indexOf('<')<0);
t('null et undefined ne produisent pas « null »', hEsc(null)==='' && hEsc(undefined)==='');
t('les accents sont laissés intacts', hEsc('Éloïse Müller-Käfer')==='Éloïse Müller-Käfer');
t('un chiffre reste lisible', hEsc(42)==='42');
// Le pire cas reel : un nom qui ferme l'attribut et en ouvre un autre.
const hostile='x" onmouseover="alert(1)';
t('la charge qui sortait de l’attribut est neutralisée',
  ('<div title="'+hEsc(hostile)+'">').match(/"/g).length===2);

console.log('\nLe code lui-même');
t('plus aucun échappement de chaîne JavaScript là où il faut du HTML',
  !/replace\(\/'\/g,\s*"\\\\'"\)/.test(src));
t('l’échappeur est déclaré une seule fois', (src.match(/function hEsc\(s\)\{/g)||[]).length===1);
t('ctlEsc n’est plus qu’un alias', /const ctlEsc = hEsc;/.test(src));

// La regle qui compte : un gestionnaire ne recoit qu'un nombre ou un
// identifiant, jamais une chaine saisie par quelqu'un.
const suspects=[];
const re=/on(?:click|mousedown|change|input)="([a-zA-Z_$][\w$]*)\(([^"]*)\)"/g;
let m;
while((m=re.exec(src))!==null){
  const args=m[2];
  // Autorise : litteraux, concatenations d'identifiants techniques, indices.
  if(/esc\(|hEsc\(|\$\{(?!i\})[a-z]+\.(nom|prenom|adresse|commune|tel|lib|titre)/.test(args)) suspects.push(m[1]+'('+args+')');
}
t('aucun gestionnaire ne reçoit de texte saisi par un opérateur',
  suspects.length===0 || (console.log('    → '+suspects.join('\n    → ')),false));

// Les six autocompletions passent bien par un indice.
const parIndice=(src.match(/FillPatient\('\+i\+'\)|fillP\(\$\{i\}\)|fillPatient\(\$\{i\}\)|fillMedecin\(\$\{i\}\)/g)||[]).length;
t('les huit autocomplétions passent un indice, jamais un nom', parIndice===8);
const tableaux=(src.match(/Res(Patients|Medecins)=m;/g)||[]).length;
t('... et gardent toutes leurs résultats en mémoire', tableaux===8);

console.log('\n'+ok+' réussi(s), '+ko+' échec(s)\n');
process.exit(ko?1:0);
