import { REPORT_SCOPES } from "../src/lib/benchmark/sample-data";
import { collectBookingLiveQuotes } from "../src/lib/ota/live-booking";
import { collectExpediaLiveQuotes } from "../src/lib/ota/live-expedia";
import { collectHolidayCheckLiveQuotes } from "../src/lib/ota/live-holidaycheck";
import { OTA_PROVIDERS } from "../src/lib/ota/registry";

async function main() {
  const baseScope = REPORT_SCOPES.find((scope) => scope.id === "beach-eu");
  const booking = OTA_PROVIDERS.find((provider) => provider.key === "booking");
  const expedia = OTA_PROVIDERS.find((provider) => provider.key === "expedia");
  const holidaycheck = OTA_PROVIDERS.find((provider) => provider.key === "holidaycheck");

  if (!baseScope || !booking || !expedia || !holidaycheck) {
    throw new Error("Smoke test config bulunamadi.");
  }

  const scope = {
    ...baseScope,
    windows: [baseScope.windows[0]]
  };
  const holidayCheckPackageWindowScope = {
    ...baseScope,
    windows: [
      {
        id: "2026-06-04_2026-06-12",
        label: "04 - 12 Haziran 2026",
        checkIn: "2026-06-04",
        checkOut: "2026-06-12",
        nights: 8
      }
    ]
  };

  const bookingResult = await collectBookingLiveQuotes(booking, scope);
  const expediaResult = await collectExpediaLiveQuotes(expedia, scope);
  const holidayCheckDefaultWindowResult = await collectHolidayCheckLiveQuotes(
    holidaycheck,
    scope
  );
  const holidayCheckPackageWindowResult = await collectHolidayCheckLiveQuotes(
    holidaycheck,
    holidayCheckPackageWindowScope
  );

  console.log(
    JSON.stringify(
      {
        scope: scope.label,
        window: scope.windows[0].label,
        booking: bookingResult,
        expedia: expediaResult,
        holidaycheckDefaultWindow: holidayCheckDefaultWindowResult,
        holidaycheckPackageWindow: {
          window: holidayCheckPackageWindowScope.windows[0].label,
          result: holidayCheckPackageWindowResult
        }
      },
      null,
      2
    )
  );
}

void main();
