// ============ 豆包画板 · 后台 service worker（module） ============
import { getCurrentId, getTask, saveTask, MAX_ITEMS } from "./store.js";

const MENU_ID = "add-to-board";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: MENU_ID, title: "➕ 加入豆包画板", contexts: ["image"] });
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  refreshBadge();
});

chrome.runtime.onStartup.addListener(refreshBadge);

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !info.srcUrl) return;
  const task = await getTask(await getCurrentId());

  if (task.board.length >= MAX_ITEMS) { flash("满", "#c0392b"); openPanel(tab); return; }
  if (task.board.some((it) => it.src === info.srcUrl)) { flash("重", "#888"); openPanel(tab); return; }

  task.board.push({
    id: crypto.randomUUID(),
    src: info.srcUrl,
    pageUrl: info.pageUrl || tab?.url || "",
    dimension: "style",
    note: "",
    addedAt: Date.now(),
  });
  await saveTask(task);
  refreshBadge();
  openPanel(tab);
});

function openPanel(tab) {
  if (tab?.id != null) chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
}

chrome.storage.onChanged.addListener((c, area) => {
  if (area !== "local") return;
  if (c.currentId || Object.keys(c).some((k) => k.startsWith("task:"))) refreshBadge();
});

async function refreshBadge() {
  try {
    const task = await getTask(await getCurrentId());
    const n = task?.board.length || 0;
    chrome.action.setBadgeText({ text: n ? String(n) : "" });
    chrome.action.setBadgeBackgroundColor({ color: "#E8A04B" });
  } catch {}
}

function flash(text, color) {
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });
  setTimeout(refreshBadge, 1200);
}
