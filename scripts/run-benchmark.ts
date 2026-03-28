import { DEFAULT_REQUEST } from "../src/lib/benchmark/sample-data";
import { runBenchmarkJob } from "../src/lib/ota/run-benchmark";

async function main() {
  const report = await runBenchmarkJob(DEFAULT_REQUEST);

  console.log(
    JSON.stringify(
      {
        generatedAt: report.generatedAt,
        mode: report.mode,
        warnings: report.warnings,
        summary: report.summary,
        scopes: report.scopes.map((scope) => ({
          id: scope.id,
          label: scope.label,
          stats: scope.stats
        }))
      },
      null,
      2
    )
  );
}

void main();
