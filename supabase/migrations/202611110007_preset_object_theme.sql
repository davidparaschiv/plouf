-- Keep the preset description separate from the hint shown to players.
alter table private.painting_presets add column object_theme text;
update private.painting_presets set object_theme=description;
alter table private.painting_presets alter column object_theme set not null;
alter table private.painting_presets add constraint painting_object_theme_valid check(
 length(private.item_text(object_theme)) between 1 and 160
 and cardinality(regexp_split_to_array(private.item_text(object_theme),' '))<=4);
-- Older clients use their description as the theme when saving a preset.
create function private.default_object_theme() returns trigger language plpgsql set search_path='' as $$
begin
 if new.object_theme is null then new.object_theme:=new.description; end if;
 return new;
end $$;
create trigger default_object_theme before insert on private.painting_presets
 for each row execute function private.default_object_theme();

create or replace function public.painting_preset(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare p private.painting_presets;
begin
 if auth.uid() is null then raise exception 'Sign in required.'; end if;
 select * into p from private.painting_presets where id=p_id;
 if not found then raise exception 'Preset not found.'; end if;
 return jsonb_build_object('id',p.id,'description',p.description,'image_path',p.image_path,'items',p.correct_items,'duration_seconds',p.duration_seconds,'quiz_language',p.quiz_language,'object_theme',p.object_theme);
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
 insert into private.paintings values(rid,p.image_path,p.object_theme,p.correct_items);
 insert into private.hosts values(rid,auth.uid());
 return rid;
end $$;


create function public.create_painting_room(p_password text,p_hint text,p_image_path text,p_items jsonb,p_duration integer,p_quiz_language text,p_object_theme text) returns text
language plpgsql security definer set search_path='' as $$
declare rid text; theme text;
begin
 if auth.uid() is null then raise exception 'Sign in required.'; end if;
 theme:=private.item_text(p_object_theme);
 if theme is null or length(theme) not between 1 and 160 or cardinality(regexp_split_to_array(theme,' '))>4 then
  raise exception 'Set the theme of the correct objects in up to four words.';
 end if;
 rid:=public.create_painting_room(p_password,p_hint,p_image_path,p_items,p_duration,p_quiz_language);
 update private.painting_presets set object_theme=trim(regexp_replace(normalize(p_object_theme,NFC),'[[:space:]]+',' ','g'))
 where private.item_text(description)=(select private.item_text(hint) from private.paintings where room_id=rid);
 update private.paintings set hint=trim(regexp_replace(normalize(p_object_theme,NFC),'[[:space:]]+',' ','g')) where room_id=rid;
 return rid;
end $$;
revoke all on function public.create_painting_room(text,text,text,jsonb,integer,text,text) from public,anon;
grant execute on function public.create_painting_room(text,text,text,jsonb,integer,text,text) to authenticated;
