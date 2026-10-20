---
title: 'Suivi prospects & audience server-side sans cookies, /stats et emails de suivi Scaleway TEM'
type: 'feature'
ticket: ''
created: '2026-10-20'
status: 'built'
baseline_revision: 'f07221bec8cb33b60390bbb97618fdd18fa6dda9'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 1
context:
  - '_bmad-output/initiative-integration-retours-client/spec-cookieless-server-tracking/spec-cookieless-server-tracking.md'
  - '_bmad-output/initiative-integration-retours-client/spec-cookieless-server-tracking/conventions.md'
  - '_bmad-output/initiative-integration-retours-client/ux-cookieless-server-tracking/DESIGN.md'
  - '_bmad-output/initiative-integration-retours-client/ux-cookieless-server-tracking/EXPERIENCE.md'
  - '_bmad-output/initiative-integration-retours-client/ux-cookieless-server-tracking/mockups/maquettes-emails-et-stats.html'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Jean-Charles ne sait pas quand un prospect ciblé ouvre la landing, la partage en interne ou s'intéresse à une offre, ni combien de visiteurs anonymes (et sous Adblock) passent sur `sdrnow.fr` — et il ne veut ni bandeau cookie ni stack lourde sur la VM `STARDUST1-S`.

**Approach:** Faire passer les pages HTML, un asset témoin, `/pour/<slug>`, `/rdv/*` et `POST /health` de `sdrnow.fr` par le micro-service Node existant (`infra/staging-server.js`, dispatch par `Host` avant toute auth), qui calcule un `anon_id` HMAC journalier, classe les visites en 3 niveaux, journalise en append-only dans `/etc/sdrnow/analytics.jsonl`, expose `staging.sdrnow.fr/stats` (admin) et envoie via l'API HTTPS Scaleway TEM l'alerte « Prospect Chaud » (debounce 120 s) et le digest anonyme de minuit conditionnel. Le contrat détaillé est la spec + `conventions.md` + `DESIGN.md`/`EXPERIENCE.md` listés en `context`.

## Boundaries & Constraints

**Always:**
- Zéro cookie / `localStorage` / `sessionStorage` / IndexedDB côté `sdrnow.fr` ; aucun `Set-Cookie` sur les routes prod ; aucun `?` de tracking dans les liens.
- Node 20 natif, zéro dépendance npm ; `daily_secret` uniquement en RAM, rotation à 00:00 Europe/Paris.
- Seul le trafic `Host: sdrnow.fr|www.sdrnow.fr` est journalisé ; sur `staging.sdrnow.fr`, `/rdv/*` redirige sans journaliser et `POST /health` répond `204` sans journaliser.
- Si Node est indisponible, `sdrnow.fr` reste servi (fallback Caddy statique ; `/rdv/*` → redirection Calendly).
- Jamais d'IP brute stockée, affichée ou envoyée ; seulement `anon_id` et `ua_family`.
- Un envoi TEM individuel par destinataire de `ALERT_EMAIL_TO` ; jamais de SMTP.
- Libellés UI/emails en vocabulaire commercial (voir EXPERIENCE « Voice and Tone »).
- **Décision (clé TEM) :** la VM n'utilise jamais `SCW_SECRET_KEY` ; `infra/main.tf` crée une clé API dédiée (`scaleway_iam_application` + `scaleway_iam_policy` limitée à l'envoi TEM sur le projet + `scaleway_iam_api_key`), exposée en output sensible `tem_secret_key` et injectée par `deploy.yml` en `TEM_SECRET_KEY`.
- **Décision (secret & redémarrage, revue 1) :** `daily_secret` reste hors SSD et tourne à 00:00 Europe/Paris, mais survit aux redémarrages du service dans la journée : il est conservé dans un tmpfs systemd (`/run/sdrnow`, `RuntimeDirectory=sdrnow`, `RuntimeDirectoryPreserve=yes`, fichier 0600 avec sa date), rechargé au démarrage s'il correspond à la date du jour, détruit à la rotation ; la map visiteur → slug/tier du jour est reconstruite depuis `analytics.jsonl` au démarrage.

**Never:**
- Stack d'observabilité externe, JS/polices/charts tiers dans `/stats` ou les emails, heatmaps, IP-to-company, digest les jours à 0 visite humaine anonyme.
- Catch-all racine `/<slug>` ; URL de session pour anonymes.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Lien prospect | `GET /pour/acme` (Host prod, UA iPhone) | `200`, contenu de `PROD_DIR/index.html`, `X-Robots-Tag: noindex, nofollow`, event `pageview` slug `acme` tier 1 | slug hors `^[a-zA-Z0-9_-]{2,64}$` → `404` |
| Lien prospect EN | `GET /en/for/acme` ou `/en/offer/acme` | `PROD_DIR/en/index.html`, `lang: en` | idem |
| Robot | UA `LinkedInBot` sur `/pour/acme` puis logo | tier 1 figé, aucun timer, compté « Bots & Scanners écartés » | — |
| Adblock | `GET /pour/acme` + `GET /assets/logo.svg` même `anon_id` | tier 2, ligne Radar, timer 120 s armé | — |
| Télémétrie | + `POST /health {"e":"init"}` | tier 3, `204`, chaque event réarme le timer | body > 512 o → `413` ; > 30 req/min/IP → `429` ; JSON/`e` invalide → `400` |
| CTA | `GET /rdv/starter` (ou `/en/book/starter`) | event `cta_click` target `starter`, `302` vers `CTA_TARGETS.starter`, `Cache-Control: no-store` | offre inconnue → `404` |
| Rattachement | même `anon_id` ouvre ensuite `/en` | events rattachés à `acme` (map RAM du jour) | — |
| Alerte | 120 s sans event pour `acme` après tier ≥ 2 | 1 email par destinataire, objet `🔥 [SDRnow] acme vient de consulter votre offre (2 appareils • Clic RDV Starter)` | échec TEM → `console.error('[TEM] …')`, pas de retry, serveur intact |
| Digest | rotation minuit, ≥ 1 anonyme humain la veille | email `📊 [SDRnow] Bilan du <date> : …` | 0 visiteur → aucun appel TEM |
| /stats | `GET /stats?period=7d` admin / lecture seule / anonyme | page HTML / `403` / `401` | période inconnue → `today` |
| Export | `GET /api/stats/export` admin | `analytics.jsonl` en `attachment` | fichier absent → corps vide |

</frozen-after-approval>

## Code Map

- `infra/Caddyfile.template` -- bloc prod (`file_server` sur `/var/www/html`) à étendre ; staging déjà en `reverse_proxy 127.0.0.1:3001` (Caddy transmet `Host` et pose `X-Forwarded-For`).
- `infra/staging-server.js` -- `createRequestHandler(options)` L552, `handleRequest` L570 (pas de routeur, `if` sur `pathname`) ; auth admin L575-617 (flags locaux `isAdmin`/`isReadOnly`), porte preview L619-653, gate 401 L655-662 → **tout dispatch prod doit précéder L575**. Réutiliser : `readBody` L535 (limite 5 Mo codée en dur → ajouter un paramètre `maxBytes`), `escapeHtmlText` L109 (n'échappe pas les guillemets → ajouter un échappement attribut), table mime L917-930, `fetch` global (précédent GitHub L399-453), `getExpiredPreviewHtml` L458 comme modèle visuel inline. Config env L10-21. `startServer` L962 seul endroit où démarrer les timers (tests sans timers actifs, `unref()`).
- `infra/editor-client.js` -- `createUI()` L397, pastille `#sdrnow-admin-pill` : ajouter le lien `📡 Radar & Stats` → `/stats`.
- `src/layouts/Layout.astro` -- layout unique des 4 pages ; `</body>` L43 : emplacement de la balise `<script is:inline>`.
- `src/components/Hero.astro` -- CTA L49 (Calendly en dur), switch langue L15-29 (`aria-label`), logo `<img>` L37 (`/assets/logo.svg`, non hashé).
- `src/components/Pricing.astro` -- `<section>` L12 sans id ; carte Starter L19 (CTA L49), Strategy L61 (CTA L88).
- `src/components/Footer.astro` -- `tel:` L10/L21.
- `src/pages/mentions-legales.astro`, `src/pages/en/legal-notice.astro` -- `mailto:` L41, switch langue L25-26.
- `src/i18n/translations.json` -- `legal.s4_text` fr L142, en L213 (texte exact imposé par conventions §5).
- `infra/main.tf` -- provider scaleway `~> 2.45`, aucune ressource TEM.
- `.github/workflows/deploy.yml` -- `staging.env` réécrit à chaque déploiement L144-155 ; les pushes `staging` déploient aussi Caddyfile + Node (impact prod immédiat).
- `tests/staging-server.test.js` -- `node:test`, helper `mockRequest` L101 (étendre si `req.socket` utilisé), dirs `tests/tmp-*`.
- DNS `sdrnow.fr` hébergé chez Infomaniak (NS `ns11/12.infomaniak.ch`), SPF actuel `v=spf1 -all`, DMARC `p=reject`, **aucun MX**.

## Tasks & Acceptance

**Execution:**
- [x] `infra/staging-server.js` -- ajouter un module tracking exporté (`createTracker(options)` : `anonId`, rotation Paris, map `anon→slug`, tiers, rate-limit `/health`, append jsonl, debounce par slug, digest, `classifyUa`, `uaFamily`) et un dispatch prod avant L575 (pages, prospect, logo témoin, `/rdv/*`, `/health`) ; `/rdv/*` et `/health` neutres sur staging ; `GET /stats` (HTML server-rendered selon DESIGN, filtres `period`, copieur de lien inline, état vide) et `GET /api/stats/export` admin-only ; `sendTemEmail` via `fetch` ; options injectables (`analyticsFile`, `ctaTargets`, `alertRecipients`, `sendEmail`, `now`, `debounceMs`) -- cœur du suivi.
- [x] `infra/Caddyfile.template` -- prod : `handle` pour `@prospect` (regex), `/`, `/en`, `/en/`, pages légales, `/assets/logo.svg`, `/health`, `/rdv/*`, `/en/book/*` → `reverse_proxy 127.0.0.1:3001` ; `handle_errors 502 503` avec fallback statique (prospect → `index.html`/`en/index.html`, `/rdv/*` → `redir` Calendly) ; reste en `file_server` -- tracking sans coupler la dispo prod à Node.
- [x] `src/layouts/Layout.astro` -- balise inline < 1,5 Ko : `init`, `pricing_view` (`IntersectionObserver` sur `[data-track="pricing"]`, une fois), `copy` (`t` via `closest('[data-plan]')` ou `tel/mailto`), `contact`, `lang_switch` (`[data-lang-switch]`), `print`, `ping` (secondes visibles cumulées) via `sendBeacon('/health')` -- CAP-4.
- [x] `src/components/Hero.astro`, `src/components/Pricing.astro`, `src/components/Footer.astro`, `src/pages/mentions-legales.astro`, `src/pages/en/legal-notice.astro` -- CTA → `/rdv/{decouverte|starter|strategy}` (fr) / `/en/book/{discovery|starter|strategy}` (en) en gardant `target="_blank"` ; `data-track="pricing"`, `data-plan="starter|strategy"`, `data-lang-switch` -- hooks stables.
- [x] `src/i18n/translations.json` -- remplacer `legal.s4_text` fr/en par les textes exacts de conventions §5 -- CAP-6.
- [x] `infra/editor-client.js` -- lien `📡 Radar & Stats` dans la pastille admin -- navigation admin.
- [x] `infra/main.tf` -- `scaleway_tem_domain` (`sdrnow.fr`, `fr-par`, `accept_tos = true`) + outputs `tem_spf_config`, `tem_dkim_config`, `tem_dmarc_*` ; application IAM + policy (permission set d'envoi TEM le plus restreint documenté par le provider, portée `project_ids = [var/projet courant]`) + `scaleway_iam_api_key`, output sensible `tem_secret_key` -- émetteur signé, clé à moindre privilège.
- [x] `.github/workflows/deploy.yml` -- ajouter à `staging.env` : `TEM_SECRET_KEY=$(tofu output -raw tem_secret_key)`, `SCW_DEFAULT_PROJECT_ID`, `ALERT_EMAIL_TO=${{ vars.ALERT_EMAIL_TO || secrets.ALERT_EMAIL_TO || 'jcm@sdrnow.fr' }}`, `ALERT_EMAIL_FROM=alertes@sdrnow.fr`, `ANALYTICS_FILE=/etc/sdrnow/analytics.jsonl`, `CTA_TARGET_*` optionnels -- config.
- [x] `tests/staging-server.test.js` -- couvrir chaque ligne de l'I/O Matrix (TEM et horloge simulés) + invariants « aucun `Set-Cookie` prod » et « aucune IP dans le jsonl » -- non-régression.

**Acceptance Criteria:**
- Given le build Astro, when on inspecte `dist/`, then aucun lien `calendly.com` hors fallback Caddy/serveur et aucune occurrence de `cookie`/`localStorage`/`sessionStorage` dans le script de balise.
- Given un redémarrage du service, when `/stats` est chargé, then les chiffres passés sont reconstruits depuis `analytics.jsonl` (seuls les timers en cours et la map RAM sont perdus).
- Given les tests existants de l'éditeur, when la suite tourne, then ils passent sans modification de comportement.

## Design Notes

- **Asset témoin = `/assets/logo.svg`** servi par Node avec `Cache-Control: no-cache` + `ETag` : chaque chargement de page revalide (304 compris) et prouve le rendu, même au retour J+N ; le CSS hashé `/_astro/*` reste en `file_server` immuable.
- **Tier** écrit à l'écriture (état courant du visiteur) ; agrégation = max par (`date`, `anon_id`) ; UA bot → tier 1 définitif.
- **Session** = suite d'events d'un `anon_id` sans trou > 30 min ; revisite = ≥ 2 sessions pour un slug.
- **Alerte** récapitule les events du slug accumulés en RAM depuis le dernier envoi ; digest compté depuis le jsonl de la veille (robuste au redémarrage).
- IP réelle = 1re valeur de `X-Forwarded-For` (Caddy l'écrase pour les clients non approuvés), sinon `socket.remoteAddress`.

## Verification

**Commands:**
- `node --test tests/staging-server.test.js` -- expected: tous verts.
- `npm run build && grep -rl "calendly.com" dist/ ; grep -c "localStorage\|sessionStorage\|document.cookie" dist/index.html` -- expected: aucun fichier, `0`.
- `cd infra && tofu validate` -- expected: succès (si `tofu` dispo localement).

**Manual checks (if no CLI):**
- Après déploiement : publier chez Infomaniak le SPF `v=spf1 include:_spf.scw-tem.cloud -all` (remplace `-all` seul) et le DKIM issus des outputs, puis valider le domaine dans la console TEM.
- Premier `tofu apply` en CI : vérifier que la clé de déploiement a les droits IAM (création application/policy/clé) ; sinon les accorder dans la console Scaleway.
- `sdrnow.fr` n'a pas de MX : `jcm@sdrnow.fr` ne reçoit rien tant qu'une messagerie n'est pas configurée → renseigner la variable GitHub `ALERT_EMAIL_TO` avec une adresse joignable.

## Implementation Notes

- `ping.d` = secondes visibles **depuis le ping précédent** (la balise remet son compteur à zéro après chaque envoi et émet un `ping` toutes les 60 s tant que l'onglet est visible, ce qui maintient le debounce d'alerte pendant la lecture ; un lot en attente ne contenant que des `ping` n'envoie pas d'email) : la somme serveur des `ping` donne exactement la lecture active, sans double comptage `visibilitychange` + `pagehide`.
- `render` (asset témoin) n'est journalisé qu'une fois par `pageview` (première revalidation du logo qui suit le HTML) et jamais sans `pageview` préalable du même `anon_id` : un logo chargé ailleurs (signature email) ne crée pas de visiteur.
- Appareils d'un prospect = maximum, sur une journée, d'`anon_id` humains distincts (l'`anon_id` change chaque nuit, deux jours différents ne prouvent pas deux appareils). L'alerte compte les appareils humains du jour pour le slug.
- `🔄 Revisite` = deux événements du slug séparés de plus de 30 min (tous appareils) ; « N sessions » affiche le total des sessions par `anon_id`. Deux appareils à 3 min d'écart = partage, pas revisite.
- KPIs, entonnoir et origines de la section 2 = humains anonymes (`slug == null`) ; « Bots & Scanners écartés » = tous les visiteurs restés niveau 1 (liens prospects compris). « Ont lu les tarifs » : % des visiteurs avec télémétrie sur `/stats`, % des visiteurs humains dans le digest (comme les maquettes).
- Slug normalisé en minuscules (`/pour/ACME` et `/pour/acme` = même ligne Radar). `referer` stocké = nom d'hôte seul.
- Sur l'hôte prod, tout chemin non routé explicitement est servi en statique par Node depuis `PROD_DIR` (sans journalisation hors pages HTML), jamais par la porte d'auth staging.
- `deploy.yml` : Node est redémarré (nouveau code + env) **avant** le rechargement de Caddy, sinon l'ancien Node répondrait `401` sur `sdrnow.fr` pendant le déploiement.
- Permission set IAM : `TransactionalEmailEmailApiCreate` (envoi API seul, projet unique) — nom repris de la doc Anymail/Scaleway, à confirmer au premier `tofu apply`.
- `Footer.astro` inchangé : le lien `tel:` est reconnu par son `href` par la balise.
- Vérifié : 57 tests verts, build sans `calendly.com` dans `dist/`, balise 1 474 octets, `tofu validate` OK, Caddyfile validé (Caddy 2.11) et testé de bout en bout en conteneur (Node arrêté → fallback statique + redirection Calendly ; Node actif → routage, `X-Robots-Tag`, 413, journal sans IP).

## Plan Change Log

## Review Triage Log

### Passe 1 (lens `quick`) — high 3 / medium 1 / low 2 / false 0 / maybe-false 0

| # | Verdict | Route | Constat & évidence |
|---|---|---|---|
| 1 | high | patch | Double alerte « Prospect Chaud » pour une seule lecture : la balise n'émet rien pendant la lecture visible, le timer de 120 s expire en pleine lecture puis le `ping` de fermeture ré-arme une 2e alerte à chronologie vide (reproduit par script). Fix : `ping` périodique (60 s) tant que l'onglet est visible + pas d'email si les events en attente ne sont que des `ping`. |
| 2 | medium | intent_gap → résolu | Redémarrage (2 par déploiement) = nouveau `daily_secret` → même appareil compté 2 fois (faux « Partage interne », reproduit). L'humain a tranché : tmpfs `/run/sdrnow`, rotation minuit conservée (décision ajoutée au bloc gelé). Code conservé et amendé plutôt que ré-dérivé intégralement, l'écart étant localisé. |
| 3 | high | patch | `getClientIp` fait confiance à `X-Forwarded-For` alors que Node écoute `0.0.0.0:3001` sans security group (`main.tf`) → contournement du rate-limit et faux prospects/appareils en appelant `:3001` directement. Fix : `listen(PORT, '127.0.0.1')` (Caddy est local). |
| 4 | low | rejeté | `analytics.jsonl` jamais tourné, lu en entier à chaque `/stats` : réel mais négligeable au trafic d'une landing B2B (des années avant d'atteindre quelques Mo) ; le fix exige une politique de rétention (hors correction directe). Signalé à l'utilisateur. |
| 5 | low | patch | Clic sur la langue active envoyé comme `lang_switch` (les deux pastilles portent `data-lang-switch`). Fix direct : n'émettre que si la cible ≠ `document.documentElement.lang`. |
| 6 | high | patch | `scaleway_iam_application`/`scaleway_iam_policy` sans `organization_id` et CI sans `SCW_DEFAULT_ORGANIZATION_ID` : le SDK (`CreateApplication`/`CreatePolicy`) ignore l'erreur de `GetDefaultOrganizationID()` et envoie un ID vide → `tofu apply` échoue et bloque tous les déploiements. Fix : `data "scaleway_account_project"` (projet du domaine TEM) → `organization_id` explicite. |

