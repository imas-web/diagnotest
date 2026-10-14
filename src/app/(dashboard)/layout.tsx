import { redirect } from "next/navigation";
import { getMyProfile } from "@/lib/supabase/server";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { UpdatePrompt } from "@/components/offline/UpdatePrompt";
import type { Profile } from "@/types";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, profile } = await getMyProfile();

  if (!user) redirect("/login");
  if (!profile) redirect("/login");

  // Personal de logística: experiencia 100% mobile, sin sidebar
  if (profile.rol === "personal_logistica") {
    return (
      <div className="min-h-screen bg-gy100 flex justify-center">
        <div className="w-full max-w-[480px] bg-white min-h-screen shadow-xl flex flex-col">
          {children}
          <UpdatePrompt />
        </div>
      </div>
    );
  }

  return (
    <DashboardShell profile={profile as Profile}>
      {children}
      <UpdatePrompt />
    </DashboardShell>
  );
}
