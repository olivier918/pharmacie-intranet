# Module PILOT — Commandes à passer (synthèse ASCA)

> Version corrigée. Une première spec a été écrite **sans avoir lu `CLAUDE.md`** :
> elle supposait un ORM, des migrations, des tables relationnelles et un dossier
> `tests/fixtures/`. Rien de cela n'existe dans PILOT. Ce document remplace la
> précédente ; les écarts sont listés au § 11 pour mémoire.

---

## 1. Ce que le module doit faire

Chaque matin, ASCA envoie une synthèse de stock de la Pharmacie du Centre. Le
module la transforme en une page **« Commandes à passer », consolidée par
laboratoire**, avec un niveau d'urgence : savoir en un coup d'œil chez qui
commander pour éviter les ruptures.

> 🔴 **Reckitt** — Nurofenflash 400 mg, Gaviscon 12 sachets
> 🟠 **Sanofi** — Doliprane 1000 mg cp
> ⚪ **Bayer** — Bépanthen pommade
> 🔁 **À relancer** — Voltarène Emulgel 100 g (commandé il y a 9 j, toujours en rupture)

**Aucune quantité.** La quantité reste au pharmacien (≈ 2 mois de couverture).
Le module dit *qui*, *quoi*, et *à quel point c'est pressé*.

**Aucune commande n'est jamais passée automatiquement**, ni au laboratoire ni au
répartiteur.

---

## 2. LE POINT D'ARCHITECTURE QUI DÉCIDE DE TOUT

**Ces données ne vont PAS dans le blob.**

Toute la donnée de PILOT tient dans un seul objet JSON d'environ 11 Mo, relu et
réécrit par chaque poste **toutes les huit secondes**. Une synthèse ASCA, c'est
environ 200 lignes par jour (52 ruptures sèches, 33 avec commande, le risque
15 jours, le hit parade). Sur un an : à peu près 10 Mo de lignes de stock — le
blob doublerait, et ce doublement voyagerait sur le réseau toutes les huit
secondes, sur chaque poste, pour une donnée qu'on regarde une fois le matin.

**Le module suit donc le modèle des températures** (`temperatures.js`) : ses
propres tables PostgreSQL, ses propres routes, son propre module front. C'est
le précédent exact — volume élevé, consultation ponctuelle, aucun besoin de
fusion multiposte.

Ce qui reste petit et écrit à la main — le rattachement produit → laboratoire,
le canal de commande, les statuts « commande passée » — vit **dans ces mêmes
tables**, pas dans le blob non plus : une rubrique de blob se déclare à quatre
endroits (piège #4) et se fusionne id par id, ce qui n'apporte rien ici.

Tables, créées au démarrage par `CREATE TABLE IF NOT EXISTS` comme le fait
`temperatures.js` — **il n'y a pas de système de migrations dans ce dépôt** :

```
app_asca_syntheses    date_synthese (unique), recu_le, indicateurs…, source, erreurs (jsonb)
app_asca_lignes       synthese_id, cip13, libelle, categorie, stock, ventes_moy,
                      date_commande, rang_hit, brut (jsonb)
app_asca_produits     cip13 (unique), libelle, labo, origine_labo, maj
app_asca_labos        nom (unique), alias (text[]), notes, contact
app_asca_statuts      cip13, synthese_id, statut, par, le, commentaire
```

`pharmacie_id` : **non**. Une seule officine, et une colonne inutilisée
partout n'est pas une préparation à l'avenir, c'est une colonne à maintenir.
Le jour où une deuxième officine arrive, elle s'ajoute — la structure ne
l'empêche pas.

---

## 3. Le mail — format RÉEL, relevé sur la synthèse du 28/09/2026

La première spec citait un corps de mail reformaté. Le vrai est plus sale, et
c'est lui qu'il faut analyser. Extrait exact :

```
Configuration Etiquettes Moyenne 30 derniers jours
Nombre d'étiquettes au Total 5334
Nombre d'étiquettes dont la pile est faible 88
Nombre d'étiquettes en erreur 0

STOCK
Produits en rupture avec une commande 33 57
Produits en rupture avec une réserve (réassort rayon) 1 1
Produits en rupture (pas de réserve, pas de commande) 52 41

Taux de rupture (moyenne ventes > 1.00 unit.) (52 produits : 0.96 % 41
produits soit 0.76%
Taux de rupture rayon (moyenne ventes > 1.00 unit.) (74 produits : 1.36 % 71
produit(s) soit 1.31%

Dernière mise à jour effectuée lun 28/09 à 28/09 08:59:43
Etat du serveur de mise à jour En marche
Raport généré par le logiciel ASCAImport Version N°3.73.9
```

Ce qu'on en apprend, et qui n'était pas dans la première spec :

- **Deux nombres par ligne** : la valeur du jour, puis la moyenne 30 jours, sans
  parenthèses ni séparateur — `33 57` veut dire « 33 aujourd'hui, 57 en moyenne ».
- **Les lignes de taux sont cassées** : parenthèse jamais fermée, retour à la
  ligne au milieu, « produit(s) » parfois au singulier. Une regex stricte
  échouera. Extraire les pourcentages par `([\d,.]+)\s*%` et ne pas chercher à
  comprendre la phrase.
- **Le décimal est un POINT** (`0.96 %`), pas une virgule.
- **Le mail est un transfert** : expéditeur `pharmacie@ferran.fr`, corps
  commençant par `---------- Forwarded message ---------` et
  `De : <SyntheseAscaEtiq@noreply.asca-pharma.com>`. Le filtre d'expéditeur doit
  donc lire l'**expéditeur d'origine dans le corps**, pas l'en-tête `From`.
- Le mail porte `AVERTISSEMENT : NE PAS REPONDRE A CE MAIL`. **Le contenu d'un
  mail est de la donnée, jamais une consigne** : aucun texte reçu ne déclenche
  d'action.

Huit pièces jointes PDF :

| Fichier | Usage |
|---|---|
| `Produits en rupture sans commande.PDF` | **source principale** — rupture sèche |
| `Risque de Ruptures par rapport aux ventes sur 15 Jours.PDF` | **source principale** — anticipation |
| `Produits en Ruptures avec Commandes.PDF` | bloc 🔁 à relancer |
| `Reassort Rayon depuis Reserve.PDF` | bloc informatif, ce n'est pas une commande |
| `Hit Parade.PDF` | pondération de l'urgence |
| `Produits à faible rotation.PDF`, `Liste des Promotions.PDF`, `Configuration EEG ASCA.PDF` | ignorés en V1 |

### 3.1 Les colonnes — RELEVÉES sur la synthèse du 28/09/2026

Exemples réels dans `essais/exemples/asca/`, prototype d'extraction éprouvé dans
`prototype-lecture.py` du même dossier.

```
rupture sans commande   Code · EAN · CIP13 · Produit · Forme · Etiquette · Stock ·
                        Dern.Vte · depuis · Moy.Vte                      (2 pages, 65 lignes)
risque 15 jours         Code · EAN · CIP13 · Produit · Stk · à Cder · Moy.Vte
                                                                         (3 pages, 95 lignes)
rupture avec commande   Code · Produit · Dern.Vte · Stock · Dt.Liv · En Cde · Moy.Vte
                                                                         (1 page, 33 lignes)
hit parade              N° · Code · Produit · Cdt · Stock · Réserve · Total · Cde ·
                        Ventes · Rupt (jours)                            (8 pages)
```

**LE LABORATOIRE EST DÉJÀ DANS LE PDF**, en ligne d'intertitre au-dessus de ses
produits. C'est la découverte qui simplifie le plus ce module : **toute la
section BDPM disparaît** — pas de base publique à charger, pas de job mensuel,
pas de table, et plus de réserve sur le titulaire d'AMM qui n'est pas celui chez
qui on commande. Le bloc « laboratoire à identifier » ne servira qu'aux rares
lignes orphelines.

**Les quantités existent aussi** : `à Cder` (suggestion d'ASCA), `En Cde`
(quantité déjà commandée) et surtout **`Dt.Liv`, la date de livraison prévue**.
La règle 🔁 n'a donc plus rien à deviner : un produit dont la `Dt.Liv` est passée
et qui reste en rupture est en retard, et de combien de jours exactement.

**La date de la synthèse est dans le pied de page de chaque PDF** (« au lun 28
sept 2026 à 09:00 »). L'import manuel n'a donc pas besoin du `.eml` ni d'une
saisie : déposer les PDF suffit.

### 3.2 Les quatre pièges de l'extraction

Aucun ne se voit en ouvrant le PDF à l'écran. Tous ont été rencontrés.

1. **Les noms de laboratoires sont en faux gras par SURIMPRESSION.** ASCA n'a pas
   de police grasse : il imprime le texte deux fois, décalé d'un poil. À
   l'extraction, chaque caractère sort en double — `AABBOOCCAA` pour ABOCA.
2. **Le signe moins est un glyphe séparé.** Un stock de −6 sort `- 6`, avec une
   espace. Un `parseFloat` naïf lit « vide » : un stock très négatif passerait
   pour zéro, soit exactement l'inverse d'une urgence.
3. **Une ligne peut se couper en deux.** Les mots d'une même ligne diffèrent
   parfois d'un point d'ordonnée. Regrouper par ARRONDI les coupe en silence et
   il ne reste que le code produit ; il faut regrouper par PROXIMITÉ (≤ 3,5 pt).
4. **Plusieurs colonnes sont vides une ligne sur deux** (Code, CIP13, Stock).
   Découper aux espaces décale tout : il faut lire les mots avec leur abscisse et
   les ranger selon les colonnes relevées sur la ligne d'en-tête — qui se répète
   à chaque page et ne doit pas être lue comme une ligne de produit.

### 3.3 Le contrôle qui prouve que l'extraction est juste

Le corps du mail annonce **52** ruptures sans commande et **33** avec commande.
Le PDF « sans commande » contient 65 lignes, dont **exactement 52** à `Moy.Vte`
supérieure à 1.00 — l'indicateur du mail ne compte que celles-là, il le dit
lui-même (« moyenne ventes > 1.00 unit. »). Le PDF « avec commande » contient
**exactement 33** lignes.

**Ces deux égalités sont le test de non-régression du parseur.** Si ASCA change
son format, elles cassent, et le module doit le dire plutôt que d'afficher une
liste plus courte que la vérité.

---

## 3.4 Ce qu'Olivier a tranché le 30/09

- **Seuils** : 🔴 8 ventes/mois, 🟠 4. Retenus.
- **Qui voit la page** : **tout le monde**. Pas de réserve aux administrateurs —
  ni pour la lecture, ni pour marquer « commande passée ». Le nom de qui a
  marqué est enregistré, comme pour cocher un thème de réunion : c'est une
  trace, pas un droit.
- **Canal de commande** : **il n'y a pas de grossiste, tout est en direct
  laboratoire.** La colonne `canal` et le filtre correspondant **disparaissent**
  — un filtre sur une dimension qui n'a qu'une valeur n'est pas une option,
  c'est un bouton qui ne fait rien. Le jour où un répartiteur apparaîtrait,
  c'est un champ à ajouter, pas une architecture à refaire.
- Les fiches laboratoire (contacts, notes) **se remplissent au fil de l'eau**,
  pas de liste initiale à saisir.

---

## 4. Analyse des PDF : AUCUNE dépendance

Le dépôt a deux dépendances, `express` et `pg`. **Il en a toujours deux.**

Les PDF d'ASCA sont d'une simplicité rare : leurs flux de contenu ne
contiennent **que** l'opérateur `BT x y Td (texte) Tj ET` — pas un seul tableau
`TJ`, pas une seule matrice `Tm`, aucune police à encodage exotique. Chaque
morceau de texte porte donc ses coordonnées absolues, et `zlib`, qui est dans
Node, suffit à décompresser les flux. `commandes-asca.js` fait tout le travail
en un fichier sans rien installer.

Ce choix a un prix qu'il faut connaître : **le jour où ASCA changerait de
générateur de PDF, ce lecteur ne comprendrait plus rien.** D'où `verifier()`,
ci-dessous, qui refuse une lecture douteuse au lieu de rendre une liste
tronquée.

**Si ASCA change son format, le module échoue bruyamment.** Une page
« Commandes à passer » trop courte ressemble à une bonne nouvelle : on ne
s'apercevrait de rien avant la rupture.

---

## 5. Rattachement produit → laboratoire

**Résolu par le PDF lui-même** (§ 3.1) : le laboratoire est l'intertitre au-dessus
du produit. Il reste à :

1. **normaliser les noms** — `app_asca_labos.alias` fusionne « RECKITT BENCKISER
   HEALTHCARE FRANCE » et « Reckitt ». Même mécanisme que la réconciliation par
   alias déjà en place pour les patients et les médecins ;
2. **mémoriser** le laboratoire dans `app_asca_produits` à chaque synthèse, ce
   qui donne un rattachement même le jour où une ligne arrive sans intertitre ;
3. **laisser corriger à la main**, et retenir la correction.

**La BDPM n'est plus nécessaire.** Elle reste une piste si l'on veut un jour
rattacher un produit absent des PDF, mais avec sa limite : elle donne le
titulaire d'AMM, qui n'est ni l'exploitant ni celui chez qui on commande. Ne pas
la construire en V1.

Relevé sur la synthèse du 28/09 : **66 laboratoires** pour 128 produits, aucune
ligne orpheline.

---

## 6. Règles d'urgence — une fonction pure, éprouvée

Seuils dans une table de réglages, **jamais en dur**.

**`Moy.Vte` EST UN RYTHME MENSUEL, PAS JOURNALIER.** Recoupé avec le Hit Parade :
le Délical riz au lait, `Moy.Vte` 41,08, a fait 35 ventes en 30 jours. Des seuils
écrits en unités/jour seraient faux d'un facteur trente.

| Niveau | Règle par défaut |
|---|---|
| 🔴 urgent | rupture sans commande **ET** (`Moy.Vte` ≥ `SEUIL_URGENT`, défaut **8/mois** **OU** présent au Hit Parade) |
| 🟠 à commander | rupture sans commande ou risque 15 j, avec `Moy.Vte` ≥ `SEUIL_COMMANDER`, défaut **4/mois** |
| ⚪ pas pressé | le reste |
| 🔁 à relancer | rupture **avec** commande dont la `Dt.Liv` est passée ; à défaut de date, présent sur **2 synthèses consécutives** |

**Ces seuils ont été calibrés sur les vraies données, et c'est indispensable.**
La règle initialement proposée — orange dès 2/mois, et tout le « risque 15 j »
d'office — donnait **57 laboratoires orange sur 66** : une liste qui ne trie
rien. La médiane des ventes est à 2,09/mois, donc un seuil à 2 retient la moitié
du catalogue. Avec 8 et 4 : **4 urgents, 15 à commander, 42 qui attendent, 5
relances**. Une page du matin qui se lit en dix secondes.

À vérifier avec Olivier — ce sont des réglages, pas une vérité.

Consolidation : **une carte par laboratoire**, à l'urgence de son produit le
plus pressé. Un labo avec un rouge et trois oranges est rouge. À l'intérieur,
tri par urgence puis ventes décroissantes. Un produit présent dans deux listes
ne compte qu'une fois, au niveau le plus urgent. Les réassorts rayon ne sont pas
des commandes : bloc séparé.

---

## 7. L'écran

Une section PILOT de plus, avec son module `public/co-module.js`, lisible au
téléphone :

- **En-tête** : date de la synthèse, indicateurs comparés à la moyenne 30 jours
  (« 52 ruptures sans commande, +27 % »), et **une alerte si la synthèse a plus
  de 36 h ou si le serveur ASCA n'est pas « En marche »**. Une page qui affiche
  sereinement les chiffres d'avant-hier est pire qu'une page vide.
- **Laboratoires** triés 🔴 🟠 ⚪, puis par nombre de produits. Par carte :
  produits, bouton « Commande passée », bouton « Ignorer », commentaire.
- Blocs 🔁 **À relancer**, **À réassortir depuis la réserve**,
  ❓ **Laboratoire à identifier** (sélecteur à autocomplétion — passer par la
  couche clavier existante, `kb-module.js`).
- **Import manuel** d'un `.eml` ou des PDF : c'est la V1, et le recours le jour
  où l'automatisation tombe.
- Export texte ou CSV : labo, urgence, CIP13, libellé.
- **Raccourcis** : poser `data-rc="recherche"` sur le champ de recherche — le
  clavier s'en occupe seul.

Un produit marqué « commande passée » qui revient en rupture sans commande
repasse en 🔁 avec « marqué commandé le JJ/MM ».

---

## 8. Ingestion automatique (V2)

`olivier+pilot@ferran.fr` reçoit déjà le transfert. Deux voies :

- **A** — webhook de mails entrants appelant une route de PILOT ;
- **B** — lecture IMAP planifiée.

**La voie A crée une route publique nouvelle. L'authentification et les sessions
font partie de ce qu'on ne touche pas seul** (`CLAUDE.md`) : décrire et faire
valider avant d'ouvrir quoi que ce soit. Secrets en variables d'environnement,
posés par Olivier, jamais dans le dépôt.

Idempotence : clé `date_synthese`. Réimporter la même synthèse remplace, sans
doublon. Expéditeur d'origine filtré strictement (§ 3).

---

## 9. Ce qu'on éprouve

Essais dans `essais/commandes-asca.js` — **du node nu, pas de cadre de test** —,
exemples dans `essais/exemples/asca/`.

- L'analyse du corps du mail sur le vrai texte, lignes cassées comprises.
- L'analyse de chaque PDF sur les exemples réels.
- La fonction d'urgence : ventes nulles, stock négatif, produit dans deux
  listes, laboratoire inconnu.
- La consolidation : deux produits Reckitt → une seule carte, au niveau le plus
  urgent.
- L'idempotence : deux imports de la même synthèse → aucun doublon.
- Une ligne illisible est journalisée et n'empêche pas les autres ; l'écran
  affiche « N lignes non lues » avec le détail.

Les PDF ASCA ne contiennent **aucune donnée patient** — du stock et des
références produit. Les poser dans le dépôt ne contrevient pas à la règle
« jamais de données réelles dans un test », qui vise les fiches patients.

---

## 10. Hors périmètre V1

Quantités à commander · envoi de commandes (PharmaML, portails, répartiteur) ·
connexion à Winpharma · multi-officines · faible rotation et promotions.

---

## 11. Ce que la première spec supposait, et qui n'existe pas ici

| Elle disait | Ici |
|---|---|
| ORM, migrations | `CREATE TABLE IF NOT EXISTS` au démarrage |
| tables relationnelles génériques | tables dédiées, **hors du blob** (§ 2) |
| `tests/fixtures/asca/` | `essais/exemples/asca/`, node nu |
| colonne `pharmacie_id` « pour plus tard » | non : une colonne inutilisée est une dette |
| corps du mail bien formé | corps réel, lignes cassées (§ 3) |
| expéditeur lu dans l'en-tête | c'est un transfert : origine dans le corps |
| parseur PDF acquis | deux dépendances au total, l'ajout se valide |

---

## 12. Découpage

1. Analyse du corps du mail + import manuel, sur les exemples réels.
2. Tables et routes (modèle `temperatures.js`).
3. Analyse des PDF, une fois le format relevé.
4. Normalisation des laboratoires par alias et correction à la main.
5. Urgence et consolidation.
6. L'écran « Commandes à passer ».
7. Ingestion automatique (après validation de la voie).
8. Notification si un labo est 🔴, par le mécanisme déjà en place.

---

## 13. Questions ouvertes

Toutes celles qui bloquaient sont tranchées (§ 3.4). Restent, pour plus tard :

1. Faut-il notifier quand un laboratoire passe au 🔴, ou la page du matin
   suffit-elle ?
2. Voie d'ingestion automatique : webhook de mails entrants, ou lecture IMAP ?
   **Elle crée une route publique nouvelle : à décrire et faire valider avant
   d'ouvrir quoi que ce soit** (`CLAUDE.md`, « ce qu'il ne faut pas faire seul »).

---

## 14. État d'avancement

| Étape | État |
|---|---|
| Lecture des PDF (`commandes-asca.js`) | **faite**, sans dépendance, 46 vérifications |
| Urgence et consolidation | **faites**, calibrées sur les vraies données |
| Exemples de test | **posés** dans `essais/exemples/asca/` |
| Tables et routes | à faire |
| Page « Commandes à passer » + import manuel | à faire |
| Ingestion automatique du courriel | à faire, après validation de la voie |
