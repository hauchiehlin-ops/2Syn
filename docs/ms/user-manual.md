# Manual Pengguna 2syn

Selamat datang ke **2syn**! 2syn adalah sistem desktop jauh berprestasi tinggi dan selamat yang menggabungkan penyulitan hujung-ke-hujung WebRTC dengan teknologi kadar bit adaptif, menyokong sambungan silang platform dari hos macOS/Windows ke klien iOS/macOS.

---

## 1. Padanan Sambungan

### 1.1 Dapatkan ID Hos
Lancarkan 2syn pada **hos** (komputer yang dikawal):
- ID 9 digit akan dipaparkan dalam medan「My ID」di bahagian atas skrin (cth. `569-639-684`).
- Klik butang 📋 di sebelah ID untuk menyalinnya, atau klik butang ⬛ untuk memaparkan kod QR.

### 1.2 Sambung daripada Peranti iOS
1. Lancarkan aplikasi 2syn di iOS.
2. Masukkan ID hos secara manual dalam medan「Connect to」, atau minta hos memaparkan kod QR dan imbas menggunakan kamera asal iOS — ID akan diisi secara automatik.
3. Ketik「Connect」. Sistem secara automatik melaksanakan NAT traversal melalui STUN dan mewujudkan sambungan terus hujung-ke-hujung — tiada konfigurasi Port Forwarding penghala diperlukan.

---

## 2. Kawalan Jauh

### 2.1 Menukar Mod Kawalan
Selepas disambungkan, ketik butang ⚙️ pada bar alat kanan atas untuk membuka panel dan beralih antara dua mod kawalan:

| Mod | Penerangan |
|---|---|
| **Trackpad（Mod Pad Sentuh）** | Seret jari = gerak kursor；ketik satu jari = klik kiri；luncur dua jari atas bawah = skrol；ketik dua jari = klik kanan |
| **Direct Touch（Mod Sentuh Terus）** | Koordinat sentuhan dipetakan terus ke koordinat skrin hos |

### 2.2 Skrol Dua Jari
Dalam mod Trackpad, luncurkan dua jari ke atas atau ke bawah pada skrin untuk menghantar peristiwa skrol ke hos. Berfungsi dengan semua aplikasi.

### 2.3 Input Papan Kekunci
1. Ketik ikon papan kekunci pada bar alat untuk membawa naik papan kekunci skrin iOS.
2. Bar alat kekunci pengubah suai (Esc, Tab, ⌃, ⌥, ⌘, ⇧, kekunci anak panah) muncul di atas papan kekunci untuk menghantar pintasan papan kekunci.
3. Ketik kekunci pengubah suai sekali untuk menguncinya (menyala biru); ia dibuka kunci secara automatik selepas satu tekanan kekunci. Ketik lagi untuk membuka kunci secara manual.

### 2.4 Pengesanan Tekanan Apple Pencil
Pada iPad yang menyokong Apple Pencil, tulis terus pada skrin dengan Pencil. 2syn menghantar:
- Nilai tekanan (0–100%)
- Sudut kecondongan pena (paksi X/Y ±90°)

ke hos secara masa nyata. Aplikasi profesional seperti Procreate dan Adobe Photoshop akan menerima data tekanan dan kecondongan penuh.

---

## 3. Penstriman Audio

Audio sistem hos (termasuk bunyi aplikasi, muzik, dll.) distriming secara automatik ke peranti iOS anda.

- **Tiada bunyi di iOS**: Ketik butang「🔇 Ketik untuk aktifkan audio」di kanan atas (dasar keselamatan penyemak imbas iOS memerlukan gerak isyarat pengguna sebelum main balik audio).
- Selepas disambungkan, ketik「🔊 Mute」untuk togol redam.

---

## 4. Penyegerakan Papan Klip

- **Hos → iOS**: Selepas menyalin teks pada hos, pemberitahuan Toast muncul di bahagian bawah skrin iOS menunjukkan pratonton kandungan yang disalin. Ketik Toast untuk menulis teks ke papan klip tempatan iOS.
- **iOS → Hos**: Taip pada papan kekunci iOS, kemudian tekan lama untuk menampal — input dihantar terus ke medan berfokus pada hos.

---

## 5. Saiz Paparan

Butang「🔍 Saiz Asal / Muatkan Skrin」pada bar alat beralih antara dua mod paparan:

| Mod | Penerangan |
|---|---|
| **Muatkan Skrin** | Skrin hos diskalakan untuk memenuhi keseluruhan paparan iOS |
| **Saiz Asal** | Paparan piksel 1:1 dengan sokongan pan, sesuai untuk kerja yang memerlukan ketepatan |

---

## 6. Kadar Bit Adaptif（ABR）

2syn mempunyai pelarasan kualiti automatik terbina dalam, mengesan RTT rangkaian dan kehilangan paket setiap 500 ms:

| Keadaan Rangkaian | Pelarasan Automatik |
|---|---|
| Baik（RTT < 80 ms, kehilangan < 1%）| Kualiti tinggi, kadar bingkai tinggi |
| Sederhana | Kualiti sederhana |
| Lemah（RTT > 200 ms atau kehilangan > 5%）| Kadar bingkai dan kadar bit dikurangkan untuk mengekalkan kestabilan sambungan |

Penunjuk titik di kanan atas (hijau / kuning / merah) mencerminkan kualiti sambungan secara masa nyata.

---

## 7. Mod Skrin Hitam Privasi

Tandakan「Mod Privasi」dalam antara muka 2syn **hos** untuk menghitamkan skrin hos, menghalang penonton daripada melihat operasi anda. Kawalan jauh terus berfungsi dengan normal.

---

## 8. Pemindahan Fail

Apabila sambungan stabil (sambungan terus P2P), seret fail ke dalam tetingkap 2syn dari mana-mana pihak iOS atau pihak hos untuk mencetuskan pemindahan. Semua pemindahan disulitkan hujung-ke-hujung melalui WebRTC Data Channel.

---

## 9. Putus Sambungan dan Sambung Semula

Ketik ⚙️ → 「🚪 Log keluar」pada bar alat untuk menamatkan sesi. Jika sambungan terputus secara tidak dijangka, aplikasi akan memaparkan gesaan — masukkan semula ID untuk menyambung semula.

---

## 10. Soalan Lazim

**S: Sambungan tersekat pada "Sedang menyambung..." dan tidak dapat diwujudkan?**
J: Kedua-dua pihak berada di belakang tembok api korporat yang ketat (Symmetric NAT) mungkin menyebabkan NAT traversal gagal. Cuba tukar salah satu pihak ke rangkaian mudah alih 4G/5G dan cuba semula.

**S: Tiada audio di iOS?**
J: Ketik butang「🔇 Ketik untuk aktifkan audio」pada skrin. iOS memerlukan gerak isyarat pengguna untuk membuka kunci main balik audio.

**S: Video kabur atau perlahan?**
J: Kadar Bit Adaptif (ABR) secara automatik melaraskan kualiti berdasarkan keadaan rangkaian. Kualiti menurun untuk mengekalkan kelancaran pada rangkaian yang lemah dan pulih secara automatik apabila rangkaian bertambah baik.

**S: Apple Pencil tiada kesan tekanan?**
J: Pastikan 2syn pada iPad anda adalah versi terkini dan 2syn pada hos telah dikemas kini ke v3.5.11 atau lebih baharu.

**S: Tidak dapat disambungkan selepas mengimbas kod QR?**
J: Kod QR hanya mengandungi ID. Sahkan bahawa 2syn pada hos sedang berjalan dan menunjukkan ID yang sama.

---

*2syn v3.5.11 · Sokongan: hubungi kami melalui ulasan App Store atau saluran rasmi*
