import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { collectInBatches } from "../src/lib/ota/collection-queue";
import { pricePageAccessError } from "../src/lib/ota/browser-diagnostics";
import { resolveProviderLiveConfig } from "../src/lib/ota/live-helpers";
import {
  browserSessionPath,
  readBrowserSession,
  writeBrowserSession,
} from "../src/lib/ota/browser-session";

test("Collection queue bounds active jobs and preserves request order", async () => {
  let active = 0,
    peak = 0;
  const results = await collectInBatches(
    Array.from({ length: 7 }, (_, index) => async () => {
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setTimeout(resolve, 7 - index));
      active--;
      return index;
    }),
    3,
  );
  assert.equal(peak, 3);
  assert.deepEqual(results, [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(await collectInBatches([]), []);
  await assert.rejects(collectInBatches([], 0));
  await assert.rejects(collectInBatches([], 1.5));
});

test("Anonymous session keys isolate provider, currency, market and proxy without exposing credentials", () => {
  const first = browserSessionPath(
    "booking:EUR:de:chrome:http://user:secret@proxy",
    "/tmp/test",
  );
  assert.doesNotMatch(first, /secret|booking|proxy|user/);
  assert.notEqual(
    first,
    browserSessionPath(
      "booking:GBP:de:chrome:http://user:secret@proxy",
      "/tmp/test",
    ),
  );
  assert.notEqual(
    first,
    browserSessionPath(
      "expedia:EUR:de:chrome:http://user:secret@proxy",
      "/tmp/test",
    ),
  );
});

test("Access diagnostics distinguish geo redirects, verification, HTTP errors and normal pages", () => {
  assert.match(
    pricePageAccessError("https://www.booking.com/hotel/test", 202, "", false)!,
    /dogrulamasi/,
  );
  assert.match(
    pricePageAccessError(
      "https://www.booking.com/?tr_redirected=1",
      200,
      "",
      false,
    )!,
    /Turkiye/,
  );
  assert.match(
    pricePageAccessError("https://www.loveholidays.com", 200, "", true)!,
    /dogrulamasi/,
  );
  assert.match(
    pricePageAccessError(
      "https://www.expedia.de",
      200,
      "Are you a human or a bot?",
      false,
    )!,
    /dogrulamasi/,
  );
  assert.match(
    pricePageAccessError("https://www.expedia.de", 429, "", false)!,
    /hiz siniri/,
  );
  assert.match(
    pricePageAccessError("https://www.expedia.de", 404, "Not found", false)!,
    /HTTP 404/,
  );
  assert.equal(
    pricePageAccessError(
      "https://www.loveholidays.com",
      200,
      "Room prices",
      false,
    ),
    null,
  );
});

test("Booking defaults match the requested market and remain proxy configurable", (t) => {
  const keys = [
    "BOOKING_MARKET",
    "BOOKING_PROXY_URL",
    "BOOKING_BROWSER_CHANNEL",
    "BOOKING_USER_AGENT",
    "BOOKING_USE_STEALTH",
    "OTA_MARKET",
    "OTA_PROXY_URL",
    "OTA_BROWSER_CHANNEL",
    "OTA_USER_AGENT",
    "OTA_USE_STEALTH",
  ];
  const original = keys.map((key) => process.env[key]);
  for (const key of keys) delete process.env[key];
  t.after(() =>
    keys.forEach((key, index) => {
      if (original[index] === undefined) delete process.env[key];
      else process.env[key] = original[index];
    }),
  );

  const eur = resolveProviderLiveConfig("booking", "EUR");
  assert.equal(eur.market, "de");
  assert.equal(eur.browserChannel, "chrome");
  assert.equal(eur.userAgent, undefined);
  assert.equal(eur.useStealth, true);

  const gbp = resolveProviderLiveConfig("booking", "GBP");
  assert.equal(gbp.market, "uk");

  process.env.BOOKING_PROXY_URL = "socks5://user:secret@example.test:1080";
  assert.equal(
    resolveProviderLiveConfig("booking", "EUR").proxyUrl,
    "socks5://user:secret@example.test:1080",
  );
});

test("Sessions use private atomic files; expired, corrupt and missing state is ignored", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ota-session-test-"));
  const file = browserSessionPath("test", path.join(root, "private"));
  const state = { cookies: [], origins: [] };
  try {
    assert.equal(await readBrowserSession(file), undefined);
    await writeBrowserSession(file, state);
    assert.deepEqual(await readBrowserSession(file), state);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.equal((await stat(path.dirname(file))).mode & 0o777, 0o700);
    assert.equal((await readdir(path.dirname(file))).length, 1);
    const old = new Date(Date.now() - 8 * 86400000);
    await utimes(file, old, old);
    assert.equal(await readBrowserSession(file), undefined);
    await writeFile(file, "{broken");
    assert.equal(await readBrowserSession(file), undefined);
    await writeFile(file, JSON.stringify({ cookies: "bad", origins: [] }));
    assert.equal(await readBrowserSession(file), undefined);
    await writeFile(file, JSON.stringify({ cookies: [null], origins: [] }));
    assert.equal(await readBrowserSession(file), undefined);
    await writeFile(
      file,
      JSON.stringify({
        cookies: [],
        origins: [{ origin: "https://example.com", localStorage: [null] }],
      }),
    );
    assert.equal(await readBrowserSession(file), undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
