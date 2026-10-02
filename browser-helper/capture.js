// Executed once, in Chrome's isolated world, only after the user presses Read.
(() => {
  const visible = (el) =>
    !!el &&
    !el.closest('[hidden], [aria-hidden="true"]') &&
    el.getClientRects().length > 0 &&
    getComputedStyle(el).visibility !== "hidden";
  const read = (el) =>
    visible(el) ? el.innerText.replace(/\s+/g, " ").trim() : "";
  const all = (selector, root = document) =>
    [...root.querySelectorAll(selector)].filter(visible);
  const buttons = () => all('button, [role="button"]');
  const byLabel = (regex) =>
    buttons().find((el) => regex.test(el.getAttribute("aria-label") || ""));
  const supportedHotel = (name) =>
    /^(Miramare Beach|Miramare Queen)$/i.test(name);
  const source = new URL(location.href);
  if (source.protocol !== "https:" || source.username || source.password)
    throw new Error("Yalnizca guvenli OTA otel sayfalari desteklenir.");
  if (
    all(
      'iframe[src*="captcha"], iframe[title="Verification system"], iframe[title="Device check"]',
    ).length
  )
    throw new Error(
      "Site dogrulamasi acik. Yardimci CAPTCHA cozmez; once kendiniz tamamlayin.",
    );
  const cleanUrl = (keys) => {
    const url = new URL(source.origin + source.pathname);
    for (const key of keys) {
      if (source.searchParams.getAll(key).length > 1)
        throw new Error("Belirsiz arama parametresi.");
      if (source.searchParams.has(key))
        url.searchParams.set(key, source.searchParams.get(key));
    }
    return url.href;
  };
  const envelope = (providerKey, snapshot) => {
    if (!snapshot.offers.length)
      throw new Error(
        "Oda toplam fiyatlari henuz yuklenmedi. Fiyatlari acip tekrar deneyin.",
      );
    if (snapshot.offers.length > 200)
      throw new Error("En fazla 200 teklif aktarilabilir.");
    return {
      format: "dgtlface-ota-capture",
      version: 1,
      providerKey,
      observedAt: new Date().toISOString(),
      snapshot,
    };
  };
  if (
    source.hostname === "www.loveholidays.com" &&
    /^\/(de\/)?hotels\/l\/$/.test(source.pathname)
  ) {
    const heading = all("h1, h2, h3").find((el) => supportedHotel(read(el)));
    const cards = all('[role="button"][aria-label]').filter((el) =>
      /^(Room option|Zimmeroption) \d/.test(el.getAttribute("aria-label")),
    );
    const offers = cards.flatMap((card) => {
      const regions = all(
        '[role="region"][aria-label="Room price information"], [role="region"][aria-label="Zimmerpreisinformationen"]',
        card,
      );
      const priceText = read(regions.at(-1));
      const name = read(card.querySelector("h3"));
      return name && priceText
        ? [{ name, priceText, description: read(card).slice(0, 2000) }]
        : [];
    });
    const snapshot = {
      url: cleanUrl(["masterId", "nights", "rooms", "date"]),
      hotelName: read(heading),
      checkInLabel: read(byLabel(/^(Check-in date|Check-in Datum)$/)),
      nightsLabel: read(byLabel(/^(How long|Wie lange)$/)),
      occupancyLabel: read(
        buttons().find(
          (el) =>
            /^(Room\(s\)|Zimmer)$/.test(el.getAttribute("aria-label") || "") &&
            /Adults|Erw\./.test(read(el)),
        ),
      ),
      offers,
    };
    if (
      !snapshot.hotelName ||
      !snapshot.checkInLabel ||
      !snapshot.nightsLabel ||
      !snapshot.occupancyLabel
    )
      throw new Error(
        "Otel, tarih veya kisi secimi okunamadi. Hotel Only ekranini acin.",
      );
    return [envelope("loveholidays", snapshot)];
  }
  if (
    source.hostname === "www.onthebeach.co.uk" &&
    /^\/hotel_searches\/show\/\d+\/?$/.test(source.pathname)
  ) {
    const number = (field) => {
      const el = document.querySelector(`select[name="search[${field}]"]`);
      return el && /^\d+$/.test(el.value) ? Number(el.value) : null;
    };
    const checkInLabel = read(
      buttons().find((el) => /^Check-in Date/.test(read(el))),
    );
    const returnElement = all("span, div, p").find((el) =>
      /^Return \d{1,2} [A-Za-z]{3,4} \d{4}$/.test(read(el)),
    );
    const captures = [];
    for (const card of all(".hotel-result")) {
      const hotelName = read(card.querySelector("h3"));
      if (!supportedHotel(hotelName)) continue;
      const totalSelected =
        card.querySelector('input[type="checkbox"][name="price[toggle]"]')
          ?.checked === true;
      if (!totalSelected) continue;
      const offers = all(".board-option", card).flatMap((row) => {
        const title = row.querySelector(".board-option__title");
        const board = read(title?.querySelector("strong"));
        const roomName = read(title).replace(board, "").trim();
        const priceText = read(row.querySelector(".board-option__price"));
        return roomName && priceText
          ? [{ roomName, board: board || "Belirtilmedi", priceText }]
          : [];
      });
      captures.push(
        envelope("onthebeach", {
          sourceUrl: cleanUrl([
            "filters[hotel_name]",
            "ordering",
            "pagination[page]",
          ]),
          hotelName,
          checkInLabel,
          returnLabel: read(returnElement),
          nights: number("nights"),
          adults: number("adults"),
          children: number("children"),
          infants: number("infants"),
          rooms: number("number_of_rooms"),
          totalSelected,
          offers,
        }),
      );
    }
    if (!captures.length)
      throw new Error(
        "Miramare otelini bulun, Total Hotel Price secin ve oda seceneklerini acin.",
      );
    return captures;
  }
  throw new Error(
    "Bu sayfa desteklenmiyor. Loveholidays Hotel Only veya On the Beach Hotel Only arama sonucunu acin.",
  );
})();
