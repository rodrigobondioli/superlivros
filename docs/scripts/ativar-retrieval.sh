#!/bin/bash
# Liga o retrieval no plano GRATUITO: cria o banco de busca (D1 + FTS5), conecta no motor, gera a chave e publica.
# Rode UMA vez, na pasta do repo:   bash docs/scripts/ativar-retrieval.sh
set -e
cd "$(dirname "$0")/../.."
BANCO=superlivros-trechos

echo "1/4 · Banco de busca no D1"
if ! npx wrangler d1 list --json 2>/dev/null | grep -q "\"$BANCO\""; then
  npx wrangler d1 create "$BANCO"
fi
ID=$(npx wrangler d1 list --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let a=[];for(let i=s.indexOf("[");i>-1&&!a.length;i=s.indexOf("[",i+1)){try{const t=JSON.parse(s.slice(i,s.lastIndexOf("]")+1));if(Array.isArray(t))a=t;}catch(e){}}const x=a.find(d=>d.name===process.argv[1]);process.stdout.write(x?(x.uuid||x.database_id||""):"")})' "$BANCO")
if [ -z "$ID" ]; then echo "Não achei o id do banco $BANCO. Me manda um print disto:"; npx wrangler d1 list; exit 1; fi
echo "     id: $ID"

echo "2/4 · Ligando o banco no motor (wrangler.toml)"
if grep -q "$BANCO" wrangler.toml; then
  echo "     já estava ligado."
else
  cat >> wrangler.toml <<TOML

# Retrieval: trechos do livro inteiro, busca por texto (docs/plano-retrieval.md)
[[d1_databases]]
binding = "TRECHOS"
database_name = "$BANCO"
database_id = "$ID"
TOML
fi

echo "3/4 · Chave da rota de indexação"
mkdir -p .indice
[ -s .indice/chave ] || openssl rand -hex 24 > .indice/chave
npx wrangler secret put INDEX_KEY < .indice/chave

echo "4/4 · Publicando o motor"
npx wrangler deploy

echo ""
echo "Pronto. Agora mande os trechos:   node docs/scripts/indexar.mjs"
