export function percentile(values: readonly number[], quantile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)];
}

export function latencySummary(values: readonly number[]) {
  return { count: values.length, p50Ms: percentile(values, 0.5), p95Ms: percentile(values, 0.95) };
}

/** Only retain enough output to match a pending marker across frame boundaries. */
export class MarkerMatcher {
  private tail = '';

  constructor(private readonly marker: string) {}

  push(chunk: string): boolean {
    const combined = this.tail + chunk;
    const found = combined.includes(this.marker);
    this.tail = this.marker.length > 1 ? combined.slice(-(this.marker.length - 1)) : '';
    return found;
  }
}
