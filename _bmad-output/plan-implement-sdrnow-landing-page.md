---
title: 'Implement SDRnow Landing Page & Infrastructure'
type: 'feature'
ticket: ''
created: '2026-10-01'
status: 'built'
baseline_revision: 'NO_VCS'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: ['/Users/sylvaintenier/Progra/sdrnow/_bmad-output/architecture-sdrnow-infra/architecture-sdrnow-infra.md', '/Users/sylvaintenier/Progra/sdrnow/_bmad-output/ux-sdrnow-landing-page/proposition-ux-sdrnow.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** We need to deploy the SDRnow landing page (an HTML/CSS one-pager) to a Scaleway server using an immutable static server paradigm, meaning no manual server configuration and deployment via CI/CD.

**Approach:** Implement a minimal landing page using HTML and Tailwind CSS matching the UX proposal. Write an OpenTofu (`main.tf`) configuration to provision the smallest Scaleway instance (Play2/Stardust) and configure a `cloud-init.yaml` to install Caddy, fetch the HTML from GitHub (or write it inline if simpler, but fetching is better), and serve it via HTTPS on `sdrnow.fr`. Finally, configure a GitHub Actions workflow to run OpenTofu automatically.

## Boundaries & Constraints

**Always:** 
- The web server must be Caddy, installed and configured via `cloud-init`.
- Infrastructure provisioning must be automated via OpenTofu.
- CI/CD must run via GitHub Actions.
- The landing page must be a single static HTML file with no dynamic backend logic, styled accurately per the SDRnow UX proposal (minimalist, orange/white theme).

**Never:** 
- Do not use Docker.
- Do not rely on manual server configuration (ClickOps or manual SSH).
- Do not add complex frameworks (React, Next.js, etc.) for a single static page.

</frozen-after-approval>

## Code Map

- `public/index.html` -- New file. Contains the minimalist one-page landing page (Hero, Methodology, Pricing, Footer).
- `infra/cloud-init.yaml` -- New file. Cloud-init script to install Caddy, set up the Caddyfile for `sdrnow.fr`, and clone/download the `index.html` file into the web root.
- `infra/main.tf` -- New file. OpenTofu configuration utilizing the Scaleway provider to create an instance and inject the `cloud-init.yaml` user_data.
- `.github/workflows/deploy.yml` -- New file. GitHub Actions workflow to setup OpenTofu, init, and apply the infrastructure.

## Tasks & Acceptance

**Execution:**
- [ ] `public/index.html` -- Create the HTML landing page using Tailwind CSS via CDN. Implement the Hero, Methodology, and Pricing sections according to the UX proposal.
- [ ] `infra/cloud-init.yaml` -- Write the `#cloud-config` payload to install Caddy, create a Caddyfile setting up `sdrnow.fr`, and download `index.html` to the Caddy root directory.
- [ ] `infra/main.tf` -- Write the OpenTofu code. Define the Scaleway provider, configure a small instance, and attach the `cloud-init.yaml` as `user_data`.
- [ ] `.github/workflows/deploy.yml` -- Create a CI/CD workflow that triggers on push to main, installs OpenTofu, configures the Scaleway API key credentials, and runs `tofu init` and `tofu apply -auto-approve`.

**Acceptance Criteria:**
- Given a push to the main branch, when the GitHub Actions workflow runs, then OpenTofu should successfully apply the configuration.
- Given the infrastructure is applied, when a user accesses `https://sdrnow.fr`, then the SDRnow landing page is served securely via Caddy.

## Implementation Notes

## Plan Change Log

## Review Triage Log

- `high` [patch] `.github/workflows/deploy.yml` / `infra/main.tf`: L'état (state) OpenTofu n'est pas persisté, causant la recréation de l'infrastructure à chaque push.
- `high` [patch] `infra/cloud-init.yaml`: L'installation de Caddy dans `runcmd` bloquera l'instance sur un prompt interactif `dpkg` car `write_files` a déjà créé `/etc/caddy/Caddyfile`.

## Verification

**Commands:**
- `tofu fmt -check` -- expected: All OpenTofu files are correctly formatted.

**Manual checks (if no CLI):**
- Inspect `public/index.html` visually in a browser to ensure it matches the minimalist orange/white design with the required sections.
- Verify `cloud-init.yaml` correctly registers the Caddyfile syntax for `sdrnow.fr`.
