import { command } from 'cleye';
import { execSync } from 'child_process';
import { existsSync, statSync, renameSync, unlinkSync } from 'fs';
import { resolve, join } from 'path';
import { platform, arch, tmpdir } from 'os';
import {
	green,
	yellow,
	red,
	dim,
	bold,
	cyan,
} from 'kolorist';
import {
	intro,
	outro,
	spinner,
	cancel,
	note,
} from '@clack/prompts';
import {
	getDefaultInstallDir,
	getProjectEntrypoint,
	getPathHint,
	getBinaryNames,
	hasPathConflicts,
	checkWriteable,
	type InstallScope,
} from '../utils/install-paths.js';
import { handleCommandError } from '../utils/error.js';

const TARGETS = [
	{ value: 'bun-darwin-arm64', label: 'macOS Apple Silicon (arm64)' },
	{ value: 'bun-darwin-x64', label: 'macOS Intel (x64)' },
	{ value: 'bun-linux-x64', label: 'Linux x64 (glibc)' },
	{ value: 'bun-linux-arm64', label: 'Linux ARM64 (glibc)' },
	{ value: 'bun-linux-x64-musl', label: 'Linux x64 (musl/Alpine)' },
	{ value: 'bun-linux-arm64-musl', label: 'Linux ARM64 (musl)' },
	{ value: 'bun-windows-x64', label: 'Windows x64' },
] as const;

function detectCurrentTarget(): string {
	const os = platform();
	const cpu = arch();
	if (os === 'darwin') return cpu === 'arm64' ? 'bun-darwin-arm64' : 'bun-darwin-x64';
	if (os === 'win32') return 'bun-windows-x64';
	return cpu === 'arm64' ? 'bun-linux-arm64' : 'bun-linux-x64';
}

function getBunPath(): string | null {
	try {
		return execSync('which bun', { encoding: 'utf8' }).trim();
	} catch {
		return null;
	}
}

function getBunVersion(): string | null {
	try {
		return execSync('bun --version', { encoding: 'utf8' }).trim();
	} catch {
		return null;
	}
}

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function compileBinary(options: {
	target?: string;
	outfile: string;
	minify?: boolean;
	bytecode?: boolean;
}): void {
	const entrypoint = resolve(getProjectEntrypoint());

	if (!existsSync(entrypoint)) {
		throw new Error(`Entry point not found: ${entrypoint}\nRun 'pnpm build' first.`);
	}

	const bunPath = getBunPath();
	if (!bunPath) {
		throw new Error(
			'Bun is required for binary compilation but was not found.\n'
			+ 'Install: curl -fsSL https://bun.sh/install | bash',
		);
	}

	const args = ['build', entrypoint, '--compile'];

	if (options.target) args.push(`--target=${options.target}`);
	if (options.minify !== false) args.push('--minify');
	if (options.bytecode !== false) args.push('--bytecode');

	args.push('--outfile', options.outfile);

	execSync(`${bunPath} ${args.join(' ')}`, {
		stdio: 'pipe',
		encoding: 'utf8',
	});
}

export default command(
	{
		name: 'compile',
		description: 'Compile a standalone native binary using Bun',
		help: {
			description: `Compile a standalone native binary using Bun

Produces a self-contained executable with no Node.js dependency.
Requires Bun to be installed on the build machine (not on the target).

Examples:
  aicommits compile                          Compile for current platform
  aicommits compile --target bun-linux-x64   Cross-compile for Linux x64
  aicommits compile --outfile ./my-binary    Custom output path
  aicommits compile --install                Compile + install to ~/.local/bin
  aicommits compile --install --scope system Compile + install to /usr/local/bin
  aicommits compile --list-targets           Show all cross-compile targets
  aicommits compile --no-minify              Skip minification
  aicommits compile --no-bytecode            Skip bytecode pre-compilation`,
		},
		parameters: [],
		flags: {
			target: {
				type: String,
				description: 'Cross-compile target (e.g. bun-linux-x64). Use --list-targets to see all.',
			},
			outfile: {
				type: String,
				alias: 'o',
				description: 'Output file path (default: ./aicommits or platform-appropriate name)',
			},
			install: {
				type: Boolean,
				description: 'Install the compiled binary to PATH after compilation',
				default: false,
			},
			scope: {
				type: String,
				description: 'Install scope when --install is used: "user" or "system"',
			},
			minify: {
				type: Boolean,
				description: 'Minify the bundle (default: true)',
				default: true,
			},
			bytecode: {
				type: Boolean,
				description: 'Pre-compile to bytecode for faster startup (default: true)',
				default: true,
			},
			listTargets: {
				type: Boolean,
				description: 'List all available cross-compile targets',
				default: false,
			},
		},
	},
	(argv) => {
		(async () => {
			// --list-targets: quick output and exit
			if (argv.flags.listTargets) {
				const current = detectCurrentTarget();
				console.log(bold('\nAvailable cross-compile targets:\n'));
				for (const t of TARGETS) {
					const marker = t.value === current ? green(' ← current') : '';
					console.log(`  ${cyan(t.value.padEnd(24))} ${t.label}${marker}`);
				}
				console.log(dim(`\n  Usage: aicommits compile --target <target>\n`));
				return;
			}

			intro(bold('aicommits compile'));

			// Check bun
			const bunPath = getBunPath();
			if (!bunPath) {
				cancel(
					'Bun is required for binary compilation but was not found.\n'
					+ '  Install: curl -fsSL https://bun.sh/install | bash',
				);
				process.exit(1);
			}

			const bunVersion = getBunVersion();
			console.log(dim(`  Using Bun ${bunVersion} (${bunPath})`));

			// Validate target
			const target = argv.flags.target;
			if (target) {
				const valid = TARGETS.some((t) => t.value === target);
				if (!valid) {
					cancel(`Unknown target "${target}". Run ${cyan('aicommits compile --list-targets')} to see options.`);
					process.exit(1);
				}
			}

			const currentTarget = target || detectCurrentTarget();
			const targetInfo = TARGETS.find((t) => t.value === currentTarget);
			const isWindows = currentTarget.includes('windows');
			const isCrossCompile = target && target !== detectCurrentTarget();

			// Determine output path
			let outfile: string;
			if (argv.flags.install) {
				// Compile to temp, then install atomically
				const scope = (argv.flags.scope || 'user') as InstallScope;
				if (scope !== 'user' && scope !== 'system') {
					cancel(`Invalid scope "${scope}". Use "user" or "system".`);
					process.exit(1);
				}
				const binDir = getDefaultInstallDir(scope);
				if (!existsSync(binDir)) {
					const { mkdirSync } = await import('fs');
					mkdirSync(binDir, { recursive: true, mode: 0o755 });
				}
				if (!checkWriteable(binDir)) {
					cancel(`Cannot write to ${binDir}. ${scope === 'system' ? 'Try with sudo.' : 'Check permissions.'}`);
					process.exit(1);
				}
				outfile = join(tmpdir(), `aicommits-compile-${Date.now()}`);
			} else if (argv.flags.outfile) {
				outfile = resolve(argv.flags.outfile);
			} else {
				outfile = resolve(isWindows ? 'aicommits.exe' : 'aicommits');
			}

			// Resolve entrypoint
			const entrypoint = resolve(getProjectEntrypoint());
			if (!existsSync(entrypoint)) {
				cancel(`Entry point not found: ${entrypoint}\nRun 'pnpm build' first.`);
				process.exit(1);
			}

			// Build args
			const args = ['build', entrypoint, '--compile'];
			if (target) args.push(`--target=${target}`);
			if (argv.flags.minify) args.push('--minify');
			if (argv.flags.bytecode) args.push('--bytecode');
			args.push('--outfile', outfile);

			// Compile
			const s = spinner();
			const label = isCrossCompile
				? `Compiling for ${targetInfo?.label || target}...`
				: 'Compiling native binary...';
			s.start(label);

			const startTime = Date.now();
			try {
				execSync(`${bunPath} ${args.join(' ')}`, {
					stdio: 'pipe',
					encoding: 'utf8',
				});
			} catch (err: unknown) {
				s.stop(red('✗ Compilation failed'));
				const msg = err instanceof Error ? (err as Error & { stderr?: string }).stderr || err.message : String(err);
				console.error(dim(msg));
				process.exit(1);
			}
			const elapsed = Date.now() - startTime;

			// Get binary size
			let sizeStr = '';
			try {
				const stat = statSync(outfile);
				sizeStr = formatSize(stat.size);
			} catch { /* ignore */ }

			s.stop(green(`✓ Compiled in ${elapsed}ms`));

			// Install flow
			if (argv.flags.install) {
				const scope = (argv.flags.scope || 'user') as InstallScope;
				const binDir = getDefaultInstallDir(scope);
				const names = getBinaryNames();
				const installed: string[] = [];

				for (const name of names) {
					const dest = join(binDir, isWindows ? `${name}.exe` : name);
					try {
						// Atomic: rename temp binary into place (overwrites existing)
						if (existsSync(dest)) unlinkSync(dest);
						renameSync(outfile, dest);
					} catch {
						// Cross-device: fall back to copy + delete
						const { copyFileSync } = await import('fs');
						copyFileSync(outfile, dest);
						try { unlinkSync(outfile); } catch { /* ignore */ }
					}
					const { chmodSync } = await import('fs');
					chmodSync(dest, 0o755);
					installed.push(dest);

					// For additional names, re-compile (rename only works for first)
					if (names.indexOf(name) < names.length - 1) {
						const nextOutfile = join(tmpdir(), `aicommits-compile-${Date.now()}`);
						try {
							execSync(`${bunPath} ${args.filter((a) => !a.startsWith('--outfile')).join(' ')} --outfile ${nextOutfile}`, {
								stdio: 'pipe',
							});
						} catch { break; }
						// Update outfile for next iteration
						Object.defineProperty(args, 'outfile', { value: nextOutfile });
					}
				}

				const lines = installed.map((p) => `  ${green('✓')} ${p} ${dim(`(${sizeStr})`)}`);

				const pathHint = getPathHint(binDir);
				if (pathHint) {
					lines.push('');
					lines.push(`  ${yellow('⚠')} ${binDir} is not in your PATH`);
					lines.push(`  ${dim(pathHint)}`);
				} else {
					lines.push(`  ${green('✓')} ${binDir} is in PATH`);
				}

				note(lines.join('\n'), 'Installed');

				if (hasPathConflicts()) {
					console.log(`  ${yellow('⚠')} Multiple aicommits binaries detected.`);
					console.log(dim(`    Run ${cyan('aicommits doctor --fix')} to resolve.\n`));
				}
			} else {
				// Just show compilation result
				const lines = [
					`  Binary:   ${bold(outfile)}`,
					`  Size:     ${sizeStr}`,
					`  Target:   ${currentTarget}${isCrossCompile ? dim(' (cross-compiled)') : ''}`,
					`  Minified: ${argv.flags.minify ? green('yes') : dim('no')}`,
					`  Bytecode: ${argv.flags.bytecode ? green('yes') : dim('no')}`,
				];
				note(lines.join('\n'), 'Compiled');
			}

			outro(`${green('✓')} Done`);
		})().catch(handleCommandError);
	},
);
