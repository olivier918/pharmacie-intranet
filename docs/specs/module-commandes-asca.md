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
app_asca_labos        nom (unique), alias (text[]), canal, notes
app_asca_statuts      cip13, synthese_id, statut, par, le, commentaire
app_asca_bdpm         cip13, titulaire, libelle          (rafraîchie mensuellement)
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

⚠️ **LE FORMAT DES COLONNES DES PDF N'EST PAS CONNU, et il ne faut pas le
deviner.** Première tâche : obtenir 2 ou 3 synthèses réelles, les poser dans
`essais/exemples/asca/`, relever les colonnes (CIP13 ? libellé ? stock ? ventes
moyennes, et par jour ou par mois ? fournisseur ? date de commande ?) et
**documenter le format constaté en tête du module d'analyse**.

De ce relevé dépendent deux choses que rien d'autre ne peut trancher : si une
**colonne fournisseur** existe, le § 5 devient presque inutile ; si la **date de
commande** existe, la règle 🔁 marche du premier jour.

---

## 4. Analyse des PDF : une dépendance à assumer

Le dépôt a **deux dépendances**, `express` et `pg`. Lire un PDF en ajoute une
(`pdf-parse`, ou `pdfjs-dist`). C'est un choix à valider avec Olivier, pas à
faire en passant. Deux règles s'il est validé :

- l'extraction se fait **côté serveur**, jamais dans le navigateur ;
- **si ASCA change son format, le module échoue bruyamment** — une alerte à
  l'écran — plutôt que de produire une liste vide qu'on croira bonne. Une page
  « Commandes à passer » vide ressemble à une bonne nouvelle.

---

## 5. Rattachement produit → laboratoire

Le point difficile. Dans l'ordre :

1. **Colonne fournisseur du PDF**, si elle existe (à vérifier, § 3).
2. **Rattachement déjà connu** dans `app_asca_produits`.
3. **BDPM** (base publique des médicaments) : `CIS_bdpm.txt` et
   `CIS_CIP_bdpm.txt` chargés dans `app_asca_bdpm`, rafraîchis par un job
   mensuel. Pas d'appel réseau à chaque synthèse.
4. Sinon : groupe **❓ Laboratoire à identifier**, assignable en un clic, et le
   choix est mémorisé.

**Réserve honnête sur la BDPM** : elle donne le **titulaire d'AMM**, qui n'est
pas toujours celui chez qui on commande — ni l'exploitant, ni le répartiteur par
lequel la commande passe réellement. Elle sert de premier jet à corriger, pas de
vérité. La parapharmacie et les dispositifs médicaux n'y figurent pas du tout :
pour eux, seules les étapes 1, 2 et 4 existent.

Normaliser les noms par `app_asca_labos.alias` : « RECKITT BENCKISER HEALTHCARE
FRANCE » et « Reckitt » sont un seul laboratoire. C'est le même mécanisme que la
réconciliation par alias déjà en place pour les patients et les médecins.

---

## 6. Règles d'urgence — une fonction pure, éprouvée

Seuils dans une table de réglages, **jamais en dur**.

| Niveau | Règle par défaut |
|---|---|
| 🔴 urgent | rupture sans commande **ET** (ventes ≥ `SEUIL_FORTE_ROTATION`, défaut 1/jour **OU** dans le top `TOP_HIT_PARADE`, défaut 100) |
| 🟠 à commander | risque 15 j, **OU** rupture sans commande avec rotation ≥ `SEUIL_ROTATION_MIN` (défaut 0,2/jour) |
| ⚪ pas pressé | rupture sans commande sous `SEUIL_ROTATION_MIN` |
| 🔁 à relancer | rupture **avec** commande depuis plus de `DELAI_RELANCE_JOURS` (défaut 3) ; date de commande inconnue → présent dans cette liste sur **2 synthèses consécutives** |

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
4. Rattachement laboratoire : BDPM, mémorisation, correction à la main.
5. Urgence et consolidation.
6. L'écran « Commandes à passer ».
7. Ingestion automatique (après validation de la voie).
8. Notification si un labo est 🔴, par le mécanisme déjà en place.

---

## 13. Ce qu'il faut demander à Olivier avant de coder

1. **Les PDF.** Deux ou trois synthèses réelles — rien ne démarre sans elles.
2. L'unité des ventes moyennes dans les PDF : par jour ou par mois ?
3. Canal par laboratoire (direct / répartiteur) : liste de départ, ou saisie au
   fil de l'eau ?
4. Qui voit cette page : le titulaire seul, les adjoints, les préparateurs ?
5. Ajout d'une dépendance d'analyse PDF : d'accord ?
