import { parseArgs } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { LoadTestOptionsSchema } from '@terminal-quest/shared';
import { runScenario } from './scenario.js';

const { values } = parseArgs({
  options: {
    'base-url': { type: 'string' },
    origin: { type: 'string' },
    out: { type: 'string' },
    mode: { type: 'string' },
    'idle-ttl-seconds': { type: 'string' },
    help: { type: 'boolean' },
  },
});

if (values.help) {
  console.log(`Usage: pnpm loadtest --base-url https://quest.example.com --out /absolute/run.json
  --origin ORIGIN          defaults to --base-url; must equal server PUBLIC_ORIGIN
  --mode capacity|idle     default capacity: 21 guests, 60 s ramp, 5 min hold, 60 s cooldown
  --idle-ttl-seconds 30    idle mode only; configure the server's TTL separately
Run only against a dedicated test deployment. See loadtest.md for host sampling and recovery.`);
} else {
  const options = LoadTestOptionsSchema.parse({
    baseUrl: values['base-url'],
    origin: values.origin ?? values['base-url'],
    out: values.out,
    mode: values.mode,
    idleTtlSeconds: values['idle-ttl-seconds'],
  });
  const report: Record<string, unknown> = {
    status: 'running',
    mode: options.mode,
    baseUrl: options.baseUrl,
    origin: options.origin,
    // The independent host evidence and recovery checks are required for T9.2.
    targetVmVerified: false,
  };
  // Reserve the output before sending any load; never overwrite an earlier run.
  await writeFile(options.out, JSON.stringify(report, null, 2), { flag: 'wx' });
  const stop = new AbortController();
  const cancel = () => stop.abort(new Error('driver interrupted'));
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  try {
    await runScenario(options, report, stop.signal, (event) =>
      console.log(`${new Date().toISOString()} ${event}`),
    );
    report.status = 'client checks passed; host evidence and recovery checks still required';
  } catch (error) {
    report.status = 'failed';
    report.error = String(error);
    console.error(error);
    process.exitCode = 1;
  } finally {
    report.finishedAt = new Date().toISOString();
    await writeFile(options.out, JSON.stringify(report, null, 2) + '\n');
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  }
}
