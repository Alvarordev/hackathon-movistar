"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Search } from "lucide-react";

import { Button, Segmentado } from "@/components/ui/Button";
import { CANALES } from "@/lib/tipos";

interface Props {
  foco: string;
  canal?: string;
  soloNunca: boolean;
  accion?: string;
}

export function FiltrosCola({ foco, canal, soloNunca, accion }: Props) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [busqueda, setBusqueda] = useState("");

  function aplicar(cambios: Record<string, string | undefined>) {
    const sp = new URLSearchParams();
    const estado = {
      foco,
      canal,
      solo_nunca_ofertados: soloNunca ? "true" : undefined,
      accion,
      ...cambios,
    };
    for (const [k, v] of Object.entries(estado)) {
      if (v) sp.set(k, v);
    }
    // `pagina` se descarta a propósito: cambiar un filtro cambia el conjunto,
    // y quedarse en la página 40 de un resultado que ahora tiene 3 deja la
    // pantalla vacía sin explicar por qué.
    iniciar(() => router.push(`/?${sp.toString()}`));
  }

  function buscar(e: React.FormEvent) {
    e.preventDefault();
    const id = busqueda.trim().toUpperCase();
    if (id) router.push(`/clientes/${id}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmentado
        etiqueta="Foco"
        valor={foco === "todos" ? "todos" : "mt"}
        onCambiar={(v) => aplicar({ foco: v })}
        opciones={[
          { valor: "mt", etiqueta: "Blindaje MT" },
          { valor: "todos", etiqueta: "Todo el portafolio" },
        ]}
      />

      <Segmentado
        etiqueta="Canal"
        valor={canal ?? "todos"}
        onCambiar={(v) => aplicar({ canal: v === "todos" ? undefined : v })}
        opciones={[
          { valor: "todos", etiqueta: "Todos" },
          ...CANALES.map((c) => ({ valor: c as string, etiqueta: c })),
        ]}
      />

      <Button
        variante={soloNunca ? "primario" : "outline"}
        onClick={() =>
          aplicar({ solo_nunca_ofertados: soloNunca ? undefined : "true" })
        }
        aria-pressed={soloNunca}
        title="Clientes elegibles a los que nunca se les ofreció Movistar Total"
      >
        Nunca se le ofreció MT
      </Button>

      <Button
        variante={accion === "recordatorio" ? "primario" : "outline"}
        onClick={() =>
          aplicar({ accion: accion === "recordatorio" ? undefined : "recordatorio" })
        }
        aria-pressed={accion === "recordatorio"}
        title="Clientes que ya aceptaron Movistar Total y quedaron con la contratación pendiente"
      >
        Seguimientos pendientes
      </Button>

      {pendiente ? (
        <Loader2 size={15} className="animate-spin text-tinta-3" />
      ) : null}

      <form onSubmit={buscar} className="relative ml-auto">
        <Search
          size={14}
          className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-tinta-3"
        />
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar cliente (CLI000013)"
          aria-label="Buscar cliente por identificador"
          className="w-56 rounded-md border border-borde bg-superficie py-1.5 pr-2.5 pl-8 text-cuerpo outline-none placeholder:text-tinta-3 focus:border-acento-borde focus:ring-2 focus:ring-acento-suave"
        />
      </form>
    </div>
  );
}

