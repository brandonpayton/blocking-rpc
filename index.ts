import type { Worker as NodeWorker } from "worker_threads";
import { serializeError, deserializeError } from "serialize-error";

// TODO: Document and explain why no postMessage
interface ExposingEndpoint {
	on: NodeWorker["on"];
	off: NodeWorker["off"];
}

// TODO: Document and explain why no event listening
interface RemoteEndpoint {
	postMessage(remoteAction: RemoteAction): void;
}

type ReleaseFunction = () => void;

type NonEmptyArray<T> = [T, ...T[]];

type RemoteAction_Consume = {
	type: "consume";
	/**
	 * The name of the exposed object or value.
	 */
	name: string;

	// TODO: Review these comments for correctness. This one below is now false
	/**
	 * A shared key used to cache and reference the remote target
	 * of the operation stored in a WeakMap. The target will be naturally
	 * forgotten when the reference key is forgotten.
	 */
	keyForRef: string;

	/**
	 * The buffer used to:
	 * - signal completion
	 * - relay the result
	 * - reference the target by the consumer (TODO: Explain this better)
	 */
	responseBuffer: SharedArrayBuffer;
};

/**
 * A remote request to get a property under the exposed object.
 */
type RemoteAction_Get = {
	type: "get";

	targetRef: string;

	/**
	 * The key of the property to get.
	 */
	propKey: string;

	keyForRef: string;

	/**
	 * The buffer used to:
	 * - signal completion
	 * - relay the result
	 * - reference the target by the consumer (TODO: Explain this better)
	 */
	responseBuffer: SharedArrayBuffer;
};

/**
 * A remote request to set a property under the exposed object.
 */
type RemoteAction_Set = {
	type: "set";
	targetRef: string;

	/**
	 * The key of the property to get.
	 */
	propKey: string;
	/**
	 * The value to set.
	 */
	value: SerializableDataType;

	/**
	 * The buffer used to signal completion.
	 */
	responseBuffer: SharedArrayBuffer;
};

/**
 * A remote request to call a method under the exposed object.
 */
type RemoteAction_Apply = {
	type: "apply";

	/**
	 * A shared key used to cache and reference the remote context
	 * of the operation stored in a WeakMap. The target will be naturally
	 * forgotten when the reference key is forgotten.
	 */
	contextRef: string;

	/**
	 * A ref to the remote function to apply.
	 */
	targetRef: string;

	/**
	 * The arguments to pass to the method.
	 */
	args: any[];

	keyForRef: string;

	/**
	 * The buffer used to:
	 * - signal completion
	 * - relay the result
	 * - reference the return value by the consumer (TODO: Explain this better)
	 */
	responseBuffer: SharedArrayBuffer;
};

/**
 * A remote request to get the own property keys of an object.
 */
type RemoteAction_ProxyOwnKeys = {
	type: "proxy-ownKeys";
	targetRef: string;
	responseBuffer: SharedArrayBuffer;
};

/**
 * A remote request to get the own property descriptor of an object.
 */
type RemoteAction_ProxyGetOwnPropertyDescriptor = {
	type: "proxy-getOwnPropertyDescriptor";
	targetRef: string;
	propKey: string;
	responseBuffer: SharedArrayBuffer;
};

type RemoteAction =
	| RemoteAction_Consume
	| RemoteAction_Get
	| RemoteAction_Set
	| RemoteAction_Apply
	| RemoteAction_ProxyOwnKeys
	| RemoteAction_ProxyGetOwnPropertyDescriptor;

// Look up TypeArray constructor because it is not available in all environments
// and we want to use it for identifying typed arrays.
const TypedArray = Object.getPrototypeOf(Uint8Array.prototype).constructor;
type TypedArray = typeof TypedArray;

// TODO: Improve name, maybe RemoteDataType.
type SerializableDataType =
	| undefined
	| boolean
	| number
	| bigint
	| string
	| Uint8Array
	| object
	| Function
	| null
	| Error;


function ensureSufficientBufferSize<T extends TypedArray | DataView>(
	arrayView: DataView,
	requiredByteSize: number,
	DataViewConstructor: {
		new (
			buffer: ArrayBuffer | SharedArrayBuffer,
			byteOffset?: number,
			byteLength?: number,
		): T;
	} = DataView as any,
): T {
	const buffer = arrayView.buffer as SharedArrayBuffer;
	const prefixSize = buffer.byteLength - arrayView.byteLength;
	if (buffer.byteLength >= prefixSize + requiredByteSize) {
		return arrayView instanceof DataViewConstructor
			? arrayView
			: (new DataViewConstructor(
					buffer,
					arrayView.byteOffset,
					arrayView.byteLength,
				) as T);
	}

	buffer.grow(prefixSize + requiredByteSize);
	return new DataViewConstructor(buffer, arrayView.byteOffset);
}

class ThrownError {
	readonly error: Error;

	constructor(error: Error) {
		this.error = error;
	}
}

// TODO: Switch from Uint8Array to DataView
type DataTypeHandler<T> = {
	write(target: DataView, value: T): any;
	// TODO: Consider which params are appropriate here.
	read(source: DataView, endpoint: RemoteEndpoint, keyForRef: string): T;
};


// TODO: Remove this if it is unnecessary.
const dataTypeHandler_Never: DataTypeHandler<undefined> = {
	write: (target: DataView, value: any) => {
		throw new Error("Cannot write 'never' type");
	},
	read: (source: DataView) => {
		throw new Error("Cannot read 'never' type");
	},
};

const dataTypeHandler_Undefined: DataTypeHandler<undefined> = {
	write(target: DataView, value: undefined) {
		// no-op
	},
	read(source: DataView) {
		return undefined;
	},
};

const dataTypeHandler_Boolean: DataTypeHandler<boolean> = {
	write(target: DataView, value: boolean) {
		target = ensureSufficientBufferSize(target, 1);
		target.setUint8(0, value ? 1 : 0);
	},
	read(source: DataView) {
		return source.getUint8(0) === 1;
	},
};

const dataTypeHandler_Number: DataTypeHandler<number> = {
	write(target: DataView, value: number) {
		// JS numbers are 64-bit floating point.
		// https://262.ecma-international.org/16.0/index.html#sec-ecmascript-language-types-number-type
		target = ensureSufficientBufferSize(target, 8);
		const view = new DataView(
			target.buffer,
			target.byteOffset,
			target.byteLength,
		);
		view.setFloat64(0, value, true); // Use little-endian format
	},
	read(source: DataView) {
		return source.getFloat64(0, true); // Use little-endian format
	},
};

const dataTypeHandler_BigInt: DataTypeHandler<bigint> = {
	write(target: DataView, value: bigint) {
		target = ensureSufficientBufferSize(target, 8);
		const view = new DataView(
			target.buffer,
			target.byteOffset,
			target.byteLength,
		);
		view.setBigInt64(0, value, true); // Use little-endian format
	},
	read(source: DataView) {
		return source.getBigInt64(0, true); // Use little-endian format
	},
};

const dataTypeHandler_Uint8Array: DataTypeHandler<Uint8Array> = {
	write(target: DataView, value: Uint8Array) {
		const lengthBytes = 4;
		const requiredByteSize = lengthBytes + value.byteLength;
		target = ensureSufficientBufferSize(target, requiredByteSize);
		target.setUint32(0, value.byteLength);
		const bufferBytes = new Uint8Array(
			target.buffer,
			target.byteOffset + lengthBytes,
			value.byteLength,
		);
		bufferBytes.set(new Uint8Array(value));
	},
	read(source: DataView) {
		const length = source.getUint32(0);
		const lengthBytes = 4;
		const startOffset = source.byteOffset + lengthBytes;
		// TODO: Can we make this more efficient?
		return new Uint8Array(source.buffer, startOffset, length);
	},
};

const dataTypeHandler_String: DataTypeHandler<string> = {
	write(target: DataView, value: string) {
		const encoder = new TextEncoder();
		const encodedText = encoder.encode(value);
		dataTypeHandler_Uint8Array.write(target, encodedText);
	},
	read(source: DataView, endpoint: RemoteEndpoint, keyForRef: string) {
		const stringData = dataTypeHandler_Uint8Array.read(
			source,
			endpoint,
			keyForRef,
		);
		const decoder = new TextDecoder();
		return decoder.decode(stringData);
	},
};

const symbolRemoteObject = Symbol("remoteObject");

// TODO: Make type param Proxy?
const dataTypeHandler_Object: DataTypeHandler<object | null> = {
	write(target: DataView, value: object) {
		let valueToRelay;
		if (value === null) {
			valueToRelay = null;
		} else if (Array.isArray(value)) {
			valueToRelay = { kind: 'array' };
		} else {
			valueToRelay = { kind: 'object' };
		}

		const jsonString = JSON.stringify(valueToRelay);
		dataTypeHandler_String.write(target, jsonString);
	},
	read(source: DataView, endpoint: RemoteEndpoint, keyForRef: string) {
		const jsonString = dataTypeHandler_String.read(source, endpoint, keyForRef);
		const typeRecord = JSON.parse(jsonString);
		if (typeRecord === null) {
			return null;
		}

		let target;
		if (typeRecord.kind === 'array') {
			target = [];
		} else if (typeRecord.kind === 'object') {
			target = {};
		} else {
			throw new TypeError(`Unrecognized object kind: ${typeRecord.kind}`);
		}

		const result = new Proxy(target, {
			// TODO: Handle more traps to behave like a normal object.

			get(target, prop, receiver) {
				if (prop === symbolRemoteObject) {
					return keyForRef;
				}

				if (typeof prop === "symbol") {
					// TODO: Support getting properties with well-known symbols.
					return undefined;
				}

				const targetRef = keyForRef;
				const keyForPropRef = crypto.randomUUID();
				const responseBuffer = createSharedArrayBufferForRpc();
				endpoint.postMessage({
					type: "get",
					targetRef: targetRef,
					propKey: prop,
					keyForRef: keyForPropRef,
					responseBuffer,
				});

				return read(responseBuffer, endpoint, keyForPropRef);
			},
			set(target, prop, value, receiver) {
				if (typeof prop === "symbol") {
					// TODO: Support setting properties with well-known symbols.
					return false;
				}

				const targetRef = keyForRef;
				const responseBuffer = createSharedArrayBufferForRpc();
				endpoint.postMessage({
					type: "set",
					targetRef: targetRef,
					propKey: prop,
					value,
					responseBuffer,
				});

				const ignoredKeyForRef = "";
				read(responseBuffer, endpoint, ignoredKeyForRef);
				return true;
			},

			ownKeys(target) {
				const targetRef = keyForRef;
				const responseBuffer = createSharedArrayBufferForRpc();
				endpoint.postMessage({
					type: "proxy-ownKeys",
					targetRef,
					responseBuffer,
				});
				const keysJson = read(responseBuffer, endpoint, keyForRef) as string;
				const keys = JSON.parse(keysJson);
				return keys;
			},

			getOwnPropertyDescriptor(target, prop) {
				if (typeof prop === "symbol") {
					// TODO: Support getting properties with well-known symbols.
					return undefined;
				}

				const targetRef = keyForRef;
				const responseBuffer = createSharedArrayBufferForRpc();
				endpoint.postMessage({
					type: "proxy-getOwnPropertyDescriptor",
					targetRef,
					propKey: prop,
					responseBuffer,
				});

				const descriptorJson = read(responseBuffer, endpoint, keyForRef) as string;
				const descriptor = JSON.parse(descriptorJson);
				return descriptor;
			}
		});

		return result;
	},
};

const dataTypeHandler_Function: DataTypeHandler<Function> = {
	write(target: DataView, value: Function) {
		/* do nothing */
	},
	read(source: DataView, endpoint: RemoteEndpoint, keyForRef: string) {
		return function remoteFunc(...args: any[]) {
			const defaultContext = undefined;
			// @ts-ignore
			const contextRef = (this as any)[symbolRemoteObject] ?? defaultContext;

			// TODO: Document quirk that remote functions are always bound.
			const targetRef = keyForRef;
			const responseBuffer = createSharedArrayBufferForRpc();
			const keyForResultRef = crypto.randomUUID();
			// TODO: Pass endpoint or action functions
			endpoint.postMessage({
				type: "apply",
				contextRef,
				targetRef,
				keyForRef: keyForResultRef,
				args,
				responseBuffer,
			});
			return read(responseBuffer, endpoint, keyForResultRef);
		};
	},
};

const dataTypeHandler_Error: DataTypeHandler<Error> = {
	write(target: DataView, value: Error) {
		const serializedError = serializeError(value);
		const errorJson = JSON.stringify(serializedError);
		dataTypeHandler_String.write(target, errorJson);
	},
	read(source: DataView, endpoint: RemoteEndpoint, keyForRef: string) {
		const errorJson = dataTypeHandler_String.read(source, endpoint, keyForRef);
		const serializedError = JSON.parse(errorJson);
		return deserializeError(serializedError);
	},
};

const dataTypeHandler_ThrownError: DataTypeHandler<ThrownError> = {
	write(target: DataView, value: ThrownError) {
		const serializedError = serializeError(value.error);
		const errorJson = JSON.stringify(serializedError);
		dataTypeHandler_String.write(target, errorJson);
	},
	read(source: DataView, endpoint: RemoteEndpoint, keyForRef: string) {
		const errorJson = dataTypeHandler_String.read(source, endpoint, keyForRef);
		const serializedError = JSON.parse(errorJson);
		const error = deserializeError(serializedError);
		return new ThrownError(error);
	},
};

const dataTypeHandlerMap = {
	Never: dataTypeHandler_Never,
	Undefined: dataTypeHandler_Undefined,
	Boolean: dataTypeHandler_Boolean,
	Number: dataTypeHandler_Number,
	BigInt: dataTypeHandler_BigInt,
	Uint8Array: dataTypeHandler_Uint8Array,
	String: dataTypeHandler_String,
	Object: dataTypeHandler_Object,
	Function: dataTypeHandler_Function,
	Error: dataTypeHandler_Error,
	ThrownError: dataTypeHandler_ThrownError,
};

// Useful to lookup data type handler type byte
const dataTypeHandlerIndices: Record<keyof typeof dataTypeHandlerMap, number> =
	Object.keys(dataTypeHandlerMap).reduce(
		(accumulator: Record<string, number>, key: string, index) => {
			accumulator[key] = index;
			return accumulator;
		},
		{},
	);

// Useful to lookup data type handler by index
const dataTypeHandlerList: DataTypeHandler<SerializableDataType>[] =
	Object.values(dataTypeHandlerMap);

// The first 8 bytes of the SharedArrayBuffer are reserved for metadata.
// We only need the first byte to store the data type, but we take 8 bytes
// to preserve byte alignment of largest possible TypedArray (Float64Array).
const sharedArrayBufferPrefixByteLength = 8;

function createSharedArrayBufferForRpc() {
	// TODO: Consider preallocating a buffer that is large enough for primitive types.
	// TODO: Revisit maxByteLength
	return new SharedArrayBuffer(sharedArrayBufferPrefixByteLength, {
		maxByteLength: 1024 * 1024 * 1024,
	});
}

function write(target: SharedArrayBuffer, data: SerializableDataType) {
	const rpcHeader = new Uint8Array(
		target,
		0,
		sharedArrayBufferPrefixByteLength,
	);

	let handlerIndex: number | undefined;
	if (data === undefined) {
		handlerIndex = dataTypeHandlerIndices.Undefined;
	} else if (typeof data === "boolean") {
		handlerIndex = dataTypeHandlerIndices.Boolean;
	} else if (typeof data === "number") {
		handlerIndex = dataTypeHandlerIndices.Number;
	} else if (typeof data === "bigint") {
		handlerIndex = dataTypeHandlerIndices.BigInt;
	} else if (typeof data === "string") {
		handlerIndex = dataTypeHandlerIndices.String;
	} else if (data instanceof Uint8Array) {
		handlerIndex = dataTypeHandlerIndices.Uint8Array;
	} else if (data instanceof ThrownError) {
		handlerIndex = dataTypeHandlerIndices.ThrownError;
	} else if (data instanceof Error) {
		handlerIndex = dataTypeHandlerIndices.Error;
	} else if (typeof data === "object") {
		handlerIndex = dataTypeHandlerIndices.Object;
	} else if (typeof data === "function") {
		handlerIndex = dataTypeHandlerIndices.Function;
	}

	if (handlerIndex === undefined) {
		// TODO: How to handle unsupported-type errors? Serialize them and relay?
		throw new TypeError(`Unsupported data type: ${typeof data} (${data})`);
	}

	const handler = dataTypeHandlerList[handlerIndex];
	handler.write(new DataView(target, sharedArrayBufferPrefixByteLength), data);

	// ATTENTION: Use an atomic store op after the bulk write to ensure
	// synchronization before notifying the reader.
	Atomics.store(rpcHeader, 0, handlerIndex);

	Atomics.notify(new BigInt64Array(target), 0);
}

function read(
	source: SharedArrayBuffer,
	endpoint: RemoteEndpoint,
	keyForRef: string,
): SerializableDataType {
	if (source.byteLength === 0) {
		throw new Error("Cannot read from an empty DataView");
	}

	Atomics.wait(new BigInt64Array(source), 0, 0n);

	const rpcHeader = new Uint8Array(
		source,
		0,
		sharedArrayBufferPrefixByteLength,
	);
	const typeByte = rpcHeader[0];
	const handler = dataTypeHandlerList[typeByte];
	if (!handler) {
		throw new TypeError(`Unsupported data type: ${typeByte}`);
	}

	const dataView = new DataView(source, sharedArrayBufferPrefixByteLength);
	const result = handler.read(dataView, endpoint, keyForRef);
	if (result instanceof ThrownError) {
		throw result.error;
	}
	return result;
}

// @TODO list supported response types

const exposedItems = new Map<string, SerializableDataType>();

/**
 * TODO: Explain this.
 */
const resultCache = new Map<string, any>();

const symbolForRelease = Symbol("release");

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
	endpoint: ExposingEndpoint,
): ReleaseFunction {
	// TODO: Fix type here
	function onMessage(event: any) {
		// @TODO: Warn if event doesn't have expected properties.

		const action = event as RemoteAction;

		switch (action.type) {
			case "consume": {
				write(action.responseBuffer, exposedValue);
				// TODO: Make way to clean up when refs are GC'd
				resultCache.set(action.keyForRef, exposedValue);
				break;
			}
			case 'get': {
				// @TODO: Try/catch for undefined subproperties or getter failure.
				const target = resultCache.get(action.targetRef);
				const result = target[action.propKey];
				write(action.responseBuffer, result);
				// TODO: Make way to clean up when refs are GC'd
				resultCache.set(action.keyForRef, result);
				break;
			}
			case 'set': {
				// @TODO: Try/catch for undefined subproperties or setter failure.
				const target = resultCache.get(action.targetRef);
				target[action.propKey] = action.value;
				write(action.responseBuffer, undefined);
				break;
			}
			case 'apply': {
				try {
					// @TODO: Try/catch for undefined subproperties or call failure.
					const context = resultCache.get(action.contextRef);
					const func = resultCache.get(action.targetRef);

					const result = func.apply(context, action.args);
					write(action.responseBuffer, result);
					// TODO: Make way to clean up when refs are GC'd
					resultCache.set(action.keyForRef, result);
				} catch (error: any) {
					write(action.responseBuffer, new ThrownError(error));
				}
				break;
			}
			case 'proxy-ownKeys': {
				const target = resultCache.get(action.targetRef);
				const keys = Reflect.ownKeys(target);
				const keysJson = JSON.stringify(keys);
				write(action.responseBuffer, keysJson);
				break;
			}
			case 'proxy-getOwnPropertyDescriptor': {
				const target = resultCache.get(action.targetRef);
				const descriptor = Reflect.getOwnPropertyDescriptor(target, action.propKey);
				if (descriptor === undefined) {
					write(action.responseBuffer, undefined);
					break;
				}

				const { get, set, value, ...descriptorWithoutGetSetValue } = descriptor;
				const descriptorJson = JSON.stringify(descriptorWithoutGetSetValue);
				write(action.responseBuffer, descriptorJson);
				break;
			}
		}
	}

	endpoint.on("message", onMessage);
	return () => {
		endpoint.off("message", onMessage);
	};
}

export function consume<T>(name: string, endpoint: RemoteEndpoint): T {
	const responseBuffer = createSharedArrayBufferForRpc();
	const keyForRef = crypto.randomUUID();
	// TODO: Make postMessage typed for acceptable messages
	endpoint.postMessage({
		type: "consume",
		name,
		keyForRef,
		responseBuffer,
	});

	const result = read(responseBuffer, endpoint, keyForRef);
	return result as T;
}
