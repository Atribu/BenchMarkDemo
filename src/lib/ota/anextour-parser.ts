export interface AnexTourOffer {
  accommodationId: string;
  operator: "ANEX Tour" | "ÖGER TOURS";
  roomName: string;
  board: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  price: number;
  currency: "EUR";
}

interface AnexApiItem {
  accommodationId: string;
  tourOperator?: {
    id?: string;
    name?: string;
  };
  units?: {
    room?: {
      name?: string;
    };
    board?: {
      code?: string;
    };
  }[];
  startDate: string;
  endDate: string;
  duration?: {
    overnights?: number;
  };
  price?: {
    total?: {
      amount?: number;
      currency?: string;
      type?: string;
    };
  };
}

interface AnexApiResponse {
  data?: {
    items?: AnexApiItem[];
  };
}

export function parseAnexTourOffers(
  response: AnexApiResponse,
  expected: {
    accommodationId: string;
    checkIn: string;
    checkOut: string;
    nights: number;
    operatorIds?: readonly string[];
  },
): AnexTourOffer[] {
  return (response.data?.items ?? []).flatMap((item) => {
    const total = item.price?.total;
    const unit = item.units?.[0];
    const operatorId = item.tourOperator?.id;
    const allowedOperatorIds = expected.operatorIds ?? ["ANEX"];

    if (
      !operatorId ||
      !allowedOperatorIds.includes(operatorId) ||
      item.accommodationId !== expected.accommodationId ||
      item.startDate !== expected.checkIn ||
      item.endDate !== expected.checkOut ||
      item.duration?.overnights !== expected.nights ||
      total?.type !== "PARTY" ||
      total.currency !== "EUR" ||
      typeof total.amount !== "number" ||
      !Number.isFinite(total.amount) ||
      total.amount <= 0 ||
      item.units?.length !== 1 ||
      !unit?.room?.name ||
      !unit.board?.code
    ) {
      return [];
    }

    const operator = operatorId === "OGE" ? "ÖGER TOURS" : "ANEX Tour";

    return [{
      accommodationId: item.accommodationId,
      operator,
      roomName: unit.room.name,
      board: unit.board.code,
      checkIn: item.startDate,
      checkOut: item.endDate,
      nights: item.duration.overnights,
      price: total.amount,
      currency: "EUR" as const,
    }];
  });
}
