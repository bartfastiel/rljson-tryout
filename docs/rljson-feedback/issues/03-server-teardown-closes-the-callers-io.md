# `Server.tearDown()` closes the local `Io` it was handed; `Client` has `ownsStores`, `Server` has nothing

- Package: `@rljson/server` 0.0.64 (`Server.tearDown`), `@rljson/io` 0.0.78
  (`IoMulti.close`)
- Environment: Node 24.18.0, Windows 11 Pro (10.0.26200)
- Severity: data availability (a role change closes a SQLite file that is
  still in use)

## Reproduction

```js
import { IoMem, createSocketPair } from '@rljson/io';
import { Route } from '@rljson/rljson';
import { Server } from '@rljson/server';

const route = Route.fromFlat('changeSets');
const io = new IoMem();
await io.init();

const server = new Server(route, io);
await server.init();
console.log('io.isOpen after server.init():     ', io.isOpen);
await server.tearDown();
console.log('io.isOpen after server.tearDown(): ', io.isOpen);

const io2 = new IoMem();
await io2.init();
const server2 = new Server(route, io2);
await server2.init();
const [, serverSide] = createSocketPair();
await server2.addBroadcastSocket(serverSide);
console.log(
  'clients.size with one loopback and no socket client:',
  server2.clients.size,
);
await server2.tearDown();
```

## Expected

The application owns the store; a hub that steps down to client keeps
using it. `ClientOptions.ownsStores: false` exists for exactly this case
(its documentation tells of an election burst that took a hub's store
away); `ServerOptions` has no counterpart.

## Actual

```text
io.isOpen after server.init():      true
io.isOpen after server.tearDown():  false
clients.size with one loopback and no socket client: 1
```

`Server.tearDown()` calls `this._ioMulti.close()` (unawaited) and
`IoMulti.close()` closes every member, the local one included. With
`IoMem` the flag flips and every later `new Server(route, io)` throws
`Local Io must be initialized and open`; with `IoSqliteNode` the file is
closed under the application.

The second half shows a related counting issue: `Server.clients` includes
broadcast-only sockets added with `addBroadcastSocket`, so `clients.size`
is not the number of connected peers once the hub has a loopback
connector (issue 19).

## Impact on us

Every node is hub, client or standalone depending on the election, and the
role changes at runtime. The first hub that stepped down closed its own
store.

## Workaround

`packages/node-service/src/store/borrowedIo.ts`: an `Io` facade whose
`close()` resolves without doing anything, handed to `Server` and `Client`
alike; the node closes the real store on shutdown. `connectedClients` in
`/status` counts the `clients` entries that have an `IoPeer`.

## Suggested fix

Add `ownsStores` to `ServerOptions` with the same semantics as on
`Client`, or never close members an owner passed in (`IoMulti` could take
an `owned: boolean` per member). Expose the peer count without the
broadcast-only sockets.
