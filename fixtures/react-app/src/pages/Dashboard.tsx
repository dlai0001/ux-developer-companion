// ❌ DECOY for the contested-name locator case (PLAN §5).
// This file IMPORTS UserCard, so it is a consumer, not a definition: −25.
// It also declares a similarly-named local to prove the ranker keys off the exact name.
import { UserCard } from '../components/UserCard/UserCard.js';

const UserCardRow = ({ children }: { children: React.ReactNode }): JSX.Element => (
  <div className="row">{children}</div>
);

export function Dashboard(): JSX.Element {
  return (
    <UserCardRow>
      <UserCard user={{ name: 'Ada Lovelace', role: 'Engineer' }} compact={false} />
    </UserCardRow>
  );
}
