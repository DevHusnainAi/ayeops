import type { Metadata } from "next";
import { Atkinson_Hyperlegible_Mono, Atkinson_Hyperlegible_Next, Big_Shoulders } from "next/font/google";
import { BRAND } from "@/lib/brand";
import "./globals.css";

// Atkinson was designed for legibility; Big Shoulders is used only for codes and headline numbers.
const sans = Atkinson_Hyperlegible_Next({ subsets: ["latin"], variable: "--font-atkinson" });
const mono = Atkinson_Hyperlegible_Mono({ subsets: ["latin"], variable: "--font-atkinson-mono" });
const display = Big_Shoulders({ subsets: ["latin"], axes: ["opsz"], variable: "--font-shoulders" });

export const metadata: Metadata = {
  title: BRAND,
  description: "Voice incident command. The agent investigates on its own; production changes wait for your voice.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${display.variable} antialiased`}>
      <body>{children}</body>
    </html>
  );
}
