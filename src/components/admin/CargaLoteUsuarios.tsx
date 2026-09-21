"use client";

import { useState } from "react";
import { toast } from "@/components/ui/ToastNotification";

const ROLES: { value: string; label: string }[] = [
  { value: "chat", label: "Solo chat" },
  { value: "preanalitica", label: "Preanalítica" },
  { value: "cobranzas", label: "Cobranzas" },
  { value: "dueno", label: "Dueño" },
];

const GRUPOS = ["Preanalítica", "Administración", "Citología", "Cobranzas"];

interface Fila {
  nombre: string;
  email: string;
  rol: string;
  grupo: string | null;
}

// Roster de DiagnoLis (listado que pasó Ignacio). Los ya marcados como
// existentes en el sistema no se recrean; solo se usan para sumarlos al
// canal de su sector si corresponde.
const ROSTER: Fila[] = [
  { nombre: "Pre Analítica 1", email: "preanalitica@diagnotest.com", rol: "preanalitica", grupo: "Preanalítica" },
  { nombre: "Pre Analítica 2", email: "preanalitica2@diagnotest.com", rol: "preanalitica", grupo: "Preanalítica" },
  { nombre: "Pre Analítica 3", email: "preanalitica3@diagnotest.com", rol: "preanalitica", grupo: "Preanalítica" },
  { nombre: "Pre Analítica 4", email: "preanalitica4@diagnotest.com", rol: "preanalitica", grupo: "Preanalítica" },
  { nombre: "Administración 1", email: "admin1@diagnotest.com", rol: "chat", grupo: "Administración" },
  { nombre: "Administración 2", email: "admin2@diagnotest.com", rol: "chat", grupo: "Administración" },
  { nombre: "Administración 3", email: "admin3@diagnotest.com", rol: "chat", grupo: "Administración" },
  { nombre: "Administración 4", email: "admin4@diagnotest.com", rol: "chat", grupo: "Administración" },
  { nombre: "A. Córdoba (RRHH)", email: "acordoba@diagnotest.com", rol: "chat", grupo: null },
  { nombre: "B. Suárez (Comercial)", email: "bsuarez@diagnotest.com", rol: "chat", grupo: null },
  { nombre: "F. Leanza (Cobranzas)", email: "fleanza@diagnotest.com", rol: "cobranzas", grupo: "Cobranzas" },
  { nombre: "F. Mas (Dirección)", email: "fmas@diagnotest.com", rol: "dueno", grupo: null },
  { nombre: "M. Orihuela (Cobranzas)", email: "morihuela@diagnotest.com", rol: "cobranzas", grupo: "Cobranzas" },
  { nombre: "N. Córdoba (Compras)", email: "ncordoba@diagnotest.com", rol: "chat", grupo: null },
  { nombre: "R. Paterno (Biología Molecular)", email: "rpaterno@diagnotest.com", rol: "chat", grupo: null },
  { nombre: "P. Monti (Dirección)", email: "pmonti@diagnotest.com", rol: "dueno", grupo: null },
  { nombre: "Bacteriología", email: "bacteriologia@diagnotest.com", rol: "chat", grupo: null },
  { nombre: "Hormonas", email: "hormonas@diagnotest.com", rol: "chat", grupo: null },
  { nombre: "Hematología", email: "hematologia@diagnotest.com", rol: "chat", grupo: null },
  { nombre: "Química", email: "quimica@diagnotest.com", rol: "chat", grupo: null },
  { nombre: "Orina", email: "orina@diagnotest.com", rol: "chat", grupo: null },
  { nombre: "Materia Fecal", email: "amf@diagnotest.com", rol: "chat", grupo: null },
  { nombre: "Serología", email: "serologia@diagnotest.com", rol: "chat", grupo: null },
  { nombre: "A. Arredondo (Cobranzas)", email: "aarredondo@diagnotest.com", rol: "cobranzas", grupo: "Cobranzas" },
  { nombre: "Talia (Externo)", email: "talia.diagnotest@gmail.com", rol: "chat", grupo: "Citología" },
  { nombre: "Frey (Externo)", email: "frey.diagnotest@gmail.com", rol: "chat", grupo: "Citología" },
];

interface Resultado {
  email: string; nombre: string; ok: boolean; password?: string; error?: string; yaExiste?: boolean;
}

export function CargaLoteUsuarios({
  emailsExistentes,
  onClose,
  onDone,
}: {
  emailsExistentes: Set<string>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [filas, setFilas] = useState<Fila[]>(ROSTER);
  const [incluidos, setIncluidos] = useState<Set<number>>(new Set(ROSTER.map((_, i) => i)));
  const [enviando, setEnviando] = useState(false);
  const [resultados, setResultados] = useState<Resultado[] | null>(null);

  function actualizarFila(i: number, cambios: Partial<Fila>) {
    setFilas((prev) => prev.map((f, idx) => (idx === i ? { ...f, ...cambios } : f)));
  }

  function toggleIncluido(i: number) {
    setIncluidos((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }

  async function enviar() {
    const seleccionadas = filas.filter((_, i) => incluidos.has(i));
    if (!seleccionadas.length) return;
    setEnviando(true);
    const payload = seleccionadas.map((f) => ({
      nombre: f.nombre,
      email: f.email,
      rol: f.rol,
      grupo: f.grupo,
      yaExiste: emailsExistentes.has(f.email.trim().toLowerCase()),
    }));
    const res = await fetch("/api/admin/usuarios/lote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filas: payload }),
    });
    const json = await res.json().catch(() => ({}));
    setEnviando(false);
    if (!res.ok) { toast("error", json.error ?? "No se pudo procesar el lote"); return; }
    setResultados(json.resultados as Resultado[]);
    const creados = (json.resultados as Resultado[]).filter((r) => r.ok && !r.yaExiste).length;
    toast("success", `${creados} cuenta(s) nueva(s) creada(s) ✓`);
  }

  function copiarCredenciales() {
    const lineas = (resultados ?? [])
      .filter((r) => r.ok && r.password)
      .map((r) => `${r.nombre} — ${r.email} — ${r.password}`);
    navigator.clipboard.writeText(lineas.join("\n"));
    toast("success", "Credenciales copiadas al portapapeles");
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-[14px] shadow-xl w-full max-w-[820px] max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-gy100 flex items-center justify-between shrink-0">
          <div>
            <div className="text-[14px] font-semibold text-gy900">Carga en lote — DiagnoLis</div>
            <div className="text-[11px] text-gy400 mt-0.5">
              Los marcados &quot;ya existe&quot; no se recrean, solo se suman al canal de su sector.
            </div>
          </div>
          <button onClick={onClose} className="text-gy400 hover:text-gy700"><i className="ti ti-x text-[18px]" /></button>
        </div>

        {!resultados ? (
          <>
            <div className="flex-1 overflow-y-auto">
              <table className="w-full border-collapse text-[11.5px]">
                <thead className="sticky top-0 bg-gy50">
                  <tr>
                    {["", "Nombre", "Email", "Rol", "Canal de sector", ""].map((h) => (
                      <th key={h} className="px-2.5 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-gy400 border-b border-gy200">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f, i) => {
                    const yaExiste = emailsExistentes.has(f.email.trim().toLowerCase());
                    return (
                      <tr key={f.email} className="border-b border-gy50">
                        <td className="px-2.5 py-1.5">
                          <input type="checkbox" checked={incluidos.has(i)} onChange={() => toggleIncluido(i)} className="w-3.5 h-3.5 accent-g700" />
                        </td>
                        <td className="px-2.5 py-1.5">
                          <input value={f.nombre} onChange={(e) => actualizarFila(i, { nombre: e.target.value })}
                            className="w-full px-1.5 py-1 border border-gy200 rounded-[4px] text-[11.5px] bg-gy50 focus:outline-none focus:border-g500" />
                        </td>
                        <td className="px-2.5 py-1.5">
                          <input value={f.email} onChange={(e) => actualizarFila(i, { email: e.target.value })}
                            className="w-full px-1.5 py-1 border border-gy200 rounded-[4px] text-[11.5px] bg-gy50 focus:outline-none focus:border-g500" />
                          {yaExiste && <div className="text-[9.5px] text-g600 mt-0.5">ya existe en el sistema</div>}
                        </td>
                        <td className="px-2.5 py-1.5">
                          <select value={f.rol} onChange={(e) => actualizarFila(i, { rol: e.target.value })}
                            className="px-1.5 py-1 border border-gy200 rounded-[4px] text-[11.5px] bg-gy50 focus:outline-none focus:border-g500">
                            {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                          </select>
                        </td>
                        <td className="px-2.5 py-1.5">
                          <select value={f.grupo ?? ""} onChange={(e) => actualizarFila(i, { grupo: e.target.value || null })}
                            className="px-1.5 py-1 border border-gy200 rounded-[4px] text-[11.5px] bg-gy50 focus:outline-none focus:border-g500">
                            <option value="">— Ninguno —</option>
                            {GRUPOS.map((g) => <option key={g} value={g}>{g}</option>)}
                          </select>
                        </td>
                        <td />
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="p-4 border-t border-gy100 flex items-center gap-3 shrink-0">
              <span className="text-[11px] text-gy400 flex-1">{incluidos.size} de {filas.length} seleccionadas</span>
              <button onClick={onClose} className="px-3 py-1.5 text-[12px] text-gy600 hover:text-gy900">Cancelar</button>
              <button onClick={enviar} disabled={!incluidos.size || enviando}
                className="flex items-center gap-1.5 px-4 py-2 bg-g800 text-white text-[12px] font-medium rounded-[6px] hover:bg-g700 disabled:opacity-50">
                {enviando && <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
                Crear {incluidos.size} cuenta(s)
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto">
              <table className="w-full border-collapse text-[11.5px]">
                <thead className="sticky top-0 bg-gy50">
                  <tr>
                    {["Nombre", "Email", "Estado", "Contraseña inicial"].map((h) => (
                      <th key={h} className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-gy400 border-b border-gy200">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {resultados.map((r) => (
                    <tr key={r.email} className="border-b border-gy50">
                      <td className="px-3 py-2 font-medium text-gy900">{r.nombre}</td>
                      <td className="px-3 py-2 text-gy600">{r.email}</td>
                      <td className="px-3 py-2">
                        {r.ok
                          ? <span className="text-g700">{r.yaExiste ? "Ya existía · sumado al canal" : "Creado ✓"}</span>
                          : <span className="text-red-600">{r.error}</span>}
                      </td>
                      <td className="px-3 py-2 font-mono text-[11px]">{r.password ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p-4 border-t border-gy100 flex items-center gap-3 shrink-0">
              <span className="text-[11px] text-gy400 flex-1">
                Guardá o copiá estas contraseñas ahora — no se van a volver a mostrar.
              </span>
              <button onClick={copiarCredenciales}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] bg-white border-2 border-gy200 text-gy600 rounded-[6px] hover:border-g400 hover:text-g700">
                <i className="ti ti-copy text-[13px]" /> Copiar credenciales
              </button>
              <button onClick={onDone} className="px-4 py-2 bg-g800 text-white text-[12px] font-medium rounded-[6px] hover:bg-g700">
                Listo
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
