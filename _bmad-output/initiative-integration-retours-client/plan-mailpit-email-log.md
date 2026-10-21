---
title: 'Capture des emails par Mailpit et journal d''envoi affiché dans /stats'
type: 'feature'
ticket: ''
created: '2026-10-20'
status: 'built'
baseline_revision: '05db13b1bcfdf9432fd86817fdf2d1625880180b'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context:
  - '_bmad-output/initiative-integration-retours-client/plan-stats-prod-staging.md'
  - '_bmad-output/initiative-integration-retours-client/ux-cookieless-server-tracking/DESIGN.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Les alertes « Prospect Chaud » et le digest de minuit ne partent nulle part tant que l'offre Scaleway TEM n'est pas activée, staging n'en produit aucun, et rien ne garde trace des emails : impossible de vérifier leur contenu ni, plus tard, de savoir ce qui a été envoyé (l'API TEM ne conserve ni le contenu ni de durée de rétention documentée).

**Approach:** Installer sur la VM une instance Mailpit partagée (capture sans livraison, UI `staging.sdrnow.fr/mail/` derrière le mot de passe admin) qui reçoit tous les emails de staging (toujours) et de la prod (tant que TEM n'est pas actif, puis en copie des envois TEM), et tenir un journal d'envoi local affiché dans une section « 📬 Emails envoyés » de chaque `<site>/stats`.

## Boundaries & Constraints

**Always:**
- Mailpit `v1.31.6`, archive `mailpit-linux-amd64.tar.gz` vérifiée par SHA-256 `10fa12ccc610f653d4ed4df848c1817f9935dcf4e9a6a458a19ab0fa02093f91` avant installation dans `/usr/local/bin/mailpit` ; installation idempotente (ne retélécharge pas si la version installée est déjà la bonne).
- Service systemd `mailpit` (`User=caddy`, `StateDirectory=mailpit`) : `--listen 127.0.0.1:8025 --smtp 127.0.0.1:1025 --webroot /mail/ --database /var/lib/mailpit/mailpit.db --max 1000 --ui-auth-file /etc/sdrnow/mailpit-ui.htpasswd --send-api-auth-accept-any --disable-version-check` ; aucune configuration de relais : Mailpit ne livre jamais rien.
- UI : `staging.sdrnow.fr/mail/` proxifié par Caddy vers `127.0.0.1:8025` ; fichier htpasswd généré par la CI avec les utilisateurs `admin` et `client` et le hash bcrypt du mot de passe staging déjà calculé (`STAGING_PASSWORD_HASH`), mode `0600`, propriétaire `caddy`. `staging.sdrnow.fr/mail/api/v1/send` est bloqué par Caddy (`403`) : seul Node l'appelle, en direct sur `127.0.0.1:8025`.
- Node envoie à Mailpit via `POST {MAILPIT_URL}/api/v1/send` (`MAILPIT_URL` par défaut `http://127.0.0.1:8025/mail`), corps `{ From: {Email, Name}, To: [{Email}], Subject, Text, HTML, Tags }`, réponse `{ ID }` ; un envoi par destinataire, comme pour TEM.
- Voies : staging → toujours Mailpit, objet préfixé `[STAGING] `, tag `staging` (alertes et digest réactivés côté staging, mais uniquement vers Mailpit) ; prod sans clé TEM → Mailpit, tag `prod` ; prod avec clé TEM → TEM **et** copie Mailpit, tags `prod`, `tem`.
- Journal d'envoi append-only `EMAIL_LOG_FILE` (défaut `/etc/sdrnow/email-log.jsonl`), une ligne par tentative et par voie : `ts`, `site` (`prod`|`staging`), `kind` (`alert`|`digest`), `ref` (slug ou date), `to`, `subject`, `transport` (`mailpit`|`tem`), `ok`, `error`, `id` (ID Mailpit ou TEM).
- Chaque `<site>/stats` affiche les 50 dernières lignes de **son** site dans une section « 📬 Emails envoyés » (date, type, objet, destinataire, voie, résultat ✅/❌) avec un lien vers `https://staging.sdrnow.fr/mail/` pour lire le contenu.
- Un échec Mailpit ou TEM est journalisé (`ok: false`, message d'erreur) sans bloquer le serveur ni l'autre voie.
- Ordre de déploiement : Mailpit installé et démarré avant le redémarrage de Node, puis rechargement de Caddy.

**Never:**
- Relais SMTP, SMTP sortant, ou livraison réelle depuis staging.
- IP ou contenu HTML des emails dans le journal d'envoi.
- Modifier la branche `feat/email-alerts-tem` dans ce changement.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Alerte staging | visite de test humaine sur `staging.sdrnow.fr/pour/acme`, 120 s d'inactivité | 1 envoi Mailpit par destinataire, objet `[STAGING] 🔥 [SDRnow] acme …`, tag `staging` ; lignes journal `site: staging`, `transport: mailpit`, `ok: true`, `id` | Mailpit injoignable → `ok: false`, `error` renseigné, aucun crash |
| Alerte prod sans TEM | visite humaine sur `sdrnow.fr/pour/acme`, pas de `TEM_SECRET_KEY` | envoi Mailpit tag `prod`, aucun appel TEM, journal `site: prod` | idem |
| Alerte prod avec TEM | même visite, clé TEM présente | envoi TEM (id TEM journalisé) + copie Mailpit tags `prod`,`tem` : 2 lignes par destinataire | échec TEM → ligne `tem` `ok: false`, la copie Mailpit part quand même |
| Digest staging | rotation de minuit, ≥ 1 visite de test humaine | digest vers Mailpit, objet préfixé `[STAGING] ` | 0 visite → aucun envoi, aucune ligne |
| Section stats | `GET sdrnow.fr/stats` admin | section « 📬 Emails envoyés » avec les lignes `site: prod` uniquement, lien vers l'UI Mailpit | journal absent → état vide explicite |
| Send API exposée | `POST https://staging.sdrnow.fr/mail/api/v1/send` | `403` (Caddy) | — |

</frozen-after-approval>

## Code Map

- `infra/staging-server.js` -- `sendTemEmail` (~L797) : renvoyer l'ID TEM de la réponse (`emails[0].id`) au lieu de `true` ; `createTracker` (~L1268) : options `emailsDisabled` / `sendEmail` / `emailEnabled` / `deliver` (~L1343) / `rotateIfNeeded` (skip digest si `emailsDisabled`) → remplacer `emailsDisabled` par un paramètre de site (`site: 'prod'|'staging'`) et des voies injectables (`sendMailpit`, `sendEmail` pour TEM) + écriture du journal d'envoi ; `buildProspectAlertEmail` / `buildDigestEmail` inchangés (préfixe ajouté au moment de l'envoi staging). `renderStatsPage` : nouvelle section. `createRequestHandler` : le tracker staging de repli (~L1914) et `startServer` (~L2611) passent le site et les voies. Config env en tête de fichier (~L22-31) : `MAILPIT_URL`, `EMAIL_LOG_FILE`.
- `infra/mailpit.service` -- nouveau fichier, modèle : `infra/sdrnow-staging.service`.
- `infra/Caddyfile.template` -- bloc `staging.sdrnow.fr` (aujourd'hui un seul `reverse_proxy 127.0.0.1:3001`) : ajouter le blocage de `/mail/api/v1/send` puis `handle /mail*` → `127.0.0.1:8025`, le reste vers Node.
- `.github/workflows/deploy.yml` -- étape 6 (scp de `staging-server.js`) / 7 (unité systemd) / 8 (`staging.env`, variable `STAGING_PASSWORD_HASH` disponible dans `env`) / 8b (restart Node puis reload Caddy) : insérer installation Mailpit + htpasswd + unité `mailpit` avant 8b ; ajouter `MAILPIT_URL` et `EMAIL_LOG_FILE` à `staging.env`. Attention aux `$` du hash bcrypt : écrire le fichier localement puis `scp`, jamais via une chaîne interpolée dans `ssh "..."`. Si `STAGING_PASSWORD_HASH` ne commence pas par `$2` (anciennes versions de `caddy hash-password` l'encodaient en base64), le décoder avant de l'écrire.
- `tests/staging-server.test.js` -- helpers `setupTracking` / `makeTracker` (voies injectées) ; tests existants d'alerte, de digest, « no email from staging » (à adapter : staging envoie désormais vers Mailpit seulement) et « without a TEM key, emails stay dormant » (à adapter : prod sans TEM → Mailpit).
- Ne pas toucher : `src/`, `infra/main.tf`.

## Tasks & Acceptance

**Execution:**
- [x] `infra/staging-server.js` -- voies Mailpit/TEM par site, préfixe et tags, journal d'envoi, ID TEM, section « 📬 Emails envoyés » dans `renderStatsPage`, config `MAILPIT_URL` / `EMAIL_LOG_FILE` -- cœur du changement.
- [x] `infra/mailpit.service` -- unité systemd selon les Boundaries -- service de capture.
- [x] `infra/Caddyfile.template` -- `/mail/` vers Mailpit sur staging, `403` sur la Send API -- accès à l'UI.
- [x] `.github/workflows/deploy.yml` -- installation vérifiée par checksum, htpasswd, unité, ordre de démarrage, variables -- déploiement.
- [x] `tests/staging-server.test.js` -- une ligne de test par ligne serveur de la matrice (la ligne Caddy est vérifiée manuellement) -- non-régression.

**Acceptance Criteria:**
- Given le journal d'envoi contenant des lignes des deux sites, when chaque `/stats` est affiché, then chacun ne montre que les lignes de son site.
- Given la suite existante, when elle tourne, then les tests de l'éditeur, du tracking et des stats passent, seuls les tests d'envoi d'email étant adaptés aux nouvelles voies.

## Implementation Notes

- `createTracker` : option `site` (`prod` | `staging`) remplace `emailsDisabled` ; voies injectables `sendMailpit` (défaut `sendMailpitEmail`) et `sendEmail` (TEM). TEM n'est actif qu'en prod (`sendEmail` injecté ou clé TEM présente) ; Mailpit reçoit toujours. Les deux envois partent en parallèle et chacun écrit sa propre ligne de journal : un échec de l'un ne bloque jamais l'autre. Les erreurs sont préfixées `[TEM]` ou `[Mailpit]` dans la console.
- Journal d'envoi : un seul fichier pour les deux sites (`EMAIL_LOG_FILE`), filtré par `site` à la lecture (`tracker.emailLog()`, les 50 dernières lignes, les plus récentes d'abord, lignes corrompues ignorées). Par défaut il est créé à côté d'un `analyticsFile` injecté (tests et outils), jamais dans `/etc/sdrnow`. Le tracker staging de repli partage le fichier du tracker prod.
- `sendTemEmail` renvoie `emails[0].id` (ou `null` si la réponse est illisible) ; `sendMailpitEmail` renvoie l'`ID` Mailpit, avec un délai maximal de 10 s.
- `/stats` : section « 📬 3. Emails envoyés » (date, type + ref, objet, destinataire, voie, ✅/❌ avec l'erreur), lien vers `https://staging.sdrnow.fr/mail/`, état vide explicite. Sur la page staging, les sous-titres indiquent désormais que les emails sont « capturés par Mailpit, jamais livrés ».
- Déploiement, étape 8a : script d'installation écrit localement (heredoc entre quotes), copié par scp puis exécuté avec `sudo bash`. Le htpasswd est écrit localement à partir de `$STAGING_PASSWORD_HASH` (décodé en base64 s'il ne commence pas par `$2`, refusé si ce n'est pas du bcrypt), puis copié et installé en `0600 caddy:caddy`. Une vérification de démarrage non bloquante (`/mail/readyz`) émet un `::warning::` en cas d'échec. Un échec du checksum ou de l'installation fait échouer le déploiement.
- Vérifié hors CI : SHA-256 de l'archive linux-amd64 v1.31.6 conforme ; script d'installation exécuté deux fois dans un conteneur ubuntu:24.04 amd64 (« installé » puis « déjà installé ») ; Mailpit v1.31.6 lancé localement avec les drapeaux exacts de l'unité, puis UI et API testées (`401` sans authentification, `200` avec un hash `caddy hash-password` en `$2a$14$` pour `admin` et `client`) ; Caddyfile validé et testé avec Caddy 2.10.2 (`/mail/api/v1/send`, `/MAIL/...`, `//mail/...`, `%73end`, `../` → `403`) ; tracker staging réel → Mailpit réel : objet `[STAGING] 🔥…`, tag `staging`, ID journalisé ; Mailpit sur un port fermé → `ok: false`, `fetch failed (ECONNREFUSED)`.

## Plan Change Log

## Review Triage Log

## Verification

**Commands:**
- `node --test tests/staging-server.test.js` -- expected: tous verts.
- `npm run build` -- expected: succès.

**Manual checks (if no CLI):**
- Après déploiement : `systemctl status mailpit` actif ; `https://staging.sdrnow.fr/mail/` demande le mot de passe admin puis affiche l'UI ; `curl -X POST https://staging.sdrnow.fr/mail/api/v1/send` → `403` ; une visite de test sur `staging.sdrnow.fr/pour/test` puis 2 min d'attente → email `[STAGING]` visible dans Mailpit et ligne ✅ dans `staging.sdrnow.fr/stats`.

### Passe 1 (lens `quick`) — high 0 / medium 1 / low 3 / false 0 / maybe-false 0

| # | Verdict | Route | Constat & évidence |
|---|---|---|---|
| 1 | medium | patch | Les trackers staging n'ont pas de `statsUrl` : chaque email `[STAGING]` capté par Mailpit renvoie vers `https://sdrnow.fr/stats`, qui n'affiche jamais les visites de test. Fix : `statsUrl` staging sur les deux trackers staging + assertion. |
| 2 | low | patch | `renderEmailRow` utilise les badges `cta` / `hot`, réservés par DESIGN.md aux clics `/rdv/*` et aux signaux multi-appareils/revisites. Fix direct : badge neutre avec ✅/❌. |
| 3 | low | patch | Une ligne JSON valide avec `ts` invalide fait lever `RangeError` dans `formatLastVisit`, non rattrapée dans le handler async → arrêt du process Node (prod + staging) à chaque `/stats`. Improbable (le journal n'est écrit que par le serveur) mais impact fort ; fix direct : filtre dans `readEmailLog` + test. |
| 4 | low | patch | Avec seulement `stagingAnalyticsFile` injecté (tests éditeur), le journal d'envoi retombe sur `/etc/sdrnow/email-log.jsonl`. Fix direct : défaut à côté de `stagingAnalyticsFile`. |
