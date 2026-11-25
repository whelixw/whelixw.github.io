"use strict";

const liveDialog = $("live-dialog");
const configuredBridge = document.querySelector('meta[name="cubeapp-bridge"]')?.content;
const bridgeUrl = URL.canParse(configuredBridge) ? new URL(configuredBridge) : null;
const bridgeOrigin = bridgeUrl?.protocol === "https:" ? bridgeUrl.origin : "";
const localBridge = location.protocol === "http:" && location.hostname === "127.0.0.1";
const liveAvailable = Boolean(bridgeOrigin || localBridge);
let account = null;
let lobbySocket = null;
let draftSocket = null;
const lobbies = new Map();
const detailRequests = new Map();
let poolsOffset = 0;
let poolsLoading = false;
let lobbiesAuthenticated = false;
let editingLobby = null;
let hostCubes = [];
let hostLoad = 0;
let hostLoading = false;
let hostSubmitting = false;

function hostField(name) { return $("live-host-form").elements.namedItem(name); }

function hostSelect(name, entries, placeholder) {
  const select = hostField(name);
  const option = (value, label) => {
    const node = document.createElement("option");
    node.value = String(value); node.textContent = label;
    return node;
  };
  select.replaceChildren(option("", placeholder), ...entries.map(([value, label]) => option(value, label)));
  select.value = "";
}

function updateHostValidity() {
  const form = $("live-host-form");
  const valid = (key, max) => { const n = Number(hostField(key).value); return Number.isSafeInteger(n) && n >= 1 && n <= max; };
  $("live-host-submit").disabled = hostLoading || hostSubmitting || !lobbiesAuthenticated
    || !valid("release", Number.MAX_SAFE_INTEGER) || !valid("amount", 127) || !valid("pack_size", 360)
    || (!editingLobby && !hostField("cube").value) || !form.checkValidity();
}

function savedHostRelease() {
  const spec = lobbies.get(editingLobby)?.game_options?.pool_specification?.[0];
  return spec ? String(spec.release?.id ?? spec.release) : null;
}

function updateHostTimer() {
  hostField("time_control").disabled = !hostField("use_time_controls").checked;
}

function clearHostCube() {
  hostSelect("release", [], "Choose a cube first");
  hostField("release").disabled = true;
  for (const key of ["amount", "pack_size"]) {
    hostField(key).value = ""; hostField(key).disabled = true;
  }
}

function sortedHostReleases(cube) {
  return [...(cube.releases || [])].sort((a, b) =>
    (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0) || Number(b.id) - Number(a.id));
}

// The API exposes saved configurations through limited sessions, not cube defaults.
// Scan in server date order, across pages; never substitute global draft defaults.
async function latestHostSettings(cube, current = () => true) {
  const releases = new Set(cube.releases.map(({ id }) => String(id)));
  for (let offset = 0; current();) {
    const page = await cubeRequest(`limited/sessions/?game_type_filter=draft&sort_key=created_at&ascending=false&limit=100&offset=${offset}`);
    const sessions = page.results || [];
    for (const session of sessions) {
      const specs = session.pool_specification?.specifications || [];
      const matches = specs.filter((spec) => releases.has(String(spec.release?.id ?? spec.release)));
      if (!matches.length) continue;
      // A mixed configuration cannot be represented faithfully by this form.
      if (specs.length !== 1 || !Number.isInteger(matches[0].amount) || !Number.isInteger(matches[0].size)
        || matches[0].amount < 1 || matches[0].amount > 127 || matches[0].size < 1 || matches[0].size > 360) return null;
      return { ...matches[0], session: session.name || `#${session.id}` };
    }
    offset += sessions.length;
    if (!sessions.length || (page.count !== undefined ? offset >= page.count : !page.next)) return null;
  }
  return null;
}

async function selectHostCube() {
  const generation = ++hostLoad;
  clearHostCube();
  // Sampling flags are cube-specific too; discard values from the previous cube.
  for (const key of ["allow_repeat", "allow_intersection"]) hostField(key).checked = false;
  const cube = hostCubes.find(({ id }) => String(id) === hostField("cube").value);
  hostLoading = Boolean(cube);
  updateHostValidity();
  if (!cube) {
    $("live-host-cube-status").textContent = "Choose a cube to load releases and saved draft settings.";
    return;
  }
  const current = () => generation === hostLoad;
  const releases = sortedHostReleases(cube);
  hostSelect("release", releases.map((release) => [release.id,
    `${release.name || `Release ${release.id}`} · ${release.created_at?.slice(0, 10) || "Date unavailable"}`]), "Choose a release");
  hostField("release").value = String(releases[0]?.id || "");
  hostField("release").disabled = !releases.length;
  $("live-host-cube-status").textContent = releases.length ? "Loading this cube's saved draft settings…" : "This cube has no releases. Choose another cube.";
  try {
    if (!releases.length) return;
    const settings = await latestHostSettings(cube, current);
    if (!current()) return;
    if (settings) {
      hostField("amount").value = settings.amount;
      hostField("pack_size").value = settings.size;
      for (const key of ["allow_repeat", "allow_intersection"]) hostField(key).checked = Boolean(settings[key]);
    }
    $("live-host-cube-status").textContent = settings
      ? `Pack settings from the most recent saved draft: ${settings.session}. You can edit them.`
      : "No usable saved draft settings for this cube. Enter packs per player and cards per pack.";
  } catch (error) {
    if (current()) $("live-host-cube-status").textContent = `Could not load saved settings: ${error.message}. Enter pack settings explicitly, or reload cubes to retry.`;
  } finally {
    if (current()) {
      hostLoading = false;
      for (const key of ["amount", "pack_size"]) hostField(key).disabled = !releases.length;
      updateHostValidity();
    }
  }
}

async function loadHostCubes(lobby = null) {
  const generation = ++hostLoad;
  hostLoading = true;
  hostField("cube").disabled = true;
  // Saved lobby fields stay intact even if the catalog cannot be loaded.
  if (!lobby) { clearHostCube(); hostSelect("cube", [], "Loading cubes…"); }
  updateHostValidity();
  $("live-host-cube-status").textContent = "Loading cubes…";
  try {
    const cubes = [];
    for (let offset = 0;;) {
      const page = await cubeRequest(`versioned-cubes/?limit=100&offset=${offset}`);
      if (generation !== hostLoad) return;
      const rows = page.results || [];
      cubes.push(...rows); offset += rows.length;
      if (!rows.length || (page.count !== undefined ? offset >= page.count : !page.next)) break;
    }
    hostCubes = cubes;
    hostSelect("cube", cubes.map(({ id, name }) => [id, name || `Cube ${id}`]), "Choose a cube");
    if (lobby) {
      const spec = lobby.game_options.pool_specification[0];
      const releaseId = String(spec.release?.id ?? spec.release);
      const cube = cubes.find((cube) => cube.releases.some(({ id }) => String(id) === releaseId));
      if (cube) {
        hostField("cube").value = String(cube.id);
        hostSelect("release", sortedHostReleases(cube).map((release) => [release.id,
          `${release.name || `Release ${release.id}`} · ${release.created_at?.slice(0, 10) || "Date unavailable"}`]), "Choose a release");
        hostField("release").value = releaseId;
        hostField("release").disabled = false;
      } else {
        // Keep an older/private saved release editable even when absent from the catalog.
        const option = document.createElement("option");
        option.value = "saved"; option.textContent = "Saved cube (unavailable in catalog)";
        hostField("cube").append(option); hostField("cube").value = "saved";
      }
      $("live-host-cube-status").textContent = "Saved lobby settings preserved. Changing cubes loads that cube's latest draft settings.";
    } else {
      $("live-host-cube-status").textContent = cubes.length ? "Choose a cube to load releases and saved draft settings." : "No cubes found. Reload cubes to try again.";
    }
    hostField("cube").disabled = !cubes.length;
  } catch (error) {
    if (generation === hostLoad) $("live-host-cube-status").textContent = `Could not load cubes: ${error.message}. Reload cubes to retry.${lobby ? " Saved lobby settings preserved." : ""}`;
  } finally {
    if (generation === hostLoad) { hostLoading = false; updateHostValidity(); }
  }
}

function lobbyStatus(message) {
  $("live-lobbies-status").textContent = message;
}

function sendLobby(type, name, extra = {}) {
  if (!account || !lobbiesAuthenticated || lobbySocket?.readyState !== WebSocket.OPEN) {
    throw new Error("Reconnect to the draft lobbies before continuing.");
  }
  lobbySocket.send(JSON.stringify({ type, name, ...extra }));
}

function hostNumber(fields, key, min, max) {
  const value = Number(fields[key]);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Invalid ${key.replaceAll("_", " ")}: use ${min}–${max}.`);
  return value;
}

function hostDraftOptions(fields) {
  return {
    draft_format: "single_pick", reverse: false,
    pool_specification: [{ type: "CubeBoosterSpecification",
      release: hostNumber(fields, "release", 1, Number.MAX_SAFE_INTEGER),
      amount: hostNumber(fields, "amount", 1, 127), size: hostNumber(fields, "pack_size", 1, 360),
      allow_repeat: Boolean(fields.allow_repeat), allow_intersection: Boolean(fields.allow_intersection), scale: false,
    }],
    use_time_controls: Boolean(fields.use_time_controls),
    time_control: fields.use_time_controls ? hostNumber(fields, "time_control", 1, 3600) : 0,
  };
}

function editHostedLobby(lobby = null) {
  editingLobby = lobby?.name || null;
  const form = $("live-host-form");
  form.reset();
  clearHostCube();
  const fields = form.elements;
  fields.namedItem("name").value = lobby?.name || "";
  fields.namedItem("name").disabled = Boolean(lobby);
  $("live-host-lobby-options").disabled = Boolean(lobby);
  if (lobby) {
    for (const key of ["size", "minimum_size"]) fields.namedItem(key).value = lobby.lobby_options?.[key] ?? "";
    fields.namedItem("require_ready").checked = Boolean(lobby.lobby_options?.require_ready);
    const options = lobby.game_options;
    const spec = options.pool_specification[0];
    const releaseId = typeof spec.release === "object" ? spec.release.id : spec.release;
    hostSelect("release", [[releaseId, spec.release?.name || `Saved release ${releaseId}`]], "Choose a release");
    fields.namedItem("release").disabled = false;
    fields.namedItem("release").value = String(releaseId);
    const values = { amount: spec.amount, pack_size: spec.size, time_control: options.time_control || 60 };
    for (const [key, value] of Object.entries(values)) fields.namedItem(key).value = value;
    for (const key of ["amount", "pack_size"]) fields.namedItem(key).disabled = false;
    for (const key of ["use_time_controls", "allow_repeat", "allow_intersection"]) {
      fields.namedItem(key).checked = Boolean(key === "use_time_controls" ? options[key] : spec[key]);
    }
  }
  $("live-host-submit").textContent = lobby ? "Save draft settings" : "Create draft lobby";
  $("live-host-cancel").hidden = !lobby;
  $("live-host-status").textContent = lobby ? `Editing ${lobby.name}. Settings changes reset readiness.` : "";
  $("live-host").open = true;
  updateHostTimer();
  return loadHostCubes(lobby);
}

async function submitHostedDraft(fields) {
  const editing = editingLobby;
  const generation = hostLoad;
  if (hostLoading) throw new Error("Wait for cube settings to finish loading.");
  if (fields.cube !== undefined) {
    const cube = hostCubes.find(({ id }) => String(id) === fields.cube);
    const saved = editing && fields.cube === "saved" && fields.release === savedHostRelease();
    if (!saved && !cube?.releases.some(({ id }) => String(id) === fields.release)) throw new Error("Choose a release belonging to the selected cube.");
  }
  let options = hostDraftOptions(fields);
  const name = editingLobby || fields.name?.trim();
  if (!/^[a-z0-9_]{1,80}$/i.test(name || "")) throw new Error("Use letters, numbers, and underscores for the lobby name.");
  let lobbyOptions;
  if (editingLobby) {
    const lobby = lobbies.get(editingLobby);
    if (!lobby || lobby.owner !== account?.user.username || lobby.state !== "pre-game") throw new Error("This lobby is no longer available for editing.");
    const saved = lobby.game_options;
    if (saved) options = { ...saved, ...options, pool_specification: [{ ...saved.pool_specification[0], ...options.pool_specification[0] }] };
  } else {
    const size = hostNumber(fields, "size", 2, 64);
    const minimum_size = hostNumber(fields, "minimum_size", 2, size);
    lobbyOptions = { size, minimum_size, require_ready: Boolean(fields.require_ready), unready_on_change: true };
    if (lobbies.has(name)) throw new Error("A lobby with that name already exists.");
  }
  // Creation silently drops invalid options upstream, so check the release first.
  await cubeRequest(`cube-releases/${options.pool_specification[0].release}/`);
  if (generation !== hostLoad || editing !== editingLobby) throw new Error("Draft settings changed. Review them before submitting again.");
  if (editing) {
    const lobby = lobbies.get(editing);
    if (!lobby || lobby.owner !== account?.user.username || lobby.state !== "pre-game") throw new Error("This lobby is no longer available for editing.");
  }
  sendLobby(editing ? "options" : "create", name,
    editing ? { options } : { game_type: "draft", lobby_options: lobbyOptions, game_options: options });
  $("live-host-status").textContent = "Sent to Cubeapp. Waiting for lobby confirmation…";
}

function canStartLobby(lobby) {
  return lobby.state === "pre-game" && lobby.owner === account?.user.username
    && lobby.users.length >= Math.max(2, lobby.lobby_options?.minimum_size || 0)
    && (!lobby.lobby_options?.require_ready || lobby.users.every(({ ready }) => ready));
}

function liveStatus(message) {
  $("live-status").textContent = message;
}

async function cubeRequest(path, body, onResponse) {
  const headers = { Accept: "application/json" };
  if (account) headers.Authorization = `Token ${account.token}`;
  if (body) headers["Content-Type"] = "application/json";
  const response = await fetch(`${bridgeOrigin}/cubeapp/api/${path}`, {
    headers,
    method: body ? "POST" : "GET",
    body: body ? JSON.stringify(body) : undefined,
  });
  onResponse?.();
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data?.errors?.join(" ") || data?.detail || (typeof data === "string" ? data : null);
    throw new Error(message || `Cubeapp returned HTTP ${response.status}`);
  }
  return data;
}

function liveForm(id, handler, report = liveStatus) {
  $(id).addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]') || form.querySelector("button");
    const fields = Object.fromEntries(new FormData(form));
    button.disabled = true;
    if (id === "live-host-form") hostSubmitting = true;
    try {
      await handler(fields);
    } catch (error) {
      report(error.message);
    } finally {
      button.disabled = false;
      if (id === "live-host-form") { hostSubmitting = false; updateHostValidity(); }
    }
  });
}

function remotePrinting(printing) {
  const id = `p${printing.id}`;
  const old = remoteCards.get(id);
  const image = (back, cropped = false) => `${bridgeOrigin}/cubeapp/api/images/${printing.id}/?size_slug=medium&back=${Number(back)}${cropped ? "&cropped=1" : ""}`;
  const face = (items, back) => ({
    name: items.map(({ name }) => name).join(" // "),
    mana: items.map((card) => card.mana_cost?.str).filter(Boolean).join(" // "),
    type: items.map((card) => card.type_line?.line).filter(Boolean).join(" // "),
    oracle: items.map((card) => card.oracle_text).filter(Boolean).join("\n\n"),
    stats: items.map((card) => card.power_toughness?.str).filter(Boolean).join(" // "),
    image: image(back),
    artImage: image(back, true),
  });
  const cardboard = printing.cardboard;
  const front = cardboard?.front_cards || [];
  const back = cardboard?.back_cards || [];
  const name = printing.name || old?.name || `Printing ${printing.id}`;
  const color = printing.color || front[0]?.color;
  const type = printing.types?.join(" ") || front[0]?.type_line?.line || old?.type || "";
  const faces = front.length
    ? [face(front, false), ...(back.length ? [face(back, true)] : [])]
    : old?.faces || [{ name, type, image: image(false), artImage: image(false, true), oracle: "Rules text has not loaded for this printing." }];
  remoteCards.set(id, {
    name,
    expansion: printing.expansion?.code || old?.expansion,
    collectorNumber: printing.collector_number ?? old?.collectorNumber,
    color: color?.length > 1 ? "M" : color?.[0] || old?.color || "C",
    type,
    manaValue: printing.cmc ?? front[0]?.cmc ?? old?.manaValue,
    faces,
    full: Boolean(front.length || old?.full),
  });
  return id;
}

async function searchCards(name) {
  const query = new URLSearchParams({ query: name, limit: 50 });
  const data = await cubeRequest(`search/?${query}`);
  return data.results;
}

function loadCardDetails(id) {
  const card = remoteCards.get(id);
  if (!card || card.full || card.name.startsWith("Printing ")) return;
  if (detailRequests.has(id)) return detailRequests.get(id);
  const request = searchCards(card.name.split(" // ")[0]).then((results) => {
    const exact = results.find(({ id: printingId }) => `p${printingId}` === id);
    const sameCard = results.find(({ name }) => name === card.name);
    if (exact || sameCard) {
      const details = exact || { ...sameCard, expansion: undefined, collector_number: undefined };
      remotePrinting({ ...details, id: Number(id.slice(1)) });
      if (previewed === id || previewComponent === id) renderPreview();
    }
  }).catch(() => {}).finally(() => detailRequests.delete(id));
  detailRequests.set(id, request);
  return request;
}

$("table").addEventListener("pointerover", inspectRemote);
$("table").addEventListener("focusin", inspectRemote);
$("table").addEventListener("click", inspectRemote);
function inspectRemote(event) {
  const id = event.target.closest("[data-preview]")?.dataset.preview;
  if (id?.startsWith("p")) loadCardDetails(id);
}

function readLayout(key) {
  try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; }
}

function showWorkspace(workspace, label) {
  chosenCards.clear();
  activeLive = workspace;
  draft = workspace.state;
  selected = null;
  showPreview(null);
  $("workspace-label").textContent = label;
  $("restart").hidden = true;
  liveDialog.close();
  render();
}

function liveWorkspace(key, finished = false) {
  const storage = `deckeditor-live-${key}`;
  const saved = readLayout(storage);
  const placements = new Map();
  let nextPickId = 0;
  for (const placement of saved.filter((pick) => !pick.addedPrinting)) {
    if (!placements.has(placement.cardId)) placements.set(placement.cardId, []);
    placements.get(placement.cardId).push(placement);
  }
  return {
    state: { picks: [], available: [], moves: [], deadline: null, round: 0, packTotal: null, history: [], drafters: new Map(), queues: new Map(), finished, submitted: false },
    loadedPool: finished,
    canSubmit: false,
    pending: null,
    hasSavedLayout: saved.length > 0,
    allowedBasics: new Set(),
    setInfinites(infinites) {
      if (!infinites) return;
      this.allowedBasics = new Set((infinites?.cardboards || []).map((card) => typeof card === "string" ? card : card.name).filter((name) => basicNames.has(name)));
      if (this.basicsRestored) return;
      this.basicsRestored = true;
      for (const pick of saved) {
        if (this.allowedBasics.has(pick.addedPrinting?.name)) {
          const cardId = remotePrinting(pick.addedPrinting);
          this.state.picks.push({ ...pick, cardId, id: nextPickId++ });
        }
      }
    },
    addBasic(printing, quantity, zone) {
      if (!editorActionDepth) return editorAction("add basic lands", () => this.addBasic(printing, quantity, zone));
      const cardId = remotePrinting(printing);
      const picks = Array.from({ length: quantity }, () => ({ id: nextPickId++, cardId, zone, addedPrinting: printing }));
      placeCards(picks, zone, destinationCell(zone, undefined, this.state), this.state);
      this.state.picks.push(...picks);
      this.state.submitted = false;
      save();
      renderEditor();
      renderSubmission();
    },
    save() {
      const layout = JSON.stringify(this.state.picks);
      localStorage.setItem(storage, layout);
      if (this.poolId) localStorage.setItem(`deckeditor-live-pool-${this.poolId}`, layout);
    },
    add(cardId, zone = "main", cell) {
      const id = nextPickId++;
      const prior = placements.get(cardId)?.shift();
      const pick = { ...prior, id, cardId, zone: prior?.zone || zone };
      if (pick.members) pick.members = pick.members.map((member, index) => ({ ...member, id: `${id}:${index}` }));
      if (cell !== undefined && !prior) placeCards([pick], zone, cell, this.state);
      this.state.picks.push(pick);
    },
  };
}

function addPrintings(workspace, entries) {
  for (const [printing, quantity] of entries || []) {
    const id = remotePrinting(printing);
    for (let copy = 0; copy < quantity; copy += 1) workspace.add(id, "pool");
  }
}

function addTraps(workspace, entries) {
  for (const [trap, quantity] of entries || []) {
    const id = registerLiveTrap(trap);
    for (let copy = 0; copy < quantity; copy += 1) workspace.add(id, "pool");
  }
}

function attachPool(workspace, pool) {
  workspace.poolId = pool.id;
  workspace.setInfinites(pool.session?.infinites);
  workspace.canSubmit = account?.user.id === pool.user?.id;
  workspace.submit = async () => {
    const name = window.prompt("Deck name", "Draft deck")?.trim();
    if (!name || !workspace.canSubmit) return;
    workspace.canSubmit = false;
    renderSubmission();
    const ids = (zone) => deckPrintings().filter((card) => card.zone === zone).map(({ cardId }) => Number(cardId.slice(1)));
    try {
      await cubeRequest(`limited/pools/${pool.id}/`, {
        name,
        deck: JSON.stringify({ maindeck: ids("main"), sideboard: ids("side") }),
      });
      workspace.state.submitted = true;
      notice("Deck submitted to Cubeapp.");
    } catch (error) {
      notice(error.message);
    } finally {
      workspace.canSubmit = true;
      renderSubmission();
    }
  };
}

function stopDraft() {
  if (draftSocket) {
    const previous = draftSocket;
    draftSocket = null;
    previous.close();
  }
}

function openSocket(path) {
  const url = new URL(`/cubeapp/ws/${path}/`, bridgeOrigin || location.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return new WebSocket(url);
}

function openDraft(key) {
  if (!/^[a-f0-9-]+$/i.test(key)) throw new Error("Enter a valid draft seat key");
  stopDraft();
  const workspace = liveWorkspace(key);
  const state = workspace.state;
  const socket = openSocket(`draft/${key.toLowerCase()}`);
  draftSocket = socket;
  let unsupported = false;
  let lastPick = 0;
  let boosterId;
  workspace.pick = (cardId, zone, cell) => {
    if (unsupported || workspace.pending || socket.readyState !== WebSocket.OPEN) return;
    workspace.pending = { cardId, zone, cell };
    const choice = traps.has(cardId) ? traps.get(cardId).wire : Number(cardId.slice(1));
    socket.send(JSON.stringify({ type: "pick", pick: { type: "SinglePickPick", pick: choice } }));
    renderSelection();
  };
  const apply = (message) => {
    switch (message.type) {
      case "previous_messages":
        for (const item of message.messages) apply(item);
        break;
      case "started": {
        state.drafters = new Map((message.drafters || []).map(({ id, username }) => [id, username]));
        const amounts = message.pool_specification?.specifications?.map(({ amount }) => amount);
        if (Number.isSafeInteger(message.pack_amount) && message.pack_amount > 0) {
          state.packTotal = message.pack_amount;
        } else if (amounts?.length && amounts.every((amount) => Number.isSafeInteger(amount) && amount > 0)) {
          state.packTotal = amounts.reduce((total, amount) => total + amount, 0);
        }
        workspace.setInfinites(message.infinites);
        unsupported = message.draft_format !== "single_pick" || message.reverse;
        if (unsupported) notice("This prototype supports standard single-pick drafts.");
        for (const spec of message.pool_specification?.specifications || []) {
          if (spec.release?.id) {
            cubeRequest(`cube-releases/${spec.release.id}/`).then((release) => {
              const cube = release.cube?.cube || release.cube;
              for (const [printing] of cube?.printings || []) remotePrinting(printing);
              for (const [trap] of cube?.traps || []) registerLiveTrap(trap);
              if (activeLive === workspace) {
                render();
                if (traps.has(previewed)) renderPreview();
              }
            }).catch(() => {});
          }
        }
        break;
      }
      case "booster_amount_update":
        if (state.drafters.has(message.drafter) && Number.isSafeInteger(message.queue_size) && message.queue_size >= 0) {
          state.queues.set(message.drafter, message.queue_size);
          if ($("draft-status").open) renderPackQueues();
        }
        return false;
      case "round":
        state.round = message.round.pack;
        break;
      case "booster": {
        selected = null;
        boosterId = message.booster.booster_id;
        state.boosterId = boosterId;
        const cube = message.booster.cubeables;
        if (unsupported || ["tickets", "purples"].some((type) => cube[type]?.length)) {
          state.available = [];
          notice("This live booster contains a draft format or special cube entry the prototype cannot play.");
          break;
        }
        state.available = [
          ...cube.printings.map((id) => remotePrinting({ id })),
          ...(cube.traps || []).map((trap) => registerLiveTrap(trap, true)),
        ];
        state.deadline = message.timeout ? (message.began_at + message.timeout) * 1000 : null;
        break;
      }
      case "pick": {
        const number = message.pick_number;
        if (!Number.isSafeInteger(number) || number <= lastPick) return false;
        lastPick = number;
        const choice = message.pick?.pick;
        const id = Number.isInteger(choice) ? remotePrinting({ id: choice })
          : choice?.type === "Trap" ? registerLiveTrap(choice, true) : null;
        if (id !== null) {
          const pending = workspace.pending?.cardId === id ? workspace.pending : null;
          state.history.push({ cardId: id, round: state.round, number, boosterId,
            pack: state.available.includes(id) ? [...state.available] : undefined });
          workspace.add(id, pending?.zone, pending?.cell);
        }
        workspace.pending = null;
        selected = null;
        state.available = [];
        state.deadline = null;
        break;
      }
      case "completed":
        if (!message.pool_id) break;
        workspace.poolId = message.pool_id;
        state.finished = true;
        state.available = [];
        $("workspace-label").textContent = message.session_name || "Completed draft";
        cubeRequest(`limited/pools/${message.pool_id}/`).then((pool) => {
          if (activeLive !== workspace) return;
          attachPool(workspace, pool);
          renderSubmission();
        }).catch((error) => notice(error.message));
        break;
      case "error":
        workspace.pending = null;
        notice(message.message || message.error || "Cubeapp rejected the draft action.");
        renderSelection();
        return false;
      default:
        return false;
    }
    return true;
  };
  socket.addEventListener("open", () => {
    if (draftSocket !== socket) return;
    showWorkspace(workspace, "Live draft");
    notice("Connected to Cubeapp draft.");
  });
  socket.addEventListener("message", ({ data }) => {
    if (draftSocket !== socket) return;
    try {
      if (!apply(JSON.parse(data))) return;
      if (state.picks.length) save();
      render();
    } catch (error) {
      notice(`Could not read a draft update: ${error.message}`);
    }
  });
  socket.addEventListener("close", () => {
    if (draftSocket !== socket || state.finished) return;
    draftSocket = null;
    workspace.pending = null;
    state.available = [];
    state.queues.clear();
    if (activeLive === workspace) {
      selected = null;
      render();
      notice("Draft connection closed. Reopen the same seat from Cubeapp to reconnect.");
    } else liveStatus("Could not open that draft seat.");
  });
}

function showLobbies() {
  const list = $("live-lobbies");
  list.replaceChildren();
  for (const lobby of lobbies.values()) {
    if (lobby.game_type !== "draft") continue;
    const row = document.createElement("div");
    const me = lobby.users.find(({ username }) => username === account.user.username);
    const state = lobby.state === "pre-game" ? (me?.ready ? "Ready" : me ? "Joined" : "Open") : "In progress";
    row.textContent = `${lobby.name} · ${lobby.users.length} players · ${state}`;
    const action = (label, handler) => {
      const button = document.createElement("button");
      button.textContent = label;
      button.addEventListener("click", () => { try { handler(); } catch (error) { lobbyStatus(error.message); } });
      row.append(button);
      return button;
    };
    const send = (type, extra) => {
      sendLobby(type, lobby.name, extra);
    };
    if (lobby.key) action("Open seat", () => openDraft(lobby.key));
    if (lobby.state === "pre-game") {
      if (!me) action("Join", () => send("join")).disabled = lobby.users.length >= (lobby.lobby_options?.size || 64);
      if (me) {
        action(me.ready ? "Unready" : "Ready", () => send("ready", { state: !me.ready }));
        action("Leave", () => send("leave"));
      }
      if (lobby.owner === account.user.username) {
        const specs = lobby.game_options?.pool_specification || [];
        const spec = specs[0];
        const editable = specs.length === 1 && spec.type === "CubeBoosterSpecification"
          && !spec.scale && !lobby.game_options.reverse && lobby.game_options.draft_format === "single_pick";
        if (editable) action("Draft settings", () => editHostedLobby(lobby));
        const start = action("Start draft", () => {
          const current = lobbies.get(lobby.name);
          if (!current || !canStartLobby(current)) throw new Error("Wait for the minimum players and required readiness before starting.");
          send("start");
        });
        start.disabled = !canStartLobby(lobby);
        start.title = start.disabled ? "At least two players and the lobby's required readiness are needed." : "Start this draft for all players";
      }
    }
    const details = document.createElement("p");
    details.textContent = `Host: ${lobby.owner} · ${lobby.users.map((user) => `${user.username}${user.ready ? " (ready)" : ""}`).join(", ")}`;
    const specs = lobby.game_options?.pool_specification || [];
    details.textContent += specs.map((spec) => ` · ${spec.amount} × ${spec.size || "?"} cards, release ${spec.release?.id || spec.release || "?"}`).join("");
    row.append(details);
    list.append(row);
  }
  $("live-lobbies-status").textContent = list.children.length ? "" : "No current draft lobbies.";
}

function connectLobbies(mark) {
  lobbiesAuthenticated = false;
  $("live-host-submit").disabled = true;
  lobbySocket?.close();
  $("live-lobbies-status").textContent = "Loading current lobbies…";
  $("live-lobbies-reconnect").hidden = true;
  const socket = openSocket("lobbies");
  lobbySocket = socket;
  socket.addEventListener("open", () => {
    if (socket !== lobbySocket) return;
    mark?.("lobby-socket-open");
    socket.send(JSON.stringify({ type: "authentication", token: account.token }));
  });
  socket.addEventListener("message", ({ data }) => {
    if (socket !== lobbySocket) return;
    const message = JSON.parse(data);
    if (message.type === "error") {
      $("live-lobbies-status").textContent = message.message || message.error || "Cubeapp rejected the lobby action.";
      $("live-host-status").textContent = $("live-lobbies-status").textContent;
      return;
    }
    if (message.type === "all_lobbies") {
      if (!lobbiesAuthenticated) mark?.("lobbies-received");
      lobbiesAuthenticated = true;
      $("live-host").hidden = false;
      if (!hostCubes.length && !hostLoading) editHostedLobby();
      else updateHostValidity();
      lobbies.clear();
      for (const lobby of message.lobbies) lobbies.set(lobby.name, lobby);
    } else if (message.type === "lobby_closed") {
      lobbies.delete(message.lobby?.name || message.name);
    } else if (message.type === "game_started" && message.key && message.lobby.game_type === "draft") {
      lobbies.set(message.lobby.name, { ...message.lobby, key: message.key });
      openDraft(message.key);
    } else if (message.lobby?.name) {
      const old = lobbies.get(message.lobby.name);
      lobbies.set(message.lobby.name, { ...old, ...message.lobby });
    } else return;
    if (["lobby_created", "lobby_update"].includes(message.type) && message.lobby?.owner === account.user.username) {
      $("live-host-status").textContent = `Lobby ${message.lobby.name} confirmed. Ready up, then choose Start draft.`;
    }
    showLobbies();
  });
  socket.addEventListener("close", () => {
    if (socket !== lobbySocket) return;
    lobbiesAuthenticated = false;
    $("live-host-submit").disabled = true;
    lobbies.clear();
    $("live-lobbies").replaceChildren();
    $("live-lobbies-status").textContent = "Lobby connection closed.";
    $("live-lobbies-reconnect").hidden = false;
  });
}

async function loadPoolEvents(reset = false, mark) {
  if (!account || poolsLoading) return;
  const list = $("live-pools");
  const status = $("live-pools-status");
  const more = $("live-pools-more");
  const refresh = $("live-pools-refresh");
  if (reset) poolsOffset = 0;
  poolsLoading = true;
  more.disabled = refresh.disabled = true;
  status.textContent = "Loading your events…";
  try {
    const query = new URLSearchParams({ players_filter: account.user.username, limit: 15, offset: poolsOffset });
    const page = await cubeRequest(`limited/sessions/?${query}`, undefined, () => mark?.("pools-headers"));
    if (reset) list.replaceChildren();
    for (const session of page.results) {
      const row = document.createElement("div");
      const title = document.createElement("span");
      const date = session.created_at?.slice(0, 10);
      title.textContent = [session.name, session.game_type, date].filter(Boolean).join(" · ");
      const button = document.createElement("button");
      button.textContent = "Open my pool";
      button.setAttribute("aria-label", `Open my pool for ${session.name}`);
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          const event = await cubeRequest(`limited/sessions/${session.id}/`);
          const pool = event.pools.find(({ user }) => user.id === account.user.id);
          if (!pool) throw new Error("Your pool is unavailable for this event.");
          await openLimitedPool(pool.id);
        } catch (error) {
          status.textContent = error.message;
        } finally {
          button.disabled = false;
        }
      });
      row.append(title, button);
      list.append(row);
    }
    poolsOffset += page.results.length;
    more.hidden = !page.next;
    status.textContent = list.children.length ? "" : "No draft or sealed pools found for your account.";
    mark?.("pools-loaded");
  } catch (error) {
    status.textContent = error.message;
  } finally {
    poolsLoading = false;
    more.disabled = refresh.disabled = false;
  }
}

$("live-lobbies-reconnect").addEventListener("click", () => connectLobbies());
liveForm("live-host-form", submitHostedDraft, (message) => { $("live-host-status").textContent = message; });
$("live-host-cancel").addEventListener("click", () => editHostedLobby());
$("live-host-reload").addEventListener("click", () => loadHostCubes(editingLobby ? lobbies.get(editingLobby) : null));
$("live-host-form").addEventListener("input", updateHostValidity);
$("live-host-form").addEventListener("change", (event) => {
  if (event.target.name === "cube") selectHostCube();
  if (event.target.name === "use_time_controls") updateHostTimer();
  updateHostValidity();
});
$("live-pools-refresh").addEventListener("click", () => loadPoolEvents(true));
$("live-pools-more").addEventListener("click", () => loadPoolEvents());

$("live-open").hidden = !liveAvailable;
$("live-open").addEventListener("click", async () => {
  liveDialog.showModal();
  try {
    const info = await cubeRequest("db-info/");
    liveStatus(`${account ? `Signed in as ${account.user.username}. ` : ""}Connected · ${info.last_expansion_name}`);
  } catch (error) {
    liveStatus(error.message);
  }
});
$("live-close").addEventListener("click", () => liveDialog.close());
$("live-demo").addEventListener("click", () => {
  stopDraft();
  chosenCards.clear();
  activeLive = null;
  draft = restore();
  selected = null;
  showPreview(null);
  $("restart").hidden = false;
  $("workspace-label").textContent = "Practice draft";
  liveDialog.close();
  render();
  notice("");
});

const basicNames = new Set(["Plains", "Island", "Swamp", "Mountain", "Forest", "Wastes",
  "Snow-Covered Plains", "Snow-Covered Island", "Snow-Covered Swamp", "Snow-Covered Mountain", "Snow-Covered Forest"]);
const searchDialog = $("search-dialog");
const searchStatus = (message) => { $("search-status").textContent = message; };
let searchRequest = 0;

async function showSearchResults(name, exact = false) {
  const request = ++searchRequest;
  const list = $("live-results");
  list.replaceChildren();
  searchStatus("Searching…");
  const workspace = activeLive;
  const query = name.toLowerCase();
  const practiceResults = workspace ? [] : [
    ...[...practiceBasics].map(([cardId, card]) => ({ name: card.name, cardId })),
    ...cards.map(([name], cardId) => ({ name, cardId })),
  ].filter((card) => exact ? card.name === name : card.name.toLowerCase().includes(query));
  const localBasics = practiceResults.filter(({ cardId }) => practiceBasics.has(cardId));
  let results = practiceResults;
  if (liveAvailable && !localBasics.some(({ name }) => name.toLowerCase() === query)) {
    try {
      const printings = await searchCards(name);
      results = localBasics.concat(printings.filter((card) => !exact || card.name === name)
        .map((card) => ({ ...card, cardId: remotePrinting(card) })));
    } catch (error) {
      if (!practiceResults.length) throw error;
    }
  }
  if (request !== searchRequest || !searchDialog.open || workspace !== activeLive) return;
  for (const printing of results.slice(0, 12)) {
    const row = document.createElement("div");
    const inspect = document.createElement("button");
    inspect.textContent = [printing.name, printing.expansion?.code].filter(Boolean).join(" · ");
    inspect.onclick = () => {
      showPreview(printing.cardId);
      searchDialog.close();
    };
    row.append(inspect);
    const canAddBasic = () => workspace
      ? workspace.allowedBasics.has(printing.name)
      : practiceBasics.has(printing.cardId);
    if (canAddBasic()) {
      const quantity = document.createElement("input");
      quantity.type = "number";
      quantity.min = "1";
      quantity.max = "99";
      quantity.value = "1";
      quantity.setAttribute("aria-label", "Quantity for " + printing.name);
      const add = document.createElement("button");
      add.textContent = "Add to Main deck";
      add.onclick = () => {
        if (workspace !== activeLive || !canAddBasic() || !quantity.checkValidity()) return;
        if (workspace) workspace.addBasic(printing, Number(quantity.value), "main");
        else addPracticeBasics(printing.cardId, Number(quantity.value));
        searchStatus("Added " + quantity.value + " × " + printing.name + ".");
      };
      row.append(quantity, add);
    }
    list.append(row);
  }
  searchStatus(results.length ? "Choose a card to preview it." : "No matching cards.");
}

$("search-open").addEventListener("click", () => {
  const shortcuts = $("basic-shortcuts");
  shortcuts.replaceChildren();
  $("live-results").replaceChildren();
  searchStatus("");
  const allowed = activeLive ? [...activeLive.allowedBasics] : [...practiceBasics.values()].map(({ name }) => name);
  $("basic-status").textContent = allowed.length
    ? "Choose an allowed basic land to add copies."
    : "Basic lands can be added when the active event allows them.";
  for (const name of allowed) {
    const button = document.createElement("button");
    button.textContent = name;
    button.onclick = () => {
      $("live-search").elements.card.value = name;
      void showSearchResults(name, true).catch((error) => searchStatus(error.message));
    };
    shortcuts.append(button);
  }
  searchDialog.showModal();
  $("live-search").elements.card.focus();
});
liveForm("live-search", ({ card }) => showSearchResults(card.trim()), searchStatus);
function signInTiming() {
  if (new URL(location.href || location.origin).searchParams.get("signinTiming") !== "1") return undefined;
  // Mark only fixed stage names. Never attach request URLs, form fields, or responses.
  return (stage) => performance.mark(`workbench-signin:${stage}`);
}

liveForm("live-login", async ({ username, password }) => {
  const mark = signInTiming();
  mark?.("submit");
  try {
    liveStatus("Signing in…");
    account = await cubeRequest("auth/login/", { username, password }, () => mark?.("login-headers"));
    liveStatus(`Signed in as ${account.user.username}.`);
    mark?.("signed-in");
    $("live-login").hidden = true;
    $("live-pools-refresh").hidden = false;
    mark?.("lobbies-start");
    connectLobbies(mark);
    mark?.("pools-start");
    void loadPoolEvents(true, mark);
    if (activeLive?.state.finished && activeLive.poolId) {
      attachPool(activeLive, await cubeRequest(`limited/pools/${activeLive.poolId}/`));
      renderSubmission();
    }
  } finally {
    $("live-login").elements.password.value = "";
  }
});
async function openLimitedPool(id) {
  const pool = await cubeRequest(`limited/pools/${Number(id)}/`);
  stopDraft();
  const workspace = liveWorkspace(`pool-${pool.id}`, true);
  workspace.poolId = pool.id;
  addPrintings(workspace, pool.pool.printings);
  addTraps(workspace, pool.pool.traps);
  if (!workspace.hasSavedLayout) {
    const stack = crypto.randomUUID();
    for (const pick of workspace.state.picks) Object.assign(pick, { cell: 0, stack });
  }
  attachPool(workspace, pool);
  showWorkspace(workspace, pool.session?.name || `Limited pool ${pool.id}`);
  const special = ["tickets", "purples"].some((type) => pool.pool[type]?.length);
  notice(special ? "Loaded printings and traps. Tickets and purples are outside this prototype." : `Loaded ${workspace.state.picks.length} entries from Cubeapp.`);
}
liveForm("live-pool", ({ pool }) => openLimitedPool(pool));
liveForm("live-seat", ({ seat }) => openDraft(seat.trim()));

