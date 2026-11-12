import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {unaccent} from '@electric-sql/pglite/contrib/unaccent';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';

test('V3 workspace isolation, ball ownership, resets, classroom records and final ranking',async()=>{
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
 for(const file of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort()) await db.exec(await readFile('supabase/migrations/'+file,'utf8'));

 const host='00000000-0000-0000-0000-000000000001',a='00000000-0000-0000-0000-000000000002',b='00000000-0000-0000-0000-000000000003',outsider='00000000-0000-0000-0000-000000000004';
 const as=async id=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');};
 const rpc=async(name,args)=>(await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as value`,args)).rows[0].value;
 const admin=async sql=>{await db.exec('reset role');await db.exec(sql);await db.exec('set role authenticated');};
 await as(host);
 const w=await rpc('access_workspace_v3',['École A',null,true,'guest-secret','host-secret']);
 assert.equal(w.guest_password_hash,undefined);assert.equal(w.host_password_hash,undefined);assert.equal(w.role,'host');
 await assert.rejects(rpc('access_workspace_v3',['Bad',null,true,'same','same']),/different/);
 await assert.rejects(rpc('access_workspace_v3',[' école a ',null,true,'guest-secret','host-secret']),/already used/);
 await assert.rejects(rpc('access_workspace_v3',['École A','wrong',false]),/incorrect/);
 const qs=JSON.stringify([{Q:'Un cœur ?',C:'Oui',W1:'Non',W2:'Peut-être',W3:'Jamais'},{Q:'Second question',C:'Correct',W1:'One',W2:'Two',W3:'Three'}]);
 const room=await rpc('create_room_v3',[w.id,null,'Classe A',null,'Quiz A',qs]);
 let opts=await rpc('workspace_options_v3',[w.id]);
 await assert.rejects(rpc('create_room_v3',[w.id,null,'classe a',opts.presets[0].id,null,null]),/classroom name is already/);
 await assert.rejects(rpc('create_room_v3',[w.id,opts.classrooms[0].id,null,null,'quiz a',qs]),/preset name is already/);
 await as(outsider);await assert.rejects(rpc('workspace_options_v3',[w.id]),/Workspace access/);
 await assert.rejects(rpc('unlock_host',[room,'pass']),/Workspace access/);
 await as(host);await rpc('control_room_v3',[room,'start']);
 await assert.rejects(rpc('control_room_v3',[room,'play']),/at least two/);
 for(const [id,name,char] of [[a,'Alice',40],[b,'Bob',41]]){await as(id);await rpc('access_workspace_v3',['École A','guest-secret',false]);await rpc('join_room_v3',[room,name,char]);}
 await as(host);await rpc('control_room_v3',[room,'play']);
 let s=await rpc('snapshot_v3',[room]);assert.equal(s.phase,'question');assert.equal(s.question,'Un cœur ?');assert.equal(s.members.length,2);assert.deepEqual([...s.answer_colors].sort(),[0,1,2,3]);const colors=s.answer_colors;assert.deepEqual((await rpc('snapshot_v3',[room])).answer_colors,colors);
 const session=s.session_id,firstTurn=s.turn_id,holder=s.holder;
 const owner=s.members.find(m=>m.id===holder).name==='Alice'?a:b,other=owner===a?b:a;
 const correct=Number(s.correct_choice);
 await assert.rejects(rpc('answer_v3',[room,session,firstTurn,correct]),/Wait for the ball/);
 await as(other);let hidden=await rpc('snapshot_v3',[room]);assert.equal(hidden.question,undefined);assert.equal(hidden.answers,undefined);assert.equal(hidden.correct_choice,undefined);
 await assert.rejects(rpc('answer_v3',[room,session,firstTurn,correct]),/Wait for the ball/);
 await assert.rejects(rpc('submit_answer',[room,session,0,correct,100]),/Wait for the ball/);
 await as(owner);let own=await rpc('snapshot_v3',[room]);assert.equal(own.correct_choice,null);assert.equal(own.question,'Un cœur ?');
 await rpc('answer_v3',[room,session,firstTurn,correct]);
 await assert.rejects(rpc('answer_v3',[room,session,firstTurn,correct]),/closed/);
 s=await rpc('snapshot_v3',[room]);assert.equal(s.score,100);assert.equal(s.best_score,100);assert.equal(s.phase,'passing');assert.equal(s.deadline,null);
 await assert.rejects(rpc('pass_ball_v3',[room,session,firstTurn,holder]),/another player/);
 const target=s.members.find(m=>m.id!==holder).id;
 await rpc('pass_ball_v3',[room,session,firstTurn,target]);
 await as(host);s=await rpc('snapshot_v3',[room]);assert.equal(s.question,'Second question');assert.notEqual(s.turn_id,firstTurn);
 await as(other);await rpc('answer_v3',[room,session,s.turn_id,(Number(s.correct_choice)+1)%4]);
 s=await rpc('snapshot_v3',[room]);assert.equal(s.phase,'restart');assert.equal(s.score,0);assert.equal(s.best_score,100);assert.equal(s.event,'wrong');
 await admin(`update private.rooms set deadline=clock_timestamp()-interval '1 second' where id='${room}'`);
 await as(host);s=await rpc('snapshot_v3',[room]);assert.equal(s.question,'Un cœur ?');assert.equal(s.event,'random');assert.equal(s.question_index,0);
 await admin(`update private.rooms set deadline=clock_timestamp()-interval '1 second' where id='${room}'`);
 s=await rpc('snapshot_v3',[room]);assert.equal(s.phase,'restart');assert.equal(s.event,'timeout');
 await admin(`update private.rooms set deadline=clock_timestamp()-interval '1 second' where id='${room}'`);
 // Complete both questions and finish automatically; best survives later resets.
 for(let i=0;i<2;i++){
  await as(host);s=await rpc('snapshot_v3',[room]);const who=s.members.find(m=>m.id===s.holder).name==='Alice'?a:b;
  await as(who);await rpc('answer_v3',[room,session,s.turn_id,Number(s.correct_choice)]);
  if(i===0){const p=await rpc('snapshot_v3',[room]);await rpc('pass_ball_v3',[room,session,p.turn_id,p.members.find(m=>m.id!==p.holder).id]);}
 }
 s=await rpc('snapshot_v3',[room]);assert.equal(s.phase,'finished');assert.equal(s.playing,false);assert.equal(s.started,false);assert.equal(s.best_score,200);assert.equal(s.ranking[0].points,200);
 await as(host);opts=await rpc('workspace_options_v3',[w.id]);
 const room2=await rpc('create_room_v3',[w.id,null,'Classe B',opts.presets[0].id,null,null]);
 await rpc('control_room_v3',[room2,'finish']);const final=await rpc('snapshot_v3',[room2]);assert.equal(final.ranking.length,2);assert.equal(final.ranking[0].name,'Classe A');
 const replay=await rpc('create_room_v3',[w.id,opts.classrooms[0].id,null,opts.presets[0].id,null,null]);
 await rpc('control_room_v3',[replay,'finish']);assert.equal((await rpc('snapshot_v3',[replay])).best_score,200);
 await as(outsider);assert.equal((await rpc('access_workspace_v3',['École A','host-secret',false])).role,'host');
 await rpc('unlock_host_v3',[room2]);assert.equal((await rpc('snapshot_v3',[room2])).host,true);
 // Server-enforced roster limit and plush-only characters.
 await rpc('control_room_v3',[room2,'start']);
 for(let i=10;i<40;i++){await as(`00000000-0000-0000-0000-${String(i).padStart(12,'0')}`);await rpc('access_workspace_v3',['École A','guest-secret',false]);await rpc('join_room_v3',[room2,'Player '+i,40+i%6]);}
 await as('00000000-0000-0000-0000-000000000005');await rpc('access_workspace_v3',['École A','guest-secret',false]);await assert.rejects(rpc('workspace_options_v3',[w.id]),/Host access/);await assert.rejects(rpc('unlock_host_v3',[room2]),/Host access/);await assert.rejects(rpc('join_room_v3',[room2,'Extra',40]),/full/);
 }finally{await db.close();}
});
