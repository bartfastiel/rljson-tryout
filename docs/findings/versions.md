# `@rljson/*` versions and duplicates

## What we tried

- At the start of slice B1 (2026-09-17) ran `pnpm view @rljson/<name> version`
  for every package roadmap section 3 pins, plus `pnpm view ... time` and
  `pnpm view ... dependencies` for the ones this slice installs.
- Added `@rljson/rljson` 0.0.81 to `packages/domain` and `@rljson/db` 0.0.42,
  `@rljson/io` 0.0.78, `@rljson/rljson` 0.0.81 to `packages/node-service`
  with `pnpm add --save-exact`, then ran `pnpm why -r` for `@rljson/rljson`,
  `@rljson/io`, `@rljson/hash`, `@rljson/json`.
- Added overrides for those four packages, first as `pnpm.overrides` in the
  root `package.json` as roadmap 3.5 says, then in `pnpm-workspace.yaml`.
- pnpm 12.4.2, Node 24.18.0.

## What happened

Pinned versus latest on npm at the time of the check:

| Package                  | Pinned | Latest | Published (latest) |
| ------------------------ | ------ | ------ | ------------------ |
| `@rljson/rljson`         | 0.0.81 | 0.0.81 | 2026-09-07         |
| `@rljson/hash`           | 0.0.19 | 0.0.19 | 2026-07-05         |
| `@rljson/json`           | 0.0.23 | 0.0.23 | 2025-11-05         |
| `@rljson/io`             | 0.0.78 | 0.0.78 | 2026-09-15         |
| `@rljson/db`             | 0.0.42 | 0.0.42 | 2026-09-15         |
| `@rljson/bs`             | 0.0.26 | 0.0.26 |                    |
| `@rljson/bs-fs`          | 0.0.4  | 0.0.4  |                    |
| `@rljson/server`         | 0.0.64 | 0.0.64 |                    |
| `@rljson/network`        | 0.0.21 | 0.0.21 |                    |
| `@rljson/io-sqlite-node` | 1.0.7  | 1.0.7  |                    |
| `@rljson/io-mssql`       | 0.0.30 | 0.0.30 |                    |
| `@rljson/is-ready`       | 0.0.17 | 0.0.17 |                    |

Every pinned version is the latest; nothing to upgrade.

`@rljson/db` 0.0.42 and `@rljson/io` 0.0.78 both depend on
`@rljson/validate` 0.0.11, a package the roadmap does not list. `validate`
declares `@rljson/rljson ^0.0.55`, `@rljson/hash ^0.0.16`,
`@rljson/json ^0.0.21`. A caret on a `0.0.x` version allows only that
patch, so without overrides the tree held two copies each of `rljson`
(0.0.55 and 0.0.81), `hash` (0.0.16 and 0.0.19) and `json` (0.0.21 and
0.0.23). `pnpm why -r @rljson/rljson` before the overrides:

```text
@rljson/rljson@0.0.55
└─┬ @rljson/validate@0.0.11
  ├─┬ @rljson/db@0.0.42
  └─┬ @rljson/io@0.0.78
@rljson/rljson@0.0.81
├── @rljson-tryout/domain@0.0.0
├── @rljson-tryout/node-service@0.0.0
├─┬ @rljson/db@0.0.42
└─┬ @rljson/io@0.0.78
Found 2 versions of @rljson/rljson
```

`pnpm.overrides` in the root `package.json` was ignored with the warning
`The "pnpm" field in package.json is no longer read by pnpm`. pnpm 12 reads
`overrides` from `pnpm-workspace.yaml`. With

```yaml
overrides:
  '@rljson/rljson': 0.0.81
  '@rljson/io': 0.0.78
  '@rljson/hash': 0.0.19
  '@rljson/json': 0.0.23
```

`pnpm why -r` reports `Found 1 version` for each of the four packages and
`@rljson/validate` links to `rljson` 0.0.81, `hash` 0.0.19, `json` 0.0.23.
The duplicate directories under `node_modules/.pnpm` from the first install
stay on disk until the next clean install but nothing resolves to them.

## What it means for rljson users

- Even the pinned "core" set (`rljson`, `io`, `db`) does not install
  cleanly on its own: `@rljson/validate` drags older `rljson`, `hash` and
  `json` copies in. Two copies of `@rljson/hash` are dangerous because both
  compute hashes for the same data; two copies of `@rljson/rljson` split
  `Route` and validator classes across `instanceof` boundaries. Always add
  the overrides, not only when `io-sqlite-node` or `io-mssql` arrive.
- With pnpm 12 the overrides belong in `pnpm-workspace.yaml`; the
  `pnpm.overrides` key in `package.json` is silently ignored apart from a
  warning on install.
- `pnpm why -r <package>` ending in `Found 1 version of <package>` is the
  check to repeat whenever an `@rljson/*` dependency changes.

## Candidates for upstream issues

- `@rljson/validate` 0.0.11 pins `@rljson/rljson ^0.0.55`,
  `@rljson/hash ^0.0.16`, `@rljson/json ^0.0.21` while `@rljson/db` 0.0.42
  and `@rljson/io` 0.0.78 pin the same packages at 0.0.81, 0.0.19 and 0.0.23,
  so a fresh install duplicates them. Reproduction:
  `pnpm add @rljson/db@0.0.42 && pnpm why @rljson/rljson` in an empty
  package shows two versions.

## Adding `@rljson/io-sqlite-node` (slice C1)

### What we tried

- `pnpm --filter @rljson-tryout/node-service add --save-exact @rljson/io-sqlite-node@1.0.7`
  (published 2026-09-14, still the latest) on 2026-09-17 with the four
  overrides from above already in `pnpm-workspace.yaml`, then
  `pnpm why -r` for `@rljson/rljson`, `@rljson/io`, `@rljson/hash`,
  `@rljson/json`, `@rljson/is-ready` and `@rljson/io-sqlite-node`.
- Read `package.json` and `dist/index.js` of the installed package to see
  what it really needs at runtime.

### What happened

- `@rljson/io-sqlite-node` 1.0.7 declares `@rljson/rljson ^0.0.73`,
  `@rljson/io ^0.0.63`, `@rljson/hash ^0.0.17`, `@rljson/json ^0.0.23` and
  `@rljson/is-ready ^0.0.17`. Without the overrides that would be a third
  copy of `rljson` (0.0.73 next to 0.0.55 and 0.0.81), a second `io` and a
  second `hash`. With the overrides in place `pnpm why -r` ends in
  `Found 1 version` for every one of the four overridden packages and the
  package links to `rljson` 0.0.81, `io` 0.0.78, `hash` 0.0.19 and `json`
  0.0.23; `@rljson/is-ready` 0.0.17 is shared with `@rljson/io` without an
  override because both ask for the same version.
- The package runs on `node:sqlite` (`import { DatabaseSync } from 'node:sqlite'`),
  which Node 24 ships without a flag and without an experimental warning;
  the esbuild bundle of the service keeps `node:sqlite` external like
  every other `node:` module and grew from 1.4 MB to 2.1 MB. The image
  built from the unchanged Dockerfile runs it on `node:24-alpine`
  (`docs/findings/stores.md`).
- Its `dependencies` also list `sql.js` 1.14.2 (a 9.4 MB WebAssembly
  build of SQLite), `path-browserify` and `shx`, none of which
  `dist/index.js` imports. They are installed and locked for nothing.

### What it means for rljson users

- The overrides of roadmap section 3.5 are the same four as for the core
  set; nothing else was needed for the SQLite store. Repeat the
  `pnpm why -r` check after adding it, as after every `@rljson/*` change.
- Expect a 10 MB download for `sql.js` that the package never loads.

### Candidates for upstream issues

- `@rljson/io-sqlite-node` 1.0.7 lists `sql.js`, `path-browserify` and
  `shx` as runtime dependencies although `dist/index.js` imports only
  `node:sqlite`, `node:fs`, `node:path` and `@rljson/*`. Reproduction:
  `grep -c "sql.js" node_modules/@rljson/io-sqlite-node/dist/index.js`
  prints 0.
- Its `@rljson/*` ranges (`rljson ^0.0.73`, `io ^0.0.63`, `hash ^0.0.17`)
  lag behind `@rljson/io` 0.0.78 and `@rljson/db` 0.0.42, so a project
  without overrides gets a third `rljson` and a second `io` and `hash`.
  Reproduction: `pnpm add @rljson/db@0.0.42 @rljson/io-sqlite-node@1.0.7`
  in an empty package, then `pnpm why @rljson/rljson`.

## Adding `@rljson/server` and `@rljson/bs` (slice D2)

### What we tried

- `pnpm --filter @rljson-tryout/node-service add --save-exact @rljson/server@0.0.64 @rljson/bs@0.0.26`
  on 2026-09-17 (0.0.66 of `server` appeared the same week and stays out
  until a dedicated upgrade pull request), then `socket.io@4.8.3` and
  `socket.io-client@4.8.3`, the versions `@rljson/server`'s own
  `devDependencies` name, and `pnpm why -r` for every `@rljson/*` package.

### What happened

- `@rljson/server` 0.0.64 declares `@rljson/bs` 0.0.26, `@rljson/db`
  0.0.42, `@rljson/io` 0.0.78, `@rljson/hash` 0.0.19, `@rljson/json`
  0.0.23, `@rljson/rljson` 0.0.81 (all exact, all matching this project)
  and `@rljson/network` 0.0.20, one behind the 0.0.21 this project pins,
  so `pnpm why -r @rljson/network` showed two versions. A fifth override
  in `pnpm-workspace.yaml` (`'@rljson/network': 0.0.21`) brings it back to
  one; the only consumer inside `server` is its `Node` class, which this
  project does not use.
- It declares no dependency on `socket.io` or `socket.io-client`, although
  `dist/socket-io-bridge.d.ts` imports both for its types; without them
  installed `tsc` fails on the import of `SocketIoBridge`. Both are
  regular dependencies of the node service now, and esbuild bundles them
  without an external (the bundle grew from 2.1 MB to 3.2 MB).
- After the change `pnpm why -r` ends in `Found 1 version` for `rljson`,
  `io`, `hash`, `json`, `network`, `bs` and `db`.

### Candidates for upstream issues

- `@rljson/server` 0.0.64 depends on `@rljson/network` 0.0.20 while 0.0.21
  is current, and declares neither `socket.io` nor `socket.io-client`
  although its public `SocketIoBridge` type needs both. Reproduction: see
  `docs/findings/hub-transport.md`.
