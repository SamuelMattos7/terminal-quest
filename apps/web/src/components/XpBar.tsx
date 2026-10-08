import { strings } from '../strings.js';

interface XpBarProps {
  level: number;
  xp: number;
  xpToNext: number;
}

/** Header XP meter (plan.md §9.2). */
export function XpBar({ level, xp, xpToNext }: XpBarProps) {
  const span = xp + xpToNext;
  const percent = span === 0 ? 100 : Math.min(100, Math.round((xp / span) * 100));
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-sm text-cyan">Lv {level}</span>
      <div
        role="progressbar"
        aria-valuenow={xp}
        aria-valuemin={0}
        aria-valuemax={span}
        aria-label={`${xp} XP, ${xpToNext} ${strings.xpToNext}`}
        className="h-2 w-32 overflow-hidden rounded bg-panel-2"
      >
        <div className="h-full rounded bg-green" style={{ width: `${percent}%` }} />
      </div>
      <span className="font-mono text-xs text-muted">{xp} XP</span>
    </div>
  );
}
