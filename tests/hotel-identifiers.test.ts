import test from "node:test";
import assert from "node:assert/strict";
import {
  isRuntimeHotelId,
  isRuntimeHotelKey,
  isRuntimeScopeKey,
  parseRuntimeHotelId,
  parseRuntimeHotelKey,
  parseRuntimeScopeKey,
} from "../src/lib/hotels/identifiers";
import { createHotelDraft } from "../src/lib/hotels/model";

test("runtime identifiers accept existing and generated hotel identities", () => {
  assert.equal(parseRuntimeHotelId("system:miramare-beach"), "system:miramare-beach");
  assert.equal(parseRuntimeHotelId("hotel_01"), "hotel_01");
  assert.equal(parseRuntimeHotelKey("miramare-beach"), "miramare-beach");
  assert.equal(parseRuntimeScopeKey("port-nature-eu"), "port-nature-eu");
});

test("runtime hotel keys reject values that could be normalized ambiguously", () => {
  for (const value of [
    " Miramare Beach ",
    "Miramare-Beach",
    "miramare--beach",
    "miramare_beach",
    "../miramare-beach",
    "miramare/beach",
    "mi",
    "",
    null,
  ]) {
    assert.equal(isRuntimeHotelKey(value), false, String(value));
    assert.throws(() => parseRuntimeHotelKey(value), /Otel anahtarı/);
  }
});

test("runtime scope and record identifiers fail closed", () => {
  assert.equal(isRuntimeScopeKey("queen-eu"), true);
  assert.equal(isRuntimeScopeKey("queen eu"), false);
  assert.equal(isRuntimeHotelId("system:port-nature"), true);
  assert.equal(isRuntimeHotelId("SYSTEM:port-nature"), false);
  assert.throws(() => parseRuntimeScopeKey("queen eu"), /Pazar anahtarı/);
  assert.throws(() => parseRuntimeHotelId("../../hotel"), /Otel kimliği/);
});

test("hotel draft creation validates external identifiers at its boundary", () => {
  assert.throws(
    () =>
      createHotelDraft({
        id: "hotel_01",
        key: "Invalid Hotel Key",
        name: "Invalid Hotel",
        shortCode: "IH",
        location: { countryCode: "TR", city: "Antalya" },
        createdBy: "admin@example.com",
        now: "2026-11-05T09:00:00.000Z",
      }),
    /Otel anahtarı/,
  );
});
