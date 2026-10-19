# Conventions & Implementation Contract — Éditeur Client Bilingue In-Page

## 1. Dictionnaire de traduction & Attributs DOM Astro

- **Source de données :** Les traductions sont stockées dans `src/i18n/translations.json` (remplaçant ou alimentant `src/i18n/translations.ts`).
- **Fusion des clés scindées :** Les clés `hero.title_pre` et `hero.title_highlight` sont fusionnées en une clé unique `hero.title` utilisant `<em>` pour le passage mis en valeur et `<br>` pour le saut de ligne.
- **Annotation des composants Astro :**
  - `data-i18n="<key>"` identifie chaque élément DOM traduisible.
  - `data-i18n-type="plain"` : réservé aux valeurs courtes et structurelles (chiffres KPIs, prix, unités, boutons CTA, liens). Aucune balise HTML ni saut de ligne n'y est autorisé.
  - `data-i18n-type="rich"` : réservé aux titres, sous-titres, paragraphes et puces de liste. Autorise uniquement `<em>`, `<strong>` et `<br>`.

## 2. Contrat HTML5 Sémantique & Styles Tailwind

- **`<em>` (Emphase d'accroche) :** Rendu en orange SDRnow sans italique via CSS parent (`[&_em]:text-primary [&_em]:not-italic`). Désactivé ou adapté sur les sections à fond déjà orange (`bg-primary`).
- **`<strong>` (Importance forte) :** Rendu en gras (`[&_strong]:font-bold`).
- **Sanitization du presse-papier :** Dans l'éditeur, l'événement `paste` est intercepté pour n'insérer que `event.clipboardData.getData('text/plain')`.

## 3. Ergonomie de l'Éditeur sur `staging.sdrnow.fr`

- **Pleine largeur :** L'éditeur s'ouvre sous forme de tiroir flottant en bas d'écran (`position: fixed; bottom: 0`) afin de ne jamais réduire la largeur du viewport ni fausser les grilles responsive Tailwind (`md:grid-cols-3`, `lg:grid-cols-4`).
- **Édition côte à côte & Auto-Switch :** Le tiroir présente le champ 🇫🇷 FR à gauche et le champ 🇬🇧 EN à droite, accompagnés des boutons `[Gras (<strong>)]` et `[Emphase Orange (<em>)]` (affichés uniquement si `data-i18n-type="rich"`). Donner le focus au champ FR ou EN permute instantanément tous les textes `[data-i18n]` de la page dans la langue active sans rechargement.

## 4. Micro-service VPS, Patch HTML `< 10 ms` & Synchronisation Git

- **Routes exposées sur `staging.sdrnow.fr` (réservées à la session Basic Auth `admin`) :**
  - `POST /api/staging` : valide le payload, met à jour `/var/www/staging`, régénère le jeton `preview` (invalidant le précédent), commite `src/i18n/translations.json` avec `[skip ci]` sur la branche `staging`, et retourne la nouvelle URL `?preview=<token>`.
  - `POST /api/publish` : valide le payload, met à jour `/var/www/html` et `/var/www/staging`, régénère le jeton `preview` si le contenu diffère du staging précédent, et commite `src/i18n/translations.json` avec `[skip ci]` sur `main` (et `staging`).
  - `POST /api/reset` : recopie les traductions actives de la Production (`/var/www/html`) vers `/var/www/staging`, régénère le jeton `preview`, et commite `[skip ci]` sur la branche `staging`, sans toucher à la Production.
- **Validation & Purge Serveur :**
  - Rejet (`400 Bad Request`) si une clé n'appartient pas à la whitelist du schéma existant ou si une valeur obligatoire est vide.
  - Suppression stricte de toute balise HTML hors `<em>`, `<strong>`, `<br>` pour les clés `rich`, et de toute balise HTML pour les clés `plain`.
- **Patch statique immédiat :** Le micro-service remplace le contenu des nœuds `[data-i18n="<key>"]` (ainsi que `<title>` et `<meta name="description">`) directement dans les fichiers HTML compilés de `/var/www/staging` et `/var/www/html` en moins de 10 ms, sans exécuter `astro build` sur le VPS.

## 5. Contrôle d'Accès Staging : Basic Auth `admin` & Jeton Read-Only par Révision

- **Fermeture par défaut :** Toute requête sur `staging.sdrnow.fr` sans en-tête Basic Auth `admin` valide ni jeton Read-Only correspondant à la révision courante du staging reçoit `401/403`.
- **Accès `admin` (Basic Auth HTTP) :** L'authentification Basic Auth `admin` (Jean-Charles) injecte/active le script de l'éditeur In-Page et autorise les appels `POST /api/*`.
- **Lien Read-Only (`?preview=<token>`) invalidé à chaque modification du Staging :**
  - Le jeton `<token>` est lié à l'état courant du staging (ex. HMAC-SHA256 du contenu `staging/translations.json` ou identifiant de révision régénéré à chaque écriture sur staging).
  - Un relecteur ouvrant `https://staging.sdrnow.fr/?preview=<token>` accède à la page sans popup Basic Auth ; un cookie de session Read-Only (`staging_preview=<token>`) est déposé pour lui permettre de naviguer entre `/` et `/en`.
  - Dès que `admin` modifie ou réinitialise le staging, le jeton change : l'ancien lien `?preview=<token>` et les cookies associés deviennent immédiatement invalides (`401/403`), obligeant à partager le nouveau lien pour toute nouvelle révision.
  - En mode Read-Only, le script d'édition n'est pas servi et tout appel `POST /api/*` renvoie `403 Forbidden`.
