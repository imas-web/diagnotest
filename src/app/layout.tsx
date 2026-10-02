import type { Metadata } from "next";
import "./globals.css";
import { ToastContainer } from "@/components/ui/ToastNotification";
import { ServiceWorkerUpdater } from "@/components/pwa/ServiceWorkerUpdater";

export const metadata: Metadata = {
  title: "DIAGNOTEST — Plataforma Operativa",
  description: "Sistema de gestión para laboratorio veterinario de análisis clínicos",
  manifest: "/manifest.json",
  themeColor: "#1a5c2e",
  // Sin esto, el "oscurecimiento automático" de Chrome en Android (para sitios
  // que no declaran su esquema de color) reinterpreta algunos botones de color
  // sólido a su manera y los deja casi blancos/invisibles — pasaba con el de
  // "Nuevo mensaje" del chat en el celular. Declarar explícitamente que el
  // sitio es claro hace que Chrome no lo toque.
  colorScheme: "light",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Diagnotest",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className="font-sans antialiased">
        {children}
        <ToastContainer />
        <ServiceWorkerUpdater />
      </body>
    </html>
  );
}
