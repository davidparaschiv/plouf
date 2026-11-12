-- Failed answers and timeouts consume the question; never restart the question list.
create or replace function private.reset_v3(p_room text,p_event text) returns void language plpgsql security definer set search_path='' as $$
declare r private.rooms;
begin
 select * into r from private.rooms where id=p_room for update;
 update private.games_v3 set score=0,holder=null,event=p_event,event_id=gen_random_uuid(),turn_id=gen_random_uuid() where room_id=p_room;
 if r.question_index+1>=r.question_count then
  perform private.finish_v3(p_room);
 else
  update private.rooms set phase='restart',question_index=question_index+1,choices=null,deadline=clock_timestamp()+interval '2 seconds' where id=p_room;
 end if;
end $$;
revoke all on function private.reset_v3(text,text) from public,anon,authenticated;
notify pgrst, 'reload schema';
