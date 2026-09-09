# Claude Code sur ce dépôt — mise en service

> Ce document décrit `.github/workflows/claude.yml`. Il est volontairement
> **hors** du dossier `.github/workflows/`, car GitHub exige une permission
> spéciale pour tout fichier qui s'y trouve — même un simple texte.

`.github/workflows/claude.yml` réveille Claude Code quand **@claude** apparaît
dans une issue ou un commentaire du dépôt. Claude lit le code, propose un correctif et ouvre une
*pull request*. **Rien n'est fusionné automatiquement.**

## Mise en service — deux choses à faire une seule fois

**1. Installer l'application Claude sur le dépôt.**
https://github.com/apps/claude → *Install* → choisir `pharmacie-intranet`.

**2. Déposer le jeton d'authentification dans les secrets du dépôt.**
Réglages du dépôt → *Secrets and variables* → *Actions* → *New repository secret*.

- Nom : `ANTHROPIC_API_KEY`
- Valeur : une clé d'API créée sur https://platform.claude.com

Pour passer par un abonnement plutôt que par une clé d'API, le secret s'appelle
`CLAUDE_CODE_OAUTH_TOKEN` (généré par `claude setup-token`), et la ligne
`anthropic_api_key:` du fichier devient
`claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}`.

## Coûts

Chaque exécution consomme des minutes d'actions GitHub et des jetons. Le
`--max-turns 25` et le délai de 30 minutes bornent les dégâts d'une tâche qui
partirait en boucle.

## Pousser une modification du fichier d'action

Un jeton personnel ordinaire ne peut pas créer ni modifier un fichier dans
`.github/workflows/` : GitHub refuse le push avec le message *« refusing to allow
a Personal Access Token to … without `workflow` scope »*. Il faut ajouter cette
permission au jeton :

- jeton **fine-grained** : *Settings* → *Developer settings* → *Personal access
  tokens* → le jeton → *Repository permissions* → **Workflows : Read and write** ;
- jeton **classique** : cocher la case **`workflow`**.

La valeur du jeton ne change pas : rien à ressaisir dans le trousseau.

## Si Claude ne répond pas

- l'application est-elle bien installée sur ce dépôt ?
- le secret existe-t-il, et sous le bon nom ?
- l'auteur de l'issue a-t-il un accès en écriture au dépôt ? L'action refuse
  les robots et les comptes sans droits — c'est pour cela que PILOT crée les
  issues avec un jeton personnel, et non un jeton d'application.
