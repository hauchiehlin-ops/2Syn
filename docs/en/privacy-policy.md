# 2syn Privacy Policy

**Last Updated:** June 26, 2026

Welcome to **2syn** (hereinafter referred to as "the Software" or "we"). This Privacy Policy explains how the Software collects, uses, and protects your data.

**Core commitment: We do not intercept, store, or analyze any remote desktop screen, audio, or input data.**

---

## 1. Data We Collect and Its Purpose

To provide basic connectivity services, we collect only the following minimum necessary information:

### 1. Signaling Exchange Data (SDP／ICE Candidates)
- **Purpose**: To help your two devices (host and client) traverse firewalls and establish a WebRTC end-to-end (P2P) connection.
- **Handling**: This transient network handshake data (including local or public IPs) is destroyed immediately after the connection is established. **Our signaling server never logs or persistently stores any network handshake packets.**

### 2. App Preferences
- **Purpose**: To store your language settings, display mode, and other preferences for automatic application on the next launch.
- **Handling**: Stored only on your device locally (iOS UserDefaults) and never sent to any server.

---

## 2. Data We Do NOT Collect

Based on 2syn's decentralized E2EE architecture, we strictly guarantee:

1. **Remote screen, video, and audio**: All streams are transmitted end-to-end directly between your two devices. No third party, including us, can intercept or decrypt them.
2. **Keyboard, mouse, and touch input**: All input commands are transmitted locally via P2P and do not pass through any server.
3. **Apple Pencil pressure and tilt data**: Stylus pressure data is transmitted directly between devices and is not retained on any server.
4. **Personally Identifiable Information (PII)**: The Software does not require you to provide your name, email address, or phone number.
5. **Location data**: The Software does not access your GPS or precise location.
6. **Camera or microphone**: The iOS client does not access the camera or microphone.

---

## 3. Data Sharing and Third-Party Disclosure

We **never sell, trade, or rent** any of your information to third parties.

The only exception: When legally compelled (e.g., by a court order), we may lawfully provide the minimal connection logs (connection timestamps) stored on the signaling server. However, we are technically unable to provide your remote screen or transmitted content.

---

## 4. Use of STUN Servers

The Software uses public STUN servers (e.g., those provided by Google) to help devices discover their public IP addresses for NAT traversal. These servers only provide IP resolution and cannot access your connection content. Their privacy policies are governed by their respective providers.

The Software uses a STUN-only architecture and **does not use TURN relay servers by default**. All connections are direct.

---

## 5. Data Security

- End-to-end communication uses WebRTC's built-in DTLS 1.3 / SRTP encryption protocols.
- App preferences are stored in the iOS system sandbox and protected by iOS native security.

---

## 6. Children's Privacy

The Software is designed for users aged 13 and above. We do not knowingly collect personal information from children under 13.

---

## 7. Changes to This Policy

If there are significant changes to this policy, we will post an announcement within the Software or on our official website. Continued use of the Software constitutes your acceptance of the updated policy.

---

## 8. Contact Us

If you have any questions about this Privacy Policy, please contact us via the App Store review page or our official customer support channels.
