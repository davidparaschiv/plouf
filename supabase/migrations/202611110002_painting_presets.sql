-- Descriptions uniquely identify shared paintings; rooms may reuse a preset.
create table private.painting_presets (
 id uuid primary key default gen_random_uuid(), description text not null,
 image_path text not null, correct_items jsonb not null, created_at timestamptz not null default now()
);
create unique index painting_description_unique on private.painting_presets(private.item_text(description));
alter table private.painting_presets enable row level security;
revoke all on private.painting_presets from public,anon,authenticated;
-- Retain existing rooms. Only eligible, distinct descriptions become presets.
insert into private.painting_presets(description,image_path,correct_items)
select distinct on (private.item_text(hint)) trim(hint),image_path,correct_items from private.paintings
where cardinality(regexp_split_to_array(private.item_text(hint),' ')) between 1 and 4
order by private.item_text(hint),room_id;
alter table private.paintings drop constraint paintings_image_path_key;

create function public.painting_presets() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in required.'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',id,'description',description) order by description),'[]'::jsonb) from private.painting_presets);
end $$;
create function public.painting_description_available(p_description text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in required.'; end if;
 return length(private.item_text(p_description)) between 1 and 160
 and cardinality(regexp_split_to_array(private.item_text(p_description),' '))<=4
 and not exists(select 1 from private.painting_presets where private.item_text(description)=private.item_text(p_description));
end $$;
-- Preview data is deliberately shared with hosts choosing an existing painting.
create function public.painting_preset(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare p private.painting_presets;
begin
 if auth.uid() is null then raise exception 'Sign in required.'; end if;
 select * into p from private.painting_presets where id=p_id;
 if not found then raise exception 'Preset not found.'; end if;
 return jsonb_build_object('id',p.id,'description',p.description,'image_path',p.image_path,'items',p.correct_items);
end $$;
create or replace function public.can_read_painting(p_path text) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (
 exists(select 1 from private.painting_presets where image_path=p_path)
 or exists(select 1 from private.paintings p where p.image_path=p_path and (
 exists(select 1 from private.hosts h where h.room_id=p.room_id and h.user_id=auth.uid())
 or exists(select 1 from private.members m where m.room_id=p.room_id and m.user_id=auth.uid()))));
$$;
alter function public.create_painting_room(text,text,text,jsonb,integer) rename to create_painting_room_base;
revoke all on function public.create_painting_room_base(text,text,text,jsonb,integer) from public,anon,authenticated;
create function public.create_painting_room(p_password text,p_hint text,p_image_path text,p_items jsonb,p_duration integer default 120) returns text
language plpgsql security definer set search_path='' as $$
declare rid text; items jsonb; description text;
begin
 if auth.uid() is null then raise exception 'Sign in required.'; end if;
 description:=trim(regexp_replace(p_hint,'[[:space:]]+',' ','g'));
 if description is null or private.item_text(description)='' or cardinality(regexp_split_to_array(private.item_text(description),' '))>4 then raise exception 'Use a description of at most four words.'; end if;
 rid:=public.create_painting_room_base(p_password,description,p_image_path,p_items,p_duration);
 select correct_items into items from private.paintings where room_id=rid;
 begin
  insert into private.painting_presets(description,image_path,correct_items) values(description,p_image_path,items);
 exception when unique_violation then raise exception 'This description is already used. Choose the preset or a different description.';
 end;
 return rid;
end $$;
create function public.create_room_from_preset(p_preset uuid,p_password text,p_duration integer default 120) returns text
language plpgsql security definer set search_path='' as $$
declare p private.painting_presets; rid text; n bigint;
begin
 if auth.uid() is null then raise exception 'Sign in required.'; end if;
 if p_password is null or length(p_password)<4 then raise exception 'Use at least four password characters.'; end if;
 if p_duration is null or p_duration not in (30,60,120,300) then raise exception 'Choose a supported duration.'; end if;
 select * into p from private.painting_presets where id=p_preset;
 if not found then raise exception 'Preset not found.'; end if;
 update private.room_counter set next_id=next_id+1 where singleton returning next_id-1 into n;
 rid:='PID-'||n;
 insert into private.rooms(id,password,theme,type,question_count,duration_seconds) values(rid,p_password,'forest','v2',jsonb_array_length(p.correct_items),p_duration);
 insert into private.paintings values(rid,p.image_path,p.description,p.correct_items);
 insert into private.hosts values(rid,auth.uid());
 return rid;
end $$;
revoke all on function public.painting_presets(),public.painting_description_available(text),public.painting_preset(uuid),public.create_painting_room(text,text,text,jsonb,integer),public.create_room_from_preset(uuid,text,integer) from public,anon;
grant execute on function public.painting_presets(),public.painting_description_available(text),public.painting_preset(uuid),public.create_painting_room(text,text,text,jsonb,integer),public.create_room_from_preset(uuid,text,integer) to authenticated;
