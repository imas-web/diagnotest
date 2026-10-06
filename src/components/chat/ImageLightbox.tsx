"use client";

import { useEffect, useState } from "react";

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
          <i className="ti ti-zoom-out text-[18px]" />
        </button>
        <button onClick={acercar} disabled={zoom >= 4} title="Acercar"
          className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30 text-white flex items-center justify-center">
          <i className="ti ti-zoom-in text-[18px]" />
        </button>
        <button onClick={() => setRotacion((r) => (r + 90) % 360)} title="Rotar"
          className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center">
          <i className="ti ti-rotate-clockwise text-[18px]" />
        </button>
        <a href={src} target="_blank" rel="noopener noreferrer" title="Abrir en pestaña nueva"
          onClick={(e) => e.stopPropagation()}
          className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center">
          <i className="ti ti-external-link text-[16px]" />
        </a>
        <button onClick={onClose} title="Cerrar (Esc)"
          className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center">
          <i className="ti ti-x text-[20px]" />
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
