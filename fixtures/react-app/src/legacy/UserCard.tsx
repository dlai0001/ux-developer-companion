// ❌ DECOY for the contested-name locator case (PLAN §5).
// Filename matches exactly (+30) — the same as the real one — so filename alone cannot decide.
// It loses because this definition is NOT exported: local-def (+10) vs exported-def (+40).
// Do not add `export` here; that is what makes the assertion deterministic.
const UserCard = (): null => null;

// Referenced so bundlers/linters do not strip it, without exporting the name itself.
export const legacyRegistry = { UserCard };
