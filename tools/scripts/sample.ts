import { parseArgs } from 'node:util';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { cpus, loadavg, release, totalmem } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { LoadSampleOptionsSchema } from '@terminal-quest/shared';
import { command, cpuPercent, cpuTicks, csvRow, hostSample } from './host.js';

const { values } = parseArgs({
  options: {
    'server-pid': { type: 'string' },
    out: { type: 'string' },
    help: { type: 'boolean' },
  },
});

if (values.help) {
  console.log(`Usage (Linux VM, as tq with the rootless Docker context):
  pnpm loadtest:sample --server-pid PID --out /absolute/host.csv
Samples host CPU, memory, server RSS and Docker every 5 s until Ctrl+C.
Start at least 60 s before the load driver. See loadtest.md.`);
} else {
  if (process.platform !== 'linux') throw new Error('host sampling requires the Linux target VM');
  const options = LoadSampleOptionsSchema.parse({
    serverPid: values['server-pid'],
    out: values.out,
  });
  const metadata = {
    startedAt: new Date().toISOString(),
    node: process.version,
    kernel: release(),
    logicalCpus: cpus().length,
    cpuModel: cpus()[0]?.model,
    memoryBytes: totalmem(),
    osRelease: await readFile('/etc/os-release', 'utf8'),
    serverPid: options.serverPid,
    commit: await command('git', ['rev-parse', 'HEAD']),
    dockerVersion: await command('docker', ['version', '--format', '{{.Server.Version}}']),
    dockerMode: await command('docker', [
      'info',
      '--format',
      'security={{json .SecurityOptions}} cgroup={{.CgroupVersion}} driver={{.CgroupDriver}} warnings={{json .Warnings}}',
    ]),
  };
  await writeFile(`${options.out}.meta.json`, JSON.stringify(metadata, null, 2) + '\n', {
    flag: 'wx',
  });
  await writeFile(
    options.out,
    'at,hostCpuPct,hostUsedMiB,hostAvailableMiB,serverRssMiB,managedRunning,managedTotal,load1,dockerStats\n',
    { flag: 'wx' },
  );
  const stop = new AbortController();
  const cancel = () => stop.abort();
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  let previous = cpuTicks(await readFile('/proc/stat', 'utf8'));
  let nextAt = performance.now() + 5000;
  try {
    while (!stop.signal.aborted) {
      try {
        await sleep(Math.max(0, nextAt - performance.now()), undefined, { signal: stop.signal });
      } catch (error) {
        if (stop.signal.aborted) break;
        throw error;
      }
      const began = performance.now();
      const at = new Date().toISOString();
      const sample = await hostSample(options.serverPid);
      await appendFile(
        options.out,
        csvRow([
          at,
          cpuPercent(previous, sample.cpu),
          sample.memoryUsedMiB,
          sample.memoryAvailableMiB,
          sample.rssMiB,
          sample.managedRunning,
          sample.managedTotal,
          loadavg()[0],
          JSON.stringify(sample.dockerStats),
        ]),
      );
      previous = sample.cpu;
      nextAt = Math.max(nextAt + 5000, performance.now());
      if (performance.now() - began > 5000) console.error(`${at} sample took over 5 s`);
    }
  } catch (error) {
    await appendFile(`${options.out}.errors.log`, `${new Date().toISOString()} ${String(error)}\n`);
    console.error(error);
    process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  }
}
