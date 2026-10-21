import { env } from 'cloudflare:workers';
export const dynamic='force-dynamic';
const enc=new TextEncoder();
const hex=(b:ArrayBuffer)=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
async function hash(s:string){return hex(await crypto.subtle.digest('SHA-256',enc.encode(s)))}
async function pinHash(pin:string,salt:string){const k=await crypto.subtle.importKey('raw',enc.encode(pin),'PBKDF2',false,['deriveBits']);return hex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:enc.encode(salt),iterations:100000},k,256))}
function fail(message:string,status=400):never{throw Object.assign(new Error(message),{status})}
function db(){if(!env.DB)fail('Database belum tersedia.',503);return env.DB!}
function out(data:unknown,status=200,headers:Record<string,string>={}){return Response.json(data,{status,headers:{'Cache-Control':'no-store',...headers}})}
function str(value:unknown,min=1,max=80){if(typeof value!=='string'||value.trim().length<min||value.trim().length>max)fail('Periksa kembali isian kamu.');return value.trim()}
function teacherSecret(){const secret=(env as unknown as {TEACHER_PASSCODE?:string}).TEACHER_PASSCODE;if(!secret)fail('Akses pengajar belum dikonfigurasi.',503);return secret}
function teacherToken(req:Request){return req.headers.get('cookie')?.match(/(?:^|;\s*)sc_teacher=([^;]+)/)?.[1]}
async function teacherSignedIn(req:Request){const token=teacherToken(req);if(!token)return false;const row=await db().prepare('SELECT hash FROM teacher_sessions WHERE hash=? AND expires>? AND version=?').bind(await hash(token),Date.now(),await hash(teacherSecret())).first();return !!row}
async function requireTeacher(req:Request){if(!await teacherSignedIn(req))fail('Masukkan passcode pengajar terlebih dahulu.',401)}
async function teacher(req:Request,id:string){await requireTeacher(req);const c=await db().prepare('SELECT * FROM classes WHERE id=?').bind(id).first();if(!c)fail('Kelas tidak ditemukan.',404);return c}
async function participant(req:Request){const raw=req.headers.get('cookie')?.match(/(?:^|;\s*)sc_session=([^;]+)/)?.[1];if(!raw)fail('Silakan masuk kelas kembali.',401);const p=await db().prepare('SELECT p.*,c.title,c.status,c.teacher,c.code FROM tokens t JOIN participants p ON p.id=t.participant_id JOIN classes c ON c.id=p.class_id WHERE t.hash=? AND t.expires>?').bind(await hash(raw),Date.now()).first();if(!p)fail('Sesi masuk berakhir. Masuk lagi dengan nama dan passcode kamu.',401);return p}
async function limit(key:string,max:number,window:number){const now=Date.now();const r=await db().prepare('INSERT INTO attempts(key,count,until) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN until<? THEN 1 ELSE count+1 END, until=CASE WHEN until<? THEN excluded.until ELSE until END RETURNING count').bind(key,now+window,now,now).first<{count:number}>();if(r!.count>max)fail('Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.',429)}
async function run(req:Request){
 const url=new URL(req.url);
 if(req.method==='GET'){
  const action=url.searchParams.get('action');
  if(action==='classes'){const signedIn=await teacherSignedIn(req);return out({signedIn,classes:signedIn?(await db().prepare('SELECT * FROM classes ORDER BY created DESC').all()).results:[]})}
  if(action==='board'){const id=str(url.searchParams.get('id'));const c=await teacher(req,id);const [people,events]=await db().batch([db().prepare('SELECT p.id,p.name,p.created,COUNT(s.id) AS score FROM participants p LEFT JOIN stars s ON s.participant_id=p.id AND s.revoked IS NULL WHERE p.class_id=? GROUP BY p.id ORDER BY score DESC,p.created ASC,p.id ASC').bind(id),db().prepare('SELECT s.*,p.name FROM stars s JOIN participants p ON p.id=s.participant_id WHERE s.class_id=? ORDER BY s.id DESC').bind(id)]);return out({classroom:c,people:people.results,events:events.results,serverTime:Date.now()})}
  if(action==='me'){const p=await participant(req);const r=await db().prepare('SELECT COUNT(*) AS score FROM stars WHERE participant_id=? AND revoked IS NULL').bind(p.id).first();return out({id:p.id,name:p.name,title:p.title,status:p.status,teacher:p.teacher,code:p.code,score:r?.score})}
  return out({ok:true});
 }
 if(req.headers.get('origin')!==url.origin)fail('Permintaan tidak diizinkan.',403);
 if(!req.headers.get('content-type')?.includes('application/json'))fail('Format permintaan tidak valid.',415);
 const raw=await req.text();if(raw.length>5000)fail('Permintaan terlalu besar.',413);
 let b;try{b=JSON.parse(raw)}catch{fail('Data tidak valid.')}
 if(b.action==='teacher-login'){
  const pin=str(b.pin,1,64),secret=teacherSecret();
  await limit('teacher-login:'+await hash(req.headers.get('cf-connecting-ip')||'unknown'),8,900000);
  const given=await hash(pin),expected=await hash(secret);let diff=0;for(let i=0;i<given.length;i++)diff|=given.charCodeAt(i)^expected.charCodeAt(i);
  if(diff)fail('Passcode pengajar salah.',401);
  const token=crypto.randomUUID()+crypto.randomUUID();
  await db().batch([db().prepare('DELETE FROM teacher_sessions WHERE expires<?').bind(Date.now()),db().prepare('INSERT INTO teacher_sessions(hash,expires,version) VALUES(?,?,?)').bind(await hash(token),Date.now()+12*3600000,expected)]);
  return out({ok:true},200,{'Set-Cookie':`sc_teacher=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=43200`});
 }
 if(b.action==='teacher-logout'){
  const token=teacherToken(req);if(token)await db().prepare('DELETE FROM teacher_sessions WHERE hash=?').bind(await hash(token)).run();
  return out({ok:true},200,{'Set-Cookie':'sc_teacher=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0'});
 }
 if(b.action==='create'){
  await requireTeacher(req);
  await limit('create:teacher',20,3600000);
  const id=crypto.randomUUID(),code=crypto.randomUUID().replaceAll('-','').slice(0,8).toUpperCase();
  await db().prepare('INSERT INTO classes(id,owner,teacher,title,code,status,created) VALUES (?,?,?,?,?,?,?)').bind(id,'afi',str(b.teacher,2,40),str(b.title,2,80),code,'open',Date.now()).run();return out({id});
 }
 if(b.action==='join'){
  const code=str(b.code,8,8).toUpperCase(),name=str(b.name,2,40),pin=str(b.pin,6,64),normalized=name.normalize('NFKC').toLocaleLowerCase('id-ID');
  const ip=req.headers.get('cf-connecting-ip')||'unknown';await limit('join-ip:'+await hash(ip),200,600000);await limit('join:'+await hash(code+':'+normalized),12,600000);
  const c=await db().prepare('SELECT * FROM classes WHERE code=?').bind(code).first();if(!c)fail('Kode kelas tidak ditemukan. Periksa QR atau kode dari pengajar.');
  let p=await db().prepare('SELECT * FROM participants WHERE class_id=? AND normalized=?').bind(c.id,normalized).first();
  if(p){if(await pinHash(pin,String(p.salt))!==p.pin_hash)fail('Nama sudah terdaftar. Gunakan passcode yang benar, atau nama lengkap yang berbeda.',401)}
  else {if(c.status==='closed')fail('Kelas sudah selesai.');const salt=crypto.randomUUID(),id=crypto.randomUUID();const h=await pinHash(pin,salt);await db().prepare('INSERT OR IGNORE INTO participants(id,class_id,name,normalized,pin_hash,salt,created) VALUES(?,?,?,?,?,?,?)').bind(id,c.id,name,normalized,h,salt,Date.now()).run();p=await db().prepare('SELECT * FROM participants WHERE class_id=? AND normalized=?').bind(c.id,normalized).first();if(await pinHash(pin,String(p!.salt))!==p!.pin_hash)fail('Nama sudah digunakan. Coba nama lengkap yang berbeda.',409)}
  const token=crypto.randomUUID()+crypto.randomUUID();await db().batch([db().prepare('DELETE FROM tokens WHERE expires<?').bind(Date.now()),db().prepare('INSERT INTO tokens(hash,participant_id,expires) VALUES(?,?,?)').bind(await hash(token),p!.id,Date.now()+7*86400000)]);return out({ok:true},200,{'Set-Cookie':`sc_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`});
 }
 if(b.action==='claim'){
  const p=await participant(req),requestId=str(b.requestId,36,36),now=Date.now();
  const prior=await db().prepare('SELECT id FROM stars WHERE request_id=? AND participant_id=?').bind(requestId,p.id).first();if(prior)return out({ok:true,duplicate:true});
  const result=await db().prepare(`INSERT OR IGNORE INTO stars(participant_id,class_id,request_id,created) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM classes WHERE id=? AND status='open') AND NOT EXISTS(SELECT 1 FROM stars WHERE participant_id=? AND created>?)`).bind(p.id,p.class_id,requestId,now,p.class_id,p.id,now-3000).run();
  if(!result.meta.changes)fail('Tombol sedang dijeda, kelas selesai, atau kamu baru saja mengklaim. Tunggu 3 detik.',409);
  return out({ok:true});
 }
 if(b.action==='status'){await teacher(req,str(b.id));if(!['open','paused','closed'].includes(b.status))fail('Status tidak valid.');await db().prepare('UPDATE classes SET status=? WHERE id=?').bind(b.status,b.id).run();return out({ok:true})}
 if(b.action==='revoke'){await teacher(req,str(b.id));const reason=str(b.reason,3,160);await db().prepare('UPDATE stars SET revoked=?,reason=? WHERE id=? AND class_id=? AND revoked IS NULL').bind(Date.now(),reason,Number(b.starId),b.id).run();return out({ok:true})}
 if(b.action==='logout')return out({ok:true},200,{'Set-Cookie':'sc_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0'});
 fail('Aksi tidak tersedia.',404);
}
async function handler(req:Request){try{return await run(req)}catch(e){const x=e as Error&{status?:number};if(!x.status)console.error('Classroom API failed',x.message);return out({error:x.status?x.message:'Ada gangguan server. Silakan coba lagi.'},x.status||500)}}
export const GET=handler;export const POST=handler;
