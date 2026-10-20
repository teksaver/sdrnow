# Sprint Change Proposal — Emphase unique, texte normal par défaut

- **Date :** 2026-10-19
- **Initiative :** initiative-integration-retours-client
- **Spec impactée :** `SPEC-client-text-editor` (CAP-2)
- **Mode :** Batch
- **Classification :** Minor
- **Statut :** ✅ Approuvée le 2026-10-19 par Sylvain Tenier, transmise à l'agent Developer

---

## 1. Issue Summary

**Déclencheur :** retour d'usage de l'éditeur in-page sur staging, après le commit `828744a` qui a ajouté le bouton « Texte Normal ».

**Problème :**
1. **Trois notions de formatage (Gras / Emphase / Normal), c'est trop.** Le gras (`<strong>`) fait doublon : la plupart des blocs riches (titres `h1`–`h3`) sont déjà en `font-bold`/`font-extrabold`, donc appliquer du gras n'y change rien visuellement.
2. **Les sélections partielles produisent un balisage fragile.** `toggleFormat()` (`infra/editor-client.js:183`) ne gère que le cas où la sélection est entièrement dans un seul `<em>` repéré depuis `anchorNode`. Si la sélection chevauche une emphase existante, déborde de ses bornes ou couvre deux emphases, l'éditeur produit des `<em>` imbriqués (`<em>a<em>b</em></em>`), adjacents (`<em>a</em><em>b</em>`) ou vides. Le cas cité est typique : une phrase entière en emphase dont on remet une partie en normal.

**Type :** simplification d'exigence suite à l'usage réel, et correction d'une approche DOM qui ne tient pas les cas limites.

**Données existantes concernées :** 4 occurrences de `<strong>` dans `src/i18n/translations.json` :
- `pricing.starter_f1` (FR/EN) : « **100 leads** »
- `legal.s1_intro` (FR/EN) : « **sdrnow.fr** »

---

## 2. Impact Analysis

### Epic / Story Impact
- Le seul périmètre touché est la fonctionnalité Éditeur Client Bilingue (`SPEC-client-text-editor`), capacité **CAP-2**. Les CAP-1, CAP-3, CAP-4 et CAP-5 ne changent pas.
- Aucun epic futur n'est invalidé et rien n'est à resséquencer.

### Principe directeur (nouveau)
> **Sémantiquement, il n'existe qu'une seule mise en valeur : `<em>`, toujours nu.** Son *rendu* est défini par le bloc qui la contient, via un sélecteur CSS centralisé `[data-i18n="<clé>"] em`. Exemples : orange par défaut, souligné blanc sur le titre Pricing sur fond orange, gras sur une puce de tarif ou une ligne de mentions légales.
>
> **Ce qui est partagé et ce qui est propre à chaque langue :** l'*apparence* de l'emphase est définie par bloc et s'applique donc à FR comme à EN. Son *placement*, lui, est propre à chaque langue. Chaque clé a une valeur FR et une valeur EN indépendantes dans `translations.json` (`fr.<clé>` / `en.<clé>`), éditées dans deux champs distincts. On peut donc mettre l'emphase à des endroits différents selon la langue, ou n'en mettre que dans une seule. Ce rendu doit être visible **dans l'éditeur**, à la sélection comme après application, et pas seulement sur la page.

### Artifact Conflicts
| Artefact | Section | Impact |
|---|---|---|
| `spec-client-text-editor.md` | CAP-2, Constraints | Retirer `<strong>` et redéfinir les actions (Emphase / Normal) |
| `spec-client-text-editor/conventions.md` | §1, §2, §3, §4 | Whitelist `<em>`+`<br>`, rendu de `<em>` par bloc, barre d'outils, normalisation serveur |
| `ux-client-text-editor/EXPERIENCE.md` | Semantic Format Toolbar, raccourcis | Retirer `[B Gras]` et `⌘B`, décrire les règles de redécoupage |
| `ux-client-text-editor/DESIGN.md` | l.133, l.165, l.177–178 | Retirer le style `<strong>` et décrire l'aperçu de l'emphase calqué sur le bloc |
| `architecture-client-text-editor.md` | l.97, l.170, l.213 | Whitelist `<em>`, `<br>` et normalisation `<strong>/<b>/<i>` → `<em>` |

### Technical Impact
- `infra/editor-client.js` : suppression du bouton Gras et de `⌘B`. **Réécriture de `toggleFormat()`/`clearFormat()`** en un modèle « aplatir → appliquer → resérialiser » (voir §4, P2). Aperçu de l'emphase dérivé du style calculé du bloc cible.
- `infra/staging-server.js` : `sanitizeValue()` convertit `<strong>`, `<b>` et `<i>` en `<em>`, puis normalise (fusion, pas d'imbrication, pas d'`<em>` vide).
- `src/i18n/translations.json` : migration des 4 `<strong>` en `<em>`.
- `src/styles/emphasis.css` (nouveau) et `src/layouts/Layout.astro` (import) : rendu de `em` centralisé par sélecteur de bloc `[data-i18n="…"] em`.
- `src/components/*.astro`, `src/pages/*.astro` : suppression de toutes les variantes `[&_em]:…` et `[&_strong]:…` (~47 occurrences, 6 fichiers).
- `tests/staging-server.test.js` : mise à jour du test de whitelist et nouveaux tests de normalisation.
- **Pas de changement d'infra ni de CI.** `editor-client.js` reste un fichier unique déployé par `deploy.yml`.

---

## 3. Recommended Approach

**Voie retenue : Direct Adjustment.**

- **Effort :** faible à moyen (~150 lignes nettes : réécriture du formatage côté éditeur, normalisation serveur, migration de 4 valeurs, classes CSS).
- **Risque :** faible. Le modèle à plat est plus simple et plus robuste que la manipulation de `Range` actuelle, et il est testable en fonctions pures.
- **Rollback :** non pertinent. On ne revient pas sur `828744a`, on fait évoluer son bouton « Texte Normal ».
- **Séquencement :** `main` et `staging` sont aujourd'hui ISO (vérifié le 2026-10-19 : `git diff staging origin/main` est vide, `main` = merge PR #5 de `faef39a`). Parcours retenu : implémenter et valider sur `staging`, puis merger dans `main`. Le déploiement CI recopie `translations.json` depuis le dépôt, donc la Prod repart de la version migrée et propre, et les deux environnements redeviennent ISO. Pendant la seule fenêtre de recette sur staging, un « Réinitialiser depuis la Prod » ramènerait les anciens `<strong>`. La normalisation serveur (P3) les convertit en `<em>` à la sauvegarde suivante : ce n'est pas bloquant, mais il est inutile de faire un reset pendant cette fenêtre.

---

## 4. Detailed Change Proposals

### P1 — Barre d'outils : deux actions explicites

**Fichier :** `infra/editor-client.js` (markup toolbar l.389–401, `openDrawerForKey` l.486–497, listeners l.700–757, `updateFormatButtonAria` l.155)

OLD :
```
[ B Gras ]  [ 🔶 Emphase Orange ]  [ ⊘ Texte Normal ]
⌘B → <strong>   ⌘I → bascule <em>   ⌘\ → retire tout
```

NEW :
```
[ 🔶 Emphase · <rendu du bloc> ]  [ ⊘ Normal ]
⌘I → met la sélection en emphase (idempotent)
⌘\ → remet la sélection en normal (idempotent)
⌘B, ⌘U → bloqués (sans effet)
```

- Le bouton Emphase n'est **plus une bascule**. Il met toujours en emphase, et « Normal » remet toujours en normal. Le résultat ne dépend donc jamais de l'état antérieur de la sélection.
- **Libellé dynamique** selon le rendu du bloc : « Emphase · orange », « Emphase · soulignée », « Emphase · gras ». Le cas codé en dur `key === 'pricing.title'` (l.491) disparaît au profit de la dérivation de P4.
- **État visuel des boutons :** le bouton Emphase est mis en évidence si toute la sélection est en emphase, à moitié si elle l'est en partie (indice visuel uniquement, sans `aria-pressed`, puisque ce n'est pas une bascule — amendé en revue le 2026-10-20).
- **Curseur sans sélection (caret) :** Emphase ne fait rien. Normal retire l'emphase de tout le segment `<em>` contenant le curseur, comme aujourd'hui.

*Rationale :* un seul concept sémantique et deux verbes sans ambiguïté, même sur une sélection mixte.

---

### P2 — Modèle « aplatir → appliquer → resérialiser » (cœur du changement)

**Fichier :** `infra/editor-client.js`. Remplace `toggleFormat()` (l.183–246) et `clearFormat()` (l.249–293).

**Algorithme :**
1. **Aplatir** le contenu du champ actif en une suite de jetons : `{ ch, em: bool }` pour chaque caractère et `{ br }` pour chaque saut de ligne. Un caractère est `em: true` s'il a un ancêtre `em`, `strong`, `b` ou `i` dans le champ, ce qui normalise du même coup l'héritage. Les autres éléments (`span`, `div`, `font` insérés par le navigateur) sont transparents.
2. **Convertir la sélection** (`Range`) en offsets de jetons `[start, end)`. Si la sélection sort du champ actif, l'opération ne fait rien.
3. **Appliquer** : `em = true` (Emphase) ou `em = false` (Normal) sur les jetons `[start, end)`.
4. **Resérialiser** en fusionnant les suites contiguës de même état :
   - une suite `em` donne **un seul** `<em>…</em>`, sans jamais d'imbrication ;
   - un `<br>` ferme la suite en cours (`<em>a</em><br><em>b</em>`) ;
   - les espaces en bordure d'une suite `em` sont rejetés à l'extérieur (`mot <em>orange</em> suite`), pour éviter un soulignement ou un fond qui déborde sur un espace ;
   - une suite `em` composée uniquement d'espaces est émise en texte normal (pas d'`<em>` vide ou invisible).
5. **Remplacer** le contenu du champ, **restaurer la sélection** aux mêmes offsets (l'utilisateur garde sa sélection et voit l'état des boutons), puis émettre `input` pour synchroniser la page.

Les étapes 1, 3 et 4 sont des **fonctions pures** (jetons ↔ chaîne), regroupées dans une section isolée du fichier et testables sous `node:test`.

**Cas limites (critères d'acceptation) :**

| # | Avant | Sélection → action | Après |
|---|---|---|---|
| E1 | `<em>Votre SDR externalisé dès demain</em>` | « SDR externalisé » → Normal | `<em>Votre</em> SDR externalisé <em>dès demain</em>` |
| E2 | `mot <em>orange</em> fin` | « mot orange » → Emphase | `<em>mot orange</em> fin` |
| E3 | `<em>orange</em>` | « ran » → Emphase | `<em>orange</em>` (inchangé, idempotent) |
| E4 | `<em>a</em> et <em>b</em>` | « et » → Emphase | `<em>a</em> <em>et</em> <em>b</em>` (respect strict : les espaces non sélectionnés restent normaux) — amendé en revue le 2026-10-20 |
| E4b | `<em>a</em> et <em>b</em>` | « a et b » → Emphase | `<em>a et b</em>` (fusion des suites contiguës) |
| E5 | `<em>a</em> et <em>b</em>` | tout → Normal | `a et b` |
| E6 | `<em>ligne 1<br>ligne 2</em>` | « 1<br>ligne » → Normal | `<em>ligne</em> 1<br>ligne <em>2</em>` |
| E7 | `Appel de 100 leads ou` | « ␣100 leads␣ » (espaces inclus, double-clic typique) → Emphase | `Appel de <em>100 leads</em> ou` (espaces rejetés hors de l'emphase) |
| E8 | `Appel de <strong>100 leads</strong>` (héritage) | ouverture du tiroir puis toute édition | `Appel de <em>100 leads</em>` |
| E9 | `<em>orange</em>` | caret dans « orange » → Normal | `orange` |
| E10 | n'importe quel contenu | sélection hors du champ actif | aucun changement |
| E11 | FR `<em>Votre SDR</em> dès demain` · EN `Your SDR <em>starting tomorrow</em>` | « Votre SDR » → Normal dans le champ FR | FR `Votre SDR dès demain` · EN **inchangé** (les langues sont indépendantes) |

**Hors périmètre (inchangé) :** l'historique natif `⌘Z` du `contenteditable` est déjà cassé par l'implémentation actuelle (`extractContents`) et le restera. Le comportement de frappe en bordure d'un `<em>` (le texte saisi juste après hérite-t-il de l'emphase ?) reste celui du navigateur ; « Normal » permet de corriger.

---

### P3 — Normalisation serveur (défense en profondeur et migration)

**Fichier :** `infra/staging-server.js`, `sanitizeValue()` (l.83–99)

OLD :
```
rich : conserve <em>, <strong>, <br> sans attributs ; supprime le reste
```

NEW :
```
rich :
  1. <strong>, <b>, <i> (avec ou sans attributs) → <em>
  2. supprime toute balise hors <em>, <br> ; supprime les attributs
  3. normalise : déplie les <em> imbriqués, fusionne </em><em>, retire <em></em>
     et les <em> ne contenant que des espaces
plain : inchangé (aucune balise)
```

Si possible, la normalisation (étape 3) réutilise la même logique de sérialisation que P2, pour que client et serveur produisent un balisage identique.

**Tests (`tests/staging-server.test.js`) :**
- l.164–167 : `<strong style>gras</strong>` doit devenir `<em>gras</em>` au lieu d'être conservé en `<strong>`.
- Nouveaux tests : `<em>a<em>b</em></em>` → `<em>ab</em>` ; `<em>a</em><em>b</em>` → `<em>ab</em>` ; `<em></em>` et `<em> </em>` retirés ; `<b>x</b>` et `<i>x</i>` → `<em>x</em>`.
- Tests unitaires des fonctions pures de P2 sur les cas E1 à E9.

---

### P4 — Rendu de l'emphase propre au bloc, visible dans l'éditeur

**4a. Pages : une feuille de style d'emphase centralisée, ciblée par bloc**

Le `<em>` reste **toujours nu** : ni classe, ni attribut, ni style dans les données. Son rendu est entièrement porté par des sélecteurs CSS qui partent du bloc conteneur, identifié par `data-i18n`, et ciblent ses `em` descendants. On peut donc passer une portion en normal puis la remettre en emphase sans rien perdre.

Nouveau fichier `src/styles/emphasis.css`, importé une fois dans `src/layouts/Layout.astro` :

```css
/* Défaut : toute emphase d'un bloc riche = orange SDRnow, sans italique */
[data-i18n-type="rich"] em {
  font-style: normal;
  color: theme('colors.primary');
}

/* Titre Pricing sur fond orange : souligné blanc */
[data-i18n="pricing.title"] em {
  color: inherit;
  text-decoration: underline;
  text-decoration-color: #fff;
}

/* Puce tarif & mentions légales : gras, couleur du texte */
[data-i18n="pricing.starter_f1"] em,
[data-i18n="legal.s1_intro"] em {
  color: inherit;
  font-weight: 700;
}
```

Fichiers `.astro` : **retirer toutes les variantes `[&_em]:…` et `[&_strong]:…`** des conteneurs (~47 occurrences dans `Hero`, `SocialProof`, `Methodology`, `Pricing`, `mentions-legales`, `en/legal-notice`). Les classes de mise en page (`text-3xl font-bold mb-4`, etc.) restent inchangées.

Ajouter une variante d'emphase revient désormais à écrire une règle `[data-i18n="<clé>"] em { … }`, sans toucher ni aux composants ni aux données. Le rendu visuel actuel est conservé à l'identique : « 100 leads » et « sdrnow.fr » restent en gras, non orange.

**4b. Éditeur : aperçu fidèle au bloc**

Dans `openDrawerForKey()` :
- insérer temporairement une sonde `<em>` dans le nœud `[data-i18n=key]` de la page, lire son `getComputedStyle` (`color`, `font-weight`, `text-decoration-line`, `font-style`), puis la retirer ;
- appliquer ce style aux `.sdrnow-input-area em` du tiroir via une variable CSS ou une règle dédiée (remplace la règle fixe orange l.442–448). La couleur n'est reprise que si elle diffère de celle du bloc ; sinon on garde la couleur du texte du tiroir, lisible sur fond sombre ;
- en déduire le libellé du bouton (P1) : `orange`, `soulignée`, `gras` ;
- la page elle-même montre déjà le rendu réel en direct (CAP-1).

*Rationale :* l'utilisateur voit dans le tiroir ce que l'emphase produira réellement dans ce bloc, sans table de correspondance codée en dur.

---

### P5 — Données : migration

**Fichier :** `src/i18n/translations.json`

```
OLD  "pricing.starter_f1": "Appel de <strong>100 leads</strong> ou prospects issus de vos listes"
NEW  "pricing.starter_f1": "Appel de <em>100 leads</em> ou prospects issus de vos listes"

OLD  "pricing.starter_f1": "Calling <strong>100 leads</strong> or prospects from your lists"
NEW  "pricing.starter_f1": "Calling <em>100 leads</em> or prospects from your lists"

OLD  "legal.s1_intro": "Le site <strong>sdrnow.fr</strong> est édité par :"
NEW  "legal.s1_intro": "Le site <em>sdrnow.fr</em> est édité par :"

OLD  "legal.s1_intro": "The website <strong>sdrnow.fr</strong> is published by:"
NEW  "legal.s1_intro": "The website <em>sdrnow.fr</em> is published by:"
```

Le déploiement CI recopie `dist/translations.json` dans le répertoire cible, si bien que staging puis prod reçoivent la donnée migrée sans étape manuelle.

---

### P6 — Documents de planification

**`spec-client-text-editor.md` — CAP-2**

OLD :
> **intent:** L'administrateur peut appliquer uniquement une emphase d'accroche, une importance forte ou un saut de ligne à l'intérieur des blocs de texte riche, tandis que les blocs de données courtes (KPIs, prix, CTA) restent verrouillés en texte brut.
> **success:** Dans un bloc riche, seuls les marqueurs d'emphase orange (`<em>`), de gras (`<strong>`) et de saut de ligne (`<br>`) peuvent être insérés (et tout collage presse-papier est converti en texte brut) ; un bouton dédié permet de dépouiller instantanément tout marqueur sur la sélection pour la rétablir en texte brut normal ; dans un bloc brut, les boutons de formatage et les sauts de ligne sont inactifs.

NEW :
> **intent:** L'administrateur peut, dans un texte normal par défaut, mettre en emphase n'importe quelle portion d'un bloc de texte riche ou la remettre en normal, et insérer des sauts de ligne, tandis que les blocs de données courtes (KPIs, prix, CTA) restent verrouillés en texte brut.
> **success:** Dans un bloc riche, seuls `<em>` (sans attribut) et `<br>` peuvent être produits (tout collage est converti en texte brut). Deux actions, « Emphase » et « Normal », s'appliquent à n'importe quelle sélection, y compris une sélection partielle ou à cheval sur une emphase existante. Le résultat ne contient jamais d'`<em>` imbriqué, adjacent ou vide : les emphases restantes sont redécoupées et fusionnées. Le rendu de l'emphase est défini par le bloc conteneur (sélecteur CSS), visible dans l'éditeur comme sur la page. Dans un bloc brut, les boutons de formatage et les sauts de ligne sont inactifs.

**`spec` — Constraints, 2ᵉ puce :** remplacer « `<em>`, `<strong>` et `<br>` » par « `<em>` et `<br>` sans attribut (le rendu visuel de `<em>` est porté par un sélecteur CSS sur le bloc conteneur, `[data-i18n="<clé>"] em`) ».

**`conventions.md`**
- §1 : `data-i18n-type="rich"` « autorise uniquement `<em>` et `<br>` ».
- §2 : remplacer les puces `<em>`/`<strong>` par :
  > **`<em>` (seule mise en valeur, toujours nu) :** son rendu est défini dans `src/styles/emphasis.css` par des sélecteurs partant du bloc conteneur. Le défaut est `[data-i18n-type="rich"] em` (orange, sans italique) ; les surcharges se font par clé avec `[data-i18n="<clé>"] em`. Variantes existantes : souligné blanc (`pricing.title`, fond orange) et gras couleur texte (`pricing.starter_f1`, `legal.s1_intro`). Les composants Astro ne portent aucune variante `[&_em]` ni `[&_strong]`.
- §3 : les boutons deviennent `[🔶 Emphase · <rendu>]` et `[⊘ Normal]`.
- §4 : « Suppression stricte de toute balise hors `<em>`, `<br>` ; `<strong>`, `<b>` et `<i>` sont convertis en `<em>` ; normalisation sans imbrication ni `<em>` vide ou adjacent ».

**`EXPERIENCE.md`**
- `Semantic Format Toolbar` (l.52) : décrire Emphase et Normal, non basculants, avec les règles de redécoupage (renvoi au tableau E1 à E10).
- Raccourcis (l.73–75) : supprimer `⌘B` ; `⌘I` = Emphase ; `⌘\` = Normal.

**`DESIGN.md`**
- l.133 : supprimer le style `<strong>`.
- l.134 : l'aperçu `<em>` du tiroir reprend le rendu du bloc cible (orange par défaut).
- l.165 : supprimer `[ B Gras ]`.
- l.177–178 : remplacer `[B Gras]` / `<strong>` par `[🔶 Emphase]` / `[⊘ Normal]`.

**`architecture-client-text-editor.md`**
- l.97, l.170, l.213 : whitelist `<em>`, `<br>` et normalisation `<strong>/<b>/<i>` → `<em>`.

---

## 5. Implementation Handoff

- **Classification :** Minor. Implémentation directe par l'agent Developer (`bmad-build`).
- **Changement de stories / epics :** aucun ajout ni retrait. CAP-2 est re-scopé (P6). Ticket unique suggéré pour `bmad-ticket` : *« CAP-2 : emphase unique `<em>`, actions Emphase/Normal idempotentes avec redécoupage, rendu par bloc »*.
- **Ordre conseillé :** P2 (fonctions pures et tests) → P3 (serveur et tests) → P1 et P4b (UI éditeur) → P4a et P5 (pages et données) → P6 (docs).

**Critères de succès :**
1. La barre d'outils d'un bloc riche ne montre que `[🔶 Emphase · …]` et `[⊘ Normal]` ; `⌘B` est sans effet.
2. Les cas E1 à E10 produisent exactement le HTML attendu (tests unitaires verts).
3. Aucun `<strong>` ne subsiste dans `src/i18n/translations.json`, et aucune variante `[&_em]` ni `[&_strong]` dans `src/**/*.astro`. Tout le rendu de `em` est dans `src/styles/emphasis.css`.
3bis. Passer « 100 leads » en Normal puis à nouveau en Emphase redonne exactement le rendu gras d'origine.
4. « 100 leads » et « sdrnow.fr » s'affichent en gras, non orange, comme aujourd'hui. Dans le tiroir, le bouton indique « Emphase · gras » et l'aperçu est en gras.
5. Sur `pricing.title`, le tiroir montre l'emphase soulignée sans cas codé en dur sur la clé.
6. `sanitizeValue` convertit et normalise (`<strong>`, `<b>`, `<i>`, imbrications, `<em>` vides) ; `node --test tests/` est vert.
