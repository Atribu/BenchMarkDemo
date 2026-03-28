"use client";

import { useDeferredValue, useState, useTransition } from "react";
import type {
  BenchmarkCell,
  BenchmarkRequest,
  BenchmarkRunResult,
  CollectionMode,
  ProviderDescriptor,
  ReportScopeDefinition,
  ScopeKey
} from "@/src/lib/benchmark/types";
import {
  formatCurrency,
  formatDateTime,
  formatPercent
} from "@/src/lib/utils/format";

interface BenchmarkDashboardProps {
  initialReport: BenchmarkRunResult;
  defaultRequest: BenchmarkRequest;
  providerCatalog: ProviderDescriptor[];
  scopeCatalog: ReportScopeDefinition[];
}

function toggleValue<T extends string>(values: T[], value: T): T[] {
  return values.includes(value)
    ? values.filter((entry) => entry !== value)
    : [...values, value];
}

function readinessLabel(provider: ProviderDescriptor): string {
  switch (provider.readiness) {
    case "mock-ready":
      return "Mock-ready";
    case "selector-mapping":
      return "Selector mapping";
    case "api-contract":
      return "API contract";
    default:
      return provider.readiness;
  }
}

function calculateNightCount(checkIn: string, checkOut: string): number | null {
  if (!checkIn || !checkOut) {
    return null;
  }

  const start = new Date(`${checkIn}T00:00:00Z`);
  const end = new Date(`${checkOut}T00:00:00Z`);

  if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf())) {
    return null;
  }

  const diff = end.valueOf() - start.valueOf();
  const nights = Math.round(diff / 86400000);
  return nights > 0 ? nights : null;
}

function cellStatusLabel(cell: BenchmarkCell): string {
  if (cell.status === "sold_out") {
    return "Sold out";
  }

  if (cell.status === "manual-review") {
    return cell.scrapedPrice !== null ? "Live fallback" : "Manual review";
  }

  if (cell.status === "missing") {
    return "No rate";
  }

  if (cell.differencePct === null) {
    return "No diff";
  }

  if (cell.differencePct <= -0.03) {
    return "Parity risk";
  }

  if (cell.differencePct < 0) {
    return "Slightly lower";
  }

  if (cell.differencePct <= 0.03) {
    return "Near parity";
  }

  if (cell.differencePct <= 0.12) {
    return "Premium";
  }

  return "High premium";
}

export function BenchmarkDashboard({
  initialReport,
  defaultRequest,
  providerCatalog,
  scopeCatalog
}: BenchmarkDashboardProps) {
  const initialWindow = defaultRequest.customWindow ?? {
    checkIn: scopeCatalog[0]?.windows[0]?.checkIn ?? "",
    checkOut: scopeCatalog[0]?.windows[0]?.checkOut ?? ""
  };
  const [report, setReport] = useState(initialReport);
  const [selectedProviderKeys, setSelectedProviderKeys] = useState(
    defaultRequest.providerKeys
  );
  const [selectedScopeKeys, setSelectedScopeKeys] = useState(defaultRequest.scopeKeys);
  const [checkIn, setCheckIn] = useState(initialWindow.checkIn);
  const [checkOut, setCheckOut] = useState(initialWindow.checkOut);
  const [mode, setMode] = useState<CollectionMode>(defaultRequest.mode);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const deferredReport = useDeferredValue(report);
  const selectedNights = calculateNightCount(checkIn, checkOut);
  const hasValidWindow = Boolean(selectedNights);

  const canRun =
    selectedProviderKeys.length > 0 && selectedScopeKeys.length > 0 && hasValidWindow;

  function handleProviderToggle(providerKey: ProviderDescriptor["key"]) {
    setSelectedProviderKeys((current) => toggleValue(current, providerKey));
  }

  function handleScopeToggle(scopeKey: ScopeKey) {
    setSelectedScopeKeys((current) => toggleValue(current, scopeKey));
  }

  function runBenchmark(nextMode: CollectionMode) {
    if (!canRun) {
      return;
    }

    startTransition(() => {
      void (async () => {
        try {
          setErrorMessage(null);

          const response = await fetch("/api/benchmark/run", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              mode: nextMode,
              providerKeys: selectedProviderKeys,
              scopeKeys: selectedScopeKeys,
              customWindow: {
                checkIn,
                checkOut
              }
            } satisfies BenchmarkRequest)
          });

          if (!response.ok) {
            throw new Error("Benchmark route failed");
          }

          const nextReport = (await response.json()) as BenchmarkRunResult;
          setMode(nextMode);
          setReport(nextReport);
        } catch (error) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "Benchmark refresh sirasinda beklenmeyen bir hata oldu."
          );
        }
      })();
    });
  }

  return (
    <div className="dashboardShell">
      <aside className="controlRail">
        <section className="panel heroCard">
          <p className="eyebrow">OTA Benchmark Automation</p>
          <h1 className="heroTitle">Tusa bas, rapor tak diye gelsin.</h1>
          <p className="heroLead">
            Tarihi burada sen sececeksin; sistem secilen pencereyle OTA'ya gidip
            canli sonucu ayni rapor akisinin icine koyacak.
          </p>

          <div className="dateSelectorPanel">
            <div className="dateInputGrid">
              <label className="dateField">
                <span className="dateLabel">Check-in</span>
                <input
                  className="dateInput"
                  onChange={(event) => setCheckIn(event.target.value)}
                  type="date"
                  value={checkIn}
                />
              </label>
              <label className="dateField">
                <span className="dateLabel">Check-out</span>
                <input
                  className="dateInput"
                  onChange={(event) => setCheckOut(event.target.value)}
                  type="date"
                  value={checkOut}
                />
              </label>
            </div>
            <p className="dateHint">
              {selectedNights
                ? `${selectedNights} gece icin Booking ve diger secili OTA akislari bu tarihle kosacak.`
                : "Gecerli bir tarih araligi sec. Check-out tarihi check-in tarihinden sonra olmali."}
            </p>
          </div>

          <div className="buttonRow">
            <button
              className="primaryButton"
              disabled={!canRun || isPending}
              onClick={() => runBenchmark("mock")}
              type="button"
            >
              {isPending && mode === "mock" ? "Calisiyor..." : "Mock Benchmark Calistir"}
            </button>
            <button
              className="secondaryButton"
              disabled={!canRun || isPending}
              onClick={() => runBenchmark("live")}
              type="button"
            >
              Canli Benchmark Calistir
            </button>
          </div>

          <div className="metaStrip">
            <span className="metaBadge">{selectedProviderKeys.length} provider secili</span>
            <span className="metaBadge">{selectedScopeKeys.length} scope secili</span>
            <span className="metaBadge">Mode: {mode}</span>
            <span className="metaBadge">
              Tarih: {checkIn || "--"} {"->"} {checkOut || "--"}
            </span>
            {selectedNights ? (
              <span className="metaBadge">{selectedNights} gece</span>
            ) : null}
          </div>
        </section>

        <section className="panel sectionCard">
          <div className="sectionTitleRow">
            <div>
              <p className="eyebrow">Provider Seti</p>
              <h2 className="sectionTitle">Baslangic OTA listesi</h2>
            </div>
          </div>

          <div className="toggleGrid">
            {providerCatalog.map((provider) => {
              const isActive = selectedProviderKeys.includes(provider.key);

              return (
                <button
                  className={`toggleCard ${isActive ? "isActive" : ""}`}
                  key={provider.key}
                  onClick={() => handleProviderToggle(provider.key)}
                  type="button"
                >
                  <span className="toggleTopline">
                    <strong>{provider.name}</strong>
                    <span className="toggleState">{isActive ? "Secili" : "Pasif"}</span>
                  </span>
                  <span className="toggleBadge">{readinessLabel(provider)}</span>
                  <span className="toggleCopy">{provider.notes}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="panel sectionCard">
          <div className="sectionTitleRow">
            <div>
              <p className="eyebrow">Report Scope</p>
              <h2 className="sectionTitle">Hotel ve pazar kirilimlari</h2>
            </div>
          </div>

          <div className="toggleGrid">
            {scopeCatalog.map((scope) => {
              const isActive = selectedScopeKeys.includes(scope.id);
              const supportedCount = providerCatalog.filter((provider) =>
                provider.supportedScopes.includes(scope.id)
              ).length;

              return (
                <button
                  className={`toggleCard ${isActive ? "isActive" : ""}`}
                  key={scope.id}
                  onClick={() => handleScopeToggle(scope.id)}
                  type="button"
                >
                  <span className="toggleTopline">
                    <strong>{scope.label}</strong>
                    <span className="toggleState">{scope.currency}</span>
                  </span>
                  <span className="toggleBadge">{supportedCount} provider destekliyor</span>
                  <span className="toggleCopy">{scope.notes}</span>
                </button>
              );
            })}
          </div>
        </section>
      </aside>

      <section className="reportStage">
        <section className="summaryGrid">
          <article className="panel metricCard">
            <span className="metricLabel">Coverage</span>
            <strong className="metricValue">
              {deferredReport.summary.coveragePct}%
            </strong>
            <p className="metricCopy">
              {deferredReport.summary.availableRateCount}/
              {deferredReport.summary.expectedRateCount} quote dolu.
            </p>
          </article>
          <article className="panel metricCard">
            <span className="metricLabel">Parity Risk</span>
            <strong className="metricValue riskInk">
              {deferredReport.summary.parityRiskCount}
            </strong>
            <p className="metricCopy">Referans fiyatin altina dusen kritik hucreler.</p>
          </article>
          <article className="panel metricCard">
            <span className="metricLabel">Premium Pocket</span>
            <strong className="metricValue premiumInk">
              {deferredReport.summary.premiumCount}
            </strong>
            <p className="metricCopy">Referansin ustunde kalan guclu prim alanlari.</p>
          </article>
          <article className="panel metricCard">
            <span className="metricLabel">Missing / Stop</span>
            <strong className="metricValue mutedInk">
              {deferredReport.summary.missingCount}
            </strong>
            <p className="metricCopy">Quote donmeyen veya sold-out hucreler.</p>
          </article>
        </section>

        <section className="panel infoStrip">
          <div>
            <p className="eyebrow">Run Snapshot</p>
            <h2 className="sectionTitle">Son benchmark kosusu</h2>
            <p className="infoCopy">
              Uretim zamani: {formatDateTime(deferredReport.generatedAt)}
            </p>
          </div>

          <div className="winnerWrap">
            {deferredReport.summary.cheapestProviderWins.length > 0 ? (
              deferredReport.summary.cheapestProviderWins.slice(0, 4).map((winner) => (
                <span className="winnerChip" key={winner.providerKey}>
                  {winner.providerName}: {winner.wins} win
                </span>
              ))
            ) : (
              <span className="ghostText">Henuz cheapest-win sinyali yok.</span>
            )}
          </div>
        </section>

        {errorMessage ? (
          <section className="panel warningPanel">
            <strong>Route hatasi</strong>
            <p>{errorMessage}</p>
          </section>
        ) : null}

        {deferredReport.warnings.length > 0 ? (
          <section className="panel warningPanel">
            <strong>Canli durum notlari</strong>
            <div className="warningList">
              {deferredReport.warnings.map((warning) => (
                <span className="warningChip" key={warning}>
                  {warning}
                </span>
              ))}
            </div>
          </section>
        ) : null}

        {deferredReport.scopes.map((scope) => (
          <section className="panel scopeCard" key={scope.id}>
            <div className="scopeHeader">
              <div>
                <p className="eyebrow">
                  {scope.hotelName} · {scope.marketLabel}
                </p>
                <h2 className="scopeTitle">{scope.label}</h2>
                <p className="scopeCopy">{scope.notes}</p>
              </div>

              <div className="scopeMeta">
                <span className="metaBadge">
                  Ortalama spread: {formatPercent(scope.stats.averageSpreadPct)}
                </span>
                <span className="metaBadge">
                  Risk: {scope.stats.parityRiskCount}
                </span>
                <span className="metaBadge">
                  Missing: {scope.stats.missingCount}
                </span>
              </div>
            </div>

            <div className="providerChipRow">
              {scope.providers.map((provider) => (
                <span className="providerChip" key={`${scope.id}_${provider.key}`}>
                  {provider.shortName}
                </span>
              ))}
            </div>

            <div className="windowGrid">
              {scope.windows.map((window) => (
                <article className="windowCard" key={`${scope.id}_${window.id}`}>
                  <div className="windowHeader">
                    <div>
                      <h3 className="windowTitle">{window.label}</h3>
                      <p className="windowCopy">
                        {window.checkIn} → {window.checkOut} · {window.nights} gece
                      </p>
                    </div>
                    <span className="windowBadge">{scope.currency}</span>
                  </div>

                  <div className="tableWrap">
                    <table className="rateTable">
                      <thead>
                        <tr>
                          <th>Room</th>
                          <th>Reference</th>
                          {scope.providers.map((provider) => (
                            <th key={`${window.id}_${provider.key}`}>{provider.shortName}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {window.rows.map((row) => (
                          <tr key={`${window.id}_${row.roomId}`}>
                            <th className="roomCell">
                              <strong>{row.roomName}</strong>
                              <span>{row.occupancyLabel}</span>
                            </th>
                            <td className="referenceCell">
                              {formatCurrency(row.referencePrice, scope.currency)}
                            </td>
                            {row.entries.map((entry) => (
                              <td
                                className={`resultCell tone-${entry.tone}`}
                                key={`${window.id}_${row.roomId}_${entry.providerKey}`}
                              >
                                <span className="cellPrice">
                                  {formatCurrency(entry.scrapedPrice, scope.currency)}
                                </span>
                                <span className="cellDiff">
                                  {formatPercent(entry.differencePct)}
                                </span>
                                <span className="cellMeta">{cellStatusLabel(entry)}</span>
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </section>
    </div>
  );
}
