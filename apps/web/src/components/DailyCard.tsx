import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DailyResponse } from '@terminal-quest/shared';
import { api } from '../api/client.js';
import { strings } from '../strings.js';

/** Today's deterministic challenge card for the world map (plan.md §10.5). */
export function DailyCard({ levelTitles }: { levelTitles: Map<string, string> }) {
  const [daily, setDaily] = useState<DailyResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .daily()
      .then((d) => {
        if (!cancelled) {
          setDaily(d);
        }
      })
      .catch(() => {
        // Daily is a bonus surface; a failure hides the card instead of
        // breaking the map.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (daily === null) {
    return null;
  }
  return (
    <section
      aria-label={strings.dailyTitle}
      data-testid="daily-card"
      className="rounded-lg border border-amber bg-panel p-4"
    >
      <h2 className="font-mono text-sm text-amber">{strings.dailyTitle}</h2>
      <p className="mt-1 text-text">{levelTitles.get(daily.levelId) ?? daily.levelId}</p>
      {daily.completed ? (
        <p className="mt-2 font-mono text-xs text-green">{strings.dailyCompleted}</p>
      ) : (
        <Link
          className="mt-2 inline-block rounded-md bg-amber px-4 py-2 font-mono text-sm font-bold text-bg"
          to={`/play/${daily.levelId}`}
        >
          {strings.dailyPlay}
        </Link>
      )}
    </section>
  );
}
