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
 for(const file of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort()){
  if(file==='202611120004_classroom_passwords.sql')await db.exec(`
   insert into private.workspace_v3(id,name,guest_password_hash,host_password_hash) values('10000000-0000-0000-0000-000000000001','Legacy',extensions.crypt(encode(extensions.digest('old-guest','sha256'),'hex'),extensions.gen_salt('bf')),extensions.crypt(encode(extensions.digest('old-host','sha256'),'hex'),extensions.gen_salt('bf')));
   insert into private.classrooms_v3(workspace_id,name,best_score) values('10000000-0000-0000-0000-000000000001','Legacy class',500);
   insert into private.workspace_access_v3 values('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','host');`);
  await db.exec(await readFile('supabase/migrations/'+file,'utf8'));
 }


 const host='00000000-0000-0000-0000-000000000001',a='00000000-0000-0000-0000-000000000002',b='00000000-0000-0000-0000-000000000003',outsider='00000000-0000-0000-0000-000000000004';
 const as=async id=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');};
 const rpc=async(name,args)=>(await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as value`,args)).rows[0].value;
 const record=async name=>{await db.exec('reset role');const result=(await db.query('select best_score,best_reached_at::text as reached from private.classrooms_v3 where name=$1',[name])).rows[0];await db.exec('set role authenticated');return result;};
 const admin=async sql=>{await db.exec('reset role');await db.exec(sql);await db.exec('set role authenticated');};
 await as(host);
 const legacyWorkspace=await rpc('access_workspace_v3',['Legacy',false]);
 const legacyClass=(await rpc('list_classrooms_v3',[legacyWorkspace.id]))[0];
 assert.equal((await record('Legacy class')).best_score,500);
 assert.equal((await rpc('access_classroom_v3',[legacyWorkspace.id,legacyClass.id,null,'old-host',false])).role,'host');
 await admin("delete from private.workspace_v3 where name='Legacy'");
 assert.deepEqual(await rpc('list_workspaces_v3',[]),[]);
 const w=await rpc('access_workspace_v3',['École A',true]);
 assert.equal(w.role,undefined);assert.deepEqual(await rpc('list_workspaces_v3',[]),[{name:'École A'}]);
 await assert.rejects(rpc('access_workspace_v3',[' école a ',true]),/already used/);
 assert.equal((await rpc('access_workspace_v3',['École A',false])).id,w.id);
 assert.deepEqual(await rpc('list_classrooms_v3',[w.id]),[]);
 await assert.rejects(rpc('access_classroom_v3',[w.id,null,'Bad',null,true,'same','same']),/different/);
 const classA=await rpc('access_classroom_v3',[w.id,null,'Classe A',null,true,'guest-secret','host-secret']);
 assert.equal(classA.role,'host');assert.equal(classA.host_password_hash,undefined);
 await assert.rejects(rpc('access_classroom_v3',[w.id,null,'classe a',null,true,'guest-secret','host-secret']),/already used/);
 await assert.rejects(rpc('access_classroom_v3',[w.id,classA.id,null,'wrong',false]),/incorrect/);
 const sharedPrefix='a'.repeat(80),otherWorkspace=await rpc('access_workspace_v3',['Long passwords',true]);
 const longClass=await rpc('access_classroom_v3',[otherWorkspace.id,null,'Long class',null,true,sharedPrefix+'guest',sharedPrefix+'host']);
 assert.equal((await rpc('access_classroom_v3',[otherWorkspace.id,longClass.id,null,sharedPrefix+'guest',false])).role,'guest');
 assert.equal((await rpc('access_classroom_v3',[otherWorkspace.id,longClass.id,null,sharedPrefix+'host',false])).role,'host');
 const qs=JSON.stringify([{Q:'Un cœur ?',C:'Oui',W1:'Non',W2:'Peut-être',W3:'Jamais'},{Q:'Second question',C:'Correct',W1:'One',W2:'Two',W3:'Three'}]);
 const room=await rpc('create_room_v3',[w.id,classA.id,null,null,'Quiz A',qs]);
 let opts=await rpc('workspace_options_v3',[w.id]);
 await assert.rejects(rpc('create_room_v3',[w.id,null,'No classroom',opts.presets[0].id,null,null]),/Host access/);
 await assert.rejects(rpc('create_room_v3',[w.id,opts.classrooms[0].id,null,null,'quiz a',qs]),/preset name is already/);
 await as(outsider);await assert.rejects(rpc('workspace_options_v3',[w.id]),/Host access/);
 await assert.rejects(rpc('unlock_host',[room,'pass']),/Classroom access/);
 await as(host);await rpc('control_room_v3',[room,'start']);
 await assert.rejects(rpc('control_room_v3',[room,'play']),/at least two/);
 for(const [id,name,char] of [[a,'Alice',40],[b,'Bob',41]]){await as(id);await rpc('access_classroom_v3',[w.id,classA.id,null,'guest-secret',false]);await rpc('join_room_v3',[room,name,char]);}
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
 s=await rpc('snapshot_v3',[room]);assert.equal(s.score,100);assert.equal(s.best_score,100);assert.equal(s.phase,'passing');assert.equal(s.deadline,null);const firstRecord=await record('Classe A');
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
 s=await rpc('snapshot_v3',[room]);assert.equal(s.phase,'finished');assert.equal(s.playing,false);assert.equal(s.started,false);assert.equal(s.best_score,200);assert.equal(s.ranking[0].points,200);const higherRecord=await record('Classe A');assert.notEqual(higherRecord.reached,firstRecord.reached);
 await as(host);opts=await rpc('workspace_options_v3',[w.id]);
 const classB=await rpc('access_classroom_v3',[w.id,null,'Classe B',null,true,'guest-b','host-b']);
 const room2=await rpc('create_room_v3',[w.id,classB.id,null,opts.presets[0].id,null,null]);
 await rpc('control_room_v3',[room2,'finish']);const final=await rpc('snapshot_v3',[room2]);assert.equal(final.ranking.length,2);assert.equal(final.ranking[0].name,'Classe A');
 const replay=await rpc('create_room_v3',[w.id,opts.classrooms[0].id,null,opts.presets[0].id,null,null]);
 await rpc('control_room_v3',[replay,'start']);
 for(const [id,name]of [[a,'Alice'],[b,'Bob']]){await as(id);await rpc('join_room_v3',[replay,name,40]);}
 await as(host);await rpc('control_room_v3',[replay,'play']);
 for(let i=0;i<2;i++){
  await as(host);const turn=await rpc('snapshot_v3',[replay]);await as(turn.members.find(m=>m.id===turn.holder).name==='Alice'?a:b);
  await rpc('answer_v3',[replay,turn.session_id,turn.turn_id,Number(turn.correct_choice)]);
  if(i===0)await rpc('pass_ball_v3',[replay,turn.session_id,turn.turn_id,turn.members.find(m=>m.id!==turn.holder).id]);
 }
 assert.equal((await record('Classe A')).reached,higherRecord.reached,'Tying a record must preserve its original achievement time');
 await as(host);assert.equal((await rpc('snapshot_v3',[replay])).best_score,200);
 await admin("update private.classrooms_v3 set name='Aardvark',best_score=200,best_reached_at=clock_timestamp()+interval '1 second' where name='Classe B'");
 const tied=await rpc('snapshot_v3',[replay]);assert.deepEqual(tied.ranking.map(c=>c.name),['Classe A','Aardvark'],'Earlier achievement wins a tie regardless of classroom name');
 await as(outsider);assert.equal((await rpc('access_classroom_v3',[w.id,classB.id,null,'host-b',false])).role,'host');
 await assert.rejects(rpc('unlock_host_v3',[room]),/Classroom access/);
 await assert.rejects(rpc('snapshot_v3',[room]),/Classroom access/);
 await assert.rejects(rpc('create_room_v3',[w.id,classA.id,null,opts.presets[0].id,null,null]),/Host access/);
 await rpc('unlock_host_v3',[room2]);assert.equal((await rpc('snapshot_v3',[room2])).host,true);
 // Server-enforced roster limit and plush-only characters.
 await rpc('control_room_v3',[room2,'start']);
 for(let i=10;i<40;i++){await as(`00000000-0000-0000-0000-${String(i).padStart(12,'0')}`);await rpc('access_classroom_v3',[w.id,classB.id,null,'guest-b',false]);await rpc('join_room_v3',[room2,'Player '+i,40+i%6]);}
 await as('00000000-0000-0000-0000-000000000005');await rpc('access_classroom_v3',[w.id,classB.id,null,'guest-b',false]);await assert.rejects(rpc('workspace_options_v3',[w.id]),/Host access/);await assert.rejects(rpc('unlock_host_v3',[room2]),/Host access/);await assert.rejects(rpc('join_room_v3',[room2,'Extra',40]),/full/);
 }finally{await db.close();}
});
