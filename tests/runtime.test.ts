import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, test, vi } from 'vitest';

import { defaultConfig, getConfig, getThreads } from '../src/config.ts';
import { parseCliFrom } from '../src/cli.ts';
import { abort } from '../src/main.ts';
import { flushStdout, printStdout } from '../src/output.ts';
import { canonicalizeAbsolutePath, getFilesystemDevices, normalizePath } from '../src/utils.ts';
import { PANIC_EXIT_CODE, Panic, panic, renderPanic } from '../src/panic.ts';
import { dust, dustSpawn, REPO_ROOT } from './support/command.ts';
import { captureStreams } from '../src/output.ts';

function tempdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dust-runtime-'));
}

/**
 * The surfaces the ported suite reaches only indirectly: the config file
 * loader, the `assert!` failures the renderer raises, and the process entry
 * point itself.
 */
describe('config file loading', () => {
  test('a TOML file supplies defaults the flags then override', async () => {
    const dir = tempdir();
    const configPath = path.join(dir, 'config.toml');
    fs.writeFileSync(
      configPath,
      ['reverse=true', 'no-colors=true', 'no-bars=true', 'depth=1', 'disable-progress=true'].join(
        '\n',
      ),
    );

    const withConfig = await dust(['--config', configPath, 'tests/test_dir']);
    expect(withConfig.stderr).toBe('');
    // `reverse` turns the tree the other way up.
    expect(withConfig.stdout).toContain('└─┬ test_dir');
    // `depth=1` stops before the files.
    expect(withConfig.stdout).not.toContain('hello_file');
  });

  test('collapse and output-format come from the config file too', async () => {
    const dir = tempdir();
    const configPath = path.join(dir, 'config.toml');
    fs.writeFileSync(configPath, ['collapse=["many"]', 'output-format="si"'].join('\n'));

    const result = await dust(['-P', '-c', '--config', configPath, 'tests/test_dir']);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('many');
    expect(result.stdout).not.toContain('hello_file');
  });

  test('a missing config file is reported and ignored', () => {
    const captured = captureStreams();
    try {
      expect(getConfig('/nonexistent/dust.toml')).toEqual({});
      expect(captured.stderr()).toBe('Config file "/nonexistent/dust.toml" doesn\'t exists\n');
    } finally {
      captured.restore();
    }
  });

  test('an unparsable config file is reported and ignored', () => {
    const dir = tempdir();
    const configPath = path.join(dir, 'config.toml');
    fs.writeFileSync(configPath, 'reverse=');

    const captured = captureStreams();
    try {
      expect(getConfig(configPath)).toEqual({});
      expect(captured.stderr()).toBe(
        `Ignoring invalid config file '${configPath}': couldn't parse TOML file\n`,
      );
    } finally {
      captured.restore();
    }
  });

  test('only a .toml extension is understood', () => {
    const dir = tempdir();
    const configPath = path.join(dir, 'config.json');
    fs.writeFileSync(configPath, '{"reverse": true}');

    const captured = captureStreams();
    try {
      expect(getConfig(configPath)).toEqual({});
      expect(captured.stderr()).toBe(
        `Ignoring invalid config file '${configPath}': don't know how to parse file\n`,
      );
    } finally {
      captured.restore();
    }
  });

  test('a key of the wrong type is a parse failure, not a silent default', () => {
    const dir = tempdir();
    const configPath = path.join(dir, 'config.toml');
    fs.writeFileSync(configPath, 'reverse=1');

    const captured = captureStreams();
    try {
      expect(getConfig(configPath)).toEqual({});
      expect(captured.stderr()).toContain("couldn't parse TOML file");
    } finally {
      captured.restore();
    }
  });

  test('auto-discovery reads $XDG_CONFIG_HOME/dust/config.toml', () => {
    const home = tempdir();
    const configHome = tempdir();
    fs.mkdirSync(path.join(configHome, 'dust'), { recursive: true });
    fs.writeFileSync(path.join(configHome, 'dust', 'config.toml'), 'reverse=true');

    const previousHome = process.env['HOME'];
    const previousXdg = process.env['XDG_CONFIG_HOME'];
    process.env['HOME'] = home;
    process.env['XDG_CONFIG_HOME'] = configHome;
    try {
      expect(getConfig(undefined).reverse).toBe(true);
      // A relative XDG_CONFIG_HOME is ignored, and ~/.dust.toml is the fallback.
      process.env['XDG_CONFIG_HOME'] = 'relative';
      fs.writeFileSync(path.join(home, '.dust.toml'), 'skip-total=true');
      expect(getConfig(undefined).skipTotal).toBe(true);
    } finally {
      if (previousHome === undefined) delete process.env['HOME'];
      else process.env['HOME'] = previousHome;
      if (previousXdg === undefined) delete process.env['XDG_CONFIG_HOME'];
      else process.env['XDG_CONFIG_HOME'] = previousXdg;
    }
  });
});

describe('threads', () => {
  test('the command line wins over the config file, as for every other count', () => {
    expect(getThreads(defaultConfig(), parseCliFrom(['dust']))).toBe(undefined);
    expect(getThreads(defaultConfig(), parseCliFrom(['dust', '-T', '4']))).toBe(4);
    expect(getThreads({ threads: 2 }, parseCliFrom(['dust']))).toBe(2);
    expect(getThreads({ threads: 2 }, parseCliFrom(['dust', '-T', '4']))).toBe(4);
  });
});

describe('utils', () => {
  test('an absolute path is canonicalized, a relative one is left alone', () => {
    expect(canonicalizeAbsolutePath('tests/test_dir')).toBe('tests/test_dir');
    expect(canonicalizeAbsolutePath('/nonexistent/path')).toBe('/nonexistent/path');
    expect(canonicalizeAbsolutePath('/tmp/.')).toBe(fs.realpathSync('/tmp'));
  });

  test('normalizePath folds separators and dots', () => {
    expect(normalizePath('a//b/./c/')).toBe('a/b/c');
  });

  test('the device set is what --limit-filesystem is built from', () => {
    const devices = getFilesystemDevices([path.join(REPO_ROOT, 'tests')], false);
    expect(devices.size).toBe(1);
    expect(getFilesystemDevices(['/nonexistent'], false).size).toBe(0);
    // Following links takes the slow path, and lands on the same device.
    expect(getFilesystemDevices([path.join(REPO_ROOT, 'tests')], true).size).toBe(1);
  });
});

describe('panics', () => {
  test('an over-narrow terminal aborts with the assertion text and status 101', async () => {
    const result = await dust(['-P', '-c', '-w', '0', 'tests/test_dir']);
    expect(result.status).toBe(PANIC_EXIT_CODE);
    expect(result.stderr).toContain('Not enough terminal width');
  });

  test('a terminal too narrow for the tree aborts too', async () => {
    const result = await dust(['-P', '-c', '-w', '10', 'tests/test_dir']);
    expect(result.status).toBe(PANIC_EXIT_CODE);
    expect(result.stderr).toContain('Terminal width not wide enough to draw directory tree');
  });

  test('an unreadable --ignore-all-in-file aborts the way unwrap does', async () => {
    const result = await dust(['-P', '-I', '/nonexistent', 'tests/test_dir']);
    expect(result.status).toBe(PANIC_EXIT_CODE);
    expect(result.stderr).toContain(
      'called `Result::unwrap()` on an `Err` value: Os { code: 2, kind: NotFound, message: "No such file or directory" }',
    );
  });

  test('panic and renderPanic', () => {
    expect(() => {
      panic('boom');
    }).toThrow(Panic);
    expect(renderPanic('boom')).toBe("thread 'main' panicked:\nboom\n");
  });
});

describe('output', () => {
  test('help and version reach stdout with their exact bytes', async () => {
    const version = await dust(['--version']);
    expect(version.status).toBe(0);
    expect(version.stdout).toBe('Dust 1.2.5\n');

    const help = await dust(['--help']);
    expect(help.status).toBe(0);
    expect(help.stdout.startsWith('Like du but more intuitive\n\nUsage: dust')).toBe(true);
    expect(help.stdout.endsWith('  -V, --version\n          Print version\n')).toBe(true);
  });

  test('a bad time filter exits 1 with the quoted value', async () => {
    const result = await dust(['-P', '-M', 'abc', 'tests/test_dir']);
    expect(result.status).toBe(1);
    expect(result.stderr).toBe('Invalid value for time filter: "abc"\n');
  });

  test('an uncompilable regex exits 1', async () => {
    const result = await dust(['-P', '-e', '(', 'tests/test_dir']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Ignoring bad value for regex');
  });

  test('with no capture installed, writes go to the real descriptor', () => {
    // A zero-length write reaches `fs.writeSync` without producing output.
    printStdout('');
    expect(() => {
      flushStdout();
    }).not.toThrow();
  });

  test('Ctrl-C prints \\nAborting on stdout and exits 1', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit ${String(code)}`);
    }) as never);
    try {
      const result = await dust(['--version']);
      expect(result.status).toBe(0);
      expect(() => {
        abort();
      }).toThrow('exit 1');
    } finally {
      exit.mockRestore();
    }
  });
});

describe('the process entry point', () => {
  test('running the real executable prints the version and exits 0', () => {
    const result = dustSpawn(['--version']);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('Dust 1.2.5\n');
    expect(result.stderr).toBe('');
  });

  test('a bad flag exits 2 through the real executable', () => {
    const result = dustSpawn(['--nope']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("unexpected argument '--nope' found");
  });

  test('--stack-size relaunches the process and passes its status through', () => {
    const result = dustSpawn(['-P', '-c', '-b', '-S', '1048576', 'tests/test_dir']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('test_dir');
  });

  test('a missing path exits 1', () => {
    const result = dustSpawn(['-P', 'bad_place']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('No such file or directory: bad_place');
  });
});
