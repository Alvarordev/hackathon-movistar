"""Renderiza el stream SSE del copiloto de forma legible en la terminal."""

import json
import sys

CYAN, VERDE, GRIS, ROJO, FIN = "\033[36m", "\033[32m", "\033[90m", "\033[31m", "\033[0m"


def main() -> None:
    texto = []
    for linea in sys.stdin:
        linea = linea.strip()
        if not linea.startswith("data: "):
            continue
        d = json.loads(linea[6:])

        if "toolName" in d and "args" in d:
            args = json.dumps(d["args"], ensure_ascii=False)
            print(f"  {CYAN}→ {d['toolName']}({args}){FIN}")
        elif "toolName" in d:
            print(f"  {VERDE}← {d['toolName']}: {d['resumen']}{FIN}")
        elif "delta" in d:
            texto.append(d["delta"])
        elif "finishReason" in d:
            print()
            print("".join(texto).strip())
            print(f"\n  {GRIS}[{d['finishReason']}, {d['toolCalls']} tool calls]{FIN}")
        elif "error" in d:
            print(f"  {ROJO}ERROR {d['error']}: {d.get('detalle', '')}{FIN}")


if __name__ == "__main__":
    main()
