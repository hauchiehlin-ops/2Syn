import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

type TransferDirection = "send" | "receive";

type TransferMessage =
  | { action: "start"; id?: string; name: string; size: number; fingerprint?: string }
  | { action: "resume"; id?: string; offset: number }
  | { action: "progress"; id?: string; name?: string; received: number; size: number }
  | { action: "end"; id?: string }
  | { action: "complete"; id?: string; name?: string; path?: string; size?: number }
  | { action: "cancel"; id?: string };

type TransferStatus = "preparing" | "transferring" | "complete" | "cancelled" | "failed";

type TransferUiState = {
  id: string;
  name: string;
  direction: TransferDirection;
  transferred: number;
  total: number;
  status: TransferStatus;
  detail?: string;
};

type ReceiveState = {
  id: string;
  name: string;
  size: number;
  fingerprint: string;
  received: number;
  chunks: BlobPart[];
};

type NativeSelectedFile = {
  kind: "native";
  name: string;
  path: string;
  size: number;
  lastModified?: number;
};

type BrowserSelectedFile = {
  kind: "browser";
  file: File;
  name: string;
  size: number;
  lastModified?: number;
};

type PendingSendFile = NativeSelectedFile | BrowserSelectedFile;

const CHUNK_SIZE = 64 * 1024;
const BUFFER_HIGH_WATER = 10 * 1024 * 1024;
const BUFFER_LOW_WATER = 2 * 1024 * 1024;
const TRANSFER_UI_INTERVAL_MS = 120;

let activeSendAbort: AbortController | null = null;
let activeReceive: ReceiveState | null = null;
let latestTransfer: TransferUiState | null = null;
let nativeReceiveListenerInstalled = false;
let activeQueueSending = false;
const pendingSendFiles: PendingSendFile[] = [];
const partialReceives = new Map<string, ReceiveState>();
const pendingResumeResolvers = new Map<string, (offset: number) => void>();
const pendingCompleteResolvers = new Map<string, (message: TransferMessage | null) => void>();
const transferStartedAt = new Map<string, number>();
let transferHideTimer: number | null = null;

export function bindFileTransferChannel(ch: RTCDataChannel) {
  ch.binaryType = "arraybuffer";
  ch.onopen = () => {
    console.log("[file-transfer] DataChannel opened");
    updateTransferUi(null);
  };
  ch.onclose = () => {
    console.log("[file-transfer] DataChannel closed");
    activeSendAbort?.abort();
    activeSendAbort = null;
    if (activeReceive && activeReceive.received < activeReceive.size) {
      rememberPartialReceive(activeReceive);
    }
    activeReceive = null;
    updateTransferUi(latestTransfer ? { ...latestTransfer, status: "cancelled" } : null);
  };
  ch.onerror = (event) => {
    console.warn("[file-transfer] DataChannel error:", event);
    updateTransferUi(latestTransfer ? { ...latestTransfer, status: "failed" } : null);
  };
  ch.onmessage = async (event) => {
    await handleIncomingMessage(event.data, ch);
  };
}

// 處理拖曳上傳至 WebRTC DataChannel
export function setupFileTransferDropZone(getChannel: () => RTCDataChannel | null) {
  setupNativeReceiveListener();

  const dropZone = document.getElementById("file-drop-zone");
  const pickButtons = [
    document.getElementById("btn-pick-transfer-files"),
    document.getElementById("btn-file-transfer-direct"),
  ].filter((el): el is HTMLElement => !!el);
  if (!dropZone && pickButtons.length === 0) return;

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.multiple = true;
  fileInput.accept = "*/*";
  fileInput.style.display = "none";
  document.body.appendChild(fileInput);
  bindQueueActions(getChannel);

  const showZone = () => {
    dropZone?.classList.add("file-drop-zone-active");
    document.body.classList.add("file-transfer-dragging");
  };
  const hideZone = () => {
    dropZone?.classList.remove("file-drop-zone-active");
    document.body.classList.remove("file-transfer-dragging");
  };

  const getOpenChannel = (showNotice = true) => {
    const ch = getChannel();
    if (!ch || ch.readyState !== "open") {
      if (showNotice) {
        showTransferNotice(transferText("file_transfer_not_connected", "Connect to a device first"));
      }
      return null;
    }
    return ch;
  };

  const openPicker = async () => {
    const hasOpenJsChannel = !!getOpenChannel(false);
    const hasNativeChannel = await hasNativeHostFileChannel();
    if (!hasOpenJsChannel && !hasNativeChannel) {
      showTransferNotice(transferText("file_transfer_not_connected", "Connect to a device first"));
      return;
    }
    if (!hasOpenJsChannel && hasNativeChannel && isDesktopTauri()) {
      const picked = await pickNativeTransferFiles();
      if (picked.length > 0) addPendingFiles(picked);
      return;
    }
    setFilePickerActive(true);
    fileInput.click();
  };

  dropZone?.addEventListener("click", openPicker);
  dropZone?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    void openPicker();
  });
  pickButtons.forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      openPicker();
    });
  });

  fileInput.addEventListener("change", async () => {
    if (fileInput.files) {
      addPendingFiles(Array.from(fileInput.files).map(toBrowserSelectedFile));
    }
    fileInput.value = "";
    window.setTimeout(() => setFilePickerActive(false), 1200);
  });
  window.addEventListener("focus", () => {
    window.setTimeout(() => setFilePickerActive(false), 1200);
  });

  let dragCounter = 0;
  window.addEventListener("dragenter", (e) => {
    if (!e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    dragCounter++;
    showZone();
  });
  window.addEventListener("dragleave", (e) => {
    if (!e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      hideZone();
    }
  });
  window.addEventListener("dragover", (e) => {
    if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
  });
  window.addEventListener("drop", async (e) => {
    if (!e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    dragCounter = 0;
    hideZone();

    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    addPendingFiles(Array.from(files).map(toBrowserSelectedFile));
  });
}

function bindQueueActions(getChannel: () => RTCDataChannel | null) {
  document.querySelectorAll<HTMLButtonElement>("[data-transfer-queue-send]").forEach((button) => {
    if (button.dataset.bound === "true") return;
    button.dataset.bound = "true";
    button.addEventListener("click", async () => {
      if (activeQueueSending || pendingSendFiles.length === 0) return;
      activeQueueSending = true;
      updateQueueUi();
      const files = [...pendingSendFiles];
      try {
        const sent = await sendFiles(files, getChannel());
        if (sent) clearPendingFiles();
      } finally {
        activeQueueSending = false;
        updateQueueUi();
      }
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-transfer-queue-clear]").forEach((button) => {
    if (button.dataset.bound === "true") return;
    button.dataset.bound = "true";
    button.addEventListener("click", () => {
      if (activeQueueSending) {
        activeQueueSending = false;
        cancelActiveFileTransfer(getChannel());
      }
      clearPendingFiles();
    });
  });
}

function addPendingFiles(files: PendingSendFile[]) {
  const existing = new Set(pendingSendFiles.map(fileQueueKey));
  files.forEach((file) => {
    const key = fileQueueKey(file);
    if (!existing.has(key)) {
      pendingSendFiles.push(file);
      existing.add(key);
    }
  });
  updateQueueUi();
}

function clearPendingFiles() {
  pendingSendFiles.length = 0;
  updateQueueUi();
}

function removePendingFile(file: PendingSendFile) {
  const key = fileQueueKey(file);
  const index = pendingSendFiles.findIndex((pendingFile) => fileQueueKey(pendingFile) === key);
  if (index >= 0) {
    pendingSendFiles.splice(index, 1);
    updateQueueUi();
  }
}

function updateQueueUi() {
  const queues = Array.from(document.querySelectorAll<HTMLElement>("[data-transfer-queue]"));
  const totalSize = pendingSendFiles.reduce((sum, file) => sum + file.size, 0);
  const title = pendingSendFiles.length === 0
    ? transferText("file_transfer_queue_empty", "No files selected")
    : transferText("file_transfer_queue_count", "{0} file(s) selected").replace("{0}", String(pendingSendFiles.length));

  document.body.classList.toggle("file-transfer-active-queue", pendingSendFiles.length > 0 && activeQueueSending);

  queues.forEach((queue) => {
    queue.style.display = pendingSendFiles.length > 0 ? "flex" : "none";
    const titleEl = queue.querySelector<HTMLElement>("[data-transfer-queue-title]");
    const sizeEl = queue.querySelector<HTMLElement>("[data-transfer-queue-size]");
    const listEl = queue.querySelector<HTMLElement>("[data-transfer-queue-list]");
    const sendButton = queue.querySelector<HTMLButtonElement>("[data-transfer-queue-send]");
    const clearButton = queue.querySelector<HTMLButtonElement>("[data-transfer-queue-clear]");

    if (titleEl) titleEl.textContent = title;
    if (sizeEl) sizeEl.textContent = formatBytes(totalSize);
    if (listEl) {
      listEl.textContent = "";
      pendingSendFiles.slice(0, 6).forEach((file) => {
        const item = document.createElement("li");
        const name = document.createElement("span");
        const size = document.createElement("span");
        name.textContent = file.name;
        size.textContent = formatBytes(file.size);
        item.append(name, size);
        listEl.appendChild(item);
      });
      if (pendingSendFiles.length > 6) {
        const item = document.createElement("li");
        item.textContent = transferText("file_transfer_queue_more", "+ {0} more").replace("{0}", String(pendingSendFiles.length - 6));
        listEl.appendChild(item);
      }
    }
    if (sendButton) {
      sendButton.textContent = activeQueueSending
        ? transferText("file_transfer_sending", "Sending")
        : transferText("file_transfer_send_selected", "Transfer");
      sendButton.disabled = activeQueueSending || pendingSendFiles.length === 0;
    }
    if (clearButton) {
      clearButton.textContent = activeQueueSending
        ? transferText("file_transfer_cancel_selected", "Cancel")
        : transferText("file_transfer_clear_selected", "Clear");
      clearButton.disabled = false;
    }
  });
}

function setupNativeReceiveListener() {
  if (!isDesktopTauri() || nativeReceiveListenerInstalled) return;
  nativeReceiveListenerInstalled = true;

  void listen<{ id?: string; name: string; transferred: number; total: number }>("file-transfer-send-progress", (event) => {
    const payload = event.payload;
    updateTransferUi({
      id: payload.id || `native-send-${payload.name}`,
      name: payload.name,
      direction: "send",
      transferred: payload.transferred || 0,
      total: payload.total || 0,
      status: "transferring",
    });
  }).catch((error) => {
    console.warn("[file-transfer] Native send progress listener failed:", error);
  });

  void listen<{ name: string; path: string; size: number }>("file-transfer-received", (event) => {
    const payload = event.payload;
    updateTransferUi({
      id: `native-receive-${Date.now()}`,
      name: payload.name || sanitizeFileName(payload.path),
      direction: "receive",
      transferred: payload.size || 0,
      total: payload.size || 0,
      status: "complete",
      detail: transferText("file_transfer_saved_to", "Saved to: {0}").replace("{0}", payload.path),
    });
  }).catch((error) => {
    nativeReceiveListenerInstalled = false;
    console.warn("[file-transfer] Native receive listener failed:", error);
  });
}

export function cancelActiveFileTransfer(ch: RTCDataChannel | null) {
  activeSendAbort?.abort();
  activeSendAbort = null;
  if (latestTransfer?.id) {
    pendingCompleteResolvers.get(latestTransfer.id)?.(null);
    pendingCompleteResolvers.delete(latestTransfer.id);
  }
  if (activeReceive) {
    if (ch) sendControlMessage(ch, { action: "cancel", id: activeReceive.id });
    activeReceive = null;
  }
  updateTransferUi(latestTransfer ? { ...latestTransfer, status: "cancelled" } : null);
}

async function sendFiles(files: PendingSendFile[], ch: RTCDataChannel | null) {
  if (ch?.readyState === "open") {
    for (const pending of files) {
      if (pending.kind !== "browser") {
        showTransferNotice(transferText("file_transfer_browser_required", "This connection requires browser-selected files."));
        return false;
      }
      const sent = await sendFile(pending.file, ch);
      if (!sent) return false;
      removePendingFile(pending);
    }
    return true;
  }

  if (isDesktopTauri()) {
    if (!(await hasNativeHostFileChannel())) {
      showTransferNotice(transferText("file_transfer_not_connected", "Connect to a device first"));
      return false;
    }

    for (const pending of files) {
      const sent = pending.kind === "native"
        ? await sendNativePathViaNativeHostChannel(pending)
        : await sendFileViaNativeHostChannel(pending.file);
      if (!sent) return false;
      removePendingFile(pending);
    }
    return true;
  }

  showTransferNotice(transferText("file_transfer_not_connected", "Connect to a device first"));
  return false;
}

function setFilePickerActive(active: boolean) {
  (window as any).__fileTransferPickerActive = active;
}

function toBrowserSelectedFile(file: File): BrowserSelectedFile {
  return {
    kind: "browser",
    file,
    name: file.name,
    size: file.size,
    lastModified: file.lastModified || 0,
  };
}

async function pickNativeTransferFiles() {
  try {
    const files = await invoke<Array<Omit<NativeSelectedFile, "kind">>>("pick_transfer_files");
    return files.map((file) => ({ ...file, kind: "native" as const }));
  } catch (error) {
    console.warn("[file-transfer] Native file picker failed:", error);
    showTransferNotice(`${transferText("file_transfer_failed", "Transfer failed")}: ${String(error)}`);
    return [];
  }
}

function fileQueueKey(file: PendingSendFile) {
  if (file.kind === "native") return `native:${file.path}:${file.size}:${file.lastModified || 0}`;
  return `browser:${file.name}:${file.size}:${file.lastModified || 0}`;
}

async function sendFile(file: File, ch: RTCDataChannel) {
  const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  const fingerprint = fileFingerprint(file);
  const abort = new AbortController();
  activeSendAbort = abort;
  updateTransferUi({
    id,
    name: file.name,
    direction: "send",
    transferred: 0,
    total: file.size,
    status: "preparing",
  });
  console.log(`[file-transfer] Sending file: ${file.name} (${file.size} bytes)`);

  if (!sendControlMessage(ch, { action: "start", id, name: file.name, size: file.size, fingerprint })) {
    updateTransferUi({
      id,
      name: file.name,
      direction: "send",
      transferred: 0,
      total: file.size,
      status: "failed",
      detail: transferText("file_transfer_stalled", "Transfer stalled. Please retry."),
    });
    activeSendAbort = null;
    return false;
  }

  updateTransferUi({
    id,
    name: file.name,
    direction: "send",
    transferred: 0,
    total: file.size,
    status: "preparing",
    detail: transferText("file_transfer_waiting_receiver", "Waiting for receiver..."),
  });
  let offset = await waitForResumeOffset(id, abort.signal);
  offset = Math.min(Math.max(offset, 0), file.size);
  updateTransferUi({
    id,
    name: file.name,
    direction: "send",
    transferred: offset,
    total: file.size,
    status: "transferring",
    detail: offset > 0 ? transferText("file_transfer_resuming", "Resuming transfer") : undefined,
  });
  let lastUiUpdateAt = 0;
  while (offset < file.size) {
    if (abort.signal.aborted) {
      sendControlMessage(ch, { action: "cancel", id });
      return false;
    }

    const chunk = await file.slice(offset, offset + CHUNK_SIZE).arrayBuffer();
    if (ch.readyState !== "open") {
      activeSendAbort = null;
      updateTransferUi({
        id,
        name: file.name,
        direction: "send",
        transferred: offset,
        total: file.size,
        status: "failed",
        detail: transferText("file_transfer_stalled", "Transfer stalled. Please retry."),
      });
      return false;
    }
    try {
      ch.send(chunk);
    } catch (error) {
      console.warn("[file-transfer] Failed to send file chunk:", error);
      activeSendAbort = null;
      updateTransferUi({
        id,
        name: file.name,
        direction: "send",
        transferred: offset,
        total: file.size,
        status: "failed",
        detail: transferText("file_transfer_stalled", "Transfer stalled. Please retry."),
      });
      return false;
    }
    offset += chunk.byteLength;
    const now = Date.now();
    if (now - lastUiUpdateAt >= TRANSFER_UI_INTERVAL_MS || offset >= file.size) {
      lastUiUpdateAt = now;
      updateTransferUi({
        id,
        name: file.name,
        direction: "send",
        transferred: offset,
        total: file.size,
        status: "transferring",
      });
    }

    if (ch.bufferedAmount > BUFFER_HIGH_WATER) {
      const writable = await waitForBufferedAmount(ch, BUFFER_LOW_WATER, abort.signal);
      if (!writable) {
        sendControlMessage(ch, { action: "cancel", id });
        activeSendAbort = null;
        updateTransferUi({
          id,
          name: file.name,
          direction: "send",
          transferred: offset,
          total: file.size,
          status: "failed",
          detail: transferText("file_transfer_stalled", "Transfer stalled. Please retry."),
        });
        return false;
      }
    }
  }

  if (!sendControlMessage(ch, { action: "end", id })) {
    activeSendAbort = null;
    updateTransferUi({
      id,
      name: file.name,
      direction: "send",
      transferred: offset,
      total: file.size,
      status: "failed",
      detail: transferText("file_transfer_stalled", "Transfer stalled. Please retry."),
    });
    return false;
  }
  updateTransferUi({
    id,
    name: file.name,
    direction: "send",
    transferred: file.size,
    total: file.size,
    status: "transferring",
    detail: transferText("file_transfer_waiting_remote_save", "Waiting for remote save..."),
  });
  const complete = await waitForRemoteComplete(id, abort.signal);
  activeSendAbort = null;
  if (!complete) {
    if (abort.signal.aborted) {
      updateTransferUi({
        id,
        name: file.name,
        direction: "send",
        transferred: file.size,
        total: file.size,
        status: "cancelled",
      });
      return false;
    }
    updateTransferUi({
      id,
      name: file.name,
      direction: "send",
      transferred: file.size,
      total: file.size,
      status: "failed",
      detail: transferText("file_transfer_remote_save_timeout", "Remote save was not confirmed. Please check the receiver."),
    });
    return false;
  }
  const completeName = complete.action === "complete" ? complete.name : undefined;
  const completePath = complete.action === "complete" ? complete.path : undefined;
  updateTransferUi({
    id,
    name: sanitizeFileName(completeName || file.name),
    direction: "send",
    transferred: file.size,
    total: file.size,
    status: "complete",
    detail: completePath || transferText("file_transfer_remote_saved", "Remote saved the file"),
  });
  console.log(`[file-transfer] Finished sending file: ${file.name}`);
  return true;
}

async function sendFileViaNativeHostChannel(file: File) {
  const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  updateTransferUi({
    id,
    name: file.name,
    direction: "send",
    transferred: 0,
    total: file.size,
    status: "preparing",
  });

  try {
    const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
    updateTransferUi({
      id,
      name: file.name,
      direction: "send",
      transferred: file.size,
      total: file.size,
      status: "transferring",
    });
    await invoke("send_selected_file_to_client", { name: file.name, bytes });
    updateTransferUi({
      id,
      name: file.name,
      direction: "send",
      transferred: file.size,
      total: file.size,
      status: "complete",
    });
    return true;
  } catch (error) {
    console.warn("[file-transfer] Native host send failed:", error);
    updateTransferUi({
      id,
      name: file.name,
      direction: "send",
      transferred: 0,
      total: file.size,
      status: "failed",
      detail: `${transferText("file_transfer_failed", "Transfer failed")}: ${String(error)}`,
    });
    return false;
  }
}

async function sendNativePathViaNativeHostChannel(file: NativeSelectedFile) {
  const id = `native-path-${Date.now()}-${Math.random()}`;
  updateTransferUi({
    id,
    name: file.name,
    direction: "send",
    transferred: 0,
    total: file.size,
    status: "preparing",
    detail: transferText("file_transfer_native_streaming", "Streaming from disk..."),
  });

  try {
    await invoke("send_file_to_client", { path: file.path });
    updateTransferUi({
      id,
      name: file.name,
      direction: "send",
      transferred: file.size,
      total: file.size,
      status: "complete",
      detail: transferText("file_transfer_remote_saved", "Remote saved the file"),
    });
    return true;
  } catch (error) {
    console.warn("[file-transfer] Native path send failed:", error);
    updateTransferUi({
      id,
      name: file.name,
      direction: "send",
      transferred: 0,
      total: file.size,
      status: "failed",
      detail: `${transferText("file_transfer_failed", "Transfer failed")}: ${String(error)}`,
    });
    return false;
  }
}

async function handleIncomingMessage(data: unknown, ch: RTCDataChannel) {
  if (typeof data === "string" && data.startsWith("{")) {
    await handleControlMessage(JSON.parse(data) as TransferMessage, ch);
    return;
  }

  if (!activeReceive) return;
  const chunk = data instanceof ArrayBuffer
    ? data
    : data instanceof Blob
      ? await data.arrayBuffer()
      : null;
  if (!chunk) return;

  activeReceive.chunks.push(chunk);
  activeReceive.received += chunk.byteLength;
  updateTransferUi({
    id: activeReceive.id,
    name: activeReceive.name,
    direction: "receive",
    transferred: activeReceive.received,
    total: activeReceive.size,
    status: "transferring",
  });
}

async function handleControlMessage(msg: TransferMessage, ch: RTCDataChannel) {
  if (msg.action === "resume") {
    if (msg.id) {
      pendingResumeResolvers.get(msg.id)?.(msg.offset || 0);
      pendingResumeResolvers.delete(msg.id);
    }
    return;
  }

  if (msg.action === "progress") {
    const received = Math.min(Math.max(msg.received || 0, 0), msg.size || 0);
    updateTransferUi({
      id: msg.id || latestTransfer?.id || `remote-progress-${Date.now()}`,
      name: sanitizeFileName(msg.name || latestTransfer?.name || "transfer"),
      direction: "send",
      transferred: received,
      total: msg.size || latestTransfer?.total || received,
      status: "transferring",
      detail: transferText("file_transfer_remote_received", "Remote received {0}").replace("{0}", formatBytes(received)),
    });
    return;
  }

  if (msg.action === "complete") {
    if (msg.id) {
      pendingCompleteResolvers.get(msg.id)?.(msg);
      pendingCompleteResolvers.delete(msg.id);
    }
    updateTransferUi({
      id: msg.id || latestTransfer?.id || `remote-complete-${Date.now()}`,
      name: sanitizeFileName(msg.name || latestTransfer?.name || "transfer"),
      direction: "send",
      transferred: msg.size || latestTransfer?.total || latestTransfer?.transferred || 0,
      total: msg.size || latestTransfer?.total || latestTransfer?.transferred || 0,
      status: "complete",
      detail: msg.path || transferText("file_transfer_remote_saved", "Remote saved the file"),
    });
    return;
  }

  if (msg.action === "start") {
    const fingerprint = msg.fingerprint || `${sanitizeFileName(msg.name)}-${msg.size}`;
    const partial = partialReceives.get(fingerprint);
    activeReceive = {
      id: msg.id || `${Date.now()}`,
      name: sanitizeFileName(msg.name),
      size: msg.size,
      fingerprint,
      received: partial?.size === msg.size ? partial.received : 0,
      chunks: partial?.size === msg.size ? partial.chunks : [],
    };
    ch.send(JSON.stringify({ action: "resume", id: activeReceive.id, offset: activeReceive.received }));
    updateTransferUi({
      id: activeReceive.id,
      name: activeReceive.name,
      direction: "receive",
      transferred: activeReceive.received,
      total: activeReceive.size,
      status: "preparing",
    });
    return;
  }

  if (msg.action === "cancel") {
    activeReceive = null;
    if (msg.id) {
      Array.from(partialReceives.entries()).forEach(([key, receive]) => {
        if (receive.id === msg.id) partialReceives.delete(key);
      });
    }
    updateTransferUi(latestTransfer ? { ...latestTransfer, status: "cancelled" } : null);
    return;
  }

  if (msg.action === "end" && activeReceive) {
    const receive = activeReceive;
    activeReceive = null;
    partialReceives.delete(receive.fingerprint);
    const blob = new Blob(receive.chunks);
    if (receive.size > 0 && blob.size !== receive.size) {
      console.warn(`[file-transfer] Size mismatch for ${receive.name}: ${blob.size}/${receive.size}`);
    }
    const savedDetail = await saveReceivedBlob(blob, receive.name);
    sendControlMessage(ch, {
      action: "complete",
      id: receive.id,
      name: receive.name,
      path: savedDetail,
      size: blob.size,
    });
    updateTransferUi({
      id: receive.id,
      name: receive.name,
      direction: "receive",
      transferred: blob.size,
      total: receive.size,
      status: "complete",
      detail: savedDetail,
    });
  }
}

function waitForResumeOffset(id: string, signal: AbortSignal) {
  return new Promise<number>((resolve) => {
    const timer = window.setTimeout(() => {
      pendingResumeResolvers.delete(id);
      resolve(0);
    }, 1500);

    pendingResumeResolvers.set(id, (offset) => {
      window.clearTimeout(timer);
      resolve(offset);
    });

    if (signal.aborted) {
      window.clearTimeout(timer);
      pendingResumeResolvers.delete(id);
      resolve(0);
    }
  });
}

function waitForRemoteComplete(id: string, signal: AbortSignal) {
  return new Promise<TransferMessage | null>((resolve) => {
    const timer = window.setTimeout(() => {
      pendingCompleteResolvers.delete(id);
      resolve(null);
    }, 120_000);

    pendingCompleteResolvers.set(id, (message) => {
      window.clearTimeout(timer);
      resolve(message);
    });

    if (signal.aborted) {
      window.clearTimeout(timer);
      pendingCompleteResolvers.delete(id);
      resolve(null);
    }
  });
}

function rememberPartialReceive(receive: ReceiveState) {
  partialReceives.set(receive.fingerprint, receive);
  while (partialReceives.size > 8) {
    const oldest = partialReceives.keys().next().value;
    if (!oldest) break;
    partialReceives.delete(oldest);
  }
}

function fileFingerprint(file: File) {
  return sanitizeFileName(`${file.name}-${file.size}-${file.lastModified || 0}`);
}

function sendControlMessage(ch: RTCDataChannel, message: TransferMessage) {
  if (ch.readyState !== "open") return false;
  try {
    ch.send(JSON.stringify(message));
    return true;
  } catch (error) {
    console.warn("[file-transfer] Failed to send control message:", error);
    return false;
  }
}

function waitForBufferedAmount(ch: RTCDataChannel, target: number, signal: AbortSignal) {
  return new Promise<boolean>((resolve) => {
    const startedAt = Date.now();
    const check = () => {
      if (signal.aborted || ch.readyState !== "open" || ch.bufferedAmount < target) {
        resolve(!signal.aborted && ch.readyState === "open");
      } else if (Date.now() - startedAt > 45_000) {
        console.warn(`[file-transfer] DataChannel backpressure timeout: ${ch.bufferedAmount} bytes buffered`);
        resolve(false);
      } else {
        setTimeout(check, 50);
      }
    };
    check();
  });
}

function updateTransferUi(state: TransferUiState | null) {
  if (transferHideTimer !== null) {
    window.clearTimeout(transferHideTimer);
    transferHideTimer = null;
  }
  latestTransfer = state;
  const progressContainers = Array.from(document.querySelectorAll<HTMLElement>("[data-transfer-progress]"));

  if (progressContainers.length === 0) return;
  if (!state) {
    progressContainers.forEach((container) => {
      container.style.display = "none";
    });
    return;
  }

  if (!transferStartedAt.has(state.id)) {
    transferStartedAt.set(state.id, Date.now());
  }
  const pct = state.total > 0 ? Math.min(100, Math.round((state.transferred / state.total) * 100)) : 0;
  const detail = state.detail || transferProgressDetail(state);
  progressContainers.forEach((container) => {
    const filenameEl = container.querySelector<HTMLElement>("[data-transfer-filename]");
    const pctEl = container.querySelector<HTMLElement>("[data-transfer-pct]");
    const barEl = container.querySelector<HTMLElement>("[data-transfer-bar]");
    const detailEl = container.querySelector<HTMLElement>("[data-transfer-detail]");
    const cancelBtn = container.querySelector<HTMLButtonElement>("[data-transfer-cancel]");

    container.style.display = "flex";
    if (filenameEl) {
      const verb = state.direction === "send"
        ? transferText("file_transfer_sending", "Sending")
        : transferText("file_transfer_receiving", "Receiving");
      filenameEl.textContent = `${verb}: ${state.name}`;
    }
    if (pctEl) pctEl.textContent = `${pct}%`;
    if (barEl) barEl.style.width = `${pct}%`;
    if (detailEl) {
      detailEl.textContent = detail;
      detailEl.style.display = detail ? "block" : "none";
    }
    if (cancelBtn) cancelBtn.disabled = state.status === "complete" || state.status === "failed";
  });

  if (state.status === "complete" || state.status === "cancelled" || state.status === "failed") {
    transferHideTimer = window.setTimeout(() => {
      if (latestTransfer?.id === state.id) {
        progressContainers.forEach((container) => {
          container.style.display = "none";
        });
        transferStartedAt.delete(state.id);
        latestTransfer = null;
      }
      transferHideTimer = null;
    }, state.status === "complete" ? 10_000 : state.detail ? 7000 : 2500);
  }
}

function transferProgressDetail(state: TransferUiState) {
  if (state.status !== "transferring" && state.status !== "preparing") return "";
  const startedAt = transferStartedAt.get(state.id) || Date.now();
  const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.1);
  const speed = state.transferred / elapsedSeconds;
  const base = `${formatBytes(state.transferred)} / ${formatBytes(state.total)}`;
  return speed > 0 ? `${base} · ${formatBytes(speed)}/s` : base;
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function saveReceivedBlob(blob: Blob, name: string) {
  if (isDesktopTauri()) {
    try {
      const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
      const path = await invoke<string>("save_received_file", { name, bytes });
      return transferText("file_transfer_saved_to", "Saved to: {0}").replace("{0}", path);
    } catch (error) {
      console.warn("[file-transfer] Native save failed, falling back to browser download:", error);
    }
  }

  downloadBlob(blob, name);
  return transferText("file_transfer_browser_download", "Saved by this device's download flow");
}

function isDesktopTauri() {
  const win = window as any;
  if (typeof win.__TAURI_INTERNALS__?.invoke !== "function") return false;
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod|android/.test(ua)) return false;
  return !(/macintosh/.test(ua) && navigator.maxTouchPoints > 2);
}

async function hasNativeHostFileChannel() {
  if (!isDesktopTauri()) return false;

  try {
    return await invoke<boolean>("has_active_file_transfer_channel");
  } catch (error) {
    console.warn("[file-transfer] Native file channel check failed:", error);
    return false;
  }
}

function sanitizeFileName(name: string) {
  const leaf = name.split(/[\\/]/).pop() || "download.bin";
  const cleaned = leaf.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").trim();
  return cleaned && cleaned !== "." && cleaned !== ".." ? cleaned : "download.bin";
}

function showTransferNotice(message: string) {
  console.warn(`[file-transfer] ${message}`);
  const progressContainers = Array.from(document.querySelectorAll<HTMLElement>("[data-transfer-progress]"));
  progressContainers.forEach((container) => {
    const filenameEl = container.querySelector<HTMLElement>("[data-transfer-filename]");
    const detailEl = container.querySelector<HTMLElement>("[data-transfer-detail]");
    if (filenameEl) filenameEl.textContent = message;
    if (detailEl) detailEl.style.display = "none";
    container.style.display = "flex";
  });
  setTimeout(() => {
    progressContainers.forEach((container) => {
      container.style.display = "none";
    });
  }, 2500);
}

function transferText(key: string, fallback: string) {
  const translate = (window as any).t as ((key: string) => string) | undefined;
  const value = translate?.(key);
  return value && value !== key ? value : fallback;
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}
