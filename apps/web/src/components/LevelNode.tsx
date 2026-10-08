import { Link } from 'react-router-dom';
import { strings } from '../strings.js';
import type { MapLevel } from './mapTypes.js';

interface LevelNodeProps {
  level: MapLevel;
}

function StatusDot({ color, label }: { color: string; label: string }) {
  return (
    <span
      aria-hidden="true"
      title={label}
      className={`inline-block h-3 w-3 rounded-full ${color}`}
    />
  );
}

/** One level on the world map: locked, available, or completed with rank. */
export function LevelNode({ level }: LevelNodeProps) {
  if (level.state === 'locked') {
    return (
      <li>
        <span
          aria-disabled="true"
          title={strings.levelLocked}
          className="flex cursor-not-allowed items-center gap-2 rounded-md border border-border bg-panel px-3 py-2 text-muted"
        >
          <StatusDot color="bg-muted" label={strings.levelLocked} />
          <span>{level.title}</span>
          <span className="ml-auto font-mono text-xs">{strings.levelLocked}</span>
        </span>
      </li>
    );
  }
  const done = level.state === 'completed';
  return (
    <li>
      <Link
        to={`/play/${level.id}`}
        className="flex items-center gap-2 rounded-md border border-border bg-panel px-3 py-2 text-text hover:border-green"
      >
        <StatusDot color={done ? 'bg-purple' : 'bg-green'} label={level.state} />
        <span>{level.title}</span>
        {level.kind === 'boss' && (
          <span className="rounded bg-amber px-1 font-mono text-xs text-bg">{level.kind}</span>
        )}
        {done && level.bestRank !== undefined ? (
          <span
            aria-label={`${strings.rankLabel} ${level.bestRank}`}
            className="ml-auto font-mono text-sm font-bold text-purple"
          >
            {level.bestRank}
          </span>
        ) : (
          <span className="ml-auto font-mono text-xs text-muted">
            {done ? strings.levelCompleted : strings.levelAvailable}
          </span>
        )}
      </Link>
    </li>
  );
}
