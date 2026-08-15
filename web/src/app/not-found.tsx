import Link from "next/link";
import { SearchX } from "lucide-react";

import { Panel, Vacio } from "@/components/ui/Base";

export default function NoEncontrado() {
  return (
    <div className="mx-auto max-w-lg p-8">
      <Panel>
        <Vacio
          icono={<SearchX size={24} />}
          titulo="Esta página no existe"
          detalle="Puede que el enlace esté mal escrito o que la vista se haya movido."
        />
        <div className="text-center">
          <Link
            href="/"
            className="text-[13px] font-medium text-acento hover:underline"
          >
            Volver a la cola de atención
          </Link>
        </div>
      </Panel>
    </div>
  );
}
