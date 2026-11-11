-- Validate new rooms without changing existing rooms or their game sessions.
create function private.require_room_content() returns trigger
language plpgsql set search_path='' as $$
begin
 if length(new.password)<4 or private.item_text(new.password)='' then
  raise exception 'Use at least four password characters.';
 end if;
 if new.question_count<1 then
  if new.type='v2' then raise exception 'Add at least one correct answer.';
  else raise exception 'Add at least one complete question.'; end if;
 end if;
 return new;
end $$;
create trigger require_room_content before insert on private.rooms
 for each row execute function private.require_room_content();

create function private.require_complete_question() returns trigger
language plpgsql set search_path='' as $$
begin
 if exists(select 1 from unnest(array['Q','C','W1','W2','W3']) k
  where jsonb_typeof(new.body->k) is distinct from 'string' or private.item_text(new.body->>k)='') then
  raise exception 'Add at least one complete question.';
 end if;
 return new;
end $$;
create trigger require_complete_question before insert on private.questions
 for each row execute function private.require_complete_question();
