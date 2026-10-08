import type { MeResponse } from '@terminal-quest/shared';
import { Link } from 'react-router-dom';
import { strings } from '../strings.js';
import { XpBar } from './XpBar.js';

interface HeaderProps {
  me: MeResponse | null;
}

/** App header: XP meter, streak, and section links (plan.md §9.2). */
export function Header({ me }: HeaderProps) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-panel px-4 py-3">
      <Link to="/map" className="font-mono text-lg font-bold text-green">
        {strings.appTitle}
      </Link>
      <div className="flex items-center gap-4">
        {me !== null && (
          <>
            <XpBar level={me.playerLevel} xp={me.user.xp} xpToNext={me.xpToNext} />
            {me.user.streakDays > 0 && (
              <span className="font-mono text-sm text-amber" title={strings.streakLabel}>
                {'⬢'} {me.user.streakDays} {strings.streakLabel}
              </span>
            )}
          </>
        )}
        <nav aria-label="Sections" className="flex items-center gap-3 text-sm">
          <Link className="text-muted hover:text-text" to="/map">
            {strings.navMap}
          </Link>
          <Link className="text-muted hover:text-text" to="/spellbook">
            {strings.navSpellbook}
          </Link>
          <Link className="text-muted hover:text-text" to="/skills">
            {strings.navSkills}
          </Link>
          <Link className="text-muted hover:text-text" to="/profile">
            {strings.navProfile}
          </Link>
          <Link className="text-muted hover:text-text" to="/settings">
            {strings.navSettings}
          </Link>
        </nav>
      </div>
    </header>
  );
}
