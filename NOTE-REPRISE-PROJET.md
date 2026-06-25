# 📝 Note de reprise — Intranet Pharmacie du Centre

> Document à consulter à chaque reprise de travail sur le projet.
> Dernière mise à jour : 25 juin 2026

---

## 🗺️ Où vit le projet

| Élément | Emplacement |
|---|---|
| **Code local (Windows)** | `C:\NOCODE\pharmacie-intranet` |
| **GitHub (source de vérité)** | https://github.com/olivier918/pharmacie-intranet |
| **Site en production (Railway)** | https://pharmacie-intranet-production.up.railway.app |
| **Données locales (non versionnées)** | `C:\NOCODE\pharmacie-intranet\data\pharmacie-data.json` |

⚠️ **Ne plus jamais remettre le projet dans OneDrive** — ça corrompt Git.

---

## 🚀 Démarrer une session de travail

### 1. Ouvrir le CMD
- `Windows + R` → taper `cmd` → Entrée
- (Pas PowerShell — la syntaxe diffère)

### 2. Se placer dans le projet et récupérer les dernières modifs GitHub
```cmd
cd /d C:\NOCODE\pharmacie-intranet
git pull origin main
```

### 3. Démarrer le serveur local
```cmd
npm start
```

### 4. Ouvrir l'intranet dans le navigateur
👉 http://localhost:3000

**Ne pas fermer la fenêtre CMD** tant que tu utilises l'intranet.

### 5. Arrêter le serveur (en fin de session)
Dans la fenêtre CMD : `Ctrl + C` puis `O`

---

## 🔐 Identifiants

| Élément | Valeur |
|---|---|
| E-mail admin | `admin@pharmacie-mondeville.fr` |
| Mot de passe admin | `pharma2026` |
| PIN personnel | Code à 4 chiffres attribué à chaque collaborateur |

---

## 🔄 Workflow type : faire une modification

1. **Récupérer la dernière version :** `git pull origin main`
2. **Démarrer le serveur :** `npm start`
3. **Modifier les fichiers** (`public\index.html`, `server.js`, etc.)
4. **Tester en local** sur http://localhost:3000 — rafraîchir avec `Ctrl + F5`
5. **Pousser sur GitHub** quand c'est OK :
   ```cmd
   git add .
   git commit -m "description courte de la modif"
   git push
   ```
6. **Railway redéploie tout seul** en 30 à 60 secondes
7. **Vérifier en prod** : https://pharmacie-intranet-production.up.railway.app

---

## 🤖 Reprendre la collaboration avec Claude

### Pour continuer un travail en cours
- Aller sur https://claude.ai
- Ouvrir la conversation existante de l'historique (titre lié à l'intranet pharmacie)
- Claude se souvient du projet grâce à sa mémoire — il faudra peut-être lui ré-uploader les fichiers à modifier

### Pour démarrer un nouveau sujet
- **Nouvelle conversation** sur claude.ai
- Lui donner l'URL du repo GitHub si c'est public, **sinon glisser directement les fichiers** :
  - `public\index.html` (toute l'UI)
  - `server.js` (back-end)
  - `package.json` (dépendances)
- Lui décrire ce qu'on veut faire

### Règles d'or pour Claude
- **Pas de regex sur l'HTML** — uniquement `str_replace` avec chaînes exactes (sinon corruption du fichier)
- Toujours **vérifier la taille du fichier après modification** (`wc -l public/index.html`)
- Pour les modifs sensibles, demander un **diff visuel** avant d'appliquer

---

## 📦 Structure du projet

```
C:\NOCODE\pharmacie-intranet\
├── public\
│   └── index.html          ← TOUT le front (UI + JS + CSS)
├── server.js               ← Express + auto-détection JSON / PostgreSQL
├── package.json            ← Dépendances (express, pg)
├── data\
│   ├── pharmacie-data.json ← Données locales (NON versionné)
│   └── backup-YYYY-MM-DD.json ← Sauvegardes auto quotidiennes
├── .gitignore              ← Exclut data/*.json et node_modules
└── node_modules\           ← Dépendances installées (recréé par npm install)
```

---

## 🧩 Les 6 modules

1. **Livraisons** — suivi avec stepper visuel 3 étapes
2. **Messagerie** — fils de discussion par patient
3. **Préparations officinales** — commandes au labo Kerangal (avec PDF)
4. **BPM** — Bilan Partagé de Médication
5. **Locations** — matériel médical avec contrats PDF
6. **Crédits & produits avancés** — suivi des dûs, relances
7. **Back Office** — staff, patients, médecins, sous-traitants, compte

---

## ⚠️ Pièges connus

| Symptôme | Cause probable | Solution |
|---|---|---|
| `cannot update the ref 'HEAD'` au push | OneDrive interfère | Projet doit être hors OneDrive (déjà fait ✅) |
| `'npm' n'est pas reconnu` | Node.js non installé ou CMD pas relancé | (Ré)installer Node LTS depuis nodejs.org, rouvrir le CMD |
| Modifs pas visibles dans le navigateur | Cache navigateur | `Ctrl + F5` pour rafraîchissement forcé |
| Le serveur ne démarre pas, port occupé | Un autre `node.exe` tourne déjà | `taskkill /F /IM node.exe` puis relancer |
| Railway ne se met pas à jour | Le push n'est pas passé | `git status` puis `git push` à nouveau |

---

## 📅 État au moment de la pause

**Dernière session (25 juin 2026) :**
- Migration du projet de OneDrive vers `C:\NOCODE\` ✅
- Correction du bug d'autocomplete patient dans le module **Crédits**
- Ajout des champs **Adresse** et **Commune** au formulaire de crédit
- Robustification des fonctions `acPatient` / `fillPatient` pour tous les modules

**Repo GitHub :** vérifier qu'il est bien repassé en **privé** (Settings → Change visibility → Private)

---

## 🆘 En cas de pépin grave

- **Le code local est corrompu** → tout récupérer depuis GitHub :
  ```cmd
  cd /d C:\NOCODE
  rmdir /S /Q pharmacie-intranet
  git clone https://github.com/olivier918/pharmacie-intranet.git
  cd pharmacie-intranet
  npm install
  ```
  Puis remettre `data\pharmacie-data.json` depuis une sauvegarde.

- **La prod Railway est cassée** → revenir au commit précédent dans GitHub :
  Aller sur le repo → onglet **Commits** → trouver le dernier commit qui fonctionnait → bouton `<>` (Browse files) → copier l'URL → demander à Claude de faire un `git revert`.

- **Les données sont perdues** → restaurer un `backup-YYYY-MM-DD.json` depuis `data\`.

---

*Bon travail Olivier ! 🚀*
