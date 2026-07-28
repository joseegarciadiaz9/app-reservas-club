import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL("https://totem-reservas-jose.josegarciadiaz9.chatgpt.site"),
  title: "TØTEM Reservas · Modo supervisado",
  description: "Prueba segura para revisar, ubicar y preparar una reserva antes de enviarla a Fourvenues.",
  openGraph: {
    title: "TØTEM Reservas · Modo supervisado",
    description: "Revisa, ubica y confirma sin crear reservas reales.",
    images: ["/og.png"],
  },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
