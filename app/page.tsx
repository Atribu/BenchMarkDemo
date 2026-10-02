import { BenchmarkDashboard } from "@/src/components/benchmark-dashboard";
import { REPORT_SCOPES } from "@/src/lib/benchmark/sample-data";
import { todayInIstanbul } from "@/src/lib/benchmark/request";
import { OTA_PROVIDERS } from "@/src/lib/ota/registry";
import { serpApiConfigured } from "@/src/lib/ota/live-serpapi";

export const dynamic = "force-dynamic";

export default function Page() {
  const today = todayInIstanbul();
  const futureDate = (offset: number) =>
    new Date(Date.parse(`${today}T00:00:00Z`) + offset * 86400000)
      .toISOString()
      .slice(0, 10);
  return (
    <BenchmarkDashboard
      today={today}
      defaultRequest={{
        mode: "live",
        providerKeys: ["tui", "holidaycheck"],
        scopeKeys: ["beach-eu", "queen-eu"],
        customWindow: { checkIn: futureDate(7), checkOut: futureDate(12) },
      }}
      providerCatalog={OTA_PROVIDERS}
      scopeCatalog={REPORT_SCOPES}
      managedSourceReady={serpApiConfigured()}
    />
  );
}
