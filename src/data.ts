import { serializeError, deserializeError } from "serialize-error";

// Look up TypeArray constructor because it is not available in all environments
// and we want to use it for identifying typed arrays.
const TypedArray = Object.getPrototypeOf(Uint8Array.prototype).constructor;
type TypedArray = typeof TypedArray;

export type SerializableDataType =
	| undefined
	| boolean
	| number
	| bigint
	| string
	| Uint8Array
	| object
	| null
	| Error;

// TODO: Switch from Uint8Array to DataView
type DataTypeHandler<T> = {
	write(target: DataView, value: T): any;
	read(source: DataView): T;
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
		const length = source.getUint32(0, true);
		const lengthBytes = 4;
		const startOffset = source.byteOffset + lengthBytes;
		// TODO: Can we make this more efficient?
		return new Uint8Array(source.buffer, startOffset, startOffset + length);
	},
};

const dataTypeHandler_String: DataTypeHandler<string> = {
	write(target: DataView, value: string) {
		const encoder = new TextEncoder();
		const encodedText = encoder.encode(value);
		dataTypeHandler_Uint8Array.write(target, encodedText);
	},
	read(source: DataView) {
		dataTypeHandler_Uint8Array.read(source);
		const length = source.getUint32(0, true);
		const decoder = new TextDecoder();
		const stringData = new Uint8Array(
			source.buffer,
			source.byteOffset + 4,
			length,
		);
		return decoder.decode(stringData);
	},
};

// TODO: Make type param Proxy?
const dataTypeHandler_Object: DataTypeHandler<object> = {
	write(target: DataView, value: object) {
		// TODO: Handle null as special case.

		// Relay object keys so they can be represented by a remote proxy.
		const objectKeys = Object.keys(value);
		const jsonString = JSON.stringify(objectKeys);
		dataTypeHandler_String.write(target, jsonString);
	},
	read(source: DataView) {
		const jsonString = dataTypeHandler_String.read(source);
		const objectKeys = JSON.parse(jsonString);
		if (!Array.isArray(objectKeys)) {
			throw new TypeError(
				`Expected array of object keys, got ${typeof objectKeys}`,
			);
		}
		// TODO
		return new Proxy({}, {});
	},
};

const dataTypeHandler_Error: DataTypeHandler<Error> = {
	write(target: DataView, value: Error) {
		const serializedError = serializeError(value);
		const errorJson = JSON.stringify(serializedError);
		dataTypeHandler_String.write(target, errorJson);
	},
	read(source: DataView) {
		const errorJson = dataTypeHandler_String.read(source);
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
	return new SharedArrayBuffer(sharedArrayBufferPrefixByteLength);
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
	}

	if (handlerIndex === undefined) {
		// TODO: How to handle unsupported-type errors? Serialize them and relay?
		throw new TypeError(`Unsupported data type: ${typeof data} (${data})`);
	}

	rpcHeader[0] = handlerIndex;
	const handler = dataTypeHandlerList[handlerIndex];
	handler.write(new DataView(target, sharedArrayBufferPrefixByteLength), data);
}

export function read(source: SharedArrayBuffer): SerializableDataType {
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
	return handler.read(dataView);
}
