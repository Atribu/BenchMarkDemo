import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BrowserContext } from "playwright";

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function browserSessionPath(
  key: string,
  directory = process.env.OTA_SESSION_DIR,
) {
  const root = directory || path.join(process.cwd(), ".ota-sessions");
  return path.join(
    root,
    `${createHash("sha256").update(key).digest("hex").slice(0, 24)}.json`,
  );
}

export async function readBrowserSession(
  file: string,
): Promise<StorageState | undefined> {
  try {
    const info = await stat(file);
    if (info.size > 5_000_000 || Date.now() - info.mtimeMs > MAX_AGE_MS) return;
    const state = JSON.parse(await readFile(file, "utf8"));
    const namedValue = (value: unknown) =>
      !!value &&
      typeof value === "object" &&
      typeof (value as { name?: unknown }).name === "string" &&
      typeof (value as { value?: unknown }).value === "string";
    if (
      Array.isArray(state?.cookies) &&
      Array.isArray(state?.origins) &&
      state.cookies.every(
        (cookie: StorageState["cookies"][number]) =>
          namedValue(cookie) &&
          typeof cookie.domain === "string" &&
          typeof cookie.path === "string" &&
          Number.isFinite(cookie.expires) &&
          typeof cookie.httpOnly === "boolean" &&
          typeof cookie.secure === "boolean" &&
          ["Strict", "Lax", "None"].includes(cookie.sameSite),
      ) &&
      state.origins.every(
        (origin: StorageState["origins"][number]) =>
          origin &&
          typeof origin.origin === "string" &&
          Array.isArray(origin.localStorage) &&
          origin.localStorage.every(namedValue),
      )
    )
      return state;
  } catch {
    // An expired, missing or damaged anonymous session must not stop collection.
  }
}

export async function writeBrowserSession(file: string, state: StorageState) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(state), {
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}
