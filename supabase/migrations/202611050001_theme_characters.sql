-- Add the fourth room theme and a server-validated character catalog.
-- Apply this migration with sync_supabase.py before publishing the new UI.
alter table private.rooms drop constraint rooms_theme_check;
alter table private.rooms add constraint rooms_theme_check check(theme in ('forest','christmas','underwater','jungle'));
alter table private.members drop constraint members_character_check;
alter table private.members add constraint members_character_check check(character between 0 and 39);
create table private.character_catalog(id integer primary key,theme text not null);
alter table private.character_catalog enable row level security;
revoke all on private.character_catalog from public,anon,authenticated;
insert into private.character_catalog(id,theme) values
(0,'jungle'),
(1,'jungle'),
(4,'jungle'),
(5,'jungle'),
(6,'jungle'),
(10,'jungle'),
(11,'jungle'),
(12,'jungle'),
(13,'jungle'),
(14,'jungle'),
(2,'christmas'),
(3,'christmas'),
(15,'christmas'),
(16,'christmas'),
(17,'christmas'),
(18,'christmas'),
(19,'christmas'),
(20,'christmas'),
(21,'christmas'),
(22,'christmas'),
(7,'forest'),
(23,'forest'),
(24,'forest'),
(25,'forest'),
(26,'forest'),
(27,'forest'),
(28,'forest'),
(29,'forest'),
(30,'forest'),
(31,'forest'),
(8,'underwater'),
(9,'underwater'),
(32,'underwater'),
(33,'underwater'),
(34,'underwater'),
(35,'underwater'),
(36,'underwater'),
(37,'underwater'),
(38,'underwater'),
(39,'underwater');

create function public.room_info(p_room text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r private.rooms; existing_member boolean;
begin
 if auth.uid() is null then raise exception 'Sign in required.'; end if;
 select * into r from private.rooms where id=p_room;
 if not found then raise exception 'Room not found.'; end if;
 select exists(select 1 from private.members where room_id=p_room and user_id=auth.uid()) into existing_member;
 return jsonb_build_object('theme',r.theme,'can_join',(r.started and not r.playing) or existing_member);
end $$;
revoke all on function public.room_info(text) from public,anon;
grant execute on function public.room_info(text) to authenticated;

create or replace function public.join_room(p_room text,p_name text,p_character integer) returns uuid
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
 if not exists(select 1 from private.character_catalog where id=p_character and theme=r.theme) then raise exception 'Choose a character from this room’s theme.'; end if;
 if length(trim(p_name)) not between 1 and 32 then raise exception 'Use a name between 1 and 32 characters.'; end if;
 insert into private.members(room_id,user_id,name,character) values(p_room,auth.uid(),trim(p_name),p_character)
 on conflict(room_id,user_id) do update set name=excluded.name,character=excluded.character returning id into mid;
 return mid;
end $$;

