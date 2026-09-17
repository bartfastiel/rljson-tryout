# Project plan: rljson-tryout

Status: decided, 2026-09-17. The slices live in [roadmap.md](roadmap.md);
this document keeps the goal, the architecture and the reasoning behind the
decisions.

## 1. Goal

Learn how [rljson](https://github.com/rljson) behaves in practice by building
a small but complete system with it:

- several server nodes that discover each other automatically,
- each node backed by a different database engine,
- each node reachable on its own subdomain and serving a minimal vanilla
  web app that works as well on a phone as on a desktop,
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
| `@rljson/server`        | 0.0.64  | `Server` (hub) and `Client` (spoke): the hub multicasts references and aggregates all clients' stores; clients keep writes local and pull data by reference through the hub, which in turn pulls from the client that has it. Its `Node` class is hard-wired to in-memory storage (see decision D4). |

The central idea to keep in mind: **references travel, data is pulled.** A
write stays local. Only the hash is announced. Whoever wants the row asks for
it by hash, and the priority cascade (local, then hub, then peers) finds it
and caches it on the way back.

Not used, at least initially: `converter`, `cli`, `uikit` (still a skeleton),
`fs-agent`, `mongo-agent` (a MongoDB change-stream sync agent, optional
slice), `io-indexed-db` and `io-fs` (not published to npm).

## 3. Target architecture

### 3.1 Topology

```text
                internet (HTTPS, Let's Encrypt through cert-manager)
                                     │
   node1.rljson-tryout.wer-ist-daniel-schwarz.de ─┐
   node2.rljson-tryout.wer-ist-daniel-schwarz.de ─┼─▶ Traefik ingress (k3s)
   node3.rljson-tryout.wer-ist-daniel-schwarz.de ─┤
   node1-pr-42.rljson-tryout.wer-ist-daniel-schwarz.de (preview) ─┘
                                                            │
   ┌──────────── one Hetzner Cloud server (cx32), single-node k3s ─────────────┐
   │  flannel bridge: one layer 2 segment, UDP broadcast reaches every pod     │
   │                                                                            │
   │  namespace petshop (production)            namespace pr-42 (preview)      │
   │  ┌─ node1 ─────┐ ┌─ node2 ─────┐ ┌─ node3 ─┐  ┌─ node1 ─┐ ┌─ node3 ─┐    │
   │  │ SQLite      │ │ SQL Server  │ │ memory  │  │ sqlite  │ │ memory  │    │
   │  │ blobs, id   │ │ blobs, id   │ │         │  │         │ │         │    │
   │  └─────────────┘ └──────┬──────┘ └─────────┘  └─────────┘ └─────────┘    │
   │                  ┌──────▼──────┐                 domain petshop-pr-42     │
   │                  │ mssql 2022  │                                          │
   │                  └─────────────┘                                          │
   │  domain petshop-production                                                │
   └────────────────────────────────────────────────────────────────────────────┘
```

Production and previews share the pod network and therefore hear each
other's broadcasts. rljson separates them by its `domain` field, which is a
feature we want to exercise anyway.

### 3.2 Anatomy of a node

Every node is the same container image with a different `STORAGE` setting.

```text
┌──────────────────────── node container ─────────────────────────┐
│ HTTP API (Fastify)     /api/*  /status  /health  /  (web app)   │
│ live updates to the browser via server-sent events              │
│ PetShopService         domain operations, e.g. issue an invoice │
│ Db (@rljson/db)   over IoMulti ── local Io ── memory | SQLite | MSSQL
│ Bs (@rljson/bs)   over BsMulti ── local BsFs (blobs)            │
│ SyncAgent              announce change sets, pull incoming ones │
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
| `changeSets`   | rljson `buffets` table listing the rows of one business operation      | the single sync route, atomic visibility      |

Every table gets its `InsertHistory` companion table so that edits form a
DAG and conflicts become detectable. A later slice models the shop
inventory additionally as a rljson cake (slice ids = animal ids, layers =
price, status, owner) to learn the layer and cake concepts on the same data.

Seed data: the Duckburg universe. Scrooge buys Donald the duck, Gyro Gearloose
breeds mechanical parrots and also buys goldfish, the Beagle Boys' orders are
never paid, Magica De Spell returns a black cat. A deterministic generator
(seeded random numbers plus story templates) produces thousands of consistent
rows and identical hashes on every node, which by itself demonstrates
content-addressed deduplication. Species images are generated procedurally as
PNG so that no licensing questions arise.

## 4. Decisions

**D1. Hetzner Cloud instead of AWS.** One provider, one API token, and a
CX32 server (4 vCPU, 8 GB) costs about 0.0113 EUR per hour, so a week is
under 2 EUR. AWS would need VPC, subnets, gateway and security groups for the
same result. Alternative: AWS with an equivalent module; the application side
does not change.

**D2. One server, single-node k3s, several node pods.** AWS VPC forwards
unicast only, Hetzner Cloud subnets are routed at layer 3, and Azure behaves
the same, so UDP broadcast between virtual machines does not work in any of
the three clouds. Pods on the flannel bridge of one k3s node share a layer 2
segment, so rljson's primary discovery path works exactly as designed. k3s
was preferred over Docker Compose because a preview environment becomes a
namespace on the same machine instead of a second server, and because the
declarative workload model fits the "everything in Terraform" requirement.
Cost: about one gigabyte of memory for k3s, Traefik, CoreDNS and
cert-manager. Alternatives: Docker Compose with one server per preview;
several servers with a VXLAN overlay, which is neither simple nor
maintainable.

**D3. One database engine per node, simplest first.** The first node runs
in memory, then SQLite (`io-sqlite-node`) as the first persistent store,
then SQL Server 2022 Express (`io-mssql`) on node2 while node3 stays in
memory on purpose to study restarts and bootstrap. Optional: PostgreSQL with
an `Io` implementation written in this repository against the official
conformance test suite, and MongoDB through `mongo-agent`, which is a
different paradigm in rljson (a change-stream agent, not an `Io`).

**D4. Own role orchestrator instead of `@rljson/server`'s `Node`.** `Node`
creates `IoMem` and `BsMem` itself and passes them to `Server` and `Client`;
there is no way to inject a persistent store. `Server` and `Client` accept
any `Io` and `Bs`, and `NetworkManager` is independent of storage, so the
orchestrator is a small class of our own. This is a good candidate for an
upstream issue or pull request once it works.

**D5. One sync route carrying change sets.** A hub relays exactly one route.
Instead of one connector per table, every business operation writes its rows
plus one row in a `changeSets` buffet table that lists them, and only the
change set hash is announced. Receivers pull the change set and then its
items. This keeps the single-route constraint, gives atomic visibility of an
operation, and makes "what arrived from whom" observable.

**D6. The browser talks HTTP to its node, not the sync protocol.** Keeps the
web app truly vanilla (no bundler, no dependencies) and keeps rljson
mechanics visible on the server side where they can be logged and tested. An
optional slice turns the browser into a real rljson client with IndexedDB.

**D7. Web app as plain HTML, CSS and JavaScript with web components, mobile
first.** Three source files, served by the node, no build step. Layout is
designed for a phone first (single column, bottom navigation, large tap
targets) and widens to a sidebar layout on desktops. Playwright tests run at
both sizes.

**D8. Testing.** Vitest for unit tests. Gherkin features with vitest-cucumber
for domain behaviour, the HTTP API and the multi-node scenarios. Multi-node
integration tests run against Docker Compose in CI (GitHub-hosted runners
have Docker). Coverage is reported to SonarQube Cloud.

**D9. CI, CD and previews.** GitHub Actions. On every pull request: lint,
type check, unit and integration tests, Sonar analysis, Terraform plan for
the cluster, and a preview environment as a Kubernetes namespace with
flattened hostnames (`node1-pr-42.rljson-tryout…`) so that one wildcard DNS
record covers production and all previews. On `main`: everything plus
Terraform apply and a smoke test. Previews are destroyed when the pull
request closes; a scheduled sweep and a manual destroy workflow are the
budget guards. Terraform state lives in an S3 bucket in the existing AWS
account, accessed through OIDC without long-lived keys.

**D10. Deployment mechanics, all in Terraform, in two stages.** Stage 1
creates the Hetzner server with cloud-init that installs k3s and hands the
kubeconfig back to Terraform. Stage 2 uses the Kubernetes and Helm providers
to install cert-manager and the workloads of one environment per workspace.
Two stages because a provider cannot be configured from values that only
exist after the same apply. Images are built by CI and pushed to the GitHub
Container Registry; a deployment is a Terraform apply with a new image tag.
Data volumes (`local-path`) survive redeploys.

**D11. Traefik and cert-manager for HTTPS.** Traefik ships with k3s, so no
extra ingress controller is installed; the community ingress-nginx project
was retired in March 2026. cert-manager issues Let's Encrypt certificates
per hostname through HTTP-01, which needs no DNS API. The ingress only
terminates browser traffic; node-to-node traffic (broadcast, probes, the
socket.io hub connection) stays inside the pod network and never passes the
ingress. Server-sent events pass through Traefik without buffering.

**D12. Static DNS on a persistent address.** Hetzner Cloud DNS does not
accept a zone with more than two labels, so the subdomain cannot be
delegated into a zone of its own, and the parent zone
`wer-ist-daniel-schwarz.de` belongs to a different Hetzner project than the
one the deployment token is scoped to. Therefore a Hetzner primary IP is
created once, two records (`rljson-tryout` and `*.rljson-tryout`) point at
it, and Terraform attaches that address to whatever server it creates. DNS
never changes again, and the server can be destroyed and recreated freely.

**D13. Container image.** Dependencies are fetched from the lockfile in a
cached layer, the service is bundled by esbuild into one file, and the
runtime stage is `node:24-alpine` with that file, the web app and a non-root
user. Roughly the size of the bare Node image plus a few megabytes. A single
executable on `scratch` is an optional experiment; it saves little because
the Node binary dominates the size, and it loses the shell for debugging.

**D14. Optional assistant with the Claude API.** Server-side tool use in the
node (tools: query tables, issue an invoice), a chat box in the web app,
model `claude-opus-5`, key as a deployment secret.

## 5. Budget estimate

| Item                                           | Rate                    | Assumption            | Cost     |
| ---------------------------------------------- | ----------------------- | --------------------- | -------- |
| Server CX32                                    | 0.0113 EUR/h            | 7 days = 168 h        | 1.90 EUR |
| Primary IPv4 address                           | about 0.50 EUR/month    | one month             | 0.50 EUR |
| Previews                                       | namespaces on the same server |                 | 0.00 EUR |
| Terraform state in S3                          |                         |                       | 0.01 EUR |
| GitHub Actions, GHCR, Let's Encrypt, SonarCloud| free for public repos   |                       | 0.00 EUR |
| Claude API (optional assistant)                | per token               | light manual use      | < 1 EUR  |
| **Total**                                      |                         |                       | **about 3.50 EUR** |

Hetzner bills hourly and caps at the monthly price, so a forgotten server
costs at most 6.49 EUR per month. The destroy workflow is the budget guard.

## 6. Slices

See [roadmap.md](roadmap.md), section 5.

## 7. Edge cases mapped to slices

| Edge case                                   | Slices             |
| ------------------------------------------- | ------------------ |
| n-to-m relations (multi-ref and junction)   | B5, B6, D17        |
| binary data                                 | B12, C2, D5        |
| large content                               | B4, B11, C5, D8    |
| merge conflicts                             | B9, D11, D12, D13  |
| concurrency                                 | D9, D10            |
| corrupt payloads from other nodes           | D14, D15, D16      |
| restarts, volatile stores, hub loss         | D4, D6, D7         |
| different database engines                  | C1, C4, E1, E6     |

## 8. Risks

- **Version drift inside the ecosystem.** `io-sqlite-node` and `io-mssql`
  pin older `@rljson/io` and `@rljson/rljson` versions than `db` and
  `server`. Two copies of `rljson` in one process could break hashing or type
  checks. Mitigation: exact pins, `pnpm.overrides`, `pnpm why` in CI, and a
  fallback to SQLite and memory only if SQL Server cannot be aligned.
- **Breaking changes upstream.** All packages are `0.0.x`. Mitigation: pin
  everything, upgrade deliberately in their own pull requests, keep findings
  in `docs/findings/` so they can be reported upstream.
- **Broadcast on the flannel bridge.** Works on a standard single-node k3s;
  if a CNI or kernel setting surprises us, the static hub address layer is
  the fallback and the discovery slice documents it.
- **Memory.** k3s and its add-ons need about one gigabyte, SQL Server
  Express about two. CX32 has eight. Previews run without SQL Server.
- **Kubeconfig hand-off.** Stage 1 fetches it through an automated SSH
  provisioner. An SSH-free variant with a Terraform-generated CA is an
  optional slice.

## 9. What is needed from the repository owner

- Hetzner project `rljson-tryout` with a read-and-write API token as
  repository secret `HCLOUD_TOKEN`, and a primary IPv4 named `rljson-tryout`
  in location Nuremberg.
- Two records in the zone `wer-ist-daniel-schwarz.de`:
  `rljson-tryout A <primary ip>` and `*.rljson-tryout A <primary ip>`.
- SonarQube Cloud organization `bartfastiel-github` with project
  `bartfastiel_rljson-tryout`, token as secret `SONAR_TOKEN`.
- Repository variable `LETSENCRYPT_EMAIL`.
- AWS credentials on the machine that runs the one-time state backend
  bootstrap script (slice A5), which sets the variable `AWS_ROLE_ARN`.
- Optional: `ANTHROPIC_API_KEY` for the assistant slice.

## 10. Repository layout

See [roadmap.md](roadmap.md), section 2.1.
