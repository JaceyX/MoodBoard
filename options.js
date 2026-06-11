const $ = (id) => document.getElementById(id);

(async function load() {
  const { settings = {} } = await chrome.storage.local.get("settings");
  $("apiKey").value = settings.apiKey || "";
  $("model").value = settings.model || "doubao-seedream-4-0-250828";
  $("watermark").checked = settings.watermark !== false;
})();

$("save").onclick = async () => {
  const settings = {
    apiKey: $("apiKey").value.trim(),
    model: $("model").value.trim() || "doubao-seedream-4-0-250828",
    watermark: $("watermark").checked,
  };
  await chrome.storage.local.set({ settings });
  const tip = $("saved");
  tip.textContent = "已保存 ✓";
  setTimeout(() => (tip.textContent = ""), 1800);
};
