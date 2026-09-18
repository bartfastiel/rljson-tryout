# `IoServer` and `IoPeerBridge` answer `write`, `close` and `createOrExtendTable` for any connected peer

- Packages: `@rljson/io` 0.0.78 (`IoServer`, `IoPeerBridge`), `@rljson/server`
  0.0.64 (`Server.addSocket`, `Client.init`)
- Environment: Node 24.18.0, Windows 11 Pro (10.0.26200); the same on
  `node:24-alpine` containers (Docker Desktop and k3s)
- Severity: security

## Reproduction

```js
import { IoMem, createSocketPair } from '@rljson/io';
import { Route } from '@rljson/rljson';
import { Client, Server } from '@rljson/server';

const column = (key) => ({
  key,
  type: 'string',
  titleLong: key,
  titleShort: key,
});
const species = {
  key: 'species',
  type: 'components',
  isHead: true,
  isRoot: true,
  isShared: false,
  columns: [column('_hash'), column('id'), column('name')],
};
const route = Route.fromFlat('changeSets');

const hubIo = new IoMem();
await hubIo.init();
const server = new Server(route, hubIo);
await server.init();
await server.createTables({ withInsertHistory: [species] });

const [clientSocket, serverSocket] = createSocketPair();
clientSocket.connect();
const clientIo = new IoMem();
await clientIo.init();
const client = new Client(clientSocket, clientIo, undefined, route, {
  ownsStores: false,
});
await Promise.all([server.addSocket(serverSocket), client.init()]);

const request = (event, payload) =>
  new Promise((resolve) =>
    clientSocket.emit(event, payload, (result, error) =>
      resolve({ result, error }),
    ),
  );

console.log('hub species rows before:', await hubIo.rowCount('species'));
const written = await request('write', {
  data: {
    species: {
      _type: 'components',
      _data: [{ id: 'evil', name: 'Written from a peer' }],
    },
  },
});
console.log('write from the client socket ->', JSON.stringify(written));
console.log('hub species rows after: ', await hubIo.rowCount('species'));

console.log('hub multi isOpen before close:', server.io.isOpen);
const closed = await request('close', undefined);
console.log('close from the client socket ->', JSON.stringify(closed));
console.log('hub multi isOpen after close: ', server.io.isOpen);
console.log(
  'events the server socket answers:',
  serverSocket
    .eventNames()
    .filter((name) => !String(name).startsWith('/'))
    .sort(),
);
```

## Expected

A peer of a hub is a read-only layer of the hub's `IoMulti` (`Server`
registers peers with `write: false`). The wire should offer a peer what the
multi would ever ask of it: `readRows`, `readRowsByHashes`, `rowCount`,
`tableExists`, `contentType`, `isReady`, `isOpen`. Writes into the other
side's store, closing it and changing its schema should not be reachable
from a socket, or at least not without an authorization hook.

## Actual

```text
hub species rows before: 0
write from the client socket -> {"error":null}
hub species rows after:  1
hub multi isOpen before close: true
close from the client socket -> {"error":null}
hub multi isOpen after close:  false
events the server socket answers: [
  'blobExists',          'close',
  'connect',             'contentType',
  'createOrExtendTable', 'deleteBlob',
  'disconnect',          'dump',
  'dumpTable',           'generateSignedUrl',
  'getBlob',             'getBlobProperties',
  'getBlobStream',       'init',
  'isOpen',              'isReady',
  'listBlobs',           'rawTableCfgs',
  'readRows',            'readRowsByHashes',
  'rowCount',            'setBlob',
  'tableExists',         'write'
]
```

Both sides register handlers for the complete `Io` (and `Bs`) interface.
Anything that connects to the hub port can write into the hub's store
(`IoServer` over the hub's multi, whose local layer is writable), close the
hub's multi (which disconnects every other client's `IoPeer`), extend
tables and read the full dump. The hub can do the same to every client
through the client's `IoPeerBridge`. A `where` clause a peer sends is run
on the receiving store as it came, which makes the unescaped SQL of
`IoSqliteNode` (issue 02) reachable from the network.

## Impact on us

Three nodes share a pod network; the hub port (3000) is not mapped outside
it, so the exposure is limited to the cluster. We still had to treat the
transport as trusted-network-only in the design and lend the store through
a facade whose `close()` is a no-op so that a peer's `close` at least does
not close the SQLite file (`packages/node-service/src/store/borrowedIo.ts`).
Writes from a peer are not prevented at all today.

## Workaround

`BorrowedIo` (no-op `close`) in front of the local store for both `Server`
and `Client`; value validation (`isSafeWhereValue`) before anything enters a
`where` clause that cascades; no port mapping for the hub port.

## Suggested fix

Split the socket protocol into what a peer needs (reads and readiness)
and what an operator needs (writes, schema, lifecycle), register only the
first set in `IoServer` and `IoPeerBridge` by default, and offer an
authorization hook (`ServerOptions.onRefArrived` already shows the shape)
for the rest. Escaping in `IoSqliteNode` (issue 02) is needed regardless.
