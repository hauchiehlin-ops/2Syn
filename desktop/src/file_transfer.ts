import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

type TransferDirection = "send" | "receive";

type TransferMessage =
  | { action: "start"; id?: string; name: string; size: number; fingerprint?: string; protocol?: "offset-v1" }
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
  lastProgressSent: number;
  lastProgressAt: number;
  chunks: Map<number, ArrayBuffer>;
  ranges: Map<number, number>;
  endReceived: boolean;
  finalizing: boolean;
  writeChain: Promise<void>;
  controlChannel: RTCDataChannel;
  sink?: BrowserReceiveSink;
};

type BrowserReceiveSink = {
  write: (offset: number, chunk: ArrayBuffer) => Promise<void>;
  close: () => Promise<string>;
  abort: () => Promise<void>;
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

const MIN_CHUNK_SIZE = 32 * 1024;
const MAX_CHUNK_SIZE = 512 * 1024;
const MOBILE_BUFFER_HIGH_WATER = 256 * 1024;
const MOBILE_BUFFER_LOW_WATER = 64 * 1024;
const TRANSFER_ACK_INTERVAL_BYTES = 64 * 1024;
const TRANSFER_ACK_INTERVAL_MS = 250;
const TRANSFER_MIN_IN_FLIGHT_BYTES = 256 * 1024;
const TRANSFER_MOBILE_MAX_IN_FLIGHT_BYTES = 768 * 1024;
const TRANSFER_DESKTOP_MAX_IN_FLIGHT_BYTES = 2 * 1024 * 1024;
const TRANSFER_UI_INTERVAL_MS = 120;
const CHUNK_GROW_AFTER = 16;
const FRAME_HEADER_BYTES = 16;
const FALLBACK_MAX_MESSAGE_SIZE = 60 * 1024;
const FRAME_MAGIC = 0x3253594e; // "2SYN"

let activeSendAbort: AbortController | null = null;
let activeSendChannel: RTCDataChannel | null = null;
let activeSendDataChannels: RTCDataChannel[] = [];
let activeReceive: ReceiveState | null = null;
let latestTransfer: TransferUiState | null = null;
let nativeReceiveListenerInstalled = false;
let activeQueueSending = false;
let activeTransferRunning = false;
let lastPriorityEventActive = false;
let transferViewportInsetInstalled = false;
const pendingSendFiles: PendingSendFile[] = [];
const partialReceives = new Map<string, ReceiveState>();
const pendingResumeResolvers = new Map<string, (offset: number) => void>();
const pendingCompleteResolvers = new Map<string, (message: TransferMessage | null) => void>();
const remoteProgressOffsets = new Map<string, number>();
const transferStartedAt = new Map<string, number>();
const cancelledTransferIds = new Set<string>();
let transferHideTimer: number | null = null;
let noticeHideTimer: number | null = null;
let channelWaitAbort: AbortController | null = null;
const splitTransferDataChannels = new Set<RTCDataChannel>();

export function bindFileTransferChannel(ch: RTCDataChannel) {
  bindFileTransferControlChannel(ch);
}

export function bindFileTransferControlChannel(ch: RTCDataChannel) {
  ch.binaryType = "arraybuffer";
  ch.bufferedAmountLowThreshold = channelBufferLowWater();
  ch.onopen = () => {
    console.log("[file-transfer] DataChannel opened");
  };
  ch.onclose = () => {
    console.log("[file-transfer] DataChannel closed");
    const interruptedSend = activeSendChannel === ch;
    if (interruptedSend) {
      activeSendAbort?.abort();
      activeSendAbort = null;
      activeSendChannel = null;
      activeSendDataChannels = [];
    }
    const currentTransfer = latestTransfer;
    const interruptedReceive = activeReceive?.controlChannel === ch && activeReceive.received < activeReceive.size;
    if (interruptedReceive && activeReceive?.sink) {
      void activeReceive.sink.abort().catch(() => {});
    } else if (interruptedReceive && activeReceive) {
      rememberPartialReceive(activeReceive);
    }
    if (activeReceive?.controlChannel === ch) activeReceive = null;
    if (currentTransfer && ((interruptedSend && isActiveTransferStatus(currentTransfer.status)) || interruptedReceive)) {
      updateTransferUi({
        ...currentTransfer,
        status: "failed",
        detail: transferText("file_transfer_channel_closed", "File transfer channel closed. Please reconnect and retry."),
      });
    }
  };
  ch.onerror = (event) => {
    console.warn("[file-transfer] DataChannel error:", event);
    if (activeSendChannel === ch && latestTransfer && isActiveTransferStatus(latestTransfer.status)) {
      updateTransferUi({ ...latestTransfer, status: "failed" });
    }
  };
  ch.onmessage = async (event) => {
    await handleIncomingMessage(event.data, ch);
  };
}

export function bindFileTransferDataChannel(ch: RTCDataChannel) {
  ch.binaryType = "arraybuffer";
  ch.bufferedAmountLowThreshold = channelBufferLowWater();
  splitTransferDataChannels.add(ch);
  ch.onclose = () => {
    splitTransferDataChannels.delete(ch);
    if (activeTransferRunning && activeSendDataChannels.includes(ch)) {
      activeSendAbort?.abort();
      window.dispatchEvent(new CustomEvent("file-transfer-channel-reset-needed"));
    }
  };
  ch.onerror = (event) => console.warn("[file-transfer] Data lane error:", event);
  ch.onmessage = async (event) => {
    await handleIncomingData(event.data, ch);
  };
}

// 處理拖曳上傳至 WebRTC DataChannel
export function setupFileTransferDropZone(getChannel: () => RTCDataChannel | null) {
  setupNativeReceiveListener();
  setupTransferViewportInset();

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

  const getUsableChannel = (showNotice = true) => {
    const ch = getChannel();
    if (!ch || ch.readyState === "closing" || ch.readyState === "closed") {
      if (showNotice) {
        showTransferNotice(transferText("file_transfer_not_connected", "Connect to a device first"));
      }
      return null;
    }
    return ch;
  };

  const openPicker = async () => {
    if (activeQueueSending || activeTransferRunning) {
      showTransferNotice(transferText("file_transfer_already_running", "A file transfer is already running."));
      return;
    }

    // Browser and mobile file pickers must open directly from the user's click.
    // Channel readiness is checked when Transfer is pressed, so selecting files
    // remains available while a temporarily interrupted channel recovers.
    if (!isDesktopTauri()) {
      setFilePickerActive(true);
      fileInput.click();
      return;
    }

    const hasOpenJsChannel = !!getUsableChannel(false);
    if (hasOpenJsChannel) {
      // WKWebView/Safari requires the file input to open in the original click gesture.
      setFilePickerActive(true);
      fileInput.click();
      return;
    }

    if (isDesktopTauri() && await hasNativeHostFileChannel()) {
      const picked = await pickNativeTransferFiles();
      if (picked.length > 0) addPendingFiles(picked);
      return;
    }

    showTransferNotice(transferText("file_transfer_not_connected", "Connect to a device first"));
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

function setupTransferViewportInset() {
  if (transferViewportInsetInstalled) return;
  transferViewportInsetInstalled = true;
  const win = window as Window & { visualViewport?: VisualViewport };
  const update = () => {
    const vv = win.visualViewport;
    const bottomInset = vv
      ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      : 0;
    document.documentElement.style.setProperty("--transfer-viewport-bottom", `${Math.ceil(bottomInset)}px`);
  };
  update();
  win.visualViewport?.addEventListener("resize", update);
  win.visualViewport?.addEventListener("scroll", update);
  window.addEventListener("orientationchange", () => window.setTimeout(update, 250));
}

function bindQueueActions(getChannel: () => RTCDataChannel | null) {
  document.querySelectorAll<HTMLButtonElement>("[data-transfer-queue-send]").forEach((button) => {
    if (button.dataset.bound === "true") return;
    button.dataset.bound = "true";
    button.addEventListener("click", async () => {
      if (activeQueueSending || pendingSendFiles.length === 0) return;
      activeQueueSending = true;
      const waitController = new AbortController();
      channelWaitAbort = waitController;
      updateQueueUi();
      const files = [...pendingSendFiles];
      const waitingId = `channel-${Date.now()}`;
      updateTransferUi({
        id: waitingId,
        name: files[0].name,
        direction: "send",
        transferred: 0,
        total: files[0].size,
        status: "preparing",
        detail: transferText("file_transfer_waiting_receiver", "Waiting for receiver..."),
      });
      try {
        const channel = await waitForOpenTransferChannel(getChannel, waitController.signal);
        if (waitController.signal.aborted) return;
        if (!channel) {
          updateTransferUi({
            id: waitingId,
            name: files[0].name,
            direction: "send",
            transferred: 0,
            total: files[0].size,
            status: "failed",
            detail: transferText("file_transfer_not_connected", "Connect to a device first"),
          });
          return;
        }
        transferStartedAt.delete(waitingId);
        const sent = await sendFiles(files, channel, getChannel, waitController.signal);
        if (sent) clearPendingFiles();
      } finally {
        if (channelWaitAbort === waitController) channelWaitAbort = null;
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
    const id = latestTransfer?.direction === "send" && isActiveTransferStatus(latestTransfer.status)
      ? latestTransfer.id
      : payload.id || `native-send-${payload.name}`;
    updateTransferUi({
      id,
      name: payload.name,
      direction: "send",
      transferred: payload.transferred || 0,
      total: payload.total || 0,
      status: "transferring",
      detail: transferText("file_transfer_native_streaming", "Streaming from disk..."),
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
  const shouldResetChannel = !!ch && (activeSendChannel === ch || ch.bufferedAmount > 0);
  if (isDesktopTauri()) {
    void invoke("cancel_active_file_transfer").catch((error) => {
      console.warn("[file-transfer] Native transfer cancel failed:", error);
    });
  }
  channelWaitAbort?.abort();
  channelWaitAbort = null;
  activeSendAbort?.abort();
  activeSendAbort = null;
  activeSendChannel = null;
  activeSendDataChannels = [];
  if (latestTransfer?.id) {
    cancelledTransferIds.add(latestTransfer.id);
    pendingCompleteResolvers.get(latestTransfer.id)?.(null);
    pendingCompleteResolvers.delete(latestTransfer.id);
    pendingResumeResolvers.get(latestTransfer.id)?.(0);
    pendingResumeResolvers.delete(latestTransfer.id);
  }
  if (activeReceive) {
    if (ch) sendControlMessage(ch, { action: "cancel", id: activeReceive.id });
    if (activeReceive.sink) void activeReceive.sink.abort().catch(() => {});
    activeReceive = null;
  }
  resetCongestedFileChannel(ch, shouldResetChannel);
  activeQueueSending = false;
  activeTransferRunning = false;
  emitTransferPriorityState(false);
  updateTransferUi(null);
  updateQueueUi();
}

export function dismissOrCancelFileTransfer(ch: RTCDataChannel | null) {
  if (activeTransferRunning || activeSendAbort || activeReceive) {
    cancelActiveFileTransfer(ch);
    return;
  }
  dismissTransferUi();
}

async function waitForOpenTransferChannel(
  getChannel: () => RTCDataChannel | null,
  signal: AbortSignal,
) {
  const deadline = Date.now() + 15_000;
  while (!signal.aborted && Date.now() < deadline) {
    const channel = getChannel();
    if (channel?.readyState === "open") return channel;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 150));
  }
  return null;
}

async function sendFiles(
  files: PendingSendFile[],
  ch: RTCDataChannel | null,
  getChannel?: () => RTCDataChannel | null,
  signal?: AbortSignal,
) {
  if (ch?.readyState === "open") {
    activeTransferRunning = true;
    try {
      let channel = ch;
      for (const pending of files) {
        if (pending.kind !== "browser") {
          showTransferNotice(transferText("file_transfer_browser_required", "This connection requires browser-selected files."));
          return false;
        }
        let sent = false;
        for (let attempt = 0; attempt < 3 && !sent; attempt++) {
          sent = await sendFile(pending.file, channel);
          if (sent) break;
          if (!getChannel || signal?.aborted || attempt >= 2) return false;

          updateTransferUi({
            id: `reconnect-${Date.now()}`,
            name: pending.name,
            direction: "send",
            transferred: 0,
            total: pending.size,
            status: "preparing",
            detail: transferText("file_transfer_waiting_receiver", "Waiting for receiver..."),
          });
          const recovered = await waitForOpenTransferChannel(getChannel, signal || new AbortController().signal);
          if (!recovered || signal?.aborted) return false;
          channel = recovered;
        }
        if (!sent) return false;
        removePendingFile(pending);
      }
      return true;
    } finally {
      activeTransferRunning = false;
    }
  }

  if (isDesktopTauri()) {
    if (!(await hasNativeHostFileChannel())) {
      resetStaleTransferUi();
      showTransferNotice(transferText("file_transfer_not_connected", "Connect to a device first"));
      return false;
    }

    activeTransferRunning = true;
    try {
      for (const pending of files) {
        const sent = pending.kind === "native"
          ? await sendNativePathViaNativeHostChannel(pending)
          : await sendFileViaNativeHostChannel(pending.file);
        if (!sent) return false;
        removePendingFile(pending);
      }
      return true;
    } finally {
      activeTransferRunning = false;
    }
  }

  resetStaleTransferUi();
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
  cancelledTransferIds.delete(id);
  const fingerprint = fileFingerprint(file);
  const abort = new AbortController();
  activeSendAbort = abort;
  activeSendChannel = ch;
  activeSendDataChannels = [];
  updateTransferUi({
    id,
    name: file.name,
    direction: "send",
    transferred: 0,
    total: file.size,
    status: "preparing",
  });
  console.log(`[file-transfer] Sending file: ${file.name} (${file.size} bytes)`);

  if (!sendControlMessage(ch, { action: "start", id, name: file.name, size: file.size, fingerprint, protocol: "offset-v1" })) {
    updateTransferUi({
      id,
      name: file.name,
      direction: "send",
      transferred: 0,
      total: file.size,
      status: "failed",
      detail: transferText("file_transfer_stalled", "Transfer stalled. Please retry."),
    });
    clearActiveSend(ch);
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
  const dataChannels = transferDataChannels(ch);
  if (dataChannels.length === 0) {
    clearActiveSend(ch);
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
  activeSendDataChannels = dataChannels;
  remoteProgressOffsets.set(id, offset);
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
  const maxChunkSize = maximumChunkPayload(ch);
  let chunkSize = Math.min(initialChunkSize(), maxChunkSize);
  const bufferHighWater = channelBufferHighWater();
  const bufferLowWater = channelBufferLowWater();
  let smoothChunks = 0;
  let adaptiveInFlightBytes = initialTransferInFlightBytes();
  const maxInFlightBytes = maxTransferInFlightBytes();
  let laneIndex = 0;
  while (offset < file.size) {
    if (abort.signal.aborted) {
      sendControlMessage(ch, { action: "cancel", id });
      return false;
    }

    const chunkOffset = offset;
    const chunk = await file.slice(chunkOffset, chunkOffset + chunkSize).arrayBuffer();
    const dataChannel = dataChannels[laneIndex++ % dataChannels.length];
    if (ch.readyState !== "open" || dataChannel.readyState !== "open") {
      clearActiveSend(ch);
      updateTransferUi({
        id,
        name: file.name,
        direction: "send",
        transferred: confirmedTransferOffset(id, file.size),
        total: file.size,
        status: "failed",
        detail: transferText("file_transfer_stalled", "Transfer stalled. Please retry."),
      });
      return false;
    }
    try {
      dataChannel.send(createChunkFrame(chunkOffset, chunk));
    } catch (error) {
      console.warn("[file-transfer] Failed to send file chunk:", error);
      clearActiveSend(ch);
      updateTransferUi({
        id,
        name: file.name,
        direction: "send",
        transferred: confirmedTransferOffset(id, file.size),
        total: file.size,
        status: "failed",
        detail: transferText("file_transfer_stalled", "Transfer stalled. Please retry."),
      });
      return false;
    }
    offset += chunk.byteLength;
    smoothChunks++;
    const now = Date.now();
    if (now - lastUiUpdateAt >= TRANSFER_UI_INTERVAL_MS || offset >= file.size) {
      lastUiUpdateAt = now;
      updateTransferUi({
        id,
        name: file.name,
        direction: "send",
        transferred: confirmedTransferOffset(id, file.size),
        total: file.size,
        status: "transferring",
        detail: transferText("file_transfer_buffered", "{0} queued for network delivery")
          .replace("{0}", formatBytes(Math.max(0, offset - confirmedTransferOffset(id, file.size)))),
      });
    }

    if (dataChannel.bufferedAmount > bufferHighWater) {
      chunkSize = Math.max(MIN_CHUNK_SIZE, Math.floor(chunkSize / 2));
      smoothChunks = 0;
      updateTransferUi({
        id,
        name: file.name,
        direction: "send",
        transferred: confirmedTransferOffset(id, file.size),
        total: file.size,
        status: "transferring",
        detail: transferText("file_transfer_waiting_network", "Waiting for the transfer buffer to drain..."),
      });
      const writable = await waitForBufferedAmount(dataChannel, bufferLowWater, abort.signal, (buffered) => {
        updateTransferUi({
          id,
          name: file.name,
          direction: "send",
          transferred: confirmedTransferOffset(id, file.size),
          total: file.size,
          status: "transferring",
          detail: transferText("file_transfer_buffered", "{0} queued for network delivery").replace("{0}", formatBytes(buffered)),
        });
      });
      if (!writable) {
        if (cancelledTransferIds.has(id)) {
          sendControlMessage(ch, { action: "cancel", id });
        }
        resetCongestedFileChannel(ch, true);
        clearActiveSend(ch);
        if (abort.signal.aborted || cancelledTransferIds.has(id)) return false;
        updateTransferUi({
          id,
          name: file.name,
          direction: "send",
          transferred: confirmedTransferOffset(id, file.size),
          total: file.size,
          status: "failed",
          detail: transferText("file_transfer_stalled", "Transfer stalled. Please retry."),
        });
        return false;
      }
    } else if (smoothChunks >= CHUNK_GROW_AFTER && chunkSize < maxChunkSize) {
      chunkSize = Math.min(maxChunkSize, chunkSize * 2);
      smoothChunks = 0;
    }

    const confirmed = confirmedTransferOffset(id, file.size);
    if (offset - confirmed >= adaptiveInFlightBytes) {
      const target = Math.max(confirmed + TRANSFER_ACK_INTERVAL_BYTES, offset - Math.floor(adaptiveInFlightBytes / 2));
      const progressStartedAt = Date.now();
      const progressed = await waitForRemoteProgress(id, target, abort.signal, file.size, (received) => {
        updateTransferUi({
          id,
          name: file.name,
          direction: "send",
          transferred: received,
          total: file.size,
          status: "transferring",
          detail: transferText("file_transfer_remote_received", "Remote received {0}").replace("{0}", formatBytes(received)),
        });
      });
      if (!progressed) {
        resetCongestedFileChannel(ch, true);
        clearActiveSend(ch);
        if (abort.signal.aborted || cancelledTransferIds.has(id)) return false;
        updateTransferUi({
          id,
          name: file.name,
          direction: "send",
          transferred: confirmedTransferOffset(id, file.size),
          total: file.size,
          status: "failed",
          detail: transferText("file_transfer_stalled", "Transfer stalled. Please retry."),
        });
        return false;
      }
      const progressElapsed = Date.now() - progressStartedAt;
      if (progressElapsed < 350 && adaptiveInFlightBytes < maxInFlightBytes) {
        adaptiveInFlightBytes = Math.min(maxInFlightBytes, adaptiveInFlightBytes + TRANSFER_ACK_INTERVAL_BYTES);
      } else if (progressElapsed > 1500 && adaptiveInFlightBytes > TRANSFER_MIN_IN_FLIGHT_BYTES) {
        adaptiveInFlightBytes = Math.max(TRANSFER_MIN_IN_FLIGHT_BYTES, Math.floor(adaptiveInFlightBytes / 2));
        chunkSize = Math.max(MIN_CHUNK_SIZE, Math.floor(chunkSize / 2));
        smoothChunks = 0;
      }
    }
  }

  if (!sendControlMessage(ch, { action: "end", id })) {
    clearActiveSend(ch);
    updateTransferUi({
      id,
      name: file.name,
      direction: "send",
      transferred: confirmedTransferOffset(id, file.size),
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
    transferred: confirmedTransferOffset(id, file.size),
    total: file.size,
    status: "transferring",
    detail: transferText("file_transfer_waiting_remote_save", "Waiting for remote save..."),
  });
  const complete = await waitForRemoteComplete(id, abort.signal);
  clearActiveSend(ch);
  if (!complete) {
    if (abort.signal.aborted) {
      if (cancelledTransferIds.has(id)) return false;
      updateTransferUi({
        id,
        name: file.name,
        direction: "send",
        transferred: confirmedTransferOffset(id, file.size),
        total: file.size,
        status: "cancelled",
      });
      return false;
    }
    updateTransferUi({
      id,
      name: file.name,
      direction: "send",
      transferred: confirmedTransferOffset(id, file.size),
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
  remoteProgressOffsets.delete(id);
  console.log(`[file-transfer] Finished sending file: ${file.name}`);
  return true;
}

function clearActiveSend(ch: RTCDataChannel) {
  if (activeSendChannel !== ch) return;
  activeSendAbort = null;
  activeSendChannel = null;
  activeSendDataChannels = [];
}

function transferDataChannels(controlChannel: RTCDataChannel) {
  if (controlChannel.label !== "file-transfer-control") {
    return controlChannel.readyState === "open" ? [controlChannel] : [];
  }
  return Array.from(splitTransferDataChannels).filter((channel) => channel.readyState === "open");
}

function confirmedTransferOffset(id: string, total: number) {
  return Math.min(Math.max(remoteProgressOffsets.get(id) || 0, 0), total);
}

function maxTransferInFlightBytes() {
  return isMobileRuntime()
    ? TRANSFER_MOBILE_MAX_IN_FLIGHT_BYTES
    : TRANSFER_DESKTOP_MAX_IN_FLIGHT_BYTES;
}

function initialTransferInFlightBytes() {
  return isMobileRuntime()
    ? TRANSFER_MIN_IN_FLIGHT_BYTES
    : 512 * 1024;
}

function resetCongestedFileChannel(ch: RTCDataChannel | null, force = false) {
  if (!ch || ch.readyState === "closed" || ch.readyState === "closing") return;
  if (force || ch.bufferedAmount > 0 || activeSendChannel === ch) {
    try {
      ch.close();
    } catch (error) {
      console.warn("[file-transfer] Failed to close congested channel:", error);
    }
    window.dispatchEvent(new CustomEvent("file-transfer-channel-reset-needed"));
  }
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

  await handleIncomingData(data, ch);
}

async function handleIncomingData(data: unknown, dataChannel: RTCDataChannel) {
  if (!activeReceive) return;
  const chunk = data instanceof ArrayBuffer
    ? data
    : data instanceof Blob
      ? await data.arrayBuffer()
      : null;
  if (!chunk) return;

  const framed = parseChunkFrame(chunk);
  const payload = framed?.payload || chunk;
  const receive = activeReceive;
  const offset = framed?.offset ?? receive.received;
  receive.writeChain = receive.writeChain.then(async () => {
    if (offset >= receive.size || receive.ranges.has(offset)) return;
    const accepted = payload.slice(0, Math.min(payload.byteLength, receive.size - offset));
    if (accepted.byteLength === 0) return;
    if (receive.sink) {
      await receive.sink.write(offset, accepted);
    } else {
      receive.chunks.set(offset, accepted);
    }
    receive.ranges.set(offset, offset + accepted.byteLength);
    while (receive.ranges.has(receive.received)) {
      receive.received = receive.ranges.get(receive.received)!;
    }
    updateTransferUi({
      id: receive.id,
      name: receive.name,
      direction: "receive",
      transferred: receive.received,
      total: receive.size,
      status: "transferring",
    });
    sendReceiveProgressIfNeeded(receive, receive.controlChannel);
    await finishReceiveIfComplete(receive);
  }).catch((error) => {
    console.warn("[file-transfer] Failed to write received chunk:", error);
    updateTransferUi({
      id: receive.id,
      name: receive.name,
      direction: "receive",
      transferred: receive.received,
      total: receive.size,
      status: "failed",
      detail: transferText("file_transfer_failed", "Transfer failed"),
    });
  });
  await receive.writeChain;
}

async function handleControlMessage(msg: TransferMessage, ch: RTCDataChannel) {
  if (msg.action === "resume") {
    if (msg.id) {
      remoteProgressOffsets.set(msg.id, Math.max(msg.offset || 0, 0));
      pendingResumeResolvers.get(msg.id)?.(msg.offset || 0);
      pendingResumeResolvers.delete(msg.id);
    }
    return;
  }

  if (msg.action === "progress") {
    const received = Math.min(Math.max(msg.received || 0, 0), msg.size || 0);
    if (msg.id) remoteProgressOffsets.set(msg.id, received);
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
    if (msg.id) remoteProgressOffsets.delete(msg.id);
    return;
  }

  if (msg.action === "start") {
    const fingerprint = msg.fingerprint || `${sanitizeFileName(msg.name)}-${msg.size}`;
    const partial = partialReceives.get(fingerprint);
    const sink = !partial ? await createBrowserReceiveSink(sanitizeFileName(msg.name)) : undefined;
    activeReceive = {
      id: msg.id || `${Date.now()}`,
      name: sanitizeFileName(msg.name),
      size: msg.size,
      fingerprint,
      received: partial?.size === msg.size ? partial.received : 0,
      lastProgressSent: partial?.size === msg.size ? partial.received : 0,
      lastProgressAt: 0,
      chunks: partial?.size === msg.size ? partial.chunks : new Map(),
      ranges: partial?.size === msg.size ? partial.ranges : new Map(),
      endReceived: false,
      finalizing: false,
      writeChain: Promise.resolve(),
      controlChannel: ch,
      sink,
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
    if (msg.id) {
      cancelledTransferIds.add(msg.id);
      pendingResumeResolvers.get(msg.id)?.(0);
      pendingResumeResolvers.delete(msg.id);
      pendingCompleteResolvers.get(msg.id)?.(null);
      pendingCompleteResolvers.delete(msg.id);
    }
    if (activeSendAbort && (!msg.id || latestTransfer?.id === msg.id)) {
      activeSendAbort.abort();
      activeSendAbort = null;
      activeSendChannel = null;
      activeSendDataChannels = [];
    }
    if (activeReceive?.sink) {
      await activeReceive.sink.abort().catch(() => {});
    }
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
    receive.endReceived = true;
    await receive.writeChain;
    await finishReceiveIfComplete(receive);
  }
}

async function finishReceiveIfComplete(receive: ReceiveState) {
  if (!receive.endReceived || receive.finalizing || receive.received !== receive.size) return;
  receive.finalizing = true;
  activeReceive = activeReceive === receive ? null : activeReceive;
  partialReceives.delete(receive.fingerprint);
  sendReceiveProgress(receive.controlChannel, receive);
  try {
    let savedDetail: string;
    if (receive.sink) {
      savedDetail = await receive.sink.close();
    } else {
      const orderedChunks = Array.from(receive.chunks.entries())
        .sort(([a], [b]) => a - b)
        .map(([, payload]) => payload);
      savedDetail = await saveReceivedBlob(new Blob(orderedChunks), receive.name);
    }
    sendControlMessage(receive.controlChannel, {
      action: "complete",
      id: receive.id,
      name: receive.name,
      path: savedDetail,
      size: receive.size,
    });
    updateTransferUi({
      id: receive.id,
      name: receive.name,
      direction: "receive",
      transferred: receive.size,
      total: receive.size,
      status: "complete",
      detail: savedDetail,
    });
  } catch (error) {
    console.warn("[file-transfer] Failed to finalize received file:", error);
    updateTransferUi({
      id: receive.id,
      name: receive.name,
      direction: "receive",
      transferred: receive.received,
      total: receive.size,
      status: "failed",
      detail: transferText("file_transfer_failed", "Transfer failed"),
    });
  }
}

function waitForResumeOffset(id: string, signal: AbortSignal) {
  return new Promise<number>((resolve) => {
    let resolved = false;
    let timer = 0;
    const finish = (offset: number) => {
      if (resolved) return;
      resolved = true;
      window.clearTimeout(timer);
      pendingResumeResolvers.delete(id);
      signal.removeEventListener("abort", abort);
      resolve(offset);
    };
    const abort = () => finish(0);
    timer = window.setTimeout(() => finish(0), 30_000);

    pendingResumeResolvers.set(id, (offset) => {
      finish(offset);
    });

    if (signal.aborted) {
      abort();
    } else {
      signal.addEventListener("abort", abort, { once: true });
    }
  });
}

function waitForRemoteComplete(id: string, signal: AbortSignal) {
  return new Promise<TransferMessage | null>((resolve) => {
    let resolved = false;
    let timer = 0;
    const finish = (message: TransferMessage | null) => {
      if (resolved) return;
      resolved = true;
      window.clearTimeout(timer);
      pendingCompleteResolvers.delete(id);
      signal.removeEventListener("abort", abort);
      resolve(message);
    };
    const abort = () => finish(null);
    timer = window.setTimeout(() => finish(null), 120_000);

    pendingCompleteResolvers.set(id, (message) => {
      finish(message);
    });

    if (signal.aborted) {
      abort();
    } else {
      signal.addEventListener("abort", abort, { once: true });
    }
  });
}

function waitForRemoteProgress(
  id: string,
  target: number,
  signal: AbortSignal,
  total: number,
  onWait?: (received: number) => void,
) {
  return new Promise<boolean>((resolve) => {
    const startedAt = Date.now();
    let timer: number | null = null;
    let done = false;
    let lastNoticeAt = 0;
    const finish = (result: boolean) => {
      if (done) return;
      done = true;
      if (timer !== null) window.clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      resolve(result);
    };
    const abort = () => finish(false);
    const check = () => {
      const received = confirmedTransferOffset(id, total);
      if (signal.aborted || cancelledTransferIds.has(id)) {
        finish(false);
      } else if (received >= target || received >= total) {
        finish(true);
      } else if (Date.now() - startedAt > 30_000) {
        console.warn(`[file-transfer] Remote progress timeout: ${received}/${target} bytes confirmed`);
        finish(false);
      } else {
        const now = Date.now();
        if (onWait && now - lastNoticeAt >= 1000) {
          lastNoticeAt = now;
          onWait(received);
        }
        timer = window.setTimeout(check, 100);
      }
    };
    if (signal.aborted) {
      abort();
    } else {
      signal.addEventListener("abort", abort, { once: true });
      check();
    }
  });
}

function sendReceiveProgressIfNeeded(receive: ReceiveState, ch: RTCDataChannel) {
  const now = Date.now();
  if (
    receive.received >= receive.size
    || receive.received - receive.lastProgressSent >= TRANSFER_ACK_INTERVAL_BYTES
    || now - receive.lastProgressAt >= TRANSFER_ACK_INTERVAL_MS
  ) {
    sendReceiveProgress(ch, receive);
  }
}

function sendReceiveProgress(ch: RTCDataChannel, receive: ReceiveState) {
  if (!sendControlMessage(ch, {
    action: "progress",
    id: receive.id,
    name: receive.name,
    received: receive.received,
    size: receive.size,
  })) {
    return;
  }
  receive.lastProgressSent = receive.received;
  receive.lastProgressAt = Date.now();
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

function createChunkFrame(offset: number, payload: ArrayBuffer) {
  const frame = new ArrayBuffer(FRAME_HEADER_BYTES + payload.byteLength);
  const view = new DataView(frame);
  view.setUint32(0, FRAME_MAGIC, false);
  const high = Math.floor(offset / 0x100000000);
  const low = offset >>> 0;
  view.setUint32(4, high, false);
  view.setUint32(8, low, false);
  view.setUint32(12, payload.byteLength, false);
  new Uint8Array(frame, FRAME_HEADER_BYTES).set(new Uint8Array(payload));
  return frame;
}

function parseChunkFrame(frame: ArrayBuffer) {
  if (frame.byteLength < FRAME_HEADER_BYTES) return null;
  const view = new DataView(frame);
  if (view.getUint32(0, false) !== FRAME_MAGIC) return null;
  const high = view.getUint32(4, false);
  const low = view.getUint32(8, false);
  const length = view.getUint32(12, false);
  if (length > frame.byteLength - FRAME_HEADER_BYTES) return null;
  return {
    offset: high * 0x100000000 + low,
    payload: frame.slice(FRAME_HEADER_BYTES, FRAME_HEADER_BYTES + length),
  };
}

function waitForBufferedAmount(ch: RTCDataChannel, target: number, signal: AbortSignal, onWait?: (buffered: number) => void) {
  return new Promise<boolean>((resolve) => {
    const startedAt = Date.now();
    let lastNoticeAt = 0;
    let done = false;
    let timer: number | null = null;
    const previousLowHandler = ch.onbufferedamountlow;
    const finish = (result: boolean) => {
      if (done) return;
      done = true;
      if (timer !== null) window.clearTimeout(timer);
      if (ch.onbufferedamountlow === onLow) {
        ch.onbufferedamountlow = previousLowHandler;
      }
      resolve(result);
    };
    const onLow = (event: Event) => {
      if (typeof previousLowHandler === "function") previousLowHandler.call(ch, event);
      if (ch.bufferedAmount < target) finish(!signal.aborted && ch.readyState === "open");
    };
    ch.bufferedAmountLowThreshold = target;
    ch.onbufferedamountlow = onLow;
    const check = () => {
      if (signal.aborted || ch.readyState !== "open" || ch.bufferedAmount < target) {
        finish(!signal.aborted && ch.readyState === "open");
      } else if (Date.now() - startedAt > 45_000) {
        console.warn(`[file-transfer] DataChannel backpressure timeout: ${ch.bufferedAmount} bytes buffered`);
        finish(false);
      } else {
        const now = Date.now();
        if (onWait && now - lastNoticeAt >= 1000) {
          lastNoticeAt = now;
          onWait(ch.bufferedAmount);
        }
        timer = window.setTimeout(check, 250);
      }
    };
    check();
  });
}

function initialChunkSize() {
  return MIN_CHUNK_SIZE;
}

function maximumChunkPayload(ch: RTCDataChannel) {
  const reported = Number((ch as any).__synMaxMessageSize || 0);
  const negotiatedMax = Number.isFinite(reported) && reported > FRAME_HEADER_BYTES
    ? Math.min(reported, MAX_CHUNK_SIZE + FRAME_HEADER_BYTES)
    : FALLBACK_MAX_MESSAGE_SIZE;
  const maxMessageSize = Math.min(negotiatedMax, FALLBACK_MAX_MESSAGE_SIZE);
  return Math.max(1024, maxMessageSize - FRAME_HEADER_BYTES);
}

function channelBufferHighWater() {
  return MOBILE_BUFFER_HIGH_WATER;
}

function channelBufferLowWater() {
  return MOBILE_BUFFER_LOW_WATER;
}

function updateTransferUi(state: TransferUiState | null) {
  if (transferHideTimer !== null) {
    window.clearTimeout(transferHideTimer);
    transferHideTimer = null;
  }
  if (state && isActiveTransferStatus(state.status)) {
    activeTransferRunning = true;
  } else if (!state || state.status === "complete" || state.status === "cancelled" || state.status === "failed") {
    activeTransferRunning = false;
  }
  emitTransferPriorityState(activeTransferRunning);
  latestTransfer = state;
  const progressContainers = Array.from(document.querySelectorAll<HTMLElement>("[data-transfer-progress]"));

  if (progressContainers.length === 0) return;
  if (!state) {
    progressContainers.forEach((container) => {
      container.style.display = "none";
      delete container.dataset.transferStatus;
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
    const cancelLabel = container.querySelector<HTMLElement>("[data-transfer-cancel-label]");
    const terminal = !isActiveTransferStatus(state.status);

    container.style.display = "flex";
    container.dataset.transferStatus = state.status;
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
    if (cancelBtn) cancelBtn.disabled = false;
    if (cancelLabel) {
      cancelLabel.textContent = terminal
        ? transferText("btn_dismiss", "Dismiss")
        : transferText("btn_cancel_transfer", "Cancel Transfer");
    }
  });

  if (state.status === "complete") {
    transferHideTimer = window.setTimeout(() => {
      if (latestTransfer?.id === state.id) {
        dismissTransferUi();
      }
      transferHideTimer = null;
    }, 30_000);
  }
}

function dismissTransferUi() {
  const transferId = latestTransfer?.id;
  if (transferHideTimer !== null) {
    window.clearTimeout(transferHideTimer);
    transferHideTimer = null;
  }
  if (noticeHideTimer !== null) {
    window.clearTimeout(noticeHideTimer);
    noticeHideTimer = null;
  }
  updateTransferUi(null);
  if (transferId) transferStartedAt.delete(transferId);
}

function emitTransferPriorityState(active: boolean) {
  if (lastPriorityEventActive === active) return;
  lastPriorityEventActive = active;
  window.dispatchEvent(new CustomEvent("file-transfer-priority-change", {
    detail: { active },
  }));
}

function isActiveTransferStatus(status: TransferStatus) {
  return status === "preparing" || status === "transferring";
}

function resetStaleTransferUi() {
  if (activeTransferRunning) return;
  if (transferHideTimer !== null) {
    window.clearTimeout(transferHideTimer);
    transferHideTimer = null;
  }
  latestTransfer = null;
  emitTransferPriorityState(false);
}

function transferProgressDetail(state: TransferUiState) {
  if (state.status !== "transferring" && state.status !== "preparing") return "";
  const startedAt = transferStartedAt.get(state.id) || Date.now();
  const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.1);
  const speed = state.transferred / elapsedSeconds;
  const base = `${formatBytes(state.transferred)} / ${formatBytes(state.total)}`;
  return speed > 0 ? `${base} · ${formatBytes(speed)}/s` : base;
}

async function createBrowserReceiveSink(name: string): Promise<BrowserReceiveSink | undefined> {
  const win = window as any;
  if (isDesktopTauri() || !isDesktopBrowserRuntime() || typeof win.showSaveFilePicker !== "function") {
    return undefined;
  }

  try {
    const handle = await win.showSaveFilePicker({
      suggestedName: sanitizeFileName(name),
    });
    const writable = await handle.createWritable();
    return {
      write: async (offset, chunk) => {
        await writable.write({
          type: "write",
          position: offset,
          data: chunk,
        });
      },
      close: async () => {
        await writable.close();
        return transferText("file_transfer_browser_saved_selected", "Saved to the selected location");
      },
      abort: async () => {
        await writable.abort();
      },
    };
  } catch (error) {
    console.warn("[file-transfer] Browser file sink unavailable, falling back to download flow:", error);
    return undefined;
  }
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
  if (isMobileRuntime()) return false;
  return true;
}

function isMobileRuntime() {
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod|android/.test(ua)) return true;
  return /macintosh/.test(ua) && navigator.maxTouchPoints > 2;
}

function isDesktopBrowserRuntime() {
  if (isMobileRuntime()) return false;
  const ua = navigator.userAgent.toLowerCase();
  return !/mobile/.test(ua);
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
  if (noticeHideTimer !== null) {
    window.clearTimeout(noticeHideTimer);
    noticeHideTimer = null;
  }
  if (latestTransfer && isActiveTransferStatus(latestTransfer.status) && activeTransferRunning) {
    updateTransferUi({ ...latestTransfer, detail: message });
    return;
  }
  resetStaleTransferUi();
  const progressContainers = Array.from(document.querySelectorAll<HTMLElement>("[data-transfer-progress]"));
  progressContainers.forEach((container) => {
    const filenameEl = container.querySelector<HTMLElement>("[data-transfer-filename]");
    const pctEl = container.querySelector<HTMLElement>("[data-transfer-pct]");
    const barEl = container.querySelector<HTMLElement>("[data-transfer-bar]");
    const detailEl = container.querySelector<HTMLElement>("[data-transfer-detail]");
    if (filenameEl) filenameEl.textContent = message;
    if (pctEl) pctEl.textContent = "0%";
    if (barEl) barEl.style.width = "0%";
    if (detailEl) detailEl.style.display = "none";
    container.style.display = "flex";
  });
  noticeHideTimer = window.setTimeout(() => {
    if (activeTransferRunning || latestTransfer) {
      noticeHideTimer = null;
      return;
    }
    progressContainers.forEach((container) => {
      container.style.display = "none";
    });
    noticeHideTimer = null;
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
