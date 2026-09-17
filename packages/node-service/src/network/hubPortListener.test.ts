import { connect, createServer, type Server } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { HubPortListener } from './hubPortListener.ts';

const listeners: HubPortListener[] = [];
const blockers: Server[] = [];

afterEach(async () => {
  for (const listener of listeners.splice(0)) {
    await listener.stop();
  }
  for (const blocker of blockers.splice(0)) {
    await new Promise<void>((resolve) => blocker.close(() => resolve()));
  }
});

const listener = (): HubPortListener => {
  const created = new HubPortListener();
  listeners.push(created);
  return created;
};

/** Occupies an ephemeral port and returns it, like a lingering probe listener. */
const occupyPort = (): Promise<number> =>
  new Promise((resolve) => {
    const blocker = createServer();
    blockers.push(blocker);
    blocker.listen(0, '0.0.0.0', () => {
      const address = blocker.address();
      resolve(
        typeof address === 'string' || address === null ? 0 : address.port,
      );
    });
  });

/** Completes a TCP handshake with the port and reports how the peer ended it. */
const probe = (port: number): Promise<'closed-by-peer' | 'refused'> =>
  new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.once('end', () => {
      socket.destroy();
      resolve('closed-by-peer');
    });
    socket.once('error', () => resolve('refused'));
  });

describe('HubPortListener', () => {
  it('accepts a connection and closes it at once, like a probe expects', async () => {
    const hubPort = listener();

    await hubPort.start(0);
    const port = hubPort.port();

    expect(hubPort.isListening()).toBe(true);
    expect(port).not.toBeNull();
    expect(await probe(port!)).toBe('closed-by-peer');
  });

  it('is idle and without a port before start and after stop', async () => {
    const hubPort = listener();
    expect(hubPort.isListening()).toBe(false);
    expect(hubPort.port()).toBeNull();

    await hubPort.start(0);
    const port = hubPort.port()!;
    await hubPort.stop();

    expect(hubPort.isListening()).toBe(false);
    expect(hubPort.port()).toBeNull();
    expect(await probe(port)).toBe('refused');
  });

  it('keeps the first server when started twice', async () => {
    const hubPort = listener();

    await hubPort.start(0);
    const port = hubPort.port();
    await hubPort.start(0);

    expect(hubPort.port()).toBe(port);
  });

  it('retries a busy port and succeeds once it is released', async () => {
    const busyPort = await occupyPort();
    const hubPort = listener();

    const starting = hubPort.start(busyPort, 10, 20);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const blocker = blockers.pop()!;
    await new Promise<void>((resolve) => blocker.close(() => resolve()));
    await starting;

    expect(hubPort.port()).toBe(busyPort);
  });

  it('gives up on a busy port after the configured attempts', async () => {
    const busyPort = await occupyPort();
    const hubPort = listener();

    await expect(hubPort.start(busyPort, 2, 10)).rejects.toMatchObject({
      code: 'EADDRINUSE',
    });
    expect(hubPort.isListening()).toBe(false);
  });
});
