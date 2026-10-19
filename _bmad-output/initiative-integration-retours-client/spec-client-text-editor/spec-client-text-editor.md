---
id: SPEC-client-text-editor
companions:
  - conventions.md
  - ../architecture-client-text-editor/architecture-client-text-editor.md
  - ../ux-client-text-editor/DESIGN.md
  - ../ux-client-text-editor/EXPERIENCE.md
sources:
  - ../forge-client-text-editor/forge-client-text-editor.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Éditeur Client Bilingue In-Page (SDRnow)

## Why

**Pain to solve & opportunity to capture.** Le fondateur de SDRnow (Jean-Charles) doit pouvoir ajuster et traduire (FR/EN) lui-même les textes du site bilingue en constatant immédiatement le rendu dans la mise en page CSS réelle, partager un aperçu en lecture seule sur Staging pour recueillir un avis, et publier en Production sans attendre une intervention développeur ni risquer d'altérer la grille graphique.

## Capabilities

- **CAP-1**
  - **intent:** L'administrateur peut sélectionner n'importe quelle unité de sens sur le site de staging pour éditer côte à côte ses versions française et anglaise tout en visualisant en temps réel le rendu CSS en pleine largeur dans la langue en cours de saisie.
  - **success:** Cliquer sur un bloc éditable ouvre un tiroir bilingue FR/EN en bas d'écran sans réduire la largeur du viewport ; placer le curseur et saisir dans le champ FR ou EN bascule instantanément toute la page dans la langue correspondante et met à jour le DOM en direct.

- **CAP-2**
  - **intent:** L'administrateur peut appliquer uniquement une emphase d'accroche, une importance forte ou un saut de ligne à l'intérieur des blocs de texte riche, tandis que les blocs de données courtes (KPIs, prix, CTA) restent verrouillés en texte brut.
  - **success:** Dans un bloc riche, seuls les marqueurs d'emphase orange (`<em>`), de gras (`<strong>`) et de saut de ligne (`<br>`) peuvent être insérés (et tout collage presse-papier est converti en texte brut) ; dans un bloc brut, les boutons de formatage et les sauts de ligne sont inactifs.

- **CAP-3**
  - **intent:** L'administrateur peut enregistrer ses modifications sur l'environnement de staging et copier un lien de partage en lecture seule à usage lié à cette version précise du staging, permettant à un relecteur externe de consulter les versions FR et EN en un clic sans ouvrir le staging au public.
  - **success:** L'action « Enregistrer sur Staging » met à jour le staging en moins de 10 ms, synchronise la branche `staging` sur GitHub sans déclencher la CI, et génère un nouveau jeton `?preview=<token>` qui invalide immédiatement tout lien de preview précédent ; ce lien donne accès à la navigation FR/EN en lecture seule stricte sans Basic Auth (éditeur et API d'écriture bloqués), tandis qu'un accès sans Basic Auth `admin` ni jeton actif renvoie `401/403`.

- **CAP-4**
  - **intent:** L'administrateur peut publier les textes validés directement sur le site de production tout en maintenant le dépôt Git synchronisé comme source de vérité.
  - **success:** L'action « Publier en Prod » rejette tout bloc vide ou balise non autorisée, met à jour les pages de production (`sdrnow.fr`) et de staging en moins de 10 ms, et commite le fichier de traductions sur `main` (et `staging`) avec `[skip ci]`.

- **CAP-5**
  - **intent:** L'administrateur peut abandonner ses essais sur l'environnement de staging en réinitialisant le staging depuis l'état actuel de la production.
  - **success:** L'action « Réinitialiser le Staging depuis la Prod » remplace les textes du staging (et de la branche `staging`) par ceux actuellement en ligne sur `sdrnow.fr` en moins de 10 ms et invalide le jeton de preview précédent, sans modifier la production.

## Constraints

- **1 unité de sens = 1 bloc de traduction FR/EN unique :** Chaque titre, paragraphe, puce, chiffre KPI ou CTA est édité d'un seul tenant afin de préserver la liberté d'ordre grammatical entre le français et l'anglais.
- **Zéro classe CSS ni `<span>` dans les données de traduction :** Seuls le texte brut et, pour les blocs riches, les balises HTML5 sémantiques `<em>`, `<strong>` et `<br>` sont admis côté client et validés par whitelist côté serveur.
- **Staging fermé au public, Basic Auth `admin` et jeton Read-Only éphémère par révision :** `staging.sdrnow.fr` renvoie `401/403` par défaut ; l'accès `admin` s'effectue par Basic Auth HTTP (débloquant l'éditeur et les API d'écriture), tandis que l'accès relecteur s'effectue sans Basic Auth via `?preview=<token>`, lequel expire dès que le staging est à nouveau modifié ou réinitialisé.
- **Zéro secret côté navigateur & zéro race condition CI/CD :** Aucun token GitHub n'est exposé au client ; le micro-service serveur applique les modifications localement et marque ses commits GitHub avec `[skip ci]` pour ne pas déclencher `.github/workflows/deploy.yml`.

## Non-goals

- Intégrer un CMS tiers ou SaaS externe (TinaCMS, Keystatic, Decap/Sveltia, Storyblok).
- Exposer une syntaxe Markdown visible à l'utilisateur ou un éditeur WYSIWYG libre permettant de modifier la structure HTML, les polices, les couleurs hors charte ou l'agencement des composants.
- Permettre l'édition directe depuis le domaine de production `sdrnow.fr`.

## Success signal

Authentifié en Basic Auth `admin` sur `staging.sdrnow.fr`, Jean-Charles modifie le titre Hero en FR et EN (en déplaçant l'emphase orange `<em>`), enregistre sur Staging, ouvre le lien `?preview=<token>` en navigation privée (sans Basic Auth) pour vérifier le rendu FR/EN en lecture seule, modifie à nouveau le Staging et constate que l'ancien lien `?preview=<token>` renvoie désormais `401/403`, puis clique sur « Publier en Prod » : `sdrnow.fr` affiche immédiatement le nouveau texte et le commit `[skip ci]` apparaît sur `main` dans GitHub.

## Assumptions

- Les pages de mentions légales (`/mentions-legales` et `/en/legal-notice`) portent les mêmes attributs `data-i18n` et sont éditables selon les mêmes règles que la page d'accueil.
- Les secrets du micro-service (hash Basic Auth `admin`, secret HMAC/génération du jeton `preview`, Fine-Grained PAT GitHub) sont injectés sur le VPS Scaleway via le pipeline OpenTofu / GitHub Actions existant.
