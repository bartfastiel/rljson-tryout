# `Server` has no connector of its own: a hub cannot announce or hear references without a loopback socket pair, which then counts as a client

- Package: `@rljson/server` 0.0.64 (`Server`, `addBroadcastSocket`,
  `clients`)
- Environment: Node 24.18.0, Windows 11 Pro (10.0.26200)
- Severity: API gap (boilerplate every hub needs; documented only in a
  comment)

## Reproduction

```js
import { IoMem, createSocketPair } from '@rljson/io';
import { Route } from '@rljson/rljson';
import { Server } from '@rljson/server';

const io = new IoMem();
await io.init();
const server = new Server(Route.fromFlat('changeSets'), io);
await server.init();
console.log(
  'members named like a sender:',
  Object.getOwnPropertyNames(Object.getPrototypeOf(server)).filter((name) =>
    /send|connector|announce/i.test(name),
  ),
);
const [, serverSide] = createSocketPair();
await server.addBroadcastSocket(serverSide);
console.log(
  'clients.size with one loopback and no socket client:',
  server.clients.size,
);
await server.tearDown();
```

## Expected

`server.connector` (or `send`/`listen`) so that the process running the
hub takes part in the route it relays, and a peer count that excludes
broadcast-only sockets.

## Actual

```text
members named like a sender: [ '_sendBootstrap' ]
clients.size with one loopback and no socket client: 1
```

`Server` relays references between its clients and keeps the latest one
for the bootstrap; it never announces or hears on its own behalf. The
`addBroadcastSocket` comment describes the intended pattern ("hub creates
a loopback socket pair so its own Connector can send/receive refs"), and
the package's own `Node` class implements it internally, but a user of
`Server` has to rebuild it: `createSocketPair()`, add one end with
`addBroadcastSocket`, build a `Db` over the local store and a `Connector`
on the other end. The loopback is then counted in `clients`.

## Impact on us

`openHubChannel` in `packages/node-service/src/network/hubTransport.ts`
does exactly that; `connectedClients` in `/status` counts only entries
with an `IoPeer`.

## Workaround

The loopback pair as described.

## Suggested fix

A `Server` option (or `server.connector` getter) that creates the loopback
and the connector internally, and a `peerCount` that leaves broadcast-only
sockets out.
