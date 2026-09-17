import { createServer, type Server } from 'node:net';

/**
 * Owns the hub port while this node is the hub.
 *
 * `NetworkManager` shares one port between its own probe listener and the
 * application's hub server: while a node is a client, the manager's probe
 * listener answers the TCP probes of the other nodes on `HUB_PORT`; the
 * moment the node becomes the hub the manager releases that port and
 * expects the application's hub transport to bind it instead, because
 * every other node keeps probing the hub there and drops it from the
 * election as soon as a probe fails. Until slice D2 puts the socket.io
 * server of `@rljson/server` on this port, this listener is the hub
 * transport: it accepts every connection and closes it at once, which is
 * exactly what a probe needs to complete its handshake.
 */
export class HubPortListener {
  private server: Server | null = null;

  /**
   * Binds the port on every interface. The manager closes its probe
   * listener synchronously before it announces the role change, but the
   * operating system may still report the port as busy for a moment, so a
   * failed bind is retried a few times before it is given up.
   */
  async start(port: number, attempts = 5, retryDelayMs = 200): Promise<void> {
    if (this.server !== null) {
      return;
    }

    for (let attempt = 1; ; attempt += 1) {
      try {
        this.server = await this.listen(port);
        return;
      } catch (error) {
        if (attempt >= attempts) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (server === null) {
      return;
    }

    this.server = null;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  isListening(): boolean {
    return this.server !== null;
  }

  /**
   * The port actually bound, which differs from the requested one only when
   * the caller asked for port `0` (the tests do, so they never bind a fixed
   * port).
   */
  port(): number | null {
    const address = this.server?.address();
    return address === null ||
      address === undefined ||
      typeof address === 'string'
      ? null
      : address.port;
  }

  private listen(port: number): Promise<Server> {
    return new Promise((resolve, reject) => {
      const server = createServer((socket) => {
        socket.end();
      });
      server.once('error', reject);
      server.listen(port, '0.0.0.0', () => {
        server.removeListener('error', reject);
        resolve(server);
      });
    });
  }
}
