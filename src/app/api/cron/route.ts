import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import twilio from 'twilio';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    console.log("🚀 Starting Cron Job...");

    // Initialize Clients
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);
    const AGRO_KEY = process.env.AGRO_API_KEY;

    // Fetch Farms
    const { data: farms, error: dbError } = await supabase.from('farms').select('*');
    
    if (dbError) throw new Error(`Database Error: ${dbError.message}`);
    
    // DEBUG LOG: This will show up in Vercel Logs so we can see if it found anything
    console.log(`📂 Found ${farms?.length || 0} farms in database.`);

    if (!farms || farms.length === 0) {
      return NextResponse.json({ success: true, message: "No farms found in database to process." });
    }

    let alertsSent = 0;

    for (const farm of farms) {
      try {
        // Parse Polygon Data
        const geoData = typeof farm.polygon_data === 'string' ? JSON.parse(farm.polygon_data) : farm.polygon_data;
        const coordinates = geoData?.coordinates || geoData?.geometry?.coordinates;

        if (!coordinates) {
          console.log(`❌ Skipping farm ${farm.id}: No coordinates.`);
          continue;
        }

        const [lon, lat] = coordinates[0][0];

        // Fetch Weather
        const weatherRes = await fetch(`https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${AGRO_KEY}`);
        const weatherData = await weatherRes.json();
        const willRain = weatherData.list?.slice(0, 8).some((b: any) => b.weather[0].main === 'Rain');

        // Fetch Soil
        const polyRes = await fetch(`https://api.agromonitoring.com/agro/1.0/polygons?appid=${AGRO_KEY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: `F_${farm.id}`, geo_json: { type: "Feature", properties: {}, geometry: geoData } })
        });
        const polyData = await polyRes.json();
        
        if (!polyData.id) continue;

        const soilRes = await fetch(`https://api.agromonitoring.com/agro/1.0/soil?polyid=${polyData.id}&appid=${AGRO_KEY}`);
        const soilData = await soilRes.json();

        // AI Message Generation
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent(`Farmer: ${farm.farmer_name}. Rain: ${willRain}. Soil: ${soilData.moisture}. Write a brief Sinhala/English WhatsApp alert.`);
        const aiMessage = result.response.text();

        // Send WhatsApp
        await twilioClient.messages.create({
          body: aiMessage,
          from: process.env.TWILIO_WHATSAPP_NUMBER,
          to: farm.phone_number
        });

        alertsSent++;
      } catch (err: any) {
        console.error(`❌ Farm ${farm.id} failed:`, err.message);
      }
    }

    return NextResponse.json({ success: true, message: `Alerts sent to ${alertsSent} farms.` });

  } catch (error: any) {
    console.error("🔴 CRITICAL CRON ERROR:", error.message);
    return NextResponse.json({ error: 'System failure', details: error.message }, { status: 500 });
  }
}
