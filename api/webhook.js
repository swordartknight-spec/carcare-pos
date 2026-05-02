// api/webhook.js — uses Firebase REST API with API Key (simpler, no private key needed)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'GET') return res.status(200).send('OK');
  if (req.method !== 'POST') return res.status(405).end();

  const body = req.body;
  if (!body?.events?.length) return res.status(200).end();

  const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const FB_PROJECT = process.env.FIREBASE_PROJECT_ID;
  const FB_APIKEY = process.env.FIREBASE_API_KEY;

  for (const event of body.events) {
    const lineUserId = event.source?.userId;
    if (!lineUserId) continue;

    // Welcome message when customer adds bot
    if (event.type === 'follow') {
      await lineReply(LINE_TOKEN, event.replyToken,
        'ยินดีต้อนรับสู่ CarCare! 🚗✨\n\n' +
        'พิมพ์ # ตามด้วยทะเบียนรถเพื่อรับใบเสร็จอัตโนมัติ\n\n' +
        'ตัวอย่าง: #กข1234\n\n' +
        '(ข้อความปกติสามารถส่งหาเราได้เลย 😊)'
      );
      continue;
    }

    if (event.type !== 'message' || event.message?.type !== 'text') continue;

    const text = event.message.text.trim();

    // Only respond to messages starting with #
    if (!text.startsWith('#')) continue;

    const plateText = text.slice(1).trim();
    const norm = plateText.replace(/\s+/g, '').toUpperCase();

    try {
      // Get all customers using Firebase REST API with API key
      const url = `https://firestore.googleapis.com/v1/projects/${FB_PROJECT}/databases/(default)/documents/customers?pageSize=500&key=${FB_APIKEY}`;
      const r = await fetch(url);
      const data = await r.json();

      if (!data.documents) {
        await lineReply(LINE_TOKEN, event.replyToken, 'ไม่สามารถเชื่อมต่อฐานข้อมูลได้ กรุณาลองใหม่');
        continue;
      }

      // Parse Firestore documents
      const customers = data.documents.map(doc => {
        const id = doc.name.split('/').pop();
        const f = doc.fields || {};
        return {
          _id: id,
          name: f.name?.stringValue || '',
          plate: f.plate?.stringValue || '',
          phone: f.phone?.stringValue || '',
          car: f.car?.stringValue || '',
          size: f.size?.stringValue || '',
          points: parseInt(f.points?.integerValue || f.points?.doubleValue || 0),
          lineUserId: f.lineUserId?.stringValue || '',
        };
      });

      // Check if Line ID already linked
      const existing = customers.find(c => c.lineUserId === lineUserId);
      if (existing) {
        await lineReply(LINE_TOKEN, event.replyToken,
          `สวัสดี ${existing.name}! 👋\n` +
          `บัญชีเชื่อมต่อแล้ว ✅\n` +
          `แต้มสะสม: ${existing.points} pts\n` +
          `ระดับ: ${tier(existing.points)}`
        );
        continue;
      }

      // Find by plate or phone
      const match = customers.find(c => {
        const p = c.plate.replace(/\s+/g, '').toUpperCase();
        const ph = c.phone.replace(/[-\s]/g, '');
        return p === norm || ph === norm;
      });

      if (match) {
        // Save Line User ID using PATCH
        const patchUrl = `https://firestore.googleapis.com/v1/projects/${FB_PROJECT}/databases/(default)/documents/customers/${match._id}?updateMask.fieldPaths=lineUserId&updateMask.fieldPaths=lineLinkedAt&key=${FB_APIKEY}`;
        await fetch(patchUrl, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fields: {
              lineUserId: { stringValue: lineUserId },
              lineLinkedAt: { stringValue: new Date().toISOString() }
            }
          })
        });

        await lineReply(LINE_TOKEN, event.replyToken,
          `ยืนยันสำเร็จ! ✅\n\n` +
          `ชื่อ: ${match.name}\n` +
          `รถ: ${match.car} (${match.size})\n` +
          `ทะเบียน: ${match.plate}\n` +
          `แต้มสะสม: ${match.points} pts\n` +
          `ระดับ: ${tier(match.points)}\n\n` +
          `คุณจะได้รับใบเสร็จผ่าน Line หลังชำระเงิน 🧾`
        );
      } else {
        await lineReply(LINE_TOKEN, event.replyToken,
          `ไม่พบทะเบียน "${plateText}" ในระบบ\n\n` +
          `ลองพิมพ์:\n` +
          `• #ทะเบียนรถ เช่น #กข1234\n` +
          `• #เบอร์โทร เช่น #0812345678\n\n` +
          `หรือแจ้งพนักงานเพิ่มข้อมูลในระบบ`
        );
      }
    } catch (e) {
      console.error('Error:', e);
      await lineReply(LINE_TOKEN, event.replyToken, 'ระบบขัดข้อง กรุณาลองใหม่');
    }
  }

  return res.status(200).end();
}

async function lineReply(token, replyToken, text) {
  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ replyToken, messages: [{ type: 'text', text }] })
  }).catch(console.error);
}

function tier(pts) {
  return pts >= 1000 ? 'Gold ★' : pts >= 400 ? 'Silver ✦' : 'Bronze ◆';
}
