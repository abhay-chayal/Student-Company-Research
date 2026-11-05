-- Run this whole file in Supabase: SQL Editor -> New query -> paste -> Run.
-- Safe to run again at any time (it only adds what is missing and updates the function).

create table if not exists students (
  id          bigserial primary key,
  roll_key    text not null unique,          -- normalized roll number (UNIQUE = one submission per student)
  roll_no     text not null,
  name        text not null,
  created_at  timestamptz not null default now()
);

create table if not exists companies (
  id          bigserial primary key,
  student_id  bigint not null references students(id) on delete cascade,
  position    smallint not null check (position between 1 and 5),
  name        text not null,                 -- as typed by the student
  name_key    text not null unique,          -- "Microsoft Corporation" -> "microsoft"
  website     text not null,                 -- as typed by the student
  domain_key  text not null unique,          -- amazon.in / amazon.com -> "amazon"
  created_at  timestamptz not null default now(),
  unique (student_id, position)
);

-- Added later: the role the student targets, and where to apply.
alter table companies add column if not exists domain        text not null default '';
alter table companies add column if not exists domain_link   text not null default '';
alter table companies add column if not exists general_link  text not null default '';

-- The three details the HOD asked for on every company (all compulsory in the app).
alter table companies add column if not exists employee_strength text not null default '';   -- a range, e.g. 201-1,000
alter table companies add column if not exists package_lpa       numeric(6,2);               -- fresher package, lakh per annum
alter table companies add column if not exists revenue_amount    numeric(14,2);
alter table companies add column if not exists revenue_unit      text not null default '';   -- Crore | Million | Billion
alter table companies add column if not exists revenue_currency  text not null default '';   -- INR | USD | EUR | GBP | JPY

alter table students add column if not exists email text not null default '';

-- Companies that are already taken before any student starts (the college's existing list).
create table if not exists reserved_companies (
  id        bigserial primary key,
  name      text not null,
  name_key  text not null unique
);

-- Only the server (service role key) may touch the tables. No public access.
alter table students  enable row level security;
alter table companies enable row level security;
alter table reserved_companies enable row level security;

-- One atomic, all-or-nothing submission. Runs one student at a time, so two
-- students submitting the same company at the same instant cannot both win.
drop function if exists submit_entry(text, text, text, jsonb);

create or replace function submit_entry(
  p_roll_no   text,
  p_roll_key  text,
  p_name      text,
  p_email     text,
  p_companies jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student_id bigint;
  v_item       jsonb;
  v_pos        int := 0;
  v_taken      text;
  v_conflicts  jsonb := '[]'::jsonb;
begin
  perform pg_advisory_xact_lock(7001);

  if exists (select 1 from students where roll_key = p_roll_key) then
    return jsonb_build_object('ok', false, 'roll', true);
  end if;

  -- Check every company first, so the student sees ALL problems at once.
  for v_item in select * from jsonb_array_elements(p_companies) loop
    v_pos := v_pos + 1;

    select name into v_taken from companies
     where name_key = v_item->>'name_key' or domain_key = v_item->>'name_key' limit 1;
    if not found then
      select name into v_taken from reserved_companies
       where name_key = v_item->>'name_key' limit 1;
    end if;
    if found then
      v_conflicts := v_conflicts || jsonb_build_array(
        jsonb_build_object('position', v_pos, 'field', 'name', 'taken', v_taken));
    end if;

    select name into v_taken from companies
     where domain_key = v_item->>'domain_key' or name_key = v_item->>'domain_key' limit 1;
    if not found then
      select name into v_taken from reserved_companies
       where name_key = v_item->>'domain_key' limit 1;
    end if;
    if found then
      v_conflicts := v_conflicts || jsonb_build_array(
        jsonb_build_object('position', v_pos, 'field', 'website', 'taken', v_taken));
    end if;
  end loop;

  if jsonb_array_length(v_conflicts) > 0 then
    return jsonb_build_object('ok', false, 'conflicts', v_conflicts);
  end if;

  begin
    insert into students (roll_key, roll_no, name, email)
    values (p_roll_key, p_roll_no, p_name, p_email)
    returning id into v_student_id;

    v_pos := 0;
    for v_item in select * from jsonb_array_elements(p_companies) loop
      v_pos := v_pos + 1;
      insert into companies (student_id, position, name, name_key, website, domain_key,
                             domain, domain_link, general_link,
                             employee_strength, package_lpa, revenue_amount, revenue_unit, revenue_currency)
      values (v_student_id, v_pos, v_item->>'name', v_item->>'name_key',
              v_item->>'website', v_item->>'domain_key',
              coalesce(v_item->>'domain', ''), coalesce(v_item->>'domain_link', ''),
              coalesce(v_item->>'general_link', ''),
              coalesce(v_item->>'employee_strength', ''), (v_item->>'package_lpa')::numeric, (v_item->>'revenue_amount')::numeric,
              coalesce(v_item->>'revenue_unit', ''), coalesce(v_item->>'revenue_currency', ''));
    end loop;
  exception when unique_violation then
    -- Safety net: the unique constraints refused something. Everything above is rolled back.
    return jsonb_build_object('ok', false, 'race', true);
  end;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function submit_entry(text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function submit_entry(text, text, text, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Review of the entries and the "fix my companies" step
-- ---------------------------------------------------------------------------
-- review_status: new | accepted | to_fix | pending | resubmitted
--   accepted    the link was checked and is a specific, open job: locked, students cannot change it
--   to_fix      the link needs to be replaced
--   pending     waiting for a college decision (for example an HR email only)
--   resubmitted the student corrected it; it will be checked again
alter table companies add column if not exists review_status text not null default 'new';
alter table companies add column if not exists review_note   text not null default '';
alter table companies add column if not exists fixed_at      timestamptz;

-- Mentor panel: a person checks every company and approves it or not.
-- mentor_decision: null = no mentor has looked yet | approved | not_approved
alter table companies add column if not exists mentor_decision text;
alter table companies add column if not exists mentor_note     text not null default '';
alter table companies add column if not exists mentor_name     text not null default '';
alter table companies add column if not exists mentor_at       timestamptz;

-- Who decided what, and when. Nothing here is ever deleted, so a wrong click can be traced and undone.
create table if not exists mentor_log (
  id              bigserial primary key,
  at              timestamptz not null default now(),
  mentor_name     text not null,
  roll_key        text not null,
  position        smallint not null,
  company_name    text not null,
  decision        text not null,
  note            text not null default '',
  previous_status text not null default ''
);
alter table mentor_log enable row level security;

-- History of every change a student makes on the fix page: the values the company had BEFORE the
-- change. The admin can look at it and restore an old version (see restore_company).
create table if not exists company_history (
  id            bigserial primary key,
  changed_at    timestamptz not null default now(),
  roll_key      text not null,
  student_name  text not null default '',
  position      smallint not null,
  source        text not null default 'fix',        -- fix = student change, restore = admin restored an older version
  name          text not null,
  name_key      text not null,
  website       text not null default '',
  domain_key    text not null,
  domain        text not null default '',
  domain_link   text not null default '',
  general_link  text not null default '',
  review_status text not null default 'new',
  review_note   text not null default '',
  restored_at   timestamptz
);
create index if not exists company_history_roll on company_history (roll_key, changed_at);
alter table company_history add column if not exists employee_strength text not null default '';
alter table company_history add column if not exists package_lpa       numeric(6,2);
alter table company_history add column if not exists revenue_amount    numeric(14,2);
alter table company_history add column if not exists revenue_unit      text not null default '';
alter table company_history add column if not exists revenue_currency  text not null default '';
alter table company_history enable row level security;

-- Sets the review result of many companies at once (used by the admin page's Import button).
create or replace function apply_review(p_items jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  with items as (
    select x->>'roll' as roll, x->>'name_key' as name_key, x->>'status' as status, coalesce(x->>'reason', '') as reason
    from jsonb_array_elements(p_items) x
  )
  update companies c
     set review_status = i.status, review_note = i.reason
    from items i
    join students s on s.roll_key = i.roll
   where c.student_id = s.id and c.name_key = i.name_key
     and i.status in ('new', 'accepted', 'to_fix', 'pending', 'resubmitted');
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- A student corrects one company. The roll number and the email must match, accepted
-- companies are locked, and a changed name or website goes through the same uniqueness
-- checks as a new submission (ignoring this company's own old values).
drop function if exists fix_company(text, text, integer, text, text, text, text, text, text, text);
create or replace function fix_company(
  p_roll_key text, p_email text, p_position integer,
  p_domain text, p_domain_link text, p_general_link text,
  p_name text default null, p_name_key text default null,
  p_website text default null, p_domain_key text default null,
  p_extras jsonb default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_student   students%rowtype;
  v_company   companies%rowtype;
  v_taken     text;
  v_conflicts jsonb := '[]'::jsonb;
begin
  perform pg_advisory_xact_lock(7001);

  select * into v_student from students where roll_key = p_roll_key;
  if not found or v_student.email = '' or lower(v_student.email) <> lower(p_email) then
    return jsonb_build_object('ok', false, 'code', 'identity');
  end if;

  select * into v_company from companies where student_id = v_student.id and position = p_position;
  if not found then return jsonb_build_object('ok', false, 'code', 'missing'); end if;
  if v_company.review_status = 'accepted' then return jsonb_build_object('ok', false, 'code', 'locked'); end if;

  if p_name_key is not null and p_name_key <> v_company.name_key then
    v_taken := null;
    select name into v_taken from companies where id <> v_company.id and (name_key = p_name_key or domain_key = p_name_key) limit 1;
    if v_taken is null then select name into v_taken from reserved_companies where name_key = p_name_key limit 1; end if;
    if v_taken is not null then
      v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object('field', 'name', 'taken', v_taken));
    end if;
  end if;
  if p_domain_key is not null and p_domain_key <> v_company.domain_key then
    v_taken := null;
    select name into v_taken from companies where id <> v_company.id and (domain_key = p_domain_key or name_key = p_domain_key) limit 1;
    if v_taken is null then select name into v_taken from reserved_companies where name_key = p_domain_key limit 1; end if;
    if v_taken is not null then
      v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object('field', 'website', 'taken', v_taken));
    end if;
  end if;
  if jsonb_array_length(v_conflicts) > 0 then
    return jsonb_build_object('ok', false, 'code', 'conflict', 'conflicts', v_conflicts);
  end if;

  begin
    insert into company_history (roll_key, student_name, position, source, name, name_key, website, domain_key, domain, domain_link, general_link, review_status, review_note,
                                 employee_strength, package_lpa, revenue_amount, revenue_unit, revenue_currency)
    values (v_student.roll_key, v_student.name, v_company.position, 'fix', v_company.name, v_company.name_key, v_company.website, v_company.domain_key,
            v_company.domain, v_company.domain_link, v_company.general_link, v_company.review_status, v_company.review_note,
            v_company.employee_strength, v_company.package_lpa, v_company.revenue_amount, v_company.revenue_unit, v_company.revenue_currency);
    update companies set
      mentor_decision   = null,
      employee_strength = coalesce(p_extras->>'employee_strength', employee_strength),
      package_lpa       = coalesce((p_extras->>'package_lpa')::numeric, package_lpa),
      revenue_amount    = coalesce((p_extras->>'revenue_amount')::numeric, revenue_amount),
      revenue_unit      = coalesce(p_extras->>'revenue_unit', revenue_unit),
      revenue_currency  = coalesce(p_extras->>'revenue_currency', revenue_currency),
      domain       = coalesce(p_domain, domain),
      domain_link  = coalesce(p_domain_link, domain_link),
      general_link = coalesce(p_general_link, general_link),
      name         = coalesce(p_name, name),
      name_key     = coalesce(p_name_key, name_key),
      website      = coalesce(p_website, website),
      domain_key   = coalesce(p_domain_key, domain_key),
      review_status = 'resubmitted',
      fixed_at     = now()
    where id = v_company.id;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'code', 'race');
  end;

  return jsonb_build_object('ok', true);
end;
$$;

-- A student saves the three details of one company. Allowed for every company, accepted ones included
-- (the links and the company itself stay locked). The roll number and the email must match.
create or replace function save_details(
  p_roll_key text, p_email text, p_position integer, p_extras jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_student students%rowtype;
  v_company companies%rowtype;
begin
  perform pg_advisory_xact_lock(7001);
  select * into v_student from students where roll_key = p_roll_key;
  if not found or v_student.email = '' or lower(v_student.email) <> lower(p_email) then
    return jsonb_build_object('ok', false, 'code', 'identity');
  end if;
  select * into v_company from companies where student_id = v_student.id and position = p_position;
  if not found then return jsonb_build_object('ok', false, 'code', 'missing'); end if;

  insert into company_history (roll_key, student_name, position, source, name, name_key, website, domain_key, domain, domain_link, general_link, review_status, review_note,
                               employee_strength, package_lpa, revenue_amount, revenue_unit, revenue_currency)
  values (v_student.roll_key, v_student.name, v_company.position, 'details', v_company.name, v_company.name_key, v_company.website, v_company.domain_key,
          v_company.domain, v_company.domain_link, v_company.general_link, v_company.review_status, v_company.review_note,
          v_company.employee_strength, v_company.package_lpa, v_company.revenue_amount, v_company.revenue_unit, v_company.revenue_currency);
  update companies set
    mentor_decision   = null,
    employee_strength = p_extras->>'employee_strength',
    package_lpa       = (p_extras->>'package_lpa')::numeric,
    revenue_amount    = (p_extras->>'revenue_amount')::numeric,
    revenue_unit      = p_extras->>'revenue_unit',
    revenue_currency  = p_extras->>'revenue_currency'
  where id = v_company.id;
  return jsonb_build_object('ok', true);
end;
$$;

-- A mentor approves or does not approve one company. Approving makes it Accepted (locked for the student);
-- not approving makes it "To fix" with the mentor's reason, which the student reads on the fix page.
create or replace function mentor_decide(
  p_roll_key text, p_position integer, p_decision text, p_note text, p_mentor text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_student students%rowtype;
  v_company companies%rowtype;
  v_note    text := left(btrim(coalesce(p_note, '')), 300);
  v_mentor  text := left(btrim(coalesce(p_mentor, '')), 40);
begin
  if p_decision not in ('approved', 'not_approved') then return jsonb_build_object('ok', false, 'code', 'decision'); end if;
  if length(v_mentor) < 2 then return jsonb_build_object('ok', false, 'code', 'mentor'); end if;
  if p_decision = 'not_approved' and length(v_note) < 3 then return jsonb_build_object('ok', false, 'code', 'note'); end if;

  perform pg_advisory_xact_lock(7001);
  select * into v_student from students where roll_key = p_roll_key;
  if not found then return jsonb_build_object('ok', false, 'code', 'missing'); end if;
  select * into v_company from companies where student_id = v_student.id and position = p_position;
  if not found then return jsonb_build_object('ok', false, 'code', 'missing'); end if;
  if p_decision = 'approved' and not (v_company.employee_strength <> '' and v_company.package_lpa is not null
       and v_company.revenue_amount is not null and v_company.revenue_unit <> '' and v_company.revenue_currency <> '') then
    return jsonb_build_object('ok', false, 'code', 'details');
  end if;

  insert into mentor_log (mentor_name, roll_key, position, company_name, decision, note, previous_status)
  values (v_mentor, v_student.roll_key, v_company.position, v_company.name, p_decision, case when p_decision = 'approved' then '' else v_note end, v_company.review_status);

  update companies set
    mentor_decision = p_decision,
    mentor_note     = case when p_decision = 'approved' then '' else v_note end,
    mentor_name     = v_mentor,
    mentor_at       = now(),
    review_status   = case when p_decision = 'approved' then 'accepted' else 'to_fix' end,
    review_note     = case when p_decision = 'approved' then '' else v_note end
  where id = v_company.id;
  return jsonb_build_object('ok', true);
end;
$$;

-- Admin: put a company back to the values saved in one history row. The current values are saved to
-- the history first, so a restore can itself be undone. The old name and website must still be free.
create or replace function restore_company(p_history_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  h           company_history%rowtype;
  v_student   students%rowtype;
  v_company   companies%rowtype;
  v_taken     text;
  v_conflicts jsonb := '[]'::jsonb;
begin
  perform pg_advisory_xact_lock(7001);

  select * into h from company_history where id = p_history_id;
  if not found then return jsonb_build_object('ok', false, 'code', 'missing'); end if;
  select * into v_student from students where roll_key = h.roll_key;
  if not found then return jsonb_build_object('ok', false, 'code', 'missing'); end if;
  select * into v_company from companies where student_id = v_student.id and position = h.position;
  if not found then return jsonb_build_object('ok', false, 'code', 'missing'); end if;

  if h.name_key <> v_company.name_key then
    v_taken := null;
    select name into v_taken from companies where id <> v_company.id and (name_key = h.name_key or domain_key = h.name_key) limit 1;
    if v_taken is null then select name into v_taken from reserved_companies where name_key = h.name_key limit 1; end if;
    if v_taken is not null then v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object('field', 'name', 'taken', v_taken)); end if;
  end if;
  if h.domain_key <> v_company.domain_key then
    v_taken := null;
    select name into v_taken from companies where id <> v_company.id and (domain_key = h.domain_key or name_key = h.domain_key) limit 1;
    if v_taken is null then select name into v_taken from reserved_companies where name_key = h.domain_key limit 1; end if;
    if v_taken is not null then v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object('field', 'website', 'taken', v_taken)); end if;
  end if;
  if jsonb_array_length(v_conflicts) > 0 then
    return jsonb_build_object('ok', false, 'code', 'conflict', 'conflicts', v_conflicts);
  end if;

  begin
    insert into company_history (roll_key, student_name, position, source, name, name_key, website, domain_key, domain, domain_link, general_link, review_status, review_note,
                                 employee_strength, package_lpa, revenue_amount, revenue_unit, revenue_currency)
    values (v_student.roll_key, v_student.name, v_company.position, 'restore', v_company.name, v_company.name_key, v_company.website, v_company.domain_key,
            v_company.domain, v_company.domain_link, v_company.general_link, v_company.review_status, v_company.review_note,
            v_company.employee_strength, v_company.package_lpa, v_company.revenue_amount, v_company.revenue_unit, v_company.revenue_currency);
    update companies set
      name = h.name, name_key = h.name_key, website = h.website, domain_key = h.domain_key,
      domain = h.domain, domain_link = h.domain_link, general_link = h.general_link,
      employee_strength = h.employee_strength, package_lpa = h.package_lpa, revenue_amount = h.revenue_amount,
      revenue_unit = h.revenue_unit, revenue_currency = h.revenue_currency,
      review_status = h.review_status, review_note = h.review_note
    where id = v_company.id;
    update company_history set restored_at = now() where id = h.id;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'code', 'race');
  end;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function apply_review(jsonb) from public, anon, authenticated;
grant execute on function apply_review(jsonb) to service_role;
revoke all on function mentor_decide(text, integer, text, text, text) from public, anon, authenticated;
grant execute on function mentor_decide(text, integer, text, text, text) to service_role;
revoke all on function save_details(text, text, integer, jsonb) from public, anon, authenticated;
grant execute on function save_details(text, text, integer, jsonb) to service_role;
revoke all on function restore_company(bigint) from public, anon, authenticated;
grant execute on function restore_company(bigint) to service_role;
revoke all on function fix_company(text, text, integer, text, text, text, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function fix_company(text, text, integer, text, text, text, text, text, text, text, jsonb) to service_role;


-- ---------------------------------------------------------------------------
-- Daily companies for students to apply to ("apply" page)
-- ---------------------------------------------------------------------------
-- Every day five students' companies are published (CS first, then IT, then AI & DS, in roll-number order).
-- A student opens a link, then tells us what happened. Everything is kept per student and per company so the
-- companies and the students can be analysed later.
create table if not exists apply_batches (
  id           bigserial primary key,
  batch_date   date not null unique,                 -- one batch per day (Indian date)
  branch       text not null,
  source       text not null default 'manual',       -- auto (the daily job) | manual (published from the admin page)
  published_at timestamptz not null default now()
);

create table if not exists apply_items (
  id               bigserial primary key,
  batch_id         bigint not null references apply_batches(id) on delete cascade,
  company_id       bigint not null references companies(id) on delete cascade,
  student_roll_key text not null,                    -- the student who submitted the company
  position         smallint not null,
  unique (batch_id, company_id)
);
create index if not exists apply_items_company on apply_items (company_id);

-- a student opened a link of a company (link_kind: domain | fresher)
create table if not exists apply_clicks (
  roll_key   text not null,                          -- the student who clicked
  company_id bigint not null references companies(id) on delete cascade,
  link_kind  text not null,
  first_at   timestamptz not null default now(),
  last_at    timestamptz not null default now(),
  clicks     integer not null default 1,
  primary key (roll_key, company_id, link_kind)
);

-- what the student says happened: applied | could_not | not_interested
create table if not exists apply_responses (
  roll_key       text not null,
  company_id     bigint not null references companies(id) on delete cascade,
  batch_id       bigint references apply_batches(id) on delete set null,
  response       text not null,
  reason         text not null default '',           -- for could_not: link_not_working | job_closed | no_relevant_opening | other
  note           text not null default '',
  first_click_at timestamptz,
  answered_at    timestamptz not null default now(),
  changes        integer not null default 0,
  primary key (roll_key, company_id)
);

-- every answer ever given, including changed ones
create table if not exists apply_response_log (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  roll_key   text not null,
  company_id bigint not null,
  response   text not null,
  reason     text not null default '',
  note       text not null default ''
);

alter table apply_batches      enable row level security;
alter table apply_items        enable row level security;
alter table apply_clicks       enable row level security;
alter table apply_responses    enable row level security;
alter table apply_response_log enable row level security;

-- Publish one batch: the companies of the given students (already chosen and ordered by the app).
-- Safe to call twice for the same date: the second call changes nothing.
create or replace function apply_publish(p_date date, p_branch text, p_rolls text[], p_source text default 'manual')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_batch bigint;
  v_count integer;
begin
  perform pg_advisory_xact_lock(7001);
  select id into v_batch from apply_batches where batch_date = p_date;
  if found then return jsonb_build_object('ok', true, 'existing', true, 'batch_id', v_batch); end if;
  if p_rolls is null or array_length(p_rolls, 1) is null then return jsonb_build_object('ok', false, 'code', 'empty'); end if;
  if exists (select 1 from apply_items where student_roll_key = any (p_rolls)) then
    return jsonb_build_object('ok', false, 'code', 'already');   -- a student of this window was published before
  end if;

  insert into apply_batches (batch_date, branch, source) values (p_date, p_branch, coalesce(p_source, 'manual')) returning id into v_batch;
  insert into apply_items (batch_id, company_id, student_roll_key, position)
  select v_batch, c.id, s.roll_key, c.position
    from unnest(p_rolls) with ordinality as r(roll_key, ord)
    join students s on s.roll_key = r.roll_key
    join companies c on c.student_id = s.id
   order by r.ord, c.position;
  get diagnostics v_count = row_count;
  if v_count = 0 then
    delete from apply_batches where id = v_batch;
    return jsonb_build_object('ok', false, 'code', 'empty');
  end if;
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'companies', v_count);
end;
$$;

-- A student opened a link. The roll number and the email must match (the same check as the fix page).
create or replace function apply_record_click(p_roll_key text, p_email text, p_company_id bigint, p_link_kind text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_student students%rowtype;
begin
  select * into v_student from students where roll_key = p_roll_key;
  if not found or v_student.email = '' or lower(v_student.email) <> lower(p_email) then
    return jsonb_build_object('ok', false, 'code', 'identity');
  end if;
  if p_link_kind not in ('domain', 'fresher') then return jsonb_build_object('ok', false, 'code', 'link'); end if;
  if not exists (select 1 from apply_items where company_id = p_company_id) then
    return jsonb_build_object('ok', false, 'code', 'missing');   -- only published companies
  end if;
  insert into apply_clicks (roll_key, company_id, link_kind) values (p_roll_key, p_company_id, p_link_kind)
  on conflict (roll_key, company_id, link_kind) do update set last_at = now(), clicks = apply_clicks.clicks + 1;
  return jsonb_build_object('ok', true);
end;
$$;

-- A student says what happened. It needs a click on that company first, and a reason when they could not apply.
create or replace function apply_save_response(p_roll_key text, p_email text, p_company_id bigint, p_response text, p_reason text, p_note text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_student students%rowtype;
  v_first   timestamptz;
  v_batch   bigint;
  v_old     apply_responses%rowtype;
  v_reason  text := coalesce(p_reason, '');
  v_note    text := left(btrim(coalesce(p_note, '')), 300);
begin
  select * into v_student from students where roll_key = p_roll_key;
  if not found or v_student.email = '' or lower(v_student.email) <> lower(p_email) then
    return jsonb_build_object('ok', false, 'code', 'identity');
  end if;
  if p_response not in ('applied', 'could_not', 'not_interested') then return jsonb_build_object('ok', false, 'code', 'response'); end if;
  if p_response = 'could_not' and v_reason not in ('link_not_working', 'job_closed', 'no_relevant_opening', 'other') then
    return jsonb_build_object('ok', false, 'code', 'reason');
  end if;
  if p_response <> 'could_not' then v_reason := ''; end if;
  select batch_id into v_batch from apply_items where company_id = p_company_id order by id limit 1;
  if v_batch is null then return jsonb_build_object('ok', false, 'code', 'missing'); end if;
  select min(first_at) into v_first from apply_clicks where roll_key = p_roll_key and company_id = p_company_id;
  if v_first is null then return jsonb_build_object('ok', false, 'code', 'click_first'); end if;

  select * into v_old from apply_responses where roll_key = p_roll_key and company_id = p_company_id;
  if found then
    update apply_responses
       set response = p_response, reason = v_reason, note = v_note, answered_at = now(),
           changes = changes + case when v_old.response <> p_response or v_old.reason <> v_reason then 1 else 0 end
     where roll_key = p_roll_key and company_id = p_company_id;
  else
    insert into apply_responses (roll_key, company_id, batch_id, response, reason, note, first_click_at)
    values (p_roll_key, p_company_id, v_batch, p_response, v_reason, v_note, v_first);
  end if;
  insert into apply_response_log (roll_key, company_id, response, reason, note) values (p_roll_key, p_company_id, p_response, v_reason, v_note);
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function apply_publish(date, text, text[], text) from public, anon, authenticated;
grant execute on function apply_publish(date, text, text[], text) to service_role;
revoke all on function apply_record_click(text, text, bigint, text) from public, anon, authenticated;
grant execute on function apply_record_click(text, text, bigint, text) to service_role;
revoke all on function apply_save_response(text, text, bigint, text, text, text) from public, anon, authenticated;
grant execute on function apply_save_response(text, text, bigint, text, text, text) to service_role;
