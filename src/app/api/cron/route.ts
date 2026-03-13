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
      try {
        const geoData = typeof farm.polygon_data === 'string' 
          ? JSON.parse(farm.polygon_data) 
          : farm.polygon_data;

        const coordinates = geoData?.coordinates;

        if (!coordinates || !coordinates[0] || !coordinates[0][0]) {
          console.error(`Farm ${farm.id} has invalid coordinates structure.`);
          continue; 
        }

        const [lon, lat] = coordinates[0][0];

        const weatherRes = await fetch(`https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${AGRO_KEY}`);
        const weatherData = await weatherRes.json();
        
        let willRain = false;
        if (weatherData.list) {
          const next24Hours = weatherData.list.slice(0, 8);
          willRain = next24Hours.some((block: any) => block.weather[0].main === 'Rain');
        }

        const polyRes = await fetch(`https://api.agromonitoring.com/agro/1.0/polygons?appid=${AGRO_KEY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            name: `Farm_${farm.id}`, 
            geo_json: { type: "Feature", properties: {}, geometry: geoData } 
          })
        });
        const polyData = await polyRes.json();
        
        if (!polyData.id) continue; 

        const soilRes = await fetch(`https://api.agromonitoring.com/agro/1.0/soil?polyid=${polyData.id}&appid=${AGRO_KEY}`);
        const soilData = await soilRes.json();
        const surfaceTempC = soilData.t0 ? (soilData.t0 - 273.15).toFixed(1) : "N/A";

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const prompt = `Write a short agricultural WhatsApp alert for farmer ${farm.farmer_name}. 
          Soil Moisture: ${soilData.moisture || 'Unknown'}. Temp: ${surfaceTempC}°C. Rain: ${willRain ? 'Yes' : 'No'}. 
          Provide advice in natural Sinhala first, then English. Use emojis.`;

        const aiResponse = await model.generateContent(prompt);
        const aiMessage = aiResponse.response.text();

        await twilioClient.messages.create({
          body: aiMessage,
          from: process.env.TWILIO_WHATSAPP_NUMBER,
          to: farm.phone_number
        });

        alertsSent++;
      } catch (innerError) {
        console.error(`Error processing farm ${farm.id}:`, innerError);
      }
    }

    // SUCCESS RETURN (Must be inside try, after the loop)
    return NextResponse.json({ success: true, message: `Alerts sent to ${alertsSent} farms.` });

  } catch (error: any) {
    // ERROR RETURN (Must be inside catch)
    return NextResponse.json({ 
      error: 'System failure', 
      details: error.message 
    }, { status: 500 });
  }
}
