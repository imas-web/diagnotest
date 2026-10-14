// Si Supabase (u otra llamada externa) se queda sin responder, evita que el
// request entero cuelgue hasta el límite duro de Vercel (25s en middleware,
// 300s en funciones) — se corta antes y el llamador decide cómo degradar.
export function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Tiempo de espera agotado (${ms}ms)`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}
