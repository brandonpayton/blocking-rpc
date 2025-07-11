import { run } from 'node:test';
import { spec } from 'node:test/reporters';
import { resolve as resolvePath } from 'node:path';
import { parentPort } from 'node:worker_threads';

parentPort!.postMessage('worker-started');

run({
	cwd: resolvePath(import.meta.dirname, '..', 'src'),
	globPatterns: [
		'**/*.test.ts',
	]
})
	.on('test:fail', () => {
		process.exitCode = 1;
	})
	.compose(spec)
	.pipe(process.stdout)
