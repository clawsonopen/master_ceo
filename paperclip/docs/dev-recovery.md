# Dev Recovery (Windows / Embedded Postgres)

Bu dokuman, `pnpm dev` veya `pnpm dev:once` calisirken gelisen dongu/crash sorunlarini hizlica toparlamak icin kullanilir.

Not: `pnpm dev` / `pnpm dev:once` acilisinda artik otomatik preflight recovery calisir (stale process temizligi + tek instance/port kontrolu + startup health gate). Bu dokuman manuel fallback adimlari icindir.

Port davranisi:
- Hedef portta Paperclip process'i tespit edilirse auto-recovery onu kapatmayi dener.
- Paperclip disi bilinmeyen process portu tutuyorsa guvenlik icin otomatik kill yapmaz; net hata verir.

## Tipik Semptomlar

- `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL`
- `ELIFECYCLE Command failed`
- cikis kodu bazen `3221225786` veya `1`
- `localhost:3100` acilmaz (`ERR_CONNECTION_REFUSED`)
- loglarda su ifade gorulur:
  - `Failed to start embedded PostgreSQL ... pre-existing shared memory block is still in use`

## Hizli Cozum (Runbook)

1. Dev servisleri durdur:
   - `pnpm dev:stop`
2. Kalan postgres processlerini zorla kapat (PowerShell):
   - `Get-Process | Where-Object { $_.ProcessName -eq 'postgres' } | Stop-Process -Force`
3. Dev ortamini yeniden kaldir:
   - `pnpm dev:once`
4. Health kontrolu yap:
   - `Invoke-WebRequest http://127.0.0.1:3100/api/health -UseBasicParsing`

Beklenen sonuc:

- Health `200` doner.
- Uygulama `http://127.0.0.1:3100` uzerinde acilir.

## Ek Notlar

- Bazen birden fazla server ayaga kalkip farkli portlara dagilabilir (ornegin `3100` ve `3108`).
- Manuel testleri her zaman `3100` uzerinden dogrula.
- Kod degisikligini test etmeden once bu recovery adimlari gerekirse tekrar calistirilabilir.

## Prod Davranisi Notu

Bu runbook gelistirme (dev) icindir. Uretim/paketli kullanimda hedef davranis:

- Uygulama bu tip runtime kilitlenmelerini otomatik toparlamali.
- Son kullanicidan terminal komutu beklenmemeli.
- Bu recovery adimlari veri sifirlama degil, sadece runtime lock/process sorunlarini temizleme amaclidir.
