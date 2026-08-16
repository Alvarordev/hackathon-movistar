"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { numero } from "@/lib/api";

/**
 * Paginación de la cola.
 *
 * Existe por una razón que no es de comodidad: sin ella la pantalla mostraba 50
 * clientes de 87,469 y no había forma de saber que existían los otros. Cincuenta
 * filas parecidas y ningún contexto se leen como un dataset recortado, no como
 * el techo de un ranking.
 *
 * Por eso el total va siempre visible, incluso en la única página de un
 * resultado chico.
 */
export function Paginacion({
  total,
  limit,
  offset,
}: {
  total: number;
  limit: number;
  offset: number;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pendiente, iniciar] = useTransition();

  const pagina = Math.floor(offset / limit) + 1;
  const paginas = Math.max(1, Math.ceil(total / limit));
  const desde = total === 0 ? 0 : offset + 1;
  const hasta = Math.min(offset + limit, total);

  function ir(p: number) {
    const sp = new URLSearchParams(params);
    // La página 1 no ensucia la URL: es el estado por defecto.
    if (p <= 1) sp.delete("pagina");
    else sp.set("pagina", String(p));
    const q = sp.toString();
    iniciar(() => router.push(q ? `/?${q}` : "/"));
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-3 pt-1">
      <p className="text-dato text-tinta-3">
        Mostrando{" "}
        <span className="tabular font-medium text-tinta-2">
          {numero(desde)}–{numero(hasta)}
        </span>{" "}
        de <span className="tabular font-medium text-tinta-2">{numero(total)}</span>{" "}
        clientes en cola
      </p>

      {pendiente ? (
        <Loader2 size={14} className="animate-spin text-tinta-3" />
      ) : null}

      <div className="ml-auto flex items-center gap-1.5">
        <span className="text-dato text-tinta-3">
          Página <span className="tabular">{numero(pagina)}</span> de{" "}
          <span className="tabular">{numero(paginas)}</span>
        </span>
        <Button
          variante="outline"
          tam="sm"
          disabled={pagina <= 1 || pendiente}
          onClick={() => ir(pagina - 1)}
          aria-label="Página anterior"
        >
          <ChevronLeft size={14} />
          Anterior
        </Button>
        <Button
          variante="outline"
          tam="sm"
          disabled={pagina >= paginas || pendiente}
          onClick={() => ir(pagina + 1)}
          aria-label="Página siguiente"
        >
          Siguiente
          <ChevronRight size={14} />
        </Button>
      </div>
    </div>
  );
}
