import type {
  CollectionAttempt,
  ValidationFunnelStageSummary,
  ValidationStage,
} from "./types";

export const VALIDATION_STAGE_LABELS: Record<ValidationStage, string> = {
  source_access: "Kaynak erişimi",
  hotel_identity: "Otel kimliği",
  stay_dates: "Tarih",
  occupancy: "Kişi / oda",
  raw_offers: "Teklif adayları",
  room_mapping: "Oda eşleşmesi",
  board: "Pansiyon",
  price: "Toplam fiyat",
  currency: "Para birimi",
};

const VALIDATION_STAGE_ORDER = Object.keys(
  VALIDATION_STAGE_LABELS,
) as ValidationStage[];

export function buildValidationFunnel(
  attempts: CollectionAttempt[],
): ValidationFunnelStageSummary[] {
  return VALIDATION_STAGE_ORDER.map((stage) => {
    const checks = attempts.flatMap((attempt) =>
      (attempt.validationChecks ?? []).filter((check) => check.stage === stage),
    );
    const count = (state: (typeof checks)[number]["state"]) =>
      checks.filter((check) => check.state === state).length;

    return {
      stage,
      label: VALIDATION_STAGE_LABELS[stage],
      passedCount: count("passed"),
      failedCount: count("failed"),
      emptyCount: count("empty"),
      unknownCount: count("unknown"),
      notApplicableCount: count("not_applicable"),
      evaluatedCount: checks.filter(
        (check) => check.state !== "not_applicable",
      ).length,
    };
  });
}
