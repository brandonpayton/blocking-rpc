import { suite, beforeEach, afterEach, test } from "node:test";
import assert from "node:assert";
import { Worker } from "node:worker_threads";

import { consume } from "./index.ts";

import type { Fixture } from "./test/worker-that-exposes-test-fixtures.ts";

suite("Blocking RPC", () => {
	let worker: Worker;
	let fixture: Fixture;

	beforeEach(async () => {
		worker = new Worker(
			new URL("./test/worker-that-exposes-test-fixtures.ts", import.meta.url),
		);
		await new Promise<Worker>((resolve, reject) => {
			function startedHandler(message: any) {
				console.log("startedHandler", message);
				if (message === "worker-started") {
					done();
				}
			}
			function done(error?: Error) {
				if (error) {
					reject(error);
				} else {
					resolve(worker);
				}
				worker.off("message", startedHandler);
				worker.off("error", errorHandler);
			}
			function errorHandler(error: any) {
				console.log("errorHandler", error);
				done(error);
			}
			worker.on("message", startedHandler);
			worker.on("error", errorHandler);
		});
		fixture = consume("fixture", worker);
	});
	afterEach(async () => {
		await worker.terminate();
	});

	test("get undefined properties", async () => {
		assert.equal(fixture.propUndefined, undefined);
		assert.equal(fixture.nested.propUndefined, undefined);
	});
	test("get boolean properties", async () => {
		assert.equal(fixture.propTrue, true);
		assert.equal(fixture.nested.propTrue, true);
		assert.equal(fixture.propFalse, false);
		assert.equal(fixture.nested.propFalse, false);
	});
	test("get number property", async () => {
		assert.equal(fixture.propZeroNumber, 0);
		assert.equal(fixture.nested.propZeroNumber, 0);
		assert.equal(fixture.propOneTwoThreeNumber, 123);
		assert.equal(fixture.nested.propOneTwoThreeNumber, 123);
		assert.equal(fixture.propOneTwoThreePointTwoFiveNumber, 123.25);
		assert.equal(fixture.nested.propOneTwoThreePointTwoFiveNumber, 123.25);
		assert.equal(fixture.propNegativeOneNumber, -1);
		assert.equal(fixture.nested.propNegativeOneNumber, -1);
		assert.equal(fixture.propNegativeOnePointFiveNumber, -1.5);
		assert.equal(fixture.nested.propNegativeOnePointFiveNumber, -1.5);
	});
	test("get string property", async () => {
		assert.equal(fixture.propEmptyString, "");
		assert.equal(fixture.nested.propHelloWorldString, "Hello World");
	});
	test("get object property", async () => {
		assert.deepEqual(fixture.propObject, { a: 1, b: 2, nested: { c: 3, d: 4 } });
		assert.deepEqual(fixture.nested.propObject, { a: 1, b: 2, nested: { c: 3, d: 4 } });
	});
	test("get Uint8Array property", async () => {
		assert.deepEqual(fixture.propUint8Array, new Uint8Array([1, 2, 3]));
		assert.deepEqual(fixture.nested.propUint8Array, new Uint8Array([1, 2, 3]));
	});
	test("get Error property", async () => {
		const expectedError = new Error("test");
		const actualError = fixture.propIdentityFunction(expectedError);
		assert.equal(actualError.message, expectedError.message);
		assert.deepEqual(expectedError, actualError);
	});
	test("call function", async () => {
		assert.equal(fixture.propIdentityFunction(undefined), undefined);
		assert.equal(fixture.propIdentityFunction(null), null);
		assert.equal(fixture.propIdentityFunction(true), true);
		assert.equal(fixture.propIdentityFunction(false), false);
		assert.equal(fixture.propIdentityFunction(0), 0);
		assert.equal(fixture.propIdentityFunction(1), 1);
		assert.equal(fixture.propIdentityFunction(-1), -1);
		assert.equal(fixture.propIdentityFunction(1.5), 1.5);
		assert.equal(fixture.propIdentityFunction(Math.PI), Math.PI);
		const expectedError = new Error("test");
		const actualError = fixture.propIdentityFunction(expectedError);
		assert.equal(actualError.message, expectedError.message);
		assert.deepEqual(expectedError, actualError);
		assert.deepEqual(
			fixture.propIdentityFunction(new Uint8Array([1, 2, 3])),
			new Uint8Array([1, 2, 3]),
		);
		assert.deepEqual(
			// Use Object.entries to avoid comparing Symbol properties in the result.
			Object.entries(
				fixture.propIdentityFunction({ a: 1, b: 2, nested: { c: 3, d: 4 } })
			),
			Object.entries({ a: 1, b: 2, nested: { c: 3, d: 4 } }),
		);
	});
	test.todo('can use remote arrays');
	test.todo("set remote property");
	test("thrown error is propagated", async () => {
		assert.throws(
			() => fixture.throwTypeError("expected message"),
			TypeError,
			"expected message",
		);
	});
});
