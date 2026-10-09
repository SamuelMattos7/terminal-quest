import { useState } from 'react';
import type { PublicLevel } from '@terminal-quest/shared';
import type { RevealedHint, SessionToast } from '../session/useSession.js';
import { strings } from '../strings.js';
import { Announcer } from './Announcer.js';
import { HintPanel } from './HintPanel.js';
import { ObjectiveList, type ObjectiveItem } from './ObjectiveList.js';
import { Toasts } from './Toasts.js';

interface QuestPanelProps {
  level: PublicLevel;
  items: ObjectiveItem[];
  hints: RevealedHint[];
  hintsUsed: number;
  hintsTotal: number;
  canRequestHint: boolean;
  toasts: SessionToast[];
  onRequestHint: () => void;
  onReset: () => void;
  onLeave: () => void;
  onDismissToast: (id: number) => void;
  onFocusTerminal: () => void;
}

/** Right-hand mission panel: story, objectives, hints, reset/leave (plan.md §9.3). */
export function QuestPanel({
  level,
  items,
  hints,
  hintsUsed,
  hintsTotal,
  canRequestHint,
  toasts,
  onRequestHint,
  onReset,
  onLeave,
  onDismissToast,
  onFocusTerminal,
}: QuestPanelProps) {
  const [confirmingReset, setConfirmingReset] = useState(false);

  return (
    <section
      id="quest-panel"
      tabIndex={-1}
      aria-label={strings.missionTab}
      onClick={onFocusTerminal}
      className="flex min-h-0 flex-col gap-4 overflow-y-auto rounded-lg border border-border bg-panel p-4"
    >
      <div className="flex items-start gap-3">
        <pre aria-hidden="true" className="font-mono text-xs leading-tight text-green">
          {'  (o_\n  (//\\\n  V_/_)'}
        </pre>
        <div>
          <h2 className="font-mono text-lg text-text">{level.title}</h2>
          <p className="mt-1 text-sm text-muted">{level.story}</p>
        </div>
      </div>

      <div>
        <h3 className="mb-2 font-mono text-sm text-cyan">{strings.objectivesTitle}</h3>
        <ObjectiveList items={items} />
      </div>

      <HintPanel
        hints={hints}
        hintsUsed={hintsUsed}
        hintsTotal={hintsTotal}
        canRequest={canRequestHint}
        onRequestHint={onRequestHint}
      />

      <Toasts toasts={toasts} onDismiss={onDismissToast} />
      <Announcer items={items} />

      <div className="mt-auto flex gap-2 pt-2">
        {confirmingReset ? (
          <div role="group" aria-label={strings.resetLevel} className="flex flex-1 flex-col gap-2">
            <p className="text-sm text-amber">{strings.resetConfirm}</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setConfirmingReset(false);
                  onReset();
                }}
                className="flex-1 rounded-md bg-red px-3 py-2 font-mono text-sm text-bg"
              >
                {strings.resetConfirmYes}
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmingReset(false);
                }}
                className="flex-1 rounded-md border border-border px-3 py-2 font-mono text-sm text-text"
              >
                {strings.resetConfirmNo}
              </button>
            </div>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => {
                setConfirmingReset(true);
              }}
              className="flex-1 rounded-md border border-border px-3 py-2 font-mono text-sm text-muted hover:text-text"
            >
              {strings.resetLevel}
            </button>
            <button
              type="button"
              onClick={onLeave}
              className="flex-1 rounded-md border border-border px-3 py-2 font-mono text-sm text-muted hover:text-text"
            >
              {strings.leaveLevel}
            </button>
          </>
        )}
      </div>
    </section>
  );
}
