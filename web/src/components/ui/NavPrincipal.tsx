"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, ListChecks } from "lucide-react";

const ENLACES = [
  { href: "/", etiqueta: "Cola de atención", icono: ListChecks },
  { href: "/supervision", etiqueta: "Supervisión", icono: BarChart3 },
];

export function NavPrincipal() {
  const ruta = usePathname();

  return (
    <nav className="flex items-center gap-1">
      {ENLACES.map(({ href, etiqueta, icono: Icono }) => {
        // El cockpit vive bajo /clientes: se considera parte de la cola.
        const activo =
          href === "/"
            ? ruta === "/" || ruta.startsWith("/clientes")
            : ruta.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={activo ? "page" : undefined}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-cuerpo font-medium transition-colors duration-150 ease-fuerte outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
              activo
                ? "bg-white/12 text-white"
                : "text-white/60 hover:bg-white/8 hover:text-white/90"
            }`}
          >
            <Icono size={14} />
            {etiqueta}
          </Link>
        );
      })}
    </nav>
  );
}
