# Panduan Pengguna 2syn

Selamat datang di **2syn**! 2syn adalah sistem desktop jarak jauh berperforma tinggi dan aman yang menggabungkan enkripsi end-to-end WebRTC dengan teknologi bitrate adaptif, mendukung koneksi lintas platform dari host macOS/Windows ke klien iOS/macOS.

---

## 1. Pasangan Koneksi

### 1.1 Mendapatkan ID Host
Luncurkan 2syn di **host** (komputer yang akan dikendalikan):
- ID 9 digit akan muncul di kolom「My ID」di bagian atas layar (mis. `569-639-684`).
- Klik tombol 📋 di sebelah ID untuk menyalinnya, atau klik tombol ⬛ untuk menampilkan kode QR.

### 1.2 Menghubungkan dari Perangkat iOS
1. Luncurkan aplikasi 2syn di iOS.
2. Masukkan ID host secara manual di kolom「Connect to」, atau minta host menampilkan kode QR dan pindai dengan kamera bawaan iOS — ID akan terisi secara otomatis.
3. Ketuk「Connect」. Sistem secara otomatis melakukan NAT traversal melalui STUN dan membangun koneksi langsung end-to-end — tidak diperlukan konfigurasi Port Forwarding router.

---

## 2. Kontrol Jarak Jauh

### 2.1 Beralih Mode Kontrol
Setelah terhubung, ketuk tombol ⚙️ pada bilah alat di sudut kanan atas untuk memperluas panel dan beralih antara dua mode kontrol:

| Mode | Deskripsi |
|---|---|
| **Trackpad（Mode Trackpad）** | Seret jari = gerakkan kursor；ketuk satu jari = klik kiri；geser dua jari atas-bawah = gulir；ketuk dua jari = klik kanan |
| **Direct Touch（Mode Sentuh Langsung）** | Koordinat sentuhan langsung sesuai dengan koordinat layar host |

### 2.2 Gulir Dua Jari
Dalam mode Trackpad, geser dua jari ke atas atau ke bawah pada layar untuk mengirim peristiwa gulir ke host. Berfungsi dengan semua aplikasi.

### 2.3 Input Keyboard
1. Ketuk ikon keyboard pada bilah alat untuk memunculkan keyboard layar iOS.
2. Bilah alat tombol modifier (Esc, Tab, ⌃, ⌥, ⌘, ⇧, tombol panah) muncul di atas keyboard untuk mengirim kombinasi pintasan keyboard.
3. Ketuk tombol modifier sekali untuk menguncinya (menyala biru); secara otomatis dibuka setelah satu penekanan tombol. Ketuk lagi untuk membuka kunci secara manual.

### 2.4 Pendeteksian Tekanan Apple Pencil
Pada iPad dengan dukungan Apple Pencil, tulis langsung di layar dengan Pencil. 2syn mengirimkan:
- Nilai tekanan (0–100%)
- Sudut kemiringan pena (sumbu X/Y ±90°)

ke host secara real-time. Aplikasi profesional seperti Procreate dan Adobe Photoshop akan menerima data tekanan dan kemiringan lengkap.

---

## 3. Streaming Audio

Audio sistem host (termasuk suara aplikasi, musik, dll.) secara otomatis di-stream ke perangkat iOS Anda.

- **Tidak ada suara di iOS**: Ketuk tombol「🔇 Ketuk untuk mengaktifkan audio」di sudut kanan atas (kebijakan keamanan browser iOS mengharuskan gestur pengguna sebelum pemutaran audio).
- Setelah terhubung, ketuk「🔊 Mute」untuk mengalihkan bisu.

---

## 4. Sinkronisasi Papan Klip

- **Host → iOS**: Setelah menyalin teks di host, notifikasi Toast muncul di bagian bawah layar iOS menampilkan pratinjau konten yang disalin. Ketuk Toast untuk menulis teks ke papan klip lokal iOS.
- **iOS → Host**: Ketik di keyboard iOS, lalu tekan lama untuk menempel — input dikirim langsung ke kolom yang difokuskan pada host.

---

## 5. Ukuran Tampilan

Tombol「🔍 Ukuran Asli / Sesuaikan Layar」pada bilah alat beralih antara dua mode tampilan:

| Mode | Deskripsi |
|---|---|
| **Sesuaikan Layar** | Layar host diskalakan untuk memenuhi seluruh tampilan iOS |
| **Ukuran Asli** | Tampilan piksel 1:1 dengan dukungan panning, ideal untuk pekerjaan presisi |

---

## 6. Bitrate Adaptif（ABR）

2syn memiliki penyesuaian kualitas otomatis bawaan, mendeteksi RTT jaringan dan kehilangan paket setiap 500 ms:

| Kondisi Jaringan | Penyesuaian Otomatis |
|---|---|
| Baik（RTT < 80 ms, kehilangan < 1%）| Kualitas tinggi, frame rate tinggi |
| Sedang | Kualitas menengah |
| Buruk（RTT > 200 ms atau kehilangan > 5%）| Frame rate dan bitrate dikurangi untuk menjaga stabilitas koneksi |

Indikator titik di sudut kanan atas (hijau / kuning / merah) mencerminkan kualitas koneksi secara real-time.

---

## 7. Mode Layar Hitam Privasi

Centang「Mode Privasi」di antarmuka 2syn **host** untuk menggelapkan layar host, mencegah penonton melihat operasi Anda. Kontrol jarak jauh terus berfungsi normal.

---

## 8. Transfer File

Ketika koneksi stabil (koneksi langsung P2P), seret file ke jendela 2syn dari sisi iOS atau sisi host untuk memicu transfer. Semua transfer dienkripsi end-to-end melalui WebRTC Data Channel.

---

## 9. Putus Koneksi dan Menghubungkan Kembali

Ketuk ⚙️ → 「🚪 Keluar」pada bilah alat untuk mengakhiri sesi. Jika koneksi terputus secara tidak terduga, aplikasi akan menampilkan petunjuk — masukkan kembali ID untuk menghubungkan kembali.

---

## 10. Pertanyaan Umum

**T: Koneksi terjebak di "Menghubungkan..." dan tidak dapat dibangun?**
J: Kedua belah pihak berada di belakang firewall korporat yang ketat (Symmetric NAT) dapat menyebabkan kegagalan NAT traversal. Coba alihkan salah satu pihak ke jaringan seluler 4G/5G dan coba lagi.

**T: Tidak ada audio di iOS?**
J: Ketuk tombol「🔇 Ketuk untuk mengaktifkan audio」di layar. iOS memerlukan gestur pengguna untuk membuka kunci pemutaran audio.

**T: Video buram atau tersendat?**
J: Bitrate Adaptif (ABR) secara otomatis menyesuaikan kualitas berdasarkan kondisi jaringan. Kualitas menurun untuk menjaga kelancaran pada jaringan yang buruk dan pulih secara otomatis saat jaringan membaik.

**T: Apple Pencil tidak memiliki efek tekanan?**
J: Pastikan 2syn di iPad Anda adalah versi terbaru dan 2syn di host telah diperbarui ke v3.5.11 atau lebih baru.

**T: Tidak dapat terhubung setelah memindai kode QR?**
J: Kode QR hanya berisi ID. Konfirmasikan bahwa 2syn di host sedang berjalan dan menampilkan ID yang sama.

---

*2syn v3.5.11 · Dukungan: hubungi kami melalui ulasan App Store atau saluran resmi*
