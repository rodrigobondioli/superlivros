# Superlivros — instruções do repo

"A estante que pensa": 307 livros viram 306 conselheiros de IA que sentam numa mesa e discutem o problema do usuário, discordando entre si.

Site estático sem build e sem framework. **Leia este arquivo inteiro antes de tocar em qualquer coisa** — este repo tem armadilhas que quebram o fluxo normal de edição.

---

## ⚠️ A regra que muda tudo: NÃO LEIA o index.html inteiro

`index.html` tem **10,5 MB em 1.256 linhas**. Quase tudo está em duas linhas:

| linha | conteúdo | tamanho |
|---|---|---|
| `const BOOKS = [...]` | 310 livros (capas são arquivos em `capas/<hash>.jpg`, não base64) | **~2,3 MB numa linha só** |
| `const MENTES = [...]` | 306 dossiês | **1,1 MB numa linha só** |

Ler o arquivo com Read estoura o contexto. Grep devolve a linha inteira e faz o mesmo estrago.

**Para inspecionar o código da aplicação, filtre as linhas gigantes:**

```bash
awk 'length($0)<3000' index.html | grep -n "nomeDaFuncao"
awk 'length($0)<3000' index.html | sed -n '1080,1100p'
```

**Para ler os dados, parseie — não leia:**

```bash
python3 -c "
import re,io,json
s=io.open('index.html',encoding='utf-8').read()
B=json.loads(re.search(r'const BOOKS = (\[.*?\]);\n', s, re.S).group(1))
M=json.loads(re.search(r'const MENTES = (\[.*?\]);\n', s, re.S).group(1))
print(len(B),len(M))
"
```

> **Nunca reescreva as duas linhas de dados.** Nenhuma operação deve reserializar `BOOKS` ou `MENTES` — isso reformata 10 MB e destrói o diff. Só se acrescenta item novo por cirurgia de string (ver `docs/pipeline-livros.md`).

## Editar: só por script de substituição exata

Edit/Write em arquivo de 10 MB com linhas de 9 MB é frágil. O fluxo que funciona é um script Python de substituições exatas, que **falha alto** se o alvo não for único:

```python
import io,sys
P=sys.argv[1]
s=io.open(P,encoding='utf-8').read()
def sub(old,new,label):
    global s
    n=s.count(old)
    if n!=1: print('FALHOU (%d): %s'%(n,label)); sys.exit(1)
    s=s.replace(old,new); print('ok:',label)

sub("""trecho exato atual""", """trecho novo""", 'o que isso faz')

io.open(P,'w',encoding='utf-8').write(s)
```

Rodar o script é tudo ou nada: se um alvo não casar exatamente uma vez, ele aborta sem gravar. Isso já evitou vários estragos — mantenha.

## Verificar antes de entregar — sempre os dois passos

**1. O JS ainda parseia:**
```bash
python3 -c "
import io,re
s=io.open('index.html',encoding='utf-8').read()
io.open('/tmp/chk.js','w',encoding='utf-8').write(re.findall(r'<script>(.*?)</script>',s,re.S)[0])
" && node --check /tmp/chk.js
```

**2. Teste headless com Playwright.** Chromium em `/opt/pw-browsers/chromium` (ou o do sistema). Carregue `file://.../index.html`, monte o estado direto nas globais (`mesa`, `thread`, `projects`, `active`, `mesaLocked`), chame as funções e verifique o resultado. Sempre capture `pageerror`.

> **Lição cara, aprendida na marra:** testar que um elemento *existe no DOM* não prova nada. Um botão foi entregue "testado" e estava invisível na tela onde o usuário precisava dele, porque vivia dentro de uma `<section>` com `display:none`. **Teste visibilidade e posição**, não presença:
> ```js
> const r = el.getBoundingClientRect();
> ({ visivel: !!el.offsetParent && r.height>0, dentroDaTela: r.bottom<=innerHeight })
> ```
> E prefira `page.click(seletor)` de verdade a chamar a função por dentro.

## Publicar — quem publica é o Rodrigo

**Site** (Vercel publica sozinho a cada push em `main`):
```
cd ~/Developer/superlivros && git add -A && git commit -m "mensagem" && git push
```

**Motor** (Cloudflare Worker):
```
cd ~/Developer/superlivros && npx wrangler deploy
```

São dois comandos separados: mexeu em `index.html` → `git push`. Mexeu em `worker/worker.js` → `wrangler deploy`. Mexeu nos dois → os dois.

> Deixe o código pronto e **entregue os comandos**. Publicação em produção é decisão dele.

**Sempre `git --no-optional-locks`** em leitura (`status`, `diff`, `log`). Sem isso sobra um `.git/index.lock` que trava o git dele. Conserto: `rm -f .git/index.lock`.

---

## Mapa do repo

| arquivo | tamanho | o que é |
|---|---|---|
| `index.html` | 10,5 MB | **o site em produção** |
| `worker/worker.js` | 37 KB | **o motor** |
| `wrangler.toml` | — | deploy do motor: nome, `main`, compat date, binding do D1 |
| `classic.html` | 9,5 MB | interface antiga; tem o sync D1 funcionando e é a única que chama `/gen` |
| `os.html` | 223 KB | variante; chama só `/council` |

**Anatomia do `index.html`:** `<style>` (CSS) → `<body>` (markup) → as duas linhas de dados → ~700 linhas de JS da aplicação, que é o que se edita.

## O motor

`broad-heart-33a0.rodrigobondioli.workers.dev` · modelo `gemini-flash-latest` · D1 `superlivros-db` no binding `DB` · `GEMINI_API_KEY` como Secret (não vai no `wrangler.toml`, sobrevive a deploy).

Rotas: `/council` `/brief` `/mente` `/cast` `/orient` `/verdict` `/ask` `/librarian` `/gen` + GET/POST na raiz (estado no D1).

- **A citação (`quote`) só existe no `/council`.** `/ask` devolve só `resposta`.
- Portão em todas as rotas: allowlist de origem (curl sem `Origin` → 403), 150 chamadas por IP por hora no D1 (→ 429), corpo acima de 3 MB (→ 413). Se o D1 cair, o limite é ignorado e o conselho continua respondendo.
- Tabelas do D1: `state` (sync), `rl` (limite), `log` (uma linha por chamada cobrada: rota, IP, bytes, latência, status). As duas últimas se criam sozinhas.
- **`maxOutputTokens`:** 3072 por padrão, **8192 no `/council`**. Resposta cortada devolve `muito_longo` (lê o `finishReason`), não um `parse` genérico.

**Ler o log do D1 exige terminal interativo** — o `wrangler` num shell não interativo pede `CLOUDFLARE_API_TOKEN`. Peça ao Rodrigo:
```
npx wrangler d1 execute superlivros-db --remote --command "SELECT datetime(ts/1000,'unixepoch','-3 hours') h, rota, status, ms FROM log ORDER BY ts DESC LIMIT 10"
```

## Estado do usuário

Tudo em `localStorage`, 9 chaves com prefixo `slos_`. Sem conta, sem servidor. Gravação passa por `lsSet()`, que avisa na tela se a cota estourar. Tem backup/restaurar em JSON na lateral.

**Não existe sync no `index.html`** — o `classic.html` tem o padrão pronto (raiz do Worker, `SYNC_KEY`, debounce 800ms, merge ao carregar). Portar é fácil; o difícil é decidir a semântica de merge de projetos e conversas.

## Como uma conversa funciona

`startFromOpening()` → `convene()` chama `/cast` e monta a mesa → cartão do curador + barra de confirmação → `startDebate()` trava a mesa e chama `/orient` (cartão de caminhos) → `sendReply()` → `callCouncil()` chama `/council`.

Pontos que já morderam:
- `selectProject()` chama `newSubject()`, que **zera a thread**. Clicar num projeto no meio de uma conversa avulsa apaga ela.
- A mesa **deduplica por autor**, não por livro. Vários autores têm 2-3 livros na estante; oferecer o mesmo autor duas vezes cria uma mente que nunca fala. Filtre por `norm(autor)`.
- A linha "a mesa tá pensando" é anexada fora da `thread` — **qualquer `renderThread()` apaga ela**.
- `callCouncil` tem timeout de 90s com `AbortController`, tenta no máximo 2 vezes, e distingue timeout de erro real na mensagem.

**A mesa aprende** (`aprenderMesa()` em `startDebate`): compara a mesa que o curador montou (`castIds`) com a que o usuário abriu. Quem ele tirou soma em `tira`, quem ele chamou soma em `chama` — no `localStorage.slos_gosto` (peso 1) e no projeto ativo `ap.gosto` (peso 2). Só vai pro `/cast` quem soma 2 ou mais (`gostoParaCast()`). O cartão do curador mostra o que levou em conta, com "esquecer". Mesa herdada e fixos (📌) não ensinam nada.

**Troca por assunto:** o `/council` devolve `deriva` (tema novo que ninguém da mesa cobre) e `deriva_ids` (livros parecidos, quando o retrieval está ligado; sem ele o front usa `rankMentes`). Vira um cartão `role:'deriva'` com até 3 mentes pra chamar ou "deixa assim". Cartão usado fica `done:true` (não some da thread), pra não oferecer o mesmo tema de novo. Mensagem com @ não gera cartão.

## Banco de teste — rode antes e depois de mexer no motor

`node docs/evals/rodar.mjs <rotulo>` roda os 18 casos de `docs/evals/perguntas.json` contra o motor publicado (~US$ 1,50, ~6 min) e grava `docs/evals/<rotulo>/resultados.json`. `node docs/evals/comparar.mjs <a> <b>` gera um HTML lado a lado. Mede acerto da curadoria contra a mesa que o Rodrigo realmente usou (casos `real`), citações literais (a frase existe no dossiê/trechos) e tempo. **O VM do Cowork não alcança o `workers.dev`** — isso roda no Terminal do Mac.

## Adicionar livro novo

Dois caminhos, propósitos diferentes — ver `docs/pipeline-livros.md`.

## Pendências conhecidas

1. `/ask` não aceita `images[]` — o front já manda, o Worker precisa do patch.
2. **Retrieval** — no plano gratuito, com busca por texto no D1 (FTS5), não Vectorize. Código pronto e testado, trechos extraídos; falta o Rodrigo ligar (`docs/plano-retrieval.md`, bloco "Estado"). **O Rodrigo não vai assinar Workers Paid** — não proponha nada que dependa dele.
3. Saída do modelo entra no DOM sem sanitização (é proposital para permitir `<b>`, mas é HTML livre).
4. Custo por turno cresce sem controle: `/council` remonta dossiês + histórico inteiros a cada turno, sem cache.
5. ~~Não existe avaliação~~ → `docs/evals/` (ver "Banco de teste"). O baseline precisa ser rodado no Mac antes de ligar o retrieval.
6. `classic.html` (9,5 MB) — decidir se fica.
