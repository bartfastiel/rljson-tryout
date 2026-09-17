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
