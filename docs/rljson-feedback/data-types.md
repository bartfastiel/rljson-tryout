# Data types: what rljson's five column types can and cannot carry

A `TableCfg` column has one of six types: `string`, `number`, `boolean`,
`json`, `jsonArray` and the catch-all `jsonValue` (`jsonValueTypes` in
`@rljson/json` 0.0.23). Everything a database knows beyond that, dates,
decimals, big integers, binary, geometry, has to be expressed in one of
them, and the hash, the stores and the validator treat the value as the
JSON it is. This note records, verified against the pinned packages
(`@rljson/hash` 0.0.19, `@rljson/json` 0.0.23, `@rljson/io` 0.0.78,
`@rljson/io-sqlite-node` 1.0.7 on Node 24.18.0's `node:sqlite`,
`@rljson/io-mssql` 0.0.30 read from its `dist`), how each value space maps,
where the mapping loses information, and what a sound extension of the
type system would look like. The probe script writes each value into a
column of the declared type through `Io.write` and reads it back through
`Io.readRows`; `hsh`, `floatRep` and `JSON.stringify` are called directly.

## Numbers: what the hash sees is not always what the store keeps

`@rljson/hash` does not hash the JSON text of a number. Its canonical form
(`floatRep` in `dist/hash.js`) prints an integer with `toString()` and
rounds a non-integer to a fixed number of decimal places that shrinks with
the magnitude: 8 places below 10, 7 below 100, 6 below 1 000, 5 below
10 000, 4 below 100 000, 3 below 1 000 000 and 2 above that, written as
`<rounded integer>p<places>`. Non-integers beyond ±90 071 992 547 409
(2^53 − 1 divided by 100) are refused, `NaN` is refused, and there is no
option to change any of it (`HashConfig` has `hashLength` and
`hashAlgorithm` only).

| Value          | `floatRep`                                                                                 | `JSON.stringify`                               | Hash equal to                             |
| -------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------- | ----------------------------------------- |
| `0.1 + 0.2`    | `30000000p8`                                                                               | `0.30000000000000004`                          | `0.3` (`30000000p8`)                      |
| `1234567.891`  | `123456789p2`                                                                              | `1234567.891`                                  | `1234567.894`                             |
| `1e21`         | `1e+21`                                                                                    | `1e+21`                                        |                                           |
| `2 ** 53 + 1`  | `9007199254740992`                                                                         | `9007199254740992`                             | `2 ** 53` (JavaScript already rounded it) |
| `-0`           | `0`                                                                                        | `0`                                            | `0`                                       |
| `1e14 + 0.5`   | throws `Float value 100000000000000.5 must be between -90071992547410 and 90071992547409.` | `100000000000000.5`                            |                                           |
| `NaN`          | `NaNp2`, but `hsh` throws `NaN is not supported.` first                                    | `null`                                         |                                           |
| `Infinity`     | throws `Float value Infinity must be between …`                                            | `null`                                         |                                           |
| `10n` (BigInt) | `hsh` throws `Unsupported type: bigint`                                                    | throws `Do not know how to serialize a BigInt` |                                           |

The rounding is meant to make hashes robust against representation noise,
and for `0.1 + 0.2` it does that. It also means that two rows whose only
difference is below the rounding threshold have the same hash, and a
content-addressed store keeps exactly one of them. Measured on both stores:

| Written into a `number` column    | `IoMem` 0.0.78                                 | `IoSqliteNode` 1.0.7 (`REAL`) |
| --------------------------------- | ---------------------------------------------- | ----------------------------- |
| `0.1 + 0.2`, then `0.3`           | 1 row, reads back `0.30000000000000004`        | the same                      |
| `1234567.891`, then `1234567.894` | 1 row, reads back `1234567.891`                | the same                      |
| `1e21`                            | `1e+21`                                        | `1e+21` (`typeof` `real`)     |
| `2 ** 53 + 1`                     | `9007199254740992`                             | `9007199254740992`            |
| `-0`                              | `-0` (`Object.is`)                             | `0`                           |
| `NaN`, `Infinity`, `10n`          | rejected by `hsh` before the store sees it     | the same                      |
| `"12.50"` (a string)              | `Table data does not match the configuration.` | the same                      |

The second write of `1234567.894` is not an error: `IoMem._write` hashes
the payload, finds the hash in its row index and skips the row; `Db.insert`
would still append an InsertHistory row for it (issue 24), pointing at the
`.891` row. The same happens on the wire: a peer that serves `.894` for the
hash of `.891` passes the cascade's hash check, because the check
recomputes the same rounded representation. Below 1 000 000 the threshold
is finer (three decimals at six digits, eight decimals below ten), so
ordinary measurements are safe; monetary or scientific values with more
significant digits than the tier allows are not, and nothing warns.

The stores themselves lose nothing relative to JavaScript: SQLite `REAL`
and SQL Server `FLOAT` are IEEE 754 doubles like a JavaScript `number`,
so `0.1 + 0.2` and `1e21` round-trip bit for bit (`typeof(n_col)` is
`real`), and `2 ** 53 + 1` was already `2 ** 53` before it reached the
store. SQLite normalises `-0` to `0`; the hash never distinguished them.

## Integers beyond 2^53 and BigInt

JSON has one number type and rljson inherits it. A JavaScript `number`
holds integers exactly up to 2^53 − 1; `2 ** 53 + 1` becomes `2 ** 53`
in the literal. `BigInt` is refused everywhere (`hsh`: `Unsupported type:
bigint`; `JSON.stringify` throws), so 64-bit identifiers, nanosecond
timestamps as integers and cryptographic counters have to be strings. As
strings they hash and store exactly, compare lexicographically only when
zero-padded, and cannot be summed in a `where`.

## Decimals and money

This project stores prices as `priceCents: number`, an integer in the
smallest unit; that keeps every value inside the exact integer range and
outside the rounding tiers. A price as a decimal `number` would be safe
below 1 000 000 with two decimals, and silently merged with its neighbour
above (`1234567.891` and `1234567.894` are one row). A `decimal` string
(`"12.50"`) is exact and hashes as text, but a `number` column refuses it
and a `string` column cannot say that it is a number. Nothing in the type
system expresses scale or precision.

## Dates and times

There is no date type. The project's convention is ISO 8601 strings in
`string` columns: `bornOn: "2020-07-22"`, `issuedOn`, `suppliesSince`;
SQLite stores them as `TEXT` (schema `bornOn_col TEXT`, `typeof` `text`),
which is also what SQL Server would get (`NVARCHAR(MAX)`). Consequences,
all verified:

- Validity is not checked: `"2024-02-30"` is accepted by both stores
  (the application validates the form and the calendar itself,
  `packages/domain/src/animalChanges.ts`).
- A `Date` instance is refused (`Unsupported type: object`), so
  serialisation is the caller's job.
- Resolution and offset are whatever the string carries.
  `Date.prototype.toISOString()` gives milliseconds and always `Z`;
  RFC 3339 allows any offset, and two strings with different offsets do
  not sort chronologically as text. JavaScript's range ends at
  `+275760-09-13T00:00:00.000Z` with the expanded six-digit year, which
  ISO 8601 permits and most databases do not.
- rljson's own timestamps: `timeId()` returns `<milliseconds since the
epoch>:<4 random characters>` (`1789714201040:qvef`), millisecond
  resolution, no offset, no order within one millisecond (issue 31);
  `InsertHistoryRow.clientTimestamp` and `ConnectorPayload.t` are
  millisecond numbers, so they stay far below the 9 × 10^13 limit of
  `floatRep` as integers and would hit it only as fractions.

## Binary

The blob store is rljson's answer for binary content: `Bs.setBlob(content)`
takes a `Buffer`, a string or a stream, and the blob id is the SHA-256 of
the content in the same 22-character base64url form as a row hash
(`hshBuffer(Buffer.from('x'))` is `LXEWQrcmsEQBYnyp-6wy9c`, 132 bits of
the digest). A row references a blob by that id in a `string` column
(`imageBlobId` on `species` in roadmap section 2.6), the validator does not resolve it, and `BsMulti`
cascades blob reads like `IoMulti` cascades rows. There is no form for
small binary values inside a row: a `Uint8Array` is refused
(`Unsupported type: object`), so a UUID is a 36-character string instead
of 16 bytes, a geometry a text encoding, and a base64 string in a
`string` column is the only way (`"AQID"` round-trips; the same string in
a `jsonArray` column is a type mismatch).

## Geodata

A `json` column accepts any plain object and nothing else: a GeoJSON point
`{ type: 'Point', coordinates: [13.405, 52.52] }` is stored and read back
intact, an array is refused (`Table data does not match the
configuration.`), a `Date` is refused. `hsh` adds a `_hash` member to the
object (`{"type":"Point","coordinates":[…],"_hash":"RIM0te2gBvNWkZyokBttMV"}`),
which GeoJSON tolerates as a foreign member but a strict consumer may
not. Coordinates are `number`s and inherit the rounding tiers: below 10
degrees eight decimals (about 1 mm), below 100 degrees seven (about 1 cm),
so a coordinate pair is safe, an elevation in metres between 1 000 and
10 000 keeps five decimals, and a value above 1 000 000 (a UTM northing)
keeps two. Nothing
validates the GeoJSON structure.

## How the two SQL stores map the types

| rljson type | `IoSqliteNode` 1.0.7 | `IoMssql` 0.0.30 (`dist/io-mssql.js`, `jsonToSqlType`) | Written as                               | Read back as                                                                             |
| ----------- | -------------------- | ------------------------------------------------------ | ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| `string`    | `TEXT`               | `NVARCHAR(MAX)` (`NVARCHAR(256)` for `_hash`)          | as is                                    | as is                                                                                    |
| `number`    | `REAL`               | `FLOAT`                                                | as is (IEEE double)                      | as is; SQLite turns `-0` into `0`                                                        |
| `boolean`   | `INTEGER`            | `BIT`                                                  | `1` / `0`                                | `val !== 0`                                                                              |
| `json`      | `TEXT`               | `NVARCHAR(MAX)`                                        | `JSON.stringify`                         | `JSON.parse`                                                                             |
| `jsonArray` | `TEXT`               | `NVARCHAR(MAX)`                                        | `JSON.stringify`                         | `JSON.parse`                                                                             |
| `jsonValue` | `TEXT`               | `NVARCHAR(MAX)`                                        | `JSON.stringify` for objects, else as is | SQLite throws `Unsupported column type jsonValue`; SQL Server drops the value (issue 34) |

Both stores keep the JSON value space and nothing more: no `DATE`,
`DECIMAL`, `BIGINT`, `VARBINARY` or `geography` column is ever created, so
the database cannot index a date range, sum a decimal exactly or run a
spatial query on rljson data without a computed column. `FLOAT` and
`REAL` carry a JavaScript `number` without loss; the precision question
is decided earlier, in `floatRep`. Inserts are parameterised in SQL
Server (`request.input(...)`), but both stores build the `where` clause
by string concatenation (`SqlStatements._whereString` in `io-sqlite-node`,
`DbStatements.whereString` in `io-mssql`, issue 02). `io-mssql` also
coerces on read (`_coerceValue`: a string in a `number`
column becomes `Number(value)` or `null`, `"true"` becomes `true`), which
SQLite does not do.

## Why JSON stays the canonical form, and what can grow on top of it

"Same content, same hash" is the foundation everything else stands on:
deduplication across nodes, verification of what a peer serves, the
version DAG keyed by row hash, the change sets that name rows by hash. The
hash is computed over a canonical rendering of the JSON value (sorted
keys, `floatRep` for numbers, nested objects replaced by their hashes).
Moving that rendering to BSON, protobuf or CBOR would change every hash
ever computed, split every network into rows hashed before and after, and
buy nothing the format needs: a binary encoding has its own canonical
form problems (CBOR needs the deterministic encoding of RFC 8949 §4.2,
protobuf has no canonical serialisation at all), and the values it adds
(64-bit integers, byte strings, tagged dates) would still have to be
mapped to the JSON that `Db`, the validator and the browser see. The
break is not worth it.

The sound evolution is logical column types in `TableCfg` with one fixed
canonical string encoding each, so that the JSON on the wire and in the
hash does not change, while adapters may use native columns and the
validator can check the form:

- `date`: `YYYY-MM-DD`, calendar-checked; SQLite `TEXT`, SQL Server `DATE`.
- `datetime`: RFC 3339 with a mandatory offset and up to nine fractional
  digits, normalised to `Z` for hashing so that the same instant hashes
  once; SQL Server `DATETIMEOFFSET(7)`, SQLite `TEXT`.
- `decimal`: a decimal string with a declared scale (`"12.50"`), no
  exponent, no rounding tiers; SQL Server `DECIMAL(p, s)`.
- `bigint`: a decimal integer string; SQL Server `BIGINT` or `DECIMAL(38)`.
- `binary`: base64url in the row for small values with a declared maximum
  length (a UUID, a public key), or a blob reference validated against
  the `Bs` for large ones; SQL Server `VARBINARY`.
- `geo`: GeoJSON in a `json` column with structural validation and a
  documented coordinate precision; SQL Server `geography`.
- `number` itself: document the rounding tiers and the ±9 × 10^13 range
  for non-integers in the public README, and either make the tier
  boundaries part of the type (`number` with a declared `precision`) or
  add an `integer` type that skips `floatRep` and refuses fractions.

Each of these is a string or an object in JSON, so existing rows, hashes
and stores stay valid; the type only tells the validator what to check
and the adapter what native column it may use. CBOR or another binary
framing can come later as a wire encoding between `IoPeer` and
`IoServer`, for size, without touching the hash.

## Recommendations

For rljson:

1. Document `floatRep` where users meet `number` and treat the collision
   of `1234567.891` and `1234567.894` as a bug or as a documented,
   type-level property; in 0.0.19 it is neither.
2. Logical types with canonical string encodings as listed above, checked
   by `BaseValidator`, mapped by `io-sqlite-node` and `io-mssql` to native
   columns where the database has them.
3. Keep JSON as the hashed form; consider a binary framing only for the
   transport.

For this project:

1. Keep integers in the smallest unit for money and identifiers, ISO
   strings for dates, base64url strings or blob ids for binary, and keep
   the calendar and form checks in the domain package; none of that can
   move into the schema until the types above exist.
2. Never put a measured `number` with more significant digits than its
   rounding tier allows into a row; scale it to an integer first.
