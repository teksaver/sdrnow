---
title: 'Emphase unique <em>, texte normal par défaut, rendu par bloc'
type: 'feature'
ticket: ''
created: '2026-10-19'
status: 'built'
baseline_revision: 'faef39ae0661f54ce48c514faf198c1f8665783b'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran:
  - 'quick'
review_loop_iteration: 0
context:
  - '_bmad-output/initiative-integration-retours-client/change-emphase-unique-normal-par-defaut/change-emphase-unique-normal-par-defaut.md'
  - '_bmad-output/initiative-integration-retours-client/spec-client-text-editor/spec-client-text-editor.md'
  - '_bmad-output/initiative-integration-retours-client/spec-client-text-editor/conventions.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Les trois notions de formatage (Gras / Emphase / Normal) font doublon visuel car les blocs riches sont déjà en gras, et la manipulation de Range actuelle produit un balisage fragile (imbrications, duplications) lors de sélections partielles ou mixtes.

**Approach:** Remplacer le gras et l'emphase par une emphase sémantique unique (`<em>` nu), définir son rendu par bloc via CSS centralisé, rendre les actions Emphase et Normal idempotentes via un modèle « aplatir → appliquer → resérialiser », normaliser côté serveur et migrer les 4 occurrences de `<strong>` restantes.

## Boundaries & Constraints

**Always:**
- `<em>` reste toujours nu (aucun attribut, aucune classe, aucun style inline dans les données).
- L'apparence de l'emphase est définie au niveau bloc (sélecteurs CSS sur `[data-i18n]`), son placement est libre et indépendant entre FR et EN.
- L'action Emphase applique `em` sur la sélection sans bascule ; Normal retire `em` sur la sélection sans bascule. Les espaces en bordure d'une sélection sont rejetés hors de `<em>`.
- `sanitizeValue()` convertit `<strong>`, `<b>`, `<i>` en `<em>`, supprime tout le reste hors `<em>` et `<br>`, et normalise (pas d'imbrication, fusion contiguë, pas d'`<em>` vide).

**Never:**
- Jamais de balises `<strong>` dans les données `translations.json` ni de boutons Gras dans l'éditeur.
- Jamais de styles d'emphase codés en dur par clé (`key === 'pricing.title'`) dans le JS de l'éditeur : l'aperçu du tiroir sonde le rendu réel du bloc via `getComputedStyle`.
- Ne pas modifier l'infrastructure ni le pipeline CI/CD (`deploy.yml`).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| E1 (Sélection partielle) | `<em>Votre SDR externalisé dès demain</em>`, sélection « SDR externalisé » → Normal | `<em>Votre</em> SDR externalisé <em>dès demain</em>` | No error expected |
| E2 (Extension emphase) | `mot <em>orange</em> fin`, sélection « mot orange » → Emphase | `<em>mot orange</em> fin` | No error expected |
| E3 (Idempotence) | `<em>orange</em>`, sélection « ran » → Emphase | `<em>orange</em>` (inchangé) | No error expected |
| E4 (Fusion contiguë) | `<em>a</em> et <em>b</em>`, sélection « et » → Emphase | `<em>a et b</em>` | No error expected |
| E5 (Reset complet) | `<em>a</em> et <em>b</em>`, sélection tout → Normal | `a et b` | No error expected |
| E6 (Saut de ligne) | `<em>ligne 1<br>ligne 2</em>`, sélection « 1<br>ligne » → Normal | `<em>ligne</em> 1<br>ligne <em>2</em>` | No error expected |
| E7 (Espaces en bordure) | `Appel de 100 leads ou`, sélection «  100 leads  » → Emphase | `Appel de <em>100 leads</em> ou` (espaces hors `<em>`) | No error expected |
| E8 (Héritage strong) | `Appel de <strong>100 leads</strong>`, édition ou normalisation | `Appel de <em>100 leads</em>` | No error expected |
| E9 (Caret dans emphase) | `<em>orange</em>`, curseur sans sélection → Normal | `orange` (retire emphase du mot/segment) | No error expected |
| E10 (Sélection hors champ) | Curseur/sélection hors du contenteditable actif | Aucun changement | Silently ignored |
| E11 (Indépendance FR/EN) | FR `<em>Votre SDR</em>` · EN `Your SDR <em>tomorrow</em>`, Normal sur FR | FR `Votre SDR` · EN inchangé | No error expected |

</frozen-after-approval>

## Code Map

- `infra/editor-client.js`:
  - `sdrnow-format-toolbar` (l.389-401): remplacer [B Gras], [🔶 Emphase Orange], [⊘ Texte Normal] par [🔶 Emphase · <rendu>] et [⊘ Normal].
  - `openDrawerForKey(key)` (l.469-520): insérer temporairement sonde `<em>` dans l'élément page `[data-i18n=key]`, lire `getComputedStyle`, déduire libellé bouton et injecter styles sur `.sdrnow-input-area em`.
  - `updateFormatButtonAria()` (l.155-180): mettre à jour aria-pressed ("true", "mixed", "false") pour Emphase.
  - Pure token functions & `applyFormat(activeInput, isEmphasis)`: remplace `toggleFormat` (l.183-246) et `clearFormat` (l.249-293) par l'algorithme aplatir/appliquer/resérialiser.
  - Event listeners & keyboard shortcuts (l.700-760): lier boutons Emphase/Normal, ⌘I → Emphase, ⌘\ → Normal, bloquer ⌘B et ⌘U.
- `infra/staging-server.js`:
  - `sanitizeValue(rawVal, type)` (l.83-100): convertir `<strong>/<b>/<i>` en `<em>`, nettoyer attributs, normaliser les `<em>` imbriqués/vides/adjacents.
- `src/i18n/translations.json`:
  - Remplacer les 4 `<strong>` par `<em>` dans `pricing.starter_f1` (FR/EN) et `legal.s1_intro` (FR/EN).
- `src/styles/emphasis.css` (nouveau) & `src/layouts/Layout.astro`:
  - Centraliser les règles de style d'emphase (`[data-i18n-type="rich"] em`, `[data-i18n="pricing.title"] em`, `[data-i18n="pricing.starter_f1"] em`, `[data-i18n="legal.s1_intro"] em`).
  - Importer `../styles/emphasis.css` dans `Layout.astro`.
- `src/components/*.astro`, `src/pages/*.astro`:
  - Retirer les classes `[&_em]:...` et `[&_strong]:...` dans `Hero.astro`, `Methodology.astro`, `Pricing.astro`, `SocialProof.astro`, `pages/mentions-legales.astro`, `pages/en/legal-notice.astro`.
- `tests/staging-server.test.js`:
  - Mettre à jour tests existants de `sanitizeValue` et ajouter tests pour cas E1 à E10 + normalisation serveur.
- Documentation:
  - `_bmad-output/initiative-integration-retours-client/spec-client-text-editor/spec-client-text-editor.md`
  - `_bmad-output/initiative-integration-retours-client/spec-client-text-editor/conventions.md`
  - `_bmad-output/initiative-integration-retours-client/ux-client-text-editor/EXPERIENCE.md`
  - `_bmad-output/initiative-integration-retours-client/ux-client-text-editor/DESIGN.md`
  - `_bmad-output/initiative-integration-retours-client/architecture-client-text-editor/architecture-client-text-editor.md`

## Tasks & Acceptance

**Execution:**
- [x] `infra/editor-client.js` -- Implémenter les fonctions pures de tokenisation (aplatir/appliquer/resérialiser), la dérivation dynamique du style d'emphase du bloc cible, la mise à jour de la barre d'outils et des raccourcis -- Assure un formatage robuste, idempotent et prévisualisable sans régression de balisage.
- [x] `infra/staging-server.js` -- Adapter `sanitizeValue()` pour convertir `<strong>/<b>/<i>` en `<em>` et normaliser le HTML riche -- Sécurise et unifie la persistance côté serveur contre les balises superflues.
- [x] `src/styles/emphasis.css` & `src/layouts/Layout.astro` -- Créer la feuille CSS centralisée d'emphase et l'importer dans Layout -- Porte le rendu visuel de `em` par bloc conteneur.
- [x] `src/components/*.astro`, `src/pages/*.astro` -- Supprimer toutes les classes Tailwind `[&_em]:...` et `[&_strong]:...` -- Nettoie le balisage des composants au profit de la feuille d'emphase centralisée.
- [x] `src/i18n/translations.json` -- Remplacer les 4 occurrences de `<strong>` par `<em>` -- Met en conformité la source de données unique.
- [x] `tests/staging-server.test.js` -- Couvrir la normalisation serveur et les cas de formatage E1 à E10 -- Garantit l'absence de régression sur les cas limites.
- [x] `_bmad-output/initiative-integration-retours-client/` docs -- Mettre à jour spec, conventions, UX et architecture selon P6 -- Maintient l'intégrité de la documentation projet.

**Acceptance Criteria:**
- Given un bloc de texte riche avec sélection partielle ou mixte dans l'éditeur, when l'utilisateur clique « Emphase » ou « Normal », then le balisage produit est propre, sans imbrication ni `<em>` vide, et les espaces en bordure sont exclus.
- Given une clé avec emphase spéciale (`pricing.starter_f1`, `legal.s1_intro`, `pricing.title`), when le tiroir s'ouvre, then l'aperçu et le libellé du bouton reflètent fidèlement le rendu du bloc sans règle codée en dur.
- Given des données avec `<strong>`, `<b>` ou `<i>`, when elles sont traitées par `sanitizeValue()`, then elles sont converties en `<em>` et normalisées.

## Implementation Notes

## Plan Change Log

## Review Triage Log

- Verdicts: 0 high, 0 medium, 3 low, 0 false, 0 maybe-false
- `low` | `patch` | `EXPERIENCE.md:27` : Table IA mentionnait encore `<strong>/<em>`. Action: remplacé par `<em> ou Normal`.
- `low` | `patch` | `EXPERIENCE.md:116` : Parcours utilisateur décrivait la conservation de `[ B Gras ] (<strong>)`. Action: remplacé par `[🔶 Emphase · gras] (<em>)`.
- `low` | `patch` | `architecture-client-text-editor.md:63` : Règle de cohérence 3 listait encore `<strong>` dans les balises autorisées. Action: `<strong>` retiré de la règle.


## Design Notes

Modèle de formatage à plat :
```javascript
// Tokens: { ch: 'a', em: true } | { br: true }
// 1. Aplatir le DOM en suite de jetons avec héritage (em/strong/b/i -> em: true)
// 2. Mettre em = true (ou false) sur le range d'index [start, end)
// 3. Resérialiser en fusionnant les runs contigus em, excluant les espaces en bordure
```

## Verification

**Commands:**
- `node --test tests/` -- expected: Tous les tests unitaires passent sans régression
- `npm run build` -- expected: Build Astro static réussit sans erreur de template ou de CSS
- `git diff src/i18n/translations.json` -- expected: Seulement les 4 occurrences de strong migrées en em

**Manual checks (if no CLI):**
- Ouvrir l'éditeur sur staging, vérifier que la barre d'outils n'affiche que Emphase et Normal, tester E1 à E10.
