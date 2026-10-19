---
name: SDRnow In-Page Bilingual Editor
description: Système visuel de la surcouche d'édition bilingue (FR/EN) et de prévisualisation sur staging.sdrnow.fr, héritant des tokens de marque SDRnow (ux-sdrnow-landing-page/DESIGN.md) tout en isolant l'interface d'administration dans une couche sombre à fort contraste.
status: final
updated: 2026-10-19
sources:
  - ../forge-client-text-editor/forge-client-text-editor.md
  - ../spec-client-text-editor/spec-client-text-editor.md
  - ../spec-client-text-editor/conventions.md
  - ../architecture-client-text-editor/architecture-client-text-editor.md
  - ../../ux-sdrnow-landing-page/DESIGN.md
colors:
  primary: '#F26522'
  primary-hover: '#D95316'
  primary-soft: '#FFF3ED'
  page-background: '#FFFFFF'
  page-surface: '#F9FAFB'
  page-text: '#111827'
  page-muted: '#4B5563'
  page-border: '#E5E7EB'
  chrome-bg: '#111827'
  chrome-surface: '#1F2937'
  chrome-input: '#0F172A'
  chrome-border: '#374151'
  chrome-text: '#F9FAFB'
  chrome-muted: '#9CA3AF'
  status-staging: '#F59E0B'
  status-prod: '#15803D'
  status-danger: '#B91C1C'
typography:
  ui-sans:
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif"
    fontSize: 14px
    fontWeight: '500'
    lineHeight: '1.4'
  ui-label:
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif"
    fontSize: 11px
    fontWeight: '700'
    lineHeight: '1.2'
    letterSpacing: 0.06em
  editor-input:
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif"
    fontSize: 15px
    fontWeight: '400'
    lineHeight: '1.55'
  mono-key:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: 11px
    fontWeight: '600'
    lineHeight: '1.2'
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
  xl: 24px
  drawer-height: 260px
components:
  admin-top-pill:
    background: '{colors.chrome-bg}'
    foreground: '{colors.chrome-text}'
    border: '{colors.chrome-border}'
    radius: '{rounded.full}'
  editable-block-outline:
    hover-ring: '{colors.primary}'
    active-ring: '{colors.primary}'
    active-bg: '{colors.primary-soft}'
    radius: '{rounded.sm}'
  bilingual-bottom-drawer:
    background: '{colors.chrome-bg}'
    surface: '{colors.chrome-surface}'
    input-bg: '{colors.chrome-input}'
    foreground: '{colors.chrome-text}'
    border: '{colors.chrome-border}'
    height: '{spacing.drawer-height}'
  semantic-format-toolbar:
    background: '{colors.chrome-surface}'
    active-bg: '{colors.primary}'
    active-foreground: '{colors.page-background}'
    disabled-foreground: '{colors.chrome-muted}'
    radius: '{rounded.sm}'
  sync-status-toast:
    background: '{colors.chrome-surface}'
    foreground: '{colors.chrome-text}'
    staging-accent: '{colors.status-staging}'
    prod-accent: '{colors.status-prod}'
    error-accent: '{colors.status-danger}'
    radius: '{rounded.md}'
  expired-preview-gate:
    background: '{colors.page-surface}'
    card-bg: '{colors.page-background}'
    foreground: '{colors.page-text}'
    border: '{colors.page-border}'
    accent: '{colors.primary}'
    radius: '{rounded.lg}'
---

## Brand & Style

L'éditeur In-Page de SDRnow est un **outil de précision chirurgicale pour dirigeant commercial pressé**, greffé directement sur la landing page B2B sans jamais la dénaturer. Il hérite intégralement des tokens de la page publique définis dans `ux-sdrnow-landing-page/DESIGN.md` (`{colors.primary}`, `{colors.page-background}`, `{colors.page-surface}`, `{colors.page-text}`) afin que le rendu prévisualisé soit **100 % identique** à la production.

Pour éviter toute confusion visuelle entre le site (fond clair `{colors.page-background}` et `{colors.page-surface}`) et l'outil d'administration, tous les composants de l'éditeur (`admin-top-pill`, `bilingual-bottom-drawer`, `sync-status-toast`) adoptent une **couche ardoise sombre** (`{colors.chrome-bg}` et `{colors.chrome-surface}`). L'administrateur distingue ainsi en une fraction de seconde « son site » (clair) de « sa console d'édition » (sombre).

## Colors

### Couche Page Publique (héritée de `ux-sdrnow-landing-page/DESIGN.md`)
- **Primary Brand Orange (`{colors.primary}` / `#F26522`, hover `{colors.primary-hover}` / `#D95316`)** : Couleur d'action et couleur du marqueur sémantique `<em>` sur fond clair (`[&_em]:text-primary [&_em]:not-italic`, ratio 3.4:1 sur `{colors.page-background}` pour grands titres `>= 24px`). Dans les sections à fond déjà `{colors.primary}` (`Pricing.astro` H2), `<em>` bascule en blanc souligné (`{colors.page-background}`, ratio 3.4:1) pour interdire tout texte orange sur fond orange.
- **Page Surfaces (`{colors.page-background}` / `#FFFFFF`, `{colors.page-surface}` / `#F9FAFB`, `{colors.page-border}` / `#E5E7EB`)** : Surfaces natives du site prévisualisé.
- **Page Text (`{colors.page-text}` / `#111827`, `{colors.page-muted}` / `#4B5563`)** : Textes du site (ratio 16.8:1 et 7.5:1 sur `{colors.page-background}`, conformes WCAG AAA/AA).

### Couche Chrome Éditeur
- **Chrome Background & Surface (`{colors.chrome-bg}` / `#111827`, `{colors.chrome-surface}` / `#1F2937`, `{colors.chrome-input}` / `#0F172A`, `{colors.chrome-border}` / `#374151`)** : Fonds du tiroir bas et de la barre flottante supérieure.
- **Chrome Text (`{colors.chrome-text}` / `#F9FAFB`, `{colors.chrome-muted}` / `#9CA3AF`)** : Texte principal (ratio 16.4:1 sur `{colors.chrome-bg}`) et labels secondaires (ratio 6.2:1 sur `{colors.chrome-bg}`, conformes WCAG AA).
- **Status Tokens** :
  - **Staging Amber (`{colors.status-staging}` / `#F59E0B`)** : Indique les modifications non enregistrées ou enregistrées uniquement sur Staging.
  - **Prod Green (`{colors.status-prod}` / `#15803D`)** : Action « Publier en Prod » et confirmation de synchronisation GitHub.
  - **Danger Red (`{colors.status-danger}` / `#B91C1C`)** : Action « Réinitialiser depuis la Prod » et erreurs de validation (`400` bloc vide).

## Typography

- **UI Sans (`{typography.ui-sans}`)** : Police Inter 14px (`fontWeight: 500`) pour les boutons de la barre d'administration et les notifications.
- **UI Label (`{typography.ui-label}`)** : Capitales 11px (`letterSpacing: 0.06em`) pour les en-têtes de colonnes `🇫🇷 FRANÇAIS` et `🇬🇧 ENGLISH` et les badges `TEXTE RICHE` / `TEXTE BRUT`.
- **Editor Input (`{typography.editor-input}`)** : Inter 15px (`lineHeight: 1.55`) dans les deux zones de saisie du tiroir bas pour un confort de lecture immédiat, indépendamment de la taille réelle du titre (`<h1>` 60px ou `<p>` 14px) sur la page.
- **Mono Key (`{typography.mono-key}`)** : Monospace 11px pour afficher discrètement l'identifiant du bloc sélectionné (ex. `hero.title`, `pricing.starter_f1`).

Dans les zones de saisie du tiroir (`{colors.chrome-input}`), les deux seules balises HTML5 sémantiques autorisées sont stylées visuellement en direct :
- `<strong>` s'affiche en gras (`font-weight: 700; color: #FFFFFF`).
- `<em>` s'affiche en orange SDRnow sans italique (`font-style: normal; color: #F26522; background: rgba(242, 101, 34, 0.15); padding: 0 2px; border-radius: 2px`).

## Layout & Spacing

- **Préservation du Viewport Pleine Largeur (100 %)** : Aucun panneau latéral n'est autorisé. La landing page conserve 100 % de sa largeur afin que les grilles Tailwind (`md:grid-cols-3`, `lg:grid-cols-4`) se comportent exactement comme en production.
- **Compensation du Tiroir Bas** : Lorsque le `bilingual-bottom-drawer` (`{spacing.drawer-height}` = `260px`) est ouvert, un `padding-bottom: 280px` est appliqué au `<body>` de la page afin que les éléments du `Footer.astro` puissent être scrollés et édités sans jamais être masqués par le tiroir.
- **Grille Interne du Tiroir** : Grille 2 colonnes égales (`grid-template-columns: 1fr 1fr`, gap `{spacing.lg}`) sur Desktop/Tablette (`>= 768px`) pour afficher `🇫🇷 Français` à gauche et `🇬🇧 English` à droite.

## Elevation & Depth

- **Z-Index Stratification** :
  - Page publique SDRnow : `z-index: auto`
  - `editable-block-outline` (badge survolé/actif) : `z-index: 30`
  - `bilingual-bottom-drawer` : `z-index: 40` avec ombre portée vers le haut (`0 -8px 24px rgba(0, 0, 0, 0.35)`)
  - `admin-top-pill` et `sync-status-toast` : `z-index: 50` (`0 4px 16px rgba(0, 0, 0, 0.25)`)

## Shapes

- **`{rounded.sm}` (`4px`)** : Contours des blocs éditables (`editable-block-outline`) et boutons de la barre de formatage (`semantic-format-toolbar`), alignés sur le rayon `4px` de la marque SDRnow.
- **`{rounded.md}` (`6px`)** : Zones de saisie FR/EN dans le tiroir et toasts de statut.
- **`{rounded.full}` (`9999px`)** : `admin-top-pill` flottante en haut d'écran pour qu'elle se détache visuellement du header rectangulaire de la page.

## Components

- **`Admin Top Pill` (`{components.admin-top-pill}`)** : Barre flottante centrée en haut d'écran (`top: 12px`), fond `{colors.chrome-bg}`, bordure `{colors.chrome-border}`, rayon `{rounded.full}`, padding `{spacing.xs}` `{spacing.md}`. Contient :
  1. Le sélecteur de mode segmenté `[ 👁️ Lecture | ✏️ Édition ]`.
  2. La pastille d'état (`● Non modifié`, `● Brouillon local` en `{colors.status-staging}`, ou `● Staging modifié`).
  3. Les boutons d'action : **Enregistrer sur Staging** (`{colors.primary}`), **📋 Copier lien Read-Only** (`{colors.chrome-surface}`), **Publier en Prod** (`{colors.status-prod}`), et **↺ Réinitialiser depuis la Prod** (texte `{colors.chrome-muted}`, passe en `{colors.status-danger}` à la demande de confirmation).
- **`Editable Block Outline` (`{components.editable-block-outline}`)** : Actif uniquement en mode `✏️ Édition`. Au survol d'un élément `[data-i18n]`, affiche un contour pointillé `2px dashed {colors.primary}` (`outline-offset: 4px`). Lorsqu'un bloc est sélectionné, le contour devient plein (`2px solid {colors.primary}`) avec un léger fond `{colors.primary-soft}` et une étiquette supérieure (`{typography.mono-key}`, fond `{colors.primary}`, texte blanc) indiquant la clé et le type (`hero.title • Riche` ou `proof.stat1_value • Brut`).
- **`Bilingual Bottom Drawer` (`{components.bilingual-bottom-drawer}`)** : Tiroir fixé en bas d'écran (`height: {spacing.drawer-height}`, fond `{colors.chrome-bg}`, bordure supérieure `2px solid {colors.primary}`). Barre d'en-tête compacte (`36px`) affichant la clé `{typography.mono-key}`, la `semantic-format-toolbar`, et le bouton fermer `✕` (`Esc`). Corps divisé en 2 cartes côte à côte (`🇫🇷 Version Française` et `🇬🇧 English Version`) sur fond `{colors.chrome-input}` avec bordure `{colors.chrome-border}` qui passe en `{colors.primary}` sur la langue ayant le focus.
- **`Semantic Format Toolbar` (`{components.semantic-format-toolbar}`)** : Groupe de 2 boutons dans l'en-tête du tiroir :
  - **`[ B Gras ]`** (`<strong>`) : Fond `{colors.chrome-surface}`, passe en `{colors.primary}` quand la sélection courante est dans un `<strong>`.
  - **`[ 🔶 Emphase Orange ]`** (`<em>`) : Fond `{colors.chrome-surface}`, passe en `{colors.primary}` quand la sélection courante est dans un `<em>`.
  - Lorsque le bloc sélectionné est `data-i18n-type="plain"`, les deux boutons sont masqués/remplacés par un badge verrouillé `🔒 Texte brut (sans style ni retour à la ligne)` en `{colors.chrome-muted}`.
- **`Sync Status Toast` (`{components.sync-status-toast}`)** : Notification flottante en haut à droite (`top: 64px; right: 16px`), fond `{colors.chrome-surface}`, bordure gauche `4px solid` (`{colors.status-staging}`, `{colors.status-prod}` ou `{colors.status-danger}`). Affiche la progression `202 Accepted` (« Appliqué sur le serveur (<10ms) • Synchro Git en cours... ») et les erreurs de validation.
- **`Expired Preview Gate` (`{components.expired-preview-gate}`)** : Écran pleine page servi lors d'une `403 Forbidden` sur un lien `?preview=<token>` invalidé. Fond `{colors.page-surface}`, carte centrée (`max-width: 440px`, fond `{colors.page-background}`, bordure `{colors.page-border}`, rayon `{rounded.lg}`, padding `{spacing.xl}`), logo SDRnow, icône cadenas/horloge en `{colors.primary}`, titre explicite et message invitant le relecteur à demander le nouveau lien à Jean-Charles.

## Do's and Don'ts

| Do | Don't |
|---|---|
| Garder la landing page à 100 % de la largeur du viewport (tiroir uniquement en bas) | Ouvrir une sidebar latérale qui écrase la page et fausse les breakpoints Tailwind |
| Utiliser les couleurs sombres `{colors.chrome-bg}` pour tous les outils d'édition | Utiliser un fond blanc pour l'éditeur qui se confondrait avec les cartes de `Pricing.astro` |
| Afficher uniquement `[B Gras]` (`<strong>`) et `[🔶 Emphase Orange]` (`<em>`) sur les blocs `rich` | Proposer un sélecteur de police, de taille, d'alignement ou de couleur libre |
| Désactiver et masquer les outils de formatage sur les blocs `plain` (KPIs, prix, CTA) | Laisser l'utilisateur insérer un `<br>` ou un `<strong>` dans un bouton CTA ou un chiffre KPI |
| Injecter l'interface d'édition uniquement pour la session Basic Auth `admin` | Afficher le moindre élément d'édition ou la moindre popup Basic Auth à un relecteur `?preview=` |
