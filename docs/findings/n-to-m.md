# n-to-m relations: multi-reference versus junction table

## What we tried

- `@rljson/rljson` 0.0.81, `@rljson/db` 0.0.42, `@rljson/hash` 0.0.19, Node
  24.18.0, while building slice B6. Compared the two ways this project
  already models "an animal carries zero or more traits": the `jsonArray`
  multi-reference `animals.traitsRefs` (slice B5) and the junction table
  `animalTraits` (`_hash`, `id`, `animalRef`, `traitRef`, one row per
  animal-trait pairing, `id` the deterministic `<animalId>--<traitId>`) this
  slice adds.
- Put both behind one interface, `TraitRelation`
  (`packages/node-service/src/store/traitRelation.ts`), with
  `traitIdsOfAnimal(animalHash)` and `animalHashesWithTrait(traitHash)`:
  `MultiReferenceTraitRelation` reads `animals.traitsRefs`,
  `JunctionTraitRelation` reads `animalTraits`. `PetShopStore` builds
  whichever the configuration variable `TRAIT_RELATION` (`multi-reference`,
  the default, or `junction`) selects and uses it for both the `?trait=<id>`
  filter of `GET /api/animals` and the `traits` list of `GET
/api/animals/:id`; the table `animalTraits` is created and seeded in both
  modes regardless, derived from `animalsSeed.traitsRefs` at module load
  (`packages/domain/src/seed/animalTraits.ts`), so the two representations
  never drift apart.
- Ran both `PetShopStore.listAnimals({ traitId })` and
  `PetShopStore.getAnimal(id)` against two independently seeded stores, one
  per mode, for every seeded trait and every seeded animal
  (`packages/node-service/src/store/petShopStore.test.ts`, "trait relation
  modes agree") and against a Gherkin scenario outline running the same
  filter scenario through both modes
  (`packages/node-service/features/traits.feature`, "The trait filter
  answers identically in both trait relation modes"). Manually started the
  service on port 8261 once with the default configuration and once with
  `TRAIT_RELATION=junction` and compared `curl -s
"http://127.0.0.1:8261/api/animals?trait=competitive-streak"` between the
  two runs.
- Measured payload size with a throwaway script against the seed data:
  `Buffer.byteLength(JSON.stringify(...), 'utf-8')` on `animalsSeed` as
  stored (with `traitsRefs`), on `animalsSeed` with `traitsRefs` stripped,
  and on `animalTraitsSeed`.

## What happened

### Query shape

- `MultiReferenceTraitRelation` needs nothing beyond `animals` itself:
  `traitsRefs` already carries every animal's trait hashes, so
  `PetShopStore.readAnimalTables` performs three `Db.get` calls in this mode
  (`animals`, `species`, `traits`) for both `listAnimals` and `getAnimal`,
  exactly as slice B5 left them.
- `JunctionTraitRelation` needs `animalTraits` in addition, since the
  relation is not on `animals` at all in this mode: `readAnimalTables`
  performs a fourth `Db.get` call (`animalTraits`) alongside the same three.
  The extra call is unconditional per request, not per animal or per trait:
  both `listAnimals` and `getAnimal` still read every table once in full and
  join in JavaScript, the same fallback pattern established in slice B3 for
  the reasons documented in `docs/findings/db-basics.md` ("Joining a
  reference", "Filtering by id").
- A route join such as `Route.fromFlat('animalTraits/animals')` or
  `Route.fromFlat('animalTraits/traits')` could in theory resolve one side
  of the junction table's references in a single `Db.get` call, the same way
  `Route.fromFlat('animals/species')` resolves `speciesRef`. It is not used
  here, for the same reason `listAnimals` does not use `animals/species`
  either (`docs/findings/db-basics.md`, "Joining a reference"): the
  unhashed route join silently drops a row whose reference does not resolve
  instead of surfacing it, and `traitIdsOfAnimal`/`animalHashesWithTrait`
  need every row, including one with a dangling reference, since a missing
  trait or animal must be left out of the _result_, not out of the _join
  input_, to match the tolerance `PetShopStore` already has for a dangling
  `speciesRef`. A route join also does not help the multi-valued direction
  at all: `animalHashesWithTrait` needs every `animalTraits` row for one
  trait hash, which is a `where`-style filter, not a reference walk, and
  `docs/findings/db-basics.md` ("Filtering by id") already documents that
  `db.get` with a `where` clause is unreliable once a table has a reference
  column such as `animalTraits.animalRef` and `animalTraits.traitRef`
  both are.
- Net result: `multi-reference` costs one `Db.get` call less per request in
  this store's read pattern (three against four), at the cost of one
  reference indirection during validation (see below) and of every animal
  row carrying its own trait list.

### Payload size

Measured against the ten seeded animals and their nineteen `animalTraits`
rows (`packages/domain/src/seed/animals.ts`, `animalTraits.ts`):

| Payload                                                     |  Bytes |
| ----------------------------------------------------------- | -----: |
| `animals` table as stored today (with `traitsRefs`)         | 16 836 |
| `animals` table with `traitsRefs` stripped                  | 16 211 |
| `traitsRefs` column alone (the difference of the two above) |    625 |
| `animalTraits` table (19 rows)                              |  2 890 |
| `animals` (without `traitsRefs`) + `animalTraits`           | 19 101 |

The junction table costs about 2 265 bytes more than the multi-reference
column for the same 19 pairings (2 890 versus 625 bytes), roughly 4.6 times
as much: each `animalTraits` row repeats its own `_hash` (22 characters),
`id` (the `<animalId>--<traitId>` slug, 20 to 45 characters here) and the
full `animalRef` hash (22 characters) that a `traitsRefs` entry does not
need to repeat, since it already lives inside the one animal row it belongs
to. A `traitsRefs` entry is 22 bytes of JSON overhead (one hash string in an
array) versus roughly 152 bytes per `animalTraits` row on average in this
seed (`_hash`, `id`, `animalRef`, `traitRef`, JSON punctuation). The gap
narrows as more distinct animal-trait pairings accumulate per animal
version, because `animalRef` is the one field the junction table pays for
per pairing that the multi-reference column does not (`animals.speciesRef`
by comparison is paid for once per animal row regardless of pairing count),
but the junction table never becomes cheaper for this schema: an
`animalTraits` row's four fields structurally cannot compress below a
`traitsRefs` array's one hash string.

### Validation

- Both `speciesRef`-style single references and the `jsonArray`
  multi-reference `traitsRefs` are already validated the same way by
  `BaseValidator._refsNotFound` (`docs/findings/db-basics.md`,
  "Multi-references"): it resolves every element of an array-valued `ref`
  column against the target table exactly like a single-valued one, wrapping
  a non-array value in a one-element array first. `animalTraits.animalRef`
  and `animalTraits.traitRef` are both single-valued `string` columns with a
  `ref`, so they go through the ordinary single-valued path of the same
  check; no new validator code was needed for either representation,
  confirmed by `packages/domain/src/seed/animalTraits.test.ts` ("is
  rejected by the validator when an animalRef is dangling" and "... when a
  traitRef is dangling").
- The element types checked differ in practice, though not in mechanism. A
  dangling `traitsRefs` entry breaks one element inside one `animals` row;
  a dangling `animalTraits.traitRef` breaks one whole row of a separate
  table. Both are reported through the same `refsNotFound.missingRefs`
  shape, but a caller distinguishing "this animal has one bad trait
  reference" from "this pairing row is entirely bad" gets that distinction
  for free from the junction table (one broken row, trivially droppable)
  and has to filter inside `traitsRefs` for the multi-reference column
  (which `PetShopStore`'s `TraitRelation.traitIdsOfAnimal` already does by
  dropping any hash that does not resolve to a stored trait, the same
  tolerance the store has for a dangling `speciesRef`).
- The junction table adds one validation dimension the multi-reference
  column does not have: `id` uniqueness. `BaseValidator` does not check
  head-table `id` uniqueness for either table (`docs/findings/db-basics.md`,
  "Candidates for upstream issues" lists the related gap for a non-null
  `id`), so nothing in rljson stops two `animalTraits` rows from sharing an
  `id`; this project relies on the derivation
  (`<animalId>--<traitId>`, one row per array entry) to keep ids unique
  rather than on a validator (`packages/domain/src/seed/animalTraits.test.ts`,
  "has unique row ids").
- Neither representation can express "an animal carries this trait exactly
  once" as a schema constraint: a `traitsRefs` array can repeat a hash, and
  nothing stops two `animalTraits` rows from carrying the same
  `(animalRef, traitRef)` pair with different `id`s. Both would need an
  application-level check, same as slice B5 found for `traitsRefs`.

### Versioning consequences

- `animalRef` and `traitRef` hold a `_hash`, the identity of one _version_ of
  an animal or a trait, exactly like `speciesRef` and the elements of
  `traitsRefs` already do (roadmap section 2.6: "References are `<table>Ref`
  columns holding a `_hash` of the referenced version"). This has a
  consequence for the junction table that the multi-reference column does
  not have to the same degree: `animals.traitsRefs` lives _inside_ the
  animal row, so a new animal version (slice B9's `PUT /api/animals/:id`)
  naturally carries a fresh `traitsRefs` array as part of that same new row,
  written in the same `Db.insert` call. `animalTraits` rows live _outside_
  the animal row, keyed to a specific `animalRef` hash; a new animal version
  has a new `_hash`, so every `animalTraits` row the previous version had
  becomes stale (it still points at a hash that is a real, readable row,
  just no longer the _current_ one) and slice B9 will have to insert fresh
  `animalTraits` rows for the new version explicitly, alongside the new
  `animals` row, or the new version's trait list silently reads as empty
  through `JunctionTraitRelation`.
- The same applies in the other direction: if a trait itself gained a new
  version (nothing in this project edits a trait today, but the schema does
  not prevent it), every `animalTraits` row referencing the old `traitRef`
  hash would need a counterpart referencing the new one, again as an
  explicit write; `traitsRefs` has no equivalent problem, because it holds
  whichever trait hash was current when that animal row was written and
  simply keeps pointing at it.
- Net effect for slice B9 and the D-slices: `multi-reference` ties the
  n-to-m relation's lifecycle to the owning row's lifecycle for free;
  `junction` decouples the relation from either side's lifecycle (its own
  rows can be added, superseded or reasoned about independently, which is
  useful once conflicts and merges enter the picture in slice D11 and later)
  but pushes the bookkeeping of "which junction rows belong to the current
  version of each side" onto the application.

## What it means for rljson users

- A `jsonArray` multi-reference and a junction table are validated
  identically by `BaseValidator`; choosing between them is a data-shape and
  query-shape decision, not a validation-safety one.
- The multi-reference column is the cheaper default for a relation that is
  always read together with its owning row (this project's trait filter
  reads `animals` regardless of mode) and that changes together with it:
  fewer `Db.get` calls, smaller payload, and versioning is free because the
  relation is part of the row.
- A junction table earns its cost when the relation itself needs an
  identity or a lifecycle independent of either side: attaching metadata to
  one specific pairing (not modelled here, but `animalTraits.id` already
  gives every pairing a stable identity `traitsRefs` cannot), inserting or
  retracting a pairing without touching the owning row's version, or
  querying the relation from the _other_ direction at scale
  (`animalHashesWithTrait` over a junction table is a direct row scan
  keyed on `traitRef`; over `traitsRefs` it has to scan every animal and
  search its array, which this project's `MultiReferenceTraitRelation`
  still does in `O(animals)` because the seed is small enough that it does
  not matter, but a junction table keyed and indexed on `traitRef` is the
  representation that scales for that direction).
- Neither representation gets referential-cardinality constraints
  ("exactly one", "at most four") from rljson itself; both need the same
  amount of application-level checking for that.

## Candidates for upstream issues

- (Carried over from `docs/findings/db-basics.md`, still relevant here)
  `BaseValidator` does not enforce uniqueness of `id` within a head table,
  so nothing catches two `animalTraits` rows sharing an `id` even though
  `TableCfg` documents `id` as the stable identity of an entity.
  Reproduction: a `TableCfg` with `isHead: true`, two rows with the same
  `id` and different `_hash`, `validateRljsonAgainstTableCfg` reports no
  error.
- The unhashed route join limitation already filed against
  `Route.fromFlat('<table>/<refTable>')` in `docs/findings/db-basics.md`
  applies equally to a junction table's two reference columns
  (`animalTraits.animalRef` into `animals`, `animalTraits.traitRef` into
  `traits`): there is no way to ask "every `animalTraits` row, with its
  animal and its trait joined, including a row whose reference is broken"
  in one `Db.get` call without falling back to separate reads and a
  JavaScript join, which is exactly what `PetShopStore.readAnimalTables`
  does for both representations in this project.
