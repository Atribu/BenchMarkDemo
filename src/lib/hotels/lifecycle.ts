export const HOTEL_LIFECYCLE_STATUSES = [
  "draft",
  "ready",
  "active",
  "archived",
] as const;

export type HotelLifecycleStatus =
  (typeof HOTEL_LIFECYCLE_STATUSES)[number];

export const HOTEL_LIFECYCLE_LABELS: Record<HotelLifecycleStatus, string> = {
  draft: "Taslak",
  ready: "Hazır",
  active: "Aktif",
  archived: "Arşivlenmiş",
};

const ALLOWED_TRANSITIONS = {
  draft: ["ready", "archived"],
  ready: ["draft", "active", "archived"],
  active: ["ready", "archived"],
  archived: ["draft"],
} as const satisfies Record<
  HotelLifecycleStatus,
  readonly HotelLifecycleStatus[]
>;

export function isHotelLifecycleStatus(
  value: unknown,
): value is HotelLifecycleStatus {
  return (
    typeof value === "string" &&
    HOTEL_LIFECYCLE_STATUSES.some((status) => status === value)
  );
}

export function canTransitionHotelStatus(
  current: HotelLifecycleStatus,
  next: HotelLifecycleStatus,
): boolean {
  return (ALLOWED_TRANSITIONS[current] as readonly HotelLifecycleStatus[]).includes(
    next,
  );
}

export function assertHotelStatusTransition(
  current: HotelLifecycleStatus,
  next: HotelLifecycleStatus,
): void {
  if (canTransitionHotelStatus(current, next)) return;

  throw new Error(
    `Otel durumu ${HOTEL_LIFECYCLE_LABELS[current]} durumundan ${HOTEL_LIFECYCLE_LABELS[next]} durumuna geçirilemez.`,
  );
}

export function isHotelAvailableForBenchmark(
  status: HotelLifecycleStatus,
): boolean {
  return status === "active";
}
