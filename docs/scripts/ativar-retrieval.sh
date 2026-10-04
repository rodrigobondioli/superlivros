#!/bin/bash
# Liga o retrieval: cria o índice no Vectorize, conecta no motor, gera a chave e publica.
# Rode UMA vez, na pasta do repo:   bash docs/scripts/ativar-retrieval.sh
# Pré-requisito: conta Cloudflare no plano Workers Paid (US$ 5/mês). No gratuito o índice não cabe.
set -e
cd "$(dirname "$0")/../.."
INDICE=superlivros-trechos

echo "1/4 · Índice no Vectorize"
if npx wrangler vectorize get "$INDICE" >/dev/null 2>&1; then
  echo "     já existe, sigo."
else
  npx wrangler vectorize create "$INDICE" --dimensions=1024 --metric=cosine
  # o índice de metadado PRECISA existir antes do primeiro trecho, senão o filtro por livro não funciona
  npx wrangler vectorize create-metadata-index "$INDICE" --property-name=livro --type=string
fi

echo "2/4 · Ligando o índice e a IA no motor (wrangler.toml)"
if grep -q "$INDICE" wrangler.toml; then
  echo "     já estava ligado."
else
  cat >> wrangler.toml <<EOF

# Retrieval: trechos do livro inteiro (docs/plano-retrieval.md)
[ai]
binding = "AI"

[[vectorize]]
binding = "VEC"
index_name = "$INDICE"
EOF
fi

echo "3/4 · Chave da rota de indexação"
mkdir -p .indice
[ -s .indice/chave ] || openssl rand -hex 24 > .indice/chave
npx wrangler secret put INDEX_KEY < .indice/chave

echo "4/4 · Publicando o motor"
npx wrangler deploy

echo ""
echo "Pronto. Agora mande os trechos:   node docs/scripts/indexar.mjs"
