import type { RevealedHint } from '../session/useSession.js';
import { strings } from '../strings.js';

interface HintPanelProps {
  hints: RevealedHint[];
  hintsUsed: number;
  hintsTotal: number;
  canRequest: boolean;
  onRequestHint: () => void;
}

/** Hint button with remaining tiers and the revealed-hints list. */
export function HintPanel({
  hints,
  hintsUsed,
  hintsTotal,
  canRequest,
  onRequestHint,
}: HintPanelProps) {
  const left = Math.max(0, hintsTotal - hintsUsed);
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={!canRequest || left === 0}
        onClick={onRequestHint}
        data-testid="hint-button"
        className="rounded-md border border-amber px-4 py-2 font-mono text-amber disabled:cursor-not-allowed disabled:opacity-40"
      >
        {strings.hintButton} ({left} {strings.hintsLeft})
      </button>
      {hints.length > 0 && (
        <ol className="flex flex-col gap-2">
          {hints.map((hint) => (
            <li
              key={hint.tier}
              className="rounded-md border border-border bg-panel-2 px-3 py-2 text-sm text-text"
            >
              <span className="font-mono text-xs text-amber">Tier {hint.tier} </span>
              {hint.text}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
