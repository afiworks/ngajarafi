# Star Class · Ngajar Afi

Aplikasi apresiasi interaktif untuk sesi Pemol. Nuansa biru-putih corporate dengan bintang emas, tanpa menampilkan diri sebagai aplikasi resmi BCA.

## Fitur

- Peserta scan QR atau memasukkan kode kelas 8 karakter.
- Nama + passcode pribadi minimal 6 karakter; masuk kembali dengan identitas yang sama.
- Halaman peserta hanya menampilkan identitas sendiri, total bintang sendiri, dan tombol klaim.
- Pengajar memasukkan passcode khusus, mengisi nama, dan membuat sesi. Tidak perlu akun ChatGPT. Passcode diperiksa di server; akses dashboard memakai cookie HttpOnly yang berlaku 12 jam. Gunakan **Kunci pengajar** untuk keluar.
- Leaderboard, podium, peringkat seri, pencarian aktivitas, dan tampilan presentasi.
- Sinkronisasi otomatis setiap 1 detik pada dashboard; setiap 2 detik pada halaman peserta. Ini menggunakan polling, bukan WebSocket. Internet diperlukan.
- Efek suara bintang asli melalui Web Audio. Klik **Aktifkan suara** sekali di laptop. Peramban harus tetap terbuka; perangkat/OS dapat membatasi suara saat tab tidak aktif.
- Jeda/buka klaim, tutup/buka kembali sesi, pembatalan bintang dengan alasan, serta ekspor CSV seluruh skor dan riwayat (WIB).
- Waktu server, penyimpanan D1 permanen, idempotency key, pembatasan klaim 3 detik, pencatatan pembatalan, dan rate limit pendaftaran/login.
- Tampilan mobile, navigasi keyboard, focus trap dialog, dan preferensi reduced motion.

## Cara menggunakan

1. Buka aplikasi, pilih **Saya pengajar**, lalu masukkan passcode pengajar.
2. Masukkan nama pengajar dan judul sesi. Buat kelas.
3. Klik **Aktifkan suara** dan **Gabung kelas** untuk menampilkan QR.
4. Peserta scan QR, isi nama lengkap serta passcode pribadi. Nama langsung muncul pada dashboard.
5. Peserta berbicara lalu menekan **Ambil bintang** setelah arahan pengajar.
6. Gunakan **Jeda klaim** saat dibutuhkan. Klaim yang tidak sah dapat dibatalkan dengan alasan melalui riwayat.
7. Gunakan **Unduh rekap** sebelum/selepas mengakhiri sesi.

Nama yang sama (termasuk perbedaan kapital) dalam satu kelas dianggap identitas yang sama. Jika dua orang bernama sama, tambahkan pembeda pada nama. Passcode tidak ditampilkan kepada pengajar dan belum memiliki fitur pemulihan mandiri; peserta harus mengingatnya.

### Akses situs

Situs sudah publik untuk peserta. Halaman pengajar dan API pengelolaan memerlukan passcode khusus. Semua sesi dalam aplikasi Afi dapat dikelola setelah passcode pengajar valid, termasuk sesi lama. Peserta hanya mendapat data dirinya sendiri.

Passcode pengajar disimpan sebagai secret runtime `TEACHER_PASSCODE` pada hosting, bukan di source, README, atau bundle browser. Login dibatasi 8 percobaan per alamat IP per 15 menit. Cookie pengajar berlaku 12 jam, tersimpan sebagai hash di database, dapat dicabut saat logout, dan otomatis tidak berlaku saat secret diganti. Fitur **Kunci pengajar** tersedia pada halaman daftar sesi.

Repo ini adalah aplikasi Vinext + Cloudflare D1 untuk Sites. Untuk pindah hosting, integrasi runtime dan database harus diadaptasi.

## Pengembangan

Runtime Node.js >= 22.13 (pengujian SQLite membutuhkan versi Node yang menyediakan `node:sqlite`; direkomendasikan Node 24). Gunakan versi package manager pada `package.json`.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm test
pnpm exec tsc --noEmit
pnpm build
pnpm dev
```

Starter Sites mempertahankan integrasi build dan database. Skema ada di `db/schema.ts`; migrasi di `drizzle/`. Setelah perubahan skema jalankan `pnpm db:generate`. Deploy Sites mengaplikasikan migrasi ke D1 sebelum memublikasikan Worker. Database lokal berbeda dari database produksi.

## Struktur

- `app/page.tsx`: UI landing, peserta, dan pengajar.
- `app/globals.css`: desain responsif.
- `app/api/classroom/route.ts`: API, otorisasi, validasi, hashing, dan operasi atomik.
- `app/chatgpt-auth.ts`: helper bawaan starter yang tidak dipakai untuk login aplikasi.
- `db/schema.ts`, `drizzle/`: skema dan migrasi.
- `tests/classroom.test.mjs`: integrasi handler API dengan SQLite in-memory (mock hanya binding D1 dan secret runtime).
- `.openai/hosting.json`: identitas project hosting dan binding DB; tidak mengandung credential.

## Integritas & batasan

Passcode di-hash menggunakan PBKDF2 SHA-256 (100.000 iterasi dengan salt unik). Token peserta di-hash dalam database dan disimpan pada cookie HttpOnly, Secure, SameSite=Lax selama 7 hari. Mutasi memverifikasi Origin. Query SQL memakai parameter. Backend tidak menerima skor atau identitas target dari peserta. Retry jaringan dengan request ID yang sama tidak menambah skor lagi. Klaim bersamaan tetap dibatasi lewat satu statement SQL atomik.

Sistem menghargai kejujuran: server tidak mengetahui siapa yang benar-benar mendapat arahan lisan. Rate limit dan riwayat membantu pengajar meninjau, bukan bukti otomatis kecurangan. Pengajar bisa menjeda semua klaim atau membatalkan bintang. Pembatalan tidak menghapus riwayat dan tidak mengurangi skor dua kali.

Tidak ada data contoh pada database produksi. Tidak ada passcode atau kunci rahasia di repo. Uji integrasi dan build tidak menggantikan uji fisik dua perangkat, suara browser, dan scan kamera sebelum kelas. Fokus penggunaan: kelas interaktif berukuran kecil–menengah, bukan event ribuan koneksi bersamaan.
