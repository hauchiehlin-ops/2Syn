import os

languages = {
    "ja": {
        "pp_title": "# 2syn プライバシーポリシー (Privacy Policy)",
        "pp_content": "最終更新日：2026年5月26日\n\n2synは、お客様のプライバシーを尊重します。リモートデスクトップの画面、音声、および入力データは、エンドツーエンド（E2E）で暗号化されており、当社が傍受、保存、または分析することは決してありません。\n\n## 収集する情報\n1. ハードウェアID (HWID)：ライセンスキーのデバイスバインディングに使用。\n2. シグナリングデータ (SDP/ICE)：WebRTC P2P接続の確立にのみ使用。\n\nデータは第三者に販売・共有されることはありません。",
        "tos_title": "# 2syn 利用規約 (Terms of Service)",
        "tos_content": "1. 買い切り型ライセンス：1つのキーで最大5台のデバイスをバインド可能。\n2. P2P接続：品質はネットワーク環境に依存します。Symmetric NAT環境ではSTUN/TURNが必要です。\n3. 免責事項：本ソフトウェアは「現状有姿」で提供されます。",
        "um_title": "# 2syn ユーザーマニュアル (User Manual)",
        "um_content": "## 1. クイックスタート\nキーを入力してデバイスを承認し、相手のIDを入力して接続します。\n\n## 2. パフォーマンス調整\nAIスマート最適化により、ネットワーク状態に応じて144Hz YUV444から60FPS YUV420まで自動調整されます。\n\n## 3. プライバシーブラックスクリーン\n仮想ディスプレイを挿入し、物理モニターをオフにすることで、覗き見を防止します。",
        "sl_title": "# 2syn App Store / Google Play ストア情報",
        "sl_content": "## アプリ名\n2syn - 超スムーズで安全なリモートデスクトップ\n\n## 説明\nエンドツーエンド暗号化と144Hzゲーミンググレードの更新レート。PCをクロスプラットフォームでシームレスに制御。\n\n* 144Hz対応、YUV444トゥルーカラー\n* 100%分散型P2P接続、データ漏洩ゼロ\n* 買い切り型、全プラットフォーム対応"
    },
    "ko": {
        "pp_title": "# 2syn 개인정보 처리방침 (Privacy Policy)",
        "pp_content": "최종 업데이트: 2026년 5월 26일\n\n2syn은 종단간 암호화(E2EE)를 사용합니다. 당사는 귀하의 화면, 오디오 또는 입력 데이터를 절대 가로채거나 저장하거나 분석하지 않습니다.\n\n## 수집하는 정보\n1. 하드웨어 ID (HWID): 라이선스 바인딩용.\n2. 신호 데이터 (SDP/ICE): P2P 연결용 (기록되지 않음).",
        "tos_title": "# 2syn 서비스 약관 (Terms of Service)",
        "tos_content": "1. 영구 라이선스: 최대 5대의 기기 지원.\n2. P2P 연결: 네트워크 환경에 따라 품질이 다를 수 있습니다.\n3. 면책 조항: 소프트웨어는 '있는 그대로' 제공됩니다.",
        "um_title": "# 2syn 사용자 매뉴얼 (User Manual)",
        "um_content": "## 1. 빠른 시작\n라이선스를 입력하고 연결할 ID를 입력하세요.\n\n## 2. 성능 최적화\n네트워크에 따라 144Hz YUV444에서 60FPS YUV420으로 자동 조정됩니다.\n\n## 3. 개인정보 보호 블랙 스크린\n물리적 모니터를 끄고 가상 디스플레이를 사용하여 엿보기를 방지합니다.",
        "sl_title": "# 2syn 스토어 등록 정보",
        "sl_content": "## 앱 이름\n2syn - 부드럽고 안전한 원격 데스크톱\n\n## 설명\n종단간 암호화, 144Hz 게이밍 주사율. 플랫폼 간 원활한 제어.\n\n* 144Hz 지원, YUV444 무손실 색상\n* 100% P2P 연결\n* 구독 없는 영구 라이선스"
    },
    "de": {
        "pp_title": "# 2syn Datenschutzerklärung (Privacy Policy)",
        "pp_content": "Zuletzt aktualisiert: 26. Mai 2026\n\n2syn verwendet Ende-zu-Ende-Verschlüsselung (E2EE). Wir fangen NIEMALS Ihre Bildschirme, Audio- oder Eingabedaten ab, speichern oder analysieren sie.\n\n## Gesammelte Informationen\n1. Hardware-ID (HWID): Für Lizenzbindung.\n2. Signalisierungsdaten (SDP/ICE): Nur für P2P-Verbindung.",
        "tos_title": "# 2syn Nutzungsbedingungen (Terms of Service)",
        "tos_content": "1. Einmaliger Kauf: Bis zu 5 Geräte pro Lizenz.\n2. P2P-Verbindung: Qualität hängt vom Netzwerk ab.\n3. Haftungsausschluss: Bereitstellung 'wie besehen'.",
        "um_title": "# 2syn Benutzerhandbuch (User Manual)",
        "um_content": "## 1. Schnellstart\nLizenzschlüssel eingeben und mit ID verbinden.\n\n## 2. Leistungsoptimierung\nAutomatische Anpassung von 144Hz YUV444 auf 60FPS YUV420 je nach Netzwerk.\n\n## 3. Privatsphäre-Schwarzbild\nSchaltet den physischen Monitor ab, um Neugierige abzuwehren.",
        "sl_title": "# 2syn Store-Eintrag",
        "sl_content": "## App-Name\n2syn - Reibungsloser & Sicherer Remote-Desktop\n\n## Beschreibung\nEnde-zu-Ende verschlüsselt, 144Hz Gaming-Bildwiederholrate.\n\n* 144Hz, YUV444 True Color\n* 100% dezentrale P2P-Verbindung\n* Einmaliger Kauf, alle Plattformen"
    },
    "es": {
        "pp_title": "# 2syn Política de Privacidad (Privacy Policy)",
        "pp_content": "Última actualización: 26 de mayo de 2026\n\n2syn utiliza cifrado de extremo a extremo (E2EE). NUNCA interceptamos, almacenamos ni analizamos sus pantallas, audio o datos de entrada.\n\n## Información recopilada\n1. ID de hardware (HWID): Para la vinculación de licencias.\n2. Datos de señalización (SDP/ICE): Solo para conexión P2P.",
        "tos_title": "# 2syn Términos de Servicio (Terms of Service)",
        "tos_content": "1. Compra única: Hasta 5 dispositivos por licencia.\n2. Conexión P2P: La calidad depende de la red.\n3. Descargo de responsabilidad: Software proporcionado 'tal cual'.",
        "um_title": "# 2syn Manual del Usuario (User Manual)",
        "um_content": "## 1. Inicio Rápido\nIngrese la clave de licencia y conéctese con ID.\n\n## 2. Optimización de Rendimiento\nAjuste automático de 144Hz YUV444 a 60FPS YUV420 según la red.\n\n## 3. Pantalla Negra de Privacidad\nApaga el monitor físico mediante una pantalla virtual.",
        "sl_title": "# 2syn Listado de Tienda",
        "sl_content": "## Nombre de la App\n2syn - Escritorio Remoto Fluido y Seguro\n\n## Descripción\nCifrado de extremo a extremo, 144Hz para juegos.\n\n* 144Hz, YUV444 Color Real\n* Conexión P2P 100% descentralizada\n* Compra única, compatible con todas las plataformas"
    },
    "ru": {
        "pp_title": "# Политика конфиденциальности 2syn (Privacy Policy)",
        "pp_content": "Последнее обновление: 26 мая 2026 г.\n\n2syn использует сквозное шифрование (E2EE). Мы НИКОГДА не перехватываем, не храним и не анализируем ваши экраны, аудио или вводимые данные.\n\n## Собираемая информация\n1. ID оборудования (HWID): Для привязки лицензии.\n2. Данные сигнализации (SDP/ICE): Только для P2P соединения.",
        "tos_title": "# Условия использования 2syn (Terms of Service)",
        "tos_content": "1. Единоразовая покупка: До 5 устройств.\n2. Соединение P2P: Качество зависит от сети.\n3. Отказ от ответственности: Предоставляется 'как есть'.",
        "um_title": "# Руководство пользователя 2syn (User Manual)",
        "um_content": "## 1. Быстрый старт\nВведите ключ лицензии и подключитесь по ID.\n\n## 2. Оптимизация\nАвтонастройка от 144Hz YUV444 до 60FPS YUV420.\n\n## 3. Приватный черный экран\nОтключает физический монитор для конфиденциальности.",
        "sl_title": "# 2syn Описание в магазине",
        "sl_content": "## Название\n2syn - Плавный и безопасный удаленный рабочий стол\n\n## Описание\nСквозное шифрование, 144 Гц для игр.\n\n* Поддержка 144Hz, YUV444\n* 100% P2P соединение\n* Единоразовая покупка"
    },
    "th": {
        "pp_title": "# นโยบายความเป็นส่วนตัว 2syn (Privacy Policy)",
        "pp_content": "อัปเดตล่าสุด: 26 พฤษภาคม 2026\n\n2syn ใช้การเข้ารหัสแบบ End-to-End (E2EE) เราไม่เคยดักจับ จัดเก็บ หรือวิเคราะห์หน้าจอ เสียง หรือข้อมูลอินพุตของคุณ\n\n## ข้อมูลที่เก็บรวบรวม\n1. Hardware ID (HWID): สำหรับการผูกใบอนุญาต\n2. ข้อมูลการส่งสัญญาณ (SDP/ICE): สำหรับการเชื่อมต่อ P2P",
        "tos_title": "# ข้อกำหนดการให้บริการ 2syn (Terms of Service)",
        "tos_content": "1. ซื้อครั้งเดียว: สูงสุด 5 อุปกรณ์\n2. การเชื่อมต่อ P2P: คุณภาพขึ้นอยู่กับเครือข่าย",
        "um_title": "# คู่มือผู้ใช้ 2syn (User Manual)",
        "um_content": "## 1. เริ่มต้นอย่างรวดเร็ว\nป้อนรหัสลิขสิทธิ์และเชื่อมต่อด้วย ID\n\n## 2. หน้าจอสีดำเพื่อความเป็นส่วนตัว\nปิดจอภาพจริงด้วยจอภาพเสมือนเพื่อป้องกันการสอดแนม",
        "sl_title": "# 2syn ข้อมูลในสโตร์",
        "sl_content": "## ชื่อแอป\n2syn - เดสก์ท็อประยะไกลที่ลื่นไหลและปลอดภัย\n\n## คำอธิบาย\nเข้ารหัสแบบ End-to-End รีเฟรชเรต 144Hz สำหรับเล่นเกม"
    },
    "id": {
        "pp_title": "# Kebijakan Privasi 2syn (Privacy Policy)",
        "pp_content": "Pembaruan Terakhir: 26 Mei 2026\n\n2syn menggunakan Enkripsi End-to-End (E2EE). Kami TIDAK PERNAH mencegat atau menyimpan layar Anda.\n\n## Informasi yang Dikumpulkan\n1. ID Perangkat Keras (HWID): Untuk lisensi.\n2. Data Sinyal (SDP/ICE): Untuk P2P.",
        "tos_title": "# Ketentuan Layanan 2syn (Terms of Service)",
        "tos_content": "1. Pembelian Sekali: Hingga 5 perangkat.\n2. P2P: Kualitas tergantung jaringan.",
        "um_title": "# Panduan Pengguna 2syn (User Manual)",
        "um_content": "## 1. Mulai Cepat\nMasukkan lisensi dan ID untuk terhubung.\n\n## 2. Layar Hitam Privasi\nMematikan monitor fisik untuk mencegah intipan.",
        "sl_title": "# 2syn Daftar Toko",
        "sl_content": "## Nama Aplikasi\n2syn - Desktop Jarak Jauh Lancar & Aman\n\n## Deskripsi\nEnkripsi E2EE, 144Hz, Pembelian Sekali."
    },
    "ms": {
        "pp_title": "# Dasar Privasi 2syn (Privacy Policy)",
        "pp_content": "Kemas Kini Terakhir: 26 Mei 2026\n\n2syn menggunakan Sulitan Hujung-ke-Hujung (E2EE). Kami TIDAK menangkap atau menyimpan skrin anda.\n\n## Maklumat Dikumpul\n1. ID Perkakasan (HWID): Untuk lesen.\n2. Data Isyarat (SDP/ICE): Untuk P2P.",
        "tos_title": "# Syarat Perkhidmatan 2syn (Terms of Service)",
        "tos_content": "1. Pembelian Sekali: Sehingga 5 peranti.\n2. P2P: Kualiti bergantung pada rangkaian.",
        "um_title": "# Manual Pengguna 2syn (User Manual)",
        "um_content": "## 1. Mula Pantas\nMasukkan lesen dan ID untuk menyambung.\n\n## 2. Skrin Hitam Privasi\nMematikan monitor fizikal untuk mengelakkan intipan.",
        "sl_title": "# 2syn Senarai Gedung",
        "sl_content": "## Nama Apl\n2syn - Desktop Jauh Lancar & Selamat\n\n## Penerangan\nSulitan E2EE, 144Hz, Pembelian Sekali."
    }
}

base_path = "/Users/barretlin/GitProjects/2syn/docs"

for lang, content in languages.items():
    lang_dir = os.path.join(base_path, lang)
    os.makedirs(lang_dir, exist_ok=True)
    
    with open(os.path.join(lang_dir, "privacy-policy.md"), "w", encoding="utf-8") as f:
        f.write(f"{content['pp_title']}\n\n{content['pp_content']}")
        
    with open(os.path.join(lang_dir, "terms-of-service.md"), "w", encoding="utf-8") as f:
        f.write(f"{content['tos_title']}\n\n{content['tos_content']}")
        
    with open(os.path.join(lang_dir, "user-manual.md"), "w", encoding="utf-8") as f:
        f.write(f"{content['um_title']}\n\n{content['um_content']}")
        
    with open(os.path.join(lang_dir, "store-listing.md"), "w", encoding="utf-8") as f:
        f.write(f"{content['sl_title']}\n\n{content['sl_content']}")

print("All language documents generated successfully.")
