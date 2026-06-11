// ============ 豆包画板 · 侧边栏（module） ============
import * as store from "./store.js";

const ARK_URL = "https://ark.cn-beijing.volces.com/api/v3/images/generations";
const MAX_ITEMS = store.MAX_ITEMS;

const DIMENSIONS = [
  { v: "style",       label: "整体风格 / 笔触",  frag: "整体绘画风格与笔触" },
  { v: "palette",     label: "配色 / 色调",      frag: "配色方案与色调" },
  { v: "lineart",     label: "线条 / 轮廓",      frag: "线条与轮廓的处理方式" },
  { v: "composition", label: "构图 / 布局",      frag: "构图与画面布局" },
  { v: "lighting",    label: "光影 / 氛围",      frag: "光影与氛围" },
  { v: "subject",     label: "主体 / 角色",      frag: "主体角色或对象" },
  { v: "element",     label: "指定元素",         frag: "其中的指定元素" },
  { v: "texture",     label: "材质 / 质感",      frag: "材质与质感" },
  { v: "custom",      label: "自定义（看说明）", frag: "" },
  { v: "base",        label: "🔁 以这张为基础", frag: "" },
];
const FRAG = Object.fromEntries(DIMENSIONS.map((d) => [d.v, d.frag]));

const $ = (id) => document.getElementById(id);
let task = null;
let view = "task";
let busy = false;
let shownFull = "";   // 当前大图的完整 base64（下载/迭代用）
let saveTimer = null;
let dragId = null;    // 拖拽排序中的卡片 id

init();

async function init() {
  task = await store.getCurrentTask();
  bindStatic();
  renderTask();
  await checkKey();

  chrome.storage.onChanged.addListener(async (c, area) => {
    if (area !== "local") return;
    if (c.settings) checkKey();
    if (c.currentId || c["task:" + task.id]) {
      const prevIds = task.board.map((i) => i.id).join(",");
      task = await store.getCurrentTask();
      renderTaskBar();
      if (view === "task" && task.board.map((i) => i.id).join(",") !== prevIds) {
        renderList();
        refreshPromptPreview();
      }
    }
    if (c.index && view === "history") renderHistory();
  });
}

function bindStatic() {
  $("settingsBtn").onclick = () => chrome.runtime.openOptionsPage();
  $("openOptions").onclick = () => chrome.runtime.openOptionsPage();
  $("historyBtn").onclick = openHistory;
  $("backBtn").onclick = () => switchView("task");
  $("newBtn").onclick = newTask;
  $("genBtn").onclick = generate;
  $("downloadBtn").onclick = download;
  $("iterateBtn").onclick = iterateFromResult;
  $("closeResult").onclick = () => $("resultWrap").classList.add("hidden");

  $("taskTitle").oninput = () => { task.title = $("taskTitle").value; debounceSave(); };
  $("globalPrompt").oninput = () => { task.prompt = $("globalPrompt").value; debounceSave(); refreshPromptPreview(); };
  $("sizeSel").onchange = () => { task.size = $("sizeSel").value; store.saveTask(task); };

  // 提示词预览 / 编辑
  $("promptToggle").onclick = togglePrompt;
  $("promptBox").oninput = () => { task.promptOverride = $("promptBox").value; syncPromptFlags(); debounceSave(); };
  $("promptReset").onclick = () => {
    task.promptOverride = null;
    $("promptBox").value = buildPrompt();
    syncPromptFlags();
    store.saveTask(task);
  };
}

function debounceSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => store.saveTask(task), 400);
}

async function checkKey() {
  const { settings = {} } = await chrome.storage.local.get("settings");
  $("keyBanner").classList.toggle("hidden", !!settings.apiKey);
}

// ---------- 视图切换 ----------
function switchView(v) {
  view = v;
  $("taskView").classList.toggle("hidden", v !== "task");
  $("historyView").classList.toggle("hidden", v !== "history");
}

async function newTask() {
  await store.createTask();
  task = await store.getCurrentTask();
  switchView("task");
  renderTask();
  setStatus("");
}

// ---------- 渲染：任务 ----------
function renderTask() {
  renderTaskBar();
  $("taskTitle").value = task.title || "";
  $("globalPrompt").value = task.prompt || "";
  $("sizeSel").value = task.size || "2K";
  renderList();
  renderResults();
  // 折叠提示词面板并复位
  $("promptPanel").classList.add("hidden");
  $("promptToggle").setAttribute("aria-expanded", "false");
  $("promptToggle").querySelector(".chev").textContent = "▸";
  syncPromptFlags();
}

function renderTaskBar() {
  $("count").textContent = `${task.board.length} / ${MAX_ITEMS}`;
  $("genBtn").disabled = task.board.length === 0 || busy;
}

function renderList() {
  const list = $("list");
  list.innerHTML = "";
  $("empty").classList.toggle("hidden", task.board.length > 0);
  task.board.forEach((item, i) => list.appendChild(card(item, i)));
}

function card(item, i) {
  const node = $("cardTpl").content.firstElementChild.cloneNode(true);
  node.dataset.id = item.id;
  node.querySelector(".idx").textContent = i + 1;
  const img = node.querySelector(".thumb-img");
  img.src = item.src;
  img.onerror = () => { img.alt = "（缩略图加载失败，仍会作为参考提交）"; };

  const sel = node.querySelector(".dim");
  DIMENSIONS.forEach((d) => {
    const o = document.createElement("option");
    o.value = d.v; o.textContent = d.label;
    if (d.v === item.dimension) o.selected = true;
    sel.appendChild(o);
  });
  sel.onchange = () => { item.dimension = sel.value; store.saveTask(task); refreshPromptPreview(); };

  const note = node.querySelector(".note");
  note.value = item.note || "";
  note.oninput = () => { item.note = note.value; debounceSave(); refreshPromptPreview(); };

  node.querySelector(".del").onclick = () => {
    task.board = task.board.filter((it) => it.id !== item.id);
    store.saveTask(task);
    renderTaskBar(); renderList(); refreshPromptPreview();
  };

  // 拖拽排序：只有手柄能发起拖动，卡片整体是放置目标
  const grip = node.querySelector(".grip");
  grip.addEventListener("dragstart", (e) => {
    dragId = item.id;
    node.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", item.id);
  });
  grip.addEventListener("dragend", () => { dragId = null; clearDragMarks(); });
  node.addEventListener("dragover", (e) => {
    if (dragId && dragId !== item.id) { e.preventDefault(); node.classList.add("drop-target"); }
  });
  node.addEventListener("dragleave", () => node.classList.remove("drop-target"));
  node.addEventListener("drop", (e) => {
    e.preventDefault();
    node.classList.remove("drop-target");
    if (dragId && dragId !== item.id) reorder(dragId, item.id);
  });

  return node;
}

function clearDragMarks() {
  document.querySelectorAll(".card").forEach((n) => n.classList.remove("dragging", "drop-target"));
}

function reorder(fromId, toId) {
  const from = task.board.findIndex((b) => b.id === fromId);
  if (from < 0) return;
  const [moved] = task.board.splice(from, 1);
  const at = task.board.findIndex((b) => b.id === toId);
  task.board.splice(at < 0 ? task.board.length : at, 0, moved);
  store.saveTask(task);
  renderList();
  refreshPromptPreview();
}

// ---------- 渲染：结果 ----------
function renderResults() {
  const results = task.results || [];
  if (!results.length) { $("resultWrap").classList.add("hidden"); return; }
  showResult(results[results.length - 1].id);

  const strip = $("resultStrip");
  strip.innerHTML = "";
  strip.classList.toggle("hidden", results.length < 2);
  results.forEach((r, i) => {
    const im = document.createElement("img");
    im.src = r.thumb;
    im.title = `第 ${i + 1} 次生成`;
    im.onclick = () => showResult(r.id);
    strip.appendChild(im);
  });
}

async function showResult(rid) {
  const full = await store.getResultImage(rid);
  if (!full) return;
  shownFull = full;
  $("resultImg").src = full;
  $("resultWrap").classList.remove("hidden");
  [...$("resultStrip").children].forEach((im, i) => {
    im.classList.toggle("on", task.results[i]?.id === rid);
  });
}

async function download() {
  if (!shownFull) return;
  const a = document.createElement("a");
  a.href = shownFull;
  a.download = `doubao-fusion-${Date.now()}.jpg`;
  a.click();
}

// 把当前结果作为「基础」加回画板，实现迭代（图生图）
async function iterateFromResult() {
  if (!shownFull || busy) return;
  if (task.board.length >= MAX_ITEMS) {
    setStatus(`画板已满 ${MAX_ITEMS} 张，先移除一张再继续。`, true);
    return;
  }
  const blob = await (await fetch(shownFull)).blob();
  const src = await downscaleToJpeg(blob, MAX_SIDE, 0.9);
  task.board.push({ id: crypto.randomUUID(), src, dimension: "base", note: "", addedAt: Date.now() });
  await store.saveTask(task);
  renderTaskBar(); renderList(); refreshPromptPreview();
  $("list").scrollTop = $("list").scrollHeight;
  setStatus("已把这张作为基础加入画板。改一下“最终想要的画面”，再点生成即可迭代。");
}

// ---------- 渲染：历史 ----------
async function openHistory() {
  switchView("history");
  await renderHistory();
}

async function renderHistory() {
  const list = await store.listTasks();
  const box = $("histList");
  box.innerHTML = "";
  $("histEmpty").classList.toggle("hidden", list.length > 0);

  list.forEach((t) => {
    const row = $("histTpl").content.firstElementChild.cloneNode(true);
    row.dataset.id = t.id;
    const img = row.querySelector(".hist-thumb img");
    if (t.thumb) img.src = t.thumb;
    else row.querySelector(".hist-thumb").classList.add("blank");
    if (t.id === task.id) row.classList.add("current");

    row.querySelector(".h-title").textContent = t.title;
    row.querySelector(".h-sub").textContent =
      `${t.itemCount} 图 · ${t.resultCount} 次生成 · ${fmtDate(t.updatedAt)}`;

    row.onclick = (e) => { if (!e.target.classList.contains("hist-del")) openTask(t.id); };
    row.querySelector(".hist-del").onclick = async (e) => {
      e.stopPropagation();
      if (!confirm(`删除任务「${t.title}」？结果也会一并删除。`)) return;
      await store.deleteTask(t.id);
      task = await store.getCurrentTask();
      renderHistory();
    };
    box.appendChild(row);
  });
}

async function openTask(id) {
  await store.setCurrent(id);
  task = await store.getCurrentTask();
  switchView("task");
  renderTask();
  setStatus("");
}

function fmtDate(ts) {
  return new Date(ts).toLocaleString("zh-CN", {
    month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// ---------- 提示词 ----------
function buildPrompt() {
  const lines = task.board.map((it, i) => {
    const n = i + 1;
    const note = (it.note || "").trim();
    if (it.dimension === "custom") return `图${n}：${note || "（未填写说明）"}。`;
    if (it.dimension === "base") {
      return `图${n}：以这张图为基础，在此之上按“最终画面”的描述进行修改${note ? "（" + note + "）" : ""}。`;
    }
    let s = `图${n}：保留它的${FRAG[it.dimension] || "特征"}`;
    if (note) s += `（${note}）`;
    return s + "。";
  });
  const tail = (task.prompt || "").trim() || "综合以上所有参考，自由发挥出协调统一的画面";
  return (
    "请参考下列图片，把它们有机融合成一张全新的原画" +
    "（不是简单拼贴，要让风格、配色、元素自然统一）：\n" +
    lines.join("\n") + "\n\n最终画面：" + tail
  );
}

function finalPrompt() {
  return task.promptOverride != null ? task.promptOverride : buildPrompt();
}

function togglePrompt() {
  const panel = $("promptPanel");
  const open = panel.classList.toggle("hidden") === false;
  $("promptToggle").setAttribute("aria-expanded", String(open));
  $("promptToggle").querySelector(".chev").textContent = open ? "▾" : "▸";
  if (open) {
    $("promptBox").value = task.promptOverride != null ? task.promptOverride : buildPrompt();
    syncPromptFlags();
  }
}

function syncPromptFlags() {
  const ov = task.promptOverride != null;
  $("promptFlag").classList.toggle("hidden", !ov);
  $("promptReset").classList.toggle("hidden", !ov);
}

// 画板/描述变化时，若未手动覆盖且面板打开，刷新预览
function refreshPromptPreview() {
  syncPromptFlags();
  const open = !$("promptPanel").classList.contains("hidden");
  if (open && task.promptOverride == null) $("promptBox").value = buildPrompt();
}

// ---------- 生成 ----------
async function generate() {
  if (busy || task.board.length === 0) return;
  const { settings = {} } = await chrome.storage.local.get("settings");
  if (!settings.apiKey) { setStatus("请先在设置里填入 API Key。", true); return; }

  setBusy(true);

  let images;
  try {
    images = await prepareImages((i, n) => setStatus(`处理参考图 ${i}/${n}…`));
  } catch (e) {
    setStatus(e.message, true); setBusy(false); return;
  }

  setStatus("正在请求豆包融合…");
  const prompt = finalPrompt();
  const size = $("sizeSel").value;
  const body = {
    model: settings.model || "doubao-seedream-4-0-250828",
    prompt,
    image: images,
    sequential_image_generation: "disabled",
    response_format: "url",
    size,
    watermark: settings.watermark !== false,
    stream: false,
  };

  try {
    const res = await fetch(ARK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.apiKey}` },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || data?.message || `HTTP ${res.status}`);
    const url = data?.data?.[0]?.url;
    if (!url) throw new Error("接口没返回图片：" + JSON.stringify(data).slice(0, 200));

    setStatus("正在保存结果…");
    const blob = await (await fetch(url)).blob();
    const { full, thumb } = await fullAndThumb(blob);
    await store.addResult(task, full, thumb, { prompt, size });
    task = await store.getCurrentTask();
    renderResults();
    setStatus("完成。");
  } catch (e) {
    setStatus("失败：" + e.message, true);
  } finally {
    setBusy(false);
  }
}

// ---------- 图片处理 ----------
const MAX_SIDE = 1536;

async function prepareImages(onProgress) {
  const out = [];
  for (let i = 0; i < task.board.length; i++) {
    onProgress?.(i + 1, task.board.length);
    try {
      out.push(await toJpegDataUrl(task.board[i].src, MAX_SIDE, 0.9));
    } catch (e) {
      throw new Error(
        `图${i + 1} 读不出来（${e.message}）。多半是 blob/懒加载图——` +
        `在原网页右键“在新标签页打开图片”拿到真实地址后重新加入。`
      );
    }
  }
  return out;
}

async function fullAndThumb(blob) {
  const full = await blobToDataUrl(blob);
  const thumb = await downscaleToJpeg(blob, 240, 0.8);
  return { full, thumb };
}

async function toJpegDataUrl(src, maxSide, q) {
  const resp = await fetch(src);
  if (!resp.ok) throw new Error("HTTP " + resp.status);
  return await downscaleToJpeg(await resp.blob(), maxSide, q);
}

async function downscaleToJpeg(blob, maxSide, q) {
  const bm = await createImageBitmap(blob);
  let w = bm.width, h = bm.height;
  const s = Math.min(1, maxSide / Math.max(w, h));
  w = Math.max(1, Math.round(w * s));
  h = Math.max(1, Math.round(h * s));
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bm, 0, 0, w, h);
  bm.close?.();
  return await blobToDataUrl(await c.convertToBlob({ type: "image/jpeg", quality: q }));
}

function blobToDataUrl(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(new Error("编码失败"));
    r.readAsDataURL(blob);
  });
}

// ---------- UI 小工具 ----------
function setBusy(b) {
  busy = b;
  $("genBtn").disabled = b || task.board.length === 0;
  $("genBtn").querySelector(".spinner").classList.toggle("hidden", !b);
  $("genBtn").querySelector(".btn-label").textContent = b ? "生成中…" : "融合生成";
}
function setStatus(msg, isErr) {
  const el = $("statusMsg");
  el.textContent = msg;
  el.classList.toggle("err", !!isErr);
}
