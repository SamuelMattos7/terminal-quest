import { useEffect } from 'react';
import { Header } from '../components/Header.js';
import { SkillGraph } from '../components/SkillGraph.js';
import { useGame } from '../stores/game.js';
import { strings } from '../strings.js';

/** Skill graph page (plan.md §9.2). */
export function SkillsPage() {
  const me = useGame((s) => s.me);
  const worlds = useGame((s) => s.worlds);
  const skillsData = useGame((s) => s.skillsData);
  const loading = useGame((s) => s.loading);
  const error = useGame((s) => s.error);

  useEffect(() => {
    if (skillsData === null && !loading && error === null) {
      void useGame.getState().loadSkills();
    }
  }, [skillsData, loading, error]);

  const worldTitles = new Map<number, string>((worlds?.worlds ?? []).map((w) => [w.id, w.title]));

  return (
    <div className="min-h-screen bg-bg">
      <Header me={me} />
      <main className="mx-auto flex max-w-5xl flex-col gap-4 p-4">
        <h1 className="font-mono text-2xl text-text">{strings.skillsTitle}</h1>
        {loading && skillsData === null && <p className="text-muted">{strings.pageLoading}</p>}
        {error !== null && skillsData === null && (
          <p role="alert" className="text-red">
            {strings.pageError} ({error})
          </p>
        )}
        {skillsData !== null && skillsData.skills.length === 0 && (
          <p className="text-muted">{strings.skillsEmpty}</p>
        )}
        {skillsData !== null && skillsData.skills.length > 0 && (
          <SkillGraph skills={skillsData.skills} worldTitles={worldTitles} />
        )}
      </main>
    </div>
  );
}
