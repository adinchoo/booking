# Choo Cottage Booking

Static booking and admin dashboard system using:

- HTML/CSS/JavaScript
- Supabase database, auth, and storage
- Vercel deployment

## Pages

- Booking page: `/`
- Admin dashboard: `/dashboard.html`

## Required files

- `index.html`
- `dashboard.html`
- `choo.jpeg`
- `qr.png`
- `site.webmanifest`
- `sw.js`
- `apple-touch-icon.png`

## Notes

The Supabase anon public key is safe to use in frontend only because Row Level Security is enabled.
Never expose the Supabase service role key.