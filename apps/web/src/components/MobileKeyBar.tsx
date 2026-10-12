import { strings } from '../strings.js';

interface KeypadKey {
  label: string;
  ariaLabel: string;
  seq: string;
}

// Raw sequences from plan.md §9.6. Accessible names match the visible labels
// exactly (WCAG 2.5.3 Label in Name).
const KEYS: KeypadKey[] = [
  { label: 'Tab', ariaLabel: 'Tab', seq: '\t' },
  { label: 'Esc', ariaLabel: 'Esc', seq: '\x1b' },
  { label: '↑', ariaLabel: 'Up arrow', seq: '\x1b[A' },
  { label: '↓', ariaLabel: 'Down arrow', seq: '\x1b[B' },
  { label: '←', ariaLabel: 'Left arrow', seq: '\x1b[D' },
  { label: '→', ariaLabel: 'Right arrow', seq: '\x1b[C' },
  { label: '|', ariaLabel: '|', seq: '|' },
  { label: '~', ariaLabel: '~', seq: '~' },
  { label: '/', ariaLabel: '/', seq: '/' },
  { label: '-', ariaLabel: '-', seq: '-' },
  { label: 'Ctrl+C', ariaLabel: 'Ctrl+C', seq: '\x03' },
  { label: 'Ctrl+D', ariaLabel: 'Ctrl+D', seq: '\x04' },
];

interface MobileKeyBarProps {
  ctrlArmed: boolean;
  onToggleCtrl: () => void;
  onKey: (seq: string) => void;
}

/**
 * Touch key bar for the level terminal (plan.md §9.6). Coarse-pointer small
 * screens only; desktop keeps its physical keyboard.
 */
export function MobileKeyBar({ ctrlArmed, onToggleCtrl, onKey }: MobileKeyBarProps) {
  return (
    <div
      role="toolbar"
      aria-label={strings.keybarLabel}
      data-testid="mobile-keybar"
      className="hidden flex-wrap gap-1 rounded-lg border border-border bg-panel p-2 [@media(pointer:coarse)]:flex lg:hidden"
    >
      <button
        type="button"
        aria-label="Ctrl"
        aria-pressed={ctrlArmed}
        title={ctrlArmed ? strings.ctrlArmed : undefined}
        onClick={onToggleCtrl}
        className={`min-h-9 min-w-9 rounded px-2 py-2 font-mono text-sm ${
          ctrlArmed ? 'bg-green text-bg' : 'border border-border text-text'
        }`}
      >
        Ctrl
      </button>
      {KEYS.map((key) => (
        <button
          key={key.ariaLabel}
          type="button"
          aria-label={key.ariaLabel}
          onClick={() => {
            onKey(key.seq);
          }}
          className="min-h-9 min-w-9 rounded border border-border px-2 py-2 font-mono text-sm text-text"
        >
          {key.label}
        </button>
      ))}
    </div>
  );
}
