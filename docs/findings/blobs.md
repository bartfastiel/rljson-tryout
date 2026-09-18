# Species images as blobs in `@rljson/bs`

## What we tried

- `@rljson/bs` 0.0.26 (`BsMem`), `@rljson/hash` 0.0.19, Node 24.18.0,
  while building slice B12 on the Windows development machine. Read
  `dist/bs.d.ts`, `dist/bs-mem.d.ts`, the bundled `dist/bs.js` and
  `README.architecture.md` of the package, and `hash-buffer.ts` of
  `@rljson/hash`, which `BsMem.setBlob` computes its ids with.
- Wrote a PNG encoder in the domain package
  (`packages/domain/src/images/png.ts`: signature, `IHDR`, one `IDAT`,
  `IEND`, CRC-32 and deflate from `node:zlib`) over a small rasterizer
  (`raster.ts`: anti-aliased circles, ellipses and triangles blended
  "source over" into an RGBA buffer) and a motif per species
  (`speciesImage.ts`: a round badge with a creature face whose palette,
  ears, snout and proportions are drawn from the species id through the
  seed generator's `mulberry32` source). Rendered the three hand-written
  and the fifty pool species, measured sizes and timings, and looked at
  the results on the phone and desktop views in light and dark mode.
- Gave the species table the columns `imageBlobId` and `imageMimeType`
  (roadmap section 2.6), filled by the seed from the species id alone, and
  let `PetShopStore` store every seeded species image in the `BsMem` that
  `main.ts` creates and also hands to the hub transport. Served the bytes
  as `GET /api/species/:hash/image` and tested the store over `IoMem` and
  SQLite: the same image stored twice, a second `seedIfEmpty`, a blob
  deleted behind the store's back, and a SQLite store reopened with an
  empty `BsMem`.

## What happened

What `BsMem` does (`@rljson/bs` 0.0.26):

- `setBlob(content)` takes a `Buffer`, a string or a web `ReadableStream`,
  computes the id as `hshBuffer(buffer)` from `@rljson/hash` and stores the
  buffer under it. `hshBuffer` is SHA-256 in base64url cut to the same 22
  characters every row `_hash` has (`HashConfig.hashLength`), so a blob
  id and a row hash are indistinguishable by shape: the duck image is
  `cZUR_CtM1HRbZkdIwhsEH9`, and
  `createHash('sha256').update(bytes).digest('base64url').slice(0, 22)`
  gives the same string. That is what lets the seed write `imageBlobId`
  into a species row before any blob store has seen the image: the id is
  a pure function of the bytes, and the bytes are a pure function of the
  species id.
- A second `setBlob` with the same content stores nothing and returns the
  very `BlobProperties` object of the first call (`===`), `createdAt`
  included; `size` stays at one blob. `BlobProperties` is `{ blobId, size,
createdAt }` and nothing else: the media type lives in the species row
  (`imageMimeType`), as the package's README says it should ("metadata is
  external").
- `getBlob`, `getBlobProperties`, `getBlobStream` and `deleteBlob` throw
  `Error('Blob not found: <id>')` for an unknown id; `blobExists` is the
  check that does not throw. `getBlob` takes an optional byte `range`.
  `listBlobs` returns the properties sorted by id with `prefix`,
  `maxResults` and a `continuationToken` that is the last id of the page.
  `generateSignedUrl` on `BsMem` returns `mem://<id>?expires=<ms>&permissions=read`,
  a string nothing can resolve. The `Bs` interface has no count; `size`
  and `clear()` are extras of `BsMem`.

The images:

- 256 by 256 pixels, 8-bit RGBA, transparent outside the badge so that the
  card surface shows through in both colour schemes. 53 species render in
  103 ms (1.9 ms each), the PNGs are 8.6 to 12.7 kB (median 10.8 kB,
  569 kB for all 53). The seed measures `small` 10 ms, `medium` 77 ms and
  `large` 1.0 s into `IoMem` with the images included, no measurable
  change against `docs/findings/seed-generator.md`; the hand-written
  seed renders its three images once at import time of the domain package.
- The bytes had to be the same on every node, because the blob id sits in
  the species row and the row hash sits in every animal, junction row and
  invoice item that references the species: a node that rendered one pixel
  differently would seed different rows and, after slice D3, hold a second
  tip for every seed entity. Two things threatened that. Node's zlib is
  Chromium's fork, whose default match finder picks its hash function by
  CPU feature (SSE4.2, ARMv8 CRC), so the default deflate strategy is not
  guaranteed to produce the same bytes on two machines; the encoder
  therefore compresses with `Z_RLE`, which only ever matches a byte against
  the byte before it and uses no hash table, over PNG filter `Sub`, which
  turns flat areas into runs of zero bytes. And `Math.hypot`, `Math.pow`
  and the trigonometric functions are not correctly rounded by
  specification, so the rasterizer uses additions, multiplications and
  `Math.sqrt` alone, which IEEE 754 fixes to the bit. What remains is the
  deflate block layout of the zlib version Node bundles (block flushing
  moved between zlib 1.2.11 and 1.2.12); the golden blob ids in
  `speciesImage.test.ts` and the golden row hashes of the seeds pin the
  current bytes, so a Node upgrade that changes them fails the tests and
  is a deliberate seed change.
- `Z_RLE` costs size: the duck image is 9.3 kB with it, 7.9 kB with the
  default strategy and 7.3 kB at level 9, and the edge pixels of the
  anti-aliasing are what fills the kilobytes, since every one of them is a
  literal byte. A flat 256 by 256 image compresses to under 2 kB.

The store:

- `seedIfEmpty` stores one blob per seeded species, `setBlob` twice gives
  one blob under one id, and a second `seedIfEmpty` stores nothing because
  the tables are not empty (both stores). `speciesImage(hash)` reads the
  species row by hash from the local store, then the blob by the row's
  `imageBlobId`.
- A `sqlite` node keeps its species rows across a restart but its `BsMem`
  starts empty, so until slice C2 puts the blobs on disk the store renders
  a missing image again from the species id and stores it: the same bytes
  land under the same id, and the row's `imageBlobId` is true again. The
  test reopens a seeded SQLite file with a fresh `BsMem`, finds zero blobs,
  serves the duck image, and finds one. A row whose `imageBlobId` is not
  what the renderer produces (a species written by a node with another
  image algorithm) was served the freshly rendered image with a warning
  in this slice; since slice D5 such a row is an uploaded image, which is
  pulled from the network and, when no node holds it, answered with `404`
  and the reason (below).
- `GET /api/species/:hash/image` answers `image/png` with
  `Cache-Control: public, max-age=31536000, immutable`: the path names the
  species version by its hash, the version names the image by its content,
  so the bytes behind a path never change. The species list carries
  `imageUrl`, the animal list and detail `speciesImageUrl`, so the app
  never builds the path itself.

Deployment: the seed changed (every species row and everything that
references it hashes differently), and the persistent production nodes
keep their old rows. Until a migration story exists, a seed change means
recreated volumes: the conductor runs `Down` and `Up` after the merge so
that every node reseeds, the same remedy `docs/findings/change-set-sync.md`
describes for the pre-D3 seed.

## What it means for rljson users

- A blob id is `hshBuffer(bytes)`: compute it yourself when a row must
  name a blob before the blob store exists, and do not confuse it with a
  full SHA-256 hex digest; it is the same 22-character base64url prefix as
  a row hash.
- Deduplication is free and silent: `setBlob` of known content is a no-op
  that returns the first store's properties. Reference counting is your
  job before `deleteBlob`.
- `getBlob` throws for a missing id; ask `blobExists` first when a missing
  blob is a state you handle rather than a bug.
- Content-addressed images make immutable caching correct by construction:
  put the content hash into the URL and let the browser keep the bytes for
  a year.
- Anything that derives a blob id deterministically on more than one
  machine must make the bytes deterministic: avoid zlib's default match
  finder and the transcendental `Math` functions, and pin the bytes with a
  golden test.

## Candidates for upstream issues

- `BsMem.generateSignedUrl` returns a `mem://` URL that nothing can open;
  throwing "not supported" would be more honest than a string that looks
  usable. Reproduction: `await new BsMem().generateSignedUrl(id, 60)` after
  one `setBlob`.
- The `Bs` documentation calls the id "SHA256 hash of the blob content"
  while `hshBuffer` truncates it to 22 base64url characters; a sentence on
  the exact form would save a round trip through `@rljson/hash`.
  Reproduction: `(await new BsMem().setBlob(Buffer.from('hello'))).blobId`
  is `LPJNul-wow4m6Dsqxbninh`, 22 characters.
- `Bs` offers no way to ask "how many blobs" or "is it empty" without
  listing them; `BsMem.size` exists but is not on the interface.

## Slice D5: blob synchronisation

### What we tried

- `@rljson/bs` 0.0.26 (`BsMulti`, `BsPeer`, `BsPeerBridge`, `BsServer`)
  as `@rljson/server` 0.0.64 wires them, socket.io 4.8.3, Node 24.18.0.
  Read `BsMulti.getBlob`, `blobExists` and `readables` in the bundled
  `dist/bs.js`, `BsPeer` (its `_withTimeout`, `isOpen`, the event names),
  `BsPeerBridge._registerBsMethods`, `BsServer._generateTransportLayerCRUD`,
  and in `server.js` `Client._setupBs`, `Server._queueBsPeer`,
  `_rebuildMultis` and `_refreshServers`.
- Ran a throwaway script with a `Server` over a `BsMem` behind real
  socket.io and two `Client`s with a `BsMem` each: stored a blob on one
  client and read it through the other client's `client.bs`, through the
  hub's `server.bs`, and through the bare `client.peerStores.bs`; asked
  every one of them for an id no node holds; watched which stores held
  the blob afterwards.
- Added an upload (`POST /api/species/:id/image`, raw bytes with the
  media type, checked by the first bytes, one mebibyte at most) that
  writes a new species version with a change set, so that a blob exists
  on one node only (the seed images are deterministic and every node
  renders them itself); let the hub transport hand the store the
  `BsMulti` of its role (`fetchBlobsThrough`, next to `readThrough` and
  `pullThrough`); made the `SyncAgent` pull every blob a received row
  names (`blobReferencesOf`, today `species.imageBlobId`) after the rows
  and list it on the transfer; and made `GET /api/species/:hash/image`
  fall through to the network, then to the renderer for a seed species
  only. Tested it with a fake `Bs` (`petShopStore.images.test.ts`), a
  fake store (`syncAgent.test.ts`), real sockets (`hubTransport.test.ts`,
  `syncAgent.transport.test.ts`), the Gherkin feature
  `features/blob-sync.feature` in-process over both stores and against
  the three containers, and by hand on Compose (host ports 8521 to 8523).

### What happened

What the library wires (`@rljson/server` 0.0.64 over `@rljson/bs` 0.0.26):

- A `Client` builds `client.bs` as a `BsMulti` over `[local (priority 1,
read and write), BsPeer to the hub (2, read only)]` and starts a
  `BsPeerBridge` over its local `Bs` on the same socket, which is how
  the hub reads the client's blobs. A `Server` builds `server.bs` as a
  `BsMulti` over `[local (1, read and write), BsPeer per client (2, read
only)]`, rebuilt on every join and leave like `server.io`, and serves
  it through a `BsServer` to every client. The same one socket carries
  the `Io` and the `Bs` events (`getBlob`, `blobExists`, ...); nothing
  distinguishes them but the event name.
- `BsPeerBridge` (the client's side, over its own store) registers the
  read methods only: `getBlob`, `getBlobStream`, `blobExists`,
  `getBlobProperties`, `listBlobs`. `BsServer` (the hub's side, over the
  hub's multi) registers all eight, `setBlob` and `deleteBlob` included:
  a client can write a blob into the hub's local store and delete one
  from it over the wire, the same asymmetry `docs/findings/hub-transport.md`
  records for `IoServer`, one step less open on the client side.
- `BsMulti.getBlob` walks the readables one after the other in priority
  order (not in parallel like `IoMulti.readRows` does within a group),
  takes the first that answers, and then writes the content into every
  writable member that did not answer ("hot-swap"), which is the local
  store, before it returns. So the write-back the roadmap hoped for
  exists at every hop: a blob read on client B that only client A holds
  went A's bridge, hub's multi (cached in the hub's `BsMem`), B's multi
  (cached in B's `BsMem`); reading through the bare `client.peerStores.bs`
  instead caches on the hub but not locally, since a `BsPeer` alone has
  no writable layer. `blobExists` walks the same way and answers `true`
  from the first member that has the blob, `false` when none has, without
  writing anything. Measured in-process over real sockets: `blobExists`
  through the multi 1.4 ms, `getBlob` of a 30 byte blob two hops away
  1.1 ms, a 10.6 kB blob on Compose 9 to 12 ms for the whole change set
  pull (row, history row, blob).
- The content survives the wire as a `Buffer` (socket.io carries binary
  attachments), `properties.createdAt` comes back as an ISO string. A
  `setBlob` on the receiving side files it under `hshBuffer(content)`
  again, so the id is recomputed on every node the blob passes through
  and never taken from the sender.
- A miss is where it breaks: `BsMem.getBlob` throws
  `Error('Blob not found: <id>')`, `BsServer` and `BsPeerBridge` pass
  that `Error` object into the socket.io acknowledgement as it is, and
  socket.io serialises an `Error` as `{}`. `BsPeer.getBlob` therefore
  rejects with a plain `{}`, and `BsMulti.getBlob` runs
  `err.message.includes('Blob not found')` over it, which throws
  `TypeError: Cannot read properties of undefined (reading 'includes')`.
  So `client.bs.getBlob(unknownId)` and `server.bs.getBlob(unknownId)`
  both fail with a `TypeError` from inside the multi, and
  `peerStores.bs.getBlob(unknownId)` with `{}`; none of them says "not
  found". `blobExists` is unaffected (a boolean serialises). This
  project asks the multi `blobExists` first and calls `getBlob` only for
  an id some node has, and wraps whatever the multi throws into `the
network could not serve blob <id>: <message>`.
- `BsPeer` gives every request 30 s (`requestTimeoutMs` in its options,
  which `Server` and `Client` do not pass through, like `IoPeer`), and a
  request on a socket it knows to be closed fails at once. `BsMulti`
  skips a peer whose `isOpen` is `false` and throws `All readable Bs
instances are closed` when every member is. A hub with a frozen client
  waits the full 30 s on that client's `blobExists` before it asks the
  next one, since the walk is sequential, so every blob read on the
  network can stall behind one slow node; the `SyncAgent` bounds a blob
  by the change set's remaining deadline (15 s) and the image endpoint
  by `blobPullTimeoutMs` (10 s), abandoning the read like a row pull.

What this project does with it:

- The store pulls a blob it lacks through the multi of the current role
  (`PetShopStore.pullBlob`): local first, `blobExists` on the multi,
  `getBlob` on the multi, then `blobIdOf(content)` against the id asked
  for. A mismatch is refused (`BlobMismatchError`) and can never land
  under the requested id, because a content-addressed `setBlob` files
  the bytes under their own hash, so the worst a lying node achieves is
  an unreferenced blob in the stores it passed through. The hot-swap
  has already cached a good blob locally by the time the check runs; the
  store's own `setBlob` afterwards is the safety net for a multi that
  did not write back and a no-op otherwise.
- The `SyncAgent` pulls the blobs of a change set after its rows were
  written in one `Io.write` and its dependencies were pulled, within the
  same deadline, and records `blobs: [{ blobId, bytes }]` on the
  transfer (`/status.sync.transfers`, `GET /api/sync/transfers`, the
  `sync` event; absent when the pull fetched none); the web app's
  transfer popup shows it as "blob 10.6 kB". A blob that no node holds,
  that comes back wrong or that does not arrive in time is logged and
  left out: the change set counts as received (the version is current
  with its `imageBlobId`), and `GET /api/species/:hash/image` asks the
  network again the moment the image is wanted, caching it then. A node
  that holds the version but gets the blob from nowhere answers `404`
  with the blob id and the reason instead of a `500`, and only a seed
  species (a row whose `imageBlobId` equals `speciesImageBlobId(id)`) is
  rendered again from its id; an uploaded image cannot be.
- An upload on a client, seen on Compose (node3 hub, node1 and node2
  clients, `IoMem` everywhere): `POST` of the 10 566 byte PNG answered
  in 17 ms with the new version; the hub pulled the change set with the
  blob in 9 ms and the other client in 12 ms, both serving the same
  bytes (`sha256sum` equal on all three) at the new version's URL, both
  transfer rows naming the blob and its size. A memory node restarted
  afterwards reseeded, joined, and its catch-up pulled the one missing
  change set with the blob in 12 ms. A second upload of the same bytes
  answered the current version unchanged in 17 ms and wrote nothing:
  the same image twice makes no second version. The refusals answer
  `415` for another media type or bytes that are not the declared image
  (checked by the PNG signature or the JPEG start-of-image marker, so
  an HTML page declared `image/png` is refused), `413` from Fastify's
  own body limit for more than a mebibyte, `404` for an unknown species.
- Animals keep referencing the species version they were written with,
  so an animal card shows the badge of the old duck version after the
  duck got a photo, until the animal is edited; the species card shows
  the photo. That is the version rule of roadmap section 2.6 at work,
  not a gap in the blob transfer.

### What it means for rljson users

- Use the multi (`client.bs`, `server.bs`) for reads you want cached:
  `BsMulti.getBlob` writes a hit into the local layer at every hop, so a
  blob read once on a client sits on the hub and the client afterwards.
  A bare `BsPeer` caches on the far side only.
- Ask `blobExists` before `getBlob` when a miss is possible: a not-found
  from the other side of a socket arrives as `{}` and makes
  `BsMulti.getBlob` throw a `TypeError` rather than "Blob not found".
- Check the id yourself when the bytes matter: a `BsPeer` hands you
  whatever the other node sent, and only the local `setBlob` recomputes
  the hash. A content-addressed store makes a wrong blob inert, not
  absent.
- Expect one slow node to stall every blob read that misses locally:
  the multi asks its peers one after the other with 30 s each. Bound
  the wait in your own code; the library offers no option through
  `Server` or `Client`.
- The hub's `BsServer` accepts `setBlob` and `deleteBlob` from any
  connected client; treat the hub port as trusted-network-only for blobs
  as for rows.

### Candidates for upstream issues

- `BsServer` and `BsPeerBridge` put the `Error` object into the socket.io
  acknowledgement, which arrives as `{}`; `BsMulti.getBlob`,
  `getBlobStream`, `getBlobProperties` and `generateSignedUrl` then
  crash on `err.message.includes(...)` with a `TypeError` for any miss
  that went through a peer. Reproduction: a `Server` with an empty
  `BsMem`, a `Client` over socket.io, `await client.bs.getBlob('nope')`;
  expected `Blob not found: nope`, observed `Cannot read properties of
undefined (reading 'includes')`. Serialising `{ message }` (as `IoServer`
  does for `Io` errors) would fix both ends.
- `BsPeer`'s `requestTimeoutMs` exists but `Server` and `Client` build
  their peers with `new BsPeer(socket)` and offer no way to set it, the
  same gap as `IoPeer`. Reproduction: `docker pause` one client and read
  a blob the hub lacks on the hub; the read returns after 30 s.
- `BsMulti.getBlob` and `blobExists` walk the readables sequentially,
  so with several peers at the same priority the slowest one delays the
  ones behind it; `IoMulti` asks a priority group in parallel.
  Reproduction: two `BsPeer`s at priority 2, the first one paused, the
  blob on the second; `getBlob` takes the first peer's full timeout.
- `BsServer` exposes `setBlob` and `deleteBlob` to every socket while
  `BsPeerBridge` exposes reads only; the asymmetry is undocumented and
  lets any client write into and delete from the hub's blob store.
  Reproduction: from a client, `socket.emit('deleteBlob', id, cb)`
  removes the blob from the hub's local `Bs`.
