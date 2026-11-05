-- Older cached frontends omitted client elapsed time. Never guess a score.
-- Keep a compatibility endpoint that gives those clients an actionable error.
create or replace function public.submit_answer(p_room text,p_session uuid,p_question integer,p_choice integer)
returns jsonb language plpgsql set search_path='' as $$
begin
 raise exception 'A new version is available. Refresh this page to answer.';
end $$;
revoke all on function public.submit_answer(text,uuid,integer,integer) from public,anon;
grant execute on function public.submit_answer(text,uuid,integer,integer) to authenticated;
