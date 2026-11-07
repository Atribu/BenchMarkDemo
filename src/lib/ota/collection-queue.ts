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

export interface TypedCollectionJob<T> {
  collectionType: "browser" | "api";
  run: () => Promise<T>;
}

export async function collectByCollectionType<T>(
  jobs: TypedCollectionJob<T>[],
  apiConcurrency = 3,
): Promise<T[]> {
  if (!Number.isInteger(apiConcurrency) || apiConcurrency < 1)
    throw new Error("Invalid API concurrency");

  const results: T[] = new Array(jobs.length);
  const indexedJobs = jobs.map((job, index) => ({ ...job, index }));
  const runGroup = (
    collectionType: TypedCollectionJob<T>["collectionType"],
    concurrency: number,
  ) =>
    collectInBatches(
      indexedJobs
        .filter((job) => job.collectionType === collectionType)
        .map((job) => async () => {
          results[job.index] = await job.run();
        }),
      concurrency,
    );

  await Promise.all([runGroup("browser", 1), runGroup("api", apiConcurrency)]);
  return results;
}
