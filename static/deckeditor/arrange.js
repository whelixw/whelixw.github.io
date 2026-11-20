"use strict";

const chosenCards = new Set();
const deckRows = 3;
const deckColumns = { pool: 10, main: 10, side: 3 };
const zoneZoom = { booster: 100, pool: 100, main: 100, side: 100 };

function setZoneZoom(zone, value) {
  zoneZoom[zone] = value;
  $("table").style.setProperty(`--zoom-${zone}`, value / 100);
  const slider = $("table").querySelector(`[data-zoom="${zone}"]`);
  if (slider) slider.value = value;
  try { localStorage.setItem("deckeditor-zone-zoom", JSON.stringify(zoneZoom)); } catch {}
}

function setupZoneZoom() {
  const table = $("table");
  const storageKey = "deckeditor-zone-zoom";
  const apply = (zone, value) => {
    setZoneZoom(zone, value);
  };
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    for (const zone of Object.keys(zoneZoom)) {
      const value = saved?.[zone];
      if (Number.isInteger(value) && value >= 10 && value <= 200) apply(zone, value);
    }
  } catch {}
  table.querySelector('[data-zoom="booster"]').value = zoneZoom.booster;
  table.addEventListener("input", (event) => {
    const zone = event.target.dataset.zoom;
    if (!Object.hasOwn(zoneZoom, zone)) return;
    apply(zone, event.target.valueAsNumber);
    try { localStorage.setItem(storageKey, JSON.stringify(zoneZoom)); } catch {}
  });
  table.addEventListener("wheel", (event) => {
    if (!event.deltaY || event.target.closest("select, .trap-components")) return;
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
    apply(zone, value); canvas.scrollTo({ left, top });
  }, { passive: false });
}

function orderedZone(zone) {
  return editorPicks().filter((pick) => pick.zone === zone).sort((left, right) =>
    (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER));
}

function selectedCards() {
  return [...chosenCards].map(findEditorPick).filter(Boolean);
}

function updateArrangeControls() {
  const selected = selectedCards();
  $("selection-count").textContent = `${selected.length} selected`;
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
  const source = findEditorPick(id);
  if (!chosenCards.has(id)) return [id];
  return orderedZone(source.zone).filter((pick) => chosenCards.has(String(pick.id))).map((pick) => String(pick.id));
}

function deckPiles(zone) {
  const groups = new Map();
  for (const pick of orderedZone(zone)) {
    const key = pick.stack || `card-${pick.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(pick);
  }
  const placed = new Map();
  const waiting = [];
  for (const pile of groups.values()) {
    const cell = pile[0].cell;
    if (Number.isSafeInteger(cell) && cell >= 0 && !placed.has(cell)) placed.set(cell, pile);
    else waiting.push(pile);
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

function arrangeDrop(ids, zone, targetId, cell) {
  if (!editorActionDepth) return editorAction("arrange cards", () => arrangeDrop(ids, zone, targetId, cell));
  if (ids.includes(targetId)) return;
  const picks = ids.map(findEditorPick).filter(Boolean);
  const target = findEditorPick(targetId);
  const stack = target || (cell !== undefined && picks.length > 1)
    ? target?.stack || crypto.randomUUID()
    : undefined;
  let moved = false;
  let arranged = false;
  const occupied = new Set(orderedZone(zone).filter((pick) => !ids.includes(String(pick.id))).map((pick) => pick.cell));
  if (!target && cell !== undefined) {
    while (occupied.has(cell)) cell += 1;
  }
  for (const pick of picks) {
    moved = changeZone(pick, zone) || moved;
    if (!target && cell !== undefined) {
      arranged = arranged || pick.cell !== cell;
      pick.cell = cell;
    } else if (target) {
      pick.cell = target.cell;
    }
    if (pick.stack || stack) arranged = true;
    pick.stack = stack || undefined;
  }
  if (!moved && !arranged) return;
  if (target) {
    target.stack = stack;
    const order = orderedZone(zone).filter((pick) => !ids.includes(String(pick.id)));
    const end = order.findLastIndex((pick) => pick.stack === stack);
    order.splice(end + 1, 0, ...picks);
    order.forEach((pick, index) => { pick.order = index; });
  }
  save();
  renderEditor();
  renderSubmission();
  notice(stack ? `Stacked ${picks.length === 1 ? "card" : `${picks.length} cards`}.`
    : moved ? `Moved cards to ${labels[zone]}.` : "Placed cards in the grid.");
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
    const origin = pick && trapOrigin(pick);
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
      for (const zone of zoneKeys) arrangeDrop(selection.filter((pick) => pick.zone === zone).map(({ id }) => String(id)), zone);
    }); };
    const expandable = selection.filter(({ cardId }) => traps.has(cardId) && !isTrapChoice(cardId));
    const coveredChoice = pick && isTrapChoice(pick.cardId) && card.nextElementSibling;
    const trap = $("card-action-trap"); trap.hidden = !coveredChoice && !expandable.length;
    trap.textContent = coveredChoice ? "Bring choices to front" : "Expand selected traps";
    trap.onclick = () => { close(); editorAction(coveredChoice ? "bring choices to front" : "expand traps", () => {
      if (coveredChoice) {
        const cards = orderedZone(pick.zone).filter((entry) => entry !== pick).concat(pick);
        cards.forEach((entry, index) => { entry.order = index; }); save(); renderEditor();
      } else for (const entry of expandable) resolveTrap(entry, entry.choices || {});
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
          button.textContent = `${path === pick.path && isTrapChoice(pick.cardId) ? "Choose" : "Reselect"} ${trapSummary(option)}`;
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
    const added = selection.filter(({ addedPrinting }) => addedPrinting);
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
    menu.hidden = false;
    anchor.querySelector(".card-menu-toggle")?.setAttribute("aria-expanded", "true");
    menu.style.left = `${Math.max(4, Math.min(x + 5, innerWidth - menu.offsetWidth - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y + 5, innerHeight - menu.offsetHeight - 4))}px`;
    if (keyboard) moves.querySelector("button")?.focus();
  };
}

function setupPaneDividers() {
  const table = $("table");
  const bind = (id, axis, first, second, initial, minimum, maximum) => {
    const handle = $(id);
    const key = `deckeditor-${id}`;
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
  setupSelectionBox($("zones"));
  const openActions = setupCardActions();
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
    if (row && event.target.closest(".inspect-trap")) {
      event.preventDefault(); event.stopPropagation();
      if (clicked && traps.has(clicked.cardId) && !isTrapChoice(clicked.cardId)) resolveTrap(clicked, clicked.choices || {});
      return;
    }
    if (event.shiftKey && clicked && traps.has(clicked.cardId) && !isTrapChoice(clicked.cardId)
      && !event.target.closest("select, .trap-component-toggle")) {
      event.preventDefault(); event.stopPropagation(); resolveTrap(clicked, clicked.choices || {}); return;
    }
    const option = event.target.closest("[data-trap-option]");
    if (option) {
      event.preventDefault();
      event.stopPropagation();
      if (!event.shiftKey || event.ctrlKey || event.metaKey) {
        const selectedRow = selectCard(event, event.ctrlKey || event.metaKey, true);
        if (selectedRow && !event.ctrlKey && !event.metaKey) openActions(selectedRow, event.clientX, event.clientY);
        return;
      }
      const pick = findEditorPick(option.closest("[data-pick]").dataset.pick);
      const origin = trapOrigin(pick);
      if (origin?.choicePath) chooseTrapOption(origin.trap, origin.choicePath, Number(option.dataset.trapOption));
      return;
    }
    const toggle = event.ctrlKey || event.metaKey || event.shiftKey;
    const selectedRow = selectCard(event, toggle);
    if (selectedRow && !toggle) openActions(selectedRow, event.clientX, event.clientY);
  });
  $("zones").addEventListener("keydown", (event) => {
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
