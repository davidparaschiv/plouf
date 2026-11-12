-- Match the existing V3 password format exactly: SHA-256 hex, then salted bcrypt.
create function private.hash_password(p_password text) returns text
language sql volatile strict security definer set search_path='' as $$
 select extensions.crypt(encode(extensions.digest(p_password,'sha256'),'hex'),extensions.gen_salt('bf'));
$$;
create function private.password_matches(p_password text,p_hash text) returns boolean
language sql stable strict security definer set search_path='' as $$
 select p_hash=extensions.crypt(encode(extensions.digest(p_password,'sha256'),'hex'),p_hash);
$$;

-- These room passwords are still plaintext. Hash once before installing the write trigger.
-- Already-hashed V3 workspace/classroom credentials are deliberately left untouched.
update private.rooms set password=private.hash_password(password);
comment on column private.rooms.password is 'Salted bcrypt of the SHA-256 password hex digest; never plaintext.';

create function private.hash_room_password_write() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and new.password is not distinct from old.password then return new; end if;
 if new.password is null or length(new.password)<4 or private.item_text(new.password)='' then
  raise exception 'Use at least four password characters.';
 end if;
 new.password:=private.hash_password(new.password);
 return new;
end $$;
-- Runs after the existing plaintext validation trigger, without modifying creation APIs.
create trigger zz_hash_room_password before insert or update of password on private.rooms
 for each row execute function private.hash_room_password_write();

create or replace function private.legacy_unlock_before_v3(p_room text,p_password text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in required.'; end if;
 if not exists(select 1 from private.rooms where id=p_room and private.password_matches(p_password,password)) then
  raise exception 'Room or password is incorrect.';
 end if;
 if exists(select 1 from private.members where room_id=p_room and user_id=auth.uid()) then
  raise exception 'This browser is already a guest. Use another browser to host.';
 end if;
 insert into private.hosts values(p_room,auth.uid()) on conflict do nothing;
end $$;
revoke all on function private.hash_password(text),private.password_matches(text,text),private.hash_room_password_write(),private.legacy_unlock_before_v3(text,text) from public,anon,authenticated;
notify pgrst, 'reload schema';
