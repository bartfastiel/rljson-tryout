# Contributing

This repository is built slice by slice, following
[docs/roadmap.md](docs/roadmap.md). The rules below are the working rules
from roadmap section 1, in short form. Read the roadmap before you start;
this file only repeats what a contributor needs to remember day to day.

## Branch and pull request flow

- Never commit to `main` directly.
- One slice, one branch, one pull request. Branch names follow
  `slice/<id>-<short-name>`, for example `slice/a3-node-service-health`.
- Open the pull request with `gh pr create` and let it merge with squash
  after its checks pass. `main` stays deployable at every point in time.
- A slice is done when its acceptance criteria in the roadmap hold on
  `main`, not before.

## Commits

- One imperative English sentence as the subject, at most 72 characters, no
  trailing period, for example `Add health endpoint to node service`.
- A body only when the why is not obvious from the subject or the diff.
- Commit in small steps that each build and pass their tests.

## Tests

- Unit tests with Vitest live next to the source they test (`*.test.ts`).
- Behaviour that a user or another node can observe gets a Gherkin feature
  (`features/*.feature`, steps in `features/steps/`).
- Coverage of new code stays above 80 percent; the `checks` job runs a
  SonarCloud analysis on every push and pull request, and on a pull request
  it additionally fails when the quality gate does not pass (a long-lived
  branch like `main` has no new-code period on its first analysis, so the
  gate step only runs where merging is decided). SonarCloud pull request
  decoration (a separate check and inline comments from the SonarCloud
  GitHub app) needs that app bound to the repository, a one-time step for a
  human; until then the gate result only shows in the `checks` job log.

## English and naming

- Everything that enters the repository is in English: code, comments,
  commit messages, pull request text, documentation, workflow names,
  Terraform descriptions.
- Identifiers are full words, no abbreviations (`invoiceItem`, not
  `invItm`). Comments only where the code cannot say it.

## Secrets and infrastructure

- Secrets never appear in the repository, in logs or in pull request
  comments. Refer to them by name only, for example `HCLOUD_TOKEN`.
- Nothing is configured on a server by hand. Terraform, cloud-init and
  Kubernetes manifests are the only way to change infrastructure.
  Interactive SSH is only for reading logs while debugging, never for
  changing state.

## Commands

```sh
pnpm install
pnpm lint
pnpm typecheck
pnpm test
```

Per package scripts live in `packages/*/package.json`.

## Where to look next

- [docs/roadmap.md](docs/roadmap.md) lists every slice in build order with
  its acceptance criterion; take the first unticked one whose dependencies
  are merged.
- [docs/plan.md](docs/plan.md) explains the reasoning behind the
  architecture.
- [docs/findings/](docs/findings/) records what was learned about rljson
  while building each slice.

When something is unclear, write the assumption into the pull request
description and continue instead of waiting for an answer.
