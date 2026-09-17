import { describe, expect, it } from 'vitest';

import { readConfiguration } from './configuration.ts';

describe('readConfiguration', () => {
  it('applies the documented defaults when nothing is set', () => {
    const configuration = readConfiguration({});

    expect(configuration).toStrictEqual({
      nodeName: 'node1',
      httpPort: 8080,
      logLevel: 'info',
      gitCommit: 'unknown',
    });
  });

  it('reads every value from the environment when set', () => {
    const configuration = readConfiguration({
      NODE_NAME: 'node2',
      HTTP_PORT: '8081',
      LOG_LEVEL: 'debug',
      GIT_COMMIT: 'abc1234',
    });

    expect(configuration).toStrictEqual({
      nodeName: 'node2',
      httpPort: 8081,
      logLevel: 'debug',
      gitCommit: 'abc1234',
    });
  });

  it('returns a frozen object', () => {
    const configuration = readConfiguration({});

    expect(Object.isFrozen(configuration)).toBe(true);
  });

  it('accepts the boundary port values 0 and 65535', () => {
    expect(readConfiguration({ HTTP_PORT: '0' }).httpPort).toBe(0);
    expect(readConfiguration({ HTTP_PORT: '65535' }).httpPort).toBe(65535);
  });

  it('throws a clear error for a port below the valid range', () => {
    expect(() => readConfiguration({ HTTP_PORT: '-1' })).toThrow(
      /HTTP_PORT must be an integer between 0 and 65535/,
    );
  });

  it('throws a clear error for a port above the valid range', () => {
    expect(() => readConfiguration({ HTTP_PORT: '65536' })).toThrow(
      /HTTP_PORT must be an integer between 0 and 65535/,
    );
  });

  it('throws a clear error for a non-numeric port', () => {
    expect(() => readConfiguration({ HTTP_PORT: 'not-a-number' })).toThrow(
      /HTTP_PORT must be an integer between 0 and 65535/,
    );
  });

  it('throws a clear error for a fractional port', () => {
    expect(() => readConfiguration({ HTTP_PORT: '8080.5' })).toThrow(
      /HTTP_PORT must be an integer between 0 and 65535/,
    );
  });

  it('accepts every documented log level', () => {
    for (const level of ['fatal', 'error', 'warn', 'info', 'debug', 'trace']) {
      expect(readConfiguration({ LOG_LEVEL: level }).logLevel).toBe(level);
    }
  });

  it('throws a clear error for an invalid log level', () => {
    expect(() => readConfiguration({ LOG_LEVEL: 'verbose' })).toThrow(
      /LOG_LEVEL must be one of/,
    );
  });
});
