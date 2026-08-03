// Shared fixture source, bundled once per React version.
// Mirrors PLAN §5's UserCard: a prop we can override (compact) and hook state (count).
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';

function UserCard({ user, compact }) {
  const [count, setCount] = useState(0);
  return (
    <div
      id="usercard"
      data-testid="usercard"
      className={compact ? 'card compact' : 'card'}
      style={{ padding: compact ? 8 : 24, border: '2px solid #2f81f7', borderRadius: 8 }}
    >
      <h2 id="uc-name">{user.name}</h2>
      <p id="uc-compact">compact={String(compact)}</p>
      <p id="uc-count">count={count}</p>
      <button id="uc-btn" onClick={() => setCount((c) => c + 1)}>inc</button>
    </div>
  );
}

function App() {
  return (
    <main style={{ font: '16px system-ui', padding: 20 }}>
      <h1>S3 fixture — React {React.version}</h1>
      <UserCard user={{ name: 'Ada Lovelace' }} compact={false} />
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
