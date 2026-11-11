-- ASCII guesses may omit accents; Unicode guesses must match the stored spelling.
-- Case, Unicode composition and whitespace normalization remain unchanged.
create function private.item_matches(guess text,answer text) returns boolean
language sql stable set search_path='' as $$
 select case when octet_length(private.item_text(guess))=length(private.item_text(guess))
 then private.item_text(guess)=private.item_key(answer)
 else private.item_text(guess)=private.item_text(answer) end;
$$;

create or replace function public.submit_item(p_room text,p_session uuid,p_guess text) returns jsonb
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
 key:=private.item_text(p_guess);
 if key is null or length(key)=0 then raise exception 'Enter an item.'; end if;
 -- Resolve correctness before deduplication: a misspelled accent must not block
 -- a later valid guess, and alternate valid spellings must never score twice.
 select (ord-1)::integer into item from private.paintings p,jsonb_array_elements_text(p.correct_items) with ordinality e(v,ord)
 where p.room_id=p_room and private.item_matches(key,v);
 select * into g from private.item_guesses where member_id=m.id and session_id=p_session
 and (guess_key=key or (correct and item_index=item));
 if found then return jsonb_build_object('correct',g.correct,'duplicate',true,'points',m.points); end if;
 perform private.advance_room(p_room);
 select * into r from private.rooms where id=p_room;
 if not r.playing or r.phase<>'painting' or received<r.question_started or received>=r.deadline then raise exception 'This question is closed.'; end if;
 select jsonb_array_length(correct_items) into total from private.paintings where room_id=p_room;
 select count(*) into found_count from private.item_guesses where member_id=m.id and session_id=p_session and correct;
 if found_count>=total then raise exception 'All items found. Wait for the others.'; end if;
 insert into private.item_guesses values(m.id,p_session,key,item,item is not null);
 update private.members set points=points+case when item is not null then 500 else -100 end where id=m.id returning * into m;
 perform private.advance_room(p_room);
 return jsonb_build_object('correct',item is not null,'duplicate',false,'points',m.points);
end $$;
