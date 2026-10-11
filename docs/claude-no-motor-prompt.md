# Superlivros: Claude no motor (prompt para o Claude Code)

## Antes de tudo

Leia o `CLAUDE.md` inteiro e siga as regras dele. Não publique nada. Tudo tem que caber no plano gratuito da Cloudflare: o tempo esperando a resposta da IA não conta como CPU, mas não faça parse pesado.

Faça `git add` só dos arquivos desta tarefa. Há mudanças pendentes de outras tarefas no repo (Web Form Design, Krug, `testes/fumaca-gemini.mjs`): não mexa nelas nem as inclua.

## Objetivo

O Rodrigo tem crédito na API da Anthropic. O Claude entra **só nas rotas em que a qualidade do texto é o produto**. O resto continua no Gemini.

| Rota | Hoje | Passa a usar |
|---|---|---|
| `/council` normal | Gemini Flash | **`claude-sonnet-5-5`** |
| `/council` com "⚡ mais inteligente" (`pro: true`) | Gemini Pro | **`claude-opus-5-5`** |
| `/verdict` | Gemini Pro | **`claude-opus-5-5`** |
| Pautas: geração e crítico | Gemini Flash | **`claude-sonnet-5-5`** |
| Todo o resto (`/cast`, `/orient`, `/brief`, `/mente`, `/ask`, `/librarian`, `termosDeBusca`, `/gen`) | Gemini | **não muda** |

Confirme os IDs dos modelos e o formato da API em docs.claude.com antes de escrever o código. Não use memória para isso.

## 1. Chamada ao Claude

Crie `askClaudeModel(env, model, prompt, images, maxTokens, timeoutMs)` com **o mesmo contrato** do `askGeminiModel`: mesma entrada, devolve o JSON já parseado e lança os mesmos códigos de erro (`tempo_esgotado`, `rede`, `muito_longo`, `parse`, e `claude_error` com status e detalhe).

- **API:** `POST https://api.anthropic.com/v1/messages`, com os cabeçalhos `x-api-key: env.ANTHROPIC_API_KEY`, `anthropic-version` e `content-type`.
- **Imagens:** `images[]` (`{mime, data}` em base64) vira um bloco `image` com `source` base64, no mesmo `content` do texto.
- **JSON:** o Claude não tem `responseMimeType`. Acrescente ao fim do prompt: "Responda apenas com o JSON pedido, sem texto antes ou depois, sem cercas de código." Faça o parse com a mesma tolerância do Gemini (tira cercas ```` ``` ```` e pega o primeiro `{...}`).
- **Resposta cortada:** `stop_reason === "max_tokens"` lança `muito_longo`.
- **Uso:** devolva `usage.input_tokens` e `usage.output_tokens` para o log (seção 4).
- **Cache de prompt (se for simples):** no `/council`, a parte que se repete a cada turno (instruções + dossiês das mentes) pode ir num bloco separado com `cache_control`, e o histórico e a pergunta num bloco depois. Isso reduz bastante o custo de conversas longas. Só faça se der para separar sem mudar o texto do prompt; se não der, deixe anotado em "Pendências" no `CLAUDE.md`.

## 2. Interruptor e fallback

Crie `askIA(env, rota, prompt, images, maxTokens, timeoutMs)`, o único ponto que decide o provedor:

- **Interruptor por rota** em `wrangler.toml`, `[vars]`: `IA_COUNCIL`, `IA_VERDICT` e `IA_PAUTAS`, cada um valendo `"claude"` ou `"gemini"`. O padrão no repo é `"claude"`. Para voltar ao Gemini, o Rodrigo troca a palavra e roda `wrangler deploy`.
- **Fallback automático:** se o Claude der erro de rede, tempo esgotado, 429, 5xx, 401/403 (chave inválida) ou crédito esgotado, refaz a mesma chamada no Gemini equivalente (Sonnet → Flash, Opus → Pro). **Não** faça fallback em `muito_longo` (estouraria igual) nem em `parse` (tente o parse tolerante primeiro).
- **Sem chave:** se não existir `env.ANTHROPIC_API_KEY`, vai direto para o Gemini, sem erro.
- Devolva `{ parsed, modelo, caiu? }` como o `askComFallback` já faz. O front já mostra aviso quando o motor cai para outro modelo; confira que o aviso continua fazendo sentido.
- **Timeouts:** 80 s no `/council` (o front espera 90 s, e 150 s com "⚡"; ajuste para 140 s com Opus), 90 s no `/verdict` e 70 s nas pautas.

**Override para teste:** se a requisição trouxer o cabeçalho `X-IA: gemini|claude` **e** o `X-Index-Key` correto (o segredo que já existe), use o provedor pedido. Sem a chave, ignore o cabeçalho. Isso deixa o banco de teste rodar as duas versões sem novo deploy.

Troque as chamadas de `/council`, `/verdict` e das pautas para `askIA`. Não toque nas outras rotas.

## 3. Prompts

Não reescreva os prompts. Só garanta que cada um termina pedindo JSON puro. Se algum depender de comportamento específico do Gemini, documente e adapte o mínimo.

## 4. Controle de custo

- O `log` do D1 ganha as colunas `tok_in` e `tok_out`, criadas por `ALTER TABLE` com fallback, no mesmo padrão da coluna `modelo`. Grave os tokens em toda chamada Claude.
- Acrescente ao `CLAUDE.md` a consulta que mostra o gasto do mês por modelo:
  ```
  npx wrangler d1 execute superlivros-db --remote --command "SELECT modelo, COUNT(*) n, SUM(tok_in) tin, SUM(tok_out) tout FROM log WHERE ts > strftime('%s','now','start of month')*1000 GROUP BY modelo"
  ```
- Busque em docs.claude.com o preço por milhão de tokens dos dois modelos e coloque a conta do custo ao lado da consulta, com a data em que conferiu.

## 5. Banco de teste

Adapte `docs/evals/rodar.mjs` para aceitar `--ia claude|gemini`, que envia o `X-IA` com o `X-Index-Key` (lido de `.indice/chave`, como o `indexar.mjs` já faz). O `comparar.mjs` continua igual.

## 6. Testes

Use os testes do motor que já existem como base, com Anthropic e Gemini simulados:
1. `/council`, `/verdict` e pautas chamam o Claude com o modelo certo, e o `pro: true` usa o Opus.
2. As outras rotas continuam no Gemini.
3. Imagens chegam ao Claude no formato certo.
4. Resposta com cercas ou texto em volta do JSON é parseada.
5. `max_tokens` dá `muito_longo`, sem fallback.
6. 429, 5xx, timeout e 401 caem no Gemini e devolvem `caiu`.
7. Sem `ANTHROPIC_API_KEY`, tudo vai para o Gemini.
8. Com o interruptor em `"gemini"`, nada chama o Claude.
9. `X-IA` sem chave é ignorado, e com chave é respeitado.
10. Os tokens são gravados no log.
11. Todos os testes que já existiam continuam passando.

## 7. Entrega

Ao terminar, me mostre o que mudou em cada arquivo e os testes passando. Depois me passe os comandos, nesta ordem:

1. `npx wrangler secret put ANTHROPIC_API_KEY` (eu colo a chave quando ele pedir)
2. `git add <arquivos desta tarefa> && git commit -m "Claude no conselho, veredito e pautas" && git push`
3. `npx wrangler deploy`
4. Banco de teste nas duas versões:
   ```
   node docs/evals/rodar.mjs gemini-out --ia gemini
   node docs/evals/rodar.mjs claude-out --ia claude
   node docs/evals/comparar.mjs gemini-out claude-out
   ```
   Diga também quanto custa rodar o banco com Claude.
