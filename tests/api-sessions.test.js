import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'vite';
import vm from 'node:vm';

test('V3 guest identity is independent, persistent and reused without replacing the host',async()=>{
 const clients=[],storedSessions=new Map(),signups=new Map();
 const result=await build({configFile:false,logLevel:'silent',define:{'import.meta.env.VITE_SUPABASE_URL':JSON.stringify('https://project.supabase.co'),'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY':JSON.stringify('public-test-key')},plugins:[{name:'mock-auth',enforce:'pre',resolveId(id){if(id==='@supabase/supabase-js')return '\0mock-auth';},load(id){if(id==='\0mock-auth')return 'export const createClient=(...args)=>globalThis.mockClient(...args);';}}],build:{write:false,minify:false,rollupOptions:{preserveEntrySignatures:'strict',input:'src/api.js',output:{format:'iife',name:'api',inlineDynamicImports:true}}}});
 const context=vm.createContext({URL,Date,Map,mockClient(_url,_key,options){
  const scope=options?.auth?.storageKey||'existing-default';clients.push({scope,options});
  return {
   auth:{
    async getSession(){return {data:{session:storedSessions.get(scope)||null}};},
    async signInAnonymously(){signups.set(scope,(signups.get(scope)||0)+1);storedSessions.set(scope,{user:{id:scope}});return {data:{session:storedSessions.get(scope)}};}
   },
   async rpc(){return {data:{user:storedSessions.get(scope).user.id}};}
  };

 }});
 vm.runInContext(result.output.find(f=>f.type==='chunk').code,context);
 const host=await context.api.rpc('host',{});
 const [guestA,guestB]=await Promise.all([context.api.rpc('join',{},'v3-guest'),context.api.rpc('find',{},'v3-guest')]);
 assert.notEqual(guestA.data.user,host.data.user);
 assert.equal(guestA.data.user,guestB.data.user);
 assert.equal((await context.api.rpc('host-again',{})).data.user,host.data.user);
 assert.equal(clients.length,2);
 assert.equal(clients[0].options,undefined,'Existing host authentication options remain unchanged');
 assert.equal(clients[1].options.auth.storageKey,'sb-project-plouf-v3-guest');
 assert.equal(signups.get(guestA.data.user),1,'Concurrent requests create only one guest identity');
 assert.equal(signups.get(host.data.user),1);
});
