import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CompleteModal } from '../components/CompleteModal.js';
import { MobileKeyBar } from '../components/MobileKeyBar.js';
import { buildObjectiveItems } from '../components/ObjectiveList.js';
import { QuestPanel } from '../components/QuestPanel.js';
import { TerminalView } from '../components/TerminalView.js';
import { useSession } from '../session/useSession.js';
import { useGame } from '../stores/game.js';
import { strings } from '../strings.js';

/** Level screen: terminal + quest panel + completion modal (plan.md §9.3). */
export function LevelPage() {
  const { levelId } = useParams();
  const navigate = useNavigate();
  const status = useSession((s) => s.status);
  const level = useSession((s) => s.level);
  const statuses = useSession((s) => s.objectives);
  const hints = useSession((s) => s.hints);
  const hintsUsed = useSession((s) => s.hintsUsed);
  const toasts = useSession((s) => s.toasts);
  const completion = useSession((s) => s.completion);
  const error = useSession((s) => s.error);
  const closeReason = useSession((s) => s.closeReason);
  const spellbook = useGame((s) => s.spellbook);
  const [ctrlArmed, setCtrlArmed] = useState(false);
  const ctrlKey = useRef({ armed: false });

  // (Re)start whenever the route level changes. Unmount closes the socket
  // only — the server session idles out via the reaper (T1.3).
  useEffect(() => {
    const session = useSession.getState();
    if (levelId === undefined) {
      return;
    }
    if (session.levelId !== levelId || session.status === 'idle' || session.status === 'closed') {
      void session.start(levelId);
    }
  }, [levelId]);

  useEffect(() => {
    return () => {
      useSession.getState().disconnect();
    };
  }, []);

  // Map progress may have changed (completions, unlocks, badges).
  useEffect(() => {
    if (completion !== null) {
      void useGame.getState().refresh();
    }
  }, [completion]);

  // Notes tab content: saved spellbook notes for this level's skills.
  useEffect(() => {
    if (useGame.getState().spellbook === null) {
      void useGame.getState().loadSpellbook();
    }
  }, []);

  const toggleCtrl = (): void => {
    ctrlKey.current.armed = !ctrlKey.current.armed;
    setCtrlArmed(ctrlKey.current.armed);
  };

  if (levelId === undefined) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <Link className="text-cyan underline" to="/map">
          {strings.levelBackToMap}
        </Link>
      </main>
    );
  }

  const handleLeave = async (): Promise<void> => {
    await useSession.getState().leave();
    navigate('/map');
  };

  if (status === 'closed' && level === null) {
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-3 p-8" data-testid="level-error">
        <p role="alert" className="text-red">
          {strings.levelLoadError} {error !== null ? `(${error})` : ''}
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => {
              void useSession.getState().start(levelId);
            }}
            className="rounded-md border border-border px-4 py-2 font-mono text-text"
          >
            {strings.levelRetry}
          </button>
          <Link className="px-4 py-2 font-mono text-cyan underline" to="/map">
            {strings.levelBackToMap}
          </Link>
        </div>
      </main>
    );
  }

  if (level === null) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <p className="text-muted">{strings.levelStarting}</p>
      </main>
    );
  }

  const items = buildObjectiveItems(level, statuses);
  const nextId = completion?.unlocked[0] ?? null;
  const notes = (spellbook?.entries ?? []).flatMap((e) =>
    level.teaches.includes(e.skillId) && e.note !== null
      ? [{ skillId: e.skillId, title: e.title, note: e.note }]
      : [],
  );

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <main className="mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-[65%_35%]">
        <div className="flex min-h-0 flex-col gap-2">
          <TerminalView
            onLeaveTerminal={() => {
              document.getElementById('quest-panel')?.focus();
            }}
            ctrlKey={ctrlKey}
            onCtrlConsumed={() => {
              setCtrlArmed(false);
            }}
          />
          <MobileKeyBar
            ctrlArmed={ctrlArmed}
            onToggleCtrl={toggleCtrl}
            onKey={(seq) => {
              useSession.getState().sendStdin(seq);
            }}
          />
        </div>
        <QuestPanel
          level={level}
          items={items}
          hints={hints}
          hintsUsed={hintsUsed}
          hintsTotal={3}
          canRequestHint={status === 'live'}
          toasts={toasts}
          notes={notes}
          onRequestHint={() => {
            useSession.getState().requestHint();
          }}
          onReset={() => {
            void useSession.getState().reset();
          }}
          onLeave={() => {
            void handleLeave();
          }}
          onDismissToast={(id) => {
            useSession.getState().dismissToast(id);
          }}
          onFocusTerminal={() => {
            useSession.getState().terminalFocus?.();
          }}
        />
      </main>
      {status === 'closed' && (
        <p role="alert" className="mx-auto w-full max-w-6xl px-4 pb-4 font-mono text-sm text-red">
          {strings.connectionClosed}
          {closeReason !== null ? ` (${closeReason})` : ''}
        </p>
      )}
      {completion !== null && (
        <CompleteModal
          result={completion}
          onNext={nextId === null ? null : () => navigate(`/play/${nextId}`)}
          onReplay={() => {
            void useSession.getState().reset();
          }}
          onBackToMap={() => {
            void handleLeave();
          }}
        />
      )}
    </div>
  );
}
