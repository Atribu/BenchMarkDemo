import type { Metadata } from "next";
import "@fontsource-variable/ibm-plex-sans";
import "@fontsource-variable/space-grotesk";
import "./globals.css";

export const metadata: Metadata = {
  title: "DGTLFACE | Hotel Benchmark",
  description:
    "DGTLFACE Hotel Benchmark: otel portföyü için tarih bazlı, uçaksız OTA fiyat karşılaştırması.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
