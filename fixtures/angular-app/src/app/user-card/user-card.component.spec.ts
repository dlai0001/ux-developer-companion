// ❌ DECOY: mentions selector 'app-user-card' in a noise path (.spec.) → −35.
describe('app-user-card', () => {
  it('is referenced here only to contest the source locator', () => {
    expect('app-user-card').toBe('app-user-card');
  });
});
