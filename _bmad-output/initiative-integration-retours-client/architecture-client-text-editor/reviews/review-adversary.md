# Adversarial Architecture Review — Éditeur Client Bilingue In-Page (SDRnow)

- **Target:** `_bmad-output/initiative-integration-retours-client/architecture-client-text-editor/architecture-client-text-editor.md`
- **Verdict:** **FAIL (Changes Required — 5 Architecture-Level Integration Clashes)**
- **Reviewer Lens:** Adversarial Two-Builder Decomposition (`Builder A` = Frontend Astro + `src/i18n/translations.json` + `infra/editor-client.js` vs `Builder B` = Backend `infra/staging-server.js` + `.github/workflows/deploy.yml` + `infra/sdrnow-staging.service`)

---

## Executive Attack Scenario

Suppose we split implementation at the exact boundaries of the Spine's *Minimal Source Tree* and *Capability → Architecture Map*:
- **Builder A (Frontend & In-Page Editor)** implements `src/i18n/translations.json`, `src/i18n/translations.ts`, `src/layouts/Layout.astro`, `src/components/*.astro`, `src/pages/**`, and `infra/editor-client.js`.
- **Builder B (Staging Proxy, HTML Patcher & CI/CD)** implements `infra/staging-server.js`, `infra/sdrnow-staging.service`, `infra/Caddyfile.template`, and `.github/workflows/deploy.yml`.

Both builders obey **AD-1 through AD-8** and every line of the **Consistency Conventions** table to the letter. Yet the system fails to boot on first deploy, corrupts HTML on first save, drops legal-page titles and links, and fails with `EACCES` on filesystem writes.

---

## Findings

### 1. [CRITICAL] Ghost Artifact (`dist/translations.json`) & Unspecified HTML Target Paths Break Boot, Preview HMAC, and Reset
- **Where:** Consistency Conventions (l. 89), AD-6 (l. 65), AD-7 (l. 73–74), Minimal Source Tree (l. 167–186).
- **The Clash:**
  - Consistency Conventions l. 89 states: `Source i18n canonique : src/i18n/translations.json (copiée dans dist/translations.json au build)`.
  - **Builder A** places `translations.json` in `src/i18n/translations.json` and imports it in `src/i18n/translations.ts` (per l. 181–182). In Astro (`output: 'static'`), files under `src/` are bundled at build time and **never copied to `dist/`** (only `public/` is copied verbatim), and neither `package.json` nor `astro.config.mjs` is in the Minimal Source Tree or Capability Map.
  - **Builder B**'s `.github/workflows/deploy.yml` runs `npm run build` and copies `dist/*` to `/var/www/staging` and `/var/www/html`. Neither directory receives `translations.json`.
  - When **Builder B**'s `staging-server.js` starts:
    1. Every request to `staging.sdrnow.fr` computes `sha256(staging/translations.json)` per AD-7 (l. 73) $\rightarrow$ throws `ENOENT` or returns `500`/`401` on all requests.
    2. `POST /api/reset` attempts to copy `/var/www/html/translations.json` to `/var/www/staging/translations.json` $\rightarrow$ fails permanently because `deploy.yml` never put `translations.json` in `/var/www/html`.
  - Additionally, AD-6 refers to *"les 4 fichiers HTML cibles"* without specifying their relative paths inside `/var/www/{staging,html}`. Astro's default directory build outputs `index.html`, `en/index.html`, `mentions-legales/index.html`, and `en/legal-notice/index.html`, whereas `Caddyfile.template` uses `try_files {path} {path}/ {path}.html =404`. If Builder B targets `en.html` / `mentions-legales.html` instead of `en/index.html` / `mentions-legales/index.html`, atomic patching fails or creates orphan files ignored by `index.html` resolution.
- **Required Spine Fix:**
  - Specify the exact mechanism that emits `dist/translations.json` at build time (e.g., `cp src/i18n/translations.json dist/translations.json` in `package.json` `"build"` script or a static Astro endpoint `src/pages/translations.json.ts`) and add `package.json` (or the endpoint) to the Minimal Source Tree.
  - Explicitly enumerate the 4 relative HTML paths inside `/var/www/staging` and `/var/www/html`: `index.html`, `en/index.html`, `mentions-legales/index.html`, `en/legal-notice/index.html`.

---

### 2. [CRITICAL] Clashing DOM & Metadata Contracts (`data-i18n-meta`, Conditional Empty Nodes, Mixed-Content Leaves, and `*_href` Keys)
- **Where:** AD-5 (l. 59), AD-8 (l. 80–83), Consistency Conventions (l. 89), vs actual code in `src/layouts/Layout.astro` (l. 26–27), `src/components/Pricing.astro` (l. 33–36, 66–68), `src/components/Footer.astro` (l. 19–27), `src/pages/mentions-legales.astro` (l. 9, 40, 51), `src/i18n/translations.ts` (l. 12, 70, 78, 81, 88, 95).
- **The Clash:**
  1. **`data-i18n-meta="title"` Collides Between Home and Legal Pages:**
     - Consistency Conventions l. 89 prescribes: `(+ data-i18n-meta="title|description" sur <title> et <meta name="description">)`.
     - However, `index.astro` uses `meta.title` while `mentions-legales.astro` and `en/legal-notice.astro` use `meta.legal_title`.
     - **Builder A** puts `data-i18n-meta="title"` in `Layout.astro` as instructed. **Builder B**'s `staging-server.js` maps `data-i18n-meta="title"` to `meta.title` across all 4 HTML files ( overwriting the Legal Notice `<title>` with the home page title) and leaves `meta.legal_title` unpatchable and uneditable.
  2. **Conditional Rendering of Optional Key `pricing.strategy_unit` Drops the DOM Node at Build Time:**
     - AD-8 (l. 81) explicitly allows `pricing.strategy_unit` to be empty (`""` in `translations.ts` l. 70 & 164).
     - Yet `Pricing.astro` (l. 66–68) wraps the element in `{t('pricing.strategy_unit') && (<span ...>{t('pricing.strategy_unit')}</span>)}`. Because `""` is falsy at Astro build time, **no `<span data-i18n="pricing.strategy_unit">` exists in the compiled HTML**. Neither `editor-client.js` nor `staging-server.js` can ever select, preview, or patch `pricing.strategy_unit`.
  3. **Mixed-Content Leaves & Attribute Keys (`footer.phone_href`, `footer.legal_href`, `legal.s1_email`, `legal.s2_website`):**
     - AD-5 (l. 59) forbids child elements other than `<em>`, `<strong>`, `<br>` inside any `[data-i18n]` leaf.
     - In `mentions-legales.astro` (l. 40, 51), `<li>{t('legal.s1_email')}<a href="mailto:jcm@sdrnow.fr">jcm@sdrnow.fr</a></li>` mixes translated text with an `<a>` tag. In `Footer.astro` (l. 24–28), `<p>` mixes `{t('footer.rights')}` and `<a href={t('footer.legal_href')}>{t('footer.legal')}</a>`. In `Pricing.astro` (l. 32–36), `<li>` contains an `<svg>` sibling to `<span set:html={t('pricing.starter_f1')}>`.
     - Furthermore, `translations.ts` contains URL attribute keys (`footer.phone_href`, `footer.legal_href`). If **Builder A** keeps them in `translations.json` (or drops them from DOM `[data-i18n]`), **Builder B**'s `POST /api/staging` validator (AD-8: *"Toute clé inconnue, manquante ou dont la valeur nettoyée est vide... entraîne un rejet 400 Bad Request"*) rejects payloads built from DOM keys, or live language switching (`CAP-1`) corrupts `href` attributes.
- **Required Spine Fix:**
  - Replace `data-i18n-meta="title|description"` with the actual translation key on `<title data-i18n="meta.title">` (or `<title data-i18n={titleKey}>`) and `<meta name="description" data-i18n-content="meta.description">`, or specify the exact attribute convention for attribute-bound translations.
  - Mandate in AD-5 that optional keys (`pricing.strategy_unit`) are **unconditionally rendered** in the DOM (never gated by `{t(key) && ...}`) so the node exists in compiled HTML even when empty.
  - Explicitly state in Consistency Conventions what happens to non-text keys (`footer.phone_href`, `footer.legal_href`) — either exclude them from `translations.json` (hardcoded per `lang` in `Footer.astro`) or define how attribute-bound keys are handled — and require `<span>` wrappers for `legal.s1_email`, `legal.s2_website`, and `footer.rights` so `<a>` and `<svg>` stay outside `[data-i18n]` leaves.

---

### 3. [CRITICAL] Undefined Payload Contract & Dual-Branch Git Desynchronization on `/api/publish` and `/api/reset`
- **Where:** AD-6 (l. 65), Consistency Conventions (l. 90), State Mutation Sequence Diagram (l. 154, 160), CAP-4, CAP-5.
- **The Clash:**
  1. **Request Payload Shape Mismatch (`{ fr, en }` vs `{ schema, fr, en }` vs `{}`):**
     - Consistency Conventions l. 90 defines the JSON structure as `{"schema": {"hero.title": "rich", ...}, "fr": {...}, "en": {...}}`, while the Sequence Diagram l. 154 shows `POST /api/staging (ou /api/publish) { fr, en }`, and `POST /api/reset` has no body specified at all.
     - **Builder A** sends `{ fr, en }` on `/api/staging`, and sends `{}` on `/api/publish` (assuming "Publier en Prod" promotes the current staging state) or sends `{ fr, en }` without `schema`.
     - **Builder B** either expects `POST /api/publish` to carry `{ fr, en }` (failing with `400 Bad Request` on `{}`) or writes the request body directly to `translations.json` (wiping out the `"schema"` key on disk and breaking subsequent validations!).
     - Moreover, the response format of `GET /api/translations` is never specified (does it return `staging/translations.json` `{ schema, fr, en }`, and does it also return the current `previewUrl` so the admin can copy the preview link on page load without re-saving?).
  2. **Git Branch Desynchronization (`ref=staging|main` vs Dual Commit):**
     - Sequence Diagram l. 160 shows `GET /repos/:owner/:repo/contents/src/i18n/translations.json?ref=staging|main` (implying `/api/staging` commits to `staging` and `/api/publish` commits to `main`).
     - Yet `POST /api/publish` writes locally to **both** `/var/www/staging` and `/var/www/html` (AD-6 l. 65, CAP-4). If the admin edits and clicks "Publier en Prod" directly (as shown in Sequence Diagram l. 153) and Builder B only commits to `main`, the `staging` branch in GitHub remains stale. On the next push to `staging`, `.github/workflows/deploy.yml` overwrites `/var/www/staging` with the stale `staging` branch!
- **Required Spine Fix:**
  - Specify the exact request body for each endpoint in Consistency Conventions:
    - `GET /api/translations` $\rightarrow$ returns `200 OK` with `{"schema": {...}, "fr": {...}, "en": {...}, "previewToken": "<hmac>", "previewUrl": "..."}` from `/var/www/staging/translations.json`.
    - `POST /api/staging` and `POST /api/publish` $\rightarrow$ request body `{"fr": {...}, "en": {...}}`; the server preserves the immutable `schema` from reference `translations.json` when writing `{"schema", "fr", "en"}` to disk and Git.
    - `POST /api/reset` $\rightarrow$ empty body `{}` (reads `/var/www/html/translations.json`, writes `/var/www/staging/translations.json` + 4 staging HTML files, returns `202 Accepted` with new `previewUrl` and `fr`/`en` state).
  - Specify in AD-6 that `POST /api/publish` enqueues GitHub `PUT [skip ci]` commits on **both** `main` and `staging` branches sequentially in the mutex queue.

---

### 4. [HIGH] VPS File Ownership (`EACCES`), Password Hash Format Clash (`ADMIN_PASS_SHA256` vs Caddy Bcrypt), and Non-Atomic CI Deploy
- **Where:** AD-6 (l. 65), AD-7 (l. 72), Consistency Conventions (l. 91), `.github/workflows/deploy.yml` (l. 90–93, 143).
- **The Clash:**
  1. **Filesystem Permission Denial (`EACCES`) on Atomic Rename:**
     - `.github/workflows/deploy.yml` l. 143 executes: `sudo chmod -R a+rX /var/www/ && (sudo chown -R caddy:caddy /var/www/ ...)`.
     - The Spine does not specify which Linux user runs `sdrnow-staging.service`. If **Builder B** configures `User=deploy` or `DynamicUser=yes` / `User=www-data` in `sdrnow-staging.service` while `/var/www/staging` and `/var/www/html` are owned by `caddy:caddy` with mode `755` (`a+rX`), `staging-server.js` crashes with `EACCES: permission denied` on its first `.tmp` write or `fs.renameSync`.
  2. **`ADMIN_PASS_SHA256` Encoding & `crypto.timingSafeEqual` Buffer Length Crash:**
     - Existing `deploy.yml` l. 91 generates a Caddy **bcrypt** hash (`STAGING_PASSWORD_HASH`), while Consistency Conventions l. 91 introduces `ADMIN_PASS_SHA256` compared via `crypto.timingSafeEqual` (AD-7 l. 72).
     - Neither the encoding of `ADMIN_PASS_SHA256` (64-char lowercase hex vs 44-char base64) nor the username comparison strategy is specified. Worse: in Node.js, `crypto.timingSafeEqual(a, b)` **throws an uncaught `RangeError` if `a.byteLength !== b.byteLength`** (e.g., when comparing `ADMIN_USER` against a shorter/longer username, or comparing a hex string buffer against a raw 32-byte digest buffer).
  3. **Destructive `rm -rf $TARGET_DIR/*` in `deploy.yml`:**
     - `deploy.yml` l. 143 runs `sudo rm -rf $TARGET_DIR/* && sudo cp -r /tmp/dist_files/* $TARGET_DIR/`. While `staging-server.js` is live, this creates a window where `/var/www/staging/translations.json` and HTML files vanish.
- **Required Spine Fix:**
  - Define the service user and directory ownership in Consistency Conventions (e.g., `sdrnow-staging.service` runs as `User=caddy` `Group=caddy`, and `/var/www/html` + `/var/www/staging` are owned by `caddy:caddy` with `0755`/`0644`).
  - Specify that `ADMIN_PASS_SHA256` is a 64-character lowercase hex SHA-256 digest (`printf '%s' "$SECRET" | sha256sum | cut -d' ' -f1`), and mandate hashing **both** `username` and `password` with SHA-256 into fixed 32-byte `Buffer`s before calling `crypto.timingSafeEqual` so buffer lengths are always 32 bytes.

---

### 5. [HIGH] Read-Only Preview Gate Traps: Missing Cookie `Path=/`, Stale Cookie Precedence, and Reviewer Basic-Auth Popup on Expired Links
- **Where:** AD-7 (l. 71–74), Conventions §5.
- **The Clash:**
  1. **Missing `Path=/` on `staging_preview` Cookie Breaks Language Switching:**
     - AD-7 (l. 73) specifies `HttpOnly; SameSite=Lax` for the `staging_preview` cookie but omits `Path=/; Secure`. If a reviewer opens `https://staging.sdrnow.fr/en/?preview=<token>` or `/mentions-legales/?preview=<token>`, RFC 6265 scopes the cookie to `/en` or `/mentions-legales`. Clicking the `FR` switcher (`href="/"`) drops the cookie and locks the reviewer out with `401`.
  2. **Stale Cookie Shadows New `?preview=<token>` or Basic Auth:**
     - AD-7 does not specify evaluation precedence when a request carries *both* an old `Cookie: staging_preview=<old>` and a new `?preview=<new>` query parameter (or `Authorization: Basic` + a stale `staging_preview` cookie). If Builder B checks the cookie before the query parameter, clicking a freshly generated preview link in a browser that previously visited an older preview fails with `401`.
  3. **Expired Preview Token Triggers Browser Basic Auth Modal for External Reviewers:**
     - AD-7 Rule 3 states: *"Toute autre requête reçoit `401 Unauthorized` (`WWW-Authenticate: Basic realm=\"SDRnow Staging Admin\"`)"*.
     - When an external reviewer visits an invalidated `?preview=<old_token>` link (or refreshes after Jean-Charles saves a new revision), returning `401` with `WWW-Authenticate: Basic` forces the reviewer's browser to pop up an admin login dialog instead of returning `403 Forbidden` (without `WWW-Authenticate`), contradicting `spec-client-text-editor.md` (CAP-3: *"sans Basic Auth... renvoie 401/403"*).
- **Required Spine Fix:**
  - In AD-7, mandate strict evaluation order:
    1. Valid `Authorization: Basic` $\rightarrow$ Admin mode (ignores any `staging_preview` cookie).
    2. Query `?preview=<token>` (evaluated **before** cookie): if valid, set `Set-Cookie: staging_preview=<token>; Path=/; HttpOnly; Secure; SameSite=Lax` and serve Read-Only; if invalid/expired while `?preview=` is explicitly present, return **`403 Forbidden` (without `WWW-Authenticate`)** and clear the cookie.
    3. Cookie `staging_preview=<token>`: if valid, serve Read-Only; if invalid/expired, clear cookie (`Max-Age=0; Path=/`) and return `401 Unauthorized` (or `403` if no Basic Auth header).

---

## Summary Table of Required Spine Edits

| # | Severity | Target Section in Spine | Concrete Fix Needed |
| --- | --- | --- | --- |
| 1 | **CRITICAL** | Consistency Conventions & AD-6 | Mandate build-time copy of `src/i18n/translations.json` to `dist/translations.json` (via `package.json` `"build"`) and list the 4 exact HTML paths (`index.html`, `en/index.html`, `mentions-legales/index.html`, `en/legal-notice/index.html`). |
| 2 | **CRITICAL** | AD-5 & Consistency Conventions | Replace `data-i18n-meta="title\|description"` with exact key mapping (`meta.title` vs `meta.legal_title`), forbid conditional `{t(key) && ...}` around `[data-i18n]` nodes (`pricing.strategy_unit`), wrap mixed-content text in `<span>` leaves, and settle `footer.*_href` handling. |
| 3 | **CRITICAL** | AD-6, Sequence Diagram & Conventions | Define exact JSON payloads for `GET /api/translations`, `POST /api/staging`, `POST /api/publish`, `POST /api/reset` (server owns `schema`), and require `/api/publish` to sync **both** `main` and `staging` branches in Git. |
| 4 | **HIGH** | Consistency Conventions & AD-7 | Specify `User=caddy` for `sdrnow-staging.service` (matching `/var/www` ownership), define `ADMIN_PASS_SHA256` as 64-char lowercase hex, and hash both user/pass to 32-byte SHA-256 buffers before `crypto.timingSafeEqual`. |
| 5 | **HIGH** | AD-7 | Add `Path=/; Secure` to `staging_preview` cookie, evaluate `?preview=` before cookie, and return `403 Forbidden` (no `WWW-Authenticate`) when an explicit `?preview=` token is invalid/expired. |
