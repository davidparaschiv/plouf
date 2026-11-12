-- Workspace names are discoverable for the sign-in selector; credentials stay private.
create function public.list_workspaces_v3() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in required.'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('name',name) order by lower(name),id) from private.workspace_v3),'[]'::jsonb);
end $$;
revoke all on function public.list_workspaces_v3() from public,anon;
grant execute on function public.list_workspaces_v3() to authenticated;
notify pgrst, 'reload schema';
