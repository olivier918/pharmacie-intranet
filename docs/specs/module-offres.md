# Module Offres — l'affiche publique diffusée par SMS

*Pharmacie du Centre, Mondeville. Écrit le 14/10/2026.*

Une opération commerciale tient dans une image. Le SMS, lui, ne transporte pas
d'image : il transporte un lien. Ce module sert ce lien, et rien d'autre.

---

## 1. Ce que ça fait

Côté officine, une rubrique **Offres** dans PILOT : on dépose l'affiche, on
donne un titre et deux dates, PILOT rend le lien et le texte prêt pour le SMS.

Côté patient, une page publique sans compte, sans cookie et sans script :
l'affiche en plein écran, les mentions légales de l'astérisque, le téléphone
de la pharmacie et un itinéraire.

| | |
|---|---|
| Adresse générale | `pharmacie-mondeville.fr/offre` |
| Adresse d'une opération | `pharmacie-mondeville.fr/offre/<code>` |
| Adresse de l'image | `/offre/i/<code>?v=<empreinte>` |
| Écriture | `POST /api/offres` — administrateurs seulement |
| Lecture | `GET /api/offres` — toute session |

---

## 2. Les trois décisions qui expliquent le reste

**La page est publique, donc montée AVANT le portail d'accès.** Un patient n'a
pas de session. C'est la même famille que `/o`, le dépôt d'ordonnance. Un essai
(`essais/offres.js`) garde cet ordre dans `server.js` : si quelqu'un déplaçait
la route après `auth.gate`, le lien renverrait l'écran de connexion de
l'officine à six cents personnes, et rien ne le dirait avant les SMS.

**L'affiche a sa propre table.** Pas le blob : il est relu en entier par chaque
poste toutes les huit secondes, une affiche de 400 Ko y repartirait sur le
réseau mille fois par jour. Pas `app_images` non plus : c'est le coffre des
ordonnances — chiffré, purgé, réservé à de la donnée de santé. Une affiche
commerciale n'y a pas sa place.

**Un lien envoyé ne meurt jamais.** Un patient rouvre son SMS trois semaines
plus tard. On ne lui rend ni une page morte ni une promesse périmée, mais
l'**image de veille** — « pas d'offre en ce moment ». Le lien nommé d'une
opération terminée ajoute une ligne : *cette offre est terminée*, pour qu'il ne
se déplace pas. L'adresse générale, elle, ne dit rien : elle montre simplement
l'offre du jour, ou la veille.

Il ne peut y avoir **qu'une seule veille**, et c'est un index unique en base qui
le garantit — pas une règle dans le code que deux titulaires pourraient
contourner chacun de leur côté.

---

## 3. Ce que le module refuse

- **Pas de SVG.** Un SVG est un document, il peut porter du script, et il serait
  servi depuis le domaine de la pharmacie. JPEG, PNG, WebP seulement, toujours
  avec `X-Content-Type-Options: nosniff`.
- **Pas de PDF.** Une affiche se regarde ; elle ne se télécharge pas.
- **Pas de script dans la page.** Zéro ligne de JavaScript, et l'essai le vérifie.
- **4 Mo maximum.** L'écran réduit de toute façon l'affiche à 1400 pixels de côté
  long avant l'envoi : un export d'agence ouvert en 4G devant la pharmacie, c'est
  une page qui n'arrive pas.
- **Les adresses réservées** (`i`, `api`, `image`, `offre`…) sont refusées : elles
  rendraient `/offre/i/<code>` ambigu.

---

## 4. L'aperçu dans le SMS

La page est construite par le serveur, pas par le navigateur, et elle porte ses
balises Open Graph dans sa source. C'est ce qui fait qu'iMessage, WhatsApp et
Signal affichent **l'affiche en vignette** sous le lien plutôt qu'une adresse
nue. Un robot d'aperçu lit le HTML et n'exécute rien : sans ces balises dans la
source, il n'y a pas d'aperçu.

L'adresse de l'image est absolue, et déduite de l'hôte reçu — le même code sert
`pharmacie-mondeville.fr` et `pilot.pharmacie-mondeville.fr` sans réglage.

---

## 5. Le compteur

Chaque ouverture incrémente un entier. **Rien d'autre n'est retenu** : ni
adresse IP, ni horaire, ni cookie, ni identifiant. Il répond à une seule
question — le SMS a-t-il été ouvert ? — et il ne constitue pas un traitement de
données personnelles.

---

## 6. Le DNS — le seul geste qui reste

Pour que `pharmacie-mondeville.fr/offre` réponde, le **domaine nu** doit pointer
sur l'application Railway.

1. Dans Railway → le service → *Settings* → *Networking* → *Custom Domain*,
   ajouter `pharmacie-mondeville.fr`. Railway donne une cible en
   `…up.railway.app`.
2. Chez le registraire, créer l'enregistrement correspondant.

**Attention, deux points.**

- Un domaine nu (apex) ne peut pas porter un `CNAME` ordinaire. Il faut un
  registraire qui propose un `ALIAS` / `ANAME` / aplatissement de CNAME —
  Cloudflare le fait, et gratuitement. Un `A` vers une adresse IP fixe n'est pas
  une bonne idée chez Railway, dont les adresses bougent.
- **Si le domaine nu sert déjà quelque chose** — un site vitrine, une
  redirection vers Google Business — le pointer sur Railway le remplace. Il faut
  le vérifier avant.

En attendant, le même lien répond déjà sous `pilot.pharmacie-mondeville.fr/offre`.
L'écran a un bouton pour basculer sur cette adresse de secours.

---

## 7. Ce qui n'est pas fait, et pourquoi

**Le module n'envoie pas le SMS.** Une campagne commerciale vers des patients
n'est pas un rappel de vaccination : la prospection par SMS suppose un
consentement préalable (art. L.34-5 du code des postes et des communications
électroniques), et la liste des destinataires n'est pas celle du soin. L'écran
prépare le texte, compte les segments, et s'arrête là. L'envoi passe par le
module **SMS patients**, en conscience, vers les personnes qui ont accepté
d'être informées des offres.

Le texte proposé est **sans accent hors GSM-7** : un seul `ê` fait basculer le
message en Unicode et la limite tombe de 160 à 70 caractères par segment. Sur
six cents envois, c'est six cents crédits de plus. L'écran affiche le compte et
prévient en orange quand le message déborde.

---

## 8. Les fichiers

| Fichier | Rôle |
|---|---|
| `offres.js` | Table, fonctions pures, page publique, routes d'administration |
| `public/of-module.js` | La rubrique **Offres** dans PILOT |
| `essais/offres.js` | 71 vérifications, dont l'ordre de montage dans `server.js` |
| `docs/affiche-veille.jpg` | L'image de veille livrée avec le dépôt |
