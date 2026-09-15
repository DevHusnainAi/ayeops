import type { Metadata } from "next";
import { Instrument_Sans, Martian_Mono } from "next/font/google";
import { BRAND } from "@/lib/brand";
import "./globals.css";

// Instrument Sans carries every human sentence: the pitch, the transcript, the copy. Martian Mono renders
// everything the machine measures or the operator must read back exactly -- codes, versions, timestamps, log
// lines. Two voices, on purpose: the product's whole premise is a human authorizing a machine precisely.
const sans = Instrument_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-sans" });
const mono = Martian_Mono({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: `${BRAND} — Voice-authorized incident command`,
  description: "The agent investigates on its own; production changes wait for a code it will never see.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} antialiased`}>
      <body>{children}</body>
    </html>
  );
}
