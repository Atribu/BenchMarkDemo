import { BenchmarkDashboard } from "@/src/components/benchmark-dashboard";
import {
  DEFAULT_REQUEST,
  REPORT_SCOPES
} from "@/src/lib/benchmark/sample-data";
import { OTA_PROVIDERS } from "@/src/lib/ota/registry";
import { runBenchmarkJob } from "@/src/lib/ota/run-benchmark";

export default async function Page() {
  const initialReport = await runBenchmarkJob(DEFAULT_REQUEST);

  return (
    <main className="pageShell">
      <BenchmarkDashboard
        defaultRequest={DEFAULT_REQUEST}
        initialReport={initialReport}
        providerCatalog={OTA_PROVIDERS}
        scopeCatalog={REPORT_SCOPES}
      />
    </main>
  );
}
