import type { Logger } from 'pino';
import type { SessionManager } from './sessionManager.js';

// Periodic + boot reaper for plan.md §7.6. The interval is unref'd so it
// never holds the process open; server shutdown (T3.2) stops it explicitly.
export const REAPER_INTERVAL_MS = 30_000;

export class Reaper {
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly manager: SessionManager,
    private readonly logger: Logger,
  ) {}

  async start(): Promise<void> {
    const orphans = await this.manager.sweepOrphans();
    if (orphans > 0) {
      this.logger.info({ orphans }, 'reaper removed orphan sandboxes at boot');
    }
    this.timer = setInterval(() => {
      void this.manager.sweepOnce().then(
        (swept) => {
          if (swept.idle + swept.maxAge > 0) {
            this.logger.info(swept, 'reaper expired sessions');
          }
        },
        (err: unknown) => {
          // A failed sweep retries on the next tick; never kill the loop.
          this.logger.error({ err }, 'reaper sweep failed');
        },
      );
    }, REAPER_INTERVAL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}
