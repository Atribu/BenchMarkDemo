
import type {
  RoomFeatures,
} from "@/src/lib/benchmark/types";

export type Check24BeachRoomId =
  | "economy"
  | "superior-land"
  | "superior-sea"
  | "corner";

interface OfficialRoomReference {
  name: string;
  features: Partial<RoomFeatures>;
  sourceUrl: string | null;
  reviewRequired: boolean;
}

export const CHECK24_BEACH_OFFICIAL_ROOMS: Record<
  Check24BeachRoomId,
  OfficialRoomReference
> = {
  economy: {
    name: "Economy Room",
    features: {},
    sourceUrl: null,
    reviewRequired: true,
  },

  "superior-land": {
    name: "Superior Land View",
    features: {
      category: "superior",
      view: "land",
      balcony: "yes",
    },
    sourceUrl:
      "https://miramarehotels.com/beach-superior-land-view-room",
    reviewRequired: false,
  },

  "superior-sea": {
    name: "Superior Sea View",
    features: {
      category: "superior",
      view: "sea",
      balcony: "yes",
    },
    sourceUrl:
      "https://miramarehotels.com/beach-superior-sea-view-room",
    reviewRequired: false,
  },

  corner: {
    name: "Superior Corner",
    features: {
      category: "variant",
      balcony: "yes",
    },
    sourceUrl:
      "https://miramarehotels.com/beach-superior-corner-room",
    reviewRequired: false,
  },
};
