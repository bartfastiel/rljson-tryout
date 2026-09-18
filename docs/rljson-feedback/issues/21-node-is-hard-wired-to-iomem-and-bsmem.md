# `Node` creates `IoMem` and `BsMem` internally and cannot run over a persistent store

- Package: `@rljson/server` 0.0.64 (`Node.start`, `NodeConfig`,
  `NodeDeps`)
- Environment: Node 24.18.0, Windows 11 Pro (10.0.26200)
- Severity: design gap (the packaged orchestrator is unusable for any
  node with a database)

## Reproduction

By reading, not by running: `dist/server.js` of 0.0.64, `Node.start()`:

```js
async start() {
  if (this._running) return;
  this._ioMem = new IoMem();
  await this._ioMem.init();
  await this._ioMem.isReady();
  this._bsMem = new BsMem();
  this._running = true;
  ...
}
```

and `dist/node.d.ts`: `NodeConfig` has `domain`, `port`, `route`,
`network`, `serverOptions`, `clientOptions`, `logger`, `identityDir`,
`hubSelfCheckMs`; `NodeDeps` has `createHubTransport`,
`createClientTransport`, `networkManagerOptions`, `createAgent`. Neither
accepts an `Io` or a `Bs`, and the `Server` and `Client` the node builds
receive `this._ioMem` and `this._bsMem`.

## Expected

`NodeConfig.io` / `NodeConfig.bs` (or a factory in `NodeDeps`), so that
the role transitions, the hub self check, `seedLatestRef` and the
last-known-ref handover the class already implements can be used over
`IoSqliteNode` or any other `Io`.

## Actual

Every node built on `Node` is an in-memory node that loses its data on
restart.

## Impact on us

The project's `RoleOrchestrator` and `HubTransport`
(`packages/node-service/src/network/`) reimplement the transitions
(`_performTransition`, `_becomeHub`, `_becomeClient`, `_onHubChanged`)
after `Node`'s model, plus the loopback connector (issue 19) and the
store lending (issue 03), to run the same logic over SQLite.
`@rljson/network` had to be pinned one version ahead of what `server`
declares to get one copy of it (issue 30), and `Node` is the only consumer
of `network` inside `server`.

## Workaround

An own orchestrator over `NetworkManager`, `Server` and `Client`.

## Suggested fix

Inject the stores; the same change would let `Node` honour `ownsStores`.
