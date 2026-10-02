// One Node process per deployment. Reject overlapping work rather than opening
// another fleet of browsers or charging a second external API query.
const shared = globalThis as typeof globalThis & {
  benchmarkQueryGate?: { running: boolean; nextAt: number };
};
const gate = (shared.benchmarkQueryGate ??= { running: false, nextAt: 0 });

export function acquireQuery(now = Date.now()): (() => void) | null {
  if (gate.running || now < gate.nextAt) return null;
  gate.running = true;
  gate.nextAt = now + 10_000;
  return () => {
    gate.running = false;
  };
}
