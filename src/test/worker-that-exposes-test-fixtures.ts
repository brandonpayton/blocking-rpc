// TODO: How to embed this worker in a test module?

import { parentPort, isMainThread } from 'node:worker_threads';
import { expose } from '../index.ts';

if (isMainThread) {
  throw new Error('This file should only be run as a worker thread.');
}

const props = {
	propOneTwoThree: 123,
	propHelloWorld: 'Hello World',
	add(a: number, b: number) {
		return a + b;
	},
}

const fixture = {
	...props,
	nested: {
		...props,
	},
};

export type Fixture = typeof fixture;

console.log("exposing calculator");

expose(
	'fixture',
	fixture,
	// TODO: Fix this type error.
	// @ts-ignore
	parentPort!,
);

parentPort!.postMessage('worker-started');

console.log('posted message: worker-started');

