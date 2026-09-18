# `electHub` reads the raw probe results, so `failThreshold` never reaches the election: one lost probe drops the hub

- Package: `@rljson/network` 0.0.21 (`ProbeScheduler.getProbes`,
  `NetworkManager._computeHub`, `electHub`)
- Environment: Node 24.18.0, Windows 11 Pro (10.0.26200)
- Severity: stability of the hub role (a single probe timeout re-elects)

## Reproduction

```js
import { ProbeScheduler, electHub } from '@rljson/network';

const outcomes = [true, false, true]; // reachable, one lost probe, reachable again
const probeFn = async (host, port, fromNodeId, toNodeId) => ({
  fromNodeId,
  toNodeId,
  reachable: outcomes.shift(),
  latencyMs: 1,
  measuredAt: Date.now(),
});
const scheduler = new ProbeScheduler({ probeFn, failThreshold: 3 });
const events = [];
scheduler.on('peer-unreachable', (nodeId) =>
  events.push(`peer-unreachable ${nodeId}`),
);
scheduler.on('peer-reachable', (nodeId) =>
  events.push(`peer-reachable ${nodeId}`),
);
scheduler.start('self');
const hub = {
  nodeId: 'hub',
  hostname: 'hub',
  localIps: ['10.0.0.2'],
  domain: 'd',
  port: 3000,
  startedAt: 1000,
};
const self = {
  nodeId: 'self',
  hostname: 'self',
  localIps: ['10.0.0.1'],
  domain: 'd',
  port: 3000,
  startedAt: 2000,
};
scheduler.setPeers([hub]);

for (let cycle = 1; cycle <= 3; cycle++) {
  await scheduler.runOnce();
  const probes = scheduler.getProbes();
  const election = electHub([self, hub], probes, 'hub', 'self');
  console.log(
    `cycle ${cycle}: probe reachable=${probes[0].reachable}, events=[${events.join(', ')}], election -> ${election.hubId} (${election.reason})`,
  );
}
scheduler.stop();
```

## Expected

With `failThreshold: 3` the peer stays a candidate until three
consecutive probes failed, the same rule that delays `peer-unreachable`.

## Actual

```text
cycle 1: probe reachable=true, events=[], election -> hub (incumbent)
cycle 2: probe reachable=false, events=[], election -> self (earliest-start)
cycle 3: probe reachable=true, events=[], election -> hub (incumbent)
```

`ProbeScheduler` applies the threshold to `_wasReachable` and to the
events only; `getProbes()` returns the last raw result per peer, and
`NetworkManager._computeHub` passes exactly that to `electHub`, which
filters candidates by `probe.reachable`. One failed probe (a 2 s timeout
against a hub that is busy serving a large read) removes the hub from the
candidates, the node elects itself, and the next cycle flips back.

## Impact on us

Not observed in production (probe round trips are under 1.3 ms on
one host), documented from the code and the reproduction while building
the role orchestrator; every role flap costs a hub transport teardown and
a reconnect of every client.

## Workaround

None in the library; the application's transitions are queued so that a
flap ends in a consistent state.

## Suggested fix

Feed `electHub` the dampened reachability (`_wasReachable`) or a probe
whose `reachable` reflects the threshold.
