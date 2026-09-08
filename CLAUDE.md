# PILOT — intranet de la Pharmacie du Centre (Mondeville)

Outil de travail quotidien d'une officine : livraisons, préparations, crédits,
caisse, renouvellements d'ordonnances, planning, messagerie, boîte à idées.
Une dizaine de personnes s'en servent en même temps, sur plusieurs postes.

**Ce n'est pas un projet d'entraînement.** Les données sont réelles et de santé.
Une régression ne casse pas un test : elle fait perdre une ordonnance, un crédit
ou une livraison à un patient. Dans le doute, ne pas modifier — signaler.

---

## Architecture en une page

Node + Express (`server.js`), PostgreSQL en production, fichier JSON en local.
Front en JavaScript natif, sans framework ni build. Hébergé sur Railway.

| Fichier | Rôle |
|---|---|
| `server.js` | API, fusion multiposte, authentification, envois mail/SMS |
| `auth.js` | Portail d'accès (mot de passe commun) + session |
| `maintenance.js` | Purges de rétention, instantanés d'historique |
| `public/index.html` | **≈ 690 Ko** — l'application principale, HTML + CSS + JS en un seul fichier |
| `public/xx-module.js` | Modules autonomes qui s'injectent dans l'application |
| `public/planning.html` + `pl-core.js` + `pl-module.js` | Le planning, page indépendante |
| `public/renouv.html` | Page patient de confirmation de renouvellement |

Modules injectés : `rn-` renouvellements · `cm-` commande de monnaie · `dp-`
dépannages · `fc-` formulaires · `dm-` boîte à idées · `pl-` planning.

**Toute la donnée tient dans un seul objet JSON** (le « blob »), lu par
`GET /api/data` et réécrit par `POST /api/data`. Il pèse environ 11 Mo.

---

## Les sept pièges de ce dépôt

Chacun a déjà causé une perte de données en production. Les lire avant d'écrire
une ligne.

### 1. Toute mutation doit estampiller `updatedAt`

Le serveur fusionne les collections **enregistrement par enregistrement**, et
départage deux versions d'un même `id` par leur `updatedAt`. Un enregistrement
modifié sans nouvel `updatedAt` sera écrasé par la copie d'un autre poste.

```js
d.statut = 'acceptee';
d.updatedAt = Date.now();   // jamais facultatif
```

### 2. `window.maCollection = …` ne met pas la variable à jour

Les collections sont des `let` de portée globale, pas des propriétés de `window`.
Une affectation sur `window` crée une propriété homonyme que personne ne lit, et
la variable réelle ne bouge pas. Muter en place (`push`, `splice`, `unshift`) ou
affecter le nom nu.

### 3. `toISOString()` donne la veille

Sur une `Date` à minuit locale, `toISOString().split('T')[0]` renvoie le jour
précédent en heure de Paris. Ce défaut a décalé cinq endroits du code. Formater
le calendrier local :

```js
const p = n => String(n).padStart(2, '0');
const iso = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
```

### 4. Une nouvelle rubrique doit être déclarée à quatre endroits

Oublier l'un d'eux donne une rubrique qui ne quitte jamais le navigateur — le
symptôme est « ça marche puis ça disparaît au rechargement ».

1. `let maRubrique = []` dans `public/index.html`
2. **le corps de la requête dans `saveAll()`** — c'est une liste écrite en dur
3. `loadAll()` **et** la boucle de resynchronisation de 8 s, qui la relisent
4. `SYNCED_COLLS` dans `server.js` (collections à `id`), ou `CONFIGS_DATEES`
   pour un objet de réglages fusionné par date

### 5. Ne jamais garder une référence d'objet à travers un `await`

La resynchronisation, toutes les 8 secondes, **remplace les collections** par la
copie du serveur (`locations = d.locations`). Une boucle qui garde des
références vers des enregistrements et les modifie après une attente écrit donc
dans des objets orphelins : le travail disparaît sans le moindre message.

Retenir l'identifiant, et retrouver l'enregistrement **après** chaque `await` :

```js
let l = locations.find(x => x.id === locId);   // avant
await fetch(...);
l = locations.find(x => x.id === locId);       // et de nouveau APRÈS
```

Pour une opération longue, geler en plus la resynchronisation avec
`_savePending = true` au début, et enregistrer dans un `finally`. Voir
`repriseScansLocations()`, dont le premier essai a perdu 72 conversions ainsi.

### 6. Les enregistrements ne sont pas envoyés tout de suite

`schedSave()` regroupe les modifications pendant 600 ms. Pour une création ou un
changement d'état — action délibérée, rare, coûteuse à perdre — appeler
`saveNow()`. Ne jamais recharger la page tant que `_savePending` est vrai.

### 7. Une migration de données ne s'écrit pas en base

Les postes ne sont pas tous sur la même version. Une migration écrite est
rejouée par chaque ancien poste et se bat avec elle-même à la fusion. **Traduire
à la lecture** : voir `DM_LEGACY` / `dmEtat()` dans `dm-module.js`, et
`credRelEtape()` dans `index.html`.

---

## Données personnelles

Le blob contient des noms de patients, des adresses, des dates de naissance et
des informations de santé. En conséquence :

- ne jamais ajouter de journalisation qui recopie le contenu d'un enregistrement
  patient, ni côté serveur ni dans la console ;
- les champs lourds ou sensibles sont retirés des instantanés d'historique via
  `HISTORY_STRIP_FIELDS` dans `maintenance.js` — y ajouter tout nouveau champ
  contenant une image ou un document ;
- le journal d'activité consigne l'action, jamais la saisie, et jamais le contenu
  d'un message ;
- ne jamais recopier de données réelles dans un test, un exemple ou un commentaire.

---

## Vérifier avant de proposer

Il n'y a ni test automatisé ni étape de compilation. Au minimum :

```bash
node --check server.js && node --check auth.js && node --check maintenance.js
node --check public/dm-module.js     # et tout module modifié
```

Le JavaScript de `index.html` est en ligne : l'extraire des balises `<script>`
sans `src` et passer `node --check` sur le résultat.

Pour une logique de tri, de date ou de fusion, écrire un petit script Node qui
l'exerce sur des cas construits et montrer la sortie. C'est ainsi qu'ont été
attrapés le décalage de date et la falaise du classement.

Lancer en local : `npm start` (sans `DATABASE_URL`, les données vont dans
`data/`). Ne jamais pointer un développement local sur la base de production.

---

## Style

Français partout : interface, commentaires, messages de commit. Pas
d'anglicismes dans ce qui est vu par l'équipe.

**Les commentaires disent pourquoi, jamais quoi.** Le code dit déjà ce qu'il
fait. Un commentaire utile explique la contrainte qui a imposé cette forme —
souvent un défaut déjà rencontré. Suivre le ton des commentaires existants.

Message de commit : une ligne de titre en français, puis un paragraphe qui
explique le problème constaté et la raison du choix retenu.

Pas de dépendance nouvelle sans nécessité démontrée : trois en tout aujourd'hui
(`express`, `nodemailer`, `pg`).

---

## Ce qu'il ne faut pas faire seul

- toucher à l'authentification, aux sessions ou aux paiements Stripe ;
- modifier la fusion multiposte (`mergeState`, `mergeById`, `applyTombstones`) ;
- changer les durées de rétention ou les purges ;
- renommer une rubrique du blob : la fusion serveur s'appuie sur son nom ;
- supprimer des données sans passer par le mécanisme de suppressions horodatées ;
- réécrire `index.html` en masse — le fichier est énorme et vivant, procéder par
  retouches ciblées.

Sur une demande qui touche à l'un de ces points : décrire ce qu'il faudrait
faire et pourquoi, plutôt que d'ouvrir une pull request.
