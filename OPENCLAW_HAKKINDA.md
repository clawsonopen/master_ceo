# OPENCLAW HAKKINDA

Bu not, `openclaw_gateway` adapter'inin neden UI'da bazen "Coming soon" göründüğünü ve bunun teknik bağlamını özetler.

## Kisa Cevap

`openclaw_gateway` Paperclip'te teknik olarak mevcuttur; ancak UI tarafinda bilincli bir gate (`comingSoon: true`) ile varsayilan olarak kapali tutulmustur.

## Kanitlar

1. UI display metadata (main branch)
- `openclaw_gateway` kaydinda `comingSoon: true` bulunuyor.
- Kaynak: https://github.com/paperclipai/paperclip/blob/main/ui/src/adapters/adapter-display-registry.ts

2. Adapter backend'de kayitli
- `openclaw_gateway` server adapter registry'de mevcut.
- Kaynak: https://github.com/paperclipai/paperclip/blob/main/server/src/adapters/registry.ts

3. Resmi docs built-in olarak listeliyor
- OpenClaw Gateway, built-in adapter listesinde yer aliyor.
- Kaynak: https://docs.paperclip.ing/adapters/overview

## Neden "Coming Soon" Olarak Kalabiliyor?

Asagidaki issue/PR'lar, OpenClaw entegrasyonunda auth/session/config hardening surecinin aktif oldugunu gosteriyor. Bu nedenle UI gate korunmus olabilir.

- UI config alanlari eksikti (2/15+)
  - Issue: https://github.com/paperclipai/paperclip/issues/2292
- Session key strategy / izolasyon sorunlari
  - Issue: https://github.com/paperclipai/paperclip/issues/2165
- Heartbeat auth akisinda API key bulunamama vakalari
  - Issue: https://github.com/paperclipai/paperclip/issues/3146
- Orphan reaper false-fail duzeltmesi (gateway run dayanimi)
  - PR: https://github.com/paperclipai/paperclip/pull/2687
- Gerekli session-key gateway config dokumani
  - PR: https://github.com/paperclipai/paperclip/pull/2481

Ek baglam: UI'da OpenClaw'i etkinlestirme amacli ancak acik durumda kalan PR'lar:
- https://github.com/paperclipai/paperclip/pull/888
- https://github.com/paperclipai/paperclip/pull/1901

## Yorumsal Sonuc (Inference)

Bu durum "adapter yok" anlamina gelmiyor. Daha cok "varsayilan UX'te herkese acmadan once entegrasyon stabilitesi + guvenlik + konfig tutarliligi" icin rollout gate'i oldugunu gosteriyor.

## Bizim Proje Acisindan Not

OpenClaw'i acma karari verirsek, asagidaki kontrol listesiyle ilerlemek daha guvenli olur:
- Auth akisi (token/JWT/secret_ref) dogrulama
- Session key strategy dogrulama (`issue/run/fixed` davranislari)
- Adapter UI form alanlarinin tum gerekli config'i kapsadigini dogrulama
- Heartbeat -> run -> transcript -> cost/usage zincirinin e2e testi
- Policy/guardrail uyumlulugu (izin ve scope denetimleri)
