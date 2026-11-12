-- Host credentials belong to workspaces; guest credentials belong to classrooms.
alter table private.workspace_v3 add column password_hash text;
-- Existing classroom host passwords become the workspace host password.
update private.workspace_v3 w set password_hash=(select c.host_password_hash from private.classrooms_v3 c where c.workspace_id=w.id order by c.id limit 1);
create table private.workspace_hosts_v3(workspace_id uuid references private.workspace_v3 on delete cascade,user_id uuid not null,primary key(workspace_id,user_id));
alter table private.workspace_hosts_v3 enable row level security;
insert into private.workspace_hosts_v3 select distinct c.workspace_id,a.user_id from private.classroom_access_v3 a join private.classrooms_v3 c on c.id=a.classroom_id where a.role='host';
create or replace function private.require_workspace_host_v3(p_workspace uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.require_workspace_v3(p_workspace);
 if not exists(select 1 from private.workspace_hosts_v3 where workspace_id=p_workspace and user_id=auth.uid()) then raise exception 'Host access required.'; end if;
end $$;
create or replace function private.require_room_v3(p_room text) returns void language plpgsql security definer set search_path='' as $$
declare game private.games_v3;
begin
 select * into game from private.games_v3 where room_id=p_room;
 if not found then raise exception 'Room not found.'; end if;
 if auth.uid() is null or not (exists(select 1 from private.workspace_hosts_v3 where workspace_id=game.workspace_id and user_id=auth.uid()) or exists(select 1 from private.classroom_access_v3 where classroom_id=game.classroom_id and user_id=auth.uid() and role='guest')) then raise exception 'Classroom access required.'; end if;
end $$;
drop function public.access_workspace_v3(text,boolean);
create function public.access_workspace_v3(p_name text,p_password text,p_create boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare w private.workspace_v3;
begin
 if auth.uid() is null then raise exception 'Sign in required.'; end if;
 if p_password is null or length(trim(p_password))<4 then raise exception 'Use at least four password characters.'; end if;
 if p_create then
  if p_name is null or length(trim(p_name)) not between 1 and 80 then raise exception 'Enter a workspace name.'; end if;
  begin
   insert into private.workspace_v3(name,password_hash) values(trim(p_name),extensions.crypt(encode(extensions.digest(p_password,'sha256'),'hex'),extensions.gen_salt('bf'))) returning * into w;
  exception when unique_violation then raise exception 'This workspace name is already used.'; end;
 else
  select * into w from private.workspace_v3 where lower(trim(name))=lower(trim(p_name)) for update;
  if w.id is null then raise exception 'Workspace or password is incorrect.'; end if;
  -- A previously passwordless, empty workspace can have its first password set.
  if w.password_hash is null then
   update private.workspace_v3 set password_hash=extensions.crypt(encode(extensions.digest(p_password,'sha256'),'hex'),extensions.gen_salt('bf')) where id=w.id returning * into w;
  elsif w.password_hash<>extensions.crypt(encode(extensions.digest(p_password,'sha256'),'hex'),w.password_hash) then raise exception 'Workspace or password is incorrect.'; end if;
 end if;
 insert into private.workspace_hosts_v3 values(w.id,auth.uid()) on conflict do nothing;
 return jsonb_build_object('id',w.id,'name',w.name);
end $$;
create or replace function public.list_workspaces_v3() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in required.'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'needs_password',password_hash is null) order by lower(name),id) from private.workspace_v3),'[]'::jsonb);
end $$;
create or replace function public.list_classrooms_v3(p_workspace uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in required.'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'workspace_id',w.id,'workspace_name',w.name) order by lower(c.name),lower(w.name),c.id) from private.classrooms_v3 c join private.workspace_v3 w on w.id=c.workspace_id where p_workspace is null or c.workspace_id=p_workspace),'[]'::jsonb);
end $$;
drop function public.access_classroom_v3(uuid,uuid,text,text,boolean,text,text);
create function public.join_classroom_v3(p_classroom uuid,p_password text) returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.classrooms_v3;
begin
 if auth.uid() is null then raise exception 'Sign in required.'; end if;
 select * into c from private.classrooms_v3 where id=p_classroom;
 if c.id is null or p_password is null or c.guest_password_hash<>extensions.crypt(encode(extensions.digest(p_password,'sha256'),'hex'),c.guest_password_hash) then raise exception 'Classroom or password is incorrect.'; end if;
 insert into private.classroom_access_v3 values(c.id,auth.uid(),'guest') on conflict(classroom_id,user_id) do update set role='guest';
 return jsonb_build_object('id',c.id,'name',c.name,'workspace_id',c.workspace_id,'workspace_name',(select name from private.workspace_v3 where id=c.workspace_id));
end $$;
drop function public.create_room_v3(uuid,uuid,text,uuid,text,jsonb);


create or replace function public.create_room_v3(p_workspace uuid,p_classroom uuid,p_classroom_name text,p_preset uuid,p_preset_name text,p_questions jsonb,p_classroom_password text default null) returns text language plpgsql security definer set search_path='' as $$
declare cid uuid:=p_classroom; pid uuid:=p_preset; rid text; internal_password text:=encode(extensions.gen_random_bytes(32),'hex');
begin
 perform private.require_workspace_host_v3(p_workspace);
 if cid is null then
  if p_classroom_name is null or length(trim(p_classroom_name)) not between 1 and 80 then raise exception 'Enter a classroom name.'; end if;
  if p_classroom_password is null or length(trim(p_classroom_password))<4 then raise exception 'Use at least four password characters.'; end if;
  begin
   insert into private.classrooms_v3(workspace_id,name,guest_password_hash) values(p_workspace,trim(p_classroom_name),extensions.crypt(encode(extensions.digest(p_classroom_password,'sha256'),'hex'),extensions.gen_salt('bf'))) returning id into cid;
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

create or replace function public.unlock_host_v3(p_room text) returns void language plpgsql security definer set search_path='' as $$
declare wid uuid;
begin
 perform private.require_room_v3(p_room);
 select workspace_id into wid from private.games_v3 where room_id=p_room;
 perform private.require_workspace_host_v3(wid);
 if exists(select 1 from private.members where room_id=p_room and user_id=auth.uid()) then raise exception 'This browser is already a guest. Use another browser to host.'; end if;
 insert into private.hosts values(p_room,auth.uid()) on conflict do nothing;
end $$;

create or replace function public.control_room_v3(p_room text,p_action text) returns void language plpgsql security definer set search_path='' as $$
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

create or replace function public.snapshot_v3(p_room text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.rooms; g private.games_v3; host boolean; mid uuid; can_see boolean; result jsonb;
begin
 perform private.require_room_v3(p_room);
 select exists(select 1 from private.hosts h join private.games_v3 game_access on game_access.room_id=h.room_id join private.workspace_hosts_v3 a on a.workspace_id=game_access.workspace_id and a.user_id=h.user_id where h.room_id=p_room and h.user_id=auth.uid()) into host;
 select id into mid from private.members where room_id=p_room and user_id=auth.uid();
 if not host and mid is null then raise exception 'Join this room first.'; end if;
 perform private.advance_v3(p_room);
 select * into r from private.rooms where id=p_room;
 select * into g from private.games_v3 where room_id=p_room;
 can_see:=host or mid=g.holder;
 result:=jsonb_build_object('id',r.id,'type','v3','phase',r.phase,'started',r.started,'playing',r.playing,'host',host,'member_id',mid,'holder',g.holder,'session_id',r.session_id,'turn_id',g.turn_id,'event_id',g.event_id,'event',g.event,'score',g.score,'deadline',r.deadline,'server_time',clock_timestamp(),'question_index',r.question_index,'question_count',r.question_count,
 'classroom_id',g.classroom_id,'classroom',(select name from private.classrooms_v3 where id=g.classroom_id),'best_score',(select best_score from private.classrooms_v3 where id=g.classroom_id),
 'members',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'character',character) order by joined_at,id) from private.members where room_id=p_room),'[]'::jsonb));
 if r.phase='question' and can_see then
  result:=result||jsonb_build_object('question',(select body->>'Q' from private.questions where room_id=p_room and idx=r.question_index),'answers',(select jsonb_agg(v->'text' order by ord) from jsonb_array_elements(r.choices) with ordinality e(v,ord)),'answer_colors',(select jsonb_agg(v->'color' order by ord) from jsonb_array_elements(r.choices) with ordinality e(v,ord)),'correct_choice',case when host then (select ord-1 from jsonb_array_elements(r.choices) with ordinality e(v,ord) where (v->>'correct')::boolean) else null end);
 end if;
 if r.phase='finished' then
  result:=result||jsonb_build_object('ranking',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'points',best_score) order by best_score desc,best_reached_at,id) from private.classrooms_v3 where workspace_id=g.workspace_id),'[]'::jsonb));
 end if;
 return result;
end $$;

alter table private.classrooms_v3 drop column host_password_hash;
delete from private.classroom_access_v3 where role='host';
revoke all on all functions in schema private from public,anon,authenticated;
revoke all on function public.access_workspace_v3(text,text,boolean),public.join_classroom_v3(uuid,text),public.create_room_v3(uuid,uuid,text,uuid,text,jsonb,text) from public,anon;
grant execute on function public.access_workspace_v3(text,text,boolean),public.join_classroom_v3(uuid,text),public.create_room_v3(uuid,uuid,text,uuid,text,jsonb,text) to authenticated;
notify pgrst, 'reload schema';

create function public.find_room_v3(p_room text,p_classroom uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.rooms; cid uuid;
begin
 if auth.uid() is null then raise exception 'Sign in required.'; end if;
 select * into r from private.rooms where id=p_room;
 if not found then raise exception 'Room not found.'; end if;
 if r.type<>'v3' then raise exception 'Room has other type: %',upper(r.type); end if;
 select classroom_id into cid from private.games_v3 where room_id=p_room;
 if cid is distinct from p_classroom then raise exception 'Room created for different classroom.'; end if;
 perform private.require_classroom_v3(p_classroom,'guest');
 return jsonb_build_object('type','v3','can_join',r.started and not r.playing);
end $$;
drop function public.join_room_v3(text,text,integer);
create or replace function public.join_room_v3(p_room text,p_name text,p_character integer,p_classroom uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare r private.rooms; mid uuid;
begin
 perform public.find_room_v3(p_room,p_classroom);
 if not exists(select 1 from private.classroom_access_v3 a join private.games_v3 g on g.classroom_id=a.classroom_id where g.room_id=p_room and a.user_id=auth.uid() and a.role='guest') then raise exception 'Hosts cannot play. Use a separate browser for a guest.'; end if;
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
revoke all on function public.find_room_v3(text,uuid),public.join_room_v3(text,text,integer,uuid) from public,anon;
grant execute on function public.find_room_v3(text,uuid),public.join_room_v3(text,text,integer,uuid) to authenticated;
notify pgrst, 'reload schema';
