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
  image algorithm) is served the freshly rendered image with a warning; the
  route stays `200` rather than answering `404` for a species that exists.
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
