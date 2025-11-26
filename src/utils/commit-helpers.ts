const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const retry = async <T>(fn: () => Promise<T>, attempts: number = 3, delay: number = 1000): Promise<T> => {
	for (let i = 0; i < attempts; i++) {
		try {
			return await fn();
		} catch (error) {
			if (i === attempts - 1) throw error;
			await sleep(delay);
		}
	}
	throw new Error('Retry failed');
};

export const getCommitMessage = async (
	messages: string[],
	skipConfirm: boolean
): Promise<string | null> => {
	const { select, confirm, isCancel } = await import('@clack/prompts');
	const { dim } = await import('kolorist');

	// Single message case
	if (messages.length === 1) {
		const [message] = messages;

		if (skipConfirm) {
			return message;
		}

		console.log(`\n\x1b[1m${message}\x1b[0m\n`);
		const confirmed = await confirm({
			message: 'Use this commit message?',
		});

		return confirmed && !isCancel(confirmed) ? message : null;
	}

	// Multiple messages case
	if (skipConfirm) {
		return messages[0];
	}

	const selected = await select({
		message: `Pick a commit message to use: ${dim('(Ctrl+c to exit)')}`,
		options: messages.map((value) => ({ label: value, value })),
	});

	return isCancel(selected) ? null : (selected as string);
};