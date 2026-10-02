import type { BenchmarkRunResult } from "../lib/benchmark/types";
import { buildPriceSummary } from "../lib/benchmark/price-summary";
import { formatCurrency, formatDateTime } from "../lib/utils/format";

export function PriceSummary({ report }: { report: BenchmarkRunResult }) {
  const items = buildPriceSummary(report);
  const hotels = [...new Set(items.map((item) => item.hotelKey))];
  return (
    <section className="priceOverview" aria-label="OTA fiyat özeti">
      <h3>OTA fiyatları</h3>
      <p>
        1 oda / 2 yetişkin için uçaksız konaklama toplamları. Her kanalda
        bulunan en düşük teklif gösterilir; oda ve pansiyonlar farklı olabilir.
        EUR ve GBP çevrilmez.
      </p>
      {hotels.map((hotel) => (
        <div key={hotel} className="priceOverviewHotel">
          <h4>{items.find((item) => item.hotelKey === hotel)?.hotelName}</h4>
          <div className="priceOverviewGrid">
            {items
              .filter((item) => item.hotelKey === hotel)
              .map((item) => (
                <article
                  key={`${item.scopeKey}:${item.providerKey}:${item.checkIn}:${item.checkOut}`}
                  className={`priceOverviewCard ${item.price === null ? "unavailable" : ""}`}
                >
                  <span>{item.providerName}</span>
                  <small>{item.marketLabel}</small>
                  <strong>
                    {item.price === null
                      ? "Fiyat alınamadı"
                      : formatCurrency(item.price, item.currency)}
                  </strong>
                  <small>
                    {item.checkIn} → {item.checkOut} · {item.nights} gece
                  </small>
                  <p>{item.description}</p>
                  <b>Kaynak: {item.source}</b>
                  {item.observedAt && (
                    <small>Kontrol: {formatDateTime(item.observedAt)}</small>
                  )}
                </article>
              ))}
          </div>
        </div>
      ))}
    </section>
  );
}
