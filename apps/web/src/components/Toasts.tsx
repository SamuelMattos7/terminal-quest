import { useEffect } from 'react';
import type { SessionToast } from '../session/useSession.js';

const DISMISS_MS = 8000;

function ToastItem({ toast, onDismiss }: { toast: SessionToast; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss(toast.id);
    }, DISMISS_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [toast.id, onDismiss]);

  return (
    <div
      role="status"
      className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${
        toast.kind === 'coach'
          ? 'border-cyan bg-panel-2 text-text'
          : 'border-green bg-panel text-text'
      }`}
    >
      <span className="flex-1">{toast.text}</span>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => {
          onDismiss(toast.id);
        }}
        className="flex min-h-6 min-w-6 items-center justify-center font-mono text-muted hover:text-text"
      >
        ×
      </button>
    </div>
  );
}

/** Transient `tux` and `coach` messages (plan.md §9.3 TuxBubble). */
export function Toasts({
  toasts,
  onDismiss,
}: {
  toasts: SessionToast[];
  onDismiss: (id: number) => void;
}) {
  if (toasts.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-2" data-testid="toasts">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
