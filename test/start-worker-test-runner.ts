import { parentPort, isMainThread } from "node:worker_threads";
import { Worker } from "node:worker_threads";

// Force colored output from test runner.
process.env.FORCE_COLOR = '1';

const worker = await new Promise<Worker>((resolve, reject) => {
	const worker = new Worker(new URL("./worker-test-runner.ts", import.meta.url));

	worker.on("message", onMessage);
	worker.on("error", onError);

	function onMessage(message: any) {
		if (message === "worker-started") {
			resolve(worker);
			settled();
		}
	}
	function onError(event: ErrorEvent) {
		console.error("worker error", event);
		reject(event);
		settled();
	}
	function settled() {
		worker.off("message", onMessage);
		worker.off("error", onError);
	}
});

worker.on('exit', (code: number) => {
	process.exit(code);
});
