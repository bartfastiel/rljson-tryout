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
                   destroy-all.yml
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
  `hashicorp/kubernetes`, `hashicorp/helm`, `hashicorp/tls`.
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
| Preview hostnames     | `node1-pr-<n>.rljson-tryout.wer-ist-daniel-schwarz.de`, apex `pr-<n>.rljson-tryout…`                                                                                                                       |
| Terraform state       | S3 bucket `bartfastiel-rljson-tryout-tfstate`, region `eu-central-1`, keys `cluster/terraform.tfstate` and `workloads/terraform.tfstate` (workspaces add their prefix)                                     |
| AWS access from CI    | OIDC, role ARN in repository variable `AWS_ROLE_ARN`, no access keys                                                                                                                                       |
| Repository secrets    | `HCLOUD_TOKEN`, `SONAR_TOKEN`, `ANTHROPIC_API_KEY`                                                                                                                                                         |
| Repository variables  | `AWS_ROLE_ARN`, `LETSENCRYPT_EMAIL`                                                                                                                                                                        |
| SonarCloud            | organization `bartfastiel-github`, project key `bartfastiel_rljson-tryout`, automatic analysis off                                                                                                         |
| Secret expiry         | `SONAR_TOKEN` and `ANTHROPIC_API_KEY` expire on 2026-12-16, `HCLOUD_TOKEN` does not expire                                                                                                                 |
| Kubernetes namespaces | `petshop` for production, `pr-<n>` for previews                                                                                                                                                            |
| Ingress               | Traefik as shipped with k3s, cert-manager with ClusterIssuers `letsencrypt-staging` and `letsencrypt-production`, HTTP redirected to HTTPS                                                                 |
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

| Variable           | Values                             | Meaning                                                                 |
| ------------------ | ---------------------------------- | ----------------------------------------------------------------------- |
| `NODE_NAME`        | `node1` …                          | Display name, also used for the hostname                                |
| `STORAGE`          | `memory`, `sqlite`, `mssql`        | Which `Io` implementation backs the node                                |
| `DATA_DIR`         | path                               | Where SQLite file, blobs and node identity live (`/data` in Kubernetes) |
| `MSSQL_CONNECTION` | connection string                  | Only for `STORAGE=mssql`                                                |
| `HTTP_PORT`        | default `8080`                     |                                                                         |
| `HUB_PORT`         | default `3000`                     |                                                                         |
| `BROADCAST_PORT`   | default `41234`                    |                                                                         |
| `RLJSON_DOMAIN`    | string                             | Network domain for peer discovery                                       |
| `SEED_SIZE`        | `none`, `small`, `medium`, `large` | Seed imported at first start when the store is empty                    |
| `PUBLIC_URL`       | URL                                | Shown in status and used for links                                      |
| `LOG_LEVEL`        | `info`                             |                                                                         |

### 2.5 HTTP contract of a node

All responses are JSON unless noted. Identifiers: `id` is the stable
identity of an entity across versions (rljson slice id), `hash` is one
immutable version (`_hash`).

| Method and path                                     | Purpose                                                                                        |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `GET /health`                                       | `{ status: "ok", name, version, commit }`                                                      |
| `GET /status`                                       | `{ nodeName, nodeId, role, hubAddress, peers: [...], storage, tables: { <table>: rowCount } }` |
| `GET /api/stats`                                    | Row counts per table, seed size, uptime                                                        |
| `GET /api/species`                                  | List of current species versions                                                               |
| `GET /api/species/:hash/image`                      | PNG bytes, `Content-Type: image/png`                                                           |
| `GET /api/animals?species=<id>&trait=<id>&q=<text>` | Current animal versions with species name joined                                               |
| `GET /api/animals/:id`                              | Current version with species, breeder and traits joined                                        |
| `GET /api/animals/:id/history`                      | All versions with InsertHistory rows, newest first                                             |
| `PUT /api/animals/:id`                              | Creates a new version from the current one plus the changed fields; returns it                 |
| `GET /api/customers`, `GET /api/breeders`           | Lists with the person joined                                                                   |
| `GET /api/invoices`, `GET /api/invoices/:id`        | Invoice with items and animals joined                                                          |
| `POST /api/invoices`                                | Body `{ customerId, items: [{ animalId, quantity }] }`, issues an invoice                      |
| `GET /api/conflicts`                                | Open DAG branch conflicts (slice D11)                                                          |
| `POST /api/conflicts/:table/:id/resolve`            | Runs the deterministic resolution (slice D12)                                                  |
| `GET /api/events`                                   | Server-sent events: `insert`, `sync`, `topology`, `conflict`                                   |
| `GET /` and static files                            | The web app                                                                                    |

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
  absolute path built from `DATA_DIR`.
- Long strings and `jsonArray` columns map differently per store; test with
  the 4 000 character story in every store (slice C1, C4).
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
3. `terraform-cluster`: `plan` on pull requests, `apply` on `main`.
   Workspace `default`. Needs `id-token: write` for AWS and `HCLOUD_TOKEN`.
4. `terraform-workloads`: on `main` workspace `production`, on pull requests
   workspace `pr-<n>` with `apply` (this is the preview), image tag from job
   2, `TF_VAR_letsencrypt_email` from the repository variable. Comments the
   preview links on the pull request (update the same comment on later runs).
5. `smoke`: waits until `https://<host>/health` returns the deployed commit
   sha, for production and preview alike.

`concurrency` groups: `cluster`, `workloads-production`, `workloads-pr-<n>`.
Pull requests from forks get no secrets; that is acceptable.

Other workflows: `preview-destroy.yml` on `pull_request: closed` destroys
and deletes workspace `pr-<n>`; `preview-sweep.yml` every six hours destroys
any `pr-*` workspace whose pull request is not open; `destroy-all.yml` is a
manual workflow with a confirmation input that destroys workloads and then
the cluster.

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
- A `terraform_data` resource with `remote-exec` that waits for
  `cloud-init status --wait` and `k3s kubectl get nodes`, followed by
  `local-exec` that copies `/etc/rancher/k3s/k3s.yaml` with the public IP
  substituted for `127.0.0.1`. The result is exposed as the sensitive output
  `kubeconfig`. Optional later improvement: build the kubeconfig without
  SSH from a Terraform-generated root CA (k3s custom CA workflow).
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
  claim for sqlite and mssql), `Service` per node, `Ingress` per host with
  `cert-manager.io/cluster-issuer`, optional SQL Server `StatefulSet`
  (`mcr.microsoft.com/mssql/server:2022-latest`, `MSSQL_PID=Express`,
  `MSSQL_MEMORY_LIMIT_MB=1536`, 4 Gi claim) controlled by `enable_mssql`
  (true in production, false in previews).
- Variables: `environment_name`, `image_tag`, `hostname_suffix`,
  `enable_mssql`, `letsencrypt_email`, `seed_size`, `rljson_domain`.

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
- [ ] **A7 Kubeconfig hand-off.** Depends on: A6. The `terraform_data`
      provisioner and the `kubeconfig` output. Done when a workflow step runs
      `kubectl get nodes` with the output and sees the node `Ready`.
- [ ] **A8 Persistent address.** Depends on: A6. The server switches from
      an ephemeral address to the pre-created primary IP (data source,
      datacenter taken from it); `README.md` gets a section "Reproducing with
      your own domain" describing the primary IP and the two DNS records. Done
      when `dig +short node1.rljson-tryout.wer-ist-daniel-schwarz.de` returns
      the primary IP and a `terraform destroy` plus `apply` of the cluster
      brings the same address back. README part done in A6; the destroy and
      apply proof follows with the destroy workflow of A13.
- [ ] **A9 First workload on the internet.** Depends on: A4, A7, A8. Stage 2
      with the module for node1 only (`STORAGE=memory`), plain HTTP ingress,
      `terraform-workloads` job for workspace `production`. Done when
      `http://node1.rljson-tryout.wer-ist-daniel-schwarz.de/health` returns the
      commit sha of `main`.
- [ ] **A10 TLS.** Depends on: A9. cert-manager, both issuers, ingress with
      TLS, HTTP redirect. Verify with the staging issuer first, then switch to
      production in the same pull request once the staging certificate was
      issued. Done when `https://node1…/health` has a valid Let's Encrypt
      certificate and `http://` redirects.
- [ ] **A11 Smoke test and deploy chain.** Depends on: A10. `smoke` job,
      concurrency groups, image tag flows from `image` to `terraform-workloads`.
      Done when a change to the health payload lands on the internet through
      one merge without manual steps and the smoke job proves it.
- [ ] **A12 Preview environments.** Depends on: A11. Workspace `pr-<n>`,
      namespace, flattened hostnames, pull request comment,
      `preview-destroy.yml`. Done when the pull request that adds this feature
      shows its own preview at `https://node1-pr-<n>.rljson-tryout…/health` and
      the namespace disappears after the merge.
- [ ] **A13 Budget guards.** Depends on: A12. `preview-sweep.yml`,
      `destroy-all.yml`, `docs/operations.md` describing both. Done when the
      sweep runs green on schedule and `destroy-all` is tested once against a
      preview workspace (never against production during this slice).

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
      to break. The version check found every pinned `@rljson/*` package at
      its latest version (`docs/findings/versions.md`); the overrides from
      3.5 were needed right away because `@rljson/validate` pulls older
      copies in, and they live in `pnpm-workspace.yaml` because pnpm 12
      ignores `pnpm.overrides` in `package.json`.
- [ ] **B2 Web app skeleton, mobile first.** Depends on: B1. `web-app`
      package with `index.html`, `app.js`, `styles.css`, hash routing, a shell
      with bottom navigation on narrow screens and a sidebar from 768 px, view
      `species` with component `species-list`. Tap targets at least 44 px,
      system font stack, `prefers-color-scheme` respected, no horizontal
      scrolling at 360 px. Playwright tests at 375 x 812 and 1280 x 800 that
      load the page and see three species. Served by the node at `/`. Done when
      the app works on a phone browser against `node1`.
- [ ] **B3 Animals with a species reference.** Depends on: B2. Table
      `animals` (without story and traits yet), `speciesRef`, route query that
      joins the species, `GET /api/animals`, view `animals` with species name
      and price. Done when the list shows the joined species name.
- [ ] **B4 Long background story.** Depends on: B3. Column
      `backgroundStory`, `GET /api/animals/:id`, view `animal-detail`, Gherkin
      set up with a first feature that round-trips a 4 000 character story.
      Done when the feature passes and the story reads well on a phone
      (line length, font size).
- [ ] **B5 Traits as multi-reference.** Depends on: B4. Table `traits`,
      column `traitsRefs` (jsonArray of hashes), validation test for a dangling
      entry, trait chips in the detail view, filter `?trait=<id>`. Done when
      filtering works and the validator rejects a dangling trait.
- [ ] **B6 Traits as a junction table.** Depends on: B5. Table
      `animalTraits`, the same filter implemented over the junction, both
      implementations behind one interface with a toggle in configuration, and
      `docs/findings/n-to-m.md` comparing query shape, payload size and
      validation. Done when both paths return the same result in a test.
- [ ] **B7 Persons and breeders.** Depends on: B4. Tables `persons`,
      `breeders`, column `breederRef`, `GET /api/breeders`, breeder shown in the
      detail view. Done when a breeder appears with their person data.
- [ ] **B8 Customers and invoices.** Depends on: B7. Tables `customers`,
      `invoices`, `invoiceItems`, `changeSets` (3.4), `POST /api/invoices`
      writing all rows plus one change set, `GET /api/invoices`, view
      `invoices` and component `invoice-form` (pick customer, add animals,
      submit), Gherkin feature "Scrooge buys Donald the duck". Done when an
      invoice issued on the phone shows up in the list with its items.
- [ ] **B9 Versions of an entity.** Depends on: B8. `PUT /api/animals/:id`,
      `GET /api/animals/:id/history`, version list in the detail view, the
      "current version" rule from 2.6 implemented once in `domain` and used by
      every list endpoint, Gherkin feature for a price change. Done when the
      list shows the new price and the history shows both versions.
- [ ] **B10 Seed generator.** Depends on: B9. Deterministic generator with
      a seed and sizes `small` (10 species, 100 animals), `medium`, `large`
      (50 species, 40 traits, 2 000 animals, 300 customers, 50 breeders, 5 000
      invoices, 12 000 items), names from Duckburg pools, deterministic ids,
      `SEED_SIZE` handling at first start, `GET /api/stats`. Tests: same seed
      gives identical hashes, sizes match, some breeders are customers, some
      invoices are unpaid. Done when `node1` runs with `SEED_SIZE=medium`.
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

### Phase C: persistent stores, one node per engine

- [ ] **C1 SQLite store.** Depends on: B13. `STORAGE=sqlite` with
      `IoSqliteNode` under `DATA_DIR`, node1 in production becomes a
      `StatefulSet` with a claim, the Gherkin domain suite runs against both
      stores in CI, `docs/findings/versions.md` and `docs/findings/stores.md`
      started. Done when an invoice survives a redeploy of node1.
- [ ] **C2 Blobs on disk.** Depends on: C1. `BsFs` under `DATA_DIR/blobs`
      for the sqlite node. Done when species images survive a redeploy.
- [ ] **C3 Second and third node.** Depends on: C1. node2 (`sqlite` for
      now) and node3 (`memory`) deployed with their own hostnames and seeds,
      each still independent. Done when all three hosts serve the app.
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

- [ ] **D1 Discovery and roles.** Depends on: C3. `RoleOrchestrator` over
      `NetworkManager` (broadcast, probing, identity under `DATA_DIR/identity`),
      `/status` shows node id, role, hub, peers; view `network` in the app with
      the topology and links to the other nodes; a local Docker Compose file
      with three nodes for the integration tests. Gherkin: "three nodes start,
      exactly one becomes hub". Done when the production status pages agree on
      one hub.
- [ ] **D2 Hub transport.** Depends on: D1. As hub, run `Server` over the
      node's own `Io` and `Bs` with a socket.io server on 3000; as client, run
      `Client` connected to the hub; the API uses the multis from then on.
      Gherkin: "a row written on the hub is readable by hash on a client". Done
      when the feature passes against Compose and `/status` in production shows
      connected clients.
- [ ] **D3 Change set synchronisation.** Depends on: D2. `SyncAgent`:
      announce every change set, pull incoming change sets and their items,
      emit `sync` events. Gherkin: "a customer created on node1 is listed on
      node2 and node3 within five seconds". Done when an invoice issued on the
      phone against node3 appears on node1.
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
- [ ] **D13 Deletions.** Depends on: D12. Tombstone versions (`deleted:
true`), lists hide them, edit versus delete resolves to the edit. Gherkin
      feature.
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
      Terraform, provisioner removed.

## 6. Findings template

Every `docs/findings/<topic>.md` has four sections: what we tried (commands,
sizes, versions), what happened (numbers, logs, screenshots as text), what it
means for rljson users, and candidates for upstream issues with a one-line
reproduction each.
