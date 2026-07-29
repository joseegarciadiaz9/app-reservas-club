import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL("https://totem-reservas-jose.josegarciadiaz9.chatgpt.site"),
  title: "TØTEM Reservas · Gestión interna",
  description: "Herramienta interna para analizar solicitudes, comprobar mesas y crear reservas en Fourvenues.",
  openGraph: {
    title: "TØTEM Reservas · Gestión interna",
    description: "Del formulario del RRPP a la mesa correcta en Fourvenues.",
    images: [{ url: "https://totem-reservas-jose.josegarciadiaz9.chatgpt.site/og.png", width: 1536, height: 1024 }],
  },
  twitter: {
    card: "summary_large_image",
    images: ["https://totem-reservas-jose.josegarciadiaz9.chatgpt.site/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
