export async function collectInBatches<T>(
  jobs: (() => Promise<T>)[],
  concurrency = 3,
): Promise<T[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1)
    throw new Error("Invalid concurrency");
  const results: T[] = new Array(jobs.length);
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
      while (index < jobs.length) {
        const current = index++;
        results[current] = await jobs[current]();
      }
    }),
  );
  return results;
}
