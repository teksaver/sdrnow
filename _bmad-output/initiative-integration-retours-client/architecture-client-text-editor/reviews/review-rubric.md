# Rubric Walker & Reality-Check Review — `architecture-client-text-editor.md`

**Target:** `/Users/sylvaintenier/Progra/sdrnow/_bmad-output/initiative-integration-retours-client/architecture-client-text-editor/architecture-client-text-editor.md`  
**Compared against:**
- `package.json`
- `infra/Caddyfile.template`
- `infra/cloud-init.yaml`
- `infra/main.tf`
- `.github/workflows/deploy.yml`
- `src/i18n/translations.ts`, `src/layouts/Layout.astro`, `src/components/*.astro`, `src/pages/**/*.astro`
- Parent spine: `_bmad-output/architecture-sdrnow-infra/architecture-sdrnow-infra.md`
- Spec package: `spec-client-text-editor.md` & `conventions.md`

---

## Overall Verdict

**PASS WITH CHANGES REQUIRED (1 High, 4 Medium)** — The spine establishes a clear, well-bounded paradigm (*Static Prod / Gatekept Staging Proxy*), preserves inherited invariants (`AD-1`..`AD-3`), and covers all 5 capabilities (`CAP-1`..`CAP-5`) with concrete, testable rules (`AD-4`..`AD-8`). However, five reality-check and boundary gaps between the spine and the brownfield codebase (`main.tf`, `deploy.yml`, Astro build behavior, and existing `.astro` DOM structures) could cause independent implementation units to diverge or fail at deploy/runtime if not tightened in the spine.

---

## 1. Good-Spine Checklist Evaluation

| Checklist Dimension | Status | Assessment |
| --- | --- | --- |
| **Fixes real divergence points for the level below** | **Partial (See F-1..F-4)** | Core client/server contracts (DOM attributes, API endpoints, `202 Accepted` response shape, HMAC preview token formula, sanitization whitelist) are fixed. However, OS user/permissions for `sdrnow-staging.service`, Astro build copy of `translations.json`, and `<title>` key disambiguation (`meta.title` vs `meta.legal_title`) are left implicit. |
| **Every AD's Rule is enforceable & prevents stated divergence** | **Pass with minor gap (See F-5)** | `AD-4`..`AD-8` have crisp, testable rules. Minor gap in `AD-6`: the Rule prose omits the exact target branch mapping per route (`staging` for `/api/staging` and `/api/reset`; both `main` and `staging` for `/api/publish`) mandated by `CAP-3`..`CAP-5`. |
| **Nothing under `Deferred` lets two units diverge** | **Pass** | Only multi-version UI history and multi-admin optimistic locking are deferred; neither affects single-admin implementation boundaries. |
| **Ratifies rather than contradicts brownfield codebase** | **Needs fixes (See F-1, F-2, F-3)** | Contradicts `infra/main.tf` on OS version and `ignore_changes = [user_data]` behavior; overlooks non-leaf/conditional DOM patterns in `Footer.astro`, `Pricing.astro`, and `mentions-legales.astro`. |
| **Covers the spec's capabilities (`CAP-1`..`CAP-5`)** | **Pass** | Every capability is mapped in `Capability → Architecture Map` and bound to specific `AD`s and files. |
| **No new AD weakens or contradicts an inherited AD** | **Pass** | `AD-1` (no Docker on VPS), `AD-2` (Caddy web server), and `AD-3` (Git reproducibility) are respected. Note: `deploy.yml` currently uses `docker run --rm caddy caddy hash-password` on the GitHub Actions runner (not on the VPS), which is replaced or superseded by `ADMIN_PASS_SHA256` in `staging.env`. |
| **Operational / environmental envelope is covered** | **Partial (See F-1, F-4)** | Systemd unit (`sdrnow-staging.service`), `/etc/sdrnow/staging.env`, Caddy routing, and GitHub API sync are covered, but brownfield provisioning on an already-created VPS (`ignore_changes = [user_data]`) and filesystem ownership (`caddy:caddy` vs Node service user) need explicit rules. |

---

## 2. Reality-Check Lens (Technology & Brownfield Verification)

| Named Tech / File | Spine Claim | Real Project (`package.json`, `infra/*`, `.github/workflows/deploy.yml`) | Verdict |
| --- | --- | --- | --- |
| **Astro** | `^5.4.2` | `package.json`: `"astro": "^5.4.2"` | Match |
| **@astrojs/tailwind** | `^5.1.5` | `package.json`: `"@astrojs/tailwind": "^5.1.5"` | Match |
| **Tailwind CSS** | `^3.4.17` | `package.json`: `"tailwindcss": "^3.4.17"` | Match |
| **Node.js** | `20 LTS` | `deploy.yml`: `node-version: 20` (CI); **NOT installed** in `infra/cloud-init.yaml` | Gap in `cloud-init.yaml` / `deploy.yml` (See F-1) |
| **Caddy** | `2.x (stable)` | `cloud-init.yaml`: `dl.cloudsmith.io/public/caddy/stable/debian.deb.txt` | Match |
| **OpenTofu** | `1.x (latest)` | `deploy.yml`: `opentofu/setup-opentofu@v1` with `tofu_version: latest` | Match |
| **Scaleway OS** | `Debian 12 / Ubuntu 24.04 LTS` | `infra/main.tf` line 51: `image = "ubuntu_jammy"` (**Ubuntu 22.04 LTS**) on `STARDUST1-S` | **Mismatch** (See F-1) |
| **4 HTML target files** | `AD-6`: "les 4 fichiers HTML cibles" | Astro builds `index.html`, `en/index.html`, `mentions-legales/index.html`, `en/legal-notice/index.html` | Implicit paths — should be explicitly listed in Conventions |

---

## 3. Prioritized Findings

### [HIGH] F-1 — Brownfield VPS Provisioning Deadlock (`cloud-init` `ignore_changes`) & OS Version Mismatch
- **Location:** `Stack` (line 103), `Inherited Invariants` (line 32), `Minimal Source Tree` (lines 170–174) vs `infra/main.tf` (lines 51, 60–62) and `.github/workflows/deploy.yml`.
- **Evidence:**
  1. `infra/main.tf` provisions `image = "ubuntu_jammy"` (Ubuntu 22.04 LTS), whereas the Spine Stack table states `Debian 12 / Ubuntu 24.04 LTS`.
  2. `infra/main.tf` defines `lifecycle { ignore_changes = [user_data] }` on `scaleway_instance_server.web`. Modifying `infra/cloud-init.yaml` to install Node.js 20 will **never execute** on the existing VPS during `tofu apply`.
  3. `deploy.yml` currently generates `STAGING_PASSWORD_HASH` via `docker run --rm caddy caddy hash-password` and injects `__STAGING_HASH__` into `Caddyfile.template` and `TF_VAR_staging_password_hash`. Under `AD-4` and `AD-7`, Caddy no longer performs `basicauth` on `staging.sdrnow.fr`.
- **Impact:** If the Infra/CI unit puts Node.js 20 installation only in `cloud-init.yaml`, `sdrnow-staging.service` will fail to start on the existing VPS (`node: not found`). Furthermore, if one unit removes `__STAGING_HASH__` from `Caddyfile.template` without aligning `deploy.yml` and `main.tf`, the deployment pipeline will break or leak unused secrets.
- **Recommendation:**
  - Fix Stack OS version to `Ubuntu 22.04 LTS (ubuntu_jammy)` (or specify how the image is upgraded).
  - Specify in `Consistency Conventions` / `Structural Seed` that `deploy.yml` must idempotently ensure Node.js 20 is installed over SSH on the target VPS (in addition to `cloud-init.yaml` for cold-start reproducibility), and clarify the retirement or adaptation of `__STAGING_HASH__` / `TF_VAR_staging_password_hash`.

### [MEDIUM] F-2 — Filesystem Ownership & Permissions Conflict Between `deploy.yml` and `sdrnow-staging.service`
- **Location:** `AD-6` (line 65), `Consistency Conventions` (line 91) vs `.github/workflows/deploy.yml` (line 143).
- **Evidence:** `deploy.yml` runs `sudo chmod -R a+rX /var/www/ && sudo chown -R caddy:caddy /var/www/`. Write permissions on `/var/www/html` and `/var/www/staging` belong solely to `caddy:caddy` (or `root`). Meanwhile, `sdrnow-staging.service` must read `/etc/sdrnow/staging.env` (`0600`) and perform atomic temp-file writes + `fs.renameSync` inside both `/var/www/staging` and `/var/www/html`.
- **Impact:** Independent units writing `sdrnow-staging.service` and `deploy.yml` can choose incompatible Unix users (e.g., `User=www-data` or `User=deploy` vs `chown caddy:caddy`), causing `EACCES` permission errors on `POST /api/staging` or `POST /api/publish`.
- **Recommendation:** Name the exact runtime `User`/`Group` for `sdrnow-staging.service` (e.g., `User=caddy` / `Group=caddy` or `root` with `EnvironmentFile=/etc/sdrnow/staging.env`) in `Consistency Conventions`.

### [MEDIUM] F-3 — Unspecified Build Copy for `dist/translations.json` & Ambiguous `<title>` Mapping Across the 4 HTML Files
- **Location:** `AD-6` (line 65), `Consistency Conventions` (line 89), `Minimal Source Tree` (lines 181–184) vs `package.json` (`astro build`) and `src/layouts/Layout.astro`.
- **Evidence:**
  1. `Consistency Conventions` states: `Source i18n canonique : src/i18n/translations.json (copiée dans dist/translations.json au build)`. However, `astro build` only copies files from `public/` to `dist/`, not `src/i18n/translations.json`. Unless `package.json` `"build"` (or `deploy.yml`) explicitly copies `src/i18n/translations.json` to `dist/translations.json`, `/var/www/staging/translations.json` and `/var/www/html/translations.json` will be missing after CI deploys!
  2. `Consistency Conventions` specifies `data-i18n-meta="title|description"` on `<title>` and `<meta name="description">` in `Layout.astro`. However, the home pages (`index.astro`, `en/index.astro`) bind `<title>` to `meta.title`, while the legal pages (`mentions-legales.astro`, `en/legal-notice.astro`) bind `<title>` to `meta.legal_title`. A generic `data-i18n-meta="title"` does not tell the server patcher whether to inject `meta.title` or `meta.legal_title`.
  3. `AD-6` mentions "les 4 fichiers HTML cibles" without naming their exact relative paths (`index.html`, `en/index.html`, `mentions-legales/index.html`, `en/legal-notice/index.html`).
- **Impact:** Server patcher and Astro frontend units will diverge on how `<title>` is matched on legal pages and where `translations.json` gets copied during build/deploy.
- **Recommendation:**
  - Specify in `Consistency Conventions` that `<title>` and `<meta name="description">` carry the actual translation key (e.g., `data-i18n="meta.title"` / `data-i18n="meta.legal_title"` and `data-i18n-meta="meta.description"`) and list the 4 exact HTML paths (`index.html`, `en/index.html`, `mentions-legales/index.html`, `en/legal-notice/index.html`).
  - Specify how `src/i18n/translations.json` is copied into `dist/translations.json` (e.g., via `package.json` build script or `deploy.yml`).

### [MEDIUM] F-4 — Brownfield DOM Traps Violating `AD-5` Leaf Rule & `AD-8` Optional/Href Keys
- **Location:** `AD-5` (line 59), `AD-8` (lines 80–83) vs `src/components/Footer.astro` (lines 19–28), `src/components/Pricing.astro` (lines 27–29, 66–68), `src/pages/mentions-legales.astro` (lines 40, 51), and `src/i18n/translations.ts`.
- **Evidence:**
  1. **Mixed text + child `<a>` elements:** In `Footer.astro` (`<p>{t('footer.rights')} <a href=...>{t('footer.legal')}</a></p>`) and `mentions-legales.astro` (`<li>{t('legal.s1_email')}<a href="mailto:jcm@sdrnow.fr">...</a></li>` and `legal.s2_website`), putting `data-i18n` on `<p>` or `<li>` directly violates `AD-5` (contains a child `<a>` or `[data-i18n]`) and would destroy the child links upon patching. These text nodes must be wrapped in dedicated `<span data-i18n="...">` leaf nodes.
  2. **Conditionally omitted optional DOM node (`pricing.strategy_unit`):** In `Pricing.astro` line 66, `{t('pricing.strategy_unit') && (<span ...>{t('pricing.strategy_unit')}</span>)}` omits the `<span>` completely at build time because `pricing.strategy_unit` is `""`. If the `<span>` is not rendered unconditionally in the HTML, neither the client editor nor the server patcher can ever populate `pricing.strategy_unit`.
  3. **Non-DOM href keys in `translations.ts`:** `footer.phone_href` and `footer.legal_href` currently live in `translations.ts` as `href` attribute values, not text/HTML leaf content. If migrated blindly into `translations.json`'s editable schema, they have no `[data-i18n]` leaf innerHTML target.
- **Impact:** Component refactoring and server/client patching units could break links in Footer/Legal pages, fail to render `pricing.strategy_unit`, or disagree on whether `*_href` keys belong in `translations.json`'s editable schema.
- **Recommendation:** Clarify in `AD-5` / `Consistency Conventions` that mixed parent elements (`Footer.astro`, `mentions-legales.astro`) must wrap their text in a dedicated `<span data-i18n="...">` sibling of the `<a>`, optional keys like `pricing.strategy_unit` must always render their `<span data-i18n="pricing.strategy_unit">` container in HTML even when empty, and specify how `footer.phone_href` / `footer.legal_href` are handled (kept static or excluded from editable text schema).

### [MEDIUM] F-5 — Target Git Branches Per API Route Omitted in `AD-6` Rule
- **Location:** `AD-6` (line 65) vs `spec-client-text-editor.md` (`CAP-3`, `CAP-4`, `CAP-5`) and `conventions.md` (lines 26–28).
- **Evidence:** `AD-6` states that `/api/staging`, `/api/publish`, and `/api/reset` enqueue `PUT /repos/:owner/:repo/contents/src/i18n/translations.json` with `[skip ci]`, without specifying which Git branch(es) each endpoint targets. The spec requires `/api/staging` and `/api/reset` to commit to `staging`, and `/api/publish` to commit to **both** `main` and `staging` (and update both `/var/www/html` and `/var/www/staging`).
- **Impact:** A builder implementing `staging-server.js` from `AD-6` alone might commit `/api/publish` only to `main`, leaving the `staging` branch out of sync in GitHub and causing the next push to `staging` to overwrite staging translations.
- **Recommendation:** Explicitly state the branch targets in `AD-6`'s Rule: `branch: "staging"` for `POST /api/staging` and `POST /api/reset`, and both `branch: "main"` and `branch: "staging"` (plus patching both `/var/www/html` and `/var/www/staging`) for `POST /api/publish`.
