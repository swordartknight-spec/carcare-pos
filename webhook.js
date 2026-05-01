// api/webhook.js
// Line Webhook — auto-captures customer Line User ID
// When a customer messages your Line bot with their plate number,
// this saves their Line User ID to Firebase automatically.

import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { credential } from 'firebase-admin';

// Initialize Firebase Admin (only once)
function getDB() {
  if (!getApps().length) {
    initializeApp({
      credential: credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      })
    });
  }
  return getFirestore();
}

// Send a Line reply message
async function replyLine(replyToken, text) {
  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: 'text', text }]
    })
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Line sends GET to verify webhook URL — just return 200
  if (req.method === 'GET') return res.status(200).send('OK');
  if (req.method !== 'POST') return res.status(405).end();

  const body = req.body;
  if (!body?.events?.length) return res.status(200).end();

  const db = getDB();

  for (const event of body.events) {
    // Only handle text messages
    if (event.type !== 'message' || event.message?.type !== 'text') {
      // If they just followed (added your account), send welcome message
      if (event.type === 'follow') {
        await replyLine(event.replyToken,
          `ยินดีต้อนรับสู่ CarCare! 🚗✨\n\n` +
          `กรุณาพิมพ์ทะเบียนรถของคุณ\nเพื่อเชื่อมต่อบัญชี Line กับโปรไฟล์ลูกค้า\n\n` +
          `ตัวอย่าง: กข 1234`
        );
      }
      continue;
    }

    const lineUserId = event.source?.userId;
    const replyToken = event.replyToken;
    const text = event.message.text.trim().toUpperCase();

    if (!lineUserId) continue;

    // Check if this Line ID is already linked to a customer
    const existingSnap = await db.collection('customers')
      .where('lineUserId', '==', lineUserId)
      .limit(1)
      .get();

    if (!existingSnap.empty) {
      const cust = existingSnap.docs[0].data();
      await replyLine(replyToken,
        `สวัสดี ${cust.name}! 👋\n` +
        `บัญชีของคุณเชื่อมต่อแล้ว ✅\n` +
        `แต้มสะสม: ${cust.points || 0} pts\n` +
        `ระดับ: ${getTier(cust.points || 0)}`
      );
      continue;
    }

    // Try to match by plate number (user typed their plate)
    // Normalize: remove spaces, uppercase
    const normalizedInput = text.replace(/\s+/g, '').toUpperCase();

    // Search all customers for matching plate
    const allCusts = await db.collection('customers').get();
    let matched = null;

    for (const doc of allCusts.docs) {
      const data = doc.data();
      const plate = (data.plate || '').replace(/\s+/g, '').toUpperCase();
      const phone = (data.phone || '').replace(/[-\s]/g, '');

      if (plate === normalizedInput || phone === normalizedInput) {
        matched = { id: doc.id, ...data };
        break;
      }
    }

    if (matched) {
      // Save Line User ID to customer profile
      await db.collection('customers').doc(matched.id).update({
        lineUserId: lineUserId,
        lineLinkedAt: new Date().toISOString()
      });

      await replyLine(replyToken,
        `ยืนยันตัวตนสำเร็จ! ✅\n\n` +
        `ชื่อ: ${matched.name}\n` +
        `รถ: ${matched.car || '-'} (${matched.size || '-'})\n` +
        `ทะเบียน: ${matched.plate || '-'}\n` +
        `แต้มสะสม: ${matched.points || 0} pts\n` +
        `ระดับ: ${getTier(matched.points || 0)}\n\n` +
        `ตอนนี้คุณจะได้รับใบเสร็จผ่าน Line หลังชำระเงิน 🧾`
      );
    } else {
      // Not found — ask them to try again or give phone number
      await replyLine(replyToken,
        `ไม่พบข้อมูลทะเบียน "${event.message.text}" ในระบบ\n\n` +
        `กรุณาลองพิมพ์:\n` +
        `• ทะเบียนรถ เช่น กข1234\n` +
        `• เบอร์โทร เช่น 0812345678\n\n` +
        `หรือแจ้งพนักงานเพื่อเพิ่มข้อมูลในระบบ`
      );
    }
  }

  return res.status(200).end();
}

function getTier(pts) {
  if (pts >= 1000) return 'Gold ★';
  if (pts >= 400) return 'Silver ✦';
  return 'Bronze ◆';
}
