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
                             domain, domain_link, general_link)
      values (v_student_id, v_pos, v_item->>'name', v_item->>'name_key',
              v_item->>'website', v_item->>'domain_key',
              coalesce(v_item->>'domain', ''), coalesce(v_item->>'domain_link', ''),
              coalesce(v_item->>'general_link', ''));
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
create or replace function fix_company(
  p_roll_key text, p_email text, p_position integer,
  p_domain text, p_domain_link text, p_general_link text,
  p_name text default null, p_name_key text default null,
  p_website text default null, p_domain_key text default null
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
    insert into company_history (roll_key, student_name, position, source, name, name_key, website, domain_key, domain, domain_link, general_link, review_status, review_note)
    values (v_student.roll_key, v_student.name, v_company.position, 'fix', v_company.name, v_company.name_key, v_company.website, v_company.domain_key,
            v_company.domain, v_company.domain_link, v_company.general_link, v_company.review_status, v_company.review_note);
    update companies set
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
    insert into company_history (roll_key, student_name, position, source, name, name_key, website, domain_key, domain, domain_link, general_link, review_status, review_note)
    values (v_student.roll_key, v_student.name, v_company.position, 'restore', v_company.name, v_company.name_key, v_company.website, v_company.domain_key,
            v_company.domain, v_company.domain_link, v_company.general_link, v_company.review_status, v_company.review_note);
    update companies set
      name = h.name, name_key = h.name_key, website = h.website, domain_key = h.domain_key,
      domain = h.domain, domain_link = h.domain_link, general_link = h.general_link,
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
revoke all on function restore_company(bigint) from public, anon, authenticated;
grant execute on function restore_company(bigint) to service_role;
revoke all on function fix_company(text, text, integer, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function fix_company(text, text, integer, text, text, text, text, text, text, text) to service_role;
