import { execa } from 'execa';
import clipboard from 'clipboardy';

export async function copyToClipboard(message: string): Promise<boolean> {
	try {
		if (process.platform === 'darwin') {
			await execa('pbcopy', { input: message });
		} else {
			await clipboard.write(message);
		}
		return true;
	} catch {
		return false;
	}
}