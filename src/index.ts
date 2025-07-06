import type { Worker as NodeWorker } from 'worker_threads';
import { read, write } from './data';
import type { SerializableDataType } from './data';

interface Endpoint {
	on: NodeWorker['on'],
	off: NodeWorker['off'],
	postMessage: NodeWorker['postMessage']
	// TODO: Support custom, lazy startup and shutdown logic.
}

type ReleaseFunction = () => void;

type NonEmptyArray<T> = [T, ...T[]];

type RemoteAction_Consume = {
	type: 'consume',
	/**
	 * The name of the exposed object or value.
	 */
	name: string,
	/**
	 * The buffer used to:
	 * - signal completion
	 * - relay the result
	 * - reference the target by the consumer (TODO: Explain this better)
	 */
	responseBuffer: SharedArrayBuffer,
}

/**
 * A remote request to get a property under the exposed object.
 */
type RemoteAction_Get = {
	type: 'get',

	/**
	 * A shared key used to cache and reference the remote target
	 * of the operation stored in a WeakMap. The target will be naturally
	 * forgotten when the reference key is forgotten.
	 */
	targetRef: SharedArrayBuffer,

	/**
	 * The key of the property to get.
	 */
	propKey: string,

	/**
	 * The buffer used to:
	 * - signal completion
	 * - relay the result
	 * - reference the target by the consumer (TODO: Explain this better)
	 */
	responseBuffer: SharedArrayBuffer,
}

/**
 * A remote request to set a property under the exposed object.
 */
type RemoteAction_Set = {
	type: 'set',

	/**
	 * A shared key used to cache and reference the remote target
	 * of the operation stored in a WeakMap. The target will be naturally
	 * forgotten when the reference key is forgotten.
	 */
	targetRef: SharedArrayBuffer,

	/**
	 * The key of the property to get.
	 */
	propKey: string,
	/**
	 * The value to set.
	 */
	value: SerializableDataType,

	/**
	 * The buffer used to:
	 * - signal completion
	 * - relay the result
	 * - reference the return  by the consumer (TODO: Explain this better)
	 */
	responseBuffer: SharedArrayBuffer,
}

/**
 * A remote request to call a method under the exposed object.
 */
type RemoteAction_Apply = {
	type: 'apply',

	/**
	 * A shared key used to cache and reference the remote context
	 * of the operation stored in a WeakMap. The target will be naturally
	 * forgotten when the reference key is forgotten.
	 */
	contextRef: SharedArrayBuffer,

	/**
	 * A ref to the remote function to apply.
	 */
	targetRef: SharedArrayBuffer,

	/**
	 * The arguments to pass to the method.
	 */
	args: any[],

	/**
	 * The buffer used to:
	 * - signal completion
	 * - relay the result
	 * - reference the return value by the consumer (TODO: Explain this better)
	 */
	responseBuffer: SharedArrayBuffer,
}

type RemoteAction = RemoteAction_Consume | RemoteAction_Get | RemoteAction_Set | RemoteAction_Apply;

// @TODO list supported response types

const exposedItems = new Map<string, SerializableDataType>();

/**
 * TODO: Explain this.
 */
const resultCache = new WeakMap<SharedArrayBuffer, any>();

const symbolForRelease = Symbol('release');

/**
 * Expose an object to the worker.
 *
 * @param exposedName The name of the exposed object.
 * @param exposedValue The value to expose.
 * @param endpoint The endpoint to use to communicate with the worker.
 * @returns A function to release the exposed object.
 */
export function expose<T extends SerializableDataType>(
	exposedName: string,
	exposedValue: T,
	// @TODO: Make this a generic type so we can accommodate other worker types.
	endpoint: Endpoint
): ReleaseFunction {
	function onMessage(event: MessageEvent) {
		// @TODO: Warn if event doesn't have expected properties.

		const action = event.data as RemoteAction;

		// Determine the target of the operation.
		// This may be a follow-up request using a previous result.
		const target = resultCache.has(action.responseBuffer)
			? resultCache.get(action.responseBuffer)
			: exposedValue;

		switch (action.type) {
			case 'consume': {
				write(action.responseBuffer, exposedValue);
				resultCache.set(action.responseBuffer, exposedValue);
				// TODO: Wrap this in function similar to read() and write()
				Atomics.notify(
					new BigInt64Array(action.responseBuffer),
					0
				);
				break;
			}
			case 'get': {
				// @TODO: Try/catch for undefined subproperties or getter failure.
				const result = target[action.propKey];
				resultCache.set(action.responseBuffer, result);

				write(action.responseBuffer, result);
				Atomics.notify(
					new BigInt64Array(action.responseBuffer),
					0
				);
				break;
			}
			case 'set': {
				// @TODO: Try/catch for undefined subproperties or setter failure.
				target[action.propKey] = action.value;
				Atomics.notify(
					new BigInt64Array(action.responseBuffer),
					0
				);
				break;
			}
			case 'apply': {
				// @TODO: Try/catch for undefined subproperties or call failure.

				const context = resultCache.get(action.contextRef);
				const func = resultCache.get(action.targetRef);

				const result = func.apply(context, action.args);
				resultCache.set(action.responseBuffer, result);

				write(action.responseBuffer, result);
				Atomics.notify(
					new BigInt64Array(action.responseBuffer),
					0
				);
				break;
			}
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

export function consume<T>(
	name: string,
	endpoint: Endpoint
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

function get(target: any, path: NonEmptyArray<string>): any {
	return path.reduce((acc, key) => acc[key], target);
}

function set(target: any, path: NonEmptyArray<string>, value: any): void {
	const propName = path[path.length - 1];

	if (path.length > 1) {
		const subTargetPath = path.slice(0, -1);
		target = get(target, subTargetPath as NonEmptyArray<string>);
	}

	target[propName] = value;
}

function apply(target: any, path: NonEmptyArray<string>, args: any[]): any {
	const methodName = path[path.length - 1];

	if (target.length > 1) {
		const contextPath = path.slice(0, -1);
		target = get(target, contextPath as NonEmptyArray<string>);
	}

	return target[methodName](...args);
}