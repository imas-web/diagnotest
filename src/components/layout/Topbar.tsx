"use client";

import { SyncIndicator } from "@/components/offline/SyncIndicator";
import type { ReactNode } from "react";

interface Props {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function Topbar({ title, subtitle, actions }: Props) {
  return (
    <header className="h-[58px] bg-white border-b border-gy200 flex items-center px-6 gap-3.5 shrink-0 shadow-sm">
      <div className="flex items-center gap-2 flex-1">
        <h1 className="text-[17px] font-semibold text-gy900">{title}</h1>
        {subtitle && <span className="text-[10px] text-gy400 font-medium">{subtitle}</span>}
      </div>
      <SyncIndicator />
      {actions}
    </header>
  );
}
