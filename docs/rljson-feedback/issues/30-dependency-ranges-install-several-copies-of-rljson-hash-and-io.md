# Dependency declarations across the packages install two or three copies of `rljson`, `hash`, `io`, `json` and `network`; `server` lacks `socket.io`; `io-sqlite-node` ships an unused `sql.js`

- Packages: `@rljson/validate` 0.0.11, `@rljson/io-sqlite-node` 1.0.7,
  `@rljson/server` 0.0.64 (with `@rljson/db` 0.0.42, `@rljson/io` 0.0.78,
  `@rljson/network` 0.0.21 as the current versions on 2026-09-17)
- Environment: pnpm 12.4.2 and npm 11 (Node 24.18.0), Windows 11 Pro
  (10.0.26200)
- Severity: two copies of `@rljson/hash` compute hashes for the same data;
  two copies of `@rljson/rljson` split `Route` and validator classes
  across `instanceof` boundaries

## Reproduction

In an empty directory with a `package.json` of `{ "type": "module" }`:

```sh
pnpm add --save-exact @rljson/db@0.0.42 @rljson/io-sqlite-node@1.0.7 @rljson/server@0.0.64 @rljson/network@0.0.21
pnpm why @rljson/rljson
pnpm why @rljson/hash
pnpm why @rljson/io
pnpm why @rljson/network
ls node_modules/socket.io
```

## Expected

One copy of every `@rljson/*` package; `socket.io` and `socket.io-client`
declared by the package whose public type `SocketIoBridge` imports them;
no runtime dependency that the bundle never loads.

## Actual

```text
@rljson/rljson@0.0.55
@rljson/rljson@0.0.73
@rljson/rljson@0.0.81
Found 3 versions of @rljson/rljson
@rljson/hash@0.0.16
@rljson/hash@0.0.17
@rljson/hash@0.0.19
Found 3 versions of @rljson/hash
@rljson/json@0.0.21
@rljson/json@0.0.23
Found 2 versions of @rljson/json
@rljson/io@0.0.63
@rljson/io@0.0.78
Found 2 versions of @rljson/io
@rljson/network@0.0.20
@rljson/network@0.0.21
Found 2 versions of @rljson/network
socket.io installed: False
sql.js on disk: 23,0 MB (sql.js@1.14.2)
```

The declarations behind it (from the installed `package.json` files):

- `@rljson/validate` 0.0.11 (pulled in by `db` and `io`): `rljson ^0.0.55`,
  `hash ^0.0.16`, `json ^0.0.21`. A caret on `0.0.x` allows only that
  patch, so it never resolves to the 0.0.81 / 0.0.19 / 0.0.23 that `db`
  and `io` pin exactly.
- `@rljson/io-sqlite-node` 1.0.7: `rljson ^0.0.73`, `io ^0.0.63`, `hash
^0.0.17`, plus `sql.js ^1.13.0`, `path-browserify`, `shx` as runtime
  dependencies; `dist/index.js` imports only `node:sqlite`, `node:fs`,
  `node:fs/promises`, `node:path` and `@rljson/*` (`grep -c "sql.js"
dist/index.js` prints 0).
- `@rljson/server` 0.0.64: `@rljson/network 0.0.20` (0.0.21 current), and
  no `socket.io` / `socket.io-client` although `dist/socket-io-bridge.d.ts`
  imports both, so `tsc` on a file that imports `SocketIoBridge` fails
  until the consumer installs them (4.8.3, the versions in the package's
  `devDependencies`, work).

## Impact on us

Five overrides in `pnpm-workspace.yaml` (`rljson`, `io`, `hash`, `json`,
`network`) and a `pnpm why -r` check after every dependency change
(`docs/findings/versions.md`); `socket.io` and `socket.io-client` as
direct dependencies of the node service.

## Workaround

Overrides (npm: `overrides` in `package.json`; pnpm 12: `overrides` in
`pnpm-workspace.yaml`, the `pnpm` field of `package.json` is no longer
read).

## Suggested fix

Release `validate` and `io-sqlite-node` against the current core
versions, pin them exactly like `db`, `io` and `server` do, declare
`socket.io` and `socket.io-client` as peer dependencies of `server`,
and move `sql.js`, `path-browserify` and `shx` out of `dependencies`.
