---
id: SPEC-cookieless-server-tracking
companions:
  - conventions.md
  - ../ux-cookieless-server-tracking/DESIGN.md
  - ../ux-cookieless-server-tracking/EXPERIENCE.md
sources:
  - ../forge-cookieless-server-tracking/forge-cookieless-server-tracking.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Suivi Prospects & Audience Server-Side Sans Cookies (SDRnow)

## Why

**Pain to solve & opportunity to capture.** Le fondateur de SDRnow (Jean-Charles) doit savoir quand un prospect B2B ciblé consulte la landing page, partage le lien en interne à d'autres décideurs ou s'intéresse à une offre précise, tout en mesurant le volume, l'origine et le comportement de l'audience anonyme — sans imposer de bandeau cookie sur la page ni alourdir l'instance Scaleway `STARDUST1-S` (1 Go RAM).

## Capabilities

- **CAP-1**
  - **intent:** Le commercial peut adresser à n'importe quel prospect un lien personnalisé d'apparence naturelle sans déclaration préalable, afin de suivre ses consultations, ses revisites dans le temps et le partage interne du lien à d'autres décideurs sans déposer de cookie ni afficher de paramètre de tracking.
  - **success:** Ouvrir `/pour/<slug>` ou `/offre/<slug>` (ou `/en/for/<slug>`) sert la page d'accueil dans la langue correspondante en conservant l'URL propre dans la barre d'adresse, émet l'en-tête `X-Robots-Tag: noindex, nofollow`, rattache la consultation au prospect `<slug>`, comptabilise séparément chaque appareil (`anon_id`) ayant ouvert ce lien (signalant un partage multi-décideurs dès $\ge 2$ appareils distincts) ainsi que les revisites à J+N, tandis que tout chemin inconnu hors préfixe autorisé (ex. `/wp-admin`, `/login`) renvoie `404`.

- **CAP-2**
  - **intent:** Le système peut reconstituer le parcours complet et les revisites journalières d'un visiteur arrivant sur l'URL générique du site sans modifier l'URL affichée ni stocker d'identifiant sur son terminal.
  - **success:** Un visiteur naviguant sur `/` ou `/en` conserve une barre d'adresse vierge de tout identifiant ; toutes ses requêtes et interactions de la journée sont rattachées côté serveur au même identifiant éphémère `anon_id = SHA256(sel_du_jour + IP + User-Agent).slice(0, 8)`, lequel est automatiquement réinitialisé à minuit lors de la rotation du sel journalier.

- **CAP-3**
  - **intent:** Le système peut distinguer automatiquement les robots de prévisualisation, les visiteurs humains équipés d'un bloqueur de scripts/publicités et les visiteurs humains avec télémétrie complète, afin de garantir des statistiques exactes et d'éviter toute fausse alerte d'ouverture.
  - **success:** Une requête HTML seule non suivie du chargement des assets de rendu (CSS/logo) ou émise par un `User-Agent` de robot connu (`LinkedInBot`, `Slackbot`, `SafeLinks`, etc.) est classée « Robot / Prévisualisation » et n'incrémente ni les visites humaines ni les alertes ; une visite chargeant le HTML et le CSS/logo sans émettre de ping JS est comptabilisée sous « Visiteur Humain — JS/Adblock filtré » ; une visite émettant les pings JS sur la route furtive `/health` est comptabilisée en « Télémétrie complète ».

- **CAP-4**
  - **intent:** Le système peut mesurer l'engagement réel d'un visiteur (choix de l'offre et redirection vers la cible propre à chaque carte, temps de lecture actif, lecture des tarifs, copie des offres, prise de contact directe, changement de langue, vérification juridique et export PDF) sans exposer d'URL de tracking.
  - **success:** Cliquer sur un bouton d'appel à l'action passe par une route propre dédiée à chaque offre (`/rdv/decouverte`, `/rdv/starter`, `/rdv/strategy` et équivalents `/en/book/...`) qui enregistre l'offre cliquée côté serveur (même sous Adblock/Sans-JS) avant de rediriger en HTTP 302 vers l'URL cible configurée pour cette offre dans la table de routage serveur (extensible à une future carte avec étape de paiement intermédiaire) ; lorsque JS est actif, le temps de lecture onglet visible (`visibilityState`), la vue de la section `Pricing`, la copie (`Ctrl+C`) dans `Pricing`, le clic/copie du téléphone (`06 67 90 24 94`) ou de l'email (`jcm@sdrnow.fr`), le switch `FR` ↔ `EN`, l'ouverture des mentions légales et l'impression/export PDF (`beforeprint`) sont rattachés à la visite via `POST /health`.

- **CAP-5**
  - **intent:** L'administrateur peut consulter l'activité détaillée des prospects et de l'audience anonyme sur une interface dédiée et recevoir par email (signé SPF/DKIM/DMARC via Scaleway Transactional Email) des alertes d'ouverture prospect groupées ainsi qu'un bilan quotidien conditionnel des visites anonymes.
  - **success:** `staging.sdrnow.fr/stats` (protégé par Basic Auth `admin`) affiche le Radar Prospects (`/pour/<slug>`, multi-appareils, chronologie, actions) et les statistiques d'audience anonyme (visiteurs uniques, origines, % Adblock, bots filtrés, entonnoir des CTAs) ; toute visite humaine (niveau 2 ou 3) sur un lien prospect déclenche un unique email récapitulatif groupé après 2 minutes d'inactivité via l'API HTTPS Scaleway TEM ; à minuit, un email de digest anonyme est envoyé uniquement si $\ge 1$ visite humaine anonyme a eu lieu dans la journée (aucun email envoyé si 0 visite humaine).

- **CAP-6**
  - **intent:** Le visiteur peut consulter dans les mentions légales (FR et EN) une information exacte confirmant l'absence totale de cookies tout en déclarant le suivi serveur des liens de prospection B2B sur la base de l'intérêt légitime.
  - **success:** Aucune bannière de consentement n'est affichée sur le site ; la section 4 des mentions légales (`legal.s4_text` FR/EN dans `src/i18n/translations.json`) remplace l'ancienne mention (« ne collecte aucune donnée à l'insu… ») par l'affirmation du zéro cookie/traceur sur le terminal et la déclaration du suivi serveur B2B (intérêt légitime, RGPD Art. 6.1.f) avec droit d'opposition à `jcm@sdrnow.fr`.

## Constraints

- **Zéro cookie, zéro stockage navigateur & zéro bandeau :** Aucune écriture ni lecture dans `document.cookie`, `localStorage`, `sessionStorage` ou `IndexedDB` sur `sdrnow.fr`.
- **Zéro paramètre `?` de tracking ni décoration d'URL anonyme :** Aucun `?v=`, `?ref=` ou `?cta=` dans les liens prospects ou boutons CTA ; aucune redirection de `/` vers une URL de session générée à la volée pour les visiteurs anonymes.
- **Empreinte `STARDUST1-S` (1 vCPU, 1 Go RAM, 10 Go SSD) & survivance aux déploiements :** Implémentation intégrée à `infra/staging-server.js` (Node 20 natif, zéro dépendance `npm` supplémentaire) avec persistance append-only dans `/etc/sdrnow/analytics.jsonl` (hors des répertoires `/var/www/html` et `/var/www/staging` purgés par `deploy.yml`).
- **Télémétrie furtive sécurisée & emails via API HTTPS Scaleway TEM :** Les pings JS utilisent la route first-party `/health` (payload limité à `< 512 octets`, rate-limité par IP en mémoire) ; les emails sortants passent exclusivement par l'API HTTPS Scaleway Transactional Email (`fr-par`, port 443 via `fetch()` natif en réutilisant `SCW_SECRET_KEY` / `SCW_DEFAULT_PROJECT_ID`) avec authentification DNS SPF/DKIM/DMARC déclarée dans `infra/main.tf` (`scaleway_tem_domain`), sans jamais utiliser de SMTP direct depuis l'IP de la VM.

## Non-goals

- Déployer une stack d'observabilité externe ou conteneurisée (OpenTelemetry Collector, Grafana, Loki, ClickHouse, Plausible, Matomo, Docker) ou un serveur SMTP local (Postfix/Exim) sur la VM.
- Enregistrer des heatmaps de mouvements de souris, des replays de session ou la profondeur de scroll au pixel près.
- Identifier nominativement les entreprises visitant l'URL générique `/` par résolution IP-to-Company / Reverse DNS.
- Envoyer des emails de bilan quotidien les jours ne comptant aucune visite humaine anonyme.

## Success signal

Jean-Charles envoie `https://sdrnow.fr/pour/acme` dans un message LinkedIn : le robot `LinkedInBot` qui prévisualise le lien est filtré (0 fausse alerte). Dix minutes plus tard, le prospect ouvre le lien sur iPhone, consulte les tarifs, copie le bloc *Starter 1 990 €*, puis transfère l'URL `https://sdrnow.fr/pour/acme` à son DG qui l'ouvre sur Mac et clique sur le bouton *Starter* (`/rdv/starter` → redirection 302 vers la cible de l'offre). Deux minutes après la fin de consultation, Jean-Charles reçoit via Scaleway TEM un email récapitulatif unique (signé DKIM/SPF) signalant l'ouverture d'`acme` sur 2 appareils distincts, la copie du tarif et le clic sur *Starter*, et retrouve le détail ainsi que les visites anonymes du jour (avec la part sous Adblock) sur `staging.sdrnow.fr/stats`.

## Assumptions

- Le domaine `sdrnow.fr` est déclaré dans Scaleway Transactional Email (`scaleway_tem_domain` dans `infra/main.tf`), les enregistrements DNS TXT correspondants (`SPF`, `DKIM`, `DMARC`) sont publiés dans la zone DNS de `sdrnow.fr`, et la liste des destinataires d'alertes (séparés par des virgules, par défaut `jcm@sdrnow.fr`) est fournie via la variable/secret GitHub `ALERT_EMAIL_TO` injectée dans `/etc/sdrnow/staging.env` (chaque destinataire recevant un email individuel séparé afin qu'aucun destinataire ne soit visible pour les autres).
- Par défaut, les 3 routes actuelles (`/rdv/decouverte`, `/rdv/starter`, `/rdv/strategy` et équivalents `/en/book/...`) pointent dans la table de routage serveur vers `https://calendly.com/jc-maleysson/30min`, chaque cible pouvant être surchargée individuellement (notamment pour une future carte redirigeant vers un paiement intermédiaire).
