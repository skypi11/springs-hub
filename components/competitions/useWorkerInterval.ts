'use client';

// setInterval hors du thread principal (archi §5 — timers du jour de match).
//
// Les navigateurs ÉTRANGLENT les timers d'un onglet en arrière-plan (≥ 1 min
// entre deux ticks sous Chrome) : or le jour de match, le capitaine est
// alt-tabbé DANS Rocket League et l'admin dans Discord — exactement le moment
// où le polling de la console et le tick des échéances doivent continuer.
// Les timers d'un Web Worker ne sont pas soumis à cet étranglement : le
// worker cadence, le thread principal exécute le callback (fetch non
// étranglé). Fallback setInterval si les Workers sont indisponibles.

import { useEffect, useRef } from 'react';

const WORKER_SRC =
  'let t=null;onmessage=e=>{clearInterval(t);if(e.data&&e.data.ms)t=setInterval(()=>postMessage(0),e.data.ms)};';

export function useWorkerInterval(callback: () => void, ms: number, enabled = true): void {
  const cbRef = useRef(callback);
  useEffect(() => { cbRef.current = callback; }, [callback]);

  useEffect(() => {
    if (!enabled) return;
    let worker: Worker | null = null;
    let fallback: ReturnType<typeof setInterval> | null = null;
    try {
      const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'application/javascript' }));
      worker = new Worker(url);
      URL.revokeObjectURL(url);
      worker.onmessage = () => { cbRef.current(); };
      worker.postMessage({ ms });
    } catch {
      fallback = setInterval(() => { cbRef.current(); }, ms);
    }
    return () => {
      if (worker) worker.terminate();
      if (fallback) clearInterval(fallback);
    };
  }, [ms, enabled]);
}
