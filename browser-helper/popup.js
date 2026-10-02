const readButton = document.getElementById("read");
const status = document.getElementById("status");
const preview = document.getElementById("preview");
const hotel = document.getElementById("hotel");
const summary = document.getElementById("summary");
let captures = [];
function showSelected() {
  const capture = captures[Number(hotel.value)];
  if (!capture) return;
  const s = capture.snapshot;
  summary.textContent = [
    s.hotelName,
    capture.providerKey,
    s.checkInLabel,
    s.returnLabel || s.nightsLabel,
    s.occupancyLabel ||
      `${s.rooms} oda / ${s.adults} yetiskin / ${s.children} cocuk / ${s.infants} bebek`,
    `${s.offers.length} yuklenmis teklif`,
    ...s.offers
      .slice(0, 3)
      .map((offer) => `${offer.name || offer.roomName}: ${offer.priceText}`),
    "Yalnizca yuklenmis oda secenekleri aktarilir.",
  ].join("\n");
}
hotel.addEventListener("change", showSelected);
readButton.addEventListener("click", async () => {
  readButton.disabled = true;
  preview.hidden = true;
  captures = [];
  status.textContent = "Sayfa okunuyor...";
  try {
    if (!globalThis.chrome?.scripting)
      throw new Error(
        "Yardimciyi Chrome/Edge uzantisi olarak yukleyin; normal web sayfasinda calismaz.",
      );
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (
      !tab?.id ||
      !/^https:\/\/www\.(loveholidays\.com|onthebeach\.co\.uk)\//.test(
        tab.url || "",
      )
    )
      throw new Error("Once desteklenen OTA sekmesine gecin.");
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["capture.js"],
    });
    captures = injection?.result;
    if (!Array.isArray(captures) || !captures.length)
      throw new Error(
        "Sayfa okunamadi. Hotel Only ve fiyat alanlarini kontrol edin.",
      );
    hotel.replaceChildren(
      ...captures.map((capture, index) => {
        const option = document.createElement("option");
        option.value = String(index);
        option.textContent = capture.snapshot.hotelName;
        return option;
      }),
    );
    showSelected();
    preview.hidden = false;
    status.textContent =
      "Okundu. Tarih, kisi ve oteli kontrol ettikten sonra indirin.";
  } catch (error) {
    status.textContent = error.message || "Sayfa okunamadi.";
  } finally {
    readButton.disabled = false;
  }
});
document.getElementById("download").addEventListener("click", () => {
  const capture = captures[Number(hotel.value)];
  if (!capture) return;
  if (Date.now() - Date.parse(capture.observedAt) >= 30 * 60 * 1000) {
    status.textContent = "Kayit eskidi. OTA sayfasini yenileyip tekrar okuyun.";
    return;
  }
  const blob = new Blob([JSON.stringify(capture, null, 2)], {
    type: "application/json",
  });
  if (blob.size > 250 * 1024) {
    status.textContent = "Dosya cok buyuk.";
    return;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `dgtlface-${capture.providerKey}-${capture.snapshot.hotelName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  status.textContent =
    "Indirme baslatildi. Benchmark panelindeki Tarayicidan aktar alanini kullanin.";
});
