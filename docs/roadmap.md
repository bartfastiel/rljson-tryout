# Roadmap and handover

This document is the working instruction for the agents that implement the
project. It is self-contained: conventions, the knowledge about rljson that is
not obvious from its documentation, the fixed names and contracts, and the
slices in the order they are built. `docs/plan.md` explains the reasoning
behind the decisions; this file tells you what to do.

Read sections 1 to 4 completely before starting any slice. Then take the
first slice whose dependencies are merged.

## 1. Working rules

- **One slice, one branch, one pull request.** Branch name
  `slice/<id>-<short-name>`, for example `slice/a3-node-service-health`.
  Never commit to `main` directly. Use a git worktree when several agents work
  in parallel.
- **A slice is done when its acceptance criteria hold on `main`.** Create the
  pull request with `gh pr create`, enable auto merge with
  `gh pr merge --auto --squash`, and wait until it is merged before starting a
  slice that depends on it. Rebase on `main` before pushing.
- **No dead code, no placeholders.** Everything that is merged is used. If a
  slice needs a helper that nothing calls yet, the slice is cut wrong.
- **Vertical.** Every slice touches what it needs from domain to deployment
  and leaves a working system behind. Prefer a smaller slice over a partial
  one.
- **Tests come with the code.** Unit tests with Vitest next to the source
  (`*.test.ts`). Behaviour that a user or a second node can observe gets a
  Gherkin feature (`features/*.feature`, steps in `features/steps/`). Keep
  coverage of new code above 80 percent; the Sonar quality gate enforces it.
  Zero open Sonar issues on new code is a standing rule too: the
  `Sonar issues on new code` step in `checks` fails the pull request when
  SonarCloud reports any.
- **English everywhere in the repository.** Identifiers are full words, no
  abbreviations (`invoiceItem`, not `invItm`). Comments only where the code
  cannot say it.
- **Commit messages** are one imperative sentence in English, followed by a
  blank line and a short body when the why is not obvious.
- **Documentation is part of the slice.** Update `README.md`,
  `docs/findings/`, and this roadmap (tick the slice, note deviations) in the
  same pull request.
- **Never install anything on the server by hand.** The server is created by
  Terraform, everything on it comes from cloud-init and Kubernetes manifests.
  Automated SSH from Terraform is allowed; interactive SSH is only for reading
  logs while debugging, never for changing state.
- **Secrets never appear in the repository, in logs or in pull request
  comments.**
- **Ask by writing.** When something is unclear, write the assumption into
  the pull request description and continue. Do not stop.

## 2. Fixed names and contracts

### 2.1 Repository layout

```text
packages/
  domain/          @rljson-tryout/domain: table configs, seed, images, pure logic
  node-service/    @rljson-tryout/node-service: HTTP API, sync, orchestration
  web-app/         @rljson-tryout/web-app: index.html, app.js, styles.css, tests
  chaos-node/      @rljson-tryout/chaos-node (slice D14 and later)
  io-postgres/     @rljson-tryout/io-postgres (optional, slice E1)
infra/
  scripts/         bootstrap-aws-state-backend.sh
  terraform/
    cluster/       Hetzner server, k3s, DNS records, kubeconfig output
    workloads/     cert-manager, one Kubernetes environment per workspace
      modules/petshop-environment/
deploy/            files copied into the image or referenced by cloud-init
docs/
  plan.md          why
  roadmap.md       what, this file
  findings/        what we learned, one file per topic
.github/workflows/ pipeline.yml, preview-destroy.yml, preview-sweep.yml,
                   down.yml, up.yml
.github/actions/   composite actions shared by the workflows
```

### 2.2 Tooling

- Node.js 24, pnpm via corepack (`packageManager` field in the root
  `package.json`), TypeScript strict with `"module": "NodeNext"`, ESM only
  (`"type": "module"`).
- ESLint flat config with typescript-eslint, Prettier with default settings
  plus `singleQuote: true`.
- Vitest for unit tests, `@amiceli/vitest-cucumber` for Gherkin, Playwright
  for the web app, `undici` or Fastify's `inject` for HTTP tests.
- Fastify for the HTTP server, `socket.io` and `socket.io-client` for the
  hub transport (required by `@rljson/server`).
- Terraform 1.13 or later (S3 backend with `use_lockfile = true`),
  providers `hetznercloud/hcloud` (1.69 or later), `hashicorp/aws`,
  `hashicorp/kubernetes`, `hashicorp/helm`, `hashicorp/tls`, `loafoe/ssh`
  (2.7 or later).
- Container images: `ghcr.io/bartfastiel/rljson-tryout/node-service:<git sha>`
  and `:main`; chaos node analogous.

### 2.3 Cloud, DNS and secrets

| Item                  | Value                                                                                                                                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hetzner project       | `rljson-tryout`                                                                                                                                                                                            |
| Server                | one `cpx32` in location `nbg1`, image `ubuntu-24.04`, k3s installed by cloud-init                                                                                                                          |
| Public IPv4           | Hetzner Primary IP named `rljson-tryout` in `nbg1`, address `162.55.190.77`, created once by hand, attached to the server by Terraform, survives server replacement                                        |
| DNS records           | `rljson-tryout` A and `*.rljson-tryout` A in the zone `wer-ist-daniel-schwarz.de` (Hetzner Cloud Console, project `konsoleH`), pointing to that primary IP, entered once by hand, not managed by Terraform |
| Production hostnames  | `node1.rljson-tryout.wer-ist-daniel-schwarz.de`, `node2…`, `node3…`; the apex host routes to node1                                                                                                         |
| Preview hostnames     | `node1-pr-<n>.rljson-tryout.wer-ist-daniel-schwarz.de`, no apex host (decided in A12)                                                                                                                      |
| Terraform state       | S3 bucket `bartfastiel-rljson-tryout-tfstate`, region `eu-central-1`, keys `cluster/terraform.tfstate` and `workloads/terraform.tfstate` (workspaces add their prefix)                                     |
| AWS access from CI    | OIDC, role ARN in repository variable `AWS_ROLE_ARN`, no access keys                                                                                                                                       |
| Repository secrets    | `HCLOUD_TOKEN`, `SONAR_TOKEN`, `ANTHROPIC_API_KEY`, `LETSENCRYPT_EMAIL`                                                                                                                                    |
| Repository variables  | `AWS_ROLE_ARN`                                                                                                                                                                                             |
| SonarCloud            | organization `bartfastiel-github`, project key `bartfastiel_rljson-tryout`, automatic analysis off                                                                                                         |
| Secret expiry         | `SONAR_TOKEN` and `ANTHROPIC_API_KEY` expire on 2026-12-16, `HCLOUD_TOKEN` does not expire                                                                                                                 |
| Kubernetes namespaces | `petshop` for production, `pr-<n>` for previews                                                                                                                                                            |
| Ingress               | Traefik as shipped with k3s, cert-manager with ClusterIssuers `letsencrypt-staging` (previews) and `letsencrypt-production` (production), HTTP redirected to HTTPS                                         |
| Ports inside a node   | HTTP `8080`, hub transport `3000`, UDP broadcast `41234`                                                                                                                                                   |
| rljson network domain | `petshop-production` in production, `petshop-pr-<n>` in previews                                                                                                                                           |

Why DNS is static: Hetzner Cloud DNS rejects zones with more than two
labels, so the subdomain cannot be delegated into its own zone, and the
parent zone belongs to another Hetzner project than the one `HCLOUD_TOKEN`
is scoped to. The two records therefore point at a primary IP that exists
independently of the server. Terraform reads it with
`data "hcloud_primary_ip"` and attaches it, so the server can be destroyed
and recreated without touching DNS. Anyone reproducing the project in
another domain creates their own primary IP and the two records once; the
README describes it.

### 2.4 Node configuration (environment variables)

| Variable            | Values                                       | Meaning                                                                                                                                                                                    |
| ------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NODE_NAME`         | `node1` …                                    | Display name, also used for the hostname                                                                                                                                                   |
| `STORAGE`           | `memory` (default), `sqlite`, `mssql`        | Which `Io` implementation backs the node: `IoMem`, `IoSqliteNode` over `DATA_DIR/petshop.sqlite` (slice C1), `IoMssql` (slice C4); any other value fails the start                         |
| `DATA_DIR`          | path                                         | Where SQLite file, blobs and node identity live (`/data` in Kubernetes)                                                                                                                    |
| `MSSQL_CONNECTION`  | connection string                            | Only for `STORAGE=mssql`                                                                                                                                                                   |
| `HTTP_PORT`         | default `8080`                               |                                                                                                                                                                                            |
| `HUB_PORT`          | default `3000`                               |                                                                                                                                                                                            |
| `BROADCAST_PORT`    | default `41234`                              |                                                                                                                                                                                            |
| `RLJSON_DOMAIN`     | string, default `petshop-local`              | Network domain for peer discovery                                                                                                                                                          |
| `SEED_SIZE`         | `none`, `small` (default), `medium`, `large` | Seed loaded at first start when every table is empty: `small` is the hand-written seed, `medium` and `large` add generated rows (slice B10); a store that holds rows keeps them            |
| `PUBLIC_URL`        | URL, default `http://localhost:<HTTP_PORT>`  | This node's own URL, shown in `/status` and used for links                                                                                                                                 |
| `NODE_URLS`         | comma separated URLs, default empty          | Public URLs of every node of the environment, this one included; the link list of the header and of `/status` (slice D1)                                                                   |
| `NODE_STATUS_URLS`  | comma separated URLs, default `NODE_URLS`    | Where the `/status` of the `NODE_URLS` entry at the same position is polled; the ClusterIP service URLs in Kubernetes, because Node's `fetch` rejects a preview's staging chain (slice C3) |
| `DISCOVERY`         | `enabled` (default), `disabled`              | `disabled` opens no broadcast or probe socket: unit tests and single-node runs; the node then reports `standalone` with a per-process id                                                   |
| `LOG_LEVEL`         | `info`                                       |                                                                                                                                                                                            |
| `WEB_APP_DIRECTORY` | path                                         | Directory served at `/`, default `packages/web-app/public`, `/app/public` in the image                                                                                                     |
| `TRAIT_RELATION`    | `multi-reference`, `junction`                | Which `TraitRelation` implementation `PetShopStore` reads the animal-trait n-to-m relation through (`docs/findings/n-to-m.md`); default `multi-reference`                                  |

### 2.5 HTTP contract of a node

All responses are JSON unless noted. Identifiers: `id` is the stable
identity of an entity across versions (rljson slice id), `hash` is one
immutable version (`_hash`).

| Method and path                                                  | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`                                                    | `{ status: "ok", name, version, commit, startedAt }`, cross-origin readable                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `GET /status`                                                    | `{ nodeName, nodeId, publicUrl, domain, role, hubNodeId, hubAddress, peers: [...], nodes: [...], transport, sync, storage, tables: { <table>: rowCount } }`, cross-origin readable; `role` is `starting`, `standalone`, `hub` or `client`; `peers` from discovery (`nodeId`, `name`, `hostname`, `addresses`, `port`, `role`, `startedAt`, `firstSeen`, `lastSeen`, `probe`); `nodes` one entry per `NODE_URLS` URL (`url`, `self`, `name`, `nodeId`, `role`, `connectedClients`, `reachable`, `lastSeen`, `seenInTopology`); `transport` the hub transport (slice D2): `{ role: "hub", hubAddress, connectedClients, lastError }`, `{ role: "client", hubAddress, connectedToHub, lastError }` or `{ role: "standalone", hubAddress: null, lastError }`; `sync` the change set synchronisation (slice D3): `{ announced, received, skipped, pending, failed, lastError, transfers: [last 10, newest first] }`, a transfer being `{ direction: "incoming" \| "outgoing", peerNodeId, changeSetHash, changeSetId, tables: { <table>: rowCount }, durationMs, at, status: "completed" \| "pending" \| "failed", error? }` |
| `GET /api/stats`                                                 | `{ nodeName, seedSize, uptimeSeconds, startedAt, rssBytes, tables: { <table>: rowCount } }`, cross-origin readable                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `GET /api/species`                                               | List of current species versions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `GET /api/species/:hash/image`                                   | PNG bytes, `Content-Type: image/png`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `GET /api/traits`                                                | List of current trait versions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `GET /api/animals?species=<id>&breeder=<id>&trait=<id>&q=<text>` | One page of the current animal versions with species and breeder joined, `{ items, total, limit, offset }`; `q` matches the name or species name case-insensitively, `limit` (default 50, at most 200) and `offset` (default 0) select the page, a value out of range answers `400`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `GET /api/animals/:id?version=<hash>`                            | Current version with species, breeder and traits joined; `version` selects an older one                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `GET /api/animals/:id/history`                                   | All versions with InsertHistory rows, newest first                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `PUT /api/animals/:id`                                           | Creates a new version from the current one plus the changed fields; returns it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `GET /api/customers`, `GET /api/breeders`                        | Lists with the person joined                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `GET /api/invoices`, `GET /api/invoices/:id`                     | Invoice with items and animals joined                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `POST /api/invoices`                                             | Body `{ customerId, items: [{ animalId, quantity }] }`, issues an invoice                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `GET /api/conflicts`                                             | Open DAG branch conflicts (slice D11)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `POST /api/conflicts/:table/:id/resolve`                         | Runs the deterministic resolution (slice D12)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `GET /api/events`                                                | Server-sent events: `insert`, `sync`, `topology`, `conflict`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `GET /` and static files                                         | The web app                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

Errors use Fastify's default shape `{ statusCode, error, message }`.

### 2.6 Domain tables

All tables are rljson `components` tables with an `InsertHistory`
companion. Every table has `_hash` and `id` first. References are
`<table>Ref` columns holding a `_hash` of the referenced version; the
generator and the API resolve `id` to the current version when they need it.

| Table          | Columns                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------- |
| `species`      | `name`, `latinName`, `description`, `imageBlobId`, `imageMimeType`                                      |
| `traits`       | `name`, `description`                                                                                   |
| `animals`      | `name`, `speciesRef`, `breederRef`, `bornOn`, `priceCents`, `backgroundStory`, `traitsRefs` (jsonArray) |
| `animalTraits` | `animalRef`, `traitRef`                                                                                 |
| `persons`      | `name`, `street`, `city`, `email`                                                                       |
| `customers`    | `personRef`, `customerNumber`                                                                           |
| `breeders`     | `personRef`, `farmName`, `suppliesSince`                                                                |
| `invoices`     | `invoiceNumber`, `customerRef`, `issuedOn`, `status` (`open`, `paid`, `cancelled`)                      |
| `invoiceItems` | `invoiceRef`, `animalRef`, `quantity`, `unitPriceCents`                                                 |
| `changeSets`   | rljson `buffets` table, see 3.4                                                                         |

Current version of an entity: the version whose InsertHistory row is a tip of
the DAG (no other row names it in `previous`). More than one tip is a
conflict.

## 3. rljson knowledge pack

Versions to pin exactly (no ranges): `@rljson/rljson` 0.0.81, `@rljson/hash`
0.0.19, `@rljson/json` 0.0.23, `@rljson/io` 0.0.78, `@rljson/db` 0.0.42,
`@rljson/bs` 0.0.26, `@rljson/bs-fs` 0.0.4, `@rljson/server` 0.0.64,
`@rljson/network` 0.0.21, `@rljson/io-sqlite-node` 1.0.7, `@rljson/io-mssql`
0.0.30, `@rljson/is-ready` 0.0.17. Check npm for newer versions at the start
of slice B1 and upgrade in a dedicated pull request only.

Sources worth reading, in this order:
`github.com/rljson/rljson.github.io` (`src/content/docs`),
`github.com/rljson/server` (`README.md`, `README.architecture.md`),
`github.com/rljson/db` (`README.architecture.md`),
`github.com/rljson/network` (`README.architecture.md`),
`github.com/rljson/io` (`README.architecture.md`, `src/io.ts`),
`github.com/rljson/bs` (`README.architecture.md`).

### 3.1 Data model in five lines

- A table is `{ _type: 'components', _data: [rows], _hash }`. `hip()` from
  `@rljson/hash` fills in every `_hash` in place; `hsh()` returns a copy.
- A row never changes. A change is a new row with a new hash plus an
  `InsertHistory` row `{ timeId, <table>Ref, route, origin, previous[] }`.
- `TableCfg` describes a table: `key`, `type`, `columns` (first column must be
  `_hash` of type `string`), flags `isHead`, `isRoot`, `isShared`.
  `createInsertHistoryTableCfg(cfg)` derives the companion.
- Column types are `string`, `number`, `boolean`, `json`, `jsonArray`. A
  reference column carries `ref: { tableKey, type }`; a `jsonArray` column
  of hashes is a multi-reference and is validated too.
- `Validate` with `BaseValidator` checks names, hashes, references, trees,
  layers, cakes, buffets.

### 3.2 Db in five lines

- `const db = new Db(io)`; `Route.fromFlat('animals')` addresses a table,
  `/animals@<hash>/species` navigates a reference.
- `db.insert(route, { animals: { _type: 'components', _data: [row] } })`
  returns `InsertHistoryRow[]`; `_type` is mandatory or nothing is written.
- `db.get(route, { _hash })` or `db.get(route, { id })` returns a
  `Container` with `rljson` (tables), `tree` and `cell`.
- `db.getInsertHistory(table)`, `db.detectDagBranch(table)`,
  `db.registerConflictObserver(route, callback)`.
- Tables must be created on every party before use:
  `await party.createTables({ withInsertHistory: [cfg, ...] })` on `Server`
  and `Client`, or through `Core` when working with a bare `Db`.

### 3.3 Server, Client, network

- `new Server(route, io, bs, options)`; `await server.init()`;
  `await server.addSocket(new SocketIoBridge(serverSideSocket))` for each
  connecting client. `server.io` and `server.bs` are multis over the local
  store plus read-only peers into every client.
- `new Client(new SocketIoBridge(clientSocket), io, bs, route, options)`;
  `await client.init()`; `client.db`, `client.connector`, `client.io`.
- `connector.send(ref)` announces; `connector.listen(async (ref) => ...)`
  receives. Self echoes are filtered, duplicates are dropped.
- `SyncConfig` flags (`includeClientIdentity`, `causalOrdering`,
  `requireAck`, `ackTimeoutMs`, `bootstrapHeartbeatMs`) go into
  `ServerOptions.syncConfig` and `ClientOptions.syncConfig`.
- `NetworkManager` from `@rljson/network` takes
  `{ domain, port, identityDir, broadcast: { enabled, port }, probing }`
  and emits `role-changed`, `hub-changed`, `peer-joined`, `peer-left`,
  `topology-changed`. `getTopology()` returns role, hub and peers.
- The `Node` class of `@rljson/server` cannot be used: it creates `IoMem`
  and `BsMem` internally. Build the `RoleOrchestrator` from `NetworkManager`
  plus `Server` and `Client` (slice D1 and D2), modelled after
  `server/src/node.ts` for the transitions.
- Broadcast goes to `255.255.255.255` on a `udp4` socket with `reuseAddr`;
  on the flannel bridge of a single k3s node every pod receives it. Peers
  reach each other on `NodeInfo.localIps` (the pod IP) and `port` (3000).
- A hub relays exactly one route. All synchronisation therefore runs over one
  route (`changeSets`, see 3.4), never one connector per table.

### 3.4 Change sets

One logical change (an invoice with its items, a new animal version) is
written as rows in the domain tables plus one row in the `changeSets` table,
an rljson `buffets` table whose `items` list `{ table, ref }` for every row
written. The `SyncAgent` announces only the change set hash. A receiving node
pulls the change set by hash, then pulls every item by table and hash through
its `Db`; `IoMulti` writes what it pulled into the local store. This keeps the
single-route constraint, gives atomic visibility of a business operation, and
makes "what arrived from whom" observable.

### 3.5 Known pitfalls

- `io-sqlite-node` and `io-mssql` pin older `io` and `rljson` versions, and
  `@rljson/validate` (pulled in by `db` and `io`) pins older `rljson`,
  `hash` and `json`. Keep the `overrides` for `@rljson/rljson`, `@rljson/io`,
  `@rljson/hash`, `@rljson/json` in `pnpm-workspace.yaml` (pnpm 12 ignores
  `pnpm.overrides` in `package.json`) and confirm with `pnpm why -r
@rljson/rljson` that exactly one version is installed. Record the outcome
  in `docs/findings/versions.md`.
- `IoSqliteNode` stores a relative `dbFileName` under `./data/`; pass an
  absolute path built from `DATA_DIR`. It opens the file with SQLite's
  defaults (`journal_mode = delete`, `synchronous = FULL`) and commits
  every `Io.write` on its own, two `fsync`s per `Db.insert`; `createIo`
  switches the connection to WAL with `synchronous = NORMAL`, ten times
  faster on the seed (`docs/findings/stores.md`). Call `init()` once per
  instance: a second call leaks the first connection.
- Long strings and `jsonArray` columns map differently per store; test with
  the 4 000 character story in every store (slice C1, C4). SQLite stores
  both as `TEXT` and round-trips them byte for byte (slice C1); its
  `readRows` `where` clause is built without escaping, so never pass user
  input into it.
- `Db.insert` on a table without `_type` in the payload writes nothing and
  fails later on the InsertHistory row.
- Peer requests time out after 30 seconds by default. A hostile or slow peer
  makes reads slow, not wrong (slice D14).
- Conflict detection is per table and fires on every InsertHistory write;
  resolution is the application's job. A merge row whose `previous` names
  all tips closes the branch.

## 4. Build, image, pipeline

### 4.1 Dockerfile (`packages/node-service/Dockerfile`, context is the repo root)

1. `FROM node:24-alpine AS base`, `corepack enable`.
2. `deps` stage: copy `package.json`, `pnpm-lock.yaml`,
   `pnpm-workspace.yaml` and every `packages/*/package.json`, then
   `RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm fetch`.
   This layer changes only when the lockfile changes.
3. `build` stage: copy the sources, `pnpm install --offline --frozen-lockfile`,
   `pnpm -r typecheck`, then bundle the service with esbuild into one file:
   `esbuild packages/node-service/src/main.ts --bundle --platform=node
--format=esm --target=node24 --sourcemap --outfile=dist/main.mjs` with a
   banner that defines `require` through `createRequire` for dependencies
   that still use it. If a dependency cannot be bundled, mark it external and
   ship it through `pnpm deploy --prod`; document why.
4. `runtime` stage: `FROM node:24-alpine`, `USER node`, copy `dist/main.mjs`,
   the web app files to `public/`, and a `package.json` with name and
   version only. `ENV NODE_ENV=production`, `EXPOSE 8080`, `HEALTHCHECK`
   with `node -e "fetch('http://127.0.0.1:8080/health').then(r => process.exit(r.ok ? 0 : 1))"`,
   `CMD ["node", "dist/main.mjs"]`.
5. Build for `linux/amd64` with Buildx and `cache-from`/`cache-to`
   `type=gha`. Labels `org.opencontainers.image.source` and `.revision`.

### 4.2 Pipeline (`.github/workflows/pipeline.yml`)

Triggers: `pull_request` and `push` to `main`. Jobs:

1. `checks`: pnpm install with cache, lint, typecheck, unit and Gherkin
   tests with coverage, Playwright tests, Sonar scan
   (`SonarSource/sonarqube-scan-action`, needs full git history).
2. `image`: build and push `node-service` (and later `chaos-node`) tagged
   with the commit sha; on `main` additionally `main`. Needs
   `packages: write`.
3. `integration` (needs `image`, skipped for forks and Dependabot like the
   deploy jobs, bounded by `timeout-minutes`): pulls that image and runs
   `pnpm --filter @rljson-tryout/node-service test:integration`, the
   Gherkin features that need the three-node Docker Compose setup of
   `deploy/compose`, and uploads the compose logs on failure.
4. `terraform-cluster`: `plan` on pull requests, `apply` on `main`.
   Workspace `default`. Needs `id-token: write` for AWS and `HCLOUD_TOKEN`.
5. `terraform-workloads`: on `main` workspace `production`, on pull requests
   workspace `pr-<n>` with `apply` (this is the preview, skipped when the
   pull request is no longer open by the time the job starts), image tag
   from job 2, `TF_VAR_letsencrypt_email` from the repository secret.
6. `smoke`: waits until `https://<host>/health` returns the deployed commit
   sha, for production and preview alike, and until `/status` reports a
   settled discovery role (`standalone`, `hub` or `client`; `starting` is
   a transient it waits out); on a pull request it then comments the
   preview links (updating the same comment on later runs).

`concurrency` groups: `cluster`, `workloads-production`, `workloads-pr-<n>`.
Pull requests from forks get no secrets; that is acceptable.

Other workflows: `preview-destroy.yml` on `pull_request: closed` destroys
and deletes workspace `pr-<n>`; `preview-sweep.yml` every six hours destroys
any `pr-*` workspace whose pull request is not open; `down.yml` is a manual
workflow with a confirmation input that destroys workloads and then the
cluster, `up.yml` brings both back (see `docs/operations.md`).

### 4.3 Terraform stage 1, `infra/terraform/cluster`

- `hcloud_ssh_key` from `tls_private_key` (the private key stays in state),
  `hcloud_firewall` allowing 22, 80, 443, 6443 inbound and everything
  outbound, `hcloud_server` `cpx32` with cloud-init `user_data` that installs
  k3s (`curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="server --tls-san
<public ip>" sh -`), and a `HelmChartConfig` for Traefik that redirects
  the `web` entrypoint to `websecure`.
- `data "hcloud_primary_ip"` by name `rljson-tryout`; the server takes its
  `datacenter` from that data source and attaches the address through
  `public_net { ipv4 = data.hcloud_primary_ip.main.id }`. No DNS resources.
- An `ssh_sensitive_resource` of the `loafoe/ssh` provider that logs in as
  root with the generated key, waits for `cloud-init status --wait` and for
  a `Ready` node in `k3s kubectl get nodes`, and reads
  `/etc/rancher/k3s/k3s.yaml`; its `result` is marked sensitive and the
  resource re-runs only when the server id changes. The sensitive output
  `kubeconfig` is that result with the public IP substituted for
  `127.0.0.1`. The provider gets `debug_log = "/dev/null"` so it never
  prints command output. Optional later improvement: build the kubeconfig
  without SSH from a Terraform-generated root CA (k3s custom CA workflow).
- Outputs: `server_ipv4`, `kubeconfig` (sensitive), `ssh_private_key`
  (sensitive).

### 4.4 Terraform stage 2, `infra/terraform/workloads`

- Reads stage 1 through `data "terraform_remote_state"` and configures the
  `kubernetes` and `helm` providers from the kubeconfig.
- Cluster-wide (only in workspace `production`, guarded by `count`):
  `helm_release` cert-manager with CRDs, two `ClusterIssuer` manifests
  (HTTP-01, ingress class `traefik`, email from variable).
- Module `petshop-environment` (every workspace): namespace, one workload
  per node (`Deployment` for memory, `StatefulSet` with a 2 Gi `local-path`
  claim for sqlite and mssql, selected by `nodes[*].storage`), `Service`
  per node, `Ingress` per host with
  `cert-manager.io/cluster-issuer`, optional SQL Server `StatefulSet`
  (`mcr.microsoft.com/mssql/server:2022-latest`, `MSSQL_PID=Express`,
  `MSSQL_MEMORY_LIMIT_MB=1536`, 4 Gi claim) controlled by `enable_mssql`
  (true in production, false in previews).
- Module variables: `environment_name`, `image` (the full reference the
  `image` job pushed), `base_domain`, `hostname_infix`, `cluster_issuer`,
  `enable_apex_ingress`, `nodes` (name and storage per node),
  `rljson_domain`, `seed_size` (one value for every node of the
  environment); slice C4 adds `enable_mssql`. The root module chooses them
  from the workspace name and takes `image`, `base_domain` and
  `letsencrypt_email` (for the issuers) as its own variables.

## 5. Slices

Legend: **Depends on** lists slices that must be merged first. **Done when**
is the acceptance criterion checked in the pull request. Tick the box when
merged.

### Phase A: walking skeleton to production

- [x] **A1 Toolchain and CI.** Depends on: nothing. Root `package.json` with
      pnpm workspace, TypeScript, ESLint, Prettier, Vitest; package `domain`
      with one test that hashes `{ a: 1 }` with `hip` from `@rljson/hash` and
      compares to a golden hash; `pipeline.yml` with the `checks` job (lint,
      typecheck, test). Done when the workflow is green on `main`. Deviation:
      the test uses `hsh` (hash into a copy) instead of `hip` (hash in place) so
      it can assert in the same breath that the input object stays unchanged;
      TypeScript is pinned to the last release below 6.1 because
      `typescript-eslint` 8.70.0 does not yet support TypeScript 7, the newly
      released native compiler.
- [x] **A2 Sonar and branch protection.** Depends on: A1.
      `sonar-project.properties` (organization `bartfastiel-github`, project key
      `bartfastiel_rljson-tryout`, sources `packages`, lcov path, coverage
      exclusions for `packages/web-app/**`, `**/*.test.ts`, `features/**`),
      Sonar step in `checks`, Dependabot for npm, GitHub Actions and Docker,
      `CONTRIBUTING.md` with the rules of section 1, branch protection on `main`
      via `gh api` (pull request required, status checks `checks` and the Sonar
      quality gate required, linear history, no required reviewers). Done when
      a test pull request shows both checks and merges only after they pass.
      Deviation: Dependabot for Docker is deferred to A4, which adds the first
      Dockerfile. The SonarCloud GitHub app does not post its own check run
      without being bound to the repository first (a one-time human step),
      so branch protection cannot require a Sonar status check; the quality
      gate is instead enforced inside the `checks` job with
      `SonarSource/sonarqube-quality-gate-action` after the scan step, run
      only on pull requests (a long-lived branch like `main` has no
      new-code period on its first analysis, so the gate reports status
      `NONE` there and the scan alone keeps running on `main` for the
      baseline and the badges), and branch protection keeps requiring only
      `checks`.
- [x] **A3 Node service with health endpoint.** Depends on: A1. Package
      `node-service`: Fastify server, `GET /health` per 2.5 with version from
      `package.json` and commit from `GIT_COMMIT` env, configuration module for
      the variables in 2.4 (only the ones used so far), structured logging,
      graceful shutdown, tests via `fastify.inject`. Done when `pnpm --filter
node-service start` answers on 8080 and tests pass. Deviation: the package is
      named `@rljson-tryout/node-service` per the repository's npm scope, run
      with `pnpm --filter @rljson-tryout/node-service start`. Graceful
      shutdown on `SIGTERM`/`SIGINT` was verified by code review and by
      confirming the server starts, listens and answers `/health`; sending the
      signal from another process on this Windows development machine could
      not exercise the JS handler because Node.js has no POSIX signal delivery
      on Windows outside a real console `Ctrl-C` (`process.kill` there
      unconditionally terminates the target instead of invoking its listener),
      so the handler will be exercised for real the first time this runs in
      the Linux container this service is built for.
- [x] **A4 Container image.** Depends on: A3. Dockerfile per 4.1,
      `.dockerignore`, `image` job in the pipeline pushing to GHCR. Done when
      `docker run -p 8080:8080 ghcr.io/bartfastiel/rljson-tryout/node-service:<sha>`
      answers `/health` and the image is under 200 MB uncompressed. Note the
      measured size in `docs/findings/image-size.md`. If the GHCR package is
      private after the first push, say so in the pull request; a human sets it
      to public once. Deviation: the `docker image inspect --format '{{.Size}}'` command reports a compressed-looking size on this Docker installation's containerd image store (58.8 MB) rather than the true uncompressed footprint, so the uncompressed size was cross-checked with `du -sx /` inside the running container (about 178 MB, still under the 200 MB budget) and both numbers are recorded in `docs/findings/image-size.md`.
- [x] **A5 State backend bootstrap.** Depends on: nothing.
      `infra/scripts/bootstrap-aws-state-backend.sh`: idempotently creates the
      S3 bucket (versioning, encryption, public access blocked), an IAM role
      `github-actions-rljson-tryout` trusting the existing GitHub OIDC provider
      for `repo:bartfastiel/rljson-tryout:*`, a policy limited to the bucket,
      and sets the repository variable `AWS_ROLE_ARN` with `gh variable set`.
      Run it once with the local AWS credentials. Done when the variable exists
      and `aws sts get-caller-identity` through the role works from a workflow
      step. Deviation: the workflow-step proof of the role moves to A6, whose
      first `terraform init` in CI assumes the role; this slice only bootstraps
      the AWS side and confirms the script is idempotent by running it twice.
      A6 found that GitHub issues the immutable subject
      `repo:<owner>@<owner id>/<name>@<repository id>:...` for this repository,
      so the script now trusts the prefix the GitHub API reports.
- [x] **A6 Server with k3s.** Depends on: A5. Stage 1 per 4.3 with an
      ephemeral address and without the kubeconfig provisioner;
      `terraform-cluster` job. Done when
      `curl -k https://<server_ipv4>:6443/version` answers from CI after
      `apply` on `main`. Deviation: the server attaches the pre-created
      primary IP from the start, because Hetzner attaches a primary IP only to
      a stopped server and switching later would have forced a replacement;
      the server takes `location` (not the deprecated `datacenter`) from the
      data source. Runs on `main` are no longer cancelled by a newer push, so
      an apply is never interrupted. The first apply failed with "server type
      cx32 not found": Hetzner replaced the `cx*2` line by `cx*3` in October
      2025 and the successor `cx33` is sold out in `nbg1`, so the server is a
      regular-performance `cpx32` (variable `server_type`, 0.0569 EUR per
      hour) and preconditions now fail the plan when the type or the image
      is unavailable in the primary IP's location.
- [x] **A7 Kubeconfig hand-off.** Depends on: A6. The `terraform_data`
      provisioner and the `kubeconfig` output. Done when a workflow step runs
      `kubectl get nodes` with the output and sees the node `Ready`. Deviation:
      an `ssh_sensitive_resource` of the `loafoe/ssh` provider replaces the
      `terraform_data` provisioner pair; it retries the SSH connection until
      the server answers, marks its result sensitive so a replacement plan
      never prints the old kubeconfig, and re-runs only when the server id
      changes.
- [ ] **A8 Persistent address.** Depends on: A6. The server switches from
      an ephemeral address to the pre-created primary IP (data source,
      datacenter taken from it); `README.md` gets a section "Reproducing with
      your own domain" describing the primary IP and the two DNS records. Done
      when `dig +short node1.rljson-tryout.wer-ist-daniel-schwarz.de` returns
      the primary IP and a `terraform destroy` plus `apply` of the cluster
      brings the same address back. README part done in A6; the destroy and
      apply proof follows with the destroy workflow of A13.
- [x] **A9 First workload on the internet.** Depends on: A4, A7, A8. Stage 2
      with the module for node1 only (`STORAGE=memory`), plain HTTP ingress,
      `terraform-workloads` job for workspace `production`. Done when
      `http://node1.rljson-tryout.wer-ist-daniel-schwarz.de/health` returns the
      commit sha of `main`. Deviation: the ingress has no TLS section, but
      the Traefik bundled with k3s already redirects the `web` entrypoint to
      `websecure` permanently, so `http://node1…/health` answers 301 or 308
      towards `https://` and the commit is read from
      `https://node1…/health` with `curl -k` (Traefik's self-signed default
      certificate until A10 adds cert-manager); the verification step of the
      pipeline checks both. The module takes no `rljson_domain` variable yet
      because the service does not read `RLJSON_DOMAIN`; the variable joins
      with the slice that introduces it, together with `STORAGE` and
      `SEED_SIZE`.
- [x] **A10 TLS.** Depends on: A9. cert-manager, both issuers, ingress with
      TLS, HTTP redirect. Verify with the staging issuer first, then switch to
      production in the same pull request once the staging certificate was
      issued. Done when `https://node1…/health` has a valid Let's Encrypt
      certificate and `http://` redirects. Deviation: two pull requests
      instead of one, because apply runs only on `main`: #16 installed
      cert-manager with both issuers and pointed the ingresses at
      `letsencrypt-staging`, its `main` run proved the staging certificates,
      and the second pull request flipped the module input to
      `letsencrypt-production` and dropped `-k` from the verification. The
      ClusterIssuers are `kubectl_manifest` resources of `alekc/kubectl`,
      because `kubernetes_manifest` cannot plan a kind whose custom resource
      definition does not exist yet, and the account email is the repository
      secret `LETSENCRYPT_EMAIL` rather than a variable, because the runner
      prints variables used in a job's environment into the public log.
- [x] **A11 Smoke test and deploy chain.** Depends on: A10. `smoke` job,
      concurrency groups, image tag flows from `image` to `terraform-workloads`.
      Done when a change to the health payload lands on the internet through
      one merge without manual steps and the smoke job proves it. The
      change is the field `startedAt` in `/health`. The verification lives
      in `infra/scripts/verify-deployment.sh`, which takes the URLs and the
      expected commit from the environment, so the `smoke` job and the
      manual workflows of A13a reuse it; it also proves `/api/species` and
      the web app at `/`. The `image` job hands its full image reference to
      `terraform-workloads` through a job output, so the registry path is
      spelled once. The concurrency groups `cluster` and
      `workloads-production` existed since A6 and A9; the workflow-level
      group serializes whole runs on `main`, so `smoke` needs no group of
      its own.
- [x] **A12 Preview environments.** Depends on: A11. Workspace `pr-<n>`,
      namespace, flattened hostnames, pull request comment,
      `preview-destroy.yml`. Done when the pull request that adds this feature
      shows its own preview at `https://node1-pr-<n>.rljson-tryout…/health` and
      the namespace disappears after the merge. Deviation: previews take
      their certificates from `letsencrypt-staging`, not from the
      production issuer, because Let's Encrypt allows 50 new certificates
      per registered domain per week and every preview host is a new one;
      reviewers accept one browser warning per preview and the smoke job
      verifies previews with `ALLOW_STAGING_CERTIFICATE=true`. A preview has
      no apex host (`pr-<n>.rljson-tryout…`); one host per node is enough
      for a review, and the module's apex ingress became optional
      (`enable_apex_ingress`). The workspace name alone selects the
      environment in the root module and any other name fails the plan. The
      pipeline no longer cancels a superseded pull request run in progress,
      because it may be in the middle of the preview apply and a killed
      apply leaves a stale state lock; a run that has not started yet is
      still dropped.
- [x] **A13 Budget guards.** Depends on: A12. `preview-sweep.yml`,
      `destroy-all.yml`, `docs/operations.md` describing both. Done when the
      sweep runs green on schedule and `destroy-all` is tested once against a
      preview workspace (never against production during this slice).
      Deviation: the manual `up` and `down` workflows replaced
      `destroy-all.yml` and were built early as slice A13a (pull request
      #17); `preview-sweep.yml` landed with A12 and reuses
      `destroy-workloads.sh`, which now takes workspace names as arguments,
      and `Preview destroy` (not `Down`) is what the acceptance test ran
      against the preview workspace of the A12 pull request.

### Phase B: the domain on one node (in-memory store)

- [x] **B1 Species table.** Depends on: A11. `domain`: `TableCfg` for
      `species` and its InsertHistory, three hand-written Duckburg species,
      hashing, validation tests (missing reference, wrong hash, wrong type).
      `node-service`: `PetShopStore` holding `Db` over `IoMem`, tables created
      at start, seed of the three species, `GET /api/species`. Done when the
      endpoint on `node1` lists three species. Deviation: started before the
      deployment chain A7 to A11 was merged, so acceptance was tests and CI
      green plus the endpoint verified locally on `HTTP_PORT=8121`; the
      check on `node1` follows automatically once A9 deploys `main`. The
      "missing reference" validation test moves to B3, where the first
      `speciesRef` column exists; the species table has no reference column
      to break. B3 delivered that test against the `animals.speciesRef`
      column. The version check found every pinned `@rljson/*` package at
      its latest version (`docs/findings/versions.md`); the overrides from
      3.5 were needed right away because `@rljson/validate` pulls older
      copies in, and they live in `pnpm-workspace.yaml` because pnpm 12
      ignores `pnpm.overrides` in `package.json`.
- [x] **B2 Web app skeleton, mobile first.** Depends on: B1. `web-app`
      package with `index.html`, `app.js`, `styles.css`, hash routing, a shell
      with bottom navigation on narrow screens and a sidebar from 768 px, view
      `species` with component `species-list`. Tap targets at least 44 px,
      system font stack, `prefers-color-scheme` respected, no horizontal
      scrolling at 360 px. Playwright tests at 375 x 812 and 1280 x 800 that
      load the page and see three species. Served by the node at `/`. Done when
      the app works on a phone browser against `node1`. Deviation: like B1,
      started before the deployment chain A7 to A11 was merged, so acceptance
      was the Playwright suite (phone and desktop projects), the unit tests
      for the static serving, the container image answering `/` locally and
      the app verified in a phone-sized browser on `HTTP_PORT=8141`; the
      check on `node1` follows automatically once A9 deploys `main`. The shell
      has one `nav` landmark that docks to the bottom on narrow screens and to
      the left from 768 px, so assistive technology sees one navigation
      instead of two with one hidden.
- [x] **B3 Animals with a species reference.** Depends on: B2. Table
      `animals` (without story and traits yet), `speciesRef`, route query that
      joins the species, `GET /api/animals`, view `animals` with species name
      and price. Done when the list shows the joined species name. Deviation:
      the seed holds ten hand-written animals, not a fixed count the roadmap
      left open. `PetShopStore.seedIfEmpty` now returns
      `{ speciesSeeded, animalsSeeded }` instead of a plain row count, since
      it seeds both tables in one coordinated call (species first, because
      animals reference them by hash). The route join
      `Route.fromFlat('animals/species')` was tried first and resolves every
      animal's species in one `Db.get` call, but it silently drops a
      referencing row whose reference does not resolve instead of including
      it with a missing species; `PetShopStore.listAnimals` therefore uses
      the explicit fallback the roadmap anticipated instead: two plain
      `Db.get` calls (`animals`, `species`) joined with a local `Map`, which
      includes every animal and reports `speciesId`/`speciesName` as `null`
      when a reference does not resolve rather than dropping the row or
      failing the request; filtering by species happens in JavaScript after
      the join (findings in `docs/findings/db-basics.md`, "Joining a
      reference"). The `animals` view becomes the default route
      (`#/animals`) and gets a second, first-listed navigation entry
      `Animals`; `#/species` stays and its cards link to the filtered
      animals view. The species filter is a row of chips that are plain
      links into the hash query (`#/animals?species=duck`), so selecting one
      is an ordinary navigation and the filtered view is shareable.
- [x] **B4 Long background story.** Depends on: B3. Column
      `backgroundStory`, `GET /api/animals/:id`, view `animal-detail`, Gherkin
      set up with a first feature that round-trips a 4 000 character story.
      Done when the feature passes and the story reads well on a phone
      (line length, font size). Deviation: `@amiceli/vitest-cucumber` 8.0.0
      is the current version (checked with `pnpm view`); its step files use
      the extension `*.steps.ts` the roadmap's own section 1 names, which is
      outside Vitest's default `include` pattern, so `node-service` gets its
      own `vitest.config.ts` widening `include` to also match
      `features/**/*.steps.ts`. `PetShopStore.getAnimal(id)` does not filter
      `db.get` by `{ id }`: that path is broken by an upstream `@rljson/db`
      bug for any table with a reference column (`docs/findings/db-basics.md`,
      "Filtering by id"), so it reads the full `animals` and `species` tables
      and finds the row by `id` in JavaScript, the same fallback
      `listAnimals` already uses for a different reason. Nine seed animals
      get a 700 to 900 character story; Sir Quackington's is the hand-written
      long one at 7 141 characters (multiple paragraphs), comfortably past
      the 4 000 character floor the Gherkin feature checks. The web app
      reuses the not-found rendering between the router's own unknown-route
      page and `animal-detail`'s unknown-id state through a small shared
      `not-found-view.js`, and an animal card is now the whole `<a>` element
      rather than an `<article>` with a separate link, so the link target
      covers the entire card.
- [x] **B5 Traits as multi-reference.** Depends on: B4. Table `traits`,
      column `traitsRefs` (jsonArray of hashes), validation test for a dangling
      entry, trait chips in the detail view, filter `?trait=<id>`. Done when
      filtering works and the validator rejects a dangling trait. Deviation:
      rljson 0.0.81's `BaseValidator` already validates a `jsonArray`
      multi-reference: `_refsNotFound` treats an array-valued `ref` column
      the same way as a single-valued one, resolving every element against
      the target table and reporting each unresolved one, so no domain-level
      validation helper was needed for the acceptance criterion
      (`docs/findings/db-basics.md`, "Multi-references"). The same mechanism
      incidentally also rejects an element of the wrong JSON type (a number
      or a boolean can never equal a stored hash), which `dataDoesNotMatchColumnConfig`
      on its own would not catch, since it only checks that the column as a
      whole is an array. The seed holds eight Duckburg-flavoured traits, not
      a fixed count the roadmap left open, and every animal gets one to four
      of them chosen to fit its existing `backgroundStory`. `GET /api/traits`
      is a new endpoint the roadmap's original section 2.5 table did not
      list; it is added there now. Filtering by `trait` happens in
      `PetShopStore.listAnimals` and `getAnimal` after a full read of
      `animals`, `species` and `traits`, the same fallback `speciesId`
      filtering and `getAnimal` already use, for the same reason
      (`docs/findings/db-basics.md`, "Filtering by id"): `db.get` with a
      `where` clause is unreliable once a table has a reference column, and
      `traitId` needs to be resolved against `traitsRefs` element by element
      besides, a shape `where` cannot express at all. The web app renders
      the species and trait filters as two labelled chip rows rather than
      one combined bar, reusing the existing `.chip` component for both the
      filter chips and the detail view's trait chips.
- [x] **B6 Traits as a junction table.** Depends on: B5. Table
      `animalTraits`, the same filter implemented over the junction, both
      implementations behind one interface with a toggle in configuration, and
      `docs/findings/n-to-m.md` comparing query shape, payload size and
      validation. Done when both paths return the same result in a test.
      Deviation: none; the interface `TraitRelation`
      (`traitIdsOfAnimal`, `animalHashesWithTrait`) has two implementations,
      `MultiReferenceTraitRelation` and `JunctionTraitRelation`, selected by
      the new configuration variable `TRAIT_RELATION`
      (`multi-reference`, the default, or `junction`); `animalTraits` seed
      rows are derived from `animalsSeed.traitsRefs` at module load rather
      than hand-written, so the seed stays in one place. The Gherkin world
      of `@amiceli/vitest-cucumber` 8.0.0 handles a `Scenario Outline` with
      `Examples` cleanly, so the dual-mode filter scenario in
      `features/traits.feature` uses that instead of a separate Vitest
      parameterised test.
- [x] **B7 Persons and breeders.** Depends on: B4. Tables `persons`,
      `breeders`, column `breederRef`, `GET /api/breeders`, breeder shown in the
      detail view. Done when a breeder appears with their person data.
      Deviation: `GET /api/animals` also gains `breederId`/`breederFarmName`
      (light) and a `?breeder=<id>` filter, and `GET /api/animals/:id` gains a
      full `breeder` object, both already anticipated by section 2.5's
      contract table. The web app gets a `#/breeders` view with
      `breeders-list` cards linking into the filtered animals view, a third
      navigation entry and, on the animals view, a compact two-chip breeder
      filter summary (active breeder plus an "All" reset) instead of a third
      full chip row, chosen for legibility at 360px as the number of
      breeders grows; picking a breeder happens from the breeders view, not
      from a chip picker in the animals view. The seed holds six Duckburg
      persons and four breeders (Grandma Duck's Farm first in the seed
      file), not a fixed count the roadmap left open; two persons (Gladstone
      Gander, Fethry Duck) are seeded without a role yet, ready for slice B8
      to reference them as customers. `AnimalBreeder.personName` and `.city`
      are typed nullable for the defensive case of a breeder whose own
      `personRef` does not resolve, the same dangling-reference tolerance
      `speciesName` already has (`docs/findings/db-basics.md`, "Joining a
      reference").
- [x] **B8 Customers and invoices.** Depends on: B7. Tables `customers`,
      `invoices`, `invoiceItems`, `changeSets` (3.4), `POST /api/invoices`
      writing all rows plus one change set, `GET /api/invoices`, view
      `invoices` and component `invoice-form` (pick customer, add animals,
      submit), Gherkin feature "Scrooge buys Donald the duck". Done when an
      invoice issued on the phone shows up in the list with its items.
      Deviation: `@rljson/db` 0.0.42 has no controller for a `buffets`
      table, so `Db.insert` and `Db.get` throw on `changeSets`; the store
      writes a change set and its InsertHistory row through `Core.import`
      (the call `Db` uses for its own history rows) and reads change sets
      through `Io.readRows`, everything else stays on `Db`
      (`docs/findings/change-sets.md`). A change set names every row the
      operation wrote, the InsertHistory rows included, so a peer can
      reproduce the operation and its place in the version DAG from the
      change set alone. `GET /api/customers` and `GET /api/invoices/:id`
      from the section 2.5 table are delivered here too, the detail with a
      `changeSetHash` field. Invoice numbers are `<year>-<sequence>` from
      the count of invoices on the node, unique per node only; the seed
      issues six invoices through the same code path as the API so the
      change set discipline holds for seed data, and Scrooge McDuck and
      Donald Duck join the persons seed as customers. Quantities are
      adjusted with a −/+ stepper per line rather than a number field, and
      stepping a line below one removes it.
- [x] **B9 Versions of an entity.** Depends on: B8. `PUT /api/animals/:id`,
      `GET /api/animals/:id/history`, version list in the detail view, the
      "current version" rule from 2.6 implemented once in `domain` and used by
      every list endpoint, Gherkin feature for a price change. The version
      mechanism ships with an edit form for animals in the app: every
      editable field, inline validation, saving creates a new version, and
      the detail view offers an "Edit" action alongside the version list;
      this is the first piece of CRUD the owner asked for. Done when the
      list shows the new price and the history shows both versions.
      Deviation: `previous` of a follow-up version names the `timeId` of
      the current version's InsertHistory row, not its hash, because
      rljson's `previous` is typed and resolved as a list of `timeId`s and
      `Db.detectDagBranch` counts tips by `timeId`
      (`docs/findings/entity-versions.md`); the rule lives in
      `packages/domain/src/entityVersions.ts` and reports conflicting ids
      alongside the current rows, ready for D11. `GET /api/animals/:id`
      gains `?version=<hash>` for reading an older version, which the
      detail view uses for its read-only view of a version. The
      `animalTraits` junction rows of a new animal version are written as
      new versions of their pairings (`<animalId>--<traitId>`), chained
      onto the previous pairing row. `traitsRefs` is written in one
      canonical order (by trait id, `traitsRefsOf`), in the seed as in an
      edit, so the same set of traits hashes the same in both trait
      relation modes; five seed animal hashes changed with it. The server
      validates bodies without Ajv type coercion, so a value of the wrong
      JSON type is refused instead of rewritten. Two findings of the B8
      review are applied here: the invoice sequence is derived from the
      highest existing number of the year (`nextInvoiceSequence`), and
      `issueInvoice` resolves customers and animals through the
      current-version rule.
- [x] **B10 Seed generator.** Depends on: B9. Deterministic generator with
      a seed and sizes `small` (10 species, 100 animals), `medium`, `large`
      (50 species, 40 traits, 2 000 animals, 300 customers, 50 breeders, 5 000
      invoices, 12 000 items), names from Duckburg pools, deterministic ids,
      `SEED_SIZE` handling at first start, `GET /api/stats`. Tests: same seed
      gives identical hashes, sizes match, some breeders are customers, some
      invoices are unpaid. Done when `node1` runs with `SEED_SIZE=medium`.
      Deviation: the hand-written Duckburg seed stays the core of every
      size, so `small` is that seed alone (the default, what previews run),
      `medium` adds 10 species, 15 traits, 100 animals, 30 customers, 10
      breeders and 200 invoices with 400 items on top of it, `large` the
      counts above, and `none` leaves the tables empty; the generated rows
      are written through the same per-row `Db.insert` path as the API with
      one change set per entity (measured against a bulk `Core.import` in
      `docs/findings/seed-generator.md`, `large` seeds in about 1.4 s
      into memory and 16 s into SQLite),
      each generated animal gets a short template story of 300 to 800
      characters until B11 replaces it, and `GET /api/animals` becomes a
      page (`q`, `limit`, `offset`, section 2.5) with a search field and a
      "Load more" button in the app so that 2 000 animals stay usable;
      production runs `medium`.
- [ ] **B11 Stories and arcs.** Depends on: B10. Template-based story
      generator producing 4 000 to 6 000 characters per animal from paragraphs
      that reference the animal's species, traits, breeder and previous owners;
      ten hand-written arcs (Scrooge, Donald, Gyro, the Beagle Boys, Magica, …)
      woven into the data. Tests on length and on references resolving. Done
      when a random animal's story mentions its real breeder.
- [ ] **B12 Species images as blobs.** Depends on: B10. Procedural PNG per
      species (own encoder over `node:zlib`, deterministic from the species
      id), stored in `BsMem`, `imageBlobId` on the species, `GET
/api/species/:hash/image`, images in list and detail. Tests: PNG
      signature, same image twice gives one blob. Done when images render on
      the phone.
- [ ] **B13 Live updates.** Depends on: B8. `GET /api/events` with
      server-sent events, the app refreshes lists on `insert`, a status line
      shows the connection. Done when an invoice issued in one tab appears in a
      second tab without reload, also through Traefik in production.
- [ ] **B14 Navigation and CRUD for the catalogue.** Depends on: B9 (and B8).
      The owner finds the current top-level `Breeders` entry out of place for
      a pet shop: navigation becomes `Animals`, `Invoices`, `Network` (once D1
      lands) and `More` (a menu view listing Species, Traits, Breeders,
      Customers); breeders get a detail page (`#/breeders/<id>`) with their
      person data and their animals; the breeder filter becomes selectable
      directly in the animals view (a picker sheet on the phone, a select on
      desktop) instead of only via the breeders list. Create, edit and delete
      for species, traits, breeders (with person), customers (with person)
      and animals through consistent forms (phone first, 44 px controls,
      inline validation, optimistic feedback); delete writes a tombstone
      version (`deleted: true` column on every entity table, lists and
      detail hide tombstones, the version history shows the deletion); API:
      `POST /api/<table>`, `PUT /api/<table>/:id`, `DELETE /api/<table>/:id`
      (tombstone) for the five entity types, with 400/404 semantics; Gherkin
      for create, edit, delete of one entity type and Playwright for every
      form at both viewports. Done when every catalogue entity can be
      created, edited and deleted from the phone and the navigation reads
      naturally to a shop user. Note that D13 then only covers the
      multi-node edit-versus-delete conflict.
- [ ] **B15 Internationalisation.** Depends on: B14. German and English,
      language detected from `navigator.language` (fallback English), a
      switch in the header persisted in `localStorage`, all UI strings in one
      dictionary module per language (plain JavaScript objects, no library),
      dates and currency formatted for the active locale, `lang` attribute on
      `html`, Playwright runs the key scenarios in both languages (`locale`
      option); seed content (names, stories) stays English. Done when the app
      opens in German on a German phone and every string of every view is
      translated.

### Phase C: persistent stores, one node per engine

- [x] **C1 SQLite store.** Depends on: B13. `STORAGE=sqlite` with
      `IoSqliteNode` under `DATA_DIR`, node1 in production becomes a
      `StatefulSet` with a claim, the Gherkin domain suite runs against both
      stores in CI, `docs/findings/versions.md` and `docs/findings/stores.md`
      started. Done when an invoice survives a redeploy of node1. Deviation:
      pulled forward before B13 (and B10 to B12), because the store's
      backend is independent of the remaining domain slices. `PetShopStore`
      receives its `Io` from the factory `createIo` (`STORAGE=memory` or
      `sqlite`; `mssql` is rejected until C4 adds it) instead of building
      an `IoMem` itself, and `createIo` returns `IoSqliteNode` with the
      connection switched to write-ahead logging and `synchronous = NORMAL`,
      because the library's defaults cost two `fsync`s per inserted row
      (seed 698 ms against 49 ms, `docs/findings/stores.md`). The store
      tests and the Gherkin features run over both stores through
      `describe.each` with one SQLite file per store under a temporary
      directory per test file; SQLite-only tests prove the byte-for-byte
      round trip of a 4 000+ character story with quotes, newlines and
      non-ASCII characters, of `traitsRefs` and of change set `items`, and
      that an invoice survives a close and reopen of the file with the
      seed reporting zeroes. The module's `nodes` entries take a `storage`
      (`memory` runs as the `Deployment` from D1, `sqlite` as a
      `StatefulSet` with a 2 Gi `local-path` claim at `/data`), production
      node1 switches to `sqlite`, previews keep `memory`; the claim also
      holds the discovery identity, so node1 keeps its node id across
      restarts (relevant for D7).
- [ ] **C2 Blobs on disk.** Depends on: C1. `BsFs` under `DATA_DIR/blobs`
      for the sqlite node. Done when species images survive a redeploy.
- [x] **C3 Second and third node.** Depends on: C1. node2 (`sqlite` for
      now) and node3 (`memory`) deployed with their own hostnames and seeds,
      each still independent; the Terraform module passes every node's URL
      to every node's container as the comma separated configuration
      variable `NODE_URLS`. The web app header shows a node bar: the current
      node renders as a clearly active link (a light badge), the other
      nodes from `NODE_URLS` as plain links, each outlined green when the
      browser's own `GET /health` probe against that node succeeds and red
      otherwise; the node service allows cross-origin `GET /health` so a
      browser on any node can probe every other node. Done when all three
      hosts serve the app and each one's header shows the other two nodes,
      correctly outlined green or red. Note: the node bar, `NODE_URLS`,
      `PUBLIC_URL` and the cross-origin `/health` already landed with the
      pulled-forward D1, with the outline driven by the discovery topology
      and the browser probe as the secondary marker; C3 adds node2 and
      node3 to the module (the `nodes` list of `environment.tf`) and proves
      the bar and the hub election on the three production hosts. Outcome:
      production runs `node1` (`sqlite`), `node2` (`sqlite`) and `node3`
      (`memory`), each with its own Service, Ingress and Let's Encrypt
      certificate, the apex host still on node1, every pod with the
      environment's `SEED_SIZE` (`small` then, `medium` since B10; every
      node seeds the same pet shop for now, see D3) and
      `NODE_STATUS_URLS`, the ClusterIP service URLs at the same
      positions as `NODE_URLS`, which the `NodeDirectory` polls instead of
      the public hosts, because Node's `fetch` rejects the staging chain of
      a preview (the open point of D1); `NODE_URLS` stays the public link
      list of the header and of `/status`. `verify-deployment.sh` waits,
      with three or more URLs, until every node lists every other node as
      seen in the discovery topology and exactly one node is the hub
      (statuses grouped by node id, since the apex host is node1 again),
      and prints the roles; a preview with one URL keeps the per-node
      check. The UDP broadcast of a pod reaches the other pods on the
      flannel bridge of k3s, so the static hub fallback of `@rljson/network`
      was not needed (`docs/findings/network-discovery.md`, verified on the
      preview of pull request #35, which ran three memory nodes for that
      purpose, and in production by the smoke job of the merge). The
      compose file gives the nodes the host-side URLs as
      `NODE_URLS` and the container names as `NODE_STATUS_URLS`, so the
      header links open from a browser on the host. Previews keep one
      memory node.
- [ ] **C4 SQL Server store.** Depends on: C3. `STORAGE=mssql` with
      `IoMssql`, SQL Server `StatefulSet` in production, node2 switched to it,
      CI runs the domain suite against SQL Server as a service container,
      findings on type mapping and import speed. Done when node2 serves the
      seed from SQL Server.
- [ ] **C5 Large import baseline.** Depends on: C4. A Kubernetes `Job` that
      imports the large seed into a chosen node, timings per store in
      `docs/findings/large-content.md`. Done when node1 holds the large seed
      and the app remains usable.

### Phase D: the network

- [x] **D1 Discovery and roles.** Depends on: C3. `RoleOrchestrator` over
      `NetworkManager` (broadcast, probing, identity under `DATA_DIR/identity`),
      `/status` shows node id, role, hub, peers; the node bar's green or red
      from C3 now comes primarily from this discovery topology (a peer seen
      by broadcast or probing) and only secondarily, shown distinctly, from
      the browser's own `/health` probe; view `network` in the app shows the
      topology, links to the other nodes and the complete link list with
      role (hub or client), node id and last seen, updated live through the
      SSE `topology` event; a local Docker Compose file with three nodes for
      the integration tests. Gherkin: "three nodes start, exactly one
      becomes hub". Done when the production status pages agree on one hub
      and the node bar reflects the discovery topology live. Deviation:
      pulled forward before C3 (and B8 to B13), because the network code is
      independent of the remaining domain slices; the three-node proof
      therefore runs against `deploy/compose/three-nodes.yml` locally and
      in the new `integration` job of the pipeline, and the production
      three-node agreement follows automatically once C3 deploys node2 and
      node3 (the module already passes `RLJSON_DOMAIN`, `HUB_PORT`,
      `BROADCAST_PORT`, `DATA_DIR`, `PUBLIC_URL` and `NODE_URLS` to every
      pod, so a single node reports `standalone` today; since C3 the three
      production nodes agree on one hub over the flannel bridge). The node bar and
      the C3 header bar landed together here: `NODE_URLS` and the
      cross-origin `/health` are in this slice, so C3 only adds the nodes.
      The web app polls `/status` every five seconds instead of listening
      to an SSE `topology` event, since B13 (server-sent events) has not
      landed; B13 replaces the polling. `NetworkManager` hands the hub port
      to the application the moment a node becomes hub, so the orchestrator
      owned a `HubPortListener` on `HUB_PORT` until D2 put the socket.io
      server there; without it every other node drops the hub on its next
      probe. A `NodeDirectory` polls `/status` of every `NODE_URLS` entry to
      map node ids to URLs and names, because the announcements of
      `@rljson/network` carry neither. With `DISCOVERY=disabled` the node
      id is not persisted (a fresh UUID per process), so unit tests and the
      Playwright web server never touch `DATA_DIR`. `/status` additionally
      reports `publicUrl`, `domain`, `hubNodeId` and the `nodes` list
      (section 2.5). Findings and measured timings (5 s to agreement, one
      broadcast interval) in `docs/findings/network-discovery.md`.
- [x] **D2 Hub transport.** Depends on: D1. As hub, run `Server` over the
      node's own `Io` and `Bs` with a socket.io server on 3000; as client, run
      `Client` connected to the hub; the API uses the multis from then on.
      Gherkin: "a row written on the hub is readable by hash on a client". Done
      when the feature passes against Compose and `/status` in production shows
      connected clients. Deviation: the API uses the multis for targeted
      reads only. `PetShopStore` keeps its `Db` on an `IoSwitch` that routes
      a `readRows` with a `where` clause through the active multi and
      everything else (writes, table creation, dumps, row counts and
      whole-table reads) to the local `Io`, because `IoMulti` answers a
      whole-table read from the first layer that holds any row, which for
      an empty local table would pull the hub's entire table in as a side
      effect of a list; lists therefore show what a node holds until D3
      pulls change sets, while `GET /api/animals/:id?version=<hash>` and
      `GET /api/invoices/:id` fall through to the hub. The local `Io` is
      lent to `Server` and `Client` through a `BorrowedIo` whose `close()`
      is a no-op, since `Server.tearDown()` closes every member of its
      multi including the node's own store (`Client` has an option
      `ownsStores` for this, `Server` has not). `@rljson/server` 0.0.64 pins
      `@rljson/network` 0.0.20, so `pnpm-workspace.yaml` overrides it to
      the project's 0.0.21. The `BsMem` a node hands to the transport is
      created in `main.ts`; nothing writes blobs before B12, but the
      `Client` always opens a blob peer to the hub and a node without a
      local `Bs` could not store one. Findings, timings and the wire
      format in `docs/findings/hub-transport.md`. C3 deployed node2 and
      node3 while this slice was built, so the production proof is the
      hub's `/status` reporting two connected clients and both clients
      reporting `connectedToHub: true` after this slice's deploy; the pull
      request records what the live cluster showed.
- [x] **D3 Change set synchronisation.** Depends on: D2. `SyncAgent`:
      announce every change set, pull incoming change sets and their items,
      emit `sync` events. Gherkin: "a customer created on node1 is listed on
      node2 and node3 within five seconds". Done when an invoice issued on the
      phone against node3 appears on node1. Seeding: since C3 every node
      seeds the same `small` pet shop into its own store (`SEED_SIZE=small`
      on every pod); once change sets synchronise, only the hub or the
      first node seeds and the others start with `SEED_SIZE=none` and
      receive the seed over the network, otherwise every node would
      announce the same rows. Deviation: every node keeps seeding, but the
      seed is deterministic down to its InsertHistory rows and change sets
      (`seedTimeId`: a fixed epoch plus a counter instead of the node's
      clock, one change set per hand-written entity too, the rows written
      through `Core.import` because `Db.insert` issues its own `timeId`),
      so a seed change set another node announces is skipped by hash and
      a `medium` node fills `small` nodes with its generated rows, which
      is the visible proof in production; the roadmap's `SEED_SIZE=none`
      plan would have needed slice D4's catch-up for late joiners first.
      The Gherkin scenarios use what exists ("an invoice issued on node3
      appears on node1 and node2", "an animal renamed on node2 shows the
      new name on node1 and node3", "a change set announced again is
      written once", the last one through a client restart), in-process
      over both stores and against Compose. The `sync` events are kept
      in `/status.sync` (counters and the last ten transfers, with the
      node that wrote a change set from the client identity its
      announcement carries) and shown on the network view; slice B13
      streams them. The hub takes part through a `Connector` over a
      loopback socket pair the `Server` holds as a broadcast-only client,
      every node announces everything it wrote on every channel it gets
      and the hub repeats it for every client that joins, a pull is
      bounded by one deadline per change set and stays pending with
      retries every 30 s, up to 20 attempts, and received rows are
      checked with `hsh` and written as they came, with the rows and
      previous versions they point at pulled up to a bound. Timings
      (tens of milliseconds announce to visible, 400 change sets in
      1.3 s) and the wire format are in
      `docs/findings/change-set-sync.md`. Production node1 and node2 keep
      the pre-D3 seed history rows on their volumes, which show up as a
      second tip per seed entity next to node3's deterministic ones until
      the volumes are emptied (`Down` and `Up`).
- [ ] **D3b Transfer indicators.** Depends on: D3, B13. Per partner node in
      the node bar an upstream and a downstream icon; when this node
      receives data from that partner the upstream icon activates
      immediately and its fill animates from bottom to top while the
      transfer runs, then keeps animating one more second after completion;
      the same for downstream when this node sends. Tapping or clicking a
      partner node opens a closable popup (full screen on narrow viewports,
      a dialog on wide ones) listing up to the last ten transfers with that
      partner, one row each with the direction icon, table, change set hash
      (short), row count and time; the data comes from the SSE `sync`
      events, which must carry direction, peer id and change set. Playwright
      covers the popup at both viewports and the animation state classes.
      Done when an invoice issued on node2 makes node1's upstream icon
      animate and the popup lists it.
- [ ] **D4 Bootstrap and heartbeat.** Depends on: D3. Late joiners receive
      the latest change set, `bootstrapHeartbeatMs` configured. Gherkin: "node3
      restarts and catches up". Done when the memory node is complete again
      after a restart in production.
- [ ] **D5 Blob synchronisation.** Depends on: D3. Images pulled through
      `BsPeer` via the hub, cached locally. Done when a species image uploaded
      to node1 renders on node3.
- [ ] **D6 Hub failover.** Depends on: D4. Delete the hub pod, watch
      re-election and reconnects, Gherkin feature. Done when the network heals
      within one minute without data loss.
- [ ] **D7 Identity persistence.** Depends on: D6. Node ids survive restarts
      on nodes with a volume, the memory node gets a fresh id; findings on how
      the hub treats the returning and the new identity.
- [ ] **D8 Large content over the network.** Depends on: D5, C5. Large seed
      imported on one node, pulls observed on the others (per-hash pulls versus
      `readRowsByHashes`), stories of 40 000 and 400 000 characters, memory of
      the in-memory node. Findings in `docs/findings/large-content.md`.
- [ ] **D9 Concurrency.** Depends on: D4. Load `Job` issuing invoices on all
      nodes at once, `SyncConfig` with client identity and causal ordering.
      Gherkin: "200 concurrent invoices from three nodes arrive everywhere
      exactly once". Findings in `docs/findings/concurrency.md`.
- [ ] **D10 Acknowledgements and gap fill.** Depends on: D9. `requireAck`,
      `ackTimeoutMs`, a paused pod that misses refs and recovers through gap
      fill. Findings appended.
- [ ] **D11 Conflict detection.** Depends on: D9. Conflict observer per
      table, `GET /api/conflicts`, badge and list in the app, Gherkin with a
      partition (a `NetworkPolicy` in Kubernetes, `docker network disconnect`
      in Compose) where two nodes change the same animal.
- [ ] **D12 Conflict resolution.** Depends on: D11. Deterministic rule
      (field-wise merge when fields differ, otherwise later client timestamp
      wins, tie broken by client id), merge version with `previous` on both
      tips, automatic on the node that detects it, `POST /api/conflicts/…
/resolve` for a manual trigger. Gherkin edit versus edit.
- [ ] **D13 Deletions.** Depends on: D12, B14. Tombstone versions (`deleted:
true`) already exist from B14; this slice covers only the multi-node
      case, edit versus delete resolves to the edit. Gherkin feature.
- [ ] **D14 Chaos node, unknown references.** Depends on: D3. Package
      `chaos-node`: joins as a client and announces change set hashes that do
      not exist. Observe and document how long honest nodes block; add bounded
      pull timeouts and a per-peer failure counter to `SyncAgent`.
      `docs/findings/hostile-nodes.md` started. Deployed in production only
      when enabled by a variable.
- [ ] **D15 Chaos node, wrong hashes.** Depends on: D14. The chaos node
      serves rows whose `_hash` does not match their content. `SyncAgent`
      verifies hashes with `hsh` before persisting and rejects the change set.
- [ ] **D16 Chaos node, invalid data.** Depends on: D15. Dangling
      references, wrong `_type`, oversized values, very slow answers.
      `Validate` before persisting, size limits, findings completed.
- [ ] **D17 Layers and cakes.** Depends on: D12. Inventory modelled as a
      cake (slice ids are animal ids, layers for price, status, owner),
      `GET /api/inventory`, comparison with the InsertHistory approach in
      `docs/findings/layers-and-cakes.md`.

### Phase E: optional, pick by interest

- [ ] **E1 Own `Io` for PostgreSQL.** Depends on: C4. Package `io-postgres`
      built against the conformance tests shipped with `@rljson/io`, one pull
      request per group of methods, finally node4 in production.
- [ ] **E2 Single executable image.** Depends on: A4. Node SEA plus
      `FROM scratch` with the musl libraries, size and start time compared in
      `docs/findings/image-size.md`.
- [ ] **E3 Browser as rljson client.** Depends on: D5. Bundle `Client`,
      `Db` and an IndexedDB `Io` for the browser, offline-capable app.
- [ ] **E4 Assistant.** Depends on: B13. `POST /api/assistant` with the
      Anthropic SDK (`claude-opus-5`, streaming, tools `query_table` and
      `issue_invoice`), chat view in the app, `ANTHROPIC_API_KEY` as a
      Kubernetes secret from the repository secret.
- [ ] **E5 Second server.** Depends on: D6. A second server in a Hetzner
      private network, broadcast fails its self-test, static hub fallback, then
      a small cloud coordinator implementing `POST /register`, `GET /peers`,
      `POST /probes`.
- [ ] **E6 MongoDB with `mongo-agent`.** Depends on: D3.
- [ ] **E7 Kubeconfig without SSH.** Depends on: A7. Terraform-generated
      root CA fed to k3s through cloud-init, admin client certificate issued by
      Terraform, SSH resource and `loafoe/ssh` provider removed.

### Phase F: finishing

- [ ] **F1 Pixel-perfect pet shop styling.** Depends on: B13, B15 (and
      ideally D3b), so styling happens once on the final, translated
      strings. The app looks like a real pet shop for its customer audience:
      colour system, typography, shapes, illustrations of every species and
      decorative elements generated as SVG by the agent (own work, no
      external assets, no licence questions), consistent icons, empty
      states, micro-interactions that respect `prefers-reduced-motion`,
      still vanilla or web components, preferably a single embedded HTML
      file with no dependencies (a lightweight framework only if truly
      justified and argued in the pull request). Pixel-perfect at 375 x 812,
      768 x 1024 and 1280 x 800 with Playwright screenshot comparisons. Done
      when the owner says it looks like a real shop and the screenshot tests
      pass.
- [ ] **F2 Comparison forks.** Depends on: everything else, optional. Fork
      the repository and rebuild the same system on a comparable TypeScript
      product (candidates to research first: Ditto, Yjs/y-websocket,
      Automerge, ElectricSQL, PowerSync, RxDB; pick what offers local
      storage plus peer or hub synchronisation with a TypeScript SDK), keep
      the web app and the domain, swap the storage and sync layers, and
      write a findings comparison.

## 6. Findings template

Every `docs/findings/<topic>.md` has four sections: what we tried (commands,
sizes, versions), what happened (numbers, logs, screenshots as text), what it
means for rljson users, and candidates for upstream issues with a one-line
reproduction each.

The candidates are consolidated for rljson's authors in
`docs/rljson-feedback/`: `README.md` holds the lessons learned (what worked,
what we built ourselves, friction, security and performance observations,
prioritised suggestions) and `issues/NN-<slug>.md` one issue-ready report per
bug or improvement, numbered by severity, each with a reproduction script
that was run against the pinned versions and its real output. A new
candidate in a findings file gets its issue file there in the same pull
request; a candidate that could not be reproduced stays in the findings
file marked "observed, not isolated".
