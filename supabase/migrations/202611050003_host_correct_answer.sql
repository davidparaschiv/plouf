-- Host-only answer highlighting; guests receive no answer key.
create or replace function public.room_snapshot(p_room text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r private.rooms; m private.members; host boolean; roster jsonb; answer jsonb; question text; options jsonb;
begin
 if auth.uid() is null then raise exception 'Sign in required.'; end if;
 select exists(select 1 from private.hosts where room_id=p_room and user_id=auth.uid()) into host;
 select * into m from private.members where room_id=p_room and user_id=auth.uid();
 if not host and m.id is null then raise exception 'Join this room first.'; end if;
 perform private.advance_room(p_room);
 select * into r from private.rooms where id=p_room;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.rank),'[]'::jsonb) into roster from
  (select id,name,character,points,row_number() over(order by points desc,joined_at,id) as rank from private.members where room_id=p_room) x;
 if r.phase='question' then
  select body->>'Q' into question from private.questions where room_id=p_room and idx=r.question_index;
  select jsonb_agg(v->'text' order by ord) into options from jsonb_array_elements(r.choices) with ordinality e(v,ord);
  select jsonb_build_object('correct',correct,'position',correct_position,'choice',choice) into answer
   from private.answers where room_id=p_room and question_index=r.question_index and member_id=m.id;
 end if;
 return jsonb_build_object('id',r.id,'theme',r.theme,'phase',r.phase,'started',r.started,'playing',r.playing,
  'session_id',r.session_id,'question_index',r.question_index,'question_count',r.question_count,'deadline',r.deadline,
  'correct_choice',case when host and r.phase='question' then (select (ord-1)::integer from jsonb_array_elements(r.choices) with ordinality e(v,ord) where (v->>'correct')::boolean limit 1) else null end,
  'server_time',clock_timestamp(),'host',host,'member_id',m.id,'members',roster,'question',question,'answers',options,'answer',answer);
end $$;

