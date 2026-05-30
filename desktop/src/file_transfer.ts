// 處理拖曳上傳至 WebRTC DataChannel
export function setupFileTransferDropZone(getChannel: () => RTCDataChannel | null) {
  const dropZone = document.getElementById("file-drop-zone");
  if (!dropZone) return;

  // 監聽全域拖曳，顯示 Drop Zone
  let dragCounter = 0;
  window.addEventListener("dragenter", (e) => {
    e.preventDefault();
    if (e.dataTransfer?.types.includes("Files")) {
      dragCounter++;
      dropZone.style.display = "flex";
    }
  });
  window.addEventListener("dragleave", (e) => {
    e.preventDefault();
    if (e.dataTransfer?.types.includes("Files")) {
      dragCounter--;
      if (dragCounter <= 0) {
        dropZone.style.display = "none";
        dragCounter = 0;
      }
    }
  });
  window.addEventListener("dragover", (e) => {
    e.preventDefault();
  });
  window.addEventListener("drop", async (e) => {
    e.preventDefault();
    dropZone.style.display = "none";
    dragCounter = 0;

    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    const ch = getChannel();
    if (!ch || ch.readyState !== "open") {
      console.warn("File transfer channel is not open");
      return;
    }

    // 依序傳送檔案
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      await sendFile(file, ch);
    }
  });
}

async function sendFile(file: File, ch: RTCDataChannel) {
  console.log(`[file-transfer] Sending file: ${file.name} (${file.size} bytes)`);
  
  // 1. 發送開始訊號
  ch.send(JSON.stringify({
    action: "start",
    name: file.name,
    size: file.size
  }));

  // 2. 切塊讀取並發送
  const chunkSize = 16384; // 16KB per chunk
  const buffer = await file.arrayBuffer();
  let offset = 0;
  
  while (offset < buffer.byteLength) {
    const chunk = buffer.slice(offset, offset + chunkSize);
    ch.send(chunk);
    offset += chunkSize;
    
    // 如果 Buffer 過滿，稍微等待以避免卡死
    if (ch.bufferedAmount > 1024 * 1024 * 10) { // 10MB
      await new Promise<void>(resolve => {
        const check = () => {
          if (ch.bufferedAmount < 1024 * 1024 * 2) resolve();
          else setTimeout(check, 50);
        };
        check();
      });
    }
  }

  // 3. 發送結束訊號
  ch.send(JSON.stringify({
    action: "end"
  }));
  console.log(`[file-transfer] Finished sending file: ${file.name}`);
}
