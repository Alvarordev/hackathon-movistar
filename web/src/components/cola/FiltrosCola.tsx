"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Search } from "lucide-react";

import { CANALES } from "@/lib/tipos";

interface Props {
  foco: string;
  canal?: string;
  soloNunca: boolean;
}

export function FiltrosCola({ foco, canal, soloNunca }: Props) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [busqueda, setBusqueda] = useState("");

  function aplicar(cambios: Record<string, string | undefined>) {
    const sp = new URLSearchParams();
    const estado = { foco, canal, solo_nunca_ofertados: soloNunca ? "true" : undefined, ...cambios };
    for (const [k, v] of Object.entries(estado)) {
      if (v) sp.set(k, v);
    }
    iniciar(() => router.push(`/?${sp.toString()}`));
  }

  function buscar(e: React.FormEvent) {
    e.preventDefault();
    const id = busqueda.trim().toUpperCase();
    if (id) router.push(`/clientes/${id}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Grupo etiqueta="Foco">
        <Opcion activo={foco === "mt"} onClick={() => aplicar({ foco: "mt" })}>
          Blindaje MT
        </Opcion>
        <Opcion
          activo={foco === "todos"}
          onClick={() => aplicar({ foco: "todos" })}
        >
          Todo el portafolio
        </Opcion>
      </Grupo>

      <Grupo etiqueta="Canal">
        <Opcion activo={!canal} onClick={() => aplicar({ canal: undefined })}>
          Todos
        </Opcion>
        {CANALES.map((c) => (
          <Opcion key={c} activo={canal === c} onClick={() => aplicar({ canal: c })}>
            {c}
          </Opcion>
        ))}
      </Grupo>

      <button
        type="button"
        onClick={() =>
          aplicar({ solo_nunca_ofertados: soloNunca ? undefined : "true" })
        }
        aria-pressed={soloNunca}
        className={`rounded-md border px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
          soloNunca
            ? "border-acento-borde bg-acento-suave text-acento"
            : "border-borde bg-superficie text-tinta-2 hover:bg-superficie-2"
        }`}
        title="Clientes elegibles a los que nunca se les ofreció Movistar Total"
      >
        Nunca se le ofreció MT
      </button>

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
          className="w-56 rounded-md border border-borde bg-superficie py-1.5 pr-2.5 pl-8 text-[13px] outline-none placeholder:text-tinta-3 focus:border-acento-borde focus:ring-2 focus:ring-acento-suave"
        />
      </form>
    </div>
  );
}

function Grupo({
  etiqueta,
  children,
}: {
  etiqueta: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1 rounded-md border border-borde bg-superficie p-0.5">
      <span className="px-1.5 text-[11px] font-medium text-tinta-3">
        {etiqueta}
      </span>
      {children}
    </div>
  );
}

function Opcion({
  activo,
  onClick,
  children,
}: {
  activo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      className={`rounded px-2 py-1 text-[13px] font-medium transition-colors ${
        activo
          ? "bg-acento-suave text-acento"
          : "text-tinta-2 hover:bg-superficie-2"
      }`}
    >
      {children}
    </button>
  );
}
