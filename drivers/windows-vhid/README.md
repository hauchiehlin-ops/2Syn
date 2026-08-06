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

The 2syn daemon first tries the virtual HID path. If the device is not installed
or rejects an input report, the daemon falls back to the older SendInput backend
and reports that fallback in `login_result.message`.

