# `IoMulti.readRows` waits for the slowest member of a priority group, and the 30 s `IoPeer` timeout cannot be configured through `Server` or `Client`

- Packages: `@rljson/io` 0.0.78 (`IoMulti.readRows`, `IoPeer`),
  `@rljson/server` 0.0.64 (`new IoPeer(socket)` in `Server.addSocket` and
  `Client.init`)
- Environment: Node 24.18.0, Windows 11 Pro (10.0.26200); measured with
  three containers on Docker Desktop as well
- Severity: availability (one slow peer stalls every cascading read on
  every node for 30 s)

## Reproduction A: a group waits for its slowest member

```js
import { IoMem, IoMulti } from '@rljson/io';

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
const store = async (rows) => {
  const io = new IoMem();
  await io.init();
  await io.createOrExtendTable({ tableCfg: species });
  if (rows.length > 0)
    await io.write({ data: { species: { _type: 'components', _data: rows } } });
  return io;
};
const delayed = (io, ms) =>
  new Proxy(io, {
    get: (target, property) =>
      property === 'readRows'
        ? (request) =>
            new Promise((resolve) =>
              setTimeout(() => resolve(target.readRows(request)), ms),
            )
        : Reflect.get(target, property),
  });

const local = await store([]);
const fastPeer = await store([{ id: 'duck', name: 'Duck' }]);
const slowPeer = delayed(await store([]), 2000);
const hash = (await fastPeer.readRows({ table: 'species', where: {} })).species
  ._data[0]._hash;
const multi = new IoMulti([
  { io: local, priority: 1, read: true, write: true, dump: true },
  { io: fastPeer, priority: 2, read: true, write: false, dump: false },
  { io: slowPeer, priority: 2, read: true, write: false, dump: false },
]);
await multi.init();
const started = performance.now();
const result = await multi.readRows({
  table: 'species',
  where: { _hash: hash },
});
console.log(
  'rows found:',
  result.species._data.length,
  '- read by hash took',
  (performance.now() - started).toFixed(0),
  'ms',
);
```

```text
rows found: 1 - read by hash took 2013 ms
```

The fast peer had the row and answered at once; the slow peer answers
after 2 000 ms and the multi waited for it.

`IoMulti.readRows` asks every readable of a group in parallel and collects
them with `Promise.allSettled` before it picks the first that returned
rows (`io.js`, `readRows`, the `else` branch for groups larger than one).
On a hub every client peer sits in the same priority group.

## Reproduction B: the timeout is 30 s and not an option

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
const [clientSocket, serverSocket] = createSocketPair();
clientSocket.connect();
const clientIo = new IoMem();
await clientIo.init();
const client = new Client(clientSocket, clientIo, undefined, route, {
  ownsStores: false,
});
await Promise.all([server.addSocket(serverSocket), client.init()]);
await client.createTables({ withInsertHistory: [species] });

serverSocket.removeAllListeners('readRows'); // the hub stops answering reads
const started = performance.now();
try {
  await client.io.readRows({
    table: 'species',
    where: { _hash: 'NoSuchHash00000000000000' },
  });
} catch (error) {
  console.log(
    `rejected after ${((performance.now() - started) / 1000).toFixed(1)} s: ${error.message}`,
  );
}
```

```text
rejected after 30.0 s: Timeout after 30000ms: readRows
```

`IoPeer` takes `_requestTimeoutMs = 3e4` as a constructor argument, but
`Server.addSocket` and `Client.init` both call `new IoPeer(socket)` without
it, and neither `ServerOptions` nor `ClientOptions` carries such a value
(`peerInitTimeoutMs` covers only `init`/`isReady`). A dropped socket does
not fail a pending request early either: socket.io only fails
acknowledgements flagged `withError`.

## Measured with containers

One client paused with `docker pause`: on the hub a read of a version the
other client holds took 30.0 s (a local hit 3 ms); a miss on any client
took 30.0 s because every client miss fans out through the hub; the HTTP
call hung for the whole time (pull request #38 review,
`docs/findings/hub-transport.md`).

## Impact on us

A single stalled node makes every cross-node read of every node take 30 s.

## Workaround

Reads that cascade are the only ones exposed to it; an application-level
bound around them is planned (a race against a timer per read).

## Suggested fix

Resolve a group as soon as one member returns rows (`Promise.any` over
"has rows", falling back to `allSettled` only for the empty case), and
expose the `IoPeer` timeout through `ServerOptions` and `ClientOptions`.
Failing pending acknowledgements on `disconnect` (socket.io's `withError`
acks, or a local registry) would remove the 30 s wait for a peer that is
already gone.
