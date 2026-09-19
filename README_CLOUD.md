# Fiş Toplama Cloud v6

Bu sürümde taranan fişler ve oluşturulan PDF'ler tarayıcı IndexedDB'si yerine
Supabase Database + Supabase Storage üzerinde kullanıcı hesabına bağlı tutulur.

## İlk kurulum

1. Supabase Dashboard'a girin.
2. SQL Editor > New query açın.
3. `SUPABASE_SETUP.sql` dosyasının tamamını yapıştırıp **Run** deyin.
4. Authentication > Users bölümünde kullanıcılarınızın bulunduğunu kontrol edin.
5. Projeyi Render'a deploy edin.

`frontend/config.js` mevcut Supabase Project URL ve publishable key ile hazırdır.

## Sonuç

- Aynı kullanıcı telefondan ve PC'den aynı fişleri görür.
- Çıkış yapmak kayıtları silmez.
- Taranan görüntü + orijinal görüntü bulutta saklanır.
- Köşe düzeltme farklı cihazda da çalışır.
- PDF arşivi farklı cihazlarda görünür.
- Sil işlemi hem veritabanından hem Storage'dan siler.
- RLS sayesinde bir kullanıcı başka kullanıcının kayıtlarını göremez.

## Render

Blueprint kullanıyorsanız `render.yaml` hazırdır.
GitHub'a push ettikten sonra Render otomatik deploy edebilir.
