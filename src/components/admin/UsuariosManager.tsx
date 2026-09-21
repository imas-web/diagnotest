"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PillStatus, RoleBadge } from "@/components/ui/PillStatus";
import { toast } from "@/components/ui/ToastNotification";
import { CargaLoteUsuarios } from "@/components/admin/CargaLoteUsuarios";

export interface UsuarioRow {
  id: string;
  nombre: string;
  email: string;
  rol: string;
  activo: boolean;
  zona_base_id: string | null;
  tipo: string | null;
}

export interface ZonaOption {
  id: string;
  nombre: string;
}

const ROLES: { value: string; label: string }[] = [
  { value: "personal_logistica", label: "Personal logística (cadete)" },
  { value: "jefe_logistica", label: "Jefe de logística" },
  { value: "preanalitica", label: "Preanalítica" },
  { value: "cobranzas", label: "Cobranzas" },
  { value: "carga", label: "Carga" },
  { value: "dueno", label: "Dueño" },
  { value: "super_admin", label: "Super Admin" },
  { value: "chat", label: "Solo chat" },
];

type Editing =
  | { mode: "nuevo" }
  | { mode: "editar"; user: UsuarioRow }
  | null;

export function UsuariosManager({ usuarios, zonas }: { usuarios: UsuarioRow[]; zonas: ZonaOption[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Editing>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [mostrarLote, setMostrarLote] = useState(false);
  const emailsExistentes = new Set(usuarios.map((u) => u.email.toLowerCase()));

  async function toggleActivo(u: UsuarioRow) {
    setBusyId(u.id);
    const res = await fetch("/api/admin/usuarios", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: u.id, activo: !u.activo }),
    });
    const json = await res.json();
    setBusyId(null);
    if (!res.ok) { toast("error", json.error ?? "No se pudo actualizar"); return; }
    toast("success", !u.activo ? "Usuario activado ✓" : "Usuario desactivado");
    router.refresh();
  }

  async function eliminar(u: UsuarioRow) {
    if (!confirm(`¿Eliminar definitivamente a "${u.nombre}" (${u.email})?\n\nSe borra su usuario, acceso y ficha de personal. Esta acción no se puede deshacer.`)) return;
    setBusyId(u.id);
    const res = await fetch("/api/admin/usuarios", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: u.id }),
    });
    const json = await res.json();
    setBusyId(null);
    if (!res.ok) { toast("error", json.error ?? "No se pudo eliminar"); return; }
    toast("success", "Usuario eliminado");
    router.refresh();
  }

  return (
    <div className="bg-white rounded-[14px] border border-gy200 shadow-sm overflow-hidden">
      <div className="px-4 py-3.5 border-b border-gy100 flex items-center gap-2">
        <i className="ti ti-users text-g600" />
        <span className="text-[14px] font-semibold flex-1">Usuarios y roles</span>
        <button onClick={() => setMostrarLote(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-white border-2 border-gy200 text-gy600 text-[12px] font-medium rounded-[6px] hover:border-g400 hover:text-g700">
          <i className="ti ti-upload" /> Carga en lote
        </button>
        <button onClick={() => setEditing({ mode: "nuevo" })}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-g800 text-white text-[12px] font-medium rounded-[6px] hover:bg-g700">
          <i className="ti ti-plus" /> Nuevo
        </button>
      </div>
      <div className="table-scroll">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="bg-gy50">
              {["Nombre", "Email", "Rol", "Estado", "Acciones"].map((h) => (
                <th key={h} className="px-3.5 py-2.5 text-left text-[10px] font-bold uppercase tracking-wide text-gy400 border-b border-gy200">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {usuarios.map((u) => (
              <tr key={u.id} className="hover:bg-gy50 border-b border-gy100 last:border-0">
                <td className="px-3.5 py-2.5 font-medium text-gy900">{u.nombre}</td>
                <td className="px-3.5 py-2.5 text-gy600 text-[11px]">{u.email}</td>
                <td className="px-3.5 py-2.5"><RoleBadge rol={u.rol} /></td>
                <td className="px-3.5 py-2.5"><PillStatus variant={u.activo ? "ok" : "grey"} label={u.activo ? "Activo" : "Inactivo"} /></td>
                <td className="px-3.5 py-2.5">
                  <div className="flex items-center gap-2">
                    <button onClick={() => setEditing({ mode: "editar", user: u })}
                      title="Editar"
                      className="px-2 py-1 text-[11px] bg-white border border-gy200 rounded-[6px] hover:bg-gy50 flex items-center gap-1">
                      <i className="ti ti-edit text-[13px]" /> Editar
                    </button>
                    <button onClick={() => toggleActivo(u)} disabled={busyId === u.id}
                      title={u.activo ? "Desactivar (bloquea el ingreso)" : "Activar"}
                      role="switch" aria-checked={u.activo}
                      className={`relative w-10 h-[22px] rounded-full transition-colors disabled:opacity-50 ${u.activo ? "bg-g500" : "bg-gy300"}`}>
                      <span className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] rounded-full bg-white shadow transition-transform ${u.activo ? "translate-x-[18px]" : ""}`} />
                    </button>
                    <button onClick={() => eliminar(u)} disabled={busyId === u.id}
                      title="Eliminar usuario"
                      className="px-2 py-1 text-[11px] font-medium bg-white border border-red-300 text-red-600 rounded-[6px] hover:bg-red-50 disabled:opacity-50 flex items-center gap-1">
                      <i className="ti ti-trash text-[13px]" /> Eliminar
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {usuarios.length === 0 && (
              <tr><td colSpan={5} className="py-10 text-center text-gy400">Sin usuarios</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <UsuarioModal
          editing={editing}
          zonas={zonas}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); router.refresh(); }}
        />
      )}

      {mostrarLote && (
        <CargaLoteUsuarios
          emailsExistentes={emailsExistentes}
          onClose={() => setMostrarLote(false)}
          onDone={() => { setMostrarLote(false); router.refresh(); }}
        />
      )}
    </div>
  );
}

function UsuarioModal({ editing, zonas, onClose, onSaved }: {
  editing: Exclude<Editing, null>;
  zonas: ZonaOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const esNuevo = editing.mode === "nuevo";
  const user = editing.mode === "editar" ? editing.user : null;

  const [nombre, setNombre] = useState(user?.nombre ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [password, setPassword] = useState("");
  const [rol, setRol] = useState(user?.rol ?? "personal_logistica");
  const [zonaId, setZonaId] = useState(user?.zona_base_id ?? "");
  const [tipo, setTipo] = useState(user?.tipo ?? "fijo");
  const [saving, setSaving] = useState(false);

  const esCadete = rol === "personal_logistica";

  async function guardar() {
    if (!nombre.trim()) { toast("error", "Ingresá el nombre"); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { toast("error", "Email con formato inválido"); return; }
    if (esNuevo && password.length < 6) { toast("error", "La contraseña debe tener al menos 6 caracteres"); return; }
    if (!esNuevo && password.length > 0 && password.length < 6) { toast("error", "La nueva contraseña debe tener al menos 6 caracteres"); return; }

    const cadeteFields = esCadete ? { zona_base_id: zonaId || null, tipo } : {};

    setSaving(true);
    const res = await fetch("/api/admin/usuarios", {
      method: esNuevo ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        esNuevo
          ? { nombre, email, password, rol, ...cadeteFields }
          : { id: user!.id, nombre, email, rol, ...cadeteFields, ...(password ? { password } : {}) }
      ),
    });
    const json = await res.json();
    setSaving(false);
    if (!res.ok) { toast("error", json.error ?? "No se pudo guardar"); return; }
    toast("success", esNuevo ? "Usuario creado ✓" : "Usuario actualizado ✓");
    onSaved();
  }

  const inputCls = "w-full px-3 py-2 border-2 border-gy200 rounded-[8px] text-[13px] bg-gy50 focus:outline-none focus:border-g500 focus:bg-white transition-colors";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-[16px] shadow-xl w-full max-w-[420px] overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gy100 flex items-center gap-2">
          <i className={`ti ${esNuevo ? "ti-user-plus" : "ti-user-edit"} text-g600`} />
          <span className="text-[15px] font-semibold flex-1">{esNuevo ? "Nuevo usuario" : "Editar usuario"}</span>
          <button onClick={onClose} className="text-gy400 hover:text-gy600"><i className="ti ti-x text-[18px]" /></button>
        </div>
        <div className="px-5 py-4 space-y-3.5">
          <div>
            <label className="block text-[11px] font-semibold text-gy600 mb-1.5">Nombre completo</label>
            <input className={inputCls} value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Juan Pérez" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-gy600 mb-1.5">Email (con el que inicia sesión)</label>
            <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nombre@diagnotest.com" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-gy600 mb-1.5">
              {esNuevo ? "Contraseña" : "Nueva contraseña (opcional)"}
            </label>
            <input className={inputCls} type="text" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder={esNuevo ? "Mínimo 6 caracteres" : "Dejar vacío para no cambiarla"} />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-gy600 mb-1.5">Rol</label>
            <select className={inputCls} value={rol} onChange={(e) => setRol(e.target.value)}>
              {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          {esCadete && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-gy600 mb-1.5">Zona base</label>
                <select className={inputCls} value={zonaId} onChange={(e) => setZonaId(e.target.value)}>
                  <option value="">— Sin asignar —</option>
                  {zonas.map((z) => <option key={z.id} value={z.id}>{z.nombre}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-gy600 mb-1.5">Tipo</label>
                <select className={inputCls} value={tipo} onChange={(e) => setTipo(e.target.value)}>
                  <option value="fijo">Fijo</option>
                  <option value="reemplazo">Reemplazo</option>
                  <option value="ventanilla">Ventanilla</option>
                </select>
              </div>
            </div>
          )}
          {esCadete && (
            <div className="flex items-start gap-1.5 text-[11px] text-g700 bg-g50 rounded-[8px] px-3 py-2">
              <i className="ti ti-info-circle text-[14px] mt-0.5 shrink-0" />
              Al ser &quot;Personal logística&quot; se crea automáticamente su ficha en el Maestro de Personal.
            </div>
          )}
        </div>
        <div className="px-5 py-4 border-t border-gy100 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-3.5 py-2 text-[13px] font-medium text-gy600 bg-white border border-gy200 rounded-[8px] hover:bg-gy50">
            Cancelar
          </button>
          <button onClick={guardar} disabled={saving}
            className="flex items-center gap-2 px-4 py-2 text-[13px] font-semibold text-white bg-g800 rounded-[8px] hover:bg-g700 disabled:opacity-60">
            {saving && <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            {esNuevo ? "Crear usuario" : "Guardar cambios"}
          </button>
        </div>
      </div>
    </div>
  );
}
