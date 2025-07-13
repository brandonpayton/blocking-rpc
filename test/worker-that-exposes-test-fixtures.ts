import { parentPort, isMainThread } from 'node:worker_threads';
import { expose } from '../index.ts';

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
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- We want a universal identity function.
	propIdentityFunction: (value: any) => value,
	propArray: [1, 2, 3],
	add(a: number, b: number) {
		return a + b;
	},
	throwTypeError(message: string) {
		throw new TypeError(message);
	},
	callWithObjectReturnValue() {
		return {
			propOneTwoThreeNumber: 123,
			doubleIt: (x: number) => x * 2,
		};
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
	// @ts-expect-error - parentPort is defined in the worker thread.
	parentPort!,
);

parentPort!.postMessage('worker-started');
