import type { ReactNode } from "react";
import Link from "next/link";
import { Headset } from "lucide-react";

import { NavPrincipal } from "@/components/ui/NavPrincipal";
import "./globals.css";

export const metadata = {
  title: "Copiloto NBO",
  description: "Asistente de oferta para asesores comerciales",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body className="flex h-full flex-col">
        <header className="flex h-12 shrink-0 items-center gap-5 border-b border-borde bg-superficie px-4">
          <Link href="/" className="flex items-center gap-2">
            <span className="grid size-6 place-items-center rounded-md bg-acento text-superficie">
              <Headset size={14} />
            </span>
            <span className="text-sm font-semibold tracking-tight">
              Copiloto NBO
            </span>
          </Link>

          <NavPrincipal />

          <span className="ml-auto hidden text-[11px] text-tinta-3 sm:block">
            Panel de asistencia al asesor · demo
          </span>
        </header>

        <main className="min-h-0 flex-1">{children}</main>
      </body>
    </html>
  );
}
