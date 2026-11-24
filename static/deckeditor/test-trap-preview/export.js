"use strict";

const exportForm = $("export-form");
const exportDescriptions = {
  txt: "Quantities and card names, with SB: marking sideboard cards.",
  cod: "Cockatrice deck file with named main deck and sideboard zones.",
  mtgo: "Magic Online text import. Printing versions are chosen by the receiving client.",
  arena: "Arena clipboard format. The cards must be available in Arena.",
  dec: "Desktop Deckeditor format with set codes. Requires live Cubeapp printing details.",
  mwDeck: "Magic Workstation format with set codes. Requires live Cubeapp printing details.",
  json: "Desktop Deckeditor JSON using Cubeapp printing IDs. Requires a live Cubeapp pool.",
};

function exportCardName(card) {
  return (card.faces.length > 1 ? card.faces[0].name : card.name).normalize("NFC");
}

function groupExportCards(cards, keyFor) {
  const groups = new Map();
  for (const card of cards) {
    const key = keyFor(card);
    if (!groups.has(key)) groups.set(key, { card, quantity: 0 });
    groups.get(key).quantity += 1;
  }
  return [...groups.values()];
}

function serializeDeckExport(format, name, sections) {
  const xml = (value) => escapeHtml(value).replaceAll("'", "&apos;");
  const grouped = sections.map((cards) => groupExportCards(cards, exportCardName));
  const lines = (cards) => cards.map(({ card, quantity }) => `${quantity} ${exportCardName(card)}`).join("\n");
  if (format === "cod") {
    const zones = grouped.map((cards, index) => `  <zone name="${index ? "side" : "main"}">\n${cards.map(({ card, quantity }) => `    <card number="${quantity}" name="${xml(exportCardName(card))}"/>`).join("\n")}\n  </zone>`);
    return `<?xml version="1.0" encoding="UTF-8"?>\n<cockatrice_deck version="1">\n  <deckname>${xml(name)}</deckname>\n  <comments/>\n${zones.join("\n")}\n</cockatrice_deck>\n`;
  }
  if (format === "json") {
    if (sections.flat().some(({ id }) => !/^p\d+$/.test(id))) {
      throw new Error("Deckeditor JSON needs Cubeapp printing IDs. Open a live pool to use this format.");
    }
    return JSON.stringify({ maindeck: sections[0].map(({ id }) => Number(id.slice(1))), sideboard: sections[1].map(({ id }) => Number(id.slice(1))) }, null, 2) + "\n";
  }
  if (format === "dec" || format === "mwDeck") {
    const missing = sections.flat().find((card) => !card.expansion);
    if (missing) throw new Error(`Set information is unavailable for ${missing.name}. Use plain text or Cockatrice, or load the card's live printing details.`);
    return sections.flatMap((cards, index) => groupExportCards(cards, (card) => JSON.stringify([card.expansion, card.name]))
      .map(({ card, quantity }) => `${index ? "SB: " : ""}${quantity} [${card.expansion}] ${card.name.normalize("NFC").replaceAll("//", "/")}`)).join("\n") + "\n";
  }
  if (format === "arena") {
    return `About\nName ${name.replace(/[\r\n]+/g, " ")}\n\nDeck\n${lines(grouped[0])}${grouped[1].length ? `\n\nSideboard\n${lines(grouped[1])}` : ""}\n`;
  }
  if (format === "mtgo") {
    return `${lines(grouped[0])}${grouped[1].length ? `\n\nSideboard\n${lines(grouped[1])}` : ""}\n`;
  }
  if (format !== "txt") throw new Error("Choose an export format.");
  return grouped.flatMap((cards, index) => cards.map(({ card, quantity }) => `${index ? "SB: " : ""}${quantity} ${exportCardName(card)}`)).join("\n") + "\n";
}

async function prepareDeckExport() {
  if (!checkDeckTraps()) throw new Error("Resolve traps in Main deck and Sideboard, or move them to Pool.");
  const format = exportForm.elements.format.value;
  const name = exportForm.elements.deckName.value.trim() || "Draft deck";
  const workspace = draft;
  const ids = ["main", "side"].map((zone) => orderedZone(zone).map(({ cardId }) => cardId));
  if (!ids.flat().length) throw new Error("Move cards into Main deck or Sideboard before exporting.");
  await Promise.all([...new Set(ids.flat())].filter((id) => remoteCards.has(id)).map(loadCardDetails));
  if (draft !== workspace) throw new Error("The workspace changed. Export again from the current deck.");
  const sections = ids.map((cards) => cards.map((id) => ({ ...cardInfo(id), id })));
  const unknown = sections.flat().find((card) => /^Printing \d+$/.test(card.name));
  if (unknown) throw new Error(`The name for ${unknown.name} has not loaded. Wait for card details and try again.`);
  const text = serializeDeckExport(format, name, sections);
  const extension = ["mtgo", "arena"].includes(format) ? "txt" : format;
  const mime = format === "json" ? "application/json" : format === "cod" ? "application/xml" : "text/plain";
  return { text, mime: `${mime};charset=utf-8`, filename: `${name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").replace(/[. ]+$/, "") || "draft-deck"}.${extension}` };
}

function updateExportHelp() {
  $("export-help").textContent = exportDescriptions[exportForm.elements.format.value];
  $("export-status").textContent = "";
}

$("export").addEventListener("click", () => {
  if (!checkDeckTraps()) return;
  updateExportHelp();
  $("export-dialog").showModal();
});
exportForm.elements.format.addEventListener("change", updateExportHelp);

async function deliverDeckExport(copy) {
  const buttons = [...exportForm.querySelectorAll("button")];
  buttons.forEach((button) => { button.disabled = true; });
  $("export-status").textContent = "Preparing deck…";
  try {
    const result = await prepareDeckExport();
    if (copy) {
      await navigator.clipboard.writeText(result.text);
      $("export-status").textContent = "Deck copied to clipboard.";
    } else {
      const url = URL.createObjectURL(new Blob([result.text], { type: result.mime }));
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      $("export-status").textContent = "Deck downloaded.";
    }
  } catch (error) {
    $("export-status").textContent = error.message;
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
}

exportForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void deliverDeckExport(false);
});
$("export-copy").addEventListener("click", () => { void deliverDeckExport(true); });

