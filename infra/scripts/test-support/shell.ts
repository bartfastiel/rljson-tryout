import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from 'node:fs';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const scriptsDirectory = fileURLToPath(new URL('../', import.meta.url));

// Git Bash accepts forward slashes in Windows paths, so the fake binaries
// and the script agree on every file they exchange.
export function posixPath(path: string): string {
  return path.replaceAll('\\', '/');
}

export type ShellOutcome = {
  status: number | null;
  output: string;
  calls: string[];
};

export type ShellRun = {
  scriptName: string;
  arguments?: string[];
  cwd?: string;
  environment: Record<string, string | undefined>;
  /** Test double directory name under test-doubles/ and the binaries taken from it. */
  doubles: Record<string, string[]>;
  binDirectory: string;
  logFile: string;
};

/**
 * Runs `infra/scripts/<scriptName>` with the named test doubles first on
 * PATH. Every double records its calls in FAKE_LOG, returned as `calls`.
 */
export function runShellScript(run: ShellRun): ShellOutcome {
  mkdirSync(run.binDirectory, { recursive: true });
  for (const [doublesName, binaries] of Object.entries(run.doubles)) {
    for (const binary of binaries) {
      const target = join(run.binDirectory, binary);
      copyFileSync(
        join(scriptsDirectory, 'test-doubles', doublesName, `${binary}.sh`),
        target,
      );
      chmodSync(target, 0o755);
    }
  }

  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries({
    ...process.env,
    ...run.environment,
  })) {
    if (value !== undefined) {
      environment[name] = value;
    }
  }
  environment['PATH'] =
    `${run.binDirectory}${delimiter}${process.env['PATH'] ?? ''}`;
  environment['FAKE_LOG'] = posixPath(run.logFile);

  const result = spawnSync(
    bash,
    [
      posixPath(join(scriptsDirectory, run.scriptName)),
      ...(run.arguments ?? []),
    ],
    { cwd: run.cwd, encoding: 'utf8', env: environment },
  );
  const calls = existsSync(run.logFile)
    ? readFileSync(run.logFile, 'utf8').trimEnd().split('\n')
    : [];
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
    calls,
  };
}
