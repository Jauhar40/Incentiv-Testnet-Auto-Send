# Incentiv Testnet Auto Send V2

Bot otomatis untuk melakukan transfer TCENT di Incentiv Testnet dengan fitur multi-wallet dan berbagai mode transfer.

## 🌟 Fitur Utama

- **Multi-Wallet Support** - Kelola multiple wallet sekaligus
- **3 Transfer Mode** - Fixed Amount, Random Amount, Send All
- **Multi-Wallet Mode** - Kirim dari wallet ke wallet secara berurutan (1-to-1 mapping)
- **Auto Login & Token Management** - Menyimpan token login untuk menghindari login berulang
- **Proxy Support** - HTTP/HTTPS dan SOCKS proxy
- **Smart Wallet Detection** - Deteksi dan skip wallet yang belum di-deploy
- **Iteration Control** - Set maximum iterations atau unlimited
- **Real-time Dashboard** - TUI (Terminal User Interface) dengan blessed
- **Transaction Logs** - Log lengkap dengan timestamp dan color coding
- **Auto-save Configuration** - Semua setting tersimpan otomatis

## 📋 Prerequisites

- Node.js v16 atau lebih tinggi
- Akun Incentiv Testnet yang sudah terdaftar

## 🔗 Registration

**IMPORTANT:** Sebelum menggunakan bot, Anda harus register akun terlebih dahulu di:

👉 **https://testnet.incentiv.io/login?refCode=61M5szisueG2sZqPuNGNCF**

Setelah register:
1. Login ke dashboard
2. **Lakukan minimal 1x transaksi** dari website untuk deploy smart wallet
3. Bot hanya bisa mengirim dari wallet yang sudah di-deploy

## 📦 Installation

1. Clone repository:
```bash
git clone https://github.com/Jauhar40/Incentiv-Testnet-Auto-Send.git
cd incentiv-autosend
```

2. Install dependencies:
```bash
npm install
```

3. Setup file konfigurasi:
```bash
# Private keys (satu per baris)
nano pk.txt

# Recipient addresses (satu per baris)
nano wallet.txt

# Proxy (opsional, satu per baris)
nano proxy.txt
```

## 📁 File Structure
```
incentiv-autosend/
├── autosend.js       # Main script
├── package.json      # Dependencies
├── pk.txt            # Private keys (JANGAN COMMIT!)
├── wallet.txt        # Recipient addresses
├── proxy.txt         # Proxy list (optional)
├── token.js          # Auto-generated tokens (JANGAN COMMIT!)
└── config.json       # Auto-generated config (JANGAN COMMIT!)
```

## 🚀 Cara Penggunaan

### Start Bot
```bash
node autosend.js
```

### Menu Navigation
Gunakan **arrow keys** (↑↓) untuk navigasi menu dan **Enter** untuk select.

### Main Menu Options

1. **Active All Account** - Login semua wallet dan simpan token
2. **Start Auto Transfer** - Mulai auto transfer
3. **Stop Auto Transfer** - Stop proses transfer
4. **Set Transfer Config** - Set jumlah TCENT untuk fixed mode
5. **Toggle Transfer Mode** - Switch antara Fixed/Random/Send All
6. **Toggle Multi-Wallet Mode** - Enable/disable multi-wallet mode
7. **Set Random Percentage Range** - Set min-max % untuk random mode
8. **Set Max Iterations** - Set maksimal iterasi (0 = unlimited)
9. **Reset Iteration Counter** - Reset counter ke 0
10. **Refresh** - Refresh wallet data
11. **Clear Logs** - Clear transaction logs
12. **Exit** - Keluar dari aplikasi

## ⚙️ Transfer Modes

### 1. Fixed Amount Mode
Transfer jumlah TCENT yang tetap setiap transaksi.
```
Example: Transfer 0.05 TCENT setiap kali
```

### 2. Random Amount Mode
Transfer persentase random dari balance (setelah gas reserve).
```
Settings:
- Min Percentage: 50%
- Max Percentage: 100%
- Gas Reserve: 0.02 TCENT

Example: Jika balance 1 TCENT, akan transfer 0.49-0.98 TCENT (random)
```

### 3. Send All Mode
Transfer semua balance minus gas reserve.
```
Example: Balance 1 TCENT, gas reserve 0.02, akan transfer 0.98 TCENT
```

## 🔄 Multi-Wallet Mode

### Enabled (Multi-Wallet Mode)
Bot akan mengirim dari wallet ke wallet secara berurutan (1-to-1 mapping):
```
Account 1 -> Recipient 1
Account 2 -> Recipient 2
Account 3 -> Recipient 3
...
```

**PENTING:** Jumlah account di `pk.txt` harus sama dengan jumlah recipient di `wallet.txt`

### Disabled (Random Mode)
Bot akan memilih recipient secara random untuk setiap account:
```
Account 1 -> Random Recipient (2, 3, or 4)
Account 2 -> Random Recipient (1, 3, or 4)
Account 3 -> Random Recipient (1, 2, or 4)
...
```

## 📊 Dashboard Components

### 1. Header
Menampilkan judul aplikasi

### 2. Main Menu
Menu navigasi utama

### 3. Wallet Information
Menampilkan:
- Smart wallet address
- TCENT balance
- Deploy status (✓ = deployed, ✗ = not deployed)
- Target recipient (jika multi-wallet mode)

### 4. Status Bar
Menampilkan:
- Bot status (Running/Idle)
- Active account
- Total accounts
- Transfer mode dan settings
- Current iteration

### 5. Transaction Logs
Real-time logs dengan color coding:
- 🔴 Red = Error
- 🟢 Green = Success
- 🟡 Yellow = Warning
- 🔵 Cyan = Info
- 🟣 Magenta = Wait

## 🔐 Proxy Format

### HTTP/HTTPS Proxy
```
http://username:password@host:port
https://username:password@host:port
```

### SOCKS Proxy
```
socks4://host:port
socks5://username:password@host:port
```

### Example (proxy.txt)
```
http://user:pass@proxy1.com:8080
socks5://user:pass@proxy2.com:1080
http://proxy3.com:3128
```

## 💡 Tips & Best Practices

1. **Selalu deploy wallet terlebih dahulu** - Lakukan minimal 1x transaksi dari website sebelum menggunakan bot
2. **Multi-wallet mode** - Pastikan jumlah pk.txt = wallet.txt untuk menghindari error
3. **Gas reserve** - Set gas reserve minimal 0.02 TCENT untuk memastikan transaksi berhasil
4. **Iteration limit** - Set max iterations untuk mencegah bot berjalan terus-menerus
5. **Proxy usage** - Gunakan proxy untuk menghindari rate limiting
6. **Token persistence** - Bot menyimpan token di `token.js` untuk menghindari login berulang

## ⚠️ Important Notes

### Smart Wallet Deployment
Bot **HANYA** bisa mengirim dari wallet yang sudah di-deploy. Wallet yang belum di-deploy akan di-skip dengan warning:
```
Wallet not deployed - SKIPPING (needs first transaction from website)
```

**Solution:** Login ke https://testnet.incentiv.io dan lakukan transaksi pertama untuk deploy wallet.

### Account & Recipient Mismatch
Jika multi-wallet mode enabled dan jumlah tidak sama:
```
ERROR: Multi-wallet mode requires equal number of accounts and recipients!
Active accounts: 10, Recipients: 8
```

**Solution:** 
- Disable multi-wallet mode, ATAU
- Pastikan pk.txt dan wallet.txt memiliki jumlah entry yang sama

## 🛡️ Security Warning

**CRITICAL - BACA INI:**

1. **JANGAN PERNAH** commit atau upload file berikut ke GitHub:
   - `pk.txt` (berisi private keys)
   - `token.js` (berisi access tokens)
   - `config.json` (mungkin berisi data sensitif)
   - `proxy.txt` (berisi proxy credentials)

2. **JANGAN SHARE** private key atau token kepada siapapun

3. **GUNAKAN** di environment yang aman

### Tambahkan ke `.gitignore`:
```gitignore
# Critical files - NEVER COMMIT
pk.txt
token.js
config.json
proxy.txt
wallet.txt

# Node modules
node_modules/

# Logs
*.log
npm-debug.log*
```

## 🐛 Troubleshooting

### Bot tidak bisa login
- Pastikan akun sudah terdaftar di Incentiv Testnet
- Cek apakah private key valid
- Cek koneksi internet atau proxy

### Wallet not deployed
- Login ke website dan lakukan transaksi pertama
- Tunggu beberapa menit hingga wallet ter-deploy di blockchain

### Transaction failed
- Pastikan balance cukup (minimal > gas reserve)
- Cek apakah recipient address valid
- Cek koneksi proxy (jika digunakan)

### Multi-wallet mode error
- Pastikan jumlah pk.txt = wallet.txt
- Atau disable multi-wallet mode

## 📖 Example Workflow
```bash
# 1. Setup files
echo "0x1234..." > pk.txt
echo "0xabcd..." >> pk.txt
echo "0xRecipient1..." > wallet.txt
echo "0xRecipient2..." >> wallet.txt

# 2. Start bot
node autosend.js

# 3. Menu: Active All Account
# Bot akan login semua wallet dan simpan token

# 4. Menu: Toggle Transfer Mode
# Pilih mode: Fixed/Random/Send All

# 5. Menu: Set Transfer Config
# Set amount atau percentage range

# 6. Menu: Start Auto Transfer
# Bot mulai transfer otomatis

# 7. Monitor logs dan status
# Lihat progress di dashboard

# 8. Menu: Stop Auto Transfer (jika perlu)
# Stop bot dengan aman
```

## 🔧 Configuration File (config.json)
```json
{
  "transferMode": "random",
  "tcentAmount": 0.05,
  "gasReserve": 0.02,
  "minPercentage": 50,
  "maxPercentage": 100,
  "maxIterations": 0,
  "currentIteration": 0,
  "multiWalletMode": true
}
```

File ini auto-generated dan auto-saved setiap kali Anda mengubah settings.

## 📊 Performance

- **Login**: ~2-3 detik per account
- **Transfer**: ~5-10 detik per transaksi
- **Delay**: 30 detik antar account (bisa diubah di code)
- **Retry**: Otomatis retry 3x untuk connection issues

## 🎯 Use Cases

- Distribusi testnet token ke multiple wallets
- Testing smart contract interactions
- Automated testnet token management
- Volume generation untuk testnet

## ⚖️ License

MIT License - Free to use

## ⚠️ Disclaimer

Tool ini dibuat untuk **Incentiv Testnet** (testing environment). Author tidak bertanggung jawab atas:
- Kehilangan aset (meskipun ini testnet)
- Penyalahgunaan tool
- Pelanggaran terms of service
- Masalah teknis yang timbul

**Gunakan dengan bijak dan bertanggung jawab.**

---

## 📞 Support

Jika ada masalah atau pertanyaan:
1. Baca dokumentasi dengan teliti
2. Cek troubleshooting section
3. Buka issue di GitHub

**Happy Testing! 🚀**

---

**Register Incentiv Testnet:** https://testnet.incentiv.io/login?refCode=61M5szisueG2sZqPuNGNCF
