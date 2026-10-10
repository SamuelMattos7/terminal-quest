import { useEffect, useState } from 'react';
import { Header } from '../components/Header.js';
import { api } from '../api/client.js';
import { useGame } from '../stores/game.js';
import { strings } from '../strings.js';

function NoteEditor({ skillId, initial }: { skillId: string; initial: string | null }) {
  const [note, setNote] = useState(initial ?? '');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const dirty = note !== (initial ?? '');
  useEffect(() => {
    setNote(initial ?? '');
    setSaved(false);
  }, [initial]);

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      await useGame.getState().saveNote(skillId, note);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  const inputId = `note-${skillId}`;
  return (
    <div className="mt-2">
      <label htmlFor={inputId} className="font-mono text-xs text-muted">
        {strings.noteLabel}
      </label>
      <textarea
        id={inputId}
        value={note}
        maxLength={2000}
        rows={2}
        onChange={(e) => {
          setNote(e.target.value);
          setSaved(false);
        }}
        className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text"
      />
      <div className="mt-1 flex items-center gap-2">
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={() => {
            void save();
          }}
          className="rounded-md border border-border px-3 py-1 font-mono text-xs text-text disabled:opacity-40"
        >
          {strings.noteSave}
        </button>
        {saved && !dirty && (
          <span className="font-mono text-xs text-green">{strings.noteSaved}</span>
        )}
      </div>
    </div>
  );
}

/** Searchable spellbook of unlocked skills with notes + export (plan.md §9.2). */
export function SpellbookPage() {
  const me = useGame((s) => s.me);
  const spellbook = useGame((s) => s.spellbook);
  const loading = useGame((s) => s.loading);
  const error = useGame((s) => s.error);
  const [query, setQuery] = useState('');
  const [exportError, setExportError] = useState(false);

  useEffect(() => {
    if (spellbook === null && !loading && error === null) {
      void useGame.getState().loadSpellbook();
    }
  }, [spellbook, loading, error]);

  const exportBook = async (): Promise<void> => {
    setExportError(false);
    try {
      const markdown = await api.spellbookExport();
      const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'spellbook.md';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setExportError(true);
    }
  };

  const q = query.trim().toLowerCase();
  const entries = (spellbook?.entries ?? []).filter(
    (e) =>
      q === '' ||
      e.title.toLowerCase().includes(q) ||
      e.skillId.toLowerCase().includes(q) ||
      (e.note ?? '').toLowerCase().includes(q) ||
      e.cheatsheet.some(
        (c) => c.syntax.toLowerCase().includes(q) || c.note.toLowerCase().includes(q),
      ),
  );

  return (
    <div className="min-h-screen bg-bg">
      <Header me={me} />
      <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="font-mono text-2xl text-text">{strings.spellbookTitle}</h1>
          <button
            type="button"
            onClick={() => {
              void exportBook();
            }}
            className="rounded-md border border-border px-4 py-2 font-mono text-sm text-text hover:border-green"
          >
            {strings.exportSpellbook}
          </button>
        </div>
        {exportError && (
          <p role="alert" className="text-sm text-red">
            {strings.exportFailed}
          </p>
        )}
        <label htmlFor="spellbook-search" className="sr-only">
          {strings.spellbookSearch}
        </label>
        <input
          id="spellbook-search"
          type="search"
          value={query}
          placeholder={strings.spellbookSearch}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
          className="rounded-md border border-border bg-panel px-3 py-2 text-text"
        />
        {loading && spellbook === null && <p className="text-muted">{strings.pageLoading}</p>}
        {error !== null && spellbook === null && (
          <p role="alert" className="text-red">
            {strings.pageError} ({error})
          </p>
        )}
        {spellbook !== null && spellbook.entries.length === 0 && (
          <p className="text-muted">{strings.spellbookEmpty}</p>
        )}
        {spellbook !== null && spellbook.entries.length > 0 && entries.length === 0 && (
          <p className="text-muted">{strings.spellbookNoMatch}</p>
        )}
        <ul className="flex flex-col gap-3">
          {entries.map((entry) => (
            <li
              key={entry.skillId}
              className="rounded-lg border border-border bg-panel p-4"
              data-testid={`spellbook-entry-${entry.skillId}`}
            >
              <h2 className="font-mono text-lg text-green">{entry.title}</h2>
              {entry.cheatsheet.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1">
                  {entry.cheatsheet.map((cheat) => (
                    <li key={cheat.syntax} className="text-sm text-text">
                      <code className="font-mono text-cyan">{cheat.syntax}</code>{' '}
                      <span className="text-muted">— {cheat.note}</span>
                    </li>
                  ))}
                </ul>
              )}
              {entry.examples.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1">
                  {entry.examples.map((example) => (
                    <li key={example} className="text-sm text-muted">
                      Example: <code className="font-mono">{example}</code>
                    </li>
                  ))}
                </ul>
              )}
              <NoteEditor skillId={entry.skillId} initial={entry.note} />
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
