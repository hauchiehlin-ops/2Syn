function bindSystemControlChannel(ch: RTCDataChannel) {
  ch.onopen = () => console.log("[DataChannel] system-control 已開啟");
  ch.onclose = () => console.log("[DataChannel] system-control 已關閉");
  ch.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "monitor_list") {
        availableMonitors = msg.monitors;
        currentMonitorIndex = msg.current;
        console.log("[system-control] 收到螢幕清單:", availableMonitors);
        
        const btnSwitchMonitor = document.getElementById("btn-switch-monitor") as HTMLButtonElement;
        if (btnSwitchMonitor && availableMonitors.length > 1) {
          btnSwitchMonitor.style.display = "block";
          btnSwitchMonitor.textContent = `🖥️ ${availableMonitors[currentMonitorIndex].name}`;
        }
      }
    } catch (e) {
      console.error("[system-control] JSON parse error:", e);
    }
  };
}
