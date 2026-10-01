---
id: SPEC-sdrnow-landing-page-infra
companions: []
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Infrastructure Landing Page SDRnow

## Why
Déployer la landing page de réassurance SDRnow de manière automatisée, traçable et reproductible. Le choix d'une approche Infrastructure as Code (OpenTofu) couplée à une CI/CD (GitHub Actions) permet de professionnaliser le déploiement et d'assurer une mise en production continue.

## Capabilities

- **CAP-1**
  - **intent:** Déployer et servir la landing page SDRnow publiquement sur internet via une instance virtuelle minimale.
  - **success:** La page est accessible via l'URL publique `https://sdrnow.fr` depuis un navigateur.
- **CAP-2**
  - **intent:** Mettre à jour l'infrastructure et l'application automatiquement à chaque modification du code source.
  - **success:** Un push sur la branche principale du dépôt GitHub déclenche un workflow GitHub Actions qui applique les changements via OpenTofu/cloud-init sur l'instance Scaleway sans intervention manuelle.

## Constraints
- Hébergement obligatoire chez le cloud provider Scaleway via une instance virtuelle (ex: type Play2 ou Stardust).
- Le domaine cible est `sdrnow.fr`, enregistré chez Infomaniak. La configuration (DNS, certificat HTTPS) devra être prévue pour lier ce domaine à l'instance Scaleway.
- L'amorçage système de base (bootstrapping) doit utiliser `cloud-init`.
- Le provisionnement et la gestion de l'infrastructure complète doivent utiliser OpenTofu.
- Le pipeline CI/CD doit être orchestré par GitHub Actions.
- Le dépôt de code hébergeant l'application et l'infrastructure doit être public (open source) sur GitHub.

## Non-goals
- Hébergement multi-cloud ou agnostique (le code IaC sera spécifique à Scaleway).
- Configuration ou déploiement manuel via la console web de Scaleway.
- Déploiement purement serverless/Object Storage (le choix de l'instance virtuelle est acté).

## Success signal
L'infrastructure Scaleway est montée via GitHub Actions, la landing page est visible en ligne sur `https://www.sdrnow.fr` avec un certificat valide, et un changement de code sur GitHub est reflété en production de manière automatisée.

## Assumptions
- **Runtime Web :** L'utilisation de Docker est inutile pour cette itération, on utilise un serveur web le plus leger posisble