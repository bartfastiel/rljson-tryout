import { afterEach, describe, expect, it, vi } from 'vitest';

import { recordingLogger } from '../testing/recordingLogger.ts';
import { EventHub, formatEvent, type EventSink } from './eventHub.ts';

/**
 * An `EventSink` that keeps what was written, reports a buffer of the
 * size a test sets, and remembers whether it was ended or destroyed.
 */
class FakeSink implements EventSink {
  readonly chunks: string[] = [];
  writableLength = 0;
  writableEnded = false;
  destroyed = false;

  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }

  end(): void {
    this.writableEnded = true;
  }

  destroy(): void {
    this.destroyed = true;
    this.writableEnded = true;
  }

  get text(): string {
    return this.chunks.join('');
  }
}

const hubWithRecords = (options = {}) => {
  const { logger, records } = recordingLogger();
  return { hub: new EventHub(logger, options), records };
};

afterEach(() => {
  vi.useRealTimers();
});

describe('formatEvent', () => {
  it('writes id, event and one data line, ended by a blank line', () => {
    expect(formatEvent(7, 'insert', { a: 1 })).toBe(
      'id: 7\nevent: insert\ndata: {"a":1}\n\n',
    );
  });

  it('keeps a payload with line breaks inside on one data line', () => {
    const frame = formatEvent(1, 'sync', { error: 'first\nsecond' });

    expect(frame.split('\n')).toStrictEqual([
      'id: 1',
      'event: sync',
      'data: {"error":"first\\nsecond"}',
      '',
      '',
    ]);
  });
});

describe('EventHub', () => {
  it('greets a new client with the retry delay and a comment', () => {
    const { hub } = hubWithRecords({ retryDelayMs: 1234 });
    const sink = new FakeSink();

    hub.add(sink);

    expect(sink.text).toBe('retry: 1234\n\n: connected\n\n');
    expect(hub.clientCount).toBe(1);
  });

  it('publishes every event to every client with ids counting up', () => {
    const { hub } = hubWithRecords();
    const first = new FakeSink();
    const second = new FakeSink();
    hub.add(first);
    hub.add(second);

    hub.publish('insert', { changeSetHash: 'a' });
    hub.publish('topology', { role: 'hub' });

    for (const sink of [first, second]) {
      expect(sink.chunks.slice(1)).toStrictEqual([
        'id: 1\nevent: insert\ndata: {"changeSetHash":"a"}\n\n',
        'id: 2\nevent: topology\ndata: {"role":"hub"}\n\n',
      ]);
    }
    expect(hub.lastId).toBe(2);
  });

  it('stops writing to a client once it was removed', () => {
    const { hub } = hubWithRecords();
    const sink = new FakeSink();
    const remove = hub.add(sink);

    remove();
    remove();
    hub.publish('insert', {});

    expect(sink.chunks).toHaveLength(1);
    expect(hub.clientCount).toBe(0);
  });

  it('drops a client whose sink was ended elsewhere', () => {
    const { hub } = hubWithRecords();
    const sink = new FakeSink();
    hub.add(sink);

    sink.writableEnded = true;
    hub.publish('insert', {});

    expect(sink.chunks).toHaveLength(1);
    expect(hub.clientCount).toBe(0);
  });

  it('destroys a client that buffers more than the bound instead of growing', () => {
    const { hub, records } = hubWithRecords({ maxBufferedBytes: 100 });
    const reading = new FakeSink();
    const stalled = new FakeSink();
    hub.add(reading);
    hub.add(stalled);

    stalled.writableLength = 101;
    hub.publish('sync', {});
    hub.publish('sync', {});

    expect(stalled.destroyed).toBe(true);
    expect(stalled.chunks).toHaveLength(2);
    expect(reading.destroyed).toBe(false);
    expect(reading.chunks).toHaveLength(3);
    expect(hub.clientCount).toBe(1);
    expect(records.filter((record) => record.level === 'warn')).toMatchObject([
      {
        message: 'event stream client is not reading, dropped',
        fields: { bufferedBytes: 101 },
      },
    ]);
  });

  it('sends a heartbeat comment while clients are connected, not after', () => {
    vi.useFakeTimers();
    const { hub } = hubWithRecords({ heartbeatIntervalMs: 1000 });
    const sink = new FakeSink();
    const remove = hub.add(sink);

    vi.advanceTimersByTime(2500);
    expect(sink.chunks.slice(1)).toStrictEqual([
      ': heartbeat\n\n',
      ': heartbeat\n\n',
    ]);

    remove();
    vi.advanceTimersByTime(5000);
    expect(sink.chunks).toHaveLength(3);

    const later = new FakeSink();
    hub.add(later);
    vi.advanceTimersByTime(1000);
    expect(later.chunks.slice(1)).toStrictEqual([': heartbeat\n\n']);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('ends every stream on close and no longer accepts clients or events', () => {
    vi.useFakeTimers();
    const { hub } = hubWithRecords({ heartbeatIntervalMs: 1000 });
    const sink = new FakeSink();
    hub.add(sink);

    hub.close();
    hub.publish('insert', {});
    const late = new FakeSink();
    const removeLate = hub.add(late);
    removeLate();

    expect(sink.writableEnded).toBe(true);
    expect(sink.chunks).toHaveLength(1);
    expect(late.writableEnded).toBe(true);
    expect(late.chunks).toHaveLength(0);
    expect(hub.clientCount).toBe(0);
    expect(hub.lastId).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
