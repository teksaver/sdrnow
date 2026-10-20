# AGENTS.md

## Git workflow

- Never push directly to `main`. Every change goes through a pull request.
- All work happens on a dedicated development branch (e.g. `feat/<sujet>`, `fix/<sujet>`), never directly on `main`.
- Open a pull request (MR) from that branch and check that the CI passes on it before merging.
- Ask the user for explicit confirmation before any `git push`, and say what the push will trigger: a push to `main` or `staging` deploys to the Scaleway server through `.github/workflows/deploy.yml`.
