# Granularity and deltas: what a rename costs and what could make it cheaper

The owner renamed one animal in production and the network view reported
eight rows in four tables travelling to every other node. This note works
out where those rows come from, measures what they weigh, and compares the
ways to make a small change ship a small payload: inside rljson's model,
outside it, and a middle way that keeps the model and shrinks the wire.

All numbers were measured against the `medium` seed with the
pinned versions (`@rljson/db` 0.0.42, `@rljson/io` 0.0.78, `@rljson/rljson`
0.0.81, `@rljson/hash` 0.0.19, `@rljson/server` 0.0.64) in two ways: two
local nodes of this service (`node-a` on 8471/8472, `node-b` on 8474/8475,
UDP 8473, domain `petshop-deltas-8471`, `SEED_SIZE=medium`, PIDs 49160 and
69340, stopped afterwards) for the transfers as `/status` reports them, and
an in-process `PetShopStore` over `IoMem` for the bytes of every row a
rename writes. Byte counts are `Buffer.byteLength(JSON.stringify(row))`;
"pulled" means the JSON of the `readRows` answer `{ _type, _data: [row],
_hash }` the receiving node gets per row, without socket.io framing (about
70 bytes per request and acknowledgement).

## What a rename produces in this project, and why

`PUT /api/animals/bowser-the-guard-dog` with `{ "name": "Bowser the Retired
Guard Dog" }` writes eight rows (`docs/findings/entity-versions.md`,
`packages/node-service/src/store/petShopStore.ts`, `updateAnimalNow`):

| Row                            | Count | Bytes (row) | Bytes (pulled) | Why it exists                                                                                                                                                        |
| ------------------------------ | ----: | ----------: | -------------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `animals` (the new version)    |     1 |       1 124 |          1 190 | A row is the unit of content addressing; the hash covers every field, so a changed name is a new row with the whole `backgroundStory` (821 of the 1 124 bytes, 73 %) |
| `animalsInsertHistory`         |     1 |         195 |            264 | `previous: ["1767225600073:seed"]` chains the version onto the seed version                                                                                          |
| `animalTraits` (junction rows) |     2 |         299 |            431 | `animalRef` holds the animal's version hash; the new version has a new hash, so every pairing is written again for it                                                |
| `animalTraitsInsertHistory`    |     2 |         410 |            548 | Each pairing (`bowser-the-guard-dog--fiercely-loyal`) is chained onto its previous version                                                                           |
| `changeSets`                   |     1 |         668 |            731 | Names the six rows above by table and hash (`docs/findings/change-sets.md`)                                                                                          |
| `changeSetsInsertHistory`      |     1 |         164 |              - | Written by every node for itself; not pulled                                                                                                                         |
| Total                          |     8 |       2 860 |          3 164 | Plus one 116-byte announcement `{"o","r","c","t"}` and seven `readRows` round trips                                                                                  |

The two live nodes reported exactly this: the receiver's transfer
`update-animal-bowser-the-guard-dog-…` lists
`{"animals":1,"animalsInsertHistory":1,"animalTraits":2,"animalTraitsInsertHistory":2}`,
`durationMs: 5`. The network view counts the change set's items, so an
animal with three traits shows the owner's "8 rows in 4 tables" (1 + 1 +
3 + 3); 17 of the 110 animals of the `medium` seed have three traits, 27
have four. The rows per rename are `2 + 2 × traits` items plus the change
set and its history row.

For `sir-quackington`, the animal with the 7 141-character story and four
traits, the same rename writes twelve rows, 10 326 bytes, of which 10 900
bytes are pulled over the wire (the answers carry a little framing): the
`animals` row alone is 7 504 bytes, 95.2 % of it the story that did not
change; the four junction rows and their histories add 1 418 bytes; the
change set with ten items 1 045. The live transfer took 7 ms.

`TRAIT_RELATION=multi-reference` changes nothing here. The mode decides how
the store _reads_ the relation (`animals.traitsRefs` or the `animalTraits`
table, `docs/findings/n-to-m.md`), but the junction table is created,
seeded and maintained in both modes so that the two representations never
drift, and `updateAnimalNow` writes the junction rows regardless. Measured
in both modes: identical tables, counts and bytes (2 860 and 10 326 bytes).
The comparison that matters is between the two _models_, below.

## Options inside rljson's model

### A star schema: the entity as a tuple of references

rljson already has the pieces: a `ref` column is a hash of a row in
another table, the validator resolves it, `IoMulti` pulls it on a miss. A
`stories` table with `{ id, text }` and a `storyRef` column on `animals`
turns the animal row into a small tuple: 384 bytes pulled instead of
1 190 for Bowser, 428 instead of 7 570 for Sir Quackington; the story row
(965 and 7 296 bytes) is written once and never moves again on a rename.
The same holds for anything large or stable, an image blob id, a long
description of a species.

Measured per rename as pulled bytes, built as real hashed rows:

| Model                                                        | Bowser (2 traits, 821-character story) | Sir Quackington (4 traits, 7 141 characters) |
| ------------------------------------------------------------ | -------------------------------------: | -------------------------------------------: |
| A. As built (story inline, junction rows per version)        |                                  3 159 |                                       10 870 |
| B. `traitsRefs` only, no junction rows                       |                                  1 803 |                                        8 178 |
| C. Story in its own table, junction rows kept                |                                  2 353 |                                        3 728 |
| D. Story in its own table and `traitsRefs` only              |                                    997 |                                        1 036 |
| E. Transport delta for the animal row (section "Middle way") |                                  2 149 |                                        3 479 |
| E on top of D                                                |                                    741 |                                          740 |

The star schema (C) removes the dependence on the story's length: the
rename of the long-story animal drops from 10.9 kB to 3.7 kB. What is
left is the junction rows and the change set, which is where the n-to-m
choice comes in.

### Junction table versus `jsonArray` multi-reference

`docs/findings/n-to-m.md` found the two representations validated
identically and the junction table 4.6 times larger for the same
pairings; its versioning consequence is what the rename shows: a junction
row references a _version_ (`animalRef` is a hash), so a new version of
the animal invalidates every pairing and the store re-creates them as new
versions of the pairing id. The `traitsRefs` array inside the animal row
has no such problem: it is part of the row, so a rename carries it along
for free (the array of two or four 22-character hashes weighs 60 to 110
bytes). Without junction rows (B) the rename is the animal, its history
row and a two-item change set: 1 803 bytes for Bowser, and with the story
moved out (D) 997 bytes, 1 036 for Sir Quackington, the same for every
animal. The junction table earns its keep only when a pairing needs its
own identity or lifecycle (metadata on the pairing, retracting one pairing
without a new animal version, querying "every animal with this trait" at
a scale where scanning `traitsRefs` hurts); none of that is the case here.

A junction row keyed by the entity id instead of the version hash
(`animalRef: 'bowser-the-guard-dog'`) would also survive a rename
untouched, and the store already resolves ids to current versions
everywhere. It would give up the statement "this version of the animal
carried this trait", which `traitsRefs` inside the version keeps anyway.

### Layers and cakes: rljson's native way to split an entity

rljson's `README.architecture.md` (0.0.81, "SliceIds", "Layer", "Cake")
describes the second answer: "For efficient management of large layers,
slice IDs are separated from their components. This allows fetching IDs
first and retrieving details later." A `Layer` "assigns components to
slices"; its type (`dist/content/layer.d.ts`) has `componentsTable`,
`sliceIdsTable`, `sliceIdsTableRow`, `add: Record<SliceId, ComponentRef>`,
an optional `remove`, and `base`, "an optional base layer that is extended
or shrinked by this layer"; `add` "assigns component properties to slice
ids. If base is defined this will add or override assignments of the base
layer." A `Cake` (`dist/content/cake.d.ts`) "is a collection of layers. A
layer is a collection of slices. All layers of a cake refer to the same
slices": `{ sliceIdsTable, sliceIdsRow, layers: { [layerTable]: LayerRef },
id? }`. `Db.join(columnSelection, cakeKey, cakeRef)` reads a cake back as
one dataset, with a fast path for the standard cake, layer, component
shape (`dist/db.d.ts`). Roadmap slice D17 plans exactly this for the
inventory.

The animals as a cake: one `sliceIds` row holds the animal ids (1 426
bytes for the 110 of `medium`, written once); each aspect is a layer over
its own components table, `names` over `animalNames` rows `{ name }`,
`stories` over `animalStories` rows `{ text }`, `prices`, `traits` (a
component `{ traitsRefs: [...] }` per animal), `species`, `breeders`; the
cake row lists the current layer of every aspect. A rename then writes
one component row `{ name: "Bowser the Retired Guard Dog" }` (138 bytes
pulled), one derived `names` layer with `base: <previous layer>` and a
single `add` entry (321 bytes), and one cake row pointing at the new
names layer and the five unchanged layers (428 bytes); with the three
history rows (826) and a six-item change set (745) that is 2 458 bytes,
independent of the story length and of the trait count. The story layer,
its components and the traits layer do not move. The price is a different
read model (a chain of `base` layers to resolve, `Db.join` instead of
`Db.get`), a version DAG per layer table rather than per entity row, and a
cake row that changes on every edit of any aspect; a rename of the
long-story animal is 4.4 times cheaper than as built, a rename of Bowser
1.3 times, and the star schema with `traitsRefs` (D) is cheaper than the
cake for both because it has fewer rows to name.

## Options outside the model

Selective updates of a JSON path, JSON Patch (RFC 6902) documents, or CRDT
operations (Automerge, Yjs, Ditto) would make the rename a 60-byte
message. They would also replace the model rather than extend it:

- Content addressing of rows goes: a row's identity is the hash of its
  full content, and a patch addresses a mutable object by id and path.
  Two nodes that apply the same patch to the same base agree by
  construction, but nothing in the row itself says which version it is.
- Verification by hash goes: in rljson a peer's answer is re-hashed and
  refused if the hash does not match (`docs/findings/change-set-sync.md`).
  A patch can only be checked against the state it produces, which the
  receiver does not have until it applied the patch, and a CRDT merge has
  no single expected state to check against.
- Deduplication by content goes: identical rows written on two nodes hash
  equal and travel once; operation logs are per node and per session.
- DAG-tip conflict detection goes: rljson surfaces two tips and leaves the
  resolution to the application (`Db.detectDagBranch`,
  `docs/findings/entity-versions.md`); a CRDT resolves concurrent edits by
  its merge rule (last writer wins per field, sequence merging for text)
  and never shows a branch. That is the point of a CRDT, and it is a
  different contract with the application.

Those systems are mature and worth using when their contract is the one
wanted; roadmap slice F2 plans a comparison fork on one of them. They are
not an evolution of rljson, because everything above is what rljson is.

## The middle way: version deltas on the wire

The rows can stay whole and immutable while the transport stops repeating
what the receiver already holds. A new version of a row is announced by
its hash, as `Connector` does; when the receiver pulls it and holds a base it can name
(the previous version, found through the history row's `previous`, which
the change set delivers alongside), it asks for the row relative to that
base, the sender answers `{ base: <hash>, patch: { name: "Bowser the
Retired Guard Dog" } }`, the receiver applies the patch to its copy of the
base, runs `hsh` and compares the result with the hash it asked for. That
is the same check `IoMulti` runs on a full row; a wrong or malicious
patch fails it in the same way and is never written. The model is intact:
the stored row is the full row with its content hash, history rows and
change sets are unchanged, deduplication and conflict detection see
nothing different. Only the bytes between two nodes shrink.

Measured against the rows above, a delta of the animal row is 180 bytes
pulled (base hash, one field, the target hash) instead of 1 190 for Bowser
(85 % less) and 7 570 for Sir Quackington (98 % less). For the whole
rename as built that is 3 159 to 2 149 bytes (32 %) and 10 870 to 3 479
bytes (68 %); the remaining bytes are junction rows and history rows,
which at 215 to 275 bytes pulled each weigh about what a delta with its
two hashes and one changed field would, so deltas pay off for rows above
a few hundred bytes and change nothing below.
On top of the star schema (D) a delta saves another 250 bytes (997 to
741), which says that model changes come first and deltas second.

Where it would live, without touching `Db`:

- `IoPeer.readRows` and `IoServer`: an optional `basis: { [table]: Ref[] }`
  (or a `deltaFrom` per `_hash` lookup) in the request; the answer is
  either the row or `{ _delta: { base, patch } }` when the server holds the
  base too. `IoMulti.readRows` reconstructs before its `hip` write-back,
  so every layer above sees a full row. A server that does not know the
  base, or a receiver that lacks it (a node catching up after an outage),
  falls back to the full row, so the change is compatible.
- The patch format can be a flat map of changed top-level fields plus a
  list of removed keys; RFC 6902 would cover nested changes (an element of
  `traitsRefs`) at the cost of a dependency. Rows are flat JSON in this
  project, so the flat map is enough here.
- The `Connector` payload is the wrong place: the announcement carries a
  reference on purpose, and an inline patch there would bypass the read
  cascade and its cache (`docs/findings/hub-transport.md`), while the base
  is only known after the history row arrived.

## Recommendations

For rljson:

1. Version deltas in the read path as sketched above, opt-in per request,
   full row as the fallback, verification by the target hash unchanged.
   It keeps every property of the model and removes the one cost that
   grows with row size.
2. First-class guidance that an entity is a tuple of references: document
   the star schema (large or stable fields in their own tables, `ref`
   columns, the validator already covers it) as the default shape for
   versioned entities, and say plainly that a `ref` to a version hash
   invalidates on every new version while a `ref` to a stable row does
   not.
3. Cakes documentation beyond the bakery example: how an entity is split
   into layers, what one edit writes (component, derived layer, cake),
   how `Db.join` reads it back, and how InsertHistory and
   `detectDagBranch` apply per layer table; the types are there, the
   guidance is not.

For this project:

1. Move `backgroundStory` into its own table with a `storyRef` on
   `animals` (a rename of the long-story animal drops from 10.9 kB to
   3.7 kB, an edit of the story costs the story row once), or model it as
   a layer under roadmap slice D17; the species image follows the same
   pattern with its blob id.
2. Stop re-creating junction rows per animal version: keep `traitsRefs` as
   the relation (997 bytes per rename with the story moved out, the same
   for every animal) and drop the `animalTraits` table, or key it by the
   entity id if a pairing ever needs its own lifecycle. The n-to-m
   finding already put the junction table on the "only when needed" side.
3. Keep whole-row hashing and the change set as the unit of transfer;
   carry the delta idea upstream rather than into the store.
