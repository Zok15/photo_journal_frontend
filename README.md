# Photo Journal Frontend

Vue 3 + Vite frontend for `photo_journal` backend.

## Production Snapshot

- Public site: `https://photolog.org`
- Public image delivery: `https://photos.photolog.org`
- Backend hosting: Hetzner
- Photo storage backend: Cloudflare R2
- DNS: Cloudflare
- Transactional mail provider: Resend

## Requirements

- Backend is running: `http://127.0.0.1:8091`
- API base URL in `.env`:

```env
VITE_API_BASE_URL=http://127.0.0.1:8091/api/v1
```

## Run

```bash
pnpm install
pnpm dev
```

Open `http://127.0.0.1:5173`.

Default test credentials:
- `admin@example.com`
- `admin12345`
