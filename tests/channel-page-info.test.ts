import test from "node:test";
import assert from "node:assert/strict";
import { extractChannelPageInfo } from "../src/lib/hotels/channel-page-info";

const cases: Array<[string, string, string]> = [
  [
    "pegastour",
    "https://pegast.ru/hotel/turkey/antalya/belek/port-nature-luxury-resort-hotel-and-spa-6609069",
    "6609069",
  ],
  [
    "loveholidays",
    "https://www.loveholidays.com/de/hotels/l/?masterId=765432",
    "765432",
  ],
  [
    "tui",
    "https://www.tui.com/hotels/hotel-example-resort-987654/hotelinformation/",
    "987654",
  ],
  [
    "restplatzboerse",
    "https://www.restplatzboerse.at/hotel/654321/",
    "654321",
  ],
  [
    "schauinsland",
    "https://www.schauinsland-reisen.de/hotel/998877-example-resort",
    "998877",
  ],
  [
    "anextour",
    "https://nurhotel.anextour.de/search/offer?aid=136301",
    "136301",
  ],
  [
    "anextour",
    "https://anextour.ru/hotels/turkey/example-resort?HOTELLIST=8356",
    "8356",
  ],
  [
    "expedia",
    "https://www.expedia.de/Example-Hotel.h8108100.Hotel-Beschreibung",
    "8108100",
  ],
  [
    "dertour",
    "https://www.dertour.de/hotel/miramare-beach-1116XL",
    "1116XL",
  ],
];

for (const [providerKey, url, expected] of cases)
  test(`${providerKey} extracts its explicit hotel identity`, () => {
    const result = extractChannelPageInfo(providerKey, url);
    assert.equal(result.recognized, true);
    assert.equal(result.externalHotelId, expected);
  });

test("Coral Russia base page is recognized without guessing its request identity", () => {
  const result = extractChannelPageInfo(
    "coraltravel",
    "https://www.coral.ru/hotels/turkey/port-nature-luxury-resort-hotel-spa-belek/",
  );
  assert.equal(result.recognized, true);
  assert.equal(result.externalHotelId, undefined);
  assert.match(result.message, /elle girin/);
});

test("a different domain is never used to infer a hotel identity", () => {
  const result = extractChannelPageInfo(
    "pegastour",
    "https://example.com/hotel/example-6609069",
  );
  assert.equal(result.recognized, false);
  assert.equal(result.externalHotelId, undefined);
});
