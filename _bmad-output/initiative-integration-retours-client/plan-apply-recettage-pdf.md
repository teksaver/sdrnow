---
title: 'apply-recettage-pdf'
type: 'feature'
ticket: ''
created: '2026-10-07'
status: 'built'
route: 'oneshot'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: []
baseline_revision: '845da96208221cee36eab09530eeba410f60b6b5'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Le client a fourni une liste de modifications (R1 à R19) dans le document de recettage (SDRnow siteweb recettage v0 > v1.pdf) à appliquer sur la landing page staging.

**Approach:** Appliquer les corrections de texte, d'espacements et de contenu directement dans le fichier `public/staging.html` selon les recommandations du document.

</frozen-after-approval>

## Implementation Notes

Toutes les recommandations du document `SDRnow siteweb recettage v0 > v1.pdf` ont été implémentées dans `public/staging.html` :
- R1-R7 : Modification du Hero (ajout du texte logo, texte d'accroche et CTA).
- R8-R10 : Section "Preuve par l'exemple" mise à jour (textes, tailles de police et espacements des 4 blocs KPIs).
- R11-R12 : Réécriture des blocs Méthodologie.
- R13-R17 : Mise à jour des offres dans la section Pricing (textes, suppression des éléments demandés, et alignement des blocs via retrait de classe `transform`).
- R18-R19 : Footer mis à jour avec lien LinkedIn et contact SDRnow.
- Typo corrigée suite à la revue de code.

## Plan Change Log

## Review Triage Log
- low: Typo (majuscule manquante) sur le premier bullet du Bloc 1 (corrigée)
- false: Paragraphe introductif du Bloc 3 non mis à jour (le document R12 ne demandait pas de le changer)
- false: Suppression de l'email dans le footer (le document R19 demandait explicitement de le remplacer par le lien LinkedIn)

## Verification

**Manual checks (if no CLI):**
- Ouvrir le fichier `public/staging.html` et vérifier que chaque demande de R1 à R19 a été implémentée correctement.
