// LES OFFRES — l'affiche publique, éprouvée en marche.
// node essais/offres.js
//
// CE QUI SE JOUE. Un lien part dans six cents SMS. Il n'est plus rattrapable :
// on ne peut ni le corriger, ni le retirer, ni savoir qui l'ouvrira et quand.
// Trois propriétés doivent donc tenir pour toujours, et ce fichier les garde.
//
//   1. LE LIEN NE MEURT PAS. Trois semaines plus tard, il répond encore —
//      l'image de veille, pas une page morte ni une remise périmée.
//   2. LA PAGE EST PUBLIQUE. Montée AVANT le portail : un patient n'a pas de
//      session. Si quelqu'un la déplaçait après, le lien renverrait l'écran de
//      connexion de l'officine à six cents personnes.
//   3. LA PAGE NE PORTE PAS DE SCRIPT. Elle est servie sur le domaine de la
//      pharmacie, et l'affiche vient d'un dépôt de fichier. Pas de script dans
//      la page, pas de SVG dans les types acceptés.
const fs = require('fs'), path = require('path');
const express = require('express');
const of = require('../offres');

let ok = 0, ko = 0;
const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };

// Une base en mémoire, assez fidèle pour les quatre requêtes du module.
function fausseBase(lignes) {
  const T = lignes.slice();
  const ordres = [];
  return {
    T, ordres,
    query: async (sql, p) => {
      const q = String(sql).replace(/\s+/g, ' ').trim();
      ordres.push({ sql: q, p: p || [] });
      if (/^SELECT .* FROM app_offres WHERE code = \$1/i.test(q)) {
        return { rows: T.filter(x => x.code === p[0]) };
      }
      if (/^SELECT .* FROM app_offres/i.test(q)) return { rows: T };
      if (/^UPDATE app_offres SET vues/i.test(q)) {
        const o = T.find(x => x.code === p[0]); if (o) o.vues = (o.vues || 0) + 1;
        return { rows: [], rowCount: o ? 1 : 0 };
      }
      if (/^UPDATE app_offres SET veille = FALSE/i.test(q)) {
        T.forEach(x => { if (x.code !== p[0]) x.veille = false; });
        return { rows: [], rowCount: 0 };
      }
      if (/^INSERT INTO app_offres/i.test(q)) {
        T.push({ code: p[0], titre: p[1], mentions: p[2], mime: p[3], octets: p[4],
                 taille: p[5], empreinte: p[6], largeur: p[7], hauteur: p[8],
                 debut: p[9], fin: p[10], veille: p[11], vues: 0 });
        return { rows: [], rowCount: 1 };
      }
      if (/^UPDATE app_offres SET titre/i.test(q)) {
        const o = T.find(x => x.code === p[0]);
        // Ordre des paramètres : code, titre, mentions, debut, fin, veille, par,
        // puis l'image SEULEMENT si elle accompagne (mime, octets, taille,
        // empreinte, largeur, hauteur).
        if (o) { o.titre = p[1]; o.mentions = p[2]; o.debut = p[3]; o.fin = p[4]; o.veille = p[5];
                 if (p.length > 7) { o.mime = p[7]; o.octets = p[8]; o.empreinte = p[10]; } }
        return { rows: [], rowCount: o ? 1 : 0 };
      }
      if (/^DELETE FROM app_offres/i.test(q)) {
        const i = T.findIndex(x => x.code === p[0]);
        if (i >= 0) T.splice(i, 1);
        return { rows: [], rowCount: i >= 0 ? 1 : 0 };
      }
      return { rows: [], rowCount: 0 };
    }
  };
}

const AFFICHE = { code: 'avene', titre: 'Journee Avene -20%', mentions: 'Hors medicaments.',
  mime: 'image/jpeg', octets: Buffer.from('JPEG'), empreinte: 'abcdef012345xyz',
  largeur: 1024, hauteur: 1536, debut: '2026-10-16', fin: '2026-10-16', veille: false, vues: 0 };
const VEILLE = { code: 'veille', titre: 'Pas d’offre en ce moment', mentions: null,
  mime: 'image/png', octets: Buffer.from('PNG'), empreinte: '999888777666555',
  largeur: 1024, hauteur: 1536, debut: null, fin: null, veille: true, vues: 0 };

async function lancer() {
  console.log('\nLES OFFRES — l’affiche publique\n');

  // ── L'adresse ─────────────────────────────────────────────────────────────
  console.log('L’adresse du lien');
  t('un titre devient une adresse lisible',
    of.normCode('Journée Avène −20 % !') === 'journee-avene-20');
  t('la casse et les accents ne décident de rien', of.normCode('AVÈNE') === 'avene');
  t('les tirets ne s’accumulent pas aux bouts', of.normCode('--avene--') === 'avene');
  t('UN SEGMENT RÉSERVÉ EST REFUSÉ — sans quoi /offre/i/x deviendrait ambigu',
    of.normCode('i') === '' && of.normCode('api') === '' && of.normCode('offre') === '');
  t('une adresse vide est refusée', of.normCode('!!!') === '' && of.normCode('') === '');
  t('elle est bornée en longueur', of.normCode('a'.repeat(99)).length <= of.CODE_MAX);

  // ── Les dates ─────────────────────────────────────────────────────────────
  console.log('\nLe dernier jour est INCLUS');
  t('la veille, l’offre tient', of.enCours(AFFICHE, '2026-10-15') === false);  // debut 16
  t('LE JOUR MÊME, L’OFFRE TIENT', of.enCours(AFFICHE, '2026-10-16') === true);
  t('le lendemain, elle ne tient plus', of.enCours(AFFICHE, '2026-10-17') === false);
  t('... et elle se dit terminée', of.terminee(AFFICHE, '2026-10-17') === true);
  t('elle ne se dit pas terminée avant', of.terminee(AFFICHE, '2026-10-16') === false);
  t('une affiche sans date est toujours en cours',
    of.enCours({ code: 'x' }, '2030-01-01') === true);
  t('la veille n’a pas de date et ne se termine jamais',
    of.enCours(VEILLE, '2099-12-31') === true && of.terminee(VEILLE, '2099-12-31') === false);

  console.log('\nCe que sert l’adresse générale');
  const deux = [{ code: 'a', fin: '2026-10-20', veille: false },
                { code: 'b', fin: '2026-10-16', veille: false }, VEILLE];
  t('la plus proche de sa fin passe devant — c’est celle qu’on perdrait',
    of.choisir(deux, '2026-10-15').code === 'b');
  t('quand tout est terminé, la veille prend le relais',
    of.choisir(deux, '2026-11-01').code === 'veille');
  t('sans veille et sans offre, rien — et surtout pas une erreur',
    of.choisir([], '2026-11-01') === null);

  // ── La page ───────────────────────────────────────────────────────────────
  console.log('\nLa page elle-même');
  const html = of.pageHtml(AFFICHE, { base: 'https://pharmacie-mondeville.fr', code: 'avene' });
  t('AUCUN SCRIPT — la page est servie sur le domaine de la pharmacie',
    !/<script/i.test(html) && !/ on[a-z]+=/i.test(html));
  t('l’aperçu du SMS trouve son image en adresse absolue',
    /<meta property="og:image" content="https:\/\/pharmacie-mondeville\.fr\/offre\/i\/avene\?v=/.test(html));
  t('... et ses dimensions, pour que l’aperçu ne saute pas',
    /og:image:width" content="1024"/.test(html) && /og:image:height" content="1536"/.test(html));
  t('l’affiche porte ses dimensions dans la page aussi',
    /width="1024" height="1536"/.test(html));
  t('le téléphone de la pharmacie est cliquable', /href="tel:\+33231521571"/.test(html));
  t('les mentions de l’astérisque sont là', /Hors medicaments\./.test(html));
  t('la page dit qu’elle ne dépose aucun cookie', /aucun cookie/.test(html));

  const fini = of.pageHtml(VEILLE, { base: 'https://x', code: 'avene', terminee: true });
  t('UN LIEN PÉRIMÉ LE DIT, avant qu’on se déplace', /Cette offre est termin/.test(fini));
  t('... et il montre la veille, pas une page morte', /offre\/i\/veille/.test(fini));
  t('l’adresse générale, elle, ne dit rien de tel',
    !/Cette offre est termin/.test(of.pageHtml(VEILLE, { base: 'https://x' })));

  const rien = of.pageHtml(null, { base: 'https://x' });
  t('sans la moindre affiche, la page tient debout',
    /Pas d’offre en ce moment/.test(rien) && !/og:image/.test(rien));

  console.log('\nL’échappement');
  const mechant = of.pageHtml(
    Object.assign({}, AFFICHE, { titre: '<script>alert(1)</script>', mentions: '" onload="x' }),
    { base: 'https://x' });
  t('un titre ne peut pas injecter de balise', !/<script>alert/.test(mechant));
  t('ni sortir d’un attribut', !/ onload="x/.test(mechant));

  // ── Les types acceptés ────────────────────────────────────────────────────
  console.log('\nCe qu’on accepte comme affiche');
  t('JPEG, PNG et WebP', of.TYPES['image/jpeg'] && of.TYPES['image/png'] && of.TYPES['image/webp']);
  t('PAS DE SVG — un SVG est un document, il porte du script', !of.TYPES['image/svg+xml']);
  t('pas de PDF non plus — une affiche se regarde', !of.TYPES['application/pdf']);

  // ── Les routes publiques ──────────────────────────────────────────────────
  console.log('\nLa page publique, en marche');
  // LES DATES SONT DANS LE PASSÉ, POUR DE BON. Cette partie-là monte la vraie
  // route, qui lit le vrai jour : une affiche datée de la semaine prochaine
  // ferait passer l'essai aujourd'hui et échouer le mois prochain.
  const PASSEE = Object.assign({}, AFFICHE, { debut: '2020-01-10', fin: '2020-01-10' });
  const AVENIR = Object.assign({}, AFFICHE, { code: 'noel', titre: 'Noel',
    debut: '2099-12-01', fin: '2099-12-24' });
  const db = fausseBase([PASSEE, AVENIR, VEILLE]);
  const pub = express();
  of.publiques(pub, { getDb: () => db });
  const s1 = await new Promise(r => { const x = pub.listen(0, () => r(x)); });
  const B = 'http://127.0.0.1:' + s1.address().port;

  let r = await fetch(B + '/offre');
  t('l’adresse générale répond', r.status === 200);
  t('... en HTML', /text\/html/.test(r.headers.get('content-type') || ''));
  t('... et sans cache : une affiche remplacée l’est tout de suite',
    /no-store/.test(r.headers.get('cache-control') || ''));

  const avant = db.T.find(x => x.code === VEILLE.code).vues;
  await fetch(B + '/offre');
  await new Promise(r2 => setTimeout(r2, 40));
  t('l’ouverture est comptée — rien d’autre : ni adresse, ni heure, ni cookie',
    db.T.find(x => x.code === VEILLE.code).vues > avant);

  r = await fetch(B + '/offre/avene');
  let txt = await r.text();
  t('un lien périmé répond 200 et montre la veille',
    r.status === 200 && /Cette offre est termin/.test(txt));
  r = await fetch(B + '/offre/jamais-vu');
  t('un lien inventé répond lui aussi, sans rien révéler',
    r.status === 200 && !/termin/.test(await r.text()));
  // UNE OFFRE À VENIR NE S'ANNONCE PAS. Le lien existe peut-être déjà dans un
  // brouillon de SMS ; tant que le premier jour n'est pas là, la page montre la
  // veille et se tait. Rien ne promet ce qui n'a pas commencé.
  r = await fetch(B + '/offre/noel');
  txt = await r.text();
  t('une offre à venir ne dit rien non plus — ni promesse, ni « terminée »',
    r.status === 200 && !/termin/.test(txt) && /offre\/i\/veille/.test(txt));

  r = await fetch(B + '/offre/i/avene?v=abcdef012345');
  t('l’image est servie', r.status === 200);
  t('... avec son type', r.headers.get('content-type') === 'image/jpeg');
  t('... en interdisant au navigateur de deviner un autre type',
    r.headers.get('x-content-type-options') === 'nosniff');
  t('... et mise en cache pour de bon quand l’empreinte accompagne',
    /immutable/.test(r.headers.get('cache-control') || ''));
  r = await fetch(B + '/offre/i/avene');
  t('sans empreinte, le cache est court — une affiche peut être remplacée',
    /max-age=60/.test(r.headers.get('cache-control') || ''));
  r = await fetch(B + '/offre/i/pas-la');
  t('une image inconnue est un 404 ordinaire', r.status === 404);
  s1.close();

  // ── Les routes d'administration ───────────────────────────────────────────
  console.log('\nQui peut écrire');
  const db2 = fausseBase([]);
  const adm = express(); adm.use(express.json({ limit: '8mb' }));
  let QUI = null, ADMIN = false;
  of.routes(adm, () => db2, { qui: () => QUI, estAdmin: async () => ADMIN });
  const s2 = await new Promise(r2 => { const x = adm.listen(0, () => r2(x)); });
  const A = 'http://127.0.0.1:' + s2.address().port;
  const poster = async (chemin, corps) => {
    const x = await fetch(A + chemin, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps) });
    return { code: x.status, j: await x.json().catch(() => ({})) };
  };
  const img = Buffer.from('affiche').toString('base64');

  t('sans session, on ne lit rien', (await fetch(A + '/api/offres')).status === 401);
  t('sans session, on n’écrit rien',
    (await poster('/api/offres', { code: 'x', titre: 'x', mime: 'image/jpeg', data: img })).code === 401);

  QUI = 'JN';   // une préparatrice : elle lit, elle n’écrit pas
  r = await fetch(A + '/api/offres');
  let j = await r.json();
  t('TOUTE SESSION LIT — le comptoir doit pouvoir donner le lien', r.status === 200 && j.ok);
  // L'ADRESSE DE DIFFUSION VIENT DU SERVEUR. Si elle vivait dans l'écran, un
  // changement de domaine demanderait de reécrire une ligne et de pousser.
  t('... et reçoit l’adresse de diffusion, réglée hors du code',
    Object.prototype.hasOwnProperty.call(j, 'base'));
  t('non réglée, elle vaut null — l’écran retombe sur l’adresse courante',
    j.base === null && of.diffusion() === null);
  process.env.OFFRE_BASE_URL = 'https://offres.pharmacie-mondeville.fr/';
  t('réglée, elle est reprise sans sa barre finale',
    of.diffusion() === 'https://offres.pharmacie-mondeville.fr');
  process.env.OFFRE_BASE_URL = 'offres.pharmacie-mondeville.fr';
  t('une adresse sans protocole est ignorée plutôt que servie de travers',
    of.diffusion() === null);
  delete process.env.OFFRE_BASE_URL;

  // UN SEUL DOMAINE FACE AUX PATIENTS. Celui qui porte deja /r/ et /o/ porte
  // /offre : l'application repond par chemin, pas par nom d'hote. Une affiche
  // ne doit donc coûter aucun domaine personnalise de plus.
  const PAT = 'https://renouvellement.pharmacie-mondeville.fr';
  t('SANS RÉGLAGE PROPRE, ON SE RANGE DERRIÈRE LE DOMAINE PATIENT EXISTANT',
    of.diffusion(PAT) === PAT);
  process.env.OFFRE_BASE_URL = 'https://offres.pharmacie-mondeville.fr';
  t('... et un réglage propre le remplace, le jour où le nom ne convient plus',
    of.diffusion(PAT) === 'https://offres.pharmacie-mondeville.fr');
  delete process.env.OFFRE_BASE_URL;
  t('un domaine patient mal formé ne passe pas davantage',
    of.diffusion('renouvellement.pharmacie-mondeville.fr') === null);

  // Le cablage : server.js doit bien transmettre ce repli, sinon la regle
  // ci-dessus est vraie dans le module et fausse en production.
  const svc = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  t('server.js transmet bien le domaine patient comme repli',
    /basePatients:\s*\(\)\s*=>\s*basePatients\(\)/.test(svc));
  t('... et sait qu’elle ne peut pas écrire', j.redacteur === false);
  t('une non-administratrice se voit refuser l’écriture',
    (await poster('/api/offres', { code: 'x', titre: 'x', mime: 'image/jpeg', data: img })).code === 403);

  QUI = 'OF'; ADMIN = true;
  console.log('\nCe que la route refuse, même à un titulaire');
  t('une affiche sans titre', (await poster('/api/offres',
    { code: 'avene', titre: '', mime: 'image/jpeg', data: img })).code === 400);
  t('une adresse réservée', (await poster('/api/offres',
    { code: 'api', titre: 'X', mime: 'image/jpeg', data: img })).code === 400);
  t('UN SVG', (await poster('/api/offres',
    { code: 'z', titre: 'X', mime: 'image/svg+xml', data: img })).code === 400);
  t('une fin qui précède le début', (await poster('/api/offres',
    { code: 'z', titre: 'X', debut: '2026-10-20', fin: '2026-10-16', mime: 'image/jpeg', data: img })).code === 400);
  t('une création sans affiche', (await poster('/api/offres', { code: 'z', titre: 'X' })).code === 400);

  console.log('\nCe qu’elle accepte');
  let p = await poster('/api/offres', { code: 'Avène -20%', titre: 'Journee Avene -20%',
    debut: '2026-10-16', fin: '2026-10-16', mentions: 'Hors medicaments.',
    mime: 'image/jpeg', data: img, largeur: 1024, hauteur: 1536 });
  t('l’affiche est enregistrée', p.code === 200 && p.j.ok);
  t('... sous l’adresse normalisée', p.j.code === 'avene-20');
  const pose = db2.T.find(x => x.code === 'avene-20');
  t('... avec son empreinte, qui autorisera le cache définitif',
    !!pose && /^[0-9a-f]{16}$/.test(pose.empreinte));
  t('... et l’auteur n’est pas oublié',
    db2.ordres.some(o => /INSERT INTO app_offres/.test(o.sql) && o.p.indexOf('OF') >= 0));

  p = await poster('/api/offres', { code: 'avene-20', titre: 'Journee Avene -20% (reporte)',
    debut: '2026-10-23', fin: '2026-10-23' });
  t('UNE DATE SE CORRIGE SANS REDÉPOSER L’AFFICHE', p.code === 200);
  t('... et l’image est restée', db2.T.find(x => x.code === 'avene-20').octets.length > 0);

  await poster('/api/offres', { code: 'veille-1', titre: 'Veille', veille: true,
    mime: 'image/png', data: img });
  await poster('/api/offres', { code: 'veille-2', titre: 'Autre veille', veille: true,
    mime: 'image/png', data: img });
  t('IL N’Y A JAMAIS DEUX VEILLES', db2.T.filter(x => x.veille).length === 1);
  t('... c’est la dernière désignée', db2.T.find(x => x.veille).code === 'veille-2');

  p = await poster('/api/offres/supprimer', { code: 'veille-1' });
  t('une affiche se supprime', p.code === 200 && !db2.T.some(x => x.code === 'veille-1'));
  s2.close();

  // ── Le montage, lu dans le code ───────────────────────────────────────────
  // CE BLOC NE TESTE PAS UN COMPORTEMENT, IL GARDE UN ORDRE. La page publique
  // ne vaut que si elle est montée avant le portail ; un déplacement innocent
  // la rendrait invisible aux patients, et rien ne le dirait avant les SMS.
  console.log('\nLe montage dans server.js');
  const sv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const iPub = sv.indexOf('offres.publiques(');
  const iGate = sv.indexOf('app.use(auth.gate)');
  const iAdm = sv.indexOf('offres.routes(');
  t('la page publique est montée', iPub > 0);
  t('LE PORTAIL VIENT APRÈS ELLE', iPub > 0 && iGate > iPub);
  t('les routes d’écriture, elles, sont derrière le portail', iAdm > iGate);
  t('les tables sont créées au démarrage', /offres\.preparer\(db\)/.test(sv));
  t('une seule veille est garantie EN BASE, pas seulement dans le code',
    /CREATE UNIQUE INDEX IF NOT EXISTS app_offres_veille/.test(
      fs.readFileSync(path.join(__dirname, '..', 'offres.js'), 'utf8')));

  const ix = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  t('l’écran est chargé par l’application', /<script src="of-module\.js"><\/script>/.test(ix));
  t('... et il relit le serveur à chaque ouverture de la rubrique',
    /name==='offres'&&window\.ofCharger/.test(ix));

  console.log('\n' + ok + ' vérifications, ' + ko + ' échec(s)\n');
  process.exit(ko ? 1 : 0);
}

lancer().catch(e => { console.error('ESSAI INTERROMPU :', e); process.exit(1); });
