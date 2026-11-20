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
const labels = { pool: "Pool", main: "Main deck", side: "Sideboard" };
const zoneKeys = Object.keys(labels);
const picksPerPack = 4;
const practicePackCount = 3;
const pickLimit = picksPerPack * practicePackCount;
const pickDuration = 75000;
const storageKey = "deckeditor-workbench-v1";
const $ = (id) => document.getElementById(id);
const pack = $("pack");
const zones = $("zones");
let previewed = null;
let previewComponent = null;
let pinnedTrapComponent = null;
let showBackOracle = false;
let activeLive = null;
const remoteCards = new Map();

function cardKey(value) {
  return /^[pt]/.test(value) ? value : Number(value);
}

function cardInfo(id) {
  if (traps.has(id)) return { ...trapInfo(id), manaValue: Infinity };
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
  const { name, type, color, faces } = cardInfo(id);
  return `<span class="fallback" aria-hidden="true" style="--card-color:${colors[color] || colors.C}">${escapeHtml(name)}<small>${escapeHtml(type)}</small></span>
    <img src="${escapeHtml(faces[0].image)}" alt="" draggable="false">`;
}

function useImageFallback(container) {
  for (const img of container.querySelectorAll("img")) {
    img.addEventListener("error", () => img.remove(), { once: true });
    if (img.complete && !img.naturalWidth) img.remove();
  }
}

function showPreview(id, component = null) {
  if (id === previewed && component === previewComponent) return;
  if (id !== previewed) {
    showBackOracle = false;
    pinnedTrapComponent = null;
  }
  previewed = id;
  previewComponent = component;
  renderPreview();
}

function renderFace(container, face) {
  container.innerHTML = '<figure><div class="preview-face"><img draggable="false"></div><figcaption></figcaption></figure>';
  const image = container.querySelector("img");
  image.addEventListener("error", () => image.closest(".preview-face").hidden = true, { once: true });
  image.src = face.image;
  image.alt = face.name;
  container.querySelector("figcaption").textContent = face.name;
}

function renderOracle(container, face) {
  container.innerHTML = '<div class="oracle"><strong></strong><div class="type"></div><div class="rules"></div><div class="stats"></div></div>';
  container.querySelector("strong").textContent = [face.name, face.mana].filter(Boolean).join("  ");
  container.querySelector(".type").textContent = face.type;
  container.querySelector(".rules").textContent = face.oracle || "";
  container.querySelector(".stats").textContent = face.stats || "";
}

function renderPreview() {
  const upper = $("preview-primary");
  const lower = $("preview-secondary");
  const toggle = $("preview-detail-toggle");
  $("preview-inspect-trap").hidden = true;
  const upperTitle = $("preview-primary-title");
  const lowerTitle = $("preview-secondary-title");
  toggle.hidden = true;
  if (previewed === null) {
    upperTitle.textContent = "Card";
    lowerTitle.textContent = "Details";
    upper.innerHTML = "<p>Hover over a card to preview it here.</p>";
    lower.replaceChildren();
    return;
  }
  if (traps.has(previewed)) {
    upperTitle.textContent = "Trap component";
    lowerTitle.textContent = trapInfo(previewed).name;
    showTrapPreview(previewed);
    const component = previewComponent ?? trapComponents(traps.get(previewed).tree)[0];
    if (component === undefined) upper.replaceChildren();
    else {
      renderFace(upper, cardInfo(component).faces[0]);
      if (typeof component === "string" && component.startsWith("p")) loadCardDetails(component);
    }
    return;
  }
  const [front, back] = cardInfo(previewed).faces;
  upperTitle.textContent = back ? "Front face" : "Card";
  lowerTitle.textContent = back && !showBackOracle ? "Back face" : "Oracle text";
  toggle.hidden = !back;
  toggle.textContent = showBackOracle ? "Show back face" : "Oracle text";
  renderFace(upper, front);
  if (back && !showBackOracle) renderFace(lower, back);
  else renderOracle(lower, back ? { ...front, oracle: [front.oracle, back.oracle].filter(Boolean).join("\n\n") } : front);
}

$("preview-detail-toggle").addEventListener("click", () => {
  showBackOracle = !showBackOracle;
  renderPreview();
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

function complete() {
  return activeLive ? draft.finished : draft.picks.length >= pickLimit;
}

function currentRound() {
  return Math.floor(draft.picks.length / picksPerPack);
}

function confirmPick(cardId, zone = "main", automatic = false, cell) {
  if (complete() || !draft.available.includes(cardId)) return;
  if (activeLive) return activeLive.pick(cardId, zone, cell);

  const round = currentRound();
  draft.picks.push({ id: draft.picks.length, cardId, zone, cell, pack: [...draft.available] });
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

function changeZone(pick, zone) {
  if (pick.zone === zone) return false;
  draft.moves.push({ id: String(pick.id), from: pick.zone, order: pick.order, stack: pick.stack, cell: pick.cell });
  pick.zone = zone;
  delete pick.order;
  delete pick.stack;
  delete pick.cell;
  draft.submitted = false;
  return true;
}

function moveCard(id, zone) {
  if (!editorActionDepth) return editorAction("move card", () => moveCard(id, zone));
  const pick = findEditorPick(id);
  if (!pick || !changeZone(pick, zone)) return;
  save();
  renderEditor();
  renderSubmission();
  notice(`Moved ${cardInfo(pick.cardId).name} to ${labels[zone]}.`);
}

function renderPack() {
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
    : `Pick ${draft.picks.length % picksPerPack + 1} / ${picksPerPack}`;
  $("pack-label").textContent = [packLabel, pickLabel].filter(Boolean).join(" · ");
  pack.innerHTML = draft.available.map((id) => {
    const name = escapeHtml(cardInfo(id).name);
    if (traps.has(id)) {
      return `<div class="booster-card card" data-card="${id}" data-preview="${id}" draggable="true">
        <button type="button" class="booster-trap-pick" aria-label="${name}" aria-pressed="false">${trapFace(id, false)}</button>
        ${trapComponentSelector(id)}
      </div>`;
    }
    return `<button type="button" class="booster-card card" data-card="${id}" data-preview="${id}" draggable="true" aria-label="${name}" aria-pressed="false">${cardFace(id)}</button>`;
  }).join("");
  renderPackGhosts();
  useImageFallback(pack);
  renderSelection();
  renderTimer();
}

function renderSelection() {
  $("booster-selection-count").textContent = selected === null ? "0 selected" : "1 selected";
  for (const [index, card] of [...pack.children].entries()) {
    const control = card.querySelector(".booster-trap-pick") || card;
    control.setAttribute("aria-pressed", String(index === selectedBoosterIndex && cardKey(card.dataset.card) === selected));
  }
  $("pick").disabled = selected === null || Boolean(activeLive?.pending);
  $("pick-hint").textContent = selected === null
    ? "Select a card, double-click to pick, or drag it into any deck zone."
    : `${cardInfo(selected).name} selected · Pick into Main deck or drag into Sideboard.`;
}

function renderEditor() {
  $("card-actions").hidden = true;
  $("selection-box").hidden = true;
  const scroll = new Map([...zones.querySelectorAll("[data-zone]")].map((pane) => {
    const canvas = pane.querySelector(".zone-cards");
    return [pane.dataset.zone, { left: canvas.scrollLeft, top: canvas.scrollTop }];
  }));
  $("total").textContent = activeLive ? `${draft.picks.length} cards` : `${draft.picks.length} / ${pickLimit} picked`;
  updateEditorHistoryControls();
  $("export").disabled = !deckPrintings().length && !hasUnresolvedDeckTraps();
  zones.innerHTML = zoneKeys.map((zone) => {
    const piles = deckPiles(zone);
    const count = orderedZone(zone).length;
    function renderCard({ id, cardId }) {
      const { name } = cardInfo(cardId);
      const trap = traps.has(cardId);
      return `<div class="card${chosenCards.has(String(id)) ? " chosen" : ""}" tabindex="0" aria-label="${escapeHtml(name)}" draggable="true" data-pick="${id}" data-preview="${cardId}">
        ${cardFace(cardId, true)}
        ${trap && !isTrapChoice(cardId) ? '<button type="button" class="resolve-trap">Expand</button>' : ""}
        <button type="button" class="card-menu-toggle" aria-label="Selection actions" aria-haspopup="true" aria-expanded="false" aria-controls="card-actions"></button>
      </div>`;
    }
    const base = deckColumns[zone] * deckRows;
    const extra = Math.ceil((Math.max(base - 1, ...piles.keys()) + 1 - base) / deckRows);
    const slots = Array.from({ length: base + extra * deckRows }, (_, cell) => {
      const { row, col } = deckCoordinates(zone, cell);
      const pile = piles.get(cell);
      return `<div class="deck-slot" data-cell="${cell}" style="grid-row:${row};grid-column:${col}">${pile ? `<div class="pile">${pile.map(renderCard).join("")}</div>` : ""}</div>`;
    }).join("");
    return `<section class="zone pane zone-${zone}" data-zone="${zone}" aria-label="${labels[zone]}">
      <header class="pane-bar"><h2>${labels[zone]}</h2><button type="button" data-fit-zone="${zone}" title="Fit cards in view (F)">Fit</button><label class="zone-zoom">Zoom <input type="range" min="10" max="200" step="1" value="${zoneZoom[zone]}" data-zoom="${zone}" aria-label="${labels[zone]} zoom"></label><span>${count}</span></header>
      <div class="canvas zone-cards" style="--columns:${deckColumns[zone] + extra};--rows:${deckRows}">${slots}</div>
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

const trapInspectionControl = ".trap-component-toggle, .trap-components";
$("table").addEventListener("click", (event) => {
  const toggle = event.target.closest(".trap-component-toggle");
  if (!toggle) return;
  const opened = toggle.getAttribute("aria-expanded") === "true";
  toggle.setAttribute("aria-expanded", String(!opened));
  toggle.setAttribute("aria-label", opened ? "Show trap components" : "Hide trap components");
});
$("table").addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !event.target.closest(trapInspectionControl)) return;
  const toggle = event.target.closest("[data-preview]")?.querySelector(".trap-component-toggle");
  if (toggle?.getAttribute("aria-expanded") !== "true") return;
  toggle.focus();
  toggle.click();
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

function startDrag(event, payload) {
  drag = payload;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", String(payload.id));
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
  if (!zone || !drag) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  zone.classList.add("over");
  const card = event.target.closest("[data-pick]");
  const slot = event.target.closest("[data-cell]");
  const lastSlot = zones.querySelector(".slot-target");
  if (lastSlot !== slot) lastSlot?.classList.remove("slot-target");
  slot?.classList.add("slot-target");
  const target = drag.type === "picked" && card && !drag.ids.includes(card.dataset.pick) ? card : null;
  const previous = zones.querySelector(".stack-target");
  if (previous !== target) previous?.classList.remove("stack-target");
  target?.classList.add("stack-target");
});
zones.addEventListener("dragleave", (event) => {
  const zone = event.target.closest("[data-zone]");
  if (zone && !zone.contains(event.relatedTarget)) zone.classList.remove("over");
  const card = event.target.closest(".stack-target");
  if (card && !card.contains(event.relatedTarget)) card.classList.remove("stack-target");
  const slot = event.target.closest(".slot-target");
  if (slot && !slot.contains(event.relatedTarget)) slot.classList.remove("slot-target");
});
zones.addEventListener("drop", (event) => {
  const zone = event.target.closest("[data-zone]");
  if (!zone || !drag) return;
  event.preventDefault();
  zone.classList.remove("over");
  zones.querySelector(".stack-target")?.classList.remove("stack-target");
  const slot = event.target.closest("[data-cell]");
  const cell = slot ? Number(slot.dataset.cell) : undefined;
  const target = event.target.closest("[data-pick]") || slot?.querySelector(".pile > :last-child");
  if (drag.type === "booster") confirmPick(drag.id, zone.dataset.zone, false, target ? undefined : cell);
  else arrangeDrop(drag.ids, zone.dataset.zone, target?.dataset.pick, cell);
  drag = null;
});
document.addEventListener("dragend", () => {
  drag = null;
  for (const zone of zones.querySelectorAll(".over")) zone.classList.remove("over");
  zones.querySelector(".stack-target")?.classList.remove("stack-target");
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
