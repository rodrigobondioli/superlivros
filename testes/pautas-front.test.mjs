// Teste da aba Pautas no index.html, com Playwright de verdade e o motor simulado por page.route().
//   node --test testes/pautas-front.test.mjs
// Acha o Playwright em: PW_MODULO=/caminho/node_modules/playwright, ./node_modules, ou em qualquer projeto de ~/Developer.
// Testa visibilidade e posicao (getBoundingClientRect), nao so presenca no DOM.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAGINA = pathToFileURL(path.join(RAIZ, "index.html")).href;
const HOJE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const ONTEM = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() - 86400000));

async function pegaPlaywright() {
  const cands = [process.env.PW_MODULO, path.join(RAIZ, "node_modules/playwright")];
  const dev = path.join(os.homedir(), "Developer");
  try { for (const d of fs.readdirSync(dev)) cands.push(path.join(dev, d, "node_modules/playwright")); } catch (e) {}
  const erros = [];
  for (const c of cands.filter(Boolean)) {
    if (!fs.existsSync(path.join(c, "package.json"))) continue;
    try { const m = await import(pathToFileURL(path.join(c, "index.mjs")).href); const browser = await m.chromium.launch(); return { browser, de: c }; }
    catch (e) { erros.push(c + ": " + String(e.message || e).split("\n")[0]); }
  }
  throw new Error("Playwright nao encontrado ou sem Chromium instalado.\n" + erros.join("\n") + "\nRode: npm i -D playwright && npx playwright install chromium   (ou PW_MODULO=...)");
}

/* ---------- motor simulado: o estado vive aqui, como no D1 ---------- */
let motor;
function novoMotor() {
  let prox = 1;
  const pauta = (dia, livro, k, extra) => Object.assign({ id: prox++, dia, origem: "cron", livro: livro.hash, livro_titulo: livro.titulo, livro_autor: livro.autor, cat: livro.cat, tipo: ["contraintuitivo", "mito", "framework", "pergunta", "erro"][k], gancho: `Gancho ${k + 1} de ${livro.titulo}`, insight: `Insight ${k + 1}: duas frases com a substancia do livro. <b>sem html</b>`, ancora: "Capitulo " + (k + 1), status: "nova", ts: Date.now() }, extra || {});
  const A = { hash: "aaaa1", titulo: "Livro de Ontem", autor: "Autora A", cat: "Design" };
  const B = { hash: "bbbb2", titulo: "Livro de Hoje", autor: "Autor B", cat: "Drinks" };
  const C = { hash: "cccc3", titulo: "Livro Gerado Agora", autor: "Autor C", cat: "Storytelling" };
  const m = { off: [], pautas: [], chamadas: [] };
  for (let k = 0; k < 5; k++) m.pautas.push(pauta(ONTEM, A, k));
  for (let k = 0; k < 5; k++) m.pautas.push(pauta(HOJE, B, k));
  m.gerar = () => { const novas = []; for (let k = 0; k < 5; k++) novas.push(pauta(HOJE, C, k, { origem: "manual" })); m.pautas.push(...novas); return { pautas: novas, livro: C, hoje: HOJE, modelo: "x" }; };
  return m;
}
async function instala(page) {
  await page.route(/\/pautas(\?|\/|$)/, async (route) => {
    const r = route.request(); const u = new URL(r.url()); const corpo = r.postData() ? JSON.parse(r.postData()) : {};
    motor.chamadas.push([r.method(), u.pathname]);
    const ok = (obj, status) => route.fulfill({ status: status || 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(obj) });
    if (r.method() === "GET") return ok({ cats_off: motor.off, pautas: motor.pautas, hoje: HOJE });
    if (u.pathname.endsWith("/filtro")) { motor.off = corpo.cats_off; return ok({ ok: true, cats_off: motor.off }); }
    if (u.pathname.endsWith("/status")) { const p = motor.pautas.find((x) => x.id === corpo.id); if (!p) return ok({ error: "nao_achei" }, 404); p.status = corpo.status; return ok({ ok: true }); }
    if (u.pathname.endsWith("/gerar")) { await new Promise((res) => setTimeout(res, 150)); return ok(motor.gerar()); }
    return ok({ error: "rota" }, 404);
  });
}
const visivel = (page, sel) => page.$eval(sel, (el) => { const r = el.getBoundingClientRect(); return { visivel: !!el.offsetParent && r.height > 0 && r.width > 0, dentroDaTela: r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth, top: r.top }; });

let browser, context, page, erros = [];
before(async () => {
  ({ browser } = await pegaPlaywright());
  context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(() => {   // a area de transferencia nao existe em file://; guarda o que foi copiado
    Object.defineProperty(navigator, "clipboard", { value: { writeText: (t) => { window.__copiado = t; return Promise.resolve(); } }, configurable: true });
  });
  page = await context.newPage();
  page.on("pageerror", (e) => erros.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") erros.push("console: " + m.text()); });
  motor = novoMotor();
  await instala(page);
  await page.goto(PAGINA);
});
after(async () => { if (browser) await browser.close(); });

test("a aba Pautas esta no menu, visivel e clicavel; abre a lista por dia, mais recente primeiro", async () => {
  const nav = await visivel(page, "#nav-pau");
  assert.ok(nav.visivel && nav.dentroDaTela, "item do menu visivel: " + JSON.stringify(nav));
  await page.click("#nav-pau");
  await page.waitForSelector(".paugrp");
  assert.ok((await visivel(page, "#view-pautas")).visivel);
  assert.ok((await visivel(page, "#paugerar")).dentroDaTela, "botao Gerar agora na tela");
  assert.equal(await page.$eval("#nav-pau", (e) => e.classList.contains("on")), true);
  assert.equal(await page.$eval("#view-estante", (e) => !!e.offsetParent), false, "a estante some");
  const grupos = await page.$$eval(".paugrp .paulivro", (els) => els.map((e) => e.textContent));
  assert.deepEqual(grupos, ["Livro de Hoje", "Livro de Ontem"]);
  const dias = await page.$$eval(".paudia", (els) => els.map((e) => e.textContent));
  assert.deepEqual(dias, ["Hoje", "Ontem"]);
  assert.equal(await page.$$eval(".pauta", (els) => els.length), 10);
  const primeira = await visivel(page, ".pauta");
  assert.ok(primeira.visivel && primeira.dentroDaTela, "a primeira pauta aparece sem rolar: " + JSON.stringify(primeira));
  assert.equal(await page.$eval(".pauta .pauinsight", (e) => e.innerHTML.includes("&lt;b&gt;")), true, "texto do modelo entra como texto, nao como HTML");
  assert.ok((await page.$$eval(".pauta .pautipo", (els) => els.map((e) => e.textContent))).includes("contraintuitivo"));
  assert.equal(await page.$eval("#view-pautas", (e) => e.querySelector(".paucov").getAttribute("src").length > 0), true, "capa no cabecalho");
});

test("o chip persiste depois de recarregar", async () => {
  const n = await page.$$eval(".pauchip", (els) => els.length);
  assert.ok(n >= 15, "chips das categorias da estante: " + n);
  assert.equal(await page.$$eval(".pauchip.on", (els) => els.length), n, "todas ligadas no comeco");
  const chip = await visivel(page, ".pauchip[data-cat='Drinks']");
  assert.ok(chip.visivel && chip.dentroDaTela);
  const salvou = page.waitForResponse((r) => r.url().endsWith("/pautas/filtro"));
  await page.click(".pauchip[data-cat='Drinks']");
  assert.equal(await page.$eval(".pauchip[data-cat='Drinks']", (e) => e.classList.contains("on")), false);
  assert.equal(await page.$eval(".pauchip[data-cat='Drinks']", (e) => e.getAttribute("aria-pressed")), "false");
  await salvou;
  assert.deepEqual(motor.off, ["Drinks"]);
  await page.reload();
  await page.waitForSelector(".paugrp");   // volta direto na aba Pautas (slos_view)
  assert.equal(await page.$eval("#nav-pau", (e) => e.classList.contains("on")), true, "recarregar volta na aba Pautas");
  assert.equal(await page.$eval(".pauchip[data-cat='Drinks']", (e) => e.classList.contains("on")), false, "Drinks continua desligada");
  assert.equal(await page.$$eval(".pauchip.on", (els) => els.length), n - 1);
  const religou = page.waitForResponse((r) => r.url().endsWith("/pautas/filtro"));
  await page.click(".pauchip[data-cat='Drinks']");
  await religou;
  assert.deepEqual(motor.off, []);
});

test("copiar copia gancho + insight + fonte", async () => {
  await page.click(".pauta .pau-copiar");
  const copiado = await page.evaluate(() => window.__copiado);
  assert.equal(copiado, "Gancho 1 de Livro de Hoje\n\nInsight 1: duas frases com a substancia do livro. <b>sem html</b>\n\n— Livro de Hoje, Autor B");
  assert.equal(await page.$eval(".pauta .pau-copiar", (e) => e.textContent), "✓ copiado");
});

test("favoritar marca; descartar some da lista e avisa o motor", async () => {
  await page.click(".pauta .pau-fav");
  await page.waitForFunction(() => document.querySelector(".pauta").classList.contains("fav"));
  assert.equal(motor.pautas.find((p) => p.id === 6).status, "fav");
  const antes = await page.$$eval(".pauta", (els) => els.map((e) => e.dataset.id));
  assert.equal(antes.length, 10);
  const avisou = page.waitForResponse((r) => r.url().endsWith("/pautas/status"));
  await page.click(".pauta[data-id='7'] .pau-descartar");
  await avisou;
  const depois = await page.$$eval(".pauta", (els) => els.map((e) => e.dataset.id));
  assert.equal(depois.length, 9);
  assert.ok(!depois.includes("7"));
  assert.equal(motor.pautas.find((p) => p.id === 7).status, "descartada");
});

test("Gerar agora mostra o carregamento e poe o resultado no topo", async () => {
  const gerou = page.waitForResponse((r) => r.url().endsWith("/pautas/gerar"));
  await page.click("#paugerar");
  assert.equal(await page.$eval("#paugerar", (e) => e.disabled), true);
  assert.ok((await visivel(page, "#paulist .libload")).visivel, "linha de carregamento visivel");
  await gerou;
  await page.waitForFunction(() => document.querySelectorAll(".pauta").length === 14);
  const grupos = await page.$$eval(".paugrp .paulivro", (els) => els.map((e) => e.textContent));
  assert.deepEqual(grupos, ["Livro Gerado Agora", "Livro de Hoje", "Livro de Ontem"]);
  assert.equal(await page.$eval("#paugerar", (e) => e.disabled), false);
  assert.equal(await page.$eval("#paulist .libload", (e) => !!e).catch(() => false), false, "carregamento sumiu");
});

test("estados vazios: sem pautas ainda, e tudo desligado", async () => {
  motor.pautas = [];
  await page.reload();
  await page.waitForSelector(".pauempty");
  assert.ok((await page.$eval(".pauempty", (e) => e.textContent)).includes("As primeiras pautas chegam amanhã às 6h"));
  assert.equal(await page.$eval("#pauaviso", (e) => !!e.offsetParent), false, "sem aviso com categorias ligadas");
  motor.off = await page.$$eval(".pauchip", (els) => els.map((e) => e.dataset.cat));
  await page.reload();
  await page.waitForSelector("#pauaviso");
  await page.waitForFunction(() => !!document.querySelector("#pauaviso").offsetParent);
  assert.ok((await page.$eval("#pauaviso", (e) => e.textContent)).includes("Todas as categorias estão desligadas"));
  assert.equal(await page.$$eval(".pauchip.on", (els) => els.length), 0);
  motor.off = [];
});

test("no celular, Pautas esta no segmento de cima e abre", async () => {
  await page.setViewportSize({ width: 390, height: 780 });
  await page.evaluate(() => localStorage.setItem("slos_view", "estante"));
  await page.reload();
  await page.waitForSelector("#mseg-pau");
  const seg = await visivel(page, "#mseg-pau");
  assert.ok(seg.visivel && seg.dentroDaTela, JSON.stringify(seg));
  await page.click("#mseg-pau");
  await page.waitForSelector(".pauempty");
  assert.ok((await visivel(page, "#paugerar")).dentroDaTela);
  await page.setViewportSize({ width: 1280, height: 800 });
});

test("nenhum erro de JS no caminho todo", () => {
  assert.deepEqual(erros, []);
});
