# Performans optimizasyonları

- Web tarama timeout zinciri uyumlu hale getirildi: JS worker 25 sn, Dart 30 sn.
- Web taramada pahalı GrabCut artık ilk yöntem değil; Canny + morfoloji hızlı yolu eklendi, GrabCut fallback olarak kaldı.
- Web JPEG çıktı kalitesi %94 -> %88 düşürüldü.
- JS -> Dart dönüşünde gereksiz `Array.from` kopyası kaldırıldı.
- Kamera/galeri girişi 3000px/%95 -> 2200px/%88 yapıldı.
- Mobil tarama çıktısı 2400px/%94 -> 2000px/%88 yapıldı.
- Mobil çoklu seçimde en fazla 2 tarama paralel çalışıyor; web tek worker nedeniyle sıralı kalıyor.
- Supabase original/scanned yüklemeleri aynı fiş için paralel hale getirildi.

Not: Arşiv büyüdüğünde `receipts_with_details` için sayfalama ayrıca eklenmelidir.
