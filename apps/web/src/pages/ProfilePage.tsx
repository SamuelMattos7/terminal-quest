import { useEffect, useState } from 'react';
import type { BadgesResponse } from '@terminal-quest/shared';
import { Header } from '../components/Header.js';
import { api } from '../api/client.js';
import { useGame } from '../stores/game.js';
import { strings } from '../strings.js';

function DisplayNameEditor({ current }: { current: string | null }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(current ?? '');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!editing) {
      setDraft(current ?? '');
      setFailed(false);
    }
  }, [current, editing]);

  if (!editing) {
    return (
      <div className="flex items-center gap-3">
        <span className="font-mono text-lg text-text" data-testid="display-name">
          {current ?? '—'}
        </span>
        <button
          type="button"
          onClick={() => {
            setEditing(true);
          }}
          className="rounded-md border border-border px-3 py-1 font-mono text-xs text-text"
        >
          {strings.editName}
        </button>
      </div>
    );
  }

  const save = async (): Promise<void> => {
    setFailed(false);
    await useGame.getState().rename(draft);
    if (useGame.getState().error === null) {
      setEditing(false);
    } else {
      setFailed(true);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="display-name-input" className="font-mono text-xs text-muted">
        {strings.displayNameLabel}
      </label>
      <div className="flex gap-2">
        <input
          id="display-name-input"
          value={draft}
          maxLength={40}
          onChange={(e) => {
            setDraft(e.target.value);
          }}
          className="rounded-md border border-border bg-panel px-3 py-2 text-text"
        />
        <button
          type="button"
          onClick={() => {
            void save();
          }}
          className="rounded-md bg-green px-4 py-2 font-mono text-sm font-bold text-bg"
        >
          {strings.saveName}
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing(false);
          }}
          className="rounded-md border border-border px-4 py-2 font-mono text-sm text-muted"
        >
          {strings.cancelEdit}
        </button>
      </div>
      {failed && (
        <p role="alert" className="text-sm text-red">
          {strings.saveFailed}
        </p>
      )}
    </div>
  );
}

/** Profile: display name, badges, and stats (plan.md §9.2). */
export function ProfilePage() {
  const me = useGame((s) => s.me);
  const progress = useGame((s) => s.progress);
  const loading = useGame((s) => s.loading);
  const error = useGame((s) => s.error);
  const [badges, setBadges] = useState<BadgesResponse | null>(null);
  const [badgesFailed, setBadgesFailed] = useState(false);

  useEffect(() => {
    if ((me === null || progress === null) && !loading && error === null) {
      void useGame.getState().refresh();
    }
  }, [me, progress, loading, error]);

  useEffect(() => {
    let cancelled = false;
    api
      .badges()
      .then((b) => {
        if (!cancelled) {
          setBadges(b);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBadgesFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const totals = progress?.totals;
  const stats: Array<[string, string]> =
    totals === undefined || totals === null
      ? []
      : [
          [strings.statXp, String(totals.xp)],
          [strings.statLevelsDone, String(totals.levelsCompleted)],
          [strings.statCompletions, String(totals.completions)],
          [strings.statHintsUsed, String(totals.hintsUsed)],
          [strings.statStreak, String(me?.user.streakDays ?? 0)],
        ];

  return (
    <div className="min-h-screen bg-bg">
      <Header me={me} />
      <main className="mx-auto flex max-w-3xl flex-col gap-6 p-4">
        <h1 className="font-mono text-2xl text-text">{strings.profileTitle}</h1>
        {loading && me === null && <p className="text-muted">{strings.pageLoading}</p>}
        {error !== null && me === null && (
          <p role="alert" className="text-red">
            {strings.pageError} ({error})
          </p>
        )}
        {me !== null && (
          <>
            <DisplayNameEditor current={me.user.displayName} />
            <section aria-label={strings.statsTitle}>
              <h2 className="mb-2 font-mono text-sm text-cyan">{strings.statsTitle}</h2>
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {stats.map(([label, value]) => (
                  <div key={label} className="rounded-md border border-border bg-panel px-3 py-2">
                    <dt className="font-mono text-xs text-muted">{label}</dt>
                    <dd className="font-mono text-xl text-text" data-testid={`stat-${label}`}>
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
            <section aria-label={strings.badgesTitle}>
              <h2 className="mb-2 font-mono text-sm text-cyan">{strings.badgesTitle}</h2>
              {badgesFailed && (
                <p role="alert" className="text-sm text-red">
                  {strings.pageError}
                </p>
              )}
              {badges !== null && (
                <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {badges.badges.map((badge) => {
                    const earned = badge.earnedAt !== null;
                    return (
                      <li
                        key={badge.id}
                        data-testid={`badge-${badge.id}`}
                        className={`rounded-md border px-3 py-2 ${
                          earned ? 'border-green bg-panel' : 'border-border bg-panel opacity-60'
                        }`}
                      >
                        <p className="font-mono text-sm text-text">{badge.title}</p>
                        <p className="text-xs text-muted">{badge.description}</p>
                        {!earned && (
                          <p className="mt-1 font-mono text-xs text-muted">{strings.badgeLocked}</p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
