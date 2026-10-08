import { useNavigate } from 'react-router-dom';
import { FakeTerminal } from '../components/FakeTerminal.js';
import { useGame } from '../stores/game.js';
import { strings } from '../strings.js';

export function Landing() {
  const navigate = useNavigate();
  const starting = useGame((s) => s.starting);
  const error = useGame((s) => s.error);

  const handleStart = async (): Promise<void> => {
    await useGame.getState().startPlaying();
    const state = useGame.getState();
    if (state.error === null && state.me !== null) {
      navigate('/map');
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-6 p-8">
      <div>
        <h1 className="font-mono text-4xl text-green">{strings.appTitle}</h1>
        <p className="mt-2 text-lg text-muted">{strings.landingTagline}</p>
      </div>
      <FakeTerminal />
      <div>
        <button
          type="button"
          disabled={starting}
          onClick={() => {
            void handleStart();
          }}
          className="rounded-md bg-green px-6 py-3 font-mono font-bold text-bg disabled:opacity-50"
        >
          {starting ? strings.startPlayingBusy : strings.startPlaying}
        </button>
        {error !== null && (
          <p role="alert" className="mt-3 text-red">
            {strings.startPlayingError} ({error})
          </p>
        )}
      </div>
    </main>
  );
}
