# Kebijakan Privasi 2syn

**Terakhir Diperbarui:** 26 Juni 2026

Selamat datang di **2syn** (selanjutnya disebut sebagai "Perangkat Lunak" atau "kami"). Kebijakan Privasi ini menjelaskan bagaimana Perangkat Lunak mengumpulkan, menggunakan, dan melindungi data Anda.

**Komitmen Inti: Kami tidak menyadap, menyimpan, atau menganalisis layar desktop jarak jauh, audio, atau data input apa pun.**

---

## Satu. Data yang Kami Kumpulkan dan Tujuannya

Untuk menyediakan layanan konektivitas dasar, kami hanya mengumpulkan informasi minimum yang diperlukan berikut ini:

### 1. Data Pertukaran Sinyal（SDP／ICE Candidates）
- **Tujuan**: Untuk membantu dua perangkat Anda (host dan klien) melewati firewall dan membangun koneksi WebRTC end-to-end (P2P).
- **Penanganan**: Data handshake jaringan sementara ini (termasuk IP lokal atau publik) dihancurkan segera setelah koneksi dibangun. **Server sinyal Perangkat Lunak tidak pernah mencatat atau menyimpan paket handshake jaringan secara permanen.**

### 2. Preferensi Aplikasi
- **Tujuan**: Untuk menyimpan pengaturan bahasa, mode tampilan, dan preferensi lainnya agar diterapkan secara otomatis saat peluncuran berikutnya.
- **Penanganan**: Hanya disimpan di perangkat Anda secara lokal (iOS UserDefaults) dan tidak pernah dikirim ke server mana pun.

---

## Dua. Data yang TIDAK Kami Kumpulkan

Berdasarkan arsitektur E2EE terdesentralisasi 2syn, kami secara ketat menjamin:

1. **Layar jarak jauh, video, dan audio**: Semua stream ditransmisikan secara end-to-end langsung antara dua perangkat Anda. Tidak ada pihak ketiga, termasuk kami, yang dapat menyadap atau mendekripsinya.
2. **Input keyboard, mouse, dan sentuh**: Semua perintah input ditransmisikan secara lokal melalui P2P dan tidak melewati server mana pun.
3. **Data tekanan dan kemiringan Apple Pencil**: Data tekanan stylus ditransmisikan langsung antara perangkat dan tidak disimpan di server mana pun.
4. **Informasi Pribadi yang Dapat Diidentifikasi (PII)**: Perangkat Lunak tidak mengharuskan Anda memberikan nama, alamat email, atau nomor telepon.
5. **Data lokasi**: Perangkat Lunak tidak mengakses GPS atau lokasi tepat Anda.
6. **Kamera atau mikrofon**: Klien iOS tidak mengakses kamera atau mikrofon.

---

## Tiga. Berbagi Data dan Pengungkapan Pihak Ketiga

Kami **tidak pernah menjual, menukar, atau menyewakan** informasi Anda kepada pihak ketiga.

Satu-satunya pengecualian: Jika diwajibkan secara hukum (mis., perintah pengadilan), kami dapat secara sah menyediakan log koneksi minimum (cap waktu koneksi) yang tersimpan di server sinyal. Namun, kami secara teknis tidak mampu menyediakan layar jarak jauh atau konten yang ditransmisikan.

---

## Empat. Penggunaan Server STUN

Perangkat Lunak menggunakan server STUN publik (mis., yang disediakan oleh Google) untuk membantu perangkat menemukan alamat IP publik mereka untuk NAT traversal. Server-server ini hanya menyediakan resolusi IP dan tidak dapat mengakses konten koneksi Anda. Kebijakan privasi mereka diatur oleh penyedia masing-masing.

Perangkat Lunak menggunakan arsitektur STUN-only dan **tidak menggunakan server relay TURN secara default**. Semua koneksi bersifat langsung.

---

## Lima. Keamanan Data

- Komunikasi end-to-end menggunakan protokol enkripsi DTLS 1.3 / SRTP bawaan WebRTC.
- Preferensi aplikasi disimpan di sandbox sistem iOS dan dilindungi oleh keamanan bawaan iOS.

---

## Enam. Privasi Anak-Anak

Perangkat Lunak ini dirancang untuk pengguna berusia 13 tahun ke atas. Kami tidak secara sadar mengumpulkan informasi pribadi dari anak-anak di bawah 13 tahun.

---

## Tujuh. Perubahan pada Kebijakan Ini

Jika ada perubahan signifikan pada kebijakan ini, kami akan memposting pengumuman di dalam Perangkat Lunak atau di situs web resmi kami. Penggunaan Perangkat Lunak yang berkelanjutan merupakan persetujuan Anda terhadap kebijakan yang diperbarui.

---

## Delapan. Hubungi Kami

Jika Anda memiliki pertanyaan tentang Kebijakan Privasi ini, silakan hubungi kami melalui halaman ulasan App Store atau saluran dukungan pelanggan resmi kami.
