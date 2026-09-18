# `Connector.listen` hands its callback the reference but not the payload's client identity, timestamp or origin

- Package: `@rljson/db` 0.0.42 (`Connector.listen`, `_processIncoming`),
  `@rljson/rljson` 0.0.81 (`ConnectorPayload`)
- Environment: Node 24.18.0, Windows 11 Pro (10.0.26200)
- Severity: API gap (a receiver cannot say who announced a reference)

## Reproduction

```js
import { Connector, Db } from '@rljson/db';
import { IoMem, createSocketPair } from '@rljson/io';
import { Route } from '@rljson/rljson';

const route = Route.fromFlat('changeSets');
const io = new IoMem();
await io.init();
const db = new Db(io);
const [senderSocket, receiverSocket] = createSocketPair();
senderSocket.connect();
receiverSocket.connect();

receiverSocket.on('/changeSets', (payload) =>
  console.log('raw socket payload:   ', JSON.stringify(payload)),
);
const receiver = new Connector(
  db,
  route,
  receiverSocket,
  { includeClientIdentity: true },
  'receiver-node',
);
receiver.listen(async (ref, predecessorRefs, info) => {
  console.log(
    'listen callback got:  ',
    JSON.stringify({ ref, predecessorRefs, info }),
  );
});
const sender = new Connector(
  db,
  route,
  senderSocket,
  { includeClientIdentity: true },
  'node-a1b2c3',
);
sender.send('SNrqQdgrwo4dB-Ji-O8uR8');
await new Promise((resolve) => setTimeout(resolve, 50));
sender.tearDown();
receiver.tearDown();
```

## Expected

`info` (or a further argument) carries the payload fields the protocol
already transports: `c` (client identity), `t` (sender time), `o`
(origin), `seq` when causal ordering is on.

## Actual

```text
raw socket payload:    {"o":"1789708927857:IcZS","r":"SNrqQdgrwo4dB-Ji-O8uR8","c":"node-a1b2c3","t":1789708927857}
listen callback got:   {"ref":"SNrqQdgrwo4dB-Ji-O8uR8","info":{"isNewestFromSender":true}}
```

The identity is on the wire (and the hub forwards it, plus `__origin`),
but the callback gets `ref`, optional `predecessorRefs` and
`{ isNewestFromSender }` only. Related observations from the same code:

- `ConnectorPayload.cksum` is declared ("content checksum for ACK
  verification") and neither set by `Connector.send` nor read by `Server`
  (grep of `db/dist/db.js` and `server/dist/server.js` finds no use).
- The hub's bootstrap message carries `c: <the hub's announce id>`, not a
  node identity, so a reference that arrives that way reads as coming
  "from the hub" even when a client produced it.
- A reference forwarded by the hub between `Server.addSocket` resolving
  and the client's `Client.init()` creating its `Connector` is lost; the
  library's own bootstrap repeats after 1, 3 and 6 s for that reason.
  Observed, not isolated in a script.

## Impact on us

`/status.sync.transfers` shows which node a change set came from. To get
that, a second listener is registered on the same socket before the
`Connector` exists and records `r -> c` for every payload, relying on
listener registration order (`AnnouncementOrigins` in
`packages/node-service/src/network/announcementChannel.ts`).

## Workaround

A raw socket listener registered before the connector.

## Suggested fix

Pass the payload (or `c`, `t`, `o`, `seq`) in `RefArrivalInfo`; either
implement `cksum` or remove it from the type; let the bootstrap carry the
producer's identity.
