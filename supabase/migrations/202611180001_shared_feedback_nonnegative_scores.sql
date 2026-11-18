-- Retain the last answer result across passing, the next question and the podium.
alter table private.games_v3 add column feedback jsonb;
create function private.capture_v3_feedback() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.event_id is distinct from old.event_id then
  if new.event in ('correct','wrong','timeout') then
   new.feedback:=jsonb_build_object('id',new.event_id,'correct',new.event='correct','at',clock_timestamp());
  elsif new.event='waiting' then new.feedback:=null;
  end if;
 end if;
 return new;
end $$;
create trigger capture_v3_feedback before update on private.games_v3
for each row execute function private.capture_v3_feedback();
revoke all on function private.capture_v3_feedback() from public,anon,authenticated;

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
 result:=jsonb_build_object('id',r.id,'type','v3','phase',r.phase,'started',r.started,'playing',r.playing,'host',host,'member_id',mid,'holder',g.holder,'session_id',r.session_id,'turn_id',g.turn_id,'event_id',g.event_id,'event',g.event,'feedback',g.feedback,'score',g.score,'deadline',r.deadline,'server_time',clock_timestamp(),'question_index',r.question_index,'question_count',r.question_count,
 'classroom_id',g.classroom_id,'classroom',(select name from private.classrooms_v3 where id=g.classroom_id),'best_score',(select best_score from private.classrooms_v3 where id=g.classroom_id),
 'members',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'character',character) order by joined_at,id) from private.members where room_id=p_room),'[]'::jsonb));
 if r.phase='question' then
  result:=result||jsonb_build_object('question',(select body->>'Q' from private.questions where room_id=p_room and idx=r.question_index),'answer_colors',(select jsonb_agg(v->'color' order by ord) from jsonb_array_elements(r.choices) with ordinality e(v,ord)));
 end if;
 if r.phase='question' and can_see then
  result:=result||jsonb_build_object('question',(select body->>'Q' from private.questions where room_id=p_room and idx=r.question_index),'answers',(select jsonb_agg(v->'text' order by ord) from jsonb_array_elements(r.choices) with ordinality e(v,ord)),'answer_colors',(select jsonb_agg(v->'color' order by ord) from jsonb_array_elements(r.choices) with ordinality e(v,ord)),'correct_choice',case when host then (select ord-1 from jsonb_array_elements(r.choices) with ordinality e(v,ord) where (v->>'correct')::boolean) else null end);
 end if;
 if r.phase='finished' then
  result:=result||jsonb_build_object('ranking',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'points',best_score) order by best_score desc,best_reached_at,id) from private.classrooms_v3 where workspace_id=g.workspace_id),'[]'::jsonb));
 end if;
 return result;
end $$;

-- Existing painting scores and all future guesses have a floor of zero.
update private.members m set points=0 from private.rooms r where r.id=m.room_id and r.type='v2' and m.points<0;
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
 update private.members set points=greatest(0,points+case when item is not null then 500 else -100 end) where id=m.id returning * into m;
 perform private.advance_room(p_room);
 return jsonb_build_object('correct',item is not null,'duplicate',false,'points',m.points);
end $$;

notify pgrst, 'reload schema';
