import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  posixPath,
  runShellScript,
  type ShellOutcome,
} from './test-support/shell.ts';

type Scenario = {
  workspaces: string[];
  arguments?: string[];
  kubeconfigPresent?: boolean;
  apiServerAnswers?: boolean;
  failDestroyIn?: string;
  failWorkspaceList?: boolean;
};

type Outcome = ShellOutcome & { summary: string };

let temporaryDirectory: string;

function runScript(scenario: Scenario): Outcome {
  const stateDirectory = join(temporaryDirectory, 'state');
  const workloadsDirectory = join(temporaryDirectory, 'workloads');
  const summaryFile = join(temporaryDirectory, 'summary.md');
  for (const directory of [stateDirectory, workloadsDirectory]) {
    mkdirSync(directory, { recursive: true });
  }

  const outcome = runShellScript({
    scriptName: 'destroy-workloads.sh',
    arguments: scenario.arguments,
    cwd: workloadsDirectory,
    doubles: { 'destroy-workloads': ['terraform', 'curl', 'sleep'] },
    binDirectory: join(temporaryDirectory, 'bin'),
    logFile: join(temporaryDirectory, 'calls.log'),
    environment: {
      FAKE_STATE_DIRECTORY: posixPath(stateDirectory),
      FAKE_WORKSPACES: scenario.workspaces.join(' '),
      FAKE_KUBECONFIG_PRESENT:
        scenario.kubeconfigPresent === false ? 'no' : 'yes',
      FAKE_API_ANSWERS: scenario.apiServerAnswers === false ? 'no' : 'yes',
      FAKE_FAIL_DESTROY_IN: scenario.failDestroyIn ?? '',
      FAKE_FAIL_WORKSPACE_LIST: scenario.failWorkspaceList ? 'yes' : 'no',
      GITHUB_STEP_SUMMARY: posixPath(summaryFile),
    },
  });
  const summary = existsSync(summaryFile)
    ? readFileSync(summaryFile, 'utf8')
    : '';
  return { ...outcome, summary };
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

  it('reports a failure before the first workspace without an empty table', () => {
    const outcome = runScript({
      workspaces: ['default', 'production'],
      failWorkspaceList: true,
    });

    expect(outcome.status).toBe(1);
    expect(terraformCalls(outcome)).toEqual([]);
    expect(outcome.summary).toContain(
      'The script failed with exit code 1 before any workspace was touched, see the log.',
    );
    expect(outcome.summary).not.toContain('| Workspace | Result |');
  });

  it('does nothing when only the default workspace exists', () => {
    const outcome = runScript({ workspaces: ['default'] });

    expect(outcome.status, outcome.output).toBe(0);
    expect(terraformCalls(outcome)).toEqual([]);
    expect(outcome.summary).toContain('No workspace besides default existed.');
  });

  describe('with workspace names as arguments', () => {
    it('destroys only the named workspaces and reports the ones that do not exist', () => {
      const outcome = runScript({
        workspaces: ['default', 'pr-3', 'pr-5', 'production'],
        arguments: ['pr-5', 'pr-9', 'pr-5'],
      });

      expect(outcome.status, outcome.output).toBe(0);
      expect(terraformCalls(outcome)).toEqual([
        'output kubeconfig',
        'output server_ipv4',
        'select pr-5',
        'destroy in pr-5',
        'select default',
        'delete pr-5',
      ]);
      expect(outcome.output).toContain(
        'Workspace pr-9 does not exist; nothing to destroy.',
      );
      expect(outcome.summary).toContain(
        '| pr-9 | does not exist, nothing to destroy |',
      );
      expect(outcome.summary).toContain(
        '| pr-5 | 5 resources destroyed, workspace deleted |',
      );
      expect(outcome.summary).not.toContain('pr-3');
      expect(outcome.summary).not.toContain('production');
    });

    it('orders named previews before production and keeps production', () => {
      const outcome = runScript({
        workspaces: ['default', 'pr-1', 'production'],
        arguments: ['production', 'pr-1'],
      });

      expect(outcome.status, outcome.output).toBe(0);
      expect(terraformCalls(outcome)).toEqual([
        'output kubeconfig',
        'output server_ipv4',
        'select pr-1',
        'destroy in pr-1',
        'select default',
        'delete pr-1',
        'select production',
        'destroy in production',
        'select default',
      ]);
      expect(outcome.summary).toContain(
        '| production | 5 resources destroyed, workspace kept |',
      );
    });

    it('succeeds without touching Terraform when none of the named workspaces exists', () => {
      const outcome = runScript({
        workspaces: ['default', 'production'],
        arguments: ['pr-9'],
      });

      expect(outcome.status, outcome.output).toBe(0);
      expect(terraformCalls(outcome)).toEqual([]);
      expect(outcome.summary).toContain('| Workspace | Result |');
      expect(outcome.summary).toContain(
        '| pr-9 | does not exist, nothing to destroy |',
      );
      expect(outcome.summary).not.toContain('No workspace besides default');
    });

    it.each([['default'], ['Pr-1'], ['pr 1'], ['-pr-1']])(
      'refuses the workspace name %s before touching anything',
      (name) => {
        const outcome = runScript({
          workspaces: ['default', 'production'],
          arguments: [name],
        });

        expect(outcome.status).toBe(2);
        expect(outcome.calls).toEqual([]);
        expect(outcome.output).toContain(
          `::error::"${name}" is not a workspace this script destroys`,
        );
      },
    );
  });
});
