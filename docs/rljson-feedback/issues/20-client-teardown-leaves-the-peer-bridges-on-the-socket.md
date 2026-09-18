# `Client.tearDown()` leaves the `IoPeerBridge` and `BsPeerBridge` listeners on the socket

- Package: `@rljson/server` 0.0.64 (`Client.init`, `Client.tearDown`)
- Environment: Node 24.18.0, Windows 11 Pro (10.0.26200)
- Severity: resource leak; a socket reused for a second `Client` answers
  every hub request twice

## Reproduction

```js
import { IoMem, createSocketPair } from '@rljson/io';
import { Route } from '@rljson/rljson';
import { Client, Server } from '@rljson/server';

const route = Route.fromFlat('changeSets');
const hubIo = new IoMem();
await hubIo.init();
const server = new Server(route, hubIo);
await server.init();
const [clientSocket, serverSocket] = createSocketPair();
clientSocket.connect();
const clientIo = new IoMem();
await clientIo.init();
const client = new Client(clientSocket, clientIo, undefined, route, {
  ownsStores: false,
});
await Promise.all([server.addSocket(serverSocket), client.init()]);

console.log(
  'readRows listeners on the client socket after init:    ',
  clientSocket.listenerCount('readRows'),
);
await client.tearDown();
console.log(
  'readRows listeners on the client socket after tearDown:',
  clientSocket.listenerCount('readRows'),
);
await server.tearDown();
```

## Expected

`tearDown()` removes what `init()` registered, so the socket can be
reused or is at least quiet.

## Actual

```text
readRows listeners on the client socket after init:     1
readRows listeners on the client socket after tearDown: 1
```

`Client.init()` starts an `IoPeerBridge` (and a `BsPeerBridge`) over the
local stores on the socket, which is how the hub reads what the client
holds. `tearDown()` clears the multis, the `Db` and the `Connector` but
never stops the bridges. A `Client` whose `init()` failed after the
bridges started, followed by a new `Client` on the same reconnecting
socket, handles every hub request twice (double local reads and health
`pong`s; acknowledgements are one-shot, so the hub sees one answer).

## Impact on us

The transport drops the socket together with a failed `Client` and opens
a fresh one instead of reusing it (`attachClient` in
`packages/node-service/src/network/hubTransport.ts`).

## Workaround

One socket per `Client`; never reuse a socket after `tearDown()`.

## Suggested fix

Keep the bridges on the instance and stop them in `tearDown()`
(`removeAllListeners` for the `Io` and `Bs` event names the bridge
registered).
