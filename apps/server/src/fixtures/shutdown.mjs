import process from 'node:process';
import { setTimeout } from 'node:timers/promises';
import { DockerProvider } from '../../dist/sandbox/dockerProvider.js';

// Only replace the Docker boundary. Fastify, SQLite, WebSockets and the
// compiled entry point all use their production implementations.
Object.assign(DockerProvider.prototype, {
  async listManaged() {
    return [];
  },
  async create(spec) {
    return { id: 'shutdown-fixture', spec };
  },
  async putFiles() {},
  async exec() {
    return { code: 0, stdout: '', stderr: '', timedOut: false };
  },
  async openShell() {
    return { onData() {}, onClose() {}, close() {} };
  },
  async watchFile() {
    return { stop() {} };
  },
  async destroy() {
    await setTimeout(25);
    process.stdout.write('fixture sandbox destroyed\n');
  },
});

if (process.platform === 'win32') {
  process.on('message', (signal) => {
    if (signal === 'SIGTERM' || signal === 'SIGINT') {
      process.emit(signal, signal);
      process.emit(signal, signal);
    }
  });
  process.channel?.unref();
}
