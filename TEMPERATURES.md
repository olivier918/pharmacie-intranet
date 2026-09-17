# Suivi des armoires réfrigérées

*Manuel du dispositif. À lire avant de toucher à `temperatures.js`,
`temp-alertes.js` ou `public/tp-module.js`.*

---

## Ce que ce dispositif est, et ce qu'il n'est pas

**Testo reste le système qui fait foi** : sondes étalonnées, certificat,
notifications propres — **qui doivent rester activées**. PILOT apporte une
surveillance *supplémentaire*. Il ne remplace rien, et le jour où les deux se
contredisent, c'est Testo qui a raison.

Deux conséquences qui expliquent presque tout le code :

> **L'API interrogée n'est pas garantie.** C'est celle que l'interface web
> Smart Connect utilise pour elle-même, pas l'API publique documentée. Testo ne
> s'engage sur rien et peut la changer sans préavis.

> **Donc l'absence de données est elle-même une alerte.** Un écran vert sur des
> données figées est plus dangereux que pas d'écran du tout. Partout dans ce
> dispositif, une mesure de plus de 45 minutes cesse d'être une valeur et
> devient un silence — tuile grise, tiret, et SMS.

---

## Les secrets

| Variable | Ce que c'est |
|---|---|
| `SAVERIS_USER` / `SAVERIS_PASS` | Un utilisateur **dédié, en lecture seule**, créé dans Smart Connect pour le robot. Faible pouvoir, révocable en un clic, distinct du compte d'administration. |
| `BREVO_API_KEY` | Déjà en place pour les SMS. Les alertes l'empruntent, elles n'en ont pas d'autre. |

Ils ne transitent jamais par une conversation, ne sont jamais journalisés, et
aucune route ne les renvoie — y compris `/api/temp/diag`, qui raconte pourtant
chaque étape d'un tirage.

Le `client_id` et le `tenant` figurent en clair dans le code : ce sont les
identifiants de l'application web publique de Testo, pas des secrets.

---

## L'authentification

Smart Connect s'appuie sur **Auth0**.

| Élément | Valeur |
|---|---|
| Point d'entrée jeton | `https://login.food.saveris.net/oauth/token` |
| `audience` | `https://food.saveris.net/` |
| Type d'autorisation | `password` |
| Durée de vie | **24 h**, sans jeton de rafraîchissement |

**Un simple en-tête `Authorization: Bearer <access_token>` suffit.** Pas de
cookie, pas de session à entretenir. Testé : le jeton d'accès donne 200, le
jeton d'identité donne 401, les cookies seuls sont refusés par CORS.

C'est ce qui a permis d'écarter Playwright et ses 400 Mo sur Railway.

---

## Le piège qui a coûté le plus cher

Dans la réponse de `/measurements`, **le point de mesure est porté par le
groupe, pas par chaque mesure** :

```json
{ "measurements": [
    { "locations": [{ "uuid": "…", "name": "Frigo 1" }],
      "physical_property": "GENERAL_TEMPERATURE",
      "measurements": [{ "timestamp": "…", "value": 6.09 }, …] } ]}
```

Une lecture qui cherche « un identifiant quelque part au-dessus » confond les
quatre armoires en une seule. **Le symptôme est traître** : les mesures
arrivent, la table se remplit, aucune erreur n'apparaît, et 20 relevés sur 28
sont écrasés en silence par la clé primaire.

`lireGroupes()` lit la forme exacte, avec la lecture défensive gardée en repli.
**L'hygrométrie remonte dans le même flux et doit être écartée**, sans quoi des
pourcentages se mélangent à des degrés.

---

## Les données

Quatre points toutes les 15 minutes : **384 mesures par jour, ~140 000 par an**.
Elles ne vont **pas** dans le blob — celui-ci est relu en entier par chaque
poste toutes les huit secondes.

| Table | Ce qu'elle porte |
|---|---|
| `app_temperatures` | `(point, ts, valeur)`, clé primaire `(point, ts)` — rejouer une plage ne duplique rien |
| `app_temp_tirages` | Chaque interrogation, réussie ou non. **C'est elle qui distingue « le frigo va bien » de « on ne sait plus rien du frigo ».** |
| `app_temp_reglages` | Une seule ligne : armé/éteint, deux numéros d'astreinte, la plage |
| `app_temp_episodes` | Les alertes ouvertes et closes |

Le tirage demande **toujours les deux dernières heures**, pas seulement depuis
le dernier point connu : après une coupure, le trou se comble seul.

**Les réglages sont dans leur propre table, pas dans le blob.** Le robot tourne
côté serveur : il ne doit pas avoir à lire un fichier de données que chaque
poste télécharge. Même choix que l'interrupteur d'ouverture des dépôts.

**L'état des épisodes est en base, pas en mémoire.** Un redémarrage — et il y en
a à chaque déploiement — ne doit ni renvoyer une alerte déjà envoyée, ni oublier
qu'un frigo est en défaut depuis deux heures.

---

## Les alertes

### Quand

| Période (heure de Paris) | Déclenchement |
|---|---|
| **Ouverture** — lundi au samedi, 9 h 00 – 19 h 30 | hors plage sur **3 relevés consécutifs** (45 min) |
| **Fermeture** — nuits et dimanche entier | hors plage dès le **premier relevé** |
| À tout moment | **plus aucun relevé depuis 45 minutes** |

En journée quelqu'un est là : une porte restée ouverte trois minutes ne doit pas
faire sonner un téléphone. La nuit, personne ne passera.

L'heure est **toujours calculée en heure de Paris**. Le serveur tourne en UTC,
et un raisonnement sur « il est 3 h du matin » fait en heure serveur se trompe
d'une ou deux heures selon la saison — c'est-à-dire précisément aux heures qui
décident du régime.

### La plage : 2 – 8 °C, et pourquoi deux seuils

La demande initiale ne portait que sur le haut. **Un frigo qui descend vers
0 °C congèle les vaccins et les détruit** sans qu'aucune alarme de chaleur ne
sonne, et sans que rien ne se voie à l'œil. 2 °C plutôt que 0 °C pour prévenir
avant que le mal soit fait.

### Combien de fois

Un frigo bloqué à 12 °C pendant six heures ne doit pas envoyer vingt-quatre
SMS : ce serait la meilleure façon de faire ignorer le vingt-cinquième.

- **une** alerte au franchissement ;
- **un rappel toutes les deux heures** tant que le défaut dure ;
- **un message au retour** dans la plage ;
- puis silence.

### Une panne du robot ne fait qu'UN SMS

Si plus rien n'arrive, les quatre armoires sont muettes pour une seule cause.
Le robot est donc évalué **en premier**, sur le point `(robot)` ; si la panne
est constatée, les armoires ne sont pas évaluées.

### Le texte des SMS

**Sans accents, volontairement.** Un seul caractère hors GSM-7 fait tomber la
limite de 160 à 70 caractères : le message passe à deux ou trois crédits, et une
alerte à 3 h du matin n'a pas besoin de cédilles.

> `PILOT - Frigo Vaccins : 9.4 C, trop chaud (plage 2-8 C).`

**Aucune donnée de santé n'y figure** : un nom d'armoire et un nombre de degrés.

### Les astreintes

Une **liste**, pas deux cases : l'équipe compte dix-huit personnes et les tours
changent. Chaque ligne porte un nom, un mobile et une case « prévenu ».
Réglée dans l'écran Températures, réservé aux administrateurs. Table
`app_temp_astreintes` ; les deux anciens numéros ont été repris une fois, sous
le drapeau `repris` — sans lui, un redémarrage ressusciterait une astreinte
qu'on vient de retirer.

- **Décocher** une ligne met la personne en pause sans effacer son numéro.
- Un **fixe** est écarté : un SMS sur un fixe ne prévient personne.
- Un numéro **invalide** est refusé à l'enregistrement et rendu à l'écran,
  jamais avalé en silence — croire qu'on a posé une astreinte et n'avoir rien
  posé est exactement le défaut que ce dispositif existe pour éviter.
- Le **même numéro deux fois** ne fait pas deux SMS.
- La liste est **remplacée en entier** à l'enregistrement : il n'existe aucun
  état intermédiaire où la base contiendrait une liste que personne n'a voulue.

**Armer sans aucune astreinte joignable est refusé** : ce serait croire qu'on
surveille. Et retirer la dernière astreinte désarme, plutôt que de laisser
l'écran afficher « armé » sur un dispositif qui ne préviendrait personne.

> Une seule astreinte reste un point unique de défaillance : la nuit, si ce
> téléphone est en silencieux, l'alerte n'existe pas.

### Éteint ≠ aveugle

Alertes éteintes, **les épisodes sont quand même enregistrés** et l'écran les
montre. Seul l'envoi est suspendu. Un dispositif qui n'enregistre rien quand il
est en veille ne sait rien dire le jour où on le rallume.

---

## Le relevé quotidien signé

C'est la trace de la surveillance **humaine** — ce qu'un inspecteur demande, et
ce qui manque au site Testo, qui ne sait dire que ce que les sondes ont mesuré,
jamais que quelqu'un a regardé.

**À l'ouverture de session du premier pharmacien de la journée**, la courbe
depuis la **dernière validation** s'affiche, et il faut signer pour continuer.
Depuis la dernière validation, pas depuis vingt-quatre heures : après un
week-end, c'est le week-end entier qu'on relit, sans quoi le dimanche ne serait
jamais relu par personne.

**Un dépassement non commenté n'est pas un relevé.** Signer une période où un
frigo est monté à 11 °C sans écrire un mot, c'est signer qu'on n'a rien vu. Le
commentaire est donc exigé — par l'écran *et* par le serveur, parce qu'une
règle qui ne tient que dans le navigateur ne tient pas.

Qui est pharmacien : le champ `poste` de la fiche collaborateur, qui doit
commencer par « Pharmacien ». **Si personne n'a ce poste renseigné, la fenêtre
ne s'ouvre jamais** — et personne ne s'en apercevra.

> **Ce qui ne doit pas arriver : bloquer quelqu'un à 8 h 30 parce que le serveur
> a hoqueté.** Si les données ne viennent pas, la fenêtre ne s'ouvre pas du
> tout. Un relevé manqué se rattrape ; un comptoir bloqué, non.

Le second pharmacien du jour n'est pas sollicité : une signature par jour
suffit. Table `app_temp_releves` — qui, quand, sur quelle période, combien de
dépassements, et le commentaire.

## Les routes

| Route | Ce qu'elle fait |
|---|---|
| `GET /api/temp/etat` | Dernières valeurs par point + résultat du dernier tirage |
| `GET /api/temp/mesures?debut=&fin=` | Les mesures d'une plage |
| `GET /api/temp/reglages` | Réglages d'alerte + épisodes ouverts |
| `POST /api/temp/reglages` | Armement et plage — **administrateurs seulement** |
| `POST /api/temp/astreintes` | Remplace la liste des astreintes — **administrateurs seulement** |
| `GET /api/temp/releve` | Dernier relevé signé + dépassements depuis |
| `POST /api/temp/releve` | Signe le relevé — refuse un dépassement non commenté |
| `POST /api/temp/alerte-test` | Force une évaluation — **administrateurs seulement** |
| `POST /api/temp/diag` | Force un tirage et raconte chaque étape. **C'est la route qu'on regarde le jour où plus rien n'arrive.** Ne renvoie jamais d'identifiant. |

---

## Le jour où ça casse

1. **`POST /api/temp/diag`** — elle dit quelle étape échoue : le jeton, la liste
   des points, la variante d'URL, l'écriture.
2. Un **401 sur le jeton** : l'utilisateur dédié a été désactivé, ou son mot de
   passe a changé. Se reconnecter à Smart Connect avec ce compte.
3. Un **404 ou une forme inattendue sur `/measurements`** : Testo a changé son
   API interne. C'est le risque assumé — `lireGroupes()` et `normaliser()` sont
   les deux fonctions à reprendre.
4. **Les mesures arrivent mais une seule armoire apparaît** : c'est le piège du
   point porté par le groupe. Relire la section plus haut.

Pendant tout ce temps, **Testo continue de surveiller et d'alerter de son
côté** : c'est précisément pour cela qu'on ne l'a pas débranché.

---

## Ce qui reste à faire

| Reste | Pourquoi ça compte |
|---|---|
| **Le rapport PDF sur une plage** | La pièce à sortir en inspection : courbes, minima, maxima, durée hors seuils. |
| **La rétention** | 13 mois de brut, puis condensé quotidien (mini, maxi, moyenne, durée hors seuils) sur 5 ans. Rien ne presse — c'est le genre de chose qu'on oublie jusqu'à ce que la table pèse. |
| **Renseigner les astreintes** | Côté organisation, pas côté code : Écran Températures, en bas. |

**Deux réglages à faire chez Testo, hors développement** : les quatre points
partagent le profil « Frigo 1 » (mêmes seuils pour les vaccins et le PDA), et le
groupe de notification ne contient qu'une seule adresse.

---

## Les essais

`essais/temperatures-alertes.js` — 58 vérifications sur le moteur de décision :
le régime selon l'heure de Paris **y compris au changement d'heure**, les seuils
haut *et* bas, le comptage des relevés consécutifs, la donnée périmée qui n'est
jamais « bonne », l'anti-répétition, la panne du robot, et le texte des SMS
(sans accent, un seul segment, aucune donnée de santé).
