/**
 * One block of a server-sent event stream as the reader parses it: an
 * event with its `id`, `event` and `data` fields, or a block of comment
 * lines only (the connection greeting and the heartbeats), which the
 * browser's `EventSource` swallows and the tests want to see.
 */
export type StreamBlock = {
  id: string | null;
  event: string | null;
  data: string | null;
  retry: string | null;
  comments: string[];
};

const emptyBlock = (): StreamBlock => ({
  id: null,
  event: null,
  data: null,
  retry: null,
  comments: [],
});

/**
 * Parses the complete blocks of a stream buffer: everything up to the
 * last blank line, leaving a trailing partial block in the buffer.
 */
export const parseBlocks = (
  buffer: string,
): { blocks: StreamBlock[]; rest: string } => {
  const blocks: StreamBlock[] = [];
  let rest = buffer;
  for (;;) {
    const end = rest.indexOf('\n\n');
    if (end === -1) {
      return { blocks, rest };
    }
    const block = emptyBlock();
    for (const line of rest.slice(0, end).split('\n')) {
      if (line.startsWith(':')) {
        block.comments.push(line.slice(1).trim());
        continue;
      }
      const separator = line.indexOf(':');
      const field = separator === -1 ? line : line.slice(0, separator);
      const value =
        separator === -1 ? '' : line.slice(separator + 1).replace(/^ /, '');
      if (field === 'id' || field === 'event' || field === 'retry') {
        block[field] = value;
      } else if (field === 'data') {
        block.data = block.data === null ? value : `${block.data}\n${value}`;
      }
    }
    blocks.push(block);
    rest = rest.slice(end + 2);
  }
};

/**
 * A client of `GET /api/events` for the tests: connects with `fetch`
 * (Fastify's `inject` cannot keep a response open), keeps every block it
 * received and lets a test wait for the first block that matches a
 * predicate. `close` aborts the connection, the way a browser tab that
 * is closed does.
 */
export class EventStreamReader {
  readonly blocks: StreamBlock[] = [];
  readonly response: Response;
  private readonly controller: AbortController;
  private readonly waiters = new Set<() => void>();
  private buffer = '';
  private ended = false;
  private endedWith: unknown = null;

  private constructor(response: Response, controller: AbortController) {
    this.response = response;
    this.controller = controller;
    void this.pump();
  }

  static async open(url: string): Promise<EventStreamReader> {
    const controller = new AbortController();
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'text/event-stream' },
    });
    return new EventStreamReader(response, controller);
  }

  /** Whether the server ended the stream. */
  get closed(): boolean {
    return this.ended;
  }

  /** The events received so far (blocks with an event name), in order. */
  get events(): StreamBlock[] {
    return this.blocks.filter((block) => block.event !== null);
  }

  /**
   * The first block that matches, already received or arriving within the
   * timeout. Rejects with the blocks seen so far when none matches in
   * time.
   */
  async next(
    matches: (block: StreamBlock) => boolean,
    timeoutMs = 5_000,
  ): Promise<StreamBlock> {
    let checked = 0;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      for (; checked < this.blocks.length; checked += 1) {
        const block = this.blocks[checked]!;
        if (matches(block)) {
          return block;
        }
      }
      if (this.ended) {
        throw new Error(
          `the stream ended before a matching block arrived: ${JSON.stringify(this.blocks)}`,
        );
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error(
          `no matching block within ${timeoutMs} ms: ${JSON.stringify(this.blocks)}`,
        );
      }
      await this.wait(remaining);
    }
  }

  /** The next event named like this, parsed from its JSON `data`. */
  async nextEvent<Payload>(
    event: string,
    matches: (payload: Payload) => boolean = () => true,
    timeoutMs = 5_000,
  ): Promise<{ id: string | null; payload: Payload }> {
    const block = await this.next(
      (candidate) =>
        candidate.event === event &&
        candidate.data !== null &&
        matches(JSON.parse(candidate.data) as Payload),
      timeoutMs,
    );
    return { id: block.id, payload: JSON.parse(block.data!) as Payload };
  }

  /** Resolves once the server ended the stream. */
  async untilClosed(timeoutMs = 5_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!this.ended) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error(`the stream was still open after ${timeoutMs} ms`);
      }
      await this.wait(remaining);
    }
  }

  close(): void {
    this.controller.abort();
  }

  private wait(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiters.delete(wake);
        resolve();
      }, timeoutMs);
      const wake = (): void => {
        clearTimeout(timer);
        resolve();
      };
      this.waiters.add(wake);
    });
  }

  private wake(): void {
    for (const waiter of [...this.waiters]) {
      this.waiters.delete(waiter);
      waiter();
    }
  }

  private async pump(): Promise<void> {
    const body = this.response.body;
    if (body === null) {
      this.ended = true;
      this.wake();
      return;
    }
    const decoder = new TextDecoder();
    try {
      for await (const chunk of body) {
        this.buffer += decoder.decode(chunk, { stream: true });
        const { blocks, rest } = parseBlocks(this.buffer);
        this.buffer = rest;
        if (blocks.length > 0) {
          this.blocks.push(...blocks);
          this.wake();
        }
      }
    } catch (error) {
      this.endedWith = error;
    } finally {
      this.ended = true;
      this.wake();
    }
  }

  /** The error the connection ended with, `null` for a clean end. */
  get error(): unknown {
    return this.endedWith;
  }
}
