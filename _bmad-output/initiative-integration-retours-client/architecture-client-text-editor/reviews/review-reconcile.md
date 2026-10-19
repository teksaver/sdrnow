# Input Reconciliation Review — `architecture-client-text-editor.md`

**Reviewer Role:** Input Reconciliation Reviewer  
**Target Artifact:** `_bmad-output/initiative-integration-retours-client/architecture-client-text-editor/architecture-client-text-editor.md`  
**Inputs Checked:**
1. `_bmad-output/initiative-integration-retours-client/spec-client-text-editor/spec-client-text-editor.md`
2. `_bmad-output/initiative-integration-retours-client/spec-client-text-editor/conventions.md`
3. `_bmad-output/initiative-integration-retours-client/forge-client-text-editor/forge-client-text-editor.md`
4. `_bmad-output/architecture-sdrnow-infra/architecture-sdrnow-infra.md`

**Verdict:** **CHANGES REQUIRED** (1 High contradiction, 3 Medium omissions/incomplete bindings, 1 Low traceability gap)

---

## Findings

### 1. [HIGH] Contradiction in `AD-7`: Content-Only Preview Token Formula Fails to Invalidate on `POST /api/reset` or Content Revert
- **Source Requirement:**
  - `spec-client-text-editor.md` (CAP-3, CAP-5, Constraint 3, Success Signal): *"L'action « Réinitialiser le Staging depuis la Prod » remplace les textes du staging (et de la branche `staging`) par ceux actuellement en ligne sur `sdrnow.fr` en moins de 10 ms et invalide le jeton de preview précédent"* ; *"lequel expire dès que le staging est à nouveau modifié ou réinitialisé."*
  - `conventions.md` (§4, §5): *"`POST /api/reset` : recopie les traductions actives de la Production (`/var/www/html`) vers `/var/www/staging`, régénère le jeton `preview`... Dès que `admin` modifie ou réinitialise le staging, le jeton change : l'ancien lien `?preview=<token>` et les cookies associés deviennent immédiatement invalides (`401/403`)."*
- **What Landed in the Spine:**
  - `AD-7` (lines 73–74) and the Sequence Diagram (line 157) define the token purely as a deterministic function of the file hash: `HMAC-SHA256(STAGING_PREVIEW_SECRET, sha256(staging/translations.json))`.
- **Why It Contradicts:**
  - Because `sha256(staging/translations.json)` depends exclusively on file content with no monotonic revision identifier or nonce:
    1. When `POST /api/reset` restores `/var/www/staging/translations.json` to the Production content, its SHA-256 reverts to the Production hash. Any preview token previously issued when Staging matched Production becomes **valid again** (and if Staging already matched Production when `/api/reset` was called, the token does not change at all).
    2. If the admin edits Staging from state $A \to B \to A$, the previously invalidated token for $A$ becomes valid again.
- **Required Fix:**
  - Include a persisted monotonic revision identifier / nonce (e.g., `revisionId` or timestamp rotated on every `POST /api/staging`, `POST /api/publish`, and `POST /api/reset`) in the HMAC payload: `HMAC-SHA256(STAGING_PREVIEW_SECRET, revisionId + ":" + sha256(staging/translations.json))`.

---

### 2. [MEDIUM] Incomplete Rules in `AD-6`: Missing Dual-Branch (`main` + `staging`) Commit on Publish and `/var/www/html/translations.json` Source on Reset
- **Source Requirement:**
  - `spec-client-text-editor.md` (CAP-4): *"L'action « Publier en Prod » ... met à jour les pages de production (`sdrnow.fr`) et de staging en moins de 10 ms, et commite le fichier de traductions sur `main` (et `staging`) avec `[skip ci]`."*
  - `conventions.md` (§4): *"`POST /api/publish` : ... commite `src/i18n/translations.json` avec `[skip ci]` sur `main` (et `staging`)."*
  - `spec-client-text-editor.md` (CAP-5) & `conventions.md` (§4): *"`POST /api/reset` : recopie les traductions actives de la Production (`/var/www/html`) vers `/var/www/staging`, régénère le jeton `preview`, et commite `[skip ci]` sur la branche `staging`, sans toucher à la Production."*
- **What Landed in the Spine:**
  - `AD-6` (line 65) and the Sequence Diagram (lines 160–161) describe the GitHub synchronization as a single `PUT` targeting `ref=staging|main` (either/or) rather than committing to **both** `main` and `staging` on `POST /api/publish`.
  - `AD-6` groups `POST /api/staging`, `POST /api/publish`, and `POST /api/reset` together without specifying that `POST /api/reset` takes no client payload and instead reads `/var/www/html/translations.json` as its source of truth (and the Deployment Topology diagram at line 123 omits `translations.json` from `/var/www/html`).
- **Required Fix:**
  - Clarify in `AD-6` and the sequence/topology diagrams that:
    1. `POST /api/publish` updates `/var/www/html` and `/var/www/staging` (including `/var/www/html/translations.json`) and enqueues `[skip ci]` commits on **both** `main` and `staging`.
    2. `POST /api/reset` reads `/var/www/html/translations.json` to overwrite `/var/www/staging/translations.json` and re-patch the 4 Staging HTML files, then enqueues a `[skip ci]` commit on `staging`.

---

### 3. [MEDIUM] Uncodified Client Editor Mechanics (`CAP-1` & `CAP-2`) and Missing Split-Key Merge / `bg-primary` Contrast Rules
- **Source Requirement:**
  - `spec-client-text-editor.md` (CAP-1, Constraint 1) & `conventions.md` (§1, §3):
    - *Bottom drawer & viewport preservation:* Floating drawer at bottom of screen (`position: fixed; bottom: 0`) displaying FR (left) and EN (right) side-by-side so viewport width is never reduced and Tailwind breakpoints (`md:grid-cols-3`, `lg:grid-cols-4`) are never distorted.
    - *Instant language auto-switch:* Focusing or typing in the FR or EN input immediately switches all `[data-i18n]` elements on the page to that language in the live DOM without reload.
    - *Split-key merge ("1 unité de sens = 1 bloc unique"):* `hero.title_pre` and `hero.title_highlight` must be merged into a single `hero.title` key using `<em>` and `<br>`.
  - `spec-client-text-editor.md` (CAP-2) & `conventions.md` (§2, §3):
    - *UI formatting lock on `plain` blocks:* Formatting buttons (`[Gras (<strong>)]`, `[Emphase Orange (<em>)]`) and line breaks are hidden/disabled when `data-i18n-type="plain"`.
    - *Contrast adjustment on orange backgrounds:* `<em>` (`[&_em]:text-primary [&_em]:not-italic`) must be disabled or adapted on sections that already have an orange background (`bg-primary`).
- **What Landed in the Spine:**
  - `CAP-1` is mapped to `AD-4` and `AD-5`, but neither those ADs nor `Consistency Conventions` codifies the `position: fixed; bottom: 0` full-width drawer contract, the side-by-side FR/EN layout, the focus-triggered full-page language auto-switch in `editor-client.js`, or the UI-level disabling of formatting buttons/line breaks on `plain` blocks.
  - `AD-5` only forbids *nested* `[data-i18n]` children ("ne contient jamais d'élément enfant `[data-i18n]`"), which does not forbid splitting one sentence across *sibling* `<span>` leaves (`hero.title_pre` + `hero.title_highlight`).
  - `Consistency Conventions` (line 91) mandates `[&_em]:text-primary [&_em]:not-italic` without the `bg-primary` exception/adaptation from `conventions.md` §2.
- **Required Fix:**
  - Codify in `AD-5` / `AD-8` and `Consistency Conventions`:
    1. The 1-semantic-unit = 1-key rule (explicitly noting the `hero.title_pre` + `hero.title_highlight` $\rightarrow$ `hero.title` merge).
    2. The client editor drawer contract (`position: fixed; bottom: 0` preserving viewport width, FR/EN side-by-side, instant full-page DOM switch on focus/input, formatting buttons & line breaks disabled on `plain`).
    3. The `bg-primary` contrast exception/adaptation for `<em>`.

---

### 4. [LOW] Omission of `/mentions-legales` and `/en/legal-notice` from Source Tree and `AD-6`
- **Source Requirement:**
  - `spec-client-text-editor.md` (Assumptions, line 58): *"Les pages de mentions légales (`/mentions-legales` et `/en/legal-notice`) portent les mêmes attributs `data-i18n` et sont éditables selon les mêmes règles que la page d'accueil."*
- **What Landed in the Spine:**
  - `AD-6` (line 65) refers to *"les 4 fichiers HTML cibles"* without naming them, while the Minimal Source Tree (line 185) only lists `pages/ # Pages FR (/) et EN (/en)`, omitting `/mentions-legales` and `/en/legal-notice`.
- **Required Fix:**
  - Explicitly name the 4 target HTML files (`index.html`, `en/index.html`, `mentions-legales/index.html`, `en/legal-notice/index.html`) in `AD-6` / `Consistency Conventions` and include the legal notice routes in the `src/pages/` source tree comment. Also add `../../architecture-sdrnow-infra/architecture-sdrnow-infra.md` to frontmatter `sources:` since `AD-1`, `AD-2`, and `AD-3` are inherited from it.

---

## Reconciliation Coverage Matrix

| Input Requirement / Constraint / Capability | Source | Spine Status | Notes |
| --- | --- | --- | --- |
| `CAP-1`: In-page bilingual editor, bottom drawer, full-width CSS preview, live language switch on focus | `spec`, `conventions` §3, `forge` | **PARTIAL** | Mapped to AD-4/AD-5, but bottom drawer (`position: fixed; bottom: 0`) and focus auto-switch are missing from ADs/Conventions (Finding #3). |
| `CAP-2`: `plain` vs `rich` distinction, only `<em>`/`<strong>`/`<br>`, plaintext paste, UI buttons disabled on `plain` | `spec`, `conventions` §1–3, `forge` | **PARTIAL** | Server & paste validation in AD-8; missing UI toolbar lock on `plain` and `bg-primary` contrast rule for `<em>` (Finding #3). |
| `CAP-3`: Staging save `< 10 ms`, GitHub `staging` sync `[skip ci]`, read-only `?preview=<token>` per revision | `spec`, `conventions` §4–5, `forge` | **CONTRADICTION** | AD-6 covers `< 10 ms` patch & async Git sync; AD-7's content-only hash formula fails to invalidate prior tokens on revert/reset (Finding #1). |
| `CAP-4`: Publish to Prod & Staging `< 10 ms`, validation, commit `[skip ci]` on `main` and `staging` | `spec`, `conventions` §4, `forge` | **PARTIAL** | AD-6 & Sequence Diagram show `staging\|main` instead of committing to both `main` and `staging` on publish (Finding #2). |
| `CAP-5`: Reset Staging from Prod `< 10 ms`, invalidate preview token, commit `[skip ci]` on `staging` | `spec`, `conventions` §4–5, `forge` | **CONTRADICTION** | Token not invalidated by content-only hash on reset (Finding #1); source `/var/www/html/translations.json` not explicit in AD-6 (Finding #2). |
| Constraint: 1 unit of meaning = 1 translation block (`hero.title_pre` + `hero.title_highlight` $\rightarrow$ `hero.title`) | `spec`, `conventions` §1, `forge` | **PARTIAL** | AD-5 forbids nested `[data-i18n]` children, but does not forbid sibling leaf splits or state the `hero.title` merge (Finding #3). |
| Constraint: Zero CSS classes or `<span>` in JSON | `spec`, `conventions` §2, `forge` | **LANDED** | Covered in AD-5 and AD-8. |
| Constraint: Staging closed to public (`401/403`), Basic Auth `admin`, ephemeral Read-Only `?preview=<token>` | `spec`, `conventions` §5, `forge` | **LANDED (with #1)** | Covered in AD-7 (subject to token rotation fix in Finding #1). |
| Constraint: Zero browser secrets & zero CI/CD race condition (`[skip ci]`) | `spec`, `forge` | **LANDED** | Covered in AD-4, AD-6, and Consistency Conventions. |
| Non-goals: No external CMS, no Markdown/free WYSIWYG, no editing on `sdrnow.fr` | `spec`, `forge` | **LANDED** | Enforced by AD-4, AD-5, and AD-8. |
| Assumption: `/mentions-legales` and `/en/legal-notice` editable via `data-i18n` | `spec` | **MISSING** | AD-6 mentions "4 fichiers HTML" without naming the legal pages; `src/pages/` comment omits them (Finding #4). |
| Assumption: Secrets injected via OpenTofu / GitHub Actions | `spec` | **LANDED** | Covered in Consistency Conventions (`/etc/sdrnow/staging.env`) and Minimal Source Tree (`deploy.yml`). |
| Inherited: `AD-1` (No Docker / Direct Packages), `AD-2` (Caddy), `AD-3` (Zero-Touch / Git truth) | `architecture-sdrnow-infra` | **LANDED** | Explicitly bound in Inherited Invariants table and AD-4, AD-5, AD-6. |
