-- All game data is private. Only the narrow, authenticated RPC API is exposed.
create schema if not exists private;
create extension if not exists pgcrypto with schema extensions;
create table private.room_counter (singleton boolean primary key default true check(singleton), next_id bigint not null);
insert into private.room_counter values(true,10020);
create table private.rooms (
 id text primary key, password text not null, theme text not null check(theme in ('forest','christmas','underwater')),
 started boolean not null default false, playing boolean not null default false,
 phase text not null default 'closed', question_index integer not null default 0,
 question_count integer not null default 0, deadline timestamptz, question_started timestamptz,
 choices jsonb, session_id uuid not null default gen_random_uuid(), created_at timestamptz default now()
);
create table private.questions(room_id text references private.rooms on delete cascade, idx integer, body jsonb not null, primary key(room_id,idx));
create table private.hosts(room_id text references private.rooms on delete cascade, user_id uuid not null, primary key(room_id,user_id));
create table private.members(id uuid primary key default gen_random_uuid(), room_id text references private.rooms on delete cascade,
 user_id uuid not null, name text not null, character integer not null check(character between 0 and 9), points integer not null default 0,
 joined_at timestamptz not null default clock_timestamp(), unique(room_id,user_id));
create table private.answers(room_id text references private.rooms on delete cascade, question_index integer, member_id uuid references private.members on delete cascade,
 received_at timestamptz not null, elapsed double precision not null, choice integer not null, correct boolean not null,
 correct_position integer, points integer not null default 0, primary key(room_id,question_index,member_id));
alter table private.rooms enable row level security;
alter table private.questions enable row level security;
alter table private.members enable row level security;
alter table private.answers enable row level security;
alter table private.hosts enable row level security;
alter table private.room_counter enable row level security;
revoke all on schema private from public,anon,authenticated;

create function private.require_host(p_room text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from private.hosts where room_id=p_room and user_id=auth.uid()) then raise exception 'Host access required.'; end if;
end $$;

create function private.advance_room(p_room text) returns void
language plpgsql security definer set search_path='' as $$
declare r private.rooms; t timestamptz; fastest double precision;
begin
 select * into r from private.rooms where id=p_room for update;
 t:=clock_timestamp();
 if not r.playing then return; end if;
 if r.phase='countdown' and t>=r.deadline then
  perform private.load_question(p_room,r.deadline);
  select * into r from private.rooms where id=p_room;
 end if;
 if r.phase='question' and (t>=r.deadline or
  (select count(*) from private.answers where room_id=p_room and question_index=r.question_index)>=
  (select count(*) from private.members where room_id=p_room)) then
  select min(elapsed) into fastest from private.answers where room_id=p_room and question_index=r.question_index and correct;
  update private.answers set points=case when correct then round((1000*greatest(.001,fastest)/greatest(.001,elapsed))::numeric)::integer else 0 end
   where room_id=p_room and question_index=r.question_index;
  update private.members m set points=m.points+a.points from private.answers a
   where a.room_id=p_room and a.question_index=r.question_index and a.member_id=m.id;
  if r.question_index+1>=r.question_count then
   update private.rooms set phase='finished',started=false,playing=false,deadline=null where id=p_room;
  else
   -- Preserve scheduled timing after a timeout; use now after an early finish.
   update private.rooms set phase='countdown',question_index=question_index+1,choices=null,
    deadline=least(t,r.deadline)+interval '5 seconds' where id=p_room;
  end if;
 end if;
end $$;

create function public.play_room(p_room text) returns void
language plpgsql security definer set search_path='' as $$
declare r private.rooms;
begin
 perform private.require_host(p_room);
 select * into r from private.rooms where id=p_room for update;
 if r.playing or not r.started then raise exception 'Start a waiting room before playing.'; end if;
 if r.question_count=0 then
  update private.rooms set started=false,playing=false,phase='finished' where id=p_room;
  return;
 end if;
 if not exists(select 1 from private.members where room_id=p_room) then raise exception 'Wait for a guest to join.'; end if;
 update private.rooms set playing=true,phase='countdown',question_index=0,deadline=clock_timestamp()+interval '5 seconds' where id=p_room;
end $$;

create function public.submit_answer(p_room text,p_session uuid,p_question integer,p_choice integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare received timestamptz; r private.rooms; m private.members; a private.answers;
 is_correct boolean; pos integer; elapsed_seconds double precision;
begin
 -- FIRST executable statement: capture real DB wall time, before locks/validation.
 received:=clock_timestamp();
 select * into r from private.rooms where id=p_room for update;
 select * into m from private.members where room_id=p_room and user_id=auth.uid();
 if m.id is null then raise exception 'Join this room first.'; end if;
 if r.session_id is distinct from p_session then raise exception 'This session has ended.'; end if;
 select * into a from private.answers where room_id=p_room and question_index=p_question and member_id=m.id;
 if found then return jsonb_build_object('correct',a.correct,'position',a.correct_position,'choice',a.choice); end if;
 if not r.playing or r.phase<>'question' or r.question_index<>p_question or received<r.question_started or received>=r.deadline then
  raise exception 'This question is closed.';
 end if;
 if p_choice not between 0 and 3 or p_choice is null then raise exception 'Invalid answer.'; end if;
 is_correct:=(r.choices->p_choice->>'correct')::boolean;
 elapsed_seconds:=greatest(.001,extract(epoch from received-r.question_started));
 if is_correct then
  select count(*)+1 into pos from private.answers where room_id=p_room and question_index=p_question and correct;
 end if;
 insert into private.answers(room_id,question_index,member_id,received_at,elapsed,choice,correct,correct_position)
  values(p_room,p_question,m.id,received,elapsed_seconds,p_choice,is_correct,pos);
 -- Correct-response positions are serialized acceptance order; scores use the captured timestamps.
 return jsonb_build_object('correct',is_correct,'position',pos,'choice',p_choice);
end $$;

create function public.room_snapshot(p_room text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r private.rooms; m private.members; host boolean; roster jsonb; answer jsonb; question text; options jsonb;
begin
 if auth.uid() is null then raise exception 'Sign in required.'; end if;
 select exists(select 1 from private.hosts where room_id=p_room and user_id=auth.uid()) into host;
 select * into m from private.members where room_id=p_room and user_id=auth.uid();
 if not host and m.id is null then raise exception 'Join this room first.'; end if;
 perform private.advance_room(p_room);
 select * into r from private.rooms where id=p_room;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.rank),'[]'::jsonb) into roster from
  (select id,name,character,points,row_number() over(order by points desc,joined_at,id) as rank from private.members where room_id=p_room) x;
 if r.phase='question' then
  select body->>'Q' into question from private.questions where room_id=p_room and idx=r.question_index;
  select jsonb_agg(v->'text' order by ord) into options from jsonb_array_elements(r.choices) with ordinality e(v,ord);
  select jsonb_build_object('correct',correct,'position',correct_position,'choice',choice) into answer
   from private.answers where room_id=p_room and question_index=r.question_index and member_id=m.id;
 end if;
 return jsonb_build_object('id',r.id,'theme',r.theme,'phase',r.phase,'started',r.started,'playing',r.playing,
  'session_id',r.session_id,'question_index',r.question_index,'question_count',r.question_count,'deadline',r.deadline,
  'server_time',clock_timestamp(),'host',host,'member_id',m.id,'members',roster,'question',question,'answers',options,'answer',answer);
end $$;

create function public.create_room(p_theme text,p_password text,p_questions jsonb) returns text
language plpgsql security definer set search_path='' as $$
declare rid text; n bigint;
begin
 if auth.uid() is null then raise exception 'Sign in required.'; end if;
 if length(p_password)<4 or p_password is null then raise exception 'Use at least four password characters.'; end if;
 if jsonb_typeof(p_questions) is distinct from 'array' then raise exception 'Questions must be an array.'; end if;
 if exists(select 1 from jsonb_array_elements(p_questions) q where
   jsonb_typeof(q->'Q') is distinct from 'string' or length(trim(q->>'Q'))=0 or
   jsonb_typeof(q->'C') is distinct from 'string' or length(trim(q->>'C'))=0 or
   jsonb_typeof(q->'W1') is distinct from 'string' or length(trim(q->>'W1'))=0 or
   jsonb_typeof(q->'W2') is distinct from 'string' or length(trim(q->>'W2'))=0 or
   jsonb_typeof(q->'W3') is distinct from 'string' or length(trim(q->>'W3'))=0 or
   (select count(distinct v) from unnest(array[q->>'C',q->>'W1',q->>'W2',q->>'W3']) v)<>4)
 then raise exception 'Every question needs Q, C, W1, W2, W3 and four distinct answers.'; end if;
 -- PostgreSQL holds this exclusive row lock until the transaction commits.
 update private.room_counter set next_id=next_id+1 where singleton returning next_id-1 into n;
 rid := 'PID-'||n;
 insert into private.rooms(id,password,theme,question_count) values(rid,p_password,p_theme,jsonb_array_length(p_questions));
 insert into private.questions select rid,(ordinality-1)::integer,value from jsonb_array_elements(p_questions) with ordinality;
 insert into private.hosts values(rid,auth.uid());
 return rid;
end $$;

create function public.unlock_host(p_room text,p_password text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in required.'; end if;
 if not exists(select 1 from private.rooms where id=p_room and password=p_password) then raise exception 'Room or password is incorrect.'; end if;
 if exists(select 1 from private.members where room_id=p_room and user_id=auth.uid()) then raise exception 'This browser is already a guest. Use another browser to host.'; end if;
 insert into private.hosts values(p_room,auth.uid()) on conflict do nothing;
end $$;

create function public.join_room(p_room text,p_name text,p_character integer) returns uuid
language plpgsql security definer set search_path='' as $$
declare r private.rooms; mid uuid;
begin
 if auth.uid() is null then raise exception 'Sign in required.'; end if;
 select * into r from private.rooms where id=p_room for update;
 if not found then raise exception 'Room not found.'; end if;
 select id into mid from private.members where room_id=p_room and user_id=auth.uid();
 if mid is not null then return mid; end if;
 if not r.started or r.playing then raise exception 'This room is not accepting guests.'; end if;
 if exists(select 1 from private.hosts where room_id=p_room and user_id=auth.uid()) then raise exception 'Hosts cannot play. Use a separate browser for a guest.'; end if;
 if length(trim(p_name)) not between 1 and 32 then raise exception 'Use a name between 1 and 32 characters.'; end if;
 insert into private.members(room_id,user_id,name,character) values(p_room,auth.uid(),trim(p_name),p_character)
 on conflict(room_id,user_id) do update set name=excluded.name,character=excluded.character returning id into mid;
 return mid;
end $$;

create function public.start_room(p_room text) returns void
language plpgsql security definer set search_path='' as $$
declare r private.rooms;
begin
 perform private.require_host(p_room);
 select * into r from private.rooms where id=p_room for update;
 if r.playing then raise exception 'A game is already playing.'; end if;
 delete from private.members where room_id=p_room;
 update private.rooms set started=true,playing=false,phase='waiting',question_index=0,choices=null,
 deadline=null,question_started=null,session_id=gen_random_uuid() where id=p_room;
end $$;

create function private.load_question(p_room text,p_start timestamptz) returns void
language plpgsql security definer set search_path='' as $$
declare q jsonb; shuffled jsonb;
begin
 select body into q from private.questions where room_id=p_room and idx=(select question_index from private.rooms where id=p_room);
 select jsonb_agg(jsonb_build_object('text',v,'correct',k='C') order by extensions.gen_random_bytes(16)) into shuffled
 from jsonb_each_text(q) as e(k,v) where k in ('C','W1','W2','W3')
 ;
 update private.rooms set choices=shuffled,phase='question',question_started=p_start,deadline=p_start+interval '15 seconds' where id=p_room;
end $$;

-- No table or private helper is reachable through PostgREST.
revoke all on all functions in schema private from public,anon,authenticated;
revoke all on function public.create_room(text,text,jsonb),public.unlock_host(text,text),public.join_room(text,text,integer),
 public.start_room(text),public.play_room(text),public.submit_answer(text,uuid,integer,integer),public.room_snapshot(text) from public,anon;
grant execute on function public.create_room(text,text,jsonb),public.unlock_host(text,text),public.join_room(text,text,integer),
 public.start_room(text),public.play_room(text),public.submit_answer(text,uuid,integer,integer),public.room_snapshot(text) to authenticated;

