# PILOT — intranet de la Pharmacie du Centre (Mondeville)

> **Exploitation courante** — où est quoi, quelles variables, quelles
> procédures, que faire quand ça va mal : voir **`EXPLOITATION.md`**.
> Ce fichier-ci ne parle que des pièges du code.

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

## Secrets : rien ne sort, rien n'entre

`/api/data` livrait la liste du personnel AVEC les codes PIN, et le mot de passe
administrateur était écrit en clair dans `public/pl-core.js`. Corrigé le
13/09/2026 — voir `identite.js`.

Trois règles en découlent, à ne jamais enfreindre :

1. **Aucun secret ne quitte le serveur.** `identite.sansSecrets()` filtre toute
   réponse contenant `staffDB` ou `ADMIN`. Une nouvelle route qui renvoie l'état
   doit passer par elle.
2. **Aucun secret n'entre.** `identite.sansSecretsEntrants()` jette `pin`,
   `pinHash`, `pinSel` et `ADMIN.pw` reçus d'un client. Sans cela, un poste
   resté sur une ancienne version réinjecterait les codes qu'il détient encore,
   et la fusion champ par champ les remettrait en base.
3. **Un secret ne se vérifie jamais dans le navigateur.** Le code PIN part à
   `/api/session/pin`. Toute comparaison de secret côté client est, par
   construction, une comparaison que l'utilisateur peut lire.

Le freinage de `identite.js` n'est pas un ornement : un PIN à quatre chiffres,
c'est 10 000 combinaisons. Le hachage protège la base en cas de fuite, il ne
protège pas d'un essai en force.

## Un gestionnaire ne reçoit jamais de texte saisi

`onclick="f('…')"` fait lire la même chaîne par **deux analyseurs** : le
navigateur découpe l'attribut HTML, puis JavaScript relit ce qu'il en reste. Il
faut donc satisfaire les deux règles à la fois, et c'est celle qu'on oublie
toujours.

Huit autocomplétions recopiaient ainsi un nom de patient dans leur gestionnaire.
Cinq échappaient l'apostrophe et rien d'autre — de l'échappement de chaîne
JavaScript là où il fallait du HTML ; **trois n'échappaient rien.** Une adresse
du genre `Résidence "Les Tilleuls"` suffisait à sortir de l'attribut.

**Règle : un gestionnaire ne reçoit qu'un identifiant ou un indice.** Les
résultats restent en mémoire (`acResPatients`, `ctlResPatients`, …) et le
gestionnaire va y chercher la ligne. Le nom ne traverse plus jamais le HTML : le
problème disparaît au lieu d'être colmaté.

Pour le texte affiché, un seul échappeur : **`hEsc()`**, qui couvre `& < > " '`.
Pas de version locale — c'est ainsi que cinq variantes divergentes sont nées.

`node essais/echappement.js` vérifie les deux règles sur le fichier lui-même.
C'est ce garde-fou qui a trouvé les trois dernières, invisibles à la recherche
d'un motif d'échappement puisqu'elles n'en avaient aucun.

## Deux questions opposées sur le même ensemble

`imagesReferencees()` et `imagesAttendues()` parcourent le même blob et ne
doivent surtout pas être confondues — l'une a été utilisée à la place de l'autre
le 13/09/2026 au soir, et a annoncé 44 ordonnances perdues qui n'existaient pas.

| | « Que puis-je supprimer ? » | « Que me manque-t-il ? » |
|---|---|---|
| Fonction | `imagesReferencees()` | `imagesAttendues()` |
| Trop large | **sans danger** | invente des pertes, fait paniquer |
| Trop étroit | **efface des ordonnances** | cache une perte réelle |
| Méthode | reconnaît un identifiant à sa **forme**, ratisse tout | liste explicite de champs : `scanId`, `imgId`, `photo`, `sig` |

Une chaîne de 32 caractères hexadécimaux dans une pierre tombale, un journal ou
une archive n'a jamais désigné une image. Le balayeur doit quand même la garder
— le coût d'une erreur n'est pas le même des deux côtés.

**Règle** : avant de réutiliser une fonction de parcours, demander dans quel sens
son erreur coûte cher. Si la réponse diffère de l'usage d'origine, il faut une
seconde fonction, pas un paramètre.

Et un compteur de pertes doit dire **d'où** viennent les manquants
(`locations.renewals.scanId`, `staffDB.photo`…) : un chiffre brut ne dit pas
s'il faut s'inquiéter.

## Chiffrement au repos des ordonnances (`coffre.js`)

Les scans sont chiffrés avant d'être écrits dans `app_images`. La clé
(`SCANS_CLE`) vit dans la configuration de la plateforme, **pas** dans la base :
un export de base seul est inutilisable. Ce que cela ne protège pas : une
application compromise, qui a la clé par construction. Le dire franchement évite
de croire la maison plus sûre qu'elle ne l'est.

Quatre règles :

1. **L'identifiant reste le condensat des octets EN CLAIR**, calculé avant le
   chiffrement. C'est ce qui préserve la déduplication — et la capacité de
   restaurer un scan en réenvoyant les mêmes octets, qui a sauvé 72 ordonnances
   le 13/09/2026.
2. **`algo` nul veut dire « encore en clair ».** Le chemin de lecture sert les
   deux époques ; sans clé, le module est inerte et rien ne change.
3. **Enveloppe.** Chaque fichier a sa propre clé, emballée par la clé maîtresse.
   Une rotation ne réécrit que des clés de 32 octets, jamais les fichiers.
4. **On relit avant de remplacer.** Reprise comme rotation : chiffrer, relire,
   comparer, et seulement ensuite écrire. Un fichier qui ne se relit pas à
   l'identique reste intact — même schéma que la conversion des codes PIN et que
   la sortie des scans du blob.

Rotation : poser la nouvelle `SCANS_CLE`, déplacer l'ancienne dans
`SCANS_CLES_ANCIENNES`, déployer, réemballer depuis le Back Office, puis retirer
l'ancienne **une fois le compteur à zéro**.

**Si la clé est perdue, les ordonnances sont perdues.** Aucune ligne de code ne
couvre ce risque : il se couvre par une deuxième copie de la clé ailleurs, et
par un essai de restauration réellement fait.

## Journal des accès : deux journaux, deux natures

Il y a désormais **deux** journaux, et les confondre serait une faute.

| | Journal d'activité | Journal des accès |
|---|---|---|
| Où | rubrique `journal` du blob | table `app_acces` |
| Écrit par | le navigateur | le serveur (`traces.js`) |
| Fusionné entre postes | oui | non |
| Effaçable | oui | **non** |
| Répond à | « que s'est-il passé dans l'officine ? » | « qui a ouvert la fiche de X, et quand ? » |

Trois règles pour `traces.js` :

1. **L'auteur vient du cookie, jamais du corps de la requête.** Un poste peut
   mentir sur ce qu'il consulte ; il ne peut pas mentir sur qui il est.
2. **Aucune route de suppression ni de modification, pas même pour un
   administrateur.** Un journal qu'on peut nettoyer ne prouve rien, et c'est la
   première chose qu'un contrôle vérifie.
3. **On note l'ouverture, jamais le contenu.** Un journal qui recopie les données
   de santé devient lui-même une donnée de santé à protéger.

`tracer(action, objet, ref, detail)` côté navigateur n'attend jamais la réponse :
le journal accompagne le geste, il ne le retarde pas. Un journal qui bloque le
comptoir serait débranché la semaine suivante.

La règle « administrateur » doit rester **identique** des deux côtés —
`staffIsAdmin()` dans `index.html` et `estAdministrateur()` dans `server.js`, y
compris la reprise sur `OF`/`AF` quand personne n'est encore marqué. Un écart
entre les deux se manifeste par un onglet visible et un 403 incompréhensible.

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
- le journal des accès consigne la nature de la fiche ouverte et sa référence
  interne, jamais le nom du patient ni rien de son contenu ;
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
(`express`, `pg` — et rien d'autre).

`nodemailer` a été retiré le 13/09/2026 : douze avis de sécurité ouverts, aucun
correctif avant une version majeure 10, et un chemin SMTP jamais emprunté puisque
l'officine envoie par l'API Brevo. Les en-têtes de sécurité sont écrits à la main
dans `securite.js` plutôt que délégués à `helmet`, pour la même raison : une
quinzaine d'en-têtes ne justifie pas une dépendance de plus. **Avant d'ajouter un
paquet, se demander ce qu'il fait qu'on ne saurait pas écrire en vingt lignes.**

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
