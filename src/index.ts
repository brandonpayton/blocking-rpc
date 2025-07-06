import type { Worker as NodeWorker } from 'worker_threads';
import { serializeError, deserializeError } from "serialize-error";

// TODO: Document and explain why no postMessage
interface ExposingEndpoint {
	on: NodeWorker['on'],
	off: NodeWorker['off'],
}

// TODO: Document and explain why no event listening
interface RemoteEndpoint {
	postMessage: NodeWorker['postMessage']
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

// TODO: Switch from Uint8Array to DataView
type DataTypeHandler<T> = {
	write(target: DataView, value: T): any;
	read(source: DataView, endpoint: RemoteEndpoint): T;
};

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
	read(source: DataView, endpoint: RemoteEndpoint) {
		const stringData = dataTypeHandler_Uint8Array.read(source, endpoint);
		const decoder = new TextDecoder();
		return decoder.decode(stringData);
	},
};

const symbolRemoteObject = Symbol('remoteObject');

// TODO: Make type param Proxy?
const dataTypeHandler_Object: DataTypeHandler<object> = {
	write(target: DataView, value: object) {
		// TODO: Handle null as special case.

		// Relay object keys so they can be represented by a remote object.
		const typedProperties = Object.keys(value);
		const jsonString = JSON.stringify(typedProperties);
		dataTypeHandler_String.write(target, jsonString);
	},
	read(source: DataView, endpoint: RemoteEndpoint) {
		const jsonString = dataTypeHandler_String.read(source, endpoint);
		const objectKeys = JSON.parse(jsonString);
		// TODO: Is this how we should handle an error like this?
		if (!Array.isArray(objectKeys)) {
			throw new TypeError(
				`Expected array of object keys, got ${typeof objectKeys}`,
			);
		}

		const result = { [symbolRemoteObject]: true };
		for (const key of objectKeys) {
			Object.defineProperty(result, key, {
				get() {
					const targetRef = source.buffer;
					const responseBuffer = createSharedArrayBufferForRpc();
					endpoint.postMessage({
						type: 'get',
						targetRef: targetRef,
						propKey: key,
						responseBuffer,
					});
					// TODO: Why isn't this passing type check?
					// TODO: Check return value of wait()
					// @ts-ignore
					Atomics.wait(
						new BigInt64Array(responseBuffer),
						0,
						0n,
					);
					return read(responseBuffer, endpoint);
				},
				// TODO: Should we constrain this type?
				set(value: any) {
					const targetRef = source.buffer;
					const responseBuffer = createSharedArrayBufferForRpc();
					endpoint.postMessage({
						type: 'set',
						targetRef: targetRef,
						propKey: key,
						value,
						responseBuffer,
					});
					// TODO: Why isn't this passing type check?
					// TODO: Check return value of wait()
					// @ts-ignore
					Atomics.wait(
						new BigInt64Array(responseBuffer),
						0,
						0n,
					);
					// TODO: Should we throw if the result is an error?
				},
			});
		}
		return result;
	},
};

const dataTypeHandler_Function: DataTypeHandler<Function> = {
	write(target: DataView, value: Function) {
		/* do nothing */
	},
	read(source: DataView, endpoint: RemoteEndpoint) {
		return (...args: any[]) => {
			// TODO: Document quirk that remote functions are always bound.
			const targetRef = source.buffer;
			const responseBuffer = createSharedArrayBufferForRpc();
			// TODO: Pass endpoint or action functions
			endpoint.postMessage({
				type: 'apply',
				targetRef: targetRef,
				args,
				responseBuffer,
			});
		};

	},
};

const dataTypeHandler_Error: DataTypeHandler<Error> = {
	write(target: DataView, value: Error) {
		const serializedError = serializeError(value);
		const errorJson = JSON.stringify(serializedError);
		dataTypeHandler_String.write(target, errorJson);
	},
	read(source: DataView, endpoint: RemoteEndpoint) {
		const errorJson = dataTypeHandler_String.read(source, endpoint);
		const serializedError = JSON.parse(errorJson);
		return deserializeError(serializedError);
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

export function createSharedArrayBufferForRpc() {
	// TODO: Consider preallocating a buffer that is large enough for primitive types.
	// TODO: Revisit maxByteLength
	return new SharedArrayBuffer(sharedArrayBufferPrefixByteLength, { maxByteLength: 1024 * 1024 * 1024 });
}

export function write(target: SharedArrayBuffer, data: SerializableDataType) {
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

	rpcHeader[0] = handlerIndex;
	const handler = dataTypeHandlerList[handlerIndex];
	handler.write(new DataView(target, sharedArrayBufferPrefixByteLength), data);
}

export function read(source: SharedArrayBuffer, endpoint: RemoteEndpoint): SerializableDataType {
	if (source.byteLength === 0) {
		throw new Error("Cannot read from an empty DataView");
	}

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
	return handler.read(dataView, endpoint);
}

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
	endpoint: ExposingEndpoint
): ReleaseFunction {
	// TODO: Fix type here
	function onMessage(event: any) {
		console.log('onMessage for', exposedName, event);
		// @TODO: Warn if event doesn't have expected properties.

		const action = event as RemoteAction;

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
					0,
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

	console.log('exposing', exposedName);
	endpoint.on('message', onMessage);
	return () => {
		endpoint.off('message', onMessage);
	}
}

export function consume<T>(
	name: string,
	endpoint: RemoteEndpoint
): T {
	console.log('consuming', name);
	const responseBuffer = createSharedArrayBufferForRpc();
	endpoint.postMessage({
		type: 'consume',
		name,
		responseBuffer,
	});
	console.log('posted consume message for', name);
	// TODO: Why isn't this passing type check?
	// TODO: Check return value of wait()
	// @ts-ignore
	Atomics.wait(
		new BigInt64Array(responseBuffer),
		0,
		0n,
	);

	const result = read(responseBuffer, endpoint);
	return result as T;
}
