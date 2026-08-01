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

After connecting, a client can use the always-visible Local Files button in the remote screen. This opens the file picker on the client device and sends selected local client files to the host. You can also drop files directly onto the remote screen without leaving the remote session. After one or more files are selected, 2syn first shows a pending transfer list and total size; transfer starts only after pressing Transfer. If a client is already connected to a desktop host, the host app's File Transfer area uses that active session to send files back to the client and does not require a new connection. Desktop apps open the local disk file picker; Web, iOS, and Android use the system or browser file source picker, but 2syn does not limit the picker to cloud drives. Files are sent directly through the active WebRTC Data Channel with end-to-end encryption. They do not pass through a 2syn file server and are not written to a backend database.

Desktop apps save received files to the system Downloads folder under `2syn-transfers` and show the full path in the transfer progress UI. If a file name already exists, 2syn adds suffixes such as `(1)` or `(2)`. Web, iOS, and Android hand the received file to the platform download/files flow.

2syn does not restrict file formats and does not set a hard-coded file count limit; multiple files are sent sequentially. Practical file size limits depend on source-device memory, browser/system file APIs, WebRTC Data Channel stability, and available disk space on the receiver. If a transfer is interrupted and the same file is selected again, both sides negotiate the received offset and resume from that point. Desktop receivers persist progress in `.part` files; Web, iOS, and Android can resume while the same page or app session still retains its temporary transfer data.

### 8.1 Address Book and Saved Passwords

The address book can save a device ID, nickname, and login password for faster future connections. Clicking Connect on an address book entry fills the remote ID and saved password. This data stays in the local browser/app storage on the current device; clear the password field or remove the entry if you do not want the password retained.

My MAC/Wake-on-LAN and local HWID have been removed from the main interface. They are no longer required for normal connections and are not used to limit the free edition.

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
A: Ensure 2syn on your iPad is the latest version and that 2syn on the host has been updated to v4.2.0 or later.

**Q: Cannot connect after scanning the QR code?**
A: The QR code only contains the ID. Confirm that 2syn on the host is running and showing the same ID.

---

*2syn v4.2.0 · Support: contact us via App Store reviews or official channels*
