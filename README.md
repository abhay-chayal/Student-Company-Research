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

## Link rules (what the form accepts)
- The domain-specific job link must point to **one specific job** (or be an email). The company home page, a general careers page, a list or search of jobs, a LinkedIn company page or post, and news/repost sites are refused with a clear message.
- The fresher hiring field may hold a careers page, a job link or an email. A student may fill either field or both.
- Every change on the fix page saves the old values to `company_history`. The admin page's "Change history" lists them and can restore one (refused if its name or website has been taken meanwhile; the restore is itself recorded, so it can be undone).
- On the fix page a company that is not accepted can be corrected or replaced by another company; the old company is released when the new one is saved, under the same uniqueness checks as a new submission.
- A general careers or campus page is accepted only for a company the student marked **General (not domain specific)**.
- An HR email is accepted instead of a link.
- Tracking parameters (`utm_source=chatgpt.com` and similar) are removed; two links pasted together, or a link pasted with brackets, are refused.
- The link is opened once. A page that is "not found", says the job is closed, or redirects to a general page is refused. Anything unclear (a site that blocks automated visits, a timeout) is let through.
- The rules live in `lib/linkrules.js` (the address), `lib/linklive.js` (opening the page) and `lib/details.js` (putting them together).

## Reviewing and correcting entries
1. Download the Excel from the admin page, then review it:
   `node scripts/review-companies.js <export.xlsx> <folder> --stage=fetch`, then `--stage=render`, `--stage=websites`, `--stage=report`.
   The first three stages open every link (and, for unclear ones, a real browser: it needs Chrome or Edge installed). `report` writes `company-review.xlsx` and `results.json`.
   Hand decisions go in `<folder>/overrides.json`. `node scripts/review/make-lists.js <folder>` writes the lists to share.
2. On the admin page click **Import review results** and choose `results.json`. Each company becomes *accepted* (locked), *to fix*, or *pending*.
3. Students open **/fix**, enter their roll number and the email they used in the form, and correct only the companies that are not accepted. Their corrections are marked *corrected*; export again and re-review those.
- Name and website can be changed only when the review found a problem with them. Every change is checked for uniqueness again.
- Set `FIX_CLOSE_AT` (ISO time) in Vercel to close corrections at a deadline.

## Tests
    npm test            # 59 checks of the rules, the exports, hostile input and a full-size dataset
    npm run test:sql    # starts a real PostgreSQL, runs supabase/schema.sql and the seed, and tests
                        # uniqueness under simultaneous requests, locking, and who can read the data
