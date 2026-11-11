import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {unaccent} from '@electric-sql/pglite/contrib/unaccent';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {PaintingDemo} from '../../src/painting-rules.js';

test('V2 database and demo agree on exact Unicode, ASCII fallback, duplicates and score',async()=>{
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
 for(const file of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort()){
  if(file==='202611110005_preset_duration.sql')await db.exec(`insert into private.painting_presets(description,image_path,correct_items) values('Legacy preset','legacy.png','["legacy"]')`);
  await db.exec(await readFile('supabase/migrations/'+file,'utf8'));
 }
 assert.equal((await db.query("select duration_seconds from private.painting_presets where description='Legacy preset'")).rows[0].duration_seconds,120);
 assert.equal((await db.query("select quiz_language from private.painting_presets where description='Legacy preset'")).rows[0].quiz_language,'en');
 assert.equal((await db.query("select object_theme from private.painting_presets where description='Legacy preset'")).rows[0].object_theme,'Legacy preset');

 const host='00000000-0000-0000-0000-000000000001',guest='00000000-0000-0000-0000-000000000002';
 const as=async id=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');};
 const rpc=async(name,args)=>(await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as value`,args)).rows[0].value;
 const items=['café','cœur','blue-chair 2','ecole','été','雪'];
 const demo=new PaintingDemo(items);
 await as(host);
 await db.query("insert into storage.objects(bucket_id,name) values('paintings',$1)",[host+'/accent.png']);
 await assert.rejects(rpc('create_room',['forest','pass','[]']),/at least one complete question/);
 await assert.rejects(rpc('create_room',['forest','    ',JSON.stringify([{Q:'Q',C:'C',W1:'A',W2:'B',W3:'D'}])]),/password/);
 await assert.rejects(rpc('create_room',['forest','pass',JSON.stringify([{Q:'\t',C:'C',W1:'A',W2:'B',W3:'D'}])]),/complete question/);
 await assert.rejects(rpc('create_painting_room',['pass','Empty painting',host+'/accent.png','[]',120]),/at least one correct answer/);
 for(const duration of [30,60,120,300]){
  const path=host+`/preset-${duration}.png`,description=`Duration ${duration}`;
  await db.query("insert into storage.objects(bucket_id,name) values('paintings',$1)",[path]);
  await rpc('create_painting_room',['pass',description,path,'["item"]',duration]);
  const preset=(await rpc('painting_presets',[])).find(p=>p.description===description);
  assert.equal((await rpc('painting_preset',[preset.id])).duration_seconds,duration);
  // Neither omission nor a legacy caller's override can change the preset's duration.
  for(const args of [[preset.id,'pass'],[preset.id,'pass',30]]){
   const reused=await rpc('create_room_from_preset',args);
   assert.equal((await rpc('room_snapshot',[reused])).duration_seconds,duration);
  }
 }
 const frPath=host+'/french.png';
 await db.query("insert into storage.objects(bucket_id,name) values('paintings',$1)",[frPath]);
 await assert.rejects(rpc('create_painting_room',['pass','French classroom',frPath,'["cœur"]',60,'de']),/English or French/);
 await rpc('create_painting_room',['pass','French classroom',frPath,JSON.stringify(['  CŒUR  ','  UNE\t  FENÊTRE  ']),60,'fr','Classroom Objects']);
 const frenchPreset=(await rpc('painting_presets',[])).find(p=>p.description==='French classroom');
 assert.equal(frenchPreset.quiz_language,'fr');
 const frenchData=await rpc('painting_preset',[frenchPreset.id]);
 assert.equal(frenchData.object_theme,'Classroom Objects');
 assert.equal(frenchData.quiz_language,'fr');assert.deepEqual(frenchData.items,['cœur','une fenêtre']);
 const frenchRoom=await rpc('create_room_from_preset',[frenchPreset.id,'pass']);
 const frenchSnapshot=await rpc('room_snapshot',[frenchRoom]);
 assert.equal(frenchSnapshot.hint,'Classroom Objects');assert.equal(frenchSnapshot.duration_seconds,60);
 await assert.rejects(rpc('create_painting_room',['pass','Bad theme',frPath,'["item"]',60,'en','']),/theme/);
 await assert.rejects(rpc('create_painting_room',['pass','Bad theme',frPath,'["item"]',60,'en','one two three four five']),/theme/);
 await rpc('start_room',[frenchRoom]);await as(guest);await rpc('join_room',[frenchRoom,'French guest',23]);
 const guestView=await rpc('room_snapshot',[frenchRoom]);
 assert.equal(guestView.hint,'Classroom Objects');assert.equal(guestView.description,undefined);
 await as(host);
 const room=await rpc('create_painting_room',['pass','Accent practice',host+'/accent.png',JSON.stringify(items),120]);
 await rpc('start_room',[room]);await as(guest);await rpc('join_room',[room,'Player',23]);await as(host);await rpc('play_room',[room]);
 await db.exec('reset role');await db.query("update private.rooms set deadline=clock_timestamp()-interval '0.1 seconds' where id=$1",[room]);
 await as(guest);const state=await rpc('room_snapshot',[room]);assert.equal(state.phase,'painting');
 for(const guess of ['cafè',' CAFÈ ','café','cafe','cafê','cafe\u0301','cœur','coeur','cœúr',' BLUE-CHAIR   2 ','ÉCOLE','école','ecole','ete','éte','ÉTÉ','雪','雪']){
  const expected=demo.guess(guess),actual=await rpc('submit_item',[room,state.session_id,guess]);
  assert.deepEqual(actual,expected,guess);
 }
 const result=await rpc('room_snapshot',[room]);assert.equal(result.phase,'finished');assert.equal(result.members[0].points,demo.score);assert.equal(demo.score,2500);
 // Finish as soon as every guest has found every item, without waiting for the timer.
 await as(host);
 const quickPreset=(await rpc('painting_presets',[])).find(p=>p.description==='Duration 30');
 const multiplayer=await rpc('create_room_from_preset',[quickPreset.id,'pass']);
 await rpc('start_room',[multiplayer]);
 await as(guest);await rpc('join_room',[multiplayer,'First',23]);
 const secondGuest='00000000-0000-0000-0000-000000000003';
 await as(secondGuest);await rpc('join_room',[multiplayer,'Second',24]);
 await as(host);await rpc('play_room',[multiplayer]);
 await db.exec('reset role');await db.query("update private.rooms set deadline=clock_timestamp()-interval '0.1 seconds' where id=$1",[multiplayer]);
 await as(guest);const active=await rpc('room_snapshot',[multiplayer]);
 await rpc('submit_item',[multiplayer,active.session_id,'item']);
 const waiting=await rpc('room_snapshot',[multiplayer]);
 assert.equal(waiting.phase,'painting');assert.equal(waiting.playing,true);
 await as(secondGuest);await rpc('submit_item',[multiplayer,active.session_id,'wrong']);
 assert.equal((await rpc('room_snapshot',[multiplayer])).phase,'painting');
 await rpc('submit_item',[multiplayer,active.session_id,'item']);
 const finished=await rpc('room_snapshot',[multiplayer]);
 assert.equal(finished.phase,'finished');assert.equal(finished.playing,false);assert.equal(finished.started,false);
 assert.equal(finished.members.length,2);assert.equal(finished.members[0].points,500);assert.equal(finished.members[1].points,400);
 }finally{await db.close();}
});
