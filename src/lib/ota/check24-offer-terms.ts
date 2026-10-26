
import type {
  OfferTerms,
} from "@/src/lib/benchmark/types";

import type {
  Check24ParsedOffer,
} from "./check24-parser";

function formatCancellation(
  offer: Check24ParsedOffer,
): string {
  const rules = offer.cancellationRules ?? [];

  if (rules.length === 0) {
    return "İptal koşulları doğrulanamadı";
  }

  const active = rules.filter(
    (rule) => rule.isActive === true,
  );

  // Birden fazla aktif veya hiç aktif kural varsa
  // yanlış bir özet üretmeyelim.
  if (active.length !== 1) {
    return "İptal koşulları manuel incelenmeli";
  }

  const rule = active[0];

  if (
    rule.feePercentage === 100
  ) {
    return "İptal halinde %100 ceza uygulanıyor";
  }

  if (
    rule.feePercentage === 0
  ) {
    return rule.untilHotel
      ? `Şu anda ücretsiz iptal; ${rule.untilHotel} tarihine kadar`
      : "Şu anda ücretsiz iptal";
  }

  if (rule.feePercentage !== null) {
    return `Şu anda %${rule.feePercentage} iptal cezası`;
  }

  return "İptal koşulları manuel incelenmeli";
}

function formatTaxes(
  offer: Check24ParsedOffer,
): string {
  if (offer.taxesIncludedStatus === true) {
    return offer.localFeesHint
      ? `Vergiler/ücretler dahil göstergesi mevcut; ${offer.localFeesHint}`
      : "Vergiler/ücretler dahil göstergesi mevcut; yerel ek ücretler doğrulanmalı";
  }

  if (offer.taxesIncludedStatus === false) {
    return offer.localFeesHint
      ? `Vergiler/ücretler tamamen dahil değil; ${offer.localFeesHint}`
      : "Vergiler/ücretler dahil değil göstergesi mevcut; ek tutar doğrulanmalı";
  }

  return "Vergi ve yerel ücret bilgisi doğrulanamadı";
}

export function buildCheck24OfferTerms(
  offer: Check24ParsedOffer,
): OfferTerms {
  const payment =
    offer.paymentMoment === "prepay"
      ? "Ön ödeme"
      : offer.paymentMoment === "postpay" ||
          offer.paymentMoment === "paylater"
        ? "Sonradan ödeme"
        : "Ödeme zamanı doğrulanamadı";

  return {
    board: "All Inclusive",
    cancellation: formatCancellation(offer),
    taxes: formatTaxes(offer),
    operator: offer.supplierName,
    availability:
      `Tamamlanan CHECK24 aramasında listelendi. ${payment}.`,
  };
}
