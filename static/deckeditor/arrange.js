"use strict";

const chosenCards = new Set();
const deckRows = 3;
const deckColumns = { pool: 10, main: 10, side: 3 };

function orderedZone(zone) {
  return editorPicks().filter((pick) => pick.zone === zone).sort((left, right) =>
    (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER));
}

function selectedCards() {
  return [...chosenCards].map(findEditorPick).filter(Boolean);
}

function updateArrangeControls() {
  const selected = selectedCards();
  const hasPair = zoneKeys.some((zone) => selected.filter((pick) => pick.zone === zone).length > 1);
  $("sort-cards").disabled = !hasPair;
  if (!hasPair) showSortMenu(false);
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
  const close = () => { menu.hidden = true; };
  document.addEventListener("pointerdown", (event) => {
    if (!menu.contains(event.target)) close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !menu.hidden) {
      close();
      anchor?.focus();
    }
  });
  let anchor;
  return (card, x, y, keyboard = false) => {
    anchor = card;
    const pick = findEditorPick(card.dataset.pick);
    const selection = selectedCards().filter(({ zone }) => zone === pick.zone);
    const ids = selection.map(({ id }) => String(id));
    showSortMenu(false);
    const moves = $("card-action-move");
    moves.replaceChildren();
    for (const zone of zoneKeys.filter((zone) => zone !== pick.zone)) {
      const move = document.createElement("button");
      move.type = "button";
      move.textContent = `Move ${ids.length > 1 ? "selection" : "card"} to ${labels[zone]}`;
      move.onclick = () => { close(); arrangeDrop(ids, zone); };
      moves.append(move);
    }
    const unstack = $("card-action-unstack");
    unstack.hidden = !selection.some(({ stack }) => stack);
    unstack.onclick = () => { close(); arrangeDrop(ids, pick.zone); };
    const origin = trapOrigin(pick);
    const trap = $("card-action-trap");
    const coveredChoice = isTrapChoice(pick.cardId) && card.nextElementSibling;
    trap.hidden = !coveredChoice && (!traps.has(pick.cardId) || Boolean(origin));
    trap.textContent = coveredChoice ? "Bring choices to front" : "Expand trap";
    trap.onclick = () => {
      close();
      if (coveredChoice) {
        const cards = orderedZone(pick.zone).filter((entry) => entry !== pick);
        cards.push(pick);
        cards.forEach((entry, index) => { entry.order = index; });
        save();
        renderEditor();
        return;
      }
      resolveTrap(pick, {});
    };
    const options = $("card-action-options");
    options.replaceChildren();
    if (origin?.choicePath && !isTrapChoice(pick.cardId)) {
      const choice = trapChoiceNode(origin.trap, origin.choicePath);
      choice?.[1].forEach(([option], index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = `Reselect ${trapSummary(option)}`;
        button.onclick = () => { close(); chooseTrapOption(origin.trap, origin.choicePath, index); };
        options.append(button);
      });
    }
    const collapse = $("card-action-collapse");
    collapse.hidden = !origin;
    collapse.onclick = () => { close(); collapseTrap(origin.trap, pick); };
    const remove = $("card-action-remove-basic");
    const added = selection.filter(({ addedPrinting }) => addedPrinting);
    remove.hidden = !added.length;
    remove.textContent = added.length > 1 ? "Remove added basics" : "Remove added basic";
    remove.onclick = () => {
      close();
      const ids = new Set(added.map(({ id }) => String(id)));
      draft.picks = draft.picks.filter(({ id }) => !ids.has(String(id)));
      draft.moves = draft.moves.filter(({ id }) => !ids.has(String(id)));
      for (const id of ids) chosenCards.delete(id);
      draft.submitted = false;
      save();
      renderEditor();
      renderSubmission();
    };
    for (const button of menu.querySelectorAll("[data-sort]")) {
      button.hidden = ids.length < 2;
      button.onclick = () => { close(); sortSelection(button.dataset.sort, pick.zone); };
    }
    menu.hidden = false;
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
  setupPaneDividers();
  setupSelectionBox($("zones"));
  const openActions = setupCardActions();
  function selectCard(event, toggle) {
    const row = event.target.closest("[data-pick]");
    if (!row || event.target.closest("select,button")) return;
    const id = row.dataset.pick;
    if (!toggle && !chosenCards.has(id)) chosenCards.clear();
    if (toggle && chosenCards.has(id)) chosenCards.delete(id);
    else chosenCards.add(id);
    updateArrangeControls();
    return row;
  }
  $("zones").addEventListener("click", (event) => {
    const option = event.target.closest("[data-trap-option]");
    if (option) {
      event.preventDefault();
      event.stopPropagation();
      if (event.ctrlKey || event.metaKey) return;
      const pick = findEditorPick(option.closest("[data-pick]").dataset.pick);
      const origin = trapOrigin(pick);
      if (origin?.choicePath) chooseTrapOption(origin.trap, origin.choicePath, Number(option.dataset.trapOption));
      return;
    }
    const button = event.target.closest(".resolve-trap");
    if (button) {
      event.stopPropagation();
      const pick = findEditorPick(button.closest("[data-pick]").dataset.pick);
      resolveTrap(pick, {});
      return;
    }
    const card = event.target.closest("[data-pick]");
    const pick = card && findEditorPick(card.dataset.pick);
    const branch = event.target.closest("[data-trap-branch]");
    if (pick && traps.has(pick.cardId) && !isTrapChoice(pick.cardId)
      && !event.target.closest("button,select") && event.shiftKey && !event.ctrlKey && !event.metaKey && branch) {
      event.stopPropagation();
      resolveTrap(pick, JSON.parse(branch.dataset.trapBranch));
      return;
    }
    const toggle = event.ctrlKey || event.metaKey || event.shiftKey;
    const row = selectCard(event, toggle);
    if (row && !toggle) openActions(row, event.clientX, event.clientY);
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
  const compare = (left, right) => {
    const a = cardInfo(left.cardId);
    const b = cardInfo(right.cardId);
    if (sort === "color" && a.color !== b.color) return Object.keys(colors).indexOf(a.color) - Object.keys(colors).indexOf(b.color);
    if (sort === "mana" && a.manaValue !== b.manaValue) return a.manaValue - b.manaValue;
    return a.name.localeCompare(b.name);
  };
  for (const zone of onlyZone ? [onlyZone] : zoneKeys) {
    const picks = [...deckPiles(zone)].sort(([left], [right]) => left - right).flatMap(([, pile]) => pile);
    const selected = picks.filter(({ id }) => chosenCards.has(String(id))).sort(compare);
    const positions = picks.map(({ stack, cell }) => ({ stack, cell }));
    picks.forEach((pick, index) => {
      const next = chosenCards.has(String(pick.id)) ? selected.shift() : pick;
      next.order = index;
      Object.assign(next, positions[index]);
    });
  }
  save();
  renderEditor();
}

function manaValue(mana) {
  return [...(mana || "").matchAll(/\{([^}]+)\}/g)].reduce((total, [, symbol]) =>
    total + (/^[XYZ]$/.test(symbol) ? 0 : Number.parseInt(symbol, 10) || 1), 0);
}
