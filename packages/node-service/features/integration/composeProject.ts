import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const repositoryRoot = resolve(import.meta.dirname, '..', '..', '..', '..');

const composeFile = resolve(
  repositoryRoot,
  'deploy',
  'compose',
  'three-nodes.yml',
);

/**
 * Where the compose logs of the last run end up, so that a CI job can
 * upload them when the test fails (the containers are gone by then).
 */
export const composeLogFile = resolve(
  repositoryRoot,
  'packages',
  'node-service',
  'test-results',
  'compose',
  'three-nodes.log',
);

const hostPort = (variable: string, defaultPort: number): number =>
  Number(process.env[variable] ?? defaultPort);

/**
 * The three nodes of `deploy/compose/three-nodes.yml` as the host reaches
 * them: the service name and the mapped port (`NODE<n>_PORT`, defaulting
 * to 8301 to 8303 like the compose file does).
 */
export const composeNodes = [
  { name: 'node1', port: hostPort('NODE1_PORT', 8301) },
  { name: 'node2', port: hostPort('NODE2_PORT', 8302) },
  { name: 'node3', port: hostPort('NODE3_PORT', 8303) },
] as const;

/**
 * Drives the three-node compose project of this repository from a test:
 * `up` builds the image from the working tree unless `NODE_SERVICE_IMAGE`
 * names a pushed one, waits for the health checks and returns; `down`
 * saves the logs and removes containers, network and volumes.
 */
export class ComposeProject {
  private readonly projectName = 'rljson-tryout-integration';

  async up(): Promise<void> {
    const image = process.env.NODE_SERVICE_IMAGE;
    await this.compose([
      'up',
      '--detach',
      '--wait',
      '--wait-timeout',
      '180',
      image === undefined ? '--build' : '--no-build',
    ]);
  }

  /**
   * Restarts one service (`node1` to `node3`) and waits for its health
   * check: what a restart of a pod looks like to the other nodes.
   */
  async restart(service: string): Promise<void> {
    await this.compose(['restart', service]);
    await this.compose([
      'up',
      '--detach',
      '--wait',
      '--wait-timeout',
      '120',
      '--no-build',
      service,
    ]);
  }

  async saveLogs(): Promise<string> {
    const { stdout, stderr } = await this.compose(['logs', '--no-color']);
    mkdirSync(dirname(composeLogFile), { recursive: true });
    writeFileSync(composeLogFile, `${stdout}${stderr}`);
    return composeLogFile;
  }

  async down(): Promise<void> {
    await this.compose(['down', '--volumes', '--remove-orphans']);
  }

  private compose(
    args: readonly string[],
  ): Promise<{ stdout: string; stderr: string }> {
    return execFileAsync(
      'docker',
      [
        'compose',
        '--file',
        composeFile,
        '--project-name',
        this.projectName,
        ...args,
      ],
      {
        cwd: repositoryRoot,
        env: process.env,
        maxBuffer: 64 * 1024 * 1024,
      },
    );
  }
}
