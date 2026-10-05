// LE SUIVI RH. Ce qui se joue ici : des échéances qui se comptent en années et
// qu'on ne peut pas attendre pour vérifier, et une étanchéité — rien de ce qui
// est écrit sur quelqu'un ne doit partir vers un poste qui n'y a pas droit.
// node essais/rh.js
const R = require('../rh');
const fs = require('fs'), path = require('path');
const rac = path.join(__dirname, '..');
const lire = f => fs.readFileSync(path.join(rac, f), 'utf8');
const src = lire('rh.js');
const ecr = lire('prive/rh-module.js');
const ix = lire('public/index.html');
const pg = lire('public/planning.html');
const sv = lire('server.js');
const core = lire('public/pl-core.js');
const id = lire('identite.js');
const vq = lire('public/vq-module.js');

let ok = 0, ko = 0;
const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };
console.log('\nSUIVI RH — la fiche de chaque collaborateur\n');

// ── L'ÉTANCHÉITÉ ────────────────────────────────────────────────────────────
// C'EST LE POINT QUI JUSTIFIE TOUT LE MODULE. /api/data renvoie le blob ENTIER
// à chaque poste ; le dépôt porte déjà la trace d'un trou de ce genre — « les
// codes de toute l'équipe livrés à chaque poste ». Une appréciation portée sur
// un collègue ne doit pas emprunter ce chemin.
console.log('Rien ne passe par le blob');
t('aucune rubrique RH dans SYNCED_COLLS côté écran',
  !/SYNCED_COLLS=\[[^\]]*rh/i.test(ix));
t('... ni côté serveur',
  !/SYNCED_COLLS[\s\S]{0,900}'app_rh|SYNCED_COLLS = \[[\s\S]{0,900}'rh/i.test(sv));
t('... ni dans ce que la page planning s’autorise à écrire',
  !/PL_COLLS[\s\S]{0,300}rh/i.test(core));
t('le module stocke dans ses propres tables',
  /CREATE TABLE IF NOT EXISTS app_rh_faits/.test(src)
  && /CREATE TABLE IF NOT EXISTS app_rh_entretiens/.test(src)
  && /CREATE TABLE IF NOT EXISTS app_rh_habilitations/.test(src));
t('l’écran ne lit aucune collection du blob, sauf l’annuaire de l’équipe',
  !/_collRef/.test(ecr) && /typeof staffDB/.test(ecr));
// Les données RH ne viennent que de /api/rh. Deux exceptions, et deux seulement :
// ouvrir et refermer la rubrique, qui passent par /api/session/rh — la porte
// appartient à identite.js, qui détient les secrets. Elles ne transportent
// aucune donnée de personne.
t('... et il ne va chercher ses données que sur /api/rh',
  !/fetch\(['"`](?!\/api\/rh|\/api\/session\/rh)/.test(ecr));

// ── LA SECONDE SERRURE ──────────────────────────────────────────────────────
// Être titulaire ne suffit plus : il faut avoir tapé le code de la rubrique.
// Les fiches du personnel ne sont pas le reste du blob — qui peut modifier
// app_data ne doit pas pouvoir s'ouvrir cette porte-là.
console.log('\nLe code de la rubrique');

t('la porte unique exige le code, en plus du titre de titulaire',
  /estAdmin[\s\S]{0,900}code_rh_requis/.test(src));
t('... et refuse quand le vérificateur manque — un oubli ferme, il n’ouvre pas',
  /typeof deps\.codeRH === 'function'\) \? deps\.codeRH\(req\) : false/.test(src));
t('le serveur câble bien la serrure sur le module',
  /codeRH:\s*\(req\)\s*=>\s*identite\.jetonRHValide\(req\)/.test(sv));

t('le code vit dans l’environnement, pas dans la base',
  /process\.env\.RH_CODE/.test(id) && !/RH_CODE/.test(src));
t('... et sans lui la rubrique reste close',
  /code_non_configure/.test(id));
t('le code ne se compare jamais dans le navigateur',
  !/RH_CODE/.test(ecr) && !/RH_CODE/.test(pg));
t('la comparaison passe par des condensats — sinon la durée dit la longueur',
  /createHash\('sha256'\)[\s\S]{0,200}memeEmpreinte/.test(id));
t('les essais en force sont freinés comme à l’ouverture de session',
  /function ouvrirRH[\s\S]{0,300}freine\(req\)/.test(id)
  && /function ouvrirRH[\s\S]{0,900}noterEchec\(req\)/.test(id));

// Ce que la demande visait : que le navigateur ne puisse pas retenir le code.
// autocomplete="off" ne tient pas cette promesse — Chrome et Safari l'ignorent
// sur un champ de type password. Un pavé ne donne rien à retenir.
t('aucun champ de mot de passe : le navigateur n’a rien à enregistrer',
  !/type=["']password["']/.test(ecr) && !/<form/i.test(ecr));
t('les chiffres tapés ne vivent que dans une variable',
  /let saisie = ''/.test(ecr));
t('le jeton ne survit ni au rechargement ni à l’onglet',
  !/\b(local|session)Storage\s*[.[]/.test(ecr) && /let rhJeton = null/.test(ecr));
t('le jeton voyage en en-tête, jamais dans l’adresse',
  /'X-RH-Jeton'/.test(ecr) && !/[?&]jeton=/.test(ecr));
t('il est lié au poste et à l’identité — recopié ailleurs, il ne vaut rien',
  /v\.uid === qui\(req\) && v\.adr === adresse\(req\)/.test(id));
const rhp = lire('prive/rh.html');
t('quitter la page referme la rubrique côté serveur',
  /pagehide[\s\S]{0,160}rhQuitterRubrique/.test(rhp) && /\/api\/session\/rh\/fermer/.test(ecr));
t('... et l’appel survit au départ de la page', /keepalive: true/.test(ecr));
// `rhFermer` ferme la fenetre modale, et ce nom etait deja pris : defini une
// seconde fois pour la rubrique, il ecrasait le premier en silence.
t('... sous un nom qui n’entre en collision avec aucun autre',
  (ecr.match(/window\.rhQuitterRubrique =/g) || []).length === 1
  && (ecr.match(/window\.rhFermer =/g) || []).length === 1);

// ── UNE SEULE PORTE ─────────────────────────────────────────────────────────
// Un module où l'autorisation se vérifie route par route finit par en oublier
// une — et celle-là ne se voit pas : elle répond 200. On vérifie donc CHAQUE
// route déclarée, pas un échantillon.
console.log('\nToutes les routes passent par la même porte');
const routes = [];
const re = /app\.(get|post)\('(\/api\/rh\/[^']*)'[\s\S]*?\n  \}\);/g;
let m;
while ((m = re.exec(src))) routes.push({ verbe: m[1], url: m[2], corps: m[0] });
t('les routes du module sont bien toutes trouvées', routes.length >= 11);

// DEUX ROUTES SORTENT DE LA PORTE, ET C'EST ECRIT ICI PLUTOT QUE DEDUIT. La
// qualification se fait au comptoir, dans l'espace general : y exiger un
// titulaire la rendrait impossible. Elles sont donc nommees une par une, et
// chacune doit prouver ce qui la protege A LA PLACE. Une route qui s'ajouterait
// a cette liste sans y etre nommee fait echouer l'essai -- c'est le but.
const HORS_PORTE = ['/api/rh/vaccination/etat', '/api/rh/qualifier'];
routes.forEach(function (r) {
  if (HORS_PORTE.indexOf(r.url) >= 0) return;
  t(r.verbe.toUpperCase() + ' ' + r.url + ' vérifie le titulaire',
    /const moi = await titulaire\(req, res\); if \(!moi\) return;/.test(r.corps));
});
const horsPorte = routes.filter(function (r) { return HORS_PORTE.indexOf(r.url) >= 0; });
t('les deux routes hors porte sont exactement celles qu’on a nommées',
  horsPorte.length === HORS_PORTE.length);
const etat = horsPorte.find(function (r) { return r.url === '/api/rh/vaccination/etat'; });
const qual = horsPorte.find(function (r) { return r.url === '/api/rh/qualifier'; });
t('l’état « qui peut vacciner » exige au moins une session ouverte',
  /session inconnue/.test(etat.corps));
t('... et il ne rend QUE des dates — aucune réserve, aucun contenu de grille',
  !/reserves/.test(etat.corps) && !/reponses/.test(etat.corps));
t('qualifier exige une session ouverte', /session inconnue/.test(qual.corps));
t('... ET le code du pharmacien, vérifié par le serveur',
  /deps\.signataire\(req, b\.code\)/.test(qual.corps));
t('... qui doit bien être un pharmacien',
  /estPharmacien\(qui2\)[\s\S]{0,120}seul un pharmacien peut qualifier/.test(qual.corps));
t('... et qui ne peut pas se qualifier lui-même',
  /qui2\.id === u[\s\S]{0,120}se qualifier soi-même/.test(qual.corps));
t('le freinage de l’ouverture de session s’applique aussi à la signature',
  /e\.code === 429/.test(qual.corps) && /function signataire[\s\S]{0,400}freine\(req\)/.test(id));
t('la porte refuse une session inconnue par un 401',
  /status\(401\)[\s\S]{0,80}session inconnue/.test(src));
t('... et un opérateur non titulaire par un 403',
  /status\(403\)[\s\S]{0,80}réservé aux titulaires/.test(src));
t('l’autorisation est demandée au serveur, jamais au navigateur',
  /deps\.estAdmin\(req\)/.test(src) && !/req\.body[\s\S]{0,40}admin/.test(src));
// CE N'EST PLUS UN ONGLET CACHE, C'EST UNE PAGE A PART. Masquer en CSS laissait
// le bouton dans le source et surtout faisait TELECHARGER rh-module.js a chaque
// poste ouvrant le planning : aucune donnee ne fuyait, le dispositif etait a nu.
t('le planning ne porte plus une seule mention du suivi RH',
  !/\brh\b/i.test(pg));
t('... et ne télécharge donc plus son module', !/rh-module/.test(pg));
t('le module a quitté public/ : ce qui y est, est servi à tout le monde',
  !fs.existsSync(path.join(rac, 'public', 'rh-module.js'))
  && fs.existsSync(path.join(rac, 'prive', 'rh-module.js')));
t('la page du suivi RH aussi',
  !fs.existsSync(path.join(rac, 'public', 'rh.html'))
  && fs.existsSync(path.join(rac, 'prive', 'rh.html')));
t('le serveur sert /rh depuis prive/, et seulement à un titulaire',
  /app\.get\('\/rh'[\s\S]{0,260}estAdministrateur\(uid\)[\s\S]{0,160}'prive', 'rh\.html'/.test(sv));
t('... et le module par la même garde', /app\.get\('\/rh-module\.js', rhPagePrivee\)/.test(sv));
// ON NE REPOND PAS « ACCES REFUSE » : un refus dit deja qu'il y a quelque chose
// a cet endroit. On laisse tomber dans le 404 ordinaire d'Express.
t('un non-titulaire reçoit le 404 ordinaire, pas un refus qui en dirait trop',
  (sv.match(/if \(!uid \|\| !\(await estAdministrateur\(uid\)\)\) return next\(\);/g) || []).length === 2);
t('l’annuaire voyage avec les fiches, derrière la même porte',
  /annuaire: annuaire, moi: moi/.test(src) && /rhEquipe\.annuaire/.test(ecr));
t('... et il ne porte ni code, ni empreinte, ni photo',
  /\{ id: x\.id, prenom: x\.prenom \|\| '', nom: x\.nom \|\| '',\s*\n\s*poste: x\.poste \|\| '', admin: x\.admin === true \}/.test(src));

// ── CE QUI SE JOURNALISE ────────────────────────────────────────────────────
console.log('\nLe journal des accès');
t('ouvrir une fiche laisse une trace — même règle que la fiche patient',
  /tracer\(moi, 'consultation', u, 'fiche RH'\)/.test(src));
t('remettre le dossier complet aussi', /tracer\(moi, 'export', u, 'dossier RH remis'\)/.test(src));
t('écrire, corriger et retirer laissent une trace',
  /tracer\(moi, 'creation'/.test(src) && /tracer\(moi, 'modification'/.test(src)
  && /tracer\(moi, 'suppression'/.test(src));
t('l’écran d’équipe ne se journalise pas : il ne montre aucun contenu',
  /On ne journalise pas cet ecran/.test(src));
t('le serveur prête au module de quoi journaliser, sans lui confier le journal',
  /noter: \(uid, action, objet, ref, detail\) => traces\.noter/.test(sv));

// ── LES ÉCHÉANCES ───────────────────────────────────────────────────────────
// La loi 2025-989 du 24 octobre 2025 : l'entretien professionnel devient
// l'entretien de parcours, passe de 2 à 4 ans, et le bilan de 6 à 8 ans.
console.log('\nLes échéances légales — réforme du 24/10/2025');
t('l’entretien de parcours se tient tous les 4 ans', R.PARCOURS_ANS === 4);
t('le bilan récapitulatif tous les 8 ans', R.BILAN_ANS === 8);
t('le premier entretien dans l’année qui suit l’embauche', R.PREMIER_AN === 1);

const ech = (ents, emb, auj) => {
  const o = {};
  R.echeances(ents, emb, auj).forEach(function (e) { o[e.type] = e; });
  return o;
};
let e1 = ech([], '2024-03-15', '2026-10-04');
t('jamais d’entretien : le premier est dû un an après l’embauche',
  e1.parcours.du === '2025-03-15');
t('... et il est signalé en retard', e1.parcours.dans < 0);
t('le bilan, lui, se compte en huit ans d’ancienneté', e1.bilan.du === '2032-03-15');

let e2 = ech([{ type: 'parcours', le: '2025-06-01' }], '2020-01-10', '2026-10-04');
t('un entretien tenu repousse l’échéance de quatre ans', e2.parcours.du === '2029-06-01');
t('... et le compte à rebours suit', e2.parcours.dans === R.joursEntre('2026-10-04', '2029-06-01'));
t('le dernier entretien est celui qui compte, pas le premier',
  ech([{ type: 'parcours', le: '2021-02-02' }, { type: 'parcours', le: '2024-09-09' }],
      null, '2026-10-04').parcours.du === '2028-09-09');
t('un entretien d’un autre type ne repousse pas celui-ci',
  ech([{ type: 'point', le: '2026-09-01' }], '2024-03-15', '2026-10-04').parcours.du === '2025-03-15');
t('sans date d’embauche ni entretien, on le dit au lieu d’inventer',
  ech([], null, '2026-10-04').parcours.inconnu === true);

// LE PIÈGE DES DATES : le 29 février n'existe pas trois années sur quatre.
console.log('\nLe 29 février');
t('un 29 février + 4 ans tombe un 29 février', R.plusAns('2024-02-29', 4) === '2028-02-29');
t('... mais + 1 an tombe au 28, pas au 1er mars', R.plusAns('2024-02-29', 1) === '2025-02-28');
t('un entretien tenu un 29 février ne glisse pas d’un jour',
  ech([{ type: 'parcours', le: '2024-02-29' }], null, '2026-10-04').parcours.du === '2028-02-29');

// ── L'ÉQUILIBRE ET LE SILENCE ───────────────────────────────────────────────
console.log('\nL’équilibre, et le silence');
const faits = [
  { le: '2026-09-01', ton: 'positif' }, { le: '2026-09-15', ton: 'corriger' },
  { le: '2026-09-20', ton: 'positif' }, { le: '2026-02-01', ton: 'neutre' }
];
const eq = R.equilibre(faits);
t('on compte par ton', eq.positif === 2 && eq.corriger === 1 && eq.neutre === 1);
t('... et le total suit', eq.total === 4);
t('un ton inventé n’est pas compté', R.equilibre([{ le: '2026-01-01', ton: 'génial' }]).total === 0);

t('le silence se mesure depuis le fait le plus RÉCENT, pas le dernier saisi',
  R.silence(faits, '2026-10-04').dernier === '2026-09-20');
t('... en jours', R.silence(faits, '2026-10-04').jours === 14);
t('quatorze jours, ce n’est pas un silence', R.silence(faits, '2026-10-04').muet === false);
t('trois mois, si', R.silence(faits, '2026-12-25').muet === true);
t('une fiche vide est le silence le plus bruyant',
  R.silence([], '2026-10-04').muet === true && R.silence([], '2026-10-04').dernier === null);
t('le seuil est à 90 jours', R.SILENCE_JOURS === 90);

// ── LA PRÉPARATION DU POINT ─────────────────────────────────────────────────
console.log('\nCe qu’on emporte à l’entretien');
const ents = [{ le: '2026-06-30', type: 'point' }, { le: '2025-01-15', type: 'point' }];
const p = R.aPreparer(faits, ents, '2026-10-04');
t('on repart du DERNIER entretien', p.depuis === '2026-06-30');
t('... donc seuls les faits postérieurs sont repris', p.total === 3);
t('... et celui de février reste dehors',
  p.neutre.length === 0 && p.positif.length === 2 && p.corriger.length === 1);
t('les faits sont rendus dans l’ordre où ils se sont produits',
  p.positif[0].le === '2026-09-01' && p.positif[1].le === '2026-09-20');
t('sans aucun entretien, on reprend tout',
  R.aPreparer(faits, [], '2026-10-04').total === 4);
t('un fait du jour même de l’entretien est déjà réglé — il ne revient pas',
  R.aPreparer([{ le: '2026-06-30', ton: 'positif' }], ents, '2026-10-04').total === 0);

// ── CE QUI PÉRIME ───────────────────────────────────────────────────────────
console.log('\nLes habilitations');
const habs = [
  { libelle: 'Vaccination', echeance: '2026-11-15' },
  { libelle: 'TROD', echeance: '2026-08-01' },
  { libelle: 'DPC', echeance: '2027-06-01' },
  { libelle: 'Diplôme', echeance: null }
];
const due = R.habilitationsDues(habs, '2026-10-04');
t('on alerte deux mois avant', R.PREAVIS_JOURS === 60);
t('... donc celle de novembre sort, pas celle de juin prochain',
  due.length === 2 && due.some(h => h.libelle === 'Vaccination') && !due.some(h => h.libelle === 'DPC'));
t('une habilitation déjà périmée ne disparaît pas de la liste',
  due.some(h => h.libelle === 'TROD' && h.perimee === true));
t('... et elle passe devant, c’est la plus urgente', due[0].libelle === 'TROD');
t('ce qui ne périme pas ne sonne jamais', !due.some(h => h.libelle === 'Diplôme'));

// ── CE QU'ON N'ÉCRIT PAS, ET CE QU'ON RAPPELLE ──────────────────────────────
console.log('\nLe garde-fou de la saisie');
t('le rappel nomme la personne — « un collaborateur » n’engage personne',
  /Si ' \+ E\(rhPrenom\(rhUid\)\) \+ ' demandait son dossier demain/.test(ecr));
t('les catégories interdites sont écrites sous le champ, pas dans une aide',
  /santé, arrêt de travail, grossesse, vie privée/.test(ecr));
t('une ligne de trois mots est signalée comme telle',
  /t\.length < 25/.test(ecr) && /un fait tient rarement en trois mots/.test(ecr));
t('la fiche qui n’a que du négatif le dit — c’est un biais de l’outil',
  /eq\.total >= 5 && eq\.positif === 0/.test(ecr));
t('le silence est écrit en toutes lettres, pas en pastille discrète',
  /il n’y aura rien à dire/.test(ecr));

t('on ne tient pas de fiche sur soi-même',
  /x\.id !== moi/.test(ecr) && /function rhMoi/.test(ecr));
t('le déséquilibre se voit depuis la grille, pas seulement dans la fiche',
  /rh-al-desq/.test(ecr));

console.log('\nLes droits de la personne');
t('corriger un fait est possible — c’est le droit de rectification',
  /\/api\/rh\/fait-modifier/.test(src) && /rhCorriger/.test(ecr));
t('le dossier complet s’édite d’un bouton — sinon on répond mal, ou tard',
  /\/api\/rh\/dossier/.test(src) && /rhDossier/.test(ecr));
t('le vocabulaire des tons est fermé côté serveur',
  /TONS\.indexOf\(b\.ton\) >= 0 \? b\.ton : null/.test(src));
t('... celui des étiquettes aussi', /TAGS\.indexOf\(b\.tag\) >= 0/.test(src));
t('un gestionnaire ne reçoit qu’un indice, jamais du texte saisi',
  /onclick="rhCorriger\(' \+ i \+ '\)/.test(ecr) && /onclick="rhOuvrir\(\\'' \+ E\(s\.id\)/.test(ecr));

console.log('\nHors périmètre, décidé le 04/10/2026');
t('aucun marqueur disciplinaire', !/L\.?1332|disciplinaire|sanction/i.test(ecr.replace(/^.*HORS PERIMETRE.*$/gm, '')));
t('... et le serveur n’en porte pas davantage, sauf pour dire qu’il n’en a pas',
  (src.match(/L\.1332-4/g) || []).length === 1);

console.log('\n' + ok + ' vérifications, ' + ko + ' échec(s)\n');
process.exit(ko ? 1 : 0);
