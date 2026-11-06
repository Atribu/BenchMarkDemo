"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { ProviderDescriptor } from "@/src/lib/benchmark/types";
import type {
  HotelChannelMappingRecord,
  HotelChannelMappingStatus,
  ManagedHotelRecord,
} from "@/src/lib/hotels/model";
import type { HotelLifecycleStatus } from "@/src/lib/hotels/lifecycle";
import { DYNAMIC_COLLECTOR_PROVIDERS } from "@/src/lib/hotels/runtime-manifest";

interface HotelManagementProps {
  providerCatalog: ProviderDescriptor[];
}

type ApiResult = { hotel?: ManagedHotelRecord; hotels?: ManagedHotelRecord[]; error?: string };

const STATUS_LABELS: Record<HotelLifecycleStatus, string> = {
  draft: "Taslak",
  ready: "Hazır",
  active: "Aktif",
  archived: "Arşivlenmiş",
};

const MAPPING_STATUS_LABELS: Record<HotelChannelMappingStatus, string> = {
  draft: "Kontrol bekliyor",
  verified: "Doğrulandı",
  disabled: "Devre dışı",
};

const VIEW_OPTIONS = [
  ["land", "Kara manzarası"],
  ["garden", "Bahçe manzarası"],
  ["sea", "Deniz manzarası"],
  ["partial-sea", "Yandan deniz manzarası"],
] as const;

function field(form: FormData, name: string): string {
  return String(form.get(name) ?? "").trim();
}

function slugify(value: string): string {
  return value
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function configurationSteps(hotel: ManagedHotelRecord) {
  const hasAliases = hotel.channelMappings.some(
    (mapping) => Object.keys(mapping.roomAliases).length > 0,
  );
  return [
    { label: "Temel bilgiler", done: true },
    { label: "Pazar", done: hotel.markets.length > 0 },
    { label: "Oda tipleri", done: hotel.rooms.length > 0 },
    { label: "Oda politikası", done: Boolean(hotel.matchingPolicy) },
    { label: "OTA kanalları", done: hotel.channelMappings.length > 0 && hasAliases },
  ];
}

export function HotelManagement({ providerCatalog }: HotelManagementProps) {
  const [hotels, setHotels] = useState<ManagedHotelRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editingMappingId, setEditingMappingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  const selected = useMemo(
    () => hotels.find((hotel) => hotel.id === selectedId) ?? null,
    [hotels, selectedId],
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/hotels?includeArchived=true", { cache: "no-store" });
        const result = (await response.json()) as ApiResult;
        if (!response.ok) throw new Error(result.error ?? "Oteller yüklenemedi.");
        if (!active) return;
        const records = result.hotels ?? [];
        setHotels(records);
        setSelectedId(records.find((hotel) => hotel.source === "user")?.id ?? records[0]?.id ?? "");
      } catch (error) {
        if (active)
          setNotice({ type: "error", text: error instanceof Error ? error.message : "Oteller yüklenemedi." });
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  function applyHotel(hotel: ManagedHotelRecord) {
    setHotels((current) => {
      const exists = current.some((item) => item.id === hotel.id);
      return exists
        ? current.map((item) => (item.id === hotel.id ? hotel : item))
        : [...current, hotel];
    });
    setSelectedId(hotel.id);
  }

  async function request(
    url: string,
    method: "POST" | "PUT" | "PATCH" | "DELETE",
    payload: unknown,
    success: string,
  ) {
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as ApiResult;
      if (!response.ok || !result.hotel)
        throw new Error(result.error ?? "İşlem tamamlanamadı.");
      applyHotel(result.hotel);
      setNotice({ type: "ok", text: success });
      return true;
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "İşlem tamamlanamadı." });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function createHotel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const data = new FormData(formElement);
    const name = field(data, "name");
    const ok = await request(
      "/api/hotels",
      "POST",
      {
        key: field(data, "key") || slugify(name),
        name,
        shortCode: field(data, "shortCode"),
        location: {
          countryCode: field(data, "countryCode"),
          city: field(data, "city"),
          region: field(data, "region") || undefined,
          address: field(data, "address") || undefined,
        },
        websiteUrl: field(data, "websiteUrl") || undefined,
      },
      "Otel güvenli bir taslak olarak oluşturuldu.",
    );
    if (ok) formElement.reset();
  }

  async function addMarket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const formElement = event.currentTarget;
    const data = new FormData(formElement);
    const ok = await request(
      `/api/hotels/${selected.id}/markets`,
      "POST",
      {
        version: selected.version,
        id: field(data, "id"),
        label: field(data, "label"),
        marketLabel: field(data, "marketLabel"),
        currency: field(data, "currency"),
        requiredBoard: field(data, "requiredBoard") || undefined,
        notes: field(data, "notes") || undefined,
      },
      "Pazar tanımı eklendi.",
    );
    if (ok) formElement.reset();
  }

  async function addRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const formElement = event.currentTarget;
    const data = new FormData(formElement);
    const ok = await request(
      `/api/hotels/${selected.id}/rooms`,
      "POST",
      {
        version: selected.version,
        id: field(data, "id"),
        name: field(data, "name"),
        occupancy: {
          rooms: Number(field(data, "rooms")),
          adults: Number(field(data, "adults")),
          children: Number(field(data, "children")),
        },
      },
      "Oda tipi eklendi.",
    );
    if (ok) formElement.reset();
  }

  async function savePolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const data = new FormData(event.currentTarget);
    const roomByView = Object.fromEntries(
      VIEW_OPTIONS.map(([view]) => [view, field(data, view)]).filter(([, roomId]) => roomId),
    );
    await request(
      `/api/hotels/${selected.id}/matching-policy`,
      "PUT",
      {
        version: selected.version,
        category: field(data, "category"),
        requireBalcony: data.get("requireBalcony") === "on",
        roomByView,
      },
      "Oda eşleştirme politikası kaydedildi; kanal doğrulamaları yeniden kontrol edilecek.",
    );
  }

  async function addMapping(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const formElement = event.currentTarget;
    const data = new FormData(formElement);
    const roomAliases = Object.fromEntries(
      selected.rooms
        .map((room) => [
          room.id,
          field(data, `alias:${room.id}`)
            .split(/[\n,]/)
            .map((alias) => alias.trim())
            .filter(Boolean),
        ] as const)
        .filter(([, aliases]) => aliases.length > 0),
    );
    const ok = await request(
      `/api/hotels/${selected.id}/channel-mappings`,
      "POST",
      {
        version: selected.version,
        providerKey: field(data, "providerKey"),
        marketId: field(data, "marketId"),
        externalHotelId: field(data, "externalHotelId") || undefined,
        pageUrl: field(data, "pageUrl") || undefined,
        searchName: field(data, "searchName") || undefined,
        roomAliases,
      },
      "OTA kanal eşleştirmesi taslak olarak eklendi.",
    );
    if (ok) formElement.reset();
  }

  function mappingAliases(
    data: FormData,
    rooms: ManagedHotelRecord["rooms"],
  ) {
    return Object.fromEntries(
      rooms
        .map((room) => [
          room.id,
          field(data, `alias:${room.id}`)
            .split(/[\n,]/)
            .map((alias) => alias.trim())
            .filter(Boolean),
        ] as const)
        .filter(([, aliases]) => aliases.length > 0),
    );
  }

  async function updateMapping(
    event: FormEvent<HTMLFormElement>,
    mapping: HotelChannelMappingRecord,
  ) {
    event.preventDefault();
    if (!selected) return;
    const data = new FormData(event.currentTarget);
    const ok = await request(
      `/api/hotels/${selected.id}/channel-mappings/${mapping.id}`,
      "PATCH",
      {
        version: selected.version,
        externalHotelId: field(data, "externalHotelId") || null,
        pageUrl: field(data, "pageUrl") || null,
        searchName: field(data, "searchName") || null,
        roomAliases: mappingAliases(data, selected.rooms),
      },
      "OTA kanal eşleştirmesi güncellendi; doğrulama durumu yeniden kontrol bekliyor.",
    );
    if (ok) setEditingMappingId(null);
  }

  async function setMappingStatus(mappingId: string, status: HotelChannelMappingStatus) {
    if (!selected) return;
    await request(
      `/api/hotels/${selected.id}/channel-mappings/${mappingId}/status`,
      "PATCH",
      { version: selected.version, status },
      status === "verified" ? "OTA eşleştirmesi doğrulandı." : "OTA eşleştirme durumu güncellendi.",
    );
  }

  async function setHotelStatus(status: HotelLifecycleStatus) {
    if (!selected) return;
    await request(
      `/api/hotels/${selected.id}/status`,
      "PATCH",
      { version: selected.version, status },
      `Otel durumu ${STATUS_LABELS[status]} olarak güncellendi.`,
    );
  }

  const userHotels = hotels.filter((hotel) => hotel.source === "user");
  const systemHotels = hotels.filter((hotel) => hotel.source === "system");
  const editable = selected?.source === "user" && selected.status === "draft";
  const steps = selected ? configurationSteps(selected) : [];

  return (
    <section className="pageEnter hotelManager">
      <div className="hotelManagerIntro">
        <div>
          <p className="eyebrow">HOTEL ONBOARDING</p>
          <h1>Yeni oteli ekleyin.<br /><span>Mevcut yapıyı koruyun.</span></h1>
          <p className="pageLead">
            Kayıtlar önce taslakta hazırlanır. Sistem otelleri salt okunurdur; yeni otel yalnızca collector yapılandırması doğrulanıp aktifleştirildikten sonra canlı benchmark listesine eklenir.
          </p>
        </div>
        <div className="isolationNote">
          <strong>İzole yapılandırma</strong>
          <span>Kullanıcı otelleri ayrı kayıt deposunda tutulur.</span>
        </div>
      </div>

      {notice && <div className={`managerNotice ${notice.type}`} role="status">{notice.text}</div>}

      <div className="hotelManagerGrid">
        <aside className="hotelDirectory">
          <div className="managerCardHeading">
            <div><span className="stepKicker">OTELLER</span><h2>Portföy kayıtları</h2></div>
            <span className="recordCount">{hotels.length}</span>
          </div>
          {loading ? (
            <p className="managerEmpty">Kayıtlar yükleniyor…</p>
          ) : (
            <>
              <p className="directoryGroup">Kullanıcı otelleri</p>
              {userHotels.length === 0 && <p className="managerEmpty">Henüz kullanıcı oteli yok.</p>}
              {userHotels.map((hotel) => (
                <button key={hotel.id} className={`hotelDirectoryItem ${selectedId === hotel.id ? "active" : ""}`} onClick={() => setSelectedId(hotel.id)}>
                  <span className="directoryMonogram">{hotel.shortCode}</span>
                  <span><strong>{hotel.name}</strong><small>{hotel.location.city} · {STATUS_LABELS[hotel.status]}</small></span>
                </button>
              ))}
              <p className="directoryGroup systemGroup">Sistem otelleri · salt okunur</p>
              {systemHotels.map((hotel) => (
                <button key={hotel.id} className={`hotelDirectoryItem system ${selectedId === hotel.id ? "active" : ""}`} onClick={() => setSelectedId(hotel.id)}>
                  <span className="directoryMonogram">{hotel.shortCode}</span>
                  <span><strong>{hotel.name}</strong><small>{hotel.location.city} · Korunan kayıt</small></span>
                </button>
              ))}
            </>
          )}
        </aside>

        <div className="hotelManagerContent">
          <details className="managerCard createHotelCard" open={userHotels.length === 0}>
            <summary><span><span className="stepNumber">+</span><strong>Yeni otel taslağı oluştur</strong></span><small>Temel bilgiler</small></summary>
            <form className="managerForm" onSubmit={createHotel}>
              <div className="formGrid formGridThree">
                <label><span>Otel adı</span><input name="name" required minLength={2} placeholder="Örn. Marina Resort" /></label>
                <label><span>Otel anahtarı</span><input name="key" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="marina-resort (otomatik olabilir)" /></label>
                <label><span>Kısa kod</span><input name="shortCode" required minLength={2} maxLength={5} placeholder="MR" /></label>
                <label><span>Ülke kodu</span><input name="countryCode" required minLength={2} maxLength={2} defaultValue="TR" /></label>
                <label><span>Şehir</span><input name="city" required minLength={2} placeholder="Antalya" /></label>
                <label><span>Bölge</span><input name="region" placeholder="Side" /></label>
              </div>
              <div className="formGrid formGridTwo">
                <label><span>Adres <small>isteğe bağlı</small></span><input name="address" /></label>
                <label><span>Web sitesi <small>HTTPS</small></span><input name="websiteUrl" type="url" placeholder="https://…" /></label>
              </div>
              <div className="formActions"><button className="managerPrimary" disabled={busy}>Taslak oluştur</button></div>
            </form>
          </details>

          {selected && (
            <>
              <section className="managerCard selectedHotelHeader">
                <div className="selectedHotelTitle">
                  <span className="selectedMonogram">{selected.shortCode}</span>
                  <div><span className="stepKicker">{selected.source === "system" ? "SİSTEM KAYDI" : "KULLANICI OTELİ"}</span><h2>{selected.name}</h2><p>{selected.location.city}{selected.location.region ? ` / ${selected.location.region}` : ""} · v{selected.version}</p></div>
                </div>
                <span className={`hotelStatusBadge ${selected.status}`}>{STATUS_LABELS[selected.status]}</span>
                {selected.source === "user" && (
                  <div className="setupProgress" aria-label="Kurulum ilerlemesi">
                    {steps.map((step, index) => <span key={step.label} className={step.done ? "done" : ""}><b>{step.done ? "✓" : index + 1}</b>{step.label}</span>)}
                  </div>
                )}
              </section>

              {selected.source === "system" ? (
                <section className="managerCard protectedRecord">
                  <strong>Bu kayıt korunuyor.</strong>
                  <p>Mevcut benchmark otellerinin pazar, oda ve kanal yapılandırmaları bu ekrandan değiştirilemez. Yeni otel akışı bu kayıtların hiçbirini güncellemez.</p>
                </section>
              ) : (
                <>
                  {selected.status !== "draft" && <div className="managerNotice neutral">Yapılandırmayı değiştirmek için oteli yeniden Taslak durumuna alın.</div>}

                  <section className="managerCard setupSection">
                    <div className="managerCardHeading"><div><span className="stepKicker">01 / PAZAR</span><h2>Satış pazarı</h2></div><span className="recordCount">{selected.markets.length}</span></div>
                    <div className="recordList">
                      {selected.markets.map((market) => <div className="recordRow" key={market.id}><div><strong>{market.label}</strong><small>{market.id} · {market.marketLabel}</small></div><span>{market.currency}{market.requiredBoard ? ` · ${market.requiredBoard === "all-inclusive-plus" ? "AI+" : "AI"}` : ""}</span></div>)}
                    </div>
                    <form className="managerForm compactForm" onSubmit={addMarket}>
                      <div className="formGrid formGridThree">
                        <label><span>Pazar anahtarı</span><input name="id" required placeholder="marina-eu" disabled={!editable} /></label>
                        <label><span>Pazar adı</span><input name="label" required placeholder="Marina Resort Avrupa" disabled={!editable} /></label>
                        <label><span>Etiket</span><input name="marketLabel" required placeholder="Avrupa" disabled={!editable} /></label>
                        <label><span>Para birimi</span><select name="currency" defaultValue="EUR" disabled={!editable}><option>EUR</option><option>GBP</option><option>RUB</option></select></label>
                        <label><span>Pansiyon</span><select name="requiredBoard" defaultValue="all-inclusive" disabled={!editable}><option value="">Zorunlu değil</option><option value="all-inclusive">Her şey dahil</option><option value="all-inclusive-plus">Her şey dahil plus</option></select></label>
                        <label><span>Not</span><input name="notes" disabled={!editable} /></label>
                      </div>
                      <div className="formActions"><button className="managerSecondary" disabled={!editable || busy}>Pazar ekle</button></div>
                    </form>
                  </section>

                  <section className="managerCard setupSection">
                    <div className="managerCardHeading"><div><span className="stepKicker">02 / ODA</span><h2>Dinamik oda tipleri</h2></div><span className="recordCount">{selected.rooms.length}</span></div>
                    <div className="recordList">
                      {selected.rooms.map((room) => <div className="recordRow" key={room.id}><div><strong>{room.name}</strong><small>{room.id}</small></div><span>{room.occupancy.rooms} oda · {room.occupancy.adults} yetişkin · {room.occupancy.children} çocuk</span></div>)}
                    </div>
                    <form className="managerForm compactForm" onSubmit={addRoom}>
                      <div className="formGrid formGridThree">
                        <label><span>Oda anahtarı</span><input name="id" required placeholder="standard-sea" disabled={!editable} /></label>
                        <label className="spanTwo"><span>Oda adı</span><input name="name" required placeholder="Standard Deniz Manzaralı" disabled={!editable} /></label>
                        <label><span>Oda</span><input name="rooms" type="number" min="1" max="10" defaultValue="1" required disabled={!editable} /></label>
                        <label><span>Yetişkin</span><input name="adults" type="number" min="1" max="20" defaultValue="2" required disabled={!editable} /></label>
                        <label><span>Çocuk</span><input name="children" type="number" min="0" max="20" defaultValue="0" required disabled={!editable} /></label>
                      </div>
                      <div className="formActions"><button className="managerSecondary" disabled={!editable || busy}>Oda tipi ekle</button></div>
                    </form>
                  </section>

                  <section className="managerCard setupSection">
                    <div className="managerCardHeading"><div><span className="stepKicker">03 / EŞLEŞTİRME</span><h2>Oda eşleştirme politikası</h2></div>{selected.matchingPolicy && <span className="configuredBadge">Yapılandırıldı</span>}</div>
                    <form className="managerForm compactForm" onSubmit={savePolicy}>
                      <div className="formGrid formGridThree">
                        <label><span>Kategori</span><select name="category" defaultValue={selected.matchingPolicy?.category ?? "standard"} disabled={!editable}><option value="standard">Standard</option><option value="superior">Superior</option></select></label>
                        <label className="checkField"><input type="checkbox" name="requireBalcony" defaultChecked={selected.matchingPolicy?.requireBalcony} disabled={!editable} /><span>Balkon zorunlu</span></label>
                      </div>
                      <div className="formGrid formGridTwo policyViews">
                        {VIEW_OPTIONS.map(([view, label]) => <label key={view}><span>{label}</span><select name={view} defaultValue={selected.matchingPolicy?.roomByView[view] ?? ""} disabled={!editable}><option value="">Kapsam dışında</option>{selected.rooms.map((room) => <option value={room.id} key={room.id}>{room.name}</option>)}</select></label>)}
                      </div>
                      <div className="formActions"><button className="managerSecondary" disabled={!editable || busy || selected.rooms.length === 0}>Politikayı kaydet</button></div>
                    </form>
                  </section>

                  <section className="managerCard setupSection">
                    <div className="managerCardHeading"><div><span className="stepKicker">04 / OTA</span><h2>Kanal eşleştirmeleri</h2></div><span className="recordCount">{selected.channelMappings.length}</span></div>
                    <div className="mappingList">
                      {selected.channelMappings.map((mapping) => {
                        const provider = providerCatalog.find((item) => item.key === mapping.providerKey);
                        const isEditing = editingMappingId === mapping.id;
                        return <article className={`mappingCard ${isEditing ? "editing" : ""}`} key={mapping.id}>
                          <div><span className="providerLetter">{provider?.shortName.slice(0, 1) ?? "?"}</span><div><strong>{provider?.name ?? mapping.providerKey}</strong><small>{selected.markets.find((market) => market.id === mapping.marketId)?.label ?? mapping.marketId} · {Object.keys(mapping.roomAliases).length} oda alias grubu</small></div></div>
                          <span className={`mappingStatus ${mapping.status}`}>{MAPPING_STATUS_LABELS[mapping.status]}{DYNAMIC_COLLECTOR_PROVIDERS.some((key) => key === mapping.providerKey) ? " · Collector destekli" : ""}</span>
                          {editable && <div className="mappingActions"><button type="button" aria-expanded={isEditing} onClick={() => setEditingMappingId(isEditing ? null : mapping.id)} disabled={busy}>{isEditing ? "Düzenlemeyi kapat" : "Düzenle"}</button><button type="button" onClick={() => setMappingStatus(mapping.id, "verified")} disabled={busy || mapping.status === "verified"}>Doğrula</button><button type="button" onClick={() => setMappingStatus(mapping.id, "disabled")} disabled={busy || mapping.status === "disabled"}>Devre dışı</button></div>}
                          {editable && isEditing && (
                            <form className="managerForm mappingEditForm" key={`${mapping.id}:${selected.version}`} onSubmit={(event) => updateMapping(event, mapping)}>
                              <div className="mappingEditHeading"><div><strong>{provider?.name ?? mapping.providerKey} eşlemesini düzenle</strong><small>OTA ve pazar değiştirilemez. Kimlik veya oda adları değişirse kanal yeniden doğrulanmalıdır.</small></div><button type="button" onClick={() => setEditingMappingId(null)} disabled={busy}>Kapat</button></div>
                              <div className="formGrid formGridThree">
                                <label><span>Harici otel kimliği</span><input name="externalHotelId" defaultValue={mapping.externalHotelId ?? ""} /></label>
                                <label><span>Kanal sayfa adresi</span><input name="pageUrl" type="url" defaultValue={mapping.pageUrl ?? ""} placeholder="https://…" /></label>
                                <label><span>Kanal arama adı</span><input name="searchName" defaultValue={mapping.searchName ?? ""} placeholder={selected.name} /></label>
                              </div>
                              {selected.rooms.length > 0 && <div className="aliasGrid"><p>OTA oda adları <small>Her oda için kanaldaki gerçek adları virgül veya yeni satırla ayırın.</small></p>{selected.rooms.map((room) => <label key={room.id}><span>{room.name}</span><textarea name={`alias:${room.id}`} rows={3} defaultValue={(mapping.roomAliases[room.id] ?? []).join("\n")} placeholder="Standard Sea View, Standard Room Sea" /></label>)}</div>}
                              <div className="formActions"><button type="button" className="managerSecondary" onClick={() => setEditingMappingId(null)} disabled={busy}>Vazgeç</button><button className="managerPrimary" disabled={busy}>Değişiklikleri kaydet</button></div>
                            </form>
                          )}
                        </article>;
                      })}
                    </div>
                    <form className="managerForm compactForm" onSubmit={addMapping}>
                      <div className="formGrid formGridThree">
                        <label><span>OTA kanalı</span><select name="providerKey" required disabled={!editable}><option value="">Kanal seçin</option>{providerCatalog.map((provider) => <option value={provider.key} key={provider.key}>{provider.name}{DYNAMIC_COLLECTOR_PROVIDERS.includes(provider.key as (typeof DYNAMIC_COLLECTOR_PROVIDERS)[number]) ? " · Dinamik destekli" : " · Yapılandırma kaydı"}</option>)}</select></label>
                        <label><span>Pazar</span><select name="marketId" required disabled={!editable}><option value="">Pazar seçin</option>{selected.markets.map((market) => <option value={market.id} key={market.id}>{market.label}</option>)}</select></label>
                        <label><span>Harici otel kimliği</span><input name="externalHotelId" disabled={!editable} /></label>
                        <label><span>Kanal sayfa adresi</span><input name="pageUrl" type="url" placeholder="https://…" disabled={!editable} /></label>
                        <label className="spanTwo"><span>Kanal arama adı</span><input name="searchName" placeholder={selected.name} disabled={!editable} /></label>
                      </div>
                      {selected.rooms.length > 0 && <div className="aliasGrid"><p>OTA oda adları <small>Virgül veya yeni satırla ayırın.</small></p>{selected.rooms.map((room) => <label key={room.id}><span>{room.name}</span><textarea name={`alias:${room.id}`} rows={2} placeholder="Standard Sea View, Standard Room Sea" disabled={!editable} /></label>)}</div>}
                      <div className="formActions"><button className="managerSecondary" disabled={!editable || busy || selected.markets.length === 0 || selected.rooms.length === 0}>Kanal eşleştirmesi ekle</button></div>
                    </form>
                  </section>

                  <section className="managerCard releaseCard">
                    <div><span className="stepKicker">05 / DURUM</span><h2>Kontrollü yayın akışı</h2><p>“Hazır”, yapılandırmanın tamamlandığını belirtir. Canlı benchmark’a otomatik dahil etmez.</p></div>
                    <div className="releaseActions">
                      {selected.status === "draft" && <><button className="managerPrimary" onClick={() => setHotelStatus("ready")} disabled={busy}>Hazıra al</button><button className="managerDanger" onClick={() => setHotelStatus("archived")} disabled={busy}>Arşivle</button></>}
                      {selected.status === "ready" && <><button className="managerPrimary" onClick={() => setHotelStatus("active")} disabled={busy}>Doğrula ve aktifleştir</button><button className="managerSecondary" onClick={() => setHotelStatus("draft")} disabled={busy}>Taslağa dön</button><button className="managerDanger" onClick={() => setHotelStatus("archived")} disabled={busy}>Arşivle</button></>}
                      {selected.status === "active" && <><button className="managerSecondary" onClick={() => setHotelStatus("ready")} disabled={busy}>Hazıra çek</button><button className="managerDanger" onClick={() => setHotelStatus("archived")} disabled={busy}>Arşivle</button></>}
                      {selected.status === "archived" && <button className="managerSecondary" onClick={() => setHotelStatus("draft")} disabled={busy}>Taslak olarak geri aç</button>}
                    </div>
                      {selected.status === "ready" && <div className="runtimeGuard"><strong>Collector doğrulaması zorunlu</strong><span>Aktivasyon için her pazarda ANEX Tour (EUR/RUB), Booking.com, CHECK24 (EUR), Coral Travel (EUR/RUB), Expedia, HolidayCheck, Loveholidays (EUR/GBP), On the Beach (GBP/Antalya), PEGAS Touristik (RUB), Restplatzbörse (EUR), Schauinsland (EUR), Stayforlong (EUR) veya TUI (EUR) kanallarından en az birinin doğrulanmış sayfa adresi ve kapsamdaki tüm odaların alias kayıtları gerekir. Coral Travel için EUR pazarında sayısal GIATA, RUB pazarında `otel-7-bölge-6` biçimli konum kimliği; ANEX, CHECK24, Loveholidays, On the Beach, PEGAS, Restplatzbörse ve Stayforlong için ilgili sayısal kimlik; Schauinsland ve TUI için sayısal GIATA kimliği “Harici otel kimliği” alanına girilir. Eksik yapılandırma kapalı biçimde reddedilir.</span></div>}
                  </section>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
