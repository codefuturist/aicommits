import { execa } from 'execa';
import { green, yellow, dim } from 'kolorist';
import { spinner, confirm, isCancel } from '@clack/prompts';
import type { ValidConfig } from './config-types.js';

export const runPostCommit = async (
	config: ValidConfig,
	interactive: boolean,
): Promise<void> => {
	const postCommit = config['post-commit'];
	if (!postCommit) return;

	const commands = postCommit
		.split(';')
		.map((c) => c.trim())
		.filter(Boolean);

	if (commands.length === 0) return;

	// In interactive mode, confirm before running
	if (interactive) {
		const proceed = await confirm({
			message: `Run post-commit: ${dim(postCommit)}`,
		});
		if (isCancel(proceed) || !proceed) return;
	}

	for (const cmd of commands) {
		const s = spinner();
		s.start(`Running: ${cmd}`);
		try {
			await execa(cmd, { shell: true, stdio: 'pipe' });
			s.stop(`${green('✔')} Post-commit: ${cmd}`);
		} catch (error: unknown) {
			const msg = error instanceof Error ? error.message : String(error);
			s.stop(`${yellow('⚠')} Post-commit failed: ${cmd}`);
			console.log(`  ${dim(msg)}`);
		}
	}
};
