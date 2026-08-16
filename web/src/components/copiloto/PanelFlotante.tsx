"use client";

import { useEffect, type Ref } from "react";
import { ChevronDown, Sparkles } from "lucide-react";

import { Chat, type CopilotoHandle } from "./Chat";
import { useCopiloto } from "./CopilotoProvider";

/**
 * Caparazón del copiloto: burbuja cuando está guardado, panel cuando está
 * abierto.
 *
 * El chat de adentro NUNCA se desmonta. Cerrar el panel esconde la
 * conversación, no la borra — el asesor cierra para ver la pantalla de atrás y
 * vuelve a lo que estaba diciendo. Por eso los dos estados se resuelven con
 * opacidad y transform en vez de con un condicional de render, y el que está
 * fuera de juego lleva `inert` para que no lo alcance el tabulador.
 */
export function PanelFlotante({
  chatRef,
}: {
  chatRef: Ref<CopilotoHandle>;
}) {
  const { abierto, abrir, cerrar, clienteId, estado } = useCopiloto();

  useEffect(() => {
    if (!abierto) return;
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") cerrar();
    };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [abierto, cerrar]);

  return (
    <>
      {/* Solo en móvil, donde el panel ocupa casi toda la pantalla y hace falta
          una salida obvia. En escritorio el panel convive con el contenido. */}
      <div
        onClick={cerrar}
        aria-hidden
        className={`fixed inset-0 z-30 bg-marino/30 transition-opacity duration-[250ms] ease-drawer sm:hidden ${
          abierto ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      <button
        type="button"
        onClick={abrir}
        inert={abierto}
        className={`fixed right-4 bottom-4 z-40 flex h-11 items-center gap-2 rounded-full bg-marino pr-4 pl-3 text-cuerpo font-medium text-white shadow-flotante outline-none transition-[transform,opacity,background-color] duration-200 ease-fuerte hover:bg-marino-2 focus-visible:ring-2 focus-visible:ring-marca/60 active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 ${
          abierto ? "pointer-events-none scale-90 opacity-0" : "opacity-100"
        }`}
      >
        <span className="grid size-6 place-items-center rounded-full bg-marca">
          <Sparkles size={13} />
        </span>
        Copiloto
      </button>

      <aside
        inert={!abierto}
        aria-label="Copiloto NBO"
        className={`fixed inset-x-0 bottom-0 z-40 flex h-[85dvh] flex-col overflow-hidden rounded-t-panel border-t border-borde bg-superficie shadow-flotante transition-[transform,opacity] duration-[250ms] ease-drawer sm:inset-x-auto sm:top-[4.5rem] sm:right-4 sm:bottom-4 sm:h-auto sm:w-[408px] sm:max-w-[calc(100vw-2rem)] sm:rounded-panel sm:border motion-reduce:transition-none ${
          abierto
            ? "translate-y-0 opacity-100 sm:scale-100"
            : "translate-y-full opacity-0 sm:translate-y-2 sm:scale-[0.98]"
        }`}
      >
        <header className="flex shrink-0 items-center gap-2 bg-marino px-3 py-2.5 text-white">
          <span className="grid size-5 place-items-center rounded bg-marca">
            <Sparkles size={12} />
          </span>
          <h2 className="text-cuerpo font-semibold">Copiloto</h2>

          {/* Sobre qué está hablando. Sin esto, en la cola no hay forma de
              saber que el copiloto no tiene un cliente delante. */}
          <span className="rounded-full bg-white/12 px-2 py-0.5 text-etiqueta text-white/80">
            {clienteId ?? "toda la planta"}
          </span>
          {estado?.abstenerse ? (
            <span className="rounded-full bg-alerta/90 px-2 py-0.5 text-etiqueta font-medium">
              abstención
            </span>
          ) : null}

          <button
            type="button"
            onClick={cerrar}
            aria-label="Guardar el copiloto"
            className="ml-auto grid size-7 shrink-0 place-items-center rounded-md text-white/70 outline-none transition-[transform,background-color,color] duration-150 ease-fuerte hover:bg-white/12 hover:text-white focus-visible:ring-2 focus-visible:ring-white/40 active:scale-[0.95] motion-reduce:transition-none motion-reduce:active:scale-100"
          >
            <ChevronDown size={16} />
          </button>
        </header>

        <Chat ref={chatRef} clienteId={clienteId} estado={estado} />
      </aside>
    </>
  );
}
