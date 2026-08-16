"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { CopilotoHandle, EstadoCliente } from "./Chat";
import { PanelFlotante } from "./PanelFlotante";

/**
 * Estado global del copiloto.
 *
 * El copiloto dejó de ser una columna del cockpit para ser una capa sobre toda
 * la herramienta: eso es lo que va a ser en producción, montado encima del
 * sistema que el asesor ya usa. Vive en el layout, así que sobrevive a la
 * navegación entre la cola y un cliente sin remontarse.
 *
 * `children` entra como prop desde un Server Component: envolver el árbol acá
 * NO convierte las páginas en client components.
 */
interface CopilotoCtx {
  abierto: boolean;
  abrir: () => void;
  cerrar: () => void;
  alternar: () => void;
  clienteId: string | null;
  estado: EstadoCliente | null;
  /** Abre el panel y manda la pregunta. Lo usan los botones del cockpit. */
  preguntar: (texto: string) => void;
  registrarCliente: (id: string, estado: EstadoCliente) => void;
  liberarCliente: () => void;
}

const Ctx = createContext<CopilotoCtx | null>(null);

export function useCopiloto(): CopilotoCtx {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error("useCopiloto necesita estar dentro de <CopilotoProvider>");
  }
  return ctx;
}

export function CopilotoProvider({ children }: { children: ReactNode }) {
  // Arranca cerrado también en el servidor: la apertura automática del cockpit
  // ocurre en un effect, después de hidratar, y así no hay mismatch.
  const [abierto, setAbierto] = useState(false);
  const [clienteId, setClienteId] = useState<string | null>(null);
  const [estado, setEstado] = useState<EstadoCliente | null>(null);
  const chatRef = useRef<CopilotoHandle>(null);

  const abrir = useCallback(() => setAbierto(true), []);
  const cerrar = useCallback(() => setAbierto(false), []);
  const alternar = useCallback(() => setAbierto((v) => !v), []);

  const registrarCliente = useCallback(
    (id: string, nuevo: EstadoCliente) => {
      setClienteId((previo) => {
        // Solo abrir al ENTRAR a un cliente distinto. Si se abriera en cada
        // registro, cambiar de canal en el simulador reabriría un panel que el
        // asesor acaba de cerrar.
        if (previo !== id) setAbierto(true);
        return id;
      });
      setEstado((previo) =>
        previo &&
        previo.abstenerse === nuevo.abstenerse &&
        previo.tieneRutaMt === nuevo.tieneRutaMt
          ? previo
          : nuevo,
      );
    },
    [],
  );

  const liberarCliente = useCallback(() => {
    setClienteId(null);
    setEstado(null);
    setAbierto(false);
  }, []);

  const preguntar = useCallback((texto: string) => {
    setAbierto(true);
    chatRef.current?.preguntar(texto);
  }, []);

  const valor = useMemo(
    () => ({
      abierto,
      abrir,
      cerrar,
      alternar,
      clienteId,
      estado,
      preguntar,
      registrarCliente,
      liberarCliente,
    }),
    [
      abierto,
      abrir,
      cerrar,
      alternar,
      clienteId,
      estado,
      preguntar,
      registrarCliente,
      liberarCliente,
    ],
  );

  return (
    <Ctx.Provider value={valor}>
      {children}
      <PanelFlotante chatRef={chatRef} />
    </Ctx.Provider>
  );
}
