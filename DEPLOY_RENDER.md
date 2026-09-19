# Render ile yayına alma

## GitHub'a gönder
Proje kök klasöründe:

```powershell
git init
git add .
git commit -m "Public deploy"
git branch -M main
git remote add origin https://github.com/a-hazal1/FisToplamaV2.git
git push -u origin main
```

Repo zaten bağlıysa `git remote add origin ...` satırını çalıştırma; sadece `git add .`, `git commit`, `git push` yeterli.

## Render
1. https://dashboard.render.com/ aç.
2. New > Blueprint seç.
3. GitHub hesabını bağla ve `FisToplamaV2` reposunu seç.
4. Render kökteki `render.yaml` dosyasını okuyacak.
5. Apply / Deploy de.
6. Deploy tamamlanınca `https://...onrender.com` adresin oluşur.

Sağlık kontrolü: `/health`

Not: Free Render servisi 15 dakika kullanılmazsa uykuya geçebilir. İlk istek yaklaşık bir dakika sürebilir.
