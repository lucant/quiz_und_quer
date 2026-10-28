import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {GameStore} from '../lib/game.js';
function ui(t){
 const dom=new JSDOM('<div id="app"></div><div id="toast"></div>',{url:'http://localhost:3000',runScripts:'outside-only'});
 t.after(()=>dom.window.close());
 const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/route\(\);\s*$/,'window.ui={renderHost,renderPlayer,renderTV,renderEditor,deleteItem,avatarPicker,dashboard,setDraft(v){draft=v},setState(v){state=v},init(){config={addresses:[]}}};');
 dom.window.eval(source);dom.window.ui.init();return dom.window;
}
function game(t,type='boolean',extra={}){const db=new GameStore(':memory:');t.after(()=>db.close());const quiz=db.saveQuiz({title:'Test',mode:'single',points:10,questions:[{type,text:'Geheime Frage',category:'Sport',correct:[0],answerMode:'digital',...extra}]});const s=db.createSession(quiz.id),p=db.join(s.id,{name:'Gast'});const action=(action,extra={})=>db.action(s.id,{revision:db.get('sessions',s.id).revision,action,...extra});return {db,s,p,action};}
test('UI: Kategorienbrett auf allen drei Ansichten ohne Fragetext',t=>{
 const w=ui(t),{db,s,p,action}=game(t);action('start');
 for(const [role,render] of [['admin','renderHost'],['player','renderPlayer'],['tv','renderTV']]){
  w.ui[render](db.view(s.id,role,p.token));assert.match(w.document.body.textContent,/Sport/);assert.doesNotMatch(w.document.body.textContent,/Geheime Frage/);assert.equal(w.document.querySelectorAll('.category-tile').length,1);
 }
});
test('UI: Modus ohne Antwortabgabe zeigt keine Eingaben bei allen Fragetypen',t=>{
 const w=ui(t);
 for(const type of ['boolean','choice','open','media','estimate','order','match','hint']){
  const s={id:'12345678',title:'Test',phase:'open',index:0,total:1,participant:{name:'Gast'},question:{type,text:'Frage',canAnswer:false,options:['A','B'],labels:type==='match'?['Links A','Links B']:undefined,points:10,hints:[]}};
  w.ui.renderPlayer(s);assert.equal(w.document.querySelectorAll('input,select,textarea,[data-choice],[data-action="save-answer"]').length,0,type);
 }
});
test('UI: Schnellbutton vergibt halbe Punkte über die echte Spielsteuerung',async t=>{
 const w=ui(t),{db,s,p,action}=game(t);action('start');action('open');action('close');
 let view=db.view(s.id,'admin');w.ui.setState(view);w.ui.renderHost(view);
 w.fetch=async(path,options)=>{action(JSON.parse(options.body).action,JSON.parse(options.body));return {ok:true,json:async()=>db.view(s.id,'admin')};};
 const button=w.document.querySelector('[data-action="quick-score"][data-points="5"]');assert.ok(button);
 await w.document.querySelector('#app').onclick({target:button});assert.equal(db.get('sessions',s.id).scores[0][p.id],5);
 assert.equal(w.document.querySelector('[data-score]').value,'5');
});
test('UI: Hinweisfreigabe erhält ungespeicherte Textantwort',t=>{
 const w=ui(t),{db,s,p,action}=game(t,'hint',{hints:['Neuer Hinweis']});action('start');action('open');const before=db.view(s.id,'player',p.token);w.ui.renderPlayer(before);w.document.querySelector('#answer-text').value='Entwurf';
 action('hint');w.ui.renderPlayer(db.view(s.id,'player',p.token),before);assert.equal(w.document.querySelector('#answer-text').value,'Entwurf');assert.match(w.document.querySelector('#live-hints').textContent,/Neuer Hinweis/);
});
test('UI: Editor bietet alle neuen Typen, Kategorie und unabhängige Antwortart',t=>{
 const w=ui(t);w.ui.setDraft({title:'Quiz',mode:'single',points:10,questions:['boolean','estimate','order','match','hint','open'].map(type=>({type,category:'Sport',answerMode:'oral',options:['A','B'],correct:[0],pairs:[{left:'A',right:'B'}],hints:['Hinweis']}))});w.ui.renderEditor();
 assert.equal(w.document.querySelectorAll('[data-qfield="category"]').length,6);assert.equal(w.document.querySelectorAll('[data-qfield="answerMode"]').length,6);
 assert.ok(w.document.querySelector('[data-lines="pairs"]'));assert.ok(w.document.querySelector('[data-lines="hints"]'));assert.ok(w.document.querySelector('[data-qfield="target"]'));
});
test('UI: Beamer animiert Zustandswechsel, aber nicht Antwort-Updates',t=>{
 const w=ui(t),{db,s,action}=game(t);action('start');const board=db.view(s.id,'tv');w.ui.renderTV(board);assert.ok(w.document.querySelector('.tv-stage.is-entering'));
 w.ui.renderTV({...board,revision:board.revision+1},board);assert.equal(w.document.querySelector('.tv-stage.is-entering'),null);
 action('open');const question=db.view(s.id,'tv');w.ui.renderTV(question,board);assert.ok(w.document.querySelector('.tv-stage.is-entering'));
 assert.match(w.document.querySelector('.brand').textContent,/Quiz & Quer/);
 assert.equal(w.document.querySelector('.brand img').getAttribute('src'),'/icon.svg');
});
test('UI: Abgebrochene Löschbestätigung sendet keine Anfrage',async t=>{
 const w=ui(t);let requests=0;w.fetch=async()=>{requests++;return {ok:true,json:async()=>({deleted:true})};};
 w.confirm=()=>false;assert.equal(await w.ui.deleteItem('quizzes','id','Name'),false);assert.equal(requests,0);
 w.confirm=message=>{assert.match(message,/endgültig löschen/);return true;};assert.equal(await w.ui.deleteItem('sessions','id','Name'),true);assert.equal(requests,1);
});
test('UI: Avatar-Auswahl ist beschriftet und pro Teilnehmer einzeln wählbar',t=>{
 const w=ui(t);w.document.querySelector('#app').innerHTML=w.ui.avatarPicker();
 assert.equal(w.document.querySelectorAll('input[name="avatar"]').length,10);assert.equal(w.document.querySelector('input:checked').value,'pawn');
 w.document.querySelector('input[value="car"]').click();assert.equal(w.document.querySelector('input:checked').value,'car');assert.equal(w.document.querySelectorAll('input:checked').length,1);
 const s={id:'12345678',title:'Test',phase:'lobby',participants:[{name:'A',avatar:'car'},{name:'B',avatar:'car'}],participant:{name:'A',avatar:'car'}};
 w.ui.renderPlayer(s);assert.equal(w.document.querySelectorAll('.name-chip [aria-label="Auto"]').length,2);
});
