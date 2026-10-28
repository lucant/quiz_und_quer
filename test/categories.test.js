import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GameStore} from '../lib/game.js';
function fixture(t,questions){const db=new GameStore(':memory:');t.after(()=>db.close());const q=db.saveQuiz({title:'Neue Typen',mode:'single',points:10,questions});const s=db.createSession(q.id);const p=db.join(s.id,{name:'Gast'});const action=(action,extra={})=>db.action(s.id,{revision:db.get('sessions',s.id).revision,action,...extra});return {db,s,p,action};}
const base={text:'Frage',category:'Sport',answerMode:'digital',solution:'Erklärung'};
test('Kategorienbrett, Gruppierung und Modus ohne Antworten mit manuellen Punkten',t=>{
  const {db,s,p,action}=fixture(t,[{...base,type:'boolean',correct:[0]},{...base,category:'Musik',type:'open'},{...base,type:'estimate',target:42,tolerance:2}]);
  action('setup',{playMode:'moderated',ordering:'category'});action('start');
  assert.equal(db.get('sessions',s.id).phase,'board');assert.equal(db.view(s.id,'tv').question,null);
  assert.equal(db.view(s.id,'tv').categories[0].total,2);
  assert.throws(()=>action('next'));action('open');
  assert.equal(db.view(s.id,'player',p.token).question.canAnswer,false);
  assert.throws(()=>db.answer(s.id,p.token,{index:0,value:[0]}));action('close');
  assert.equal(db.get('sessions',s.id).scores[0][p.id],undefined);assert.throws(()=>action('reveal'));
  action('score',{index:0,participantId:p.id,points:5});action('reveal');
  assert.throws(()=>action('open'));action('next');assert.equal(db.view(s.id,'tv').categories[0].completed,1);
  action('open');assert.equal(db.get('sessions',s.id).quiz.questions[1].type,'estimate');
  assert.throws(()=>action('setup',{playMode:'digital',ordering:'sequence'}));
});
test('Neue digitale Fragetypen: Lösungen geschützt und automatische Bewertung',t=>{
  const {db,s,p,action}=fixture(t,[{...base,type:'boolean',correct:[1]},{...base,type:'estimate',target:100,tolerance:5},{...base,type:'order',options:['Erster','Zweiter','Dritter']},{...base,type:'match',pairs:[{left:'Frankreich',right:'Paris'},{left:'Italien',right:'Rom'}]}]);
  action('start');
  for(let i=0;i<4;i++){
    action('open');const q=db.get('sessions',s.id).quiz.questions[i];const view=db.view(s.id,'player',p.token).question;
    assert.equal(view.target,undefined);assert.equal(view.correctOrder,undefined);assert.equal(view.pairs,undefined);
    const value=i===0?[1]:i===1?105:q.correctOrder;
    if(i>=2)assert.throws(()=>db.answer(s.id,p.token,{index:i,value:Array(q.options.length).fill(0)}));
    db.answer(s.id,p.token,{index:i,value});action('close');assert.equal(db.get('sessions',s.id).scores[i][p.id],10);action('reveal');action('next');
  }
  assert.equal(db.view(s.id,'tv').question,null);action('finish');assert.equal(db.view(s.id,'tv').ranking[0].points,40);
});
test('Hinweise werden einzeln freigegeben; Antwortart unabhängig von Kategorie',t=>{
 const {db,s,p,action}=fixture(t,[{...base,type:'hint',hints:['Erster Hinweis','Zweiter Hinweis']},{...base,type:'boolean',answerMode:'oral',correct:[0]}]);
 action('start');action('open');assert.deepEqual(db.view(s.id,'tv').question.hints,[]);
 action('hint');assert.deepEqual(db.view(s.id,'player',p.token).question.hints,['Erster Hinweis']);
 db.answer(s.id,p.token,{index:0,value:'Antwort'});action('close');assert.throws(()=>action('hint'));
 action('score',{index:0,participantId:p.id,points:10});action('reveal');action('next');action('open');
 assert.equal(db.view(s.id,'player',p.token).question.canAnswer,false);assert.throws(()=>db.answer(s.id,p.token,{index:1,value:[0]}));
});
test('Alte Vorlagen werden normalisiert; alte Sessions bleiben kompatibel',t=>{
 const {db,s,p,action}=fixture(t,[{...base,type:'text'},{...base,type:'oral',answerMode:undefined}]);
 const old=db.get('sessions',s.id);delete old.boardEnabled;delete old.playMode;db.put('sessions',old);
 action('start');assert.equal(db.get('sessions',s.id).phase,'open');assert.equal(db.get('sessions',s.id).quiz.questions[0].type,'open');
 db.answer(s.id,p.token,{index:0,value:'Text'});action('close');action('score',{index:0,participantId:p.id,points:0});action('reveal');action('next');assert.equal(db.get('sessions',s.id).phase,'open');
 assert.throws(()=>db.answer(s.id,p.token,{index:1,value:'Text'}));
});
test('Löschen erfordert Bestätigung; Quizkopien in Sessions bleiben erhalten',t=>{
 const {db,s,p,action}=fixture(t,[{...base,type:'boolean',correct:[0]}]);
 const quizId=db.get('sessions',s.id).quiz.id;
 assert.throws(()=>db.delete('quizzes',quizId,false));assert.equal(db.list('quizzes').length,1);
 db.delete('quizzes',quizId,true);assert.equal(db.list('quizzes').length,0);
 action('start');action('open');assert.equal(db.view(s.id,'player',p.token).question.text,base.text);
 assert.throws(()=>db.delete('sessions',s.id,'true'));assert.equal(db.list('sessions').length,1);
 db.delete('sessions',s.id,true);assert.equal(db.list('sessions').length,0);
 assert.throws(()=>db.view(s.id,'player',p.token));assert.throws(()=>db.answer(s.id,p.token,{index:0,value:[0]}));
});
test('Avatare dürfen mehrfach gewählt werden und erscheinen in allen Ansichten',t=>{
 const {db,s,p,action}=fixture(t,[{...base,type:'boolean',correct:[0]}]);
 const a=db.join(s.id,{name:'Auto A',avatar:'car'}),b=db.join(s.id,{name:'Auto B',avatar:'car'});
 assert.equal(a.avatar,b.avatar);assert.equal(p.avatar,'pawn');
 assert.throws(()=>db.join(s.id,{name:'Falsch',avatar:'invalid'}));
 for(const role of ['admin','tv','player'])assert.equal(db.view(s.id,role,a.token).participants.find(p=>p.id===a.id).avatar,'car');
 assert.equal(db.view(s.id,'player',a.token).participant.avatar,'car');
 assert.equal(db.view(s.id,'admin').ranking.find(p=>p.id===b.id).avatar,'car');
});
