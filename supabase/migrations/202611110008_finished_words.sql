-- Release each guest's personal word review only after the game has finished.
alter function public.room_snapshot(text) rename to room_snapshot_before_words;
revoke all on function public.room_snapshot_before_words(text) from public,anon,authenticated;
create function public.room_snapshot(p_room text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; review jsonb;
begin
 result:=public.room_snapshot_before_words(p_room);
 if result->>'type'='v2' and result->>'phase'='finished' and not (result->>'host')::boolean then
  select coalesce(jsonb_agg(jsonb_build_object('word',v,'correct',(result->'found_items')?v)
   order by case when (result->'found_items')?v then 0 else 1 end,ord),'[]'::jsonb)
  into review from private.paintings p,jsonb_array_elements_text(p.correct_items) with ordinality e(v,ord)
  where p.room_id=p_room;
  result:=result||jsonb_build_object('words',review);
 end if;
 return result;
end $$;
revoke all on function public.room_snapshot(text) from public,anon;
grant execute on function public.room_snapshot(text) to authenticated;
