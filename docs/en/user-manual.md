# 2syn User Manual

Welcome to 2syn! 2syn is a secure remote desktop control system that combines cross-platform native high-performance with WebRTC End-to-End Encryption. This manual will guide you through the initial setup, device pairing, and advanced performance tuning.

## 1. Quick Start & Device Authorization

### 1.1 Obtain and Enter License Key
2syn utilizes a one-time buyout license mechanism. When you launch the application for the first time, you will be prompted to enter a License Key.
1. Launch the 2syn application (Desktop or Mobile).
2. Enter your key in the input field (For the testing phase, please use: `BUYOUT-KEY-12345`).
3. The system will automatically capture your local Hardware ID (HWID) and complete the binding process with our signaling server. Each key supports up to 5 simultaneous devices.

### 1.2 Cross-Device Pairing
For maximum security, 2syn uses a decentralized P2P architecture. Once both devices are authorized:
1. **Host and Client**: On the "Connect" field, enter the ID of the Host device you want to control.
2. **Automatic NAT Traversal**: The system will automatically use STUN servers to detect public IPs on both ends and establish an End-to-End direct channel. You do NOT need to configure Port Forwarding on your router.

## 2. Interface Operation & Performance Tuning

### 2.1 Smart Optimization
2syn features a built-in AI-level monitoring module. The system automatically detects network Latency (RTT) and Packet Loss every 500 milliseconds:
* **Smooth Network (Latency < 30ms)**: Automatically switches to ultra-high quality (YUV444 lossless color format) and 144 FPS gaming-level refresh rate.
* **Congested Network**: The system dynamically scales down the refresh rate (to 60 or 30 FPS) and switches to the YUV420 compression format to ensure uninterrupted connection and lag-free operation.

### 2.2 Collapsible Advanced Control Panel
To maintain a clean user interface, advanced parameters that affect operation experience are hidden by default in a "Collapsible Panel". Click the gear icon or the "Advanced Settings" button to expand:
* **Color Format**: Manually force YUV444 (High Quality) or YUV420 (Bandwidth Saving).
* **Max Refresh Rate (FPS)**: Cap the frame rate transmission to save battery life.
* **Max Bitrate**: Under mobile networks, you can cap the maximum transmission bandwidth (e.g., 5000 kbps) to prevent data overage.

### 2.3 File Transfer
When the connection quality is stable (P2P mode with low packet loss), the file transfer button unlocks. You can drag and drop or click to transfer files between devices. All transfers are End-to-End Encrypted via WebRTC Data Channels.

## 3. Security & Privacy Features

### 3.1 Privacy Black Screen Mode
When you are remotely controlling your office or home computer, and you do not want the physical monitor to display your actions to bystanders:
1. Click the "Privacy Black Screen" button on the control bar.
2. The system automatically inserts a fully virtual 1080p display via the Virtual Display Driver (IDD) and turns off output to your physical monitor.

## 4. Troubleshooting

**Q: The connection is stuck at "Handshaking SDP/ICE..."?**
A: This usually means both devices are behind a strict firewall (Symmetric NAT), causing P2P hole-punching to fail.
* **Solution**: 2syn supports TURN server relay fallback. In the final production version, the system will automatically downgrade to relay mode. During development, please ensure at least one device is using a less restrictive network (like 4G/5G mobile data or a standard home Wi-Fi).

**Q: I get the error "Maximum authorized devices reached (err_limit_exceeded)"?**
A: Your License Key is already bound to 5 devices.
* **Solution**: Go to a device you no longer use and click "Unbind". Note: Unbinding has a security cooldown period to prevent license abuse.

**Q: The screen looks blurry or the colors are washed out?**
A: The system may have detected network instability and automatically enabled the `YUV420` fallback mode. If you are certain your bandwidth is sufficient, you can go into Advanced Settings and manually force it back to `YUV444`.
