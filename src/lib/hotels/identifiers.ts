declare const hotelIdBrand: unique symbol;
declare const hotelKeyBrand: unique symbol;
declare const scopeKeyBrand: unique symbol;

export type RuntimeHotelId = string & {
  readonly [hotelIdBrand]: "RuntimeHotelId";
};
export type RuntimeHotelKey = string & {
  readonly [hotelKeyBrand]: "RuntimeHotelKey";
};
export type RuntimeScopeKey = string & {
  readonly [scopeKeyBrand]: "RuntimeScopeKey";
};

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RECORD_ID_PATTERN = /^[a-z0-9][a-z0-9:_-]*$/;

function hasValidLength(value: string, maximum: number): boolean {
  return value.length >= 3 && value.length <= maximum;
}

export function isRuntimeHotelId(value: unknown): value is RuntimeHotelId {
  return (
    typeof value === "string" &&
    hasValidLength(value, 120) &&
    RECORD_ID_PATTERN.test(value)
  );
}

export function isRuntimeHotelKey(value: unknown): value is RuntimeHotelKey {
  return (
    typeof value === "string" &&
    hasValidLength(value, 80) &&
    SLUG_PATTERN.test(value)
  );
}

export function isRuntimeScopeKey(value: unknown): value is RuntimeScopeKey {
  return (
    typeof value === "string" &&
    hasValidLength(value, 100) &&
    SLUG_PATTERN.test(value)
  );
}

export function parseRuntimeHotelId(value: unknown): RuntimeHotelId {
  if (isRuntimeHotelId(value)) return value;
  throw new Error("Otel kimliği geçersiz.");
}

export function parseRuntimeHotelKey(value: unknown): RuntimeHotelKey {
  if (isRuntimeHotelKey(value)) return value;
  throw new Error(
    "Otel anahtarı yalnızca küçük harf, rakam ve tek tire ayırıcıları içermelidir.",
  );
}

export function parseRuntimeScopeKey(value: unknown): RuntimeScopeKey {
  if (isRuntimeScopeKey(value)) return value;
  throw new Error(
    "Pazar anahtarı yalnızca küçük harf, rakam ve tek tire ayırıcıları içermelidir.",
  );
}
