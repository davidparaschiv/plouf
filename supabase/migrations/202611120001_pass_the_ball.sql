-- V3 is isolated from the V1/V2 state machines. Workspace passwords are never returned.
alter table private.rooms drop constraint rooms_type_check;
alter table private.rooms add constraint rooms_type_check check(type in ('v1','v2','v3'));
create table private.workspace_v3(id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name)) between 1 and 80), guest_password_hash text not null, host_password_hash text not null);
create unique index workspace_v3_name on private.workspace_v3(lower(btrim(name)));
create table private.workspace_access_v3(workspace_id uuid references private.workspace_v3 on delete cascade,user_id uuid not null,role text not null check(role in ('host','guest')),primary key(workspace_id,user_id));
create table private.classrooms_v3(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references private.workspace_v3 on delete cascade,name text not null check(length(trim(name)) between 1 and 80),best_score integer not null default 0 check(best_score>=0));
create unique index classrooms_v3_name on private.classrooms_v3(workspace_id,lower(btrim(name)));
create table private.presets_v3(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references private.workspace_v3 on delete cascade,name text not null check(length(trim(name)) between 1 and 80),questions jsonb not null check(jsonb_typeof(questions)='array' and jsonb_array_length(questions)>0));
create unique index presets_v3_name on private.presets_v3(workspace_id,lower(btrim(name)));
create table private.games_v3(room_id text primary key references private.rooms on delete cascade,workspace_id uuid not null references private.workspace_v3,classroom_id uuid not null references private.classrooms_v3,preset_id uuid not null references private.presets_v3,holder uuid references private.members on delete set null,score integer not null default 0,turn_id uuid not null default gen_random_uuid(),event_id uuid not null default gen_random_uuid(),event text not null default 'waiting');
alter table private.workspace_v3 enable row level security;
alter table private.workspace_access_v3 enable row level security;
alter table private.classrooms_v3 enable row level security;
alter table private.presets_v3 enable row level security;
alter table private.games_v3 enable row level security;

create function private.require_workspace_v3(p_workspace uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from private.workspace_access_v3 where workspace_id=p_workspace and user_id=auth.uid()) then raise exception 'Workspace access required.'; end if;
end $$;
create function private.require_workspace_host_v3(p_workspace uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.require_workspace_v3(p_workspace);
 if not exists(select 1 from private.workspace_access_v3 where workspace_id=p_workspace and user_id=auth.uid() and role='host') then raise exception 'Host access required.'; end if;
end $$;
create function public.access_workspace_v3(p_name text,p_password text default null,p_create boolean default false,p_guest_password text default null,p_host_password text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare w private.workspace_v3; access_role text;
begin
 if auth.uid() is null then raise exception 'Sign in required.'; end if;
 if p_create then
  if p_name is null or length(trim(p_name)) not between 1 and 80 then raise exception 'Enter a workspace name.'; end if;
  if p_guest_password is null or p_host_password is null or length(trim(p_guest_password))<4 or length(trim(p_host_password))<4 then raise exception 'Use at least four password characters.'; end if;
  if p_guest_password=p_host_password then raise exception 'Use different Guest and Host passwords.'; end if;
  begin
   insert into private.workspace_v3(name,guest_password_hash,host_password_hash) values(trim(p_name),extensions.crypt(p_guest_password,extensions.gen_salt('bf')),extensions.crypt(p_host_password,extensions.gen_salt('bf'))) returning * into w;
  exception when unique_violation then raise exception 'This workspace name is already used.'; end;
  access_role:='host';
 else
  select * into w from private.workspace_v3 where lower(trim(name))=lower(trim(p_name));
  if w.id is null or p_password is null then raise exception 'Workspace or password is incorrect.'; end if;
  if w.host_password_hash=extensions.crypt(p_password,w.host_password_hash) then access_role:='host';
  elsif w.guest_password_hash=extensions.crypt(p_password,w.guest_password_hash) then access_role:='guest';
  else raise exception 'Workspace or password is incorrect.'; end if;
 end if;
 insert into private.workspace_access_v3 values(w.id,auth.uid(),access_role) on conflict(workspace_id,user_id) do update set role=excluded.role;
 return jsonb_build_object('id',w.id,'name',w.name,'role',access_role);
end $$;
create function public.workspace_options_v3(p_workspace uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.require_workspace_host_v3(p_workspace);
 return jsonb_build_object('classrooms',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'best_score',best_score) order by lower(name)) from private.classrooms_v3 where workspace_id=p_workspace),'[]'::jsonb),'presets',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by lower(name)) from private.presets_v3 where workspace_id=p_workspace),'[]'::jsonb));
end $$;
create function public.create_room_v3(p_workspace uuid,p_classroom uuid,p_classroom_name text,p_preset uuid,p_preset_name text,p_questions jsonb) returns text language plpgsql security definer set search_path='' as $$
declare cid uuid:=p_classroom; pid uuid:=p_preset; rid text; internal_password text:=encode(extensions.gen_random_bytes(32),'hex');
begin
 perform private.require_workspace_host_v3(p_workspace);
 if cid is null then
  if p_classroom_name is null or length(trim(p_classroom_name)) not between 1 and 80 then raise exception 'Enter a classroom name.'; end if;
  begin
   insert into private.classrooms_v3(workspace_id,name) values(p_workspace,trim(p_classroom_name)) returning id into cid;
  exception when unique_violation then raise exception 'This classroom name is already used.'; end;
 end if;
 if not exists(select 1 from private.classrooms_v3 where id=cid and workspace_id=p_workspace) then raise exception 'Choose a classroom.'; end if;
 if pid is null then
  if p_preset_name is null or length(trim(p_preset_name)) not between 1 and 80 then raise exception 'Enter a preset name.'; end if;
  -- Reuse the validated V1 creation function so the JSON contract stays identical.
  rid:=public.create_room('forest',internal_password,p_questions);
  begin
   insert into private.presets_v3(workspace_id,name,questions) values(p_workspace,trim(p_preset_name),p_questions) returning id into pid;
  exception when unique_violation then raise exception 'This preset name is already used.'; end;
 else
  select questions into p_questions from private.presets_v3 where id=pid and workspace_id=p_workspace;
  if not found then raise exception 'Preset not found.'; end if;
  rid:=public.create_room('forest',internal_password,p_questions);
 end if;
 update private.rooms set type='v3' where id=rid;
 insert into private.games_v3(room_id,workspace_id,classroom_id,preset_id) values(rid,p_workspace,cid,pid);
 return rid;
end $$;
create function private.require_room_v3(p_room text) returns void language plpgsql security definer set search_path='' as $$
declare wid uuid;
begin
 select workspace_id into wid from private.games_v3 where room_id=p_room;
 if not found then raise exception 'Room not found.'; end if;
 perform private.require_workspace_v3(wid);
end $$;
create function public.unlock_host_v3(p_room text) returns void language plpgsql security definer set search_path='' as $$
declare wid uuid;
begin
 perform private.require_room_v3(p_room);
 select workspace_id into wid from private.games_v3 where room_id=p_room;
 perform private.require_workspace_host_v3(wid);
 if exists(select 1 from private.members where room_id=p_room and user_id=auth.uid()) then raise exception 'This browser is already a guest. Use another browser to host.'; end if;
 insert into private.hosts values(p_room,auth.uid()) on conflict do nothing;
end $$;
create function public.join_room_v3(p_room text,p_name text,p_character integer) returns uuid language plpgsql security definer set search_path='' as $$
declare r private.rooms; mid uuid;
begin
 perform private.require_room_v3(p_room);
 if not exists(select 1 from private.workspace_access_v3 a join private.games_v3 g on g.workspace_id=a.workspace_id where g.room_id=p_room and a.user_id=auth.uid() and a.role='guest') then raise exception 'Hosts cannot play. Use a separate browser for a guest.'; end if;
 select * into r from private.rooms where id=p_room for update;
 if not r.started or r.playing then raise exception 'This room is not accepting guests.'; end if;
 if exists(select 1 from private.hosts where room_id=p_room and user_id=auth.uid()) then raise exception 'Hosts cannot play. Use a separate browser for a guest.'; end if;
 select id into mid from private.members where room_id=p_room and user_id=auth.uid();
 if mid is not null then return mid; end if;
 if (select count(*) from private.members where room_id=p_room)>=30 then raise exception 'This room is full (30 players).'; end if;
 if p_name is null or length(trim(p_name)) not between 1 and 32 then raise exception 'Use a name between 1 and 32 characters.'; end if;
 if p_character is null or p_character not between 40 and 45 then raise exception 'Choose a plush character.'; end if;
 insert into private.members(room_id,user_id,name,character) values(p_room,auth.uid(),trim(p_name),p_character) returning id into mid;
 return mid;
end $$;
create function private.question_v3(p_room text,p_holder uuid,p_random boolean) returns void language plpgsql security definer set search_path='' as $$
declare q jsonb; opts jsonb; stamp timestamptz:=clock_timestamp();
begin
 select body into q from private.questions where room_id=p_room and idx=(select question_index from private.rooms where id=p_room);
 with answer_order as (select k,v,row_number() over(order by extensions.gen_random_bytes(16)) n from jsonb_each_text(q) e(k,v) where k in ('C','W1','W2','W3')),
 color_order as (select color,row_number() over(order by extensions.gen_random_bytes(16)) n from generate_series(0,3) color)
 select jsonb_agg(jsonb_build_object('text',a.v,'correct',a.k='C','color',c.color) order by a.n) into opts from answer_order a join color_order c using(n);
 update private.games_v3 set holder=p_holder,turn_id=gen_random_uuid(),event_id=gen_random_uuid(),event=case when p_random then 'random' else 'received' end where room_id=p_room;
 update private.rooms set phase='question',choices=opts,question_started=stamp,deadline=stamp+interval '20 seconds' where id=p_room;
end $$;
create function private.reset_v3(p_room text,p_event text) returns void language plpgsql security definer set search_path='' as $$
begin
 update private.games_v3 set score=0,holder=null,event=p_event,event_id=gen_random_uuid(),turn_id=gen_random_uuid() where room_id=p_room;
 update private.rooms set phase='restart',question_index=0,choices=null,deadline=clock_timestamp()+interval '2 seconds' where id=p_room;
end $$;
create function private.finish_v3(p_room text) returns void language plpgsql security definer set search_path='' as $$
begin
 update private.rooms set started=false,playing=false,phase='finished',deadline=null where id=p_room;
 update private.games_v3 set event='finished',event_id=gen_random_uuid() where room_id=p_room;
end $$;
create function public.control_room_v3(p_room text,p_action text) returns void language plpgsql security definer set search_path='' as $$
declare r private.rooms; mid uuid;
begin
 perform private.require_room_v3(p_room); perform private.require_workspace_host_v3((select workspace_id from private.games_v3 where room_id=p_room)); perform private.require_host(p_room);
 select * into r from private.rooms where id=p_room for update;
 if p_action='finish' then perform private.finish_v3(p_room); return; end if;
 if r.playing then raise exception 'A game is already playing.'; end if;
 if p_action='start' then
  update private.games_v3 set holder=null,score=0,turn_id=gen_random_uuid(),event='waiting',event_id=gen_random_uuid() where room_id=p_room;
  delete from private.members where room_id=p_room;
  update private.rooms set started=true,playing=false,phase='waiting',question_index=0,choices=null,deadline=null,session_id=gen_random_uuid() where id=p_room;
 elsif p_action='play' then
  if not r.started or (select count(*) from private.members where room_id=p_room)<2 then raise exception 'Wait for at least two guests.'; end if;
  select id into mid from private.members where room_id=p_room order by extensions.gen_random_bytes(16) limit 1;
  update private.rooms set playing=true,question_index=0 where id=p_room;
  perform private.question_v3(p_room,mid,true);
 else raise exception 'Invalid action.';
 end if;
end $$;
create function private.advance_v3(p_room text) returns void language plpgsql security definer set search_path='' as $$
declare r private.rooms; mid uuid;
begin
 select * into r from private.rooms where id=p_room for update;
 if not r.playing then return; end if;
 if r.phase='question' and clock_timestamp()>=r.deadline then perform private.reset_v3(p_room,'timeout');
 elsif r.phase='restart' and clock_timestamp()>=r.deadline then
  select id into mid from private.members where room_id=p_room order by extensions.gen_random_bytes(16) limit 1;
  perform private.question_v3(p_room,mid,true);
 end if;
end $$;
create function public.answer_v3(p_room text,p_session uuid,p_turn uuid,p_choice integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.rooms; g private.games_v3; correct boolean;
begin
 perform private.require_room_v3(p_room);
 select * into r from private.rooms where id=p_room for update;
 select * into g from private.games_v3 where room_id=p_room;
 if r.session_id is distinct from p_session or g.turn_id is distinct from p_turn or r.phase<>'question' or not r.playing then raise exception 'This question is closed.'; end if;
 if not exists(select 1 from private.workspace_access_v3 where workspace_id=g.workspace_id and user_id=auth.uid() and role='guest') or not exists(select 1 from private.members where id=g.holder and user_id=auth.uid()) or exists(select 1 from private.hosts where room_id=p_room and user_id=auth.uid()) then raise exception 'Wait for the ball.'; end if;
 if clock_timestamp()>=r.deadline then perform private.reset_v3(p_room,'timeout'); return jsonb_build_object('correct',false); end if;
 if p_choice is null or p_choice not between 0 and 3 then raise exception 'Invalid answer.'; end if;
 correct:=(r.choices->p_choice->>'correct')::boolean;
 if not correct then perform private.reset_v3(p_room,'wrong');
 else
  update private.games_v3 set score=score+100,event='correct',event_id=gen_random_uuid() where room_id=p_room returning * into g;
  update private.classrooms_v3 set best_score=greatest(best_score,g.score) where id=g.classroom_id;
  if r.question_index+1>=r.question_count then perform private.finish_v3(p_room);
  else update private.rooms set phase='passing',deadline=null,question_index=question_index+1 where id=p_room; end if;
 end if;
 return jsonb_build_object('correct',correct);
end $$;
create function public.pass_ball_v3(p_room text,p_session uuid,p_turn uuid,p_target uuid) returns void language plpgsql security definer set search_path='' as $$
declare r private.rooms; g private.games_v3;
begin
 perform private.require_room_v3(p_room);
 select * into r from private.rooms where id=p_room for update;
 select * into g from private.games_v3 where room_id=p_room;
 if r.session_id is distinct from p_session or g.turn_id is distinct from p_turn or not r.playing or r.phase<>'passing' then raise exception 'Wait for the ball.'; end if;
 if not exists(select 1 from private.workspace_access_v3 where workspace_id=g.workspace_id and user_id=auth.uid() and role='guest') or not exists(select 1 from private.members where id=g.holder and user_id=auth.uid()) or exists(select 1 from private.hosts where room_id=p_room and user_id=auth.uid()) then raise exception 'Wait for the ball.'; end if;
 if p_target is null or p_target=g.holder or not exists(select 1 from private.members where room_id=p_room and id=p_target) then raise exception 'Choose another player.'; end if;
 perform private.question_v3(p_room,p_target,false);
end $$;
create function public.snapshot_v3(p_room text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.rooms; g private.games_v3; host boolean; mid uuid; can_see boolean; result jsonb;
begin
 perform private.require_room_v3(p_room);
 select exists(select 1 from private.hosts h join private.games_v3 game_access on game_access.room_id=h.room_id join private.workspace_access_v3 a on a.workspace_id=game_access.workspace_id and a.user_id=h.user_id where h.room_id=p_room and h.user_id=auth.uid() and a.role='host') into host;
 select id into mid from private.members where room_id=p_room and user_id=auth.uid();
 if not host and mid is null then raise exception 'Join this room first.'; end if;
 perform private.advance_v3(p_room);
 select * into r from private.rooms where id=p_room;
 select * into g from private.games_v3 where room_id=p_room;
 can_see:=host or mid=g.holder;
 result:=jsonb_build_object('id',r.id,'type','v3','phase',r.phase,'started',r.started,'playing',r.playing,'host',host,'member_id',mid,'holder',g.holder,'session_id',r.session_id,'turn_id',g.turn_id,'event_id',g.event_id,'event',g.event,'score',g.score,'deadline',r.deadline,'server_time',clock_timestamp(),'question_index',r.question_index,'question_count',r.question_count,
 'classroom',(select name from private.classrooms_v3 where id=g.classroom_id),'best_score',(select best_score from private.classrooms_v3 where id=g.classroom_id),
 'members',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'character',character) order by joined_at,id) from private.members where room_id=p_room),'[]'::jsonb));
 if r.phase='question' and can_see then
  result:=result||jsonb_build_object('question',(select body->>'Q' from private.questions where room_id=p_room and idx=r.question_index),'answers',(select jsonb_agg(v->'text' order by ord) from jsonb_array_elements(r.choices) with ordinality e(v,ord)),'answer_colors',(select jsonb_agg(v->'color' order by ord) from jsonb_array_elements(r.choices) with ordinality e(v,ord)),'correct_choice',case when host then (select ord-1 from jsonb_array_elements(r.choices) with ordinality e(v,ord) where (v->>'correct')::boolean) else null end);
 end if;
 if r.phase='finished' then
  result:=result||jsonb_build_object('ranking',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'points',best_score) order by best_score desc,lower(name),id) from private.classrooms_v3 where workspace_id=g.workspace_id),'[]'::jsonb));
 end if;
 return result;
end $$;
-- Route old entry points away from V3 so its private questions cannot leak through V1.
alter function public.room_snapshot(text) rename to legacy_snapshot_before_v3;
alter function public.legacy_snapshot_before_v3(text) set schema private;
create function public.room_snapshot(p_room text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from private.games_v3 where room_id=p_room) then return public.snapshot_v3(p_room); end if;
 return private.legacy_snapshot_before_v3(p_room);
end $$;
alter function public.unlock_host(text,text) rename to legacy_unlock_before_v3;
alter function public.legacy_unlock_before_v3(text,text) set schema private;
create function public.unlock_host(p_room text,p_password text) returns void language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from private.games_v3 where room_id=p_room) then perform public.unlock_host_v3(p_room); return; end if;
 perform private.legacy_unlock_before_v3(p_room,p_password);
end $$;
-- start/play must only use the V3 control endpoint for V3 rooms.
alter function public.start_room(text) rename to legacy_start_before_v3;
alter function public.legacy_start_before_v3(text) set schema private;
create function public.start_room(p_room text) returns void language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from private.games_v3 where room_id=p_room) then perform public.control_room_v3(p_room,'start'); else perform private.legacy_start_before_v3(p_room); end if;
end $$;
alter function public.play_room(text) rename to legacy_play_before_v3;
alter function public.legacy_play_before_v3(text) set schema private;
create function public.play_room(p_room text) returns void language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from private.games_v3 where room_id=p_room) then perform public.control_room_v3(p_room,'play'); else perform private.legacy_play_before_v3(p_room); end if;
end $$;
revoke all on all functions in schema private from public,anon,authenticated;
revoke all on function public.access_workspace_v3(text,text,boolean,text,text),public.workspace_options_v3(uuid),public.create_room_v3(uuid,uuid,text,uuid,text,jsonb),public.unlock_host_v3(text),public.join_room_v3(text,text,integer),public.control_room_v3(text,text),public.answer_v3(text,uuid,uuid,integer),public.pass_ball_v3(text,uuid,uuid,uuid),public.snapshot_v3(text),public.room_snapshot(text),public.unlock_host(text,text),public.start_room(text),public.play_room(text) from public,anon;
grant execute on function public.access_workspace_v3(text,text,boolean,text,text),public.workspace_options_v3(uuid),public.create_room_v3(uuid,uuid,text,uuid,text,jsonb),public.unlock_host_v3(text),public.join_room_v3(text,text,integer),public.control_room_v3(text,text),public.answer_v3(text,uuid,uuid,integer),public.pass_ball_v3(text,uuid,uuid,uuid),public.snapshot_v3(text),public.room_snapshot(text),public.unlock_host(text,text),public.start_room(text),public.play_room(text) to authenticated;
-- The V1 answer RPC must not be usable to probe a V3 question.
alter function public.submit_answer(text,uuid,integer,integer,integer) rename to legacy_answer_before_v3;
alter function public.legacy_answer_before_v3(text,uuid,integer,integer,integer) set schema private;
create function public.submit_answer(p_room text,p_session uuid,p_question integer,p_choice integer,p_elapsed_ms integer) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from private.games_v3 where room_id=p_room) then raise exception 'Wait for the ball.'; end if;
 return private.legacy_answer_before_v3(p_room,p_session,p_question,p_choice,p_elapsed_ms);
end $$;
revoke all on function private.legacy_answer_before_v3(text,uuid,integer,integer,integer) from public,anon,authenticated;
revoke all on function public.submit_answer(text,uuid,integer,integer,integer) from public,anon;
grant execute on function public.submit_answer(text,uuid,integer,integer,integer) to authenticated;
notify pgrst, 'reload schema';
