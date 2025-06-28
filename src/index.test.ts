import { suite, test } from 'node:test';
import assert from 'node:assert';

import { Worker } from 'node:worker_threads';

function startWorker() {
	const worker = new Worker(new URL('./test/test-worker.ts', import.meta.url));
	return new Promise<Worker>((resolve, reject) => {
		function startedHandler(message: any) {
			if (message === 'worker-started') {
				worker.off('message', startedHandler);
				worker.off('error', errorHandler);
				resolve(worker);
			}
		}
		function errorHandler(error: any) {
			worker.off('message', startedHandler);
			worker.off('error', errorHandler);
			reject(error);
		}
		worker.on('message', startedHandler);
		worker.on('error', errorHandler);
	});
}

suite('Blocking RPC', () => {
	test('expose and call', async () => {
		let worker: Worker | undefined;
		try {
			worker = await startWorker();
			assert.ok(worker);

			// TODO: Here we would normally expose a value and call it.
			// For now, we just check that the worker starts.
		} finally {
			if (worker) {
				worker.terminate();
			}
		}
	});
});