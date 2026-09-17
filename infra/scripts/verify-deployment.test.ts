import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const scriptPath = fileURLToPath(
  new URL('./verify-deployment.sh', import.meta.url),
);
const testDoublesDirectory = fileURLToPath(
  new URL('./test-doubles/verify-deployment/', import.meta.url),
);

// On Windows the first bash on PATH may be the one of the Windows Subsystem
// for Linux, which cannot see the temporary directory; Git Bash can.
const gitBashOnWindows = join(
  process.env['ProgramFiles'] ?? 'C:\\Program Files',
  'Git',
  'usr',
  'bin',
  'bash.exe',
);
const bash =
  process.platform === 'win32' && existsSync(gitBashOnWindows)
    ? gitBashOnWindows
    : 'bash';

const expectedCommit = '8c95897323ad88221e43f88f281d86b6f13520cd';
const nodeUrl = 'https://node1.example.org';
const apexUrl = 'https://example.org';

type Scenario = {
  deploymentUrls?: string;
  expectedCommit?: string;
  healthReadyAfter?: number;
  timeoutSeconds?: number;
  issuer?: string;
  redirect?: string;
  species?: string;
  webApp?: string;
};

type Outcome = {
  status: number | null;
  output: string;
  calls: string[];
};

let temporaryDirectory: string;

// Git Bash accepts forward slashes in Windows paths, so the fake binaries
// and the script agree on every file they exchange.
function posixPath(path: string): string {
  return path.replaceAll('\\', '/');
}

function runScript(scenario: Scenario): Outcome {
  const fakeBinariesDirectory = join(temporaryDirectory, 'bin');
  const stateDirectory = join(temporaryDirectory, 'state');
  const logFile = join(temporaryDirectory, 'calls.log');
  for (const directory of [fakeBinariesDirectory, stateDirectory]) {
    mkdirSync(directory, { recursive: true });
  }
  for (const name of ['curl', 'openssl', 'sleep']) {
    const target = join(fakeBinariesDirectory, name);
    copyFileSync(join(testDoublesDirectory, `${name}.sh`), target);
    chmodSync(target, 0o755);
  }

  const environment: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PATH: `${fakeBinariesDirectory}${delimiter}${process.env['PATH'] ?? ''}`,
    FAKE_LOG: posixPath(logFile),
    FAKE_STATE_DIRECTORY: posixPath(stateDirectory),
    FAKE_HEALTH_COMMIT: expectedCommit,
    FAKE_HEALTH_READY_AFTER: String(scenario.healthReadyAfter ?? 0),
    FAKE_ISSUER:
      scenario.issuer ?? "issuer=C = US, O = Let's Encrypt, CN = YR2",
    FAKE_REDIRECT: scenario.redirect ?? '301 __HEALTH_URL__',
    FAKE_SPECIES: scenario.species ?? '[{"id":"a"},{"id":"b"},{"id":"c"}]',
    FAKE_WEB_APP: scenario.webApp ?? '200 text/html; charset=utf-8',
    EXPECTED_COMMIT: scenario.expectedCommit ?? expectedCommit,
    VERIFY_TIMEOUT_SECONDS: String(scenario.timeoutSeconds ?? 300),
  };
  if (scenario.deploymentUrls !== undefined) {
    environment['DEPLOYMENT_URLS'] = scenario.deploymentUrls;
  } else {
    delete environment['DEPLOYMENT_URLS'];
  }
  // The fake redirect names the health URL of the host being asked.
  if (environment['FAKE_REDIRECT'].includes('__HEALTH_URL__')) {
    environment['FAKE_REDIRECT'] = environment['FAKE_REDIRECT'].replace(
      '__HEALTH_URL__',
      `${(scenario.deploymentUrls ?? nodeUrl).split(' ')[0]}/health`,
    );
  }

  const result = spawnSync(bash, [posixPath(scriptPath)], {
    encoding: 'utf8',
    env: environment,
  });
  const calls = existsSync(logFile)
    ? readFileSync(logFile, 'utf8').trim().split('\n')
    : [];
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
    calls,
  };
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
    expect(outcome.output).toContain(`${nodeUrl}/api/species lists 3 species`);
    expect(outcome.output).toContain(
      `${nodeUrl}/ serves the web app: 200 text/html; charset=utf-8`,
    );
    expect(outcome.calls).not.toContain('sleep 10');
  });

  it('polls /health until the expected commit appears', () => {
    const outcome = runScript({ deploymentUrls: nodeUrl, healthReadyAfter: 2 });

    expect(outcome.status).toBe(0);
    expect(outcome.calls.filter((call) => call === 'sleep 10')).toHaveLength(2);
    expect(
      outcome.calls.filter((call) => call.endsWith(`${nodeUrl}/health`)),
    ).toHaveLength(3);
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
    });

    expect(outcome.status).toBe(1);
    expect(outcome.output).toContain(
      "::error::https://node1.example.org/health does not serve a Let's Encrypt certificate, got: issuer=CN=TRAEFIK DEFAULT CERT",
    );
  });

  it('fails when http does not redirect to the https health URL', () => {
    const outcome = runScript({ deploymentUrls: nodeUrl, redirect: '200 ' });

    expect(outcome.status).toBe(1);
    expect(outcome.output).toContain(
      `::error::http://node1.example.org/health does not redirect to ${nodeUrl}/health, got: 200`,
    );
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
