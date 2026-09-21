// Badge de mensajes sin leer en el ícono de la pestaña del navegador, al
// estilo WhatsApp Web: un círculo con el número dibujado sobre el favicon
// (vía canvas) + el número como prefijo del título de la pestaña.

let baseImgPromise: Promise<HTMLImageElement> | null = null;
let tituloOriginal: string | null = null;

function cargarFaviconBase(): Promise<HTMLImageElement> {
  if (!baseImgPromise) {
    baseImgPromise = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = "/favicon.ico";
    });
  }
  return baseImgPromise;
}

export async function actualizarBadgeFavicon(count: number) {
  try {
    const img = await cargarFaviconBase();
    const size = 32;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(img, 0, 0, size, size);

    if (count > 0) {
      const r = 11;
      const cx = size - r + 3;
      const cy = r - 3;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = "#e02424";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#fff";
      ctx.stroke();

      ctx.fillStyle = "#fff";
      ctx.font = "bold 14px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(count > 9 ? "9+" : String(count), cx, cy + 1);
    }

    const url = canvas.toDataURL("image/png");
    const links = document.querySelectorAll<HTMLLinkElement>("link[rel~='icon']");
    if (links.length === 0) {
      const link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
      link.type = "image/png";
      link.href = url;
    } else {
      links.forEach((link) => { link.type = "image/png"; link.href = url; });
    }

    if (tituloOriginal === null) tituloOriginal = document.title.replace(/^\(\d+\+?\)\s*/, "");
    document.title = count > 0 ? `(${count > 99 ? "99+" : count}) ${tituloOriginal}` : tituloOriginal;
  } catch {
    /* si el favicon no carga (ej. bloqueado), no rompe nada más */
  }
}
