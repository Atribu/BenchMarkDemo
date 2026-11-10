import type { HotelCurrency, HotelLocation } from "./model";

export interface ChannelMarketEligibility {
  eligible: boolean;
  label: "Uygun" | "Pazar seçin" | "Uygun değil";
  reason: string;
}

interface ChannelRule {
  currencies: readonly HotelCurrency[];
  countryCodes?: readonly string[];
}

const CHANNEL_RULES: Record<string, ChannelRule> = {
  anextour: { currencies: ["EUR", "RUB"], countryCodes: ["TR"] },
  booking: { currencies: ["EUR", "GBP"] },
  check24: { currencies: ["EUR"] },
  coraltravel: { currencies: ["EUR", "RUB"], countryCodes: ["TR"] },
  expedia: { currencies: ["EUR", "GBP"] },
  holidaycheck: { currencies: ["EUR"] },
  loveholidays: { currencies: ["EUR", "GBP"] },
  onthebeach: { currencies: ["GBP"], countryCodes: ["TR"] },
  pegastour: { currencies: ["RUB"], countryCodes: ["TR"] },
  restplatzboerse: { currencies: ["EUR"] },
  schauinsland: { currencies: ["EUR"] },
  stayforlong: { currencies: ["EUR"] },
  tui: { currencies: ["EUR"] },
};

export function getChannelMarketEligibility(
  providerKey: string,
  currency: HotelCurrency | undefined,
  location: Pick<HotelLocation, "countryCode">,
): ChannelMarketEligibility {
  if (!currency)
    return {
      eligible: false,
      label: "Pazar seçin",
      reason: "Kanal uygunluğunu görmek için önce pazarı seçin.",
    };

  const rule = CHANNEL_RULES[providerKey];
  if (!rule)
    return {
      eligible: false,
      label: "Uygun değil",
      reason: "Bu kanal için dinamik collector desteği bulunmuyor.",
    };

  const countryCode = location.countryCode.toUpperCase();
  if (rule.countryCodes && !rule.countryCodes.includes(countryCode))
    return {
      eligible: false,
      label: "Uygun değil",
      reason: `Bu kanal yalnızca ${rule.countryCodes.join("/")} otelleri için destekleniyor.`,
    };

  if (!rule.currencies.includes(currency))
    return {
      eligible: false,
      label: "Uygun değil",
      reason: `Bu kanal ${rule.currencies.join("/")} pazarlarını destekliyor; seçilen pazar ${currency}.`,
    };

  return {
    eligible: true,
    label: "Uygun",
    reason: `${currency} pazarı dinamik collector tarafından destekleniyor.`,
  };
}
