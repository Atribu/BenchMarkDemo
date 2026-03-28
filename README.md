# OTA Benchmark Automation

Iki otel icin OTA benchmark akisini sheet'ten koda tasimak uzere kurulan ilk iskelet.

## Bu surumde ne var

- Next.js tabanli bir kontrol paneli
- Miramare Beach ve Miramare Queen icin seed reference fiyatlari
- Booking, Expedia, Hotelbeds, HolidayCheck, Loveholidays, On the Beach ve TUI provider katalogu
- `Fiyat`, `Fark`, `parity risk`, `premium`, `missing` mantigini hesaplayan benchmark engine
- `/api/benchmark/run` uzerinden tetiklenen benchmark route
- `npm run benchmark:mock` ile terminalden calistirilabilen mock benchmark akisi

## Neler henuz plan asamasinda

- Gercek Playwright selectorlari
- Provider bazli login / anti-bot handling
- Hotelbeds API baglantisi
- Oda tipi mapping ekranlari
- Rapor export (`xlsx`, `csv`, `pdf`)
- Zamanlanmis job ve persistence katmani

## Komutlar

```bash
npm install
npx playwright install chromium
npm run dev
```

Proxy ile yabanci pazar cikisi denemek icin opsiyonel env degiskenleri:

```bash
export OTA_MARKET=uk
export OTA_PROXY_URL="http://username:password@host:port"
```

Provider bazli override da kullanabilirsin:

```bash
export BOOKING_MARKET=de
export BOOKING_PROXY_URL="http://username:password@host:port"
export EXPEDIA_MARKET=us
export EXPEDIA_PROXY_URL="http://username:password@host:port"
```

Desteklenen market preset'leri: `default`, `uk`, `de`, `us`

Mock pipeline'i terminalden denemek icin:

```bash
npm run benchmark:mock
```

## Mimari not

Bu kurulumda UI, benchmark engine'den ayri tutuldu. Boylesiyle bir sonraki adimda:

1. Referans fiyat kaynagini panelden veya DB'den yonetebiliriz.
2. Her OTA icin gercek scraper ekleyebiliriz.
3. Ayni engine ile hem web raporu hem export dosyasi uretebiliriz.

## Live beta durumu

- `Booking.com`: beta live probe var. Searchresults property-card parser'i ile requested-date `sold_out` durumunu okuyabiliyor; room-level fiyat yerine sadece hotel-level fallback gorurse onu `manual-review` olarak donduruyor.
- `Expedia`: beta live probe var. Bot korumasi gelirse `manual-review` quote donduruyor.
- `Hotelbeds`: beta live API collector var. Availability akisi icin `HOTELBEDS_API_KEY`, `HOTELBEDS_SECRET`, `HOTELBEDS_CERT_PATH`, `HOTELBEDS_KEY_PATH` ve otel bazli `HOTELBEDS_HOTEL_CODE_*` env degerleri lazim.
- `HolidayCheck`: beta live probe var. Exact-date `hotel-only` teklif sayfasini acip `all-offers-service` cevabindan oda ve toplam fiyat okuyabiliyor.
- `Loveholidays`: beta live probe var. Search sayfasina gidip anti-bot/JS gate cevabini ve varsa hotel-level fiyat sinyalini kontrol ediyor.
- `On the Beach`: beta live probe var. Search sayfasina gidip anti-bot/JS gate cevabini ve varsa hotel-level fiyat sinyalini kontrol ediyor.
- `TUI`: beta live probe var. Resmi TUI offer endpoint'inden exact-date hotel-only fiyatini ve oda aciklamasini okuyabiliyor.
- Diger providerlar su an `manual-review` olarak isaretleniyor.

## Hotelbeds env kurulumu

```bash
export HOTELBEDS_API_KEY="..."
export HOTELBEDS_SECRET="..."
export HOTELBEDS_CERT_PATH="/abs/path/client.crt"
export HOTELBEDS_KEY_PATH="/abs/path/client.key"
export HOTELBEDS_CA_PATH="/abs/path/ca.crt" # opsiyonel
export HOTELBEDS_HOTEL_CODE_MIRAMARE_BEACH="123456"
export HOTELBEDS_HOTEL_CODE_MIRAMARE_QUEEN="123457"
```

Varsayilan endpoint test ortami icin `https://api-mtls.test.hotelbeds.com`. Gerekirse `HOTELBEDS_BASE_URL` ile override edebilirsin.
