#!/usr/bin/env python3
"""Catálogo da estante para as pautas diárias (o motor lê isto para sortear o livro do dia).

Lê BOOKS do index.html por parse, sem reserializar nada, e grava dois arquivos em data/:
  catalogo-pautas.json          uma entrada por livro: {hash, titulo, autor, cat}.
                                Pequeno (~40 KB): o motor baixa e guarda em cache.
  catalogo-pautas-texto.ndjson  uma linha por livro: {hash, txt, ganchos, muda}.
                                É o fallback para livro sem trechos no índice (escaneado).
                                Fica separado porque tem ~2 MB: no plano gratuito da Cloudflare
                                cada chamada tem 10 ms de CPU, e parsear isso toda vez estouraria.
                                O motor só baixa quando precisa e acha a linha do livro por busca
                                de texto, sem parsear o arquivo inteiro.

Rode sempre que adicionar ou tirar livro da estante:
  python3 scripts/catalogo-pautas.py
"""
import io, json, os, re, sys

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
IDX = os.path.join(RAIZ, "index.html")
OUT = os.path.join(RAIZ, "data")


def books():
    with io.open(IDX, encoding="utf-8") as f:
        for l in f:
            if l.startswith("const BOOKS = "):
                return json.loads(l[l.index("["):l.rindex("]") + 1])
    sys.exit("não achei BOOKS no index.html")


def main():
    bs = books()
    os.makedirs(OUT, exist_ok=True)
    cat, texto, vistos = [], [], set()
    for b in bs:
        h = re.sub(r"[^a-z0-9]", "", str(b.get("hash", "")).lower())
        if not h or h in vistos:
            continue
        vistos.add(h)
        cat.append({"hash": h, "titulo": b.get("titulo", ""), "autor": b.get("autor", ""), "cat": b.get("cat", "")})
        txt = (b.get("txt") or "").strip()
        ganchos = [g for g in (b.get("ganchos") or []) if isinstance(g, str) and g.strip()]
        muda = (b.get("muda") or "").strip()
        if txt or ganchos or muda:
            texto.append({"hash": h, "txt": txt, "ganchos": ganchos, "muda": muda})
    with io.open(os.path.join(OUT, "catalogo-pautas.json"), "w", encoding="utf-8") as f:
        # uma entrada por linha: o diff do git mostra exatamente qual livro entrou ou saiu
        f.write("[\n" + ",\n".join(json.dumps(c, ensure_ascii=False) for c in cat) + "\n]\n")
    with io.open(os.path.join(OUT, "catalogo-pautas-texto.ndjson"), "w", encoding="utf-8") as f:
        for t in texto:
            # separators sem espaço: o motor acha a linha procurando por {"hash":"<hash>"
            f.write(json.dumps(t, ensure_ascii=False, separators=(",", ":")) + "\n")
    sem = len(cat) - len(texto)
    print("catálogo: %d livros em data/catalogo-pautas.json · texto de fallback para %d (%d sem nada) em data/catalogo-pautas-texto.ndjson" % (len(cat), len(texto), sem))


if __name__ == "__main__":
    main()
