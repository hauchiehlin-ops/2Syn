# Dasar Privasi 2syn

**Kemas Kini Terakhir:** 26 Jun 2026

Selamat datang ke **2syn** (selepas ini dirujuk sebagai "Perisian" atau "kami"). Dasar Privasi ini menerangkan bagaimana Perisian mengumpul, menggunakan, dan melindungi data anda.

**Komitmen Teras: Kami tidak memintas, menyimpan, atau menganalisis sebarang skrin desktop jauh, audio, atau data input anda.**

---

## Satu. Data Yang Kami Kumpul dan Tujuannya

Untuk menyediakan perkhidmatan sambungan asas, kami hanya mengumpul maklumat minimum yang diperlukan berikut:

### 1. Data Pertukaran Isyarat（SDP／ICE Candidates）
- **Tujuan**: Untuk membantu dua peranti anda (hos dan klien) melepasi tembok api dan mewujudkan sambungan WebRTC hujung-ke-hujung (P2P).
- **Pengendalian**: Data handshake rangkaian sementara ini (termasuk IP tempatan atau awam) dimusnahkan serta-merta selepas sambungan diwujudkan. **Pelayan isyarat Perisian tidak pernah merekodkan atau menyimpan sebarang paket handshake rangkaian secara berterusan.**

### 2. Keutamaan Aplikasi
- **Tujuan**: Untuk menyimpan tetapan bahasa, mod paparan, dan keutamaan lain anda untuk digunakan secara automatik pada permulaan seterusnya.
- **Pengendalian**: Disimpan hanya pada peranti anda secara tempatan (iOS UserDefaults) dan tidak dihantar ke mana-mana pelayan.

---

## Dua. Data Yang Tidak Kami Kumpul

Berdasarkan seni bina E2EE terdesentralisasi 2syn, kami menjamin dengan ketat:

1. **Skrin jauh, video, dan audio**: Semua strim dihantar secara hujung-ke-hujung terus antara dua peranti anda. Tiada pihak ketiga, termasuk kami, yang boleh memintas atau menyahsulit.
2. **Input papan kekunci, tetikus, dan sentuhan**: Semua arahan input dihantar secara tempatan melalui P2P dan tidak melalui mana-mana pelayan.
3. **Data tekanan dan kecondongan Apple Pencil**: Data tekanan pensel dihantar terus antara peranti dan tidak disimpan di mana-mana pelayan.
4. **Maklumat Peribadi yang Boleh Dikenal Pasti (PII)**: Perisian tidak memerlukan anda memberikan nama, alamat e-mel, atau nombor telefon.
5. **Data lokasi**: Perisian tidak mengakses GPS atau lokasi tepat anda.
6. **Kamera atau mikrofon**: Klien iOS tidak mengakses kamera atau mikrofon.

---

## Tiga. Perkongsian Data dan Pendedahan Pihak Ketiga

Kami **tidak pernah menjual, menukar, atau menyewakan** sebarang maklumat anda kepada pihak ketiga.

Satu-satunya pengecualian: Apabila dipaksa secara undang-undang (cth., perintah mahkamah), kami mungkin secara sah menyediakan log sambungan minimum (cap masa sambungan) yang tersimpan pada pelayan isyarat. Walau bagaimanapun, kami tidak mampu secara teknikal untuk menyediakan skrin jauh atau kandungan yang dihantar.

---

## Empat. Penggunaan Pelayan STUN

Perisian menggunakan pelayan STUN awam (cth., yang disediakan oleh Google) untuk membantu peranti menemui alamat IP awam mereka untuk NAT traversal. Pelayan-pelayan ini hanya menyediakan resolusi IP dan tidak dapat mengakses kandungan sambungan anda. Dasar privasi mereka dikawal oleh pembekal masing-masing.

Perisian menggunakan seni bina STUN-only dan **tidak menggunakan pelayan geganti TURN secara lalai**. Semua sambungan adalah terus.

---

## Lima. Keselamatan Data

- Komunikasi hujung-ke-hujung menggunakan protokol penyulitan DTLS 1.3 / SRTP terbina dalam WebRTC.
- Keutamaan aplikasi disimpan dalam kotak pasir sistem iOS dan dilindungi oleh keselamatan asal iOS.

---

## Enam. Privasi Kanak-Kanak

Perisian ini direka untuk pengguna berumur 13 tahun ke atas. Kami tidak mengumpul maklumat peribadi daripada kanak-kanak di bawah 13 tahun secara sedar.

---

## Tujuh. Perubahan Pada Dasar Ini

Jika terdapat perubahan ketara pada dasar ini, kami akan menyiarkan pengumuman dalam Perisian atau di laman web rasmi kami. Penggunaan berterusan Perisian ini merupakan persetujuan anda terhadap dasar yang dikemas kini.

---

## Lapan. Hubungi Kami

Jika anda mempunyai sebarang soalan mengenai Dasar Privasi ini, sila hubungi kami melalui halaman ulasan App Store atau saluran sokongan pelanggan rasmi kami.
