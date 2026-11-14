# UBUZIMA PHARMA website

A responsive static website for UBUZIMA PHARMA, connected to the pharmacy product API and WhatsApp enquiries.

## Files

- `index.html` — public homepage and catalogue preview
- `medicines.html` — patient/customer catalogue and browser-local cart
- `news.html` — public pharmacy news and videos
- `newsletter-confirm.html`, `newsletter-unsubscribe.html`, `staff-invite.html` — email and staff invitation flows
- `forgot-password.html`, `password-reset.html` — staff and patient password recovery
- `admin/` — admin dashboard
- `pharmacist/` — pharmacist dashboard
- `about.html`, `values.html`, `contact.html` — pharmacy information
- `styles.css`, `app.js` — shared design and browser behavior
- `config.js` — API URL and pharmacy contact settings

## Product catalogue and dashboards

The homepage and medicines page read available product names, details, images, and BIF prices from the API. Each product links to a full detail page with its available ingredients, strength, dosage form, pack size, manufacturer, directions, warnings, and storage information. Staff can add those optional fields when uploading or editing a medicine; existing fields and catalogue actions remain unchanged. Customers can search the catalogue, keep a cart in their browser, and send an order enquiry through WhatsApp. Checkout and payment are not implemented.

The admin and pharmacist dashboards require staff email sign-in. The admin account is provisioned with `ubuzimapharma@gmail.com` by default; pharmacists use the email assigned by the admin. Staff can create, edit, hide, restore, or remove products, upload images, and review recent product changes.

The public catalogue and browser cart are the patient-facing dashboard for this MVP. No patient account or health information is collected, and the website does not offer diagnosis. API/database setup, staff provisioning, deployment, and backup instructions are in the backend project's `README.md`.

Signed-in staff can publish news and YouTube/Vimeo links from either staff dashboard. The homepage/news page display published articles. Newsletter signup is opt-in and requires email confirmation; invitations, confirmation, and password recovery messages use the SMTP or Resend provider configured by the backend. `ubuzimapharma@gmail.com` is the Reply-To address.

Staff and patient login pages link to password recovery. Recovery emails use the backend's configured SMTP or Resend provider; reset links are single-use and expire after one hour.

## Configuration and local preview

1. In `config.js`, set `apiBaseUrl` to the backend origin (`http://localhost:4000` for local development) and replace `257XXXXXXXX` with the official WhatsApp number.
2. Follow the backend README to configure PostgreSQL, add `STAFF_PASSWORD` to the backend `.env`, and run `npm run create:staff` to provision the initial admin.
3. Serve this folder on `http://localhost:3000` (for example, run `npx serve . -l 3000`) while the API is running.
4. Open `index.html`, `medicines.html`, `/admin/`, or `/pharmacist/`.

For production, configure the exact website origin in backend `CORS_ORIGINS`, use HTTPS, and set the deployed API base URL here. Review the Kirundi copy and confirm pharmacy details and all regulatory claims before publishing.

## Important

The catalogue starts empty so no sample products or stock are represented as real. Product availability and prices must be confirmed by the pharmacy. WhatsApp orders remain requests and are not confirmed until the pharmacy responds.
# ubuzimapharma
