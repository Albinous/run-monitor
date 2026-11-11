import { useEffect, useState } from 'react';
import { RunList } from './RunList';
import { RunPage } from './RunPage';

/** "#/run/r08" -> "r08". Hash routing works on GitHub Pages without any server setup. */
const RUN_ROUTE = /^#\/run\/([\w-]+)/;

/** The part of the URL after "#", updated on back/forward and link clicks. */
function useHash(): string {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const onHashChange = () => setHash(location.hash);
    addEventListener('hashchange', onHashChange);
    return () => removeEventListener('hashchange', onHashChange);
  }, []);
  return hash;
}

export function App() {
  const hash = useHash();
  const runId = RUN_ROUTE.exec(hash)?.[1];
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <a href="#/" className="brand">
          Run Monitor
        </a>
        <span className="muted small">20 synthetic runs · all data generated in-browser</span>
      </header>
      <main id="main" tabIndex={-1}>
        {runId ? <RunPage key="run" id={runId} /> : <RunList />}
      </main>
    </>
  );
}
