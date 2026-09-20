# Render Free deploy

1. Ushbu papkani GitHub repository sifatida push qiling.
2. Render dashboardda **New > Blueprint** ni tanlang.
3. GitHub repositoryni ulang va `render.yaml` faylini tanlang.
4. **Apply** tugmasini bosing.
5. Render bergan `https://...onrender.com` manzilni oching.

Tekshiruv:

```text
https://YOUR-SERVICE.onrender.com/api/health
```

Render Free uyqu rejimiga o‘tishi mumkin. Hozirgi JSON saqlash `data/` ichida bo‘ladi va qayta deploy/restart paytida yo‘qolishi mumkin. Doimiy production ma’lumotlari uchun keyingi bosqichda Supabase yoki PostgreSQL ulash kerak.
