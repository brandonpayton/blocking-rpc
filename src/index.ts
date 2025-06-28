import type { Worker as NodeWorker } from 'worker_threads';

const resultCache = new WeakMap<SharedArrayBuffer, any>();

interface Endpoint {
	addEventListener: (type: string, listener: (event: any) => void) => void;
	removeEventListener: (type: string, listener: (event: any) => void) => void;
	postMessage: (message: any) => void;
}

export function expose<T>(
	value: T,
	// @TODO: Make this a generic type so we can accommodate other worker types.
	endpoint: NodeWorker
): T {
	return value;
}

export function wrap<T>() {
	// @TODO: Support releasing the proxy.
	return new Proxy<T>({} as T, {
		// TODO: get
		// TODO: set
		// TODO: apply
	});
}
