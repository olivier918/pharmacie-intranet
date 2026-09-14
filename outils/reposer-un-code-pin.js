#!/usr/bin/env node
//
//  REPOSER UN CODE PIN — outil de dernier recours
//  ══════════════════════════════════════════════
//
//  A utiliser quand plus personne ne peut franchir l'ecran du code : le
//  Back Office, qui sert normalement a cela, est derriere ce meme ecran.
//
//  Ce programme ne touche a RIEN. Il calcule une empreinte a partir du code
//  que vous saisissez, et il ecrit a l'ecran la requete SQL a executer
//  vous-meme dans la console de l'hebergeur. Vous voyez exactement ce qui
//  sera fait avant que ce soit fait.
//
//  Le code saisi ne s'affiche pas, ne part nulle part, et ne reste ni dans
//  l'historique du terminal ni dans un fichier. Ce qui sort, c'est une
//  empreinte scrypt et un sel — c'est-a-dire exactement ce que la base
//  contient deja, et dont on ne peut pas remonter au code.
//
//  Usage :  node outils/reposer-un-code-pin.js OF
//           (OF = l'identifiant de la fiche, celui de la colonne `id`)
//
//  Aucune dependance : tout vient de Node lui-meme.
//
const crypto = require('crypto');

function sortir(m) { console.error('\n  ⛔ ' + m + '\n'); process.exit(1); }

// Memes parametres que identite.js. S'ils divergent, l'empreipreinte calculee
// ici ne voudra rien dire pour le serveur — c'est le seul point a surveiller
// si un jour ces valeurs changent la-bas.
const N = 16384, r = 8, p = 1;
function empreinte(pin, sel) {
  return crypto.scryptSync(String(pin), sel, 32, { N: N, r: r, p: p }).toString('hex');
}

// Entree redirigee (essais automatises) : on lit tout une seule fois, puis on
// sert les lignes. Se rebrancher sur `end` a la deuxieme question ne rendrait
// jamais la main — le flux est deja termine.
let _lignes = null;
function lignesRedirigees() {
  if (_lignes) return _lignes;
  let t = '';
  try { t = require('fs').readFileSync(0, 'utf8'); } catch (e) { t = ''; }
  _lignes = t.split('\n');
  return _lignes;
}

function demander(invite) {
  return new Promise((resoudre) => {
    process.stdout.write(invite);
    if (!process.stdin.isTTY) {
      const l = lignesRedirigees().shift();
      process.stdout.write('\n');
      return resoudre(l === undefined ? '' : l.trim());
    }
    process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding('utf8');
    let saisie = '';
    const surTouche = (c) => {
      if (c === '\r' || c === '\n') {
        process.stdin.setRawMode(false); process.stdin.pause();
        process.stdin.removeListener('data', surTouche);
        process.stdout.write('\n'); return resoudre(saisie);
      }
      if (c === '') { process.stdout.write('\n'); process.exit(130); }
      if (c === '' || c === '\b') { saisie = saisie.slice(0, -1); return; }
      saisie += c;
    };
    process.stdin.on('data', surTouche);
  });
}

(async () => {
  // ── Mode verification ────────────────────────────────────────────────────
  // Repond a UNE question : le code que j'ai en tete correspond-il a ce que la
  // base contient ? Sans navigateur, sans serveur, sans rien ecrire. C'est ce
  // qui separe « je me suis trompe de code » de « l'application ne lit pas
  // cette base » — deux pannes identiques a l'ecran, opposees dans les faits.
  //
  //   node outils/reposer-un-code-pin.js --verifier <pinSel> <pinHash>
  //
  // Le sel et l'empreinte ne sont pas des secrets : ils sont deja en base, et
  // on ne remonte pas d'eux au code.
  if (process.argv[2] === '--verifier') {
    const sel = String(process.argv[3] || '').trim();
    const hash = String(process.argv[4] || '').trim();
    if (!/^[0-9a-f]{32}$/.test(sel) || !/^[0-9a-f]{64}$/.test(hash)) {
      sortir('Usage : node outils/reposer-un-code-pin.js --verifier <pinSel> <pinHash>\n'
        + '     Les deux valeurs se lisent en base, elles ne sont pas secretes.');
    }
    const code = await demander('  Code a verifier : ');
    const calcule = empreinte(code, sel);
    if (calcule === hash) {
      console.log('\n  \u2705 CE CODE CORRESPOND a ce que contient la base.');
      console.log('     Si l\'ecran le refuse quand meme, ce n\'est pas le code :');
      console.log('     c\'est que l\'application ne lit pas cette base-la.\n');
      process.exit(0);
    }
    console.log('\n  \u274c Ce code NE correspond PAS a ce que contient la base.');
    console.log('     Reposez-en un : node outils/reposer-un-code-pin.js <fiche>\n');
    process.exit(1);
  }

  const fiche = String(process.argv[2] || '').trim();
  if (!fiche) sortir('Indiquez l\'identifiant de la fiche.\n     node outils/reposer-un-code-pin.js OF');
  if (!/^[A-Za-z0-9_-]{1,16}$/.test(fiche)) sortir('Identifiant de fiche inattendu : ' + fiche);
  if (process.argv[3]) sortir('Le code ne se passe pas en argument : il resterait dans l\'historique du terminal.');

  console.log('\n  Nouveau code pour la fiche « ' + fiche +' ».\n  Rien ne s\'affichera pendant la saisie.\n');
  const a = await demander('  Code (EXACTEMENT 4 chiffres) : ');
  // QUATRE, pas cinq. Le serveur accepte de 4 a 8 chiffres, mais le pave de
  // l'ecran d'accueil n'en saisit que quatre et part tout seul au quatrieme
  // (`if(pinStr.length===4) checkPin()` dans public/index.html). Un code plus
  // long est donc parfaitement valide en base et INSAISISSABLE a l'ecran.
  // Cet outil a fait perdre une heure une nuit pour cette raison exacte.
  if (!/^\d{4}$/.test(a)) sortir('Le code doit faire EXACTEMENT 4 chiffres : c\'est tout ce que le pave de l\'ecran sait saisir.');
  const b = await demander('  Le meme, pour verifier : ');
  if (a !== b) sortir('Les deux saisies different. Rien n\'a ete calcule.');

  const sel = crypto.randomBytes(16).toString('hex');
  const hash = empreinte(a, sel);

  // Verification immediate : on relit ce qu'on vient d'ecrire. Un outil de
  // secours qui n'eprouve pas son propre resultat ne vaut rien.
  if (empreinte(a, sel) !== hash) sortir('Verification interne echouee. N\'utilisez pas ce resultat.');

  const sql =
    "UPDATE app_data\n" +
    "SET data = jsonb_set(data, '{staffDB}', (\n" +
    "  SELECT jsonb_agg(\n" +
    "    CASE WHEN e.s->>'id' = '" + fiche + "'\n" +
    "      THEN (e.s - 'pin') || '{\"pinHash\":\"" + hash + "\",\"pinSel\":\"" + sel + "\"}'::jsonb\n" +
    "      ELSE e.s END\n" +
    "    ORDER BY e.ord)\n" +
    "  FROM jsonb_array_elements(data->'staffDB') WITH ORDINALITY AS e(s, ord)))\n" +
    "WHERE id = 1;";

  console.log('\n  ✅ Empreinte calculee. Le code lui-meme n\'est nulle part.\n');
  console.log('  Executez ceci dans la console SQL de l\'hebergeur :\n');
  // La console web de Railway mange le premier caractere de chaque collage.
  console.log('  (console web : commencez la selection a la fin de la ligne de tirets,');
  console.log('   le retour a la ligne sera mange a la place du U de UPDATE)\n');
  console.log('─'.repeat(72));
  console.log(sql);
  console.log('─'.repeat(72));
  console.log('\n  Cette requete ne modifie que la fiche « ' + fiche + ' », et seulement ses');
  console.log('  deux champs de code. Toutes les autres fiches sont recopiees telles quelles.');
  console.log('  Aucun redemarrage n\'est necessaire : le serveur relit la base a chaque essai.\n');
})();
