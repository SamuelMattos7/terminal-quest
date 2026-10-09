import { useEffect, useRef, useState } from 'react';
import { strings } from '../strings.js';
import type { ObjectiveItem } from './ObjectiveList.js';

/** ARIA live region announcing objective completions (plan.md §9.5). */
export function Announcer({ items }: { items: ObjectiveItem[] }) {
  const [announcement, setAnnouncement] = useState('');
  const prevDone = useRef<Set<string> | null>(null);

  useEffect(() => {
    const done = new Set(items.filter((i) => i.status === 'done').map((i) => i.id));
    if (prevDone.current === null) {
      // First render: baseline silently so pre-done items are not announced.
      prevDone.current = done;
      return;
    }
    const newly = items.find((i) => i.status === 'done' && !prevDone.current?.has(i.id));
    prevDone.current = done;
    if (newly !== undefined) {
      setAnnouncement(`${strings.objectiveCompleteAnnouncement} ${newly.text}`);
    }
  }, [items]);

  return (
    <div aria-live="polite" role="status" className="sr-only" data-testid="announcer">
      {announcement}
    </div>
  );
}
