import json
import os

locales_dir = "public/locales"

# I will provide a dictionary of dictionaries mapping key -> lang -> translation
translations = {
    "ui_p2p_ready": {
        "en": "Excellent (P2P Ready)", "zh-TW": "極佳 (P2P 直連)", "zh-CN": "极佳 (P2P 直连)",
        "ja": "非常に良い (P2P接続)", "ko": "매우 좋음 (P2P 직결)", "de": "Hervorragend (P2P)",
        "th": "ดีเยี่ยม (P2P Ready)", "id": "Sangat Baik (P2P Ready)", "ms": "Cemerlang (P2P Sedia)",
        "es": "Excelente (Listo para P2P)", "ru": "Отлично (Готов к P2P)"
    },
    "ui_relay_ready": {
        "en": "Fair (Relay Server)", "zh-TW": "尚可 (中繼伺服器)", "zh-CN": "尚可 (中继服务器)",
        "ja": "普通 (リレーサーバー)", "ko": "보통 (중계 서버)", "de": "Mäßig (Relay-Server)",
        "th": "ปานกลาง (เซิร์ฟเวอร์รีเลย์)", "id": "Cukup (Server Relay)", "ms": "Sederhana (Pelayan Relay)",
        "es": "Regular (Servidor Relay)", "ru": "Удовлетворительно (Релейный сервер)"
    },
    "ui_offline": {
        "en": "Poor (Offline)", "zh-TW": "離線 (無法連線)", "zh-CN": "离线 (无法连接)",
        "ja": "オフライン", "ko": "오프라인 (연결 불가)", "de": "Schlecht (Offline)",
        "th": "แย่ (ออฟไลน์)", "id": "Buruk (Offline)", "ms": "Lemah (Luar Talian)",
        "es": "Pobre (Fuera de línea)", "ru": "Плохо (Не в сети)"
    },
    "ui_network_traversal": {
        "en": "NETWORK TRAVERSAL", "zh-TW": "網路穿透狀態", "zh-CN": "网络穿透状态",
        "ja": "ネットワーク トラバーサル", "ko": "네트워크 트래버설", "de": "NETZWERK-TRAVERSAL",
        "th": "การส่งผ่านเครือข่าย", "id": "TRAVERSAL JARINGAN", "ms": "TRAVERSAL RANGKAIAN",
        "es": "ATRAVESAMIENTO DE RED", "ru": "ОБХОД СЕТИ"
    },
    "ui_network_traversal_desc1": {
        "en": "Tailscale interface detected. You now have 100% traversal rate through cellular and CGNAT networks for ultra-stable, high-speed connections.", 
        "zh-TW": "已偵測到 Tailscale 網卡。您現在具備 100% 的行動網路與 CGNAT 穿透率，可享有超穩定、高速的直連體驗。", 
        "zh-CN": "已检测到 Tailscale 网卡。您现在具备 100% 的蜂窝网络与 CGNAT 穿透率，可享有超稳定、高速的直连体验。",
        "ja": "Tailscale インターフェースを検出しました。セルラーおよび CGNAT ネットワークで 100% のトラバーサル率を確保し、超安定・高速な接続を実現します。", 
        "ko": "Tailscale 인터페이스가 감지되었습니다. 이제 셀룰러 및 CGNAT 네트워크를 통해 100% 트래버설 속도를 제공하여 매우 안정적이고 빠른 연결을 지원합니다.", 
        "de": "Tailscale-Schnittstelle erkannt. Sie haben jetzt 100 % Traversal-Rate durch Mobilfunk- und CGNAT-Netzwerke für extrem stabile Hochgeschwindigkeitsverbindungen.",
        "th": "ตรวจพบอินเทอร์เฟซ Tailscale ตอนนี้คุณมีอัตราการส่งผ่าน 100% ผ่านเครือข่ายเซลลูลาร์และ CGNAT สำหรับการเชื่อมต่อที่เสถียรและความเร็วสูง", 
        "id": "Antarmuka Tailscale terdeteksi. Anda sekarang memiliki tingkat traversal 100% melalui jaringan seluler dan CGNAT untuk koneksi berkecepatan tinggi yang sangat stabil.", 
        "ms": "Antara muka Tailscale dikesan. Anda kini mempunyai kadar traversal 100% melalui rangkaian selular dan CGNAT untuk sambungan berkelajuan tinggi yang sangat stabil.",
        "es": "Interfaz de Tailscale detectada. Ahora tiene una tasa de atravesamiento del 100% a través de redes celulares y CGNAT para conexiones ultra estables y de alta velocidad.", 
        "ru": "Обнаружен интерфейс Tailscale. Теперь у вас 100% скорость обхода через сотовые сети и CGNAT для сверхстабильных и высокоскоростных соединений."
    },
    "ui_network_traversal_desc2": {
        "en": "If a TURN server is unavailable, it is recommended to install the free VPN tool Tailscale on both devices to achieve 100% P2P ultra-low latency direct connection.", 
        "zh-TW": "若不具備 TURN 伺服器，建議在雙端安裝免費的安全虛擬局域網工具 Tailscale，以 100% 實現 P2P 超低延遲直連。", 
        "zh-CN": "若不具备 TURN 服务器，建议在双端安装免费的安全虚拟局域网工具 Tailscale，以 100% 实现 P2P 超低延迟直连。",
        "ja": "TURN サーバーがない場合は、双方のデバイスに無料のセキュア VPN ツール Tailscale をインストールし、100% の P2P 超低遅延直接接続を実現することをお勧めします。", 
        "ko": "TURN 서버를 사용할 수 없는 경우, 양쪽 기기에 무료 보안 VPN 도구인 Tailscale을 설치하여 100% P2P 초저지연 직접 연결을 구현하는 것을 권장합니다.", 
        "de": "Wenn kein TURN-Server verfügbar ist, wird empfohlen, das kostenlose VPN-Tool Tailscale auf beiden Geräten zu installieren, um eine 100%ige direkte P2P-Verbindung mit extrem niedriger Latenz zu erreichen.",
        "th": "หากไม่มีเซิร์ฟเวอร์ TURN ขอแนะนำให้ติดตั้งเครื่องมือ VPN ฟรี Tailscale ในทั้งสองอุปกรณ์เพื่อการเชื่อมต่อโดยตรงแบบ P2P ที่มีความหน่วงแฝงต่ำพิเศษ 100%", 
        "id": "Jika server TURN tidak tersedia, disarankan untuk menginstal alat VPN gratis Tailscale di kedua perangkat untuk mencapai koneksi langsung P2P latensi sangat rendah 100%.", 
        "ms": "Jika pelayan TURN tidak tersedia, disyorkan untuk memasang alat VPN percuma Tailscale pada kedua-dua peranti untuk mencapai sambungan langsung P2P kependaman ultra-rendah 100%.",
        "es": "Si un servidor TURN no está disponible, se recomienda instalar la herramienta VPN gratuita Tailscale en ambos dispositivos para lograr una conexión directa P2P de latencia ultra baja al 100%.", 
        "ru": "Если сервер TURN недоступен, рекомендуется установить бесплатный VPN-инструмент Tailscale на оба устройства для достижения 100% прямого P2P-соединения со сверхнизкой задержкой."
    },
    "ui_run_on_startup": {
        "en": "Run on System Startup", "zh-TW": "開機自動啟動", "zh-CN": "开机自动启动",
        "ja": "システム起動時に実行", "ko": "시스템 시작 시 실행", "de": "Beim Systemstart ausführen",
        "th": "รันเมื่อระบบเริ่มต้น", "id": "Jalankan saat Sistem Mulai", "ms": "Jalankan pada Permulaan Sistem",
        "es": "Ejecutar al inicio del sistema", "ru": "Запускать при запуске системы"
    },
    "ui_run_diagnostics": {
        "en": "Run Diagnostics", "zh-TW": "執行診斷", "zh-CN": "执行诊断",
        "ja": "診断を実行", "ko": "진단 실행", "de": "Diagnose ausführen",
        "th": "รันการวินิจฉัย", "id": "Jalankan Diagnostik", "ms": "Jalankan Diagnostik",
        "es": "Ejecutar diagnósticos", "ru": "Запустить диагностику"
    },
    "ui_network_metrics": {
        "en": "Network & Video Quality Metrics", "zh-TW": "網路與視訊品質監控", "zh-CN": "网络与视频质量监控",
        "ja": "ネットワークとビデオ品質の指標", "ko": "네트워크 및 비디오 품질 지표", "de": "Netzwerk- und Videoqualitätsmetriken",
        "th": "เมตริกคุณภาพเครือข่ายและวิดีโอ", "id": "Metrik Kualitas Jaringan & Video", "ms": "Metrik Kualiti Rangkaian & Video",
        "es": "Métricas de calidad de red y video", "ru": "Метрики качества сети и видео"
    },
    "ui_host_info": {
        "en": "Host Information", "zh-TW": "主控端資訊", "zh-CN": "主控端信息",
        "ja": "ホスト情報", "ko": "호스트 정보", "de": "Host-Informationen",
        "th": "ข้อมูลโฮสต์", "id": "Informasi Tuan Rumah", "ms": "Maklumat Tuan Rumah",
        "es": "Información del host", "ru": "Информация о хосте"
    },
    "ui_security_privacy": {
        "en": "Security & Privacy", "zh-TW": "安全性與隱私", "zh-CN": "安全性与隐私",
        "ja": "セキュリティとプライバシー", "ko": "보안 및 개인 정보 보호", "de": "Sicherheit & Datenschutz",
        "th": "ความปลอดภัยและความเป็นส่วนตัว", "id": "Keamanan & Privasi", "ms": "Keselamatan & Privasi",
        "es": "Seguridad y privacidad", "ru": "Безопасность и конфиденциальность"
    },
    "ui_system_logs": {
        "en": "System Logs", "zh-TW": "系統日誌", "zh-CN": "系统日志",
        "ja": "システムログ", "ko": "시스템 로그", "de": "Systemprotokolle",
        "th": "บันทึกระบบ", "id": "Log Sistem", "ms": "Log Sistem",
        "es": "Registros del sistema", "ru": "Системные журналы"
    },
    "ui_advanced_dev": {
        "en": "Advanced Developer Tools", "zh-TW": "進階開發者工具", "zh-CN": "高级开发者工具",
        "ja": "高度な開発者ツール", "ko": "고급 개발자 도구", "de": "Erweiterte Entwicklertools",
        "th": "เครื่องมือผู้พัฒนาขั้นสูง", "id": "Alat Pengembang Lanjutan", "ms": "Alat Pembangun Lanjutan",
        "es": "Herramientas de desarrollo avanzadas", "ru": "Расширенные инструменты разработчика"
    },
    "ui_diagnostics": {
        "en": "Security & Connectivity Diagnostics", "zh-TW": "安全性與連線診斷", "zh-CN": "安全性与连接诊断",
        "ja": "セキュリティと接続の診断", "ko": "보안 및 연결 진단", "de": "Sicherheits- und Konnektivitätsdiagnose",
        "th": "การวินิจฉัยความปลอดภัยและการเชื่อมต่อ", "id": "Diagnostik Keamanan & Konektivitas", "ms": "Diagnostik Keselamatan & Kesambungan",
        "es": "Diagnóstico de seguridad y conectividad", "ru": "Диагностика безопасности и подключения"
    },
    "ui_my_id": {
        "en": "My ID:", "zh-TW": "我的 ID：", "zh-CN": "我的 ID：",
        "ja": "マイ ID:", "ko": "내 ID:", "de": "Meine ID:",
        "th": "รหัสของฉัน:", "id": "ID Saya:", "ms": "ID Saya:",
        "es": "Mi ID:", "ru": "Мой ID:"
    },
    "ui_my_mac": {
        "en": "My MAC:", "zh-TW": "我的 MAC：", "zh-CN": "我的 MAC：",
        "ja": "マイ MAC:", "ko": "내 MAC:", "de": "Meine MAC:",
        "th": "MAC ของฉัน:", "id": "MAC Saya:", "ms": "MAC Saya:",
        "es": "Mi MAC:", "ru": "Мой MAC:"
    },
    "ui_my_hwid": {
        "en": "My HWID:", "zh-TW": "我的 HWID：", "zh-CN": "我的 HWID：",
        "ja": "マイ HWID:", "ko": "내 HWID:", "de": "Meine HWID:",
        "th": "HWID ของฉัน:", "id": "HWID Saya:", "ms": "HWID Saya:",
        "es": "Mi HWID:", "ru": "Мой HWID:"
    },
    "ui_signaling_status": {
        "en": "Signaling Status:", "zh-TW": "信令連線狀態：", "zh-CN": "信令连接状态：",
        "ja": "シグナリング状態:", "ko": "시그널링 상태:", "de": "Signalisierungsstatus:",
        "th": "สถานะการส่งสัญญาณ:", "id": "Status Sinyal:", "ms": "Status Isyarat:",
        "es": "Estado de señalización:", "ru": "Статус сигнализации:"
    },
    "ui_static_password": {
        "en": "Static Access Password:", "zh-TW": "無人值守密碼：", "zh-CN": "无人值守密码：",
        "ja": "無人アクセスパスワード:", "ko": "무인 액세스 암호:", "de": "Statisches Zugangspasswort:",
        "th": "รหัสผ่านการเข้าถึงคงที่:", "id": "Kata Sandi Akses Statis:", "ms": "Kata Laluan Akses Statik:",
        "es": "Contraseña de acceso estática:", "ru": "Статический пароль доступа:"
    },
    "ui_stun_lookup": {
        "en": "STUN Server Lookup:", "zh-TW": "STUN 伺服器解析：", "zh-CN": "STUN 服务器解析：",
        "ja": "STUNサーバー解決:", "ko": "STUN 서버 확인:", "de": "STUN-Server-Suche:",
        "th": "การค้นหาเซิร์ฟเวอร์ STUN:", "id": "Pencarian Server STUN:", "ms": "Carian Pelayan STUN:",
        "es": "Búsqueda de servidor STUN:", "ru": "Поиск сервера STUN:"
    },
    "ui_nat_type": {
        "en": "NAT Detection Type:", "zh-TW": "NAT 類型偵測：", "zh-CN": "NAT 类型检测：",
        "ja": "NAT検出タイプ:", "ko": "NAT 감지 유형:", "de": "NAT-Erkennungstyp:",
        "th": "ประเภทการตรวจจับ NAT:", "id": "Jenis Deteksi NAT:", "ms": "Jenis Pengesanan NAT:",
        "es": "Tipo de detección NAT:", "ru": "Тип обнаружения NAT:"
    },
    "ui_opt_suggestions": {
        "en": "Optimization Suggestions", "zh-TW": "連線最佳化建議", "zh-CN": "连接优化建议",
        "ja": "最適化の提案", "ko": "최적화 제안", "de": "Optimierungsvorschläge",
        "th": "ข้อเสนอแนะในการเพิ่มประสิทธิภาพ", "id": "Saran Pengoptimalan", "ms": "Cadangan Pengoptimuman",
        "es": "Sugerencias de optimización", "ru": "Предложения по оптимизации"
    },
    "ui_click_analyze": {
        "en": "Click the button above to analyze your device secure store and connection pipes.", 
        "zh-TW": "請點擊上方按鈕以分析您的本機安全儲存區與連線通道狀態。", 
        "zh-CN": "请点击上方按钮以分析您的本地安全存储区与连接通道状态。",
        "ja": "上のボタンをクリックして、デバイスのセキュアストアと接続パイプを分析してください。", 
        "ko": "위의 버튼을 클릭하여 기기 보안 저장소 및 연결 파이프를 분석하십시오.", 
        "de": "Klicken Sie auf die Schaltfläche oben, um Ihren sicheren Gerätespeicher und die Verbindungsleitungen zu analysieren.",
        "th": "คลิกปุ่มด้านบนเพื่อวิเคราะห์ที่เก็บที่ปลอดภัยของอุปกรณ์และท่อเชื่อมต่อของคุณ", 
        "id": "Klik tombol di atas untuk menganalisis penyimpanan aman perangkat dan pipa koneksi Anda.", 
        "ms": "Klik butang di atas untuk menganalisis storan selamat peranti dan paip sambungan anda.",
        "es": "Haga clic en el botón de arriba para analizar la tienda segura de su dispositivo y las tuberías de conexión.", 
        "ru": "Нажмите кнопку выше, чтобы проанализировать безопасное хранилище вашего устройства и каналы подключения."
    },
    "ui_conn_protocol": {
        "en": "Connection Protocol", "zh-TW": "連線傳輸協定", "zh-CN": "连接传输协议",
        "ja": "接続プロトコル", "ko": "연결 프로토콜", "de": "Verbindungsprotokoll",
        "th": "โปรโตคอลการเชื่อมต่อ", "id": "Protokol Koneksi", "ms": "Protokol Sambungan",
        "es": "Protocolo de conexión", "ru": "Протокол подключения"
    },
    "ui_codec_sec": {
        "en": "Codec & Cipher Security", "zh-TW": "編解碼與加密等級", "zh-CN": "编解码与加密等级",
        "ja": "コーデックと暗号のセキュリティ", "ko": "코덱 및 암호화 보안", "de": "Codec- und Verschlüsselungssicherheit",
        "th": "ความปลอดภัยของโคเดกและรหัสผ่าน", "id": "Keamanan Codec & Sandi", "ms": "Keselamatan Codec & Sifer",
        "es": "Seguridad de códec y cifrado", "ru": "Безопасность кодека и шифра"
    },
    "ui_actual_fps": {
        "en": "Actual FPS (Live)", "zh-TW": "實際幀率 (即時)", "zh-CN": "实际帧率 (实时)",
        "ja": "実際のFPS (ライブ)", "ko": "실제 FPS (실시간)", "de": "Tatsächliche FPS (Live)",
        "th": "FPS จริง (สด)", "id": "FPS Aktual (Langsung)", "ms": "FPS Sebenar (Langsung)",
        "es": "FPS real (en vivo)", "ru": "Фактический FPS (в реальном времени)"
    },
    "ui_actual_bitrate": {
        "en": "Actual Bitrate (Live)", "zh-TW": "實際碼率 (即時)", "zh-CN": "实际码率 (实时)",
        "ja": "実際のビットレート (ライブ)", "ko": "실제 비트레이트 (실시간)", "de": "Tatsächliche Bitrate (Live)",
        "th": "บิตเรตจริง (สด)", "id": "Bitrate Aktual (Langsung)", "ms": "Bitrate Sebenar (Langsung)",
        "es": "Tasa de bits real (en vivo)", "ru": "Фактический битрейт (в реальном времени)"
    },
    "ui_net_lat": {
        "en": "Network Latency (RTT)", "zh-TW": "網路延遲 (RTT)", "zh-CN": "网络延迟 (RTT)",
        "ja": "ネットワーク遅延 (RTT)", "ko": "네트워크 지연 시간 (RTT)", "de": "Netzwerklatenz (RTT)",
        "th": "ความหน่วงของเครือข่าย (RTT)", "id": "Latensi Jaringan (RTT)", "ms": "Latensi Rangkaian (RTT)",
        "es": "Latencia de red (RTT)", "ru": "Задержка сети (RTT)"
    },
    "ui_pkt_loss": {
        "en": "Packet Loss Rate", "zh-TW": "封包遺失率", "zh-CN": "丢包率",
        "ja": "パケットロス率", "ko": "패킷 손실률", "de": "Paketverlustrate",
        "th": "อัตราการสูญเสียแพ็กเก็ต", "id": "Tingkat Kehilangan Paket", "ms": "Kadar Kehilangan Pakej",
        "es": "Tasa de pérdida de paquetes", "ru": "Уровень потери пакетов"
    },
    "ui_sim_rtt": {
        "en": "Simulated RTT Latency", "zh-TW": "模擬 RTT 延遲", "zh-CN": "模拟 RTT 延迟",
        "ja": "シミュレートされたRTT遅延", "ko": "시뮬레이션된 RTT 지연 시간", "de": "Simulierte RTT-Latenz",
        "th": "ความหน่วง RTT จำลอง", "id": "Latensi RTT Simulasi", "ms": "Latensi RTT Simulasi",
        "es": "Latencia RTT simulada", "ru": "Имитация задержки RTT"
    },
    "ui_sim_loss": {
        "en": "Simulated Packet Loss", "zh-TW": "模擬封包遺失", "zh-CN": "模拟丢包",
        "ja": "シミュレートされたパケットロス", "ko": "시뮬레이션된 패킷 손실", "de": "Simulierter Paketverlust",
        "th": "การสูญเสียแพ็กเก็ตจำลอง", "id": "Kehilangan Paket Simulasi", "ms": "Kehilangan Pakej Simulasi",
        "es": "Pérdida de paquetes simulada", "ru": "Имитация потери пакетов"
    },
    "ui_tgt_fps": {
        "en": "Target Frame Rate", "zh-TW": "目標幀率上限", "zh-CN": "目标帧率上限",
        "ja": "ターゲットフレームレート", "ko": "목표 프레임 속도", "de": "Ziel-Bildrate",
        "th": "อัตราเฟรมเป้าหมาย", "id": "Kecepatan Bingkai Target", "ms": "Kadar Bingkai Sasaran",
        "es": "Velocidad de fotogramas objetivo", "ru": "Целевая частота кадров"
    },
    "ui_max_bit": {
        "en": "Max Bitrate Limit", "zh-TW": "最大編碼碼率上限", "zh-CN": "最大编码码率上限",
        "ja": "最大ビットレート制限", "ko": "최대 비트레이트 제한", "de": "Maximales Bitratenlimit",
        "th": "ขีดจำกัดบิตเรตสูงสุด", "id": "Batas Bitrate Maksimum", "ms": "Had Bitrate Maksimum",
        "es": "Límite máximo de tasa de bits", "ru": "Максимальный лимит битрейта"
    },
    "ui_color_samp": {
        "en": "Color Sampling", "zh-TW": "色彩抽樣格式", "zh-CN": "色彩抽样格式",
        "ja": "カラーサンプリング", "ko": "색상 샘플링", "de": "Farbabtastung",
        "th": "การสุ่มตัวอย่างสี", "id": "Pengambilan Sampel Warna", "ms": "Pensampelan Warna",
        "es": "Muestreo de color", "ru": "Цветовая субдискретизация"
    },
    "ui_priv_shield": {
        "en": "Privacy Shield Mode (Virtual GPU)", "zh-TW": "隱私黑屏模式 (虛擬顯示器)", "zh-CN": "隐私黑屏模式 (虚拟显示器)",
        "ja": "プライバシーシールドモード (仮想GPU)", "ko": "개인 정보 보호 실드 모드 (가상 GPU)", "de": "Datenschutzschild-Modus (Virtuelle GPU)",
        "th": "โหมดโล่ความเป็นส่วนตัว (GPU เสมือน)", "id": "Mode Perisai Privasi (GPU Virtual)", "ms": "Mod Perisai Privasi (GPU Maya)",
        "es": "Modo escudo de privacidad (GPU virtual)", "ru": "Режим защиты конфиденциальности (Виртуальный графический процессор)"
    },
    "ui_smart_opt": {
        "en": "Smart Quality Auto-Optimization", "zh-TW": "智慧畫質自動動態變頻", "zh-CN": "智慧画质自动动态变频",
        "ja": "スマート品質自動最適化", "ko": "스마트 품질 자동 최적화", "de": "Intelligente automatische Qualitätsoptimierung",
        "th": "การเพิ่มประสิทธิภาพคุณภาพอัจฉริยะอัตโนมัติ", "id": "Pengoptimalan Otomatis Kualitas Cerdas", "ms": "Pengoptimuman Auto Kualiti Pintar",
        "es": "Optimización automática de calidad inteligente", "ru": "Интеллектуальная автооптимизация качества"
    },
    "ui_offline_sdp": {
        "en": "Offline Connection (SDP)", "zh-TW": "離線連線 (SDP 模式)", "zh-CN": "离线连接 (SDP 模式)",
        "ja": "オフライン接続 (SDP)", "ko": "오프라인 연결 (SDP)", "de": "Offline-Verbindung (SDP)",
        "th": "การเชื่อมต่อแบบออฟไลน์ (SDP)", "id": "Koneksi Offline (SDP)", "ms": "Sambungan Luar Talian (SDP)",
        "es": "Conexión fuera de línea (SDP)", "ru": "Автономное подключение (SDP)"
    },
    "ui_enter_sdp": {
        "en": "Enter Remote SDP Answer/Offer", "zh-TW": "請輸入遠端的 SDP Offer 或 Answer", "zh-CN": "请输入远程的 SDP Offer 或 Answer",
        "ja": "リモートSDPアンサー/オファーを入力", "ko": "원격 SDP 응답/제안 입력", "de": "Geben Sie die Remote-SDP-Antwort/-Angebot ein",
        "th": "ป้อน SDP คำตอบ/ข้อเสนอระยะไกล", "id": "Masukkan SDP Jawaban/Penawaran Jarak Jauh", "ms": "Masukkan Jawapan/Tawaran SDP Jauh",
        "es": "Ingrese respuesta/oferta SDP remota", "ru": "Введите удаленный ответ/предложение SDP"
    },
    "ui_gen_sdp": {
        "en": "Generate & Copy Local SDP Offer", "zh-TW": "產生並複製本機的 SDP Offer", "zh-CN": "产生并复制本机的 SDP Offer",
        "ja": "ローカルSDPオファーを生成してコピー", "ko": "로컬 SDP 제안 생성 및 복사", "de": "Lokales SDP-Angebot generieren & kopieren",
        "th": "สร้างและคัดลอกข้อเสนอ SDP ในเครื่อง", "id": "Hasilkan & Salin Penawaran SDP Lokal", "ms": "Jana & Salin Tawaran SDP Tempatan",
        "es": "Generar y copiar oferta SDP local", "ru": "Сгенерировать и скопировать локальное предложение SDP"
    },
    "ui_force_play": {
        "en": "Force Play", "zh-TW": "強制播放", "zh-CN": "强制播放",
        "ja": "強制再生", "ko": "강제 재생", "de": "Wiedergabe erzwingen",
        "th": "บังคับเล่น", "id": "Paksa Main", "ms": "Paksa Main",
        "es": "Forzar reproducción", "ru": "Принудительное воспроизведение"
    },
    "ui_import_json": {
        "en": "Import JSON", "zh-TW": "匯入 JSON", "zh-CN": "导入 JSON",
        "ja": "JSONをインポート", "ko": "JSON 가져오기", "de": "JSON importieren",
        "th": "นำเข้า JSON", "id": "Impor JSON", "ms": "Import JSON",
        "es": "Importar JSON", "ru": "Импорт JSON"
    },
    "ui_export_json": {
        "en": "Export JSON", "zh-TW": "匯出 JSON", "zh-CN": "导出 JSON",
        "ja": "JSONをエクスポート", "ko": "JSON 내보내기", "de": "JSON exportieren",
        "th": "ส่งออก JSON", "id": "Ekspor JSON", "ms": "Eksport JSON",
        "es": "Exportar JSON", "ru": "Экспорт JSON"
    },
    "ui_save_reload": {
        "en": "Save and Reload", "zh-TW": "儲存並重新載入", "zh-CN": "保存并重新载入",
        "ja": "保存して再読み込み", "ko": "저장 및 다시 로드", "de": "Speichern und neu laden",
        "th": "บันทึกและโหลดใหม่", "id": "Simpan dan Muat Ulang", "ms": "Simpan dan Muat Semula",
        "es": "Guardar y recargar", "ru": "Сохранить и перезагрузить"
    },
    "ui_byoi": {
        "en": "Advanced: Bring Your Own TURN (BYOI)", "zh-TW": "進階：自攜 TURN 伺服器 (BYOI)", "zh-CN": "进阶：自携 TURN 服务器 (BYOI)",
        "ja": "高度な設定: 独自のTURNを使用 (BYOI)", "ko": "고급: 고유한 TURN 가져오기 (BYOI)", "de": "Erweitert: Eigenen TURN mitbringen (BYOI)",
        "th": "ขั้นสูง: นำ TURN ของคุณมาเอง (BYOI)", "id": "Lanjutan: Bawa TURN Anda Sendiri (BYOI)", "ms": "Lanjutan: Bawa TURN Anda Sendiri (BYOI)",
        "es": "Avanzado: Traiga su propio TURN (BYOI)", "ru": "Дополнительно: Принесите свой собственный TURN (BYOI)"
    },
    "ui_byoi_desc": {
        "en": "If you host a custom TURN relay server (e.g., Coturn), you can enter the JSON array configuration here:", 
        "zh-TW": "若您有自架 Coturn 等中繼伺服器，可在此輸入 JSON 陣列格式配置：", 
        "zh-CN": "若您有自架 Coturn 等中继服务器，可在此输入 JSON 阵列格式配置：",
        "ja": "カスタムTURNリレーサーバー（Coturnなど）をホストしている場合は、ここにJSON配列構成を入力できます:", 
        "ko": "사용자 지정 TURN 중계 서버(예: Coturn)를 호스팅하는 경우 여기에 JSON 배열 구성을 입력할 수 있습니다.", 
        "de": "Wenn Sie einen benutzerdefinierten TURN-Relay-Server (z. B. Coturn) hosten, können Sie hier die JSON-Array-Konfiguration eingeben:",
        "th": "หากคุณโฮสต์เซิร์ฟเวอร์รีเลย์ TURN แบบกำหนดเอง (เช่น Coturn) คุณสามารถป้อนการกำหนดค่าอาร์เรย์ JSON ที่นี่:", 
        "id": "Jika Anda menghosting server relay TURN khusus (mis., Coturn), Anda dapat memasukkan konfigurasi array JSON di sini:", 
        "ms": "Jika anda mengehoskan pelayan relay TURN tersuai (mis., Coturn), anda boleh memasukkan konfigurasi tatasusunan JSON di sini:",
        "es": "Si aloja un servidor de retransmisión TURN personalizado (por ejemplo, Coturn), puede ingresar la configuración de la matriz JSON aquí:", 
        "ru": "Если вы размещаете пользовательский сервер ретрансляции TURN (например, Coturn), вы можете ввести конфигурацию массива JSON здесь:"
    },
    "ui_dl_mac": {
        "en": "Download for Mac / Windows", "zh-TW": "Mac / Windows 下載", "zh-CN": "Mac / Windows 下载",
        "ja": "Mac / Windows向けダウンロード", "ko": "Mac / Windows용 다운로드", "de": "Download für Mac / Windows",
        "th": "ดาวน์โหลดสำหรับ Mac / Windows", "id": "Unduh untuk Mac / Windows", "ms": "Muat turun untuk Mac / Windows",
        "es": "Descargar para Mac / Windows", "ru": "Скачать для Mac / Windows"
    },
    "ui_dl_ios": {
        "en": "Download for iOS (App Store)", "zh-TW": "iOS 下載 (App Store)", "zh-CN": "iOS 下载 (App Store)",
        "ja": "iOS向けダウンロード (App Store)", "ko": "iOS용 다운로드 (App Store)", "de": "Download für iOS (App Store)",
        "th": "ดาวน์โหลดสำหรับ iOS (App Store)", "id": "Unduh untuk iOS (App Store)", "ms": "Muat turun untuk iOS (App Store)",
        "es": "Descargar para iOS (App Store)", "ru": "Скачать для iOS (App Store)"
    },
    "ui_dl_android": {
        "en": "Download for Android", "zh-TW": "Android 下載", "zh-CN": "Android 下载",
        "ja": "Android向けダウンロード", "ko": "Android용 다운로드", "de": "Download für Android",
        "th": "ดาวน์โหลดสำหรับ Android", "id": "Unduh untuk Android", "ms": "Muat turun untuk Android",
        "es": "Descargar para Android", "ru": "Скачать для Android"
    },
    "ui_logs_hint": {
        "en": "Above are the real-time debug logs for the host device. If you see 'Screen capture failed', it means the Mac host has checked the permission but is still rejected by the system. Please try unchecking and checking the App permission again and restart the App.", 
        "zh-TW": "以上為被控端主機的即時除錯日誌。若包含 'Screen capture failed'，表示 Mac 主機雖勾選了權限，但仍被系統拒絕，請嘗試將該 App 權限取消勾選後重新勾選，並重啟 App。", 
        "zh-CN": "以上为被控端主机的实时排错日志。若包含 'Screen capture failed'，表示 Mac 主机虽勾选了权限，但仍被系统拒绝，请尝试将该 App 权限取消勾选后重新勾选，并重启 App。",
        "ja": "上記はホストデバイスのリアルタイムデバッグログです。「画面キャプチャに失敗しました」と表示される場合は、Macホストが権限を確認したにもかかわらずシステムに拒否されていることを意味します。アプリの権限のチェックを外して再度チェックし、アプリを再起動してみてください。", 
        "ko": "위는 호스트 기기의 실시간 디버그 로그입니다. '화면 캡처 실패'가 표시되면 Mac 호스트가 권한을 확인했지만 여전히 시스템에서 거부됨을 의미합니다. 앱 권한을 선택 취소했다가 다시 선택하고 앱을 다시 시작해 보십시오.", 
        "de": "Oben sehen Sie die Echtzeit-Debug-Protokolle für das Hostgerät. Wenn Sie 'Screen capture failed' sehen, bedeutet dies, dass der Mac-Host die Berechtigung überprüft hat, aber vom System immer noch abgelehnt wird. Bitte versuchen Sie, die App-Berechtigung zu deaktivieren und wieder zu aktivieren und die App neu zu starten.",
        "th": "ด้านบนคือบันทึกการแก้ไขข้อบกพร่องแบบเรียลไทม์สำหรับอุปกรณ์โฮสต์ หากคุณเห็น 'การจับภาพหน้าจอล้มเหลว' หมายความว่าโฮสต์ Mac ได้ตรวจสอบสิทธิ์แล้วแต่ระบบยังคงปฏิเสธ โปรดลองยกเลิกการทำเครื่องหมายและทำเครื่องหมายที่สิทธิ์ของแอปอีกครั้ง แล้วรีสตาร์ทแอป", 
        "id": "Di atas adalah log debug real-time untuk perangkat host. Jika Anda melihat 'Tangkapan layar gagal', itu berarti host Mac telah memeriksa izin tetapi masih ditolak oleh sistem. Coba hapus centang dan centang izin Aplikasi lagi lalu mulai ulang Aplikasi.", 
        "ms": "Di atas adalah log nyahpepijat masa nyata untuk peranti tuan rumah. Jika anda melihat 'Tangkapan skrin gagal', ini bermakna tuan rumah Mac telah memeriksa kebenaran tetapi masih ditolak oleh sistem. Sila cuba nyahsemak dan semak kebenaran Apl sekali lagi dan mulakan semula Apl.",
        "es": "A continuación se muestran los registros de depuración en tiempo real para el dispositivo host. Si ve 'Error en la captura de pantalla', significa que el host Mac ha verificado el permiso pero el sistema aún lo rechaza. Intente desmarcar y marcar nuevamente el permiso de la aplicación y reiniciar la aplicación.", 
        "ru": "Выше приведены журналы отладки в реальном времени для хост-устройства. Если вы видите «Сбой захвата экрана», это означает, что хост Mac проверил разрешение, но система все равно его отклонила. Попробуйте снять и снова установить флажок разрешения приложения и перезапустить приложение."
    },
    "ui_btn_reprompt": {
        "en": "Re-prompt System Permission", "zh-TW": "重新發起系統授權提示", "zh-CN": "重新发起系统授权提示",
        "ja": "システム権限を再度促す", "ko": "시스템 권한 다시 묻기", "de": "Systemberechtigung erneut anfordern",
        "th": "พรอมต์การอนุญาตระบบอีกครั้ง", "id": "Minta Ulang Izin Sistem", "ms": "Mohon Semula Kebenaran Sistem",
        "es": "Volver a solicitar permiso del sistema", "ru": "Повторно запросить разрешение системы"
    },
    "ui_permission_warning": {
        "en": "Insufficient macOS system permissions will cause a black screen during remote control!", 
        "zh-TW": "macOS 系統權限不足，將導致遠端控制黑屏！", 
        "zh-CN": "macOS 系统权限不足，将导致远程控制黑屏！",
        "ja": "macOSのシステム権限が不十分な場合、リモートコントロール中に黒い画面が表示されます！", 
        "ko": "macOS 시스템 권한이 부족하면 원격 제어 중에 검은색 화면이 나타납니다!", 
        "de": "Unzureichende macOS-Systemberechtigungen führen während der Fernsteuerung zu einem schwarzen Bildschirm!",
        "th": "สิทธิ์ของระบบ macOS ไม่เพียงพอจะทำให้หน้าจอดำระหว่างการควบคุมระยะไกล!", 
        "id": "Izin sistem macOS yang tidak memadai akan menyebabkan layar hitam selama kendali jarak jauh!", 
        "ms": "Kebenaran sistem macOS yang tidak mencukupi akan menyebabkan skrin hitam semasa kawalan jauh!",
        "es": "¡Los permisos insuficientes del sistema macOS causarán una pantalla negra durante el control remoto!", 
        "ru": "Недостаточные системные разрешения macOS приведут к черному экрану во время удаленного управления!"
    },
    "ui_dl_hint": {
        "en": "Both host and client devices need to download and install the application.", 
        "zh-TW": "被控端與主控端設備均需下載安裝。", 
        "zh-CN": "被控端与主控端设备均需下载安装。",
        "ja": "ホストとクライアントの両方のデバイスで、アプリケーションをダウンロードしてインストールする必要があります。", 
        "ko": "호스트와 클라이언트 기기 모두 응용 프로그램을 다운로드하여 설치해야 합니다.", 
        "de": "Sowohl Host- als auch Client-Geräte müssen die Anwendung herunterladen und installieren.",
        "th": "ทั้งอุปกรณ์โฮสต์และไคลเอนต์จำเป็นต้องดาวน์โหลดและติดตั้งแอปพลิเคชัน", 
        "id": "Baik perangkat host maupun klien perlu mengunduh dan menginstal aplikasi.", 
        "ms": "Kedua-dua peranti tuan rumah dan pelanggan perlu memuat turun dan memasang aplikasi.",
        "es": "Tanto el dispositivo host como el cliente deben descargar e instalar la aplicación.", 
        "ru": "Обоим устройствам, хосту и клиенту, необходимо загрузить и установить приложение."
    },
    "ui_sys_auto_adj": {
        "en": "System automatically adjusting. Network and stream quality are in optimal states.", 
        "zh-TW": "系統已自動動態變頻。網路與畫質處於最佳化狀態。", 
        "zh-CN": "系统已自动动态变频。网络与画质处于最佳化状态。",
        "ja": "システムは自動的に調整されています。ネットワークとストリームの品質は最適な状態です。", 
        "ko": "시스템이 자동으로 조정 중입니다. 네트워크 및 스트림 품질이 최적 상태입니다.", 
        "de": "Das System passt sich automatisch an. Netzwerk- und Stream-Qualität befinden sich in einem optimalen Zustand.",
        "th": "ระบบกำลังปรับอัตโนมัติ คุณภาพเครือข่ายและสตรีมอยู่ในสถานะที่เหมาะสมที่สุด", 
        "id": "Sistem secara otomatis menyesuaikan. Kualitas jaringan dan aliran berada dalam status optimal.", 
        "ms": "Sistem melaras secara automatik. Rangkaian dan kualiti strim berada dalam keadaan optimum.",
        "es": "El sistema se está ajustando automáticamente. La red y la calidad de transmisión están en estados óptimos.", 
        "ru": "Система настраивается автоматически. Сеть и качество потока находятся в оптимальном состоянии."
    },
    "ui_sim_relay_mode": {
        "en": "Simulate Relay Mode", "zh-TW": "模擬 Relay 中繼模式", "zh-CN": "模拟 Relay 中继模式",
        "ja": "リレーモードをシミュレート", "ko": "중계 모드 시뮬레이션", "de": "Relay-Modus simulieren",
        "th": "จำลองโหมดรีเลย์", "id": "Simulasikan Mode Relay", "ms": "Simulasi Mod Relay",
        "es": "Simular modo relé", "ru": "Имитация режима ретрансляции"
    }
}

languages = ["en", "zh-TW", "zh-CN", "ja", "ko", "de", "es", "ru", "th", "id", "ms"]

# Update each json file
for lang in languages:
    filepath = os.path.join(locales_dir, f"{lang}.json")
    if os.path.exists(filepath):
        with open(filepath, "r", encoding="utf-8") as f:
            try:
                data = json.load(f)
            except:
                data = {}
    else:
        data = {}
        
    # Inject translation keys
    for key, trans_dict in translations.items():
        if lang in trans_dict:
            data[key] = trans_dict[lang]
        else:
            data[key] = trans_dict["en"]  # fallback to English if not provided
            
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

print("All language JSON files updated.")
