// 11 國語系操作說明與隱私政策專業文檔字典
export const I18N_HELP_DOCS: Record<string, {
  tabControls: string;
  tabPrivacy: string;
  controlsHtml: string;
  privacyHtml: string;
}> = {
  "zh-TW": {
    tabControls: "操作指南",
    tabPrivacy: "隱私政策",
    controlsHtml: `
      <div>
        <h3>觸控模式與手勢操作</h3>
        <ul>
          <li><strong>虛擬軌跡板模式 (Trackpad Mode)</strong>：預設模式。單指滑動控制 Mac 游標移動；單指輕點為左鍵點擊；單指長按 (400ms) 或雙指輕點為右鍵點擊；雙指滑動進行網頁與文件捲動；雙擊並保持後滑動可進行拖曳選取。</li>
          <li><strong>直控模式 (Direct Touch Mode)</strong>：單指直接點選畫面對應位置，支援防手震與延遲拖曳激活，適合高精準度的按鈕點選。</li>
          <li><strong>進階手勢擴充 (Mac Gestures)</strong>：
            <br>• <strong>三指輕點</strong>：一秒啟動 macOS Mission Control (視窗總覽)。
            <br>• <strong>三指左右掃動</strong>：流暢切換不同的 macOS 工作桌面或全螢幕應用程式。
            <br>• 物理確認：觸發進階手勢時伴隨物理震動回饋。
          </li>
        </ul>
      </div>
      <div>
        <h3>虛擬鍵盤輸入</h3>
        <ul>
          <li>連線成功後，點選懸浮轉盤的鍵盤按鈕，即可喚起行動端原生輸入法，支援多國語言增量與組合輸入。</li>
        </ul>
      </div>
      <div>
        <h3>安全連線與無人值守密碼</h3>
        <ul>
          <li><strong>唯一驗證金鑰</strong>：為提升無人值守安全性，本系統已徹底取消隨機 Access PIN 機制。現在統一改以「靜態無人值守密碼 (Static Access Password)」作為唯一的連線驗證金鑰。</li>
          <li><strong>安全保存</strong>：所有設定的無人值守密碼均儲存於系統 Keychain 安全區，並以最高安全層級加密保存，絕不暴露明文。</li>
          <li><strong>明隱碼切換與刪除</strong>：在被控端設定介面中，可隨時點擊 Show/Hide 切換明隱碼，或點擊 Delete 抹除密碼以停止所有遠端存取。</li>
        </ul>
      </div>
      <div>
        <h3>連線前置設定 (Dashboard)</h3>
        <ul><li><strong>Logs (診斷日誌)</strong>：即時開啟遠端主機的系統診斷日誌與網路診斷工具，以便進行連線除錯。</li><li><strong>Quality (畫質變頻)</strong>：切換畫質檔位：
            <br>• <strong>Fluid (流暢)</strong>：限制 120fps (若支援)，YUV 4:2:0，6Mbps 碼率，確保超低延遲。
            <br>• <strong>Retina (清真)</strong>：限制 60fps，YUV 4:4:4 無損色彩，18Mbps 碼率，文字銳利。
            <br>• <strong>Auto (自適應)</strong>：根據真實 RTT 與丟包率無感切換畫質，保證控制流不卡頓。
          </li></ul>
      </div>
      <div>
        <h3>懸浮控制轉盤按鈕說明</h3>
        <ul><li><strong>Display (顯示模式)</strong>：切換「自適應縮放」、「原始比例」與「延展填充」，適配行動裝置無黑邊。</li><li><strong>Audio (音訊轉發)</strong>：預設開啟無損音訊串流，點擊可快速靜音/恢復音訊。</li><li><strong>Monitor (多螢幕切換)</strong>：若遠端主機具備多螢幕環境，點擊按鈕可無縫循環切換目標螢幕。</li><li><strong>Mode (控制模式)</strong>：切換虛擬軌跡板與直控模式，適配不同操控場景。</li><li><strong>Shortcuts (複合快捷鍵)</strong>：快速發送 Ctrl-Alt-Del、Win、Alt-Tab、Ctrl-Esc 等 macOS 系統複合鍵。</li></ul>
      </div>
    `,
    privacyHtml: `
      <div>
        <h3>符合 App Store 審核標準之隱私聲明</h3>
        <p>您的隱私與數據安全是 2syn 最核心的原則。本應用程式符合兩大平台對於遠端控制與安全傳輸的嚴格審核標準。</p>
      </div>
      <div>
        <h3>1. 去中心化 WebRTC P2P 安全傳輸</h3>
        <p>2syn 採用先進的 WebRTC 技術進行點對點直接連線。所有的視訊畫面、音訊串流以及鍵盤滑鼠控制流均經由 DTLS/SRTP 進行 256 位元端到端加密傳輸。所有數據直接在您的主控端與被控端之間傳遞，絕不經過且絕不儲存於任何第三方伺服器。</p>
      </div>
      <div>
        <h3>2. macOS / iOS 系統權限索取與用途</h3>
        <ul>
          <li><strong>螢幕錄製與系統音訊錄製權限</strong>：僅用於在被控端擷取畫面與音訊以進行編碼傳輸。2syn 絕不會在本地或雲端儲存或分析您的任何錄製內容。</li>
          <li><strong>輔助使用權限</strong>：僅用於接收主控端指令後，在 Mac 本地模擬鍵盤與滑鼠的輸入操作，以實現遠端控制功能。</li>
          <li><strong>虛擬顯示器驅動 (IDD)</strong>：用於在連線時動態插入高更新率虛擬螢幕，並在啟用「隱私黑屏」時遮罩實體螢幕，保護現場隱私。</li>
          <li><strong>安全儲存 (Keychain)</strong>：用於以最高安全層級儲存您的授權金鑰與靜態無人值守密碼，防範惡意讀取。</li>
        </ul>
      </div>
      <div>
        <h3>3. 零數據收集與刪除聲明</h3>
        <p>我們實行嚴格的「零數據收集政策 (Zero-Data Policy)」。2syn 不會收集、不會存儲、不會銷售您的任何個人資料、設備特徵、連線歷史或傳輸數據。您在本地安全儲存的任何密碼均可隨時在設定中清除，且卸載應用程式時系統會自動將其完全抹除。</p>
      </div>
    `
  },
  "zh-CN": {
    tabControls: "操作指南",
    tabPrivacy: "隐私政策",
    controlsHtml: `
      <div>
        <h3>触控模式与手势操作</h3>
        <ul>
          <li><strong>虚拟触控板模式 (Trackpad Mode)</strong>：默认模式。单指滑动控制 Mac 光标移动；单指轻点为左键点击；单指长按 (400ms) 或双指轻点为右键点击；双指滑动进行网页与文件滚动；双击并保持后滑动可进行拖拽选取。</li>
          <li><strong>直控模式 (Direct Touch Mode)</strong>：单指直接点击画面对应位置，支持防抖与延迟拖拽激活，适合高精准度的按钮点击。</li>
          <li><strong>进阶手势扩充 (Mac Gestures)</strong>：
            <br>• <strong>三指轻点</strong>：一秒启动 macOS Mission Control (窗口总览)。
            <br>• <strong>三指左右扫动</strong>：流畅切换不同的 macOS 工作桌面或全屏应用程序。
            <br>• 物理确认：触发进阶手势时伴随物理震动反馈。
          </li>
        </ul>
      </div>
      <div>
        <h3>虚拟键盘输入</h3>
        <ul>
          <li>连接成功后，点击悬浮转盘的键盘按钮，即可唤起移动端原生输入法，支持多国语言增量与组合输入。</li>
        </ul>
      </div>
      <div>
        <h3>上方工具栏 (Top Toolbar)</h3>
        <ul>
          <li><strong>Monitor (多屏幕切换)</strong>：若远程主机具备多屏幕环境，点击按钮可无缝循环切换目标屏幕。</li>
          <li><strong>Audio (音频转发)</strong>：默认开启无损音频串流，点击可快速静音/恢复音频。</li>
          <li><strong>Display (显示模式)</strong>：切换“自适应缩放”、“原始比例”与“延展填充”，适配移动设备无黑边。</li>
        </ul>
      </div>
      <div>
        <h3>悬浮控制转盘按钮说明</h3>
        <ul>
          <li><strong>Keyboard (键盘)</strong>：唤起或关闭移动端键盘，用于在远程 Mac 输入文字。</li>
          <li><strong>Mode (控制模式)</strong>：切换虚拟触控板与直控模式，适配不同操控场景。</li>
          <li><strong>Shortcuts (复合快捷键)</strong>：快速发送 Ctrl-Alt-Del、Win、Alt-Tab、Ctrl-Esc 等 macOS 系统复合键。</li>
          <li><strong>Logs (诊断日志)</strong>：即时开启远程主机的系统诊断日志与网络诊断工具，以便进行连接除错。</li>
          <li><strong>Quality (画质变频)</strong>：切换画质档位：
            <br>• <strong>Fluid (流畅)</strong>：限制 120fps (若支持)，YUV 4:2:0，6Mbps 码率，确保超低延迟。
            <br>• <strong>Retina (超清)</strong>：限制 60fps，YUV 4:4:4 无损色彩，18Mbps 码率，文字锐利。
            <br>• <strong>Auto (自适应)</strong>：根据真实 RTT 与丢包率无感切换画质，保证控制流不卡顿。
          </li>
        </ul>
      </div>
    `,
    privacyHtml: `
      <div>
        <h3>符合 App Store 审核标准之隐私声明</h3>
        <p>您的隐私与数据安全是 2syn 最核心的原则。本应用程序符合两大平台对于远程控制与安全传输的严格审核标准。</p>
      </div>
      <div>
        <h3>1. 去中心化 WebRTC P2P 安全传输</h3>
        <p>2syn 采用先进的 WebRTC 技术进行点对点直接连接。所有的视频画面、音频流以及键盘鼠标控制流均经由 DTLS/SRTP 进行 256 位端到端加密传输。所有数据直接在您的主控端与被控端之间传递，绝不经过且绝不存储于任何第三方服务器。</p>
      </div>
      <div>
        <h3>2. macOS / iOS 系统权限索取与用途</h3>
        <ul>
          <li><strong>屏幕录制与系统音频录制权限</strong>：仅用于在被控端截取画面与音频以进行编码传输。2syn 绝不会在本地或云端存储或分析您的任何录制内容。</li>
          <li><strong>辅助使用权限</strong>：仅用于接收主控端指令后，在 Mac 本地模拟键盘与鼠标的输入操作，以实现远程控制功能。</li>
          <li><strong>虚拟显示器驱动 (IDD)</strong>：用于在连接时动态插入高更新率虚拟屏幕，并在启用“隐私黑屏”时遮罩实体屏幕，保护现场隐私。</li>
          <li><strong>安全存储 (Keychain)</strong>：用于以最高安全层级存储您的授权金钥与静态无人值守密码，防范恶意读取。</li>
        </ul>
      </div>
      <div>
        <h3>3. 零数据收集与删除声明</h3>
        <p>我们实行严格的“零数据收集政策 (Zero-Data Policy)”。2syn 不会收集、不会存储、不会销售您的任何个人资料、设备特征、连接历史或传输数据。您在本地安全存储的任何密码均可随时在设置中清除，且卸载应用程序时系统会自动将其完全抹除。</p>
      </div>
    `
  },
  "en": {
    tabControls: "Controls",
    tabPrivacy: "Privacy",
    controlsHtml: `
      <div>
        <h3>Touch Modes &amp; Gestures</h3>
        <ul>
          <li><strong>Trackpad Mode</strong>: Default. One finger to move cursor. Tap to left-click, double-tap to drag. Two fingers to scroll or tap for right-click. Long-press (400ms) with one finger for right-click.</li>
          <li><strong>Direct Touch Mode</strong>: Tap directly on the screen where you want to click. Features anti-tremor and lazy drag activation, ideal for precise button clicks.</li>
          <li><strong>Mac Gestures</strong>:
            <br>• <strong>Three-finger Tap</strong>: Opens macOS Mission Control instantly.
            <br>• <strong>Three-finger Swipe Left/Right</strong>: Smoothly switch between spaces or fullscreen apps.
            <br>• Haptic Feedback: Triggers physical vibration on gesture activation.
          </li>
        </ul>
      </div>
      <div>
        <h3>Virtual Keyboard</h3>
        <ul>
          <li>Once connected, tap the Keyboard icon in the dial to trigger the mobile native keyboard, supporting multi-language input and combinations.</li>
        </ul>
      </div>
      <div>
        <h3>Secure Connection &amp; Unattended Password</h3>
        <ul>
          <li><strong>Exclusive Verification Key</strong>: To upgrade unattended security, the random Access PIN mechanism has been fully deprecated. The "Static Access Password" is now the sole verification key for remote sessions.</li>
          <li><strong>Secure Cryptography</strong>: All passwords are securely encrypted and saved within the system-level Keychain (SecureStorage), ensuring no raw passwords are exposed.</li>
          <li><strong>Visibility &amp; Deletion</strong>: You can toggle the password visibility using the Show/Hide button, or wipe the password completely by clicking Delete to disable all unattended access.</li>
        </ul>
      </div>
      <div>
        <h3>Connection Settings (Dashboard)</h3>
        <ul><li><strong>Logs</strong>: Instantly open the remote system diagnostic log and network diagnostic panel for troubleshooting.</li><li><strong>Quality</strong>: Toggle stream presets:
            <br>• <strong>Fluid</strong>: Limit to 120fps (if supported), YUV 4:2:0, 6Mbps bitrate, prioritizing ultra-low latency.
            <br>• <strong>Retina</strong>: Limit to 60fps, YUV 4:4:4 lossless color, 18Mbps bitrate, rendering razor-sharp text.
            <br>• <strong>Auto</strong>: Automatically switch quality based on physical RTT and packet loss for an uninterrupted control stream.
          </li></ul>
      </div>
      <div>
        <h3>Floating Control Dial Actions</h3>
        <ul><li><strong>Display Mode</strong>: Switch between Fit (adaptive scale), Original ratio, and Fill to eliminate black borders on different screens.</li><li><strong>Audio</strong>: Lossless audio streaming is enabled by default. Click to quickly mute or unmute.</li><li><strong>Monitor</strong>: Cycle seamlessly through target displays if the remote host has a multi-monitor setup.</li><li><strong>Mode</strong>: Toggle between Trackpad and Direct Touch modes based on your workflow.</li><li><strong>Shortcuts</strong>: Send complex macOS system combinations such as Ctrl-Alt-Del, Win, Alt-Tab, and Ctrl-Esc.</li></ul>
      </div>
    `,
    privacyHtml: `
      <div>
        <h3>Privacy Compliance for App Store</h3>
        <p>Your privacy and data security are the core principles of 2syn. This app strictly complies with store guidelines for remote control tools.</p>
      </div>
      <div>
        <h3>1. Decentralized WebRTC P2P Transmission</h3>
        <p>2syn establishes direct peer-to-peer connections using WebRTC. All video streams, audio streams, and keyboard/mouse controls are end-to-end encrypted with 256-bit DTLS/SRTP. Your data flows directly between your host and client, never passing through or stored on any third-party servers.</p>
      </div>
      <div>
        <h3>2. System Permissions & Purposes</h3>
        <ul>
          <li><strong>Screen & System Audio Recording</strong>: Required on the remote host to capture the screen and audio for encoding and transmission. 2syn never records or stores any of your data locally or in the cloud.</li>
          <li><strong>Accessibility</strong>: Required to simulate mouse clicks and keystrokes locally on the Mac to fulfill remote control actions.</li>
          <li><strong>Virtual Display Driver (IDD)</strong>: Dynamically plugs a virtual screen during connections and blanks the physical monitor when Privacy Mode is active.</li>
          <li><strong>Secure Storage (Keychain)</strong>: Saves your license key and static password securely using system-level cryptography.</li>
        </ul>
      </div>
      <div>
        <h3>3. Zero-Data Policy</h3>
        <p>We do not collect, store, or sell any personal data, device characteristics, connection logs, or keystrokes. Any password securely saved locally can be wiped in the settings at any time and is completely deleted when the app is uninstalled.</p>
      </div>
    `
  },
  "ja": {
    tabControls: "操作ガイド",
    tabPrivacy: "プライバシー",
    controlsHtml: `
      <div>
        <h3>タッチモードとジェスチャー</h3>
        <ul>
          <li><strong>トラックパッドモード</strong>：デフォルト。1本指でカーソル移動。タップで左クリック、ダブルタップでドラッグ。2本指タップで右クリック、2本指スワイプでスクロール。</li>
          <li><strong>ダイレクトタッチモード</strong>：画面上のボタンを直接クリック。手ぶれ補正と遅延ドラッグ機能を備え、精密な操作に最適。</li>
          <li><strong>Mac用ジェスチャー</strong>：
            <br>• <strong>3本指タップ</strong>：macOSのMission Controlを起動。
            <br>• <strong>3本指左右スワイプ</strong>：操作スペース（デスクトップ）やフルスクリーンアプリをスムーズに切り替え。
            <br>• 物理フィードバック：ジェスチャー検出時に心地よい振動を提供。
          </li>
        </ul>
      </div>
      <div>
        <h3>仮想キーボード入力</h3>
        <ul>
          <li>接続後、フローティングダイヤルのキーボードボタンをタップすると、モバイル端末の標準キーボードが起動し、複数言語の入力をサポートします。</li>
        </ul>
      </div>
      <div>
        <h3>コントロールダイヤルのボタン機能</h3>
        <ul>
          <li><strong>Keyboard (キーボード)</strong>：リモートのMacに文字を入力するための仮想キーボードを表示/非表示にします。</li>
          <li><strong>Mode (操作モード)</strong>：トラックパッドとダイレクトタッチを切り替えます。</li>
          <li><strong>Display (表示モード)</strong>：Fit（自動フィット）、Original（等倍）、Fill（画面一杯）を切り替えます。</li>
          <li><strong>Shortcuts (ショートカット)</strong>：Ctrl-Alt-Del、Win、Alt-Tab、Ctrl-Escなどの複合キーを瞬時に送信。</li>
          <li><strong>Logs (診断ログ)</strong>：接続トラブルシューティング用のシステム診断およびネットワーク診断パネルを開きます。</li>
          <li><strong>Quality (画質調整)</strong>：
            <br>• <strong>Fluid (流暢)</strong>：最大120fps（サポート時）、YUV 4:2:0、6Mbps、超低遅延を優先。
            <br>• <strong>Retina (高精細)</strong>：最大60fps、無損色YUV 4:4:4、18Mbps、テキストを鮮明に表示。
            <br>• <strong>Auto (自動調整)</strong>：物理的なRTTとパケットロスに基づき、画質をインテリジェントに動的調整します。
          </li>
        </ul>
      </div>
    `,
    privacyHtml: `
      <div>
        <h3>App Store 審査基準適合声明</h3>
        <p>お客様のプライバシーとデータセキュリティは、2synの最優先事項です。本アプリは、遠隔制御ツールに関する両プラットフォームの厳格な審査ガイドラインに完全準拠しています。</p>
      </div>
      <div>
        <h3>1. 分散型 WebRTC P2P 暗号化通信</h3>
        <p>2synは、WebRTCによるピアツーピア直接接続を確立します。すべての画面、音声、およびキーボード/マウスの操作情報は、256ビットのDTLS/SRTPによってエンドツーエンドで暗号化されます。データは端末間で直接送信され、第三者サーバーを経由または保存することは一切ありません。</p>
      </div>
      <div>
        <h3>2. システム権限の要求と用途</h3>
        <ul>
          <li><strong>画面およびシステムオーディオ録画権限</strong>：リモートホストの画面と音声をキャプチャして伝送するために必要です。2synが録画データを保存またはアップロードすることは決してありません。</li>
          <li><strong>アクセシビリティ (補助機能) 権限</strong>：受信したコマンドを元に、Mac上でマウス操作やキーボード入力を模倣し、遠隔制御を実現するために必要です。</li>
          <li><strong>仮想ディスプレイのドライバ (IDD)</strong>：接続時に仮想ディスプレイを挿入し、「プライバシー画面」有効化時に実画面をブラックアウトします。</li>
          <li><strong>セキュアストレージ (Keychain)</strong>：ライセンスキーと自動パスワードをシステム標準の暗号化によって安全に保管します。</li>
        </ul>
      </div>
      <div>
        <h3>3. ゼロデータ収集ポリシー</h3>
        <p>私たちは個人情報、端末情報、接続ログ、またはキー入力を収集、保存、販売しません。ローカルに保存されたパスワードはいつでも設定から消去可能で、アプリ削除時に自動的に完全に抹消されます。</p>
      </div>
    `
  },
  "ko": {
    tabControls: "조작 가이드",
    tabPrivacy: "개인정보",
    controlsHtml: `
      <div>
        <h3>터치 모드 및 제스처</h3>
        <ul>
          <li><strong>트랙패드 모드</strong>: 기본 모드. 한 손가락으로 커서 이동. 한 손가락 탭으로 좌클릭, 더블 탭 후 드래그로 선택. 두 손가락 탭으로 우클릭, 두 손가락 스와이프로 스크롤.</li>
          <li><strong>직접 터치 모드</strong>: 화면의 특정 위치를 직접 터치하여 클릭. 미세 손떨림 방지와 지연 드래그가 적용되어 정밀한 버튼 클릭에 적합합니다.</li>
          <li><strong>Mac 전용 고급 제스처</strong>:
            <br>• <strong>세 손가락 탭</strong>: macOS Mission Control을 즉시 실행합니다.
            <br>• <strong>세 손가락 좌우 스와이프</strong>: 작업 공간(데스크톱) 또는 전체 화면 앱을 부드럽게 전환합니다.
            <br>• 햅틱 피드백: 제스처 인식 시 진동 피드백을 제공합니다.
          </li>
        </ul>
      </div>
      <div>
        <h3>가상 키보드 입력</h3>
        <ul>
          <li>연결 성공 후 플로팅 다이얼의 키보드 아이콘을 탭하면 모바일 네이티브 키보드가 실행되어 다국어 입력 및 조합 키를 지원합니다.</li>
        </ul>
      </div>
      <div>
        <h3>플로팅 다이얼 버튼 기능 설명</h3>
        <ul>
          <li><strong>Keyboard (키보드)</strong>: 원격 Mac에 텍스트를 입력하기 위해 가상 키보드를 열거나 닫습니다.</li>
          <li><strong>Mode (제어 모드)</strong>: 트랙패드와 직접 터치 모드를 즉시 전환합니다.</li>
          <li><strong>Display (화면 비율)</strong>: Fit (자동 피트), Original (원본 비율), Fill (꽉 찬 화면)을 전환하여 디바이스별 레터박스를 해결합니다.</li>
          <li><strong>Shortcuts (단축키)</strong>: Ctrl-Alt-Del, Win, Alt-Tab, Ctrl-Esc 등의 조합 단축키를 즉시 전송합니다.</li>
          <li><strong>Logs (진단 로그)</strong>: 연결 문제를 실시간으로 분석할 수 있는 원격 시스템 진단 및 네트워크 품질 도구를 엽니다.</li>
          <li><strong>Quality (화질 변속)</strong>:
            <br>• <strong>Fluid (부드럽게)</strong>: 최대 120fps(지원 시), YUV 4:2:0, 6Mbps 대역폭 제한으로 초저지연을 보장합니다.
            <br>• <strong>Retina (선명하게)</strong>: 최대 60fps, YUV 4:4:4 무손실 색상, 18Mbps 대역폭 제한으로 텍스트를 칼날처럼 선명하게 표현합니다.
            <br>• <strong>Auto (자동 최적화)</strong>: 실제 RTT 및 패킷 손실률에 따라 화질을 인텔리전트하게 자동 전환하여 부드러운 제어 흐름을 유지합니다.
          </li>
        </ul>
      </div>
    `,
    privacyHtml: `
      <div>
        <h3>App Store 심사 기준 준수 선언</h3>
        <p>고객의 개인정보와 데이터 보안은 2syn의 가장 핵심적인 원칙입니다. 본 앱은 원격 제어 및 보안 전송에 대한 양대 플랫폼의 엄격한 심사 가이드라인을 완벽히 준수합니다.</p>
      </div>
      <div>
        <h3>1. 분산형 WebRTC P2P 암호화 전송</h3>
        <p>2syn은 WebRTC 기술을 활용하여 직접적인 피어 투 피어(P2P) 연결을 수립합니다. 모든 화면 스트리밍, 음성 및 키보드/마우스 제어 신호는 256비트 DTLS/SRTP를 통해 종단간 암호화(E2EE) 처리됩니다. 데이터는 장치 간에 직접 전송되며 제3자 서버에 전달되거나 저장되지 않습니다.</p>
      </div>
      <div>
        <h3>2. 시스템 권한 요구 및 사용 목적</h3>
        <ul>
          <li><strong>화면 및 시스템 오디오 녹화 권한</strong>: 원격 호스트의 화면과 사운드를 캡처하여 스트리밍을 전송하는 데만 사용됩니다. 2syn은 어떠한 데이터도 원격 또는 로컬에 저장하지 않습니다.</li>
          <li><strong>손쉬운 사용 (Accessibility) 권한</strong>: 제어 신호를 수신하여 Mac에서 마우스 움직임과 키보드 입력을 물리적으로 시뮬레이션하기 위해 반드시 필요합니다.</li>
          <li><strong>가상 모니터 드라이버 (IDD)</strong>: 연결 시 가상 디스플레이를 동적으로 생성하며, '프라이버시 모드' 실행 시 실제 모니터 화면을 검게 차단하여 현장 프라이버시를 보호합니다.</li>
          <li><strong>보안 저장소 (Keychain)</strong>: 라이선스 키와 무인 제어 암호 등을 시스템 표준 최고 수준의 암호화 기술로 안전하게 격리 보관합니다.</li>
        </ul>
      </div>
      <div>
        <h3>3. 제로 데이터 수집 정책</h3>
        <p>우리는 개인 정보, 장치 식별 정보, 연결 기록 또는 키 입력을 일절 수집, 저장, 판매하지 않습니다. 로컬에 저장된 모든 암호는 설정에서 언제든지 지울 수 있으며, 앱 삭제 시 장치에서 완전히 지워집니다.</p>
      </div>
    `
  },
  "de": {
    tabControls: "Anleitung",
    tabPrivacy: "Datenschutz",
    controlsHtml: `
      <div>
        <h3>Touch-Modi & Gesten</h3>
        <ul>
          <li><strong>Trackpad-Modus</strong>: Standard. Ein Finger zum Bewegen. Tippen für Linksklick, Doppeltippen zum Ziehen. Zwei Finger zum Scrollen oder Tippen für Rechtsklick.</li>
          <li><strong>Direkt-Touch-Modus</strong>: Tippen Sie direkt auf die Stelle, auf die Sie klicken möchten. Ausgestattet mit Anti-Zittern und verzögerter Drag-Aktivierung.</li>
          <li><strong>Mac-Gesten</strong>:
            <br>• <strong>Drei-Finger-Tippen</strong>: Öffnet macOS Mission Control sofort.
            <br>• <strong>Drei-Finger-Wischen (L/R)</strong>: Wechselt nahtlos zwischen macOS-Spaces oder Vollbild-Apps.
            <br>• Haptik: Erzeugt ein Vibrationsfeedback bei Aktivierung.
          </li>
        </ul>
      </div>
      <div>
        <h3>Virtuelle Tastatur</h3>
        <ul>
          <li>Tippen Sie nach dem Verbinden auf das Tastatursymbol im Dial, um die native mobile Tastatur aufzurufen.</li>
        </ul>
      </div>
      <div>
        <h3>Aktionen des Floating Dials</h3>
        <ul>
          <li><strong>Keyboard</strong>: Tastatur ein-/ausblenden.</li>
          <li><strong>Mode</strong>: Umschalten zwischen Trackpad- und Direkt-Touch-Modus.</li>
          <li><strong>Display</strong>: Umschalten zwischen Fit (Skalieren), Original und Ausfüllen (Fill).</li>
          <li><strong>Shortcuts</strong>: Sendet macOS-Kombinationen wie Ctrl-Alt-Del, Win, Alt-Tab und Ctrl-Esc.</li>
          <li><strong>Logs</strong>: Öffnet die Remotesystemdiagnose für die Fehlersuche.</li>
          <li><strong>Quality (Stream-Qualität)</strong>:
            <br>• <strong>Fluid</strong>: Bis zu 120fps (falls unterstützt), YUV 4:2:0, 6Mbps für extrem niedrige Latenz.
            <br>• <strong>Retina</strong>: Bis zu 60fps, YUV 4:4:4 verlustfreie Farbe, 18Mbps für gestochen scharfen Text.
            <br>• <strong>Auto</strong>: Passt die Qualität basierend auf RTT und Paketverlust automatisch an.
          </li>
        </ul>
      </div>
    `,
    privacyHtml: `
      <div>
        <h3>Datenschutzkonformität für App Store</h3>
        <p>Ihre Privatsphäre und Datensicherheit sind die Grundprinzipien von 2syn. Diese App entspricht vollständig den Richtlinien für Fernsteuerungstools.</p>
      </div>
      <div>
        <h3>1. Dezentrale WebRTC-P2P-Übertragung</h3>
        <p>2syn stellt direkte Peer-to-Peer-Verbindungen über WebRTC her. Alle Videostreams, Audiostreams und Tastatur-/Maussteuerungen sind mit 256-Bit-DTLS/SRTP Ende-zu-Ende verschlüsselt. Ihre Daten fließen direkt zwischen Ihren Geräten und werden niemals auf Servern Dritter gespeichert.</p>
      </div>
      <div>
        <h3>2. Systemberechtigungen & Zwecke</h3>
        <ul>
          <li><strong>Bildschirmaufnahme</strong>: Erforderlich, um den Bildschirm auf dem Remotehost für die Übertragung zu erfassen. 2syn speichert diese Daten niemals lokal oder in der Cloud.</li>
          <li><strong>Bedienungshilfen (Accessibility)</strong>: Erforderlich, um Mausklicks und Tastatureingaben lokal auf dem Mac zu simulieren.</li>
          <li><strong>Virtueller Bildschirmtreiber (IDD)</strong>: Richtet während Verbindungen einen virtuellen Monitor ein und blendet den physischen Bildschirm im Datenschutzmodus aus.</li>
          <li><strong>Sicherer Speicher (Keychain)</strong>: Speichert Lizenzschlüssel und Passwörter sicher mithilfe von Verschlüsselung auf Systemebene.</li>
        </ul>
      </div>
      <div>
        <h3>3. Zero-Data-Richtlinie</h3>
        <p>Wir sammeln, speichern oder verkaufen keine persönlichen Daten, Verbindungsprotokolle oder Tastatureingaben. Lokal gespeicherte Passwörter können jederzeit in den Einstellungen gelöscht werden.</p>
      </div>
    `
  },
  "th": {
    tabControls: "วิธีใช้งาน",
    tabPrivacy: "ความเป็นส่วนตัว",
    controlsHtml: `
      <div>
        <h3>โหมดสัมผัสและท่าทาง</h3>
        <ul>
          <li><strong>โหมดแทร็คแพด</strong>: ค่าเริ่มต้น ใช้หนึ่งนิ้วเพื่อเลื่อนเคอร์เซอร์ แตะเพื่อคลิกซ้าย แตะสองครั้งเพื่อลาก ใช้สองนิ้วแตะเพื่อคลิกขวา หรือสองนิ้วเลื่อนเพื่อสกรอลล์</li>
          <li><strong>โหมดสัมผัสโดยตรง</strong>: แตะตรงจุดที่ต้องการคลิกบนหน้าจอทันที มีระบบป้องกันการสั่นและเปิดใช้งานการลากแบบหน่วงเวลา เหมาะสำหรับการคลิกปุ่มที่ต้องการความแม่นยำสูง</li>
          <li><strong>ท่าทางขั้นสูงสำหรับ Mac</strong>:
            <br>• <strong>แตะด้วยสามนิ้ว</strong>: เปิด macOS Mission Control ทันที
            <br>• <strong>ปัดสามนิ้วไปทางซ้าย/ขวา</strong>: สลับระหว่างหน้าจอเดสก์ท็อปหรือแอปแบบเต็มหน้าจออย่างราบรื่น
            <br>• การตอบสนองด้วยการสั่น: มีการสั่นเมื่อเปิดใช้งานท่าทางสัมผัส
          </li>
        </ul>
      </div>
      <div>
        <h3>การป้อนข้อมูลด้วยคีย์บอร์ดเสมือน</h3>
        <ul>
          <li>เมื่อเชื่อมต่อแล้ว ให้แตะไอคอนคีย์บอร์ดบนแป้นหมุนควบคุมเพื่อเรียกใช้คีย์บอร์ดของมือถือ รองรับการป้อนข้อมูลและการใช้ปุ่มร่วมหลายภาษา</li>
        </ul>
      </div>
      <div>
        <h3>คำอธิบายปุ่มบนแป้นหมุนควบคุม</h3>
        <ul>
          <li><strong>Keyboard</strong>: แสดงหรือซ่อนคีย์บอร์ดเสมือนสำหรับการพิมพ์บน Mac เครื่องปลายทาง</li>
          <li><strong>Mode</strong>: สลับระหว่างโหมดแทร็คแพดและโหมดสัมผัสโดยตรงตามความเหมาะสมของงาน</li>
          <li><strong>Display</strong>: สลับระหว่าง Fit (ปรับขนาดอัตโนมัติ), Original (ขนาดเดิม), และ Fill (เต็มจอ) เพื่อแก้ไขปัญหาขอบดำ</li>
          <li><strong>Shortcuts</strong>: ส่งคีย์ลัดระบบ macOS เช่น Ctrl-Alt-Del, Win, Alt-Tab, และ Ctrl-Esc ทันที</li>
          <li><strong>Logs</strong>: เปิดบันทึกการวินิจฉัยระบบเครื่องปลายทางและเครื่องมือวิเคราะห์คุณภาพเครือข่ายทันที</li>
          <li><strong>Quality</strong>: สลับระดับคุณภาพวิดีโอ:
            <br>• <strong>Fluid</strong>: จำกัดไว้ที่ 120fps (หากรองรับ), YUV 4:2:0, บิตเรต 6Mbps เน้นความหน่วงต่ำเป็นพิเศษ
            <br>• <strong>Retina</strong>: จำกัดไว้ที่ 60fps, YUV 4:4:4 สีที่ไม่สูญเสียคุณภาพ, บิตเรต 18Mbps เพื่อข้อความที่คมชัดสูง
            <br>• <strong>Auto</strong>: ปรับคุณภาพโดยอัตโนมัติตาม RTT และการสูญเสียแพ็กเก็ตจริง เพื่อการควบคุมที่ราบรื่นไม่สะดุด
          </li>
        </ul>
      </div>
    `,
    privacyHtml: `
      <div>
        <h3>การปฏิบัติตามนโยบายความเป็นส่วนตัวสำหรับ App Store</h3>
        <p>ความเป็นส่วนตัวและความปลอดภัยของข้อมูลของคุณคือหลักการสำคัญที่สุดของ 2syn แอปนี้ปฏิบัติตามแนวทางสโตร์สำหรับเครื่องมือควบคุมระยะไกลอย่างเคร่งครัด</p>
      </div>
      <div>
        <h3>1. การรับส่งข้อมูลความปลอดภัยแบบ WebRTC P2P</h3>
        <p>2syn เชื่อมต่อแบบ Peer-to-Peer โดยตรงโดยใช้เทคโนโลยี WebRTC วิดีโอ เสียง และการควบคุมคีย์บอร์ด/เมาส์ทั้งหมดได้รับการเข้ารหัสแบบ End-to-End ด้วย DTLS/SRTP 256 บิต ข้อมูลของคุณจะวิ่งตรงระหว่างอุปกรณ์ของคุณเท่านั้น ไม่ผ่านหรือถูกเก็บไว้บนเซิร์ฟเวอร์บุคคลที่สามใดๆ</p>
      </div>
      <div>
        <h3>2. การขอสิทธิ์เข้าถึงระบบและจุดประสงค์</h3>
        <ul>
          <li><strong>การบันทึกหน้าจอและเสียงระบบ</strong>: จำเป็นต้องใช้บน Mac เครื่องปลายทางเพื่อจับภาพหน้าจอและเสียงเพื่อเข้ารหัสส่งข้อมูล 2syn จะไม่บันทึกหรือเก็บข้อมูลใดๆ ของคุณไว้ในเครื่องหรือบนคลาวด์เด็ดขาด</li>
          <li><strong>การเข้าถึงเพื่ออำนวยความสะดวก (Accessibility)</strong>: จำเป็นต้องใช้เพื่อจำลองการคลิกเมาส์และการกดแป้นพิมพ์บน Mac เพื่อทำตามคำสั่งควบคุมระยะไกล</li>
          <li><strong>ไดรเวอร์จอแสดงผลเสมือน (IDD)</strong>: เพิ่มจอแสดงผลเสมือนระหว่างการเชื่อมต่อ และปิดหน้าจอจริงเมื่อเปิดใช้งานโหมดความเป็นส่วนตัว</li>
          <li><strong>พื้นที่จัดเก็บปลอดภัย (Keychain)</strong>: บันทึกคีย์ใบอนุญาตและรหัสผ่านเข้าถึงอย่างปลอดภัยโดยใช้การเข้ารหัสระดับระบบ</li>
        </ul>
      </div>
      <div>
        <h3>3. นโยบายไม่เก็บข้อมูล (Zero-Data Policy)</h3>
        <p>เราไม่เก็บรวบรวม จัดเก็บ หรือขายข้อมูลส่วนบุคคล บันทึกการเชื่อมต่อ หรือการกดแป้นพิมพ์ใดๆ รหัสผ่านใดๆ ที่บันทึกไว้ในเครื่องสามารถลบออกจากการตั้งค่าได้ตลอดเวลา และจะถูกลบออกอย่างสมบูรณ์เมื่อถอนการติดตั้งแอป</p>
      </div>
    `
  },
  "id": {
    tabControls: "Panduan",
    tabPrivacy: "Privasi",
    controlsHtml: `
      <div>
        <h3>Mode Sentuh & Gerakan</h3>
        <ul>
          <li><strong>Mode Trackpad</strong>: Default. Satu jari untuk menggerakkan kursor. Ketuk untuk klik kiri, ketuk dua kali untuk menyeret. Dua jari untuk menggulir atau ketuk untuk klik kanan.</li>
          <li><strong>Mode Sentuh Langsung</strong>: Ketuk langsung pada layar tempat Anda ingin mengeklik. Dilengkapi dengan peredam tremor dan aktivasi seret tertunda, ideal untuk klik tombol yang presisi.</li>
          <li><strong>Gerakan Mac</strong>:
            <br>• <strong>Ketukan Tiga Jari</strong>: Membuka macOS Mission Control secara instan.
            <br>• <strong>Sapuan Tiga Jari Kiri/Kanan</strong>: Beralih dengan mulus antara ruang macOS atau aplikasi layar penuh.
            <br>• Umpan Balik Haptik: Memicu getaran fisik pada aktivasi gerakan.
          </li>
        </ul>
      </div>
      <div>
        <h3>Keyboard Virtual</h3>
        <ul>
          <li>Setelah terhubung, ketuk ikon Keyboard pada dial untuk memanggil keyboard asli seluler.</li>
        </ul>
      </div>
      <div>
        <h3>Tindakan Tombol Dial</h3>
        <ul>
          <li><strong>Keyboard</strong>: Tampilkan atau sembunyikan keyboard virtual.</li>
          <li><strong>Mode</strong>: Beralih antara mode Trackpad dan Sentuh Langsung.</li>
          <li><strong>Display</strong>: Beralih antara Fit (skala adaptif), Rasio asli, dan Isi (Fill).</li>
          <li><strong>Shortcuts</strong>: Kirim kombinasi tombol macOS seperti Ctrl-Alt-Del, Win, Alt-Tab, dan Ctrl-Esc.</li>
          <li><strong>Logs</strong>: Buka log diagnosis sistem jarak jauh untuk pemecahan masalah.</li>
          <li><strong>Quality (Kualitas Aliran)</strong>:
            <br>• <strong>Fluid</strong>: Batasi hingga 120fps (jika didukung), YUV 4:2:0, bitrate 6Mbps, memprioritaskan latensi sangat rendah.
            <br>• <strong>Retina</strong>: Batasi hingga 60fps, warna tanpa rugi YUV 4:4:4, bitrate 18Mbps, teks tajam.
            <br>• <strong>Auto</strong>: Menyesuaikan kualitas secara otomatis berdasarkan RTT fisik dan kehilangan paket.
          </li>
        </ul>
      </div>
    `,
    privacyHtml: `
      <div>
        <h3>Kepatuhan Privasi untuk App Store</h3>
        <p>Privasi dan keamanan data Anda adalah prinsip utama dari 2syn. Aplikasi ini mematuhi pedoman toko untuk alat kontrol jarak jauh secara ketat.</p>
      </div>
      <div>
        <h3>1. Transmisi P2P WebRTC Terdesentralisasi</h3>
        <p>2syn membuat koneksi peer-to-peer langsung menggunakan WebRTC. Semua aliran video, aliran audio, and kontrol keyboard/mouse dienkripsi end-to-end dengan DTLS/SRTP 256-bit. Data Anda mengalir langsung di antara perangkat Anda, tidak pernah melewati atau disimpan di server pihak ketiga.</p>
      </div>
      <div>
        <h3>2. Izin Sistem & Tujuan</h3>
        <ul>
          <li><strong>Perekaman Layar</strong>: Diperlukan pada host jarak jauh untuk menangkap layar untuk transmisi. 2syn tidak pernah menyimpan data ini secara lokal atau di cloud.</li>
          <li><strong>Aksesibilitas (Accessibility)</strong>: Diperlukan untuk mensimulasikan klik mouse dan keystroke secara lokal pada Mac.</li>
          <li><strong>Driver Tampilan Virtual (IDD)</strong>: Memasang monitor virtual secara dinamis selama koneksi dan mematikan layar fisik dalam Mode Privasi.</li>
          <li><strong>Penyimpanan Aman (Keychain)</strong>: Menyimpan kunci lisensi dan kata sandi dengan aman menggunakan kriptografi tingkat sistem.</li>
        </ul>
      </div>
      <div>
        <h3>3. Kebijakan Tanpa Data</h3>
        <p>Kami tidak mengumpulkan, menyimpan, atau menjual data pribadi, log koneksi, atau penekanan tombol. Sandi yang disimpan secara lokal dapat dihapus di pengaturan kapan saja.</p>
      </div>
    `
  },
  "ms": {
    tabControls: "Panduan",
    tabPrivacy: "Privasi",
    controlsHtml: `
      <div>
        <h3>Mod Sentuh & Isyarat</h3>
        <ul>
          <li><strong>Mod Trackpad</strong>: Lalai. Satu jari untuk menggerakkan kursor. Ketuk untuk klik kiri, ketik dua kali untuk menyeret. Dua jari untuk skrol atau ketuk untuk klik kanan.</li>
          <li><strong>Mod Sentuh Langsung</strong>: Ketuk terus pada skrin tempat yang ingin diklik. Dilengkapi dengan suppression tremor dan pengaktifan seret tertunda.</li>
          <li><strong>Isyarat Mac</strong>:
            <br>• <strong>Ketukan Tiga Jari</strong>: Membuka macOS Mission Control dengan serta-merta.
            <br>• <strong>Sapuan Tiga Jari Kiri/Kanan</strong>: Bertukar antara ruang macOS atau aplikasi skrin penuh dengan lancar.
            <br>• Maklum Balas Haptik: Memicu getaran fizikal pada pengaktifan isyarat.
          </li>
        </ul>
      </div>
      <div>
        <h3>Keyboard Maya</h3>
        <ul>
          <li>Setelah disambungkan, ketuk ikon Keyboard pada dial untuk memanggil keyboard asli mudah alih.</li>
        </ul>
      </div>
      <div>
        <h3>Tindakan Butang Dial</h3>
        <ul>
          <li><strong>Keyboard</strong>: Tunjukkan atau sembunyikan keyboard maya.</li>
          <li><strong>Mode</strong>: Beralih antara mod Trackpad dan Sentuh Langsung.</li>
          <li><strong>Display</strong>: Beralih antara Fit (skala adaptif), Nisbah asli, dan Isi (Fill).</li>
          <li><strong>Shortcuts</strong>: Hantar kombinasi kekunci macOS seperti Ctrl-Alt-Del, Win, Alt-Tab, dan Ctrl-Esc.</li>
          <li><strong>Logs</strong>: Buka log diagnosis sistem jauh untuk penyelesaian masalah.</li>
          <li><strong>Quality (Kualiti Penstriman)</strong>:
            <br>• <strong>Fluid</strong>: Hadkan hingga 120fps (jika disokong), YUV 4:2:0, bitrate 6Mbps, mengutamakan latensi ultra-rendah.
            <br>• <strong>Retina</strong>: Hadkan hingga 60fps, warna tanpa rugi YUV 4:4:4, bitrate 18Mbps, teks tajam.
            <br>• <strong>Auto</strong>: Menyesuaikan kualiti secara automatik berdasarkan RTT fizikal dan kehilangan paket.
          </li>
        </ul>
      </div>
    `,
    privacyHtml: `
      <div>
        <h3>Kepatuhan Privasi untuk App Store</h3>
        <p>Privasi dan keselamatan data anda adalah prinsip utama dari 2syn. Aplikasi ini mematuhi garis panduan stor untuk alat kawalan jauh secara ketat.</p>
      </div>
      <div>
        <h3>1. Transmisi P2P WebRTC Terdesentralisasi</h3>
        <p>2syn membuat sambungan peer-to-peer langsung menggunakan WebRTC. Semua aliran video, aliran audio, and kawalan keyboard/mouse dienkripsi end-to-end dengan DTLS/SRTP 256-bit. Data anda mengalir terus di antara peranti anda, tidak pernah melalui atau disimpan di pelayan pihak ketiga.</p>
      </div>
      <div>
        <h3>2. Keizinan Sistem & Tujuan</h3>
        <ul>
          <li><strong>Rakaman Skrin</strong>: Diperlukan pada hos jauh untuk menangkap skrin untuk transmisi. 2syn tidak pernah menyimpan data ini secara tempatan atau di awan.</li>
          <li><strong>Kebolehcapaian (Accessibility)</strong>: Diperlukan untuk mensimulasikan klik tetikus dan penekanan kekunci secara tempatan pada Mac.</li>
          <li><strong>Pemandu Paparan Maya (IDD)</strong>: Memasang monitor maya secara dinamik semasa sambungan dan mematikan skrin fizikal dalam Mod Privasi.</li>
          <li><strong>Penyimpanan Selamat (Keychain)</strong>: Menyimpan kunci lesen dan kata laluan dengan selamat menggunakan kriptografi peringkat sistem.</li>
        </ul>
      </div>
      <div>
        <h3>3. Polisi Tanpa Data</h3>
        <p>Kami tidak mengumpul, menyimpan, atau menjual data peribadi, log sambungan, atau penekanan kekunci. Kata laluan yang disimpan secara tempatan boleh dipadamkan di tetapan pada bila-bila masa.</p>
      </div>
    `
  },
  "ru": {
    tabControls: "Инструкция",
    tabPrivacy: "Приватность",
    controlsHtml: `
      <div>
        <h3>Сенсорные режимы и жесты</h3>
        <ul>
          <li><strong>Режим трекпада</strong>: По умолчанию. Один палец для перемещения курсора. Тап для левого клика, двойной тап для перетаскивания. Два пальца для прокрутки или тап для правого клика.</li>
          <li><strong>Режим прямого касания</strong>: Нажимайте непосредственно на элементы на экране. Оснащен подавлением дрожания и отложенной активацией перетаскивания.</li>
          <li><strong>Жесты Mac</strong>:
            <br>• <strong>Касание тремя пальцами</strong>: Мгновенно открывает macOS Mission Control.
            <br>• <strong>Свайп тремя пальцами (Л/П)</strong>: Плавное переключение рабочих столов macOS Spaces или полноэкранных приложений.
            <br>• Виброотклик: Физическая вибрация при активации жестов.
          </li>
        </ul>
      </div>
      <div>
        <h3>Виртуальная клавиатура</h3>
        <ul>
          <li>После подключения нажмите на значок клавиатуры на колесе управления, чтобы вызвать экранную клавиатуру.</li>
        </ul>
      </div>
      <div>
        <h3>Кнопки колеса управления</h3>
        <ul>
          <li><strong>Keyboard (Клавиатура)</strong>: Показать или скрыть виртуальную клавиатуру.</li>
          <li><strong>Mode (Режим)</strong>: Переключение между режимами трекпада и прямого касания.</li>
          <li><strong>Display (Экран)</strong>: Переключение между Fit (адаптивный масштаб), Original (оригинал) и Fill (заполнение).</li>
          <li><strong>Shortcuts (Горячие клавиши)</strong>: Отправка системных комбинаций macOS, таких как Ctrl-Alt-Del, Win, Alt-Tab и Ctrl-Esc.</li>
          <li><strong>Logs (Логи)</strong>: Открытие логов удаленной диагностики для устранения неполадок.</li>
          <li><strong>Quality (Качество потока)</strong>:
            <br>• <strong>Fluid (Плавный)</strong>: До 120 кадров/с (если поддерживается), YUV 4:2:0, битрейт 6 Мбит/с для минимальной задержки.
            <br>• <strong>Retina (Четкий)</strong>: До 60 кадров/с, цвет без потерь YUV 4:4:4, битрейт 18 Мбит/с для сверхчеткого текста.
            <br>• <strong>Auto (Авто)</strong>: Автоматическая регулировка качества в зависимости от RTT и потери пакетов.
          </li>
        </ul>
      </div>
    `,
    privacyHtml: `
      <div>
        <h3>Соответствие стандартам App Store</h3>
        <p>Ваша конфиденциальность и безопасность данных — главный приоритет 2syn. Приложение строго соответствует правилам магазинов для инструментов удаленного доступа.</p>
      </div>
      <div>
        <h3>1. Децентрализованная передача WebRTC P2P</h3>
        <p>2syn устанавливает прямые одноранговые (P2P) соединения с использованием WebRTC. Все видеопотоки, аудиопотоки и управление клавиатурой/мышью зашифрованы с использованием 256-битного шифрования DTLS/SRTP. Данные передаются напрямую между вашими устройствами и никогда не проходят через сторонние серверы.</p>
      </div>
      <div>
        <h3>2. Системные разрешения и цели</h3>
        <ul>
          <li><strong>Запись экрана</strong>: Требуется на удаленном хосте для захвата экрана перед отправкой. 2syn никогда не сохраняет эти данные локально или в облаке.</li>
          <li><strong>Универсальный доступ (Accessibility)</strong>: Требуется для имитации нажатий кнопок мыши и клавиш локально на Mac.</li>
          <li><strong>Драйвер виртуального дисплея (IDD)</strong>: Динамически подключает виртуальный монитор во время сеанса и гасит физический экран в режиме приватности.</li>
          <li><strong>Безопасное хранилище (Keychain)</strong>: Надежно хранит лицензионные ключи и пароли с использованием системного шифрования.</li>
        </ul>
      </div>
      <div>
        <h3>3. Политика отсутствия сбора данных</h3>
        <p>Мы не собираем, не храним и не продаем персональные данные, логи подключений или нажатия клавиш. Любой пароль, сохраненный локально, можно удалить в настройках в любое время.</p>
      </div>
    `
  },
  "es": {
    tabControls: "Guía",
    tabPrivacy: "Privacidad",
    controlsHtml: `
      <div>
        <h3>Modos de control y gestos</h3>
        <ul>
          <li><strong>Modo Trackpad</strong>: Predeterminado. Un dedo para mover el cursor. Un toque para clic izquierdo, doble toque para arrastrar. Dos dedos para desplazarse o tocar para clic derecho.</li>
          <li><strong>Modo Toque Directo</strong>: Toque directamente en la pantalla donde desee hacer clic. Cuenta con supresión de temblores y arrastre diferido.</li>
          <li><strong>Gestos de Mac</strong>:
            <br>• <strong>Toque con tres dedos</strong>: Abre macOS Mission Control al instante.
            <br>• <strong>Deslizar con tres dedos (I/D)</strong>: Cambia fluidamente entre espacios de macOS o aplicaciones a pantalla completa.
            <br>• Respuesta Háptica: Vibración física al activar gestos.
          </li>
        </ul>
      </div>
      <div>
        <h3>Teclado Virtual</h3>
        <ul>
          <li>Una vez conectado, toque el icono de teclado en el dial para abrir el teclado nativo del móvil.</li>
        </ul>
      </div>
      <div>
        <h3>Acciones del Dial de Control</h3>
        <ul>
          <li><strong>Keyboard</strong>: Mostrar u ocultar el teclado virtual.</li>
          <li><strong>Mode</strong>: Alternar entre los modos Trackpad y Toque Directo.</li>
          <li><strong>Display</strong>: Cambiar entre Fit (escala adaptativa), Relación original y Relleno (Fill).</li>
          <li><strong>Shortcuts</strong>: Enviar combinaciones del sistema macOS como Ctrl-Alt-Del, Win, Alt-Tab y Ctrl-Esc.</li>
          <li><strong>Logs</strong>: Abrir el registro de diagnóstico remoto para solucionar problemas.</li>
          <li><strong>Quality (Calidad de video)</strong>:
            <br>• <strong>Fluid</strong>: Hasta 120fps (si es compatible), YUV 4:2:0, bitrate de 6Mbps para latencia ultra baja.
            <br>• <strong>Retina</strong>: Hasta 60fps, color sin pérdidas YUV 4:4:4, bitrate de 18Mbps para texto nítido.
            <br>• <strong>Auto</strong>: Ajusta la calidad automáticamente según el RTT y la pérdida de paquetes.
          </li>
        </ul>
      </div>
    `,
    privacyHtml: `
      <div>
        <h3>Cumplimiento de Privacidad para App Store</h3>
        <p>Su privacidad y la seguridad de sus datos son los principios fundamentales de 2syn. Esta aplicación cumple estrictamente con las políticas de las tiendas para herramientas de control remoto.</p>
      </div>
      <div>
        <h3>1. Transmisión WebRTC P2P descentralizada</h3>
        <p>2syn establece conexiones directas peer-to-peer mediante WebRTC. Todos los flujos de video, audio y controles de teclado/ratón se cifran de extremo a extremo con DTLS/SRTP de 256 bits. Sus datos fluyen directamente entre sus dispositivos, sin pasar por servidores de terceros.</p>
      </div>
      <div>
        <h3>2. Permisos del sistema y propósitos</h3>
        <ul>
          <li><strong>Grabación de pantalla</strong>: Requerido en el host remoto para capturar la pantalla para la transmisión. 2syn nunca guarda estos datos de forma local ni en la nube.</li>
          <li><strong>Accesibilidad (Accessibility)</strong>: Requerido para simular clics de ratón y pulsar teclas localmente en la Mac.</li>
          <li><strong>Controlador de pantalla virtual (IDD)</strong>: Conecta dinámicamente un monitor virtual durante la conexión y apaga la pantalla física en el Modo de Privacidad.</li>
          <li><strong>Almacenamiento seguro (Keychain)</strong>: Guarda sus claves de licencia y contraseñas de forma segura mediante criptografía a nivel de sistema.</li>
        </ul>
      </div>
      <div>
        <h3>3. Política de cero datos</h3>
        <p>No recopilamos, almacenamos ni vendemos datos personales, registros de conexión ni pulsaciones de teclas. Cualquier contraseña guardada localmente se puede borrar en los ajustes en cualquier momento.</p>
      </div>
    `
  }
};
