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
    if (dbError || !farms) throw new Error(`Database Error: ${dbError?.message}`);

    let alertsSent = 0;

    for (const farm of farms) {
      const [lon, lat] = farm.polygon_data.coordinates[0][0];

      // A. Fetch Weather - UPDATED TO HTTPS
      const weatherRes = await fetch(`https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${AGRO_KEY}`);
      const weatherData = await weatherRes.json();
      
      let willRain = false;
      if (weatherData.list) {
        const next24Hours = weatherData.list.slice(0, 8);
        willRain = next24Hours.some((block: any) => block.weather[0].main === 'Rain');
      }

      // B. Fetch Soil Data - UPDATED TO HTTPS + Safety Check
      const polyRes = await fetch(`https://api.agromonitoring.com/agro/1.0/polygons?appid=${AGRO_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `Farm_${farm.id}`, geo_json: { type: "Feature", properties: {}, geometry: farm.polygon_data } })
      });
      const polyData = await polyRes.json();
      
      if (!polyData.id) {
          console.error(`Skipping farm ${farm.id}: No Polygon ID returned from Agro API`);
          continue; 
      }

      const soilRes = await fetch(`https://api.agromonitoring.com/agro/1.0/soil?polyid=${polyData.id}&appid=${AGRO_KEY}`);
      const soilData = await soilRes.json();
      const surfaceTempC = soilData.t0 ? (soilData.t0 - 273.15).toFixed(1) : "N/A";

      // C. AI Generation
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const prompt = `
        You are an expert agricultural AI assistant in Sri Lanka. 
        Analyze live data for farmer ${farm.farmer_name}:
        - Soil Moisture: ${soilData.moisture || 'Unknown'} m³/m³
        - Surface Temp: ${surfaceTempC}°C
        - Rain next 24h: ${willRain ? 'YES' : 'NO'}

        Write a short WhatsApp message:
        1. Natural Sinhala advice on irrigation/fertilizer.
        2. Short English translation below.
        Keep it concise. Use emojis.
      `;

      const aiResponse = await model.generateContent(prompt);
      const aiMessage = aiResponse.response.text();

      // D. Send WhatsApp
      await twilioClient.messages.create({
        body: aiMessage,
        from: process.env.TWILIO_WHATSAPP_NUMBER,
        to: farm.phone_number
      });

      alertsSent++;
    }

    return NextResponse.json({ success: true, message: `Alerts sent to ${alertsSent} farms.` });

  } catch (error: any) {
    console.error("CRON ENGINE ERROR:", error);
    // This will help us see the actual error in the browser window
    return NextResponse.json({ 
      error: 'System failure', 
      details: error.message 
    }, { status: 500 });
  }
}
