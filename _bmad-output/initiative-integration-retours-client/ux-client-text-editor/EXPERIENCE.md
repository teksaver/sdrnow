---
name: SDRnow In-Page Bilingual Editor
status: final
updated: 2026-10-19
sources:
  - ../forge-client-text-editor/forge-client-text-editor.md
  - ../spec-client-text-editor/spec-client-text-editor.md
  - ../spec-client-text-editor/conventions.md
  - ../architecture-client-text-editor/architecture-client-text-editor.md
  - ../../ux-sdrnow-landing-page/EXPERIENCE.md
---

# SDRnow In-Page Bilingual Editor — Experience Spine

## Foundation

Surcouche web d'administration (« In-Page Visual Editor ») injectée uniquement sur `staging.sdrnow.fr` pour le compte `admin`, complétée par un mode de lecture seule par jeton de révision (`?preview=<token>`) pour les relecteurs externes.
- **Form-factor :** Web Desktop/Laptop prioritaire pour l'édition (`admin`), Web Responsive (Mobile + Desktop) pour la consultation du lien de partage Read-Only (`?preview=`).
- **UI System :** HTML/CSS/JS natif zéro-dépendance (`infra/editor-client.js`) superposé aux pages statiques Astro + Tailwind CSS du site.
- **Référence visuelle :** `DESIGN.md` détient l'ensemble des tokens visuels (`{colors.*}`, `{typography.*}`, `{rounded.*}`, `{spacing.*}`, `{components.*}`). En cas de conflit avec un aperçu ou croquis, `DESIGN.md` et `EXPERIENCE.md` font foi.

## Information Architecture

| Surface | Reached from | Purpose |
|---|---|---|
| **Staging Admin Canvas & Top Pill** | `https://staging.sdrnow.fr` (Basic Auth `admin`) | Parcourir les 4 pages du site en mode `👁️ Lecture` ou `✏️ Édition`, déclencher la sauvegarde Staging, copier le lien Read-Only, publier en Prod ou réinitialiser depuis la Prod. |
| **Bilingual Bottom Drawer** | Clic sur n'importe quel nœud `[data-i18n]` en mode `✏️ Édition` | Éditer côte à côte le texte 🇫🇷 FR et 🇬🇧 EN du bloc sélectionné, appliquer `<em>` ou Normal (si `rich`), et prévisualiser instantanément chaque langue dans le DOM de la page. |
| **Reviewer Read-Only Preview** | `https://staging.sdrnow.fr/?preview=<token>` (1 clic, sans Basic Auth) | Permettre à un associé ou pair de consulter la révision courante du Staging en FR (`/`, `/mentions-legales`) et en EN (`/en`, `/en/legal-notice`) sans aucun outil d'édition visible. |
| **Expired Preview Gate (`403`)** | Ouverture d'un lien `?preview=<token>` d'une révision antérieure | Informer proprement le relecteur que le Staging a évolué depuis l'envoi du lien, sans jamais déclencher la popup système Basic Auth du navigateur. |

## Voice and Tone

Microcopie de l'interface d'administration et des écrans d'état (en français, claire, directe et sans jargon Git/CI).

| Do | Don't |
|---|---|
| « Enregistré sur Staging • Lien de partage mis à jour » | « Commit `[skip ci]` poussé sur `refs/heads/staging` (HTTP 202) » |
| « 📋 Copier le lien d'avis (lecture seule) » | « Générer un token HMAC-SHA256 de session preview » |
| « ↺ Réinitialiser depuis la Prod » | « Hard reset sur `main` » |
| « Ce champ ne peut pas être vide. » | « Error 400: Schema validation failed on key `hero.cta` » |
| « Ce lien d'aperçu a expiré car une nouvelle version est en cours de test. Demandez le nouveau lien à Jean-Charles. » | « 403 Forbidden — Invalid HMAC token » |

## Component Patterns

Spécifications comportementales (les spécifications visuelles résident dans `DESIGN.md.Components`).

| Component | Use | Behavioral rules |
|---|---|---|
| **`Admin Top Pill`** | Global sur `staging.sdrnow.fr` (session `admin`) | S'ouvre par défaut en mode `👁️ Lecture` au chargement pour laisser Jean-Charles naviguer normalement. Basculer sur `✏️ Édition` active les contours `[data-i18n]` et intercepte les clics sur les liens `<a data-i18n>` pour les éditer au lieu de naviguer. Les actions destructives ou publiques (« Publier en Prod » et « Réinitialiser depuis la Prod ») demandent un second clic de confirmation inline sous 3 s (« Confirmer ? »). |
| **`Editable Block Outline`** | Tout nœud `[data-i18n]` en mode `✏️ Édition` | Survol : affiche le contour `{components.editable-block-outline.hover-ring}` et le curseur `pointer`. Clic : verrouille la sélection sur ce bloc, ouvre le `Bilingual Bottom Drawer` et scrolle doucement si le bloc est trop bas. |
| **`Bilingual Bottom Drawer`** | Bas d'écran (`{components.bilingual-bottom-drawer.height}`) lorsqu'un bloc est actif | Charge les valeurs FR et EN courantes de la clé sélectionnée. **Règle d'Auto-Switch (`CAP-1`) :** dès que le champ `🇫🇷 Français` reçoit le focus, tous les nœuds `[data-i18n]` de la page affichent leur version FR ; dès que le champ `🇬🇧 English` reçoit le focus, tous les nœuds `[data-i18n]` de la page basculent instantanément en version EN sans rechargement HTTP. Toute frappe met à jour le nœud cible dans le DOM en temps réel (`input` event). |
| **`Semantic Format Toolbar`** | En-tête du `Bilingual Bottom Drawer` | Si le bloc actif est `data-i18n-type="rich"` : deux boutons non basculants sont disponibles : `[🔶 Emphase · <rendu>]` (`Cmd/Ctrl+I`) applique `<em>` sur la sélection (idempotent), et `[⊘ Normal]` (`Cmd/Ctrl+\`) remet la sélection en texte normal sans emphase (idempotent). Le redécoupage et la fusion des `<em>` sont automatiques selon les cas limites E1 à E10 (pas d'imbrication, fusion des adjacents, espaces en bordure rejetés hors de `<em>`). Le libellé du bouton Emphase et l'aperçu dans le tiroir reflètent dynamiquement le rendu réel du bloc ciblé (orange par défaut, souligné sur fond orange, gras sur puce de tarif ou mentions légales). `Cmd/Ctrl+B` et `Cmd/Ctrl+U` sont bloqués. Si le bloc est `data-i18n-type="plain"` : les boutons sont désactivés, remplacés par le badge `🔒 Texte brut`, et la touche `Entrée` est bloquée. Dans tous les blocs, l'événement `paste` est intercepté et converti en `text/plain`. |
| **`Sync Status Toast`** | Retour des actions `/api/staging`, `/api/publish`, `/api/reset` | Dès réception du `HTTP 202 Accepted` (`< 10 ms`), affiche le succès immédiat (« Enregistré sur Staging » ou « Publié en Prod »), met à jour en mémoire la nouvelle URL `?preview=<token>` du bouton de copie, et disparaît automatiquement après 4 s (reste affiché en `{colors.status-danger}` en cas d'erreur `400`/`500`). |
| **`Expired Preview Gate`** | Réponse `403 Forbidden` sur `?preview=<token>` expiré | Remplace la page par une carte explicative statique sans jamais envoyer d'en-tête `WWW-Authenticate`. |

## State Patterns

| State | Surface | Treatment |
|---|---|---|
| **Cold load (Mode Lecture par défaut)** | Staging Admin Canvas & Top Pill | La page s'affiche exactement comme en production ; seule l'`Admin Top Pill` est visible en haut. `GET /api/translations` précharge en arrière-plan le dictionnaire `{schema, fr, en, previewUrl}`. |
| **Edit mode — Idle** | Staging Admin Canvas & Top Pill | Bascule sur `✏️ Édition` : les blocs `[data-i18n]` s'illuminent au survol (`{colors.primary}`). Le tiroir bas reste fermé tant qu'aucun bloc n'est cliqué. |
| **Edit mode — Block focused (`rich` vs `plain`)** | Bilingual Bottom Drawer | Le tiroir s'ouvre avec les champs FR et EN remplis. La barre `Semantic Format Toolbar` est active si `rich`, ou verrouillée (`🔒 Texte brut`) si `plain`. |
| **Dirty / Unsaved edits** | Admin Top Pill & Bilingual Bottom Drawer | Dès qu'un caractère diffère du dernier état enregistré sur Staging, la pastille passe à `● Modifications non enregistrées` (`{colors.status-staging}`) et un écouteur `beforeunload` prévient la fermeture accidentelle de l'onglet. |
| **Saving / `202 Accepted`** | Admin Top Pill & Sync Status Toast | Le bouton cliqué affiche un indicateur bref pendant l'appel (`< 10 ms`), puis `Sync Status Toast` confirme la mise à jour locale immédiate et la mise en file d'attente GitHub (`gitSync: "queued"`). L'état `Dirty` retombe à zéro. |
| **Validation error (Bloc vide)** | Bilingual Bottom Drawer & Sync Status Toast | Si un champ obligatoire FR ou EN est vidé, sa bordure passe en `{colors.status-danger}`, un message inline « Ce champ ne peut pas être vide » s'affiche sous le champ, et l'enregistrement/publication est bloqué. |
| **Offline / Network failure** | Sync Status Toast | Toast `{colors.status-danger}` : « Connexion perdue. Vos modifications restent affichées à l'écran — réessayez d'enregistrer. » Les saisies en mémoire dans le DOM sont conservées. |
| **Permission denied / Expired preview (`403`)** | Expired Preview Gate (`403`) | Si un relecteur ouvre un ancien `?preview=<token>`, affichage de l'`Expired Preview Gate` sans popup Basic Auth. Si une requête arrive sans `?preview=` ni session, `401` déclenche le Basic Auth `admin` du navigateur. |

## Interaction Primitives

- **Clic sur un bloc `[data-i18n]` (en mode `✏️ Édition`)** : Sélectionne le bloc et ouvre le `Bilingual Bottom Drawer` avec focus sur le champ de la langue actuellement affichée à l'écran.
- **Focus dans le champ FR ou EN (`focusin`)** : Bascule instantanément l'intégralité des textes `[data-i18n]` de la page en français ou en anglais.
- **`⌘I` / `Ctrl+I`** (dans un champ `rich`) : Applique l'emphase (`<em>`) sur la sélection (idempotent).
- **`⌘\` / `Ctrl+\`** (dans un champ `rich`) : Remet la sélection en texte normal sans emphase (idempotent).
- **`Entrée`** : Insère un `<br>` dans un bloc `rich` ; ignoré (`preventDefault()`) dans un bloc `plain`.
- **`⌘V` / `Ctrl+V` (`paste`)** : Intercepté partout (`preventDefault()`), extrait uniquement `clipboardData.getData('text/plain')` et l'insère à la position du curseur.
- **`Esc`** : Ferme le `Bilingual Bottom Drawer` (en conservant les modifications en cours dans le DOM).

**Interdits partout :** Glisser-déposer de blocs, redimensionnement de conteneurs, raccourcis natifs `contenteditable` non filtrés (`⌘U` souligné est bloqué par `preventDefault()`), ouverture d'une modale par-dessus le tiroir.

## Accessibility Floor

- **Contraste WCAG AA/AAA :** Tous les textes de l'`Admin Top Pill` et du `Bilingual Bottom Drawer` respectent un ratio `>= 6.2:1` (`{colors.chrome-text}` et `{colors.chrome-muted}` sur `{colors.chrome-bg}`).
- **Navigation clavier :** `Tab` dans le tiroir passe directement du champ `🇫🇷 Français` au champ `🇬🇧 English` (ce qui bascule aussi la langue de la page en direct), puis aux boutons de la `Semantic Format Toolbar`. `Esc` referme le tiroir et rend le focus au bloc `[data-i18n]` dans la page.
- **Annonces ARIA :** Les régions `Sync Status Toast` portent `role="status" aria-live="polite"` ; les erreurs de champ vide portent `role="alert"`. Les boutons de formatage portent `aria-pressed="true|false"`.

## Responsive & Platform

| Breakpoint | Surface | Behavior |
|---|---|---|
| `>= md` (`768px+`) | Staging Admin Canvas & Bilingual Bottom Drawer | Surface nominale d'édition pour Jean-Charles : les champs `🇫🇷 Français` et `🇬🇧 English` sont affichés côte à côte en 2 colonnes (`1fr 1fr`) dans le tiroir de `{spacing.drawer-height}` (`260px`). |
| `< md` (`< 768px`) | Reviewer Read-Only Preview & Staging Admin | Pour les relecteurs (`?preview=`), la landing page responsive s'affiche nativement sur mobile. Si Jean-Charles ouvre le mode édition sur mobile, les 2 champs FR/EN du tiroir s'empilent verticalement (`max-height: 55vh; overflow-y: auto`). |

## Inspiration & Anti-patterns

- **Inspiré de Webflow / Framer (barre flottante sombre) :** L'outil d'édition vit dans une couche sombre (`{colors.chrome-bg}`) détachée du site clair pour ne jamais polluer la perception visuelle de la page.
- **Rejeté — Les panneaux latéraux (TinaCMS / Storyblok) :** Réduisent la largeur utile du viewport et déclenchent les mauvais breakpoints Tailwind pendant la prévisualisation.
- **Rejeté — La syntaxe Markdown (`**`, `==`) :** Oblige l'utilisateur à lire du code dans ses phrases au lieu de voir le vrai rendu.
- **Rejeté — La popup Basic Auth chez les relecteurs :** Remplacée par le lien `?preview=<token>` en 1 clic et la page `Expired Preview Gate` (`403`) dès que le staging change.

## Key Flows

### Flow 1 — Édition bilingue In-Page, formatage sémantique & demande d'avis (`CAP-1`, `CAP-2`, `CAP-3`)

1. **Jean-Charles** (fondateur de SDRnow) ouvre `https://staging.sdrnow.fr` sur son MacBook et s'authentifie via la popup Basic Auth `admin`.
2. La page s'affiche avec l'`Admin Top Pill` en haut. Il clique sur `✏️ Édition`, puis clique sur le grand titre Hero (`hero.title`, type `rich`).
3. Le `Bilingual Bottom Drawer` s'ouvre en bas d'écran sans rétrécir la page. Dans le champ `🇫🇷 Français`, il réécrit sa phrase, sélectionne les mots *« en rendez-vous qualifiés »* à la souris et clique sur **`[ 🔶 Emphase Orange ]`** (`<em>`) : dans le Hero juste au-dessus, ces mots passent instantanément en orange `{colors.primary}`.
4. Il clique ensuite dans le champ `🇬🇧 English` à droite : **toute la landing page bascule instantanément en anglais** sous ses yeux. Il colle une phrase depuis Google Docs (`Cmd+V` nettoyé automatiquement en texte brut), met deux mots en `<em>`, et vérifie que les 2 lignes rentrent parfaitement dans le Hero.
5. Il clique sur **« Enregistrer sur Staging »** dans l'`Admin Top Pill` : en moins de 10 ms, le `Sync Status Toast` affiche *« Enregistré sur Staging • Lien de partage mis à jour »*.
6. **Climax :** Il clique sur **« 📋 Copier le lien d'avis (lecture seule) »** et colle l'URL `https://staging.sdrnow.fr/?preview=a8f9...` dans WhatsApp pour son associé **Marc**. Marc clique sur son iPhone : la page s'ouvre immédiatement sans mot de passe, il bascule entre `FR` et `EN` via le bouton de la page, voit la nouvelle accroche orange en situation réelle, sans aucun bouton d'édition à l'écran.

- **Failure path (Champ vidé ou erreur de saisie) :** En modifiant le bouton CTA (`hero.cta`, type `plain`), Jean-Charles efface tout le texte par erreur et clique sur « Enregistrer sur Staging ». La bordure du champ passe en `{colors.status-danger}` avec le message *« Ce champ ne peut pas être vide »* et l'envoi réseau est bloqué jusqu'à ce qu'il saisisse un texte.

### Flow 2 — Expiration automatique du lien Read-Only & Publication en Production (`CAP-3`, `CAP-4`)

1. Après le retour de Marc sur WhatsApp (*« Top, mais mets plutôt "150 leads" dans l'offre Starter »*), **Jean-Charles** retourne sur son onglet `staging.sdrnow.fr`, clique sur la première puce de `Pricing.astro` (`pricing.starter_f1`, type `rich`), remplace `100 leads` par `150 leads` en conservant l'emphase **`[🔶 Emphase · gras]`** (`<em>`), et clique sur **« Enregistrer sur Staging »**.
2. Curieux, **Marc** reclique sur l'ancien lien WhatsApp reçu 10 minutes plus tôt : comme le compteur `.revision` du Staging a changé, il tombe proprement sur l'écran **`Expired Preview Gate` (`403`)** lui indiquant que le lien a expiré suite à une nouvelle modification (sans aucune popup Basic Auth).
3. Satisfait du rendu final sur Staging, Jean-Charles clique sur **« Publier en Prod »**, puis confirme d'un second clic sur **« Confirmer ? »**.
4. **Climax :** En moins de 10 ms, le micro-service patche `/var/www/html` et renvoie `202 Accepted`. Le `Sync Status Toast` passe au vert (`{colors.status-prod}`) : *« Publié en Prod ! sdrnow.fr est à jour. »* Jean-Charles ouvre `https://sdrnow.fr` dans un nouvel onglet : ses textes FR et EN sont déjà en ligne pour ses prospects, pendant que la file d'attente serveur commite `[skip ci]` sur `main` et `staging` en tâche de fond.

- **Failure path (Panne réseau / GitHub lent) :** Si l'API GitHub met 1 seconde à répondre, Jean-Charles n'attend pas : le `202 Accepted` rend la main immédiatement dès le disque local mis à jour. Si sa propre connexion coupe avant le clic, le `Sync Status Toast` l'avertit et conserve ses textes dans le tiroir pour réessayer.

### Flow 3 — Abandon d'un essai via Réinitialisation depuis la Prod (`CAP-5`)

1. Un vendredi soir, **Jean-Charles** teste sur `staging.sdrnow.fr` une reformulation agressive des 4 chiffres de preuve sociale (`proof.stat1_value`..`stat4_label`, type `plain`) et l'enregistre sur Staging.
2. En relisant la page en mode `👁️ Lecture`, il trouve finalement que la version actuellement en ligne sur `sdrnow.fr` est bien meilleure et veut tout annuler d'un coup.
3. Il clique sur **« ↺ Réinitialiser depuis la Prod »** dans l'`Admin Top Pill`, puis sur **« Confirmer le reset ? »**.
4. **Climax :** En moins de 10 ms, la page de Staging se recharge avec les textes exacts de `sdrnow.fr`, tout lien `?preview=` précédent est invalidé, et `sdrnow.fr` n'a jamais été touché.
