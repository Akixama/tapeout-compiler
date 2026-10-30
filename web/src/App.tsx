import { useEffect, useState } from 'react';
import { loadBundle, type Bundle } from './data';
import TaskList from './pages/TaskList';
import TaskPage from './pages/TaskPage';

// Tiny hash router: #/ and #/task/<id>
const useRoute = () => {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => { setHash(location.hash); window.scrollTo(0, 0); };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  const m = /^#\/task\/(\d+)/.exec(hash);
  return m ? { page: 'task' as const, id: Number(m[1]) } : { page: 'list' as const };
};

export default function App() {
  const route = useRoute();
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { loadBundle().then(setBundle, (e) => setError(String(e))); }, []);

  return (
    <div className="shell">
      <header className="top">
        <a className="brand" href="#/"><img src="/chip.svg" alt="" />TapeOut Compiler</a>
        <span className="spacer" />
        <span className="chip">TapeOut × X Layer</span>
      </header>
      {error && <p className="result err">Could not load task data: {error}</p>}
      {!bundle && !error && <p className="hint">Loading tasks…</p>}
      {bundle && (route.page === 'task'
        ? <TaskPage bundle={bundle} id={route.id} />
        : <TaskList bundle={bundle} />)}
      <footer className="foot">
        Independent tool for the <a href="https://tapeout.net" target="_blank" rel="noreferrer">TapeOut</a> protocol. Task data and leaders read from BNB Chain
        {bundle && <> (snapshot {new Date(bundle.leadersAt).toLocaleString()})</>}. Circuits are checked in your browser; nothing is sent anywhere.
      </footer>
    </div>
  );
}
