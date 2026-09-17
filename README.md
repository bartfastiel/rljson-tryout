# rljson-tryout

[![Pipeline](https://github.com/bartfastiel/rljson-tryout/actions/workflows/pipeline.yml/badge.svg)](https://github.com/bartfastiel/rljson-tryout/actions/workflows/pipeline.yml)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=bartfastiel_rljson-tryout&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=bartfastiel_rljson-tryout)
[![License](https://img.shields.io/github/license/bartfastiel/rljson-tryout)](LICENSE)
![Node](https://img.shields.io/badge/node-24-339933?logo=node.js&logoColor=white)

[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=bartfastiel_rljson-tryout&metric=coverage)](https://sonarcloud.io/summary/new_code?id=bartfastiel_rljson-tryout)
[![Bugs](https://sonarcloud.io/api/project_badges/measure?project=bartfastiel_rljson-tryout&metric=bugs)](https://sonarcloud.io/summary/new_code?id=bartfastiel_rljson-tryout)
[![Vulnerabilities](https://sonarcloud.io/api/project_badges/measure?project=bartfastiel_rljson-tryout&metric=vulnerabilities)](https://sonarcloud.io/summary/new_code?id=bartfastiel_rljson-tryout)
[![Code Smells](https://sonarcloud.io/api/project_badges/measure?project=bartfastiel_rljson-tryout&metric=code_smells)](https://sonarcloud.io/summary/new_code?id=bartfastiel_rljson-tryout)
[![Security Rating](https://sonarcloud.io/api/project_badges/measure?project=bartfastiel_rljson-tryout&metric=security_rating)](https://sonarcloud.io/summary/new_code?id=bartfastiel_rljson-tryout)
[![Reliability Rating](https://sonarcloud.io/api/project_badges/measure?project=bartfastiel_rljson-tryout&metric=reliability_rating)](https://sonarcloud.io/summary/new_code?id=bartfastiel_rljson-tryout)
[![Maintainability Rating](https://sonarcloud.io/api/project_badges/measure?project=bartfastiel_rljson-tryout&metric=sqale_rating)](https://sonarcloud.io/summary/new_code?id=bartfastiel_rljson-tryout)
[![Duplicated Lines (%)](https://sonarcloud.io/api/project_badges/measure?project=bartfastiel_rljson-tryout&metric=duplicated_lines_density)](https://sonarcloud.io/summary/new_code?id=bartfastiel_rljson-tryout)
[![Lines of Code](https://sonarcloud.io/api/project_badges/measure?project=bartfastiel_rljson-tryout&metric=ncloc)](https://sonarcloud.io/summary/new_code?id=bartfastiel_rljson-tryout)

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

The system is live at [https://node1.rljson-tryout.wer-ist-daniel-schwarz.de](https://node1.rljson-tryout.wer-ist-daniel-schwarz.de) with a production Let's Encrypt certificate.
Phase A (walking skeleton to production) is complete; phase B (the domain on one node) is in progress.
Slice D1 (discovery and roles) was pulled forward: every node discovers the other nodes of its rljson domain by UDP broadcast, takes part in the hub election and reports the outcome at `/status`; the three-node proof runs against a local Docker Compose setup until slice C3 deploys node2 and node3.
Implementation follows [docs/roadmap.md](docs/roadmap.md) slice by slice; the reasoning behind the architecture is in [docs/plan.md](docs/plan.md).
Every pull request deploys its own preview with a staging certificate.
The manual `Up` and `Down` workflows switch the whole system off and on.

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

The web app lives in `packages/web-app/public` as plain HTML, CSS and
JavaScript modules and is served by the node service at `/`. Its Playwright
tests run with `pnpm --filter @rljson-tryout/web-app test:e2e` (once per
machine: `pnpm --filter @rljson-tryout/web-app exec playwright install chromium`).

### Running the node service

```sh
pnpm --filter @rljson-tryout/node-service start
```

Starts the Fastify server on `0.0.0.0:8080` (override with `HTTP_PORT`) and
answers `GET /health` with `{ status, name, version, commit, startedAt }`.
At start the node seeds its in-memory rljson store with three Duckburg
species, eight Duckburg-flavoured traits, eight Duckburg persons, four
breeders, five customers, ten Duckburg animals, the `animalTraits`
junction table derived from the animals' traits, and six invoices, and
serves them as `GET /api/species`
(`[{ id, hash, name, latinName, description }]`), `GET /api/traits`
(`[{ id, hash, name, description }]`), `GET /api/breeders`
(`[{ id, hash, farmName, suppliesSince, person: { id, name, city } | null }]`,
the supplying person already joined), `GET /api/customers`
(`[{ id, hash, customerNumber, person: { id, name, city } | null }]`),
`GET /api/animals` (optionally narrowed with `?species=<id>`,
`?breeder=<id>`, `?trait=<id>`, or any combination, returning
`[{ id, hash, name, speciesId, speciesName, breederId, breederFarmName, bornOn, priceCents }]`
with the species and breeder already joined but the background story and
the traits left out so the list stays light), `GET /api/animals/:id`
(the same fields plus the full `backgroundStory`, `traits: [{ id, name }]`
and `breeder: { id, farmName, personName, city } | null`, `404` for an
unknown id), `GET /api/invoices` (newest first,
`[{ id, hash, invoiceNumber, issuedOn, status, customer: { id, customerNumber, personName } | null, totalCents, itemCount }]`),
`GET /api/invoices/:id` (the invoice with
`customer: { id, customerNumber, person } | null`,
`items: [{ id, hash, animal: { id, name, speciesName } | null, quantity, unitPriceCents, lineTotalCents }]`,
`totalCents` and `changeSetHash`, the hash of the `changeSets` row that
wrote it, `404` for an unknown id) and `POST /api/invoices` (body
`{ customerId, items: [{ animalId, quantity }] }`, answers `201` with the
invoice as the detail endpoint serves it, or `400` with
`{ statusCode, error, message }` for an unknown customer or animal, no
items or a quantity below one; every invoice is written together with its
items and one change set naming every row, see
[docs/findings/change-sets.md](docs/findings/change-sets.md)), and, as
the web app, at `http://localhost:8080/`. Use `pnpm --filter
@rljson-tryout/node-service dev` to restart on file changes. Stop it with
`Ctrl-C`; it closes the server and exits cleanly.

At start the node also joins its rljson network domain: it binds the
probe listener on `HUB_PORT` (3000) and the UDP broadcast socket on
`BROADCAST_PORT` (41234), announces itself every five seconds, probes
every node it hears, and takes part in the hub election of
`@rljson/network` (earliest start wins, an incumbent hub is kept while it
answers). `GET /status` reports the outcome:
`{ nodeName, nodeId, publicUrl, domain, role, hubNodeId, hubAddress, peers, nodes, storage, tables }`
with `role` one of `starting`, `standalone` (no other node of the domain
is known, or discovery is disabled), `hub` and `client`; `peers` lists
every node discovery knows (`nodeId`, `name` when known, `hostname`,
`addresses`, `port`, `role`, `startedAt`, `firstSeen`, `lastSeen`,
`probe: { reachable, latencyMs, measuredAt } | null`; a peer's `lastSeen`
advances for as long as discovery still lists it, not per heartbeat, so
`probe.measuredAt` and `probe.reachable` tell whether it answered); `nodes` lists every
URL of `NODE_URLS` (this node included and flagged `self`) with the name,
node id and role it reported to this node's poll of its `/status`,
`reachable` from that server-side poll, `seenInTopology` from discovery
and `lastSeen`; `tables` holds the row count of every table of the store.
`/health` and `/status` allow cross-origin reads so that the web app of
one node can probe every other node. Set `DISCOVERY=disabled` for a
single-node run without sockets; the node then reports `standalone` with
an id that lives for the process only. The node id of a node with
discovery persists under `DATA_DIR/identity/<domain>/node-id`.

The web app shows the environment in the header: this node as a badge,
every other node of `NODE_URLS` as a link outlined green when discovery
on this node sees it and red otherwise, with a small marker for the
browser's own `/health` probe. The `Network` view lists the same nodes
with all three signals and the discovered peers, refreshed every five
seconds.

Environment variables the service understands so far:

| Variable            | Default                        | Meaning                                                                                                                                                                                   |
| ------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_NAME`         | `node1`                        | Display name, reported by `/health` and `/status`                                                                                                                                         |
| `HTTP_PORT`         | `8080`                         | Port to listen on, must be an integer 0 to 65535                                                                                                                                          |
| `LOG_LEVEL`         | `info`                         | Pino log level (`fatal`, `error`, `warn`, `info`, `debug`, `trace`)                                                                                                                       |
| `GIT_COMMIT`        | `unknown`                      | Commit shown by `/health`, set by the container build                                                                                                                                     |
| `WEB_APP_DIRECTORY` | `packages/web-app/public`      | Directory served at `/`; must exist (`/app/public` in the image)                                                                                                                          |
| `TRAIT_RELATION`    | `multi-reference`              | How the store reads which traits an animal carries: `multi-reference` (`animals.traitsRefs`) or `junction` (the `animalTraits` table, [docs/findings/n-to-m.md](docs/findings/n-to-m.md)) |
| `RLJSON_DOMAIN`     | `petshop-local`                | rljson network domain; only nodes of the same domain discover each other                                                                                                                  |
| `HUB_PORT`          | `3000`                         | TCP port of the hub transport and of the probe listener                                                                                                                                   |
| `BROADCAST_PORT`    | `41234`                        | UDP port of the discovery announcements                                                                                                                                                   |
| `DATA_DIR`          | `packages/node-service/data`   | Where the node identity lives (`identity/<domain>/node-id`); `/data` in the image                                                                                                         |
| `PUBLIC_URL`        | `http://localhost:<HTTP_PORT>` | This node's own URL as `/status` reports it and as the other nodes link to it                                                                                                             |
| `NODE_URLS`         | empty                          | Comma separated public URLs of every node of the environment, this one included; each is polled for its `/status` every three seconds                                                     |
| `DISCOVERY`         | `enabled`                      | `disabled` turns the broadcast and probe sockets off (unit tests, single-node runs)                                                                                                       |

### Running three nodes with Docker Compose

`deploy/compose/three-nodes.yml` starts three node services of the domain
`petshop-compose` on one bridge network, reachable from the host on the
ports 8301 to 8303 (`NODE1_PORT` to `NODE3_PORT`):

```sh
docker compose -f deploy/compose/three-nodes.yml up --build --wait
curl -s http://localhost:8301/status | jq '{nodeName, role, hubAddress}'
docker compose -f deploy/compose/three-nodes.yml down
```

Within about five seconds (one broadcast interval) exactly one node
reports `hub` and the other two `client` with the same `hubAddress`. The
nodes know each other by their container-internal URLs
(`http://node1:8080` and so on), so the links in the header work between
the containers but not from a browser on the host, which the header shows
as a red browser probe marker next to a green discovery outline. Set
`NODE_SERVICE_IMAGE` to run a pushed image instead of building one, together
with `NODE_SERVICE_PULL_POLICY=missing` unless the image was pulled before
(the compose file never pulls by default, so a local build is never
overwritten by a registry image of the same name). The Gherkin feature
`packages/node-service/features/network.feature` ("three nodes start,
exactly one becomes hub") drives exactly this setup:

```sh
pnpm --filter @rljson-tryout/node-service test:integration
```

It needs Docker, builds the image from the working tree (or uses
`NODE_SERVICE_IMAGE`), waits for the three `/status` endpoints to settle,
checks the roles, the hub address and the node lists, saves the compose
logs to `packages/node-service/test-results/compose/three-nodes.log` and
tears the project down again. `pnpm test` leaves it out; the `integration`
job of the pipeline runs it against the image the `image` job pushed.
What the library does and does not do, and the timings measured, are in
[docs/findings/network-discovery.md](docs/findings/network-discovery.md).

See [CONTRIBUTING.md](CONTRIBUTING.md) for the branch, pull request and
commit conventions.

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

### Server and DNS

`infra/terraform/cluster` creates one Hetzner Cloud server with k3s installed
by cloud-init. The public address and the DNS records are created once by
hand, outside Terraform, so that the server can be destroyed and recreated
without changing DNS:

1. Create a Hetzner Cloud project and an API token with read and write
   permission.
2. In that project, create a primary IPv4 named `rljson-tryout` in the
   location you want the server in, with auto delete switched off. Terraform
   reads it by name and places the server in the same location.
3. In the DNS zone of your domain, point an A record for your subdomain (for
   example `rljson-tryout`) and a wildcard A record (`*.rljson-tryout`) at
   that address.
4. Store the token as the repository secret `HCLOUD_TOKEN`.

The first push to `main` then plans and applies the cluster stage: pull
requests only plan, `main` applies and waits until the Kubernetes API server
answers on port 6443. Terraform then logs in over SSH with the key it
generated, waits for cloud-init and a `Ready` node, and reads the kubeconfig
into the sensitive output `kubeconfig`. This SSH session is automated and
the only one the project uses; nobody logs in to change anything. Any later
change to `cloud-init.yaml` replaces the server on the next apply: the
primary IP and the DNS records stay, everything stored on the server's local
volumes is lost.

The server type is the Terraform variable `server_type` (default `cpx32`, a
regular-performance 4 vCPU, 8 GB machine). The plan resolves the type and
the `ubuntu-24.04` image through data sources and fails on the pull request
when the type does not exist or is sold out in the primary IP's location, so
a cheaper cost-optimized type such as `cx33` can be tried safely: if the
plan passes, it is available.

### Workloads

`infra/terraform/workloads` is the second stage. It reads the kubeconfig
from the state of the cluster stage, configures the `kubernetes`, `helm`
and `kubectl` providers from it and calls the module
`modules/petshop-environment` once per workspace: namespace `petshop` in
workspace `production`, one `Deployment` of the node service per node (so
far only `node1` with the in-memory store), a `ClusterIP` service and a
Traefik `Ingress` per node, plus an ingress for the apex host that routes
to `node1`. The image is the one the `image` job pushed for the same
commit, `ghcr.io/bartfastiel/rljson-tryout/node-service:<commit sha>`.
Every pod receives its discovery configuration from the module:
`RLJSON_DOMAIN` (`petshop-production`, or `petshop-pr-<number>` in a
preview, so that the environments sharing the pod network never see each
other), `HUB_PORT`, `BROADCAST_PORT`, `DATA_DIR=/data` on an `emptyDir`
(the root filesystem is read-only), `PUBLIC_URL` and the `NODE_URLS` of
all nodes of the environment; the container ports 3000 (TCP) and 41234
(UDP) are named in the pod, and the pods share the flannel bridge without
`hostNetwork`.

Every push to `main` deploys automatically: the `image` job pushes
`ghcr.io/<repository>/node-service:<commit sha>`, the `terraform-workloads`
job plans and applies workspace `production` with exactly that reference
and exposes the deployed URLs as a job output, and the `smoke` job runs
`infra/scripts/verify-deployment.sh` against them: it polls `/health` until
it reports the commit that was just pushed with a certificate the runner
trusts, then checks that `http://` redirects, that `/status` reports a
settled discovery role (`standalone`, `hub` or `client`), that
`/api/species` lists species and that `/` serves the web app. The
hostnames follow
`<node>.<base_domain>` with the apex host as an alias of `node1`; with the
default `base_domain` that is

- `https://node1.rljson-tryout.wer-ist-daniel-schwarz.de/health`
- `https://rljson-tryout.wer-ist-daniel-schwarz.de/health`

Traefik redirects `http://` to `https://` permanently. The production
workspace also installs cert-manager (Helm chart from
`charts.jetstack.io`) with the ClusterIssuers `letsencrypt-staging` and
`letsencrypt-production` (ACME HTTP-01 through the `traefik` ingress
class, account email from the repository secret `LETSENCRYPT_EMAIL`, passed
as `TF_VAR_letsencrypt_email`). Every ingress carries a
`cert-manager.io/cluster-issuer` annotation and a `tls` block, so
cert-manager keeps one certificate per host. The root module names
`letsencrypt-production`; when trying a new setup, point it at
`letsencrypt-staging` first (certificates no browser trusts, `curl -k`),
because Let's Encrypt production issues at most five identical
certificates per week. To reproduce under another domain, set the
Terraform variable `base_domain` and the repository secret
`LETSENCRYPT_EMAIL`; nothing else in the stage knows the domain, and the
image reference follows the repository that runs the pipeline.

### Preview environments

Every pull request from this repository deploys its own preview: the same
pipeline applies the workloads workspace `pr-<number>`, which maps to the
namespace `pr-<number>` and the host
`node1-pr-<number>.rljson-tryout.wer-ist-daniel-schwarz.de`, and the
`smoke` job posts one comment with the links and the deployed commit that
later pushes update. Previews take their certificate from the Let's
Encrypt staging issuer so that they never use up the production rate
limit, which means one browser warning per preview (or `curl -k`). The
`Preview destroy` workflow removes the preview when the pull request is
closed or merged, and `Preview sweep` removes every six hours whatever
that missed. [docs/operations.md](docs/operations.md) has the details,
including what happens while the system is switched off.

### Switching the system off and on

The server costs money every hour it exists. The manual workflows `Down`
and `Up` destroy everything and bring it back with one click each; the
Terraform state, the primary IP, the DNS records and the container images
survive in between. [docs/operations.md](docs/operations.md) describes the
sequence, the durations, what is lost and how to recover from a stale
state lock or a server that was deleted by hand.

## License

[MIT](LICENSE)
