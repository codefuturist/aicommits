import { command } from 'cleye';
import { red } from 'kolorist';
import { hasOwn, getConfig, setConfigs } from '../utils/config.js';
import { KnownError, handleCliError } from '../utils/error.js';

export default command(
	{
		name: 'config',

		parameters: ['[mode]', '[key=value...]'],
	},
	(argv) => {
		(async () => {
			const { mode, keyValue: keyValues } = argv._;

			// If no mode provided, show all current config (excluding defaults)
			if (!mode) {
				const config = await getConfig({}, true);
				const sensitiveKeys = ['OPENAI_API_KEY', 'TOGETHER_API_KEY', 'api-key'];

				// Default values to exclude from display
				const defaults = {
					locale: 'en',
					generate: 1,
					type: '',
					timeout: 10_000,
					'max-length': 72,
					model: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
					'openai-model': 'gpt-5-mini',
					'together-model': 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
					provider: undefined, // Show provider when set
				};

				console.log('Current configuration:');
				let hasConfig = false;

				for (const [key, value] of Object.entries(config)) {
					// Skip undefined/null/empty values and default values
					if (value === undefined || value === null || value === '') continue;
					if (defaults[key as keyof typeof defaults] === value) continue;

					hasConfig = true;
					const displayValue = sensitiveKeys.includes(key)
						? `${String(value).substring(0, 4)}****`
						: String(value);
					console.log(`  ${key}=${displayValue}`);
				}

				if (!hasConfig) {
					console.log('  (using all default values)');
				}
				return;
			}

			if (mode === 'get') {
				const config = await getConfig({}, true);
				const sensitiveKeys = ['OPENAI_API_KEY', 'TOGETHER_API_KEY', 'api-key'];
				for (const key of keyValues) {
					if (hasOwn(config, key)) {
						const value = config[key as keyof typeof config];
						const displayValue = sensitiveKeys.includes(key)
							? `${String(value).substring(0, 4)}****`
							: String(value);
						console.log(`${key}=${displayValue}`);
					}
				}
				return;
			}

			if (mode === 'set') {
				await setConfigs(
					keyValues.map((keyValue) => keyValue.split('=') as [string, string])
				);
				return;
			}

			throw new KnownError(`Invalid mode: ${mode}`);
		})().catch((error) => {
			console.error(`${red('✖')} ${error.message}`);
			handleCliError(error);
			process.exit(1);
		});
	}
);
