# Live updates over server-sent events

## What we tried

- Fastify 5.12.5 (`reply.hijack()` and the `preClose` hook), Node 24.18.0,
  the browser's `EventSource`, `@rljson/db` 0.0.42 and `@rljson/server`
  0.0.64 behind the change sets of slice D3, while building slice B13.
- Built `EventHub` (`packages/node-service/src/events/eventHub.ts`), the
  route `GET /api/events`, a `TopologyWatch` over the network part of
  `/status`, the `insert` event from the store's change set listener (now
  with the ids of the entities written) and the `sync` event from an
  `onTransfer` hook on the `SyncAgent`, plus `live-events.js`,
  `live-content.js` and `live-indicator.js` in the web app.
- Tested the hub with fake sinks (`eventHub.test.ts`), the route with a
  real `listen` on port 0 and a streaming `fetch` reader
  (`routes/events.test.ts`, `testing/eventStreamReader.ts`; Fastify's
  `inject` cannot keep a response open), the Gherkin feature
  `features/live-updates.feature` in-process over both stores with two
  nodes connected through their hub, and the app with Playwright at both
  viewports, two pages in one context (`tests/live-updates.spec.ts`).
- Measured on the development machine (Windows, `IoMem`): one node on
  port 8451 with 20 invoices issued one after another while a script read
  the stream; two nodes discovering each other on 8452 and 8453 (one
  seeded `medium`, one `small`, broadcast on 8456), 100 invoices issued on
  the client in batches of ten with a stream open on both nodes, and the
  hub's stream watched for 45 s while the client was stopped and started
  again.
- Measured through Traefik on the preview of pull request #40 (three
  memory nodes, staging certificates, `curl -N` for 40 s on node1 while an
  invoice was issued on node3).

## What happened

The wire, as `curl -N` shows it:

```text
HTTP/1.1 200 OK
content-type: text/event-stream
cache-control: no-cache
x-accel-buffering: no
access-control-allow-origin: *
Transfer-Encoding: chunked

retry: 3000

: connected

id: 2
event: insert
data: {"changeSetHash":"X_rqIdDMEa_O1iy8DcSrGt","changeSetId":"issue-invoice-2026-0007","tables":{"invoices":1,"invoicesInsertHistory":1,"invoiceItems":1,"invoiceItemsInsertHistory":1},"entityIds":["invoice-2026-0007","invoice-2026-0007-item-1"]}

: heartbeat
```

- The first event of a fresh node has id 2: id 1 is the `topology` event
  of discovery starting right after `listen` (`starting` to
  `standalone`), streamed to nobody. Ids count per process and are not
  replayed: a browser that reconnects sends `Last-Event-ID`, the node
  ignores it, and the app refreshes every view once the stream is back.
- The seed is written before the server listens and the hub is wired at
  `onReady`, so the 44 or 444 seed change sets are not streamed (and do
  not consume ids); a `medium` node's 400 generated change sets do reach
  a `small` node's stream as `sync` events when they are pulled.

Timings, one node (`IoMem`, port 8451, 20 invoices):

- An `insert` event arrives 0.1 ms (median, at most 0.4 ms) after the
  `POST /api/invoices` answer, because the store's listener runs inside
  the write, before the response goes out; 15.6 ms (median) after the
  request started, which is the write itself.

Timings, two nodes (hub `medium` on 8452, client `small` on 8453):

- The two processes found each other over the UDP broadcast on one
  Windows machine (both bound `0.0.0.0:8456` with `reuseAddr`); the
  client pulled the 400 generated change sets and reported 110 animals.
- 100 invoices issued on the client in 191 ms (batches of ten): the
  client's stream carried 100 `insert` and 100 outgoing `sync` events, the
  hub's stream 100 `pending` and 100 `completed` incoming `sync` events,
  the last one 227 ms after the burst started, 36 ms after the last
  answer; ids consecutive on both, no `pending` with an error.
- Client stopped while the hub's stream was watched (times from the
  stream's start): the socket dropped and `connectedClients` went 1 to 0
  (+5.3 s), the directory's poll reported node-b unreachable (+7.3 s),
  the probe failed (+7.9 s), a heartbeat (+15.0 s), `peer-left` after the
  15 s broadcast timeout with the role going `standalone` (+20.9 s, two
  events in the same millisecond: the peer list, then the role), the
  transport stepped down (+21.4 s). Client started again 22 s after the
  stop: peer discovered with the role `starting` and a probe not yet run
  (+27.5 s), `hub` again 20 ms later, transport serving (+28.5 s), the
  client connected (+31.5 s), the directory seeing it as `client`
  (+34.5 s). Twelve `topology` events in 45 s of a restart, none while
  nothing moved: the comparison leaves `lastSeen` and the probe timings
  out, otherwise every 3 s directory poll and every 10 s probe cycle
  would be an event.

Through Traefik (preview of #40, `node1-pr-40` and `node3-pr-40`):

- See the section below; the numbers were recorded after the preview
  came up.

What the browser does:

- `EventSource` reconnects on its own after a dropped connection, 3 s
  later with the `retry` the stream advises, and fires `error` with
  `readyState CONNECTING` meanwhile (the indicator shows
  "reconnecting"). After an HTTP error (a 502 from a proxy while the node
  restarts) it gives up for good (`readyState CLOSED`), so `live-events.js`
  opens a new one 5 s later. The `offline` and `online` events of the
  window close and reopen it at once (the indicator shows "offline" in
  between). Playwright drives exactly this: `page.route` aborts the
  stream, the page dispatches `offline` and `online`, and the indicator
  goes live, offline, reconnecting, live.
- Two tabs of one profile on plain HTTP share the browser's six
  connections per host; each holds one for its stream. Over HTTPS through
  Traefik the browser multiplexes them on one HTTP/2 connection.
- A view refreshes 300 ms after the last event of a burst, with one
  request per page it has loaded (the animals view fetches every loaded
  page again, in parallel, and drops the answer when the selection or the
  page count moved on meanwhile), so the 100-invoice burst above ended in
  one refresh of the invoice list per tab.
- The indicator cost the phone header its room: with the wider system
  font of the Ubuntu runner (not on Windows) the node badge wrapped under
  the title at 375 px, and a node bar of `height: 100%` in the now taller
  header hung over the first row of every view and swallowed the taps on
  it, which failed eleven unrelated Playwright tests in CI. The bar's
  height follows its content on phones now, and a test at 340 px keeps
  the header above the page.

## What it means for rljson users

- Nothing in rljson emits an event you can stream. What a node writes is
  observable only because this project wraps every write in a change set
  and tells a listener; what arrives from other nodes is observable
  because the `SyncAgent` records each transfer. `Db.registerConflictObserver`
  is the one hook the library offers, and it is per table and about
  branches, not about rows written (slice D11 will feed the `conflict`
  event from it).
- A `Connector.listen` callback fires when a hash is announced, not when
  the rows are there; the `pending` event marks that moment and the
  `completed` one the moment the data is local, which is what a UI can
  animate (D3b).
- The hub transport's state has no event either (`@rljson/server` logs
  connections and disconnections but exposes them as `isConnected` and
  `clients.size` only), so the topology watch polls the snapshot once a
  second; a change of a client's socket therefore reaches the stream up
  to a second late, everything discovery reports at once.
- Keep the stream cheap: a node under a `medium` sync writes 800 events
  in about a second to every client, so the hub never queues per client
  and drops a client whose unread data exceeds a megabyte instead of
  growing with it.

## Candidates for upstream issues

- `Server` and `Client` of `@rljson/server` offer no event for a client
  joining or leaving, or for the socket to the hub connecting and
  dropping; an application that wants to show the topology live has to
  poll `clients.size` and `isConnected`. Reproduction: `new Server(...)`,
  `addSocket(bridge)`, look for an emitter on the instance.
- `Connector.listen` gives no signal once a reference's rows have been
  pulled, only that it was announced; the receiving side has to derive
  "arrived" itself. Reproduction: `connector.listen(cb)`, `cb` runs before
  `IoMulti.readRows` was ever called for the reference.
