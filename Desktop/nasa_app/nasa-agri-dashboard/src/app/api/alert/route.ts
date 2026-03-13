import { NextResponse } from 'next/server';
import twilio from 'twilio';

export async function POST(req: Request) {
  try {
    // We receive the real-time farm data from your frontend
    const { moisture, willRain } = await req.json();

    // Securely load your keys from .env.local
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER;
    const toNumber = process.env.MY_PHONE_NUMBER; 

    if (!accountSid || !authToken || !fromNumber || !toNumber) {
        return NextResponse.json({ error: 'Missing Twilio credentials' }, { status: 500 });
    }

    // Initialize the Twilio transmission engine
    const client = twilio(accountSid, authToken);

    // Formulate a professional, actionable message for the farmer
    let messageBody = `*🌾 Agri-Space Alert*\n\nYour farm boundaries have been analyzed from space.\n\n💧 *Soil Moisture:* ${moisture} m³/m³\n🌧️ *Rain Forecast:* ${willRain ? 'Heavy rain expected' : 'Clear skies'}\n\n`;

    // The Logic Engine: Tell the farmer exactly what to do
    if (willRain) {
        messageBody += `*Action:* ⛔ DO NOT apply fertilizer today. It will wash away.`;
    } else if (moisture < 0.20) {
        messageBody += `*Action:* 🚨 Critical: Irrigate your land immediately.`;
    } else {
        messageBody += `*Action:* ✅ Conditions are optimal. No action needed.`;
    }

    // Fire the message via WhatsApp
    const message = await client.messages.create({
        body: messageBody,
        from: fromNumber,
        to: toNumber
    });

    return NextResponse.json({ success: true, messageSid: message.sid });

  } catch (error) {
    console.error("Twilio Error:", error);
    return NextResponse.json({ error: 'Failed to send WhatsApp message' }, { status: 500 });
  }
}