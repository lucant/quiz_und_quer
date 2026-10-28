const $ = (s, root = document) => root.querySelector(s);
const app = $('#app');
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const phases = {lobby:'Lobby',board:'Kategorien',open:'Antwortphase',grading:'Bewertung',revealed:'Auflösung',finished:'Beendet'};
const typeNames = {choice:'Multiple Choice',open:'Offene Frage',media:'Bild / Audio',boolean:'Wahr / Falsch',estimate:'Schätzfrage',order:'Reihenfolge',match:'Zuordnung',hint:'Hinweisfrage'};
let timer, state, config, draft, quizList = [], busy = false, audioEnabled = false, audioElement, mediaKey = '', routeKey = 0;
let toastTimer;
function toast(message,error=false) { const el=$('#toast'); el.textContent=message; el.className=error?'error':'';el.style.display='block';clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.style.display='none',4500); }
async function api(path, options={}) {
  const response = await fetch(`/api${path}`, { ...options, headers: {'Content-Type':'application/json',...options.headers}, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  const data=await response.json(); if(!response.ok) {const error=new Error(data.error || 'Anfrage fehlgeschlagen.');error.status=response.status;throw error;}return data;
}
const post=(path,body,headers)=>api(path,{method:'POST',body,headers});
const header=(label='Dein Quiz. Euer Abend.')=>`<header class="topbar"><a class="brand" href="/"><img class="brand-icon" src="/icon.svg" alt="">Quiz &amp; Quer<span class="muted small"> / ${esc(label)}</span></a><span class="status" id="connection"><span class="dot"></span> Lokal verbunden</span></header>`;
const shell=(content,kind='shell',label)=>`<div class="${kind}">${header(label)}${kind==='tv-shell'?`<div class="tv-stage">${content}</div>`:content}</div>`;
const btn=(label,action,cls='',attrs='')=>`<button class="${cls}" data-action="${action}" ${attrs}>${label}</button>`;
const avatars={pawn:['♟','Spielfigur'],car:['🚗','Auto'],hat:['🎩','Hut'],dog:['🐕','Hund'],ship:['⛵','Schiff'],shoe:['👟','Schuh'],cat:['🐈','Katze'],duck:['🦆','Ente'],rocket:['🚀','Rakete'],bicycle:['🚲','Fahrrad']};
function avatar(id){const [symbol,label]=avatars[id]||avatars.pawn;return `<span class="avatar" role="img" aria-label="${label}">${symbol}</span>`;}
function avatarPicker(){return `<fieldset class="avatar-picker"><legend>Deine Spielfigur</legend><div>${Object.entries(avatars).map(([id,[symbol,label]],i)=>`<label class="avatar-choice"><input type="radio" name="avatar" value="${id}" ${i===0?'checked':''}><span role="img" aria-label="${label}">${symbol}</span><small>${label}</small></label>`).join('')}</div><p class="muted small">Mehrere Spieler dürfen dieselbe Figur wählen.</p></fieldset>`;}
async function deleteItem(kind,id,title){
  const message=kind==='quizzes'?`Quiz „${title}“ endgültig löschen? Bereits erstellte Sessions bleiben erhalten.`:`Session „${title}“ (${id}) endgültig löschen? Teilnehmer, Antworten und Punkte dieser Session werden entfernt. Eine laufende Runde wird beendet.`;
  if(!confirm(message))return false;
  await api(`/${kind}/${id}`,{method:'DELETE',body:{confirm:true}});toast(kind==='quizzes'?'Quiz gelöscht.':'Session gelöscht.');return true;
}
function navigate(path) { history.pushState({},'',path); route(); }
document.addEventListener('click',e=>{const a=e.target.closest('a');if(a && a.origin===location.origin && !a.target && !e.ctrlKey && !e.metaKey){e.preventDefault();navigate(a.pathname+a.search);}});
window.addEventListener('popstate',route);
window.addEventListener('beforeunload',e=>{if(draft){e.preventDefault();e.returnValue='';}});
function baseUrl() {return localStorage.getItem('quiz-base-url') || config?.publicUrl || location.origin;}
function joinLink(id) {return `${baseUrl().replace(/\/$/,'')}/join/${id}`;}
function qr(id) {return `/api/sessions/${id}/qr?base=${encodeURIComponent(baseUrl())}`;}
function ranking(rows) {let last,rank=0;return `<div>${(rows||[]).map((p,i)=>{if(p.points!==last)rank=i+1;last=p.points;return `<div class="ranking-row"><span class="rank number">${rank.toString().padStart(2,'0')}</span>${avatar(p.avatar)}<strong>${esc(p.name)}</strong><strong class="number">${p.points} <span class="muted small">Pkt.</span></strong></div>`;}).join('')}</div>`;}
function participants(ps) {return `<div class="participant-list">${ps.map(p=>`<span class="name-chip">${avatar(p.avatar)}${esc(p.name)}</span>`).join('') || '<p class="muted">Noch ist es ruhig hier. Lade die ersten Gäste ein.</p>'}</div>`;}
async function route() {
  const key=++routeKey;clearTimeout(timer);state=null;draft=null;mediaKey='';if(audioElement){audioElement.pause();audioElement=null;}
  app.onclick=null;app.oninput=null;app.onchange=null;
  app.innerHTML='<div class="loading">Quizabend wird geladen …</div>';
  try {
    config ||= await api('/config');
    if(key!==routeKey)return;
    const path=location.pathname;
    if(path==='/')return dashboard();
    if(path==='/quiz/new')return editor();
    let m=path.match(/^\/quiz\/([\w-]+)$/);if(m)return editor(m[1]);
    m=path.match(/^\/(host|tv|join)\/([A-Fa-f0-9]{8})$/);
    if(m){const role=m[1]==='host'?'admin':m[1]==='tv'?'tv':'player';return watch(m[2].toUpperCase(),role,key);}
    app.innerHTML=shell('<h1>Diese Seite gibt es nicht.</h1><a href="/">Zum Dashboard →</a>');
  }catch(e){app.innerHTML=shell(`<h1>Das hat nicht geklappt.</h1><p class="error-text">${esc(e.message)}</p><a href="/">Zum Dashboard →</a>`);}
}
async function dashboard() {
  const [quizzes,sessions]=await Promise.all([api('/quizzes'),api('/sessions')]);quizList=quizzes;
  app.innerHTML=shell(`<section class="hero"><div><div class="eyebrow">Ein guter Abend beginnt mit einer Frage</div><h1>Bereit für die nächste Runde?</h1><p>Quiz vorbereiten, Freunde einladen, gemeinsam rätseln.</p></div>${btn('+ Neues Quiz','new','primary')}</section>
    <div class="section-title"><h2>Deine Quizze</h2><span>${quizzes.length} vorbereitet</span></div>
    ${quizzes.length?`<div class="grid">${quizzes.map(q=>`<article class="card quiz-card"><div class="row between"><span class="badge">${q.mode==='team'?'TEAMS':'EINZELSPIELER'}</span><span class="muted small">${q.questions.length} Fragen</span></div><h2>${esc(q.title)}</h2><div class="meta"><span>${q.points} Grundpunkte</span><span>${q.questions.filter(q=>q.media).length} Medien</span></div><div class="actions">${btn('Session erstellen','create-session','primary',`data-id="${q.id}" ${q.questions.length?'':'disabled'}`)}${btn('Bearbeiten','edit','',`data-id="${q.id}"`)}${btn('Duplizieren','duplicate','',`data-id="${q.id}"`)}${btn('Löschen','delete-quiz','danger',`data-id="${q.id}"`)}</div></article>`).join('')}</div>`:`<div class="empty"><h2>Platz für deine erste Quizidee.</h2><p>Erstelle Fragen, lege Punkte fest und füge Bilder oder Audio hinzu.</p>${btn('Erstes Quiz erstellen','new','primary')}</div>`}
    <div class="section-title"><h2>Spielrunden & Archiv</h2><span>${sessions.length} Sessions</span></div>
    ${sessions.length?`<div class="card session-list">${sessions.reverse().map(s=>`<div class="session-row"><a class="session-main" href="/host/${s.id}"><div><strong>${esc(s.title)}</strong><p class="muted small">${s.id} · ${new Date(s.createdAt).toLocaleDateString('de-DE')} · ${s.participants} Teilnehmer</p></div><span class="badge ${s.phase==='finished'?'':'live'}">${phases[s.phase]} &nbsp; →</span></a>${btn('Löschen','delete-session','danger',`data-id="${s.id}" data-title="${esc(s.title)}"`)}</div>`).join('')}</div>`:'<p class="muted">Hier erscheinen deine laufenden und abgeschlossenen Spielrunden.</p>'}
    <div class="footer row between"><span>Für gemeinsame Abende. Ohne Cloud.</span><span>Bis zu 20 Geräte · Daten lokal gespeichert</span></div>`);
  app.onclick=async e=>{const b=e.target.closest('[data-action]');if(!b)return;try{switch(b.dataset.action){
    case 'new':navigate('/quiz/new');break;
    case 'delete-quiz':{const q=quizList.find(q=>q.id===b.dataset.id);b.disabled=true;if(await deleteItem('quizzes',q.id,q.title))await dashboard();else b.disabled=false;break;}
    case 'delete-session':b.disabled=true;if(await deleteItem('sessions',b.dataset.id,b.dataset.title))await dashboard();else b.disabled=false;break;
    case 'edit':navigate(`/quiz/${b.dataset.id}`);break;
    case 'duplicate':{const q=quizList.find(q=>q.id===b.dataset.id);const copy=await post('/quizzes',{...q,title:`${q.title} (Kopie)`});navigate(`/quiz/${copy.id}`);break;}
    case 'create-session':b.disabled=true;{const s=await post('/sessions',{quizId:b.dataset.id});navigate(`/host/${s.id}`);}break;
  }}catch(err){toast(err.message,true);b.disabled=false;}};
}
function newQuestion(){return {category:'Allgemein',answerMode:'digital',pairs:[],hints:[],target:0,tolerance:0,unit:'',type:'choice',text:'',points:null,options:['','','',''],correct:[0],multiple:false,solution:'',media:null};}
async function editor(id) {
  if(id){const qs=await api('/quizzes');draft=structuredClone(qs.find(q=>q.id===id));if(!draft)throw new Error('Quiz nicht gefunden.');}
  else draft={title:'',mode:'single',points:10,questions:[newQuestion()]};
  draft.questions.forEach(q=>{q.answerMode ||= ['oral','media'].includes(q.type)?'oral':'digital';if(['text','oral'].includes(q.type))q.type='open';q.category ||= 'Allgemein';});
  renderEditor();
}
function renderEditor() {
  const d=draft;
  app.innerHTML=shell(`<div class="editor"><datalist id="categories">${[...new Set(d.questions.map(q=>q.category||'Allgemein'))].map(c=>`<option value="${esc(c)}">`).join('')}</datalist><div class="editor-head"><div><div class="eyebrow">Quizwerkstatt</div><h1>${d.id?'Quiz bearbeiten':'Neues Quiz'}</h1></div><div class="actions">${btn('Zurück','back')}${btn('Quiz speichern','save','primary')}</div></div>
    <div class="card fields"><label>Quizname<input data-field="title" maxlength="120" placeholder="Zum Beispiel: Freitagabend mit Freunden" value="${esc(d.title)}"></label><label>Spielmodus<select data-field="mode"><option value="single" ${d.mode==='single'?'selected':''}>Einzelspieler</option><option value="team" ${d.mode==='team'?'selected':''}>Teams</option></select></label><label>Grundpunkte<input type="number" data-field="points" min="0.5" max="1000" step="0.5" value="${d.points}"></label></div>
    ${d.questions.map((q,i)=>`<section class="card question-edit" data-q="${i}"><div class="row between"><h3><span class="muted">${String(i+1).padStart(2,'0')} /</span> Frage</h3><div class="actions">${btn('↑','up','',`aria-label="Frage nach oben" ${i===0?'disabled':''}`)}${btn('↓','down','',`aria-label="Frage nach unten" ${i===d.questions.length-1?'disabled':''}`)}${btn('Entfernen','remove','danger')}</div></div>
    <div class="qfields"><label>Fragetyp<select data-qfield="type">${Object.entries(typeNames).map(([v,l])=>`<option value="${v}" ${q.type===v?'selected':''}>${l}</option>`).join('')}</select></label><label>Punkte (leer = ${d.points})<input data-qfield="points" type="number" min="0.5" max="1000" step="0.5" placeholder="Grundpunkte" value="${q.points??''}"></label></div>
    <div class="qfields"><label>Themenkategorie<input data-qfield="category" list="categories" maxlength="60" value="${esc(q.category||'Allgemein')}" placeholder="Zum Beispiel Sport"></label><label>Antwortart<select data-qfield="answerMode"><option value="digital" ${q.answerMode==='digital'?'selected':''}>Am Handy antworten</option><option value="oral" ${q.answerMode==='oral'?'selected':''}>Mündlich · Moderator bewertet</option></select></label></div>
    ${extraEditor(q)}<label>Fragetext<textarea data-qfield="text" maxlength="4000" placeholder="Was möchtest du wissen?">${esc(q.text)}</textarea></label>
    ${q.type==='choice'?`<label class="checkline"><input type="checkbox" data-qfield="multiple" ${q.multiple?'checked':''}> Mehrere richtige Antworten</label><p class="muted small">Markiere die richtige Lösung. Punkte gibt es nur für die vollständig richtige Auswahl.</p>${q.options.map((v,j)=>`<div class="option-edit"><input aria-label="Option ${j+1} ist richtig" type="${q.multiple?'checkbox':'radio'}" name="correct-${i}" data-correct="${j}" ${q.correct.includes(j)?'checked':''}><input aria-label="Antwortoption ${j+1}" type="text" maxlength="500" data-option="${j}" value="${esc(v)}" placeholder="Antwort ${String.fromCharCode(65+j)}">${btn('×','remove-option','',`data-option-index="${j}" aria-label="Antwortoption entfernen" ${q.options.length<=2?'disabled':''}`)}</div>`).join('')}${btn('+ Antwortoption','add-option','',q.options.length>=8?'disabled':'')}`:`<p class="muted small">${q.answerMode==='digital'?'Gäste antworten am Handy.':'Die Antwort erfolgt mündlich.'} Du vergibst anschließend die Punkte pro ${d.mode==='team'?'Team':'Spieler'}, auch 0 oder Teilpunkte.</p>`}
    <div class="spacer"></div><label>Lösung / Erklärung für die Auflösung<textarea data-qfield="solution" maxlength="4000" placeholder="Wird erst bei der Auflösung gezeigt">${esc(q.solution)}</textarea></label>
    <div class="upload"><label>Bild oder Audio · ausschließlich auf dem TV</label><p class="muted small">PNG, JPG, WebP, GIF, MP3, WAV, OGG oder M4A · maximal 20 MB</p>${q.media?`<p>${esc(q.media.name)} ${btn('Medium entfernen','remove-media')}</p>${q.media.type==='image'?`<img class="upload-preview" src="/uploads/${q.media.id}" alt="Medienvorschau">`:`<audio controls preload="metadata" src="/uploads/${q.media.id}"></audio>`}`:''}<input type="file" data-upload accept="image/png,image/jpeg,image/webp,image/gif,audio/mpeg,audio/wav,audio/ogg,audio/mp4,.m4a"></div>
    </section>`).join('')}<div class="spacer"></div>${btn('+ Frage hinzufügen','add','full')}<p class="muted small footer">Änderungen betreffen nur die Vorlage. Bereits erstellte Spielsessions behalten ihre Fragen und Regeln.</p></div>`);
  app.oninput=e=>{const el=e.target;if(el.dataset.field){draft[el.dataset.field]=el.dataset.field==='points'?Number(el.value):el.value;}
    const section=el.closest('[data-q]');if(!section)return;const q=draft.questions[Number(section.dataset.q)];
    if(el.dataset.qfield){const f=el.dataset.qfield;q[f]=['target','tolerance'].includes(f)?Number(el.value):f==='points'?(el.value===''?null:Number(el.value)):f==='multiple'?el.checked:el.value;}
    if(el.dataset.lines==='options')q.options=el.value.split('\n');
    if(el.dataset.lines==='hints')q.hints=el.value.split('\n');
    if(el.dataset.lines==='pairs')q.pairs=el.value.split('\n').map(line=>{const [left,...right]=line.split('|');return {left:left.trim(),right:right.join('|').trim()};});
    if(el.dataset.option!==undefined)q.options[Number(el.dataset.option)]=el.value;
  };
  app.onchange=async e=>{const el=e.target,section=el.closest('[data-q]');if(!section)return;const q=draft.questions[Number(section.dataset.q)];
    if(el.dataset.qfield==='type'){if(q.type==='boolean')q.correct=[0];if(q.type==='choice' && q.options.length<2){q.options=['','','',''];q.correct=[0];}renderEditor();}
    if(el.dataset.qfield==='multiple'){if(!q.multiple)q.correct=q.correct.slice(0,1);renderEditor();}
    if(el.hasAttribute('data-boolean'))q.correct=[Number(el.value)];
    if(el.dataset.correct!==undefined){const j=Number(el.dataset.correct);q.correct=q.multiple?(el.checked?[...q.correct,j]:q.correct.filter(n=>n!==j)):[j];}
    if(el.hasAttribute('data-upload') && el.files[0]){const file=el.files[0];if(file.size>20*1024*1024)return toast('Die Datei darf höchstens 20 MB groß sein.',true);el.disabled=true;
      try{const r=await fetch('/api/uploads',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file});const m=await r.json();if(!r.ok)throw new Error(m.error);q.media={...m,name:file.name};renderEditor();toast('Medium hochgeladen. Quiz bitte speichern.');}catch(err){toast(err.message,true);el.disabled=false;}}
  };
  app.onclick=async e=>{const b=e.target.closest('[data-action]');if(!b)return;const i=Number(b.closest('[data-q]')?.dataset.q),q=draft.questions[i];
    try{switch(b.dataset.action){
      case 'back':if(confirm('Editor verlassen? Nicht gespeicherte Änderungen gehen verloren.'))navigate('/');return;
      case 'save':b.disabled=true;await api(draft.id?`/quizzes/${draft.id}`:'/quizzes',{method:draft.id?'PUT':'POST',body:draft});draft=null;toast('Quiz gespeichert.');navigate('/');return;
      case 'add':draft.questions.push(newQuestion());break;
      case 'remove':if(confirm('Diese Frage aus der Vorlage entfernen?'))draft.questions.splice(i,1);break;
      case 'up':[draft.questions[i-1],draft.questions[i]]=[q,draft.questions[i-1]];break;
      case 'down':[draft.questions[i+1],draft.questions[i]]=[q,draft.questions[i+1]];break;
      case 'add-option':q.options.push('');break;
      case 'remove-option':{const j=Number(b.dataset.optionIndex);q.options.splice(j,1);q.correct=q.correct.filter(n=>n!==j).map(n=>n>j?n-1:n);break;}
      case 'remove-media':q.media=null;break;
    }renderEditor();}catch(err){toast(err.message,true);b.disabled=false;}
  };
}
function extraEditor(q){
  if(q.type==='boolean')return `<label>Richtige Antwort<select data-boolean><option value="0" ${q.correct?.[0]===0?'selected':''}>Wahr</option><option value="1" ${q.correct?.[0]===1?'selected':''}>Falsch</option></select></label>`;
  if(q.type==='estimate')return `<div class="fields"><label>Zielwert<input type="number" step="any" data-qfield="target" value="${q.target??0}"></label><label>Toleranz ±<input type="number" min="0" step="any" data-qfield="tolerance" value="${q.tolerance??0}"></label><label>Einheit<input data-qfield="unit" value="${esc(q.unit)}" placeholder="z. B. km"></label></div><p class="muted small">Innerhalb der Toleranz: volle Punkte. Außerhalb: 0 Punkte. Manuell korrigierbar.</p>`;
  if(q.type==='order')return `<label>Einträge in der richtigen Reihenfolge · ein Eintrag pro Zeile<textarea data-lines="options">${esc(q.options.join('\n'))}</textarea></label><p class="muted small">2–8 unterschiedliche Einträge. Die Anzeige wird pro Session gemischt.</p>`;
  if(q.type==='match')return `<label>Richtige Paare · pro Zeile Begriff | Zuordnung<textarea data-lines="pairs" placeholder="Frankreich | Paris\nItalien | Rom">${esc((q.pairs||[]).map(p=>p.left+' | '+p.right).join('\n'))}</textarea></label><p class="muted small">2–8 Paare. Die rechten Begriffe werden gemischt angezeigt.</p>`;
  if(q.type==='hint')return `<label>Hinweise · ein Hinweis pro Zeile<textarea data-lines="hints">${esc((q.hints||[]).join('\n'))}</textarea></label><p class="muted small">Der Moderator deckt die Hinweise einzeln auf. Bewertung manuell.</p>`;
  return '';
}
function board(s){const cs=s.categories||[];return `<section class="category-board"><div class="eyebrow">${s.phase==='lobby'?'Das erwartet euch':'Euer Quizabend'}</div><h2>Kategorien im Überblick</h2><div class="category-grid">${cs.map(c=>`<div class="card category-tile ${c.completed===c.total?'done':''}"><h3>${esc(c.name)}</h3><strong>${c.total-c.completed}</strong><p class="muted">von ${c.total} Fragen offen</p><progress value="${c.completed}" max="${c.total}"></progress></div>`).join('')}</div></section>`;}
function questionExtras(q){return `${q.category?`<span class="badge">${esc(q.category)}</span>`:''}${q.hints?.map((h,i)=>`<div class="notice">Hinweis ${i+1}: ${esc(h)}</div>`).join('')||''}${q.type==='estimate'&&q.target!==undefined?`<p class="solution">Zielwert: ${q.target} ${esc(q.unit)} · Toleranz ±${q.tolerance}</p>`:''}${q.correctOrder?`<div class="solution">${q.correctOrder.map((n,i)=>`${esc(q.labels?.[i]||String(i+1))} → ${esc(q.options[n])}`).join('<br>')}</div>`:''}`;}
function structuredAnswer(q,value,enabled){return `<div>${q.options.map((_,i)=>`<label>${esc(q.labels?.[i]||`Position ${i+1}`)}<select data-arrange="${i}" ${enabled?'':'disabled'}><option value="">Bitte wählen</option>${q.options.map((text,j)=>`<option value="${j}" ${value?.[i]===j?'selected':''}>${esc(text)}</option>`).join('')}</select></label>`).join('')}</div>`;}
function token(id){try{return JSON.parse(localStorage.getItem(`quiz-player-${id}`)||'null')?.token;}catch{return null;}}
async function watch(id,role,key) {
  app.oninput=null;app.onchange=null;app.onclick=null;
  if(role==='player'&&!token(id))return joinForm(id,key);
  const update=async()=>{
    if(key!==routeKey)return;
    try{
      const fresh=await api(`/sessions/${id}?role=${role}`,{headers:role==='player'?{Authorization:`Bearer ${token(id)}`}:{}});
      if(key!==routeKey)return;
      const previous=state;state=fresh;
      if(!previous || previous.revision!==fresh.revision){
        if(role==='admin')renderHost(fresh,previous);
        else if(role==='tv')renderTV(fresh,previous);
        else renderPlayer(fresh,previous);
      }
      const c=$('#connection');if(c)c.innerHTML='<span class="dot"></span> Lokal verbunden';
    }catch(err){if(err.status===404){if(audioElement)audioElement.pause();app.innerHTML=shell('<h1>Diese Session ist nicht mehr verfügbar.</h1><p class="muted">Sie wurde gelöscht oder der Link ist ungültig.</p><a href="/">Zum Dashboard →</a>');return;}if(!state){app.innerHTML=shell(`<h1>Verbindung nicht möglich</h1><p>${esc(err.message)}</p><p class="muted">Erneuter Versuch läuft automatisch …</p>`);}else{const c=$('#connection');if(c)c.innerHTML='<span class="connection">Verbindung unterbrochen · neuer Versuch …</span>';}}
    if(key===routeKey)timer=setTimeout(update,800);
  };await update();
}
async function joinForm(id,key) {
  const s=await api(`/sessions/${id}`);if(key!==routeKey)return;
  app.innerHTML=shell(`<div class="card join-card"><div class="eyebrow">Du bist eingeladen</div><h1>${esc(s.title)}</h1><p class="muted">${s.mode==='team'?'Ein Team. Ein Handy. Gemeinsam zur richtigen Antwort.':'Mach es dir bequem. Gleich geht’s los.'}</p>${s.phase==='lobby'?`<form id="join-form"><label>${s.mode==='team'?'Teamname':'Dein Name'}<input name="name" autocomplete="nickname" maxlength="40" required placeholder="Wie dürfen wir euch nennen?"></label>${avatarPicker()}<button class="primary">Mitspielen →</button></form>`:'<div class="notice">Die Runde hat bereits begonnen. Neue Teilnehmer können nicht mehr beitreten. Für die Wiederverbindung nutze dasselbe Gerät und denselben Browser wie beim Beitritt.</div>'}<p class="muted small">Session ${id}</p></div>`,'player-shell','Mitspielen');
  const form=$('#join-form');if(form)form.onsubmit=async e=>{e.preventDefault();const b=$('button',form);b.disabled=true;try{const p=await post(`/sessions/${id}/join`,{name:new FormData(form).get('name'),avatar:new FormData(form).get('avatar')});localStorage.setItem(`quiz-player-${id}`,JSON.stringify(p));watch(id,'player',key);}catch(err){toast(err.message,true);b.disabled=false;}};
}
function phasebar(s){const n=['open','grading','revealed'].indexOf(s.phase);return `<div class="phasebar" aria-label="${phases[s.phase]}">${[0,1,2].map(i=>`<span class="${i<=n?'active':''}"></span>`).join('')}</div>`;}
function choices(q,selected=[],enabled=false){return `<div class="choices">${q.options.map((v,i)=>`<${enabled?'button':'div'} class="option ${selected.includes(i)?'selected':''} ${q.correct?.includes(i)?'correct':''}" ${enabled?`data-choice="${i}" aria-pressed="${selected.includes(i)}"`:''}><span class="letter">${String.fromCharCode(65+i)}</span><span>${esc(v)}</span>${q.correct?.includes(i)?'<span aria-label="Richtige Antwort">✓</span>':''}</${enabled?'button':'div'}>`).join('')}</div>`;}
function answerText(s,idx,pid){const q=s.quiz.questions[idx],v=s.answers[idx]?.[pid]?.value;return Array.isArray(v)?(v.map((n,i)=>(q.type==='match'?q.pairs[i].left+' → ':'')+q.options[n]).join(' · ')||'Keine Auswahl'):v ?? (['oral','media'].includes(q.type)?'Mündliche Antwort':'Keine Antwort');}
function scoreRows(s,idx,editable){const q=s.quiz.questions[idx],max=q.points??s.quiz.points;return s.participants.map(p=>`<div class="grading-row"><strong>${avatar(p.avatar)}${esc(p.name)}</strong><span class="answer">${esc(answerText(s,idx,p.id))}</span>${editable?`<input aria-label="Punkte für ${esc(p.name)}" class="score-input" data-score="${p.id}" data-index="${idx}" type="number" min="0" max="${max}" step="0.5" placeholder="0–${max}" value="${s.scores[idx]?.[p.id]??''}">${btn('Setzen','score','',`data-pid="${p.id}" data-index="${idx}"`)}<div class="score-shortcuts">${[0,max/2,max].map(n=>btn(`${n} Pkt.`,'quick-score','',`data-pid="${p.id}" data-index="${idx}" data-points="${n}"`)).join('')}</div>`:`<strong>${s.scores[idx]?.[p.id]??'–'} Pkt.</strong>`}</div>`).join('');}
function captureEdits(){return [...app.querySelectorAll('[data-score]')].filter(el=>el.dataset.dirty==='true').map(el=>({pid:el.dataset.score,index:el.dataset.index,value:el.value,focused:el===document.activeElement}));}
function renderHost(s,previous) {
  const edits=captureEdits(),openDetails=[...app.querySelectorAll('details[open]')].map(el=>el.id);
  const oldBase=$('#base-url')?.value,baseFocused=document.activeElement?.id==='base-url';
  const q=s.quiz.questions[s.index],finished=s.phase==='finished';
  app.innerHTML=shell(`<div class="row between"><div><div class="eyebrow">${finished?'Spielarchiv':'Moderation'} / ${s.id}</div><h1>${esc(s.quiz.title)}</h1></div><div class="actions"><a href="/">← Dashboard</a><a href="/tv/${s.id}" target="_blank" rel="noopener"><button>TV / Beamer öffnen ↗</button></a></div></div><div class="spacer"></div><div class="split"><main>
    ${s.phase==='lobby'?`<div class="card"><div class="row between"><h2>Alle da?</h2><span class="badge live">LOBBY OFFEN</span></div><p class="muted">${s.quiz.mode==='team'?'Jedes Team verwendet ein gemeinsames Gerät.':'Jeder spielt auf seinem eigenen Gerät.'} Nach dem Start ist der Beitritt geschlossen.</p>${participants(s.participants)}<div class="spacer"></div><div class="qfields"><label>Spielmodus<select id="play-mode"><option value="digital" ${s.playMode!=='moderated'?'selected':''}>Mit Antwortabgabe</option><option value="moderated" ${s.playMode==='moderated'?'selected':''}>Ohne Antwortabgabe</option></select></label><label>Fragenreihenfolge<select id="ordering"><option value="sequence" ${s.ordering!=='category'?'selected':''}>Reihenfolge der Vorlage</option><option value="category" ${s.ordering==='category'?'selected':''}>Nach Kategorien gruppiert</option></select></label></div>${btn('Einstellungen übernehmen','setup')}${board(s)}${btn('Quiz starten →','start','primary',s.participants.length?'':'disabled')}</div>`:s.phase==='board'?`<div class="card">${board(s)}<p class="muted">${s.index+1} von ${s.quiz.questions.length} Fragen abgeschlossen.</p>${s.index+1<s.quiz.questions.length?btn('Nächste Frage öffnen →','open','primary'):btn('Quiz endgültig beenden','finish','primary')}</div>`:finished?`<div class="card"><div class="eyebrow">Das Ergebnis steht fest</div><h2>Ein Abend. Viele gute Antworten.</h2>${ranking(s.ranking)}<p class="muted small footer">Abgeschlossen am ${new Date(s.finishedAt).toLocaleString('de-DE')}. Antworten und Punkte sind endgültig.</p></div>`:`<div class="card"><div class="row between"><span class="badge live">${phases[s.phase]}</span><span class="muted small">Frage ${s.index+1} / ${s.quiz.questions.length} · ${q.points??s.quiz.points} Punkte</span></div>${phasebar(s)}<div class="question-title">${esc(q.text)}</div>${questionExtras({...q,labels:q.pairs?.map(p=>p.left),hints:q.hints?.slice(0,s.hintsShown||0)})}${q.type==='hint'&&s.phase==='open'?btn('Nächsten Hinweis zeigen','hint','',s.hintsShown>=q.hints.length?'disabled':''):''}${['choice','boolean'].includes(q.type)?choices(q):`<p class="muted">${typeNames[q.type]}</p>`}
    ${s.phase==='open'?`<p class="muted">${Object.values(s.answers[s.index]||{}).filter(a=>Array.isArray(a.value)?a.value.length:a.value).length} / ${s.participants.length} Antworten eingegangen</p>${btn('Antworten schließen','close','primary')}`:''}
    ${s.phase==='grading'?`<h3>Bewertung</h3><p class="muted small">Jeden Teilnehmer bewerten, auch mit 0 Punkten. Maximal ${q.points??s.quiz.points} Punkte.</p>${scoreRows(s,s.index,true)}<div class="spacer"></div>${btn('Lösung aufdecken →','reveal','primary',s.participants.every(p=>s.scores[s.index]?.[p.id]!==undefined)?'':'disabled')}`:''}
    ${s.phase==='revealed'?`<div class="solution">${esc(q.solution)}</div><div class="spacer"></div><div class="actions">${btn(s.showRanking?'Rangliste ausblenden':'Rangliste einblenden','ranking')}${s.boardEnabled?btn('Kategorien anzeigen →','next','primary'):s.index<s.quiz.questions.length-1?btn('Nächste Frage →','next','primary'):btn('Quiz endgültig beenden','finish','primary')}</div>`:''}</div>`}
    ${q?.media&&!finished&&s.phase!=='board'?`<div class="card" style="margin-top:20px"><h3>Medien auf dem TV</h3><p class="muted small">${esc(q.media.name)} · ${s.media.visible?'eingeblendet':'ausgeblendet'}</p><div class="media-controls">${btn(s.media.visible?'Medium ausblenden':'Medium einblenden','media-toggle')}${q.media.type==='audio'?`${btn(s.media.playing?'Pause':'Audio abspielen','media-play')}${btn('Von vorne','media-reset')}`:''}</div>${q.media.type==='audio'?'<p class="muted small">Auf dem TV zuerst einmal „Audio aktivieren“ anklicken. Audio startet nur dort.</p>':''}</div>`:''}
    ${s.index>=0?`<details id="history" ${finished?'open':''}><summary>Antworten & Punkte je Frage${finished?'':' · Korrekturen'}</summary>${s.quiz.questions.slice(0,s.index+(s.phase==='open'?0:1)).map((hq,i)=>`<div class="card archive-question"><h3>${i+1}. ${esc(hq.text)}</h3><p class="muted small">${typeNames[hq.type]} · ${hq.points??s.quiz.points} Punkte</p>${scoreRows(s,i,!finished)}${hq.solution?`<p class="solution">Lösung: ${esc(hq.solution)}</p>`:''}</div>`).join('')}</details>`:''}
    ${s.corrections.length?`<details id="audit"><summary>Bewertungsprotokoll (${s.corrections.length})</summary>${s.corrections.map(c=>`<p class="muted small">${new Date(c.at).toLocaleTimeString('de-DE')} · Frage ${c.index+1} · ${esc(s.participants.find(p=>p.id===c.participantId)?.name)}: ${c.previous??'offen'} → ${c.points} Punkte</p>`).join('')}</details>`:''}
    </main><aside class="side"><div class="card"><div class="eyebrow">${s.quiz.mode==='team'?'Teams':'Spieler'}</div><h2>${s.participants.length} <span class="muted">/ 20 dabei</span></h2>${s.phase==='lobby'?`<img class="qr" src="${qr(s.id)}" alt="QR-Code zum Beitreten"><div class="big-code" style="font-size:22px;text-align:center">${s.id}</div><p class="join-url">${esc(joinLink(s.id))}</p>${btn('Link kopieren','copy','full')}`:participants(s.participants)}</div>
    ${s.phase==='lobby'?`<div class="card"><label>Adresse für Gäste<input id="base-url" value="${esc(baseUrl())}" placeholder="http://192.168.178.20:3000"></label><p class="muted small">Nutze die LAN-IP des Docker-Rechners. „localhost“ funktioniert nur auf diesem Rechner.</p>${btn('Adresse übernehmen','base','full')}<p class="muted small">Erkannte Adressen:<br>${config.addresses.map(esc).join('<br>')||'Keine LAN-Adresse erkannt.'}</p></div>`:!finished?`<div class="card"><h3>Aktueller Punktestand</h3>${ranking(s.ranking)}</div>`:''}</aside></div>`,'shell',finished?'Archiv':'Spielleitung');
  openDetails.forEach(id=>{const el=$(`#${id}`);if(el)el.open=true;});
  for(const e of edits){const el=$(`[data-score="${e.pid}"][data-index="${e.index}"]`);if(el){el.value=e.value;el.dataset.dirty='true';if(e.focused)el.focus();}}
  if(oldBase!==undefined&&$('#base-url')){$('#base-url').value=oldBase;if(baseFocused)$('#base-url').focus();}
  app.oninput=e=>{if(e.target.dataset.score)e.target.dataset.dirty='true';};
  app.onclick=async e=>{
    const b=e.target.closest('[data-action]');if(!b || busy)return;const action=b.dataset.action;
    try{
      if(action==='copy'){try{await navigator.clipboard.writeText(joinLink(s.id));toast('Einladungslink kopiert.');}catch{prompt('Einladungslink kopieren:',joinLink(s.id));}return;}
      if(action==='base'){const u=new URL($('#base-url').value);if(!['http:','https:'].includes(u.protocol))throw new Error('Bitte eine HTTP-Adresse eingeben.');localStorage.setItem('quiz-base-url',u.origin);renderHost(state);toast('Adresse für QR-Codes gespeichert.');return;}
      if(action==='finish'&&!confirm('Quiz endgültig beenden? Danach sind auch Punktekorrekturen nicht mehr möglich.'))return;
      const payload={action,revision:state.revision};
      if(action==='setup')Object.assign(payload,{playMode:$('#play-mode').value,ordering:$('#ordering').value});
      if(action==='start' && ($('#play-mode').value!==(state.playMode||'digital') || $('#ordering').value!==(state.ordering||'sequence'))){const configured=await post(`/sessions/${s.id}/action`,{action:'setup',revision:state.revision,playMode:$('#play-mode').value,ordering:$('#ordering').value});state=configured;payload.revision=configured.revision;}
      let scoreInput;
      if(action==='quick-score'){scoreInput=$('[data-score]',b.closest('.grading-row'));Object.assign(payload,{action:'score',index:Number(b.dataset.index),participantId:b.dataset.pid,points:Number(b.dataset.points)});}
      if(action==='score'){scoreInput=$(`[data-score="${b.dataset.pid}"][data-index="${b.dataset.index}"]`,b.closest('.grading-row'));if(scoreInput.value==='')throw new Error('Bitte eine Punktzahl eingeben.');Object.assign(payload,{index:Number(b.dataset.index),participantId:b.dataset.pid,points:Number(scoreInput.value)});}
      if(action.startsWith('media-')){const m=state.media;const position=m.position+(m.playing?(Date.now()-m.changedAt)/1000:0);Object.assign(payload,{action:'media',visible:action==='media-toggle'?!m.visible:true,playing:action==='media-play'?!m.playing:action==='media-reset'?false:m.playing,position:action==='media-reset'?0:position});if(!payload.visible)payload.playing=false;}
      busy=true;b.disabled=true;const fresh=await post(`/sessions/${s.id}/action`,payload);if(scoreInput)scoreInput.dataset.dirty='false';state=fresh;renderHost(fresh);if(action==='score')toast('Punkte gespeichert.');
    }catch(err){toast(err.message,true);b.disabled=false;}finally{busy=false;}
  };
}
function renderPlayer(s,previous) {
  // Preserve typing and selection during background updates within the same open question.
  if(previous && previous.index===s.index && previous.phase===s.phase && s.phase==='open'){const hints=$('#live-hints');if(hints)hints.innerHTML=(s.question.hints||[]).map((h,i)=>`<div class="notice">Hinweis ${i+1}: ${esc(h)}</div>`).join('');return;}
  const q=s.question;
  app.innerHTML=shell(`<div class="row between"><span class="eyebrow">${avatar(s.participant.avatar)}${esc(s.participant.name)}</span><span class="badge">${s.mode==='team'?'TEAM':'SPIELER'}</span></div>
    ${s.phase==='lobby'?`<div class="card"><div class="eyebrow">Du bist dabei</div><h1>${esc(s.title)}</h1><p class="muted">Mach es dir bequem. Der Moderator startet die Runde.</p>${participants(s.participants)}${board(s)}</div>`:s.phase==='board'?board(s):s.showRanking?`<div class="card"><div class="eyebrow">${s.phase==='finished'?'Endergebnis':'Zwischenstand'}</div><h1>${s.phase==='finished'?'Danke fürs Mitspielen!':'So steht’s gerade.'}</h1>${ranking(s.ranking)}</div>`:`<div class="card"><div class="row between"><span class="badge live">${phases[s.phase]}</span><span class="muted small">${s.index+1} / ${s.total} · ${q.points} Punkte</span></div>${phasebar(s)}<h1 class="question-title">${esc(q.text)}</h1>${q.category?`<span class="badge">${esc(q.category)}</span>`:''}<div id="live-hints">${(q.hints||[]).map((h,i)=>`<div class="notice">Hinweis ${i+1}: ${esc(h)}</div>`).join('')}</div>${playerQuestion(s,q)}
    ${s.phase==='open'&&q.canAnswer?`<p id="save-state" class="saving small" aria-live="polite">${s.answer?'Antwort gespeichert. Änderungen sind noch möglich.':q.type==='choice'?'Auswahl wird automatisch gespeichert.':q.type==='text'?'Du kannst deine Antwort bis zum Schließen ändern.':''}</p>`:s.phase==='open'?'<div class="notice">Ihr antwortet mündlich. Der Moderator vergibt die Punkte.</div>':s.phase==='grading'?'<div class="notice">Antworten geschlossen. Der Moderator bewertet gerade.</div>':`<div class="notice">${s.points??0} von ${q.points} Punkten für euch.</div><div class="solution">${esc(q.solution)}</div>`}</div>`}<p class="muted small footer">${esc(s.title)} · Session ${s.id}</p>`,'player-shell','Mitspielen');
  app.onclick=async e=>{const choice=e.target.closest('[data-choice]'),b=e.target.closest('[data-action="save-answer"]');if((!choice&&!b)||busy)return;
    let value;
    if(choice){const selected=[...app.querySelectorAll('.option.selected')].map(el=>Number(el.dataset.choice));const i=Number(choice.dataset.choice);value=q.multiple?(selected.includes(i)?selected.filter(v=>v!==i):[...selected,i]):[i];}
    else if(['order','match'].includes(q.type)){const inputs=[...app.querySelectorAll('[data-arrange]')];if(inputs.some(el=>el.value===''))return toast('Bitte alle Positionen zuordnen.',true);value=inputs.map(el=>Number(el.value));}else if(q.type==='estimate'){if($('#answer-text').value==='')return toast('Bitte eine Zahl eingeben.',true);value=Number($('#answer-text').value);}else value=$('#answer-text').value;
    busy=true;if(b)b.disabled=true;const status=$('#save-state');status.textContent='Wird gespeichert …';
    try{const result=await post(`/sessions/${s.id}/answer`,{index:s.index,value},{Authorization:`Bearer ${token(s.id)}`});if(state.index===s.index&&state.phase==='open'){if(choice){for(const el of app.querySelectorAll('[data-choice]')){const selected=result.value.includes(Number(el.dataset.choice));el.classList.toggle('selected',selected);el.setAttribute('aria-pressed',String(selected));}}status.textContent='Gespeichert ✓ Änderungen sind noch möglich.';}}
    catch(err){toast(err.message,true);status.textContent='Nicht gespeichert. Bitte erneut versuchen.';}finally{busy=false;if(b)b.disabled=false;}
  };
}
function playerQuestion(s,q){
  const enabled=s.phase==='open'&&q.canAnswer;
  let html='';
  if(['choice','boolean'].includes(q.type))html=choices(q,s.answer?.value||[],enabled);
  else if(['order','match'].includes(q.type))html=q.canAnswer?structuredAnswer(q,s.answer?.value,enabled):`<div class="card">${q.labels?`<p>${q.labels.map(esc).join(' · ')}</p>`:''}<p>${q.options.map(esc).join(' · ')}</p></div>`;
  else if(q.canAnswer)html=q.type==='estimate'?`<label>Deine Antwort (${esc(q.unit||'Zahl')})<input type="number" step="any" id="answer-text" ${enabled?'':'disabled'} value="${esc(s.answer?.value??'')}"></label>`:`<label>Deine Antwort<textarea id="answer-text" maxlength="4000" ${enabled?'':'disabled'}>${esc(s.answer?.value||'')}</textarea></label>`;
  if(enabled&&!['choice','boolean'].includes(q.type))html+=btn('Antwort speichern','save-answer','primary');
  if(s.phase==='revealed')html+=questionExtras({...q,hints:[],category:null});
  return html;
}
function renderTV(s,previous) {
  const q=s.question;
  const transitionKey=v=>v?`${v.phase}:${v.index}:${!!v.showRanking}`:'';
  const animate=transitionKey(s)!==transitionKey(previous);
  // Keep the audio DOM node alive across polls to avoid restarting playback.
  if(audioElement)audioElement.remove();
  app.innerHTML=shell(s.phase==='lobby'?`<section class="tv-lobby"><div><div class="eyebrow">Willkommen zum Quizabend</div><h1>${esc(s.title)}</h1><p class="muted">Handy raus. Code scannen. Miträtseln.</p><div class="spacer"></div>${participants(s.participants)}${board(s)}</div><div class="card"><img class="qr" src="${qr(s.id)}" alt="QR-Code zur Spielrunde"><p class="join-url">${esc(joinLink(s.id))}</p><div class="big-code">${s.id}</div></div></section>`:s.phase==='board'?board(s):s.showRanking?`<div class="eyebrow">${s.phase==='finished'?'Ein großartiger Abend':'Zwischenstand'}</div><h1>${s.phase==='finished'?'Das ist euer Endergebnis.':'Wer liegt vorn?'}</h1><div class="card">${ranking(s.ranking)}</div>`:`<div class="row between"><span class="badge live">${phases[s.phase]}</span><span class="muted">Frage ${s.index+1} / ${s.total} · ${q.points} Punkte</span></div><h1 class="question-title">${esc(q.text)}</h1>${q.media?.type==='image'?`<img class="tv-media" src="/uploads/${q.media.id}" alt="Bild zur Quizfrage">`:''}<div id="audio-slot"></div>${questionExtras(q)}${['choice','boolean'].includes(q.type)?choices(q):['order','match'].includes(q.type)?`<div class="card">${q.options.map((v,i)=>`<p>${esc(q.labels?.[i]||String(i+1))} · ${esc(v)}</p>`).join('')}</div>`:''}${s.phase==='grading'?'<div class="notice">Antworten geschlossen. Die Punkte werden vergeben.</div>':''}${s.phase==='revealed'?`<div class="solution question-title">${esc(q.solution)}</div>`:''}`,'tv-shell','Gemeinsam rätseln');
  if(animate)$('.tv-stage').classList.add('is-entering');
  else if((q?.hints?.length||0)>(previous?.question?.hints?.length||0))$('.tv-stage .notice:last-of-type')?.classList.add('hint-entering');
  if(q?.media?.type==='audio' && !s.showRanking){
    if(mediaKey!==q.media.id){if(audioElement)audioElement.pause();audioElement=document.createElement('audio');audioElement.src=`/uploads/${q.media.id}`;audioElement.preload='auto';mediaKey=q.media.id;}
    $('#audio-slot').append(audioElement);
    $('#audio-slot').insertAdjacentHTML('beforeend',`<p class="muted">♫ ${s.media.playing?'Audio läuft':'Audio bereit'}</p>`);
    syncAudio(s);
  }else if(audioElement)audioElement.pause();
  if(!audioEnabled){app.insertAdjacentHTML('beforeend',btn('♫ Audio auf diesem Bildschirm aktivieren','enable-audio','tv-enable'));}
  app.onclick=async e=>{if(e.target.closest('[data-action="enable-audio"]')){
    try{const ctx=new (window.AudioContext||window.webkitAudioContext)();await ctx.resume();await ctx.close();audioEnabled=true;e.target.remove();if(audioElement){await audioElement.play();syncAudio(state);}toast('TV-Audio aktiviert.');}catch{toast('Audio bitte bei der Medienfrage erneut aktivieren.',true);audioEnabled=false;}
  }};
}
function syncAudio(s){if(!audioElement)return;const audio=audioElement;
  const apply=()=>{if(audio!==audioElement)return;const target=s.media.position+(s.media.playing?(Date.now()-s.media.changedAt)/1000:0);if(Number.isFinite(audio.duration))audio.currentTime=Math.min(target,Math.max(0,audio.duration-.05));if(s.media.playing&&audioEnabled)audio.play().catch(()=>{audioEnabled=false;toast('Bitte Audio auf dem TV aktivieren.',true);if(!$('[data-action="enable-audio"]'))app.insertAdjacentHTML('beforeend',btn('♫ Audio aktivieren','enable-audio','tv-enable'));});else audio.pause();};
  if(audio.readyState>=1)apply();else audio.onloadedmetadata=apply;
}
route();
