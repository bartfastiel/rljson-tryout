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
const apexUrl = 'https://example.org';

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
  species?: string;
  webApp?: string;
};

let temporaryDirectory: string;

function runScript(scenario: Scenario): Outcome {
  const stateDirectory = join(temporaryDirectory, 'state');
  mkdirSync(stateDirectory, { recursive: true });

  // The fake redirect names the health URL of the host being asked.
  const redirect = (scenario.redirect ?? '301 __HEALTH_URL__').replace(
    '__HEALTH_URL__',
    `${(scenario.deploymentUrls ?? nodeUrl).split(' ')[0]}/health`,
  );

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
      FAKE_REDIRECT: redirect,
      FAKE_STATUS:
        scenario.status ??
        '{"nodeName":"node1","nodeId":"id-node1","role":"standalone","hubAddress":null}',
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

  it.each([
    ['a node still starting', '{"nodeName":"node1","role":"starting"}'],
    ['no role', '{"nodeName":"node1"}'],
    ['an empty body', ''],
    ['no JSON', 'Service Unavailable'],
  ])('fails when /status reports %s', (_, status) => {
    const outcome = runScript({ deploymentUrls: nodeUrl, status });

    expect(outcome.status).toBe(1);
    expect(outcome.output).toContain(
      `::error::${nodeUrl}/status does not report a settled role (standalone, hub or client), got: ${status}`,
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
