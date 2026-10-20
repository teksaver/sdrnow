# Conventions & Implementation Contract — Suivi Prospects & Audience Server-Side Sans Cookies

## 1. Routage Caddy (`infra/Caddyfile.template`), Réécritures & Redirections par Offre

- **Liens prospects personnalisés (`CAP-1`) :**
  - Chemins FR : `/pour/<slug>` et `/offre/<slug>` (où `<slug>` respecte `^[a-zA-Z0-9_-]{2,64}$`).
  - Chemins EN : `/en/for/<slug>` et `/en/offer/<slug>`.
  - Traitement serveur : ajout de l'en-tête `X-Robots-Tag: noindex, nofollow`, notification asynchrone (ou proxy) vers `127.0.0.1:3001` avec l'URL originale, l'IP réelle (`X-Forwarded-For`), le `User-Agent` et le `Referer`, et service transparent de `/index.html` (FR) ou `/en/index.html` (EN) avec statut `200 OK` sans redirection `301/302`.
  - Tout autre chemin inexistant à la racine (`/wp-admin`, `/login`, `/.env`) conserve le comportement `=404`.
- **Routes de redirection CTA par carte d'offre (`CAP-4`) :**
  - FR : `/rdv/decouverte` (Hero), `/rdv/starter` (Package Starter), `/rdv/strategy` (Package Strategy).
  - EN : `/en/book/discovery` (Hero), `/en/book/starter` (Package Starter), `/en/book/strategy` (Package Strategy).
  - Table de routage serveur `CTA_TARGETS` dans `infra/staging-server.js` : chaque clé d'offre (`hero`, `starter`, `strategy`, et toute future carte telle qu'une offre avec paiement intermédiaire) est associée à son URL de destination propre (configurable via `/etc/sdrnow/staging.env`, avec pour valeur par défaut actuelle `https://calendly.com/jc-maleysson/30min`).
  - Traitement serveur : proxifiées vers `127.0.0.1:3001`, qui enregistre l'événement `cta_click` (`hero` | `starter` | `strategy`) rattaché au visiteur et répond immédiatement par `302 Found` vers `CTA_TARGETS[offer]` avec `Cache-Control: no-store`.
- **Endpoint furtif de télémétrie JS (`CAP-3`, `CAP-4`) :**
  - `POST /health` sur `sdrnow.fr` est proxifié vers `127.0.0.1:3001/health` (traité dans `infra/staging-server.js` **avant** le contrôle d'authentification Basic Auth / preview cookie de staging, et sans jamais émettre d'en-tête `Set-Cookie`).

## 2. Corrélation d'Identité Éphémère & Classification à 3 Niveaux (`CAP-2`, `CAP-3`)

- **Hachage journalier sans cookie (`anon_id`) :**
  - `anon_id = HMAC-SHA256(daily_secret, "${client_ip}|${user_agent}").slice(0, 8)`.
  - `daily_secret` est régénéré automatiquement chaque nuit à `00:00` (Europe/Paris) en mémoire dans `staging-server.js` (jamais écrit sur disque, rendant impossible toute ré-identification d'IP a posteriori).
- **Rattachement d'un prospect (`prospect_slug`) :**
  - Lorsqu'un `anon_id` ouvre `/pour/<slug>` (ou `/offre/<slug>`, `/en/for/<slug>`), l'association `anon_id -> slug` est mémorisée en RAM pour la journée afin que les requêtes suivantes du même visiteur (chargement CSS, `POST /health`, clic `/rdv/...`, bascule `/en`, clic `/mentions-legales`) soient automatiquement rattachées à `<slug>` même si le `Referer` est omis.
- **Classification à 3 niveaux :**
  1. **Niveau 1 — Robot / Prévisualisation (filtré) :** `User-Agent` correspondant au pattern `/bot|crawl|spider|slurp|linkedinbot|slackbot|whatsapp|facebot|twitterbot|telegrambot|discordbot|applebot|bingpreview|headlesschrome|lighthouse|curl|wget|python|go-http-client|safelinks|mimecast|urlscan/i` **ou** requête HTML initiale (`GET /...`) non suivie ni d'une requête d'asset de rendu (CSS/logo) ni d'un `POST /health`.
  2. **Niveau 2 — Humain sous Adblock / Sans JS :** Requête HTML initiale suivie du chargement d'au moins un asset de rendu (CSS/logo) par le même `anon_id`, sans aucun `POST /health` reçu.
  3. **Niveau 3 — Humain avec Télémétrie complète :** Réception d'au moins un `POST /health` valide.

## 3. Protocole de la Balise Client Légère & Route `/health` (`CAP-4`)

- **Payload `POST /health` (`navigator.sendBeacon` ou `fetch(..., { keepalive: true })`) :**
  - Taille maximale acceptée par le serveur : `512 octets` (au-delà : `413 Payload Too Large`).
  - Rate-limit en mémoire dans `staging-server.js` : maximum 30 requêtes `/health` par minute et par IP.
  - Format JSON minimal :
    `{ "e": "<event_type>", "p": "<pathname>", "d": <active_seconds>, "t": "<target_detail>" }`
- **Types d'événements (`e`) :**
  - `"init"` : ouverture de la page côté JS (bascule la visite en Niveau 3).
  - `"pricing_view"` : entrée de la section `Pricing.astro` dans le viewport (`IntersectionObserver`, déclenché une seule fois par chargement).
  - `"copy"` : événement `copy` (`Ctrl+C`) déclenché dans la section `Pricing` (`t: "starter" | "strategy" | "pricing"`, sans jamais lire le contenu du presse-papier) ou sur les coordonnées (`t: "phone" | "email"`).
  - `"contact"` : clic sur `tel:0667902494` (`t: "phone"`) ou `mailto:jcm@sdrnow.fr` (`t: "email"`).
  - `"lang_switch"` : clic sur le sélecteur `FR` / `EN`.
  - `"print"` : déclenchement de `window.onbeforeprint`.
  - `"ping"` : émis lors de `visibilitychange` (`hidden`) ou `pagehide` avec le cumul exact de secondes où `document.visibilityState === 'visible'` (`d`).

## 4. Stockage `/etc/sdrnow/analytics.jsonl`, Vue `/stats` & Alertes Scaleway TEM (`CAP-5`)

- **Stockage append-only :**
  - Fichier `/etc/sdrnow/analytics.jsonl` (un objet JSON par ligne : `ts`, `date`, `anon_id`, `slug`, `tier`, `event`, `target`, `duration`, `lang`, `referer`, `ua_family`).
- **Interface `staging.sdrnow.fr/stats` (réservée à `isAdmin` Basic Auth) :**
  - **Section 1 — Radar Prospects (`/pour/<slug>`) :** tableau trié par dernière activité affichant le slug prospect, la date/heure, le nombre d'appareils distincts (`anon_id` uniques → badge « Partage interne » dès $\ge 2$), le nombre de revisites, le temps de lecture actif cumulé, et les badges d'actions (`Tarifs vus`, `Copie tarif`, `Téléphone`, `Mentions légales`, `Export PDF`, `Clic RDV Hero/Starter/Strategy`).
  - **Section 2 — Audience Anonyme & Entonnoir :** visiteurs humains uniques par jour (ventilés en *Télémétrie complète* vs *Adblock / Sans JS*), compteur de *Bots / Prévisualisations filtrés*, top origines (`Referer`), et taux de conversion comparé des boutons CTA (`Hero` vs `Starter` vs `Strategy`).
- **Envoi d'Emails via Scaleway Transactional Email (TEM) & Configuration DNS (`SPF` / `DKIM` / `DMARC`) :**
  - **Provisionnement OpenTofu (`infra/main.tf`) :** Déclaration de la ressource `scaleway_tem_domain` (région `fr-par`, domaine `sdrnow.fr`) et exposition en `output` des enregistrements TXT `spf_config`, `dkim_config` et `dmarc` (ou création automatique via `scaleway_domain_record` si la zone DNS est gérée sur Scaleway Domains).
  - **Appel API HTTPS depuis la VM (`infra/staging-server.js`) :** Requête `POST https://api.scaleway.com/transactional-email/v1alpha1/regions/fr-par/emails` via `fetch()` natif Node 20 (port 443) authentifiée par `X-Auth-Token: process.env.SCW_SECRET_KEY` avec `project_id: process.env.SCW_DEFAULT_PROJECT_ID` (variables déjà présentes dans `.github/workflows/deploy.yml` et injectées dans `/etc/sdrnow/staging.env`).
  - **Configuration et confidentialité des destinataires (`ALERT_EMAIL_TO`) :** La variable ou le secret GitHub `ALERT_EMAIL_TO` (`${{ vars.ALERT_EMAIL_TO || secrets.ALERT_EMAIL_TO || 'jcm@sdrnow.fr' }}` dans `.github/workflows/deploy.yml`, injectée dans `/etc/sdrnow/staging.env`) accepte une ou plusieurs adresses séparées par des virgules (ex. `jcm@sdrnow.fr,copie@domaine.fr`). Pour garantir que les destinataires ne soient jamais visibles l'un pour l'autre dans les en-têtes `To:`/`Cc:`, `staging-server.js` boucle sur chaque adresse et déclenche **un envoi Scaleway TEM individuel distinct par destinataire** (`to: [{ email: recipient }]`).
  - **Alerte « Prospect Chaud » (debounce 2 min) :** déclenchée uniquement lorsqu'une visite sur un lien prospect (`slug != null`) atteint le Niveau 2 ou 3 ; un timer de 120 secondes (réinitialisé à chaque nouvel événement de ce prospect) envoie un unique email récapitulatif aux destinataires de `ALERT_EMAIL_TO`.
  - **Digest Anonyme de Minuit (conditionnel) :** lors de la rotation du `daily_secret` à `00:00` (Europe/Paris), si le nombre de visiteurs humains anonymes (`slug == null`, Niveau 2 ou 3) de la journée écoulée est $\ge 1$, envoi d'un email de synthèse (avec les compteurs clés dans l'objet du mail). Si `0` visiteur humain anonyme, aucun email n'est envoyé.

## 5. Mentions Légales `src/i18n/translations.json` (`CAP-6`)

- **`fr` → `legal.s4_text` :**
  `"Le site sdrnow.fr ne dépose aucun cookie ni traceur tiers sur votre terminal. Dans le cadre de nos échanges commerciaux B2B (intérêt légitime), la consultation du site depuis un lien de prospection peut être enregistrée côté serveur afin d'assurer le suivi de votre dossier. Vous pouvez exercer vos droits d'accès, d'opposition ou de suppression à tout moment en écrivant à jcm@sdrnow.fr. La prise de rendez-vous est gérée par la plateforme tierce Calendly, soumise à sa propre politique de confidentialité."`
- **`en` → `legal.s4_text` :**
  `"The sdrnow.fr website does not place any cookies or third-party trackers on your device. As part of our B2B commercial exchanges (legitimate interest), visits originating from an outreach link may be logged server-side to follow up on your inquiry. You may exercise your rights of access, objection, or deletion at any time by writing to jcm@sdrnow.fr. Meeting scheduling is managed by the third-party platform Calendly, subject to its own privacy policy."`
