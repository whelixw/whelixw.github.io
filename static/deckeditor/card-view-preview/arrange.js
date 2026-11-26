"use strict";

const chosenCards = new Set();
const deckRows = 3;
const deckColumns = { pool: 10, main: 10, side: 3 };
const zoneZoom = { booster: 100, pool: 100, main: 100, side: 100 };
const placementMode = new URL(location.href || location.origin).searchParams.get("placement") === "last" ? "last" : "first";
const lastPlacement = new WeakMap();

function destinationCell(zone, cell, state = draft) {
  return cell ?? (placementMode === "last" ? lastPlacement.get(state)?.[zone] : undefined) ?? 0;
}

function setZoneZoom(zone, value) {
  zoneZoom[zone] = value;
  $("table").style.setProperty(`--zoom-${zone}`, value / 100);
  const slider = $("table").querySelector(`[data-zoom="${zone}"]`);
  if (slider) slider.value = value;
  try { localStorage.setItem("deckeditor-card-view-preview-zone-zoom", JSON.stringify(zoneZoom)); } catch {}
}

function setupZoneZoom() {
  const table = $("table");
  const storageKey = "deckeditor-card-view-preview-zone-zoom";
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    for (const zone of Object.keys(zoneZoom)) {
      const value = saved?.[zone];
      if (Number.isInteger(value) && value >= 10 && value <= 200) setZoneZoom(zone, value);
    }
  } catch {}
  table.querySelector('[data-zoom="booster"]').value = zoneZoom.booster;
  table.addEventListener("input", (event) => {
    const zone = event.target.dataset.zoom;
    if (!Object.hasOwn(zoneZoom, zone)) return;
    setZoneZoom(zone, event.target.valueAsNumber);
  });
  table.addEventListener("wheel", (event) => {
    if (!event.deltaY || event.shiftKey || event.target.closest("select, .trap-components")) return;
    const canvas = event.target.closest(".zone-cards, #pack");
    if (!canvas) return;
    const zone = canvas.id === "pack" ? "booster" : canvas.closest("[data-zone]").dataset.zone;
    event.preventDefault();
    const oldZoom = zoneZoom[zone];
    const value = Math.max(10, Math.min(200, oldZoom + (event.deltaY < 0 ? 10 : -10)));
    if (oldZoom === value) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    const left = (canvas.scrollLeft + x) * value / oldZoom - x;
    const top = (canvas.scrollTop + y) * value / oldZoom - y;
    setZoneZoom(zone, value); canvas.scrollTo({ left, top });
  }, { passive: false });
}

function orderedZone(zone, state = draft) {
  return editorPicks(state).filter((pick) => pick.zone === zone).sort((left, right) =>
    (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER));
}

function selectedCards() {
  return [...chosenCards].map(findEditorPick).filter(Boolean);
}

function updateArrangeControls() {
  const selected = selectedCards();
  $("selection-count").textContent = `${selected.length} selected`;
  const selectedByZone = new Map();
  for (const { zone } of selected) selectedByZone.set(zone, (selectedByZone.get(zone) ?? 0) + 1);
  for (const counter of zones.querySelectorAll("[data-card-total]")) {
    const count = selectedByZone.get(counter.closest("[data-zone]").dataset.zone) ?? 0;
    counter.dataset.selected = count;
    counter.textContent = `${count}/${counter.dataset.cardTotal}`;
  }
  $("sort-cards").disabled = !editorPicks().length;
  $("sort-cards").textContent = selected.length ? `Sort ${selected.length} selected ▾` : `Sort ${labels[activeEditorZone]} ▾`;
  updateEditorHistoryControls();
  for (const card of $("zones").querySelectorAll("[data-pick]")) {
    card.classList.toggle("chosen", chosenCards.has(card.dataset.pick));
  }
}

function showSortMenu(open) {
  $("sort-options").hidden = !open;
  $("sort-cards").setAttribute("aria-expanded", String(open));
}

function draggedCards(id) {
  if (!chosenCards.has(id)) return [id];
  return zoneKeys.flatMap((zone) => orderedZone(zone))
    .filter((pick) => chosenCards.has(String(pick.id))).map((pick) => String(pick.id));
}

function deckPiles(zone, state = draft, mergeCollisions = false) {
  const groups = new Map();
  for (const pick of orderedZone(zone, state)) {
    const key = pick.stack || `card-${pick.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(pick);
  }
  const placed = new Map();
  const waiting = [];
  for (const pile of groups.values()) {
    const cell = pile[0].cell;
    if (!Number.isSafeInteger(cell) || cell < 0) {
      waiting.push(pile);
    } else if (!placed.has(cell)) {
      placed.set(cell, pile);
    } else if (mergeCollisions) {
      const existing = placed.get(cell);
      const stack = existing[0].stack || pile[0].stack || crypto.randomUUID();
      existing.push(...pile);
      for (const pick of existing) pick.stack = stack;
    } else {
      waiting.push(pile);
    }
  }
  let cell = 0;
  for (const pile of waiting) {
    while (placed.has(cell)) cell += 1;
    placed.set(cell, pile);
  }
  for (const [position, pile] of placed) {
    for (const pick of pile) pick.cell = position;
  }
  return placed;
}

function deckCoordinates(zone, cell) {
  const cols = deckColumns[zone];
  const overflow = cell - cols * deckRows;
  return overflow < 0
    ? { row: Math.floor(cell / cols) + 1, col: cell % cols + 1 }
    : { row: overflow % deckRows + 1, col: cols + Math.floor(overflow / deckRows) + 1 };
}

function placeCards(picks, zone, cell, state = draft) {
  if (!picks.length) return;
  const pile = deckPiles(zone, state).get(cell) || [];
  const remaining = pile.filter((pick) => !picks.includes(pick));
  const stack = remaining[0]?.stack || (remaining.length + picks.length > 1
    ? pile[0]?.stack || crypto.randomUUID() : undefined);
  let order = orderedZone(zone, state).reduce((maximum, pick) => Math.max(maximum, pick.order ?? -1), -1);
  for (const pick of remaining) {
    pick.stack = stack;
    if (pick.order === undefined) pick.order = ++order;
  }
  for (const pick of picks) {
    if (pick.zone !== zone) changeZone(pick, zone, state);
    Object.assign(pick, { zone, cell, stack, order: ++order });
  }
  if (!lastPlacement.has(state)) lastPlacement.set(state, {});
  lastPlacement.get(state)[zone] = cell;
}

function arrangeDrop(ids, zone, cell = destinationCell(zone)) {
  if (!editorActionDepth) return editorAction("arrange cards", () => arrangeDrop(ids, zone, cell));
  const picks = ids.map(findEditorPick).filter(Boolean);
  if (!picks.length) return;
  placeCards(picks, zone, cell);
  draft.submitted = false;
  save();
  renderEditor();
  renderSubmission();
  notice(`Placed ${picks.length === 1 ? "1 card" : `${picks.length} cards`} in ${labels[zone]}.`);
}

function setupSelectionBox(canvasRoot) {
  const overlay = $("selection-box");
  let gesture;
  canvasRoot.addEventListener("pointerdown", (event) => {
    const canvas = event.target.closest(".zone-cards");
    if (!canvas || event.button !== 0 || event.pointerType === "touch" || event.target.closest("[data-pick]")) return;
    if (event.target === canvas) {
      const rect = canvas.getBoundingClientRect();
      if (event.clientX >= rect.left + canvas.clientWidth || event.clientY >= rect.top + canvas.clientHeight) return;
    }
    $("card-actions").hidden = true;
    showSortMenu(false);
    gesture = {
      canvas,
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      previous: event.ctrlKey || event.metaKey || event.shiftKey ? [...chosenCards] : [],
    };
    canvas.setPointerCapture(event.pointerId);
  });
  document.addEventListener("pointermove", (event) => {
    if (gesture?.pointer !== event.pointerId) return;
    const { canvas, x, y, previous } = gesture;
    if (!canvas.isConnected) {
      gesture = null;
      overlay.hidden = true;
      return;
    }
    if (overlay.hidden && Math.hypot(event.clientX - x, event.clientY - y) < 5) return;
    const bounds = canvas.getBoundingClientRect();
    const endX = Math.max(bounds.left, Math.min(event.clientX, bounds.right));
    const endY = Math.max(bounds.top, Math.min(event.clientY, bounds.bottom));
    const left = Math.min(x, endX);
    const top = Math.min(y, endY);
    const right = Math.max(x, endX);
    const bottom = Math.max(y, endY);
    Object.assign(overlay.style, { left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px` });
    overlay.hidden = false;
    chosenCards.clear();
    for (const id of previous) chosenCards.add(id);
    for (const card of canvas.querySelectorAll("[data-pick]")) {
      const rect = card.getBoundingClientRect();
      const visibleBottom = card.nextElementSibling?.getBoundingClientRect().top ?? rect.bottom;
      if (left < rect.right && right > rect.left && top < visibleBottom && bottom > rect.top) {
        chosenCards.add(card.dataset.pick);
      }
    }
    updateArrangeControls();
  });
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) {
    document.addEventListener(name, (event) => {
      if (gesture?.pointer !== event.pointerId) return;
      if (name === "pointerup" && overlay.hidden && !gesture.previous.length) {
        chosenCards.clear();
        updateArrangeControls();
      }
      gesture = null;
      overlay.hidden = true;
    });
  }
}

function showCardMenu(menu, x, y) {
  menu.hidden = false;
  menu.style.left = `${Math.max(4, Math.min(x + 5, innerWidth - menu.offsetWidth - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(y + 5, innerHeight - menu.offsetHeight - 4))}px`;
}

function setupCardActions() {
  const menu = $("card-actions");
  let anchor;
  const close = () => {
    menu.hidden = true;
    anchor?.querySelector(".card-menu-toggle")?.setAttribute("aria-expanded", "false");
  };
  document.addEventListener("pointerdown", (event) => { if (!menu.contains(event.target)) close(); });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !menu.hidden) { close(); anchor?.focus(); }
  });
  return (card, x, y, keyboard = false) => {
    anchor = card;
    const clicked = findEditorPick(card.dataset.pick);
    if (!clicked) return;
    if (!chosenCards.has(String(clicked.id))) {
      chosenCards.clear(); chosenCards.add(String(clicked.id)); updateArrangeControls();
    }
    const selection = selectedCards();
    const ids = selection.map(({ id }) => String(id));
    const pick = selection.length === 1 ? selection[0] : null;
    const standaloneChoice = pick && isStandaloneTrapChoice(pick.cardId);
    const origin = standaloneChoice ? { trap: pick, choicePath: "root" } : pick && trapOrigin(pick);
    $("card-action-scope").textContent = `Actions for ${ids.length} selected ${ids.length === 1 ? "card" : "cards"}`;
    showSortMenu(false);
    const moves = $("card-action-move"); moves.replaceChildren();
    for (const zone of zoneKeys.filter((zone) => selection.some((pick) => pick.zone !== zone))) {
      const move = document.createElement("button"); move.type = "button";
      move.textContent = `Move ${ids.length} selected to ${labels[zone]}`;
      move.onclick = () => { close(); arrangeDrop(ids, zone); }; moves.append(move);
    }
    const unstack = $("card-action-unstack");
    unstack.hidden = !selection.some(({ stack }) => stack);
    unstack.onclick = () => { close(); editorAction("unstack selection", () => {
      for (const pick of selection.filter(({ stack }) => stack)) {
        delete pick.stack;
        delete pick.cell;
      }
      for (const zone of new Set(selection.map(({ zone }) => zone))) deckPiles(zone);
      save(); renderEditor();
    }); };
    const expandable = selection.filter(({ cardId }) => canExpandTrap(cardId));
    const coveredChoice = pick && isTrapChoice(pick.cardId) && card.nextElementSibling;
    const trap = $("card-action-trap"); trap.hidden = !coveredChoice && !expandable.length;
    trap.textContent = coveredChoice ? "Bring choices to front" : "Expand selected traps";
    trap.onclick = () => { close(); editorAction(coveredChoice ? "bring choices to front" : "expand traps", () => {
      if (coveredChoice) {
        const cards = orderedZone(pick.zone).filter((entry) => entry !== pick).concat(pick);
        cards.forEach((entry, index) => { entry.order = index; }); save(); renderEditor();
      } else for (const entry of expandable) resolveTrap(entry, {});
    }); };
    const options = $("card-action-options"); options.replaceChildren();
    if (origin?.choicePath) {
      const paths = pick.path ? pick.path.split(".").map((_, index, parts) => parts.slice(0, index + 1).join(".")) : [origin.choicePath];
      for (const path of paths) {
        const choice = trapChoiceNode(origin.trap, path);
        if (choice?.[0] !== "AnyNode") continue;
        choice[1].forEach(([option], index) => {
          if (String(index) === origin.trap.choices?.[path]) return;
          const button = document.createElement("button"); button.type = "button";
          button.textContent = `${standaloneChoice || (path === pick.path && isTrapChoice(pick.cardId)) ? "Choose" : "Reselect"} ${trapSummary(option)}`;
          button.onclick = () => { close(); chooseTrapOption(origin.trap, path, index); }; options.append(button);
        });
      }
    }
    // Capture branch targets before any collapse changes member IDs.
    const plans = selection.flatMap((member) => {
      const origin = trapOrigin(member);
      return origin ? [{ trap: origin.trap, member, path: trapCollapsePath(origin.trap, member) }] : [];
    }).filter((plan, index, all) => !all.some((other, otherIndex) => other.trap === plan.trap
      && (other.path === plan.path ? otherIndex < index : !other.path || (plan.path && plan.path.startsWith(`${other.path}.`)))));
    const collapse = $("card-action-collapse"); collapse.hidden = !plans.length;
    collapse.textContent = ids.length > 1 ? "Collapse selected traps / choices" : plans[0]?.path ? "Collapse choice" : "Collapse trap";
    collapse.onclick = () => { close(); editorAction("collapse traps", () => {
      for (const plan of plans) collapseTrap(plan.trap, plan.member);
    }); };
    const added = selection.filter(({ addedPrinting, addedBasic }) => addedPrinting || addedBasic);
    const remove = $("card-action-remove-basic"); remove.hidden = !added.length;
    remove.textContent = `Remove ${added.length} selected added ${added.length === 1 ? "basic" : "basics"}`;
    remove.onclick = () => { close(); editorAction("remove added basics", () => {
      const removed = new Set(added.map(({ id }) => String(id)));
      draft.picks = draft.picks.filter(({ id }) => !removed.has(String(id)));
      for (const id of removed) chosenCards.delete(id);
      draft.submitted = false; save(); renderEditor(); renderSubmission();
    }); };
    for (const button of menu.querySelectorAll("[data-sort]")) {
      button.hidden = ids.length < 2;
      button.onclick = () => { close(); sortSelection(button.dataset.sort); };
    }
    for (const button of menu.querySelectorAll("[data-layout]")) {
      button.onclick = () => { close(); applyLayout(button.dataset.layout); };
    }
    $("card-action-fit").onclick = () => { close(); for (const zone of new Set(selection.map(({ zone }) => zone))) fitEditorView(zone); };
    anchor.querySelector(".card-menu-toggle")?.setAttribute("aria-expanded", "true");
    showCardMenu(menu, x, y);
    if (keyboard) menu.querySelector("button:not([hidden])")?.focus();
  };
}

function setupPaneDividers() {
  const table = $("table");
  const bind = (id, axis, first, second, initial, minimum, maximum) => {
    const handle = $(id);
    const key = `deckeditor-card-view-preview-${id}`;
    let ratio = initial;
    const set = (value) => {
      ratio = Math.min(maximum, Math.max(minimum, value));
      table.style.setProperty(first, `${ratio}fr`);
      table.style.setProperty(second, `${1 - ratio}fr`);
      handle.setAttribute("aria-valuenow", String(Math.round(ratio * 100)));
    };
    const persist = () => { try { localStorage.setItem(key, String(ratio)); } catch {} };
    try {
      const saved = Number(localStorage.getItem(key));
      if (saved >= minimum && saved <= maximum) ratio = saved;
    } catch {}
    handle.setAttribute("aria-valuemin", String(minimum * 100));
    handle.setAttribute("aria-valuemax", String(maximum * 100));
    set(ratio);
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      handle.focus();
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener("pointermove", (event) => {
      if (!handle.hasPointerCapture(event.pointerId)) return;
      const rect = table.getBoundingClientRect();
      set(axis === "x" ? (event.clientX - rect.left) / rect.width : (event.clientY - rect.top) / rect.height);
    });
    handle.addEventListener("lostpointercapture", persist);
    handle.addEventListener("keydown", (event) => {
      const previous = axis === "x" ? "ArrowLeft" : "ArrowUp";
      const next = axis === "x" ? "ArrowRight" : "ArrowDown";
      if (![previous, next, "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      set(event.key === "Home" ? minimum : event.key === "End" ? maximum : ratio + (event.key === next ? .03 : -.03));
      persist();
    });
  };
  bind("deck-divider", "x", "--main-track", "--side-track", .75, .30, .85);
  bind("pool-divider", "y", "--upper-track", "--lower-track", .50, .24, .76);
}

function setupArrangement() {
  setupLayoutControls();
  setupPaneDividers();
  setupZoneZoom();
  const controls = $("deck-actions-toggle");
  controls.addEventListener("click", () => {
    const visible = document.body.classList.contains("deck-controls-hidden");
    document.body.classList.toggle("deck-controls-hidden", !visible);
    controls.setAttribute("aria-pressed", String(visible));
    if (!visible) showSortMenu(false);
  });
  const keepTop = $("keep-card-top");
  try { keepTop.checked = localStorage.getItem("deckeditor-card-view-preview-keep-card-top") === "true"; } catch {}
  document.body.classList.toggle("keep-card-top", keepTop.checked);
  keepTop.addEventListener("change", () => {
    document.body.classList.toggle("keep-card-top", keepTop.checked);
    try { localStorage.setItem("deckeditor-card-view-preview-keep-card-top", String(keepTop.checked)); } catch {}
  });
  const names = $("show-card-names");
  try { names.checked = localStorage.getItem("deckeditor-card-view-preview-show-card-names") === "true"; } catch {}
  const showNames = () => document.body.classList.toggle("show-card-names", names.checked);
  showNames();
  names.addEventListener("change", () => {
    showNames();
    try { localStorage.setItem("deckeditor-card-view-preview-show-card-names", String(names.checked)); } catch {}
    renderEditor();
    if (traps.has(previewed)) renderPreview();
  });
  setupSelectionBox($("zones"));
  const openActions = setupCardActions();
  function setTrapChoosing(row, enabled) {
    row.classList.toggle("choosing-trap", enabled);
    row.querySelector(".choose-trap")?.setAttribute("aria-pressed", String(enabled));
  }
  function selectCard(event, toggle, optionArtwork = false) {
    const row = event.target.closest("[data-pick]");
    if (!row || (!optionArtwork && event.target.closest("select,button"))) return;
    const id = row.dataset.pick;
    if (!toggle && !chosenCards.has(id)) chosenCards.clear();
    if (toggle && chosenCards.has(id)) chosenCards.delete(id);
    else chosenCards.add(id);
    updateArrangeControls();
    return row;
  }
  $("zones").addEventListener("click", (event) => {
    const row = event.target.closest("[data-pick]");
    const clicked = row && findEditorPick(row.dataset.pick);
    if (row && event.target.closest(".card-menu-toggle")) {
      event.stopPropagation(); openActions(row, event.clientX, event.clientY, event.detail === 0); return;
    }
    const toggle = event.ctrlKey || event.metaKey || event.shiftKey;
    const standaloneChoice = clicked && isStandaloneTrapChoice(clicked.cardId);
    const namedChoice = clicked && cardViewPreview && names.checked && isTrapChoice(clicked.cardId);
    const chooseButton = event.target.closest(".choose-trap");
    if ((standaloneChoice && chooseButton) || ((standaloneChoice || namedChoice) && !toggle && !event.target.closest("button"))) {
      chosenCards.clear();
      openActions(row, event.clientX, event.clientY, event.detail === 0);
      return;
    }
    if (clicked && isTrapChoice(clicked.cardId) && event.target.closest(".choose-trap")) {
      event.stopPropagation();
      const enabled = !row.classList.contains("choosing-trap");
      setTrapChoosing(row, enabled);
      if (enabled && event.detail === 0) row.querySelector("[data-trap-option]")?.focus();
      return;
    }
    const option = event.target.closest("[data-trap-option]");
    if (option && clicked && isTrapChoice(clicked.cardId)) {
      event.stopPropagation();
      if (event.ctrlKey || event.metaKey) {
        selectCard(event, true, true);
        return;
      }
      if (cardViewPreview && names.checked) return;
      if (!names.checked && !event.shiftKey && !row.classList.contains("choosing-trap")) return;
      const origin = trapOrigin(clicked);
      if (origin?.choicePath) chooseTrapOption(origin.trap, origin.choicePath, Number(option.dataset.trapOption));
      return;
    }
    if (row && event.target.closest(".inspect-trap")) {
      event.preventDefault(); event.stopPropagation();
      if (clicked && canExpandTrap(clicked.cardId)) resolveTrap(clicked, {});
      return;
    }
    if (event.shiftKey && clicked && canExpandTrap(clicked.cardId)
      && !event.target.closest("select, .trap-component-toggle")) {
      event.preventDefault(); event.stopPropagation(); resolveTrap(clicked, {}); return;
    }
    const selectedRow = selectCard(event, toggle);
    if (selectedRow && !toggle && names.checked && clicked && canExpandTrap(clicked.cardId)) {
      openActions(selectedRow, event.clientX, event.clientY);
    }
  });
  $("zones").addEventListener("contextmenu", (event) => {
    const row = event.target.closest("[data-pick]");
    if (!row) return;
    event.preventDefault();
    const keyboard = !event.clientX && !event.clientY;
    const bounds = keyboard && row.getBoundingClientRect();
    openActions(row, bounds ? bounds.left : event.clientX, bounds ? bounds.bottom : event.clientY, keyboard);
  });
  for (const type of ["pointerout", "focusout"]) {
    $("zones").addEventListener(type, (event) => {
      const row = event.target.closest(".choosing-trap");
      if (row && !row.contains(event.relatedTarget)) setTrapChoosing(row, false);
    });
  }
  $("zones").addEventListener("keydown", (event) => {
    const choosing = event.target.closest(".choosing-trap");
    if (event.key === "Escape" && choosing) {
      event.preventDefault();
      event.stopPropagation();
      setTrapChoosing(choosing, false);
      choosing.querySelector(".choose-trap")?.focus();
      return;
    }
    if (!["Space", "Enter"].includes(event.code) || !event.target.closest("[data-pick]") || event.target.closest("select,button")) return;
    event.preventDefault();
    const row = selectCard(event, event.code === "Space");
    if (row && event.code === "Enter") {
      const bounds = row.getBoundingClientRect();
      openActions(row, bounds.right, bounds.top, true);
    }
  });
  $("sort-cards").addEventListener("click", () => {
    showSortMenu($("sort-options").hidden);
    if (!$("sort-options").hidden) $("sort-options").querySelector("button").focus();
  });
  document.addEventListener("click", (event) => {
    if (!$("sort-control").contains(event.target)) showSortMenu(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || $("sort-options").hidden) return;
    showSortMenu(false);
    $("sort-cards").focus();
  });
  $("sort-options").addEventListener("click", (event) => {
    const sort = event.target.closest("[data-sort]")?.dataset.sort;
    if (!sort) return;
    showSortMenu(false);
    $("sort-cards").focus();
    sortSelection(sort);
  });
}

function sortSelection(sort, onlyZone) {
  return editorAction(`sort by ${sort}`, () => {
    const targets = new Set(editorTargets().map(({ id }) => String(id)));
    for (const zone of onlyZone ? [onlyZone] : zoneKeys) {
      const picks = [...deckPiles(zone)].sort(([left], [right]) => left - right).flatMap(([, pile]) => pile);
      if (!picks.some(({ id }) => targets.has(String(id)))) continue;
      const selected = picks.filter(({ id }) => targets.has(String(id))).sort((a, b) => compareEditorCards(sort, a, b));
      const positions = picks.map(({ stack, cell }) => ({ stack, cell }));
      picks.forEach((pick, index) => {
        const next = targets.has(String(pick.id)) ? selected.shift() : pick;
        next.order = index; Object.assign(next, positions[index]);
      });
    }
    save(); renderEditor();
  });
}

function manaValue(mana) {
  return [...(mana || "").matchAll(/\{([^}]+)\}/g)].reduce((total, [, symbol]) =>
    total + (/^[XYZ]$/.test(symbol) ? 0 : Number.parseInt(symbol, 10) || 1), 0);
}
