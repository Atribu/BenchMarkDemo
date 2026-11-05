import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createFileHotelStore } from "../src/lib/hotels/file-store";
import { createHotelDraft } from "../src/lib/hotels/model";
import { systemHotelRecord } from "../src/lib/hotels/repository";
import { HOTEL_CATALOG } from "../src/lib/hotels/catalog";

function draft() {
  return createHotelDraft({
    id: "hotel_01",
    key: "example-resort",
    name: "Example Resort",
    shortCode: "ER",
    location: { countryCode: "TR", city: "Antalya", region: "Kemer" },
    createdBy: "admin@example.com",
    now: "2026-11-05T09:00:00.000Z",
  });
}

async function temporaryStore() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "hotel-store-"));
  return { directory, store: createFileHotelStore(directory) };
}

test("file hotel store starts empty and persists user drafts atomically", async () => {
  const { directory, store } = await temporaryStore();
  try {
    assert.deepEqual(await store.load(), []);
    await store.update((hotels) => ({
      hotels: [...hotels, draft()],
      result: undefined,
    }));

    const loaded = await store.load();
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].key, "example-resort");
    assert.equal(loaded[0].status, "draft");
    const stored = JSON.parse(
      await readFile(path.join(directory, "user-hotels.json"), "utf8"),
    );
    assert.equal(stored.schemaVersion, 1);
    assert.equal(stored.hotels[0].source, "user");
    assert.equal((await stat(path.join(directory, "user-hotels.json"))).mode & 0o777, 0o600);
    assert.deepEqual(
      (await readdir(directory)).filter((entry) => entry.endsWith(".tmp")),
      [],
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("file hotel store rejects corrupt and unsupported data instead of resetting it", async () => {
  const { directory, store } = await temporaryStore();
  try {
    const file = path.join(directory, "user-hotels.json");
    await writeFile(file, "{broken");
    await assert.rejects(() => store.load(), /doğrulanamadı/);
    await writeFile(file, JSON.stringify({ schemaVersion: 99, hotels: [] }));
    await assert.rejects(() => store.load(), /doğrulanamadı/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("file hotel store rejects system records and invalid persisted identities", async () => {
  const { directory, store } = await temporaryStore();
  try {
    await assert.rejects(
      () =>
        store.update(() => ({
          hotels: [systemHotelRecord(HOTEL_CATALOG[0])],
          result: undefined,
        })),
      /Yalnızca kullanıcı otelleri/,
    );
    const invalid = {
      ...draft(),
      key: "Invalid Key",
    } as unknown as ReturnType<typeof draft>;
    await assert.rejects(
      () => store.update(() => ({ hotels: [invalid], result: undefined })),
      /Otel anahtarı/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("file hotel store rejects duplicate user identities", async () => {
  const { directory, store } = await temporaryStore();
  try {
    await assert.rejects(
      () =>
        store.update(() => ({
          hotels: [draft(), draft()],
          result: undefined,
        })),
      /depoda yineleniyor/,
    );
    assert.deepEqual(await store.load(), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("file hotel store lock prevents overlapping writes", async () => {
  const { directory, store } = await temporaryStore();
  try {
    await mkdir(path.join(directory, "user-hotels.lock"));
    await assert.rejects(
      () => store.update(() => ({ hotels: [draft()], result: undefined })),
      /meşgul/,
    );
    assert.deepEqual(await store.load(), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
