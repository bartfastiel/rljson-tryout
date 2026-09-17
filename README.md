# rljson-tryout

A hobby project to learn [rljson](https://github.com/rljson) by building
something real with it: a small network of nodes that discover each other,
synchronise a pet shop dataset between different database backends, and each
serve a tiny web app on their own subdomain.

rljson is a JSON-based exchange format inspired by relational databases:
normalised tables, every row deeply hashed, hashes used as primary keys,
data immutable and synchronised by passing references instead of payloads.
This repository explores how that works out in practice, with a special
interest in the edge cases: n-to-m relations, binary blobs, large content,
merge conflicts, concurrency, and how nodes react to corrupt payloads from
other nodes.

## Status

Bootstrapped. Implementation follows [docs/roadmap.md](docs/roadmap.md)
slice by slice; the reasoning behind the architecture is in
[docs/plan.md](docs/plan.md).

## Principles

- Everything is reproducible from this repository: infrastructure as code,
  containers, CI and CD. Nothing is set up by hand on a server.
- `main` is always deployable. Work happens on feature branches and lands
  through pull requests.
- Clean, readable TypeScript. Tests first where it matters, Gherkin scenarios
  for behaviour that spans nodes.

## Development

```sh
pnpm install
pnpm lint
pnpm typecheck
pnpm test
```

Node 24 runs the TypeScript sources directly (type stripping); there is no
build step in the monorepo. Per-package scripts live in
`packages/*/package.json`.

## Reproducing

### Terraform state backend

`infra/scripts/bootstrap-aws-state-backend.sh` creates the S3 bucket that
holds Terraform state and an IAM role that GitHub Actions assumes through
OIDC, scoped to that one bucket; it finishes by setting the repository
variable `AWS_ROLE_ARN`. Run it once, from a shell with local AWS
credentials that have IAM and S3 rights and an authenticated `gh` CLI:

```sh
infra/scripts/bootstrap-aws-state-backend.sh
```

It is idempotent: re-running it on an already bootstrapped account changes
nothing. Override `GITHUB_REPOSITORY`, `STATE_BUCKET`, `AWS_REGION` or
`ROLE_NAME` as environment variables to reproduce the project under a
different account or repository.

## License

[MIT](LICENSE)
