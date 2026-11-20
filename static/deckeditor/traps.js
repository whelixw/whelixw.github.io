"use strict";

const demoTrap = "t-demo";
const traps = new Map([
  [demoTrap, { tree: ["AllNode", [[0, 1], [["AnyNode", [[6, 1], [2, 1]]], 1]]] }],
]);

function registerLiveTrap(trap, raw = false) {
  function normalize(node) {
    if (Number.isInteger(node)) return remotePrinting({ id: node });
    if (Number.isInteger(node.id)) return remotePrinting(node);
    const children = node.options || node.children;
    if (!["AllNode", "AnyNode"].includes(node.type) || !Array.isArray(children)) {
      throw new Error("Cubeapp returned an unsupported trap node.");
    }
    const options = children.map(([child, count]) => [normalize(child), count]);
    options.sort((left, right) => JSON.stringify(left[0]).localeCompare(JSON.stringify(right[0])));
    return [node.type, options];
  }
  const tree = normalize(trap.node);
  const encoded = btoa(JSON.stringify([trap.intention_type || "", tree])).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  const id = `t-${encoded}`;
  const previous = traps.get(id);
  const imageId = typeof trap.id === "string" && /^[a-z0-9_-]+$/i.test(trap.id) ? trap.id : previous?.imageId;
  traps.set(id, { tree, imageId, wire: raw ? trap : previous?.wire });
  return id;
}

function trapSummary(node) {
  if (!Array.isArray(node)) return cardInfo(node).name;
  const [type, children] = node;
  return children.map(([child, count]) => {
    const label = trapSummary(child);
    return (type === "AllNode" && count > 1 ? `${count}× ` : "") + (Array.isArray(child) ? `(${label})` : label);
  }).join(type === "AllNode" ? " + " : " or ");
}

function trapInfo(id) {
  const { tree, option } = traps.get(id);
  return { name: option ? "Choose one" : "Trap", type: trapSummary(tree), color: "C", faces: [] };
}

function trapComponents(node) {
  const members = new Set();
  function collect(node) {
    if (Array.isArray(node)) {
      for (const [child] of node[1]) collect(child);
    } else {
      members.add(node);
    }
  }
  collect(node);
  return [...members];
}

function isTrapChoice(id) {
  return traps.get(id)?.option === true;
}

function trapComponentSelector(id) {
  const members = trapComponents(traps.get(id).tree);
  if (!members.length) return "";

  return `<button type="button" class="trap-component-toggle" aria-expanded="false" aria-label="Show trap components">⌄</button>
    <span class="trap-components trap-choice-art" role="group" aria-label="Trap components" style="--choice-columns:1">
      ${members.map((member) => {
        const name = escapeHtml(cardInfo(member).name);
        return `<button type="button" data-component="${member}" title="${name}" aria-label="Preview ${name}">${trapTile(member)}<span>${name}</span></button>`;
      }).join("")}
    </span>`;
}

function trapTile(member) {
  if (member === undefined) return "";
  const image = cardInfo(member).faces[0]?.image;
  return image ? `<img src="${escapeHtml(image)}" alt="" draggable="false" loading="lazy">` : "";
}

function trapFace(id, interactive = true, deck = false) {
  const { tree, option } = traps.get(id);
  const members = trapComponents(tree);
  const tile = trapTile;
  if (deck && isTrapChoice(id)) {
    const choices = tree[1];
    return `<span class="trap-choice-face"><strong>Choose one</strong>
      <span class="trap-choice-art" style="--choice-columns:${choices.length > 3 ? 2 : 1}">
        ${choices.map(([node], index) => {
          const member = trapComponents(node)[0];
          const label = escapeHtml(trapSummary(node));
          return `<button type="button" data-trap-option="${index}" ${member === undefined ? "" : `data-component="${member}"`} title="${label} · Shift-click to choose; click for actions" aria-label="${label} · click for actions">${tile(member)}<span>${label}</span></button>`;
        }).join("")}
      </span></span>`;
  }
  const tiles = members.map((member) => {
    const name = escapeHtml(cardInfo(member).name);
    return `<span class="trap-art-component">${tile(member)}<span>${name}</span></span>`;
  }).join("");
  const overlay = interactive ? trapComponentSelector(id) : "";
  return `<span class="trap-face"><strong>${option ? "Choose one" : "Trap"}</strong><span class="trap-art-strip">${tiles}</span></span>${overlay}`;
}

function showTrapPreview(id) {
  const preview = $("preview-secondary");
  preview.innerHTML = `<div class="preview-trap-art">${trapFace(id, false)}</div>`;
  const inspect = $("preview-inspect-trap");
  inspect.hidden = false;
  inspect.onclick = () => openTrap(id);
  useImageFallback(preview);
}

function trapLeaf(id, count = 1) {
  const card = cardInfo(id);
  const leaf = document.createElement("div");
  leaf.className = "trap-leaf";
  leaf.textContent = (count > 1 ? `${count}× ` : "") + card.name;
  if (card.faces[0]?.image) {
    const image = document.createElement("img");
    image.src = card.faces[0].image;
    image.alt = "";
    image.loading = "lazy";
    image.addEventListener("error", () => image.remove(), { once: true });
    leaf.prepend(image);
  }
  return leaf;
}

function visitTrap(node, choices, visit, path = "root", choicePath) {
  visit(node, path, choicePath);
  if (!Array.isArray(node)) return;
  const [type, children] = node;
  if (type === "AnyNode") {
    const index = choices[path];
    if (index !== undefined && index !== "" && children[index]) {
      visitTrap(children[index][0], choices, visit, `${path}.${index}`, path);
    }
    return;
  }
  children.forEach(([child, count], index) => {
    for (let copy = 0; copy < count; copy += 1) {
      visitTrap(child, choices, visit, `${path}.${index}.${copy}`, choicePath);
    }
  });
}

function trapLeaves(pick, choices = pick.choices || {}) {
  const leaves = [];
  visitTrap(traps.get(pick.cardId).tree, choices, (node, path, choicePath) => {
    if (!Array.isArray(node)) leaves.push({ cardId: node, path, choicePath });
    else if (node[0] === "AnyNode" && !node[1][choices[path]]) {
      const cardId = `t-option-${pick.cardId}-${path}`;
      traps.set(cardId, { tree: node, option: true });
      leaves.push({ cardId, path, choicePath: path });
    }
  });
  return leaves;
}

function trapOrigin(card) {
  const [root, index] = String(card.id).split(":");
  if (index === undefined) return null;
  const trap = draft.picks.find((pick) => String(pick.id) === root && pick.members);
  if (!trap) return null;
  return { trap, choicePath: card.choicePath ?? trapLeaves(trap)[Number(index)]?.choicePath };
}

function trapPlacement({ zone, cell, stack, order }) {
  return { zone, cell, stack, order };
}

function refreshTrap(pick, message) {
  const prefix = `${pick.id}:`;
  draft.moves = draft.moves.filter(({ id }) => String(id) !== String(pick.id) && !String(id).startsWith(prefix));
  for (const id of chosenCards) {
    if (id === String(pick.id) || id.startsWith(prefix)) chosenCards.delete(id);
  }
  draft.submitted = false;
  renderEditor();
  save();
  renderSubmission();
  notice(message);
}

function trapCollapsePath(pick, member) {
  const memberPath = member.path || trapOrigin(member)?.choicePath;
  if (!memberPath) return null;
  const paths = memberPath.split(".").map((_, index, parts) => parts.slice(0, index + 1).join("."));
  return paths.reverse().find((path) => {
    const node = trapChoiceNode(pick, path);
    return node?.[0] === "AnyNode" && node[1][pick.choices?.[path]];
  }) || null;
}

function collapseTrap(pick, member) {
  if (!editorActionDepth) return editorAction("collapse trap", () => collapseTrap(pick, member));
  const path = trapCollapsePath(pick, member);
  if (path) {
    const choices = Object.fromEntries(Object.entries(pick.choices || {})
      .filter(([key]) => key !== path && !key.startsWith(`${path}.`)));
    resolveTrap(pick, choices, path);
    notice("Collapsed choice. Other trap components are unchanged.");
    return;
  }
  Object.assign(pick, trapPlacement(member));
  delete pick.members;
  refreshTrap(pick, "Collapsed trap.");
}

function chooseTrapOption(pick, path, index) {
  if (!editorActionDepth) return editorAction("choose trap option", () => chooseTrapOption(pick, path, index));
  const node = trapChoiceNode(pick, path);
  if (node?.[0] !== "AnyNode" || !node[1][index]) return;
  const next = String(index);
  if (pick.choices?.[path] === next) return;
  const choices = Object.fromEntries(Object.entries(pick.choices || {})
    .filter(([key]) => !key.startsWith(`${path}.`)));
  choices[path] = next;
  resolveTrap(pick, choices, path);
}

function trapChoiceNode(pick, choicePath) {
  let choice;
  visitTrap(traps.get(pick.cardId).tree, pick.choices || {}, (node, path) => {
    if (path === choicePath) choice = node;
  });
  return choice;
}

function resolveTrap(pick, choices, choicePath) {
  if (!editorActionDepth) return editorAction("expand trap", () => resolveTrap(pick, choices, choicePath));
  const previous = pick.members || [];
  const leaves = trapLeaves(pick, choices);
  const placements = leaves.map((leaf, index) => {
    const match = previous.find((member) => member.path === leaf.path && member.cardId === leaf.cardId);
    if (match) return match;
    const legacy = previous[index];
    return legacy && !legacy.path && legacy.cardId === leaf.cardId ? legacy : null;
  });
  const replaced = choicePath && previous.find((member) => !placements.includes(member)
    && (member.path === choicePath || member.path?.startsWith(`${choicePath}.`) || trapOrigin(member)?.choicePath === choicePath));
  const source = replaced || (!previous.length ? pick : null);
  const affected = (path) => !choicePath || path === choicePath || path.startsWith(`${choicePath}.`);
  const inherited = source && trapPlacement(source);
  if (inherited && !inherited.stack && leaves.filter((leaf, index) => !placements[index] && affected(leaf.path)).length > 1) {
    inherited.stack = crypto.randomUUID();
  }
  pick.choices = choices;
  pick.members = leaves.map((leaf, index) => {
    const placement = placements[index] || (affected(leaf.path) ? inherited : null);
    return { ...leaf, ...trapPlacement(placement || { zone: pick.zone }), id: `${pick.id}:${index}` };
  });
  refreshTrap(pick, choicePath ? "Applied trap choice." : "Expanded trap. Choose options on the remaining choice cards.");
}

function openTrap(cardId) {
  const container = $("trap-tree");
  container.replaceChildren();
  function branch(node, parent, count = 1) {
    if (!Array.isArray(node)) {
      parent.append(trapLeaf(node, count));
      return;
    }
    const box = document.createElement("fieldset");
    const legend = document.createElement("legend");
    const all = node[0] === "AllNode";
    legend.textContent = (count > 1 ? count + "× " : "") + (all ? "Take all" : "Choose one");
    box.append(legend);
    parent.append(box);
    for (const [child, quantity] of node[1]) branch(child, box, all ? quantity : 1);
  }
  branch(traps.get(cardId).tree, container);
  $("trap-dialog").showModal();
}
function editorPicks() {
  return draft.picks.flatMap((pick) => {
    if (!pick.members) return [pick];
    if (pick.members.some(({ cardId }) => cardId.startsWith?.("t-option-") && !traps.has(cardId))) trapLeaves(pick);
    return pick.members;
  });
}

function hasUnresolvedDeckTraps() {
  return editorPicks().some(({ cardId, zone }) => zone !== "pool" && traps.has(cardId));
}

function deckPrintings() {
  return editorPicks().filter(({ cardId, zone }) => zone !== "pool" && !traps.has(cardId));
}

function findEditorPick(id) {
  return editorPicks().find((pick) => String(pick.id) === String(id));
}
