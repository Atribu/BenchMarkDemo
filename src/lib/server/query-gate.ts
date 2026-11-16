// One Node process per deployment. Reject overlapping work rather than opening
// another fleet of browsers or charging a second external API query. A lease
// prevents an interrupted request from leaving the process locked forever.
export const QUERY_COOLDOWN_MS = 10_000;
export const QUERY_LEASE_MS = 15 * 60_000;

interface QueryGateOptions {
  cooldownMs?: number;
  leaseMs?: number;
}

export interface QueryGateStatus {
  reason: "running" | "cooldown" | null;
  retryAfterMs: number;
}

export function createQueryGate(options: QueryGateOptions = {}) {
  const cooldownMs = options.cooldownMs ?? QUERY_COOLDOWN_MS;
  const leaseMs = options.leaseMs ?? QUERY_LEASE_MS;
  if (!Number.isFinite(cooldownMs) || cooldownMs < 0)
    throw new Error("Invalid query cooldown");
  if (!Number.isFinite(leaseMs) || leaseMs <= 0)
    throw new Error("Invalid query lease");

  let activeId = 0;
  let sequence = 0;
  let runningUntil = 0;
  let nextAt = 0;

  const status = (now = Date.now()): QueryGateStatus => {
    if (activeId !== 0 && now < runningUntil)
      return { reason: "running", retryAfterMs: runningUntil - now };
    if (now < nextAt)
      return { reason: "cooldown", retryAfterMs: nextAt - now };
    return { reason: null, retryAfterMs: 0 };
  };

  return {
    status,
    acquire(now = Date.now()): (() => void) | null {
      if (status(now).reason) return null;

      const queryId = ++sequence;
      activeId = queryId;
      runningUntil = now + leaseMs;
      nextAt = now + cooldownMs;

      return () => {
        // A late completion from an expired lease must not unlock a newer query.
        if (activeId !== queryId) return;
        activeId = 0;
        runningUntil = 0;
      };
    },
  };
}

const shared = globalThis as typeof globalThis & {
  benchmarkQueryGateV2?: ReturnType<typeof createQueryGate>;
};
const gate = (shared.benchmarkQueryGateV2 ??= createQueryGate());

export function acquireQuery(now = Date.now()): (() => void) | null {
  return gate.acquire(now);
}

export function getQueryGateStatus(now = Date.now()): QueryGateStatus {
  return gate.status(now);
}
