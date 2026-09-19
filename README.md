# FisToplama Hybrid Scanner v4

Bu sürümde:
- 4 köşe tespiti + perspective tarama korunur.
- Warp sonrasında kalan koyu klavye/masa yan şeritleri güvenli şekilde temizlenir.
- Taranan fişler IndexedDB'de kullanıcı bazlı kalır.
- Oluşturulan PDF'ler de IndexedDB PDF arşivine kaydedilir; çıkış/giriş sonrası tekrar görünür ve indirilebilir.
- Kartlardaki Köşeleri düzelt / İndir / Sil eylemleri her render'da korunur ve görünür tutulur.

Çalıştırma:
1. `cd backend`
2. `python -m pip install -r requirements.txt`
3. `python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload`
4. `http://127.0.0.1:8000`

Not: Yerel arşiv aynı tarayıcı/cihaz için kalıcıdır. Farklı cihazlarda ortak arşiv için Supabase Storage/DB gerekir.
