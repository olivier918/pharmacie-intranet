// Garde-fou de la sortie des images du fichier de donnees.
// La question testee : les deux epoques cohabitent-elles ? Un document signe
// il y a six mois doit rester lisible apres la reprise.
// node essais/images.js
const fs=require('fs'), path=require('path');
const src=fs.readFileSync(path.join(__dirname,'..','public','index.html'),'utf8');
let ok=0,ko=0; const t=(n,c)=>{c?(ok++,console.log('  ✓ '+n)):(ko++,console.log('  ✗ '+n));};

// On extrait les helpers du fichier lui-meme : c'est le code reel qui est eprouve.
const bloc=src.slice(src.indexOf('function estIdImage(v)'), src.indexOf('function tracer(action'));
const ctx={window:{},fetch:async()=>({ok:false})};
const f=new Function('window','fetch', bloc+'; return {estIdImage,imgSrc,imgData,imgDataURL,imgTeleverser,imgPrecharger,_imgCache};');
const H=f(ctx.window, ctx.fetch);

const ID='a'.repeat(32);
const DATA='data:image/png;base64,iVBORw0KGgo=';

console.log('\nIMAGES — un identifiant, pas un contenu\n');
console.log('Reconnaître ce qu’on manipule');
t('un condensat de 32 hexa est un identifiant', H.estIdImage(ID));
t('une adresse data: n’en est pas un', !H.estIdImage(DATA));
t('une chaîne vide non plus', !H.estIdImage('') && !H.estIdImage(null));
t('32 caractères non hexadécimaux non plus', !H.estIdImage('z'.repeat(32)));
t('31 ou 33 caractères non plus', !H.estIdImage('a'.repeat(31)) && !H.estIdImage('a'.repeat(33)));

console.log('\nL’affichage sert les deux époques');
t('un identifiant devient une adresse servie à la demande', H.imgSrc(ID)==='/api/images/'+ID);
t('une image déjà en data: reste telle quelle', H.imgSrc(DATA)===DATA);
t('l’absence d’image ne produit pas d’adresse cassée', H.imgSrc('')==='' && H.imgSrc(null)==='' && H.imgSrc(undefined)==='');

console.log('\nLes PDF : rien, plutôt qu’un document qui plante');
t('sans préchargement, un identifiant ne rend rien', H.imgData(ID)==='');
H._imgCache.set(ID, DATA);
t('après préchargement, il rend le contenu', H.imgData(ID)===DATA);
t('une signature archivée en data: passe sans préchargement', H.imgData(DATA)===DATA);
t('pas de signature, pas de tentative', H.imgData('')==='' && H.imgData(null)==='');

console.log('\nLe dépôt ne perd jamais l’original');
(async function(){
  // Serveur en panne : imgTeleverser doit rendre la valeur d'origine, pas ''.
  const rendu=await H.imgTeleverser(DATA);
  t('si le dépôt échoue, l’image d’origine est conservée', rendu===DATA);
  t('ce qui n’est pas une adresse data: ressort inchangé', (await H.imgTeleverser(ID))===ID);
  t('une valeur vide ne devient pas « undefined »', (await H.imgTeleverser(''))==='');

  console.log('\nLe code lui-même');
  t('plus aucune interpolation directe de s.photo dans un style',
    !/background-image:url\('\$\{s\.photo\}'\)/.test(src));
  t('jsPDF ne reçoit plus rec.sig brut',
    !/addImage\(rec\.sig/.test(src)
    && !/addImage\(rec\.sig/.test(fs.readFileSync(path.join(__dirname,'..','public','dp-module.js'),'utf8')));
  t('la reprise relit avant de remplacer',
    /const relu=await imgDataURL\(id\);[\s\S]{0,200}s\[c\.champ\]=id/.test(src));
  t('la reprise est réservée aux administrateurs',
    /async function reprisePhotosSignatures\(\)\{\s*\n\s*if\(!isAdmin\(\)\)/.test(src));

  console.log('\n'+ok+' réussi(s), '+ko+' échec(s)\n');
  process.exit(ko?1:0);
})();
