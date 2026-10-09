import type { PublicLevel } from '@terminal-quest/shared';
import { strings } from '../strings.js';

export interface ObjectiveItem {
  id: string;
  text: string;
  optional: boolean;
  bonus: boolean;
  status: 'pending' | 'done';
}

/** Join public objective text with live completion statuses. */
export function buildObjectiveItems(
  level: PublicLevel,
  statuses: Array<{ id: string; status: 'pending' | 'done' }>,
): ObjectiveItem[] {
  const byId = new Map(statuses.map((s) => [s.id, s.status]));
  return level.objectives.map((o) => ({
    id: o.id,
    text: o.text,
    optional: o.optional,
    bonus: o.bonus,
    status: byId.get(o.id) ?? 'pending',
  }));
}

/** Checkbox-style objective list with bonus labels (plan.md §9.3). */
export function ObjectiveList({ items }: { items: ObjectiveItem[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => {
        const done = item.status === 'done';
        return (
          <li
            key={item.id}
            data-testid={`objective-${item.id}`}
            className={`flex items-start gap-2 rounded-md border px-3 py-2 ${
              done ? 'border-green bg-panel-2' : 'border-border bg-panel'
            }`}
          >
            <span
              aria-hidden="true"
              className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border font-mono text-xs ${
                done ? 'border-green bg-green text-bg' : 'border-muted text-transparent'
              }`}
            >
              ✓
            </span>
            <span className={done ? 'text-text' : 'text-muted'}>
              {item.text}
              <span className="sr-only">
                {done ? strings.objectiveDone : strings.objectivePending}
              </span>
            </span>
            {item.bonus && (
              <span className="ml-auto shrink-0 rounded bg-amber px-1 font-mono text-xs text-bg">
                {strings.bonusLabel}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
