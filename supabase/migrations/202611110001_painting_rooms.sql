-- V2 is additive; existing rooms and V1 rules remain unchanged.
create extension if not exists unaccent with schema extensions;
alter table private.rooms add column duration_seconds integer not null default 120 check(duration_seconds in (30,60,120,300));
alter table private.rooms add column type text not null default 'v1' check(type in ('v1','v2'));
create table private.paintings (
 room_id text primary key references private.rooms on delete cascade,
 image_path text not null unique, hint text not null, correct_items jsonb not null
);
create table private.item_guesses (
 member_id uuid references private.members on delete cascade,
 session_id uuid not null, guess_key text not null, item_index integer,
 correct boolean not null, primary key(member_id,session_id,guess_key)
);
create unique index item_found_once on private.item_guesses(member_id,session_id,item_index) where correct;
alter table private.paintings enable row level security;
alter table private.item_guesses enable row level security;
revoke all on private.paintings,private.item_guesses from public,anon,authenticated;
create function private.item_text(value text) returns text language sql immutable set search_path='' as $$
 select lower(trim(regexp_replace(normalize(value,NFC),U&'[\0009-\000D\0020\0085\00A0\1680\2000-\200A\2028\2029\202F\205F\3000]+',' ','g')));
$$;
create function private.item_key(value text) returns text language sql stable set search_path='' as $$
 select extensions.unaccent('extensions.unaccent'::regdictionary,private.item_text(value));
$$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('paintings','paintings',false,5242880,array['image/png']) on conflict(id) do nothing;
create function public.can_read_painting(p_path text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.paintings p join private.rooms r on r.id=p.room_id
 where p.image_path=p_path and (exists(select 1 from private.hosts h where h.room_id=r.id and h.user_id=auth.uid())
 or exists(select 1 from private.members m where m.room_id=r.id and m.user_id=auth.uid())));
$$;
revoke all on function public.can_read_painting(text) from public,anon;
grant execute on function public.can_read_painting(text) to authenticated;
create policy painting_upload on storage.objects for insert to authenticated with check
(bucket_id='paintings' and (storage.foldername(name))[1]=auth.uid()::text);
create policy painting_read on storage.objects for select to authenticated using
(bucket_id='paintings' and (public.can_read_painting(name) or (storage.foldername(name))[1]=auth.uid()::text));
create policy painting_cleanup on storage.objects for delete to authenticated using
(bucket_id='paintings' and (storage.foldername(name))[1]=auth.uid()::text
 and not public.can_read_painting(name));

create function public.create_painting_room(p_password text,p_hint text,p_image_path text,p_items jsonb,p_duration integer default 120) returns text
language plpgsql security definer set search_path='' as $$
declare rid text; n bigint; normalized jsonb;
begin
 if auth.uid() is null then raise exception 'Sign in required.'; end if;
 if p_password is null or length(p_password)<4 then raise exception 'Use at least four password characters.'; end if;
 if p_duration is null or p_duration not in (30,60,120,300) then raise exception 'Choose a supported duration.'; end if;
 if p_hint is null or length(trim(p_hint)) not between 1 and 160 then raise exception 'Enter a theme hint (1–160 characters).'; end if;
 if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Items must be a JSON array of strings.'; end if;
 if exists(select 1 from jsonb_array_elements(p_items) v where jsonb_typeof(v) is distinct from 'string' or length(private.item_text(v#>>'{}'))=0)
 then raise exception 'Items must be a JSON array of strings.'; end if;
 if (select count(*)<>count(distinct private.item_key(v)) from jsonb_array_elements_text(p_items) v)
 then raise exception 'Item names must be unique, including without accents.'; end if;
 if not exists(select 1 from storage.objects where bucket_id='paintings' and name=p_image_path
 and (storage.foldername(name))[1]=auth.uid()::text) then raise exception 'Upload a PNG painting first.'; end if;
 select coalesce(jsonb_agg(private.item_text(v) order by ord),'[]'::jsonb) into normalized from jsonb_array_elements_text(p_items) with ordinality e(v,ord);
 update private.room_counter set next_id=next_id+1 where singleton returning next_id-1 into n;
 rid:='PID-'||n;
 insert into private.rooms(id,password,theme,type,question_count,duration_seconds) values(rid,p_password,'forest','v2',jsonb_array_length(normalized),p_duration);
 insert into private.paintings values(rid,p_image_path,trim(p_hint),normalized);
 insert into private.hosts values(rid,auth.uid());
 return rid;
end $$;

alter function private.advance_room(text) rename to advance_room_v1;
create function private.advance_room(p_room text) returns void
language plpgsql security definer set search_path='' as $$
declare r private.rooms; total integer;
begin
 select * into r from private.rooms where id=p_room for update;
 if r.type='v1' then perform private.advance_room_v1(p_room); return; end if;
 if not r.playing then return; end if;
 if r.phase='countdown' and clock_timestamp()>=r.deadline then
  update private.rooms set phase='painting',question_started=deadline,deadline=deadline+make_interval(secs=>r.duration_seconds) where id=p_room;
  select * into r from private.rooms where id=p_room;
 end if;
 if r.phase='painting' then
  select jsonb_array_length(correct_items) into total from private.paintings where room_id=p_room;
  if clock_timestamp()>=r.deadline or not exists(select 1 from private.members m where m.room_id=p_room
    and (select count(*) from private.item_guesses g where g.member_id=m.id and g.session_id=r.session_id and g.correct)<total)
  then update private.rooms set phase='finished',started=false,playing=false,deadline=null where id=p_room; end if;
 end if;
end $$;
alter function public.play_room(text) rename to play_room_v1;
revoke all on function public.play_room_v1(text) from public,anon,authenticated;
create function public.play_room(p_room text) returns void
language plpgsql security definer set search_path='' as $$
declare r private.rooms;
begin
 perform private.require_host(p_room);
 select * into r from private.rooms where id=p_room for update;
 if r.type='v1' then perform public.play_room_v1(p_room); return; end if;
 if r.playing or not r.started then raise exception 'Start a waiting room before playing.'; end if;
 if not exists(select 1 from private.members where room_id=p_room) then raise exception 'Wait for a guest to join.'; end if;
 update private.rooms set playing=true,phase='countdown',deadline=clock_timestamp()+interval '3 seconds' where id=p_room;
end $$;

create function public.submit_item(p_room text,p_session uuid,p_guess text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare received timestamptz; r private.rooms; m private.members; g private.item_guesses; key text; item integer; total integer; found_count integer;
begin
 received:=clock_timestamp();
 select * into r from private.rooms where id=p_room for update;
 if r.type is distinct from 'v2' then raise exception 'Room is not a painting game.'; end if;
 if exists(select 1 from private.hosts where room_id=p_room and user_id=auth.uid()) then raise exception 'Hosts cannot play. Use a separate browser for a guest.'; end if;
 select * into m from private.members where room_id=p_room and user_id=auth.uid();
 if m.id is null then raise exception 'Join this room first.'; end if;
 if r.session_id is distinct from p_session then raise exception 'This session has ended.'; end if;
 key:=private.item_key(p_guess);
 if key is null or length(key)=0 then raise exception 'Enter an item.'; end if;
 select * into g from private.item_guesses where member_id=m.id and session_id=p_session and guess_key=key;
 if found then return jsonb_build_object('correct',g.correct,'duplicate',true,'points',m.points); end if;
 perform private.advance_room(p_room);
 select * into r from private.rooms where id=p_room;
 if not r.playing or r.phase<>'painting' or received<r.question_started or received>=r.deadline then raise exception 'This question is closed.'; end if;
 select jsonb_array_length(correct_items) into total from private.paintings where room_id=p_room;
 select count(*) into found_count from private.item_guesses where member_id=m.id and session_id=p_session and correct;
 if found_count>=total then raise exception 'All items found. Wait for the others.'; end if;
 select (ord-1)::integer into item from private.paintings p,jsonb_array_elements_text(p.correct_items) with ordinality e(v,ord)
 where p.room_id=p_room and private.item_key(v)=key;
 insert into private.item_guesses values(m.id,p_session,key,item,item is not null);
 update private.members set points=points+case when item is not null then 500 else -100 end where id=m.id returning * into m;
 perform private.advance_room(p_room);
 return jsonb_build_object('correct',item is not null,'duplicate',false,'points',m.points);
end $$;

alter function public.room_snapshot(text) rename to room_snapshot_v1;
revoke all on function public.room_snapshot_v1(text) from public,anon,authenticated;
create function public.room_snapshot(p_room text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r private.rooms; m private.members; is_host boolean; roster jsonb; result jsonb; painting private.paintings; found_items jsonb; total_guests integer;
begin
 if auth.uid() is null then raise exception 'Sign in required.'; end if;
 select * into r from private.rooms where id=p_room;
 if r.type='v1' then return public.room_snapshot_v1(p_room)||jsonb_build_object('type','v1'); end if;
 select exists(select 1 from private.hosts where room_id=p_room and user_id=auth.uid()) into is_host;
 select * into m from private.members where room_id=p_room and user_id=auth.uid();
 if not is_host and m.id is null then raise exception 'Join this room first.'; end if;
 perform private.advance_room(p_room);
 select * into r from private.rooms where id=p_room;
 select * into painting from private.paintings where room_id=p_room;
 select count(*) into total_guests from private.members where room_id=p_room;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.rank),'[]'::jsonb) into roster from
 (select id,name,character,points,row_number() over(order by points desc,joined_at,id) as rank from private.members where room_id=p_room) x;
 -- Live guests receive only themselves and never any ranking, even through the API.
 if not is_host and r.phase<>'finished' then
  select coalesce(jsonb_agg(v-'rank'),'[]'::jsonb) into roster from jsonb_array_elements(roster) v
  where r.phase in ('waiting','closed') or v->>'id'=m.id::text;
 end if;
 select coalesce(jsonb_agg(painting.correct_items->g.item_index order by g.item_index),'[]'::jsonb) into found_items
 from private.item_guesses g where g.member_id=m.id and g.session_id=r.session_id and g.correct;
 return jsonb_build_object('id',r.id,'type','v2','theme',r.theme,'phase',r.phase,'started',r.started,'playing',r.playing,
 'session_id',r.session_id,'question_index',0,'question_count',r.question_count,'deadline',r.deadline,
 'server_time',clock_timestamp(),'host',is_host,'member_id',m.id,'members',roster,'guest_count',total_guests,
 'duration_seconds',r.duration_seconds,'hint',painting.hint,'image_path',painting.image_path,'found_items',found_items,'total_items',jsonb_array_length(painting.correct_items),'points',m.points);
end $$;
create or replace function public.room_info(p_room text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r private.rooms; existing_member boolean;
begin
 if auth.uid() is null then raise exception 'Sign in required.'; end if;
 select * into r from private.rooms where id=p_room;
 if not found then raise exception 'Room not found.'; end if;
 select exists(select 1 from private.members where room_id=p_room and user_id=auth.uid()) into existing_member;
 return jsonb_build_object('theme',r.theme,'type',r.type,'can_join',(r.started and not r.playing) or existing_member);
end $$;
revoke all on all functions in schema private from public,anon,authenticated;
revoke all on function public.create_painting_room(text,text,text,jsonb,integer),public.submit_item(text,uuid,text),public.room_snapshot(text),public.play_room(text) from public,anon;
grant execute on function public.create_painting_room(text,text,text,jsonb,integer),public.submit_item(text,uuid,text),public.room_snapshot(text),public.play_room(text) to authenticated;
