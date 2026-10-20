# Forged Idea: Cookieless Server-Side Tracking (SDRnow)

## Locked Decisions

- **Deux points d'entrée sans aucun `?` dans l'URL :**
  - **Prospect identifié (`/pour/<slug>` ou `/offre/<slug>` en FR, `/en/for/<slug>` en EN) :** Réécriture serveur transparente vers `index.html` avec en-tête `X-Robots-Tag: noindex, nofollow`. Créé à la volée par Jean-Charles sans configuration préalable. Conserve le slug en cas de copier-coller de l'URL vers un autre décideur.
  - **Visiteur anonyme (`/` ou `/en`) :** L'URL reste vierge. Corrélation de la consultation (et des revisites de la journée) côté serveur via `anon_id = SHA256(sel_du_jour + IP + User-Agent).slice(0, 8)` renouvelé à minuit.
- **Classification serveur à 3 niveaux (anti-faux positifs) :**
  1. *Bots / Prévisualisations (LinkedInBot, Slackbot, SafeLinks)* : `GET` HTML seul sans chargement CSS/logo dans la foulée ou `User-Agent` bot → exclus des visites humaines et des alertes.
  2. *Humain sous Adblock / Sans JS* : `GET` HTML + chargement CSS/logo sans ping JS → comptabilisé dans les stats (« JS/Adblock filtré »), déclenche l'alerte prospect et trace les clics CTA.
  3. *Humain avec télémétrie complète* : Idem + pings JS furtifs via `POST /health` (payload `< 512 octets`, rate-limité par IP).
- **Signaux comportementaux B2B captés & Redirections par carte d'offre :**
  - Redirections HTTP 302 propres via une table de routage par offre (`CTA_TARGETS`) sur `/rdv/decouverte`, `/rdv/starter`, `/rdv/strategy` (et `/en/book/discovery|starter|strategy`), permettant de rediriger chaque carte vers sa propre cible (Calendly aujourd'hui, et paiement intermédiaire pour une future 3e carte).
  - Partage interne multi-décideurs (plusieurs `anon_id` distincts sur un même `/pour/<slug>`) et revisites décalées (J+N).
  - Temps de lecture actif réel (`visibilityState`), vue de la section `Pricing`, copie (`Ctrl+C`) dans `Pricing`, clic/copie téléphone (`06 67 90 24 94`) ou email, switch `FR` ↔ `EN`, clic `/mentions-legales`, et impression/export PDF (`beforeprint`).
- **Infra légère sur `STARDUST1-S` (1 Go RAM) :**
  - Intégré à `infra/staging-server.js` (Node 20 natif, zéro dépendance npm), stockage append-only dans `/etc/sdrnow/analytics.jsonl` (survit aux déploiements Git).
  - Vue `staging.sdrnow.fr/stats` protégée par la Basic Auth existante (Radar Prospects + Audience Anonyme / % Adblock / Entonnoir CTA).
- **Alertes Email par API HTTPS Scaleway Transactional Email (TEM) & DNS SPF/DKIM/DMARC :**
  - Provisionnement de `scaleway_tem_domain` dans `infra/main.tf` (SPF/DKIM/DMARC) et envoi via `fetch()` HTTPS (port 443) en réutilisant `SCW_SECRET_KEY` et `SCW_DEFAULT_PROJECT_ID` déjà présents dans `deploy.yml`.
  - *Sur `/pour/<slug>`* : Alerte « Prospect Chaud » groupée en fin de session (debounce 2 min après le dernier signal humain).
  - *Sur `/` (anonyme)* : Digest quotidien envoyé à minuit (à la rotation du `sel_du_jour`) **uniquement si $\ge 1$ visite humaine anonyme** a eu lieu dans la journée.
- **Cadre légal (`src/i18n/translations.json` → `legal.s4_text` FR/EN) :**
  - Zéro bandeau cookie (exemption ePrivacy Art. 82).
  - Remplacement de la phrase actuelle (« ne collecte aucune donnée à l'insu… ») par la mention de l'absence totale de cookies et du suivi serveur B2B sur intérêt légitime (RGPD Art. 6.1.f) avec droit d'opposition à `jcm@sdrnow.fr`.

## Rejected Options

- **Paramètres de tracking dans l'URL (`?v=`, `?ref=`, `?cta=`) :** Rejeté car trahit immédiatement le pistage dans la barre d'adresse et au survol des boutons.
- **Réécriture catch-all à la racine (`sdrnow.fr/<slug>`) sans préfixe :** Rejeté car avalerait tous les scanners de vulnérabilités (`GET /wp-admin`, `GET /login`) en faux prospects.
- **Génération d'une URL de session aléatoire à la volée pour les visiteurs anonymes (`/` → `/v/8f3a`) :** Rejeté car dégrade la confiance, inutile grâce à `anon_id` côté serveur, et assimilé à du *URL decoration* (traceur) par la CNIL.
- **Stack OpenTelemetry + Grafana/Loki/ClickHouse :** Rejeté car ferait crasher l'instance `STARDUST1-S` (1 Go RAM) par OOM et offre une UX DevOps inadaptée à un commercial.
- **Envoi d'emails en SMTP direct depuis l'IP de la VM (port 25/465/587) :** Rejeté car bloqué par défaut sur Scaleway Stardust et mauvaise réputation IP des sous-réseaux VPS face à Outlook/Gmail.
- **Envoi du digest de minuit les jours à 0 visite humaine :** Rejeté pour éviter la fatigue d'alerte.
- **Heatmaps souris et scroll au pixel près :** Rejeté comme bruit non actionnable.
