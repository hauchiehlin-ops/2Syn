import { invoke } from "@tauri-apps/api/core";

type TransferDirection = "send" | "receive";

type TransferMessage =
  | { action: "start"; id?: string; name: string; size: number }
  | { action: "end"; id?: string }
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
  received: number;
  chunks: BlobPart[];
};

const CHUNK_SIZE = 16 * 1024;
const BUFFER_HIGH_WATER = 10 * 1024 * 1024;
const BUFFER_LOW_WATER = 2 * 1024 * 1024;

let activeSendAbort: AbortController | null = null;
let activeReceive: ReceiveState | null = null;
let latestTransfer: TransferUiState | null = null;

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
    activeReceive = null;
    updateTransferUi(latestTransfer ? { ...latestTransfer, status: "cancelled" } : null);
  };
  ch.onerror = (event) => {
    console.warn("[file-transfer] DataChannel error:", event);
    updateTransferUi(latestTransfer ? { ...latestTransfer, status: "failed" } : null);
  };
  ch.onmessage = async (event) => {
    await handleIncomingMessage(event.data);
  };
}

// 處理拖曳上傳至 WebRTC DataChannel
export function setupFileTransferDropZone(getChannel: () => RTCDataChannel | null) {
  const dropZone = document.getElementById("file-drop-zone");
  const pickButtons = [
    document.getElementById("btn-pick-transfer-files"),
    document.getElementById("btn-file-transfer-float"),
  ].filter((el): el is HTMLElement => !!el);
  if (!dropZone && pickButtons.length === 0) return;

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.multiple = true;
  fileInput.style.display = "none";
  document.body.appendChild(fileInput);

  const showZone = () => {
    dropZone?.classList.add("file-drop-zone-active");
    document.body.classList.add("file-transfer-dragging");
  };
  const hideZone = () => {
    dropZone?.classList.remove("file-drop-zone-active");
    document.body.classList.remove("file-transfer-dragging");
  };

  const getOpenChannel = () => {
    const ch = getChannel();
    if (!ch || ch.readyState !== "open") {
      showTransferNotice(transferText("file_transfer_not_connected", "Connect to a device first"));
      return null;
    }
    return ch;
  };

  const openPicker = () => {
    if (!getOpenChannel()) return;
    fileInput.click();
  };

  dropZone?.addEventListener("click", openPicker);
  dropZone?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openPicker();
  });
  pickButtons.forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      openPicker();
    });
  });

  fileInput.addEventListener("change", async () => {
    if (fileInput.files) {
      await sendFiles(Array.from(fileInput.files), getOpenChannel());
    }
    fileInput.value = "";
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
    await sendFiles(Array.from(files), getOpenChannel());
  });
}

export function cancelActiveFileTransfer(ch: RTCDataChannel | null) {
  activeSendAbort?.abort();
  activeSendAbort = null;
  if (activeReceive) {
    ch?.send(JSON.stringify({ action: "cancel", id: activeReceive.id }));
    activeReceive = null;
  }
  updateTransferUi(latestTransfer ? { ...latestTransfer, status: "cancelled" } : null);
}

async function sendFiles(files: File[], ch: RTCDataChannel | null) {
  if (!ch || ch.readyState !== "open") {
    showTransferNotice(transferText("file_transfer_not_connected", "Connect to a device first"));
    return;
  }

  for (const file of files) {
    await sendFile(file, ch);
  }
}

async function sendFile(file: File, ch: RTCDataChannel) {
  const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
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

  ch.send(JSON.stringify({ action: "start", id, name: file.name, size: file.size }));

  let offset = 0;
  while (offset < file.size) {
    if (abort.signal.aborted) {
      ch.send(JSON.stringify({ action: "cancel", id }));
      return;
    }

    const chunk = await file.slice(offset, offset + CHUNK_SIZE).arrayBuffer();
    ch.send(chunk);
    offset += chunk.byteLength;
    updateTransferUi({
      id,
      name: file.name,
      direction: "send",
      transferred: offset,
      total: file.size,
      status: "transferring",
    });

    if (ch.bufferedAmount > BUFFER_HIGH_WATER) {
      await waitForBufferedAmount(ch, BUFFER_LOW_WATER, abort.signal);
    }
  }

  ch.send(JSON.stringify({ action: "end", id }));
  activeSendAbort = null;
  updateTransferUi({
    id,
    name: file.name,
    direction: "send",
    transferred: file.size,
    total: file.size,
    status: "complete",
  });
  console.log(`[file-transfer] Finished sending file: ${file.name}`);
}

async function handleIncomingMessage(data: unknown) {
  if (typeof data === "string" && data.startsWith("{")) {
    await handleControlMessage(JSON.parse(data) as TransferMessage);
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

async function handleControlMessage(msg: TransferMessage) {
  if (msg.action === "start") {
    activeReceive = {
      id: msg.id || `${Date.now()}`,
      name: sanitizeFileName(msg.name),
      size: msg.size,
      received: 0,
      chunks: [],
    };
    updateTransferUi({
      id: activeReceive.id,
      name: activeReceive.name,
      direction: "receive",
      transferred: 0,
      total: activeReceive.size,
      status: "preparing",
    });
    return;
  }

  if (msg.action === "cancel") {
    activeReceive = null;
    updateTransferUi(latestTransfer ? { ...latestTransfer, status: "cancelled" } : null);
    return;
  }

  if (msg.action === "end" && activeReceive) {
    const receive = activeReceive;
    activeReceive = null;
    const blob = new Blob(receive.chunks);
    if (receive.size > 0 && blob.size !== receive.size) {
      console.warn(`[file-transfer] Size mismatch for ${receive.name}: ${blob.size}/${receive.size}`);
    }
    const savedDetail = await saveReceivedBlob(blob, receive.name);
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

function waitForBufferedAmount(ch: RTCDataChannel, target: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const check = () => {
      if (signal.aborted || ch.readyState !== "open" || ch.bufferedAmount < target) {
        resolve();
      } else {
        setTimeout(check, 50);
      }
    };
    check();
  });
}

function updateTransferUi(state: TransferUiState | null) {
  latestTransfer = state;
  const progressContainers = Array.from(document.querySelectorAll<HTMLElement>("[data-transfer-progress]"));

  if (progressContainers.length === 0) return;
  if (!state) {
    progressContainers.forEach((container) => {
      container.style.display = "none";
    });
    return;
  }

  const pct = state.total > 0 ? Math.min(100, Math.round((state.transferred / state.total) * 100)) : 0;
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
      detailEl.textContent = state.detail || "";
      detailEl.style.display = state.detail ? "block" : "none";
    }
    if (cancelBtn) cancelBtn.disabled = state.status === "complete" || state.status === "failed";
  });

  if (state.status === "complete" || state.status === "cancelled" || state.status === "failed") {
    setTimeout(() => {
      if (latestTransfer?.id === state.id) {
        progressContainers.forEach((container) => {
          container.style.display = "none";
        });
      }
    }, state.detail ? 7000 : 2500);
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
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod|android/.test(ua)) return false;
  return !(/macintosh/.test(ua) && navigator.maxTouchPoints > 2);
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
