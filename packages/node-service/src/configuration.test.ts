import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { readConfiguration } from './configuration.ts';

const webAppPublicDirectory = resolve(
  import.meta.dirname,
  '..',
  '..',
  'web-app',
  'public',
);

const packageDataDirectory = resolve(import.meta.dirname, '..', 'data');

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'node-service-'));
afterAll(() => rmSync(temporaryDirectory, { recursive: true, force: true }));

describe('readConfiguration', () => {
  it('applies the documented defaults when nothing is set', () => {
    const configuration = readConfiguration({});

    expect(configuration).toStrictEqual({
      nodeName: 'node1',
      httpPort: 8080,
      logLevel: 'info',
      gitCommit: 'unknown',
      webAppDirectory: webAppPublicDirectory,
      storage: 'memory',
      seedSize: 'small',
      traitRelationMode: 'multi-reference',
      rljsonDomain: 'petshop-local',
      hubPort: 3000,
      broadcastPort: 41234,
      dataDirectory: packageDataDirectory,
      publicUrl: 'http://localhost:8080',
      nodeUrls: [],
      nodeStatusUrls: [],
      discovery: 'enabled',
    });
  });

  it('reads every value from the environment when set', () => {
    const configuration = readConfiguration({
      NODE_NAME: 'node2',
      HTTP_PORT: '8081',
      LOG_LEVEL: 'debug',
      GIT_COMMIT: 'abc1234',
      WEB_APP_DIRECTORY: temporaryDirectory,
      STORAGE: 'sqlite',
      SEED_SIZE: 'large',
      TRAIT_RELATION: 'junction',
      RLJSON_DOMAIN: 'petshop-compose',
      HUB_PORT: '3100',
      BROADCAST_PORT: '41300',
      DATA_DIR: temporaryDirectory,
      PUBLIC_URL: 'http://node2:8080',
      NODE_URLS: 'http://node1:8080,http://node2:8080,http://node3:8080',
      NODE_STATUS_URLS:
        'http://node1.petshop.svc:80,http://node2.petshop.svc:80,http://node3.petshop.svc:80',
      DISCOVERY: 'disabled',
    });

    expect(configuration).toStrictEqual({
      nodeName: 'node2',
      httpPort: 8081,
      logLevel: 'debug',
      gitCommit: 'abc1234',
      webAppDirectory: temporaryDirectory,
      storage: 'sqlite',
      seedSize: 'large',
      traitRelationMode: 'junction',
      rljsonDomain: 'petshop-compose',
      hubPort: 3100,
      broadcastPort: 41300,
      dataDirectory: temporaryDirectory,
      publicUrl: 'http://node2:8080',
      nodeUrls: ['http://node1:8080', 'http://node2:8080', 'http://node3:8080'],
      nodeStatusUrls: [
        'http://node1.petshop.svc',
        'http://node2.petshop.svc',
        'http://node3.petshop.svc',
      ],
      discovery: 'disabled',
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

  it('defaults the storage to memory', () => {
    expect(readConfiguration({}).storage).toBe('memory');
  });

  it('accepts both documented storage kinds', () => {
    expect(readConfiguration({ STORAGE: 'memory' }).storage).toBe('memory');
    expect(readConfiguration({ STORAGE: 'sqlite' }).storage).toBe('sqlite');
  });

  it('throws a clear error for a storage kind it does not know yet', () => {
    expect(() => readConfiguration({ STORAGE: 'mssql' })).toThrow(
      'STORAGE must be one of memory, sqlite, got "mssql"',
    );
  });

  it('defaults the seed size to small', () => {
    expect(readConfiguration({}).seedSize).toBe('small');
  });

  it('defaults the trait relation mode to multi-reference', () => {
    expect(readConfiguration({}).traitRelationMode).toBe('multi-reference');
  });

  it('accepts both documented trait relation modes', () => {
    expect(
      readConfiguration({ TRAIT_RELATION: 'multi-reference' })
        .traitRelationMode,
    ).toBe('multi-reference');
    expect(
      readConfiguration({ TRAIT_RELATION: 'junction' }).traitRelationMode,
    ).toBe('junction');
  });

  it('throws a clear error for an invalid trait relation mode', () => {
    expect(() =>
      readConfiguration({ TRAIT_RELATION: 'materialized-view' }),
    ).toThrow(/TRAIT_RELATION must be one of/);
  });

  it('resolves a relative web app directory against the working directory', () => {
    const configuration = readConfiguration({ WEB_APP_DIRECTORY: '.' });

    expect(configuration.webAppDirectory).toBe(process.cwd());
  });

  it('throws a clear error when the web app directory does not exist', () => {
    const missing = join(temporaryDirectory, 'missing');

    expect(() => readConfiguration({ WEB_APP_DIRECTORY: missing })).toThrow(
      /WEB_APP_DIRECTORY must be an existing directory/,
    );
  });

  it('throws a clear error when the web app directory is a file', () => {
    const file = join(temporaryDirectory, 'index.html');
    writeFileSync(file, '<!doctype html>');

    expect(() => readConfiguration({ WEB_APP_DIRECTORY: file })).toThrow(
      /WEB_APP_DIRECTORY must be an existing directory/,
    );
  });

  it('validates the hub and broadcast ports like the HTTP port', () => {
    expect(() => readConfiguration({ HUB_PORT: '70000' })).toThrow(
      /HUB_PORT must be an integer between 0 and 65535/,
    );
    expect(() => readConfiguration({ BROADCAST_PORT: 'udp' })).toThrow(
      /BROADCAST_PORT must be an integer between 0 and 65535/,
    );
    expect(readConfiguration({ HUB_PORT: '0' }).hubPort).toBe(0);
  });

  it('derives the default public URL from the HTTP port', () => {
    expect(readConfiguration({ HTTP_PORT: '8301' }).publicUrl).toBe(
      'http://localhost:8301',
    );
  });

  it('normalizes URLs: lower-cased origin, no trailing slash, no query', () => {
    const configuration = readConfiguration({
      PUBLIC_URL: 'HTTPS://Node1.Example.test/',
      NODE_URLS:
        ' https://node1.example.test/ ,, https://node2.example.test/app/?x=1#top ',
    });

    expect(configuration.publicUrl).toBe('https://node1.example.test');
    expect(configuration.nodeUrls).toStrictEqual([
      'https://node1.example.test',
      'https://node2.example.test/app',
    ]);
    expect(Object.isFrozen(configuration.nodeUrls)).toBe(true);
  });

  it('throws a clear error for a public URL that is not absolute', () => {
    expect(() =>
      readConfiguration({ PUBLIC_URL: 'node1.example.test/status' }),
    ).toThrow(/PUBLIC_URL must be an absolute URL/);
    expect(() => readConfiguration({ PUBLIC_URL: '/status' })).toThrow(
      /PUBLIC_URL must be an absolute URL/,
    );
    expect(() => readConfiguration({ PUBLIC_URL: 'node1:8080' })).toThrow(
      /PUBLIC_URL must be an http or https URL/,
    );
  });

  it('throws a clear error for a node URL with an unsupported scheme', () => {
    expect(() =>
      readConfiguration({ NODE_URLS: 'http://node1:8080,ftp://node2:8080' }),
    ).toThrow(
      /NODE_URLS must be an http or https URL, got "ftp:\/\/node2:8080"/,
    );
  });

  it('polls the public URLs themselves when NODE_STATUS_URLS is not set', () => {
    const configuration = readConfiguration({
      NODE_URLS: 'https://node1.example.test,https://node2.example.test',
    });

    expect(configuration.nodeStatusUrls).toStrictEqual(configuration.nodeUrls);
  });

  it('aligns NODE_STATUS_URLS with NODE_URLS by position and normalizes them alike', () => {
    const configuration = readConfiguration({
      NODE_URLS: 'https://node1.example.test,https://node2.example.test',
      NODE_STATUS_URLS:
        ' http://node1.pr-7.svc.cluster.local/ , HTTP://Node2.pr-7.svc.cluster.local:80/?x=1 ',
    });

    expect(configuration.nodeStatusUrls).toStrictEqual([
      'http://node1.pr-7.svc.cluster.local',
      'http://node2.pr-7.svc.cluster.local',
    ]);
    expect(Object.isFrozen(configuration.nodeStatusUrls)).toBe(true);
  });

  it('throws a clear error when NODE_STATUS_URLS and NODE_URLS differ in length', () => {
    expect(() =>
      readConfiguration({
        NODE_URLS: 'https://node1.example.test,https://node2.example.test',
        NODE_STATUS_URLS: 'http://node1.svc',
      }),
    ).toThrow(
      'NODE_STATUS_URLS must list one URL per NODE_URLS entry in the same order, got 1 for 2',
    );
    expect(() =>
      readConfiguration({ NODE_STATUS_URLS: 'http://node1.svc' }),
    ).toThrow(
      'NODE_STATUS_URLS must list one URL per NODE_URLS entry in the same order, got 1 for 0',
    );
  });

  it('validates every NODE_STATUS_URLS entry like a node URL', () => {
    expect(() =>
      readConfiguration({
        NODE_URLS: 'https://node1.example.test',
        NODE_STATUS_URLS: 'node1.svc',
      }),
    ).toThrow(/NODE_STATUS_URLS must be an absolute URL, got "node1.svc"/);
  });

  it('resolves a relative data directory against the working directory', () => {
    expect(readConfiguration({ DATA_DIR: 'state' }).dataDirectory).toBe(
      resolve(process.cwd(), 'state'),
    );
  });

  it('rejects an empty rljson domain', () => {
    expect(() => readConfiguration({ RLJSON_DOMAIN: '  ' })).toThrow(
      /RLJSON_DOMAIN must not be empty/,
    );
  });

  it('accepts both discovery modes and rejects anything else', () => {
    expect(readConfiguration({ DISCOVERY: 'enabled' }).discovery).toBe(
      'enabled',
    );
    expect(readConfiguration({ DISCOVERY: 'disabled' }).discovery).toBe(
      'disabled',
    );
    expect(() => readConfiguration({ DISCOVERY: 'off' })).toThrow(
      /DISCOVERY must be one of enabled, disabled/,
    );
  });

  it('accepts every seed size and rejects anything else', () => {
    for (const size of ['none', 'small', 'medium', 'large'] as const) {
      expect(readConfiguration({ SEED_SIZE: size }).seedSize).toBe(size);
    }
    expect(() => readConfiguration({ SEED_SIZE: 'huge' })).toThrow(
      /SEED_SIZE must be one of none, small, medium, large/,
    );
  });
});
