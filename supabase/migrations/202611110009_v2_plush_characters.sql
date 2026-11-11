-- V1 retains its themed characters; V2 uses the six plush portraits.
alter table private.character_catalog add column room_type text not null default 'v1' check(room_type in ('v1','v2'));
alter table private.members drop constraint members_character_check;
alter table private.members add constraint members_character_check check(character between 0 and 45);
insert into private.character_catalog(id,theme,room_type) values
 (40,'forest','v2'),(41,'forest','v2'),(42,'forest','v2'),
 (43,'forest','v2'),(44,'forest','v2'),(45,'forest','v2');

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
 if not exists(select 1 from private.character_catalog where id=p_character and theme=r.theme and room_type=r.type) then raise exception 'Choose a character from this room’s theme.'; end if;
 if length(trim(p_name)) not between 1 and 32 then raise exception 'Use a name between 1 and 32 characters.'; end if;
 insert into private.members(room_id,user_id,name,character) values(p_room,auth.uid(),trim(p_name),p_character)
 on conflict(room_id,user_id) do update set name=excluded.name,character=excluded.character returning id into mid;
 return mid;
end $$;

