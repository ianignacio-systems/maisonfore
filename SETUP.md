# Setting up MaisonFore online

There are two setups:

- **A. A test site on Render**: one address for the whole portal, ready in about 15 minutes. Use it to try
  MaisonFore with your team and a few courses.
- **B. Production**: MaisonFore's own Supabase project, the server on Render, the portal on Cloudflare at
  maisonfore.com. Use it for launch.

Never put passwords, connection strings or secret keys in chat or in the code.

# A. A test site on Render

Render runs one service that is both the server and the portal, plus a PostgreSQL database, both in
Singapore. Sign-in is the Maison account (the MaisonPOS Supabase project), so your MaisonPOS email and
password work, and testers can create their own accounts.

## A1. Put the code on GitHub

Render deploys from GitHub. On github.com, create a **private** repository named `maisonfore`, empty (no
README). Then, in a terminal in the project folder:

```
git init
git add .
git commit -m "MaisonFore"
git branch -M main
git remote add origin https://github.com/<your-account>/maisonfore.git
git push -u origin main
```

`.env` files and `node_modules` are left out on purpose (see `.gitignore`).

## A2. Create the site on Render

1. **render.com** → sign in → **New → Blueprint**. Connect GitHub if asked, and pick the `maisonfore`
   repository. Render reads `render.yaml` and lists two things: the **maisonfore** web service and the
   **maisonfore-db** database.
2. Fill in the three values it asks for:

   | Variable | Where to find it |
   | --- | --- |
   | `VITE_SUPABASE_URL` | Supabase → the **MaisonPOS** project → Project Settings → Data API → Project URL |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | Same project → Project Settings → API Keys → the **publishable** key (never the secret key) |
   | `PLATFORM_ADMIN_EMAILS` | Your email, and any other Maison staff, separated by commas. They can open Maison admin. |

3. **Apply**. The first build takes about 5 minutes. When the service says **Live**, its address is at the
   top, e.g. `https://maisonfore.onrender.com` (Render may add letters if the name is taken).
4. Check `https://<your address>/api/v1/health`. It answers `{"ok":true,"api":"v1"}`.

## A3. Let sign-in emails come back to the test site

Supabase → the **MaisonPOS** project → **Authentication → URL Configuration → Redirect URLs** → add
`https://<your address>/**`. Without it, the confirm-email and reset-password links open MaisonPOS instead.

## A4. Try it

1. Open your address and sign in with your MaisonPOS email and password, or create an account.
2. **Add your course**, fill in **Settings**, then **Go live → Send to Maison for review**.
3. Sign in with an email from `PLATFORM_ADMIN_EMAILS` and open `https://<your address>/admin` to approve it.
4. Add your team under **Staff**. They sign in at `https://<your address>/<course address>`.
5. **The golfer app** is at `https://<your address>/play`. Open it on your phone, sign in (any Maison
   account works) and book a time; it shows up on the tee sheet straight away. Only approved courses are
   listed. To put it on the home screen: Safari → Share → **Add to Home Screen**; Chrome → ⋮ → **Install app**.

## A5. Phone alerts for golfers (optional)

Golfers on the waitlist get offered times that open up, and app golfers get a reminder before their pay
deadline. They always see these in the app's Messages; phone alerts make them buzz the phone too.

1. On any computer with Node.js, run `npx web-push generate-vapid-keys`. It prints a **Public Key** and a
   **Private Key**. Keep the private key to yourself: don't paste it into chats, email or code.
2. Render → the **maisonfore** service → **Environment** → add:

   | Variable | Value |
   | --- | --- |
   | `VAPID_PUBLIC_KEY` | the Public Key |
   | `VAPID_PRIVATE_KEY` | the Private Key |
   | `VAPID_SUBJECT` | `mailto:` and an email push services can reach you at, e.g. `mailto:you@example.com` |

3. **Save, rebuild and deploy.** Golfers then turn alerts on in the app (Messages or Profile). On iPhone the app
   must first be added to the home screen (Share → **Add to Home Screen**), then opened from there.

Keep the same keys from then on: new keys mean every golfer has to turn alerts on again.

## Good to know

- **Updates**: every `git push` to `main` rebuilds the site by itself.
- **Sleeping**: the free web service sleeps after 15 minutes without visitors; the first visit after that
  takes about a minute. To keep it awake, change its instance type to **Starter**.
- **The server's minute round** releases holds that ran out, offers opened times to the waitlist, reminds golfers
  to pay and sends phone alerts. While the free service sleeps, that round stops too, so for real use (and for
  testing the waitlist properly) use **Starter**.
- **The free database expires after 30 days** (then 14 days' grace before it is deleted). To keep the test
  data, upgrade **maisonfore-db** to a paid plan before then.
- **If you sign in but every page says to sign in again**, the MaisonPOS project still uses the older JWT
  secret: add `SUPABASE_JWT_SECRET` to the maisonfore service (Environment), with the same value as the
  MaisonPOS server's setting of that name.
- The local sign-in without a password (`MAISON_DEV_AUTH`) is refused online on purpose.

# B. Production

MaisonFore uses the same four accounts as MaisonPOS: **Supabase**, **Render** (Singapore), **GitHub** and
**Cloudflare**. In Render, **New → Blueprint**, then set the **Blueprint path** to `render.production.yaml`.

## 1. Supabase

1. **supabase.com** → organization **Maison** → **New project**: name `maisonfore`, region **Southeast Asia
   (Singapore)**. This holds MaisonFore's own data. The tables are made by the server when it starts.
2. Sign-in is **not** set up here: MaisonFore uses the **Maison account**, which today is the MaisonPOS
   project's sign-in. In the **MaisonPOS** project → **Authentication → URL Configuration → Redirect URLs**,
   add `https://maisonfore.com/**`, so password-reset and confirmation links can return to MaisonFore.
3. From the MaisonPOS project you need its **Project URL** and **publishable key** (for the portal), as in
   MaisonPOS's own setup.

## 2. Render: the MaisonFore server

1. **New → Blueprint** → the `maisonfore` repository, **Blueprint path** `render.production.yaml`. Instance type **Starter**.
2. **Environment**:

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | the **MaisonFore** project → Connect → URI, **Session pooler**, with its database password |
   | `SUPABASE_URL` | the **MaisonPOS** project's Project URL (the Maison account sign-in) |
   | `CORS_ORIGINS` | `https://maisonfore.com,https://www.maisonfore.com` |
   | `PLATFORM_ADMIN_EMAILS` | your email (opens Maison admin) |

3. When it's **Live**, `https://maisonfore-server.onrender.com/api/v1/health` answers `{"ok":true,"api":"v1"}`.

## 3. Cloudflare Pages: the portal

1. **Workers & Pages → Create → Pages → Connect to Git** → the repository. Build command
   `npm run build:pages`, output folder `portal/dist`, branch `main`. This builds the portal and puts the
   golfer app inside it at `/play`.
2. **Variables**: `NODE_VERSION` = `22`, `VITE_SERVER_URL` = the Render address, `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_PUBLISHABLE_KEY` = the **MaisonPOS** project's.
3. **Custom domains** → `maisonfore.com`. The `_redirects` file that comes with the portal sends
   `maisonfore.com/play/...` to the golfer app and every other address to the portal, so
   `maisonfore.com/coursename` opens the portal.

## First use

1. Open `maisonfore.com`, sign in with your Maison account (your MaisonPOS email and password work).
2. **Add your course**, then **Settings**: tee times, players and green fees (local, foreign, senior…, 9 and 18 holes), carts, caddies and fees, booking rules, holidays and the course page.
3. **Go live → Send to Maison for review**. A Maison admin approves it at `maisonfore.com/admin`.
4. Staff use **Tee sheet** for phone, Viber and walk-in bookings from day one, before approval.
5. Once approved, golfers find the course at `maisonfore.com/play`.
