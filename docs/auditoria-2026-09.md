# Auditoria — setembro/2026

Auditoria estratégica feita sobre o código em produção. Números medidos, não estimados. Atualizada conforme os itens foram sendo resolvidos.

## O quadro

**O ativo:** 306 dossiês técnicos extraídos do texto real dos livros — voz, tese, frameworks, anti-padrões, passagens-âncora — mais um orquestrador que faz as mentes *discordarem*. Não é um chatbot com livros no prompt; é uma estrutura de conhecimento. É defensável e difícil de copiar.

**O gargalo:** o produto se chama biblioteca inteligente e **não tem busca**. Nenhum embedding, nenhum índice vetorial, nenhuma leitura de conteúdo na hora de decidir. A busca da estante é `includes()` de substring. A escolha das mentes manda os 307 livros descritos numa linha cada para o modelo ler inteiro, a cada convocação.

## Inventário medido

| métrica | valor |
|---|---|
| Livros / Mentes | 307 / 306 |
| `index.html` cru / gzip | 10,5 MB / ~6,5 MB |
| Capas base64 | ~6,8 MB (65% do arquivo) |
| Campo `txt` (trechos) | ~2,1 MB — média 6.876 chars/livro |
| Dossiê `md` | média 2.867 chars |
| Roster enviado a `/cast` e `/librarian` | 111.872 chars (~27k tokens) **por chamada** |
| Dossiês por turno de `/council` | até 3.500 × N mentes — mesa de 5 ≈ 17,5k chars, **todo turno** |

## Resolvido

- **Motor era proxy aberto do Gemini** → portão em todas as rotas: allowlist de origem, 150 chamadas/IP/hora no D1, teto de 3 MB por corpo. `Origin` é spoofável por script: barra abuso oportunista e curl cru, não barra atacante dedicado. Próximo passo, se aparecer abuso real, é Turnstile.
- **Zero observabilidade** → tabela `log` no D1, uma linha por chamada cobrada, gravada via `ctx.waitUntil` fora do caminho crítico.
- **Falhas de gravação silenciosas** → `lsSet()` único que avisa na tela na primeira falha.
- **Estado só no navegador** → backup/restaurar em JSON (mitigação, não solução; sync continua em aberto).
- **`@` com instrução contraditória** → o Worker passou a ler o campo `to`.
- **Conversa avulsa nunca era salva** → botão "salvar em projeto" no cabeçalho da mesa, com adoção retroativa da conversa em andamento.
- **`/council` estourava o teto de saída** → 8192 tokens e erro `muito_longo` explícito em vez de 502 genérico.
- **Espera infinita sem timeout** → 90s com `AbortController`, no máximo 2 tentativas, contador de segundos na tela.

## Em aberto, por prioridade

### 1. Retrieval com Vectorize — a decisão estruturante
~27k tokens de entrada só para escolher quem senta na mesa, antes de qualquer resposta. O campo `txt` — 2,1 MB de texto real de livro — **nunca é usado na escolha das mentes**, só no chat individual do livro. A 600 livros o roster dobra e a qualidade degrada: o modelo passa a escolher por posição, não por mérito.

Cloudflare Vectorize está na mesma conta. Indexar dossiês + trechos, fazer retrieval top-30, e só então pedir ao LLM para curar entre esses. Corta ~90% do payload de seleção e passa a considerar o conteúdo real.

**É a única mudança que muda o teto do produto.** Esforço médio, impacto muito alto.

### 2. Não existe avaliação
Com 306 mentes e um motor inteiramente feito de prompt, não há como saber se uma mudança melhorou ou piorou. Um conjunto de 20 problemas-teste com rubrica (a mesa escolheu ângulos diferentes? as mentes discordaram? a fala está fundada no dossiê?) já daria sinal. Esforço: 1 dia. Impacto alto e composto.

### 3. 10,5 MB antes do primeiro pixel
Gzip só leva a ~6,5 MB porque base64 de JPEG não comprime. Em ordem de retorno: (a) capas como arquivos separados com `loading="lazy"` → −6,8 MB de uma vez; (b) `txt` e `md` sob demanda por hash → −3 MB; (c) `BOOKS`/`MENTES` como JSON externo cacheado no edge. Depois de (a) e (b) o HTML cai para centenas de KB e o projeto volta a ser editável por ferramentas normais.

Hoje é desconforto; em dois anos é o que impede o produto de existir no celular.

### 4. Custo por turno sem controle
`/council` remonta o prompt inteiro a cada turno: dossiês completos + histórico completo + memória do projeto. Sem cache, sem resumo do histórico antigo. Caminhos: context caching do Gemini para a parte estável, resumo progressivo do histórico, dossiê integral só no primeiro turno. Agora dá para medir o antes e o depois.

### 5. Saída do modelo entra no DOM sem sanitização
`text: linkBooks(rp.txt)` vai para `innerHTML`. É proposital (permite `<b>`), mas é HTML livre, e os dossiês chegam do cliente. Allowlist de tags resolve em ~1h.

### 6. Sync entre dispositivos
O `classic.html` já tem o padrão funcionando com o D1. Portar o cliente é fácil; decidir a semântica de merge de projetos e conversas é que não.

## Fora do escopo desta auditoria
- **Custo em dinheiro** — dá para medir volume de tokens, não preço. Com o log ligado, o número real aparece.
- **Comportamento de usuários reais** — não há analytics; tudo aqui é análise estática de código e payload.
- **`os.html`** — não auditado; chama só o `/council` e ninguém o linka.
