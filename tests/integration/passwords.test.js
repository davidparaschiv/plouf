import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {unaccent} from '@electric-sql/pglite/contrib/unaccent';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';

test('historical and new room passwords use the same V3 hash format without changing credentials',async()=>{
 const db=new PGlite({extensions:{unaccent,pgcrypto}});
 try{
 await db.exec(`create role anon; create role authenticated; create schema auth; create schema extensions; create schema storage;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,storage to authenticated; grant execute on function auth.uid() to authenticated;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
 alter table storage.objects enable row level security;
 grant select,insert,delete on storage.objects to authenticated;
 create function storage.foldername(text) returns text[] language sql as $$select (string_to_array($1,'/'))[1:cardinality(string_to_array($1,'/'))-1]$$;`);
 for(const file of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')&&f<'202611120007_hash_room_passwords.sql').sort()) await db.exec(await readFile('supabase/migrations/'+file,'utf8'));

 const password='  Café 🔒 '+ 'x'.repeat(100)+' tail  ';
 for(const [id,type]of [['legacy-v1','v1'],['legacy-v2','v2']])await db.query("insert into private.rooms(id,password,theme,type,question_count) values($1,$2,'forest',$3,1)",[id,password,type]);
 const existingHash=(await db.query("select extensions.crypt(encode(extensions.digest($1::text,'sha256'),'hex'),extensions.gen_salt('bf')) as hash",[password])).rows[0].hash;
 const wid=(await db.query("insert into private.workspace_v3(name,password_hash) values('Existing workspace',$1) returning id",[existingHash])).rows[0].id;
 const cid=(await db.query("insert into private.classrooms_v3(workspace_id,name,guest_password_hash) values($1,'Existing class',$2) returning id",[wid,existingHash])).rows[0].id;
 await db.exec(await readFile('supabase/migrations/202611120007_hash_room_passwords.sql','utf8'));
 const rows=(await db.query('select id,password from private.rooms order by id')).rows;
 assert.notEqual(rows[0].password,rows[1].password,'Identical passwords get different salts');
 for(const row of rows){
  assert.notEqual(row.password,password);assert.match(row.password,/^\$2[aby]\$/);
  assert.equal((await db.query("select private.password_matches($1,$2) as matches",[password,row.password])).rows[0].matches,true);
  assert.equal((await db.query("select private.password_matches($1,$2) as matches",[password+'wrong',row.password])).rows[0].matches,false);
 }
 assert.equal((await db.query('select password_hash from private.workspace_v3 where id=$1',[wid])).rows[0].password_hash,existingHash);
 assert.equal((await db.query('select guest_password_hash from private.classrooms_v3 where id=$1',[cid])).rows[0].guest_password_hash,existingHash);
 const as=async n=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",['00000000-0000-0000-0000-'+String(n).padStart(12,'0')]);await db.exec('set role authenticated');};
 const rpc=async(name,args)=>(await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as value`,args)).rows[0].value;
 await as(1);
 for(const id of ['legacy-v1','legacy-v2']){await assert.rejects(rpc('unlock_host',[id,'wrong']),/incorrect/);await rpc('unlock_host',[id,password]);}
 const questions=JSON.stringify([{Q:'Question',C:'Correct',W1:'A',W2:'B',W3:'D'}]);
 const newRoom=await rpc('create_room',['forest',password,questions]);
 await as(2);await rpc('unlock_host',[newRoom,password]);
 await assert.rejects(rpc('unlock_host',[newRoom,password.trim()]),/incorrect/);
 // Updating game state must preserve the stored hash, rather than hashing it again.
 await db.exec('reset role');const before=(await db.query('select password from private.rooms where id=$1',[newRoom])).rows[0].password;
 await db.query('update private.rooms set started=true where id=$1',[newRoom]);
 assert.equal((await db.query('select password from private.rooms where id=$1',[newRoom])).rows[0].password,before);
 // The existing room-creation APIs, including V2 presets and V3, share the trigger.
 const preset=(await db.query("insert into private.painting_presets(description,image_path,correct_items) values('Hash preset','example.png','[\"book\"]') returning id")).rows[0].id;
 await as(1);const painting=await rpc('create_room_from_preset',[preset,password]);await as(2);await rpc('unlock_host',[painting,password]);
 await as(1);const workspace=await rpc('access_workspace_v3',['New workspace',password,true]);
 await rpc('create_room_v3',[workspace.id,null,'New classroom',null,'New quiz',questions,password]);
 const guestClass=(await rpc('list_classrooms_v3',[workspace.id]))[0];await as(3);await rpc('join_classroom_v3',[guestClass.id,password]);
 }finally{await db.close();}
});
