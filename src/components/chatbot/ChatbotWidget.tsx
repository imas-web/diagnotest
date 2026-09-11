"use client";

import { useEffect, useRef, useState } from "react";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export function ChatbotWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open]);

  async function enviar() {
    const pregunta = input.trim();
    if (!pregunta || loading) return;

    const historial = [...messages, { role: "user" as const, content: pregunta }];
    setMessages(historial);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chatbot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: historial }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al consultar el asistente");
      setMessages((prev) => [...prev, { role: "assistant", content: data.answer }]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `⚠️ ${err instanceof Error ? err.message : "Error al consultar el asistente"}` },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      enviar();
    }
  }

  return (
    <>
      {!open && (
        <span className="fixed bottom-7 left-[76px] z-50 px-2 py-1 rounded-full bg-indigo-600 text-white text-[10px] font-semibold shadow-lg pointer-events-none whitespace-nowrap">
          DiagnoLis
        </span>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Cerrar DiagnoLis" : "Hablar con DiagnoLis, el asistente"}
        title="DiagnoLis · asistente automático (no es el chat interno)"
        className="fixed bottom-5 left-5 z-50 w-14 h-14 rounded-full bg-indigo-600 text-white shadow-lg flex items-center justify-center hover:bg-indigo-700 transition-colors"
      >
        {open ? (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        ) : (
          <i className="ti ti-user text-[26px]" />
        )}
      </button>

      {open && (
        <div className="fixed bottom-24 left-5 z-50 w-[min(380px,calc(100vw-2.5rem))] h-[min(560px,calc(100vh-8rem))] bg-white rounded-xl shadow-2xl border border-gy200 flex flex-col overflow-hidden">
          <div className="bg-indigo-600 text-white px-4 py-3 shrink-0">
            <p className="font-semibold text-sm flex items-center gap-1.5"><i className="ti ti-user text-[16px]" /> DiagnoLis</p>
            <p className="text-xs text-indigo-100">Asistente automático — preguntá sobre retiros, controles, pedidos o gastos. No es el chat de la empresa.</p>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2 bg-gy50">
            {messages.length === 0 && (
              <p className="text-sm text-gy600 px-1">
                Ej: &ldquo;¿Quién controló los retiros de Facundo el 25 de agosto?&rdquo;
              </p>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                    m.role === "user" ? "bg-indigo-600 text-white" : "bg-white border border-gy200 text-gy900"
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-white border border-gy200 rounded-lg px-3 py-2 text-sm text-gy400">Pensando…</div>
              </div>
            )}
          </div>

          <div className="border-t border-gy200 p-2 flex items-end gap-2 shrink-0 bg-white">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Escribí tu consulta…"
              rows={1}
              className="flex-1 resize-none rounded-lg border border-gy300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 max-h-24"
            />
            <button
              onClick={enviar}
              disabled={loading || !input.trim()}
              aria-label="Enviar"
              className="shrink-0 w-9 h-9 rounded-lg bg-indigo-600 text-white flex items-center justify-center disabled:opacity-40"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
