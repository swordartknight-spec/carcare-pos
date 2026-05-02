// api/webhook.js
// Line Webhook — uses Firebase REST API directly (no SDK)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'GET') return res.status(200).send('OK');
  if (req.method !== 'POST') return res.status(405).end();

  const body = req.body;
  if (!body?.events?.length) return res.status(200).end();

  const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const PROJECT_ID = process.env.FIREBASE_PROJECT_ID;

  for (const event of body.events) {
    const lineUserId = event.source?.userId;
    if (!lineUserId) continue;

    if (event.type === 'follow') {
      await reply(TOKEN, event.replyToken,
        'ยินดีต้อนรับสู่ CarCare! 🚗✨\n\nกรุณาพิมพ์ทะเบียนรถของคุณ\nเพื่อรับใบเสร็จผ่าน Line อัตโนมัติ\n\nตัวอย่าง: กข 1234'
      );
      continue;
    }

    if (event.type !== 'message' || event.message?.type !== 'text') continue;

    const text = event.message.text.trim();
    const norm = text.replace(/\s+/g,'').toUpperCase();

    try {
      const token = await getToken();
      if (!token) { await reply(TOKEN, event.replyToken, 'ระบบขัดข้อง กรุณาลองใหม่'); continue; }

      // Check if already linked
      const existing = await queryFS(PROJECT_ID, token, 'lineUserId', lineUserId);
      if (existing) {
        await reply(TOKEN, event.replyToken,
          `สวัสดี ${existing.name}! 👋\nบัญชีเชื่อมต่อแล้ว ✅\nแต้ม: ${existing.points||0} pts · ${tier(existing.points||0)}`
        );
        continue;
      }

      // Find by plate or phone
      const all = await getAllDocs(PROJECT_ID, token, 'customers');
      const match = all.find(c => {
        const p = (c.plate||'').replace(/\s+/g,'').toUpperCase();
        const ph = (c.phone||'').replace(/[-\s]/g,'');
        return p===norm || ph===norm;
      });

      if (match) {
        await patchDoc(PROJECT_ID, token, 'customers', match._id, {
          lineUserId: lineUserId,
          lineLinkedAt: new Date().toISOString()
        });
        await reply(TOKEN, event.replyToken,
          `ยืนยันสำเร็จ! ✅\n\nชื่อ: ${match.name}\nรถ: ${match.car||'-'} (${match.size||'-'})\nทะเบียน: ${match.plate||'-'}\nแต้ม: ${match.points||0} pts · ${tier(match.points||0)}\n\nคุณจะได้รับใบเสร็จผ่าน Line หลังชำระเงิน 🧾`
        );
      } else {
        await reply(TOKEN, event.replyToken,
          `ไม่พบทะเบียน "${text}"\n\nลองพิมพ์:\n• ทะเบียนรถ เช่น กข1234\n• เบอร์โทร เช่น 0812345678\n\nหรือแจ้งพนักงานเพิ่มข้อมูล`
        );
      }
    } catch(e) {
      console.error(e);
      await reply(TOKEN, event.replyToken, 'ระบบขัดข้อง กรุณาลองใหม่');
    }
  }
  return res.status(200).end();
}

async function reply(token, replyToken, text) {
  await fetch('https://api.line.me/v2/bot/message/reply', {
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},
    body:JSON.stringify({replyToken,messages:[{type:'text',text}]})
  }).catch(console.error);
}

async function getToken() {
  const email = process.env.FIREBASE_CLIENT_EMAIL;
  let key = process.env.FIREBASE_PRIVATE_KEY;
  if(!email||!key) return null;
  // Handle various encodings of newlines
  key = key.replace(/\\n/g,'\n').replace(/\\\\n/g,'\n');
  // If key doesn't have actual newlines, it might be URL encoded
  if(!key.includes('\n')){
    key = key.replace(/\\n/g,'\n');
  }
  try {
    const now = Math.floor(Date.now()/1000);
    const header = b64url(JSON.stringify({alg:'RS256',typ:'JWT'}));
    const payload = b64url(JSON.stringify({
      iss:email,sub:email,
      aud:'https://oauth2.googleapis.com/token',
      iat:now,exp:now+3600,
      scope:'https://www.googleapis.com/auth/datastore'
    }));
    const input = `${header}.${payload}`;
    // Clean the key - remove headers, whitespace, and any non-base64 chars
    const keyData = key
      .replace(/-----BEGIN PRIVATE KEY-----/g,'')
      .replace(/-----END PRIVATE KEY-----/g,'')
      .replace(/[\r\n\s]/g,'')
      .replace(/[^A-Za-z0-9+/=]/g,'');
    const bkey = Uint8Array.from(atob(keyData),c=>c.charCodeAt(0));
    const ck = await crypto.subtle.importKey('pkcs8',bkey.buffer,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5',ck,new TextEncoder().encode(input));
    const jwt = `${input}.${b64url(sig)}`;
    const r = await fetch('https://oauth2.googleapis.com/token',{
      method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:`grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
    });
    const d = await r.json();
    return d.access_token||null;
  } catch(e) { console.error('Token error:',e); return null; }
}

function b64url(data) {
  const str = typeof data==='string'?data:String.fromCharCode(...new Uint8Array(data));
  return btoa(str).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
}

async function getAllDocs(pid, token, col) {
  const r = await fetch(
    `https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents/${col}?pageSize=500`,
    {headers:{'Authorization':`Bearer ${token}`}}
  );
  const d = await r.json();
  if(!d.documents) return [];
  return d.documents.map(doc=>({_id:doc.name.split('/').pop(),...parseFields(doc.fields)}));
}

async function queryFS(pid, token, field, value) {
  const r = await fetch(
    `https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents:runQuery`,
    {method:'POST',headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},
     body:JSON.stringify({structuredQuery:{from:[{collectionId:'customers'}],where:{fieldFilter:{field:{fieldPath:field},op:'EQUAL',value:{stringValue:value}}},limit:1}})}
  );
  const d = await r.json();
  if(!Array.isArray(d)||!d[0]?.document) return null;
  return {_id:d[0].document.name.split('/').pop(),...parseFields(d[0].document.fields)};
}

async function patchDoc(pid, token, col, id, updates) {
  const fields={};
  for(const[k,v] of Object.entries(updates)) fields[k]={stringValue:String(v)};
  const mask=Object.keys(updates).map(k=>`updateMask.fieldPaths=${k}`).join('&');
  await fetch(
    `https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents/${col}/${id}?${mask}`,
    {method:'PATCH',headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({fields})}
  );
}

function parseFields(fields={}) {
  const out={};
  for(const[k,v] of Object.entries(fields))
    out[k]=v.stringValue??v.integerValue??v.doubleValue??v.booleanValue??null;
  return out;
}

function tier(p) {
  return p>=1000?'Gold ★':p>=400?'Silver ✦':'Bronze ◆';
}
