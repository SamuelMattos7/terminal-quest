export class ResourceLimitError extends Error {
  constructor(resource: string) {
    super(`${resource} limit exceeded`);
    this.name = 'ResourceLimitError';
  }
}

/** Fixed one-second window; rejected traffic cannot grow the counter. */
export function createBudget(limit: number, now: () => number = Date.now) {
  let start = now();
  let used = 0;
  return {
    take(amount = 1): boolean {
      const at = now();
      if (at - start >= 1000) {
        start = at;
        used = 0;
      }
      if (amount > limit - used) return false;
      used += amount;
      return true;
    },
  };
}
