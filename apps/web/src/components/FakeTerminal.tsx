import { useEffect, useState } from 'react';
import { strings } from '../strings.js';
import { useSettings } from '../stores/settings.js';

const TICK_MS = 45;

/** Decorative hero terminal that types the first command (plan.md §9.2). */
export function FakeTerminal() {
  const reducedMotion = useSettings((s) => s.reducedMotion);
  const command = strings.fakeTerminalCommand;
  const [typed, setTyped] = useState(() => (reducedMotion ? command.length : 0));

  useEffect(() => {
    if (reducedMotion) {
      setTyped(command.length);
      return;
    }
    if (typed >= command.length) {
      return;
    }
    const timer = setTimeout(() => {
      setTyped((n) => Math.min(n + 1, command.length));
    }, TICK_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [typed, reducedMotion, command.length]);

  const done = typed >= command.length;
  return (
    <div
      aria-hidden="true"
      className="rounded-lg border border-border bg-panel p-4 font-mono text-sm"
    >
      <p className="text-text">
        <span className="text-green">{strings.fakeTerminalPrompt} </span>
        {command.slice(0, typed)}
        {!done && <span className="animate-pulse text-green">▊</span>}
      </p>
      {done && <p className="mt-1 text-muted">{strings.fakeTerminalOutput}</p>}
    </div>
  );
}
