# 2syn Privacy Policy

**Last Updated:** May 26, 2026

Welcome to 2syn ("Software" or "We"). This Privacy Policy explains how we collect, use, process, and protect your data. 2syn is a decentralized, high-performance remote desktop solution featuring end-to-end encryption. **We respect your privacy to the highest degree: We DO NOT intercept, store, or analyze your remote desktop screens, audio, or input data.**

## 1. Information We Collect and Its Purpose

To ensure the legitimacy of software licensing and to provide basic connectivity services, we collect only the absolute minimum necessary information:

1. **Hardware ID (HWID)**:
   * **Purpose**: Used for device binding of your Buyout License Key and anti-piracy verification.
   * **Handling**: This code is a one-way hash generated from your local hardware attributes. We cannot reverse-engineer this to determine your real device serial numbers or personal identity. This information is only transmitted during signaling server verification.
2. **Signaling Exchange Data (SDP/ICE Candidates)**:
   * **Purpose**: Exclusively used to help your two devices (Host and Client) traverse firewalls and establish a WebRTC Peer-to-Peer (P2P) connection.
   * **Handling**: This transient network data (including local or public IPs) is instantly destroyed after the connection is established. **Our Signaling Server NEVER logs or persistently stores any network handshake packets.**

## 2. Information We Do NOT Collect

Based on 2syn's End-to-End Encrypted (E2EE) decentralized architecture, we strictly guarantee the following:

1. **Remote Screen & Audio**: Your desktop video, webcam, and system audio are transmitted directly Point-to-Point between your devices. No third party (including us) can intercept or decrypt it.
2. **Keyboard & Mouse Inputs**: All input commands are transmitted locally via P2P.
3. **Personally Identifiable Information (PII)**: We do not require your name, email address, or phone number for you to use our buyout service.

## 3. Data Sharing & Third-Party Disclosure

We **NEVER sell, trade, or rent** your information to third parties.
The only exception: If compelled by law (e.g., a court order), we may legally provide the HWID and license activation logs residing on our authorization server. Please note that we have zero technical ability to provide your remote screen data or transmission content.

## 4. Use of STUN/TURN Relay Servers

To allow devices to traverse complex network environments (e.g., Symmetric NAT), this Software uses public STUN servers by default (e.g., provided by Google) or allows you to configure custom TURN servers. These third-party servers only provide IP resolution and relay encrypted traffic; they cannot decrypt your connection content. Their privacy policies are governed by their respective providers.

## 5. Data Security Measures

We have implemented industry-standard security measures:
* The license verification process uses Ed25519 asymmetric cryptographic signatures.
* End-to-end communication utilizes WebRTC's built-in DTLS/SRTP bank-grade encryption protocols.

## 6. Children's Privacy

Our Software is not designed for children under 13. We do not knowingly collect personal information from children under 13.

## 7. Changes to this Policy

We reserve the right to modify this Privacy Policy at any time. For major changes, we will post announcements within the Software or on our official website. Continued use of the Software implies your acceptance of the updated Privacy Policy.

## 8. Contact Us

If you have any questions regarding this Privacy Policy, please contact us through our official customer support channels.
