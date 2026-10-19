# Sprint Change Proposal — Rétablissement du Texte Normal & Résolution du Reset Prod

## 1. Issue Summary

**Déclencheurs :**
1. **Absence de bouton « Texte Normal » dans l'éditeur in-page :** L'administrateur peut appliquer du gras (`<strong>`) ou de l'emphase (`<em>`), mais ne dispose d'aucun bouton ni raccourci pour retirer d'un clic tout formatage sur la sélection et revenir en texte brut normal.
2. **Erreur 500 ENOENT lors de « Réinitialiser depuis la Prod » :** L'action appelle `POST /api/reset`, qui tente d'ouvrir `/var/www/html/translations.json`. Comme la branche `main` n'a pas encore été déployée avec la nouvelle architecture Astro i18n JSON (la PR est toujours sur `staging`), ce fichier n'existe pas encore sur le VPS Scaleway, entraînant : `ENOENT: no such file or directory, open '/var/www/html/translations.json'`.

---

## 2. Impact Analysis

- **Epic Impact :** Fonctionnalité de l'éditeur client bilingue in-page (`SPEC-client-text-editor`). Les objectifs de base restent inchangés.
- **Story Impact :** Ajustement direct de l'ergonomie de la barre d'outils sémantique et sécurisation de la route `POST /api/reset`.
- **Artifact Conflicts :**
  - `spec-client-text-editor.md` : Mise à jour de `CAP-2` pour mentionner l'action de réinitialisation en texte normal.
  - `ux-client-text-editor/EXPERIENCE.md` : Ajout du bouton `[ ⊘ Texte Normal ]` (raccourci `Cmd/Ctrl + \`) dans `Semantic Format Toolbar`.
  - `architecture-client-text-editor.md` : Aucun conflit architectural ; le dépouillement HTML produit du texte brut 100% conforme à la whitelist serveur.
- **Technical Impact :**
  - `infra/editor-client.js` : Implémentation de `clearFormat()` et ajout du bouton `btnNormal`.
  - `infra/staging-server.js` : Fallback gracieux dans `POST /api/reset` si `/var/www/html/translations.json` n'existe pas encore.
  - `.github/workflows/deploy.yml` : Initialisation idempotente de `/var/www/html/translations.json` lors du déploiement.

---

## 3. Recommended Approach

**Voie retenue : Direct Adjustment (Ajustement Direct)**
- **Effort :** Très faible (~30 lignes de code et configuration).
- **Risque :** Minime.
- **Bénéfice :** Ergonomie complète de l'éditeur pour Jean-Charles et élimination immédiate de l'erreur 500 sur le bouton de reset.

---

## 4. Detailed Change Proposals

### Proposition 1 : Barre d'outils et fonction `clearFormat()` dans `infra/editor-client.js`
- Ajout du bouton `[ ⊘ Texte Normal ]` dans `#sdrnow-format-toolbar` (visible en mode `rich`).
- Ajout de la fonction `clearFormat()` nettoyant les balises `<strong>`, `<em>`, `<b>`, `<i>` sur la sélection courante via `removeFormat` et déballage DOM ciblé.
- Liaison du raccourci clavier `Cmd/Ctrl + \`.

### Proposition 2 : Sécurisation de `POST /api/reset` et initialisation CI
- Dans `infra/staging-server.js` : si `/var/www/html/translations.json` n'existe pas encore, copier atomiquement le fichier depuis `stagingDir/translations.json` pour initialiser la baseline sans planter.
- Dans `.github/workflows/deploy.yml` : s'assurer que `/var/www/html/translations.json` existe lors de l'étape de déploiement via SCP/SSH.

---

## 5. Implementation Handoff

- **Classification :** Minor (Ajustement direct réalisable immédiatement par l'agent Developer).
- **Destinataire :** Developer Agent.
- **Critères de succès :**
  1. Cliquer sur `[ ⊘ Texte Normal ]` retire tout le gras et l'emphase de la sélection.
  2. Cliquer sur « ↺ Réinitialiser depuis la Prod » réussit (`202 Accepted`) même si la production n'a pas encore de fichier `translations.json` dédié.
  3. Tous les tests automatisés (`tests/staging-server.test.js`) passent au vert.
