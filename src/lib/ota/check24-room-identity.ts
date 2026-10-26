
import type {
  Check24ParsedOffer,
} from "./check24-parser";

export type Check24RoomIdentityStatus =
  | "consistent"
  | "mixed-group"
  | "insufficient-data";

export interface Check24RoomIdentityResult {
  status: Check24RoomIdentityStatus;
  canUseGroupDetails: boolean;
  reason: string;
}

export function validateCheck24RoomIdentity(
  offer: Check24ParsedOffer,
): Check24RoomIdentityResult {
  const sourceId = offer.sourceRoomId;
  const groupId = offer.groupRoomId;

  if (!sourceId || !groupId) {
    return {
      status: "insufficient-data",
      canUseGroupDetails: false,
      reason:
        "Teklif veya grup oda kimliği eksik. " +
        "Grup açıklaması doğrulama için kullanılamaz.",
    };
  }

  if (sourceId !== groupId) {
    return {
      status: "mixed-group",
      canUseGroupDetails: false,
      reason:
        `Teklif oda ID (${sourceId}) ile ` +
        `grup oda ID (${groupId}) farklı. ` +
        "Grup açıklaması teklife aktarılamaz.",
    };
  }

  // ID eşitliği, oda özelliklerinin kesin olarak
  // eşdeğer olduğunu tek başına kanıtlamaz.
  return {
    status: "consistent",
    canUseGroupDetails: false,
    reason:
      "Oda kimlikleri eşit. Ancak grup açıklamasının " +
      "teklifle eşdeğerliği henüz doğrulanmadı.",
  };
}
