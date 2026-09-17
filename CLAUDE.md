# rljson-tryout

A hobby project that learns rljson by building a self-discovering multi-node
pet shop. `docs/plan.md` explains the decisions, `docs/roadmap.md` is the
work instruction: read its sections 1 to 4 before touching code, then take
the first unticked slice whose dependencies are merged.

## Hard rules

- Never commit to `main`. One slice, one branch `slice/<id>-<name>`, one
  pull request, auto merge with squash after green checks.
- Every merged state builds, passes tests and deploys. No dead code, no
  placeholders, no "to be done later" comments.
- English only inside the repository. Full words as identifiers, no
  abbreviations. Comments only where the code cannot say it.
- Tests ship with the code: Vitest unit tests next to the source, Gherkin
  features for behaviour that a user or another node can observe.
- Nothing is configured on the server by hand. Terraform, cloud-init and
  Kubernetes manifests are the only way to change infrastructure.
- Secrets never enter the repository, logs or pull request comments. Names
  in use: secrets `HCLOUD_TOKEN`, `SONAR_TOKEN`, `ANTHROPIC_API_KEY`,
  `LETSENCRYPT_EMAIL`; variables `AWS_ROLE_ARN`.
- Pin `@rljson/*` packages exactly; upgrade only in a dedicated pull request.
- When something is unclear, write the assumption into the pull request and
  continue. Record what you learn about rljson in `docs/findings/`.

## Commands

```sh
pnpm install
pnpm lint
pnpm typecheck
pnpm test
```

Per package scripts live in `packages/*/package.json`.
