# Como um livro novo vira mente

Existem **dois caminhos**, com propósitos diferentes. Não são intercambiáveis.

## Caminho A — o usuário adiciona pelo app (self-service)

Já existe e funciona: Estante → adicionar livro → escolhe PDF/EPUB/DOCX → `extractFileText()` (pdf.js / mammoth / jszip, via CDN) → `POST /mente` no Worker → volta `dominio`, `tese`, `convoque`, `md`, `desc`, `cat` → entra em `userLib` e é mesclado em `BOOKS`/`MENTES`.

Também dá para disparar isso de dentro de uma conversa: o card "Livros que fortaleceriam a mesa" tem o botão **"já tenho o arquivo → sentar na mesa"**, que abre o modal preenchido e, quando a mente fica pronta, **senta ela na mesa aberta** (flag `sentarDepois`).

**Limite:** vive só no `localStorage` daquele navegador. Some se limpar os dados, não existe no celular, capa é gerada (`genCover`), trecho limitado a 7000 chars do começo do arquivo.

## Caminho B — ingestão permanente (entra no arquivo publicado)

É o que produz entrada de qualidade: capa real da página 1, trecho de três janelas do miolo, e dossiê escrito à mão lendo o livro.

**Pasta de entrada:** `Livros em PDF/_Entrada/` no Google Drive dele (`~/Library/CloudStorage/GoogleDrive-.../My Drive/03 - ESTUDOS : CURSOS/Livros em PDF`). Precisa estar conectada à sessão.

**Passos:**

1. **Extrair** — `ingest.py <pdf> <categoria>` gera três arquivos em `~/ing/out/`:
   - `<hash>.jpg` — capa da página 1 via `pdftoppm`, redimensionada para 320px de largura (o padrão das outras)
   - `<hash>.txt` — trecho de ~7000 chars, 3 janelas em 25%/50%/72% do livro, 2 páginas cada (mesmo algoritmo do `extract2.py` original)
   - `<hash>.pack.txt` — INÍCIO (índice/intro) + MEIO + FIM, ~27k chars, **para você ler e escrever o dossiê**

   `hash = md5(categoria + "/" + nomeDoArquivo)`. A categoria entra no hash, então **decida a categoria antes** — mudar depois obriga a recalcular.

2. **Ler o pack e escrever o dossiê.** Este é o passo que não se automatiza; é o que dá valor à estante. Siga exatamente o formato das mentes existentes:
   `**Domínio/lente:**` · `**Tese central:**` · `**Convoque para:**` · `**NÃO convoque para:**` · `**Frameworks/modelos:**` · `**Posições fortes:**` · `**Anti-padrões:**` · `**Passagens-âncora:**`

   O `NÃO convoque para` importa tanto quanto o resto — é o que evita a mente ser chamada para o problema errado.

3. **Inserir** — `insert.py index.html <pasta-assets> meta.json md.txt` acrescenta um objeto no fim de `BOOKS` e outro no fim de `MENTES`, por cirurgia de string (`s.index('];\n', i)`), sem reserializar nada. Aborta se o hash já existir.

   Campos do BOOK: `cat, titulo, autor, autor_norm, hash, has_cover, cover (base64), file, desc, muda, ganchos[], txt`
   Campos da MENTE: `id (= hash do book), titulo, autor, dominio, tese, convoque, md`

4. **Arquivar** — copie a capa para `Livros em PDF/.capas/<hash>.jpg`, mova o PDF para a pasta da categoria com nome limpo (`Título - Autor.pdf`), e o original para `_Entrada/_processados/`.

5. **Verificar** — `node --check` no JS extraído + Playwright: busca acha o livro, gaveta abre, capa renderiza, contagens subiram.

**Antes de ingerir, cheque duplicata por autor.** "O Mito do Empreendedor" foi recusado porque é a tradução de "The E-Myth Revisited", que já estava lá — e como a mesa deduplica por autor, a segunda entrada nunca seria convocada.

## Esquema do hash — inconsistência histórica

Os livros antigos não seguem uma regra só: `md5(cat + "/" + file)` bate em 188 dos 305 originais, `md5(file)` em 26, o resto veio de outros lotes. **Não tente derivar o hash de um livro existente** — leia do `BOOKS`. Para livro novo, use `md5(cat + "/" + file)`.
