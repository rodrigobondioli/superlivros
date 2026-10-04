#!/usr/bin/env python3
"""Extrai o texto inteiro de cada livro da estante e corta em trechos pro retrieval.

Saída em <repo>/.indice/ (fora do git):
  trechos.ndjson   uma linha por trecho: {"id":"<hash>-<n>","livro":"<hash>","txt":"..."}
  feitos.txt       livros já processados (hash<TAB>status<TAB>n_trechos)
  relatorio.txt    o que não deu: PDF não encontrado, escaneado (sem texto)

Retomável: roda de novo e ele continua de onde parou. Livro novo na estante = roda de novo.
  python3 docs/scripts/trechos.py --pdfs "/caminho/Livros em PDF" [--limite-segundos 150] [--livro <hash>]
Precisa do pdftotext (poppler).
"""
import argparse, json, os, re, subprocess, sys, time, unicodedata

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
IDX = os.path.join(RAIZ, ".indice")
TAM, SOBRA = 1800, 200          # tamanho do trecho e sobreposição, em caracteres
MIN_TEXTO = 20000               # abaixo disso o PDF é escaneado (imagem), sem texto útil

def books():
    with open(os.path.join(RAIZ, "index.html"), encoding="utf-8") as f:
        for l in f:
            if l.startswith("const BOOKS = "):
                return json.loads(l[l.index("["):l.rindex("]") + 1])
    sys.exit("não achei BOOKS no index.html")

def nrm(s):
    s = unicodedata.normalize("NFD", s.lower())
    return re.sub(r"[^a-z0-9]", "", "".join(c for c in s if unicodedata.category(c) != "Mn"))

def acha_pdf(raiz, b, todos):
    p = os.path.join(raiz, b["cat"], b["file"])
    if os.path.exists(p):
        return p
    alvo = nrm(os.path.splitext(b["file"])[0])
    nomes = [(q, nrm(os.path.splitext(os.path.basename(q))[0])) for q in todos]
    for q, n in nomes:                      # mesmo arquivo em outra pasta, ou com acento/espaço diferente
        if n == alvo:
            return q
    if len(alvo) >= 12:                     # nome com autor no fim, ou prefixo de site no começo
        for q, n in nomes:
            if alvo in n:
                return q
    return None

def limpa(t):
    t = t.replace("\f", "\n")
    t = re.sub(r"(?i)oceanofpdf\.com|z-library|z-lib\.org|libgen\.\w+", "", t)   # marca d'agua de site
    t = re.sub(r"(?m)^\s*\d{1,4}\s*$", "", t)              # número de página solto
    t = re.sub(r"(\w)-\n(\w)", r"\1\2", t)                # hifenização no fim da linha
    t = re.sub(r"\n{2,}", " ", t)                     # parágrafo
    t = re.sub(r"\s*\n\s*", " ", t)                        # quebra de linha dentro do parágrafo
    t = re.sub(r"[ \t ]+", " ", t)
    return "\n".join(p.strip() for p in t.split(" ") if p.strip())

def corta(t):
    # tira a parte pré-textual (créditos, elogios, sumário) e o fim (notas, índice, agradecimentos)
    t = t[int(len(t) * 0.04): int(len(t) * 0.94)]
    out, i = [], 0
    while i < len(t):
        fim = min(i + TAM, len(t))
        if fim < len(t):                                     # termina em fim de frase, se der
            janela = t[fim - 400:fim]
            m = max(janela.rfind(". "), janela.rfind("? "), janela.rfind("! "), janela.rfind(".\n"))
            if m > 0:
                fim = fim - 400 + m + 1
        pedaco = t[i:fim].strip()
        if len(pedaco) > 200:
            out.append(pedaco)
        if fim >= len(t):
            break
        i = max(fim - SOBRA, i + 1)
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdfs", required=True, help='pasta "Livros em PDF"')
    ap.add_argument("--limite-segundos", type=int, default=0, help="para sozinho depois de N segundos (retomável)")
    ap.add_argument("--livro", default="", help="só este hash")
    a = ap.parse_args()
    os.makedirs(IDX, exist_ok=True)
    feitos_p = os.path.join(IDX, "feitos.txt")
    feitos = set()
    if os.path.exists(feitos_p):
        # sem_pdf/erro nao contam como feito: tenta de novo na proxima rodada
        feitos = {l.split("\t")[0] for l in open(feitos_p, encoding="utf-8") if l.strip() and l.split("\t")[1] in ("ok", "escaneado")}
    todos = []
    for d, _, fs in os.walk(a.pdfs):
        if "/_to_delete" in d:
            continue
        todos += [os.path.join(d, f) for f in fs if f.lower().endswith(".pdf")]
    lista = [b for b in books() if b["hash"] not in feitos and (not a.livro or b["hash"] == a.livro)]
    t0, n_ok = time.time(), 0
    with open(os.path.join(IDX, "trechos.ndjson"), "a", encoding="utf-8") as out, \
         open(feitos_p, "a", encoding="utf-8") as fe, \
         open(os.path.join(IDX, "relatorio.txt"), "a", encoding="utf-8") as rel:
        for b in lista:
            if a.limite_segundos and time.time() - t0 > a.limite_segundos:
                break
            pdf = acha_pdf(a.pdfs, b, todos)
            if not pdf:
                rel.write(f"SEM PDF\t{b['hash']}\t{b['cat']}/{b['file']}\n"); fe.write(f"{b['hash']}\tsem_pdf\t0\n"); continue
            try:
                txt = subprocess.run(["pdftotext", "-enc", "UTF-8", pdf, "-"], capture_output=True, timeout=120).stdout.decode("utf-8", "ignore")
            except Exception as e:
                rel.write(f"ERRO\t{b['hash']}\t{pdf}\t{e}\n"); fe.write(f"{b['hash']}\terro\t0\n"); continue
            txt = limpa(txt)
            if len(txt) < MIN_TEXTO:
                rel.write(f"ESCANEADO\t{b['hash']}\t{b['titulo']}\t{len(txt)} chars\n"); fe.write(f"{b['hash']}\tescaneado\t0\n"); continue
            ts = corta(txt)
            for k, t in enumerate(ts):
                out.write(json.dumps({"id": f"{b['hash']}-{k}", "livro": b["hash"], "txt": t}, ensure_ascii=False) + "\n")
            out.flush()
            fe.write(f"{b['hash']}\tok\t{len(ts)}\n"); fe.flush()
            n_ok += 1
    ult = {}
    for l in open(feitos_p, encoding="utf-8"):
        if l.strip(): ult[l.split("\t")[0]] = l.split("\t")[1]
    resta = len([b for b in books() if b["hash"] not in ult])
    probl = sum(1 for v in ult.values() if v not in ("ok",))
    print(f"processados agora: {n_ok} · faltam: {resta} · sem texto ou sem PDF: {probl} (ver .indice/relatorio.txt)")

if __name__ == "__main__":
    main()
