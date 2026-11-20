"use strict";

let activeEditorZone = "main";
const builtinLayouts = [
  { id: "curve", name: "Mana curve", columns: "mana", rows: "kind", order: "name" },
  { id: "colors", name: "Color overview", columns: "color", rows: "none", order: "mana" },
  { id: "review", name: "Deck review", columns: "none", rows: "land", order: "name" },
];
let savedLayouts = [];
try {
  const saved = JSON.parse(localStorage.getItem("deckeditor-layout-presets"));
  if (Array.isArray(saved)) savedLayouts = saved.filter((preset) => preset && typeof preset.id === "string"
    && !builtinLayouts.some(({ id }) => id === preset.id) && typeof preset.name === "string" && preset.name.trim()
    && ["mana", "color", "none"].includes(preset.columns) && ["kind", "land", "none"].includes(preset.rows)
    && ["mana", "color", "name"].includes(preset.order)).slice(0, 30);
} catch {}

function editorTargets() {
  const selection = selectedCards();
  return selection.length ? selection : orderedZone(activeEditorZone);
}

function compareEditorCards(sort, left, right) {
  const a = cardInfo(left.cardId), b = cardInfo(right.cardId);
  if (sort === "mana" && a.manaValue !== b.manaValue) return a.manaValue - b.manaValue;
  if (sort === "color" && a.color !== b.color) return "WUBRGMC".indexOf(a.color) - "WUBRGMC".indexOf(b.color);
  return a.name.localeCompare(b.name);
}

function applyLayout(idOrPreset) {
  const preset = typeof idOrPreset === "string" ? [...builtinLayouts, ...savedLayouts].find(({ id }) => id === idOrPreset) : idOrPreset;
  if (!preset) return;
  return editorAction(`layout: ${preset.name}`, () => {
    const targets = editorTargets();
    const ids = new Set(targets.map(({ id }) => String(id)));
    for (const zone of zoneKeys) {
      const selected = targets.filter((pick) => pick.zone === zone);
      if (!selected.length) continue;
      const occupied = new Set([...deckPiles(zone)].filter(([, pile]) => pile.some(({ id }) => !ids.has(String(id)))).map(([cell]) => cell));
      const groups = new Map();
      for (const pick of selected) {
        const info = cardInfo(pick.cardId);
        const land = /\bLand\b/i.test(info.type);
        const creature = /\bCreature\b/i.test(info.type);
        const row = preset.rows === "none" ? 0 : land ? 2 : preset.rows === "kind" && !creature ? 1 : 0;
        const column = preset.columns === "mana" ? (land ? 0 : info.manaValue)
          : preset.columns === "color" ? Math.max(0, "WUBRGMC".indexOf(info.color)) : 0;
        const key = `${row}:${column}`;
        if (!groups.has(key)) groups.set(key, { row, column, picks: [] });
        groups.get(key).picks.push(pick);
      }
      const columns = [...new Set([...groups.values()].map(({ column }) => column))].sort((a, b) => a - b);
      for (const group of [...groups.values()].sort((a, b) => a.row - b.row || a.column - b.column)) {
        let column = columns.indexOf(group.column);
        const cellAt = (col) => col < deckColumns[zone] ? group.row * deckColumns[zone] + col
          : deckColumns[zone] * deckRows + (col - deckColumns[zone]) * deckRows + group.row;
        while (occupied.has(cellAt(column))) column++;
        const cell = cellAt(column);
        occupied.add(cell);
        const stack = group.picks.length > 1 ? crypto.randomUUID() : undefined;
        group.picks.sort((a, b) => compareEditorCards(preset.order, a, b)).forEach((pick, order) => {
          Object.assign(pick, { cell, stack, order });
        });
      }
    }
    save(); renderEditor();
    notice(`Applied ${preset.name} to ${targets.length} cards.`);
  });
}

function fitEditorView(zone = activeEditorZone) {
  const canvas = zones.querySelector(`[data-zone="${zone}"] .zone-cards`);
  if (!canvas) return;
  const selected = selectedCards().filter((pick) => pick.zone === zone);
  const ids = new Set(selected.map(({ id }) => String(id)));
  const cards = [...canvas.querySelectorAll("[data-pick]")].filter((card) => !ids.size || ids.has(card.dataset.pick));
  if (!cards.length) return;
  const bounds = () => {
    const rects = cards.map((card) => card.getBoundingClientRect());
    return { left: Math.min(...rects.map((r) => r.left)), top: Math.min(...rects.map((r) => r.top)),
      right: Math.max(...rects.map((r) => r.right)), bottom: Math.max(...rects.map((r) => r.bottom)) };
  };
  for (let pass = 0; pass < 3; pass++) {
    const box = bounds();
    const ratio = Math.min((canvas.clientWidth - 16) / (box.right - box.left), (canvas.clientHeight - 16) / (box.bottom - box.top));
    if (!Number.isFinite(ratio) || ratio <= 0) return;
    setZoneZoom(zone, Math.max(10, Math.min(200, Math.floor(zoneZoom[zone] * ratio))));
  }
  const box = bounds(), viewport = canvas.getBoundingClientRect();
  canvas.scrollTo({ left: canvas.scrollLeft + box.left - viewport.left - 8,
    top: canvas.scrollTop + box.top - viewport.top - 8 });
}

function setupLayoutControls() {
  const loadPreset = (id) => {
    const preset = [...builtinLayouts, ...savedLayouts].find((preset) => preset.id === id) || builtinLayouts[0];
    for (const key of ["name", "columns", "rows", "order"]) $(`layout-${key}`).value = preset[key];
    $("layout-delete").disabled = !savedLayouts.some(({ id }) => id === preset.id);
  };
  const listPresets = (id = "curve") => {
    $("layout-preset").replaceChildren(...[...builtinLayouts, ...savedLayouts].map((preset) => {
      const option = document.createElement("option"); option.value = preset.id; option.textContent = preset.name; return option;
    }));
    $("layout-preset").value = id;
    loadPreset(id);
  };
  const formPreset = () => ({ name: $("layout-name").value.trim(), columns: $("layout-columns").value,
    rows: $("layout-rows").value, order: $("layout-order").value });
  $("layout-presets-open").addEventListener("click", () => {
    showSortMenu(false); listPresets();
    $("layout-scope").textContent = selectedCards().length ? `Applies to ${selectedCards().length} selected cards.` : `Applies to all cards in ${labels[activeEditorZone]}.`;
    $("layout-status").textContent = ""; $("layout-dialog").showModal();
  });
  $("layout-preset").addEventListener("change", () => loadPreset($("layout-preset").value));
  $("layout-form").addEventListener("submit", (event) => {
    event.preventDefault(); const preset = formPreset(); if (!preset.name) return;
    applyLayout(preset); $("layout-dialog").close();
  });
  const persist = () => {
    try { localStorage.setItem("deckeditor-layout-presets", JSON.stringify(savedLayouts)); return true; }
    catch { $("layout-status").textContent = "Browser storage is unavailable; preset changes could not be saved."; return false; }
  };
  $("layout-save").addEventListener("click", () => {
    const preset = formPreset(); if (!preset.name) { $("layout-name").focus(); return; }
    const existing = savedLayouts.find(({ id }) => id === $("layout-preset").value);
    if (!existing && savedLayouts.length >= 30) { $("layout-status").textContent = "Delete a saved preset before adding another (maximum 30)."; return; }
    const id = existing?.id || crypto.randomUUID();
    savedLayouts = savedLayouts.filter((item) => item.id !== id).concat({ ...preset, id });
    if (persist()) { listPresets(id); $("layout-status").textContent = "Preset saved."; }
  });
  $("layout-delete").addEventListener("click", () => {
    savedLayouts = savedLayouts.filter(({ id }) => id !== $("layout-preset").value);
    if (persist()) { listPresets(); $("layout-status").textContent = "Saved preset deleted."; }
  });
  $("sort-options").addEventListener("click", (event) => {
    const id = event.target.closest("[data-layout]")?.dataset.layout;
    if (id) { showSortMenu(false); applyLayout(id); }
  });
  for (const name of ["pointerdown", "focusin"]) zones.addEventListener(name, (event) => {
    const zone = event.target.closest("[data-zone]")?.dataset.zone;
    if (zone) { activeEditorZone = zone; updateArrangeControls(); }
  });
  zones.addEventListener("click", (event) => {
    const zone = event.target.closest("[data-fit-zone]")?.dataset.fitZone;
    if (zone) fitEditorView(zone);
  });
  document.addEventListener("keydown", (event) => {
    if (event.target.closest("input,textarea,select,dialog,[contenteditable=true]")) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault(); replayEditorAction(event.shiftKey ? "redo" : "undo");
    } else if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === "f") {
      event.preventDefault(); fitEditorView();
    }
  });
}
