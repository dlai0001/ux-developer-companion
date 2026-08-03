// ❌ DECOY for the contested-name locator case (PLAN §5).
// Declares `const UserCard` in a noise path (.test.) → −35. Never executed by `npm test`:
// the vitest suites are scoped to test/unit and test/integration, not fixtures/.
const UserCard = (): null => null;
export const cases = [UserCard];
