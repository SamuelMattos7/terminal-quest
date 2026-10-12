import type { ServerMessage } from '@terminal-quest/shared';
import { strings } from '../strings.js';

type CompletionResult = Extract<ServerMessage, { t: 'level_complete' }>['result'];

interface CompleteModalProps {
  result: CompletionResult;
  onNext: (() => void) | null;
  onReplay: () => void;
  onBackToMap: () => void;
}

/** Level-complete celebration with rank, XP, skills, and next steps (plan.md §9.3). */
export function CompleteModal({ result, onNext, onReplay, onBackToMap }: CompleteModalProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={strings.completeTitle}
      data-testid="complete-modal"
      className="fixed inset-0 z-10 flex items-center justify-center bg-bg/80 p-4"
    >
      <div className="w-full max-w-lg rounded-lg border border-green bg-panel p-6">
        <h2 className="font-mono text-2xl text-green">{strings.completeTitle}</h2>
        <p className="mt-2 font-mono text-4xl text-text" data-testid="complete-rank">
          {result.rank}
        </p>
        <p className="mt-1 text-muted">
          {strings.completeXp}: <span className="font-mono text-text">{result.xp}</span>
        </p>

        <ul className="mt-3 flex flex-col gap-1">
          {result.breakdown.map((line) => (
            <li key={line.label} className="flex justify-between font-mono text-sm text-muted">
              <span>{line.label}</span>
              <span>+{line.xp}</span>
            </li>
          ))}
        </ul>

        {result.skillsGained.length > 0 && (
          <div className="mt-3">
            <h3 className="font-mono text-sm text-cyan">{strings.completeSkills}</h3>
            <p className="text-sm text-text">{result.skillsGained.join(', ')}</p>
          </div>
        )}

        {result.explain.length > 0 && (
          <div className="mt-3">
            <h3 className="font-mono text-sm text-cyan">{strings.completeExplain}</h3>
            <ul className="mt-1 flex flex-col gap-2">
              {result.explain.map((card) => (
                <li key={card.command} className="rounded bg-panel-2 px-3 py-2 text-sm text-text">
                  <code className="font-mono text-green">{card.command}</code>
                  <ul className="mt-1">
                    {card.parts.map((part) => (
                      <li key={part.token} className="text-muted">
                        <span className="font-mono">{part.token}</span>: {part.meaning}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </div>
        )}

        {result.newBadges.length > 0 && (
          <div className="mt-3">
            <h3 className="font-mono text-sm text-cyan">{strings.completeBadges}</h3>
            <p className="text-sm text-amber">{result.newBadges.join(', ')}</p>
          </div>
        )}

        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          {onNext !== null && (
            <button
              type="button"
              onClick={onNext}
              data-testid="complete-next"
              className="flex-1 rounded-md bg-green px-4 py-2 font-mono font-bold text-bg"
            >
              {strings.nextLevel}
            </button>
          )}
          <button
            type="button"
            onClick={onReplay}
            data-testid="complete-replay"
            className="flex-1 rounded-md border border-border px-4 py-2 font-mono text-text"
          >
            {strings.replayLevel}
          </button>
          <button
            type="button"
            onClick={onBackToMap}
            data-testid="complete-back"
            className="flex-1 rounded-md border border-border px-4 py-2 font-mono text-muted"
          >
            {strings.levelBackToMap}
          </button>
        </div>
      </div>
    </div>
  );
}
