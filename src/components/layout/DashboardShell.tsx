"use client";

import { useState } from "react";
import Image from "next/image";
import { Sidebar } from "@/components/layout/Sidebar";
import { OfflineBanner } from "@/components/offline/SyncIndicator";
import { ChatbotWidget } from "@/components/chatbot/ChatbotWidget";
import type { Profile } from "@/types";

export function DashboardShell({
  profile,
  children,
}: {
  profile: Profile;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Overlay (solo mobile, cuando el cajón está abierto) */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          className="fixed inset-0 bg-black/40 z-30 md:hidden"
          aria-hidden
        />
      )}

      {/* Sidebar: cajón deslizante en mobile, fijo en desktop */}
      <div
        className={`fixed inset-y-0 left-0 z-40 transition-transform duration-200 md:static md:z-auto md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <Sidebar profile={profile} onNavigate={() => setOpen(false)} />
      </div>

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Barra superior con botón de menú (solo mobile) */}
        <header className="md:hidden flex items-center gap-3 px-4 h-14 bg-g800 shrink-0 z-20">
          <button
            onClick={() => setOpen(true)}
            aria-label="Abrir menú"
            className="text-white/90 hover:text-white p-1 -ml-1"
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="bg-white rounded-lg px-2.5 py-1.5 shadow-sm">
            <Image src="/logo.png" alt="Diagnotest" width={120} height={38} className="object-contain" priority />
          </div>
        </header>

        <OfflineBanner />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>

      <ChatbotWidget />
    </div>
  );
}
