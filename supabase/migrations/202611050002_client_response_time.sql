-- Replace the old RPC so scoring always receives browser elapsed milliseconds.
drop function public.submit_answer(text,uuid,integer,integer);

create function public.submit_answer(p_room text,p_session uuid,p_question integer,p_choice integer,p_elapsed_ms integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare received timestamptz; r private.rooms; m private.members; a private.answers;
 is_correct boolean; pos integer; elapsed_seconds double precision;
begin
 -- FIRST executable statement: capture real DB wall time, before locks/validation.
 received:=clock_timestamp();
 select * into r from private.rooms where id=p_room for update;
 select * into m from private.members where room_id=p_room and user_id=auth.uid();
 if m.id is null then raise exception 'Join this room first.'; end if;
 if r.session_id is distinct from p_session then raise exception 'This session has ended.'; end if;
 select * into a from private.answers where room_id=p_room and question_index=p_question and member_id=m.id;
 if found then return jsonb_build_object('correct',a.correct,'position',a.correct_position,'choice',a.choice); end if;
 if not r.playing or r.phase<>'question' or r.question_index<>p_question or received<r.question_started or received>=r.deadline then
  raise exception 'This question is closed.';
 end if;
 if p_choice not between 0 and 3 or p_choice is null then raise exception 'Invalid answer.'; end if;
 is_correct:=(r.choices->p_choice->>'correct')::boolean;
 if p_elapsed_ms is null or p_elapsed_ms < 0 or p_elapsed_ms > 15000 then
  raise exception 'Invalid response time.';
 end if;
 -- Use browser-supplied milliseconds, not server arrival minus start time.
 elapsed_seconds:=greatest(.001,p_elapsed_ms / 1000.0);
 if is_correct then
  select count(*)+1 into pos from private.answers where room_id=p_room and question_index=p_question and correct;
 end if;
 insert into private.answers(room_id,question_index,member_id,received_at,elapsed,choice,correct,correct_position)
  values(p_room,p_question,m.id,received,elapsed_seconds,p_choice,is_correct,pos);
 -- Immediate feedback positions remain acceptance order; points use client elapsed time.
 return jsonb_build_object('correct',is_correct,'position',pos,'choice',p_choice);
end $$;

revoke all on function public.submit_answer(text,uuid,integer,integer,integer) from public,anon;
grant execute on function public.submit_answer(text,uuid,integer,integer,integer) to authenticated;
