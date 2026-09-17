# Project plan: rljson-tryout

Status: draft for review, 2026-09-17.

This document is the roadmap for the project. It states what we want to learn,
the target architecture, the decisions taken so far (with their alternatives),
and the vertical slices in which the work is delivered. Every slice ends in a
state that builds, passes its tests and, from slice 8 on, is deployed to the
internet by CI.

## 1. Goal

Learn how [rljson](https://github.com/rljson) behaves in practice by building
a small but complete system with it:

- several server nodes that discover each other automatically,
- each node backed by a different database engine,
- each node reachable on its own subdomain and serving a minimal vanilla
  web app,
- a pet shop as the example domain, with a large generated dataset of
  interlinked stories,
- a deliberate exploration of the edge cases: n-to-m relations, binary data,
  large content, merge conflicts, concurrency, and the behaviour of honest
  nodes when another node sends corrupt payloads.

Everything is infrastructure as code and runs from CI. Nothing is installed
by hand on a server. The whole thing is meant to run for a few days on a
budget of about 5 EUR.

## 2. rljson in a nutshell (as far as this plan needs it)

rljson is a young ecosystem (organisation created in 2025, all packages on
`0.0.x`, two core maintainers, commits from this week). Expect rough edges and
breaking changes. The parts we build on:

| Package                 | Version | What it gives us                                                                                                                                                                  |
| ----------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@rljson/rljson`        | 0.0.81  | The format: tables of rows, every row and table deeply hashed, `_hash` is the primary key, references are `<table>Ref` columns holding hashes. Table schemas (`TableCfg`), validation, routes, the sync wire protocol, `InsertHistory` as an append-only log whose `previous` links form a DAG, conflict detection types. |
| `@rljson/hash`          | 0.0.19  | Deep hashing (`hip`, `hsh`).                                                                                                                                                      |
| `@rljson/io`            | 0.0.78  | The `Io` storage interface (12 methods) plus `IoMem`, `IoMulti` (priority cascade with write-back caching), `IoPeer` and `IoPeerBridge` (remote `Io` over a socket).             |
| `@rljson/io-sqlite-node`| 1.0.7   | `Io` on SQLite through `node:sqlite`, persisted to a file.                                                                                                                        |
| `@rljson/io-mssql`      | 0.0.30  | `Io` on Microsoft SQL Server.                                                                                                                                                     |
| `@rljson/bs`, `bs-fs`   | 0.0.26 / 0.0.4 | Content-addressed blob storage (SHA-256 ids), in memory or on the file system, plus the same peer and multi composition as `io`. This is where binary images go.          |
| `@rljson/db`            | 0.0.42  | High-level `Db`: `get(route, where)` joins across referenced tables, `insert(route, data)` writes rows and `InsertHistory`, observers, `detectDagBranch` conflict detection, and the `Connector` that speaks the sync protocol over a socket. |
| `@rljson/network`       | 0.0.21  | Peer discovery and hub election with zero rljson knowledge: UDP broadcast first, an optional cloud coordinator second, a static hub address third, manual override always. TCP probing, deterministic election (incumbent, earliest start, node id). |
| `@rljson/server`        | 0.0.64  | `Server` (hub) and `Client` (spoke): the hub multicasts references and aggregates all clients' stores; clients keep writes local and pull data by reference through the hub, which in turn pulls from the client that has it. `Node` wires network topology to hub or client role, but is hard-wired to in-memory storage (see decision D4). |

The central idea to keep in mind: **references travel, data is pulled.** A
write stays local. Only the hash is announced. Whoever wants the row asks for
it by hash, and the priority cascade (local, then hub, then peers) finds it
and caches it on the way back.

Not used, at least initially: `converter`, `cli`, `uikit` (still a skeleton),
`fs-agent`, `mongo-agent` (a MongoDB change-stream sync agent, see slice 22),
`io-indexed-db` and `io-fs` (not published to npm).

## 3. Target architecture

### 3.1 Topology

```text
                     internet (HTTPS, Let's Encrypt via Caddy)
                                     │
   node1.rljson-tryout.wer-ist-daniel-schwarz.de ─┐
   node2.rljson-tryout.wer-ist-daniel-schwarz.de ─┼─▶ Caddy reverse proxy
   node3.rljson-tryout.wer-ist-daniel-schwarz.de ─┘        │
         rljson-tryout.wer-ist-daniel-schwarz.de ─▶ landing page / topology view
                                                            │
   ┌────────────────── one Hetzner Cloud server, Docker Compose ──────────────────┐
   │  docker bridge network "petshop" (one L2 segment, UDP broadcast works)       │
   │                                                                              │
   │  ┌─ node1 ───────────┐  ┌─ node2 ───────────┐  ┌─ node3 ───────────┐        │
   │  │ SQLite (file)     │  │ SQL Server        │  │ in memory         │        │
   │  │ blobs on disk     │  │ blobs on disk     │  │ blobs in memory   │        │
   │  │ role: hub|client  │◀▶│ role: hub|client  │◀▶│ role: hub|client  │        │
   │  └───────────────────┘  └─────────┬─────────┘  └───────────────────┘        │
   │                                   │ mssql://                                 │
   │                         ┌─────────▼─────────┐                                │
   │                         │ mssql 2022 Express│                                │
   │                         └───────────────────┘                                │
   │  optional later: node4 PostgreSQL (own Io), chaos node, second server        │
   └──────────────────────────────────────────────────────────────────────────────┘
```

Why one server and not one server per node: see decision D2.

### 3.2 Anatomy of a node

Every node is the same container image with a different `STORAGE` setting.

```text
┌──────────────────────── node container ─────────────────────────┐
│ HTTP API (Fastify)     /api/*  /status  /health  /  (web app)   │
│ live updates to the browser via server-sent events              │
│ PetShopService         domain operations, e.g. issue an invoice │
│ Db (@rljson/db)   over IoMulti ── local Io ── SQLite | MSSQL | memory
│ Bs (@rljson/bs)   over BsMulti ── local BsFs (blobs)            │
│ SyncAgent              announce own refs, pull incoming refs    │
│ RoleOrchestrator       NetworkManager → hub or client           │
│    hub:    Server + socket.io server on :3000                   │
│    client: socket.io-client connected to the hub                │
└─────────────────────────────────────────────────────────────────┘
   UDP 41234 broadcast (discovery)   TCP 3000 (hub transport, probes)
```

### 3.3 Domain model

Every table is an rljson `components` table with a `TableCfg`. Identity
across versions is an explicit `id` column (rljson calls that a slice id);
`_hash` identifies one immutable version of a row.

| Table          | Columns (besides `_hash`, `id`)                                        | Edge case it exercises                        |
| -------------- | ---------------------------------------------------------------------- | --------------------------------------------- |
| `species`      | `name`, `latinName`, `description`, `imageBlobId`, `imageMimeType`     | binary data (image lives in blob storage)     |
| `traits`       | `name`, `description`                                                  |                                               |
| `animals`      | `name`, `speciesRef`, `breederRef`, `bornOn`, `priceCents`, `backgroundStory`, `traitsRefs` (jsonArray) | large content (story > 4000 chars), n-to-m via a multi-ref column |
| `animalTraits` | `animalRef`, `traitRef`                                                | n-to-m via a junction table, to compare both patterns |
| `persons`      | `name`, `street`, `city`, `email`                                      |                                               |
| `customers`    | `personRef`, `customerNumber`                                          |                                               |
| `breeders`     | `personRef`, `farmName`, `suppliesSince`                               | a breeder can also be a customer (same person) |
| `invoices`     | `invoiceNumber`, `customerRef`, `issuedOn`, `status`                   |                                               |
| `invoiceItems` | `invoiceRef`, `animalRef`, `quantity`, `unitPriceCents`                | references in both directions of a query      |

Every table gets its `InsertHistory` companion table so that edits form a
DAG and conflicts become detectable. Later slices model the shop inventory
additionally as a rljson cake (slice ids = animal ids, layers = price,
status, owner) to learn the layer and cake concepts on the same data.

Seed data: the Duckburg universe. Scrooge buys Donald the duck, Gyro Gearloose
breeds mechanical parrots and also buys goldfish, the Beagle Boys' orders are
never paid, Magica De Spell returns a black cat. A deterministic generator
(seeded random numbers plus story templates) produces thousands of consistent
rows and identical hashes on every node, which by itself demonstrates
content-addressed deduplication. Species images are generated procedurally as
PNG so that no licensing questions arise.

## 4. Decisions

Each decision names the alternatives. They are open for discussion; changing
one before slice 8 is cheap.

**D1. Hetzner Cloud instead of AWS.** Recommended. The domain is already at
Hetzner, and Hetzner DNS is now part of the Cloud API with official Terraform
support (`hcloud_zone_rrset`, provider 1.54 and later, current 1.69). One
provider, one API token, and a CX32 server (4 vCPU, 8 GB) costs about
0.0113 EUR per hour, so three days are under 1 EUR. AWS would need VPC,
subnets, gateway, security groups and a Route 53 zone or DNS delegation for
the same result. Alternative: AWS with an equivalent module; the application
side does not change.

**D2. One server, several node containers, one Docker bridge network.** AWS
VPC forwards unicast only, Hetzner Cloud subnets are routed at layer 3, and
Azure behaves the same, so UDP broadcast between virtual machines does not
work in any of the three clouds. Containers on one Docker bridge share a
layer 2 segment, so rljson's primary discovery path (UDP broadcast) works
exactly as designed. This is also the cheapest and simplest option. A second
server is an optional later slice (21) to watch the fallback cascade
(broadcast fails its self-test, static or cloud layer takes over) for real.
Alternative: several servers with a VXLAN overlay, which is neither simple nor
maintainable.

**D3. One database engine per node.** node1 SQLite (`io-sqlite-node`), node2
SQL Server 2022 Express (`io-mssql`), node3 in memory (`IoMem`, volatile on
purpose to study restarts and bootstrap). Optional node4 PostgreSQL with an
`Io` implementation written in this repository against the official
conformance test suite (slice 18). MongoDB is a different paradigm in rljson
(a change-stream agent, not an `Io`) and is an optional slice 22.

**D4. Own role orchestrator instead of `@rljson/server`'s `Node`.** `Node`
creates `IoMem` and `BsMem` itself and passes them to `Server` and `Client`;
there is no way to inject a persistent store. `Server` and `Client` accept
any `Io` and `Bs`, and `NetworkManager` is independent of storage, so the
orchestrator is a small class of our own. This is a good candidate for an
upstream issue or pull request once it works.

**D5. The browser talks HTTP to its node, not the sync protocol.** Keeps the
web app truly vanilla (no bundler, no dependencies) and keeps rljson
mechanics visible on the server side where they can be logged and tested.
Optional slice 19 turns the browser into a real rljson client with
IndexedDB for a local-first, offline-capable app.

**D6. Web app as plain HTML, CSS and JavaScript with web components.** Three
source files, served by the node, no build step. Inlining into a single file
is a trivial optional step and not planned.

**D7. Testing.** Vitest for unit tests. Gherkin features with vitest-cucumber
for domain behaviour, the HTTP API and the multi-node scenarios. Multi-node
integration tests run against Docker Compose in CI (GitHub-hosted runners
have Docker). Coverage is reported to SonarQube Cloud.

**D8. CI, CD and previews.** GitHub Actions. On every pull request: lint,
type check, unit and integration tests, Sonar analysis, `terraform plan`, and
a preview environment. On `main`: everything plus `terraform apply` and a
deployment. A preview environment is its own Terraform workspace with its own
server and DNS wildcard (`*.pr-42.rljson-tryout.wer-ist-daniel-schwarz.de`),
created when the pull request opens and destroyed when it closes. A scheduled
sweep destroys preview environments whose pull request is no longer open, and
a manual workflow destroys everything. Terraform state lives in an S3 bucket
in the existing AWS account (cost is cents). Alternative: HCP Terraform free
tier, which needs another account.

**D9. Deployment mechanics.** Images are built by CI and pushed to the
GitHub Container Registry (public, like the repository). The server is
created by Terraform with cloud-init that installs Docker and writes the
Compose file and Caddyfile from templates. A redeploy is a `terraform apply`
with a new image tag; a `terraform_data` resource with a remote-exec
provisioner (SSH key generated by Terraform, never handled manually) runs
`docker compose pull` and `docker compose up -d`. Data volumes survive
redeploys. Alternative: Watchtower polling the registry, which is simpler but
asynchronous and harder to reason about in tests.

**D10. Optional assistant with the Claude API.** Server-side tool use in the
node (tools: query tables, issue an invoice), a chat box in the web app.
Model `claude-opus-5`, key as a deployment secret. Slice 20.

## 5. Budget estimate

| Item                                           | Rate                    | Assumption            | Cost     |
| ---------------------------------------------- | ----------------------- | --------------------- | -------- |
| Production server CX32                         | 0.0113 EUR/h            | 4 days = 96 h         | 1.08 EUR |
| Primary IPv4 address                           | about 0.50 EUR/month    | prorated              | 0.07 EUR |
| Preview servers CX22                           | 0.0060 EUR/h            | 40 h in total         | 0.24 EUR |
| Terraform state in S3                          |                         |                       | 0.01 EUR |
| GitHub Actions, GHCR, Let's Encrypt, SonarCloud| free for public repos   |                       | 0.00 EUR |
| Claude API (optional slice 20)                 | per token               | light manual use      | < 1 EUR  |
| **Total**                                      |                         |                       | **about 2.50 EUR** |

Hetzner bills hourly and caps at the monthly price, so a forgotten server
costs at most 6.49 EUR per month. The scheduled sweep and the destroy
workflow are the budget guards.

## 6. Vertical slices

Each slice is one pull request (slices 0 to 2 land directly on `main` while
the repository is being bootstrapped; branch protection is switched on at the
end of slice 2). Size is a rough T-shirt size.

### Phase 0: bootstrap

**S0. Repository, README, license.** Done.

**S1. This plan.** Done with this document.

**S2. Toolchain and CI.** (M) pnpm workspace, TypeScript strict, ESLint,
Prettier, Vitest with a first test, `CONTRIBUTING.md` describing the branch
and pull request workflow, GitHub Actions `ci.yml` (lint, type check, test),
SonarQube Cloud analysis with `sonar-project.properties` and coverage upload,
Dependabot for npm and actions, branch protection on `main` (CI required,
pull requests only, squash merge). Done when a trivial pull request shows
green checks and a Sonar quality gate.

### Phase 1: rljson in one process

**S3. Domain model as rljson tables.** (M) Package `domain`: `TableCfg` for
all nine tables plus their `InsertHistory` companions, a hand-written
Duckburg example dataset, hashing with `@rljson/hash`, validation with
`Validate` and `BaseValidator`, golden JSON files. Tests show what the
validator catches: a missing reference, a wrong hash, a bad column type.
Learning focus: hashes as keys, `Ref` columns, multi-ref columns, table
configs, what "immutable row" means for an update.

**S4. Seed data generator.** (M) Deterministic generator with a seed, sizes
`small`, `medium`, `large` (about 50 species, 40 traits, 2 000 animals, 300
customers, 50 breeders, 5 000 invoices, 12 000 invoice items). Background
stories above 4 000 characters from story templates, a set of hand-written
arcs woven in, procedural PNG images per species (tiny own PNG encoder over
`node:zlib`), CLI `pnpm seed`. Tests: same seed gives identical hashes,
stories are long enough, every animal has one to five traits, some breeders
are customers, at least one unpaid invoice. Learning focus: how
content-addressing collapses duplicates, size of the resulting rljson file.

**S5. Db in memory: queries and edits.** (L) `PetShopService` over
`@rljson/db` with `IoMem` and `BsMem`: import the seed, route queries
(animal with species and breeder, invoice with items and animals, animals by
trait in both n-to-m styles), issue an invoice, change an animal's price,
read the version history of a row. First Gherkin feature: "Scrooge buys
Donald the duck". Learning focus: routes, `insert`, `InsertHistory`, how to
find the current version of an entity, the `Join` API.

**S6. Persistent stores: SQLite and SQL Server.** (M) The same feature suite
runs against `IoSqliteNode` (file) and `IoMssql` (SQL Server in a Compose
service, also in CI). Findings about type mapping (long strings, `jsonArray`
columns), performance of the large seed import, and version pinning of the
`@rljson/*` packages (the two store packages pin older `io` and `rljson`
versions; unify with `pnpm.overrides` and verify with `pnpm why`). Learning
focus: what an `Io` implementation has to do, where the implementations
differ.

### Phase 2: one node on the internet

**S7. Node service.** (L) Package `node-service`: Fastify HTTP API for the
domain, `/status` (node id, role, peers, table row counts), `/health`,
static serving of the web app, configuration by environment variables
(`STORAGE=sqlite|mssql|memory`, `DATA_DIR`, `NODE_NAME`), structured logging,
multi-stage Dockerfile on `node:24-alpine`, Gherkin API tests. Still a single
node without networking.

**S8. Web app.** (M) `index.html`, `app.js`, `styles.css`. Web components
`pet-list`, `pet-detail` (with image and full story), `invoice-form`,
`node-status`. Live updates via server-sent events. A Playwright smoke test.

**S9. Terraform and continuous deployment.** (L) `infra/terraform`: Hetzner
project resources (SSH key, firewall, CX32 server with cloud-init, primary
IP), DNS records in the Hetzner zone, Caddy with automatic HTTPS, Compose
stack rendered from a template, S3 state backend, `deploy.yml` on `main`
(build and push images to GHCR, `terraform apply`, remote `compose up`).
Done when `https://node1.rljson-tryout.wer-ist-daniel-schwarz.de` serves the
web app with the seed data. Requires the secrets listed in section 9.

**S10. Preview environments and budget guards.** (M) Terraform workspace per
pull request, `preview.yml` (create or update on open and push, comment the
links on the pull request), `preview-destroy.yml` on close, a six-hourly
sweep, and a manual `destroy-all.yml`. Done when a pull request gets its own
`https://node1.pr-<n>.rljson-tryout.wer-ist-daniel-schwarz.de`.

### Phase 3: the network

**S11. Discovery and roles.** (L) `RoleOrchestrator` over `NetworkManager`:
UDP broadcast on the Compose network, TCP probing, hub election, socket.io
transport, hub self-check. Each node runs `Server` when hub and `Client` when
spoke, always over its own persistent `Io` and `Bs`. The status page and the
landing page show who is hub. Compose runs node1 to node3 locally and in
production. Gherkin: "three nodes start, exactly one becomes hub", "the hub
is stopped, a new hub is elected". Learning focus: election rules, startup
race deferral, role transitions, socket namespaces.

**S12. Data synchronisation.** (L) `SyncAgent`: announce every local insert
through the `Connector`, pull every incoming reference through the `Db` and
persist it locally (the `IoMulti` write-back does most of this), bootstrap on
connect. Gherkin: "a customer created on node1 is visible on node2 and node3
within five seconds", "an invoice issued on node2 shows the right animal on
node1". Learning focus: pull by reference, the cascade local, hub, peer, what
happens when the hub does not hold the data itself.

**S13. Binary blobs.** (M) Species images through `Bs`: local `BsFs`, `BsPeer`
via the hub, read-only bridges. The web app on node3 shows an image uploaded
on node1. Tests with large images and identical images uploaded twice.
Learning focus: blob ids versus row hashes, deduplication, streaming.

**S14. Large content and bulk import.** (M) Import the large seed on one node
and watch the others pull it: per-reference pulls versus `readRowsByHashes`,
memory of the in-memory node, timings per store. Stories of 4 000, 40 000 and
400 000 characters. Findings go to `docs/findings/`.

**S15. Layers and cakes.** (M) Model the inventory as a cake: slice ids are
animal ids, layers assign price, status and owner components. A price change
is a new layer row with `base`. Compare with the plain `InsertHistory`
approach from slice 5 for the question "what is the current state of the
shop". Learning focus: slice ids, layers with base and add, cakes, buffets.

**S16. Concurrency.** (M) A load script creates invoices concurrently on all
nodes. Enable `SyncConfig` (client identity, causal ordering, acknowledgement,
gap fill) and observe sequence numbers, missing references, acknowledgement
timeouts and the ref log. Gherkin: "200 concurrent invoices from three nodes
all arrive everywhere exactly once". Learning focus: the hardened sync
protocol and its limits.

**S17. Merge conflicts.** (L) Two nodes edit the same animal while the
network is partitioned (`docker network disconnect`), then reconnect.
`registerConflictObserver` reports the `dagBranch`. The web app lists open
conflicts. A deterministic resolution strategy (field-wise merge, otherwise
the later client timestamp wins, tie broken by client id) writes a merge row
whose `previous` names both tips, which closes the branch on every node.
Gherkin for edit versus edit and edit versus delete. Learning focus: rljson
detects, the application resolves.

**S18. Corrupt payloads and a hostile node.** (M) A `chaos-node` container
that announces references that do not exist, serves rows whose `_hash` does
not match their content, rows with dangling references, wrong `_type`,
oversized values and slow answers. Observe how the honest nodes behave (do
they persist garbage, hang for the 30 second timeout, crash), then harden the
`SyncAgent` with hash verification and validation before persisting.
Findings documented. Learning focus: which guarantees the format gives and
which the application must add.

**S19. Restarts and volatile nodes.** (M) The in-memory node restarts and
bootstraps from the hub; the SQLite node restarts and keeps its identity and
data (identity directory and data volume); the hub is killed and the survivors
re-elect. Gherkin scenarios over Compose restarts.

### Phase 4: optional extensions, pick by interest

**S20. Own `Io` for PostgreSQL.** (L) Package `io-postgres` implemented
against the official conformance tests from `@rljson/io`, node4 in Compose.
The most direct way to learn the storage contract.

**S21. Browser as rljson client.** (L) Bundle `Client`, `Db` and
`io-indexed-db` for the browser, local-first web app that works offline and
syncs when the node is reachable.

**S22. Assistant with the Claude API.** (M) Tool use with two tools (query,
issue invoice), prompts such as "issue an invoice for customer X for the
largest ape" or "how many goldfish were sold this summer". Server-side,
streamed to the chat box in the web app.

**S23. Second server.** (M) A second Hetzner server in the same private
network to show that broadcast does not cross it, then the static hub
address fallback, then a tiny cloud coordinator of our own implementing the
three endpoints the `CloudLayer` expects.

**S24. MongoDB node with `mongo-agent`.** (L) A replica set plus the agent,
the pet shop collections synchronised through the components and edits chain.

**S25. k3s instead of Compose.** (M) Single-node Kubernetes on the same
server, manifests applied from CI.

## 7. Edge cases mapped to slices

| Edge case                                   | Slices             |
| ------------------------------------------- | ------------------ |
| n-to-m relations (multi-ref and junction)   | S3, S5, S15        |
| binary data                                 | S4, S13            |
| large content                               | S4, S6, S14        |
| merge conflicts                             | S5, S17            |
| concurrency                                 | S16                |
| corrupt payloads from other nodes           | S18                |
| restarts, volatile stores, hub loss         | S11, S19           |
| different database engines                  | S6, S20, S24       |

## 8. Risks

- **Version drift inside the ecosystem.** `io-sqlite-node` and `io-mssql`
  pin older `@rljson/io` and `@rljson/rljson` versions than `db` and
  `server`. Two copies of `rljson` in one process could break hashing or type
  checks. Mitigation: exact pins, `pnpm.overrides`, `pnpm why` in CI, and a
  fallback to SQLite and memory only if SQL Server cannot be aligned.
- **Breaking changes upstream.** All packages are `0.0.x`. Mitigation: pin
  everything, upgrade deliberately in their own pull requests, keep findings
  in `docs/findings/` so they can be reported upstream.
- **Broadcast on the Docker bridge in production.** Works on a standard
  bridge; if Compose or the kernel configuration surprises us, the static hub
  address layer is the fallback and slice 11 documents it.
- **SQL Server memory.** Express needs about 2 GB. CX32 has 8 GB; if
  previews on CX22 are too tight they run without node2.
- **DNS zone location.** Terraform needs the zone in the Hetzner Cloud
  Console (the new DNS). If `wer-ist-daniel-schwarz.de` is still in the
  legacy DNS console, it needs the one-time migration first, or the
  community `hetznerdns` provider as a stopgap.

## 9. What is needed from the repository owner

Before slice 9 can deploy:

- `HCLOUD_TOKEN`: a read and write API token of a Hetzner Cloud project that
  also holds the DNS zone.
- `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` for the Terraform state
  bucket, or the decision to use HCP Terraform instead.
- `SONAR_TOKEN` and a SonarQube Cloud project for `bartfastiel/rljson-tryout`
  (slice 2).
- Confirmation that the DNS zone is in the Hetzner Cloud Console.
- Later, for slice 22: `ANTHROPIC_API_KEY`.

## 10. Repository layout

```text
packages/
  domain/          table configs, seed generator, image generator
  node-service/    HTTP API, role orchestrator, sync agent, Dockerfile
  web-app/         index.html, app.js, styles.css, Playwright tests
  chaos-node/      the hostile node (slice 18)
  io-postgres/     optional own Io (slice 20)
infra/
  terraform/       environment module, prod and preview workspaces
deploy/
  compose/         docker-compose.yml, Caddyfile template, landing page
docs/
  plan.md          this document
  decisions/       one short record per decision that changes
  findings/        what we learned about rljson, slice by slice
.github/workflows/ ci.yml, deploy.yml, preview.yml, preview-destroy.yml,
                   preview-sweep.yml, destroy-all.yml
```
