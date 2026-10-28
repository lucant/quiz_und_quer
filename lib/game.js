import { randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export class GameError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export function assert(ok, message, status = 400) { if (!ok) throw new GameError(message, status); }
const clean = (v, max = 300) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const finite = (n) => typeof n === 'number' && Number.isFinite(n);
export const AVATARS = ['pawn','car','hat','dog','ship','shoe','cat','duck','rocket','bicycle'];
const digital = (s,q) => (s.playMode || 'digital') === 'digital' && (q.answerMode || (['oral','media'].includes(q.type)?'oral':'digital')) === 'digital';
const category = q => q.category || 'Allgemein';
function shuffle(values) { return values.map(v=>({v,key:randomBytes(4).readUInt32LE()})).sort((a,b)=>a.key-b.key).map(x=>x.v); }
export function categories(s) {
  return [...new Set(s.quiz.questions.map(category))].map(name=>({name,total:s.quiz.questions.filter(q=>category(q)===name).length,
    completed:s.quiz.questions.filter((q,i)=>category(q)===name && (i<s.index || i===s.index && ['revealed','board','finished'].includes(s.phase))).length}));
}

export function validateQuiz(input) {
  const title = clean(input.title, 120);
  assert(title, 'Bitte einen Quiznamen eingeben.');
  assert(['single', 'team'].includes(input.mode), 'Ungültiger Spielmodus.');
  assert(finite(input.points) && input.points > 0 && input.points <= 1000, 'Grundpunkte müssen zwischen 0 und 1000 liegen (größer als 0).');
  assert(Array.isArray(input.questions) && input.questions.length <= 200, 'Maximal 200 Fragen pro Quiz.');
  const questions = input.questions.map((q, i) => {
    assert(['choice', 'text', 'oral', 'open', 'media','boolean','estimate','order','match','hint'].includes(q.type), `Frage ${i + 1}: Ungültiger Typ.`);
    const type = ['text','oral'].includes(q.type) ? 'open' : q.type;
    const answerMode = q.answerMode || (['oral','media'].includes(q.type)?'oral':'digital');
    assert(['oral','digital'].includes(answerMode),'Ungültige Antwortart.');
    const text = clean(q.text, 4000);
    assert(text, `Frage ${i + 1}: Fragetext fehlt.`);
    const points = q.points === null || q.points === '' || q.points === undefined ? null : q.points;
    assert(points === null || (finite(points) && points > 0 && points <= 1000), `Frage ${i + 1}: Ungültige Punkte.`);
    const options = ['choice','order'].includes(type) && Array.isArray(q.options) ? q.options.map(v => clean(v, 500)) : type==='boolean'?['Wahr','Falsch']:[];
    const correct = ['choice','boolean'].includes(type) && Array.isArray(q.correct) ? [...new Set(q.correct)].sort((a,b)=>a-b) : [];
    if(type==='boolean') assert(correct.length===1 && [0,1].includes(correct[0]),`Frage ${i+1}: Wahr oder Falsch als Lösung wählen.`);
    if(type==='order') assert(options.length>=2 && options.length<=8 && options.every(Boolean) && new Set(options).size===options.length,'Reihenfolge: 2–8 unterschiedliche Einträge erforderlich.');
    const pairs=type==='match' && Array.isArray(q.pairs)?q.pairs.map(p=>({left:clean(p.left,500),right:clean(p.right,500)})):[];
    if(type==='match') assert(pairs.length>=2 && pairs.length<=8 && pairs.every(p=>p.left&&p.right) && new Set(pairs.map(p=>p.right)).size===pairs.length,'Zuordnung: 2–8 vollständige Paare mit unterschiedlichen rechten Begriffen erforderlich.');
    const hints=type==='hint' && Array.isArray(q.hints)?q.hints.map(h=>clean(h,1000)):[];
    if(type==='hint') assert(hints.length>=1 && hints.length<=10 && hints.every(Boolean),'Bitte 1–10 ausgefüllte Hinweise anlegen.');
    if(type==='estimate') assert(finite(q.target) && finite(q.tolerance) && q.tolerance>=0,'Schätzfrage: Zielwert und nichtnegative Toleranz erforderlich.');
    if (q.type === 'choice') {
      assert(options.length >= 2 && options.length <= 8 && options.every(Boolean), `Frage ${i+1}: Zwei bis acht ausgefüllte Optionen erforderlich.`);
      assert(correct.length > 0 && correct.every(n => Number.isInteger(n) && n >= 0 && n < options.length), `Frage ${i+1}: Richtige Antworten markieren.`);
      assert(q.multiple || correct.length === 1, `Frage ${i+1}: Nur eine richtige Antwort erlaubt.`);
    }
    const media = q.media ? { id: clean(q.media.id, 100), type: q.media.type, name: clean(q.media.name, 180) } : null;
    assert(!media || (/^[a-f0-9-]+\.(png|jpg|webp|gif|mp3|wav|ogg|m4a)$/.test(media.id) && ['image', 'audio'].includes(media.type)), 'Ungültiges Medium.');
    assert(q.type !== 'media' || media, `Frage ${i+1}: Bitte ein Bild oder Audio hochladen.`);
    return { id: randomUUID(), type, answerMode, category:clean(q.category,60)||'Allgemein', text, points, options, correct, multiple: type==='choice' && !!q.multiple, solution: clean(q.solution, 4000), media, pairs, hints, ...(type==='estimate'?{target:q.target,tolerance:q.tolerance,unit:clean(q.unit,40)}:{}) };
  });
  return { title, mode: input.mode, points: input.points, questions };
}

export class GameStore {
  constructor(filename) {
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS quizzes (id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, data TEXT NOT NULL);');
  }
  close() { this.db.close(); }
  list(table) { return this.db.prepare(`SELECT data FROM ${table}`).all().map(r => JSON.parse(r.data)); }
  get(table, id) {
    const row = this.db.prepare(`SELECT data FROM ${table} WHERE id = ?`).get(id);
    assert(row, table === 'quizzes' ? 'Quiz nicht gefunden.' : 'Session nicht gefunden.', 404);
    return JSON.parse(row.data);
  }
  put(table, value) { this.db.prepare(`INSERT OR REPLACE INTO ${table} (id,data) VALUES (?,?)`).run(value.id, JSON.stringify(value)); return value; }
  delete(table,id,confirmed) {
    assert(['quizzes','sessions'].includes(table),'Ungültiger Datentyp.');
    assert(confirmed===true,'Das Löschen muss ausdrücklich bestätigt werden.');
    this.get(table,id);
    this.db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
    return {deleted:true};
  }
  saveQuiz(input, id) {
    if (id) this.get('quizzes', id);
    return this.put('quizzes', { ...validateQuiz(input), id: id || randomUUID(), updatedAt: new Date().toISOString() });
  }
  createSession(quizId) {
    const quiz = this.get('quizzes', quizId);
    assert(quiz.questions.length, 'Das Quiz braucht mindestens eine Frage.');
    let id;
    do { id = randomBytes(4).toString('hex').toUpperCase(); } while(this.db.prepare('SELECT id FROM sessions WHERE id=?').get(id));
    for(const q of quiz.questions) {
      if(q.type==='order') {const original=[...q.options];q.options=shuffle(q.options);q.correctOrder=original.map(x=>q.options.indexOf(x));}
      if(q.type==='match') {q.options=shuffle(q.pairs.map(p=>p.right));q.correctOrder=q.pairs.map(p=>q.options.indexOf(p.right));}
    }
    return this.put('sessions', { id, quiz, boardEnabled:true, playMode:'digital', ordering:'sequence', hintsShown:0, phase: 'lobby', index: -1, revision: 0, participants: [], answers: {}, scores: {}, corrections: [], showRanking: false, media: { visible: false, playing: false, position: 0, changedAt: Date.now() }, createdAt: new Date().toISOString() });
  }
  commit(s) { s.revision++; return this.put('sessions', s); }
  join(id, input) {
    const s = this.get('sessions', id);
    assert(s.phase === 'lobby', 'Die Runde läuft bereits. Nur bestehende Teilnehmer können zurückkehren.', 409);
    const name = clean(input.name, 40);
    const avatar=input.avatar || 'pawn';assert(AVATARS.includes(avatar),'Bitte einen verfügbaren Avatar wählen.');
    assert(name, 'Bitte einen Namen eingeben.');
    assert(s.participants.length < 20, 'Diese Runde ist mit 20 Teilnehmergeräten voll.');
    assert(!s.participants.some(p => p.name.toLocaleLowerCase('de') === name.toLocaleLowerCase('de')), 'Dieser Name ist bereits vergeben.');
    const p = { id: randomUUID(), name, avatar, token: randomBytes(32).toString('hex') };
    s.participants.push(p); this.commit(s);
    return p;
  }
  participant(s, token) { const p = s.participants.find(p => p.token === token); assert(p, 'Bitte über den Session-Link beitreten.', 401); return p; }
  answer(id, token, input) {
    const s = this.get('sessions', id); const p = this.participant(s, token);
    assert(s.phase === 'open' && input.index === s.index, 'Die Antwortphase dieser Frage ist geschlossen.', 409);
    const q = s.quiz.questions[s.index];
    assert(digital(s,q),'Für diese Frage ist keine digitale Antwortabgabe vorgesehen.',409);
    let value;
    if (['choice','boolean'].includes(q.type)) {
      assert(Array.isArray(input.value), 'Ungültige Antwort.');
      value = [...new Set(input.value)].sort((a,b)=>a-b);
      assert(value.every(v => Number.isInteger(v) && v >= 0 && v < q.options.length) && (q.multiple || value.length <= 1), 'Ungültige Auswahl.');
    } else if(q.type==='estimate') {
      assert(finite(input.value),'Bitte eine endliche Zahl eingeben.');value=input.value;
    } else if(['order','match'].includes(q.type)) {
      value=input.value;assert(Array.isArray(value)&&value.length===q.options.length&&new Set(value).size===value.length&&value.every(v=>Number.isInteger(v)&&v>=0&&v<q.options.length),'Bitte jeden Eintrag genau einmal zuordnen.');
    } else {
      assert(['text','open','hint','media'].includes(q.type), 'Diese Frage wird mündlich durch den Moderator bewertet.');
      assert(typeof input.value === 'string' && input.value.length <= 4000, 'Maximal 4000 Zeichen.');
      value = input.value.trim();
    }
    (s.answers[s.index] ??= {})[p.id] = { value, savedAt: new Date().toISOString() };
    this.commit(s); return { saved: true, value };
  }
  action(id, input) {
    const s = this.get('sessions', id);
    assert(input.revision === s.revision, 'Der Spielstand hat sich geändert. Bitte Aktion erneut ausführen.', 409);
    assert(s.phase !== 'finished', 'Das Quiz ist beendet und unveränderlich.', 409);
    const q = s.quiz.questions[s.index];
    switch(input.action) {
      case 'setup':
        assert(s.phase==='lobby','Einstellungen nur vor dem Start möglich.');
        assert(['digital','moderated'].includes(input.playMode)&&['sequence','category'].includes(input.ordering),'Ungültige Spieleinstellungen.');
        s.playMode=input.playMode;s.ordering=input.ordering;break;
      case 'start':
        assert(s.phase === 'lobby' && s.participants.length, 'Start nur aus der Lobby mit mindestens einem Teilnehmer.');
        if(s.ordering==='category') {const names=[...new Set(s.quiz.questions.map(category))];s.quiz.questions.sort((a,b)=>names.indexOf(category(a))-names.indexOf(category(b)));}
        s.index = s.boardEnabled?-1:0; s.phase = s.boardEnabled?'board':'open'; break;
      case 'open':
        assert(s.boardEnabled && s.phase==='board' && s.index+1<s.quiz.questions.length,'Nächste Frage kann nur vom Kategorienbrett geöffnet werden.');
        s.index++;s.phase='open';s.showRanking=false;s.hintsShown=0;break;
      case 'hint':
        assert(s.phase==='open' && q?.type==='hint' && (s.hintsShown||0)<q.hints.length,'Kein weiterer Hinweis verfügbar.');s.hintsShown=(s.hintsShown||0)+1;break;
      case 'close':
        assert(s.phase === 'open', 'Antwortphase ist nicht geöffnet.', 409);
        s.phase = 'grading'; s.scores[s.index] = {};
        if (digital(s,q) && ['choice','boolean','estimate','order','match'].includes(q.type)) for (const p of s.participants) {
          const value = s.answers[s.index]?.[p.id]?.value;
          const right=q.type==='estimate'?finite(value)&&Math.abs(value-q.target)<=q.tolerance:Array.isArray(value)&&JSON.stringify(value)===JSON.stringify(['order','match'].includes(q.type)?q.correctOrder:q.correct);
          s.scores[s.index][p.id] = right ? (q.points ?? s.quiz.points) : 0;
        }
        break;
      case 'score': {
        assert(['grading','revealed','open','board'].includes(s.phase), 'Bewertung hier nicht möglich.');
        const idx = input.index;
        assert(Number.isInteger(idx) && idx >= 0 && idx <= s.index && (idx < s.index || s.phase !== 'open'), 'Frage noch nicht geschlossen.');
        assert(s.participants.some(p => p.id === input.participantId), 'Teilnehmer nicht gefunden.');
        const max = s.quiz.questions[idx].points ?? s.quiz.points;
        assert(finite(input.points) && input.points >= 0 && input.points <= max, `Punkte müssen zwischen 0 und ${max} liegen.`);
        const previous = s.scores[idx]?.[input.participantId];
        (s.scores[idx] ??= {})[input.participantId] = input.points;
        s.corrections.push({ index: idx, participantId: input.participantId, previous: previous ?? null, points: input.points, at: new Date().toISOString() });
        break;
      }
      case 'reveal':
        assert(s.phase === 'grading', 'Frage muss zuerst geschlossen werden.');
        assert(s.participants.every(p => finite(s.scores[s.index]?.[p.id])), 'Bitte zuerst alle Teilnehmer bewerten, auch mit 0 Punkten.');
        s.phase = 'revealed'; break;
      case 'next':
        assert(s.phase === 'revealed' && (s.boardEnabled || s.index + 1 < s.quiz.questions.length), 'Nächste Frage ist noch nicht verfügbar.');
        if(!s.boardEnabled)s.index++; s.phase = s.boardEnabled?'board':'open'; s.showRanking = false; break;
      case 'finish':
        assert(s.phase === (s.boardEnabled?'board':'revealed') && s.index === s.quiz.questions.length - 1, 'Zuerst alle Fragen abschließen und das Kategorienbrett anzeigen.');
        s.phase = 'finished'; s.finishedAt = new Date().toISOString(); s.showRanking = true; break;
      case 'ranking':
        assert(s.phase === 'revealed', 'Rangliste kann nach der Auflösung eingeblendet werden.');
        s.showRanking = !s.showRanking; break;
      case 'media':
        assert(q?.media && ['open','grading','revealed'].includes(s.phase), 'Keine Medien für diese Frage vorhanden.');
        assert(finite(input.position) && input.position >= 0 && input.position <= 86400, 'Ungültige Wiedergabeposition.');
        s.media = { visible: !!input.visible, playing: !!input.playing, position: input.position, changedAt: Date.now() }; break;
      default: throw new GameError('Unbekannte Aktion.');
    }
    if (['start','open','next','finish'].includes(input.action)) s.media = { visible: false, playing: false, position: 0, changedAt: Date.now() };
    return this.commit(s);
  }
  view(id, role, token) {
    const s = this.get('sessions', id);
    if (role === 'admin') return { ...s, categories:categories(s), participants: s.participants.map(({token, ...p})=>p), ranking: this.ranking(s) };
    const p = role === 'player' ? this.participant(s, token) : null;
    const revealed = ['revealed','finished'].includes(s.phase);
    const original = s.phase==='board'?null:s.quiz.questions[s.index];
    const question = original ? { text: original.text, type: original.type, category:category(original), answerMode:original.answerMode, canAnswer:digital(s,original), unit:original.unit, hints:original.hints?.slice(0,revealed?original.hints.length:s.hintsShown||0), labels:original.pairs?.map(p=>p.left), options: original.options, multiple: original.multiple, points: original.points ?? s.quiz.points,
      ...(role === 'tv' && s.media.visible ? {media: original.media} : {}),
      ...(revealed ? { correct: original.correct, correctOrder:original.correctOrder, target:original.target,tolerance:original.tolerance, solution: original.solution } : {}) } : null;
    return { id: s.id, title: s.quiz.title, mode: s.quiz.mode, playMode:s.playMode||'digital',categories:categories(s), phase: s.phase, index: s.index, revision: s.revision, total: s.quiz.questions.length,
      participants: s.participants.map(({id,name,avatar})=>({id,name,avatar:avatar||'pawn'})), question, media: role === 'tv' ? s.media : undefined,
      showRanking: s.showRanking, ranking: s.showRanking ? this.ranking(s) : null,
      participant: p ? {id:p.id,name:p.name,avatar:p.avatar||'pawn'} : null, answer: p ? s.answers[s.index]?.[p.id] : undefined,
      points: p && revealed ? s.scores[s.index]?.[p.id] : undefined };
  }
  ranking(s) {
    return s.participants.map(p => ({ id:p.id, name:p.name, avatar:p.avatar||'pawn', points: Object.values(s.scores).reduce((sum,row)=>sum+(row[p.id] ?? 0),0) })).sort((a,b)=>b.points-a.points || a.name.localeCompare(b.name,'de'));
  }
}
