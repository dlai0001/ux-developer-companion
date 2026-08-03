// ✅ THE EXPECTED ANSWER for the contested-name locator case (PLAN §5).
// Signals: exported definition (+40) and filename-exact (+30).
// Four decoys elsewhere in this fixture must lose to it — see UserCard.test.tsx,
// UserCard.stories.tsx, ../../legacy/UserCard.tsx and ../../pages/Dashboard.tsx.
import { useState } from 'react';

export interface User {
  name: string;
  role: string;
}

export interface UserCardProps {
  user: User;
  compact: boolean;
}

export function UserCard({ user, compact }: UserCardProps): JSX.Element {
  // Hook index 0 — spike S3 overrides this via overrideValueAtPath('hooks', id, 0, [], n).
  const [count, setCount] = useState(0);

  return (
    <div
      id="usercard"
      data-testid="usercard"
      className={compact ? 'card compact' : 'card'}
    >
      <h2 data-testid="uc-name">{user.name}</h2>
      <p data-testid="uc-role">{user.role}</p>
      <p data-testid="uc-compact">compact={String(compact)}</p>
      <p data-testid="uc-count">count={count}</p>
      <button data-testid="uc-btn" className="primary-btn" onClick={() => setCount((c) => c + 1)}>
        increment
      </button>
    </div>
  );
}
