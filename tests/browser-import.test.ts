import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { JSDOM } from "jsdom";
import { prepareBrowserImport } from "../src/lib/benchmark/browser-import";
import { mergeBrowserImport } from "../src/lib/benchmark/browser-import-merge";
import { benchmarkCsv } from "../src/lib/benchmark/export";
import { POST } from "../app/api/benchmark/browser-import/route";

const now = new Date("2026-10-02T12:00:00Z");
const request = {
  mode: "live",
  scopeKeys: ["queen-eu"],
  providerKeys: ["loveholidays", "onthebeach"],
  customWindow: { checkIn: "2026-10-23", checkOut: "2026-10-28" },
};
const capture = {
  format: "dgtlface-ota-capture",
  version: 1,
  providerKey: "loveholidays",
  observedAt: now.toISOString(),
  snapshot: {
    url: "https://www.loveholidays.com/de/hotels/l/?masterId=371430&nights=5&rooms=2&date=2026-10-23",
    hotelName: "Miramare Queen",
    checkInLabel: "23.10.2026",
    nightsLabel: "5 Nächte",
    occupancyLabel: "1 Zimmer, 2 Erw.",
    offers: [
      {
        name: "Standard Zimmer",
        priceText: "272 € pro Nacht / 1.356 € insgesamt",
        description: "All inclusive Nicht erstattungsfähig",
      },
    ],
  },
};
const otb = {
  ...capture,
  providerKey: "onthebeach",
  snapshot: {
    sourceUrl: "https://www.onthebeach.co.uk/hotel_searches/show/12345",
    hotelName: "Miramare Queen",
    checkInLabel: "Check-in Date 23 Oct 2026",
    returnLabel: "Return 28 Oct 2026",
    nights: 5,
    adults: 2,
    children: 0,
    infants: 0,
    rooms: 1,
    totalSelected: true,
    offers: [
      {
        roomName: "Double Or Twin Land View Balcony",
        board: "All Inclusive",
        priceText: "£1,019\n.88\nper party",
      },
      {
        roomName: "Double Or Twin Side Sea View Balcony",
        board: "All Inclusive",
        priceText: "£1,085.82 per party",
      },
    ],
  },
};
const prepare = (data: unknown = capture, query: unknown = request) =>
  prepareBrowserImport({ capture: data, request: query }, now);

test("browser import creates a report without querying OTAs or inflating automated coverage", () => {
  const report = prepare();
  const offer = report.browserOffers![0];
  assert.equal(report.collectionMethod, "browser-import");
  assert.equal(offer.captureMethod, "browser-assisted");
  assert.equal(offer.observedAt, now.toISOString());
  assert.equal(offer.price, 1356);
  assert.equal(offer.matchedRoomId, undefined);
  assert.equal(report.summary.availableRateCount, 0);
  assert.equal(report.summary.coveragePct, 0);
  assert.ok(
    report.scopes.every((scope) =>
      scope.windows.every((w) =>
        w.rows.every((r) => r.entries.every((e) => e.scrapedPrice === null)),
      ),
    ),
  );
  assert.match(offer.terms.availability, /sunucu OTA'ya bağlanmadı/);
});

test("OTB import retains native GBP and separates partial sea even for EUR preference", () => {
  const report = prepare(otb);
  const offers = report.browserOffers!;
  assert.equal(offers[0].scopeKey, "queen-uk");
  assert.equal(offers[0].currency, "GBP");
  assert.equal(offers[0].matchedRoomId, "standard-land");
  assert.equal(offers[1].matchedRoomId, undefined);
  assert.equal(report.summary.availableRateCount, 0);
});

test("capture boundary rejects unsupported channels, versions, selections and ambiguous context", () => {
  for (const patch of [
    { format: "other" },
    { version: 2 },
    { providerKey: "booking" },
    { observedAt: "invalid" },
    { observedAt: "2026-10-02T11:30:00Z" },
    { observedAt: "2026-10-02T12:02:00Z" },
  ])
    assert.throws(() => prepare({ ...capture, ...patch }));
  for (const patch of [
    { mode: "mock" },
    { providerKeys: ["tui"] },
    { scopeKeys: ["beach-eu"] },
    { scopeKeys: ["queen-uk"] },
    { customWindow: { checkIn: "2026-10-24", checkOut: "2026-10-29" } },
  ])
    assert.throws(() => prepare(capture, { ...request, ...patch }));
  for (const patch of [
    { hotelName: "Another Hotel" },
    { occupancyLabel: "1 Zimmer, 3 Erw." },
    { nightsLabel: "6 Nächte" },
    { checkInLabel: "24.10.2026" },
    { offers: [] },
    { offers: Array(201).fill(capture.snapshot.offers[0]) },
  ])
    assert.throws(() =>
      prepare({ ...capture, snapshot: { ...capture.snapshot, ...patch } }),
    );
});

test("browser import rejects source spoofing, duplicate parameters, credentials and unrelated tracking fields", () => {
  for (const url of [
    capture.snapshot.url.replace("https:", "http:"),
    capture.snapshot.url.replace(
      "loveholidays.com",
      "loveholidays.com.example.org",
    ),
    capture.snapshot.url.replace("https://", "https://name:secret@"),
    capture.snapshot.url + "#secret",
    capture.snapshot.url + "&rooms=2",
    capture.snapshot.url + "&token=secret",
    capture.snapshot.url.replace("371430", "371656"),
    capture.snapshot.url.replace("/hotels/l/", "/holidays/"),
  ])
    assert.throws(() =>
      prepare({ ...capture, snapshot: { ...capture.snapshot, url } }),
    );
  for (const patch of [
    { adults: "2" },
    { rooms: null },
    { children: 1 },
    { infants: 1 },
    { totalSelected: "true" },
    { totalSelected: false },
  ])
    assert.throws(() =>
      prepare({ ...otb, snapshot: { ...otb.snapshot, ...patch } }),
    );
});

test("browser input features are ignored; nightly, wrong currency and empty prices never become offers", () => {
  for (const priceText of ["272 € pro Nacht", "£1,356 total", "0 € insgesamt"])
    assert.throws(() =>
      prepare({
        ...capture,
        snapshot: {
          ...capture.snapshot,
          offers: [{ ...capture.snapshot.offers[0], priceText }],
        },
      }),
    );
  const data = {
    ...capture,
    snapshot: {
      ...capture.snapshot,
      offers: [
        {
          ...capture.snapshot.offers[0],
          matchedRoomId: "standard-land",
          price: 1,
          roomFeatures: { view: "land" },
        },
      ],
    },
  };
  assert.equal(prepare(data).browserOffers![0].matchedRoomId, undefined);
  assert.equal(prepare(data).browserOffers![0].price, 1356);
});

test("reimport replaces a whole batch, retains other channels, and never overwrites direct quotes or summary", () => {
  const original = prepare();
  const report = mergeBrowserImport(original, prepare(otb), now.getTime());
  assert.equal(report.browserOffers!.length, 3);
  const duplicate = mergeBrowserImport(report, prepare(), now.getTime());
  assert.equal(duplicate.browserOffers!.length, 3);
  assert.deepEqual(duplicate.summary, original.summary);
  assert.deepEqual(duplicate.scopes, original.scopes);
  const incoming = prepare({
    ...capture,
    observedAt: "2026-10-02T12:00:30Z",
    snapshot: {
      ...capture.snapshot,
      offers: [
        { ...capture.snapshot.offers[0], priceText: "1.500 € insgesamt" },
      ],
    },
  });
  const replaced = mergeBrowserImport(
    duplicate,
    incoming,
    now.getTime() + 30_000,
  );
  assert.equal(replaced.browserOffers!.length, 3);
  assert.equal(replaced.browserOffers!.at(-1)!.price, 1500);
  assert.throws(
    () => mergeBrowserImport(replaced, prepare(), now.getTime() + 30_000),
    /daha yeni/,
  );
  assert.throws(
    () => mergeBrowserImport(null, prepare(), now.getTime() + 30 * 60 * 1000),
    /30 dakika/,
  );
  assert.throws(() =>
    mergeBrowserImport({ ...original, mode: "mock" }, prepare(), now.getTime()),
  );
  assert.throws(() =>
    mergeBrowserImport({ ...original, scopes: [] }, prepare(), now.getTime()),
  );
});

test("CSV preserves assisted provenance and formula-escapes imported room names", () => {
  const report = prepare({
    ...capture,
    snapshot: {
      ...capture.snapshot,
      offers: [{ ...capture.snapshot.offers[0], name: "=HYPERLINK(1)" }],
    },
  });
  const csv = benchmarkCsv(report);
  assert.match(
    csv,
    /TARAYICI AKTARIMI \/ KULLANICI BAŞLATIMLI \/ SUNUCUDAN DOĞRULANMADI/,
  );
  assert.match(csv, /'=HYPERLINK/);
  assert.match(csv, /OTOMATİK ODA KAPSAMASINA DAHİL DEĞİL/);
  assert.ok(!csv.includes('"CANLI"'));
});

test("browser import refuses flight upsells, deposits and ambiguous Loveholidays price regions", () => {
  for (const priceText of [
    "Hotel und Flug 1.356 € insgesamt",
    "Deposit 30 € / 1.356 € insgesamt",
    "£30 per night / 1.356 € insgesamt",
    "1.356 € insgesamt / 1.500 € insgesamt",
  ])
    assert.throws(() =>
      prepare({
        ...capture,
        snapshot: {
          ...capture.snapshot,
          offers: [{ ...capture.snapshot.offers[0], priceText }],
        },
      }),
    );
});

const script = readFileSync(
  new URL("../browser-helper/capture.js", import.meta.url),
  "utf8",
);
function extract(html: string, url: string) {
  const dom = new JSDOM(html, { url, runScripts: "outside-only" });
  Object.defineProperty(dom.window.HTMLElement.prototype, "innerText", {
    get() {
      return this.textContent;
    },
  });
  dom.window.HTMLElement.prototype.getClientRects = function () {
    return (this.closest('[hidden], [style="display:none"]')
      ? []
      : [{}]) as unknown as DOMRectList;
  };
  Object.defineProperty(dom.window.document, "cookie", {
    get() {
      throw new Error("Cookies must not be read");
    },
  });
  dom.window.fetch = () => {
    throw new Error("No network allowed");
  };
  try {
    return JSON.parse(
      JSON.stringify(vm.runInContext(script, dom.getInternalVMContext())),
    ) as (typeof capture)[];
  } finally {
    dom.window.close();
  }
}
const loveHtml = `<p>Private customer email: secret@example.com</p>
<button><h3>Miramare Queen</h3></button><div role="button" aria-label="Check-in Datum">23.10.2026</div>
<div role="button" aria-label="Wie lange">5 Nächte</div><div role="button" aria-label="Zimmer">1 Zimmer, 2 Erw.</div>
<div role="button" aria-label="Zimmeroption 1"><h3>Standard Zimmer</h3><span>All inclusive Nicht erstattungsfähig</span>
<span role="region" aria-label="Zimmerpreisinformationen">Ab <span role="region" aria-label="Zimmerpreisinformationen">272 € pro Nacht / 1.356 € insgesamt</span></span><span>Hotel + Flug 2.000 € insgesamt</span></div>
<div role="button" aria-label="Zimmeroption 2" hidden><h3>Hidden</h3><span role="region" aria-label="Zimmerpreisinformationen">1 € insgesamt</span></div>`;

test("helper reads only visible hotel-only card totals and excludes page/account data and tracking URL", () => {
  const [data] = extract(
    loveHtml,
    capture.snapshot.url + "&tracking=email%40example.com",
  );
  assert.equal(data.snapshot.offers.length, 1);
  assert.equal(
    data.snapshot.offers[0].priceText,
    "272 € pro Nacht / 1.356 € insgesamt",
  );
  assert.equal(data.snapshot.url, capture.snapshot.url);
  assert.ok(!JSON.stringify(data).includes("secret@example.com"));
  assert.equal(
    prepare({ ...data, observedAt: now.toISOString() }).browserOffers![0].price,
    1356,
  );
});

const otbHtml = `<button>Check-in Date 23 Oct 2026</button><div>Return 28 Oct 2026</div>
${Object.entries({
  nights: 5,
  adults: 2,
  children: 0,
  infants: 0,
  number_of_rooms: 1,
})
  .map(
    ([key, value]) =>
      `<select name="search[${key}]"><option selected value="${value}">${value}</option></select>`,
  )
  .join("")}
<article class="hotel-result"><h3>Miramare Queen<span></span></h3><input type="checkbox" name="price[toggle]" checked>
<div class="board-option"><div class="board-option__title"><strong>All Inclusive</strong> Double Or Twin Land View Balcony</div><div class="board-option__price">£1,019<span>.88</span> per party</div></div>
<div class="board-option" hidden><div class="board-option__title"><strong>All Inclusive</strong>Hidden room</div><div class="board-option__price">£1 per party</div></div></article>`;
test("helper OTB contract keeps split pennies, source dates and occupancy and requires Total Hotel Price", () => {
  const [data] = extract(otbHtml, otb.snapshot.sourceUrl);
  assert.equal(data.snapshot.offers.length, 1);
  const report = prepare({ ...data, observedAt: now.toISOString() });
  assert.equal(report.browserOffers![0].price, 1019.88);
  assert.throws(
    () => extract(otbHtml.replace(" checked", ""), otb.snapshot.sourceUrl),
    /Total Hotel Price/,
  );
});

test("helper refuses unrelated pages and visible verification challenges", () => {
  assert.throws(
    () => extract(loveHtml, "https://evil.example/hotels/l/"),
    /desteklenmiyor/,
  );
  assert.throws(
    () =>
      extract(
        loveHtml,
        capture.snapshot.url.replace("/hotels/l/", "/holidays/"),
      ),
    /desteklenmiyor/,
  );
  assert.throws(
    () =>
      extract(
        loveHtml + '<iframe title="Verification system"></iframe>',
        capture.snapshot.url,
      ),
    /CAPTCHA/,
  );
});

test("helper permissions stay user-triggered with no persistent host, background, cookies or downloads permissions", () => {
  const manifest = JSON.parse(
    readFileSync(
      new URL("../browser-helper/manifest.json", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(manifest.permissions, ["activeTab", "scripting"]);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.background, undefined);
  assert.equal(manifest.content_scripts, undefined);
});

test("extension popup reads only on click, previews the selected hotel and exports JSON only on confirmation", async () => {
  const html = readFileSync(
    new URL("../browser-helper/popup.html", import.meta.url),
    "utf8",
  );
  const popupScript = readFileSync(
    new URL("../browser-helper/popup.js", import.meta.url),
    "utf8",
  );
  const dom = new JSDOM(html, {
    url: "https://extension-test.invalid/",
    runScripts: "outside-only",
  });
  let reads = 0;
  let downloads = 0;
  let blob: Blob | undefined;
  Object.assign(dom.window, {
    chrome: {
      tabs: { query: async () => [{ id: 1, url: capture.snapshot.url }] },
      scripting: {
        executeScript: async (options: unknown) => {
          reads++;
          assert.deepEqual(JSON.parse(JSON.stringify(options)), {
            target: { tabId: 1 },
            files: ["capture.js"],
          });
          return [
            { result: [{ ...capture, observedAt: new Date().toISOString() }] },
          ];
        },
      },
    },
  });
  dom.window.URL.createObjectURL = (value) => {
    blob = value as Blob;
    return "blob:example";
  };
  dom.window.URL.revokeObjectURL = () => {};
  dom.window.HTMLAnchorElement.prototype.click = function () {
    downloads++;
    assert.match(this.download, /^dgtlface-loveholidays-miramare-queen\.json$/);
  };
  try {
    vm.runInContext(popupScript, dom.getInternalVMContext());
    assert.equal(reads, 0);
    assert.equal(downloads, 0);
    (dom.window.document.getElementById("read") as HTMLButtonElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(reads, 1);
    assert.equal(downloads, 0);
    assert.equal(
      (dom.window.document.getElementById("preview") as HTMLElement).hidden,
      false,
    );
    assert.match(
      dom.window.document.getElementById("summary")!.textContent!,
      /Miramare Queen/,
    );
    (
      dom.window.document.getElementById("download") as HTMLButtonElement
    ).click();
    assert.equal(downloads, 1);
    assert.equal(blob?.type, "application/json");
  } finally {
    dom.window.close();
  }
});

test("retired import route cannot inject user-supplied prices into live reports", async () => {
  const call = (
    body: string,
    headers: Record<string, string> = { "Content-Type": "application/json" },
  ) =>
    POST(
      new Request("http://localhost:3000/api/benchmark/browser-import", {
        method: "POST",
        body,
        headers,
      }),
    );
  assert.equal(
    (
      await call("{}", {
        "Content-Type": "application/json",
        Origin: "https://evil.example",
      })
    ).status,
    410,
  );
  assert.equal(
    (await call("{}", { "Content-Type": "text/plain" })).status,
    410,
  );
  assert.equal((await call(" ".repeat(256 * 1024 + 1))).status, 410);
  assert.equal((await call("not json")).status, 410);
  assert.equal((await call("{}")).headers.get("Cache-Control"), "no-store");
});
