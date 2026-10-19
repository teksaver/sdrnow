---
title: 'Éditeur Client Bilingue In-Page, Contrôle d’Accès Staging et Micro-service de Publication'
type: 'feature'
ticket: ''
created: '2026-10-19'
status: 'built'
baseline_revision: '1493191853113e739b8b0d460a6e6af4763381de'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran:
  - 'quick'
review_loop_iteration: 0
context:
  - '_bmad-output/initiative-integration-retours-client/spec-client-text-editor/spec-client-text-editor.md'
  - '_bmad-output/initiative-integration-retours-client/spec-client-text-editor/conventions.md'
  - '_bmad-output/initiative-integration-retours-client/architecture-client-text-editor/architecture-client-text-editor.md'
  - '_bmad-output/initiative-integration-retours-client/ux-client-text-editor/DESIGN.md'
  - '_bmad-output/initiative-integration-retours-client/ux-client-text-editor/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Le fondateur de SDRnow (Jean-Charles) doit pouvoir modifier et traduire (FR/EN) lui-même les textes du site en constatant immédiatement le rendu dans la mise en page CSS réelle sur Staging, partager un aperçu en lecture seule via un lien éphémère sans ouvrir le Staging au public, et publier en Production sans intervention technique ni altération graphique.

**Approach:** Déployer un éditeur visuel bilingue in-page zéro-dépendance (tiroir bas et pastille d'action sombre) injecté sur `staging.sdrnow.fr` uniquement pour la session Basic Auth `admin`, adossé à un micro-service Node 20 natif qui applique les modifications localement dans les fichiers HTML compilés en moins de 10 ms (`HTTP 202`), gère un contrôle d'accès strict (Basic Auth admin vs jeton preview HMAC par révision), et synchronise les branches Git de manière asynchrone avec `[skip ci]`.

## Boundaries & Constraints

**Always:**
- Stocker les textes et le schéma de validation (`plain` vs `rich`, `optional`) dans `src/i18n/translations.json`, copié vers `dist/translations.json` au build.
- Fusionner `hero.title_pre` et `hero.title_highlight` en une unique clé sémantique `hero.title` avec `<em>` et `<br>`.
- Rendre chaque élément portant `data-i18n="<key>"` comme une feuille sémantique inconditionnelle (`data-i18n-type="plain|rich"`), sans élément enfant `[data-i18n]` imbriqué.
- Isoler les libellés avec liens dans `Footer.astro` et `mentions-legales.astro` dans leurs propres `<span data-i18n="..." data-i18n-type="plain">`.
- Séparer strictement la production (`sdrnow.fr` servi directement par le `file_server` Caddy sur `/var/www/html`) du staging (`staging.sdrnow.fr` délégué par `reverse_proxy` au micro-service Node 20 `127.0.0.1:3001`).
- Injecter `<script src="/__editor.js"></script>` uniquement lorsque la requête sur staging est authentifiée en Basic Auth `admin`.
- Renvoyer un `403 Forbidden` propre (page HTML "Lien expiré", sans en-tête `WWW-Authenticate`) lorsqu'un paramètre `?preview=<token>` est invalide ou expiré, pour éviter toute invite d'authentification Basic Auth chez un relecteur.
- Bloquer tout formatage HTML ou saut de ligne sur les clés `plain` ; limiter les clés `rich` exclusivement aux balises `<em>`, `<strong>` et `<br>` (avec conversion systématique du presse-papier en texte brut).
- Muter localement les fichiers HTML et JSON sur le VPS en moins de 10 ms (`HTTP 202 Accepted`), et enfiler les commits GitHub avec `[skip ci]` via une file asynchrone séquentielle.

**Never:**
- Jamais de CMS externe (TinaCMS, Keystatic, Decap) ni de syntaxe Markdown brute exposée à l'utilisateur.
- Jamais de dépendances npm côté serveur VPS (utiliser uniquement les modules natifs Node 20 : `node:http`, `node:fs`, `node:path`, `node:crypto`).
- Jamais de modification directe du contenu depuis le domaine public `sdrnow.fr`.
- Jamais de panneau d'édition latéral réduisant la largeur du viewport ou faussant les media queries Tailwind.
- Jamais d'exposition de secrets (token GitHub, hash secret) côté navigateur.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Accès Staging Admin | Requête `staging.sdrnow.fr` avec en-tête `Authorization: Basic admin:pass` valide | Page servie avec injection de `/__editor.js` avant `</body>` ; mode `👁️ Lecture` par défaut avec pastille haute | `401 Unauthorized` avec `WWW-Authenticate: Basic` si invalide ou manquant |
| Accès Preview Relecteur | Requête `staging.sdrnow.fr/?preview=<token>` correspondant au token HMAC de la révision courante | Cookie `staging_preview=<token>` déposé, page servie en lecture seule stricte sans `/__editor.js`, navigation FR/EN permise | N/A |
| Accès Preview Expiré | Requête `staging.sdrnow.fr/?preview=<vieux_token>` d'une version antérieure | Réponse `403 Forbidden` immédiate avec page explicative HTML "Lien expiré", sans invite Basic Auth | Rendu propre sans popup d'authentification |
| Sélection bloc & switch langue | Clic sur un bloc `[data-i18n]` puis focus sur le champ FR ou EN dans le tiroir bas | Tiroir bas ouvert (260px) avec textes FR/EN ; le focus FR bascule tous les textes de la page en FR, le focus EN bascule tous les textes en EN | N/A |
| Saisie et live preview | Frappe clavier dans le champ FR ou EN actif du tiroir | Mise à jour immédiate du nœud DOM correspondant dans la page ; pastille passe à "Modifications non enregistrées" | N/A |
| Formatage riche | Sélection texte + clic `[B Gras]` ou `[🔶 Emphase]` dans bloc `rich` | Insertion ou bascule des balises `<strong>` ou `<em>` dans le champ et dans le DOM | Inactif si `data-i18n-type="plain"` |
| Collage de texte | `Paste` d'un texte contenant du HTML externe ou du style | Interception de l'événement et insertion stricte de texte brut (`text/plain`) | Tout HTML externe est dépouillé |
| Sauvegarde Staging | Clic "Enregistrer sur Staging" (`POST /api/staging`) | Validation whitelist, patch atomique `/var/www/staging` (<10ms), incrément révision, retour `202 Accepted` avec nouveau `previewUrl`, toast de confirmation, file GitHub `[skip ci]` | `400 Bad Request` si champ obligatoire vide, toast rouge si réseau coupé |
| Publication Prod | Clic "Publier en Prod" + confirmation sous 3s (`POST /api/publish`) | Validation, patch atomique `/var/www/html` et `/var/www/staging` (<10ms), retour `202 Accepted`, file GitHub `[skip ci]` sur `main` puis `staging` | `400 Bad Request` si invalide |
| Réinitialisation Prod | Clic "Réinitialiser depuis la Prod" + confirmation sous 3s (`POST /api/reset`) | Lecture `/var/www/html/translations.json`, patch atomique `/var/www/staging` (<10ms), retour `202 Accepted` | `500` si échec lecture prod |

</frozen-after-approval>

## Code Map

- `src/i18n/translations.json` -- Schéma déclaratif (`rich` vs `plain`, `optional`) et dictionnaires bilingues FR/EN unifiés. Source de vérité unique des textes.
- `src/i18n/translations.ts` -- Chargeur TypeScript important `translations.json` et exportant la fonction `useTranslations(lang)` pour les composants Astro.
- `src/layouts/Layout.astro` -- Annotation `data-i18n="meta.title"` (ou `meta.legal_title`) sur `<title>` et `data-i18n-content="meta.description"` sur `<meta name="description">`.
- `src/components/Hero.astro` -- Fusion `hero.title` avec `<em>` et `<br>`, annotation `data-i18n="hero.*"` et `data-i18n-type="plain|rich"`.
- `src/components/SocialProof.astro` -- Annotation `data-i18n="proof.*"` et `data-i18n-type="plain"`.
- `src/components/Methodology.astro` -- Annotation `data-i18n="method.*"` et `data-i18n-type="plain|rich"`.
- `src/components/Pricing.astro` -- Rendu inconditionnel de `pricing.strategy_unit`, style de l'emphase pour fond orange, annotations `data-i18n="pricing.*"`.
- `src/components/Footer.astro` -- Isolation des textes avec liens dans des `<span>` distincts (`footer.rights`, `footer.phone`, `footer.legal`).
- `src/pages/mentions-legales.astro` & `src/pages/en/legal-notice.astro` -- Annotations `data-i18n="legal.*"`, isolation des liens mails/web.
- `infra/staging-server.js` -- Micro-service Node 20 natif : authentification Basic Auth admin, gestion des jetons HMAC et cookies preview, injection de `/__editor.js`, patch atomique des 4 HTML (<10ms), endpoints `/api/*` et file Git mutex.
- `infra/editor-client.js` -- Script client In-Page UI : pastille d'administration supérieure, tiroir bilingue bas (260px), auto-switch de langue au focus, mise à jour DOM temps réel, boutons de formatage sémantique, toasts de synchronisation.
- `infra/Caddyfile.template` -- Configuration reverse proxy pour `staging.sdrnow.fr` vers `127.0.0.1:3001`.
- `infra/sdrnow-staging.service` -- Définition de l'unité systemd pour exécuter le micro-service sous l'utilisateur `caddy`.
- `.github/workflows/deploy.yml` -- Pipeline CI/CD : copie de `translations.json` dans `dist/`, installation Node 20, provisionnement du service systemd et de `/etc/sdrnow/staging.env`.
- `package.json` -- Commande de build assurant la présence de `dist/translations.json`.

## Tasks & Acceptance

**Execution:**
- [x] `src/i18n/translations.json` -- Créer le fichier JSON avec le bloc `schema` (`plain` vs `rich`, `optional`), et les dictionnaires complets `fr` et `en` incluant `hero.title` unifié -- Centralise la source de vérité et les règles de validation serveur.
- [x] `src/i18n/translations.ts` -- Adapter le chargeur TypeScript pour lire `translations.json` tout en préservant l'API `useTranslations(lang)` -- Maintient la compatibilité avec le typage et les composants existants.
- [x] `package.json` -- Mettre à jour le script de build pour copier `src/i18n/translations.json` dans `dist/translations.json` après le build Astro -- Garantit la disponibilité du JSON de traduction sur le serveur VPS.
- [x] `src/layouts/Layout.astro` -- Ajouter les attributs `data-i18n="meta.title"` sur `<title>` et `data-i18n-content="meta.description"` sur `<meta name="description">` -- Permet l'édition et le patch des métadonnées SEO.
- [x] `src/components/Hero.astro` -- Remplacer `hero.title_pre` et `hero.title_highlight` par une balise `h1` unique avec `data-i18n="hero.title"` et `data-i18n-type="rich"` utilisant `set:html`, et annoter tous les autres éléments texte -- Élimine le morcellement sémantique et rend le titre éditable.
- [x] `src/components/SocialProof.astro` -- Annoter tous les chiffres et libellés avec `data-i18n="proof.*"` et `data-i18n-type="plain"` -- Rend les statistiques éditables en mode texte brut.
- [x] `src/components/Methodology.astro` -- Annoter le titre de section, les étapes et les listes avec `data-i18n="method.*"` et `data-i18n-type="plain|rich"` -- Rend l'ensemble de la méthode éditable.
- [x] `src/components/Pricing.astro` -- Rendre `pricing.strategy_unit` inconditionnellement dans le DOM et annoter tous les prix, badges et fonctionnalités avec `data-i18n="pricing.*"` -- Assure la stabilité structurelle du DOM pour le patch HTML.
- [x] `src/components/Footer.astro` -- Isoler les libellés `footer.phone`, `footer.rights` et `footer.legal` dans des balises `<span>` avec `data-i18n` et `data-i18n-type="plain"` -- Empêche l'écrasement des balises `<a>` lors du remplacement textuel.
- [x] `src/pages/mentions-legales.astro` & `src/pages/en/legal-notice.astro` -- Annoter les sections juridiques avec `data-i18n="legal.*"` et isoler les liens `<a>` dans des spans frères -- Garantit la traductibilité intégrale des pages légales.
- [x] `infra/staging-server.js` -- Implémenter le serveur HTTP Node 20 natif avec contrôle d'accès (Basic Auth admin vs HMAC preview token), injection de `/__editor.js`, patch atomique des 4 HTML en mémoire/disque (<10ms), routes `/api/*` et file d'attente GitHub mutex `[skip ci]` -- Fournit le backend autonome et sécurisé de staging et publication.
- [x] `infra/editor-client.js` -- Implémenter la surcouche client In-Page avec barre d'outils supérieure, tiroir bilingue bas (260px), auto-switch de langue, live DOM preview, formatage riche `<em>`/`<strong>`, nettoyage presse-papier et toasts asynchrones -- Fournit l'expérience WYSIWYG sans panneau latéral.
- [x] `infra/Caddyfile.template` -- Mettre à jour la directive `staging.sdrnow.fr` pour utiliser `reverse_proxy 127.0.0.1:3001` -- Connecte Caddy au micro-service de staging.
- [x] `infra/sdrnow-staging.service` -- Créer la configuration de service systemd sous l'utilisateur `caddy` avec redémarrage automatique et chargement de `/etc/sdrnow/staging.env` -- Assure la persistance du processus serveur sur le VPS.
- [x] `.github/workflows/deploy.yml` -- Configurer le déploiement du micro-service, de l'unité systemd, des permissions de `/var/www/` et du fichier d'environnement sur le VPS Scaleway -- Automatise le déploiement idempotent sans rupture de service.
- [x] `tests/staging-server.test.js` -- Créer une suite de tests unitaires et d'intégration Node.js pour valider le serveur staging, l'authentification, les HMAC tokens, le patch HTML et la sanitization -- Vérifie automatiquement tous les cas limites de l'I/O matrix.

**Acceptance Criteria:**
- Given une installation propre, when `npm run build` est exécuté, then le build Astro réussit sans erreur et `dist/translations.json` est généré avec l'arborescence des 4 pages compilées.
- Given une requête sur `staging.sdrnow.fr` sans en-tête d'authentification ni jeton, when le serveur répond, then il retourne `401 Unauthorized` avec l'en-tête `WWW-Authenticate: Basic realm="SDRnow Staging Admin"`.
- Given une requête authentifiée en Basic Auth `admin`, when une page HTML est servie, then la balise `<script src="/__editor.js"></script>` est injectée avant `</body>`.
- Given un relecteur ouvrant `https://staging.sdrnow.fr/?preview=<token>` avec un jeton valide, when la page se charge, then le contenu est visible en lecture seule sans injection de `/__editor.js` et le cookie `staging_preview` est positionné.
- Given un relecteur ouvrant un lien `?preview=<token>` expiré ou altéré, when la requête arrive, then le serveur retourne immédiatement `403 Forbidden` avec une page d'information dédiée et sans en-tête `WWW-Authenticate`.
- Given l'éditeur ouvert dans le navigateur, when l'utilisateur sélectionne un bloc et place le curseur dans le champ FR, then tous les blocs traduisibles de la page affichent instantanément leurs traductions françaises ; lorsqu'il place le curseur dans le champ EN, tous les blocs basculent instantanément en anglais.
- Given une clé typée `rich`, when l'utilisateur applique le formatage `[🔶 Emphase Orange]`, then le texte est enveloppé de `<em>` dans le champ et mis en valeur en orange dans la page.
- Given une clé typée `plain`, when l'utilisateur tente de coller du texte formaté ou d'appuyer sur Entrée, then tout HTML est supprimé et aucun saut de ligne n'est inséré.
- Given des modifications en cours, when l'utilisateur clique sur « Enregistrer sur Staging », then l'API répond `202 Accepted` en moins de 10 ms, les fichiers de staging sont patchés sur le disque, et un nouveau jeton preview est retourné.
- Given un clic confirmé sur « Publier en Prod », then `/var/www/html` est mis à jour immédiatement et un commit `[skip ci]` est envoyé sur la branche `main` de GitHub.

## Implementation Notes

## Plan Change Log

## Review Triage Log

| Verdict | Count |
|---|---|
| high | 3 |
| medium | 6 |
| low | 1 |
| false | 0 |
| maybe-false | 0 |

| Location | Verdict | Route | Evidence / Action |
|---|---|---|---|
| `infra/editor-client.js:151-155` | high | patch | Clicking bold/em buttons blurs the input area because mousedown shifts focus to the button; adding preventDefault on mousedown and maintaining active selection fixes this. |
| `infra/editor-client.js:520-524` | medium | patch | Pasting multiline text into plain fields does not strip newlines; stripping \r and \n when activeType is plain fixes this. |
| `infra/editor-client.js:527-561` | medium | patch | Pressing Enter in rich mode inserts browser default div/p; intercepting Enter to insert `<br>` fixes this. |
| `infra/editor-client.js:169-174` | medium | patch | Unwrapping tag replaces parent outerHTML rather than selection; proper selection range unwrapping or execCommand toggle fixes this. |
| `infra/editor-client.js:376-405` | medium | patch | Empty `pricing.strategy_unit` has 0px dimensions and cannot be clicked; adding edit-mode dashed placeholder styling for empty `[data-i18n]` elements fixes this. |
| `infra/editor-client.js:396-405` | medium | patch | SEO metadata in `<head>` cannot be clicked directly; adding a "🏷️ SEO / Métadonnées" action button in the admin pill to open and edit page meta fixes this. |
| `infra/editor-client.js:34-81` | low | patch | Missing ARIA attributes (`role="status"`, `role="alert"`, `aria-pressed`) and focus restoration on drawer close; adding them satisfies accessibility floor. |
| `.github/workflows/deploy.yml:142-153` | high | patch | Indented heredoc EOF delimiter causes bash to consume subsequent deployment commands; aligning EOF to column 0 fixes this. |
| `infra/staging-server.js:430-446` | high | patch | Stale `staging_preview` cookie triggers 401 Basic Auth prompt instead of clean 403 Forbidden; returning 403 with expired HTML and clearing cookie when stale fixes this. |
| `.github/workflows/deploy.yml:1-25` | medium | patch | Missing `permissions: contents: write` block prevents GitHub commit sync when using GITHUB_TOKEN fallback; adding workflow permissions fixes this. |

## Design Notes

### Règle d'injection HTML et Patch Atomique (<10 ms)
Dans `infra/staging-server.js`, la lecture et le patch des 4 fichiers HTML cibles (`index.html`, `en/index.html`, `mentions-legales/index.html`, `en/legal-notice/index.html`) s'effectuent par remplacement d'expression régulière ou d'arborescence simple sur les balises annotées :
- Pour les balises classiques : `<([a-z0-9]+)[^>]*data-i18n="${key}"[^>]*>([\\s\\S]*?)<\\/\\1>` remplacé par `<$1 ...>${sanitizedValue}</$1>`.
- Pour `<title data-i18n="${key}">...</title>` : remplacement du contenu de la balise title.
- Pour `<meta name="description" data-i18n-content="${key}" content="...">` : remplacement de l'attribut `content`.
Chaque écriture sur disque s'effectue via un fichier temporaire (`.tmp`) suivi d'un `fs.renameSync` pour une atomicité absolue sans corruption possible lors d'accès concurrents.

### Règle de validation et sanitization stricte
Avant toute écriture sur `/api/staging` et `/api/publish` :
1. Chaque clé transmise doit figurer dans le bloc `schema` de `translations.json`.
2. Si une clé requise (`optional: false`) a une valeur vide ou ne contenant que des espaces, rejet `400 Bad Request`.
3. Pour `type: "plain"`, suppression de toute balise HTML (`replace(/<[^>]*>/g, '')`) et saut de ligne.
4. Pour `type: "rich"`, conservation stricte de `<em>`, `</em>`, `<strong>`, `</strong>`, `<br>` et `<br/>`. Toute autre balise est dépouillée (`replace(/<(?!\\/?(em|strong|br)\\b)[^>]*>/gi, '')`).

## Verification

**Commands:**
- `npm run build` -- expected: Compilation Astro sans erreur et création de `dist/translations.json` et des 4 pages HTML.
- `node --test tests/staging-server.test.js` -- expected: 100% des tests unitaires et scénarios de sécurité/mutation passent au vert.
- `tofu validate` (dans `./infra`) -- expected: Configuration OpenTofu valide.

**Manual checks (if no CLI):**
- Inspecter visuellement l'HTML compilé de `dist/index.html` pour vérifier la présence des attributs `data-i18n` et `data-i18n-type`.
- Vérifier que l'URL `/?preview=<token>` est bien protégée et expire à la modification suivante de révision.
