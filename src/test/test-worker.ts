import { parentPort, isMainThread } from 'node:worker_threads';

if (isMainThread) {
  throw new Error('This file should only be run as a worker thread.');
}

parentPort!.postMessage('worker-started');