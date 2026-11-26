"use strict";

const editorHistories = new WeakMap();
let editorActionDepth = 0;
const copyEditorState = (value) => JSON.parse(JSON.stringify(value));

function editorHistory() {
  if (!editorHistories.has(draft)) editorHistories.set(draft, { undo: [], redo: [] });
  return editorHistories.get(draft);
}

function updateEditorHistoryControls() {
  const history = editorHistory();
  $("undo").disabled = !history.undo.length;
  $("redo").disabled = !history.redo.length;
  $("undo").title = history.undo.length ? `Undo ${history.undo.at(-1).label}` : "Nothing to undo";
  $("redo").title = history.redo.length ? `Redo ${history.redo.at(-1).label}` : "Nothing to redo";
}

function editorAction(label, action) {
  if (editorActionDepth) return action();
  const workspace = draft;
  const before = new Map(draft.picks.map((pick) => [String(pick.id), copyEditorState(pick)]));
  const selectionBefore = [...chosenCards];
  editorActionDepth++;
  try { return action(); }
  finally {
    editorActionDepth--;
    if (draft === workspace) {
      const after = new Map(draft.picks.map((pick) => [String(pick.id), copyEditorState(pick)]));
      const changed = [...new Set([...before.keys(), ...after.keys()])]
        .filter((id) => JSON.stringify(before.get(id)) !== JSON.stringify(after.get(id)));
      if (changed.length) {
        const history = editorHistory();
        history.undo.push({ label, changed,
          before: new Map(changed.filter((id) => before.has(id)).map((id) => [id, before.get(id)])),
          after: new Map(changed.filter((id) => after.has(id)).map((id) => [id, after.get(id)])),
          selectionBefore, selectionAfter: [...chosenCards] });
        if (history.undo.length > 100) history.undo.shift();
        history.redo = [];
      }
      updateEditorHistoryControls();
    }
  }
}

function replayEditorAction(direction) {
  const history = editorHistory();
  const command = history[direction].pop();
  if (!command) return;
  const target = direction === "undo" ? command.before : command.after;
  const changed = new Set(command.changed);
  // Replace only roots touched by this action; later server-confirmed picks stay intact.
  draft.picks = draft.picks.flatMap((pick) => !changed.has(String(pick.id)) ? [pick]
    : target.has(String(pick.id)) ? [copyEditorState(target.get(String(pick.id)))] : []);
  const present = new Set(draft.picks.map(({ id }) => String(id)));
  for (const id of command.changed) {
    if (!present.has(id) && target.has(id)) draft.picks.push(copyEditorState(target.get(id)));
  }
  // A pick confirmed after this edit can share a cell with the restored cards.
  for (const zone of zoneKeys) deckPiles(zone, draft, true);
  chosenCards.clear();
  for (const id of direction === "undo" ? command.selectionBefore : command.selectionAfter) {
    if (findEditorPick(id)) chosenCards.add(id);
  }
  history[direction === "undo" ? "redo" : "undo"].push(command);
  draft.moves = [];
  draft.submitted = false;
  save();
  renderEditor();
  renderSubmission();
  updateEditorHistoryControls();
  notice(`${direction === "undo" ? "Undid" : "Redid"} ${command.label}.`);
}
