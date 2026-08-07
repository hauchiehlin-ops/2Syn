!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Installing 2syn Virtual HID Keyboard driver..."

  SetOutPath "$INSTDIR\driver\2synvhid"
  File "windows\driver\2synvhid.inf"
  File "windows\driver\2synvhid.sys"
  File "windows\driver\2synvhid.cat"

  IfFileExists "$INSTDIR\driver\2synvhid\2synvhid.inf" 0 2syn_vhid_missing
  nsExec::ExecToLog '"$SYSDIR\pnputil.exe" /add-driver "$INSTDIR\driver\2synvhid\2synvhid.inf" /install'
  Pop $0
  StrCmp $0 "0" 2syn_vhid_done

  MessageBox MB_ICONSTOP|MB_OK "2syn was installed, but the Windows lock-screen keyboard driver could not be installed. Please make sure this installer is running as Administrator and the driver package is signed. pnputil exit code: $0"
  Abort

  2syn_vhid_missing:
    MessageBox MB_ICONSTOP|MB_OK "2syn installer is missing the Windows lock-screen keyboard driver files."
    Abort

  2syn_vhid_done:
    DetailPrint "2syn Virtual HID Keyboard driver installed."
!macroend

