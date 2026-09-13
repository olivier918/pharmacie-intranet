#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
//  OUVRIR UNE ORDONNANCE — épreuve de la clé
// ─────────────────────────────────────────────────────────────────────────────
//
//  À QUOI SERT CE FICHIER. À prouver, une fois, que la copie papier de la clé
//  rouvre réellement une ordonnance. Pas que l'intranet fonctionne — il
//  fonctionne, il a la clé dans sa configuration. Ce qu'on vérifie ici, c'est
//  que le papier du coffre suffit, SANS l'intranet, SANS la plateforme.
//
//  Une clé dont on ne s'est jamais servi pour restaurer n'est pas une clé,
//  c'est une croyance.
//
//  CE FICHIER VIT AVEC LA CLÉ. Rangez-en une copie imprimée avec le papier du
//  coffre : une clé sans mode d'emploi se retrouve, six ans plus tard, entre
//  les mains de quelqu'un qui ne saura pas quoi en faire.
//
//  Il ne dépend de rien : ni du dépôt, ni d'internet, ni d'un paquet à
//  installer. Node seul suffit.
//
//  USAGE :  node ouvrir-une-ordonnance.js essai-restauration-xxxx.json
//
//  La clé se tape au clavier, à l'invite. Elle n'est JAMAIS passée en argument :
//  la ligne de commande reste dans l'historique du terminal.
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EXT = { 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png',
              'image/webp': '.webp', 'image/heic': '.heic', 'application/pdf': '.pdf' };

function sortir(message) { console.error('\n  ⛔ ' + message + '\n'); process.exit(1); }

// L'empreinte publique d'une clé : quatre octets du condensat de la clé. Elle
// répond à « est-ce la bonne clé ? » sans jamais montrer la clé.
function empreinte(cle) { return crypto.createHash('sha256').update(cle).digest('hex').slice(0, 8); }

function lireCle(saisie) {
  const s = String(saisie || '').trim();
  if (!s) sortir('Aucune clé saisie.');
  let b = null;
  if (/^[0-9a-fA-F]{64}$/.test(s)) b = Buffer.from(s, 'hex');
  else { try { b = Buffer.from(s, 'base64'); } catch (e) { b = null; } }
  if (!b || b.length !== 32) {
    sortir('Clé invalide : 32 octets attendus, ' + (b ? b.length : 0) + ' lus.\n'
      + '     Vérifiez que la ligne a été recopiée entière, sans espace ni retour à la ligne.');
  }
  return b;
}

// Saisie masquée : rien ne doit s'afficher, et rien ne doit rester à l'écran
// derrière quelqu'un qui passe.
function demanderCle() {
  return new Promise((resoudre) => {
    process.stdout.write('  Clé (recopiée du papier du coffre), puis Entrée : ');
    const tty = process.stdin.isTTY;
    if (!tty) {   // entrée redirigée : on lit simplement une ligne
      let tampon = '';
      process.stdin.on('data', (d) => { tampon += d; });
      process.stdin.on('end', () => { process.stdout.write('\n'); resoudre(tampon.split('\n')[0]); });
      return;
    }
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    let saisie = '';
    const surTouche = (c) => {
      if (c === '\r' || c === '\n' || c === '') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', surTouche);
        process.stdout.write('\n');
        return resoudre(saisie);
      }
      if (c === '') { process.stdout.write('\n'); process.exit(130); }     // Ctrl-C
      if (c === '' || c === '\b') { saisie = saisie.slice(0, -1); return; } // effacement
      saisie += c;
    };
    process.stdin.on('data', surTouche);
  });
}

(async () => {
  const fichier = process.argv[2];
  if (!fichier) sortir('Indiquez le fichier exporté.\n     node ouvrir-une-ordonnance.js essai-restauration-xxxx.json');
  if (process.argv[3]) sortir('La clé ne se passe pas en argument : elle resterait dans l\'historique du terminal.\n     Relancez sans, elle sera demandée.');

  let r;
  try { r = JSON.parse(fs.readFileSync(fichier, 'utf8')); }
  catch (e) { sortir('Fichier illisible : ' + e.message); }
  if (!r || !r.id || !r.octets) sortir('Ce fichier n\'est pas un export scellé.');

  console.log('\n  ─────────────────────────────────────────────────────────');
  console.log('  Épreuve de la clé — ' + path.basename(fichier));
  console.log('  ─────────────────────────────────────────────────────────');
  console.log('  Document      : ' + r.id + '   (' + (r.mime || 'type inconnu') + ')');
  if (!r.algo) {
    console.log('\n  Ce fichier n\'est pas chiffré : il n\'y a rien à éprouver.\n');
    process.exit(0);
  }
  console.log('  Scellé avec   : clé d\'empreinte ' + r.marque);
  console.log('');

  const cle = lireCle(await demanderCle());

  // 1. La bonne clé ? On le dit AVANT d'essayer, pour que l'échec soit clair.
  if (empreinte(cle) !== r.marque) {
    sortir('Cette clé n\'est pas celle qui a scellé ce fichier.\n'
      + '     Empreinte attendue : ' + r.marque + '\n'
      + '     Empreinte saisie   : ' + empreinte(cle) + '\n'
      + '     Si une rotation a eu lieu, c\'est la clé PRÉCÉDENTE qu\'il faut ici.');
  }
  console.log('  ✓ La clé correspond bien à ce fichier.');

  // 2. Ouvrir l'enveloppe, puis le fichier.
  let clair;
  try {
    const e = Buffer.from(r.enveloppe, 'base64');
    const octets = Buffer.from(r.octets, 'base64');
    const ivF = e.subarray(0, 12), tagF = e.subarray(12, 28);
    const ivC = e.subarray(28, 40), tagC = e.subarray(40, 56), cleEmballee = e.subarray(56);

    const dC = crypto.createDecipheriv('aes-256-gcm', cle, ivC);
    dC.setAuthTag(tagC);
    const cleFichier = Buffer.concat([dC.update(cleEmballee), dC.final()]);

    const dF = crypto.createDecipheriv('aes-256-gcm', cleFichier, ivF);
    dF.setAuthTag(tagF);
    clair = Buffer.concat([dF.update(octets), dF.final()]);
    cleFichier.fill(0);
  } catch (e) {
    sortir('Le fichier n\'a pas pu être ouvert : ' + e.message
      + '\n     Le contenu est peut-être abîmé — un seul octet modifié suffit à le faire refuser.');
  }
  cle.fill(0);
  console.log('  ✓ Le fichier s\'est ouvert.');

  // 3. La preuve sans image : l'identifiant EST le condensat du contenu en
  //    clair. S'ils coïncident, ce sont bien les octets d'origine, à l'octet
  //    près — pas besoin de croire ses yeux.
  const condensat = crypto.createHash('sha256').update(clair).digest('hex').slice(0, 32);
  if (condensat !== r.id) {
    sortir('Le contenu obtenu ne correspond pas à l\'identifiant du document.\n'
      + '     Attendu : ' + r.id + '\n     Obtenu  : ' + condensat);
  }
  console.log('  ✓ Le contenu obtenu redonne exactement l\'identifiant du document.');

  const sortieFichier = path.join(path.dirname(path.resolve(fichier)),
    'ordonnance-restauree-' + r.id.slice(0, 8) + (EXT[r.mime] || '.bin'));
  fs.writeFileSync(sortieFichier, clair);
  console.log('\n  ─────────────────────────────────────────────────────────');
  console.log('  Épreuve réussie. Ouvrez le fichier et regardez-le :');
  console.log('  ' + sortieFichier);
  console.log('  ─────────────────────────────────────────────────────────');
  console.log('  Puis effacez-le : c\'est une ordonnance en clair sur votre disque.');
  console.log('  rm "' + sortieFichier + '"\n');
})();
