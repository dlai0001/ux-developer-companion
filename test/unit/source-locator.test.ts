// The ranker is what makes the locator usable: unranked first-match was 55-73% top-1 on real
// repos and 10-20% on contested names (spikes/FINDINGS.md S8). These cases mirror the
// contested-name fixture in fixtures/react-app (PLAN §5).
import { describe, expect, it } from 'vitest';
import { scoreCandidate } from '../../src/extension/locator-rank.js';

const rank = (
  cands: Array<{ path: string; text: string }>, name: string,
  framework: 'react' | 'angular', ancestry: string[] = [],
): string[] =>
  cands
    .map((c) => ({ path: c.path, ...scoreCandidate(c.path, c.text, name, framework, ancestry) }))
    .sort((a, b) => b.score - a.score)
    .map((c) => c.path);

describe('source locator ranking — React contested name', () => {
  const candidates = [
    { path: 'src/components/UserCard/UserCard.tsx', text: 'export function UserCard({ user }) {}' },
    { path: 'src/legacy/UserCard.tsx', text: 'const UserCard = () => null;\nexport const legacyRegistry = { UserCard };' },
    { path: 'src/pages/Dashboard.tsx', text: `import { UserCard } from '../components/UserCard/UserCard.js';\nconst UserCardRow = () => null;` },
    { path: 'src/components/UserCard/UserCard.test.tsx', text: 'const UserCard = () => null;' },
    { path: 'src/components/UserCard/UserCard.stories.tsx', text: 'const UserCard = () => null;' },
  ];

  it('ranks the exported definition first', () => {
    expect(rank(candidates, 'UserCard', 'react')[0]).toBe('src/components/UserCard/UserCard.tsx');
  });

  it('beats a same-filename decoy that is not exported', () => {
    const order = rank(candidates, 'UserCard', 'react');
    expect(order.indexOf('src/components/UserCard/UserCard.tsx'))
      .toBeLessThan(order.indexOf('src/legacy/UserCard.tsx'));
  });

  it('demotes a file that imports the name (a consumer, not a definition)', () => {
    const { reasons } = scoreCandidate(
      'src/pages/Dashboard.tsx', candidates[2]!.text, 'UserCard', 'react',
    );
    expect(reasons).toContain('imports-it');
  });

  it('demotes test and story files', () => {
    for (const p of ['src/components/UserCard/UserCard.test.tsx', 'src/components/UserCard/UserCard.stories.tsx']) {
      expect(scoreCandidate(p, 'const UserCard = () => null;', 'UserCard', 'react').reasons)
        .toContain('noise-path');
    }
  });

  it('uses ancestry to break ties between equally-shaped candidates', () => {
    const tie = [
      { path: 'src/widgets/Badge.tsx', text: 'export function Badge() {}' },
      { path: 'src/App/Badge.tsx', text: 'export function Badge() {}' },
    ];
    // ownersList says the component is rendered under App.
    expect(rank(tie, 'Badge', 'react', ['App', 'Badge'])[0]).toBe('src/App/Badge.tsx');
  });

  it('would pick the WRONG file without ranking (regression guard)', () => {
    // Naive "first match in file order" — what PLAN §4.3 originally specified.
    const naive = [...candidates].sort((a, b) => a.path.localeCompare(b.path))[0]!.path;
    expect(naive).not.toBe('src/components/UserCard/UserCard.tsx');
    expect(rank(candidates, 'UserCard', 'react')[0]).toBe('src/components/UserCard/UserCard.tsx');
  });
});

describe('source locator ranking — Angular selector', () => {
  const candidates = [
    { path: 'src/app/user-card/user-card.component.ts', text: `@Component({ selector: 'app-user-card' }) export class UserCardComponent {}` },
    { path: 'src/app/user-card/user-card.component.spec.ts', text: `describe('app-user-card', () => {});` },
    { path: 'src/app/demo/demo.component.ts', text: `@Component({ selector: 'app-demo' }) // app-user-card shown here` },
  ];

  it('ranks the decorated declaration first', () => {
    expect(rank(candidates, 'app-user-card', 'angular')[0])
      .toBe('src/app/user-card/user-card.component.ts');
  });

  it('recognises the .component.ts filename convention', () => {
    expect(scoreCandidate(candidates[0]!.path, candidates[0]!.text, 'app-user-card', 'angular').reasons)
      .toContain('filename-exact');
  });

  it('demotes the spec file even though it mentions the selector', () => {
    expect(scoreCandidate(candidates[1]!.path, candidates[1]!.text, 'app-user-card', 'angular').reasons)
      .toContain('noise-path');
  });
});
