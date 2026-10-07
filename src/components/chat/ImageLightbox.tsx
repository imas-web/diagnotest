"use client";

import { useEffect, useState } from "react";

// Íconos en SVG propio (no la fuente "ti" de Tabler Icons): en este visor
// los botones quedaban sin símbolo — por lo que sea, esos nombres puntuales
// (zoom-in/zoom-out/rotate-clockwise/external-link) no se veían con la
// versión de la fuente que carga la app — así que acá no dependen de eso.
function Icono({ nombre, size = 18 }: { nombre: "zoom-in" | "zoom-out" | "rotar" | "externo" | "cerrar"; size?: number }) {
  const props = { width: size, height: size, viewBox: "0 0 24 24", fill: "none" as const, stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (nombre) {
    case "zoom-out":
      return <svg {...props}><circle cx="10" cy="10" r="7" /><line x1="21" y1="21" x2="15.8" y2="15.8" /><line x1="7" y1="10" x2="13" y2="10" /></svg>;
    case "zoom-in":
      return <svg {...props}><circle cx="10" cy="10" r="7" /><line x1="21" y1="21" x2="15.8" y2="15.8" /><line x1="7" y1="10" x2="13" y2="10" /><line x1="10" y1="7" x2="10" y2="13" /></svg>;
    case "rotar":
      return <svg {...props}><path d="M3 12a9 9 0 1 0 3.5-7.1" /><polyline points="3 3 3 6.5 6.5 6.5" /></svg>;
    case "externo":
      return <svg {...props}><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>;
    case "cerrar":
      return <svg {...props}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>;
  }
}

// Visor de fotos del chat: antes había que click derecho → abrir en pestaña
// nueva para ver algo más grande, y ahí no se podía ni hacer zoom ni rotar.
// Clickeando la miniatura se abre esto en vez de eso — zoom (click, rueda del
// mouse o los botones) y rotar en pasos de 90°, sin salir de la app.
export function ImageLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const [zoom, setZoom] = useState(1);
  const [rotacion, setRotacion] = useState(0);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const acercar = () => setZoom((z) => Math.min(4, +(z + 0.5).toFixed(2)));
  const alejar = () => setZoom((z) => Math.max(1, +(z - 0.5).toFixed(2)));

  return (
    <div className="fixed inset-0 z-[100] bg-black/85 flex items-center justify-center" onClick={onClose}>
      <div className="absolute top-3 right-3 flex items-center gap-2 z-10" onClick={(e) => e.stopPropagation()}>
        <button onClick={alejar} disabled={zoom <= 1} title="Alejar"
          className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30 text-white flex items-center justify-center">
          <Icono nombre="zoom-out" />
        </button>
        <button onClick={acercar} disabled={zoom >= 4} title="Acercar"
          className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30 text-white flex items-center justify-center">
          <Icono nombre="zoom-in" />
        </button>
        <button onClick={() => setRotacion((r) => (r + 90) % 360)} title="Rotar"
          className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center">
          <Icono nombre="rotar" />
        </button>
        <a href={src} target="_blank" rel="noopener noreferrer" title="Abrir en pestaña nueva"
          onClick={(e) => e.stopPropagation()}
          className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center">
          <Icono nombre="externo" size={16} />
        </a>
        <button onClick={onClose} title="Cerrar (Esc)"
          className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center">
          <Icono nombre="cerrar" size={20} />
        </button>
      </div>
      <div className="w-full h-full overflow-auto flex items-center justify-center p-10" onClick={(e) => e.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          onClick={() => (zoom === 1 ? setZoom(2) : setZoom(1))}
          onWheel={(e) => { e.preventDefault(); if (e.deltaY < 0) acercar(); else alejar(); }}
          draggable={false}
          className="select-none transition-transform duration-150"
          style={{
            transform: `scale(${zoom}) rotate(${rotacion}deg)`,
            cursor: zoom === 1 ? "zoom-in" : "zoom-out",
            maxHeight: zoom === 1 ? "90vh" : "none",
            maxWidth: zoom === 1 ? "90vw" : "none",
          }}
        />
      </div>
    </div>
  );
}
