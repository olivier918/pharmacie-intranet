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

## Les huit pièges de ce dépôt

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

### 8. Une collection n'est PAS sur `window`

Les collections sont déclarées avec `let` au premier niveau d'un `<script>`.
Elles vivent dans la **portée lexicale globale** — `typeof deliveries` répond
bien `object`, et un autre `<script>` les voit par leur nom nu — mais **ce ne
sont pas des propriétés de `window`**.

```js
typeof deliveries   // "object"
window.deliveries   // undefined        ← et personne ne le signale
```

Un module qui lit `window['deliveries']` reçoit `undefined`, se croit devant
une liste vide, et **n'a aucune erreur à montrer**. C'est ce qui a vidé les
fiches patients de tout leur historique : les neuf sources d'événements
rendaient zéro, la fiche s'affichait normalement, et rien ne disait qu'il
manquait quelque chose.

**Règle** : un module lit une collection par `window._collRef('<nom>')`, le
résolveur exposé par `index.html`, ou par son nom nu. Jamais par `window`.
`essais/acces-collections.js` garde la règle sur le code source lui-même.

(`pl-core.js` fait exception : il est le noyau de `planning.html`, une autre
page, où c'est lui qui crée les globales avec `window.x = …`.)

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

## Une image, c'est un identifiant — jamais un contenu

Les scans d'ordonnance, puis les photos et signatures des collaborateurs, ont
tous commencé leur vie en base64 **dans le fichier de données**. Celui-ci est
relu EN ENTIER par chaque poste toutes les huit secondes, et recopié dans chaque
instantané d'historique : une image de 14 Ko y coûte mille fois son poids.

Tout contenu va donc dans `app_images`, adressé par le condensat de ses octets,
et la fiche ne garde qu'un identifiant de 32 caractères.

**Les deux époques cohabitent durablement**, et ce n'est pas une transition :
les documents archivés (bons de vaccination, contrôles, retours) portent une
copie de la signature telle qu'elle était au moment de signer. **Un document
signé ne se retouche pas.** Toute lecture passe donc par les helpers :

- `imgSrc(v)` — pour un `<img>` ou un fond CSS : rend une adresse, le navigateur
  met en cache. Sert les deux formes.
- `imgData(v)` — **synchrone**, pour jsPDF, qui ne sait pas aller chercher une
  adresse. Rend une chaîne vide si le contenu n'a pas été préchargé : le
  document part sans signature plutôt que de planter.
- `imgPrecharger(...)` — à appeler **avant** d'entrer dans une fabrique de PDF.
- `imgTeleverser(dataUrl)` — dépose et rend l'identifiant. **Rend la valeur
  d'origine si le dépôt échoue** : mieux vaut une image lourde qu'une image
  perdue.

Toute reprise suit le schéma éprouvé trois fois : **déposer, RELIRE, comparer,
et seulement ensuite remplacer.** Ce qui ne se relit pas à l'identique reste où
il est. `node essais/images.js`.

## L'historique se règle en durée, pas en nombre

`MAX_HISTORY = 300` paraissait généreux. Un instantané est pris à chaque
écriture, au rythme maximal d'un toutes les cinq minutes ; une officine ouverte
dix heures avec dix-huit personnes en produit environ **cent vingt par jour**.
**Trois cents instantanés, c'était deux jours et demi** — cher en place, et
court en couverture. Le pire des deux mondes.

Les scans supprimés le 13/09 ont été retrouvés parce que la perte a été vue le
**lendemain**. Un problème du vendredi découvert le lundi n'aurait plus rien
trouvé.

`maint.elagage()` conserve désormais une **durée**, avec une résolution qui se
relâche en vieillissant : tout sur 6 h, un par heure jusqu'à 2 jours, un par
jour jusqu'à 30, un par semaine jusqu'à 6 mois. Environ **136 instantanés pour
six mois de couverture**, au lieu de 300 pour deux jours et demi.

C'est une fonction **pure** : elle prend la liste des lignes et rend les
identifiants à supprimer. Une règle de rétention qui ne s'éprouve pas est une
perte de données en attente — `node essais/historique.js`.

Deux filets : les douze derniers instantanés survivent quoi qu'il arrive, et
`MAX_HISTORY` reste en borne dure au cas où la règle de temps laisserait tout
passer.

**Pour dimensionner un plan d'hébergement, ne jamais estimer sur la taille du
JSON** : PostgreSQL compresse les colonnes volumineuses. « Où en est-on ? » du
Back Office affiche la place réellement occupée, table par table.

## Une table ne rend pas la place qu'on lui reprend

PostgreSQL ne supprime pas une ligne : il la marque morte et réutilisera peut-être
sa place. Une table qu'on élague tous les jours — l'historique — grandit donc
indéfiniment alors que son contenu vivant ne bouge pas. Le 14/09/2026,
`app_data_history` occupait **2,9 Go pour quelques dizaines d'instantanés**.

Conséquences pratiques, dans l'ordre où elles piègent :

1. **La taille d'une table ne dit pas ce qu'elle contient.** Dimensionner un plan
   d'hébergement sur `pg_total_relation_size` avant compactage, c'est payer pour
   du vide. Le seul chiffre honnête est celui d'après.
2. **Une restauration (`pg_dump` / `pg_restore`) ne recopie que les lignes
   vivantes.** Le ballonnement disparaît donc tout seul lors d'une migration —
   il n'y a pas d'urgence à compacter *pour* migrer, seulement pour rendre de la
   place ici et pour connaître le vrai chiffre.
3. **`VACUUM FULL` prend un verrou exclusif.** Pendant la réécriture, personne ne
   lit ni n'écrit cette table. Sur `app_data`, c'est tout l'intranet qui attend.
   L'opération se déclenche à la main, à une heure creuse — jamais depuis un
   automate, jamais depuis l'élagage.
4. **Elle dure plus longtemps qu'une requête HTTP.** `POST /api/base/compacter`
   répond donc *avant* d'avoir fini, sur une connexion dédiée (pas une place du
   pool immobilisée pendant cinq minutes), et l'écran vient demander où ça en est
   à `GET /api/base/compactage`.

Et un point de sécurité qui ne se voit pas : **un nom de table ne peut pas être
passé en paramètre à PostgreSQL.** Il finit forcément concaténé dans le texte de
la requête. C'est le seul endroit de l'application où une chaîne venue du
navigateur pourrait entrer dans du SQL. La protection est une liste fermée
(`maint.TABLES_COMPACTABLES`), et c'est **la valeur de la liste** qui part dans
la requête, jamais la chaîne reçue. `essais/compactage.js` garde ce point.

## Identité patient : ce qui fait deux fiches, ou une

Douze collections stockent le nom du patient en **texte libre**, recopié à la
saisie. Rapprocher, c'est décider que deux chaînes désignent la même personne —
et l'erreur n'y coûte pas la même chose dans les deux sens :

- une fiche qui **oublie** une livraison se corrige ;
- une fiche qui **attribue** à un patient l'ordonnance d'un autre est une faute
  grave, et invisible, puisqu'elle s'affiche comme un fait.

D'où la règle : **dans le doute, on ne rattache pas, on signale.**

`ptClef()` met à plat ce qui relève de la saisie — casse, accents, apostrophes,
espaces — et rien de plus. Réduire davantage (ignorer un tiret de prénom
composé) ferait fusionner des gens différents.

**La date de naissance est le seul arbitre admis entre homonymes.** Deux MARTIN
Jean nés en 1940 et en 1972 sont deux personnes : `upsertPatient` crée alors
deux fiches, et leurs identifiants portent la date (`pt:MARTIN|JEAN#1940-05-05`).
Sans date, on ne tranche pas — ni pour rattacher, ni pour compléter.

`ptRattacher()` rend quatre verdicts : `sur` (le seul qui autorise l'affichage),
`homonyme`, `ecart` (dates divergentes), `inconnu`. Tout ce qui n'est pas `sur`
part dans la file « À rattacher » du Back Office.

**La voie qui ne peut pas se tromper** : un enregistrement portant `patientId`
court-circuite tout le rapprochement. C'est là qu'il faut aller — le
rapprochement par nom ne sert qu'à lire l'historique déjà saisi.

`node essais/patients.js` et `node essais/annuaire.js`.

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

## Le clavier des listes de suggestion : une couche, pas quinze

`public/kb-module.js` donne les flèches, Entrée, Tab, Échap et F4 à **toutes**
les listes de suggestion du dépôt, sans qu'aucune ne le sache. Il ne connaît
aucune fonction de remplissage : il déclenche sur la ligne surlignée le geste
qu'elle attendait déjà de la souris.

**Ce qu'une nouvelle autocomplétion doit respecter pour en hériter** — c'est le
contrat, et il est déjà celui des quinze existantes :

1. La boîte porte `class="ac-drop"` (ou `rn-drop`, ou `kb-liste`), ou un
   identifiant finissant par `sugg`, `-ac` ou `-drop`.
2. Les lignes choisissables sont les **enfants directs** de la boîte et portent
   leur `onmousedown` (ou `onclick`). Une ligne sans gestionnaire — « Aucun
   patient connu à ce nom » — est du texte : le clavier la saute, comme l'œil.
3. La boîte est à **quatre ancêtres au plus** du champ, et cet ancêtre commun ne
   contient **qu'un seul champ de saisie**. C'est cette seconde condition qui
   empêche une flèche bas tapée dans le champ téléphone de piloter la liste des
   patients restée ouverte deux cases plus haut : dans le doute, le module
   préfère un clavier inerte à un clavier qui remplit la mauvaise case.

**Aucune ligne n'est présélectionnée**, jamais. Ces champs acceptent aussi un
nom *inconnu* — c'est ainsi qu'une fiche se crée. Surligner d'office la première
proposition rattacherait au premier homonyme venu le patient qu'on était en
train de créer, sur une simple touche Entrée.

`node essais/clavier.js` exécute le vrai module contre un DOM de poche : les
deux formes d'imbrication du dépôt, le voisin qui ne doit rien piloter, Entrée
sans surlignage qui laisse valider la saisie, et les touches qu'il ne doit
**pas** détourner (case à cocher, champ date, Ctrl+flèche).

## Un pavé qui s'ouvre doit se voir

`formEnVue(el)` (index.html) remplace `scrollIntoView({block:'start'})` pour les
formulaires : celui-ci alignait le haut du pavé sur le haut de la *fenêtre*,
c'est-à-dire **derrière l'en-tête collant de 64 px** — on ouvrait un pavé dont
le titre et la croix de fermeture étaient cachés. `formEnVue` mesure à l'image
suivante (les champs conditionnels ne sont pas encore posés), pose le pavé sous
l'en-tête et le centre dans la hauteur restante s'il y tient. Il ajoute
`.form-vue` : une ombre qui le soulève au-dessus de la liste de cartes où il se
fondait, et un liseré vert qui s'allume une seconde puis s'éteint.

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

## Le serveur dit tout au démarrage — le lire AVANT de supposer

Nuit du 14 au 15/09/2026 : deux heures de fausses pistes (données écrasées ?
blob régressé ? mauvaise base ?) alors que la réponse était en ligne 12 des
logs du déploiement, depuis le début :

```
📁 Mode fichier local (pas de DATABASE_URL)
🔑 Identite : 0/0 code(s) en empreinte, administrateur par ADMIN_PASSWORD
⛔ AUCUN code ne permet d'ouvrir une session : personne ne pourra se connecter.
```

**Devant une panne d'application, les logs du démarrage passent avant toute
hypothèse.** Ce bandeau existe précisément pour répondre à « sur quoi suis-je
branché et qui peut entrer ». Une session qui propose une explication sans
l'avoir lu fait perdre du temps à tout le monde.

Deux pièges de configuration en découlent, et ils valent au-delà de cet
incident :

- **Une variable de connexion recopiée en dur est une bombe à retardement.**
  `DATABASE_URL` était une copie figée contenant le mot de passe ; la rotation
  de ce mot de passe a cassé l'application. Une référence
  `${{Postgres.DATABASE_URL}}` suit toute seule. Attention : `${{DATABASE_URL}}`
  sans nom de service se pointe elle-même, se résout à VIDE, et ne produit
  aucune erreur.
- **`REQUIRE_DB=1` n'est pas un confort.** Sans elle, une `DATABASE_URL`
  absente ou vide fait démarrer le serveur « avec succès » sur un fichier local
  qui n'existe pas dans le dépôt : zéro collaborateur, zéro empreinte, et le
  mot de passe de secours `ADMIN_PASSWORD` qui donne l'illusion que
  l'application fonctionne. Un serveur qui ne peut pas faire son travail doit
  refuser de démarrer, pas dégrader en silence.

Corollaire pour les écrans : « Code incorrect » disait la vérité et était
parfaitement trompeur. Un message d'erreur qui ne distingue pas « le code est
faux » de « il n'y a aucun code à comparer » envoie chercher au mauvais
endroit. Quand deux causes opposées produisent le même message, il faut un
instrument qui les sépare — ici `outils/reposer-un-code-pin.js --verifier`.

---

## Un seul conteneur : trois états vivent en mémoire

Le serveur suppose aujourd'hui **un seul processus**. Trois choses ne sont ni en
base ni partagées, elles vivent dans la mémoire du conteneur :

| État | Où | Ce qui casse à deux conteneurs |
|---|---|---|
| `sonnetteClients` | `server.js` | Le Raspberry poste l'appui sur **un** conteneur ; seuls les navigateurs connectés à celui-là sont prévenus. La moitié de l'équipe environ ne voit pas la sonnette — sans erreur, sans trace |
| `_echecs` | `identite.js` | La limite d'essais de code PIN devient une limite **par conteneur** : le seuil est de fait doublé |
| `seaux` | `securite.js` | Même chose pour les freins de débit, dont le garde-fou anti-rafale des SMS |

Les sessions collantes n'y changent rien pour la sonnette : c'est le Raspberry
qui tape au hasard, pas un navigateur.

**Avant de passer à deux conteneurs** (bascule Scalingo, mise à l'échelle), il
faut faire transiter ces événements par la base. `LISTEN`/`NOTIFY` de PostgreSQL
suffit et n'ajoute aucune dépendance : chaque conteneur écoute un canal, l'appui
déclenche un `NOTIFY`, chacun sert ensuite ses propres clients SSE.

Corollaire général : **tout nouvel état partagé entre requêtes va en base, pas
dans une `Map` de module.** Un cache de lecture à durée courte (le solde SMS,
`_enVol`) reste acceptable : au pire il est calculé deux fois.

## Plusieurs personnes sur le même enregistrement : une collection à part

`mergeById` remplace un enregistrement **entier** par le plus récemment
modifié. Tant qu'une seule personne à la fois touche un enregistrement, tout va
bien. Dès que plusieurs y écrivent en même temps, le dernier qui enregistre
efface les autres, **sans message et sans trace**.

La question à se poser pour tout nouveau champ : *est-il normal que deux
personnes y touchent dans la même fenêtre de huit secondes ?*

| Cas | Réponse |
|---|---|
| Les messages d'une conversation | Collection `messages`, à part de `convos` |
| Les réactions à un message | Collection `reactions`, une par personne, avec son id |
| Les tâches d'une demande de groupe | Une tâche par personne, reliées par un `lot` |
| Le statut d'une livraison | Sur la livraison : une seule personne la traite |

Un enregistrement par personne, c'est ce qui rend deux gestes simultanés
compatibles. Le coût est une collection de plus à déclarer (piège n° 4) ;
le coût de l'autre choix est une donnée perdue que personne ne voit passer.

⚠️ `c.vu[uid]` (accusés de lecture de la messagerie) n'a **pas** été traité
ainsi : deux lectures simultanées peuvent encore s'écraser. La conséquence —
une pastille de non-lu qui reste allumée — a été jugée supportable. À revoir
si elle devient gênante.

## Un travail à faire n’apparaît que dans UNE liste

Une ordonnance photographiée chez le patient pendant une livraison ouvre un
dossier « € À facturer » dans les renouvellements
(`odLivEnregistrer`). À partir de là, la ligne de livraison sort de la liste
« à facturer » des livraisons : `dAFacturer()` exige
`!d.ordoRecupereeLe`.

Ce n’est pas de l’esthétique. Deux listes pour le même travail, c’est
facturé deux fois le jour où deux personnes y vont, et jamais le jour où
chacune croit que l’autre s’en charge. Quand un module en alimente un autre,
**celui qui alimente se tait**. `essais/livraison-ordo.js` garde ce point.

## Armoires réfrigérées : le manuel est à part

`temperatures.js` (le robot), `temp-alertes.js` (la décision) et
`public/tp-module.js` (l'écran) ont leur propre manuel : **`TEMPERATURES.md`**,
à la racine. Le lire avant d'y toucher — il y a trois choses qu'on ne devine
pas, et chacune a déjà coûté :

1. **L'API de Testo n'est pas garantie** : c'est celle de son interface web,
   pas l'API publique. D'où le principe qui commande tout le reste — *l'absence
   de données est elle-même une alerte*. Une mesure de plus de 45 minutes n'est
   plus une valeur, c'est un silence : tuile grise, tiret, SMS.
2. **Le point de mesure est porté par le GROUPE, pas par la mesure.** Une
   lecture qui cherche un identifiant « quelque part au-dessus » confond les
   quatre armoires en une seule — sans erreur, sans rien : la clé primaire
   écrase 20 relevés sur 28 en silence.
3. **Les mesures ne vont pas dans le blob** : 384 par jour, ~140 000 par an.
   Elles ont leurs tables, et les réglages d'alerte aussi — le robot tourne
   côté serveur, il ne doit pas lire un fichier que chaque poste télécharge
   toutes les huit secondes.

Et une règle d'écriture : **un SMS d'alerte s'écrit sans accents**. Un seul
caractère hors GSM-7 fait tomber la limite de 160 à 70 caractères.

## Vérifier avant de proposer

Il y a désormais des essais, et ils sont la première vérification :

```bash
for f in essais/*.js; do node "$f" || echo "ECHEC $f"; done
```

Ils extraient les fonctions du code réel (jamais une copie qui divergerait) et
portent sur ce qui a déjà mordu : dates, fusion, échappement, images,
raccourcis, préparations, réunion, crédits SMS, accusés, dépôts,
ordonnance récupérée en livraison, preuve de dépôt groupé, groupes de
destinataires, répertoire des laboratoires, réactions, provenance du matériel,
inversion nom/prénom, annuaire des médecins, accès aux collections,
alertes de température. **Toute logique de
tri, de date, de fusion ou de droits nouvelle mérite sa suite.**

Il n'y a pas d'étape de compilation. Au minimum, en plus :

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
