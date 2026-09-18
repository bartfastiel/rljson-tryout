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
- Measured through Traefik on the preview of pull request #40
  (`node1-pr-40`, a single memory node behind a staging certificate, as
  every preview is): a stream read for 45 s with five invoices issued on
  the node meanwhile, a stream left idle for 200 s, and the app in two
  tabs of one Chromium with an invoice issued in one of them. The
  cross-node `sync` event through Traefik is a production check after the
  merge, since only production runs three nodes.

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

Through Traefik (preview of #40, `https://node1-pr-40.rljson-tryout…`,
HTTPS, HTTP/2 from Node's `fetch`, no ingress annotation added):

- Traefik as k3s ships it passes the stream through unchanged: the
  response carried `content-type: text/event-stream`, `cache-control:
no-cache`, `x-accel-buffering: no` and chunked transfer, and an
  `insert` event arrived 0.6 ms before the answer of the `POST` that
  caused it (median of five, the two responses race over the same
  connection), 32 ms after the request left, which is the round trip.
  Traefik does not buffer `text/event-stream`; its flush interval only
  applies to other content types.
- Nothing closes an idle stream: left alone for 200 s, the connection
  saw a heartbeat every 15.0 s and nothing else, and ended only when the
  client aborted. Traefik's timeouts that could apply
  (`respondingTimeouts.idleTimeout`, 180 s by default) count idle
  keep-alive connections between requests, not a response in progress,
  and the heartbeat keeps the response in progress anyway. No k3s or
  Traefik setting was touched for this.
- The app in two tabs of one Chromium against the preview: tab B on the
  invoice list showed "Live updates: live", an invoice issued through the
  form in tab A (105 ms for the `POST`) appeared as a card in tab B
  310 ms later, one navigation entry in tab B throughout (no reload),
  which is the 300 ms debounce plus one `GET /api/invoices`.
- A preview is a single node, so the cross-node `sync` event through
  Traefik is checked in production after the merge: `curl -N
https://node1.rljson-tryout…/api/events` while an invoice is issued on
  node3 should show `pending` and `completed` `sync` events within a
  second, given the tens of milliseconds the sync itself takes
  (`docs/findings/change-set-sync.md`).

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

## Slice D3b: transfer indicators

### What we tried

- Built the per-partner transfer icons of the header and the network
  view (`transfer-activity.js`, `transfer-icon.js`), the popup with the
  last ten transfers and the expandable payload (`transfer-dialog.js`,
  `change-set-payload.js`), `GET /api/sync/transfers` over a ring of
  fifty transfers in the `SyncAgent`, and `GET /api/change-sets/:hash`
  over `PetShopStore.changeSetPayload`, which resolves the version a
  data row supersedes through the local store.
- Tested the payload resolution over both stores (an edited animal, a
  seeded row, an invoice, a change set recorded without its rows), the
  routes with `inject`, and the app with Playwright at both viewports
  with a mocked stream, a mocked status and mocked endpoints.
- Ran the three containers (host ports 8501 to 8503, node1 the hub)
  with node1's web app open in Chromium at both viewports and a
  `MutationObserver` on node2's upstream icon, renamed an animal on
  node2, opened the popup, then issued an invoice on node2 while it was
  open.

### What happened

- Resolving the version a received row supersedes needs no second read
  of the network: a change set names the row's InsertHistory row, the
  history row's `previous` names the `timeId` of the earlier history
  row, which the sync agent pulled as a dependency when it was missing
  (`docs/findings/change-set-sync.md`), and that row's `<table>Ref`
  names the earlier data row. Two reads by `timeId` and by `_hash` on
  the local store per data row; a seeded row and an invoice have
  `previous: []` and read as first versions, a junction row of an edit
  chains to the earlier pairing and shows the old `animalRef` next to
  the new one.
- On Compose the rename on node2 reached node1's icon 35 ms after the
  `PUT` started (`is-receiving`), the pull took 5 to 9 ms (`is-trailing`
  8 ms later), the status refresh the `sync` event triggers rebuilt the
  bar about 300 ms later with the icon still trailing and the fill loop
  in step, and the icon was idle after the trailing second. The invoice
  issued on node2 while the popup was open appeared as its first row
  (`invoices 1, invoiceItems 1`, 3 ms) before the `POST` had been
  answered for 30 ms. The hub's own edit shows as one outgoing transfer
  with `peerNodeId: null` on the hub, listed for every partner, and as
  an incoming transfer from the hub's id on each client.
- A `pending` start and the outcome of a pull that takes single-digit
  milliseconds arrive in the same tick of the browser; the trailing
  second is what makes a transfer visible at all, and a rebuilt icon
  must not restart the loop, or every status refresh would show a jump.
  The loop's phase is therefore global (`animation-delay` set to the
  negative elapsed part of the 700 ms loop when an icon starts
  animating), and `applyActivityTo` only touches an icon whose state
  changed.
- Playwright cannot stream a `route.fulfill`, so the tests answer
  `/api/events` with one complete `text/event-stream` body per batch of
  events and a `retry: 100`: the browser applies the events, sees the
  response end, reconnects after 100 ms and waits on the next batch,
  which the test releases when it is ready. The state classes of a
  transfer can then be asserted one at a time, including the second of
  `is-trailing`.
- `showModal()` puts the focus on the first focusable element of the
  dialog, the partner's link; the title takes it instead
  (`tabindex="-1"`), so that the name is read first and Tab reaches the
  link, the close button and the rows in order. The badge that opened
  the popup may have been rebuilt by a status refresh by the time it
  closes; the focus then goes to its successor for the same partner
  (`data-transfer-partner`).

### What it means for rljson users

- The InsertHistory row is enough to show a before and after: keep the
  history rows in the change set, pull the `previous` rows as
  dependencies, and a diff of two versions is two local reads.
- The row hashes and `timeId`s a change set carries are the only
  identity a UI needs across nodes; a transfer list keyed by change set
  hash and direction can merge a pull's start and outcome without
  further state.

### Candidates for upstream issues

- None new; the missing "arrived" signal of `Connector.listen` (above)
  is what makes the project's own `pending` and `completed` events
  necessary for the indicators.
