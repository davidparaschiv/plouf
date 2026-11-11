import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {unaccent} from '@electric-sql/pglite/contrib/unaccent';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';

test('V1 and V2 database lifecycle, authorization, Unicode, scoring and finish', async()=>{
 const db=new PGlite({extensions:{unaccent,pgcrypto}});
 try {
 await db.exec(`create role anon; create role authenticated; create schema auth; create schema extensions; create schema storage;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,storage to authenticated; grant execute on function auth.uid() to authenticated;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
 alter table storage.objects enable row level security;
 grant select,insert,delete on storage.objects to authenticated;
 create function storage.foldername(text) returns text[] language sql as $$select (string_to_array($1,'/'))[1:cardinality(string_to_array($1,'/'))-1]$$;`);
 for(const file of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort()) await db.exec(await readFile('supabase/migrations/'+file,'utf8'));
 const host='00000000-0000-0000-0000-000000000001',a='00000000-0000-0000-0000-000000000002',b='00000000-0000-0000-0000-000000000003';
 const as=async id=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');};
 const rpc=async(name,args)=> (await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as value`,args)).rows[0].value;
 const admin=async sql=>{await db.exec('reset role');await db.exec(sql);await db.exec('set role authenticated');};
 await as(host);
 // Storage policies: private painting uploads are restricted to the current user.
 await assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('paintings',$1)",[a+'/wrong.png']));
 await db.query("insert into storage.objects(bucket_id,name) values('paintings',$1)",[host+'/painting.png']);
 const room=await rpc('create_painting_room',['host-password','Objects',host+'/painting.png',JSON.stringify(['  UN  CŒUR ','a blue chair','une boîte'])]);
 assert.equal((await rpc('room_info',[room])).type,'v2');
 await rpc('start_room',[room]);
 await as(a); await rpc('join_room',[room,'Alice',23]);
 await as(b); await rpc('join_room',[room,'Bob',24]);
 await as(host); await rpc('play_room',[room]);
 let s=await rpc('room_snapshot',[room]);assert.equal(s.phase,'countdown');const session=s.session_id;
 await assert.rejects(rpc('submit_item',[room,session,'un coeur']),/Hosts cannot play/);
 await as(a);await assert.rejects(rpc('submit_item',[room,session,'un coeur']),/closed/);
 await admin(`update private.rooms set deadline=clock_timestamp()-interval '0.1 seconds' where id='${room}'`);
 s=await rpc('room_snapshot',[room]);assert.equal(s.phase,'painting');assert.equal(s.total_items,3);
 assert.equal(s.members.length,1);assert.equal(s.members[0].rank,undefined);assert.equal(s.correct_items,undefined);
 assert.equal(s.guest_count,2);assert.equal(s.found_items.length,0);
 await assert.rejects(db.query('select * from private.paintings'),/permission denied/);
 await assert.rejects(rpc('room_snapshot_v1',[room]),/permission denied/);
 let r=await rpc('submit_item',[room,session,' \tUN\u00a0 COEUR  ']);assert.equal(r.points,500);assert.equal(r.correct,true);
 r=await rpc('submit_item',[room,session,'un cœur']);assert.equal(r.duplicate,true);assert.equal(r.points,500);
 r=await rpc('submit_item',[room,session,'not present']);assert.equal(r.points,400);
 r=await rpc('submit_item',[room,session,'not present']);assert.equal(r.duplicate,true);assert.equal(r.points,400);
 await rpc('submit_item',[room,session,'a BLUE   chair']);await rpc('submit_item',[room,session,'une boite']);
 s=await rpc('room_snapshot',[room]);assert.equal(s.phase,'painting');assert.equal(s.found_items.length,3);assert.equal(s.points,1400);
 await as(host);s=await rpc('room_snapshot',[room]);assert.equal(s.members.length,2);assert.equal(s.members[0].rank,1);
 await as(b);for (const guess of ['un cœur','a blue chair','une boîte']) await rpc('submit_item',[room,session,guess]);
 s=await rpc('room_snapshot',[room]);assert.equal(s.phase,'finished');assert.equal(s.playing,false);assert.equal(s.started,false);assert.equal(s.members[0].points,1500);
 await as(host);await rpc('start_room',[room]);await as(a);await rpc('join_room',[room,'Alice',23]);await as(host);await rpc('play_room',[room]);
 await admin(`update private.rooms set deadline=clock_timestamp()-interval '124 seconds' where id='${room}'`);
 s=await rpc('room_snapshot',[room]);assert.equal(s.phase,'finished');
 // Configurable durations, invalid JSON, and ownership validation.
 await assert.rejects(rpc('create_painting_room',['pass','Theme',host+'/painting.png',JSON.stringify(['boîte','boite']),30]),/unique/);
 await assert.rejects(rpc('create_painting_room',['pass','Theme',host+'/painting.png',JSON.stringify(['x']),45]),/duration/);
 for (const duration of [30,60,300]) {
  const path=host+'/'+duration+'.png';
  await db.query("insert into storage.objects(bucket_id,name) values('paintings',$1)",[path]);
  const timed=await rpc('create_painting_room',['pass','Theme '+duration,path,JSON.stringify(['x']),duration]);
  await rpc('start_room',[timed]);await as(a);await rpc('join_room',[timed,'Alice',23]);await as(host);await rpc('play_room',[timed]);
  await admin(`update private.rooms set deadline=clock_timestamp()-interval '0.1 seconds' where id='${timed}'`);
  const state=await rpc('room_snapshot',[timed]);
  assert.equal(state.duration_seconds,duration);
  assert.ok(new Date(state.deadline)-new Date(state.server_time)> (duration-1)*1000);
 }
 // Shared presets retain a unique description while permitting independent rooms.
 const presets=await rpc('painting_presets',[]);
 const preset=presets.find(p=>p.description==='Objects');assert.ok(preset);
 assert.equal(await rpc('painting_description_available',['  OBJECTS  ']),false);
 assert.equal(await rpc('painting_description_available',['Fresh painting']),true);
 await assert.rejects(rpc('create_painting_room',['pass','one two three four five',host+'/painting.png','[]',30]),/four words/);
 await db.query("insert into storage.objects(bucket_id,name) values('paintings',$1)",[host+'/duplicate.png']);
 await assert.rejects(rpc('create_painting_room',['pass','  OBJECTS ',host+'/duplicate.png','["x"]',30]),/already used/);
 await as(b);
 const preview=await rpc('painting_preset',[preset.id]);assert.equal(preview.items.length,3);
 assert.equal(await rpc('can_read_painting',[preview.image_path]),true);
 const reused=await rpc('create_room_from_preset',[preset.id,'password',60]);
 const reusedSnapshot=await rpc('room_snapshot',[reused]);assert.equal(reusedSnapshot.host,true);assert.equal(reusedSnapshot.hint,'Objects');assert.equal(reusedSnapshot.duration_seconds,60);
 await assert.rejects(rpc('create_painting_room_base',['pass','Other',host+'/painting.png','[]',30]),/permission denied/);
 await as(host);
 // V1 still uses the original quiz flow and timing.
 const v1=await rpc('create_room',['forest','pass',JSON.stringify([{Q:'Q?',C:'Yes',W1:'No',W2:'Maybe',W3:'Never'}])]);
 await rpc('start_room',[v1]);await as(a);await rpc('join_room',[v1,'Alice',23]);await as(host);await rpc('play_room',[v1]);
 s=await rpc('room_snapshot',[v1]);assert.equal(s.type,'v1');assert.equal(s.phase,'countdown');
 await admin(`update private.rooms set deadline=clock_timestamp()-interval '0.1 seconds' where id='${v1}'`);
 s=await rpc('room_snapshot',[v1]);assert.equal(s.phase,'question');assert.equal(s.answers.length,4);
 const choice=s.correct_choice;await as(a);await rpc('submit_answer',[v1,s.session_id,0,choice,1500]);s=await rpc('room_snapshot',[v1]);
 assert.equal(s.phase,'finished');assert.equal(s.members[0].points,1000);
 } finally {await db.close();}
});
