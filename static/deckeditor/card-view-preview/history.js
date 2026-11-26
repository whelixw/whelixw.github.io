"use strict";

let historyIndex = null;
let historyDraft = null;

function draftHistory() {
  return activeLive ? draft.history : practiceDraftPicks().map((pick, index) => ({
    cardId: pick.cardId, round: Math.floor(index / picksPerPack) + 1, number: index + 1,
    boosterId: `practice-${Math.floor(index / picksPerPack)}`, pack: pick.pack,
  }));
}

// Use copy counts, since a pack can contain multiple identical printings or traps.
function packGhosts(history, boosterId, available) {
  if (boosterId === undefined || boosterId === null) return [];
  const maximum = new Map();
  for (const entry of history) {
    if (entry.boosterId !== boosterId || !Array.isArray(entry.pack)) continue;
    const counts = new Map();
    for (const id of entry.pack) counts.set(id, (counts.get(id) || 0) + 1);
    for (const [id, count] of counts) maximum.set(id, Math.max(maximum.get(id) || 0, count));
  }
  for (const id of available) maximum.set(id, Math.max(0, (maximum.get(id) || 0) - 1));
  return [...maximum].flatMap(([id, count]) => Array(count).fill(id));
}

function packSnapshotCard(id, { ghost = false, picked = false } = {}) {
  const name = escapeHtml(cardInfo(id).name);
  const face = traps.has(id) ? trapFace(id, false) : cardFace(id);
  return `<div class="card snapshot-card${ghost ? " pack-ghost" : ""}${picked ? " history-picked" : ""}"
    tabindex="0" data-preview="${id}" aria-label="${name}${ghost ? " (seen earlier; no longer available)" : picked ? " (picked)" : ""}">
    ${face}${ghost ? '<span class="snapshot-badge">Seen earlier</span>' : picked ? '<span class="snapshot-badge">Picked</span>' : ""}
  </div>`;
}

function renderPackGhosts() {
  if (!$("show-pack-ghosts").checked || !draft.available.length) return;
  const boosterId = activeLive ? draft.boosterId : `practice-${currentRound()}`;
  pack.insertAdjacentHTML("beforeend", packGhosts(draftHistory(), boosterId, draft.available)
    .map((id) => packSnapshotCard(id, { ghost: true })).join(""));
}

function renderPickHistory() {
  const history = draftHistory();
  if (historyDraft !== draft) {
    historyDraft = draft;
    historyIndex = null;
  }
  if (historyIndex !== null) historyIndex = Math.min(historyIndex, history.length - 1);
  const index = historyIndex ?? history.length - 1;
  $("pick-history-empty").textContent = activeLive?.loadedPool ? "Pick history is available from the draft seat." : "No confirmed picks yet.";
  $("pick-history-empty").hidden = Boolean(history.length);
  $("pick-history").replaceChildren(...history.map(({ cardId, round, number }, position) => {
    const row = document.createElement("li");
    row.value = number;
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.historyIndex = position;
    button.setAttribute("aria-current", String(position === index));
    const card = cardInfo(cardId);
    const name = traps.has(cardId) ? `Trap (${card.type})` : card.name;
    button.textContent = round ? `Pack ${round} · ${name}` : name;
    row.append(button);
    return row;
  }));
  $("history-view").hidden = !history.length;
  if (!history.length) return;
  const entry = history[index];
  $("history-label").textContent = `Pick ${entry.number}${entry.round ? ` · Pack ${entry.round}` : ""}`;
  $("history-previous").disabled = index <= 0;
  $("history-next").disabled = index >= history.length - 1;
  $("history-description").textContent = Array.isArray(entry.pack)
    ? "Pack before this pick. The chosen card is highlighted."
    : "The pack snapshot is unavailable for this older pick. Showing the chosen card.";
  let marked = false;
  $("history-pack").innerHTML = (entry.pack || [entry.cardId]).map((id) => {
    const picked = !marked && id === entry.cardId;
    marked ||= picked;
    return packSnapshotCard(id, { picked });
  }).join("");
  useImageFallback($("history-pack"));
}

function setupHistory() {
  $("pick-history").addEventListener("click", (event) => {
    const button = event.target.closest("[data-history-index]");
    if (!button) return;
    historyIndex = Number(button.dataset.historyIndex);
    renderPickHistory();
  });
  for (const [id, step] of [["history-previous", -1], ["history-next", 1]]) {
    $(id).addEventListener("click", () => {
      historyIndex = Math.max(0, Math.min(draftHistory().length - 1,
        (historyIndex ?? draftHistory().length - 1) + step));
      renderPickHistory();
    });
  }
  for (const name of ["pointerover", "focusin", "click"]) {
    $("history-pack").addEventListener(name, previewCard);
  }
  try { $("show-pack-ghosts").checked = localStorage.getItem("deckeditor-card-view-preview-pack-ghosts") === "true"; } catch {}
  $("show-pack-ghosts").addEventListener("change", () => {
    try { localStorage.setItem("deckeditor-card-view-preview-pack-ghosts", String($("show-pack-ghosts").checked)); } catch {}
    renderPack();
  });
}
