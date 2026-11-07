import type { CollectionAttempt, ValidationStage } from "../benchmark/types";
import type { HotelStore } from "./file-store";
import type { DynamicHotelRuntimeManifest } from "./runtime-manifest";

const REQUIRED_LIVE_STAGES = [
  "source_access",
  "hotel_identity",
  "stay_dates",
  "occupancy",
  "raw_offers",
  "room_mapping",
  "board",
  "price",
  "currency",
] as const satisfies readonly ValidationStage[];

function hasCompleteLiveEvidence(attempt: CollectionAttempt): boolean {
  if (
    attempt.status !== "completed" ||
    attempt.acceptedOfferCount < 1 ||
    attempt.errorCode
  )
    return false;

  const checks = new Map(
    (attempt.validationChecks ?? []).map((check) => [check.stage, check]),
  );
  return REQUIRED_LIVE_STAGES.every(
    (stage) => checks.get(stage)?.state === "passed",
  );
}

function evidenceKey(scopeKey: string, providerKey: string): string {
  return `${scopeKey}\u0000${providerKey}`;
}

export async function recordLiveCollectorEvidence(input: {
  store: HotelStore;
  manifests: readonly DynamicHotelRuntimeManifest[];
  attempts: readonly CollectionAttempt[];
}): Promise<number> {
  const dynamicScopes = new Map<string, string>();
  for (const manifest of input.manifests) {
    for (const scope of manifest.scopes)
      dynamicScopes.set(scope.id, manifest.hotelId);
  }

  const evidence = new Map<
    string,
    { checkedAt: string; succeeded: boolean }
  >();
  for (const attempt of input.attempts) {
    const hotelId = dynamicScopes.get(attempt.scopeKey);
    if (!hotelId || attempt.status === "not_run") continue;
    const key = evidenceKey(attempt.scopeKey, attempt.providerKey);
    const candidate = {
      checkedAt: attempt.completedAt,
      succeeded: hasCompleteLiveEvidence(attempt),
    };
    const current = evidence.get(key);
    if (
      !current ||
      (candidate.succeeded && !current.succeeded) ||
      (candidate.succeeded === current.succeeded &&
        candidate.checkedAt > current.checkedAt)
    )
      evidence.set(key, candidate);
  }
  if (evidence.size === 0) return 0;

  return input.store.update((hotels) => {
    let updatedCount = 0;
    const updatedHotels = hotels.map((hotel) => {
      const manifest = input.manifests.find(
        (candidate) => candidate.hotelId === hotel.id,
      );
      if (!manifest || hotel.status !== "active") return hotel;
      const scopeIds = new Set<string>(
        manifest.scopes.map((scope) => scope.id),
      );
      let changed = false;
      const channelMappings = hotel.channelMappings.map((mapping) => {
        if (
          mapping.status !== "configured" ||
          !mapping.configurationCheckedAt ||
          !scopeIds.has(mapping.marketId)
        )
          return mapping;
        const liveCheck = evidence.get(
          evidenceKey(mapping.marketId, mapping.providerKey),
        );
        if (
          !liveCheck ||
          (mapping.lastLiveCheckAt ?? "") >= liveCheck.checkedAt
        )
          return mapping;
        changed = true;
        updatedCount += 1;
        return {
          ...mapping,
          liveVerifiedAt: liveCheck.succeeded
            ? liveCheck.checkedAt
            : mapping.liveVerifiedAt,
          lastLiveCheckAt: liveCheck.checkedAt,
          lastLiveCheckSucceeded: liveCheck.succeeded,
        };
      });
      return changed ? { ...hotel, channelMappings } : hotel;
    });
    return { hotels: updatedHotels, result: updatedCount };
  });
}
