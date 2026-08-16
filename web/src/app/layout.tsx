import type { ReactNode } from "react";
import Link from "next/link";
import { Onest } from "next/font/google";
import { Headset } from "lucide-react";

import { CopilotoProvider } from "@/components/copiloto/CopilotoProvider";
import { NavPrincipal } from "@/components/ui/NavPrincipal";
import "./globals.css";

// Geométrica-humanista, cercana a la Telefónica Sans de la marca. Variable
// font: un solo archivo cubre de 400 a 700 sin pedir pesos sueltos.
const onest = Onest({
  subsets: ["latin"],
  variable: "--font-onest",
  display: "swap",
});

export const metadata = {
  title: "Copiloto NBO",
  description: "Asistente de oferta para asesores comerciales",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" className={onest.variable}>
      <body className="flex h-full flex-col">
        {/* Header oscuro: el chrome de la herramienta se despega del contenido
            sin necesidad de una línea divisoria, y deja claro que el copiloto
            es una capa sobre el sistema, no otra pantalla más. */}
        <header className="flex h-12 shrink-0 items-center gap-5 bg-marino px-4 text-white">
          <Link href="/" className="flex items-center gap-2">
            <span className="grid size-6 place-items-center rounded-md bg-marca text-white">
              <Headset size={14} />
            </span>
            <span className="text-sm font-semibold tracking-tight">
              Copiloto NBO
            </span>
          </Link>

          <NavPrincipal />

          <span className="ml-auto hidden text-etiqueta text-white/45 sm:block">
            Panel de asistencia al asesor · demo
          </span>
        </header>

        {/* El provider envuelve a `children` como prop: las páginas siguen
            siendo server components, y el chat sobrevive a la navegación
            porque el layout no se remonta. */}
        <CopilotoProvider>
          <main className="min-h-0 flex-1">{children}</main>
        </CopilotoProvider>
      </body>
    </html>
  );
}
