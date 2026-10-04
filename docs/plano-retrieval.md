# Plano — dar o livro inteiro pra cada mente (retrieval) + fixar modelos

**Objetivo:** hoje cada mente responde a partir de um dossiê de ~3 mil caracteres (`MENTES[].md`). O texto da obra quase não entra no `/council`. Este plano indexa o texto completo dos PDFs no Cloudflare Vectorize e, a cada pergunta, entrega a cada mente os trechos do próprio livro que tratam do assunto. Efeito colateral desejado: o `/cast` deixa de mandar 112 mil caracteres de roster por convocação.

Leia `CLAUDE.md` antes. Este plano não muda nenhuma regra de lá.

> **Estado em 04/10/2026 — código pronto, falta ligar. Versão do PLANO GRATUITO (decisão do Rodrigo: não assinar Workers Paid).**
> - **Troca de peça:** em vez de Vectorize + embeddings (exigem Workers Paid), a busca é **por texto, no D1 com FTS5**, num banco separado (`superlivros-trechos`, binding `TRECHOS`). Como os livros são quase todos em inglês e a pergunta vem em português, uma chamada curta no Flash (`termosDeBusca`) devolve os conceitos nas duas línguas antes de buscar (~US$ 0,001 por turno, +1-3 s).
> - **Medido com os dados reais (SQLite local, mesmo esquema):** 82.002 trechos de 305 livros = **260 MB** (o teto do D1 gratuito é 500 MB por banco; sobra espaço pra ~200 livros). Busca da lista curta: ~20 ms; trechos de um livro: ~4 ms.
> - **Limite do gratuito que importa:** ~100 mil linhas gravadas por dia na conta. A carga inicial deve levar **2 a 3 dias** de `node docs/scripts/indexar.mjs` (ele para sozinho no teto e continua de onde parou). Enquanto o teto do dia estiver estourado, o portão do motor (limite por IP e log, que também gravam no D1) fica sem contar — o conselho continua respondendo.
> - **Passo 0 ✅** `docs/evals/` (6 conversas reais + 12 escritas, `rodar.mjs`, `comparar.mjs`).
> - **Passo 3 ✅ rodado:** `.indice/trechos.ndjson` (fora do git). Ficaram de fora 4 escaneados e 1 sem PDF (Não Me Faça Pensar) — `.indice/relatorio.txt`.
> - **No motor, com fallback em tudo:** sem o banco, ou se a busca falhar/demorar mais de 12 s, responde exatamente como antes. `/council` busca até 4 trechos por mente (`livro:"<hash>" AND (termos)`, bm25) e exige `quote_orig` literal. `/cast` monta a lista curta (40 livros pelo texto + 15 por palavra + quem o usuário costuma chamar + mentes locais) e roda a curadoria no **Pro**; com menos de 10 livros achados, roster inteiro no Flash como hoje. `/indexar` grava 33 trechos por chamada (limite de 100 parâmetros do D1), só com o cabeçalho `X-Index-Key`. Testado com SQLite de verdade por baixo (24 testes).
> - **Falta (Rodrigo, no Terminal):** `bash docs/scripts/ativar-retrieval.sh` → `node docs/scripts/indexar.mjs` (repetir nos dias seguintes até terminar) → Passo 7.
> - Os Passos 2, 4, 5 e 6 abaixo descrevem a versão com Vectorize; ficam como registro. Se um dia a conta for pro Workers Paid, dá pra trocar a busca por embeddings sem mexer no resto.

---

## Números medidos (04/10/2026)

| | |
|---|---|
| PDFs na biblioteca | 310 (em `Livros em PDF/<categoria>/`, Google Drive do Rodrigo) |
| Texto por livro (amostra de 24) | média **~514 mil caracteres** |
| Sem texto extraível (escaneado) | 1 em 24 na amostra — esperar ~10-15 livros assim no total |
| Texto total estimado | **~160 milhões de caracteres** |
| Trechos estimados (1.800 chars, sobreposição 200) | **~100 mil** |

## Custo estimado (preços oficiais consultados em 04/10/2026)

- **Embedding (uma vez):** Workers AI `@cf/baai/bge-m3` a US$ 0,0118 por milhão de tokens de entrada → ~40M tokens → **~US$ 0,50 no total**.
- **Vectorize (por mês):** ~100 mil vetores × 1024 dimensões ≈ 102M dimensões armazenadas e consultadas. No plano Workers Paid: armazenamento ~US$ 0,05 + consulta ~US$ 0,52 → **~US$ 0,60/mês**. Fórmula oficial: `(vetores consultados + vetores armazenados) × dimensões`.
- **Pré-requisito:** isso **não cabe no plano gratuito** (limite de 5M dimensões armazenadas). Exige **Workers Paid (US$ 5/mês)**. Confirmar com o Rodrigo qual plano a conta está antes de começar.

---

## Passo 0 — Banco de teste ANTES de mexer em qualquer coisa

Sem isto não dá pra saber se o resultado melhorou.

1. Pedir ao Rodrigo 15-20 perguntas reais que ele já fez à mesa (ou tirar das conversas salvas nos projetos — `localStorage.slos_projects`, campo `convos[].thread`).
2. Salvar em `docs/evals/perguntas.md` com a mesa usada em cada uma.
3. Script que roda cada pergunta contra o `/council` atual e grava a saída em `docs/evals/baseline/`. Mesma mesa, mesma pergunta, para comparar lado a lado depois.

Critérios de comparação (julgamento humano, lado a lado): a fala está fundada no livro ou é genérica? A citação é uma passagem que responde à pergunta ou a frase-âncora de sempre? As mentes discordam de verdade?

## Passo 1 — Modelos ✅ FEITO (04/10/2026)

> **Já implementado e testado — não refazer.** O que existe hoje no `worker/worker.js`:
> - Constantes `FLASH = "gemini-3.8-flash"`, `PRO = "gemini-3.1-pro-preview"`, `ALIAS_SEGURO = "gemini-flash-latest"`. Todas as rotas usam `FLASH`.
> - `askGeminiModel` aceita `timeoutMs` e, se o nome fixo do modelo sumir (HTTP 404), refaz no `ALIAS_SEGURO`.
> - `askComFallback(env, preferido, ...)`: se o preferido for o Pro e falhar (erro ou 70s sem resposta), refaz no Flash. Não faz fallback em `muito_longo`, que estouraria igual.
> - `/verdict` sempre no Pro, com fallback. `/council` no Pro **só quando o front manda `pro: true`**.
> - As duas rotas devolvem `modelo` no corpo e no cabeçalho `X-Modelo`; o portão grava o modelo na coluna nova `log.modelo` (criada por `ALTER TABLE`, com fallback de insert sem a coluna).
>
> **No site, botão "⚡ mais inteligente"** no cabeçalho da mesa: liga o Pro no `/council` só para aquela conversa. O estado é salvo na conversa (`convos[].pro`), volta ao reabrir e zera em "novo assunto". Com ele ligado, o timeout do front vai de 90s para 150s, a espera mostra "a mesa tá pensando com calma…", e se o motor cair pro Flash aparece um aviso na conversa.
>
> 14 testes do motor com Gemini e D1 simulados + Playwright no front, todos passando.

O texto abaixo é o registro da decisão.


Hoje tudo usa o alias `gemini-flash-latest`, que **pode trocar de modelo sozinho** sem aviso. Fixar IDs explícitos.

**Decisão do Rodrigo (04/10/2026): custo importa.** O Pro custa ~3× o Flash por token e, aplicado ao conselho inteiro, levaria o gasto de ~US$ 8 para ~US$ 23-31/mês. Então:

| rota | modelo | preço (entrada / saída, por 1M tokens) |
|---|---|---|
| `/verdict` (só o "Fechar a mesa", ~1 por conversa) | `gemini-3.1-pro-preview` | US$ 2,00 / 12,00 |
| **todo o resto, inclusive `/council`** | `gemini-3.8-flash` | US$ 0,75 / 3,75 (promocional até 31/12/2026) |

- O Pro é **preview**: pode mudar ou ser descontinuado. **Fallback** obrigatório: se o Pro falhar (erro HTTP ou timeout), refazer a mesma chamada no `gemini-3.8-flash` e marcar no log qual modelo respondeu.
- Acrescentar a coluna `modelo` na tabela `log` do D1 (`ALTER TABLE`, com o `CREATE TABLE IF NOT EXISTS` atualizado).
- **Pro no `/council` só entra se o banco de teste mostrar, depois do Passo 7, que o Flash com o livro inteiro ainda é o gargalo.** Não antecipar.
- Atenção ao preço do Flash: o valor é promocional até 31/12/2026. Reavaliar em dezembro.

## Passo 2 — Infra

```
npx wrangler vectorize create superlivros-trechos --dimensions=1024 --metric=cosine
npx wrangler vectorize create-metadata-index superlivros-trechos --property-name=livro --type=string
```

> **O índice de metadado precisa existir ANTES de inserir qualquer vetor.** Vetores inseridos antes não ficam filtráveis por `livro`.

Confirmar na documentação atual que o `bge-m3` devolve 1024 dimensões antes de criar o índice.

`wrangler.toml`:
```toml
[ai]
binding = "AI"

[[vectorize]]
binding = "VEC"
index_name = "superlivros-trechos"
```

## Passo 3 — Extração e corte em trechos (roda no Mac do Rodrigo)

Script em `docs/scripts/` (não versionar a saída — são ~160 MB de texto):

1. Para cada livro de `BOOKS`, achar o PDF em `Livros em PDF/<cat>/<file>`. **Os nomes não batem 100%** (o hash tem 3 esquemas históricos, ver `docs/pipeline-livros.md`). Casar por `file` primeiro, depois por nome normalizado. **Relatório dos que não casaram** — não pular em silêncio.
2. `pdftotext` do livro inteiro. Livro com menos de 20 mil caracteres = escaneado → listar e pular.
3. Cortar a capa e a parte pré-textual (copyright, elogios, sumário) e o fim (notas, índice remissivo, agradecimentos): descartar os primeiros ~4% e os últimos ~6%, ou detectar por palavra-chave.
4. Trechos de ~1.800 caracteres com 200 de sobreposição, **cortando em fim de frase**.
5. Saída NDJSON: `{"id":"<hash>-<n>","livro":"<hash>","txt":"..."}`.

## Passo 4 — Rota de indexação no Worker

`POST /indexar`, protegida por segredo (`npx wrangler secret put INDEX_KEY`), **isenta do portão de origem só quando o cabeçalho de segredo confere**. Recebe lotes de ~50 trechos:

```js
const { data } = await env.AI.run('@cf/baai/bge-m3', { text: lote.map(t => t.txt) });
await env.VEC.upsert(lote.map((t, i) => ({
  id: t.id, values: data[i], metadata: { livro: t.livro, txt: t.txt }
})));
```

Guardar o `txt` no metadado faz a busca devolver o texto direto, sem segunda consulta. Conferir o limite de tamanho de metadado por vetor na doc atual — 1.800 caracteres deve caber.

O script do Passo 3 manda os lotes pra essa rota a partir do Terminal do Mac. Deve ser **retomável**: grava o último lote confirmado e recomeça dali se cair.

## Passo 5 — `/council` com trechos do livro

1. Montar a consulta com a última mensagem do usuário + o `problem`.
2. Gerar o embedding uma vez (`env.AI.run`).
3. Para cada mente da mesa: `env.VEC.query(vetor, { topK: 4, filter: { livro: mente.id }, returnMetadata: 'all' })`. Rodar as consultas **em paralelo** (`Promise.all`).
4. No prompt, cada mente ganha um bloco `TRECHOS DO LIVRO` logo abaixo do dossiê.
5. Regras novas no `councilPrompt`: a fala deve se apoiar nos trechos quando eles forem pertinentes; **o `quote` precisa ser literal de um dos trechos** (ou vazio), nunca inventado ou parafraseado.
6. **Se o Vectorize falhar, seguir sem trechos** — o conselho nunca pode cair por causa disso. Mesma filosofia do D1 no portão.

O payload de entrada cresce ~8 mil tokens por turno. Já entra no orçamento de 8192 de saída sem mudança, mas vigiar o `muito_longo`.

## Passo 6 — `/cast` sem mandar a estante inteira

> **Estado atual (04/10/2026):** o curador já recebe, de cada livro, a tese inteira (até 400 chars), o `convoque` e o "NÃO convoque" (extraído do `md`), com a regra de nunca escolher uma mente cujo "NÃO convoque" descreve o problema. A ordem do roster é embaralhada a cada montagem para tirar o viés de posição. Custo: ~80 mil tokens por montagem, ~US$ 0,06 por conversa nova no Flash.
>
> **O que este passo muda:** o retrieval reduz a lista a ~30 livros pelo conteúdo real, e esses 30 vão com **todos** os critérios acima. Com a lista curta, a montagem pode rodar no **Pro** (`askComFallback(env, PRO, ...)`) por ~US$ 0,02 a conversa. A montagem roda uma vez por conversa e decide tudo o que vem depois — é onde o Pro rende mais por centavo.


1. Embedding do problema.
2. `VEC.query` sem filtro, `topK` alto (conferir o máximo permitido na doc).
3. Agregar a pontuação por `livro` e ficar com os ~30 livros mais relevantes.
4. Mandar ao modelo **só esses 30** para a curadoria final, em vez do roster de 307.
5. Fallback para o roster completo atual se o Vectorize falhar.

## Passo 7 — Comparar

Rodar o banco de teste de novo e pôr ao lado do baseline e do resultado do Passo 1. Mostrar ao Rodrigo antes de publicar.

---

## Pegadinhas conhecidas

- **Perguntas em português, livros em inglês.** O `bge-m3` é multilíngue e deve casar português com inglês, mas **verificar no banco de teste** — se não casar bem, traduzir a consulta antes do embedding.
- Livros novos passam a exigir indexação também. Atualizar `docs/pipeline-livros.md` com o passo de indexar.
- O limite de 150 chamadas por IP por hora conta as chamadas de IA; a rota `/indexar` não deve entrar nessa conta.
- Não versionar trechos nem vetores no repo.

## Custo esperado depois do plano

Estimativa a ~15 turnos/dia (provavelmente acima do uso real — confirmar pelo log do D1):

| | por mês |
|---|---|
| Antes | ~US$ 8 |
| Depois (livro inteiro no Flash + Pro só no veredito) | **~US$ 11-12**, + US$ 0,60 do Vectorize, + US$ 5 do Workers Paid se a conta ainda não estiver nele |

## Fora deste plano, de propósito

- **Uma chamada por mente** (cada conselheiro pensando separado). Dobra o custo do turno e multiplica a latência — 5 chamadas em sequência pode passar dos 90 segundos de timeout atual. Decidir depois do Passo 7, com o banco de teste mostrando se vale.
