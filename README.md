# blocking-rpc

This is a blocking RPC implementation for use by WebAssembly imports. It relies upon SharedArrayBuffer and the Atomics API for blocking and data transfer.

Inspired by the Promise-based [comlink](https://github.com/GoogleChromeLabs/comlink/) library.
