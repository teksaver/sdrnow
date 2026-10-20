---
name: SDRnow Analytics Radar & Email Alerts
description: Système visuel du tableau de bord d'activité (staging.sdrnow.fr/stats) et des emails transactionnels (Alerte Prospect Chaud & Digest de Minuit) envoyés via Scaleway TEM, héritant des tokens de marque SDRnow (ux-sdrnow-landing-page/DESIGN.md) et du chrome d'administration sombre (ux-client-text-editor/DESIGN.md).
status: final
updated: 2026-10-20
sources:
  - ../forge-cookieless-server-tracking/forge-cookieless-server-tracking.md
  - ../spec-cookieless-server-tracking/spec-cookieless-server-tracking.md
  - ../spec-cookieless-server-tracking/conventions.md
  - ../ux-client-text-editor/DESIGN.md
  - ../../ux-sdrnow-landing-page/DESIGN.md
colors:
  primary: '#F26522'
  primary-hover: '#D95316'
  primary-soft: '#FFF3ED'
  chrome-bg: '#111827'
  chrome-surface: '#1F2937'
  chrome-border: '#374151'
  chrome-text: '#F9FAFB'
  chrome-muted: '#9CA3AF'
  page-bg: '#F9FAFB'
  card-bg: '#FFFFFF'
  text-main: '#111827'
  text-muted: '#4B5563'
  border: '#E5E7EB'
  badge-hot-bg: '#FFEDD5'
  badge-hot-text: '#C2410C'
  badge-hot-border: '#FDBA74'
  badge-cta-bg: '#DCFCE7'
  badge-cta-text: '#15803D'
  badge-cta-border: '#86EFAC'
  badge-copy-bg: '#EDE9FE'
  badge-copy-text: '#6D28D9'
  badge-copy-border: '#C4B5FD'
  badge-view-bg: '#DBEAFE'
  badge-view-text: '#1D4ED8'
  badge-view-border: '#93C5FD'
  badge-adblock-bg: '#FEF3C7'
  badge-adblock-text: '#B45309'
  badge-adblock-border: '#FCD34D'
  badge-neutral-bg: '#F3F4F6'
  badge-neutral-text: '#374151'
  badge-neutral-border: '#D1D5DB'
typography:
  ui-sans:
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: 14px
    fontWeight: '500'
    lineHeight: '1.5'
  section-heading:
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: 17px
    fontWeight: '800'
    lineHeight: '1.3'
  kpi-value:
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: 28px
    fontWeight: '800'
    lineHeight: '1.1'
  table-header:
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: 11.5px
    fontWeight: '700'
    lineHeight: '1.2'
    letterSpacing: 0.05em
  mono-slug:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
    fontSize: 13.5px
    fontWeight: '700'
    lineHeight: '1.3'
rounded:
  sm: 4px
  md: 6px
  lg: 10px
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 28px
components:
  admin-top-header:
    background: '{colors.chrome-bg}'
    surface: '{colors.chrome-surface}'
    foreground: '{colors.chrome-text}'
    active-pill: '{colors.primary}'
    border: '{colors.chrome-border}'
  link-generator-strip:
    background: '{colors.card-bg}'
    input-prefix-bg: '{colors.badge-neutral-bg}'
    border: '{colors.border}'
    button-bg: '{colors.chrome-bg}'
    radius: '{rounded.md}'
  prospect-radar-table:
    background: '{colors.card-bg}'
    hot-row-bg: '#FFFDFB'
    header-bg: '{colors.page-bg}'
    border: '{colors.border}'
    radius: '{rounded.lg}'
  signal-badge:
    radius: '{rounded.full}'
    font: '{typography.table-header}'
  funnel-progress-bar:
    track-bg: '{colors.badge-neutral-bg}'
    primary-fill: '{colors.primary}'
    secondary-fill: '{colors.text-muted}'
    direct-fill: '{colors.badge-copy-text}'
    radius: '{rounded.full}'
  transactional-email-card:
    header-bg: '{colors.chrome-bg}'
    header-border-bottom: '{colors.primary}'
    body-bg: '{colors.card-bg}'
    banner-bg: '{colors.primary-soft}'
    banner-border: '{colors.primary}'
    cta-bg: '{colors.primary}'
    radius: '{rounded.md}'
---

# SDRnow Analytics Radar & Email Alerts — Design Spine

> **Contrat de référence :** Ce document `DESIGN.md` et son pair [`EXPERIENCE.md`](./EXPERIENCE.md) constituent la source de vérité visuelle et comportementale. Les maquettes de référence ([`mockups/maquettes-emails-et-stats.html`](./mockups/maquettes-emails-et-stats.html)) illustrent ces spécifications ; en cas d'écart, `DESIGN.md` et `EXPERIENCE.md` prévalent.

## Brand & Style

L'interface de suivi (`/stats` et emails d'alerte) prolonge l'esthétique B2B directe et sans fioritures de SDRnow :
- **Lisibilité commerciale immédiate (« 3-Second Triage ») :** Conçu pour un dirigeant commercial entre deux rendez-vous. Aucune courbe décorative ni jargon DevOps ; chaque couleur signale un niveau d'intention d'achat (partage multi-décideurs, copie de tarif, clic de prise de rendez-vous).
- **Continuité d'administration sur `staging.sdrnow.fr` :** L'en-tête reprend le thème sombre `{colors.chrome-bg}` (`#111827`) de l'éditeur bilingue, tandis que le corps de `/stats` et des emails repose sur des cartes claires `{colors.card-bg}` (`#FFFFFF`) sur fond `{colors.page-bg}` (`#F9FAFB`) pour maximiser le confort de lecture des tableaux et chronologies.

## Colors

- **Identité & Accents d'Action :**
  - `{colors.primary}` (`#F26522`) : Onglet actif de navigation, barre de progression de l'offre dominante, bordure d'accentuation des en-têtes d'emails et boutons CTA d'emails.
  - `{colors.primary-soft}` (`#FFF3ED`) : Fond du bandeau d'alerte prioritaire dans l'email « Prospect Chaud » et du filtre de période actif.
- **Badges Sémantiques d'Intention B2B :**
  - **Chaud / Partage interne (`{colors.badge-hot-*}`) :** Fond `#FFEDD5`, texte `#C2410C`, bordure `#FDBA74` — réservé aux signaux de contagion multi-appareils ($\ge 2$ `anon_id` sur un même lien prospect) et aux revisites à J+N.
  - **Conversion CTA (`{colors.badge-cta-*}`) :** Fond `#DCFCE7`, texte `#15803D`, bordure `#86EFAC` — réservé aux clics sur les routes `/rdv/*` et `/en/book/*`.
  - **Intention Tarifaire & Contact (`{colors.badge-copy-*}`) :** Fond `#EDE9FE`, texte `#6D28D9`, bordure `#C4B5FD` — réservé à la copie (`Ctrl+C`) dans `Pricing` et aux clics/copies sur le téléphone ou l'email.
  - **Lecture Tarifs (`{colors.badge-view-*}`) :** Fond `#DBEAFE`, texte `#1D4ED8`, bordure `#93C5FD` — signale l'entrée du bloc `Pricing` dans le viewport.
  - **Mode Protégé Adblock / Sans-JS (`{colors.badge-adblock-*}`) :** Fond `#FEF3C7`, texte `#B45309`, bordure `#FCD34D` — distingue les visites humaines confirmées par le couple `HTML + CSS` sans ping JS.
  - **Neutre (`{colors.badge-neutral-*}`) :** Fond `#F3F4F6`, texte `#374151`, bordure `#D1D5DB` — langue, ouverture des mentions légales, export PDF (`beforeprint`).

## Typography

- **Police principale (`{typography.ui-sans}`) :** Pile système + `Inter` (`14px`, graisse `500`), garantissant un rendu identique sur `/stats` et dans tous les clients mail (Apple Mail, Gmail, Outlook) sans dépendre du chargement d'une police distante dans les emails.
- **Valeurs KPI (`{typography.kpi-value}`) :** `28px` (`800` extra-bold) sur `/stats` (`18px` dans les mini-KPIs d'emails) pour une lecture instantanée des volumes et taux de conversion.
- **Identifiants & Chemins (`{typography.mono-slug}`) :** Police chasse fixe (`ui-monospace`, `13.5px`, `700`) pour les slugs prospects (`/pour/acme-drh`), les identifiants anonymes (`#a4f9c2`) et les horodatages (`14:12:04`).

## Layout & Spacing

- **Tableau de bord `/stats` ([`mockups/maquettes-emails-et-stats.html`](./mockups/maquettes-emails-et-stats.html)) :**
  - Conteneur centré (`max-width: 1180px`, padding `{spacing.xl}`) structuré verticalement en 4 strates :
    1. **Barre Admin Unifiée (`admin-top-header`)** : Logo `SDRnow`, bascule `✏️ Éditeur de textes` ↔ `📡 Radar & Stats`, et sélecteur de période (`Aujourd'hui`, `7 derniers jours`, `30 jours`, `⬇ Export .jsonl`).
    2. **Bandeau Copieur de Lien (`link-generator-strip`)** : Champ préfixé `https://sdrnow.fr/pour/` + saisie du slug + boutons `Copier le lien FR` et `Copier EN (/en/for/…)`.
    3. **Section 1 — Radar Prospects Identifiés** : Tableau pleine largeur prioritaire en haut de page.
    4. **Section 2 — Audience Anonyme & Entonnoir par Carte** : Grille de 4 KPIs (`grid-template-columns: repeat(auto-fit, minmax(210px, 1fr))`) suivie d'une grille 2 colonnes (`1.3fr 1fr`, empilée sous `820px`) opposant l'entonnoir des cartes d'offre aux origines de trafic (`Referer`).
- **Emails HTML (`transactional-email-card`) :**
  - Largeur maximale `600px` compatible tous webmails et mobiles, CSS inline uniquement, structure en carte unique à en-tête `{colors.chrome-bg}` souligné d'une bordure `{colors.primary}` de `3px`.

## Elevation & Depth

- **Surfaces plates et contrastées :** Sur `/stats`, les cartes blanches `{colors.card-bg}` reposent sur `{colors.page-bg}` avec une bordure fine `1px solid {colors.border}` et une ombre minimale (`0 1px 3px rgba(0,0,0,0.04)`). Aucune ombre portée dans les emails HTML pour garantir la compatibilité Outlook/Gmail.

## Shapes

- **Cartes et tableaux :** Rayon `{rounded.lg}` (`10px`) sur `/stats`, `{rounded.md}` (`6px` à `8px`) dans les emails.
- **Badges de signaux et sélecteur de navigation admin :** Rayon `{rounded.full}` (`9999px` — forme pilule).

## Components

- **`admin-top-header` :** Barre supérieure partagée sur `staging.sdrnow.fr`. Permet de naviguer sans rechargement d'authentification entre la page d'édition (`/`) et `/stats`.
- **`link-generator-strip` :** Barre utilitaire sous l'en-tête permettant de formater proprement un slug en `kebab-case` et de copier l'URL complète FR ou EN dans le presse-papier en un clic.
- **`prospect-radar-table` :** Tableau des liens `/pour/<slug>` et `/offre/<slug>`. Les lignes ayant généré un partage multi-appareils ou un clic CTA reçoivent un fond légèrement chaud (`#FFFDFB`).
- **`signal-badge` :** Pilules sémantiques combinant icône Unicode + libellé court (`🔥 2 appareils`, `👁 Tarifs vus`, `📋 Copie Tarif Starter`, `✅ Clic RDV Starter`, `🛡 Adblock / Sans JS`).
- **`funnel-progress-bar` :** Barres horizontales comparant le nombre de clics et la part de conversion de chaque route d'offre (`/rdv/starter`, `/rdv/decouverte`, `/rdv/strategy`, `Téléphone`, et toute nouvelle carte ajoutée à `CTA_TARGETS`).
- **`transactional-email-card` :** Gabarit HTML commun aux 2 emails Scaleway TEM (Alerte Prospect Chaud & Digest de Minuit) avec frise chronologique verticale bordée à gauche (`2px solid {colors.border}`) et puces `{colors.primary}`.

## Do's and Don'ts

- **Do :** Toujours afficher le compteur de *Bots & Scanners écartés* dans une carte grisée secondaire (`{colors.text-muted}`) pour prouver que le filtrage protège les statistiques sans polluer les chiffres d'audience humaine.
- **Do :** Rendre l'objet de chaque email auto-suffisant (inclure le slug, le nombre d'appareils et le CTA cliqué dès le sujet du mail).
- **Don't :** Ne jamais utiliser de JavaScript externe, de bibliothèque de graphiques (Chart.js, D3) ou de polices CDN tierces dans `/stats` ou dans les emails.
- **Don't :** Ne jamais afficher une adresse IP brute dans `/stats` ni dans les emails (utiliser exclusivement le hash court `#anon_id` et la famille d'appareil/navigateur déduite du `User-Agent`).
