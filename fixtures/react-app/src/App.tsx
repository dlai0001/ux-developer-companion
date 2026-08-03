import { useEffect, useState } from 'react';
import { UserCard } from './components/UserCard/UserCard.js';
import { List } from './pages/List.js';

/** Minimal path router — real pathnames so the context payload has a meaningful Route line. */
function useRoute(): string {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = (): void => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return path;
}

function Home(): JSX.Element {
  return (
    <>
      <UserCard user={{ name: 'Ada Lovelace', role: 'Engineer' }} compact={false} />

      {/* INTENTIONAL axe violation #1: low contrast (see styles.css). */}
      <p className="low-contrast" data-testid="low-contrast">
        Low contrast text used by the M7 contrast checker.
      </p>

      {/* INTENTIONAL axe violation #2: input with no associated label. */}
      <input data-testid="unlabelled" type="text" placeholder="Search" />

      <div className="grid" data-testid="grid">
        <div>one</div><div>two</div><div>three</div>
      </div>
    </>
  );
}

export function App(): JSX.Element {
  const path = useRoute();
  const go = (to: string) => (e: React.MouseEvent): void => {
    e.preventDefault();
    window.history.pushState({}, '', to);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };
  return (
    <main>
      <h1>UX Companion React fixture</h1>
      <nav>
        <a href="/" onClick={go('/')}>home</a>
        <a href="/list" onClick={go('/list')}>list</a>
      </nav>
      {path === '/list' ? <List /> : <Home />}
    </main>
  );
}
