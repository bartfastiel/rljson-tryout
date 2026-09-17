import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  posixPath,
  runShellScript,
  type ShellOutcome as Outcome,
} from './test-support/shell.ts';

const expectedCommit = '8c95897323ad88221e43f88f281d86b6f13520cd';
const nodeUrl = 'https://node1.example.org';
const node2Url = 'https://node2.example.org';
const node3Url = 'https://node3.example.org';
const apexUrl = 'https://example.org';
const threeNodeUrls = `${nodeUrl} ${node2Url} ${node3Url}`;

type NodeStatus = {
  nodeName: string;
  nodeId: string;
  role: string;
  hubAddress: string | null;
  nodes: {
    url: string;
    self: boolean;
    name: string | null;
    seenInTopology: boolean;
  }[];
};

type StatusByHost = Record<string, NodeStatus>;

type Scenario = {
  deploymentUrls?: string;
  expectedCommit?: string;
  healthReadyAfter?: number;
  issuerReadyAfter?: number;
  timeoutSeconds?: number;
  issuer?: string;
  allowStagingCertificate?: string;
  redirect?: string;
  status?: string;
  statusReadyAfter?: number;
  statusByHost?: StatusByHost;
  unsettledStatusByHost?: StatusByHost;
  networkSettledAfter?: number;
  species?: string;
  webApp?: string;
};

const nodeUrls = [nodeUrl, node2Url, node3Url] as const;
const nodeNames = ['node1', 'node2', 'node3'] as const;

/**
 * The `/status` of one node of a three-node environment: `seen` names the
 * other nodes whose discovery announcements have reached it.
 */
const statusOf = (
  name: (typeof nodeNames)[number],
  role: string,
  seen: readonly string[],
): NodeStatus => ({
  nodeName: name,
  nodeId: `id-${name}`,
  role,
  hubAddress: '10.42.0.12:3000',
  nodes: nodeNames.map((other, index) => ({
    url: nodeUrls[index],
    self: other === name,
    name: other === name || seen.includes(other) ? other : null,
    seenInTopology: other === name || seen.includes(other),
  })),
});

/** Every node sees the two others, node2 is the hub. */
const settledNetwork = (): StatusByHost => ({
  'node1.example.org': statusOf('node1', 'client', ['node2', 'node3']),
  'node2.example.org': statusOf('node2', 'hub', ['node1', 'node3']),
  'node3.example.org': statusOf('node3', 'client', ['node1', 'node2']),
});

let temporaryDirectory: string;

function runScript(scenario: Scenario): Outcome {
  const stateDirectory = join(temporaryDirectory, 'state');
  mkdirSync(stateDirectory, { recursive: true });

  return runShellScript({
    scriptName: 'verify-deployment.sh',
    doubles: { 'verify-deployment': ['curl', 'openssl', 'sleep'] },
    binDirectory: join(temporaryDirectory, 'bin'),
    logFile: join(temporaryDirectory, 'calls.log'),
    environment: {
      FAKE_STATE_DIRECTORY: posixPath(stateDirectory),
      FAKE_HEALTH_COMMIT: expectedCommit,
      FAKE_HEALTH_READY_AFTER: String(scenario.healthReadyAfter ?? 0),
      FAKE_ISSUER_READY_AFTER: String(scenario.issuerReadyAfter ?? 0),
      FAKE_ISSUER:
        scenario.issuer ?? "issuer=C = US, O = Let's Encrypt, CN = YR2",
      // The fake redirect names the health URL of the host being asked.
      FAKE_REDIRECT: scenario.redirect ?? '301 __HEALTH_URL__',
      FAKE_STATUS_READY_AFTER: String(scenario.statusReadyAfter ?? 0),
      FAKE_STATUS:
        scenario.status ??
        '{"nodeName":"node1","nodeId":"id-node1","role":"standalone","hubAddress":null}',
      FAKE_STATUS_BY_HOST:
        scenario.statusByHost === undefined
          ? undefined
          : JSON.stringify(scenario.statusByHost),
      FAKE_UNSETTLED_STATUS_BY_HOST:
        scenario.unsettledStatusByHost === undefined
          ? undefined
          : JSON.stringify(scenario.unsettledStatusByHost),
      FAKE_NETWORK_SETTLED_AFTER: String(scenario.networkSettledAfter ?? 0),
      FAKE_SPECIES: scenario.species ?? '[{"id":"a"},{"id":"b"},{"id":"c"}]',
      FAKE_WEB_APP: scenario.webApp ?? '200 text/html; charset=utf-8',
      DEPLOYMENT_URLS: scenario.deploymentUrls,
      EXPECTED_COMMIT: scenario.expectedCommit ?? expectedCommit,
      ALLOW_STAGING_CERTIFICATE: scenario.allowStagingCertificate,
      VERIFY_TIMEOUT_SECONDS: String(scenario.timeoutSeconds ?? 300),
    },
  });
}

beforeEach(() => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), 'verify-deployment-'));
});

afterEach(() => {
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe('verify-deployment.sh', () => {
  it('passes when every URL serves the commit, a trusted certificate, the redirect, species and the web app', () => {
    const outcome = runScript({ deploymentUrls: nodeUrl });

    expect(outcome.status).toBe(0);
    expect(outcome.output).toContain(`${nodeUrl}/health answered:`);
    expect(outcome.output).toContain(`"commit":"${expectedCommit}"`);
    expect(outcome.output).toContain(
      "certificate issuer: issuer=C = US, O = Let's Encrypt, CN = YR2",
    );
    expect(outcome.output).toContain(
      `http://node1.example.org/health redirects: 301 ${nodeUrl}/health`,
    );
    expect(outcome.output).toContain(
      `${nodeUrl}/status reports: {"nodeName":"node1","nodeId":"id-node1","role":"standalone","hubAddress":null}`,
    );
    expect(outcome.output).toContain(`${nodeUrl}/api/species lists 3 species`);
    expect(outcome.output).toContain(
      `${nodeUrl}/ serves the web app: 200 text/html; charset=utf-8`,
    );
    expect(outcome.calls).not.toContain('sleep 10');
  });

  it.each(['hub', 'client'])(
    'accepts the settled discovery role %s',
    (role) => {
      const outcome = runScript({
        deploymentUrls: nodeUrl,
        status: `{"nodeName":"node1","nodeId":"id-node1","role":"${role}","hubAddress":"10.42.0.12:3000"}`,
      });

      expect(outcome.status, outcome.output).toBe(0);
      expect(outcome.output).toContain(`"role":"${role}"`);
    },
  );

  it('polls /health until the expected commit appears', () => {
    const outcome = runScript({ deploymentUrls: nodeUrl, healthReadyAfter: 2 });

    expect(outcome.status).toBe(0);
    expect(outcome.calls.filter((call) => call === 'sleep 10')).toHaveLength(2);
    expect(
      outcome.calls.filter((call) => call.endsWith(`${nodeUrl}/health`)),
    ).toHaveLength(3);
  });

  it('keeps polling while Traefik still serves its default certificate', () => {
    const outcome = runScript({
      deploymentUrls: nodeUrl,
      issuerReadyAfter: 2,
      allowStagingCertificate: 'true',
      issuer:
        "issuer=C = US, O = Let's Encrypt, CN = (STAGING) Ersatz Emmer YR2",
    });

    expect(outcome.status, outcome.output).toBe(0);
    expect(outcome.calls.filter((call) => call === 'sleep 10')).toHaveLength(2);
    expect(
      outcome.calls.filter((call) => call.startsWith('openssl x509')),
    ).toHaveLength(3);
    expect(outcome.output).not.toContain('TRAEFIK DEFAULT CERT');
    expect(outcome.output).toContain('certificate issuer: issuer=C = US');
  });

  it('checks every URL of the list', () => {
    const outcome = runScript({
      deploymentUrls: `${nodeUrl} ${apexUrl}`,
      redirect: '301 https://node1.example.org/health',
    });

    // The fake redirect only matches the first host, so the second one
    // fails after the first has passed completely.
    expect(outcome.status).toBe(1);
    expect(outcome.output).toContain(`${nodeUrl}/ serves the web app`);
    expect(outcome.output).toContain(
      `::error::http://example.org/health does not redirect to ${apexUrl}/health`,
    );
  });

  it('fails with an annotated error when the commit never appears', () => {
    const outcome = runScript({
      deploymentUrls: nodeUrl,
      healthReadyAfter: 100,
      timeoutSeconds: 0,
    });

    expect(outcome.status).toBe(1);
    expect(outcome.output).toContain(
      `::error::${nodeUrl}/health did not report commit ${expectedCommit} within 0 seconds.`,
    );
    expect(outcome.output).toContain(
      '"commit":"0000000000000000000000000000000000000000"',
    );
  });

  it("fails when the certificate is not from Let's Encrypt", () => {
    const outcome = runScript({
      deploymentUrls: nodeUrl,
      issuer: 'issuer=CN=TRAEFIK DEFAULT CERT',
      timeoutSeconds: 0,
    });

    expect(outcome.status).toBe(1);
    expect(outcome.output).toContain(
      "::error::https://node1.example.org/health does not serve a Let's Encrypt production certificate after 0 seconds, got: issuer=CN=TRAEFIK DEFAULT CERT",
    );
  });

  describe('certificate chain verification', () => {
    const stagingIssuer =
      "issuer=C = US, O = Let's Encrypt, CN = (STAGING) Ersatz Emmer YR2";
    const httpsCalls = (outcome: Outcome) =>
      outcome.calls.filter((call) => call.includes(' https://'));

    it('verifies the chain and rejects a staging certificate by default', () => {
      const outcome = runScript({
        deploymentUrls: nodeUrl,
        issuer: stagingIssuer,
        timeoutSeconds: 0,
      });

      expect(outcome.status).toBe(1);
      expect(outcome.output).toContain(
        `::error::${nodeUrl}/health does not serve a Let's Encrypt production certificate after 0 seconds, got: ${stagingIssuer}`,
      );
      expect(httpsCalls(outcome).length).toBeGreaterThan(0);
      for (const call of outcome.calls) {
        expect(call).not.toContain(' -k ');
      }
    });

    it('accepts a staging certificate without chain verification when allowed', () => {
      const outcome = runScript({
        deploymentUrls: nodeUrl,
        issuer: stagingIssuer,
        allowStagingCertificate: 'true',
      });

      expect(outcome.status, outcome.output).toBe(0);
      expect(outcome.output).toContain(
        `${nodeUrl}/health certificate issuer: ${stagingIssuer}`,
      );
      expect(httpsCalls(outcome).length).toBeGreaterThan(0);
      for (const call of httpsCalls(outcome)) {
        expect(call).toContain(' -k ');
      }
    });

    it('rejects a production certificate when a staging one is expected', () => {
      const outcome = runScript({
        deploymentUrls: nodeUrl,
        allowStagingCertificate: 'true',
        timeoutSeconds: 0,
      });

      expect(outcome.status).toBe(1);
      expect(outcome.output).toContain(
        `::error::${nodeUrl}/health does not serve a Let's Encrypt staging certificate after 0 seconds, got: issuer=C = US, O = Let's Encrypt, CN = YR2`,
      );
    });

    it('refuses any other value of ALLOW_STAGING_CERTIFICATE', () => {
      const outcome = runScript({
        deploymentUrls: nodeUrl,
        allowStagingCertificate: 'yes',
      });

      expect(outcome.status).toBe(1);
      expect(outcome.output).toContain(
        '::error::ALLOW_STAGING_CERTIFICATE must be true or false, got: yes',
      );
      expect(outcome.calls).toHaveLength(0);
    });
  });

  it('fails when http does not redirect to the https health URL', () => {
    const outcome = runScript({ deploymentUrls: nodeUrl, redirect: '200 ' });

    expect(outcome.status).toBe(1);
    expect(outcome.output).toContain(
      `::error::http://node1.example.org/health does not redirect to ${nodeUrl}/health, got: 200`,
    );
  });

  it('polls /status while the node still reports the role starting', () => {
    const outcome = runScript({ deploymentUrls: nodeUrl, statusReadyAfter: 2 });

    expect(outcome.status, outcome.output).toBe(0);
    expect(outcome.calls.filter((call) => call === 'sleep 10')).toHaveLength(2);
    expect(
      outcome.calls.filter((call) => call.endsWith(`${nodeUrl}/status`)),
    ).toHaveLength(3);
    expect(outcome.output).toContain('"role":"standalone"');
  });

  it.each([
    ['a node still starting', '{"nodeName":"node1","role":"starting"}'],
    ['no role', '{"nodeName":"node1"}'],
    ['an empty body', ''],
    ['no JSON', 'Service Unavailable'],
  ])('fails when /status keeps reporting %s until the timeout', (_, status) => {
    const outcome = runScript({
      deploymentUrls: nodeUrl,
      status,
      timeoutSeconds: 0,
    });

    expect(outcome.status).toBe(1);
    expect(outcome.output).toContain(
      `::error::${nodeUrl}/status did not report a settled role (standalone, hub or client) within 0 seconds, got: ${status}`,
    );
    expect(outcome.output).not.toContain('lists');
  });

  it.each([
    ['an empty array', '[]'],
    ['an object', '{"error":"x"}'],
    ['an empty body', ''],
    ['no JSON', 'Service Unavailable'],
  ])('fails when /api/species answers with %s', (_, species) => {
    const outcome = runScript({ deploymentUrls: nodeUrl, species });

    expect(outcome.status).toBe(1);
    expect(outcome.output).toContain(
      `::error::${nodeUrl}/api/species does not answer with a non-empty JSON array, got: ${species}`,
    );
    expect(outcome.output).not.toContain('lists');
  });

  it('fails when / does not serve the web app', () => {
    const outcome = runScript({
      deploymentUrls: nodeUrl,
      webApp: '404 application/json; charset=utf-8',
    });

    expect(outcome.status).toBe(1);
    expect(outcome.output).toContain(
      `::error::${nodeUrl}/ does not serve the web app, got: 404 application/json; charset=utf-8`,
    );
  });

  // Every run of the script spawns a shell and a few jq processes per URL,
  // which is slow on Windows; the three-node scenarios need more than the
  // default five seconds.
  describe('with three or more URLs', { timeout: 30_000 }, () => {
    it('passes once every node sees every other node and exactly one is the hub, and prints the roles', () => {
      const outcome = runScript({
        deploymentUrls: threeNodeUrls,
        statusByHost: settledNetwork(),
      });

      expect(outcome.status, outcome.output).toBe(0);
      expect(outcome.output).toContain(
        'network settled with the roles: node1 client, node2 hub, node3 client',
      );
      expect(outcome.output).toContain('node1 sees node2, node3');
      expect(outcome.output).toContain('node2 sees node1, node3');
      expect(outcome.output).toContain('node3 sees node1, node2');
      expect(outcome.calls).not.toContain('sleep 10');
      expect(
        outcome.calls.filter((call) => call.endsWith(`${node3Url}/status`)),
      ).toHaveLength(2);
    });

    it('waits out the second hub of a cold start', () => {
      const outcome = runScript({
        deploymentUrls: threeNodeUrls,
        // node1 missed node2's first announcement and elected itself too.
        unsettledStatusByHost: {
          'node1.example.org': statusOf('node1', 'hub', ['node3']),
          'node2.example.org': statusOf('node2', 'hub', ['node1', 'node3']),
          'node3.example.org': statusOf('node3', 'client', ['node1', 'node2']),
        },
        statusByHost: settledNetwork(),
        networkSettledAfter: 2,
      });

      expect(outcome.status, outcome.output).toBe(0);
      expect(outcome.calls.filter((call) => call === 'sleep 10')).toHaveLength(
        1,
      );
      expect(outcome.output).toContain(
        'network settled with the roles: node1 client, node2 hub, node3 client',
      );
    });

    it('treats the apex host as the node it routes to', () => {
      const outcome = runScript({
        deploymentUrls: `${threeNodeUrls} ${apexUrl}`,
        statusByHost: {
          ...settledNetwork(),
          'example.org': statusOf('node1', 'client', ['node2', 'node3']),
        },
      });

      expect(outcome.status, outcome.output).toBe(0);
      expect(outcome.output).toContain(
        'network settled with the roles: node1 client, node2 hub, node3 client',
      );
    });

    it('fails when two nodes keep claiming the hub', () => {
      const outcome = runScript({
        deploymentUrls: threeNodeUrls,
        statusByHost: {
          'node1.example.org': statusOf('node1', 'hub', ['node2', 'node3']),
          'node2.example.org': statusOf('node2', 'hub', ['node1', 'node3']),
          'node3.example.org': statusOf('node3', 'client', ['node1', 'node2']),
        },
        timeoutSeconds: 0,
      });

      expect(outcome.status).toBe(1);
      expect(outcome.output).toContain(
        '::error::The 3 URLs did not settle into one network with exactly one hub and every node seen by every other node within 0 seconds. Last roles: node1 hub, node2 hub, node3 client',
      );
    });

    it('fails when a node never sees another node in the topology', () => {
      const outcome = runScript({
        deploymentUrls: threeNodeUrls,
        statusByHost: {
          ...settledNetwork(),
          'node1.example.org': statusOf('node1', 'client', ['node2']),
        },
        timeoutSeconds: 0,
      });

      expect(outcome.status).toBe(1);
      expect(outcome.output).toContain(
        'Last roles: node1 client, node2 hub, node3 client',
      );
      expect(outcome.output).not.toContain('network settled');
    });

    it('fails when the URLs all answer as the same node', () => {
      const outcome = runScript({
        deploymentUrls: threeNodeUrls,
        timeoutSeconds: 0,
      });

      expect(outcome.status).toBe(1);
      expect(outcome.output).toContain(
        'did not settle into one network with exactly one hub and every node seen by every other node within 0 seconds. Last roles: node1 standalone',
      );
    });
  });

  it('keeps the single-node check with fewer than three URLs', () => {
    const outcome = runScript({ deploymentUrls: `${nodeUrl} ${apexUrl}` });

    expect(outcome.status, outcome.output).toBe(0);
    expect(outcome.output).toContain(`${apexUrl}/ serves the web app`);
    expect(outcome.output).not.toContain('network settled');
    expect(
      outcome.calls.filter((call) => call.endsWith(`${nodeUrl}/status`)),
    ).toHaveLength(1);
  });

  it('refuses to run without the deployment URLs', () => {
    const outcome = runScript({});

    expect(outcome.status).toBe(1);
    expect(outcome.output).toContain('DEPLOYMENT_URLS must list');
    expect(outcome.calls).toHaveLength(0);
  });

  it('refuses to run when the deployment URLs are only whitespace', () => {
    const outcome = runScript({ deploymentUrls: '  ' });

    expect(outcome.status).toBe(1);
    expect(outcome.output).toContain('::error::DEPLOYMENT_URLS holds no URL');
    expect(outcome.calls).toHaveLength(0);
  });
});
