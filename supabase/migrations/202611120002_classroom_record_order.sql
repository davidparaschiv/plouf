-- A tie never changes a record timestamp: the earliest achievement wins.
alter table private.classrooms_v3 add column best_reached_at timestamptz not null default clock_timestamp();

create or replace function public.answer_v3(p_room text,p_session uuid,p_turn uuid,p_choice integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.rooms; g private.games_v3; correct boolean;
begin
 perform private.require_room_v3(p_room);
 select * into r from private.rooms where id=p_room for update;
 select * into g from private.games_v3 where room_id=p_room;
 if r.session_id is distinct from p_session or g.turn_id is distinct from p_turn or r.phase<>'question' or not r.playing then raise exception 'This question is closed.'; end if;
 if not exists(select 1 from private.workspace_access_v3 where workspace_id=g.workspace_id and user_id=auth.uid() and role='guest') or not exists(select 1 from private.members where id=g.holder and user_id=auth.uid()) or exists(select 1 from private.hosts where room_id=p_room and user_id=auth.uid()) then raise exception 'Wait for the ball.'; end if;
 if clock_timestamp()>=r.deadline then perform private.reset_v3(p_room,'timeout'); return jsonb_build_object('correct',false); end if;
 if p_choice is null or p_choice not between 0 and 3 then raise exception 'Invalid answer.'; end if;
 correct:=(r.choices->p_choice->>'correct')::boolean;
 if not correct then perform private.reset_v3(p_room,'wrong');
 else
  update private.games_v3 set score=score+100,event='correct',event_id=gen_random_uuid() where room_id=p_room returning * into g;
  update private.classrooms_v3 set best_score=g.score,best_reached_at=clock_timestamp() where id=g.classroom_id and best_score<g.score;
  if r.question_index+1>=r.question_count then perform private.finish_v3(p_room);
  else update private.rooms set phase='passing',deadline=null,question_index=question_index+1 where id=p_room; end if;
 end if;
 return jsonb_build_object('correct',correct);
end $$;

create or replace function public.snapshot_v3(p_room text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.rooms; g private.games_v3; host boolean; mid uuid; can_see boolean; result jsonb;
begin
 perform private.require_room_v3(p_room);
 select exists(select 1 from private.hosts h join private.games_v3 game_access on game_access.room_id=h.room_id join private.workspace_access_v3 a on a.workspace_id=game_access.workspace_id and a.user_id=h.user_id where h.room_id=p_room and h.user_id=auth.uid() and a.role='host') into host;
 select id into mid from private.members where room_id=p_room and user_id=auth.uid();
 if not host and mid is null then raise exception 'Join this room first.'; end if;
 perform private.advance_v3(p_room);
 select * into r from private.rooms where id=p_room;
 select * into g from private.games_v3 where room_id=p_room;
 can_see:=host or mid=g.holder;
 result:=jsonb_build_object('id',r.id,'type','v3','phase',r.phase,'started',r.started,'playing',r.playing,'host',host,'member_id',mid,'holder',g.holder,'session_id',r.session_id,'turn_id',g.turn_id,'event_id',g.event_id,'event',g.event,'score',g.score,'deadline',r.deadline,'server_time',clock_timestamp(),'question_index',r.question_index,'question_count',r.question_count,
 'classroom',(select name from private.classrooms_v3 where id=g.classroom_id),'best_score',(select best_score from private.classrooms_v3 where id=g.classroom_id),
 'members',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'character',character) order by joined_at,id) from private.members where room_id=p_room),'[]'::jsonb));
 if r.phase='question' and can_see then
  result:=result||jsonb_build_object('question',(select body->>'Q' from private.questions where room_id=p_room and idx=r.question_index),'answers',(select jsonb_agg(v->'text' order by ord) from jsonb_array_elements(r.choices) with ordinality e(v,ord)),'answer_colors',(select jsonb_agg(v->'color' order by ord) from jsonb_array_elements(r.choices) with ordinality e(v,ord)),'correct_choice',case when host then (select ord-1 from jsonb_array_elements(r.choices) with ordinality e(v,ord) where (v->>'correct')::boolean) else null end);
 end if;
 if r.phase='finished' then
  result:=result||jsonb_build_object('ranking',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'points',best_score) order by best_score desc,best_reached_at,id) from private.classrooms_v3 where workspace_id=g.workspace_id),'[]'::jsonb));
 end if;
 return result;
end $$;

notify pgrst, 'reload schema';
