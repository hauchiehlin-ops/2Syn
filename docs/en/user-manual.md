# 2syn User Manual

Welcome to **2syn**! 2syn is a high-performance, secure remote desktop system combining WebRTC end-to-end encryption with adaptive bitrate technology, supporting cross-platform connections from macOS/Windows hosts to iOS/macOS clients.

---

## 1. Connection Pairing

### 1.1 Get the Host ID
Launch 2syn on the **host** (the computer to be controlled):
- A 9-digit ID will appear in the「My ID」field at the top of the screen (e.g. `569-639-684`).
- Click the 📋 button next to the ID to copy it, or click the ⬛ button to display a QR code.

### 1.2 Connect from an iOS Device
1. Launch the 2syn app on iOS.
2. Manually enter the host ID in the「Connect to」field, or have the host display the QR code and scan it with the iOS native camera — the ID will be filled in automatically.
3. Tap「Connect」. The system automatically performs NAT traversal via STUN and establishes a direct end-to-end connection — no router Port Forwarding required.

---

## 2. Remote Control

### 2.1 Switching Control Modes
After connecting, tap the ⚙️ toolbar button in the upper right to expand the panel and switch between two control modes:

| Mode | Description |
|---|---|
| **Trackpad** | Drag finger = move cursor; single tap = left click; two-finger scroll = scroll; two-finger tap = right click |
| **Direct Touch** | Touch coordinates map directly to host screen coordinates |

### 2.2 Two-Finger Scroll
In Trackpad mode, slide two fingers up or down on the screen to send scroll events to the host. Works with all applications.

### 2.3 Keyboard Input
1. Tap the keyboard icon in the toolbar to bring up the iOS on-screen keyboard.
2. A modifier key toolbar (Esc, Tab, ⌃, ⌥, ⌘, ⇧, arrow keys) appears above the keyboard for sending keyboard shortcuts.
3. Tap a modifier key once to lock it (lights up blue); it unlocks automatically after one key press. Tap again to unlock manually.

### 2.4 Apple Pencil Pressure Sensing
On an iPad with Apple Pencil support, write directly on the screen with the Pencil. 2syn transmits:
- Pressure value (0–100%)
- Tilt angle (X/Y axis ±90°)

to the host in real time. Professional apps such as Procreate and Adobe Photoshop will receive full pressure and tilt data.

---

## 3. Audio Streaming

The host's system audio (including app sounds, music, etc.) is automatically streamed to your iOS device.

- **No sound on iOS**: Tap the「🔇 Tap to enable audio」button in the upper right (iOS browser security policy requires a user gesture before audio playback).
- After connecting, tap「🔊 Mute」to toggle mute.

---

## 4. Clipboard Sync

- **Host → iOS**: After copying text on the host, a Toast notification appears at the bottom of the iOS screen showing a preview of the copied content. Tap the Toast to write the text to the iOS local clipboard.
- **iOS → Host**: Type in the iOS keyboard, then long-press to paste — the input is sent directly to the focused field on the host.

---

## 5. Display Size

The「🔍 Original Size / Fit Screen」button in the toolbar switches between two display modes:

| Mode | Description |
|---|---|
| **Fit Screen** | Host screen scaled to fill the entire iOS display |
| **Original Size** | 1:1 pixel display with pan support, ideal for precision work |

---

## 6. Adaptive Bitrate (ABR)

2syn has built-in automatic quality adjustment, detecting network RTT and packet loss every 500 ms:

| Network Condition | Automatic Adjustment |
|---|---|
| Good (RTT < 80 ms, loss < 1%) | High quality, high frame rate |
| Fair | Medium quality |
| Poor (RTT > 200 ms or loss > 5%) | Reduced frame rate and bitrate to maintain connection stability |

The dot indicator in the upper right (green / yellow / red) reflects connection quality in real time.

---

## 7. Privacy Screen Mode

Check「Privacy Mode」in the **host** 2syn interface to black out the host screen, preventing bystanders from seeing your operations. Remote control continues to function normally.

---

## 8. File Transfer

When the connection is stable (P2P direct connection), drag files into the 2syn window from either the iOS side or the host side to trigger a transfer. All transfers are end-to-end encrypted via WebRTC Data Channel.

---

## 9. Disconnect and Reconnect

Tap ⚙️ → 「🚪 Sign out」in the toolbar to end the session. If the connection drops unexpectedly, the app will show a prompt — re-enter the ID to reconnect.

---

## 10. FAQ

**Q: The connection is stuck at "Connecting..." and cannot be established?**
A: Both parties being behind strict corporate firewalls (Symmetric NAT) may cause NAT traversal to fail. Try switching one side to a 4G/5G mobile network and retry.

**Q: No audio on iOS?**
A: Tap the「🔇 Tap to enable audio」button on screen. iOS requires a user gesture to unlock audio playback.

**Q: Blurry or laggy video?**
A: Adaptive Bitrate (ABR) automatically adjusts quality based on network conditions. Quality drops to maintain smoothness on poor networks and recovers automatically when the network improves.

**Q: Apple Pencil has no pressure effect?**
A: Ensure 2syn on your iPad is the latest version and that 2syn on the host has been updated to v3.5.11 or later.

**Q: Cannot connect after scanning the QR code?**
A: The QR code only contains the ID. Confirm that 2syn on the host is running and showing the same ID.

---

*2syn v3.5.11 · Support: contact us via App Store reviews or official channels*
