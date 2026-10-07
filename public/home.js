/* BOSS X Home Page - independent of the existing license implementation. */
(() => {
  const HOME_KEY = "bossxHomeShortcuts";
  const home = document.getElementById("bossHomePage");
  const list = document.getElementById("bxHomeShortcuts");
  const modal = document.getElementById("bxHomeModal");
  const nameInput = document.getElementById("bxWebsiteName");
  const urlInput = document.getElementById("bxWebsiteUrl");
  let editingIndex = -1;

  if (!home || !list || !modal) return;

  function accessIsValid() {
    try {
      const x = JSON.parse(localStorage.getItem("bxp_access") || "null");
      return !!(x?.ok && (!x.expiresAt || new Date(x.expiresAt) > new Date()));
    } catch { return false; }
  }

  function getShortcuts() {
    try {
      const x = JSON.parse(localStorage.getItem(HOME_KEY) || "[]");
      return Array.isArray(x) ? x : [];
    } catch { return []; }
  }

  function saveShortcuts(items) {
    localStorage.setItem(HOME_KEY, JSON.stringify(items));
  }

  function safeUrl(raw) {
    try {
      const u = new URL(raw.trim());
      if (u.protocol !== "http:" && u.protocol !== "https:") return null;
      return u.href;
    } catch { return null; }
  }

  function iconFor(name) {
    const n = name.toLowerCase();
    if (n.includes("whatsapp")) return "WA";
    if (n.includes("facebook")) return "f";
    if (n.includes("instagram")) return "◎";
    if (n.includes("youtube")) return "▶";
    return "WEB";
  }

  function render() {
    list.innerHTML = "";
    const items = getShortcuts();
    const add = document.createElement("button");
    add.type = "button";
    add.className = "bxShortcut bxAddShortcut";
    add.innerHTML = '<span class="bxShortcutIcon">＋</span><strong>ADD</strong><small>Website shortcut</small>';
    add.addEventListener("click", () => openModal(-1));
    list.appendChild(add);

    items.forEach((item, index) => {
      const card = document.createElement("div");
      card.className = "bxShortcut";
      card.innerHTML = `
        <span class="bxShortcutIcon">${iconFor(item.name)}</span>
        <div>
          <div class="bxShortcutName" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</div>
          <div class="bxShortcutUrl">${escapeHtml(item.url)}</div>
        </div>
        <div class="bxShortcutActions">
          <button class="bxMiniBtn" type="button" data-action="open">OPEN</button>
          <button class="bxMiniBtn" type="button" data-action="edit">EDIT</button>
          <button class="bxMiniBtn" type="button" data-action="delete">DELETE</button>
        </div>`;
      card.querySelector('[data-action="open"]').addEventListener("click", () => window.open(item.url, "_blank", "noopener"));
      card.querySelector('[data-action="edit"]').addEventListener("click", () => openModal(index));
      card.querySelector('[data-action="delete"]').addEventListener("click", () => {
        const next = getShortcuts();
        next.splice(index, 1);
        saveShortcuts(next);
        render();
      });
      card.addEventListener("dblclick", () => window.open(item.url, "_blank", "noopener"));
      list.appendChild(card);
    });
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
  }

  function openModal(index) {
    editingIndex = index;
    const item = index >= 0 ? getShortcuts()[index] : null;
    document.getElementById("bxHomeModalTitle").textContent = item ? "Edit website" : "Add website";
    nameInput.value = item?.name || "";
    urlInput.value = item?.url || "";
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    setTimeout(() => nameInput.focus(), 0);
  }

  function closeModal() {
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    editingIndex = -1;
  }

  function syncVisibility() {
    const active = accessIsValid();
    home.classList.toggle("bx-home-visible", active);
    if (!active) closeModal();
    if (active) render();
  }

  document.getElementById("bxCancelShortcut")?.addEventListener("click", closeModal);
  document.getElementById("bxSaveShortcut")?.addEventListener("click", () => {
    const name = nameInput.value.trim();
    const url = safeUrl(urlInput.value);
    if (!name) return alert("Enter a website name.");
    if (!url) return alert("Enter a valid http:// or https:// website URL.");
    const items = getShortcuts();
    const record = {name, url};
    if (editingIndex >= 0) items[editingIndex] = record;
    else items.push(record);
    saveShortcuts(items);
    render();
    closeModal();
  });

  modal.addEventListener("click", e => { if (e.target === modal) closeModal(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });

  document.querySelectorAll("[data-bx-home-action=add]").forEach(el => el.addEventListener("click", () => openModal(-1)));
  document.querySelectorAll("[data-bx-home-action=refresh]").forEach(el => el.addEventListener("click", () => { render(); location.reload(); }));
  document.querySelectorAll("[data-bx-home-action=back]").forEach(el => el.addEventListener("click", () => history.back()));
  document.querySelectorAll("[data-bx-home-target]").forEach(el => el.addEventListener("click", () => {
    const target = document.querySelector(el.getAttribute("data-bx-home-target"));
    target?.scrollIntoView({behavior:"smooth", block:"start"});
  }));

  // Activation writes bxp_access; polling only observes it and never changes it.
  syncVisibility();
  window.setInterval(syncVisibility, 500);
})();
