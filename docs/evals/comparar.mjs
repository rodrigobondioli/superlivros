// Põe duas rodadas lado a lado num HTML pra julgar no olho.
//   node docs/evals/comparar.mjs baseline retrieval
// Gera docs/evals/comparar-baseline-retrieval.html (abre no navegador).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const [a, b] = process.argv.slice(2);
if (!a || !b) { console.log("Uso: node docs/evals/comparar.mjs <rotuloA> <rotuloB>"); process.exit(1); }
const ler = (r) => JSON.parse(fs.readFileSync(path.join(AQUI, r, "resultados.json"), "utf8"));
const A = ler(a), B = ler(b);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const soNegrito = (s) => esc(s).replace(/&lt;(\/?)b&gt;/g, "<$1b>");

function coluna(r) {
  if (!r) return `<div class="col vazio">sem este caso</div>`;
  let h = "";
  if (r.cast) {
    if (r.cast.erro) h += `<div class="erro">curadoria falhou: ${esc(r.cast.erro)}</div>`;
    else h += `<h4>Mesa montada <span class="meta">${esc(r.cast.modelo)} · ${(r.cast.ms / 1000).toFixed(1)}s · lista de ${r.cast.lista}${r.cast.de ? ` · <b>${r.cast.acertos}/${r.cast.de}</b> da mesa real` : ""}</span></h4>
      <ul class="picks">${r.cast.picks.map((p) => `<li><b>${esc(p.autor)}</b> <i>${esc(p.titulo)}</i> <span class="cat">${esc(p.cat)}</span><div class="mot">${esc(p.motivo)}</div></li>`).join("")}</ul>
      ${r.cast.angulos ? `<div class="ang">${esc(r.cast.angulos)}</div>` : ""}`;
  }
  const c = r.council || {};
  if (c.erro) h += `<div class="erro">conselho falhou: ${esc(c.erro)}</div>`;
  else if (c.replies) {
    h += `<h4>Primeira rodada da mesa <span class="meta">${esc(c.modelo)} · ${(c.ms / 1000).toFixed(1)}s · trechos em ${Object.keys(c.fontes || {}).length} de ${c.mesa.length} mentes</span></h4>`;
    h += c.replies.map((x) => `<div class="fala"><div class="quem">${esc(x.autor)} <span>${esc(x.livro)}</span></div><div class="tx">${soNegrito(x.txt)}</div>${x.quote ? `<div class="q ${x.literal === true ? "ok" : x.literal === false ? "nao" : ""}">“${esc(x.quote)}”${x.quote_orig ? `<div class="qo">${esc(x.quote_orig)}</div>` : ""}<span class="selo">${x.literal === true ? "✓ está no texto" : x.literal === false ? "✗ não achei no texto" : ""}</span></div>` : ""}</div>`).join("");
    if (c.deriva) h += `<div class="ang">mudança de assunto detectada: ${esc(c.deriva)}</div>`;
  }
  return `<div class="col">${h}</div>`;
}

const ids = [...new Set([...A.casos.map((x) => x.id), ...B.casos.map((x) => x.id)])];
const val = (v) => Array.isArray(v) ? (v.length ? v.join(", ") : "nenhum") : v;
const linhaResumo = (k, rot) => `<tr><td>${rot}</td><td>${esc(val(A.resumo[k]))}</td><td>${esc(val(B.resumo[k]))}</td></tr>`;
const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(a)} × ${esc(b)}</title>
<style>
:root{--bg:#0d0d0f;--pn:#151517;--ln:#2a2a30;--tx:#ececee;--mu:#8c8c94;--li:#E7F99A;--am:#F08C00;--rd:#ff6b6b}
body{background:var(--bg);color:var(--tx);font:14px/1.55 -apple-system,system-ui,sans-serif;margin:0;padding:24px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:0 0 6px}h4{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--li);margin:14px 0 8px}
.meta{color:var(--mu);text-transform:none;letter-spacing:0;font-weight:400}
table{border-collapse:collapse;margin:16px 0 28px}td,th{border:1px solid var(--ln);padding:6px 12px;text-align:left}th{color:var(--mu);font-weight:500}
.caso{border-top:1px solid var(--ln);padding:22px 0}.prob{color:var(--mu);max-width:1100px;white-space:pre-wrap;font-size:13px;max-height:7.5em;overflow:auto}
.lado{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:12px}.col{background:var(--pn);border:1px solid var(--ln);border-radius:12px;padding:6px 16px 14px;min-width:0}
.cab{display:grid;grid-template-columns:1fr 1fr;gap:18px;position:sticky;top:0;background:var(--bg);padding:8px 0;z-index:2;font-weight:700;color:var(--li)}
.picks{margin:0;padding-left:18px}.picks li{margin-bottom:6px}.mot{color:var(--mu);font-size:12.5px}.cat{font-size:11px;color:var(--am)}
.ang{color:var(--mu);font-style:italic;font-size:12.5px;margin-top:8px}.fala{margin:10px 0 14px}.quem{font-weight:700}.quem span{font-weight:400;color:var(--mu);font-style:italic;font-size:12.5px}
.q{border-left:2px solid var(--ln);padding:4px 10px;margin-top:6px;font-style:italic;color:#cfcfd4;font-size:13px}.q.ok{border-color:var(--li)}.q.nao{border-color:var(--rd)}
.qo{color:var(--mu);font-size:12px}.selo{display:block;font-style:normal;font-size:11px;color:var(--mu);margin-top:3px}.q.ok .selo{color:var(--li)}.q.nao .selo{color:var(--rd)}
.erro{color:var(--rd)}@media(max-width:800px){.lado,.cab{grid-template-columns:1fr}}
</style></head><body>
<h1>${esc(a)} × ${esc(b)}</h1><div class="meta">${esc(A.resumo.quando)} × ${esc(B.resumo.quando)}</div>
<table><tr><th></th><th>${esc(a)}</th><th>${esc(b)}</th></tr>
${linhaResumo("cast_acerto_mesa_real", "Curadoria: acertos contra a mesa que você usou")}
${linhaResumo("cast_categorias_por_mesa", "Curadoria: categorias diferentes por mesa")}
${linhaResumo("cast_ms_medio", "Curadoria: tempo médio (ms)")}
${linhaResumo("citacoes_literais", "Mesa: citações que existem de verdade no texto")}
${linhaResumo("falas_com_trechos", "Mesa: mentes que receberam trechos do livro")}
${linhaResumo("conselho_ms_medio", "Mesa: tempo médio (ms)")}
${linhaResumo("erros", "Erros")}
</table>
<p class="meta">Pra julgar no olho, em cada caso: a fala está fundada no livro ou é genérica? A citação responde à pergunta ou é a frase de sempre? As mentes discordam de verdade?</p>
<div class="cab"><div>${esc(a)}</div><div>${esc(b)}</div></div>
${ids.map((id) => { const ra = A.casos.find((x) => x.id === id), rb = B.casos.find((x) => x.id === id); const r = ra || rb; return `<div class="caso"><h2>${esc(id)} <span class="meta">${esc(r.origem)}</span></h2><div class="prob">${esc(r.problema)}</div><div class="lado">${coluna(ra)}${coluna(rb)}</div></div>`; }).join("")}
</body></html>`;
const saida = path.join(AQUI, `comparar-${a}-${b}.html`);
fs.writeFileSync(saida, html);
console.log("Gerado:", path.relative(process.cwd(), saida));
