import { RunList } from './RunList';

export function App() {
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
        <RunList />
      </main>
    </>
  );
}
