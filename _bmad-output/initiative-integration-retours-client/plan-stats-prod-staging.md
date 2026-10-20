---
title: 'Stats séparées prod / staging : <site>/stats, journal de test avec identité du testeur'
type: 'feature'
ticket: ''
created: '2026-10-20'
status: 'built'
baseline_revision: 'dcdd6f68b04600be0fe9dc194196a757b692bec2'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context:
  - '_bmad-output/initiative-integration-retours-client/plan-cookieless-server-tracking.md'
  - '_bmad-output/initiative-integration-retours-client/ux-cookieless-server-tracking/DESIGN.md'
  - '_bmad-output/initiative-integration-retours-client/ux-cookieless-server-tracking/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Aujourd'hui l'unique page `staging.sdrnow.fr/stats` affiche les visites de la **prod**, et les visites de `staging.sdrnow.fr` ne sont jamais enregistrées : impossible de tester le parcours de suivi (lecture, tarifs, copie, clic RDV) sans polluer la prod, ni de savoir qui a testé.

**Approach:** Règle unique « les stats d'un site sont sur `<ce site>/stats` » : `sdrnow.fr/stats` (et `www`) affiche la prod derrière le même Basic Auth admin ; `staging.sdrnow.fr/stats` affiche les visites de test de staging, enregistrées par un second tracker (journal et secret journalier distincts) avec l'identité du testeur.

## Boundaries & Constraints

**Always:**
- Prod : `/stats` et `/api/stats/export` sur `sdrnow.fr|www.sdrnow.fr` exigent le Basic Auth admin existant (mêmes `ADMIN_USER` / `ADMIN_PASS_SHA256`), `X-Robots-Tag: noindex, nofollow`, `Cache-Control: no-store`, aucun lien depuis le site ; ces requêtes ne sont jamais comptées comme visites.
- Prod : au-delà de 10 échecs d'authentification par minute et par IP sur ces routes → `429`.
- Staging : journal séparé `analytics-staging.jsonl`, secret journalier distinct (`daily-secret-staging.json` dans le même tmpfs), même classification à 3 niveaux, mêmes routes (`/pour|/offre|/en/for|/en/offer/<slug>`, `/health`, `/rdv/*`, `/en/book/*`, logo témoin `no-cache` + `ETag`, pages HTML).
- Staging : chaque événement porte `tester` = nom d'utilisateur Basic Auth (`admin`, `client`) ou `preview` (lien de prévisualisation) ; le tracking staging s'exécute **après** la porte d'authentification (non authentifié → `401` comme le reste de staging).
- Jamais d'email réel depuis staging : dans ce plan, le tracker staging n'émet aucun email (alertes et digest) ; la capture des emails de test par Mailpit fera l'objet d'un plan ultérieur.
- Chaque page `/stats` indique clairement quelles données elle montre (« Prod — sdrnow.fr » / « Staging — visites de test ») et renvoie vers l'autre.
- `STATS_URL` par défaut = `https://sdrnow.fr/stats` (lien des futurs emails).
- La prod reste anonyme : aucun champ `tester` dans `analytics.jsonl`.

**Never:**
- Nouveau sous-domaine ou DNS ; bascule prod/staging sur une même page ; mélange des deux journaux.
- Modifier le comportement prod existant hors l'ajout de `/stats` et de l'export.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Stats prod | `GET sdrnow.fr/stats?period=7d` Basic admin valide | page « Prod », données de `analytics.jsonl`, `noindex`, aucun event journalisé | — |
| Stats prod sans auth | `GET sdrnow.fr/stats` sans / mauvais identifiants | `401` + `WWW-Authenticate` | 11e échec/min/IP → `429` |
| Export prod | `GET sdrnow.fr/api/stats/export` admin | `analytics.jsonl` en attachment | sans auth → `401` |
| Visite de test | admin ouvre `staging.sdrnow.fr/pour/acme` + logo + `POST /health` | events dans `analytics-staging.jsonl`, slug `acme`, tier 3, `tester: "admin"` ; rien dans `analytics.jsonl` | — |
| Test preview | relecteur (cookie preview) ouvre `staging.sdrnow.fr/` puis `/rdv/starter` | events `tester: "preview"`, `302` vers la cible | — |
| Staging non authentifié | `POST staging.sdrnow.fr/health` ou `GET /rdv/starter` sans auth | `401`, rien journalisé | — |
| Stats staging | `GET staging.sdrnow.fr/stats` admin | page « Staging », données de `analytics-staging.jsonl`, testeurs affichés | lecture seule → `403`, anonyme → `401` |
| Pas d'email staging | 120 s d'inactivité après une visite de test sur `/pour/acme` | aucun appel `sendEmail` | — |

</frozen-after-approval>

## Code Map

- `infra/staging-server.js` -- `STATS_URL` L29 (défaut à changer) ; `createTracker` L1253 (options `analyticsFile`, `secretFile`, `sendEmail` ; `deliver` L1343 avec garde `emailEnabled`) → ajouter une option `emailsDisabled` et un champ optionnel `tester` aux `record*` / `logEvent` ; `handleProdRequest` L1886 (dispatch prod avant auth) → ajouter `/stats`, `/stats/`, `/api/stats/export` avec Basic Auth ; `handleRequest` L2006 : routes neutres staging L2014-2026 (à remplacer par le tracking staging **après** la porte L2031-2117, qui pose `isAdmin` / `isReadOnly`, le nom d'utilisateur est `user` L2041) ; `/stats` staging L2119 et export L2148 → lire le tracker staging ; fichiers statiques L2376-2432 (pageview HTML staging à journaliser, logo témoin à servir en `no-cache` + `ETag`, réutiliser la logique L1961-1975 de prod). `renderStatsPage` : ajouter titre d'environnement, lien croisé et affichage des testeurs. `startServer` L2434 : second tracker (`STAGING_ANALYTICS_FILE`, `daily-secret-staging.json`, `emailsDisabled`).
- Extraire la vérification Basic Auth existante (L2034-2060, `expectedUserHashes`, `expectedPassHash`, `timingSafeEqual`) dans une fonction locale réutilisée par staging et prod — ne pas dupliquer.
- `infra/Caddyfile.template` -- L8 `@tracked` : ajouter `/stats /stats/ /api/stats/export` au bloc prod.
- `.github/workflows/deploy.yml` -- L153 : ajouter `STAGING_ANALYTICS_FILE=/etc/sdrnow/analytics-staging.jsonl`.
- `tests/staging-server.test.js` -- helpers `setupTracking` (~L1001, `ctx.prod` L1032, `ctx.tracker` L1020) ; le test L1466 « staging host keeps /rdv/* and POST /health neutral » décrit l'ancien comportement → le remplacer par les lignes staging de la matrice.
- Ne pas toucher : `src/` (la balise et les boutons sont déjà sur staging), `infra/main.tf`, branche `feat/email-alerts-tem`.

## Tasks & Acceptance

**Execution:**
- [x] `infra/staging-server.js` -- fonction Basic Auth partagée ; `/stats` + export prod avec auth et limite d'échecs ; tracker staging (journal, secret, `emailsDisabled`, `tester`) branché après la porte d'auth sur prospect, `/health`, `/rdv/*`, logo témoin et pages HTML ; `/stats` staging sur le tracker staging ; `renderStatsPage` avec environnement, lien croisé et testeurs ; `STATS_URL` -- cœur du changement.
- [x] `infra/Caddyfile.template` -- router `/stats`, `/stats/`, `/api/stats/export` de la prod vers Node -- accès à `sdrnow.fr/stats`.
- [x] `.github/workflows/deploy.yml` -- variable `STAGING_ANALYTICS_FILE` -- journal staging persistant.
- [x] `tests/staging-server.test.js` -- une ligne de test par ligne de la matrice ; remplacer le test « neutral » obsolète -- non-régression.

**Acceptance Criteria:**
- Given les deux trackers actifs, when une visite a lieu sur chaque domaine, then chaque `/stats` ne montre que les visites de son propre domaine.
- Given la suite existante, when elle tourne, then les tests de l'éditeur et du tracking prod passent sans modification de comportement.

## Implementation Notes

- Limite d'échecs prod : seuls les identifiants **erronés** comptent (une requête sans `Authorization`, comme le premier chargement navigateur, renvoie `401` sans compter). Après 10 échecs dans la minute, toute requête de cette IP sur `/stats`/export reçoit `429` jusqu'à la fin de la fenêtre, y compris avec le bon mot de passe (anti-brute-force). IP hachée (HMAC clé aléatoire du processus), RAM seulement.
- Routes trackées factorisées (`handleTrackedRoute`) entre prod (public) et staging (après la porte) ; sur staging, `/pour/<slug>` sert la page staging avec l'éditeur injecté pour un admin, comme `/`.
- Page staging : en plus du titre et du lien croisé, le copieur de lien et l'état vide pointent vers `https://staging.sdrnow.fr/pour/…`, les sous-titres « alerte / bilan email » indiquent qu'aucun email ne part de staging, l'onglet « Éditeur » de la page prod pointe vers `https://staging.sdrnow.fr/`. Favicon `/stats` en `data:` (le logo témoin n'est plus chargé par la page stats, qui ne compte donc jamais comme visite).
- Le tracker staging (`emailsDisabled`) n'arme aucun timer d'alerte et ne livre ni alerte ni digest ; les champs `tester` ne sont écrits que s'ils sont fournis (prod : jamais).
- Tests éditeur : seule modification, `stagingAnalyticsFile` dans un dossier temporaire (les pages staging sont désormais journalisées), comportement inchangé.
- Vérifié : 64 tests verts, `npm run build` OK, smoke test serveur réel (prod `/stats` 401/200 « Prod », visite staging `/pour/test` + logo journalisée avec `tester: admin` dans le journal staging seul, `POST /health` staging sans auth `401`, deux secrets journaliers distincts dans le tmpfs).

## Plan Change Log

## Review Triage Log

## Design Notes

- `tester` ne sort jamais de staging : c'est un environnement interne derrière authentification, le nom d'utilisateur Basic Auth n'est pas une donnée de visiteur externe.
- Sur la page staging, afficher les testeurs dans le Radar (ex. « 👤 admin, preview ») et en sous-ligne du KPI visiteurs (« admin ×2 • preview ×1 »).

## Verification

**Commands:**
- `node --test tests/staging-server.test.js` -- expected: tous verts.
- `npm run build` -- expected: succès.

**Manual checks (if no CLI):**
- Après déploiement : `curl -I https://sdrnow.fr/stats` → `401` ; connecté admin → page « Prod » ; une visite de `staging.sdrnow.fr/pour/test` apparaît sur `staging.sdrnow.fr/stats` avec `👤 admin`, et pas sur `sdrnow.fr/stats`.

### Passe 1 (lens `quick`) — high 0 / medium 0 / low 4 / false 0 / maybe-false 0

| # | Verdict | Route | Constat & évidence |
|---|---|---|---|
| 1 | low | patch | Fenêtre fixe des échecs d'auth prod ouverte par n'importe quelle requête `/stats` : 10 échecs à t=59 s + 10 à t=60,1 s passent en 401 (2× la limite à la frontière). Fix direct : ancrer la fenêtre sur le premier échec + test à cheval sur la frontière. |
| 2 | low | rejeté | Fixture `setupTracking` (`adminUser: 'client,admin'`, `stagingTracker`) et tests prod réécrits : conséquences voulues du déplacement de `/stats` (intention), aucun comportement produit dégradé ; le seul fix proposé est d'amender le plan. |
| 3 | low | patch | Sans `stagingTracker`/`stagingAnalyticsFile`, le tracker staging de repli écrit dans `/etc/sdrnow/analytics-staging.jsonl` (les 9 tests éditeur ont dû passer l'option). Fix direct : défaut à côté de `options.analyticsFile`. |
| 4 | low | patch | Avec `emailsDisabled`, la rotation de minuit calcule encore le digest staging (lecture complète du journal) avant de l'abandonner. Fix direct : ne pas appeler `sendDigest`. |
