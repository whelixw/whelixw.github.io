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
    return [node.type, children.map(([child, count]) => [normalize(child), count])];
  }
  function canonicalize(node) {
    if (!Array.isArray(node)) return node;
    const [type, children] = node;
    const options = children.map(([child, count]) => [canonicalize(child), count]);
    options.sort((left, right) => JSON.stringify(left[0]).localeCompare(JSON.stringify(right[0])));
    return [type, options];
  }
  const imageTree = normalize(trap.node);
  const tree = canonicalize(imageTree);
  const encoded = btoa(JSON.stringify([trap.intention_type || "", tree])).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  const id = `t-${encoded}`;
  const previous = traps.get(id);
  const imageId = typeof trap.id === "string" && /^[a-z0-9_-]+$/i.test(trap.id) ? trap.id : previous?.imageId;
  traps.set(id, { tree, imageId, imageTree, wire: raw ? trap : previous?.wire });
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
  const { tree } = traps.get(id);
  if (!trapComponents(tree).length) return "";

  return `<button type="button" class="trap-component-toggle" hidden aria-expanded="false" aria-label="Show trap components"></button>
    <span class="trap-components trap-art-strip" role="group" aria-label="Trap components">
      ${trapArtTree(tree, true)}
    </span>`;
}

function trapTile(member) {
  if (member === undefined) return "";
  const face = cardInfo(member).faces[0];
  if (!face?.image) return "";
  // Cubeapp uses the reference's layout-aware artwork crop (including split cards).
  if (face.artImage) return `<img class="trap-artwork" src="${escapeHtml(face.artImage)}" alt="" draggable="false" loading="lazy">`;
  // Practice images are full faces. Match mtgimg's standard artwork rectangle,
  // then center-crop that rectangle to the strip, never the whole card face.
  return `<svg class="trap-artwork" viewBox="92 120 560 435" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><image href="${escapeHtml(face.image)}" width="745" height="1040" preserveAspectRatio="none"></image></svg>`;
}

function trapArtTree(node, interactive = false, count = 1, parentType = null, chooseOptions = false) {
  const copies = count > 1 ? `<span class="trap-count" aria-hidden="true">${count}×</span>` : "";
  if (!Array.isArray(node)) {
    const name = escapeHtml(cardInfo(node).name);
    const label = (count > 1 ? `${count}× ` : "") + name;
    const content = `${trapTile(node)}<span class="trap-name">${name}</span>${copies}`;
    return interactive
      ? `<button type="button" class="trap-art-component" data-component="${node}" title="${label}" aria-label="Preview ${label}">${content}</button>`
      : `<span class="trap-art-component" data-component="${node}" title="${label}">${content}</span>`;
  }
  const [type, children] = node;
  const any = type === "AnyNode";
  const label = (count > 1 ? `${count}× ` : "") + (parentType === null ? "" : parentType === "AllNode" ? "AND " : "OR ") + (any ? "choose one" : "take all");
  return `<span class="trap-art-group ${any ? "trap-art-any" : "trap-art-all"}" role="group" aria-label="${label}">${copies}
    <span class="trap-group-children">${children.map(([child, quantity], index) => {
      if (!chooseOptions) return trapArtTree(child, interactive, any ? 1 : quantity, type);
      const member = trapComponents(child)[0];
      const summary = escapeHtml(trapSummary(child));
      return `<button type="button" class="trap-art-option" data-trap-option="${index}" ${member === undefined ? "" : `data-component="${member}"`} title="Choose ${summary}" aria-label="Choose ${summary}">${trapArtTree(child, false, 1, type)}</button>`;
    }).join("")}</span>
  </span>`;
}

function originalTrapImage(id) {
  const { imageId } = traps.get(id);
  return imageId && $("show-card-names").checked
    ? `${bridgeOrigin}/cubeapp/api/images/${imageId}/?type=trap&size_slug=medium` : "";
}

function originalTrapHitAreas(node) {
  if (!Array.isArray(node)) {
    const name = cardInfo(node).name;
    return { name, markup: `<span class="trap-art-component" data-component="${node}" title="${escapeHtml(name)}"></span>` };
  }
  const [, children] = node;
  // Cubeapp sorts the image rows by card name or the nested group's name.
  const rows = children.map(([child, count]) => ({ ...originalTrapHitAreas(child), child, count }));
  rows.sort((left, right) => (left.name > right.name) - (left.name < right.name));
  const name = rows.map(({ name, child, count }) =>
    (count > 1 ? `${count}x` : "") + name + (Array.isArray(child) ? ` ${child[0]}` : "")).join("");
  const markup = rows.map(({ markup, child, count }) => Array.isArray(child) ? markup.repeat(count) : markup).join("");
  return { name, markup: `<span class="original-trap-group">${markup}</span>` };
}

function trapFace(id, interactive = true, deck = false) {
  const { tree, imageTree } = traps.get(id);
  const chooseOptions = deck && isTrapChoice(id);
  const overlay = interactive && !chooseOptions ? trapComponentSelector(id) : "";
  const source = deck && !chooseOptions ? originalTrapImage(id) : "";
  const original = source ? `<img class="original-trap-art" src="${escapeHtml(source)}" alt="" draggable="false" loading="lazy"><span class="original-trap-components">${originalTrapHitAreas(imageTree || tree).markup}</span>` : "";
  return `<span class="trap-face"><span class="trap-art-strip">${trapArtTree(tree, false, 1, null, chooseOptions)}</span>${original}</span>${overlay}`;
}

function showTrapPreview(id) {
  const preview = $("preview-secondary");
  const inspect = $("preview-inspect-trap");
  inspect.hidden = false;
  inspect.onclick = () => openTrap(id);

  const { tree } = traps.get(id);
  const originalImage = originalTrapImage(id);
  if (originalImage && preview.firstElementChild?.dataset.originalImage === originalImage) return;

  preview.innerHTML = `<div class="preview-trap-art">${trapFace(id, false)}</div>`;
  useImageFallback(preview);
  if (!originalImage) return;

  const art = preview.firstElementChild;
  art.dataset.originalImage = originalImage;
  const image = document.createElement("img");
  image.alt = trapSummary(tree);
  image.draggable = false;
  image.addEventListener("load", () => art.replaceChildren(image), { once: true });
  image.src = originalImage;
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
  delete pick.choices;
  refreshTrap(pick, "Collapsed trap.");
}

function chooseTrapOption(pick, path, index) {
  if (!pick.members) return;
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
  const affected = (path) => !previous.length || !choicePath || path === choicePath || path.startsWith(`${choicePath}.`);
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
function editorPicks(state = draft) {
  return state.picks.flatMap((pick) => {
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

