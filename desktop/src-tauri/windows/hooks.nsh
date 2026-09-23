; 鎖定畫面用的 vhid 驅動為「選配」：
; - 編譯期：tauri 以絕對路徑 !include 本檔，makensis 的工作目錄卻是 target 下的 nsis 輸出資料夾，
;   所以驅動路徑必須用 ${__FILEDIR__}（本檔所在目錄）組出，不能寫相對路徑。
;   必須在 macro 外先展開成 define，macro 展開時 __FILEDIR__ 已不是本檔。
; - 三個檔（inf/sys/cat）都由 scripts/prepare-windows-host-installer.ps1 staged 進來才打包；
;   缺任一個就整段略過（沒裝 WDK 的機器照樣能出安裝檔）。
; - 安裝期：pnputil 失敗（驅動未簽章、非系統管理員）只警告不中止，
;   主程式照常可用，只是鎖定畫面登入無法使用。
!define SYN_VHID_SRC_DIR "${__FILEDIR__}\driver"

!if /FileExists "${SYN_VHID_SRC_DIR}\2synvhid.inf"
  !if /FileExists "${SYN_VHID_SRC_DIR}\2synvhid.sys"
    !if /FileExists "${SYN_VHID_SRC_DIR}\2synvhid.cat"
      !define SYN_VHID_BUNDLED
    !endif
  !endif
!endif

!ifdef SYN_VHID_BUNDLED
  !echo "2syn: bundling Windows lock-screen vhid driver from ${SYN_VHID_SRC_DIR}"
!else
  !echo "2syn: vhid driver files not staged, building installer WITHOUT lock-screen driver"
!endif

!macro NSIS_HOOK_POSTINSTALL
!ifdef SYN_VHID_BUNDLED
  DetailPrint "Installing 2syn Virtual HID Keyboard driver..."

  SetOutPath "$INSTDIR\driver\2synvhid"
  File "${SYN_VHID_SRC_DIR}\2synvhid.inf"
  File "${SYN_VHID_SRC_DIR}\2synvhid.sys"
  File "${SYN_VHID_SRC_DIR}\2synvhid.cat"

  nsExec::ExecToLog '"$SYSDIR\pnputil.exe" /add-driver "$INSTDIR\driver\2synvhid\2synvhid.inf" /install'
  Pop $0
  StrCmp $0 "0" 2syn_vhid_done

  DetailPrint "2syn Virtual HID Keyboard driver install failed (pnputil exit code: $0)."
  MessageBox MB_ICONEXCLAMATION|MB_OK "2syn was installed, but the optional Windows lock-screen keyboard driver could not be installed (pnputil exit code: $0).$\r$\n$\r$\nRemote control works normally; only remote login at the Windows lock screen will be unavailable." /SD IDOK
  Goto 2syn_vhid_end

  2syn_vhid_done:
    DetailPrint "2syn Virtual HID Keyboard driver installed."

  2syn_vhid_end:
!endif
!macroend
