# Company Research Portal

Each student submits their name, roll number and 5 companies: name, official website, domain (role), and a domain-specific and/or general fresher hiring link or email.
A company can be taken by only one student. Admin downloads everything as Excel/CSV.

## How duplicates are stopped
- Company name is reduced to a key: case, spaces, symbols and endings like Pvt/Ltd/Corporation/Technologies are ignored (`Microsoft Corporation` = `microsoft`).
- Website is reduced to its company part (`amazon.com`, `amazon.in`, `aws.amazon.com` = `amazon`).
- A company is refused if either key is taken, or matches the other kind of key (name `TCS` vs website `tcs.com`).
- The database itself holds UNIQUE constraints and each submission runs as one locked, all-or-nothing transaction, so simultaneous submissions cannot both win.
- One submission per roll number.

## Run on your computer (no accounts needed)
    npm install
    npm run dev            # http://localhost:3000   admin: /admin
    npm test               # duplicate-rule checks
Without Supabase keys it uses temporary memory storage. To try the admin page set `ADMIN_PASSWORD` first
(PowerShell: `$env:ADMIN_PASSWORD="test123"; npm run dev`).

## Deploy (free)
1. **Supabase**: create a project -> SQL Editor -> paste `supabase/schema.sql` -> Run. Then paste `supabase/seed_reserved.sql` -> Run (loads the college's existing company list as "already taken"). Both are safe to run again; re-run `schema.sql` after any update that changes the database.
   Then Project Settings -> API: copy the *Project URL* and the *service_role* key.
2. **Vercel**: push this folder to a GitHub repo -> vercel.com -> Add New Project -> import it (Framework: Other).
   Add the environment variables from `.env.example`, then Deploy.
3. Share the Vercel link with students. Admin page: `your-link/admin`.
4. Test once with a fake student, then delete that row from the admin page.

## College's existing company list
Companies already on the college list are marked "already taken" for every student.
- Source: the Excel sheet from the college. Clean it with `npm run build-reserved -- "path/to/list.xlsx"`.
  It removes duplicates and spelling variants, strips notes like "(hold)", and writes
  `data/ACEIT-companies-cleaned.xlsx` (check this), `data/reserved-companies.json` and `supabase/seed_reserved.sql`.
- Every spelling of a company is reserved, so `HCLTech` and `HCL Technologies` are both blocked.
- To change the list later, edit the sheet, re-run the command, and run the new `seed_reserved.sql` in Supabase.
