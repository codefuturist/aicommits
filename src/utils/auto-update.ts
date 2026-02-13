import { exec } from 'child_process';
import { promisify } from 'util';
import updateNotifier from 'update-notifier';

const execAsync = promisify(exec);

export interface AutoUpdateOptions {
	pkg: { name: string; version: string };
	distTag?: string;
	autoUpdate?: boolean;
}

export async function checkAndAutoUpdate(options: AutoUpdateOptions): Promise<void> {
	const { pkg, distTag = 'latest', autoUpdate = true } = options;

	if (pkg.version === '0.0.0-semantic-release') {
		return;
	}

	const notifier = updateNotifier({
		pkg,
		distTag: pkg.version.includes('-') ? 'develop' : distTag,
	});

	const update = notifier.update;

	if (!update || !autoUpdate) {
		if (update && !autoUpdate) {
			notifier.notify();
		}
		return;
	}

	// Check if running as global installation
	const isGlobal = await checkIfGlobalInstallation(pkg.name);
	if (!isGlobal) {
		// Can't auto-update local installations
		notifier.notify();
		return;
	}

	console.log(`Updating ${pkg.name} from v${update.current} to v${update.latest}...`);

	try {
		// Run npm update in background without blocking
		await runBackgroundUpdate(pkg.name);
		console.log(`✓ ${pkg.name} updated to v${update.latest}`);
		console.log('Please restart to use the new version.');
	} catch (error) {
		// If auto-update fails, just notify the user
		console.log('Auto-update failed. You can manually update with:');
		console.log(`  npm update -g ${pkg.name}`);
		notifier.notify();
	}
}

async function checkIfGlobalInstallation(packageName: string): Promise<boolean> {
	try {
		const { stdout } = await execAsync(`npm list -g ${packageName} --depth=0`);
		return stdout.includes(packageName);
	} catch {
		// If command fails, assume it's not global
		return false;
	}
}

async function runBackgroundUpdate(packageName: string): Promise<void> {
	// Use exec with detached option to run in background
	return new Promise((resolve, reject) => {
		const child = exec(`npm update -g ${packageName}`, {
			timeout: 60000, // 60 second timeout
			env: { ...process.env, NPM_CONFIG_PROGRESS: 'false' },
		});

		child.on('error', (error) => {
			reject(error);
		});

		child.on('exit', (code) => {
			if (code === 0 || code === null) {
				resolve();
			} else {
				reject(new Error(`npm update exited with code ${code}`));
			}
		});
	});
}

export function createNotifier(options: AutoUpdateOptions) {
	return {
		check: () => checkAndAutoUpdate(options),
	};
}
