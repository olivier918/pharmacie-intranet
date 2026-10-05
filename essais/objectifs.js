// LES OBJECTIFS — l'import, éprouvé en marche.
// node essais/objectifs.js
//
// Ce qui se joue : rapprocher quatorze fiches Word de l'équipe réelle. Un
// import qui avale silencieusement deux fiches sur quatorze est pire qu'un
// import qui échoue — on croit le travail fait. On monte donc la vraie route,
// avec une fausse base qui enregistre ce qu'on lui demande, et on regarde.
const express = require('express');
const rh = require('../rh');

let ok = 0, ko = 0;
const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };

// La fausse base garde la trace de chaque ordre : c'est elle qui dira si
// l'import remplace l'année ou s'il empile.
function fausseBase() {
  const ordres = [];
  return {
    ordres,
    query: async (sql, p) => {
      ordres.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), p: p || [] });
      return { rows: [] };
    }
  };
}

// L'équipe réelle : Mathilde s'appelle ADAM côté intranet et BINET dans son
// document — c'est exactement le genre d'écart qu'on veut voir signalé.
const EQUIPE = [
  { id:'PP', prenom:'Paloma',      nom:'PETIT' },
  { id:'BM', prenom:'Brunilde',    nom:'Marti' },
  { id:'ER', prenom:'Élodie',      nom:'Rivognac' },
  { id:'HL', prenom:'Hervine',     nom:'Lhullier' },
  { id:'CB', prenom:'Céline',      nom:'Bourdon' },
  { id:'QD', prenom:'Quentin',     nom:'Debons' },
  { id:'AB', prenom:'Alexis',      nom:'Baguelin' },
  { id:'JN', prenom:'Julie',       nom:'Nicolas' },
  { id:'JC', prenom:'Jean-Claude', nom:'Tran-Van' },
  { id:'ED', prenom:'Enzo',        nom:'Doré' },
  { id:'MN', prenom:'Marion',      nom:'Noyée' },
  { id:'JP', prenom:'Jules',       nom:'Palvadeau' },
  { id:'AC', prenom:'Allison',     nom:'Courvalet' },
  { id:'MA', prenom:'Mathilde',    nom:'ADAM' }
];

const FICHES = [
  { nom:'PETIT', prenom:'Paloma', intitule:'Assistante administrative',
    missions:['Accueil téléphonique'], referent:['Caisse'],
    annees:[{ annee:2026, objectifs:['Suivi rigoureux de la caisse','Opérations commerciales'],
              bilan:['Bien dans son poste'], formations:[] },
            { annee:2025, objectifs:['Traiter les rejets'], bilan:[], formations:[] }] },
  { nom:'TRAN VAN', prenom:'Jean Claude', intitule:'Préparateur / Coach',
    missions:[], referent:[],
    annees:[{ annee:2026, objectifs:['Animer les briefs'], bilan:[], formations:['Secourisme'] }] },
  { nom:'Doré', prenom:'Enzo', intitule:'', missions:['Supervision du comptoir'],
    referent:[], annees:[] },
  // Celle-ci ne doit PAS passer : son document porte un autre nom que l'équipe.
  { nom:'BINET', prenom:'Mathilde', intitule:'Préparatrice', missions:[], referent:[],
    annees:[{ annee:2025, objectifs:['Rayon bébé'], bilan:[], formations:[] }] }
];

async function lancer() {
  console.log('\nLES OBJECTIFS — l’import\n');

  // ── Le rapprochement des noms ─────────────────────────────────────────────
  console.log('Rapprocher un nom de document avec un nom d’équipe');
  t('les accents ne décident de rien',
    rh.memeePersonne({ nom:'NOYEE', prenom:'Marion' }, { nom:'Noyée', prenom:'Marion' }));
  t('les traits d’union non plus',
    rh.memeePersonne({ nom:'TRAN VAN', prenom:'Jean Claude' }, { nom:'Tran-Van', prenom:'Jean-Claude' }));
  t('la casse non plus',
    rh.memeePersonne({ nom:'bourdon', prenom:'céline' }, { nom:'BOURDON', prenom:'Céline' }));
  t('MAIS UN AUTRE NOM DE FAMILLE EST UNE AUTRE PERSONNE',
    !rh.memeePersonne({ nom:'BINET', prenom:'Mathilde' }, { nom:'ADAM', prenom:'Mathilde' }));
  t('... et un autre prénom aussi',
    !rh.memeePersonne({ nom:'PETIT', prenom:'Paloma' }, { nom:'PETIT', prenom:'Pauline' }));
  t('une fiche vide ne rapproche rien',
    !rh.memeePersonne({ nom:'', prenom:'' }, { nom:'PETIT', prenom:'Paloma' }));

  // ── La route ──────────────────────────────────────────────────────────────
  const db = fausseBase();
  const app = express();
  app.use(express.json({ limit: '4mb' }));
  rh.routes(app, () => db, {
    qui: () => 'OF',
    estAdmin: async () => true,
    codeRH: () => true,
    equipe: async () => EQUIPE,
    noter: () => {}
  });
  const srv = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  const base = 'http://127.0.0.1:' + srv.address().port;

  const poster = async (corps) => {
    const r = await fetch(base + '/api/rh/objectifs-import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corps)
    });
    return { code: r.status, j: await r.json() };
  };

  console.log('\nL’import');
  let r = await poster({ fiches: FICHES });
  t('il répond', r.code === 200 && r.j.ok === true);
  t('trois fiches sur quatre sont rapprochées', r.j.importes === 3);
  t('LA QUATRIÈME EST SIGNALÉE, PAS AVALÉE',
    r.j.inconnus.length === 1 && /Mathilde BINET/.test(r.j.inconnus[0]));
  t('les années sont comptées', r.j.annees === 3);
  t('les lignes aussi', r.j.lignes === 2 + 1 + 1 + 1 + 1);

  const ins = db.ordres.filter(o => /INSERT INTO app_rh_objectifs/.test(o.sql));
  const del = db.ordres.filter(o => /DELETE FROM app_rh_objectifs/.test(o.sql));
  const pos = db.ordres.filter(o => /INSERT INTO app_rh_poste/.test(o.sql));
  t('chaque ligne est posée une fois', ins.length === r.j.lignes);
  t('le poste est enregistré pour chaque personne rapprochée', pos.length === 3);
  t('... y compris celle qui n’a aucun objectif — Enzo n’a qu’une fiche de poste',
    pos.some(o => o.p[0] === 'ED'));

  console.log('\nRéimporter remplace l’année, n’empile pas');
  t('chaque année est vidée avant d’être réécrite', del.length === 3);
  t('... et le vidage précède l’écriture',
    db.ordres.findIndex(o => /DELETE FROM app_rh_objectifs/.test(o.sql))
    < db.ordres.findIndex(o => /INSERT INTO app_rh_objectifs/.test(o.sql)));
  t('le vidage vise bien un collaborateur ET une année',
    del[0].p.length === 2 && typeof del[0].p[1] === 'number');

  console.log('\nCe qui est écrit');
  const types = [...new Set(ins.map(o => o.p[2]))].sort();
  t('les trois natures sont distinguées : objectif, bilan, formation',
    types.join(',') === 'bilan,formation,objectif');
  // Le rang repart a zero POUR CHAQUE ANNEE : c'est l'ordre dans la liste de
  // l'annee, pas un numero d'ordre global.
  t('l’ordre du document est conservé dans le rang',
    ins.filter(o => o.p[2] === 'objectif' && o.p[0] === 'PP' && o.p[1] === 2026)
       .map(o => o.p[3]).join(',') === '0,1');
  t('... et il repart à zéro à chaque année',
    ins.filter(o => o.p[2] === 'objectif' && o.p[0] === 'PP' && o.p[1] === 2025)
       .map(o => o.p[3]).join(',') === '0');
  t('le texte arrive entier', ins.some(o => /Suivi rigoureux de la caisse/.test(o.p[4])));
  t('l’auteur de l’import est enregistré', ins.every(o => o.p[5] === 'OF'));

  console.log('\nCe que la route refuse');
  r = await poster({ fiches: [] });
  t('une liste vide est refusée', r.code === 400);
  r = await poster({});
  t('un corps sans fiches aussi', r.code === 400);

  // SANS L'EQUIPE, ON REFUSE PLUTOT QUE DE RAPPROCHER A L'AVEUGLE.
  const app2 = express(); app2.use(express.json());
  rh.routes(app2, () => fausseBase(), { qui: () => 'OF', estAdmin: async () => true, codeRH: () => true });
  const srv2 = await new Promise(r2 => { const s = app2.listen(0, () => r2(s)); });
  const r2 = await fetch('http://127.0.0.1:' + srv2.address().port + '/api/rh/objectifs-import', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fiches: FICHES })
  });
  t('sans l’équipe, la route refuse au lieu de rapprocher à l’aveugle', r2.status === 503);
  srv2.close();

  console.log('\nL’état d’un objectif');
  const maj = async (corps) => {
    const x = await fetch(base + '/api/rh/objectif-etat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corps) });
    return x.status;
  };
  t('un état inventé est refusé', (await maj({ id: 1, etat: 'génial' })) === 400);
  t('un objectif sans identifiant aussi', (await maj({ etat: 'atteint' })) === 400);
  t('les trois états sont ceux attendus',
    rh.ETATS_OBJ.join(',') === 'en_cours,atteint,abandonne');

  srv.close();
  console.log('\n' + ok + ' vérifications, ' + ko + ' échec(s)\n');
  process.exit(ko ? 1 : 0);
}

lancer().catch(e => { console.error('ESSAI INTERROMPU :', e); process.exit(1); });
