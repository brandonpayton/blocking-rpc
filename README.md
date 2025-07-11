# blocking-rpc

This is a blocking RPC implementation for use by WebAssembly imports. It relies upon SharedArrayBuffer and the Atomics API for blocking and data transfer.

Inspired by the Promise-based [comlink](https://github.com/GoogleChromeLabs/comlink/) library.

## API

- `expose(exposedName, exposedValue, endpoint)`
- `consume(exposedName, endpoint)`

## Example

### Make a value available to a remote endpoint

```ts
import { expose } from 'blocking-rpc';

const worker = new Worker('...');
const obj = {
	log(x: any) { console.log(x); }
	// ...
};
expose('example-obj', obj, worker);
```

### Interact with a remote value

```ts
import { consume } from 'blocking-rpc';
import { parentPort } from 'node:worker_threads';

const example = consume('example-obj', parentPort!)
example.log('hello from the consuming thread!');
```