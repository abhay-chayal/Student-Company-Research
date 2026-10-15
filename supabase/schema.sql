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

-- Only the server (service role key) may touch the tables. No public access.
alter table students  enable row level security;
alter table companies enable row level security;

-- One atomic, all-or-nothing submission. Runs one student at a time, so two
-- students submitting the same company at the same instant cannot both win.
create or replace function submit_entry(
  p_roll_no   text,
  p_roll_key  text,
  p_name      text,
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
    if found then
      v_conflicts := v_conflicts || jsonb_build_array(
        jsonb_build_object('position', v_pos, 'field', 'name', 'taken', v_taken));
    end if;

    select name into v_taken from companies
     where domain_key = v_item->>'domain_key' or name_key = v_item->>'domain_key' limit 1;
    if found then
      v_conflicts := v_conflicts || jsonb_build_array(
        jsonb_build_object('position', v_pos, 'field', 'website', 'taken', v_taken));
    end if;
  end loop;

  if jsonb_array_length(v_conflicts) > 0 then
    return jsonb_build_object('ok', false, 'conflicts', v_conflicts);
  end if;

  begin
    insert into students (roll_key, roll_no, name)
    values (p_roll_key, p_roll_no, p_name)
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

revoke all on function submit_entry(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function submit_entry(text, text, text, jsonb) to service_role;
