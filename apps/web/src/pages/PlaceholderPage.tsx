import { Link } from 'react-router-dom';
import { strings } from '../strings.js';

interface PlaceholderPageProps {
  title: string;
  /** Milestone that delivers the real page (e.g. 'T4.2'). Logged in PROGRESS.md Known gaps. */
  taskId: string;
}

/** Temporary stand-in so the full route table exists from T4.1. Replaced in T4.2/T4.3. */
export function PlaceholderPage({ title, taskId }: PlaceholderPageProps) {
  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="font-mono text-2xl text-text">{title}</h1>
      <p className="mt-2 text-muted">
        {strings.comingSoon} {taskId}.
      </p>
      <p className="mt-4">
        <Link className="text-cyan underline" to="/map">
          {strings.navMap}
        </Link>
      </p>
    </main>
  );
}
