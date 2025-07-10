// TODO: How to embed this worker in a test module?

import { parentPort, isMainThread } from 'node:worker_threads';
import { expose } from '../src/index.ts';

if (isMainThread) {
  throw new Error('This file should only be run as a worker thread.');
}

const props = {
	propUndefined: undefined,
	propTrue: true,
	propFalse: false,
	propZeroNumber: 0,
	propOneTwoThreeNumber: 123,
	propOneTwoThreePointTwoFiveNumber: 123.25,
	propNegativeOneNumber: -1,
	propNegativeOnePointFiveNumber: -1.5,
	propBigInt: BigInt(123),
	propEmptyString: '',
	propHelloWorldString: 'Hello World',
	propObject: { a: 1, b: 2, nested: { c: 3, d: 4 } },
	propUint8Array: new Uint8Array([1, 2, 3]),
	propError: new Error('test'),
	propIdentityFunction: (value: any) => value,
	propArray: [1, 2, 3],
	add(a: number, b: number) {
		return a + b;
	},
	throwTypeError(message: string) {
		throw new TypeError(message);
	},
};

const fixture = {
	...props,
	nested: {
		...props,
	},
};

export type Fixture = typeof fixture;

expose(
	'fixture',
	fixture,
	// TODO: Fix this type error.
	// @ts-ignore
	parentPort!,
);

parentPort!.postMessage('worker-started');
