// api/send-receipt.js
// Vercel serverless function — handles sending Line messages

export default async function handler(req, res) {
  // Allow CORS from your GitHub Pages app
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { lineUserId, message } = req.body;
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;

  if (!token) return res.status(500).json({ error: 'LINE token not configured' });
  if (!lineUserId || !message) return res.status(400).json({ error: 'Missing lineUserId or message' });

  try {
    const response = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        to: lineUserId,
        messages: [
          {
            type: 'text',
            text: message
          }
        ]
      })
    });

    if (!response.ok) {
      const err = await response.json();
      return res.status(400).json({ error: err });
    }

    return res.status(200).json({ success: true });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
