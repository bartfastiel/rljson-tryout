# `IoSqliteNode` lifecycle: `init()` twice leaks the first connection, a relative `dbFileName` lands under `./data`, and `deleteDatabase` sleeps 800 ms unconditionally

- Package: `@rljson/io-sqlite-node` 1.0.7
- Environment: Node 24.18.0 (`node:sqlite`), Windows 11 Pro (10.0.26200)
- Severity: resource leak (a locked file on Windows), surprising defaults

## Reproduction

```js
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { IoSqliteNode } from '@rljson/io-sqlite-node';

const directory = mkdtempSync(join(tmpdir(), 'rljson-init-'));

const io = new IoSqliteNode();
io.dbFileName = join(directory, 'defaults.sqlite');
await io.init();
console.log(
  'journal_mode:',
  io.db.prepare('PRAGMA journal_mode').get(),
  'synchronous:',
  io.db.prepare('PRAGMA synchronous').get(),
);
await io.close();

const twice = new IoSqliteNode();
twice.dbFileName = join(directory, 'twice.sqlite');
await twice.init();
const firstConnection = twice.db;
await twice.init();
console.log(
  'second init() replaced io.db:',
  twice.db !== firstConnection,
  '- first connection still open:',
  firstConnection.isOpen,
);
await twice.close();
console.log(
  'after close(): first connection open:',
  firstConnection.isOpen,
  '- second open:',
  twice.db.isOpen,
);
try {
  rmSync(twice.dbFileName);
  console.log('file removed after close():', !existsSync(twice.dbFileName));
} catch (error) {
  console.log('removing the file after close() failed:', error.code);
}

const relative = new IoSqliteNode();
relative.dbFileName = 'relative.sqlite';
console.log(
  'relative dbFileName resolves to:',
  relative.dbFileName,
  '(cwd',
  resolve('.'),
  ')',
);
```

## Expected

A second `init()` is a no-op or closes the first connection; `close()`
leaves no handle behind; a relative file name resolves against the
working directory like every other Node API, or the setter documents the
`./data` prefix; `deleteDatabase` retries without a fixed sleep.

## Actual

```text
journal_mode: [Object: null prototype] { journal_mode: 'delete' } synchronous: [Object: null prototype] { synchronous: 2 }
second init() replaced io.db: true - first connection still open: true
after close(): first connection open: true - second open: false
removing the file after close() failed: EPERM
relative dbFileName resolves to: ./data/relative.sqlite (cwd C:\...\repro )
```

- `init()` opens a new `DatabaseSync` on every call and drops the
  reference to the previous one, which stays open; on Windows the file
  stays locked after `close()` (`EPERM` on removal), on Linux the handle
  leaks.
- The `dbFileName` setter turns a relative name into `./data/<name>`,
  relative to `process.cwd()`.
- `deleteDatabase` (`dist/index.js`, line 366) awaits `setTimeout(800)`
  before the first `unlink`, on every platform; the retry loop that
  follows would be enough (removing right after `close()` worked at once
  in every run on Windows).
- The defaults `journal_mode = delete`, `synchronous = 2` are issue 13.

## Impact on us

`createIo` passes an absolute path built from `DATA_DIR` and calls
`init()` exactly once per instance; the tests remove databases with their
own retry instead of `deleteDatabase`
(`packages/node-service/src/store/createIo.ts`, `testing/testStores.ts`).

## Suggested fix

Guard `init()` against a second call (return, or close first), resolve
relative names against `cwd` or document the prefix in the setter's
signature, and drop the fixed sleep in favour of the retry loop.
