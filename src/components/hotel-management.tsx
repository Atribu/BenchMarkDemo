"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { ProviderDescriptor } from "@/src/lib/benchmark/types";
import type {
  HotelChannelMappingRecord,
  HotelChannelMappingStatus,
  ManagedHotelRecord,
} from "@/src/lib/hotels/model";
import type { HotelLifecycleStatus } from "@/src/lib/hotels/lifecycle";
import { extractChannelPageInfo } from "@/src/lib/hotels/channel-page-info";
import { getChannelMarketEligibility } from "@/src/lib/hotels/channel-eligibility";

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
  configured: "Yapılandırma kontrol edildi",
  disabled: "Devre dışı",
};

const VIEW_OPTIONS = [
  ["land", "Kara manzarası"],
  ["garden", "Bahçe manzarası"],
  ["sea", "Deniz manzarası"],
  ["partial-sea", "Yandan deniz manzarası"],
] as const;

interface RoomDraft {
  id: string;
  name: string;
  rooms: number;
  adults: number;
  children: number;
}

const EMPTY_ROOM_DRAFT: RoomDraft = {
  id: "",
  name: "",
  rooms: 1,
  adults: 2,
  children: 0,
};

const ROOM_PRESETS: Array<RoomDraft & { label: string }> = [
  { label: "Kara manzaralı", id: "superior-land", name: "Superior Kara Manzaralı", rooms: 1, adults: 2, children: 0 },
  { label: "Deniz manzaralı", id: "superior-sea", name: "Superior Deniz Manzaralı", rooms: 1, adults: 2, children: 0 },
  { label: "Yandan deniz", id: "superior-partial-sea", name: "Superior Yandan Deniz Manzaralı", rooms: 1, adults: 2, children: 0 },
  { label: "Bahçe manzaralı", id: "superior-garden", name: "Superior Bahçe Manzaralı", rooms: 1, adults: 2, children: 0 },
  { label: "Aile odası", id: "family-room", name: "Aile Odası", rooms: 1, adults: 2, children: 2 },
];

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

function parseBulkRooms(value: string): RoomDraft[] {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 1 || lines.length > 20)
    throw new Error("Toplu ekleme alanına 1-20 oda satırı girin.");

  return lines.map((line, index) => {
    const parts = line.split("|").map((part) => part.trim());
    if (parts.length < 2 || parts.length > 5)
      throw new Error(`${index + 1}. satır “anahtar | oda adı | oda | yetişkin | çocuk” biçiminde olmalıdır.`);
    const [id, name, rooms = "1", adults = "2", children = "0"] = parts;
    const occupancy = [rooms, adults, children].map(Number);
    if (!id || !name || occupancy.some((number) => !Number.isSafeInteger(number)))
      throw new Error(`${index + 1}. satırdaki oda bilgileri geçersiz.`);
    return {
      id,
      name,
      rooms: occupancy[0],
      adults: occupancy[1],
      children: occupancy[2],
    };
  });
}

function configurationSteps(hotel: ManagedHotelRecord) {
  const hasAliases = hotel.channelMappings.some(
    (mapping) => Object.keys(mapping.roomAliases).length > 0,
  );
  return [
    { label: "Pazar", done: hotel.markets.length > 0 },
    { label: "Oda tipleri", done: hotel.rooms.length > 0 },
    { label: "Oda politikası", done: Boolean(hotel.matchingPolicy) },
    { label: "OTA kanalları", done: hotel.channelMappings.length > 0 && hasAliases },
    { label: "Yayın", done: hotel.status !== "draft" },
  ];
}

function setupStepIsUnlocked(steps: ReturnType<typeof configurationSteps>, index: number) {
  return index === 0 || steps.slice(0, index).every((step) => step.done);
}

interface ChannelIdentityFieldsProps {
  providerKey: string;
  hotelName: string;
  disabled?: boolean;
  defaultExternalHotelId?: string;
  defaultPageUrl?: string;
  defaultSearchName?: string;
}

function ChannelIdentityFields({
  providerKey,
  hotelName,
  disabled = false,
  defaultExternalHotelId = "",
  defaultPageUrl = "",
  defaultSearchName = "",
}: ChannelIdentityFieldsProps) {
  const [externalHotelId, setExternalHotelId] = useState(defaultExternalHotelId);
  const [pageUrl, setPageUrl] = useState(defaultPageUrl);
  const [searchName, setSearchName] = useState(defaultSearchName);
  const [analysis, setAnalysis] = useState<{
    type: "ok" | "neutral" | "error";
    text: string;
  } | null>(null);

  function inspectPageUrl() {
    if (!providerKey) {
      setAnalysis({ type: "error", text: "Önce OTA kanalını seçin." });
      return;
    }

    const result = extractChannelPageInfo(providerKey, pageUrl);
    if (result.externalHotelId) setExternalHotelId(result.externalHotelId);
    if (!searchName.trim()) setSearchName(hotelName);
    setAnalysis({
      type: result.externalHotelId ? "ok" : result.recognized ? "neutral" : "error",
      text: result.message,
    });
  }

  return (
    <>
      <label>
        <span>Harici otel kimliği</span>
        <input
          name="externalHotelId"
          value={externalHotelId}
          onChange={(event) => setExternalHotelId(event.target.value)}
          disabled={disabled}
        />
      </label>
      <label>
        <span>Kanal sayfa adresi</span>
        <input
          name="pageUrl"
          type="url"
          value={pageUrl}
          onChange={(event) => {
            setPageUrl(event.target.value);
            setAnalysis(null);
          }}
          placeholder="https://…"
          disabled={disabled}
        />
      </label>
      <label>
        <span>Kanal arama adı</span>
        <input
          name="searchName"
          value={searchName}
          onChange={(event) => setSearchName(event.target.value)}
          placeholder={hotelName}
          disabled={disabled}
        />
      </label>
      <div className="channelIdentityAssist">
        <button
          type="button"
          className="managerSecondary"
          onClick={inspectPageUrl}
          disabled={disabled || !pageUrl.trim()}
        >
          Adresten bilgileri al
        </button>
        {analysis && (
          <small className={`channelIdentityNotice ${analysis.type}`}>{analysis.text}</small>
        )}
      </div>
    </>
  );
}

interface MappingRoomAliasesProps {
  hotelId: string;
  mapping: HotelChannelMappingRecord;
  rooms: ManagedHotelRecord["rooms"];
  disabled?: boolean;
}

function MappingRoomAliases({
  hotelId,
  mapping,
  rooms,
  disabled = false,
}: MappingRoomAliasesProps) {
  const [aliases, setAliases] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      rooms.map((room) => [room.id, (mapping.roomAliases[room.id] ?? []).join("\n")]),
    ),
  );
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [discovering, setDiscovering] = useState(false);
  const [discoveryNotice, setDiscoveryNotice] = useState<{
    type: "ok" | "neutral" | "error";
    text: string;
  } | null>(null);
  const [unassigned, setUnassigned] = useState<string[]>([]);

  async function discover() {
    setDiscovering(true);
    setDiscoveryNotice(null);
    setUnassigned([]);
    try {
      const response = await fetch(
        `/api/hotels/${hotelId}/channel-mappings/${mapping.id}/room-suggestions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ checkIn, checkOut }),
        },
      );
      const result = await response.json() as {
        aliasesByRoom?: Record<string, string[]>;
        unassigned?: string[];
        warnings?: string[];
        error?: string;
      };
      if (!response.ok) throw new Error(result.error ?? "OTA oda adları alınamadı.");

      let added = 0;
      const nextAliases = { ...aliases };
      for (const room of rooms) {
        const existing = aliases[room.id]
          ?.split(/\r?\n/)
          .map((value) => value.trim())
          .filter(Boolean) ?? [];
        const merged = [...new Set([...existing, ...(result.aliasesByRoom?.[room.id] ?? [])])];
        added += merged.length - existing.length;
        nextAliases[room.id] = merged.join("\n");
      }
      setAliases(nextAliases);
      setUnassigned(result.unassigned ?? []);
      setDiscoveryNotice({
        type: added > 0 ? "ok" : "neutral",
        text: added > 0
          ? `${added} OTA oda adı ilgili alias alanlarına eklendi. Kontrol edip değişiklikleri kaydedin.`
          : result.unassigned?.length
            ? "Oda adları bulundu ancak güvenli biçimde eşleştirilemedi; inceleme listesine alındı."
            : result.warnings?.[0] ?? "Seçilen tarihler için doğrulanabilir OTA oda adı bulunamadı.",
      });
    } catch (error) {
      setDiscoveryNotice({
        type: "error",
        text: error instanceof Error ? error.message : "OTA oda adları alınamadı.",
      });
    } finally {
      setDiscovering(false);
    }
  }

  function assignUnmatched(name: string, roomId: string) {
    if (!roomId) return;
    setAliases((current) => {
      const existing = current[roomId]
        ?.split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean) ?? [];
      return {
        ...current,
        [roomId]: [...new Set([...existing, name])].join("\n"),
      };
    });
    setUnassigned((current) => current.filter((value) => value !== name));
  }

  return (
    <>
      <div className="roomAliasDiscovery">
        <div><strong>OTA oda adlarını otomatik topla</strong><small>Canlı kanal sorgusu yapar; bulunan adlar kaydetmeden önce incelemenize sunulur.</small></div>
        <label><span>Giriş</span><input type="date" value={checkIn} onChange={(event) => setCheckIn(event.target.value)} disabled={disabled || discovering} /></label>
        <label><span>Çıkış</span><input type="date" value={checkOut} onChange={(event) => setCheckOut(event.target.value)} disabled={disabled || discovering} /></label>
        <button type="button" className="managerSecondary" onClick={discover} disabled={disabled || discovering || !checkIn || !checkOut}>{discovering ? "Oda adları aranıyor…" : "OTA oda adlarını getir"}</button>
        {discoveryNotice && <p className={`roomDiscoveryNotice ${discoveryNotice.type}`}>{discoveryNotice.text}</p>}
        {unassigned.length > 0 && <div className="unassignedRooms"><span>İncelenecek adlar <small>Doğru odayı siz seçerseniz alias alanına eklenir.</small></span>{unassigned.map((name) => <div key={name}><small>{name}</small><select defaultValue="" onChange={(event) => assignUnmatched(name, event.target.value)} disabled={disabled || discovering}><option value="">Odaya ata…</option>{rooms.map((room) => <option value={room.id} key={room.id}>{room.name}</option>)}</select></div>)}</div>}
      </div>
      <div className="aliasGrid">
        <p>OTA oda adları <small>Otomatik bulunan adları doğrulayın; gerekirse düzenleyin veya silin.</small></p>
        {rooms.map((room) => <label key={room.id}><span>{room.name}</span><textarea name={`alias:${room.id}`} rows={3} value={aliases[room.id] ?? ""} onChange={(event) => setAliases((current) => ({ ...current, [room.id]: event.target.value }))} placeholder="Standard Sea View, Standard Room Sea" disabled={disabled || discovering} /></label>)}
      </div>
    </>
  );
}

export function HotelManagement({ providerCatalog }: HotelManagementProps) {
  const [hotels, setHotels] = useState<ManagedHotelRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editingMappingId, setEditingMappingId] = useState<string | null>(null);
  const [newMappingProviderKey, setNewMappingProviderKey] = useState("");
  const [newMappingMarketId, setNewMappingMarketId] = useState("");
  const [activeSetupStep, setActiveSetupStep] = useState(0);
  const [roomDraft, setRoomDraft] = useState<RoomDraft>(EMPTY_ROOM_DRAFT);
  const [bulkRooms, setBulkRooms] = useState("");
  const [notice, setNotice] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  const selected = useMemo(
    () => hotels.find((hotel) => hotel.id === selectedId) ?? null,
    [hotels, selectedId],
  );

  useEffect(() => {
    if (!selected || selected.source !== "user") return;
    const selectedSteps = configurationSteps(selected);
    const firstIncomplete = selectedSteps.findIndex((step) => !step.done);
    setActiveSetupStep(firstIncomplete === -1 ? selectedSteps.length - 1 : firstIncomplete);
    setEditingMappingId(null);
    setNewMappingProviderKey("");
    setNewMappingMarketId("");
    setRoomDraft(EMPTY_ROOM_DRAFT);
    setBulkRooms("");
  }, [selectedId]);

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

  async function addRoomsBulk(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    let rooms: RoomDraft[];
    try {
      rooms = parseBulkRooms(bulkRooms);
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "Toplu oda listesi geçersiz.",
      });
      return;
    }

    const ok = await request(
      `/api/hotels/${selected.id}/rooms`,
      "POST",
      {
        version: selected.version,
        rooms: rooms.map((room) => ({
          id: room.id,
          name: room.name,
          occupancy: {
            rooms: room.rooms,
            adults: room.adults,
            children: room.children,
          },
        })),
      },
      `${rooms.length} oda tipi tek işlemde eklendi.`,
    );
    if (ok) setBulkRooms("");
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
        id: field(data, "id") || slugify(field(data, "name")),
        name: field(data, "name"),
        occupancy: {
          rooms: Number(field(data, "rooms")),
          adults: Number(field(data, "adults")),
          children: Number(field(data, "children")),
        },
      },
      "Oda tipi eklendi.",
    );
    if (ok) {
      formElement.reset();
      setRoomDraft(EMPTY_ROOM_DRAFT);
    }
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
      "Oda eşleştirme politikası kaydedildi; kanal yapılandırmaları yeniden kontrol edilecek.",
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
    if (ok) {
      formElement.reset();
      setNewMappingProviderKey("");
      setNewMappingMarketId("");
    }
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
      "OTA kanal eşleştirmesi güncellendi; yapılandırma yeniden kontrol bekliyor.",
    );
    if (ok) setEditingMappingId(null);
  }

  async function setMappingStatus(mappingId: string, status: HotelChannelMappingStatus) {
    if (!selected) return;
    await request(
      `/api/hotels/${selected.id}/channel-mappings/${mappingId}/status`,
      "PATCH",
      { version: selected.version, status },
      status === "configured"
        ? "OTA eşleştirme yapılandırması kontrol edildi. Bu işlem canlı kanal erişimi kanıtı değildir."
        : "OTA eşleştirme durumu güncellendi.",
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
  const newMappingMarket = selected?.markets.find(
    (market) => market.id === newMappingMarketId,
  );

  return (
    <section className="pageEnter hotelManager">
      <div className="hotelManagerIntro">
        <div>
          <p className="eyebrow">HOTEL ONBOARDING</p>
          <h1>Yeni oteli ekleyin.<br /><span>Mevcut yapıyı koruyun.</span></h1>
          <p className="pageLead">
            Kayıtlar önce taslakta hazırlanır. Sistem otelleri salt okunurdur; yeni otel yalnızca collector yapılandırması kontrol edilip aktifleştirildikten sonra canlı benchmark listesine eklenir.
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
                  <div className="setupProgress" aria-label="Otel kurulum adımları">
                    {steps.map((step, index) => {
                      const unlocked = setupStepIsUnlocked(steps, index);
                      return (
                        <button
                          type="button"
                          key={step.label}
                          className={`${step.done ? "done" : ""} ${activeSetupStep === index ? "active" : ""}`}
                          onClick={() => setActiveSetupStep(index)}
                          disabled={!unlocked}
                          aria-current={activeSetupStep === index ? "step" : undefined}
                          title={unlocked ? step.label : "Önce önceki adımı tamamlayın"}
                        >
                          <b>{step.done ? "✓" : index + 1}</b>{step.label}
                        </button>
                      );
                    })}
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

                  {activeSetupStep === 0 && <section className="managerCard setupSection">
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
                  </section>}

                  {activeSetupStep === 1 && <section className="managerCard setupSection">
                    <div className="managerCardHeading"><div><span className="stepKicker">02 / ODA</span><h2>Dinamik oda tipleri</h2></div><span className="recordCount">{selected.rooms.length}</span></div>
                    <div className="recordList">
                      {selected.rooms.map((room) => <div className="recordRow" key={room.id}><div><strong>{room.name}</strong><small>{room.id}</small></div><span>{room.occupancy.rooms} oda · {room.occupancy.adults} yetişkin · {room.occupancy.children} çocuk</span></div>)}
                    </div>
                    <div className="roomPresetPanel">
                      <div><strong>Hızlı oda şablonları</strong><small>Şablonu seçin, gerekirse alanları düzenleyip ekleyin.</small></div>
                      <div className="roomPresetGrid">
                        {ROOM_PRESETS.map(({ label, ...preset }) => {
                          const alreadyAdded = selected.rooms.some((room) => room.id === preset.id);
                          return <button type="button" key={preset.id} onClick={() => setRoomDraft(preset)} disabled={!editable || busy || alreadyAdded}><span>{label}</span><small>{alreadyAdded ? "Eklendi" : `${preset.adults} yetişkin · ${preset.children} çocuk`}</small></button>;
                        })}
                      </div>
                    </div>
                    <form className="managerForm compactForm roomSingleForm" onSubmit={addRoom}>
                      <div className="formGrid formGridThree">
                        <label><span>Oda anahtarı <small>boşsa addan üretilir</small></span><input name="id" placeholder="standard-sea" value={roomDraft.id} onChange={(event) => setRoomDraft((current) => ({ ...current, id: event.target.value }))} disabled={!editable} /></label>
                        <label className="spanTwo"><span>Oda adı</span><input name="name" required placeholder="Standard Deniz Manzaralı" value={roomDraft.name} onChange={(event) => setRoomDraft((current) => ({ ...current, name: event.target.value }))} onBlur={() => setRoomDraft((current) => current.id ? current : { ...current, id: slugify(current.name) })} disabled={!editable} /></label>
                        <label><span>Oda</span><input name="rooms" type="number" min="1" max="10" value={roomDraft.rooms} onChange={(event) => setRoomDraft((current) => ({ ...current, rooms: Number(event.target.value) }))} required disabled={!editable} /></label>
                        <label><span>Yetişkin</span><input name="adults" type="number" min="1" max="20" value={roomDraft.adults} onChange={(event) => setRoomDraft((current) => ({ ...current, adults: Number(event.target.value) }))} required disabled={!editable} /></label>
                        <label><span>Çocuk</span><input name="children" type="number" min="0" max="20" value={roomDraft.children} onChange={(event) => setRoomDraft((current) => ({ ...current, children: Number(event.target.value) }))} required disabled={!editable} /></label>
                      </div>
                      <div className="formActions"><button className="managerSecondary" disabled={!editable || busy}>Oda tipi ekle</button></div>
                    </form>
                    <details className="roomBulkEntry">
                      <summary>Birden fazla odayı toplu ekle <small>En fazla 20 oda</small></summary>
                      <form className="managerForm roomBulkForm" onSubmit={addRoomsBulk}>
                        <label><span>Her satıra bir oda</span><textarea value={bulkRooms} onChange={(event) => setBulkRooms(event.target.value)} rows={5} placeholder={"superior-land | Superior Kara Manzaralı | 1 | 2 | 0\nsuperior-sea | Superior Deniz Manzaralı | 1 | 2 | 0"} disabled={!editable || busy} /></label>
                        <p>Biçim: oda anahtarı | oda adı | oda | yetişkin | çocuk. Son üç değer yazılmazsa 1 | 2 | 0 kullanılır.</p>
                        <div className="formActions"><button className="managerPrimary" disabled={!editable || busy || !bulkRooms.trim()}>Listedeki odaları ekle</button></div>
                      </form>
                    </details>
                  </section>}

                  {activeSetupStep === 2 && <section className="managerCard setupSection">
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
                  </section>}

                  {activeSetupStep === 3 && <section className="managerCard setupSection">
                    <div className="managerCardHeading"><div><span className="stepKicker">04 / OTA</span><h2>Kanal eşleştirmeleri</h2></div><span className="recordCount">{selected.channelMappings.length}</span></div>
                    <div className="mappingList">
                      {selected.channelMappings.map((mapping) => {
                        const provider = providerCatalog.find((item) => item.key === mapping.providerKey);
                        const mappingMarket = selected.markets.find((market) => market.id === mapping.marketId);
                        const eligibility = getChannelMarketEligibility(
                          mapping.providerKey,
                          mappingMarket?.currency,
                          selected.location,
                        );
                        const isEditing = editingMappingId === mapping.id;
                        return <article className={`mappingCard ${isEditing ? "editing" : ""}`} key={mapping.id}>
                          <div><span className="providerLetter">{provider?.shortName.slice(0, 1) ?? "?"}</span><div><strong>{provider?.name ?? mapping.providerKey}</strong><small>{selected.markets.find((market) => market.id === mapping.marketId)?.label ?? mapping.marketId} · {Object.keys(mapping.roomAliases).length} oda alias grubu</small></div></div>
                          <span className={`mappingStatus ${mapping.status} ${mapping.lastLiveCheckSucceeded === false ? "liveFailed" : ""} ${eligibility.eligible ? "eligible" : "ineligible"}`} title={eligibility.reason}>{mapping.lastLiveCheckSucceeded === false ? "Son canlı kontrol başarısız" : mapping.liveVerifiedAt ? "Canlı sorguda doğrulandı" : MAPPING_STATUS_LABELS[mapping.status]} · {eligibility.label}</span>
                          {editable && <div className="mappingActions"><button type="button" aria-expanded={isEditing} onClick={() => setEditingMappingId(isEditing ? null : mapping.id)} disabled={busy}>{isEditing ? "Düzenlemeyi kapat" : "Düzenle"}</button><button type="button" onClick={() => setMappingStatus(mapping.id, "configured")} disabled={busy || mapping.status === "configured"}>Yapılandırmayı kontrol et</button><button type="button" onClick={() => setMappingStatus(mapping.id, "disabled")} disabled={busy || mapping.status === "disabled"}>Devre dışı</button></div>}
                          {editable && isEditing && (
                            <form className="managerForm mappingEditForm" key={`${mapping.id}:${selected.version}`} onSubmit={(event) => updateMapping(event, mapping)}>
                              <div className="mappingEditHeading"><div><strong>{provider?.name ?? mapping.providerKey} eşlemesini düzenle</strong><small>OTA ve pazar değiştirilemez. Kimlik veya oda adları değişirse yapılandırma yeniden kontrol edilmelidir.</small></div><button type="button" onClick={() => setEditingMappingId(null)} disabled={busy}>Kapat</button></div>
                              <div className="formGrid formGridThree">
                                <ChannelIdentityFields
                                  providerKey={mapping.providerKey}
                                  hotelName={selected.name}
                                  defaultExternalHotelId={mapping.externalHotelId}
                                  defaultPageUrl={mapping.pageUrl}
                                  defaultSearchName={mapping.searchName}
                                  disabled={busy}
                                />
                              </div>
                              {selected.rooms.length > 0 && <MappingRoomAliases hotelId={selected.id} mapping={mapping} rooms={selected.rooms} disabled={busy} />}
                              <div className="formActions"><button type="button" className="managerSecondary" onClick={() => setEditingMappingId(null)} disabled={busy}>Vazgeç</button><button className="managerPrimary" disabled={busy}>Değişiklikleri kaydet</button></div>
                            </form>
                          )}
                        </article>;
                      })}
                    </div>
                    <form className="managerForm compactForm" onSubmit={addMapping}>
                      <div className="formGrid formGridThree">
                        <label><span>Pazar</span><select name="marketId" value={newMappingMarketId} onChange={(event) => { setNewMappingMarketId(event.target.value); setNewMappingProviderKey(""); }} required disabled={!editable}><option value="">Pazar seçin</option>{selected.markets.map((market) => <option value={market.id} key={market.id}>{market.label} · {market.currency}</option>)}</select></label>
                        <label><span>OTA kanalı</span><select name="providerKey" value={newMappingProviderKey} onChange={(event) => setNewMappingProviderKey(event.target.value)} required disabled={!editable || !newMappingMarket}><option value="">Kanal seçin</option>{providerCatalog.map((provider) => {
                          const providerEligibility = getChannelMarketEligibility(provider.key, newMappingMarket?.currency, selected.location);
                          const alreadyMapped = selected.channelMappings.some((mapping) => mapping.marketId === newMappingMarket?.id && mapping.providerKey === provider.key);
                          return <option value={provider.key} key={provider.key} disabled={!providerEligibility.eligible || alreadyMapped}>{provider.name} · {alreadyMapped ? "Zaten eklendi" : providerEligibility.label}</option>;
                        })}</select></label>
                        <span aria-hidden="true" />
                        <div className="channelEligibilityGrid">
                          <div className="channelEligibilityHeading"><strong>Kanal uygunluğu</strong><small>{newMappingMarket ? `${newMappingMarket.label} · ${newMappingMarket.currency}` : "Önce pazarı seçin"}</small></div>
                          {providerCatalog.map((provider) => {
                            const providerEligibility = getChannelMarketEligibility(provider.key, newMappingMarket?.currency, selected.location);
                            const alreadyMapped = selected.channelMappings.some((mapping) => mapping.marketId === newMappingMarket?.id && mapping.providerKey === provider.key);
                            return (
                              <button
                                type="button"
                                key={provider.key}
                                className={`${providerEligibility.eligible ? "eligible" : "ineligible"} ${newMappingProviderKey === provider.key ? "selected" : ""}`}
                                onClick={() => setNewMappingProviderKey(provider.key)}
                                disabled={!editable || busy || !providerEligibility.eligible || alreadyMapped}
                                title={alreadyMapped ? "Bu kanal seçilen pazara zaten eklenmiş." : providerEligibility.reason}
                              >
                                <span>{provider.shortName}</span>
                                <b>{alreadyMapped ? "Eklendi" : providerEligibility.label}</b>
                                <small>{alreadyMapped ? "Bu pazar için eşleştirme mevcut." : providerEligibility.reason}</small>
                              </button>
                            );
                          })}
                        </div>
                        <ChannelIdentityFields
                          key={`new:${selected.id}:${newMappingMarketId}:${newMappingProviderKey}`}
                          providerKey={newMappingProviderKey}
                          hotelName={selected.name}
                          disabled={!editable || busy}
                        />
                      </div>
                      {selected.rooms.length > 0 && <div className="aliasGrid"><p>OTA oda adları <small>Manuel girebilir veya kanalı taslak olarak ekledikten sonra Düzenle bölümünden otomatik toplayabilirsiniz.</small></p>{selected.rooms.map((room) => <label key={room.id}><span>{room.name}</span><textarea name={`alias:${room.id}`} rows={2} placeholder="Standard Sea View, Standard Room Sea" disabled={!editable} /></label>)}</div>}
                      <div className="formActions"><button className="managerSecondary" disabled={!editable || busy || selected.markets.length === 0 || selected.rooms.length === 0}>Kanal eşleştirmesi ekle</button></div>
                    </form>
                  </section>}

                  {activeSetupStep === 4 && <section className="managerCard releaseCard">
                    <div><span className="stepKicker">05 / DURUM</span><h2>Kontrollü yayın akışı</h2><p>“Hazır”, yapılandırmanın tamamlandığını belirtir. Canlı benchmark’a otomatik dahil etmez.</p></div>
                    <div className="releaseActions">
                      {selected.status === "draft" && <><button className="managerPrimary" onClick={() => setHotelStatus("ready")} disabled={busy}>Hazıra al</button><button className="managerDanger" onClick={() => setHotelStatus("archived")} disabled={busy}>Arşivle</button></>}
                      {selected.status === "ready" && <><button className="managerPrimary" onClick={() => setHotelStatus("active")} disabled={busy}>Aktifleştir</button><button className="managerSecondary" onClick={() => setHotelStatus("draft")} disabled={busy}>Taslağa dön</button><button className="managerDanger" onClick={() => setHotelStatus("archived")} disabled={busy}>Arşivle</button></>}
                      {selected.status === "active" && <><button className="managerSecondary" onClick={() => setHotelStatus("ready")} disabled={busy}>Hazıra çek</button><button className="managerDanger" onClick={() => setHotelStatus("archived")} disabled={busy}>Arşivle</button></>}
                      {selected.status === "archived" && <button className="managerSecondary" onClick={() => setHotelStatus("draft")} disabled={busy}>Taslak olarak geri aç</button>}
                    </div>
                      {selected.status === "ready" && <div className="runtimeGuard"><strong>Collector yapılandırma kontrolü zorunlu</strong><span>Aktivasyon için her pazarda desteklenen kanallardan en az birinin kimlik/sayfa bilgisi ve kapsamdaki tüm odaların alias kayıtları kontrol edilmiş olmalıdır. Bu kontrol canlı OTA erişiminin veya fiyat alınacağının kanıtı değildir; canlı sonuçlar benchmark sorgusunda ayrıca raporlanır. Eksik yapılandırma kapalı biçimde reddedilir.</span></div>}
                  </section>}

                  <div className="managerCard setupWizardControls">
                    <button
                      type="button"
                      className="managerSecondary"
                      onClick={() => setActiveSetupStep((current) => Math.max(0, current - 1))}
                      disabled={activeSetupStep === 0 || busy}
                    >
                      Önceki adım
                    </button>
                    <span>
                      <small>Adım {activeSetupStep + 1} / {steps.length}</small>
                      <strong>{steps[activeSetupStep]?.label}</strong>
                    </span>
                    {activeSetupStep < steps.length - 1 ? (
                      <button
                        type="button"
                        className="managerPrimary"
                        onClick={() => setActiveSetupStep((current) => Math.min(steps.length - 1, current + 1))}
                        disabled={!steps[activeSetupStep]?.done || busy}
                      >
                        Sonraki adım
                      </button>
                    ) : (
                      <span className={`setupWizardResult ${steps[activeSetupStep]?.done ? "done" : ""}`}>
                        {steps[activeSetupStep]?.done ? "Kurulum tamamlandı" : "Yayın durumu bekleniyor"}
                      </span>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
