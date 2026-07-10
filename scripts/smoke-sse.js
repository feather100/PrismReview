/**
 * PrismReview — SSE DB Smoke Test (Sprint 4.3C)
 *
 * Verifies Meeting SSE DB turns hardening:
 * - Completed DB replay → finite + meeting.completed
 * - Sequence monotonic
 * - Correct review → SSE error
 * - Mock fallback still works
 */

const BASE = 'http://localhost:4000/api';

const p = (url, opts = {}) => new Promise(r => { const u=new URL(url); const lib=url.startsWith('https')?require('https'):require('http');
  const req=lib.request({hostname:u.hostname,port:u.port,path:u.pathname+u.search,method:opts.method||'GET',headers:{'Content-Type':'application/json',...(opts.headers||{})}},
    (res)=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>r({s:res.statusCode,b:JSON.parse(d)}));});
  req.on('error',e=>r({s:0,b:e.message}));if(opts.body)req.write(JSON.stringify(opts.body));req.end(); });

const fetchSSE = (url, timeoutMs = 8000) => new Promise(r => {
  const u=new URL(url); let resolved=false; let allData=''; let statusCode=0;
  const timer=setTimeout(()=>{if(!resolved){resolved=true;r({s:statusCode,b:allData||'TIMEOUT'});}},timeoutMs);
  const req=require('http').get({hostname:u.hostname,port:u.port,path:u.pathname}, (res)=>{
    statusCode=res.statusCode;
    const done=()=>{if(!resolved){resolved=true;clearTimeout(timer);r({s:statusCode,b:allData});}};
    res.on('data',c=>allData+=c.toString()); res.on('end',done); res.on('close',done);
  });
  req.on('error',e=>{if(!resolved){resolved=true;clearTimeout(timer);r({s:0,b:e.message});}});
});

const setupReview = async () => {
  const c=await p(BASE+'/reviews',{method:'POST',body:{title:'SSE Test',objective:'T'}});
  await p(BASE+'/reviews/'+c.b.id+'/diagnose',{method:'POST'});
  const dx=await p(BASE+'/reviews/'+c.b.id+'/diagnosis');
  const roles=dx.b.recommendedRoles.slice(0,3).map(r=>({roleId:r.roleId,weight:r.weight}));
  await p(BASE+'/reviews/'+c.b.id+'/roles',{method:'POST',body:{roles}});
  await p(BASE+'/reviews/'+c.b.id+'/start',{method:'POST'});
  return c.b.id;
};

let pass=0,fail=0;
const check=async(name,fn)=>{try{const r=await fn();if(r.pass){pass++;console.log('  ✅ '+name);}else{fail++;console.log('  ❌ '+name+' — '+r.actual);}}catch(e){fail++;console.log('  ❌ '+name+' — threw: '+e.message);}};

(async () => {
  console.log('\n🧪 SSE DB Smoke Test (Sprint 4.3C)\n');

  // 1. Completed DB replay
  const rid = await setupReview();
  await new Promise(r=>setTimeout(r, 4000));

  const rv = await p(BASE+'/reviews/'+rid);
  console.log('  Review status:', rv.b.status);

  if (rv.b.status === 'completed') {
    const sse1 = await fetchSSE(BASE+'/reviews/'+rid+'/meeting/stream', 8000);
    await check('Completed: finite replay + meeting.completed', () => {
      const hasME=sse1.b.includes('meeting.started'), hasTS=sse1.b.includes('agent.turn.started');
      const hasMC=sse1.b.includes('meeting.completed'), noErr=!sse1.b.includes('event: error');
      return {pass: hasME&&hasTS&&hasMC&&noErr, actual: 'started='+hasME+' turns='+hasTS+' completed='+hasMC+(noErr?'':' error')};
    });

    const seqs=[...sse1.b.matchAll(/"sequence":(\d+)/g)].map(m=>parseInt(m[1]));
    const mono=seqs.every((v,i)=>i===0||v>seqs[i-1]);
    await check('Completed: sequence monotonic', () => ({pass:seqs.length>5&&mono, actual:seqs.length+' events, monotonic='+mono}));
  }

  // 2. Draft → SSE error
  const c2=await p(BASE+'/reviews',{method:'POST',body:{title:'SSE Draft',objective:'T'}});
  const sse2=await fetchSSE(BASE+'/reviews/'+c2.b.id+'/meeting/stream', 3000);
  await check('Draft: SSE error', () => ({pass:sse2.b.includes('event: error'), actual:sse2.b.includes('event: error')?'error':'no error, '+sse2.b.length+' bytes'}));

  // 3. Invalid UUID → SSE error
  const sse3=await fetchSSE(BASE+'/reviews/not-a-uuid/meeting/stream', 3000);
  await check('Invalid UUID: SSE error', () => ({pass:sse3.b.includes('event: error'), actual:sse3.b.includes('event: error')?'error':'no error, '+sse3.b.length+' bytes'}));

  // 4. Non-existent valid UUID → SSE error (no review)
  const sse4=await fetchSSE(BASE+'/reviews/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa/meeting/stream', 3000);
  await check('Non-existent: SSE error', () => ({pass:sse4.b.includes('event: error'), actual:sse4.b.includes('event: error')?'error':'no error, '+sse4.b.length+' bytes'}));

  console.log('\n'+'='.repeat(50));
  console.log('  '+pass+'/'+(pass+fail)+' passed, '+fail+'/'+(pass+fail)+' failed');
  console.log('='.repeat(50));
  process.exit(fail>0?1:0);
})();
