---
status: final
---
# Foundation
Site web statique "One-page", responsive (Mobile First mais optimisé Desktop pour les lectures par des décideurs B2B au bureau). Framework suggéré : TailwindCSS ou HTML/CSS pur. Référence visuelle stricte : `DESIGN.md`.

# Information Architecture
Le site est un flux linéaire (tunnel de réassurance) :
1. **Hero Section :** La promesse claire et le CTA.
2. **La Méthode (SDRnow) :** Déconstruction du process (Preuve de structuration).
3. **Packages & Pricing :** Starter (1990€) et Strategy (Devis) - Validation du budget.
4. **Footer :** Rappel du CTA (Agenda) et contact direct.

*(Note : Pas de section "Cas d'usage" ou "Blog" conformément à l'Idée Forgée).*

# Voice and Tone
- **Ton :** Direct, assertif, orienté ROI et processus. 
- **Style :** Phrases courtes. On ne vulgarise pas à outrance, on s'adresse à des pairs (Directeurs Commerciaux, Dirigeants).

# Component Patterns
- **Le CTA Unique :** Tous les boutons du site s'intitulent "Mon agenda" (ou variante "Planifier un échange") et pointent tous vers la même URL Calendly externe.
- **Blocs Méthode :** Affichés sous forme de colonnes (Desktop) ou liste empilée (Mobile) avec une icône, un titre (ex: "Approche multicanale") et 2-3 bullet points.

# State Patterns
- Pas de states complexes (pas de modales, pas de sliders). 
- Le clic sur un bouton ouvre le Calendly dans un nouvel onglet (target="_blank") pour ne pas perdre la page de réassurance.

# Key Flows

## Journey 1: La validation budgétaire par l'associé (Le CFO)
- **Protagoniste :** Marc, CFO, n'a jamais parlé à SDRnow.
- **Déclencheur :** Reçoit le lien du VP Sales sur Slack avec la mention "On peut tester le package Starter à 1990€ ?".
- **Action :** Marc ouvre la page sur son ordinateur portable. Il scrolle rapidement le Hero. Il s'arrête sur la section "Méthode" pour vérifier que l'approche est carrée (pas de spam bas de gamme). Il scrolle jusqu'au "Package SDRnow Starter" pour vérifier le périmètre exact des 1990€.
- **Climax :** Marc voit que c'est packagé (100 leads, 3 à 5 jours) et structuré. Il ferme l'onglet et répond "OK pour le test" sur Slack.

## Journey 2: Le prospect prêt à s'engager
- **Protagoniste :** Céline, VP Sales, a eu Jean-Charles au téléphone. Elle veut lancer le projet.
- **Déclencheur :** Elle va sur le site pour retrouver le lien de l'agenda.
- **Action :** Arrive sur la page (sur mobile ou desktop), clique directement sur le bouton "Mon agenda" présent dans le Header.
- **Climax :** Accède au Calendly et réserve son créneau de 30 minutes de closing.
