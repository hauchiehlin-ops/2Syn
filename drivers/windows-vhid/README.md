# 2syn Windows Virtual HID Keyboard Driver

This directory contains the Windows login-screen input backend for 2syn.

The driver is a UMDF 2 virtual HID keyboard built on the Windows Virtual HID
Framework (VHF). The daemon submits 8-byte boot-keyboard HID reports through:

```text
\\.\2synvhid
IOCTL_2SYNVHID_SUBMIT_KEYBOARD_REPORT
```

## Build Requirements

- Windows 10/11
- Visual Studio with MSVC
- Windows Driver Kit (WDK)
- Driver signing certificate or Windows test-signing mode

## Build

Open `2synvhid.vcxproj` in Visual Studio or run MSBuild from a WDK developer
prompt:

```powershell
msbuild .\2synvhid.vcxproj /p:Configuration=Release /p:Platform=x64
```

## Install for Development

Use an elevated terminal on a test machine:

```powershell
bcdedit /set testsigning on
pnputil /add-driver .\2synvhid.inf /install
```

Reboot after enabling test-signing.

## Runtime Contract

The 2syn daemon uses this virtual HID path for Windows lock-screen login. If the
device is not installed or rejects an input report, lock-screen password
injection fails and the client receives a `login_result` error. The lock-screen
path must not silently fall back to `SendInput`, because `SendInput` cannot be
treated as a reliable secure-desktop input backend.

The current boot-keyboard report path intentionally supports only stable
alphanumeric credentials (`A-Z`, `a-z`, `0-9`) for Windows lock-screen login.
Punctuation and non-ASCII characters depend on the active Windows keyboard
layout at the secure desktop and are not safe to promise for unattended login.
