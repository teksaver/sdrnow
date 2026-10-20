---
name: SDRnow Analytics Radar & Email Alerts
status: final
updated: 2026-10-20
sources:
  - ../forge-cookieless-server-tracking/forge-cookieless-server-tracking.md
  - ../spec-cookieless-server-tracking/spec-cookieless-server-tracking.md
  - ../spec-cookieless-server-tracking/conventions.md
  - ../ux-client-text-editor/EXPERIENCE.md
---

# SDRnow Analytics Radar & Email Alerts — Experience Spine

> **Contrat de référence :** Ce document `EXPERIENCE.md` et son pair [`DESIGN.md`](./DESIGN.md) constituent la source de vérité comportementale et visuelle. Les maquettes ([`mockups/maquettes-emails-et-stats.html`](./mockups/maquettes-emails-et-stats.html)) illustrent ces flux ; en cas d'écart, `DESIGN.md` et `EXPERIENCE.md` prévalent.

## Foundation

Expérience de suivi commercial B2B sans cookie articulée autour de deux notifications email proactives (Scaleway TEM) et d'un tableau de bord web léger sur `staging.sdrnow.fr/stats`, complétée par une transparence totale côté prospect sur `sdrnow.fr`.
- **Form-factor :**
  - *Emails d'alerte et de digest :* Mobile-first (lecture rapide sur smartphone entre deux rendez-vous) et Desktop webmail.
  - *Tableau de bord `/stats` :* Web Desktop/Laptop prioritaire et Web Mobile responsive.
- **UI System :** HTML/CSS natif zéro-dépendance servi directement par `infra/staging-server.js` pour `/stats`, et HTML/CSS inline pour les emails Scaleway TEM.
- **Référence visuelle :** [`DESIGN.md`](./DESIGN.md) détient l'ensemble des tokens (`{colors.*}`, `{typography.*}`, `{rounded.*}`, `{spacing.*}`, `{components.*}`).

## Information Architecture

| Surface | Reached from | Purpose |
|---|---|---|
| **1. Landing Prospect (`/pour/<slug>`, `/offre/<slug>`, `/en/for/<slug>`)** | Lien envoyé par Jean-Charles (LinkedIn, Email, SMS) | Afficher la landing page SDRnow avec une URL propre et valorisante sans `?` ni bandeau cookie, tout en rattachant la session au prospect `<slug>` ([`spec CAP-1`](../spec-cookieless-server-tracking/spec-cookieless-server-tracking.md)). |
| **2. Email « Alerte Prospect Chaud »** | Notification push Scaleway TEM (2 min après la fin d'une visite humaine sur un lien prospect) | Permettre à Jean-Charles de savoir immédiatement qui vient d'ouvrir son offre, s'il y a eu partage interne ($\ge 2$ appareils) et quelles actions ont été réalisées ([`mockups/maquettes-emails-et-stats.html`](./mockups/maquettes-emails-et-stats.html)). |
| **3. Email « Digest de Minuit »** | Envoi automatique à `00:00` (Europe/Paris) si et seulement si $\ge 1$ visite humaine anonyme a eu lieu | Donner chaque matin au café le résumé des visites anonymes de la veille pour savoir en un coup d'œil s'il est utile d'ouvrir `/stats` ([`mockups/maquettes-emails-et-stats.html`](./mockups/maquettes-emails-et-stats.html)). |
| **4. Tableau de bord `staging.sdrnow.fr/stats`** | Clic depuis un email d'alerte ou bascule `📡 Radar & Stats` depuis l'éditeur `staging.sdrnow.fr` | Consulter l'historique complet du Radar Prospects, comparer les conversions par carte d'offre, suivre la part d'Adblock et copier rapidement un nouveau lien `/pour/<slug>` ([`mockups/maquettes-emails-et-stats.html`](./mockups/maquettes-emails-et-stats.html)). |

## Voice and Tone

- **Sujets d'emails télégraphiques et décisifs :** L'objet du mail contient toujours le verdict commercial avant même l'ouverture :
  - *Alerte Prospect :* `🔥 [SDRnow] <slug> vient de consulter votre offre (<N> appareil(s) • <Action principale>)`
  - *Digest Minuit :* `📊 [SDRnow] Bilan du <Date> : <N> visiteur(s) anonyme(s) (<X> clic(s) RDV • <Y> ont lu les tarifs)`
- **Vocabulaire métier B2B (zéro jargon technique) :**
  - Ne jamais écrire `HMAC-SHA256`, `IntersectionObserver` ou `HTTP 302` dans l'interface : traduire systématiquement en faits commerciaux (`🔥 2 appareils (Partage interne)`, `👁 Tarifs vus`, `📋 Copie Tarif Starter`, `🛡 Adblock / Sans JS`, `Bots & Scanners écartés`).

## Component Patterns

| Component | Visual spec | Behavioral contract |
|---|---|---|
| **Barre Admin Unifiée** | `{components.admin-top-header}` | Affiche les deux onglets `✏️ Éditeur de textes` (`/`) et `📡 Radar & Stats` (`/stats`) sur `staging.sdrnow.fr` lorsque l'utilisateur est authentifié en `admin`, ainsi que les filtres de période (`?period=today\|7d\|30d\|all`) et le bouton `⬇ Export .jsonl` (`/api/stats/export`). |
| **Copieur Rapide de Lien** | `{components.link-generator-strip}` | Lors de la saisie dans le champ slug, normalise les espaces et caractères spéciaux en `kebab-case` (`^[a-zA-Z0-9_-]{2,64}$`). Cliquer sur `Copier le lien FR` copie `https://sdrnow.fr/pour/<slug>` dans le presse-papier et affiche `✓ Copié !` pendant `2 s` (`Copier EN` copie `https://sdrnow.fr/en/for/<slug>`). |
| **Tableau Radar Prospects** | `{components.prospect-radar-table}` | Trie les prospects par date de dernière activité humaine décroissante. Affiche automatiquement le badge `{colors.badge-hot-bg}` `🔥 <N> appareils (Partage interne)` dès que le nombre d'`anon_id` distincts associés au `<slug>` est $\ge 2$, et `🔄 Revisite` dès qu'au moins 2 sessions espacées de plus de 30 minutes sont enregistrées. |
| **Entonnoir par Carte d'Offre** | `{components.funnel-progress-bar}` | Calcule dynamiquement la répartition des clics à partir des événements `cta_click` (`hero`, `starter`, `strategy`, et toute future clé de `CTA_TARGETS`) ainsi que des clics `contact` (`phone`/`email`). |
| **Carte Email Transactionnel** | `{components.transactional-email-card}` | Générée côté serveur à l'expiration du timer de debounce (`120 s`) pour un prospect ou à `00:00` pour le digest anonyme. Inclut un bouton principal pointant vers `https://staging.sdrnow.fr/stats`. |

## State Patterns

| Surface / Component | State | Behavior & visual treatment |
|---|---|---|
| **Visite entrante sur `/pour/<slug>` ou `/` (`CAP-3`)** | **Niveau 1 : Robot / Prévisualisation** (`LinkedInBot`, `SafeLinks`, ou HTML seul sans CSS dans les 3 s) | Incrémente uniquement le compteur gris `Bots & Scanners Écartés` (`{colors.text-muted}`). Ne crée aucune ligne dans le Radar Prospects et n'arme aucun timer d'email. |
| **Visite entrante sur `/pour/<slug>` ou `/` (`CAP-3`)** | **Niveau 2 : Humain sous Adblock / Sans JS** (`GET` HTML + chargement CSS/logo, aucun `POST /health`) | Crée/met à jour la session avec le badge `{colors.badge-adblock-bg}` `🛡 Adblock / Sans JS`, affiche `N/A (Sans JS)` dans la colonne *Lecture active*, capte tout clic sur `/rdv/*` et arme le timer d'email prospect (`120 s`). |
| **Visite entrante sur `/pour/<slug>` ou `/` (`CAP-3`)** | **Niveau 3 : Humain — Télémétrie complète** (au moins un `POST /health` reçu) | Met à jour en direct la durée de lecture active (`visibilityState`) et empile les badges d'intention (`👁 Tarifs vus`, `📋 Copie Tarif`, `📞 Téléphone`, `⚖️ Mentions légales`, `🖨 Export PDF`, `✅ Clic RDV <Offre>`) en réinitialisant le timer d'email de `120 s` à chaque événement. |
| **Digest de Minuit (`00:00` Europe/Paris)** | **Journée calme (`0` visiteur humain anonyme)** | Silence radio : aucun appel à l'API Scaleway TEM n'est déclenché afin d'éviter toute fatigue d'alerte. |
| **Tableau Radar Prospects (`/stats`)** | **État vide (aucun lien `/pour/<slug>` encore visité)** | Affiche une ligne d'accueil explicative dans `{components.prospect-radar-table}` invitant à envoyer un premier lien `https://sdrnow.fr/pour/nom-prospect` ou à utiliser le copieur rapide ci-dessus. |

## Interaction Primitives

- **Zéro friction côté Prospect :** Le visiteur de `sdrnow.fr` ou `sdrnow.fr/pour/<slug>` ne subit aucune modale, aucun bandeau cookie, aucune latence au clic (la route `/rdv/<offre>` journalise en mémoire/fichier en `< 2 ms` et répond `302 Found` immédiatement).
- **Debounce d'alerte anti-spam (`120 s`) :** Tant qu'un prospect est actif sur la page (scroll vers `Pricing`, copie de texte, clic CTA), le compte à rebours de 2 minutes est prolongé à chaque signal afin que Jean-Charles reçoive **un seul email complet** résumant toute la séquence.

## Responsive & Platform

- **Emails HTML :** Structure mono-colonne fluide (`max-width: 600px`), lisible sans zoom sur iOS Mail et Gmail Android.
- **Dashboard `/stats` :** Sous `820px`, la grille Entonnoir/Origines passe en 1 colonne et le tableau Radar Prospects active un défilement horizontal doux (`overflow-x: auto`) pour préserver l'alignement des badges sur mobile.

## Accessibility Floor

- **Contraste :** Tous les badges sémantiques (`{colors.badge-*-text}` sur `{colors.badge-*-bg}`) respectent un ratio de contraste $\ge 4.5:1$ (WCAG AA) et associent systématiquement une icône distinctive (`🔥`, `👁`, `📋`, `✅`, `🛡`) au texte pour ne jamais reposer sur la seule couleur.
- **Navigation clavier :** Le copieur rapide de lien, les filtres de période et les onglets d'administration sont intégralement utilisables au clavier (`Tab` / `Enter`).

## Key Flows

### Flow 1 — Détection d'un partage multi-décideurs et alerte « Prospect Chaud »
**Protagoniste :** **Jean-Charles** (fondateur de SDRnow, en déplacement entre deux appels clients) et **Claire** (DRH chez `acme`, prospectée sur LinkedIn).
1. Jean-Charles envoie un message LinkedIn à Claire contenant simplement `https://sdrnow.fr/pour/acme-drh` (tapé à la volée dans LinkedIn sans ouvrir de back-office).
2. Deux secondes après l'envoi, le robot `LinkedInBot` requête `GET /pour/acme-drh` pour générer l'aperçu du message : le serveur détecte le `User-Agent` bot (et l'absence de chargement CSS), le classe en **Niveau 1 (Robot écarté)** et n'envoie aucune fausse alerte à Jean-Charles.
3. À `14:12`, Claire clique sur le lien depuis son iPhone : la page s'affiche instantanément avec l'URL propre `https://sdrnow.fr/pour/acme-drh` et sans bandeau cookie. Elle lit pendant 45 secondes jusqu'aux tarifs (`👁 Tarifs vus`) et copie le texte de l'offre *Starter 1 990 €* (`📋 Copie Tarif Starter`), puis transfère le lien `https://sdrnow.fr/pour/acme-drh` à son DG sur Teams.
4. À `14:15` (avant l'expiration des 2 minutes d'inactivité), le DG ouvre le lien depuis son Mac : le serveur détecte un **2e `anon_id` distinct** sur `acme-drh` (`🔥 2 appareils — Partage interne`), enregistre son passage sur les mentions légales puis son clic sur `/rdv/starter` (redirigé en 302 vers Calendly).
5. **Climax :** À `14:18` (2 minutes après le dernier signal), Jean-Charles reçoit sur son téléphone un unique email `🔥 [SDRnow] acme-drh vient de consulter votre offre (2 appareils • Clic RDV Starter)` détaillant toute la chronologie seconde par seconde.

### Flow 2 — Consultation du Digest de Minuit et pilotage sur `/stats`
**Protagoniste :** **Jean-Charles**, le matin à `08:30` devant son café.
1. En ouvrant sa boîte mail, Jean-Charles voit le mail envoyé à `00:00` : `📊 [SDRnow] Bilan du 20 oct. : 6 visiteurs anonymes (2 clics RDV • 4 ont lu les tarifs)`. (La veille, dimanche sans visite humaine, il n'avait reçu aucun mail).
2. Il lit dans l'aperçu du mail qu'un visiteur anonyme venu de LinkedIn a copié les tarifs et qu'un visiteur sous Adblock a cliqué sur le bouton Hero.
3. **Climax :** Il clique sur le bouton `Consulter le tableau de bord /stats →` du mail, arrive sur `staging.sdrnow.fr/stats`, constate dans l'entonnoir que le *Package Starter (1 990 €)* concentre 56 % des clics, et utilise au passage le bandeau copieur pour préparer en un clic son prochain lien `https://sdrnow.fr/pour/dalkia-dsi`.
