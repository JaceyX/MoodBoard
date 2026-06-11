// ============ 任务数据层 ============
// 结构：
//   currentId            -> 当前任务 id
//   task:<id>            -> { id,title,createdAt,updatedAt,board[],prompt,size,results[] }
//   result:<rid>         -> 完整结果图的 base64（单独存，避免任务对象过大）
//   index                -> 轻量历史列表 [{id,title,...,thumb}]，按 updatedAt 倒序
// 结果图以 base64 落地，规避方舟图片 URL ~24h 失效的问题。

export const MAX_ITEMS = 10;

const KEY_CURRENT = "currentId";
const KEY_INDEX = "index";
const tkey = (id) => "task:" + id;
const rkey = (id) => "result:" + id;

function newTask() {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: "",
    createdAt: now,
    updatedAt: now,
    board: [],
    prompt: "",
    promptOverride: null, // 手动编辑的最终提示词；null = 用自动拼接
    size: "2K",
    results: [], // [{id,thumb,createdAt,prompt,size}]
  };
}

export async function getCurrentId() {
  const { [KEY_CURRENT]: id } = await chrome.storage.local.get(KEY_CURRENT);
  if (id && (await getTask(id))) return id;
  return await migrateOrCreate();
}

async function migrateOrCreate() {
  // 兼容 v0.1 的旧 board
  const { board } = await chrome.storage.local.get("board");
  const t = newTask();
  if (Array.isArray(board) && board.length) {
    t.board = board;
    await chrome.storage.local.remove("board");
  }
  await persist(t);
  await chrome.storage.local.set({ [KEY_CURRENT]: t.id });
  return t.id;
}

export async function createTask() {
  const t = newTask();
  await persist(t);
  await chrome.storage.local.set({ [KEY_CURRENT]: t.id });
  return t.id;
}

export async function getTask(id) {
  return (await chrome.storage.local.get(tkey(id)))[tkey(id)] || null;
}

export async function getCurrentTask() {
  return getTask(await getCurrentId());
}

export async function setCurrent(id) {
  await chrome.storage.local.set({ [KEY_CURRENT]: id });
}

export async function saveTask(task) {
  task.updatedAt = Date.now();
  await persist(task);
}

async function persist(task) {
  await chrome.storage.local.set({ [tkey(task.id)]: task });
  await indexUpsert(task);
}

export async function listTasks() {
  return (await chrome.storage.local.get(KEY_INDEX))[KEY_INDEX] || [];
}

export async function deleteTask(id) {
  const t = await getTask(id);
  const keys = [tkey(id), ...(t?.results || []).map((r) => rkey(r.id))];
  await chrome.storage.local.remove(keys);
  const index = (await listTasks()).filter((x) => x.id !== id);
  await chrome.storage.local.set({ [KEY_INDEX]: index });
  const { [KEY_CURRENT]: cur } = await chrome.storage.local.get(KEY_CURRENT);
  if (cur === id) await setCurrent(index[0]?.id || (await createTask()));
}

// 存一张结果图：完整 base64 单独落地，任务里只留缩略图+元数据
export async function addResult(task, fullDataUrl, thumb, meta) {
  const rid = crypto.randomUUID();
  await chrome.storage.local.set({ [rkey(rid)]: fullDataUrl });
  task.results.push({ id: rid, thumb, createdAt: Date.now(), ...meta });
  await saveTask(task);
  return rid;
}

export async function getResultImage(rid) {
  return (await chrome.storage.local.get(rkey(rid)))[rkey(rid)] || null;
}

async function indexUpsert(task) {
  let index = (await chrome.storage.local.get(KEY_INDEX))[KEY_INDEX] || [];
  const last = task.results[task.results.length - 1];
  const meta = {
    id: task.id,
    title: task.title?.trim() || autoTitle(task),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    itemCount: task.board.length,
    resultCount: task.results.length,
    thumb: last ? last.thumb : null,
  };
  const i = index.findIndex((t) => t.id === task.id);
  if (i >= 0) index[i] = meta;
  else index.unshift(meta);
  index.sort((a, b) => b.updatedAt - a.updatedAt);
  await chrome.storage.local.set({ [KEY_INDEX]: index });
}

function autoTitle(task) {
  const p = (task.prompt || "").trim();
  if (p) return p.slice(0, 20);
  const d = new Date(task.createdAt);
  return (
    "未命名 · " +
    d.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" }) +
    " " +
    d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
  );
}
