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
  new URL('./destroy-workloads.sh', import.meta.url),
);
const testDoublesDirectory = fileURLToPath(
  new URL('./test-doubles/', import.meta.url),
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

type Scenario = {
  workspaces: string[];
  kubeconfigPresent?: boolean;
  apiServerAnswers?: boolean;
  failDestroyIn?: string;
};

type Outcome = {
  status: number | null;
  output: string;
  calls: string[];
  summary: string;
};

let temporaryDirectory: string;

// Git Bash accepts forward slashes in Windows paths, so the fake binaries
// and the script agree on every file they exchange.
function posixPath(path: string): string {
  return path.replaceAll('\\', '/');
}

function runScript(scenario: Scenario): Outcome {
  const binDirectory = join(temporaryDirectory, 'bin');
  const stateDirectory = join(temporaryDirectory, 'state');
  const workloadsDirectory = join(temporaryDirectory, 'workloads');
  const logFile = join(temporaryDirectory, 'calls.log');
  const summaryFile = join(temporaryDirectory, 'summary.md');
  for (const directory of [binDirectory, stateDirectory, workloadsDirectory]) {
    mkdirSync(directory, { recursive: true });
  }
  for (const name of ['terraform', 'curl', 'sleep']) {
    const target = join(binDirectory, name);
    copyFileSync(join(testDoublesDirectory, `${name}.sh`), target);
    chmodSync(target, 0o755);
  }

  const result = spawnSync(bash, [posixPath(scriptPath)], {
    cwd: workloadsDirectory,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${binDirectory}${delimiter}${process.env['PATH'] ?? ''}`,
      FAKE_LOG: posixPath(logFile),
      FAKE_STATE_DIRECTORY: posixPath(stateDirectory),
      FAKE_WORKSPACES: scenario.workspaces.join(' '),
      FAKE_KUBECONFIG_PRESENT:
        scenario.kubeconfigPresent === false ? 'no' : 'yes',
      FAKE_API_ANSWERS: scenario.apiServerAnswers === false ? 'no' : 'yes',
      FAKE_FAIL_DESTROY_IN: scenario.failDestroyIn ?? '',
      GITHUB_STEP_SUMMARY: posixPath(summaryFile),
    },
  });

  const calls = existsSync(logFile)
    ? readFileSync(logFile, 'utf8').trimEnd().split('\n')
    : [];
  const summary = existsSync(summaryFile)
    ? readFileSync(summaryFile, 'utf8')
    : '';
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
    calls,
    summary,
  };
}

function terraformCalls(outcome: Outcome): string[] {
  return outcome.calls.filter(
    (call) => !call.startsWith('curl ') && !call.startsWith('sleep '),
  );
}

describe('destroy-workloads.sh', () => {
  beforeEach(() => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'destroy-workloads-'));
  });

  afterEach(() => {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it('destroys previews before production, deletes previews and keeps production', () => {
    const outcome = runScript({
      workspaces: ['default', 'pr-12', 'pr-7', 'production'],
    });

    expect(outcome.status, outcome.output).toBe(0);
    expect(terraformCalls(outcome)).toEqual([
      'output kubeconfig',
      'output server_ipv4',
      'select pr-12',
      'destroy in pr-12',
      'select default',
      'delete pr-12',
      'select pr-7',
      'destroy in pr-7',
      'select default',
      'delete pr-7',
      'select production',
      'destroy in production',
      'select default',
    ]);
    expect(outcome.summary).toContain(
      '| pr-12 | 5 resources destroyed, workspace deleted |',
    );
    expect(outcome.summary).toContain(
      '| pr-7 | 5 resources destroyed, workspace deleted |',
    );
    expect(outcome.summary).toContain(
      '| production | 5 resources destroyed, workspace kept |',
    );
  });

  it('removes orphaned states without destroying when the cluster state has no kubeconfig', () => {
    const outcome = runScript({
      workspaces: ['default', 'pr-3', 'production'],
      kubeconfigPresent: false,
    });

    expect(outcome.status, outcome.output).toBe(0);
    expect(terraformCalls(outcome)).toEqual([
      'output kubeconfig',
      'select pr-3',
      'select default',
      'delete -force pr-3',
      'select production',
      'select default',
      'delete -force production',
    ]);
    expect(outcome.output).toContain(
      'The cluster state has no kubeconfig output',
    );
    expect(outcome.summary).toContain(
      '| production | cluster unreachable: state with 5 resources removed, workspace deleted |',
    );
  });

  it('treats a cluster whose API server does not answer three probes as gone', () => {
    const outcome = runScript({
      workspaces: ['default', 'production'],
      apiServerAnswers: false,
    });

    expect(outcome.status, outcome.output).toBe(0);
    expect(
      outcome.calls.filter((call) => call.startsWith('curl ')),
    ).toHaveLength(3);
    expect(outcome.calls.filter((call) => call.startsWith('sleep '))).toEqual([
      'sleep 10',
      'sleep 10',
    ]);
    expect(terraformCalls(outcome)).toEqual([
      'output kubeconfig',
      'output server_ipv4',
      'select production',
      'select default',
      'delete -force production',
    ]);
  });

  it('stops at a failing destroy, leaves the rest untouched and still writes the summary', () => {
    const outcome = runScript({
      workspaces: ['default', 'pr-1', 'pr-2', 'production'],
      failDestroyIn: 'pr-2',
    });

    expect(outcome.status).toBe(1);
    expect(terraformCalls(outcome)).toEqual([
      'output kubeconfig',
      'output server_ipv4',
      'select pr-1',
      'destroy in pr-1',
      'select default',
      'delete pr-1',
      'select pr-2',
      'destroy in pr-2',
      'select default',
    ]);
    expect(outcome.output).toContain('::endgroup::');
    expect(outcome.output).toContain(
      '::error::Destroying workspace pr-2 failed with exit code 1.',
    );
    expect(outcome.summary).toContain(
      '| pr-1 | 5 resources destroyed, workspace deleted |',
    );
    expect(outcome.summary).toContain(
      '| pr-2 | failed with exit code 1, see the log |',
    );
    expect(outcome.summary).toContain(
      '| production | not touched because pr-2 failed |',
    );
  });

  it('does nothing when only the default workspace exists', () => {
    const outcome = runScript({ workspaces: ['default'] });

    expect(outcome.status, outcome.output).toBe(0);
    expect(terraformCalls(outcome)).toEqual([]);
    expect(outcome.summary).toContain('No workspace besides default existed.');
  });
});
