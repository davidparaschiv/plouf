-- Language is descriptive metadata only; existing presets default to English.
alter table private.painting_presets add column quiz_language text not null default 'en'
 check(quiz_language in ('en','fr'));
-- Explicitly backfill every existing preset.
update private.painting_presets set quiz_language='en';

create or replace function public.painting_presets() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in required.'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',id,'description',description,'quiz_language',quiz_language) order by description),'[]'::jsonb) from private.painting_presets);
end $$;
create or replace function public.painting_preset(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare p private.painting_presets;
begin
 if auth.uid() is null then raise exception 'Sign in required.'; end if;
 select * into p from private.painting_presets where id=p_id;
 if not found then raise exception 'Preset not found.'; end if;
 return jsonb_build_object('id',p.id,'description',p.description,'image_path',p.image_path,'items',p.correct_items,'duration_seconds',p.duration_seconds,'quiz_language',p.quiz_language);
end $$;

-- Keep the five-argument API for older clients (which use the English default).
create function public.create_painting_room(p_password text,p_hint text,p_image_path text,p_items jsonb,p_duration integer,p_quiz_language text) returns text
language plpgsql security definer set search_path='' as $$
declare rid text;
begin
 if auth.uid() is null then raise exception 'Sign in required.'; end if;
 if p_quiz_language is null or p_quiz_language not in ('en','fr') then raise exception 'Choose English or French.'; end if;
 rid:=public.create_painting_room(p_password,p_hint,p_image_path,p_items,p_duration);
 update private.painting_presets set quiz_language=p_quiz_language
 where private.item_text(description)=(select private.item_text(hint) from private.paintings where room_id=rid);
 return rid;
end $$;
revoke all on function public.create_painting_room(text,text,text,jsonb,integer,text) from public,anon;
grant execute on function public.create_painting_room(text,text,text,jsonb,integer,text) to authenticated;
