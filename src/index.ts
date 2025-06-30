import type { Worker as NodeWorker } from 'worker_threads';

interface Endpoint {
	on: NodeWorker['on'],
	off: NodeWorker['off'],
	postMessage: NodeWorker['postMessage']
}

type ReleaseFunction = () => void;

type NonEmptyArray<T> = [T, ...T[]];
type RemoteAction_Get = {
	type: 'get',
	path: NonEmptyArray<string>,
	responseBuffer: SharedArrayBuffer,
}
type RemoteAction_Set = {
	type: 'set',
	path: NonEmptyArray<string>,
	value: any,
	responseBuffer: SharedArrayBuffer,
}
type RemoteAction_Apply = {
	type: 'apply',
	path: NonEmptyArray<string>,
	args: any[],
	responseBuffer: SharedArrayBuffer,
}
type RemoteAction = RemoteAction_Get | RemoteAction_Set | RemoteAction_Apply;

// @TODO list supported response types

const resultCache = new WeakMap<SharedArrayBuffer, any>();
const symbolForRelease = Symbol('release');

export function expose<T>(
	name: string,
	value: T,
	// @TODO: Make this a generic type so we can accommodate other worker types.
	endpoint: Endpoint
): ReleaseFunction {
	function onMessage(event: MessageEvent) {
		// @TODO: Warn if event doesn't have expected properties.

		const request = event.data;
		

		switch (request.type) {

			
		}
	}

	endpoint.on('message', onMessage);
	return () => {
		endpoint.off('message', onMessage);
	}	
}

type Wrapped<T> = T & {
	[symbolForRelease]: ReleaseFunction,
}

export function wrap<T>(
	name: string,
): Wrapped<T> {
	// @TODO: Support releasing the proxy.
	return new Proxy<T>({} as T, {
		// TODO: get
		// TODO: set
		// TODO: apply
	}) as Wrapped<T>;
}

export function releaseWrapped<T>(
	wrapped: Wrapped<T>
): void {
	if (symbolForRelease in wrapped) {
		wrapped[symbolForRelease]();
	}
}
