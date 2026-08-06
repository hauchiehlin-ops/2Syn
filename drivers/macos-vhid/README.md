# 2syn macOS Virtual HID Input Backend

macOS login-window input requires a DriverKit HID System Extension with Apple
DriverKit entitlements and notarized distribution. The daemon already exposes
the cross-platform login-input contract, but the macOS backend intentionally
returns:

```text
login_input_unsupported|macos_driverkit_hid_backend_required
```

until the signed System Extension is added.

Important constraints:

- FileVault pre-boot login cannot be controlled by 2syn because macOS and the
  daemon are not running yet.
- A DriverKit HID System Extension requires an Apple Developer account with the
  relevant DriverKit/HID entitlements approved by Apple.
- Local development requires Xcode, a provisioning profile, system extension
  approval, and user consent in System Settings.

The Windows implementation in `drivers/windows-vhid` is the reference contract:
the daemon submits keyboard reports through a privileged virtual keyboard
backend after validating the 2syn unattended password.

