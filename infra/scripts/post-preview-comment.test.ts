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

const marker = '<!-- rljson-tryout-preview -->';
const previewUrl = 'https://node1-pr-42.example.org';
const deployedCommit = '8c95897323ad88221e43f88f281d86b6f13520cd';

type Comment = { id: number; body: string };

type Scenario = {
  status?: string;
  deploymentUrls?: string;
  deployedCommit?: string;
  comments?: Comment[];
};

type Outcome = ShellOutcome & {
  posted: string | undefined;
  patched: Record<string, string>;
};

let temporaryDirectory: string;

function readPayloadBody(file: string): string {
  return (JSON.parse(readFileSync(file, 'utf8')) as { body: string }).body;
}

function runScript(scenario: Scenario): Outcome {
  const stateDirectory = join(temporaryDirectory, 'state');
  mkdirSync(stateDirectory, { recursive: true });

  const outcome = runShellScript({
    scriptName: 'post-preview-comment.sh',
    doubles: { 'post-preview-comment': ['gh'] },
    binDirectory: join(temporaryDirectory, 'bin'),
    logFile: join(temporaryDirectory, 'calls.log'),
    environment: {
      FAKE_STATE_DIRECTORY: posixPath(stateDirectory),
      FAKE_COMMENTS: JSON.stringify(scenario.comments ?? []),
      GITHUB_REPOSITORY: 'example/repository',
      PULL_REQUEST_NUMBER: '42',
      PREVIEW_STATUS: scenario.status ?? 'deployed',
      DEPLOYMENT_URLS: scenario.deploymentUrls,
      DEPLOYED_COMMIT: scenario.deployedCommit,
    },
  });

  const postFile = join(stateDirectory, 'post.json');
  const patched: Record<string, string> = {};
  for (const comment of scenario.comments ?? []) {
    const patchFile = join(stateDirectory, `patch-${comment.id}.json`);
    if (existsSync(patchFile)) {
      patched[comment.id] = readPayloadBody(patchFile);
    }
  }
  return {
    ...outcome,
    posted: existsSync(postFile) ? readPayloadBody(postFile) : undefined,
    patched,
  };
}

function deployed(scenario: Scenario = {}): Scenario {
  return {
    status: 'deployed',
    deploymentUrls: previewUrl,
    deployedCommit,
    ...scenario,
  };
}

beforeEach(() => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), 'post-preview-comment-'));
});

afterEach(() => {
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe('post-preview-comment.sh', () => {
  it('creates the comment with the marker, the links, the commit and the staging note', () => {
    const outcome = runScript(
      deployed({ comments: [{ id: 1, body: 'Looks good to me.' }] }),
    );

    expect(outcome.status, outcome.output).toBe(0);
    expect(outcome.posted).toBeDefined();
    expect(outcome.posted?.startsWith(`${marker}\n`)).toBe(true);
    expect(outcome.posted).toContain('## Preview environment');
    expect(outcome.posted).toContain(`Commit \`${deployedCommit}\``);
    expect(outcome.posted).toContain('namespace `pr-42`');
    expect(outcome.posted).toContain(
      `- ${previewUrl}/ ([health](${previewUrl}/health), [species](${previewUrl}/api/species))`,
    );
    expect(outcome.posted).toContain(
      'staging** issuer: the browser shows a warning once per preview, accept it',
    );
    expect(outcome.posted).toContain(
      'destroyed when this pull request is closed',
    );
    expect(outcome.patched).toEqual({});
    expect(outcome.output).toContain(
      'Created the preview comment: https://github.com/example/repository/pull/1#issuecomment-999',
    );
    expect(outcome.calls[0]).toBe(
      `gh api repos/example/repository/issues/42/comments --paginate --jq .[] | select(.body | contains("${marker}")) | .id`,
    );
  });

  it('lists every deployment URL', () => {
    const outcome = runScript(
      deployed({ deploymentUrls: `${previewUrl} https://pr-42.example.org` }),
    );

    expect(outcome.status, outcome.output).toBe(0);
    expect(outcome.posted).toContain(`- ${previewUrl}/ (`);
    expect(outcome.posted).toContain('- https://pr-42.example.org/ (');
  });

  it('updates the comment that carries the marker instead of adding one', () => {
    const outcome = runScript(
      deployed({
        comments: [
          { id: 7, body: 'A review comment' },
          { id: 8, body: `${marker}\n## Preview environment\n\nold text` },
          { id: 9, body: `${marker}\nan unexpected duplicate` },
        ],
      }),
    );

    expect(outcome.status, outcome.output).toBe(0);
    expect(outcome.posted).toBeUndefined();
    expect(Object.keys(outcome.patched)).toEqual(['8']);
    expect(outcome.patched['8']).toContain(`Commit \`${deployedCommit}\``);
    expect(outcome.output).toContain(
      'Updated the preview comment: https://github.com/example/repository/pull/1#issuecomment-8',
    );
  });

  it('rewrites the comment when the preview was destroyed', () => {
    const outcome = runScript({
      status: 'destroyed',
      comments: [{ id: 8, body: `${marker}\nold text` }],
    });

    expect(outcome.status, outcome.output).toBe(0);
    expect(outcome.posted).toBeUndefined();
    expect(outcome.patched['8']?.startsWith(`${marker}\n`)).toBe(true);
    expect(outcome.patched['8']).toContain(
      'Destroyed after the pull request was closed: namespace `pr-42` and its Terraform workspace are gone.',
    );
  });

  it('adds no comment about a destroyed preview that was never announced', () => {
    const outcome = runScript({
      status: 'destroyed',
      comments: [{ id: 1, body: 'Looks good to me.' }],
    });

    expect(outcome.status, outcome.output).toBe(0);
    expect(outcome.posted).toBeUndefined();
    expect(outcome.patched).toEqual({});
    expect(outcome.output).toContain(
      'Pull request 42 has no preview comment; nothing to update.',
    );
  });

  it('refuses an unknown status before calling gh', () => {
    const outcome = runScript({ status: 'paused' });

    expect(outcome.status).toBe(1);
    expect(outcome.output).toContain(
      '::error::PREVIEW_STATUS must be deployed or destroyed, got: paused',
    );
    expect(outcome.calls).toHaveLength(0);
  });

  it.each([
    ['DEPLOYMENT_URLS', deployed({ deploymentUrls: undefined })],
    ['DEPLOYED_COMMIT', deployed({ deployedCommit: undefined })],
  ])('refuses a deployment without %s', (variable, scenario) => {
    const outcome = runScript(scenario);

    expect(outcome.status).toBe(1);
    expect(outcome.output).toContain(`${variable} must`);
    expect(outcome.calls).toHaveLength(0);
  });

  it('refuses deployment URLs that are only whitespace', () => {
    const outcome = runScript(deployed({ deploymentUrls: '  ' }));

    expect(outcome.status).toBe(1);
    expect(outcome.output).toContain('::error::DEPLOYMENT_URLS holds no URL');
    expect(outcome.calls).toHaveLength(0);
  });
});
