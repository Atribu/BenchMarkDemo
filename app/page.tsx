import { BenchmarkDashboard } from "@/src/components/benchmark-dashboard";
import { todayInIstanbul } from "@/src/lib/benchmark/request";
import { serpApiConfigured } from "@/src/lib/ota/live-serpapi";
import { loadDynamicHotelRuntimeContext } from "@/src/lib/hotels/runtime-store";

export const dynamic = "force-dynamic";

export default async function Page() {
  const runtimeContext = await loadDynamicHotelRuntimeContext();
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
      providerCatalog={runtimeContext.providers}
      scopeCatalog={runtimeContext.catalog}
      managedSourceReady={serpApiConfigured()}
    />
  );
}
