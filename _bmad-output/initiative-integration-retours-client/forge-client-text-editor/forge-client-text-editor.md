# Forged Idea: Éditeur Client Bilingue In-Page (SDRnow)

## Locked Decisions
- **Éditeur In-Page sur `staging.sdrnow.fr` (`data-i18n`)** : Édition directement sur la vraie page Astro pour garantir 100 % du rendu CSS Tailwind en temps réel, sans dupliquer les templates.
- **Unité de traduction = Unité de sens** : 1 bloc éditable FR/EN par élément structurel (titre, paragraphe, puce, chiffre KPI, CTA). Fusion des clés découpées artificiellement pour le style (`hero.title_pre` + `hero.title_highlight` $\rightarrow$ `hero.title`).
- **Distinction `plain` vs `rich`** :
  - `data-i18n-type="plain"` (KPIs, prix, boutons CTA) : texte brut uniquement, aucun saut de ligne ni balise.
  - `data-i18n-type="rich"` (titres, paragraphes, puces) : seules les balises `<em>`, `<strong>` et `<br>` sont autorisées. Collage (`paste`) forcé en `text/plain`.
- **Contrat HTML5 sémantique pur (zéro classe CSS ni `<span>` dans le JSON)** :
  - `<em>` = emphase d'accroche, stylée par CSS en orange SDRnow (`text-primary not-italic`).
  - `<strong>` = importance forte, stylée par CSS en gras (`font-bold`).
- **UX Tiroir Bilingue Pleine Largeur** : Au clic sur un bloc en mode édition, ouverture d'un tiroir flottant en bas d'écran affichant les champs FR et EN côte à côte + boutons `[Gras]` et `[Emphase Orange]`. Le focus dans le champ FR ou EN bascule instantanément la langue affichée sur toute la page sans rechargement.
- **Workflow à 2 paliers + Reset** :
  - **Enregistrer sur Staging** : patche `/var/www/staging` en `< 10 ms` + commit `src/i18n/translations.json` avec `[skip ci]` sur la branche `staging`.
  - **Publier en Prod** : patche `/var/www/html` (et `/var/www/staging`) en `< 10 ms` + commit `src/i18n/translations.json` avec `[skip ci]` sur `main` (et `staging`).
  - **Réinitialiser le Staging depuis la Prod** : écrase les essais du Staging en recopiant les textes actuellement en ligne sur `sdrnow.fr` (`main`), sans jamais toucher à la Prod.
  - Validation serveur : interdiction d'enregistrer un bloc vide, whitelist stricte des clés et purge HTML hors `<em>`, `<strong>`, `<br>`.
- **Contrôle d'accès à 2 niveaux (Staging jamais public)** :
  - Par défaut, `staging.sdrnow.fr` renvoie `401/403` au grand public.
  - **Compte `admin` (Jean-Charles) via Basic Auth HTTP** : débloque l'interface d'édition et les routes d'écriture (`POST /api/staging`, `/api/publish`, `/api/reset`).
  - **Lien de partage Read-Only (`?preview=<token>`) à expiration par révision** : généré depuis l'interface admin sans Basic Auth requis pour le relecteur (pose un cookie de session lecture seule pour naviguer entre `/` et `/en`), et invalidé automatiquement dès que le Staging est à nouveau modifié ou réinitialisé.

## Rejected Options & Why
- **Outil limité au Staging avec mise en prod manuelle par le dev** : Rejeté — frustrant pour le client d'attendre une intervention humaine après avoir validé ses textes.
- **CMS Formulaires (Keystatic, Decap/Sveltia)** : Rejeté — pas de vraie preview CSS (ou oblige à maintenir les composants Astro en double).
- **CMS Visuels SaaS (TinaCMS, Storyblok)** : Rejeté — disproportionné pour 45 clés, dépendance SaaS externe, et pas d'édition FR/EN côte à côte.
- **1 bloc par élément stylé (`title_pre` / `title_highlight`)** : Rejeté — casse la liberté grammaticale entre le français et l'anglais et fige l'emplacement des mots mis en valeur.
- **Syntaxe Markdown visible (`**`, `==`) ou WYSIWYG libre** : Rejeté — le client ne doit ni apprendre une syntaxe ni pouvoir injecter du HTML arbitraire (« gribouillis ») qui détruirait la grille Tailwind.
- **Déclenchement de GitHub Actions (`deploy.yml`) à chaque sauvegarde client** : Rejeté — crée un délai de 2-3 minutes et une *race condition* si le client publie deux fois de suite rapidement (paré via patch HTML direct + commit `[skip ci]`).
