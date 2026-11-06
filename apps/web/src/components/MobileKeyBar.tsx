import { useLayoutEffect, useRef } from 'react';
import { strings } from '../strings.js';

interface KeypadKey {
  label: string;
  ariaLabel: string;
  seq: string;
}

// Raw sequences from plan.md §9.6. Accessible names match the visible labels
// exactly (WCAG 2.5.3 Label in Name).
const KEYS: KeypadKey[] = [
  { label: strings.keyTab, ariaLabel: strings.keyTab, seq: '\t' },
  { label: strings.keyEsc, ariaLabel: strings.keyEsc, seq: '\x1b' },
  { label: '↑', ariaLabel: strings.keyUp, seq: '\x1b[A' },
  { label: '↓', ariaLabel: strings.keyDown, seq: '\x1b[B' },
  { label: '←', ariaLabel: strings.keyLeft, seq: '\x1b[D' },
  { label: '→', ariaLabel: strings.keyRight, seq: '\x1b[C' },
  { label: '|', ariaLabel: '|', seq: '|' },
  { label: '~', ariaLabel: '~', seq: '~' },
  { label: '/', ariaLabel: '/', seq: '/' },
  { label: '-', ariaLabel: '-', seq: '-' },
  { label: strings.keyInterrupt, ariaLabel: strings.keyInterrupt, seq: '\x03' },
  { label: strings.keyEof, ariaLabel: strings.keyEof, seq: '\x04' },
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
  const spacerRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const spacer = spacerRef.current;
    const toolbar = toolbarRef.current;
    if (spacer === null || toolbar === null) return;

    const viewport = window.visualViewport;
    const updatePosition = (): void => {
      const bottom = viewport
        ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
        : 0;
      toolbar.style.bottom = `${bottom}px`;
      toolbar.style.maxHeight = viewport ? `${viewport.height}px` : '';
    };
    const reserveSpace = (): void => {
      spacer.style.height = `${toolbar.offsetHeight}px`;
    };

    updatePosition();
    reserveSpace();
    viewport?.addEventListener('resize', updatePosition);
    viewport?.addEventListener('scroll', updatePosition);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(reserveSpace) : null;
    observer?.observe(toolbar);
    return () => {
      observer?.disconnect();
      viewport?.removeEventListener('resize', updatePosition);
      viewport?.removeEventListener('scroll', updatePosition);
    };
  }, []);

  return (
    <>
      <div ref={spacerRef} aria-hidden="true" />
      <div
        ref={toolbarRef}
        role="toolbar"
        aria-label={strings.keybarLabel}
        data-testid="mobile-keybar"
        className="fixed inset-x-0 bottom-0 z-10 hidden max-h-dvh flex-wrap gap-1 overflow-y-auto overscroll-contain rounded-t-lg border border-border bg-panel p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] max-lg:[@media(pointer:coarse)]:flex"
        onPointerDown={(event) => {
          if (event.pointerType === 'touch' || event.pointerType === 'pen') {
            // Keep the terminal's input focused so tapping a key leaves the keyboard open.
            event.preventDefault();
          }
        }}
      >
        <button
          type="button"
          aria-label={strings.keyCtrl}
          aria-pressed={ctrlArmed}
          title={ctrlArmed ? strings.ctrlArmed : undefined}
          onClick={onToggleCtrl}
          className={`min-h-9 min-w-9 rounded px-2 py-2 font-mono text-sm ${
            ctrlArmed ? 'bg-green text-bg' : 'border border-border text-text'
          }`}
        >
          {strings.keyCtrl}
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
    </>
  );
}
