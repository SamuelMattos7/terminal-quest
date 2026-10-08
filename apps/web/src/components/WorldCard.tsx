import { strings } from '../strings.js';
import { LevelNode } from './LevelNode.js';
import type { MapWorld } from './mapTypes.js';

interface WorldCardProps {
  world: MapWorld;
  index: number;
}

/** One world on the vertical map path (plan.md §9.2). */
export function WorldCard({ world, index }: WorldCardProps) {
  const headingId = `world-${world.id}-heading`;
  return (
    <section aria-labelledby={headingId} className="rounded-lg border border-border bg-panel p-4">
      <h2 id={headingId} className="font-mono text-xl text-text">
        <span className="text-cyan">{index + 1}. </span>
        {world.title}
      </h2>
      <p className="mt-1 text-sm text-muted">{world.blurb}</p>
      {world.levels.length === 0 ? (
        <p className="mt-3 text-sm text-muted">{strings.mapEmptyWorld}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {world.levels.map((level) => (
            <LevelNode key={level.id} level={level} />
          ))}
        </ul>
      )}
    </section>
  );
}
