import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

interface Usage {
  month: string;
  monthCount: number;
  day: string;
  dayCount: number;
}

// Conservative attempt limits, not a claim about the provider's bill. Persistent
// storage is required; unreadable/corrupt counters fail closed, never reset.
export async function reserveSerpApiRequest(
  directory = process.env.BENCHMARK_STATE_DIR ||
    path.join(process.cwd(), ".benchmark-state"),
  now = new Date(),
): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lock = path.join(directory, "serpapi-budget.lock");
  try {
    await mkdir(lock, { mode: 0o700 });
  } catch {
    throw new Error(
      "SerpAPI kullanım sayacı meşgul veya erişilemiyor; sorgu yapılmadı.",
    );
  }
  const file = path.join(directory, "serpapi-usage.json");
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    const day = now.toISOString().slice(0, 10);
    const month = day.slice(0, 7);
    let usage: Usage = { month, monthCount: 0, day, dayCount: 0 };
    try {
      const stored = JSON.parse(await readFile(file, "utf8")) as Usage;
      if (
        !/^\d{4}-\d{2}$/.test(stored.month) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(stored.day) ||
        stored.month !== stored.day.slice(0, 7) ||
        stored.day > day ||
        !Number.isSafeInteger(stored.monthCount) ||
        stored.monthCount < 0 ||
        !Number.isSafeInteger(stored.dayCount) ||
        stored.dayCount < 0 ||
        stored.dayCount > stored.monthCount
      )
        throw new Error("Invalid counter");
      usage = {
        month,
        day,
        monthCount: stored.month === month ? stored.monthCount : 0,
        dayCount: stored.day === day ? stored.dayCount : 0,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error(
          "SerpAPI kullanım sayacı doğrulanamadı; sorgu yapılmadı.",
        );
    }
    if (usage.monthCount >= 200 || usage.dayCount >= 20)
      throw new Error(
        "SerpAPI deneme sınırı doldu (günlük 20, aylık 200 istek). Otomatik ücretli yükseltme yapılmaz.",
      );
    usage.monthCount++;
    usage.dayCount++;
    await writeFile(temp, JSON.stringify(usage), { mode: 0o600, flag: "wx" });
    await rename(temp, file);
  } finally {
    await rm(temp, { force: true }).catch(() => undefined);
    await rm(lock, { recursive: true });
  }
}
