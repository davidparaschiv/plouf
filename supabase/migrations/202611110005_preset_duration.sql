-- Existing presets receive two minutes; newly saved presets retain their chosen duration.
alter table private.painting_presets add column duration_seconds integer not null default 120
 check(duration_seconds in (30,60,120,300));

create or replace function public.painting_preset(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare p private.painting_presets;
begin
 if auth.uid() is null then raise exception 'Sign in required.'; end if;
 select * into p from private.painting_presets where id=p_id;
 if not found then raise exception 'Preset not found.'; end if;
 return jsonb_build_object('id',p.id,'description',p.description,'image_path',p.image_path,'items',p.correct_items,'duration_seconds',p.duration_seconds);
end $$;
create or replace function public.create_painting_room(p_password text,p_hint text,p_image_path text,p_items jsonb,p_duration integer default 120) returns text
language plpgsql security definer set search_path='' as $$
declare rid text; items jsonb; description text;
begin
 if auth.uid() is null then raise exception 'Sign in required.'; end if;
 description:=trim(regexp_replace(p_hint,'[[:space:]]+',' ','g'));
 if description is null or private.item_text(description)='' or cardinality(regexp_split_to_array(private.item_text(description),' '))>4 then raise exception 'Use a description of at most four words.'; end if;
 rid:=public.create_painting_room_base(p_password,description,p_image_path,p_items,p_duration);
 select correct_items into items from private.paintings where room_id=rid;
 begin
  insert into private.painting_presets(description,image_path,correct_items,duration_seconds) values(description,p_image_path,items,p_duration);
 exception when unique_violation then raise exception 'This description is already used. Choose the preset or a different description.';
 end;
 return rid;
end $$;
create or replace function public.create_room_from_preset(p_preset uuid,p_password text,p_duration integer default 120) returns text
language plpgsql security definer set search_path='' as $$
declare p private.painting_presets; rid text; n bigint;
begin
 if auth.uid() is null then raise exception 'Sign in required.'; end if;
 if p_password is null or length(p_password)<4 then raise exception 'Use at least four password characters.'; end if;
 select * into p from private.painting_presets where id=p_preset;
 if not found then raise exception 'Preset not found.'; end if;
 update private.room_counter set next_id=next_id+1 where singleton returning next_id-1 into n;
 rid:='PID-'||n;
 insert into private.rooms(id,password,theme,type,question_count,duration_seconds) values(rid,p_password,'forest','v2',jsonb_array_length(p.correct_items),p.duration_seconds);
 insert into private.paintings values(rid,p.image_path,p.description,p.correct_items);
 insert into private.hosts values(rid,auth.uid());
 return rid;
end $$;

-- The legacy p_duration argument is retained for old clients; saved preset duration is authoritative.
