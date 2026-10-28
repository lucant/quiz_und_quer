import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GameStore } from '../lib/game.js';
import { createApp } from '../server.js';

const quiz = () => ({title:'Testabend', mode:'team', points:10, questions:[
  {type:'choice',text:'Welche Zahlen sind gerade?',options:['2','3','4'],correct:[0,2],multiple:true,solution:'2 und 4'},
  {type:'text',text:'Nenne einen Planeten.',solution:'Zum Beispiel Mars',points:5},
  {type:'oral',text:'Mündliche Frage',solution:'Antwort'}
]});
function setup(t) {const dir=mkdtempSync(join(tmpdir(),'quiz-test-'));const store=new GameStore(join(dir,'db.sqlite'));t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});return store;}
function act(store,id,action,extra={}) {
  let before=store.get('sessions',id);
  if(action==='finish'&&before.boardEnabled&&before.phase==='revealed'&&before.index===before.quiz.questions.length-1)store.action(id,{revision:before.revision,action:'next'});
  const result=store.action(id,{revision:store.get('sessions',id).revision,action,...extra});
  if(['start','next'].includes(action)&&result.phase==='board'&&result.index+1<result.quiz.questions.length)return store.action(id,{revision:result.revision,action:'open'});
  return result;
}

test('Vollständige Runde: Sequenz, automatische und manuelle Bewertung, Korrektur, endgültiger Abschluss',t=>{
  const db=setup(t),q=db.saveQuiz(quiz()),s=db.createSession(q.id),a=db.join(s.id,{name:'Team A'}),b=db.join(s.id,{name:'Team B'});
  assert.throws(()=>act(db,s.id,'next'));
  act(db,s.id,'start');
  assert.throws(()=>db.join(s.id,{name:'Spät'}));
  db.answer(s.id,a.token,{index:0,value:[0]});db.answer(s.id,a.token,{index:0,value:[2,0]});
  db.answer(s.id,b.token,{index:0,value:[0,1,2]});
  assert.equal(db.view(s.id,'player',a.token).question.correct,undefined);
  act(db,s.id,'close');
  assert.throws(()=>db.answer(s.id,a.token,{index:0,value:[0]}));
  let st=db.get('sessions',s.id);assert.equal(st.scores[0][a.id],10);assert.equal(st.scores[0][b.id],0);
  act(db,s.id,'reveal');assert.deepEqual(db.view(s.id,'tv').question.correct,[0,2]);
  act(db,s.id,'next');assert.throws(()=>db.answer(s.id,a.token,{index:0,value:[0,2]}));
  db.answer(s.id,a.token,{index:1,value:'Mars'});act(db,s.id,'close');
  assert.throws(()=>act(db,s.id,'reveal'));assert.throws(()=>act(db,s.id,'next'));
  assert.throws(()=>act(db,s.id,'score',{index:1,participantId:a.id,points:6}));
  act(db,s.id,'score',{index:1,participantId:a.id,points:2.5});act(db,s.id,'score',{index:1,participantId:b.id,points:0});
  act(db,s.id,'reveal');assert.throws(()=>act(db,s.id,'finish'));act(db,s.id,'next');
  assert.throws(()=>db.answer(s.id,a.token,{index:2,value:'Mündlich'}));
  act(db,s.id,'score',{index:0,participantId:b.id,points:5});
  act(db,s.id,'close');for(const p of [a,b])act(db,s.id,'score',{index:2,participantId:p.id,points:0});
  act(db,s.id,'reveal');act(db,s.id,'finish');
  assert.throws(()=>act(db,s.id,'score',{index:0,participantId:a.id,points:0}));
  assert.equal(db.view(s.id,'tv').ranking[0].points,12.5);
  assert.equal(db.get('sessions',s.id).phase,'finished');
});

test('Unveränderliche Quizkopie, Wiederverbindung und persistenter Spielstand',t=>{
  const dir=mkdtempSync(join(tmpdir(),'quiz-persist-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const path=join(dir,'db.sqlite');let db=new GameStore(path);const q=db.saveQuiz(quiz()),s=db.createSession(q.id),p=db.join(s.id,{name:'Gast'});
  act(db,s.id,'start');db.answer(s.id,p.token,{index:0,value:[0,2]});
  db.saveQuiz({...quiz(),title:'Geändert',points:99},q.id);db.close();db=new GameStore(path);
  assert.equal(db.get('sessions',s.id).quiz.points,10);assert.equal(db.get('sessions',s.id).quiz.title,'Testabend');
  assert.deepEqual(db.view(s.id,'player',p.token).answer.value,[0,2]);assert.equal(db.get('sessions',s.id).phase,'open');
  db.close();
});

test('Veraltete Moderation, doppelte Namen, Teilnehmerlimit und private Daten',t=>{
  const db=setup(t),q=db.saveQuiz(quiz()),s=db.createSession(q.id),p=db.join(s.id,{name:'Alice'});
  assert.throws(()=>db.join(s.id,{name:'alice'}));assert.throws(()=>db.action(s.id,{revision:0,action:'start'}));
  for(let i=1;i<20;i++)db.join(s.id,{name:`Gast ${i}`});assert.throws(()=>db.join(s.id,{name:'Zu viel'}));
  act(db,s.id,'start');
  assert.throws(()=>db.view(s.id,'player','falsch'));
  const tv=db.view(s.id,'tv');assert.equal(tv.quiz,undefined);assert.equal(tv.answers,undefined);assert.equal(tv.participants[0].token,undefined);assert.equal(tv.ranking,null);
  assert.equal(db.view(s.id,'admin').participants[0].token,undefined);
  assert.throws(()=>db.answer(s.id,p.token,{index:0,value:[9]}));
  const rev=db.get('sessions',s.id).revision;db.action(s.id,{action:'close',revision:rev});assert.throws(()=>db.action(s.id,{action:'close',revision:rev}));
});

test('Medien und Lösungen erscheinen nicht vor Freigabe auf Gästeansichten',t=>{
  const db=setup(t);const input=quiz();input.questions[0].media={id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.png',type:'image',name:'Foto'};
  const q=db.saveQuiz(input),s=db.createSession(q.id),p=db.join(s.id,{name:'Gast'});act(db,s.id,'start');
  assert.equal(db.view(s.id,'tv').question.media,undefined);act(db,s.id,'media',{visible:true,playing:false,position:0});
  assert.equal(db.view(s.id,'tv').question.media.type,'image');assert.equal(db.view(s.id,'player',p.token).question.media,undefined);
  assert.equal(db.view(s.id,'player',p.token).question.solution,undefined);
});

test('HTTP: Quiz, Session, QR-Code, Upload, Bytebereiche, Fehler und Cross-Origin-Schutz',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'quiz-http-'));const {server,store}=createApp({dataDir:dir});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{await new Promise(r=>server.close(r));store.close();rmSync(dir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=(path,body)=>fetch(base+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await request('/')).status,200);assert.equal((await request('/api/health')).status,200);
  const q=await (await request('/api/quizzes',quiz())).json(),s=await (await request('/api/sessions',{quizId:q.id})).json();
  assert.equal((await request(`/api/sessions/${s.id}/qr`)).headers.get('content-type'),'image/svg+xml');
  const cross=await fetch(`${base}/api/sessions`,{method:'POST',headers:{Origin:'https://foreign.example','Content-Type':'application/json'},body:JSON.stringify({quizId:q.id})});assert.equal(cross.status,403);
  assert.equal((await request('/api/quizzes',{...quiz(),points:-1})).status,400);
  const media=await fetch(`${base}/api/uploads`,{method:'POST',body:Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0])});assert.equal(media.status,201);
  const file=await media.json();const partial=await fetch(`${base}/uploads/${file.id}`,{headers:{Range:'bytes=0-7'}});assert.equal(partial.status,206);assert.equal((await partial.arrayBuffer()).byteLength,8);
  assert.equal((await fetch(`${base}/api/uploads`,{method:'POST',body:'<script>bad</script>'})).status,400);
  assert.equal((await fetch(`${base}/api/quizzes`,{method:'POST',body:'null'})).status,400);
  const remove=(path,confirm)=>fetch(base+path,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirm})});
  assert.equal((await remove(`/api/quizzes/${q.id}`,false)).status,400);
  assert.equal((await remove(`/api/quizzes/${q.id}`,true)).status,200);
  assert.equal((await request(`/api/sessions/${s.id}`)).status,200);
  assert.equal((await remove(`/api/sessions/${s.id}`,true)).status,200);
  assert.equal((await request(`/api/sessions/${s.id}`)).status,404);
});

test('20 gleichzeitige Teilnehmer: keine verlorenen Antworten und gemeinsame Antwortsperre',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'quiz-concurrent-'));const {server,store}=createApp({dataDir:dir});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{await new Promise(r=>server.close(r));store.close();rmSync(dir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`;
  const q=store.saveQuiz(quiz()),s=store.createSession(q.id);
  const ps=Array.from({length:20},(_,i)=>store.join(s.id,{name:`Spieler ${i+1}`}));act(store,s.id,'start');
  const answer=p=>fetch(`${base}/api/sessions/${s.id}/answer`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${p.token}`},body:JSON.stringify({index:0,value:[0,2]})});
  const results=await Promise.all(ps.map(answer));assert.ok(results.every(r=>r.status===200));
  assert.equal(Object.keys(store.get('sessions',s.id).answers[0]).length,20);
  act(store,s.id,'close');assert.ok(Object.values(store.get('sessions',s.id).scores[0]).every(n=>n===10));
  const late=await Promise.all(ps.map(answer));assert.ok(late.every(r=>r.status===409));
});
