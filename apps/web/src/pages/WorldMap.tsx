import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { DailyCard } from '../components/DailyCard.js';
import { Header } from '../components/Header.js';
import { ReviewBanner } from '../components/ReviewBanner.js';
import { WorldCard } from '../components/WorldCard.js';
import { useGame } from '../stores/game.js';
import { strings } from '../strings.js';

export function WorldMap() {
  const me = useGame((s) => s.me);
  const worlds = useGame((s) => s.worlds);
  const loading = useGame((s) => s.loading);
  const error = useGame((s) => s.error);

  useEffect(() => {
    if (worlds === null && !loading && error === null) {
      void useGame.getState().refresh();
    }
  }, [worlds, loading, error]);

  const levelTitles = new Map<string, string>();
  for (const world of worlds?.worlds ?? []) {
    for (const level of world.levels) {
      levelTitles.set(level.id, level.title);
    }
  }

  return (
    <div className="min-h-screen bg-bg">
      <Header me={me} />
      <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
        <h1 className="font-mono text-2xl text-text">{strings.mapTitle}</h1>{' '}
        {loading && worlds === null && <p className="text-muted">{strings.mapLoading}</p>}
        {error !== null && worlds === null && (
          <div role="alert" className="rounded-md border border-red bg-panel p-4">
            <p className="text-red">
              {strings.mapError} ({error})
            </p>
            <div className="mt-3 flex gap-3">
              <button
                type="button"
                onClick={() => {
                  void useGame.getState().refresh();
                }}
                className="rounded-md border border-border px-4 py-2 font-mono text-text hover:border-green"
              >
                {strings.mapRetry}
              </button>
              <Link className="px-4 py-2 font-mono text-cyan underline" to="/">
                {strings.startPlaying}
              </Link>
            </div>
          </div>
        )}
        {worlds !== null && (
          <>
            <DailyCard levelTitles={levelTitles} />
            <ReviewBanner levelTitles={levelTitles} />
            <div className="flex flex-col gap-4">
              {worlds.worlds.map((world, index) => (
                <WorldCard key={world.id} world={world} index={index} />
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
