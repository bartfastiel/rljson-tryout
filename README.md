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

The system is live with a production Let's Encrypt certificate on three nodes: [node1](https://node1.rljson-tryout.wer-ist-daniel-schwarz.de) (also the apex host [rljson-tryout.wer-ist-daniel-schwarz.de](https://rljson-tryout.wer-ist-daniel-schwarz.de)), [node2](https://node2.rljson-tryout.wer-ist-daniel-schwarz.de) and [node3](https://node3.rljson-tryout.wer-ist-daniel-schwarz.de).
Phase A (walking skeleton to production) is complete; phase B (the domain on one node) is in progress, slice C1 gives node1 and node2 in production a SQLite store on a persistent volume each, so their invoices survive a redeploy, and slice C3 puts the three nodes on the internet, each still with its own data.
Slice D1 (discovery and roles) was pulled forward: every node discovers the other nodes of its rljson domain by UDP broadcast, takes part in the hub election and reports the outcome at `/status`; since C3 the three production nodes agree on one hub, which the header of the web app and the `Network` view show live.
Slice D2 (hub transport) makes the nodes talk: the hub serves its store over socket.io on the hub port, every client connects to it, and a row written on one node is readable by its hash on every other node through the read cascade of `@rljson/server`.
Slice D3 (change set synchronisation) makes them agree: every change a node writes is announced as one change set, every other node pulls it within tens of milliseconds, an animal renamed on one node shows the new name on all of them, and the seed is deterministic, so a node seeded `medium` fills the `small` ones with its generated rows.
Slice B13 (live updates) makes it visible: every node streams its inserts, transfers and topology changes over `GET /api/events`, and the web app refreshes what it shows the moment they arrive, with a header indicator for the connection.
Slice D4 (bootstrap and catch-up) makes them complete: whenever a node connects to its hub, both compare the change sets they hold and pull what they lack, so a node that restarts or joins late holds everything the others wrote while it was away within moments of reconnecting, and a hub that restarts learns what its clients hold.
Slice D3b (transfer indicators) shows the traffic: every partner node in the header carries an upstream and a downstream arrow that fills up while a change set arrives from or goes to that node, and a tap on the node opens the last ten transfers with it, each expandable to the rows it carried, an edited entity next to the version it replaced.
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
At its first start, while every table is still empty, the node seeds its
rljson store with the size `SEED_SIZE` names: `small` (the
default) is the hand-written Duckburg seed of three species, eight
Duckburg-flavoured traits, eight persons, four breeders, five customers,
ten animals, the `animalTraits` junction table derived from the animals'
traits, and six invoices; `medium` and `large` add rows from the
deterministic generator in `packages/domain/src/generator` on top of it
(`medium`: 10 species, 15 traits, 100 animals, 30 customers, 10 breeders,
200 invoices with 400 items; `large`: 50 species, 40 traits, 2 000
animals, 300 customers, 50 breeders, 5 000 invoices with 12 000 items),
drawn from Duckburg name pools with a seeded random source so that every
node computes the same hashes for the same size; `none` leaves the tables
empty. Every generated row gets its InsertHistory row and every generated
entity its change set, the way the API writes them
([docs/findings/seed-generator.md](docs/findings/seed-generator.md):
`large` seeds in about 1.4 seconds into the in-memory store and 16 seconds
into SQLite). The node serves the data as
`GET /api/species`
(`[{ id, hash, name, latinName, description, imageUrl }]`),
`GET /api/species/:hash/image` (the PNG of that species version,
`Cache-Control: public, max-age=31536000, immutable` because the hash names
the version and the version names the image by content, `404` for an
unknown hash; every species image is a 256 by 256 badge rendered
deterministically from the species id by the domain package's own PNG
encoder, stored once in the node's blob store under the content id the
species row carries in `imageBlobId`, see
[docs/findings/blobs.md](docs/findings/blobs.md)), `GET /api/traits`
(`[{ id, hash, name, description }]`), `GET /api/breeders`
(`[{ id, hash, farmName, suppliesSince, person: { id, name, city } | null }]`,
the supplying person already joined), `GET /api/customers`
(`[{ id, hash, customerNumber, person: { id, name, city } | null }]`),
`GET /api/animals` (one page of the current animals, optionally narrowed
with `?species=<id>`, `?breeder=<id>`, `?trait=<id>`, `?q=<text>` (a
case-insensitive substring of the name or the species name), or any
combination, and sliced with `?limit=<1..200>` (default 50) and
`?offset=<n>` (default 0), returning
`{ items: [{ id, hash, name, speciesId, speciesName, speciesImageUrl, breederId, breederFarmName, bornOn, priceCents }], total, limit, offset }`
with the species and breeder already joined but the background story and
the traits left out so the list stays light, and `400` for a `limit` or
`offset` outside its range), `GET /api/animals/:id`
(the same fields plus the full `backgroundStory`, `traits: [{ id, name }]`
and `breeder: { id, farmName, personName, city } | null`, `404` for an
unknown id; `?version=<hash>` serves that exact version of the animal
instead of the current one), `GET /api/animals/:id/history` (every version
of the animal newest first,
`[{ hash, timeId, previous, current, name, priceCents, bornOn, speciesId, breederId, traitIds, storyLength }]`),
`PUT /api/animals/:id` (body: any subset of `name`, `speciesId`,
`breederId`, `bornOn`, `priceCents`, `backgroundStory`, `traitIds`; writes
a new version of the animal chained onto the current one and answers `200`
with it as the detail endpoint serves it, `400` with
`{ statusCode, error, message }` for a value that cannot be applied, `404`
for an unknown id; every list serves the current version of each entity,
see [docs/findings/entity-versions.md](docs/findings/entity-versions.md)),
`GET /api/invoices` (newest first,
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
`{ nodeName, nodeId, publicUrl, domain, role, hubNodeId, hubAddress, peers, nodes, transport, sync, storage, tables }`
with `role` one of `starting`, `standalone` (no other node of the domain
is known, or discovery is disabled), `hub` and `client`; `peers` lists
every node discovery knows (`nodeId`, `name` when known, `hostname`,
`addresses`, `port`, `role`, `startedAt`, `firstSeen`, `lastSeen`,
`probe: { reachable, latencyMs, measuredAt } | null`; a peer's `lastSeen`
advances for as long as discovery still lists it, not per heartbeat, so
`probe.measuredAt` and `probe.reachable` tell whether it answered); `nodes` lists every
URL of `NODE_URLS` (this node included and flagged `self`) with the name,
node id, role and, for the hub, `connectedClients` it reported to this
node's poll of its `/status`, `reachable` from that server-side poll,
`seenInTopology` from discovery and `lastSeen`; `tables` holds the row
count of every table of the store.
`GET /api/stats` reports
`{ nodeName, seedSize, uptimeSeconds, startedAt, rssBytes, tables }`: the
seed size the node was configured with, its uptime, the resident set size
of the process in bytes and the same row counts `/status` carries, which
is how a large seed's cost in memory is observed. `/health`, `/status`
and `/api/stats` allow cross-origin reads so that the web app of one node
can probe every other node. Set `DISCOVERY=disabled` for a
single-node run without sockets; the node then reports `standalone` with
an id that lives for the process only. The node id of a node with
discovery persists under `DATA_DIR/identity/<domain>/node-id`.

The role decides what runs on the hub port. The hub starts a socket.io
server on `HUB_PORT` with a `Server` of `@rljson/server` over the node's
own store behind it, and every client connects a socket.io client to the
hub's address with a `Client` over its own store; `transport` in
`/status` shows it: `{ role: "hub", hubAddress, connectedClients, lastError }`
on the hub, `{ role: "client", hubAddress, connectedToHub, lastError }` on
a client, `{ role: "standalone", hubAddress: null, lastError }` otherwise,
with `lastError` the last failure of the transport (a port that would not
bind, a hub that cannot be reached, a dropped socket), `null` once the
next step succeeded. From then on every read of a specific row goes
through the read cascade of `@rljson/server`: the local store first, then
the hub, and through the hub every other client, and what comes back is
cached locally. Writes stay local and whole-table reads never leave the
node, so `GET /api/animals/:id?version=<hash>` on a client serves a
version written on the hub by its hash and `GET /api/invoices/:id` serves
an invoice issued on the hub by its id the moment they exist. What the
cascade does on a read miss, what the requests look like on the wire and
what happens when the hub goes away are in
[docs/findings/hub-transport.md](docs/findings/hub-transport.md).

Every change a node writes is one change set (the rows it wrote and their
InsertHistory rows, named by hash), and the node's `SyncAgent` announces
its hash on the `changeSets` route: a client announces to the hub, the
hub relays to every other client and takes part itself through a
loopback connection. Every other node pulls the change set and its rows
by hash from the hub's store (the hub from its clients'), checks each
row's hash against its content, writes the rows exactly as they came in
one write, so that the change set appears whole or not at all, and
records it, so an invoice issued on one node is listed on every node and an animal
renamed on one node is the current version on every node, its history
chained to the seed version, within tens of milliseconds. A change set a
node already holds is skipped by hash; one whose rows a peer cannot serve
stays pending and is pulled again on the next announcement and every
thirty seconds. Whenever a client connects to its hub (at its start,
after a restart, after every reconnection) the two catch up: each lists
the change sets the other holds, read from the other's store alone,
pulls what it lacks in the order the other learned about them and
announces what the other lacks. A node that seeded before it joined
therefore tells the others what it holds, a node that restarts holds
everything the others wrote while it was away moments after it
reconnected, and a hub that restarts learns what its clients hold; two
nodes that hold the same change sets exchange one table read and
nothing else. `/status` reports it under `sync`:
`{ announced, received, skipped, pending, failed, lastError, transfers, catchUp }`
with the last ten transfers, each with its direction, the node it came
from or went to, the change set, the rows per table, how long the pull
took and how it ended, and the last catch-up
(`{ lastStartedAt, lastCompletedAt, missingAtStart, pulled, durationMs }`);
the `Network` view shows the counters and transfers. The seed is
deterministic down to its history rows and change sets (the same fixed
`timeId`s on every node, one change set per seeded entity, 44 for
`small`), so every node seeds itself, the catch-up finds nothing to do
between nodes of the same seed, and a node seeded `medium` fills `small`
nodes with its 400 generated change sets in under half a second. The wire
format, the timings and what the library does and does not do are in
[docs/findings/change-set-sync.md](docs/findings/change-set-sync.md).

`STORAGE` selects what backs the store. `memory` (the default) keeps
everything in the process, so a restart starts from the seed again.
`sqlite` keeps it in `DATA_DIR/petshop.sqlite` through
`@rljson/io-sqlite-node` on `node:sqlite` (no native module, no flag on
Node 24): the tables are created once and found again on the next start,
the seed runs only into an empty database, and every invoice issued
through the API is still listed after the process was stopped and started
again. The database runs in write-ahead logging mode with
`synchronous = NORMAL`, which keeps every committed write across a crash
of the process (only a power loss can lose the last ones) and makes the
seed about ten times faster than SQLite's defaults; `/status` reports
which store is active under `storage`. The store tests and the Gherkin
features run over both stores, and
[docs/findings/stores.md](docs/findings/stores.md) lists where the two
`Io` implementations differ and how fast each one is.

```sh
STORAGE=sqlite DATA_DIR=/tmp/petshop pnpm --filter @rljson-tryout/node-service start
```

The animals view of the web app searches and pages through the node: a
search field at the top narrows the list to names and species containing
the text (the text lives in the hash, `#/animals?q=quack`, so it combines
with the filter chips and survives a reload), a line says how many of the
matching animals are shown, and a "Load more" button appends the next
fifty. The animal picker of the invoice form asks the node for the twenty
animals matching its search the same way. Every species has a badge: the
species cards show it at the top, the animal cards as a small round
thumbnail beside the name, the animal detail next to the facts, all
served from `GET /api/species/:hash/image` with a cache header that lets
the browser keep them.

The web app shows the environment in the header: this node as a badge,
every other node of `NODE_URLS` as a badge outlined green when discovery
on this node sees it and red otherwise, with a small marker for the
browser's own `/health` probe, on the hub a small count of its connected
clients, and two small arrows: the upstream arrow fills up from the
bottom, over and over, while a change set is arriving from that node and
for one more second after it landed, the downstream arrow does the same
while this node announces to it (a hub's announcement reaches every
client, so every badge shows it), a failed pull flashes the arrow red
once, and with `prefers-reduced-motion` the arrow simply turns green for
the same time. Tapping a partner opens a popup (full screen on a phone,
a dialog on a wide screen) with the node's link and the last ten
transfers with it, newest first, each with the direction, the tables,
the short change set hash, the row count, the time, the duration and the
outcome, kept current from the stream while it is open; a row expands to
the change set's payload: every row with its fields and, for an edited
entity, the new version next to the one it replaced with the changed
fields marked and long texts cut to the changed region. The data comes
from `GET /api/sync/transfers?peer=<nodeId>&limit=10` (the sync agent
remembers the last fifty transfers) and `GET /api/change-sets/:hash`
(`{ hash, id, items: [{ table, ref, row, previousRow }] }`, `404` for a
change set the node does not hold). The `Network` view lists the same
nodes with all three signals, the same arrows and a `Transfers` button
per partner, what this node's hub transport is doing, and the discovered
peers.

Everything a node does is also a stream: `GET /api/events` answers
server-sent events (`text/event-stream`, kept open, a comment heartbeat
every fifteen seconds, an `id` per event and a `retry` hint of three
seconds) with `insert` for every change set this node writes itself
(`{ changeSetHash, changeSetId, tables, entityIds }`), `sync` for every
change set transfer of the sync agent (the transfer as `/status` lists
it, once when the pull starts with `status: "pending"` and once with its
outcome) and `topology` whenever the network part of `/status` changes
(`{ nodeId, role, hubNodeId, hubAddress, peers, nodes, transport }`);
`conflict` is reserved for the conflict detection of slice D11. Try it
with `curl -N http://localhost:8080/api/events` in one shell and an
invoice issued in another. The web app follows the stream: a header
indicator shows whether it is live (green), reconnecting (amber) or the
browser is offline (grey), every list and detail refreshes in place when
a change set touches what it shows, so an invoice issued in one tab or on
another node appears in the invoice list of every other tab without a
reload, the search text, filters, loaded pages and scroll position
staying as they are, and the header and the `Network` view follow the
`topology` and `sync` events, with a status poll every thirty seconds as
the fallback. What the stream looks like on the wire, through Traefik
and under load is in [docs/findings/live-updates.md](docs/findings/live-updates.md).

Environment variables the service understands so far:

| Variable            | Default                        | Meaning                                                                                                                                                                                             |
| ------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_NAME`         | `node1`                        | Display name, reported by `/health` and `/status`                                                                                                                                                   |
| `HTTP_PORT`         | `8080`                         | Port to listen on, must be an integer 0 to 65535                                                                                                                                                    |
| `LOG_LEVEL`         | `info`                         | Pino log level (`fatal`, `error`, `warn`, `info`, `debug`, `trace`)                                                                                                                                 |
| `GIT_COMMIT`        | `unknown`                      | Commit shown by `/health`, set by the container build                                                                                                                                               |
| `WEB_APP_DIRECTORY` | `packages/web-app/public`      | Directory served at `/`; must exist (`/app/public` in the image)                                                                                                                                    |
| `TRAIT_RELATION`    | `multi-reference`              | How the store reads which traits an animal carries: `multi-reference` (`animals.traitsRefs`) or `junction` (the `animalTraits` table, [docs/findings/n-to-m.md](docs/findings/n-to-m.md))           |
| `RLJSON_DOMAIN`     | `petshop-local`                | rljson network domain; only nodes of the same domain discover each other                                                                                                                            |
| `HUB_PORT`          | `3000`                         | TCP port of the hub transport and of the probe listener                                                                                                                                             |
| `BROADCAST_PORT`    | `41234`                        | UDP port of the discovery announcements                                                                                                                                                             |
| `STORAGE`           | `memory`                       | What backs the store: `memory` (lost on restart) or `sqlite` (`DATA_DIR/petshop.sqlite`, survives restarts); `mssql` follows with slice C4                                                          |
| `SEED_SIZE`         | `small`                        | What an empty store is seeded with at the first start: `none`, `small` (the hand-written seed), `medium` or `large` (the hand-written seed plus generated rows); a store that holds rows keeps them |
| `DATA_DIR`          | `packages/node-service/data`   | Where the node identity lives (`identity/<domain>/node-id`) and, with `STORAGE=sqlite`, the database file; `/data` in the image                                                                     |
| `PUBLIC_URL`        | `http://localhost:<HTTP_PORT>` | This node's own URL as `/status` reports it and as the other nodes link to it                                                                                                                       |
| `NODE_URLS`         | empty                          | Comma separated public URLs of every node of the environment, this one included, as the header links to them                                                                                        |
| `NODE_STATUS_URLS`  | `NODE_URLS`                    | Comma separated URLs at which this node polls the `/status` of the node at the same position of `NODE_URLS` every three seconds; the in-cluster service URLs in Kubernetes, same length             |
| `DISCOVERY`         | `enabled`                      | `disabled` turns the broadcast and probe sockets off (unit tests, single-node runs)                                                                                                                 |

### Running three nodes with Docker Compose

`deploy/compose/three-nodes.yml` starts three node services of the domain
`petshop-compose` on one bridge network, reachable from the host on the
ports 8301 to 8303 (`NODE1_PORT` to `NODE3_PORT`):

```sh
docker compose -f deploy/compose/three-nodes.yml up --build --wait
curl -s http://localhost:8301/status | jq '{nodeName, role, hubAddress, transport}'
docker compose -f deploy/compose/three-nodes.yml down
```

Within about five seconds (one broadcast interval) exactly one node
reports `hub` and the other two `client` with the same `hubAddress`, and
a moment later the hub's `transport` counts two connected clients and
each client's reports `connectedToHub: true`, every node's `sync.catchUp`
shows a completed catch-up with nothing missing and nothing announced,
since all three seeded the same. An animal
renamed on any node (`PUT /api/animals/bowser-the-guard-dog` with
`{ "name": "Bowser the Retired Guard Dog" }`) then shows the new name on
the other two (`GET /api/animals/bowser-the-guard-dog`) within tens of
milliseconds, an invoice issued on any node (`POST /api/invoices`) is
listed on the other two (`GET /api/invoices`), and `/status.sync` of the
receivers lists the transfer with the node it came from. Stop a client
(`docker compose -f deploy/compose/three-nodes.yml stop node3`), write on
the other two, start it again (`… start node3`): its `tables` match the
others' within a second of `connectedToHub: true` and its `sync.catchUp`
reports what it pulled. `NODE<n>_SEED_SIZE` sets one node's seed, so a
node started with `none` next to one with `medium` shows the catch-up of
several hundred change sets. Like in
Kubernetes, the nodes
carry two address lists: `NODE_URLS` names the host-side URLs
(`http://localhost:8301` and so on), so the links in the header open from
a browser on the host and its probe marker turns green, and
`NODE_STATUS_URLS` names the container-internal URLs (`http://node1:8080`
and so on), where the nodes poll each other's `/status`. Set
`NODE_SERVICE_IMAGE` to run a pushed image instead of building one, together
with `NODE_SERVICE_PULL_POLICY=missing` unless the image was pulled before
(the compose file never pulls by default, so a local build is never
overwritten by a registry image of the same name). The Gherkin features
`packages/node-service/features/network.feature` ("three nodes start,
exactly one becomes hub"), `features/hub-transport.feature` ("a row
written on the hub is readable by hash on a client") and
`features/change-set-sync.feature` ("an invoice issued on node3 appears
on node1 and node2 within five seconds", "an animal renamed on node2
shows the new name on node1 and node3", "a change set announced again is
written once", the latter two also run in-process by `pnpm test`; its
fourth scenario, the transfers with a node and the rows an edit carried
as the web app reads them, runs in-process only) and
`features/bootstrap.feature` ("node3 restarts and catches up"; its two
other scenarios, a hub that restarts and a node that joins with change
sets of its own, run in-process only) drive exactly this setup:

```sh
pnpm --filter @rljson-tryout/node-service test:integration
```

It needs Docker, builds the image from the working tree (or uses
`NODE_SERVICE_IMAGE`), waits for the three `/status` endpoints to settle,
checks the roles, the hub address, the node lists and the transport, edits
an animal and issues an invoice on the hub and reads both back on a
client, issues an invoice on node3 and renames an animal on node2 and
waits for them on the other nodes, restarts a client container and checks
that it holds the hub's invoice again while the other client holds it
once, saves the compose logs to
`packages/node-service/test-results/compose/three-nodes.log` and tears the
project down again. `pnpm test` leaves it out; the `integration` job of
the pipeline runs it against the image the `image` job pushed. What the
library does and does not do, and the timings measured, are in
[docs/findings/network-discovery.md](docs/findings/network-discovery.md)
and [docs/findings/hub-transport.md](docs/findings/hub-transport.md).

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
workspace `production`, one workload of the node service per node, a
`ClusterIP` service and a Traefik `Ingress` per node, plus an ingress for
the apex host that routes to `node1`. The workload
follows the node's `storage` in the module's `nodes` list: a `memory` node
is a `Deployment` over an `emptyDir` with a surge rollout, a `sqlite` node
is a `StatefulSet` with one replica and a 2 Gi `local-path` persistent
volume claim mounted at `/data`, which holds the SQLite file and the
discovery identity, so that an invoice and the node id survive a restart
and a redeploy (a rollout of a `StatefulSet` replaces its single pod, a
few seconds of downtime the `smoke` job waits out). Production runs
three nodes, `node1` and `node2` over `sqlite` and `node3` over `memory`,
each with its own hostname, certificate and seed; previews run a single
`node1` over `memory`. The image is the one the
`image` job pushed for the same commit,
`ghcr.io/bartfastiel/rljson-tryout/node-service:<commit sha>`. Every pod
receives its configuration from the module: `STORAGE`, `SEED_SIZE`
(`small` on every node), `RLJSON_DOMAIN`
(`petshop-production`, or `petshop-pr-<number>` in a preview, so that the
environments sharing the pod network never see each other), `HUB_PORT`,
`BROADCAST_PORT`, `DATA_DIR=/data` (the root filesystem is read-only),
`PUBLIC_URL`, the `NODE_URLS` of all nodes of the environment and the
`NODE_STATUS_URLS` of their `ClusterIP` services
(`http://<node>.<namespace>.svc.cluster.local`), where the server-side
`/status` poll goes because a preview's public certificate is not one
Node's `fetch` trusts; the
container ports 3000 (TCP) and 41234 (UDP) are named in the pod, and the
pods share the flannel bridge without `hostNetwork`, over which the UDP
broadcast of one pod reaches the others
([docs/findings/network-discovery.md](docs/findings/network-discovery.md)).

Every push to `main` deploys automatically: the `image` job pushes
`ghcr.io/<repository>/node-service:<commit sha>`, the `terraform-workloads`
job plans and applies workspace `production` with exactly that reference
and exposes the deployed URLs as a job output, and the `smoke` job runs
`infra/scripts/verify-deployment.sh` against them: it polls `/health` until
it reports the commit that was just pushed with a certificate the runner
trusts, then checks that `http://` redirects, that `/status` reports a
settled discovery role (`standalone`, `hub` or `client`), that
`/api/species` lists species and that `/` serves the web app; with three
or more URLs it then waits (up to five minutes) until every node lists
every other node as seen in the discovery topology and exactly one node
is the hub, and prints the roles. The
hostnames follow
`<node>.<base_domain>` with the apex host as an alias of `node1`; with the
default `base_domain` that is

- `https://node1.rljson-tryout.wer-ist-daniel-schwarz.de/health`
- `https://node2.rljson-tryout.wer-ist-daniel-schwarz.de/health`
- `https://node3.rljson-tryout.wer-ist-daniel-schwarz.de/health`
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
