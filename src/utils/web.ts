export const openWebUrl = (url: string) => {
	const platform = process.platform;
	const cmd =
		platform === 'darwin'
			? 'open'
			: platform === 'win32'
			? 'start'
			: 'xdg-open';
	try {
		require('execa')(cmd, [url]);
	} catch {}
};
