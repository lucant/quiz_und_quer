import http from 'node:http';
import { mkdirSync, existsSync, readFileSync, writeFileSync, statSync, createReadStream } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { randomUUID } from 'node:crypto';
import QRCode from 'qrcode';
import { GameStore, assert } from './lib/game.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.png':'image/png', '.jpg':'image/jpeg', '.webp':'image/webp', '.gif':'image/gif', '.mp3':'audio/mpeg', '.wav':'audio/wav', '.ogg':'audio/ogg', '.m4a':'audio/mp4' };
export function createApp({ dataDir = process.env.DATA_DIR || join(root,'data'), publicUrl = process.env.PUBLIC_URL || '' } = {}) {
  mkdirSync(join(dataDir,'uploads'), {recursive:true});
  const store = new GameStore(join(dataDir,'quiz.sqlite'));
  function send(res, status, value, type = 'application/json; charset=utf-8') {
    res.writeHead(status, { 'Content-Type':type, 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' });
    res.end(type.startsWith('application/json') ? JSON.stringify(value) : value);
  }
  async function body(req, limit = 2 * 1024 * 1024, raw = false) {
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; assert(size <= limit, `Upload zu groß (maximal ${limit / 1024 / 1024} MB).`, 413); chunks.push(chunk); }
    const buffer = Buffer.concat(chunks);
    if (raw) return buffer;
    try { const value = JSON.parse(buffer.toString() || '{}'); assert(value && typeof value === 'object' && !Array.isArray(value), 'Ungültige Eingabe.'); return value; }
    catch { assert(false, 'Ungültiges JSON.'); }
  }
  function file(req,res,path) {
    assert(existsSync(path), 'Datei nicht gefunden.', 404);
    const size = statSync(path).size;
    const headers = {'Content-Type': types[extname(path)] || 'application/octet-stream', 'X-Content-Type-Options':'nosniff', 'Accept-Ranges':'bytes', 'Cache-Control':'no-cache'};
    const range = req.headers.range;
    if (range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(range);
      assert(match, 'Ungültiger Bytebereich.',416);
      const start = Number(match[1]), end = match[2] ? Math.min(Number(match[2]),size-1) : size-1;
      assert(start <= end && start < size, 'Ungültiger Bytebereich.',416);
      res.writeHead(206,{...headers,'Content-Range':`bytes ${start}-${end}/${size}`,'Content-Length':end-start+1});
      createReadStream(path,{start,end}).pipe(res);
    } else { res.writeHead(200,{...headers,'Content-Length':size}); createReadStream(path).pipe(res); }
  }
  const server = http.createServer(async(req,res)=>{
    try {
      const url = new URL(req.url, 'http://localhost'); const path = url.pathname; const method = req.method;
      // No CORS: writes must originate from this local app, even without passwords.
      if (['POST','PUT','DELETE'].includes(method) && req.headers.origin) {
        assert(new URL(req.headers.origin).host === req.headers.host, 'Fremder Ursprung nicht erlaubt.', 403);
      }
      if (path === '/api/health') return send(res,200,{ok:true});
      if (path === '/api/config') {
        const port = server.address().port;
        const addresses = Object.values(networkInterfaces()).flat().filter(a=>a.family==='IPv4' && !a.internal).map(a=>`http://${a.address}:${port}`);
        return send(res,200,{publicUrl, addresses});
      }
      if (path === '/api/quizzes' && method === 'GET') return send(res,200,store.list('quizzes'));
      if (path === '/api/quizzes' && method === 'POST') return send(res,201,store.saveQuiz(await body(req)));
      let m = path.match(/^\/api\/quizzes\/([\w-]+)$/);
      if (m && method === 'PUT') return send(res,200,store.saveQuiz(await body(req),m[1]));
      if (m && method === 'DELETE') return send(res,200,store.delete('quizzes',m[1],(await body(req)).confirm));
      if (path === '/api/sessions' && method === 'GET') return send(res,200,store.list('sessions').map(s=>({id:s.id,title:s.quiz.title,phase:s.phase,createdAt:s.createdAt,participants:s.participants.length})));
      if (path === '/api/sessions' && method === 'POST') return send(res,201,store.view(store.createSession((await body(req)).quizId).id,'admin'));
      m = path.match(/^\/api\/sessions\/([A-F0-9]{8})(?:\/(join|answer|action|qr))?$/);
      if (m) {
        const id=m[1], action=m[2];
        if (method==='DELETE' && !action) return send(res,200,store.delete('sessions',id,(await body(req)).confirm));
        if (action === 'qr' && method === 'GET') {
          store.get('sessions',id);
          const base = url.searchParams.get('base') || publicUrl || `http://${req.headers.host}`;
          const parsed = new URL(base); assert(['http:','https:'].includes(parsed.protocol), 'Ungültige Adresse.');
          const svg = await QRCode.toString(`${parsed.origin}/join/${id}`,{type:'svg',margin:2,width:250,color:{dark:'#141719',light:'#ffffff'}});
          return send(res,200,svg,'image/svg+xml');
        }
        if (method === 'GET' && !action) {
          const role=url.searchParams.get('role') || 'tv'; assert(['admin','tv','player'].includes(role),'Ungültige Ansicht.');
          return send(res,200,store.view(id,role,req.headers.authorization?.replace(/^Bearer /,'')));
        }
        if (method === 'POST') {
          const input = await body(req);
          if (action === 'join') return send(res,201,store.join(id,input));
          if (action === 'answer') return send(res,200,store.answer(id,req.headers.authorization?.replace(/^Bearer /,''),input));
          if (action === 'action') { store.action(id,input); return send(res,200,store.view(id,'admin')); }
        }
      }
      if (path === '/api/uploads' && method === 'POST') {
        const data = await body(req,20*1024*1024,true);
        let ext;
        if (data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) ext='png';
        else if (data[0]===255 && data[1]===216 && data[2]===255) ext='jpg';
        else if (['GIF87a','GIF89a'].includes(data.toString('ascii',0,6))) ext='gif';
        else if (data.toString('ascii',0,4)==='RIFF' && data.toString('ascii',8,12)==='WEBP') ext='webp';
        else if (data.toString('ascii',0,4)==='RIFF' && data.toString('ascii',8,12)==='WAVE') ext='wav';
        else if (data.toString('ascii',0,4)==='OggS') ext='ogg';
        else if (data.toString('ascii',0,3)==='ID3' || (data[0]===255 && (data[1]&224)===224)) ext='mp3';
        else if (data.toString('ascii',4,8)==='ftyp' && ['M4A ','isom','mp42'].includes(data.toString('ascii',8,12))) ext='m4a';
        assert(ext,'Unterstützt: PNG, JPG, GIF, WebP, MP3, WAV, OGG, M4A.');
        const id = `${randomUUID()}.${ext}`; writeFileSync(join(dataDir,'uploads',id),data);
        return send(res,201,{id,type:['png','jpg','gif','webp'].includes(ext)?'image':'audio'});
      }
      if (path.startsWith('/uploads/') && method === 'GET') {
        const id=path.slice(9); assert(/^[a-f0-9-]+\.(png|jpg|webp|gif|mp3|wav|ogg|m4a)$/.test(id),'Nicht gefunden.',404);
        return file(req,res,join(dataDir,'uploads',id));
      }
      if (method === 'GET' && ['/icon.svg','/logo.svg'].includes(path)) return send(res,200,readFileSync(join(root,'public',path.slice(1)),'utf8'),'image/svg+xml');
      if (method === 'GET' && ['/app.js','/style.css'].includes(path)) return file(req,res,join(root,'public',path.slice(1)));
      if (method === 'GET' && !path.startsWith('/api/')) return file(req,res,join(root,'public','index.html'));
      send(res,404,{error:'Nicht gefunden.'});
    } catch(error) {
      if (!error.status) console.error(error);
      if (!res.headersSent) send(res,error.status || 500,{error:error.status ? error.message : 'Interner Serverfehler.'});
      else res.end();
    }
  });
  return {server,store};
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const {server,store} = createApp();
  server.listen(Number(process.env.PORT || 3000),'0.0.0.0',()=>console.log(`Quizabend läuft auf http://localhost:${server.address().port}`));
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>server.close(()=>{store.close();process.exit(0);}));
}
