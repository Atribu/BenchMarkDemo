import { describe, expect, it } from "vitest";
import { parseAnexTourOffers } from "./anextour-parser";

describe("parseAnexTourOffers", () => {
  const expected = {
    accommodationId: "1708",
    checkIn: "2027-03-22",
    checkOut: "2027-03-29",
    nights: 7,
  };

  const makeOffer = (
    operator: string,
    overrides: Record<string, unknown> = {},
  ) => ({
    accommodationId: "1708",
    tourOperator: {
      id: operator,
      name: operator === "ANEX" ? "ANEX Tour" : "BUCHER Reisen",
    },
    units: [
      {
        room: { name: "Doppelzimmer Economy" },
        board: { code: "ALLINCLUSIVEPLUS" },
      },
    ],
    startDate: "2027-03-22",
    endDate: "2027-03-29",
    duration: { overnights: 7 },
    price: {
      total: {
        amount: 1059,
        currency: "EUR",
        type: "PARTY",
      },
    },
    ...overrides,
  });

  it("yalnızca ANEX Tour teklifini kabul eder", () => {
    const result = parseAnexTourOffers(
      {
        data: {
          items: [
            makeOffer("BU"),
            makeOffer("ANEX"),
          ],
        },
      },
      expected,
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      operator: "ANEX Tour",
      roomName: "Doppelzimmer Economy",
      board: "ALLINCLUSIVEPLUS",
      price: 1059,
      currency: "EUR",
    });
  });

  it("yanlış tarih ve gece sayısını reddeder", () => {
    const result = parseAnexTourOffers(
      {
        data: {
          items: [
            makeOffer("ANEX", {
              startDate: "2027-03-23",
            }),
            makeOffer("ANEX", {
              duration: { overnights: 5 },
            }),
          ],
        },
      },
      expected,
    );

    expect(result).toHaveLength(0);
  });

  it("kişi başı fiyatı ve farklı para birimini reddeder", () => {
    const result = parseAnexTourOffers(
      {
        data: {
          items: [
            makeOffer("ANEX", {
              price: {
                total: {
                  amount: 529.5,
                  currency: "EUR",
                  type: "ESTIMATED",
                },
              },
            }),
            makeOffer("ANEX", {
              price: {
                total: {
                  amount: 1059,
                  currency: "GBP",
                  type: "PARTY",
                },
              },
            }),
          ],
        },
      },
      expected,
    );

    expect(result).toHaveLength(0);
  });
});