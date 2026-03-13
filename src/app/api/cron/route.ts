import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import twilio from 'twilio';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // 1. Initialize Clients
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!, 
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } } // Prevents session hanging in serverless
    );
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);
    const AGRO_KEY = process.env.AGRO_API_KEY;

    // 2. Fetch Farms - DEBUG VERSION
    const { data: farms, error: dbError } = await supabase
      .from('farms')
      .select('*');
    
    // Log exactly what was found to Vercel Logs
    console.log("Database Row Count:", farms?.length);
    console.log("Database Error Object:", dbError);

    if (dbError) throw new Error(`DB Error: ${dbError.message}`);
    
    // If it's still 0, we'll return a special message to help us debug
    if (!farms || farms.length === 0) {
      return NextResponse.json({ 
        success: true, 
        message: "The database query returned 0 rows. Check if the 'farms' table has data in the 'public' schema.",
        rowCount: farms?.length 
      });
    }

    let alertsSent = 0;

    for (const farm of farms) {
      try {
        // Robust Parsing
        const geoData = typeof farm.polygon_data === 'string' ? JSON.parse(farm.polygon_data) : farm.polygon_data;
        const coords = geoData?.coordinates || geoData?.geometry?.coordinates;

        if (!coords || !coords[0]) continue;
        const [lon, lat] = coords[0][0];

        // Fetch Data
        const weatherRes = await fetch(`https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${AGRO_KEY}`);
        const weatherData = await weatherRes.json();
        const willRain = weatherData.list?.slice(0, 8).some((b: any) => b.weather[0].main === 'Rain') || false;

        const polyRes = await fetch(`https://api.agromonitoring.com/agro/1.0/polygons?appid=${AGRO_KEY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: `F_${farm.id}`, geo_json: { type: "Feature", properties: {}, geometry: geoData } })
        });
        const polyData = await polyRes.json();
        
        if (!polyData.id) continue;

        const soilRes = await fetch(`https://api.agromonitoring.com/agro/1.0/soil?polyid=${polyData.id}&appid=${AGRO_KEY}`);
        const soilData = await soilRes.json();

        // AI Advice
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
        const result = await model.generateContent(`Farmer: ${farm.farmer_name}. Rain: ${willRain}. Soil: ${soilData.moisture}. Write a 2-sentence WhatsApp alert in Sinhala and English.`);
        const aiMessage = result.response.text();

        // Send WhatsApp
        await twilioClient.messages.create({
          body: aiMessage,
          from: process.env.TWILIO_WHATSAPP_NUMBER,
          to: farm.phone_number
        });

        alertsSent++;
      } catch (err) {
        console.error("Individual Farm Error:", err);
      }
    }

    return NextResponse.json({ success: true, message: `Alerts sent to ${alertsSent} farms.` });

  } catch (error: any) {
    console.error("CRITICAL ERROR:", error.message);
    return NextResponse.json({ error: 'System failure', details: error.message }, { status: 500 });
  }
}
