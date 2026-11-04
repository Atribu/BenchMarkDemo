import type {
  BenchmarkErrorCode,
  CollectionAttempt,
  CollectionAttemptStatus,
  CollectionValidationCheck,
  ProviderCollectionResult,
  ProviderDescriptor,
  ReportScopeDefinition,
} from "../benchmark/types";

const TECHNICAL_ERRORS = new Set<BenchmarkErrorCode>([
  "access_blocked",
  "rate_limited",
  "timeout",
  "invalid_response",
]);

const NOT_RUN_ERRORS = new Set<BenchmarkErrorCode>([
  "hotel_mapping_missing",
  "configuration_missing",
]);

function dominantErrorCode(
  codes: BenchmarkErrorCode[],
): BenchmarkErrorCode | null {
  return (
    codes.find((code) => TECHNICAL_ERRORS.has(code)) ??
    codes.find((code) => NOT_RUN_ERRORS.has(code)) ??
    codes.find((code) => code === "currency_mismatch") ??
    codes.find((code) => code === "room_mapping_failed") ??
    codes.find((code) => code === "no_inventory") ??
    null
  );
}

function attemptStatus(input: {
  executed: boolean;
  availableCount: number;
  noInventory: boolean;
  rawOfferCount: number;
  codes: BenchmarkErrorCode[];
}): CollectionAttemptStatus {
  if (!input.executed || input.codes.some((code) => NOT_RUN_ERRORS.has(code)))
    return "not_run";
  if (input.availableCount > 0 || input.noInventory) return "completed";
  if (
    input.rawOfferCount > 0 ||
    input.codes.some(
      (code) =>
        code === "room_mapping_failed" || code === "currency_mismatch",
    )
  )
    return "partial";
  return "failed";
}

function derivedCheck(
  stage: CollectionValidationCheck["stage"],
  state: CollectionValidationCheck["state"],
  detail?: string,
): CollectionValidationCheck {
  return { stage, state, evidence: "derived", detail };
}

function buildDerivedValidationChecks(input: {
  executed: boolean;
  status: CollectionAttemptStatus;
  codes: BenchmarkErrorCode[];
  acceptedOfferCount: number;
  rawOfferCount: number;
  noInventory: boolean;
  hasBoardEvidence: boolean;
  hasPositivePrice: boolean;
  hasExpectedCurrency: boolean;
}): CollectionValidationCheck[] {
  const notRun = !input.executed || input.status === "not_run";
  const accessFailed = input.codes.some((code) =>
    ["access_blocked", "rate_limited", "timeout"].includes(code),
  );
  const hotelFailed = input.codes.includes("hotel_mapping_missing");
  const currencyFailed = input.codes.includes("currency_mismatch");
  const roomFailed = input.codes.includes("room_mapping_failed");
  const verifiedSearch =
    input.acceptedOfferCount > 0 ||
    input.rawOfferCount > 0 ||
    input.noInventory;
  const afterInventoryState: CollectionValidationCheck["state"] = notRun
    ? "not_applicable"
    : input.noInventory
      ? "not_applicable"
      : "unknown";

  return [
    derivedCheck(
      "source_access",
      notRun
        ? "not_applicable"
        : input.status === "failed" && accessFailed
          ? "failed"
          : "passed",
      input.status === "failed" && accessFailed
        ? "Kaynak yanıtı alınamadı."
        : undefined,
    ),
    derivedCheck(
      "hotel_identity",
      hotelFailed
        ? "failed"
        : verifiedSearch
          ? "passed"
          : notRun
            ? "not_applicable"
            : "unknown",
    ),
    derivedCheck(
      "stay_dates",
      verifiedSearch ? "passed" : notRun ? "not_applicable" : "unknown",
    ),
    derivedCheck(
      "occupancy",
      verifiedSearch ? "passed" : notRun ? "not_applicable" : "unknown",
    ),
    derivedCheck(
      "raw_offers",
      notRun
        ? "not_applicable"
        : input.rawOfferCount > 0 || input.acceptedOfferCount > 0
          ? "passed"
          : input.noInventory
            ? "empty"
            : "unknown",
      input.noInventory ? "Doğrulanmış boş teklif yanıtı." : undefined,
    ),
    derivedCheck(
      "room_mapping",
      input.acceptedOfferCount > 0
        ? "passed"
        : roomFailed || input.rawOfferCount > 0
          ? "failed"
          : afterInventoryState,
    ),
    derivedCheck(
      "board",
      input.noInventory || notRun
        ? "not_applicable"
        : input.hasBoardEvidence
          ? "passed"
          : "unknown",
    ),
    derivedCheck(
      "price",
      input.noInventory || notRun
        ? "not_applicable"
        : input.hasPositivePrice
          ? "passed"
          : "unknown",
    ),
    derivedCheck(
      "currency",
      input.noInventory || notRun
        ? "not_applicable"
        : currencyFailed
          ? "failed"
          : input.hasExpectedCurrency
            ? "passed"
            : "unknown",
    ),
  ];
}

export function buildCollectionAttempts(input: {
  provider: ProviderDescriptor;
  scope: ReportScopeDefinition;
  result: ProviderCollectionResult;
  executed: boolean;
  startedAt: string;
  completedAt: string;
  durationMs: number;
}): CollectionAttempt[] {
  return input.scope.windows.map((window) => {
    const quotes = input.result.quotes.filter(
      (quote) => quote.windowId === window.id,
    );
    const offers = (input.result.offers ?? []).filter(
      (offer) => offer.windowId === window.id,
    );
    const availableQuotes = quotes.filter(
      (quote) =>
        quote.status === "available" &&
        quote.currency === input.scope.currency &&
        quote.price !== null &&
        Number.isFinite(quote.price) &&
        quote.price > 0,
    );
    const codes = quotes.flatMap((quote): BenchmarkErrorCode[] => {
      if (quote.errorCode) return [quote.errorCode];
      if (quote.status !== "available") return [];
      if (quote.currency !== input.scope.currency) return ["currency_mismatch"];
      if (
        quote.price === null ||
        !Number.isFinite(quote.price) ||
        quote.price <= 0
      )
        return ["invalid_response"];
      return [];
    });
    const noInventory =
      quotes.length > 0 &&
      quotes.every(
        (quote) =>
          quote.status === "sold_out" || quote.errorCode === "no_inventory",
      );
    const acceptedIds = new Set(
      availableQuotes.map(
        (quote) => quote.offerId ?? `${quote.roomId}:${quote.windowId}`,
      ),
    );
    const errorCode = dominantErrorCode(codes);
    const status = attemptStatus({
      executed: input.executed,
      availableCount: availableQuotes.length,
      noInventory,
      rawOfferCount: offers.length,
      codes,
    });
    const reason =
      quotes.find((quote) => quote.errorCode === errorCode)?.reason ??
      quotes.find((quote) => quote.reason)?.reason;
    const hasBoardEvidence = [...quotes, ...offers].some((item) => {
      const board = item.terms?.board.trim().toLowerCase();
      return Boolean(board && board !== "unknown" && board !== "bilinmiyor");
    });
    const hasPositivePrice = [...quotes, ...offers].some(
      (item) =>
        item.price !== null &&
        Number.isFinite(item.price) &&
        item.price > 0,
    );
    const hasExpectedCurrency = [...quotes, ...offers].some(
      (item) => item.currency === input.scope.currency,
    );
    const validationChecks = buildDerivedValidationChecks({
      executed: input.executed,
      status,
      codes,
      acceptedOfferCount: acceptedIds.size,
      rawOfferCount: offers.length,
      noInventory,
      hasBoardEvidence,
      hasPositivePrice,
      hasExpectedCurrency,
    });

    return {
      id: [input.provider.key, input.scope.id, window.id].join("::"),
      providerKey: input.provider.key,
      scopeKey: input.scope.id,
      hotelKey: input.scope.hotelKey,
      windowId: window.id,
      status,
      startedAt: input.startedAt,
      completedAt: input.completedAt,
      durationMs:
        input.scope.windows.length === 1 ? input.durationMs : undefined,
      rawOfferCount: offers.length,
      acceptedOfferCount: acceptedIds.size,
      errorCode,
      reason,
      validationChecks,
    };
  });
}
