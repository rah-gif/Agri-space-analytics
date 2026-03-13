import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import twilio from 'twilio';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);
    const AGRO_KEY = process.env.AGRO_API_KEY;

    const { data: farms, error: dbError } = await supabase.from('farms').select('*');
    if (dbError) throw new Error(`Supabase Error: ${dbError.message}`);

    if (!farms || farms.length === 0) {
      return NextResponse.json({ success: true, message: "No farm records found in Supabase." });
    }

    let alertsSent = 0;
    let diagnostics = []; // This will track exactly what happens to each farm

    for (const farm of farms) {
      try {
        const geoData = typeof farm.polygon_data === 'string' ? JSON.parse(farm.polygon_data) : farm.polygon_data;
        const coords = geoData?.coordinates || geoData?.geometry?.coordinates;
        
        if (!coords) {
          diagnostics.push(`Farm ${farm.farmer_name}: Failed - Could not find coordinates.`);
          continue;
        }

        const [lon, lat] = coords[0][0];

        // 1. Weather Test
        const weatherRes = await fetch(`https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${AGRO_KEY}`);
        const wData = await weatherRes.json();
        const willRain = wData.list?.slice(0, 8).some((b: any) => b.weather[0].main === 'Rain') || false;

        // 2. Agro Polygon Test
        const polyRes = await fetch(`https://api.agromonitoring.com/agro/1.0/polygons?appid=${AGRO_KEY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: `F_${farm.id}`, geo_json: { type: "Feature", properties: {}, geometry: geoData } })
        });
        const pData = await polyRes.json();
        
        if (!pData.id) {
          diagnostics.push(`Farm ${farm.farmer_name}: Agro API failed. Response: ${JSON.stringify(pData)}`);
          continue;
        }

        // 3. Agro Soil Test
        const soilRes = await fetch(`https://api.agromonitoring.com/agro/1.0/soil?polyid=${pData.id}&appid=${AGRO_KEY}`);
        const sData = await soilRes.json();

        // 4. Gemini AI Test
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const prompt = `Context: Sri Lankan Farmer ${farm.farmer_name}. Soil Moisture: ${sData.moisture}. Rain: ${willRain}. Write a short WhatsApp alert in Sinhala then English.`;
        const result = await model.generateContent(prompt);
        const aiMsg = result.response.text();

        // 5. Twilio Test
        await twilioClient.messages.create({
          body: aiMsg,
          from: process.env.TWILIO_WHATSAPP_NUMBER,
          to: farm.phone_number
        });

        alertsSent++;
        diagnostics.push(`Farm ${farm.farmer_name}: SUCCESS! Message sent.`);

      } catch (innerErr: any) {
        // If it crashes anywhere, this catches the exact reason
        diagnostics.push(`Farm ${farm.farmer_name} Exception: ${innerErr.message}`);
      }
    }

    // Now returning the diagnostics array to the browser
    return NextResponse.json({ 
      success: true, 
      message: `Alerts sent to ${alertsSent} farms.`,
      debug_report: diagnostics
    });

  } catch (error: any) {
    return NextResponse.json({ error: 'System failure', details: error.message }, { status: 500 });
  }
}
