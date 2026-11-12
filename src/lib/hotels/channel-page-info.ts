export interface ChannelPageInfo {
  recognized: boolean;
  externalHotelId?: string;
  message: string;
}

const PROVIDER_DOMAINS: Record<string, readonly string[]> = {
  anextour: ["anextour.de", "anextour.ru"],
  booking: ["booking.com"],
  check24: ["check24.de"],
  coraltravel: ["coraltravel.de", "coral.ru"],
  dertour: ["dertour.de"],
  expedia: ["expedia.com", "expedia.de", "expedia.co.uk"],
  holidaycheck: ["holidaycheck.de"],
  loveholidays: ["loveholidays.com"],
  onthebeach: ["onthebeach.co.uk"],
  pegastour: ["pegast.ru"],
  restplatzboerse: ["restplatzboerse.at"],
  schauinsland: ["schauinsland-reisen.de"],
  stayforlong: ["stayforlong.com", "stayforlong.de"],
  tui: ["tui.com"],
};

function matchesDomain(hostname: string, domains: readonly string[]) {
  const normalized = hostname.toLowerCase();
  return domains.some(
    (domain) => normalized === domain || normalized.endsWith(`.${domain}`),
  );
}

function queryId(url: URL, names: readonly string[], pattern = /^\d+$/) {
  for (const name of names) {
    const value = url.searchParams.get(name)?.trim();
    if (value && pattern.test(value)) return value;
  }
  return undefined;
}

function pathMatch(url: URL, pattern: RegExp) {
  return url.pathname.match(pattern)?.[1];
}

function extractExternalHotelId(providerKey: string, url: URL) {
  switch (providerKey) {
    case "anextour":
      return queryId(url, ["aid", "HOTELLIST", "hotelId"]);
    case "booking":
      return queryId(url, ["hotelId", "hotel_id"]);
    case "check24":
      return queryId(url, ["hotelId", "hotel_id"]);
    case "coraltravel":
      return queryId(
        url,
        ["requestId", "locationId"],
        /^\d+-7-\d+-6$/,
      );
    case "dertour":
      return pathMatch(url, /\/hotel\/[^/]+-([a-z0-9]+)\/?$/i);
    case "expedia":
      return (
        queryId(url, ["hotelId", "propertyId"]) ??
        pathMatch(url, /\.h(\d+)\./i)
      );
    case "holidaycheck":
      return pathMatch(url, /\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\/?$/i);
    case "loveholidays":
      return queryId(url, ["masterId"]);
    case "onthebeach":
      return queryId(url, ["propertyId", "hotelId"]);
    case "pegastour":
      return pathMatch(url, /-(\d+)\/?$/);
    case "restplatzboerse":
      return pathMatch(url, /\/hotel\/(\d+)\/?$/i);
    case "schauinsland":
      return pathMatch(url, /\/hotel\/(\d+)-[^/]+\/?$/i);
    case "stayforlong":
      return queryId(url, ["propertyId", "hotelId", "id"]);
    case "tui":
      return (
        pathMatch(url, /\/hotels\/[^/]*-(\d+)\/hotelinformation\/?$/i) ??
        pathMatch(url, /\/angebote\/[^/]+\/(\d+)\/list\/?$/i)
      );
    default:
      return undefined;
  }
}

export function extractChannelPageInfo(
  providerKey: string,
  pageUrl: string,
): ChannelPageInfo {
  const domains = PROVIDER_DOMAINS[providerKey];
  if (!domains)
    return {
      recognized: false,
      message: "Bu kanal için otomatik adres çözümleme henüz desteklenmiyor.",
    };

  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    return {
      recognized: false,
      message: "Önce geçerli bir kanal sayfa adresi girin.",
    };
  }

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !matchesDomain(url.hostname, domains)
  )
    return {
      recognized: false,
      message: "Adres seçilen OTA kanalının HTTPS alan adına ait değil.",
    };

  const externalHotelId = extractExternalHotelId(providerKey, url);
  if (externalHotelId)
    return {
      recognized: true,
      externalHotelId,
      message: `Harici otel kimliği adresten çıkarıldı: ${externalHotelId}`,
    };

  return {
    recognized: true,
    message:
      "Kanal adresi tanındı; harici otel kimliği bu URL'de açık olarak bulunmuyor. Kimliği kanalın teklif/API bilgisinden elle girin.",
  };
}
