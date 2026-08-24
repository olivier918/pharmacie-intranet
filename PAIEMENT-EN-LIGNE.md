# Lien de paiement en ligne — mode d'emploi

Permet d'envoyer au patient, depuis le module **Crédits / relances**, un lien de
paiement par carte bancaire (SMS, mail ou lien copié). Le dossier se solde tout
seul dès réception du règlement.

Tant que les clés Stripe ne sont pas renseignées, la fonction reste **inactive**
et l'intranet fonctionne exactement comme avant.

---

## 1. Créer le compte Stripe

1. Ouvrir un compte sur <https://dashboard.stripe.com/register> au nom de la pharmacie.
2. Renseigner l'IBAN professionnel : Stripe reverse les encaissements sur ce compte.
3. Rester en **mode test** pour les premiers essais (interrupteur en haut du tableau de bord).

Tarif carte européenne : **1,5 % + 0,25 €** par transaction, sans abonnement.
Sur un crédit de 18,50 €, cela représente 0,53 €.

## 2. Récupérer la clé secrète

Tableau de bord Stripe → **Développeurs → Clés API** → copier la *clé secrète*.

- Mode test : commence par `sk_test_…`
- Mode réel : commence par `sk_live_…`

⚠️ Cette clé donne accès aux encaissements. Elle ne doit jamais être écrite dans
le code ni envoyée par mail : uniquement dans les variables Railway.

## 3. Déclarer le webhook

C'est lui qui solde automatiquement le dossier quand le patient paie.

Tableau de bord Stripe → **Développeurs → Webhooks → Ajouter un point de terminaison**

- **URL** : `https://pharmacie-intranet-production.up.railway.app/api/paiement/webhook`
- **Événement à écouter** : `checkout.session.completed` (celui-là seulement)

Stripe affiche ensuite un **secret de signature** commençant par `whsec_…` : le copier.

## 4. Renseigner les variables sur Railway

Projet Railway → onglet **Variables** → ajouter :

| Variable | Valeur |
|---|---|
| `STRIPE_SECRET_KEY` | la clé de l'étape 2 (`sk_test_…` puis `sk_live_…`) |
| `STRIPE_WEBHOOK_SECRET` | le secret de l'étape 3 (`whsec_…`) |

Railway redéploie automatiquement. Au démarrage, le journal doit afficher :

```
💳 Paiement en ligne Stripe configuré — mode test
```

Si `STRIPE_WEBHOOK_SECRET` manque, le lien fonctionne quand même mais la
confirmation reste manuelle (bouton « Vérifier le paiement »).

---

## Utilisation quotidienne

1. Module **Crédits** → sur un dossier en cours → **Créer un lien de paiement**.
2. Vérifier le montant et le libellé, puis **Créer le lien**.
3. **Envoyer par SMS**, **Envoyer par mail**, ou **Copier** le lien pour le donner
   au comptoir.
4. Dès que le patient règle, le dossier passe automatiquement au statut
   **« payé — à saisir »**. L'envoi est tracé dans l'historique des relances.
5. Solder le crédit dans **Winpharma**, puis cliquer sur **Clôturer sur Winpharma**
   sur la fiche : le dossier est clôturé et archivé.

Le bouton **Vérifier le paiement** interroge Stripe à la demande : à utiliser si
un doute subsiste, ou si le webhook n'est pas configuré.

### Pourquoi deux étapes

L'argent encaissé par Stripe n'entre pas dans la caisse : la vente doit être
soldée à la main dans Winpharma. Si le dossier passait directement en « clôturé »,
il quitterait la liste active et la saisie serait oubliée — le crédit resterait
ouvert dans le logiciel de vente alors que le patient a payé.

L'état intermédiaire empêche cet oubli :

| Statut | Signification | Compteur | Dans la liste |
|---|---|---|---|
| **en cours** | créance à recouvrer | Total dû | oui |
| **payé — à saisir** | argent encaissé, vente non soldée dans Winpharma | À saisir | oui, en tête |
| **clôturé** | saisie Winpharma confirmée, dossier archivé | Clôturés | non, archivé |

### Archivage

Un dossier clôturé quitte la liste de travail. Rien n'est supprimé : il reste
consultable en cliquant sur le compteur **Clôturés**, en choisissant « Clôturés »
dans le filtre de statut, en isolant le patient, ou tout simplement en le
recherchant par son nom — une recherche affiche toujours les archives.

Un rappel discret sous la liste indique combien de dossiers sont archivés, avec
un bouton pour les afficher.

Cette règle s'applique au statut, pas à un marqueur ajouté aux dossiers : vos
crédits déjà clôturés sont donc archivés dès la mise à jour, sans aucune
modification de vos données.

Les dossiers « payé — à saisir » remontent **en tête de liste** et alimentent le
compteur **À saisir**, cliquable, qui affiche aussi le montant total concerné.
Ils sortent du « Total dû », puisque la somme est encaissée.

Sur ces dossiers, la timeline de relance disparaît : la procédure est terminée,
seule la saisie reste à faire. L'historique des relances demeure consultable dans
le détail du dossier.

Cette étape ne concerne **que les paiements en ligne**. Un règlement au comptoir
continue de se clôturer directement par le bouton **Réglé** : la saisie Winpharma
s'y fait naturellement en caisse.

---

## Points d'attention

**Secret médical.** Le libellé apparaît sur le relevé bancaire du patient et dans
le tableau de bord Stripe. Il ne doit contenir aucun nom de médicament ni
information de santé — seulement une référence de dossier (`PHC-123456`).
L'interface propose ce libellé neutre par défaut et bloque la création si elle
détecte un mot repris des produits avancés.

**Comptabilité.** L'argent arrive sur le compte Stripe, pas dans la caisse. Le
rapprochement dans le logiciel métier reste manuel — la mention est ajoutée
automatiquement aux notes du dossier soldé.

**Un lien = un règlement.** Le lien se désactive après le premier paiement : un
patient qui rouvre un vieux SMS ne peut pas payer deux fois. Contrairement à une
session Checkout classique, il n'expire pas au bout de 24 h — le patient peut
régler plusieurs jours après le SMS, ce qui est le cas normal en relance.

**Confiance du patient.** Le SMS nomme la pharmacie et rappelle le numéro de
l'officine : un SMS de paiement anonyme serait légitimement pris pour une arnaque.

---

## Passage en réel

Une fois les essais concluants en mode test :

1. Basculer le tableau de bord Stripe en mode réel.
2. Recréer le webhook (le secret `whsec_…` diffère entre test et réel).
3. Remplacer les deux variables Railway par les valeurs `sk_live_…` / `whsec_…`.

Le bandeau orange « Mode test » disparaît alors de la fenêtre de création du lien.

---

## En cas de problème

**« Paiement en ligne non configuré »** — `STRIPE_SECRET_KEY` absente ou mal
copiée sur Railway.

**Le dossier ne se solde pas tout seul** — vérifier dans Stripe (Développeurs →
Webhooks → Tentatives) que la livraison renvoie bien un code 200. Un code 400
signale une signature refusée : le `STRIPE_WEBHOOK_SECRET` de Railway ne
correspond pas à celui du webhook déclaré.

**« Ce numéro n'est pas un mobile français »** — la fiche patient contient un fixe.
Utiliser le mail ou le lien copié.
