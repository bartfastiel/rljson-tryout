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
  pullRequestStates: Record<number, string>;
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
    scriptName: 'sweep-previews.sh',
    cwd: workloadsDirectory,
    doubles: {
      'destroy-workloads': ['terraform', 'curl', 'sleep'],
      'sweep-previews': ['gh'],
    },
    binDirectory: join(temporaryDirectory, 'bin'),
    logFile: join(temporaryDirectory, 'calls.log'),
    environment: {
      FAKE_STATE_DIRECTORY: posixPath(stateDirectory),
      FAKE_WORKSPACES: scenario.workspaces.join(' '),
      FAKE_KUBECONFIG_PRESENT: 'yes',
      FAKE_API_ANSWERS: 'yes',
      FAKE_FAIL_DESTROY_IN: scenario.failDestroyIn ?? '',
      FAKE_FAIL_WORKSPACE_LIST: scenario.failWorkspaceList ? 'yes' : 'no',
      FAKE_PULL_REQUEST_STATES: Object.entries(scenario.pullRequestStates)
        .map(([number, state]) => `${number}=${state}`)
        .join(' '),
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
    (call) =>
      !call.startsWith('curl ') &&
      !call.startsWith('sleep ') &&
      !call.startsWith('gh '),
  );
}

beforeEach(() => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), 'sweep-previews-'));
});

afterEach(() => {
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe('sweep-previews.sh', () => {
  it('destroys the previews of merged and closed pull requests and keeps the open ones', () => {
    const outcome = runScript({
      workspaces: ['default', 'pr-3', 'pr-5', 'pr-8', 'production'],
      pullRequestStates: { 3: 'MERGED', 5: 'OPEN', 8: 'CLOSED' },
    });

    expect(outcome.status, outcome.output).toBe(0);
    expect(outcome.calls.filter((call) => call.startsWith('gh '))).toEqual([
      'gh pr view 3 --json state --jq .state',
      'gh pr view 5 --json state --jq .state',
      'gh pr view 8 --json state --jq .state',
    ]);
    expect(terraformCalls(outcome)).toEqual([
      'output kubeconfig',
      'output server_ipv4',
      'select pr-3',
      'destroy in pr-3',
      'select default',
      'delete pr-3',
      'select pr-8',
      'destroy in pr-8',
      'select default',
      'delete pr-8',
    ]);
    expect(outcome.summary).toContain('## Preview sweep');
    expect(outcome.summary).toContain('| pr-3 | #3 | merged | destroyed |');
    expect(outcome.summary).toContain('| pr-5 | #5 | open | kept |');
    expect(outcome.summary).toContain('| pr-8 | #8 | closed | destroyed |');
    expect(outcome.summary).toContain(
      '| pr-3 | 5 resources destroyed, workspace deleted |',
    );
    expect(outcome.summary.indexOf('## Preview sweep')).toBeLessThan(
      outcome.summary.indexOf('## Workloads'),
    );
    expect(outcome.summary).not.toContain('| production |');
  });

  it('reports a failed destroy in its own table and fails', () => {
    const outcome = runScript({
      workspaces: ['default', 'pr-3', 'pr-8'],
      pullRequestStates: { 3: 'MERGED', 8: 'CLOSED' },
      failDestroyIn: 'pr-8',
    });

    expect(outcome.status).toBe(1);
    expect(outcome.summary).toContain(
      '| pr-3 | #3 | merged | destroy failed with exit code 1, see the Workloads table |',
    );
    expect(outcome.summary).toContain(
      '| pr-8 | #8 | closed | destroy failed with exit code 1, see the Workloads table |',
    );
    expect(outcome.summary).toContain(
      '| pr-3 | 5 resources destroyed, workspace deleted |',
    );
    expect(outcome.summary).toContain(
      '| pr-8 | failed with exit code 1, see the log |',
    );
  });

  it('fails when the workspaces cannot be listed instead of reporting no preview', () => {
    const outcome = runScript({
      workspaces: ['default', 'pr-3'],
      pullRequestStates: { 3: 'MERGED' },
      failWorkspaceList: true,
    });

    expect(outcome.status).toBe(1);
    expect(outcome.calls).toHaveLength(0);
    expect(outcome.output).toContain(
      'Error: the fake workspace list fails on purpose',
    );
    expect(outcome.summary).toBe('');
  });

  it('does nothing when every preview belongs to an open pull request', () => {
    const outcome = runScript({
      workspaces: ['default', 'pr-5', 'production'],
      pullRequestStates: { 5: 'OPEN' },
    });

    expect(outcome.status, outcome.output).toBe(0);
    expect(terraformCalls(outcome)).toEqual([]);
    expect(outcome.output).toContain(
      'Every preview belongs to an open pull request; nothing to destroy.',
    );
    expect(outcome.summary).not.toContain('## Workloads');
  });

  it('reports when no preview workspace exists', () => {
    const outcome = runScript({
      workspaces: ['default', 'production'],
      pullRequestStates: {},
    });

    expect(outcome.status, outcome.output).toBe(0);
    expect(outcome.calls).toHaveLength(0);
    expect(outcome.summary).toContain('No preview workspace exists.');
  });

  it('keeps a preview whose pull request state cannot be read and fails after destroying the others', () => {
    const outcome = runScript({
      workspaces: ['default', 'pr-3', 'pr-4', 'production'],
      pullRequestStates: { 3: 'CLOSED' },
    });

    expect(outcome.status).toBe(1);
    expect(terraformCalls(outcome)).toEqual([
      'output kubeconfig',
      'output server_ipv4',
      'select pr-3',
      'destroy in pr-3',
      'select default',
      'delete pr-3',
    ]);
    expect(outcome.summary).toContain(
      '| pr-4 | #4 | could not be read: GraphQL: Could not resolve to a PullRequest with the number of 4. (repository.pullRequest) | kept |',
    );
    expect(outcome.output).toContain(
      '::error::The pull request state of pr-4 could not be read; these previews were kept.',
    );
  });

  it('keeps a preview whose pull request reports an unexpected state', () => {
    const outcome = runScript({
      workspaces: ['default', 'pr-6'],
      pullRequestStates: { 6: 'DRAFT' },
    });

    expect(outcome.status).toBe(1);
    expect(terraformCalls(outcome)).toEqual([]);
    expect(outcome.summary).toContain(
      '| pr-6 | #6 | unexpected state DRAFT | kept |',
    );
  });
});
