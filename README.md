# DGTLFACE Hotel Benchmark

Miramare Beach ve Miramare Queen icin tarih bazli, ucaksiz OTA fiyat sorgusu. Kapsam yalnizca otel/tarih/kanal secip fiyatlari gormektir; referans fiyat, yuzde farki, Sheets senkronizasyonu ve operasyon yol haritasi panelden cikarilmistir. Next.js / React / TypeScript; tarayici collector'lari Playwright kullanir.

## Calistirma

```bash
npm install
npm run playwright:install
npm run dev
```

Panel: http://localhost:3000. Otel/pazar, giris-cikis tarihi ve kanallari secip **Fiyatlari getir** ile canli sorgu yapin. Dosya aktarimi veya tarayici eklentisi gerekmez. Demo dugmesi kaldirildi; mock motoru yalnizca gelistirme testleri icindir. Raporlar CSV olarak indirilebilir.

```bash
npm test
npm run benchmark:mock
npm run build
npm run start
```

Uygulama acilisinda dis sitelere sorgu yapmaz ve ornek fiyatlari canli gibi gostermez. Varsayilan tarih bugunden 7 gun sonrasi, konaklama 5 gecedir. Panelde tum fiyatlar 1 oda / 2 yetiskin / toplam konaklama icindir. Canli sorgular gecmis tarih kabul etmez; en fazla 60 gece secilebilir.

## Ucretsiz Ek Fiyat Servisi

SerpAPI Google Hotels adapter'i **Fiyatlari getir** akisina eklendi. Dogrudan OTA ve HolidayCheck ek kaynaginda teklif bulunamazsa, secili kanal icin otel baslangic toplami arar. Fiyat ozetinde her kanal icin bulunan en dusuk teklif, gercek kaynak ve para birimiyle gosterilir. Kaynak onceligi dogrudan OTA, HolidayCheck, Google Hotels'tir; kaynaklar esdeger oda fiyati sayilmaz. Oda/pansiyon bilgisi olmayan Google Hotels tutarlari oda hucrelerini ve oda kapsama oranini degistirmez. CSV'ye ek kaynak olarak eklenir.

1. [SerpAPI ucretsiz hesabini](https://serpapi.com/users/sign_up) kendi e-postanizla acip dogrulayin. Ucretli paket veya otomatik kredi alim ayari acmayin. Hesap olusturma ve sozlesme onayi kullaniciya aittir.
2. Hesap panelindeki API anahtarini yerel `.env.local` dosyasinda `SERPAPI_API_KEY` alanina ekleyin ve `SERPAPI_ENABLED=true` yapin. Anahtari sohbete, Git'e veya `NEXT_PUBLIC_*` degiskenine koymayin. `.env.example` diger alanlari gosterir.
3. Gelistirme sunucusunu yeniden baslatin. OTA baglantilari ekraninda yapilandirma gorunur; bu canli erisimin test edildigi anlamina gelmez. Tarihi/secili OTA'lari belirleyip ayni dugmeyi kullanin.

Bu entegrasyon henuz gercek bir SerpAPI anahtariyla test edilmedi. [Servis dokumani](https://serpapi.com/google-hotels-property-details) ve sentetik sozlesme testlerine dayanir. Anahtar eklendiginde her iki otelde, farkli tarihlerde gercek yanit/kapsama testi yapilmalidir. Google Hotels'te olmayan teklif uretilemez; tum OTA'lar garanti edilmez. Hotelbeds bu kaynaga dahil degildir, kendi uretim hesabi gerekir. SerpAPI Google'in resmi fiyat disari aktarim API'si degil, ucuncu taraf veri servisidir.

Her otel/pazar/tarih icin bir servis istegi yapilir, her OTA icin ayri istek yapilmaz. Bu uygulama otomatik yeniden deneme yapmaz; basarisizlar dahil en fazla **20 istek/UTC gunu ve 200 istek/UTC ayi** ayirir. [Ucretsiz plan](https://serpapi.com/pricing) 2 Ekim 2026 kontrolunde 250 sorgu/aydir; servis kosullari degisebilir. Sayac yalnizca bu kurulumun kullanimini bilir, hesabin diger uygulamalardaki kullanimini veya faturasini garanti edemez. Kilitli/bozuk sayac sorguyu durdurur; kotayi sifirlamak icin sayaci silmeyin. API yaniti, API anahtari ve anahtarli URL istemciye/loglara aktarilmaz.

## Yayin Hazirligi

Su an otomatik yayin yapilmaz. Bu surum tek kullanicili/ekip ici, **tek Node sureci ve kalici disk** ile calistirilmak uzere hazirlandi; coklu instance/serverless icin paylasilan kuyruk, kimlik sistemi ve kalici kullanim deposu gerekir. Rapor tarayici bellegindedir, yenilemede kaybolur; kalici arsiv degildir.

- Uretimde `BENCHMARK_AUTH_USER` ve en az 20 karakterlik, bosluksuz ASCII `BENCHMARK_AUTH_PASSWORD` zorunludur. Eksik/zayif ayarda uygulama 503, giris yapilmamissa 401 verir. Paylasimli HTTP Basic erisimi HTTPS olmadan kullanmayin.
- `BENCHMARK_PUBLIC_ORIGIN=https://gercek-alan-adiniz` ayarlayin. HTTPS ters proxy, giris denemelerine IP bazli hiz siniri ve uzun surebilen OTA sorgularina uygun istek zaman asimi yapilandirin. Bir Node surecinde ayni anda tek sorgu ve 10 saniyelik baslatma araligi uygulanir.
- `BENCHMARK_STATE_DIR` icin uygulama kullanicisina ait ozel/kalici bir disk dizini baglayin. Varsayilan `.benchmark-state/` Git'e alinmaz. Ayni diski korumadan yeniden dagitim kota sayacini kaybettirir. Surec yazim sirasinda kapanirsa kalan kilidi yonetici, calisan is olmadigini dogrulayarak incelemelidir.
- Node 22/24 LTS, `npm ci`, Linux sunucuda `npx playwright install --with-deps chromium`, `npm run build`, sonra `npm start -- --hostname 127.0.0.1` kullanin. Dev sunucusunu internete acmayin. API anahtarlari ve giris sifresi sunucu secret yonetiminde tutulmali.
- Acik gelistirme sunucusuna dokunmadan derlemek icin `NEXT_DIST_DIR=.next-release npm run build` kullanilabilir; bu ciktiyi baslatirken de ayni `NEXT_DIST_DIR` gereklidir.
- Yayin oncesi servis/OTA veri kullanim kosullarini ve yeniden yayinlama haklarini kontrol edin; iki otel icin canli fiyat dogrulamasi, mobil kontrol ve HTTPS/giris/kota testi tamamlanmali. Erisim engeli veya fiyat yoklugu asla sahte veriyle doldurulmaz.

Next.js 15.5.27'ye ve bagimli guvenlik yamalarina gecildi. Next'in PostCSS bagimliligi ayni ana surumde yamali 8.5.28 ile sabitlendi (`overrides`); bu nedenle her guncellemede build/test tekrarlanmalidir.

IBM Plex Sans ve Space Grotesk artik Fontsource paketlerinden yerel sunulur; build Google Fonts ag erisimine bagli degildir. 2 Ekim 2026 son kontrolde **131 test**, TypeScript ve izole uretim build'i gecti; `npm audit` 0 bilinen acik bildirdi. Uretim HTTP testleri eksik erisim ayarina 503, girissiz istege 401, dogru girise 200, baska origin'e 403 ve eski aktarim endpoint'ine 410 dogruladi. Bu, yayina alindigi veya kapsamli guvenlik denetimi yapildigi anlamina gelmez.

2 Ekim 2026 17:06 Istanbul canli UI testi: Beach / 9-14 Ekim / 5 gece icin HolidayCheck 1439 EUR baslangic toplami ve HolidayCheck uzerinden TUI etiketli 1456 EUR teklif ozet kartlarina geldi. Bunlar farkli odalardir, esdeger fiyat karsilastirmasi degildir. TUI'nin kendi servisi baglanti zaman asimina ugradi; dogrudan hucreleri basarili yapilmadi. 2 eslesen HolidayCheck oda fiyati, 165 alternatif teklif, bunlarin icinden 14 TUI etiketli ek kaynak teklifi goruldu. Masaustu ve 390 px mobil fiyat ozeti dogrulandi; yatay sayfa tasmasi ve tarayici konsol hatasi gorulmedi. SerpAPI hesap/anahtari olmadigindan onun testi sentetik yanitlarla sinirlidir.

### Kanal ve pazar secimi

Yedi OTA'nin tamami her iki otelde secilebilir; **Tum OTA'lari sec** hepsini isaretler. Otel/pazar degisince kanal secimleri silinmez. Pazar bir tercihtir: Avrupa seciliyken On the Beach ayni otelin GBP pazarina, UK seciliyken TUI/HolidayCheck/Hotelbeds ayni otelin EUR pazarina yonlendirilir. Secilen tarihler korunur. EUR ve GBP ayri tablolardadir; kur donusumu yapilmaz. Yalnizca yonlendirilen kanal ek tabloya konur; diger kanallarin sorgulari gereksiz yere tekrarlanmaz. Otel eslestirmesi olmayan bir kanal rapordan dusurulmez, nedeni gosterilir. Bir kanalin secilebilir olmasi canli erisiminin basarili oldugu anlamina gelmez.

## Marka ve Arayuz

Orijinal SVG logo ve renkler [DGTLFACE](https://dgtlface.com/tr/) sitesinden alinmistir. Logo: `public/brand/dgtlface-logo.svg`. Renkler: `#140F25`, `#A754CF`, `#547CCF`, `#54B9CF`. Marka alanlari koyu, fiyat tablosu okunabilirlik icin acik tasarlanmistir. Panel ve OTA baglanti durumu ekranlari mobil uyumludur.

## Canli Kanal Durumu

| Kanal | Mevcut akis | Kalan gereksinim |
| --- | --- | --- |
| TUI | Ucaksiz rooms-panel servisi; toplam fiyat, otel/tarih/kisi/para birimi kontrolu; oda/balkon ayrimi; pansiyon, iptal ve sehir vergisi bilgisi | Kosullarin diger kanallarla tam esdegerligi ve duzenli erisim garantisi yok |
| HolidayCheck | Exact-date hotel-only; otel kimligi, 1 oda/2 yetiskin, para birimi; kati oda eslesmesi ve alternatif teklifler; operator, pansiyon, iptal, cashback | Vergi dokumu ve tum iptal kosullari her teklifte mevcut degil; son fiyat/musaitlik yeniden kontrol edilmeli |
| Booking | Dogrudan otel oda tablosu okuyucusu; tarih/kisi/para birimi ve secilebilir oda toplami kontrolu | Bu ortamda Turkiye ana sayfasina yonleniyor. Oda tablosu birim testli, otomatik canli fiyat henuz dogrulanmadi |
| Expedia | Almanya/UK otel sayfasinda oda karti, mevcut konaklama toplami, tarih/kisi/para birimi kontrolu | 2 Ekim 2026 otomatik testinde bot dogrulamasi engelledi; canli basari dogrulanmadi |
| Hotelbeds | Availability API; gzip, timeout, BOOKABLE satis fiyati, oda/para birimi kontrolu | API hesabi, mTLS dosyalari, otel kodlari ve uretim erisimi |
| Loveholidays | Beach (371656) ve Queen (371430) icin dogrulanmis Hotel Only otel kimlikleri; GBP/EUR oda toplami, tarih ve kisi kontrolu | 2 Ekim 2026 otomatik testinde erisim dogrulamasi engelledi. Queen 16-21 Ekim Hotel Only sayfasindaki kara ve kismi deniz manzarali oda kartlari okuyucu testlerine eklendi; tarayicida gorulmesi otomatik basari sayilmaz |
| On the Beach | Hotel Only formu, 2-28 gece, 1 oda/2 yetiskin; otel filtresi, Total Hotel Price, tum oda secenekleri | Tekil collector testinde 16-21 Ekim 2026 Beach icin otomatik 1429.01 / 1524.87 GBP alindi. Sonraki panel/API denemeleri CAPTCHA ile engellendi; duzenli otomasyon henuz dogrulanmadi |

Canli collector bulunmasi baglantinin her zaman calisacagi anlamina gelmez. Hucreler bolgesel erisim engeli, site dogrulamasi, eksik API ayari, eksik otel eslestirmesi, sorgu zaman asimi ve oda fiyati eslesmesini ayri etiketlerle gosterir. Siniflandirilamayan hata **Kontrol bekliyor** olarak kalir; dogrulanmis fiyat gibi gosterilmez. Oda manzarasi acik degilse generic isimden kara manzarasi varsayilmaz. Net Hotelbeds maliyeti perakende OTA fiyatina esit sayilmaz. Bos veya hatali HTTP 200 cevabi tek basina musaitlik yok kabul edilmez.

## Booking / Expedia / TUI Icin HolidayCheck Ek Kaynagi

TUI'nin kendi servisine baglanilamadiginda da HolidayCheck'teki operator adi tam olarak **TUI** olan teklifler ayni kurallarla ayri ek kaynak olarak kullanilir. Bu TUI uzerinden dogrudan dogrulama sayilmaz. Mevcut HolidayCheck sorgusu tekrar kullanilir.

Booking veya Expedia secilip dogrudan sorgu erisim/oda dogrulamasinda basarisiz olursa, HolidayCheck'in ayni otel ve tarihteki ucaksiz teklifleri de kontrol edilir. HolidayCheck'in ayrica secilmesi gerekmez. Secili HolidayCheck sorgusu varsa sonucu tekrar kullanilir; ayni arama basarisiz oldugu icin korlemesine tekrarlanmaz. Aksi halde otel basina bir EUR kaynak sorgusu yapilir (en fazla 2 eszamanli). `OTA_HOLIDAYCHECK_SECONDARY=false` bu ozelligi kapatir.

Yalnizca kaynak operator adi tam olarak Booking.com veya Expedia olan ve kullanicinin sectigi kanala ait teklifler kabul edilir. Otel, tarih, 1 oda/2 yetiskin, EUR, fiyat ve kaynak URL tekrar kontrol edilir. `secondaryOffers` alaninda gercek `providerKey` **holidaycheck**, ilan edilen satici `advertisedProviderKey` olarak ayridir. Dogrudan Booking/Expedia hucreleri, hata durumlari ve basari/kapsama oranlari degistirilmez. Panel ve CSV **HolidayCheck uzerinden / dogrudan OTA dogrulamasi degil** der; GBP isteginde dahi EUR etiketini korur. Gosterilen fiyatlar son musaitlik veya rezervasyon fiyati garantisi degildir.

2 Ekim 2026 testinde 23-28 Ekim icin sadece Booking/Expedia secilerek iki otelden 31 ek kaynak teklifi alindi (Beach 17, Queen 14; 0 dogrudan fiyat). En dusuk kaynak etiketli toplamlar: Beach Booking 1836 EUR, Expedia 1628.10 EUR; Queen Booking 1355.76 EUR, Expedia 1355.77 EUR. Oda/tarife farklari nedeniyle bu dort deger birbirine esdeger oda/parite fiyati olarak yorumlanmamali. Loveholidays'in alternatifleri sonuc dizisine aktarmayan degisken golgeleme hatasi da duzeltildi ve collector seviyesinde regresyon testi eklendi; bu kod duzeltmesi erisim dogrulama engelini cozmez. 91 birim testi ve TypeScript denetimi gecti.

## Loveholidays / On the Beach Erisim Kontrolu

2 Ekim 2026 yeniden testinde iki otel icin 23-28 Ekim / 5 gece / 1 oda / 2 yetiskin sorgulari her iki kanalda da otomatik erisim dogrulamasi veya hiz siniriyla durdu: 0/8 oda fiyati, 0 alternatif. Ek olarak Queen icin yeni, oturum kaydi olmayan ve stealth kapali tarayicilarla birer sorgu yapildi; onlar da engellendi. `USE_STEALTH=false` artik hem eklentiyi hem ek tarayici bayragini ve navigator degisikliklerini kapatir; bu bir erisim cozumu garantisi degildir. Varsayilan kanal ayarlari degistirilmedi.

Ayni tarihlerde normal tarayicida Queen icin Loveholidays Hotel Only ekraninda Standard Zimmer 1356 EUR (iadesiz) ve 1507 EUR (esnek otel degisikligi), suite 2034 EUR goruldu. On the Beach Hotel Only ekraninda Double Or Twin Land View Balcony 1019.88 GBP, yan deniz manzarali oda ve aile odasi 1085.82 GBP goruldu. Bunlar **yalnizca tarayici gozlemi ve okuyucu test ornekleridir**; rapora otomatik sonuc veya elle fiyat kaydi olarak eklenmedi. Farkli oda/kosul/para birimleri birbirine esdeger sayilmadi.

On the Beach artik tum dogrulanmis oda toplamlarini korur, kati oda eslestirmesini uygular ve eslesmeyenleri alternatif olarak rapora verir. Kismi deniz, ekonomi, balkonsuz ve belirsiz oda normal oda yerine konmaz. Kisi basi, gecelik, depozito, karisik para birimi/birim ve sifir fiyat reddedilir. Sonraki tarih sorgusu basarisiz olsa da onceki teklifler korunur. Booking/Expedia'nin eski oda okuyuculari bu degisiklige dahil degildir.

Normal tarayicida fiyat gorulmesi sunucudan tek tusla otomatik fiyat alindigi anlamina gelmez. Kullanici kontrollu aktarim asagidaki bolumde uygulanmistir; arka plan collector erisim engelini cozmez. Loveholidays'in [resmi partner sayfasi](https://www.loveholidays.com/about-us/affiliate.html) Partnerize uzerinden yonlendirme/komisyon programi anlatir; bu sayfa benchmark fiyat API'si erisiminin varligini veya verilecegini kanitlamaz. Yeni hesap, ucretli servis veya proxy kurulmadan once erisim kapsami netlestirilmelidir.

## Tek Tusla Fiyat Sorgusu

Ana ekran yalnizca otel, tarih ve OTA secimi ile **Fiyatlari getir** akisini sunar. Demo dugmesi ve tarayici/dosya aktarim paneli ana ekrandan kaldirilmistir. Canli sorgu eski elle dogrulanan kayitlarla tamamlanmaz; yalnizca o sorgudaki collector ve acikca etiketlenen ek kaynak sonuclari kullanilir. Erisim engeli varsa fiyat bos kalir ve nedeni gosterilir. Bu sadelestirme OTA erisim engellerini cozmez.

2 Ekim 2026 saat 16:16 Istanbul panel kontrolu: Miramare Beach / 9-14 Ekim / 5 gece / 1 oda / 2 yetiskin, yedi OTA tek dugmeyle sorgulandi. TUI ve HolidayCheck'ten 4 eslesen oda fiyati ve 211 diger oda/tarife teklifi; HolidayCheck uzerinden Booking/Expedia etiketli 12 ek kaynak teklifi geldi (bu 12 kayit HolidayCheck'in teklifleriyle ortusebilir). Booking bolgesel yonlendirme, Expedia/Loveholidays/On the Beach site dogrulamasi, Hotelbeds eksik API ayari nedeniyle dogrudan fiyat vermedi. Elle kayit eklenmedi. Bu test tum OTA'larin otomatik calistigi anlamina gelmez.

Asagidaki tarayici aktarimi ve elle dogrulama bolumleri onceki denemenin teknik kaydidir. Yardimci ve okuyucu kodu silinmedi, ancak kullanicidan kurulum/dosya aktarimi isteyen panel aktif urun akisinda yer almaz. Demo motoru da yalnizca gelistirme/test amaciyla korunur.

## Kullanici Kontrollu Tarayici Aktarimi (Eski Deneme)

**Asagidaki bolum teknik gecmistir, mevcut kullanim talimati degildir.** Panel kaldirildi; `/api/benchmark/browser-import` artik 410 doner ve dosyadan fiyat eklemez.

Paneldeki **Tarayicidan aktar** alani Loveholidays ve On the Beach icindir. Chrome/Edge yardimcisi `browser-helper/` klasorunde, indirilebilir paket `public/dgtlface-ota-helper.zip` icindedir. Yeniden paketlemek icin `npm run browser-helper:package` (yerel `zip` komutu gerekir). Uzanti tarayiciya otomatik kurulmaz; kullanici bir kez kurmalidir.

1. Panelden yardimci ZIP'ini indirip acin. Chrome'da `chrome://extensions` veya Edge'de `edge://extensions` acin; Gelistirici modu / Paketlenmemis oge yukle ile `manifest.json` bulunan klasoru secin. Repodaki `browser-helper/` de dogrudan secilebilir.
2. OTA'nin Hotel Only sayfasinda ayni otel, tarih, 1 oda / 2 yetiskin aramasini acip yenileyin. On the Beach'te **Total Hotel Price** secin. Yuklenmemis odalari dahil etmek icin Show more / Mehr anzeigen / View more board options acin.
3. Yardimci dugmesinde **Acik OTA sayfasini oku** secin, gorunen bilgiyi kontrol edip **JSON dosyasini indir** deyin. Birden fazla desteklenen otel gorunuyorsa hangisini aktaracaginizi secin.
4. Benchmark'ta ayni sorguyu secin. **OTA aktarim dosyasi** alanindan JSON'u acin. Onizlemeyi kontrol edip **Kontrol ettim, rapora ekle** deyin. JSON metni yapistirmak da desteklenir. Onizleme tek basina raporu degistirmez.

Onceden otomatik sorgu calistirmak gerekmez; ilk aktarim bos canli rapor olusturur ve otomatik sorgu yapilmadigini acikca belirtir. Mevcut canli raporda tarihler/secimler ayniysa otomatik sonuclari koruyarak eklenir. Demo veya degismis secimde once raporu temizlemek gerekir. Aynı OTA/otel/tarih grubunun yeni aktarimi eski grubun tamamini degistirir; tekrar ayni dosya fiyatlari cogaltmaz, daha eski dosya yeniyi ezemez. Gruplar panelden kaldirilabilir. Sayfa yenilenince rapor kaybolur; CSV ile saklanabilir.

**Guven siniri:** `browserOffers` kayitlari `captureMethod: browser-assisted` tasir. Sunucu yalnizca dosyanin otel, secili kanal, tarih, gece, kisi, currency, kaynak URL ve oda-toplam fiyat sozlesmesini kontrol eder; OTA'ya baglanmaz ve dosyanin gercekligini tasdik etmez. JSON imzali degildir, degistirilebilir. Yalnizca kendi yardimcinizin olusturdugu dosyayi kullanin. Oda ozellikleri sunucuda tekrar ayristirilir; dosyadan gelen `matchedRoomId` veya hazir sayisal fiyat guvenilir kabul edilmez.

Dosya en fazla 250 KB, HTTP govdesi en fazla 256 KB, 1-200 teklif olabilir. 30 dakika ve ustu yasli veya bir dakikadan fazla gelecek tarihli okuma reddedilir. Bu sure fiyat guncelligi garantisi degildir: sayfayi yenilemek kullanicinin sorumlulugudur; acik rapor otomatik yenilenmez. Yanlis tarih/otel/para birimi, ucakli/gecelik/kisi basi tutar kabul edilmez. EUR/GBP cevrilmez. Aktarilan fiyatlar ayri kartlarda ve CSV'de **TARAYICI AKTARIMI / SUNUCUDAN DOGRULANMADI** etiketiyle bulunur; otomatik hucrelere, kapsama veya en ucuz OTA hesabina eklenmez.

Yardimci ag istegi yapmaz, cerez/localStorage/gecmis/hesap verisi okumaz, sayfa HTML'ini disari aktarmaz. Kaynak URL'de yalnizca arama parametreleri korunur. Arka plan gorevi, content script veya kalici host izni yoktur. [Chrome activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab) ve [scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting) ile kullanici tarafindan etkinlestirilen sekmede tek seferlik DOM okuma yapar. CAPTCHA cozmez veya tarayici guvenlik uyarilarini gecmez. JSON dosyasinin benchmark sunucusuna gonderilmesini kullanici baslatir; sunucu dosyayi diske yazmaz. Bu gelistirme surumunu yerel ortamda kullanin.

2 Ekim 2026 testinde Queen 23-28 Ekim / 5 gece / 1 oda / 2 yetiskin icin normal tarayicida gorulen Loveholidays'in 3 EUR teklifi JSON metniyle, On the Beach'in 6 GBP teklifi JSON dosya secicisiyle onizlenip rapora eklendi: **9 tarayici teklifi, 0 otomatik oda fiyati**. Ayni dosya tekrar eklendiginde 9 kayit olarak kaldi. Bu UI testi yardimcinin Chrome'a kurulup uctan uca calistirildigi iddiasi degildir; uzanti okuyucusu ve dugme/indirme akisi jsdom birim testleriyle kontrol edildi.

113/113 test, TypeScript ve ZIP butunluk denetimi gecti. Masaustu aktarim akisi ve tarayici hata konsolu kontrol edildi. Bu turdaki 390px viewport denemesi tarayiciya uygulanmadi (1280px kaldi); mobil gorsel kontrol bu ozellik icin tamamlanmis sayilmaz. Uretim build'i acik dev sunucusunun `.next` dizinine yazmamak icin calistirilmadi. `npm audit` ayrica mevcut bagimliliklarda 6 uyari bildirdi (1 dusuk, 4 yuksek, 1 kritik; Next.js dahil). Bunlar bu ozellik kapsaminda toplu guncellenmedi. Kimlik dogrulamasi da olmayan gelistirme sunucusunu internete acmadan once bagimliliklar ve erisim guvenligi ele alinmali.

## Google Hotels Ek Kaynagi

Bu ek adim yalnizca HolidayCheck kaynaginda ilgili Booking/Expedia kanali icin teklif bulunmayan scope'larda calisir; ikinci kez ayni baslangic fiyatini aramak icin her zaman tetiklenmez.

Secili Booking/Expedia oda sorgusu dogrulanamazsa Google Hotels'teki ayni otelin fiyat ekrani da kontrol edilir. Takvimden secilen giris-cikis, 2 yetiskin/0 cocuk ve **Stay total** dogrulanir. Yil bilgisi dahil tarihler, otel kimligi ve ucaksiz arama OTA teklif baglantisindan da kontrol edilir. Su an Booking, Expedia ve TUI icin dogrulayici vardir; sadece raporda secili kanallar kabul edilir.

Bu veriler `hotelPrices` alaninda, **otel baslangic fiyati** olarak ayri gosterilir. Oda/pansiyon eslesmesi sayilmaz; oda tablosuna veya basari oranina eklenmez. CSV'de ayri ek kaynak satiri olarak bulunur. Google'in gosterdigi para birimi OTA'nin satis para biriminden farkli olabilir. Teklif bulunmasi ve tum kanallarin listelenmesi garanti degildir; bu akis erisim engellerini asan bir cozum degildir.

2 Ekim 2026 canli testinde Beach icin 16-21 ve 23-28 Ekim 2026 araliklarinda TUI'nin 1458 EUR otel baslangic toplami otomatik alindi. Ayni tarihlerde TUI'nin dogrudan superior oda fiyatlari farklidir; bu nedenle baslangic toplami oda fiyatinin yerine gecmez. Queen icin ek kaynak henuz istikrarli degil; bazi sorgular fiyat gorunumunde zaman asimina ugradi. Mevcut cikis IP'siyle Google'dan Booking veya Expedia fiyati dogrulanmadi.

## Elle Dogrulanan Fiyatlar (Eski Deneme)

`data/manual-observations.json`, sitede tarayiciyla gorulmus fiyatlarin kaynak, oda, kosul ve kontrol zamani kayitlarini tutar. 2 Ekim 2026 kontrolunde Miramare Beach icin 9-14 Ekim 2026 / 5 gece / 1 oda / 2 yetiskin / ucaksiz toplamlar kaydedildi: Expedia Almanya EUR ve On the Beach UK GBP. Bunlar otomatik collector entegrasyonu degildir; panelde **Elle dogrulandi**, CSV'de **ELLE KONTROL / ANLIK DEGIL** olarak ayrilir.

Bu kayitlar artik canli sorguya eklenmez. Onceki birlestirme yardimcisi, kaynak verileri ve testleri teknik gecmis olarak korunur; fiyat toplama akisinda kullanilmaz. Panel saatleri Istanbul, CSV kontrol zamani UTC'dir. On the Beach arama-oturumu baglantisi sona erebilir. Iptal/vergi bilgisi gorulmediyse kosullarda acikca belirtilir.

## Dogruluk Sinirlari

TUI'nin eski CloudFront arama servisi sadece en ucuz tek teklif ozetini veriyordu. Artik resmi otel sayfasinin kullandigi `https://cloud.tui.com/osp/ao/ml/rooms-panel/rooms` servisi sorgulanir. `roomTypes: []` yalnizca bu kanalda teklif olmadigini belirtir; ag hatasi veya bozuk yanit doluluk sonucu sayilmaz.

### Oda eslesmesi ve alternatif teklifler

TUI, HolidayCheck, Loveholidays ve On the Beach okuyuculari dogrulanmis ucaksiz toplam fiyatlari oda eslesmesinden once korur. Beach superior satirlari acik superior kategorisi, uygun manzara ve balkon kaniti ister. Queen standard/double kategorisi ve acik manzara ister; bilinmeyen balkon bilgisi ayrica belirtilir. Kismi/yan deniz, balkonsuz, ekonomi, aile, suite ve belirsiz manzara otomatik olarak normal oda yerine konmaz. Almanca ve Ingilizce oda ifadeleri desteklenir; HolidayCheck'in LLM uretimi oda detaylari eslesme kaniti sayilmaz.

Ana tabloda oda profiline uyan en dusuk teklif gosterilir. Diger fiyatlar `alternativeOffers` ile korunur: farkli/belirsiz oda veya ayni oda icin diger operator/tarife secenekleri. Tamamen ayni teklifler tekillestirilir; farkli pansiyon, iptal ve operatorler birlestirilmez. Panel ilk 6 alternatifi gosterir, kalani acilabilir. CSV'de **ALTERNATIF TEKLIF** olarak ayri satirlar vardir; bunlar oda kapsama oranini veya eslesen oda sayisini artirmaz.

Kaynak pansiyon ve iptal kosullari, operator ve kontrol zamani gosterilir. Bilinmeyen kosullar tahmin edilmez. Cashback kosullu iadedir, fiyat toplamindan dusulmez. Oda eslesmesi tam tarife esdegerligi degildir; canli raporda motor da parite/yuzde farki ve en ucuz OTA siralamasi uretmez. Kaynak linki belirli bir teklifi degil tarihli aramayi acar; son fiyat ve musaitlik rezervasyonda yeniden kontrol edilmelidir. TUI linkinde `selectedDuration` korunur; Queen HolidayCheck linki guncel otel slug'ini kullanir.

Bos fiyat hucreleri erisim, eksik API ayari, tamamlanmamis entegrasyon ve teklif yok durumlarini ayirir. On the Beach'in eski `/holidays/search` baglantisi yerine Hotel Only formu kullanilir; kisi basi fiyat toplam diye alinmaz, kusuratlar korunur. HTML icindeki bot kutuphanesi adlari tek basina captcha kaniti sayilmaz.

- Eski referans verileri motor uyumlulugu icin kodda kalir; panel ve CSV referans veya yuzde farki gostermez.
- Pansiyon, iptal, vergi, promosyon ve balkon gibi alt oda ozellikleri tum kanallarda normalize edilmis degil. Sonuclar **on karsilastirmadir**, kesin rate-parity karari olarak kullanilmamali.
- Rapor yalnizca acik oturumda tutulur. Sayfa yenilenince kaybolur; kalici gecmis, Excel/PDF ve zamanlama henuz yoktur.
- Her raporda en fazla 3 dogrudan collector, ardindan en fazla 2 ek kaynak sorgusu eszamanli calisir. Bu raporlar arasi global rate-limit veya kalici is kuyrugu degildir. API'de kimlik dogrulama yoktur; bu surumu internete acik kullanima cikarmayin.

## Sunucu Ayarlari

`.env.example` degisken adlarini gosterir. Gercek bilgileri `.env.local` veya sunucu secret yonetiminde tutun. `.env*`, anahtarlar, sertifika paketleri ve `credentials/` git tarafinda dislanmistir. Gercek sirlar `NEXT_PUBLIC_*` degiskenlerine yazilmamalidir.

Anonim tarayici cookie/localStorage verisi `.ota-sessions/` altinda, OTA/para birimi/pazar/tarayici/proxy bazinda ayri tutulur. Kisisel Chrome profili kullanilmaz; oturumlar kimlik dogrulama engelini asmaz. Dosyalar Git disindadir, dizin 0700/dosya 0600 izinleriyle yazilir. Eksik/bozuk veya son yazimdan 7 gun gecmis kayitlar kullanilmaz. `OTA_PERSIST_SESSIONS=false` kaliciligi kapatir; `OTA_SESSION_DIR` konumu degistirir. `OTA_GOOGLE_HOTELS=false` ek kaynagi kapatir. `OTA_DEBUG=true`, Google collector hata adimini ve Playwright hata ayrintisini sunucu konsoluna yazar.

Tarayici collector'lari icin opsiyonel proxy:

```bash
OTA_PROXY_URL=http://username:password@host:port
BOOKING_MARKET=de
BOOKING_PROXY_URL=http://username:password@host:port
EXPEDIA_MARKET=uk
```

Saglayiciya ozel dolu deger genel degeri ezer. Bos deger genel proxy'yi iptal etmez. Market secimi sadece dil/saat dilimini degistirir; IP ulkesini degistirmez. Proxy erisim saglasa da oda-toplam fiyat collector'i ayrica tamamlanmalidir. TUI dogrudan sunucu HTTP istegi, Hotelbeds dogrudan mTLS kullanir; tarayici proxy ayarlari bu iki akis icin gecerli degildir.

Hotelbeds icin `HOTELBEDS_API_KEY`, `HOTELBEDS_SECRET`, `HOTELBEDS_CERT_PATH`, `HOTELBEDS_KEY_PATH`, `HOTELBEDS_HOTEL_CODE_MIRAMARE_BEACH`, `HOTELBEDS_HOTEL_CODE_MIRAMARE_QUEEN` gerekir. `HOTELBEDS_CA_PATH` opsiyoneldir. Varsayilan `HOTELBEDS_BASE_URL` **test ortamidir**, gercek ticari fiyat kaynagi olarak kullanilmamalidir; uretim erisimi saglayiciyla tamamlanmalidir.

## Kontroller

En son Loveholidays / On the Beach duzeltmeleriyle 99/99 birim testi, `npx tsc --noEmit` ve `git diff --check` gecti. Yeni testler On the Beach alternatiflerinin kapsama ayrimini, yan deniz/ekonomi/balkon/oda kategorisini, bozuk toplam fiyatlari, farkli pansiyonlarin korunmasini ve sonraki sorgu hatasinda onceki tekliflerin kaybolmamasini kapsar. Tarayicida gozlenen Queen ornekleri yalnizca test verisidir; 99 testin gecmesi otomatik canli erisim basarisi anlamina gelmez.

Guncel oda/teklif ayrimi: 82 birim testi; yan/tam deniz, balkon, genel oda, farkli tarife, cashback, hatali tarih/kisi/otel, alternatiflerin CSV ve kapsama ayrimi kapsaniyor. 2 Ekim 2026'da 23-28 Ekim panel testinde 6 eslesen oda ve 259 alternatif, 16-21 Ekim API testinde 6 eslesen oda ve 275 alternatif alindi (TUI + HolidayCheck, iki otel, 0 elle kayit). TUI Queen her iki aralikta teklif dondurmedi. Alternatif sayisi farkli oda/operator/tarife seceneklerini ifade eder. TUI 23-28 Ekim kaynak ekraninda 1508/1620 EUR ve ayri balkonsuz 1458 EUR goruldu. Masaustu ve 390px mobil kart yerlesimi kontrol edildi. Asagidaki 60/70 testli eski denemeler yeni kati oda eslestirmesinden oncedir; fiyatlari yeni esdeger oda sonucu olarak yorumlamayin.

`npm test`: fiyat formatlari ve para birimi; oda manzarasi; TUI tarih/total/cevap yapisi; Hotelbeds gzip ve net/brut ayrimi; API istegi/tarih dogrulama; motorun supheli veriyi dislamasi; CSV formula injection ve proxy onceligi. Testler canli siteye baglanmaz. Gercek erisim icin panelden sinirli sayida canli sorgu calistirin.

Yeni testler Booking/Loveholidays oda fiyat ayristirma, ucakli-gecelik fiyat ayrimi, Google Hotels teklif baglantisi/tarih/total dogrulamasi, oturum dosyasi guvenligi ve collector eszamanlilik sinirini kapsar. 2 Ekim 2026 kontrolunde 60 test ve TypeScript denetimi gecti. Iki otel icin 16-21 ve 23-28 Ekim canli API testlerinde TUI/HolidayCheck toplam 6 oda fiyati verdi (her tarih araliginda); TUI Queen icin teklif yok, Booking yonlendirme, Expedia erisim dogrulamasi dondu. Bunlar tum kanallarda basari anlami tasimaz.

Son eklenen kontroller pazar yonlendirmesini, secilen kanallarin korunmasini, yinelenen islerin engellenmesini, Queen GBP referans guvenligini ve hata etiketlerini kapsar. Toplam 70 test ve TypeScript denetimi gecti. 2 Ekim 2026 tarihinde yedi kanalin iki otelde 16-21 Ekim canli API testi: 28 oda/kanal hucresinin 6'sinda otomatik fiyat, 0 elle kayit. TUI Beach 1502/1610 EUR; HolidayCheck Beach 1458/1566 EUR, Queen 1612.80/1279.88 EUR. TUI Queen teklif dondurmedi; Booking bolgesel yonlendirme, Expedia/Loveholidays dogrulama, Hotelbeds eksik ayar, On the Beach CAPTCHA/form zaman asimi verdi. Google ek kaynagi bu calistirmada dogrulanmis fiyat vermedi. Arayuzden tekrarlanan canli sorgu da 6 fiyat verdi; Queen HolidayCheck deniz manzarasi o sorguda 1278 EUR idi. Secim hatasi giderildi; tum kanallardan otomatik fiyat alma henuz tamamlanmadi.

Uygulama calisirken `npm run benchmark:live-smoke` bugunden 7 gun sonrasi icin TUI ve HolidayCheck'i iki otelde test eder. Ozel sorgu: `npm run benchmark:live-smoke -- 2026-10-16 2026-10-21 onthebeach beach-uk` (gelecek tarih secin). Test sunucusunu `BENCHMARK_BASE_URL` ile degistirebilirsiniz. Script her hucrede fiyat/durum/neden, kaynak yontemi ve kontrol zamanini, alternatif sayisini ve her pencerenin ilk 6 alternatifini, ayrica HolidayCheck ek kaynak tekliflerini yazar. Otomatik oda fiyati, dogrulanmis alternatif ve ek kaynak teklifi ucu de yoksa cikis kodu 1 olur; elle girilmis kayitlar basari sayilmaz. Cikis kodu 0 tum kanallarin basarili veya dogrudan erisilebilir oldugu anlamina gelmez.
