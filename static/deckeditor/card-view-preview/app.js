"use strict";

const cards = [
  ["Lightning Bolt", "Instant", "R"], ["Counterspell", "Instant", "U"],
  ["Llanowar Elves", "Creature", "G"], ["Swords to Plowshares", "Instant", "W"],
  ["Dark Ritual", "Instant", "B"], ["Sol Ring", "Artifact", "C"],
  ["Opt", "Instant", "U"], ["Birds of Paradise", "Creature", "G"],
  ["Go for the Throat", "Instant", "B"], ["Lightning Helix", "Instant", "M"],
  ["Serum Visions", "Sorcery", "U"], ["Raise the Alarm", "Instant", "W"],
  ["Mulldrifter", "Creature", "U"], ["Farseek", "Sorcery", "G"],
  ["Fatal Push", "Instant", "B"], ["Abrade", "Instant", "R"],
  ["Memory Lapse", "Instant", "U"], ["Blade Splicer", "Creature", "W"],
  ["Delver of Secrets", "Creature", "U"],
];
const colors = { R: "#e57e61", U: "#5bafdb", G: "#75b78b", W: "#e1cc9d", B: "#ae8cd2", C: "#b3b6c3", M: "#dbad60" };
const practiceBasics = new Map([
  ["Plains", "W"], ["Island", "U"], ["Swamp", "B"], ["Mountain", "R"], ["Forest", "G"],
].map(([name, symbol]) => {
  const type = `Basic Land — ${name}`;
  return [`b-${symbol}`, { name, type, color: "C", frameColor: symbol, manaValue: 0,
    faces: [{ name, type, oracle: `{T}: Add {${symbol}}.` }] }];
}));
const labels = { pool: "Pool", main: "Main deck", side: "Sideboard" };
const zoneKeys = Object.keys(labels);
const picksPerPack = 4;
const practicePackCount = 3;
const pickLimit = picksPerPack * practicePackCount;
const pickDuration = 75000;
const storageKey = "deckeditor-card-view-preview-workbench-v1";
const $ = (id) => document.getElementById(id);
const pack = $("pack");
const zones = $("zones");
let previewed = null;
let previewComponent = null;
let pinnedTrapComponent = null;
let previewMode = "auto";
let activeLive = null;
const remoteCards = new Map();

function cardKey(value) {
  return /^[bpt]/.test(value) ? value : Number(value);
}

function cardInfo(id) {
  if (traps.has(id)) return { ...trapInfo(id), manaValue: Infinity };
  if (practiceBasics.has(id)) return practiceBasics.get(id);
  const remote = remoteCards.get(id);
  if (remote) return { ...remote, manaValue: remote.manaValue ?? manaValue(remote.faces[0].mana) };
  const [name, type, color] = cards[id];
  const faces = cardDetails[id].faces;
  return { name, type, color, faces, manaValue: manaValue(faces[0].mana) };
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function cardFace(id, deck = false) {
  if (traps.has(id)) return trapFace(id, true, deck);
  const { name, type, color, frameColor = color, faces } = cardInfo(id);
  const fallback = `<span class="fallback" aria-hidden="true" style="--card-color:${colors[frameColor] || colors.C}">${escapeHtml(name)}<small>${escapeHtml(type)}</small></span>`;
  if (!faces[0].image) return fallback;
  return `${fallback}<img src="${escapeHtml(faces[0].image)}" alt="" draggable="false">`;
}

function useImageFallback(container) {
  for (const img of container.querySelectorAll("img, .trap-artwork image")) {
    img.addEventListener("error", () => img.remove(), { once: true });
    if (img.classList.contains("original-trap-art")) {
      const showOriginal = () => { img.dataset.loaded = ""; };
      img.addEventListener("load", showOriginal, { once: true });
      if (img.complete && img.naturalWidth) showOriginal();
    }
    if (img.complete && !img.naturalWidth) img.remove();
  }
}

function showPreview(id, component = null) {
  if (id === previewed && component === previewComponent) return;
  if (id !== previewed) pinnedTrapComponent = null;
  previewed = id;
  previewComponent = component;
  renderPreview();
}

function renderFace(container, face) {
  if (!face.image) {
    container.innerHTML = "<figure><figcaption></figcaption></figure>";
    container.querySelector("figcaption").textContent = face.name;
    return;
  }
  container.innerHTML = '<figure><div class="preview-face"><img draggable="false"></div><figcaption></figcaption></figure>';
  const image = container.querySelector("img");
  image.addEventListener("error", () => image.closest(".preview-face").hidden = true, { once: true });
  image.src = face.image;
  image.alt = face.name;
  container.querySelector("figcaption").textContent = face.name;
}

function renderOracle(container, faces) {
  container.innerHTML = faces.map((face) => `<article class="oracle">
    <strong>${escapeHtml([face.name, face.mana].filter(Boolean).join("  "))}</strong>
    <div class="type">${escapeHtml(face.type || "")}</div>
    <div class="rules">${escapeHtml(face.oracle || "")}</div>
    <div class="stats">${escapeHtml(face.stats || "")}</div>
  </article>`).join("");
}

function previewPrinting() {
  const trap = traps.get(previewed);
  return trap ? previewComponent ?? trapComponents(trap.tree)[0] : previewed;
}

function renderPreview() {
  const upper = $("preview-primary");
  const lower = $("preview-secondary");
  const upperTitle = $("preview-primary-title");
  const lowerTitle = $("preview-secondary-title");
  const isTrap = traps.has(previewed);
  const isAuto = previewMode === "auto";
  const showTrap = isTrap && (isAuto || previewMode === "trap");
  $("preview-secondary-drawer").hidden = !showTrap && !(isAuto && previewed !== null && !isTrap);
  $("preview-inspect-trap").hidden = !showTrap;

  const printing = previewPrinting();
  if (showTrap) {
    lowerTitle.textContent = trapInfo(previewed).name;
    showTrapPreview(previewed, printing);
  }
  if (printing === null || printing === undefined) {
    upperTitle.textContent = "Card";
    upper.innerHTML = printing === null ? "<p>Hover over a card to preview it here.</p>" : "";
    return;
  }

  const faces = cardInfo(printing).faces;
  const [front, back] = faces;
  if (isAuto || showTrap) {
    upperTitle.textContent = isTrap ? "Trap component" : back ? "Front face" : "Card";
    renderFace(upper, front);
    if (!isTrap) {
      lowerTitle.textContent = back ? "Back face" : "Oracle text";
      if (back) renderFace(lower, back);
      else renderOracle(lower, faces);
    }
  } else if (previewMode === "back" && back) {
    upperTitle.textContent = "Back face";
    renderFace(upper, back);
  } else if (!showTrap) {
    upperTitle.textContent = "Oracle text";
    renderOracle(upper, faces);
  }
  if (remoteCards.has(printing)) loadCardDetails(printing);
}

$("preview-modes").addEventListener("click", (event) => {
  const selectedMode = event.target.closest("button[data-mode]");
  if (!selectedMode) return;
  previewMode = selectedMode.dataset.mode;
  for (const button of $("preview-modes").querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button === selectedMode));
  }
  renderPreview();
});
$("preview-secondary").addEventListener("click", (event) => {
  const component = event.target.closest("button[data-component]");
  if (!component || !traps.has(previewed)) return;
  pinnedTrapComponent = cardKey(component.dataset.component);
  showPreview(previewed, pinnedTrapComponent);
});

let pointerPosition;
function previewCard(event) {
  const card = event.target.closest("[data-preview]");
  if (!card) return;
  const component = event.target.closest("[data-component]");
  const id = cardKey(card.dataset.preview);
  const member = component ? cardKey(component.dataset.component) : id === previewed ? pinnedTrapComponent : null;
  showPreview(id, member);
  if (event.type === "click" && component?.closest(".trap-components")) pinnedTrapComponent = member;
}

for (const name of ["pointerover", "focusin", "click"]) $("table").addEventListener(name, previewCard);
document.addEventListener("pointermove", (event) => {
  pointerPosition = [event.clientX, event.clientY];
  if (event.shiftKey && event.target.closest("[data-component]")) previewCard(event);
});
function updateTrapOverlay(enabled) {
  document.body.classList.toggle("inspect-components", enabled);
  const target = pointerPosition && document.elementFromPoint(...pointerPosition);
  if (target) previewCard({ target });
}
document.addEventListener("keydown", (event) => {
  if (event.key === "Shift" && !event.repeat) updateTrapOverlay(true);
});
document.addEventListener("keyup", (event) => {
  if (event.key === "Shift") updateTrapOverlay(false);
});
window.addEventListener("blur", () => document.body.classList.remove("inspect-components"));
function packCards(round) {
  if (round === 0) return [0, 1, 2, 3, demoTrap, 18];
  return Array.from({ length: 6 }, (_, index) => round * 6 + index);
}

function freshDraft() {
  return { picks: [], available: packCards(0), moves: [], deadline: Date.now() + pickDuration, submitted: false };
}

function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (!saved?.picks || !saved?.moves || !saved?.available) return freshDraft();
    const previousZones = new Map(saved.picks.flatMap((pick) => [pick, ...(pick.members || [])])
      .map(({ id, zone }) => [String(id), zone]));
    saved.moves = saved.moves.reduceRight((moves, move) => {
      const from = move.from;
      const id = String(move.id);
      if (previousZones.has(id) && from !== previousZones.get(id)) {
        moves.push({ ...move, id, from });
        previousZones.set(id, from);
      }
      return moves;
    }, []).reverse();
    return saved;
  } catch {
    return freshDraft();
  }
}

let draft = restore();
let selected = null;
let selectedBoosterIndex = -1;
let drag = null;
let storageAvailable = true;

function save() {
  try {
    if (activeLive) activeLive.save();
    else localStorage.setItem(storageKey, JSON.stringify(draft));
  } catch {
    storageAvailable = false;
    $("notice").textContent = "Browser storage is unavailable.";
  }
}

function notice(message) {
  $("notice").textContent = message + (storageAvailable ? "" : " Browser storage is unavailable.");
}

function practiceDraftPicks() {
  return draft.picks.filter(({ addedBasic }) => !addedBasic);
}

function complete() {
  return activeLive ? draft.finished : practiceDraftPicks().length >= pickLimit;
}

function currentRound() {
  return Math.floor(practiceDraftPicks().length / picksPerPack);
}

function confirmPick(cardId, zone = "main", automatic = false, cell) {
  if (complete() || !draft.available.includes(cardId)) return;
  cell = destinationCell(zone, cell);
  if (activeLive) return activeLive.pick(cardId, zone, cell);

  const round = currentRound();
  const pick = { id: practiceDraftPicks().length, cardId, zone, pack: [...draft.available] };
  placeCards([pick], zone, cell);
  draft.picks.push(pick);
  draft.available.splice(draft.available.indexOf(cardId), 1);
  if (complete()) {
    draft.available = [];
  } else if (currentRound() !== round) {
    draft.available = packCards(currentRound());
  }
  draft.deadline = Date.now() + pickDuration;
  selected = null;
  save();
  render();
  const name = cardInfo(cardId).name;
  notice(automatic ? `Time expired. ${name} went to Main deck.` : `Picked ${name} into ${labels[zone]}.`);
}

function addPracticeBasics(cardId, quantity) {
  if (activeLive || !practiceBasics.has(cardId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) return;
  editorAction("add basic lands", () => {
    const zone = "main";
    const picks = Array.from({ length: quantity }, () => ({
      id: crypto.randomUUID(), cardId, zone, addedBasic: true,
    }));
    placeCards(picks, zone, destinationCell(zone));
    draft.picks.push(...picks);
    draft.submitted = false;
    save();
    renderEditor();
    renderSubmission();
  });
}

function changeZone(pick, zone, state) {
  state.moves.push({ id: String(pick.id), from: pick.zone, order: pick.order, stack: pick.stack, cell: pick.cell });
  pick.zone = zone;
  delete pick.order;
  delete pick.stack;
  delete pick.cell;
  state.submitted = false;
}

function renderPack() {
  $("booster-actions").hidden = true;
  const round = currentRound();
  $("progress").innerHTML = activeLive ? "" : Array.from({ length: practicePackCount }, (_, index) =>
    `<span class="${index < round ? "done" : index === round ? "active" : ""}">${index < round ? "✓ " : ""}Pack ${index + 1}</span>`
  ).join("");
  $("draft-panel").hidden = complete();
  $("complete-panel").hidden = !complete();
  $("table").classList.toggle("finished", complete());
  if (complete()) {
    pack.replaceChildren();
    return;
  }
  const packNumber = activeLive ? draft.round : round + 1;
  const packTotal = activeLive ? draft.packTotal : practicePackCount;
  const packLabel = packNumber ? `Pack ${packNumber}${packTotal ? ` of ${packTotal}` : ""}` : "";
  const pickLabel = activeLive
    ? (draft.available.length ? `Pick ${draft.picks.length + 1}` : "Waiting for booster")
    : `Pick ${practiceDraftPicks().length % picksPerPack + 1} / ${picksPerPack}`;
  $("pack-label").textContent = [packLabel, pickLabel].filter(Boolean).join(" · ");
  pack.innerHTML = draft.available.map((id) => {
    const name = escapeHtml(cardInfo(id).name);
    if (traps.has(id)) {
      return `<div class="booster-card card" data-card="${id}" data-preview="${id}" draggable="true">
        <button type="button" class="booster-trap-pick" aria-label="${name}" aria-pressed="false">${trapFace(id, false)}</button>
        ${trapComponentSelector(id)}
        <button type="button" class="inspect-trap" aria-expanded="false" title="Preview this trap without picking it">Preview</button>
      </div>`;
    }
    return `<button type="button" class="booster-card card" data-card="${id}" data-preview="${id}" draggable="true" aria-label="${name}" aria-pressed="false">${cardFace(id)}</button>`;
  }).join("");
  renderPackGhosts();
  pack.style.setProperty("--pack-count", Math.max(1, pack.children.length));
  useImageFallback(pack);
  renderSelection();
  renderTimer();
}

function renderSelection() {
  for (const [index, card] of [...pack.children].entries()) {
    const control = card.querySelector(".booster-trap-pick") || card;
    control.setAttribute("aria-pressed", String(index === selectedBoosterIndex && cardKey(card.dataset.card) === selected));
  }
  $("pick").disabled = selected === null || Boolean(activeLive?.pending);
  $("pick-hint").textContent = selected === null
    ? "Double-click to pick. Right-click for pick destinations."
    : `${cardInfo(selected).name} selected · Drag to a cell to place it there.`;
}

function renderEditor() {
  $("card-actions").hidden = true;
  $("selection-box").hidden = true;
  const scroll = new Map([...zones.querySelectorAll("[data-zone]")].map((pane) => {
    const canvas = pane.querySelector(".zone-cards");
    return [pane.dataset.zone, { left: canvas.scrollLeft, top: canvas.scrollTop }];
  }));
  $("total").textContent = activeLive ? `${draft.picks.length} cards` : `${practiceDraftPicks().length} / ${pickLimit} picked`;
  updateEditorHistoryControls();
  $("export").disabled = !deckPrintings().length && !hasUnresolvedDeckTraps();
  zones.innerHTML = zoneKeys.map((zone) => {
    const piles = deckPiles(zone);
    const count = orderedZone(zone).length;
    function renderCard({ id, cardId }) {
      const { name } = cardInfo(cardId);
      const trapControl = !traps.has(cardId) ? "" : isStandaloneTrapChoice(cardId)
        ? '<button type="button" class="inspect-trap choose-trap" aria-haspopup="true" aria-controls="card-actions">Choose</button>'
        : isTrapChoice(cardId)
        ? '<button type="button" class="inspect-trap choose-trap" aria-pressed="false">Choose</button>'
        : '<button type="button" class="inspect-trap expand-trap" title="Expand this trap into deck cards">Expand</button>';
      return `<div class="card${chosenCards.has(String(id)) ? " chosen" : ""}" tabindex="0" aria-label="${escapeHtml(name)}" draggable="true" data-pick="${id}" data-preview="${cardId}">
        ${cardFace(cardId, true)}
        ${trapControl}
        <button type="button" class="card-menu-toggle" aria-label="Selection actions" aria-haspopup="true" aria-expanded="false" aria-controls="card-actions"></button>
      </div>`;
    }
    const base = deckColumns[zone] * deckRows;
    const extra = Math.ceil((Math.max(base - 1, ...piles.keys()) + 1 - base) / deckRows);
    const slots = Array.from({ length: base + extra * deckRows }, (_, cell) => {
      const { row, col } = deckCoordinates(zone, cell);
      const pile = piles.get(cell);
      const stackRows = pile?.length > 1 ? `repeat(${pile.length - 1}, var(--stack-step)) auto` : "auto";
      return `<div class="deck-slot" data-cell="${cell}" style="grid-row:${row};grid-column:${col}">${pile ? `<div class="pile" style="grid-template-rows:${stackRows}">${pile.map(renderCard).join("")}</div>` : ""}</div>`;
    }).join("");
    const rowDepths = Array(deckRows).fill(1);
    for (const [cell, pile] of piles) {
      const { row } = deckCoordinates(zone, cell);
      rowDepths[row - 1] = Math.max(rowDepths[row - 1], pile.length);
    }
    const rowHeights = rowDepths.map((depth) => `calc(var(--slot-width) / .717 + ${depth - 1} * var(--stack-step))`).join(" ");
    return `<section class="zone pane zone-${zone}" data-zone="${zone}" aria-label="${labels[zone]}">
      <header class="pane-bar"><h2>${labels[zone]}</h2><button type="button" data-fit-zone="${zone}" title="Fit cards in view (F)">Fit</button><label class="zone-zoom">Zoom <input type="range" min="10" max="200" step="1" value="${zoneZoom[zone]}" data-zoom="${zone}" aria-label="${labels[zone]} zoom"></label><span class="deck-zone-count" data-card-total="${count}" title="Selected / total">0/${count}</span></header>
      <div class="canvas zone-cards" style="--columns:${deckColumns[zone] + extra};--rows:${deckRows};grid-template-rows:${rowHeights}">${slots}</div>
    </section>`;
  }).join("");
  useImageFallback(zones);
  for (const pane of zones.querySelectorAll("[data-zone]")) {
    const position = scroll.get(pane.dataset.zone);
    if (position) pane.querySelector(".zone-cards").scrollTo(position);
  }
  updateArrangeControls();
}

function renderSubmission() {
  const hasMainDeck = deckPrintings().some(({ zone }) => zone === "main");
  $("submit").disabled = draft.submitted || (!hasMainDeck && !hasUnresolvedDeckTraps())
    || Boolean(activeLive && !activeLive.canSubmit);
  $("submit").textContent = activeLive
    ? (draft.submitted ? "Deck submitted" : "Submit deck")
    : (draft.submitted ? "Demo deck submitted" : "Submit demo deck");
}

function renderTimer() {
  if (!Number.isFinite(draft.deadline)) {
    $("timer").textContent = "";
    return;
  }
  const seconds = Math.max(0, Math.ceil((draft.deadline - Date.now()) / 1000));
  $("timer").textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  $("timer").classList.toggle("urgent", seconds <= 10);
}

function renderPackQueues() {
  const section = $("pack-queues");
  section.hidden = !activeLive || activeLive.loadedPool;
  if (section.hidden) return;
  const players = [...draft.drafters];
  $("pack-queues-empty").hidden = Boolean(players.length);
  $("pack-queues-list").replaceChildren(...players.map(([id, name]) => {
    const row = document.createElement("li");
    row.textContent = `${name}: ${draft.queues.get(id) ?? "Unavailable"}`;
    return row;
  }));
}

$("draft-status-open").addEventListener("click", () => {
  renderPickHistory();
  renderPackQueues();
  $("draft-status").showModal();
});

function render() {
  if ($("draft-status").open) {
    renderPickHistory();
    renderPackQueues();
  }
  renderPack();
  renderEditor();
  renderSubmission();
  if (complete()) $("pick-hint").textContent = "Hover any card to preview it. Use the move menu or drag to rearrange.";
}

const trapInspectionControl = ".trap-component-toggle, .trap-components, .inspect-trap";
function toggleTrapInspection(card) {
  const toggle = card?.querySelector(".trap-component-toggle");
  if (!toggle) return;
  const opened = toggle.getAttribute("aria-expanded") === "true";
  toggle.setAttribute("aria-expanded", String(!opened));
  toggle.setAttribute("aria-label", opened ? "Show trap components" : "Hide trap components");
  const button = card.querySelector(".inspect-trap");
  if (button) {
    button.textContent = opened ? "Preview" : "Close preview";
    button.setAttribute("aria-expanded", String(!opened));
    button.title = opened ? "Show component preview for this card" : "Hide component preview for this card";
  }
}
$("table").addEventListener("click", (event) => {
  const toggle = event.target.closest(".trap-component-toggle, #pack .inspect-trap");
  if (!toggle) return;
  toggleTrapInspection(toggle.closest("[data-preview]"));
});
$("table").addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !event.target.closest(trapInspectionControl)) return;
  const toggle = event.target.closest("[data-preview]")?.querySelector(".trap-component-toggle");
  if (toggle?.getAttribute("aria-expanded") !== "true") return;
  toggle.click();
  event.target.closest("[data-preview]")?.querySelector(".inspect-trap")?.focus();
});
pack.addEventListener("click", (event) => {
  if (event.target.closest(trapInspectionControl)) return;
  const card = event.target.closest("[data-card]");
  if (!card) return;
  selected = cardKey(card.dataset.card);
  selectedBoosterIndex = [...pack.children].indexOf(card);
  renderSelection();
});
pack.addEventListener("dblclick", (event) => {
  if (event.target.closest(trapInspectionControl)) return;
  const card = event.target.closest("[data-card]");
  if (!card) return;
  const id = cardKey(card.dataset.card);
  if (event.shiftKey && traps.has(id)) return;
  confirmPick(id);
});
$("pick").addEventListener("click", () => confirmPick(selected));

const boosterActions = $("booster-actions");
let boosterActionCard;
pack.addEventListener("contextmenu", (event) => {
  const card = event.target.closest("[data-card]");
  if (!card || activeLive?.pending) return;
  event.preventDefault();
  boosterActionCard = card;
  selected = cardKey(card.dataset.card);
  selectedBoosterIndex = [...pack.children].indexOf(card);
  renderSelection();
  const keyboard = !event.clientX && !event.clientY;
  const bounds = keyboard && card.getBoundingClientRect();
  showCardMenu(boosterActions, bounds ? bounds.left : event.clientX, bounds ? bounds.bottom : event.clientY);
  boosterActions.querySelector("button")?.focus();
});
boosterActions.addEventListener("click", (event) => {
  const zone = event.target.closest("[data-pick-zone]")?.dataset.pickZone;
  if (!zone) return;
  boosterActions.hidden = true;
  confirmPick(selected, zone);
  if (activeLive?.pending) boosterActionCard?.focus();
  else (pack.querySelector(".booster-trap-pick, button.booster-card") || $("draft-status-open")).focus();
});
document.addEventListener("pointerdown", (event) => {
  if (!boosterActions.hidden && !boosterActions.contains(event.target)) boosterActions.hidden = true;
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || boosterActions.hidden) return;
  boosterActions.hidden = true;
  (boosterActionCard?.querySelector(".booster-trap-pick") || boosterActionCard)?.focus();
});

function setCardDragImage(event, payload) {
  const card = event.target.closest("[data-pick]");
  const name = payload.type === "booster" ? cardInfo(payload.id).name : card.getAttribute("aria-label");
  const count = payload.ids?.length ?? 1;
  const label = count === 1 ? name : `${count} cards`;
  const badge = document.createElement("canvas");
  const brush = badge.getContext("2d");
  if (!brush) return;
  const font = "600 13px system-ui, sans-serif";
  brush.font = font;
  badge.width = Math.min(240, Math.ceil(brush.measureText(label).width) + 20);
  badge.height = 26;
  brush.fillStyle = "#292e33";
  brush.fillRect(0, 0, badge.width, badge.height);
  brush.strokeStyle = "#8cc9f0";
  brush.strokeRect(.5, .5, badge.width - 1, badge.height - 1);
  brush.fillStyle = "#e3e7eb";
  brush.font = font;
  brush.textBaseline = "middle";
  brush.fillText(label, 10, badge.height / 2, badge.width - 20);
  event.dataTransfer.setDragImage(badge, 8, 8);
}

function startDrag(event, payload) {
  drag = payload;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", String(payload.id));
  setCardDragImage(event, payload);
  document.body.classList.add("deck-dragging");
}

pack.addEventListener("dragstart", (event) => {
  if (event.target.closest(trapInspectionControl)) {
    event.preventDefault();
    return;
  }
  const card = event.target.closest("[data-card]");
  if (card) startDrag(event, { type: "booster", id: cardKey(card.dataset.card) });
});
zones.addEventListener("dragstart", (event) => {
  const row = event.target.closest("[data-pick]");
  if (row && !event.target.closest("select,button")) {
    startDrag(event, { type: "picked", id: row.dataset.pick, ids: draggedCards(row.dataset.pick) });
  } else {
    event.preventDefault();
  }
});
zones.addEventListener("dragover", (event) => {
  const zone = event.target.closest("[data-zone]");
  const slot = event.target.closest("[data-cell]");
  if (!zone || !slot || !drag) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  zone.classList.add("over");
  const lastSlot = zones.querySelector(".slot-target");
  if (lastSlot !== slot) lastSlot?.classList.remove("slot-target");
  slot.classList.add("slot-target");
});
zones.addEventListener("dragleave", (event) => {
  const zone = event.target.closest("[data-zone]");
  if (zone && !zone.contains(event.relatedTarget)) zone.classList.remove("over");
  const slot = event.target.closest(".slot-target");
  if (slot && !slot.contains(event.relatedTarget)) slot.classList.remove("slot-target");
});
zones.addEventListener("drop", (event) => {
  const zone = event.target.closest("[data-zone]");
  const slot = event.target.closest("[data-cell]");
  if (!zone || !slot || !drag) return;
  event.preventDefault();
  zone.classList.remove("over");
  slot.classList.remove("slot-target");
  const cell = Number(slot.dataset.cell);
  if (drag.type === "booster") confirmPick(drag.id, zone.dataset.zone, false, cell);
  else arrangeDrop(drag.ids, zone.dataset.zone, cell);
  drag = null;
});
document.addEventListener("drop", () => document.body.classList.remove("deck-dragging"));
document.addEventListener("dragend", () => {
  document.body.classList.remove("deck-dragging");
  drag = null;
  for (const zone of zones.querySelectorAll(".over")) zone.classList.remove("over");
  zones.querySelector(".slot-target")?.classList.remove("slot-target");
});
$("undo").addEventListener("click", () => replayEditorAction("undo"));
$("redo").addEventListener("click", () => replayEditorAction("redo"));

function checkDeckTraps() {
  if (!hasUnresolvedDeckTraps()) return true;
  notice("Resolve traps in Main deck and Sideboard, or move them to Pool.");
  return false;
}


$("submit").addEventListener("click", () => {
  if (!complete() || $("submit").disabled || !checkDeckTraps()) return;
  if (!deckPrintings().some(({ zone }) => zone === "main")) return;
  if (activeLive) return void activeLive.submit();
  draft.submitted = true;
  save();
  renderSubmission();
  notice("Demo submission recorded in this browser.");
});

$("restart").addEventListener("click", () => {
  if (draft.picks.length && !window.confirm("Start over and clear this draft and deck?")) return;
  draft = freshDraft();
  chosenCards.clear();
  selected = null;
  drag = null;
  showPreview(null);
  save();
  render();
  notice("New draft started.");
});

setupHistory();
setupArrangement();
save();
render();
setInterval(() => {
  if (complete()) return;
  if (!activeLive && draft.deadline <= Date.now()) confirmPick(draft.available[0], "main", true);
  else renderTimer();
}, 250);
