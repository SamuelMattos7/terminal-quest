import { useEffect, useState } from 'react';
import { strings } from './strings.js';

export default function App() {
  const [health, setHealth] = useState<string>('…');

  useEffect(() => {
    fetch('/healthz')
      .then((r) => r.json())
      .then((j: unknown) => {
        if (typeof j === 'object' && j !== null && 'ok' in j) {
          setHealth(strings.healthOk);
        } else {
          setHealth('unexpected response');
        }
      })
      .catch(() => {
        setHealth('server not reachable (run pnpm dev)');
      });
  }, []);

  return (
    <main style={{ padding: 32, maxWidth: 720 }}>
      <h1>{strings.appTitle}</h1>
      <p>{strings.landingTagline}</p>
      <p>
        <button type="button">{strings.startPlaying}</button>
      </p>
      <p>
        <code>/healthz: {health}</code>
      </p>
    </main>
  );
}
