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
	afterEach(() => {
		worker.terminate();
	});

	test("number property", async () => {
		assert.equal(fixture.propOneTwoThree, 123);
	});
	test("number property access - nested", async () => {
		assert.equal(fixture.nested.propOneTwoThree, 123);
	});
	test("string property", async () => {
		assert.equal(fixture.propHelloWorld, "Hello World");
	});
	test("string property access - nested", async () => {
		assert.equal(fixture.nested.propHelloWorld, "Hello World");
	});
	test("function property", async () => {
		assert.equal(fixture.add(1, 2), 3);
	});
	test("function property access - nested", async () => {
		assert.equal(fixture.nested.add(3, 4), 7);
	});
});
