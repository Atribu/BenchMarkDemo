"use client";

import Image from "next/image";
import { PriceSummary } from "./price-summary";
import { useRef, useState } from "react";
import { browserBatchKey } from "@/src/lib/benchmark/browser-import-merge";
import type {
  BenchmarkCell,
  BenchmarkRequest,
  BenchmarkRunResult,
  CollectionMode,
  CollectedOffer,
  RoomFeatures,
  SecondaryOffer,
  BrowserImportedOffer,
  OtaKey,
  ProviderDescriptor,
  ReportScopeDefinition,
  ScopeKey,
} from "@/src/lib/benchmark/types";
import { nightCount } from "@/src/lib/benchmark/request";
import { benchmarkCsv } from "@/src/lib/benchmark/export";
import { buildCollectionPlan } from "@/src/lib/benchmark/collection-plan";
import { benchmarkStatusLabel } from "@/src/lib/benchmark/status";
import { offerConditions } from "@/src/lib/ota/offer-matching";
import { formatCurrency, formatDateTime } from "@/src/lib/utils/format";

interface BenchmarkDashboardProps {
  today: string;
  defaultRequest: BenchmarkRequest;
  providerCatalog: ProviderDescriptor[];
  scopeCatalog: ReportScopeDefinition[];
  managedSourceReady?: boolean;
}

type Section = "benchmark" | "channels";
type IconName =
  "grid" | "channels" | "arrow" | "download" | "check" | "clock" | "external";

function Icon({
  name,
  className = "",
}: {
  name: IconName;
  className?: string;
}) {
  const paths: Record<IconName, React.ReactNode> = {
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </>
    ),
    channels: (
      <>
        <circle cx="6" cy="6" r="3" />
        <circle cx="18" cy="18" r="3" />
        <path d="M9 6h6a3 3 0 0 1 3 3v6M6 9v9h9" />
      </>
    ),
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    download: <path d="M12 3v12m-5-5 5 5 5-5M4 15v5h16v-5" />,
    check: <path d="m5 12 4 4L19 6" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    external: <path d="M14 3h7v7m0-7L10 14M10 4H4v16h16v-6" />,
  };
  return (
    <svg
      className={`icon ${className}`}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

const CHANNEL_INFO: Record<
  OtaKey,
  { label: string; detail: string; type: "beta" | "setup" }
> = {
  tui: {
    label: "Hotel-only · Beta",
    detail:
      "Uçaksız konaklama tekliflerini okur. Tarih, oda ve manzara eşleşmeyen teklifleri karşılaştırmaya almaz.",
    type: "beta",
  },
  holidaycheck: {
    label: "Hotel-only · Beta",
    detail:
      "Seçilen tarihlerdeki uçaksız teklifleri kontrol eder. Tarayıcı erişimi ve oda eşleşmesine bağlıdır.",
    type: "beta",
  },
  booking: {
    label: "Doğrulama gerekli",
    detail:
      "Doğrudan erişim Türkiye yönlendirmesine takılabilir. HolidayCheck'teki Booking.com etiketli teklifler varsa ayrı ek kaynak bölümünde gösterilir; doğrudan Booking fiyatı sayılmaz.",
    type: "setup",
  },
  expedia: {
    label: "Doğrulama gerekli",
    detail:
      "Doğrudan oda sorgusu doğrulama ekranına takılabilir. HolidayCheck'teki Expedia etiketli teklifler varsa ayrı ek kaynak bölümünde gösterilir; doğrudan Expedia fiyatı sayılmaz.",
    type: "setup",
  },
  hotelbeds: {
    label: "API erişimi gerekli",
    detail:
      "API anahtarı, secret, mTLS sertifikaları ve otel kodları gerekir. Net maliyet değil, doğrulanmış satış fiyatı kullanılır.",
    type: "setup",
  },
  loveholidays: {
    label: "Erişim & eşleştirme",
    detail:
      "Beach ve Queen için GBP ve EUR Hotel Only otel kimlikleri tanımlı. Oda toplamlarını okur; otomatik erişim doğrulamasına takılabilir.",
    type: "setup",
  },
  onthebeach: {
    label: "Hotel-only · Beta",
    detail:
      "Birleşik Krallık pazarı. Hotel Only formunda 2–28 gece ve 1 oda / 2 yetişkin toplamını GBP olarak okur. CAPTCHA doğrulaması otomatik sorguyu engelleyebilir; uçaklı veya kişi başı fiyat kullanılmaz.",
    type: "beta",
  },
};

const PORTFOLIOS: { value: string; label: string; scopes: ScopeKey[] }[] = [
  {
    value: "both-eu",
    label: "İki otel · Avrupa",
    scopes: ["beach-eu", "queen-eu"],
  },
  { value: "beach-eu", label: "Miramare Beach · Avrupa", scopes: ["beach-eu"] },
  { value: "queen-eu", label: "Miramare Queen · Avrupa", scopes: ["queen-eu"] },
  {
    value: "beach-uk",
    label: "Miramare Beach · Birleşik Krallık",
    scopes: ["beach-uk"],
  },
  {
    value: "queen-uk",
    label: "Miramare Queen · Birleşik Krallık",
    scopes: ["queen-uk"],
  },
  {
    value: "both-uk",
    label: "İki otel · Birleşik Krallık",
    scopes: ["beach-uk", "queen-uk"],
  },
];

function shortDate(date: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

function sourceUrl(hint: string) {
  const match = hint.match(/https:\/\/[^\s|]+/);
  if (!match || /[{}]/.test(match[0])) return null;
  try {
    return new URL(match[0]).href;
  } catch {
    return null;
  }
}

function roomFeatureLabel(features: RoomFeatures) {
  const views = {
    land: "Kara",
    garden: "Bahçe",
    sea: "Deniz",
    "partial-sea": "Yan/kısmi deniz",
    unknown: "Manzara belirsiz",
  };
  return `${views[features.view]} · ${features.balcony === "yes" ? "Balkonlu" : features.balcony === "no" ? "Balkonsuz" : "Balkon bilgisi yok"}`;
}

function AlternativeOfferCard({
  offer,
  providers,
  advertisedName,
  browserImport = false,
}: {
  offer: CollectedOffer;
  providers: ProviderDescriptor[];
  advertisedName?: string;
  browserImport?: boolean;
}) {
  const url = sourceUrl(offer.sourceHint);
  return (
    <article className="alternativeOfferCard">
      <div className="alternativeOfferPrice">
        <span>
          {advertisedName ??
            providers.find((provider) => provider.key === offer.providerKey)
              ?.name ??
            offer.providerKey}
        </span>
        <strong>{formatCurrency(offer.price, offer.currency)}</strong>
      </div>
      {advertisedName && (
        <p className="secondarySourceBadge">
          Kaynak: HolidayCheck · doğrudan OTA doğrulaması değil
        </p>
      )}
      {browserImport && (
        <p className="browserSourceBadge">
          Tarayıcıdan aktarıldı · otomatik sorgu değil
        </p>
      )}
      <h4>{offer.roomName}</h4>
      <p>{roomFeatureLabel(offer.roomFeatures)}</p>
      <p>
        <b>{offer.terms.board}</b>
        {offer.terms.operator ? ` · ${offer.terms.operator}` : ""}
      </p>
      <p className="alternativeReason">{offer.matchReason}</p>
      {offer.terms.cashback && (
        <p className="cashbackNote">
          {formatCurrency(
            offer.terms.cashback.amount,
            offer.terms.cashback.currency,
          )}{" "}
          koşullu cashback; toplamdan düşülmedi.
        </p>
      )}
      <details className="rateConditions">
        <summary>İptal, vergi ve teklif koşulları</summary>
        <p>{offerConditions(offer.terms)}</p>
      </details>
      <small>Kontrol: {formatDateTime(offer.observedAt)} · İstanbul</small>
      {url && (
        <a className="sourceLink" href={url} target="_blank" rel="noreferrer">
          Tarihli kaynak aramasını aç <Icon name="external" />
        </a>
      )}
    </article>
  );
}

function BrowserOfferSection({
  offers,
  providers,
  onRemove,
}: {
  offers: BrowserImportedOffer[];
  providers: ProviderDescriptor[];
  onRemove: (key: string) => void;
}) {
  const groups = new Map<string, BrowserImportedOffer[]>();
  for (const offer of offers) {
    const key = browserBatchKey(offer);
    groups.set(key, [...(groups.get(key) ?? []), offer]);
  }
  return (
    <section
      className="scopeReport"
      id="browser-offers"
      aria-label="Tarayıcıdan aktarılan teklifler"
    >
      <div className="alternativeOffers">
        <span className="eyebrow">
          KULLANICI BAŞLATIMLI · OTOMATİK SORGUDAN AYRI
        </span>
        <h3>Tarayıcıdan aktarılan teklifler</h3>
        <p className="alternativeIntro">
          Bu fiyatlar kullanıcı tarafından sağlanan dosyadan okunmuştur; kaynak
          gerçekliği sunucudan doğrulanmaz. Otomatik başarı ve oda kapsamasına
          dahil değildir. Kontrol saatindeki ekran kaydıdır; açık rapor
          kendiliğinden yenilenmez.
        </p>
        {[...groups].map(([key, group]) => (
          <section className="secondaryOfferGroup" key={key}>
            <h4>
              {group[0].hotelName} /{" "}
              {providers.find((p) => p.key === group[0].providerKey)?.name}{" "}
              <small>{group.length} teklif</small>
            </h4>
            <p>
              {shortDate(group[0].checkIn)} → {shortDate(group[0].checkOut)} ·{" "}
              {group[0].nights} gece · 1 oda / 2 yetişkin · {group[0].currency}
            </p>
            <button className="textButton" onClick={() => onRemove(key)}>
              Bu aktarımı rapordan kaldır
            </button>
            <div className="alternativeOfferGrid">
              {group.slice(0, 6).map((offer) => (
                <AlternativeOfferCard
                  key={offer.id}
                  offer={offer}
                  providers={providers}
                  browserImport
                />
              ))}
            </div>
            {group.length > 6 && (
              <details className="moreAlternatives">
                <summary>
                  Diğer {group.length - 6} tarayıcı teklifini göster
                </summary>
                <div className="alternativeOfferGrid">
                  {group.slice(6).map((offer) => (
                    <AlternativeOfferCard
                      key={offer.id}
                      offer={offer}
                      providers={providers}
                      browserImport
                    />
                  ))}
                </div>
              </details>
            )}
          </section>
        ))}
      </div>
    </section>
  );
}

function SecondaryOfferSection({
  offers,
  providers,
}: {
  offers: SecondaryOffer[];
  providers: ProviderDescriptor[];
}) {
  const groups = new Map<string, SecondaryOffer[]>();
  for (const offer of offers) {
    const key = `${offer.hotelKey}:${offer.windowId}:${offer.advertisedProviderKey}`;
    groups.set(key, [...(groups.get(key) ?? []), offer]);
  }
  return (
    <section
      className="scopeReport secondaryOffersReport"
      id="secondary-offers"
      aria-label="Ek kaynak OTA teklifleri"
    >
      <div className="alternativeOffers">
        <span className="eyebrow">EK KAYNAK · DOĞRUDAN ERİŞİMDEN AYRI</span>
        <h3>HolidayCheck üzerinden OTA teklifleri</h3>
        <p className="alternativeIntro">
          Seçili OTA etiketiyle HolidayCheck&apos;te görülen uçaksız
          toplamlar. Doğrudan OTA fiyatı veya kesin müsaitlik değildir; oda
          kapsamasına ve başarı sayısına eklenmez. Kaynak EUR fiyatlarıdır,
          GBP&apos;ye çevrilmez. HolidayCheck ayrıca seçildiyse bu teklifler
          onun sonuçlarında da bulunabilir.
        </p>
        {[...groups].map(([key, group]) => {
          const first = group[0];
          const name =
            providers.find(
              (provider) => provider.key === first.advertisedProviderKey,
            )?.name ?? first.advertisedProviderKey;
          return (
            <section
              className="secondaryOfferGroup"
              key={key}
              aria-label={`${first.hotelName} ${name} ek kaynak teklifleri`}
            >
              <h4>
                {first.hotelName} / {name} <small>{group.length} teklif</small>
              </h4>
              <p className="alternativeIntro">
                {shortDate(first.checkIn)} → {shortDate(first.checkOut)} ·{" "}
                {first.nights} gece · 1 oda / 2 yetişkin · {first.currency}
              </p>
              <div className="alternativeOfferGrid">
                {group.slice(0, 3).map((offer) => (
                  <AlternativeOfferCard
                    key={offer.id}
                    offer={offer}
                    providers={providers}
                    advertisedName={name}
                  />
                ))}
              </div>
              {group.length > 3 && (
                <details className="moreAlternatives">
                  <summary>
                    {name}: diğer {group.length - 3} ek kaynak teklifini göster
                  </summary>
                  <div className="alternativeOfferGrid">
                    {group.slice(3).map((offer) => (
                      <AlternativeOfferCard
                        key={offer.id}
                        offer={offer}
                        providers={providers}
                        advertisedName={name}
                      />
                    ))}
                  </div>
                </details>
              )}
            </section>
          );
        })}
      </div>
    </section>
  );
}

function RateCell({
  cell,
  currency,
  secondaryOfferCount = 0,
}: {
  cell: BenchmarkCell;
  currency: "EUR" | "GBP";
  secondaryOfferCount?: number;
}) {
  const url = cell.dataMode === "live" ? sourceUrl(cell.sourceHint) : null;
  const available = cell.status === "available";
  return (
    <td className={`rateCell ${available ? "priceAvailable" : "muted"}`}>
      <span
        className={`rateStatus ${cell.captureMethod === "manual-browser" ? "manual" : available ? "received" : ""}`}
      >
        <span className="statusDot" />
        {benchmarkStatusLabel(cell)}
      </span>
      <strong className={available ? "rateValue" : "rateValue unconfirmed"}>
        {formatCurrency(cell.scrapedPrice, currency)}
      </strong>
      {!available && (
        <span className="rateNote">
          {cell.scrapedPrice !== null
            ? "Fiyat doğrulanamadı"
            : "Doğrulanmış fiyat yok"}
        </span>
      )}
      {cell.offerDescription && (
        <span className="rateDetail">{cell.offerDescription}</span>
      )}
      {cell.roomFeatures && (
        <span className="rateDetail">
          {roomFeatureLabel(cell.roomFeatures)}
        </span>
      )}
      {cell.terms?.cashback && (
        <span className="rateDetail cashbackNote">
          {formatCurrency(cell.terms.cashback.amount, currency)} koşullu
          cashback; toplamdan düşülmedi.
        </span>
      )}
      {cell.observedAt && (
        <span className="rateDetail manualTimestamp">
          Kontrol: {formatDateTime(cell.observedAt)} · İstanbul saati
        </span>
      )}
      {cell.captureMethod === "manual-browser" && available && (
        <span className="rateDetail">
          Anlık otomatik sorgu değil; kaydedilmiş site kontrolü.
        </span>
      )}
      {cell.offerConditions && (
        <details className="rateConditions">
          <summary>Teklif koşulları</summary>
          <p>{cell.offerConditions}</p>
        </details>
      )}
      {!available && (
        <span className="rateDetail">
          {cell.reason ??
            (cell.status === "sold_out"
              ? "Bu kanalda seçilen tarihler için teklif bulunamadı."
              : "Oda fiyatı doğrulanamadı. Ayrıntılar rapor uyarılarında.")}
        </span>
      )}
      {url && (
        <a className="sourceLink" href={url} target="_blank" rel="noreferrer">
          Kaynak aramasını aç <Icon name="external" />
        </a>
      )}
      {secondaryOfferCount > 0 && (
        <a className="sourceLink secondarySourceLink" href="#secondary-offers">
          Ek kaynakta {secondaryOfferCount} teklif var; ayrı incele
        </a>
      )}
    </td>
  );
}

export function BenchmarkDashboard({
  today,
  defaultRequest,
  providerCatalog,
  scopeCatalog,
  managedSourceReady = false,
}: BenchmarkDashboardProps) {
  const [section, setSection] = useState<Section>("benchmark");
  const [report, setReport] = useState<BenchmarkRunResult | null>(null);
  const [selectedProviders, setSelectedProviders] = useState(
    defaultRequest.providerKeys,
  );
  const [selectedScopes, setSelectedScopes] = useState(
    defaultRequest.scopeKeys,
  );
  const [checkIn, setCheckIn] = useState(
    defaultRequest.customWindow?.checkIn ?? "",
  );
  const [checkOut, setCheckOut] = useState(
    defaultRequest.customWindow?.checkOut ?? "",
  );
  const [runningMode, setRunningMode] = useState<CollectionMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSelection, setLastSelection] = useState("");
  const runLock = useRef(false);
  function navigate(nextSection: Section) {
    setSection(nextSection);
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  const isRunning = runningMode !== null;
  const nights = nightCount(checkIn, checkOut);
  const criteria = {
    providerKeys: selectedProviders,
    scopeKeys: selectedScopes,
    customWindow: { checkIn, checkOut },
  };
  const selectionKey = JSON.stringify(criteria);
  const selectionChanged = !!report && selectionKey !== lastSelection;
  const collectionPlan = buildCollectionPlan(
    scopeCatalog.filter((scope) => selectedScopes.includes(scope.id)),
    providerCatalog.filter((provider) =>
      selectedProviders.includes(provider.key),
    ),
    scopeCatalog,
  );
  const canRun = !!nights && selectedProviders.length > 0 && !isRunning;
  const manualCount =
    report?.scopes.reduce(
      (total, scope) =>
        total +
        scope.windows.reduce(
          (sum, window) =>
            sum +
            window.rows.reduce(
              (count, room) =>
                count +
                room.entries.filter(
                  (entry) => entry.captureMethod === "manual-browser",
                ).length,
              0,
            ),
          0,
        ),
      0,
    ) ?? 0;
  const portfolio =
    PORTFOLIOS.find(
      (option) => option.scopes.join(",") === selectedScopes.join(","),
    )?.value ?? "both-eu";

  function selectPortfolio(value: string) {
    const scopes = PORTFOLIOS.find((option) => option.value === value)!.scopes;
    setSelectedScopes(scopes);
  }

  async function runBenchmark() {
    const mode: CollectionMode = "live";
    if (!canRun || runLock.current) return;
    runLock.current = true;
    setRunningMode(mode);
    setError(null);
    try {
      const response = await fetch("/api/benchmark/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...criteria, mode } satisfies BenchmarkRequest),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Rapor tamamlanamadı.");
      setReport(result as BenchmarkRunResult);
      setLastSelection(selectionKey);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Bağlantı kurulamadı. Tekrar deneyin.",
      );
    } finally {
      runLock.current = false;
      setRunningMode(null);
    }
  }

  function exportReport() {
    if (!report) return;
    const url = URL.createObjectURL(
      new Blob([benchmarkCsv(report)], { type: "text/csv;charset=utf-8;" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `dgtlface-benchmark-${report.mode}-${report.runId}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const navItems: {
    id: Section;
    label: string;
    icon: IconName;
    number: string;
  }[] = [
    { id: "benchmark", label: "Benchmark", icon: "grid", number: "01" },
    {
      id: "channels",
      label: "OTA bağlantıları",
      icon: "channels",
      number: "02",
    },
  ];

  return (
    <div className="appShell">
      <aside className="sidebar">
        <a
          className="brandLink"
          href="https://dgtlface.com/tr/"
          target="_blank"
          rel="noreferrer"
          aria-label="DGTLFACE web sitesi"
        >
          <Image
            src="/brand/dgtlface-logo.svg"
            alt="DGTLFACE"
            width={220}
            height={55}
            priority
          />
        </a>
        <div className="workspaceLabel">
          <span className="tinyRule" /> HOSPITALITY INTELLIGENCE
        </div>
        <nav className="mainNav" aria-label="Ana menü">
          {navItems.map((item) => (
            <button
              key={item.id}
              className={`navItem ${section === item.id ? "active" : ""}`}
              aria-current={section === item.id ? "page" : undefined}
              onClick={() => navigate(item.id)}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
              <small>{item.number}</small>
            </button>
          ))}
        </nav>
        <div className="portfolioCard">
          <span className="eyebrow">OTEL PORTFÖYÜ</span>
          <div>
            <span className="hotelMonogram">MB</span>
            <p>
              Miramare Beach<small>Avrupa & Birleşik Krallık</small>
            </p>
          </div>
          <div>
            <span className="hotelMonogram">MQ</span>
            <p>
              Miramare Queen<small>Avrupa & Birleşik Krallık</small>
            </p>
          </div>
        </div>
        <div className="sidebarFoot">
          <span className="brandGradientLine" />
          <p>
            Better data.
            <br />
            <strong>Better decisions.</strong>
          </p>
          <span>DGTLFACE / BENCHMARK v0.2</span>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <span className="breadcrumb">Miramare Collection</span>
            <span className="crumbDivider">/</span>
            <strong>
              {navItems.find((item) => item.id === section)?.label}
            </strong>
          </div>
          <span className="environmentBadge">
            <span className="statusDot" /> Geliştirme sürümü
          </span>
        </header>

        {section === "benchmark" && (
          <div className="pageEnter">
            <section className="hero">
              <div>
                <p className="eyebrow">HOTEL BENCHMARK / DGTLFACE</p>
                <h1>
                  Fiyatı görün.
                  <br />
                  <span>Farkı yönetin.</span>
                </h1>
                <p className="heroLead">
                  İki otel. Tek bakış. Seçtiğiniz tarihlerdeki
                  <br className="desktopBreak" /> uçaksız OTA fiyatlarını aynı
                  raporda karşılaştırın.
                </p>
              </div>
              <div className="heroArt" aria-hidden="true">
                <div className="orbit orbitOne" />
                <div className="orbit orbitTwo" />
                <div className="orbit orbitThree" />
                <div className="orbitCore">
                  <span>DF</span>
                  <small>BENCHMARK</small>
                </div>
                <span className="orbitLabel orbitLabelOne">DATA</span>
                <span className="orbitLabel orbitLabelTwo">INSIGHT</span>
                <span className="orbitPoint" />
              </div>
              <div className="heroCorner">
                DESIGNED FOR HOSPITALITY<span>01 / BENCHMARK</span>
              </div>
            </section>

            <section className="queryPanel" aria-labelledby="query-heading">
              <div className="panelHeading">
                <div>
                  <span className="stepNumber">01</span>
                  <h2 id="query-heading">Sorgunuzu oluşturun</h2>
                </div>
                <span className="quietLabel">
                  Sadece otel · 1 oda · 2 yetişkin
                </span>
              </div>
              <fieldset disabled={isRunning} className="queryFields">
                <legend className="srOnly">Otel, tarih ve OTA seçimi</legend>
                <div className="inputRow">
                  <label className="field portfolioField">
                    <span>Otel & tercih edilen pazar</span>
                    <select
                      value={portfolio}
                      onChange={(event) => selectPortfolio(event.target.value)}
                    >
                      {PORTFOLIOS.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Giriş tarihi</span>
                    <input
                      type="date"
                      value={checkIn}
                      onChange={(event) => setCheckIn(event.target.value)}
                      aria-describedby="date-help"
                    />
                  </label>
                  <label className="field">
                    <span>Çıkış tarihi</span>
                    <input
                      type="date"
                      value={checkOut}
                      onChange={(event) => setCheckOut(event.target.value)}
                      aria-describedby="date-help"
                    />
                  </label>
                  <div className="nightCount">
                    <Icon name="clock" />
                    <strong>{nights ?? "–"}</strong>
                    <span>gece</span>
                  </div>
                </div>
                <div id="date-help" className="dateHelp">
                  {!nights
                    ? "1–60 gece arasında geçerli bir giriş ve çıkış tarihi seçin."
                    : checkIn < today
                      ? "Fiyat almak için bugün veya ileri bir giriş tarihi seçin."
                      : "Fiyatlar kişi başı veya gecelik değil, seçilen konaklamanın toplamıdır."}
                </div>
                <div className="channelSelectorHeading">
                  <span>Karşılaştırılacak kanallar</span>
                  <small>{selectedProviders.length} seçili</small>
                  <button
                    type="button"
                    className="textButton"
                    disabled={
                      isRunning ||
                      selectedProviders.length === providerCatalog.length
                    }
                    onClick={() =>
                      setSelectedProviders(
                        providerCatalog.map((provider) => provider.key),
                      )
                    }
                  >
                    Tüm OTA'ları seç
                  </button>
                </div>
                <div className="channelChips">
                  {providerCatalog.map((provider) => (
                    <label
                      key={provider.key}
                      className={`channelChip ${selectedProviders.includes(provider.key) ? "selected" : ""}`}
                      title={CHANNEL_INFO[provider.key].detail}
                    >
                      <input
                        type="checkbox"
                        aria-label={provider.name}
                        checked={selectedProviders.includes(provider.key)}
                        disabled={isRunning}
                        onChange={() =>
                          setSelectedProviders((current) =>
                            current.includes(provider.key)
                              ? current.filter((key) => key !== provider.key)
                              : [...current, provider.key],
                          )
                        }
                      />
                      <span className="checkboxMark">
                        <Icon name="check" />
                      </span>
                      <span>{provider.name}</span>
                    </label>
                  ))}
                </div>
                <p className="dateHelp">
                  Tüm kanallar seçilebilir. Kanal tercih edilen pazarı
                  desteklemiyorsa aynı otel desteklenen pazarda sorgulanır. EUR
                  ve GBP ayrı tablolarda gösterilir.
                </p>
                {collectionPlan.warnings.length > 0 && (
                  <details className="rateConditions routingNotes">
                    <summary>
                      Bu seçimdeki pazar yönlendirmeleri (
                      {collectionPlan.warnings.length})
                    </summary>
                    {collectionPlan.warnings.map((warning) => (
                      <p key={warning}>{warning}</p>
                    ))}
                  </details>
                )}
              </fieldset>
              <div className="queryActions">
                <p>
                  <span className="statusDot" />
                  Seçilebilir olması, kanalın canlı erişiminin doğrulandığı
                  anlamına gelmez.
                  <button
                    className="textButton"
                    onClick={() => navigate("channels")}
                  >
                    Kanal durumları <Icon name="arrow" />
                  </button>
                </p>
                <div className="actionButtons">
                  <button
                    className="primaryButton"
                    disabled={!canRun || checkIn < today}
                    onClick={() => void runBenchmark()}
                  >
                    {runningMode === "live" ? (
                      <>
                        <span className="spinner" /> Fiyatlar alınıyor…
                      </>
                    ) : (
                      <>
                        Fiyatları getir <Icon name="arrow" />
                      </>
                    )}
                  </button>
                </div>
              </div>
              {error && (
                <div className="errorNotice" role="alert">
                  {error}
                  {report && " Aşağıda önceki rapor gösteriliyor."}
                </div>
              )}
            </section>

            <div className="runAnnouncement" role="status" aria-live="polite">
              {isRunning
                ? "Seçilen kanallar kontrol ediliyor. Canlı sorgu birkaç dakika sürebilir; bu sırada yeni sorgu başlatılmaz."
                : report
                  ? `Sorgu tamamlandı. ${report.summary.availableRateCount} eşleşen oda fiyatı, ${report.summary.alternativeOfferCount ?? 0} diğer oda/tarife teklifi, ${report.secondaryOffers?.length ?? 0} ek kaynak teklifi.`
                  : ""}
            </div>

            <section
              className="resultsSection"
              aria-labelledby="results-heading"
              aria-busy={isRunning}
            >
              <div className="resultsHeading">
                <div>
                  <p className="eyebrow">THE BIG PICTURE</p>
                  <h2 id="results-heading">Benchmark raporu</h2>
                </div>
                <button
                  className="exportButton"
                  onClick={exportReport}
                  disabled={!report || isRunning}
                >
                  <Icon name="download" /> CSV indir
                </button>
              </div>
              {report && (
                <div
                  className={`reportNotice ${report.mode === "mock" ? "demoNotice" : "liveNotice"}`}
                >
                  <span className="reportMode">
                    {report.mode === "mock"
                      ? "DEMO"
                      : report.collectionMethod === "browser-import"
                        ? "TARAYICI AKTARIMI"
                        : manualCount
                          ? "CANLI + ELLE KONTROL"
                          : "CANLI SORGU"}
                  </span>
                  <span>
                    {report.mode === "mock"
                      ? "Örnek veriler gösteriliyor. Bunlar OTA'lardan alınmış gerçek fiyatlar değildir."
                      : report.collectionMethod === "browser-import"
                        ? "Otomatik OTA sorgusu yapılmadı. Kullanıcı başlatımlı teklifler aşağıdaki tarayıcı aktarımı bölümündedir."
                        : `Son sorgu: ${formatDateTime(report.generatedAt)}. ${manualCount ? `${manualCount} hücre kaydedilmiş elle kontrol içeriyor; güncellik için hücredeki kontrol saatine bakın.` : "Eşleşmeyen sonuçlar karşılaştırma dışındadır."}`}
                  </span>
                </div>
              )}
              {selectionChanged && (
                <p className="staleNotice">
                  Seçimler değişti. Aşağıdaki rapor önceki sorguya aittir;
                  güncellemek için fiyatları yeniden getirin.
                </p>
              )}
              <div className="statGrid">
                <article className="statCard">
                  <span>
                    {report?.mode === "mock"
                      ? "Örnek fiyat"
                      : "Eşleşen oda fiyatı"}
                  </span>
                  <div>
                    <strong>
                      {report
                        ? String(report.summary.availableRateCount).padStart(
                            2,
                            "0",
                          )
                        : "–"}
                    </strong>
                    <small>
                      / {report?.summary.expectedRateCount ?? "–"} sonuç
                    </small>
                  </div>
                  <p>Oda ve tarih bazında</p>
                </article>
                <article className="statCard">
                  <span>Veri kapsamı</span>
                  <div>
                    <strong>
                      {report ? `%${report.summary.coveragePct}` : "–"}
                    </strong>
                    <span className="miniBars" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                      <i />
                      <i />
                    </span>
                  </div>
                  <p>Oda satırlarının doluluk oranı</p>
                </article>
                <article className="statCard">
                  <span>Diğer oda / tarife fiyatları</span>
                  <div>
                    <strong>
                      {report
                        ? String(
                            report.summary.alternativeOfferCount ?? 0,
                          ).padStart(2, "0")
                        : "–"}
                    </strong>
                  </div>
                  <p>Sitelerde bulunan diğer teklifler</p>
                </article>
                <article className="statCard">
                  <span>Kontrol edilecek</span>
                  <div>
                    <strong>
                      {report
                        ? String(report.summary.missingCount).padStart(2, "0")
                        : "–"}
                    </strong>
                    <span className="metricMark">
                      <Icon name="clock" />
                    </span>
                  </div>
                  <p>Eksik veya doğrulanamayan fiyat</p>
                </article>
              </div>

              {!report ? (
                <div className="emptyReport">
                  <div className="emptyIcon">
                    <Icon name="grid" />
                  </div>
                  <p className="eyebrow">İLK RAPORUNUZU OLUŞTURUN</p>
                  <h3>Karşılaştırma burada başlar.</h3>
                  <p>
                    Otel, tarih ve kanallarınızı seçin.
                    <br />
                    Fiyatlar geldiğinde oda bazındaki sonuçları burada
                    göreceksiniz.
                  </p>
                  <div className="emptySteps">
                    <span>
                      01 <b>Tarih seçin</b>
                    </span>
                    <i />
                    <span>
                      02 <b>Fiyatları getirin</b>
                    </span>
                    <i />
                    <span>
                      03 <b>Karşılaştırın</b>
                    </span>
                  </div>
                </div>
              ) : (
                <>
                  <PriceSummary report={report} />
                  <p className="referenceNotice">
                    Fiyatlar{" "}
                    {report.mode === "mock" ? "örnek verilerdir; " : ""}1 oda, 2
                    yetişkin için konaklama toplamıdır, uçak dahil değildir. Oda
                    eşleşmesi aynı tarife anlamına gelmez; pansiyon, iptal ve
                    vergileri kontrol edin. Cashback toplamdan düşülmez. Kaynak
                    bağlantıları tarihli aramayı açar; belirli bir teklifi veya
                    fiyatı garanti etmez.
                    {!!report.summary.alternativeOfferCount && (
                      <>
                        {" "}
                        Ayrıca{" "}
                        <strong>
                          {report.summary.alternativeOfferCount} alternatif
                          teklif
                        </strong>{" "}
                        bulundu; oda kapsamasına dahil edilmedi.
                      </>
                    )}
                  </p>
                  {!!report.secondaryOffers?.length && (
                    <p className="reportNotice secondarySourceNotice">
                      Doğrudan erişimden ayrı olarak HolidayCheck üzerinden{" "}
                      <strong>
                        {report.secondaryOffers.length} OTA teklifi
                      </strong>{" "}
                      bulundu.{" "}
                      <a href="#secondary-offers">
                        Ek kaynak fiyatlarını incele
                      </a>
                    </p>
                  )}
                  {!!report.browserOffers?.length && (
                    <BrowserOfferSection
                      offers={report.browserOffers}
                      providers={report.providers}
                      onRemove={(key) =>
                        setReport((current) =>
                          current
                            ? {
                                ...current,
                                browserOffers: current.browserOffers?.filter(
                                  (offer) => browserBatchKey(offer) !== key,
                                ),
                              }
                            : current,
                        )
                      }
                    />
                  )}
                  {report.scopes.map((scope) => (
                    <article className="scopeReport" key={scope.id}>
                      <header className="scopeHeading">
                        <div>
                          <span className="hotelIndex">
                            {scope.hotelKey === "miramare-beach" ? "MB" : "MQ"}
                          </span>
                          <div>
                            <h3>{scope.hotelName}</h3>
                            <p>
                              {scope.marketLabel} <span>/</span>{" "}
                              {scope.currency} <span>/</span> Sadece konaklama
                            </p>
                          </div>
                        </div>
                        <span className="scopeChannelCount">
                          {scope.providers.length} kanal
                        </span>
                      </header>
                      {scope.windows.map((window) => (
                        <div key={window.id}>
                          <div className="windowLabel">
                            <Icon name="clock" />
                            <strong>
                              {shortDate(window.checkIn)} <span>→</span>{" "}
                              {shortDate(window.checkOut)}
                            </strong>
                            <span>{window.nights} gece · 2 yetişkin</span>
                          </div>
                          <p className="tableScrollHint">
                            Tüm kanallar için tabloyu yatay kaydırın{" "}
                            <Icon name="arrow" />
                          </p>
                          <div
                            className="tableScroll"
                            tabIndex={0}
                            role="region"
                            aria-label={`${scope.hotelName} fiyat karşılaştırması`}
                          >
                            <table>
                              <caption className="srOnly">
                                {scope.hotelName}, {window.nights} gece,{" "}
                                {scope.currency} toplam konaklama fiyatları
                              </caption>
                              <thead>
                                <tr>
                                  <th scope="col">Oda kategorisi</th>
                                  {scope.providers.map((provider) => (
                                    <th key={provider.key} scope="col">
                                      {provider.name}
                                      <small>Konaklama toplamı</small>
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {window.rows.map((room) => (
                                  <tr key={room.roomId}>
                                    <th scope="row">
                                      <span
                                        className={`roomView ${room.roomId.endsWith("sea") ? "seaView" : "landView"}`}
                                      />
                                      <strong>
                                        {room.roomName.replace(
                                          "Manzarali",
                                          "Manzaralı",
                                        )}
                                      </strong>
                                      <small>1 oda · 2 yetişkin</small>
                                    </th>
                                    {room.entries.map((entry) => (
                                      <RateCell
                                        key={entry.providerKey}
                                        cell={entry}
                                        currency={scope.currency}
                                        secondaryOfferCount={
                                          report.secondaryOffers?.filter(
                                            (offer) =>
                                              offer.hotelKey ===
                                                scope.hotelKey &&
                                              offer.windowId === window.id &&
                                              offer.advertisedProviderKey ===
                                                entry.providerKey,
                                          ).length ?? 0
                                        }
                                      />
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          {!!window.alternativeOffers?.length && (
                            <section
                              className="alternativeOffers"
                              aria-label={`${scope.hotelName} alternatif teklifler`}
                            >
                              <header>
                                <div>
                                  <span className="eyebrow">
                                    DİĞER GERÇEK FİYATLAR
                                  </span>
                                  <h3>
                                    Alternatif teklifler{" "}
                                    <small>
                                      {window.alternativeOffers.length}
                                    </small>
                                  </h3>
                                </div>
                              </header>
                              <p className="alternativeIntro">
                                Aynı tarihler, {window.nights} gece, 1 oda ve 2
                                yetişkin. Farklı/belirsiz oda özellikleri veya
                                ek tarife seçenekleri; ana oda fiyatı yerine
                                kullanılmaz.
                              </p>
                              <div className="alternativeOfferGrid">
                                {window.alternativeOffers
                                  .slice(0, 6)
                                  .map((offer) => (
                                    <AlternativeOfferCard
                                      key={offer.id}
                                      offer={offer}
                                      providers={scope.providers}
                                    />
                                  ))}
                              </div>
                              {window.alternativeOffers.length > 6 && (
                                <details className="moreAlternatives">
                                  <summary>
                                    Diğer {window.alternativeOffers.length - 6}{" "}
                                    teklifi göster
                                  </summary>
                                  <div className="alternativeOfferGrid">
                                    {window.alternativeOffers
                                      .slice(6)
                                      .map((offer) => (
                                        <AlternativeOfferCard
                                          key={offer.id}
                                          offer={offer}
                                          providers={scope.providers}
                                        />
                                      ))}
                                  </div>
                                </details>
                              )}
                            </section>
                          )}
                          {(report.hotelPrices ?? []).some(
                            (price) =>
                              price.scopeKey === scope.id &&
                              price.windowId === window.id,
                          ) && (
                            <aside className="hotelPriceNotice">
                              <strong>
                                Google Hotels: otel başlangıç fiyatları
                              </strong>
                              <p>
                                Bu tutarlar oda/pansiyon eşleşmesi değildir;
                                yukarıdaki oda karşılaştırmasına ve başarı
                                sayısına dahil edilmez.
                              </p>
                              {(report.hotelPrices ?? [])
                                .filter(
                                  (price) =>
                                    price.scopeKey === scope.id &&
                                    price.windowId === window.id,
                                )
                                .map((price) => (
                                  <p key={price.providerKey}>
                                    {price.providerName}:{" "}
                                    {new Intl.NumberFormat("tr-TR", {
                                      style: "currency",
                                      currency: price.currency,
                                    }).format(price.price)}{" "}
                                    toplam · 2 yetişkin ·{" "}
                                    <a
                                      href={price.sourceUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      Google Hotels kaynağı
                                    </a>{" "}
                                    · {price.collectedVia === "serpapi" ? "SerpAPI ile otomatik · " : ""}{formatDateTime(price.observedAt)}
                                  </p>
                                ))}
                            </aside>
                          )}
                        </div>
                      ))}
                    </article>
                  ))}
                  {!!report.secondaryOffers?.length && (
                    <SecondaryOfferSection
                      offers={report.secondaryOffers}
                      providers={report.providers}
                    />
                  )}
                  {report.warnings.length > 0 && (
                    <details className="warningsPanel">
                      <summary>
                        <span className="warningCount">
                          {report.warnings.length}
                        </span>{" "}
                        Veri kalitesi & bağlantı notları{" "}
                        <span>Ayrıntıları göster</span>
                      </summary>
                      <ul>
                        {report.warnings.map((warning, index) => (
                          <li key={index}>{warning}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </>
              )}
            </section>
          </div>
        )}

        {section === "channels" && (
          <section className="pageEnter detailPage">
            <p className="eyebrow">CONNECTION CENTER</p>
            <h1>
              Her kanalın
              <br />
              <span>durumu net.</span>
            </h1>
            <p className="pageLead">
              Entegrasyon kabiliyeti, aktif bağlantı garantisi değildir. Gerçek
              erişim durumu her sorguda yeniden kontrol edilir.
            </p>
            <p className="referenceNotice">
              {managedSourceReady
                ? "Ek fiyat servisi: SerpAPI anahtarı tanımlı. Eksik kanallar için Google Hotels sorgulanır; teklif bulunması ve tüm OTA'ların kapsanması garanti değildir."
                : "Ek fiyat servisi henüz bağlı değil. SerpAPI ücretsiz hesap anahtarı sunucuya eklendiğinde aynı Fiyatları getir düğmesiyle çalışacak; dosya veya eklenti gerekmez."}
            </p>
            <div className="channelGrid">
              {providerCatalog.map((provider) => {
                const info = CHANNEL_INFO[provider.key];
                const cells =
                  report?.mode === "live"
                    ? (report.scopes.flatMap((scope) =>
                        scope.windows.flatMap((window) =>
                          window.rows.flatMap((room) =>
                            room.entries.filter(
                              (entry) => entry.providerKey === provider.key,
                            ),
                          ),
                        ),
                      ) ?? [])
                    : [];
                return (
                  <article className="channelCard" key={provider.key}>
                    <div className="channelCardTop">
                      <span className="providerLetter">
                        {provider.shortName.slice(0, 1)}
                      </span>
                      <span className={`channelState ${info.type}`}>
                        {info.label}
                      </span>
                    </div>
                    <h2>{provider.name}</h2>
                    <p>{info.detail}</p>
                    <div className="channelMarkets">
                      {provider.supportedScopes.includes("beach-eu")
                        ? "Avrupa / EUR"
                        : ""}
                      {provider.supportedScopes.includes("beach-uk")
                        ? `${provider.supportedScopes.includes("beach-eu") ? " · " : ""}Birleşik Krallık / GBP`
                        : ""}
                    </div>
                    <footer>
                      {cells.length
                        ? `${cells.filter((cell) => cell.status === "available" && cell.captureMethod !== "manual-browser").length} otomatik fiyat · ${cells.filter((cell) => cell.captureMethod === "manual-browser").length} elle kontrol kaydı / ${cells.length} sonuç`
                        : "Son raporda canlı sonuç yok"}
                      {!!report?.secondaryOffers?.some(
                        (offer) => offer.advertisedProviderKey === provider.key,
                      ) && (
                        <span className="secondarySourceBadge">
                          {
                            report.secondaryOffers.filter(
                              (offer) =>
                                offer.advertisedProviderKey === provider.key,
                            ).length
                          }{" "}
                          teklif HolidayCheck üzerinden; doğrudan OTA erişimi
                          değil
                        </span>
                      )}
                    </footer>
                  </article>
                );
              })}
            </div>
            <div className="setupNote">
              <Icon name="channels" />
              <p>
                Proxy tek başına yeterli değil. Erişim sağlandıktan sonra doğru
                otel, tarih, oda, pansiyon ve toplam fiyat eşleşmesini de
                doğrulamamız gerekiyor. Bağlantı bilgileri sunucu ortam
                değişkenlerinde tutulmalı, panelde paylaşılmamalı.
              </p>
            </div>
          </section>
        )}

        <footer className="workspaceFooter">
          <span>
            DGTLFACE <b>HOTEL BENCHMARK</b>
          </span>
          <span>
            {scopeCatalog.length} otel / pazar tanımı · EUR & GBP
            <span className="footerDot">·</span>Uçaksız fiyat odağı
          </span>
        </footer>
      </main>
    </div>
  );
}
