import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ReviewResponse, SkillsResponse } from '@terminal-quest/shared';
import { api } from '../api/client.js';
import { strings } from '../strings.js';

/** Spaced-repetition banner: replay completed levels for 25% XP (§10.5). */
export function ReviewBanner({ levelTitles }: { levelTitles: Map<string, string> }) {
  const [review, setReview] = useState<ReviewResponse | null>(null);
  const [skills, setSkills] = useState<SkillsResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.review(), api.skills()])
      .then(([r, s]) => {
        if (!cancelled) {
          setReview(r);
          setSkills(s);
        }
      })
      .catch(() => {
        // Like DailyCard, review is bonus: hide on failure.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (review === null || review.due.length === 0) {
    return null;
  }
  const skillTitles = new Map((skills?.skills ?? []).map((s) => [s.id, s.title]));
  return (
    <section
      aria-label={strings.reviewTitle}
      data-testid="review-banner"
      className="rounded-lg border border-cyan bg-panel p-4"
    >
      <h2 className="font-mono text-sm text-cyan">
        {strings.reviewTitle} ({review.due.length})
      </h2>
      <ul className="mt-2 flex flex-col gap-2">
        {review.due.map((item) => (
          <li key={`${item.skillId}:${item.levelId}`} className="flex items-center gap-2 text-sm">
            <span className="text-text">
              {skillTitles.get(item.skillId) ?? item.skillId} —{' '}
              {levelTitles.get(item.levelId) ?? item.levelId}
            </span>
            <Link
              className="ml-auto rounded border border-border px-3 py-1 font-mono text-xs text-text hover:border-green"
              to={`/play/${item.levelId}`}
            >
              {strings.reviewPlay}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
