# Walkthrough — Emphase unique `<em>`, texte normal par défaut

Cible : commits `2ceda82`, `47dd4d6` (F1–F3), `cb973b0` (respect strict) sur `staging`.
Proposition : [change-emphase-unique-normal-par-defaut.md](../change-emphase-unique-normal-par-defaut/change-emphase-unique-normal-par-defaut.md)
Plan : [plan-change-emphase-unique-normal-par-defaut.md](../plan-change-emphase-unique-normal-par-defaut.md)
Bloc courant : revue terminée

## [x] 1. Intention — acceptée

Extrait verbatim (source : section Intent du plan) :

**Problem:** Les trois notions de formatage (Gras / Emphase / Normal) font doublon visuel car les blocs riches sont déjà en gras, et la manipulation de Range actuelle produit un balisage fragile (imbrications, duplications) lors de sélections partielles ou mixtes.

**Approach:** Remplacer le gras et l'emphase par une emphase sémantique unique (`<em>` nu), définir son rendu par bloc via CSS centralisé, rendre les actions Emphase et Normal idempotentes via un modèle « aplatir → appliquer → resérialiser », normaliser côté serveur et migrer les 4 occurrences de `<strong>` restantes.

_Source : section Intent du plan._

## [x] 2. Vue d'ensemble — acceptée

Le texte d'un bloc riche est traité comme une suite de caractères marqués « emphase » ou « normal ». Toute action reconstruit le HTML à partir de cette suite, ce qui rend impossibles les `<em>` imbriqués ou collés. Le rendu visuel est porté par une feuille CSS qui cible le bloc via `data-i18n`.

Points d'entrée, dans l'ordre :

1. [src/styles/emphasis.css](../../../src/styles/emphasis.css) — le rendu de `em` par bloc (défaut orange, variantes souligné et gras).
2. [infra/staging-server.js:89](../../../infra/staging-server.js#L89) — le modèle pur, source unique : `decodeHtmlEntities`, `escapeHtmlText`, `htmlToTokens`, `tokensToHtml`, `applyTokensFormat`, injecté dans le navigateur via `buildEmphasisModelPrelude`.
3. [infra/editor-client.js:341](../../../infra/editor-client.js#L341) — `applyFormat`, l'action des boutons Emphase et Normal dans le tiroir.
4. [infra/editor-client.js:550](../../../infra/editor-client.js#L550) — `openDrawerForKey`, la sonde qui calque l'aperçu et le libellé sur le rendu du bloc.
5. [tests/staging-server.test.js:184](../../../tests/staging-server.test.js#L184) — les cas E1 à E11 en tests.

## [x] 3. Modèle de jetons et sérialisation — acceptée (modifié pendant la revue)

Mécanisme : le HTML est aplati en jetons `{ch, em}` et `{br}`. Les jetons contiennent du texte décodé (`&amp;` donne `&`, `&nbsp;` donne une espace insécable), et `em`, `strong`, `b` et `i` comptent tous comme emphase. L'action modifie le drapeau `em` sur une plage. La sérialisation regroupe les suites contiguës et échappe `&`, `<` et `>`. Il y a une seule balise `<em>` par suite, un `<br>` coupe la suite, les espaces en bordure (insécables compris) sortent de l'emphase. Deux emphases séparées par un espace normal restent distinctes : seuls les caractères sélectionnés changent d'état (respect strict). Ce code n'existe qu'à un seul endroit, le serveur. Il est servi au navigateur en tête de `/__editor.js`.

Références : [decodeHtmlEntities / escapeHtmlText](../../../infra/staging-server.js#L89), [htmlToTokens](../../../infra/staging-server.js#L118), [tokensToHtml](../../../infra/staging-server.js#L160), [applyTokensFormat](../../../infra/staging-server.js#L227), [buildEmphasisModelPrelude](../../../infra/staging-server.js#L267), [injection dans /__editor.js](../../../infra/staging-server.js#L883).

_Modifié pendant la revue : suppression de la fusion à travers les espaces ; E4 amendé, E4b ajouté._

## [x] 4. Éditeur : appliquer et restaurer la sélection — acceptée (modifié pendant la revue, vérifié en navigateur)

Mécanisme : `domToTokens` aplatit le champ actif et convertit les bornes de la sélection en index de jetons. `applyFormat` applique l'action, remplace `innerHTML`, puis restaure la sélection aux mêmes index via `findDomPosition`. L'état du bouton (`aria-pressed` true, mixed ou false) est recalculé sur le même modèle. L'éditeur n'a plus de copie du modèle et utilise `window.__sdrnowEmphasisModel`.

Références : [domToTokens](../../../infra/editor-client.js#L164), [findDomPosition](../../../infra/editor-client.js#L234), [updateFormatButtonAria](../../../infra/editor-client.js#L272), [applyFormat](../../../infra/editor-client.js#L341), barre d'outils et raccourcis dans [setupEventListeners](../../../infra/editor-client.js#L678).

_Modifié pendant la revue : `applyFormat` n'agit que si la sélection est déjà dans un champ du tiroir (plus de recentrage qui plaçait le curseur en position 0) ; `aria-pressed` retiré du bouton Emphase (action, pas bascule)._

## [x] 5. Rendu par bloc : CSS centralisé et aperçu dans le tiroir — accepté (vérifié en navigateur)

Mécanisme : `emphasis.css` définit un défaut `[data-i18n-type="rich"] em` et des surcharges `[data-i18n="<clé>"] em`, importé dans le layout. Toutes les variantes `[&_em]` et `[&_strong]` ont été retirées des composants. Dans le tiroir, une sonde `<em>` est insérée temporairement dans le bloc de la page pour lire son style calculé, d'où le libellé (orange, soulignée, gras) et le style de l'aperçu.

Exemple traité : [Pricing.astro](../../../src/components/Pricing.astro). Même traitement : [Hero.astro](../../../src/components/Hero.astro), [SocialProof.astro](../../../src/components/SocialProof.astro), [Methodology.astro](../../../src/components/Methodology.astro), [mentions-legales.astro](../../../src/pages/mentions-legales.astro), [legal-notice.astro](../../../src/pages/en/legal-notice.astro). Sonde : [editor-client.js:585](../../../infra/editor-client.js#L585).

## [ ] 6. Serveur : sanitisation et tests — non parcouru (couvert par les tests, revue close par l'utilisateur)

Mécanisme : `sanitizeValue` en mode riche se réduit à `tokensToHtml(htmlToTokens(raw))`. Les balises hors liste disparaissent, `strong`, `b` et `i` deviennent `em`, et le balisage est normalisé. Le trim se fait sur les jetons décodés.

Références : [sanitizeValue](../../../infra/staging-server.js#L282), [tests](../../../tests/staging-server.test.js#L164), [test de parité navigateur/serveur](../../../tests/staging-server.test.js#L409).

## [ ] 7. Périphérie — non parcouru (revue close par l'utilisateur)

- [translations.json](../../../src/i18n/translations.json) — migration des 4 `<strong>`.
- [translations.json](../../../src/i18n/translations.json) — 5 `&` nus normalisés en `&amp;` (method.step1_title, step3_title FR/EN, step2_item1 EN), sans différence visible.
- [Layout.astro](../../../src/layouts/Layout.astro) — import de `emphasis.css`.
- Spec, conventions, UX, architecture : [spec](../spec-client-text-editor/spec-client-text-editor.md), [conventions](../spec-client-text-editor/conventions.md), [EXPERIENCE](../ux-client-text-editor/EXPERIENCE.md), [DESIGN](../ux-client-text-editor/DESIGN.md), [architecture](../architecture-client-text-editor/architecture-client-text-editor.md).
