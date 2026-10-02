"use client";

import { useState } from "react";
import type {
  BenchmarkRequest,
  BenchmarkRunResult,
} from "../lib/benchmark/types";
import { BROWSER_CAPTURE_MAX_BYTES } from "../lib/benchmark/browser-import-merge";
import { formatCurrency, formatDateTime } from "../lib/utils/format";

export function BrowserImportPanel({
  request,
  disabled,
  blockedReason,
  onBusy,
  onApply,
  onReset,
}: {
  request: BenchmarkRequest;
  disabled: boolean;
  blockedReason?: string;
  onBusy: (busy: boolean) => void;
  onApply: (report: BenchmarkRunResult) => void;
  onReset?: () => void;
}) {
  const [preview, setPreview] = useState<BenchmarkRunResult | null>(null);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  async function previewText(load: () => Promise<string>) {
    if (disabled || busy) return;
    setBusy(true);
    onBusy(true);
    setError("");
    setPreview(null);
    try {
      const raw = await load();
      if (new Blob([raw]).size > BROWSER_CAPTURE_MAX_BYTES - 2048)
        throw new Error("Dosya en fazla 250 KB olabilir.");
      const capture = JSON.parse(raw);
      setText(raw);
      const response = await fetch("/api/benchmark/browser-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request, capture }),
        signal: AbortSignal.timeout(20000),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Aktarım doğrulanamadı.");
      setPreview(result);
    } catch (error) {
      setError(
        error instanceof SyntaxError
          ? "Geçersiz JSON dosyası."
          : error instanceof Error
            ? error.message
            : "Dosya okunamadı.",
      );
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <section
      className="browserImportPanel"
      aria-labelledby="browser-import-heading"
    >
      <div className="panelHeading">
        <div>
          <span className="stepNumber">+</span>
          <h2 id="browser-import-heading">Tarayıcıdan aktar</h2>
        </div>
        <span className="quietLabel">Loveholidays / On the Beach</span>
      </div>
      <p>
        Otomatik erişim engellendiğinde, kendi açtığınız OTA sekmesindeki{" "}
        <b>uçaksız konaklama toplamlarını</b> buraya aktarın. Önce yukarıdan
        aynı otel, tarih ve OTA&apos;yı seçin. Otomatik sorgu çalıştırmanız
        gerekmez.
      </p>
      <details className="browserInstallGuide">
        <summary>İlk kullanım: tarayıcı yardımcısını kur</summary>
        <ol>
          <li>
            <a href="/dgtlface-ota-helper.zip" download>
              Chrome / Edge yardımcısını indir
            </a>{" "}
            ve ZIP&apos;i aç.
          </li>
          <li>
            Chrome&apos;da <code>chrome://extensions</code>, Edge&apos;de{" "}
            <code>edge://extensions</code> sayfasını aç. Geliştirici modunu
            etkinleştir, <b>Paketlenmemiş öğe yükle</b> ile açtığın klasörü seç.
          </li>
          <li>
            OTA&apos;da Hotel Only ekranını açıp sayfayı yenile. 1 oda / 2
            yetişkin ve tarihleri kontrol et. On the Beach&apos;te{" "}
            <b>Total Hotel Price</b> seç. Daha fazla oda için{" "}
            <b>Show more / Mehr anzeigen / View more board options</b> aç.
          </li>
          <li>
            Yardımcıya tıkla: <b>Açık OTA sayfasını oku</b>, sonra{" "}
            <b>JSON dosyasını indir</b>. Aşağıdan dosyayı seç, önizle ve rapora
            ekle.
          </li>
        </ol>
        <p>
          Yardımcı yalnızca tıkladığın sekmede çalışır. Çerez, şifre, geçmiş
          veya hesap bilgisi okumaz; arka planda çalışmaz, dış servise veri
          göndermez, CAPTCHA çözmez. Dosyayı bu panele göndermeyi sen
          başlatırsın. İlk kurulum senin tarayıcı onayını gerektirir.
        </p>
        <p>
          Loveholidays:{" "}
          <a
            href="https://www.loveholidays.com/de/hotels/"
            target="_blank"
            rel="noreferrer"
          >
            EUR otel araması
          </a>{" "}
          /{" "}
          <a
            href="https://www.loveholidays.com/hotels/"
            target="_blank"
            rel="noreferrer"
          >
            GBP otel araması
          </a>
          . On the Beach:{" "}
          <a
            href="https://www.onthebeach.co.uk/_p/hotels"
            target="_blank"
            rel="noreferrer"
          >
            Hotel Only formu (GBP)
          </a>
          . Bu bağlantılarda tarihleri kendin seçmelisin.
        </p>
      </details>
      <p className="dateHelp">
        Yalnızca son 30 dakikada okunan dosyalar kabul edilir. EUR ve GBP
        çevrilmez. Kayıtlar sunucudan OTA doğrulaması değildir; ayrı gösterilir
        ve otomatik oda kapsamasını artırmaz. Sayfa yenilenince rapor silinir;
        saklamak için CSV indir.
      </p>
      {blockedReason && (
        <p className="staleNotice">
          {blockedReason}{" "}
          {onReset && (
            <button
              className="textButton"
              disabled={disabled}
              onClick={onReset}
            >
              Yeni aktarım için raporu temizle
            </button>
          )}
        </p>
      )}
      <label className="browserFileLabel">
        OTA aktarım dosyası (.json)
        <input
          type="file"
          accept=".json,application/json"
          disabled={disabled || !!blockedReason || busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            void previewText(async () => {
              if (file.size > BROWSER_CAPTURE_MAX_BYTES - 2048)
                throw new Error("Dosya en fazla 250 KB olabilir.");
              return file.text();
            });
          }}
        />
      </label>
      <details className="browserPaste">
        <summary>Dosya yerine JSON metni kullan</summary>
        <label>
          OTA aktarım JSON&apos;u
          <textarea
            rows={5}
            value={text}
            disabled={disabled || !!blockedReason || busy}
            onChange={(event) => {
              setText(event.target.value);
              setPreview(null);
            }}
            maxLength={BROWSER_CAPTURE_MAX_BYTES}
          />
        </label>
        <button
          className="secondaryButton"
          disabled={disabled || !!blockedReason || busy || !text.trim()}
          onClick={() => void previewText(async () => text)}
        >
          Aktarımı önizle
        </button>
      </details>
      {busy && (
        <p role="status">
          Dosyanın tarih, otel, kişi ve fiyat alanları kontrol ediliyor…
        </p>
      )}
      {error && (
        <p className="errorNotice" role="alert">
          {error}
        </p>
      )}
      {preview && (
        <div
          className="browserPreview"
          aria-label="Tarayıcı aktarım önizlemesi"
        >
          <h3>
            {preview.browserOffers![0].hotelName} /{" "}
            {preview.browserOffers![0].providerKey === "loveholidays"
              ? "Loveholidays"
              : "On the Beach"}
          </h3>
          <p>
            <b>
              {preview.browserOffers![0].checkIn} →{" "}
              {preview.browserOffers![0].checkOut}
            </b>{" "}
            · {preview.browserOffers![0].nights} gece · 1 oda / 2 yetişkin ·{" "}
            {preview.browserOffers![0].currency}
          </p>
          <p>
            {preview.browserOffers!.length} teklif · Okuma:{" "}
            {formatDateTime(preview.browserOffers![0].observedAt)} İstanbul
          </p>
          <p>{preview.warnings.at(-1)}</p>
          <details open>
            <summary>Aktarılacak fiyatları kontrol et</summary>
            <ul>
              {preview.browserOffers!.map((offer) => (
                <li key={offer.id}>
                  <b>{formatCurrency(offer.price, offer.currency)}</b> ·{" "}
                  {offer.roomName} · {offer.terms.board}
                  <small>{offer.matchReason}</small>
                </li>
              ))}
            </ul>
          </details>
          <p>
            Dosya imzalı değildir; içeriğinin gerçekten OTA&apos;dan geldiği
            sunucudan doğrulanamaz. Yalnızca kendi yardımcınızın ürettiği
            dosyayı kullanın. Aynı OTA/otel/tarih için önceki tarayıcı aktarımı
            varsa bu liste onun yerini alır.
          </p>
          <button
            className="primaryButton"
            disabled={disabled || !!blockedReason || busy}
            onClick={() => {
              try {
                onApply(preview);
                setPreview(null);
                setText("");
                setError("");
              } catch (error) {
                setError(
                  error instanceof Error
                    ? error.message
                    : "Aktarım eklenemedi.",
                );
              }
            }}
          >
            Kontrol ettim, rapora ekle
          </button>
        </div>
      )}
    </section>
  );
}
