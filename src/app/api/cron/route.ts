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
    let healthySkipped = 0;
    let diagnostics = []; 

    for (const farm of farms) {
      try {
        const geoData = typeof farm.polygon_data === 'string' ? JSON.parse(farm.polygon_data) : farm.polygon_data;
        const coords = geoData?.coordinates || geoData?.geometry?.coordinates;
        
        if (!coords) {
          diagnostics.push(`Farm ${farm.farmer_name}: Failed - No coordinates.`);
          continue;
        }

        const [lon, lat] = coords[0][0];

        // 1. Weather Test
        const weatherRes = await fetch(`https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${AGRO_KEY}`);
        const wData = await weatherRes.json();
        const willRain = wData.list?.slice(0, 8).some((b: any) => b.weather[0].main === 'Rain') || false;

        // 2. Agro Polygon (READ-ONLY)
        const polyListRes = await fetch(`https://api.agromonitoring.com/agro/1.0/polygons?appid=${AGRO_KEY}`);
        const polyList = await polyListRes.json();
        
        let polyId;
        if (polyList && polyList.length > 0) {
          polyId = polyList[0].id;
        }

        if (!polyId) {
          diagnostics.push(`Farm ${farm.farmer_name}: Failed - No existing Agro polygons found.`);
          continue;
        }

        // 3. Agro Soil Test
        const soilRes = await fetch(`https://api.agromonitoring.com/agro/1.0/soil?polyid=${polyId}&appid=${AGRO_KEY}`);
        const sData = await soilRes.json();
        const moisture = sData.moisture || 0;
        const tempC = sData.t0 ? (sData.t0 - 273.15) : 25;

        // --- THE SMART THRESHOLD LOGIC ---
        // Only trigger an alert if moisture is too low, it's too hot, or rain is coming.
        const isLowMoisture = moisture < 0.20;
        const isTooHot = tempC > 35;
        
        if (!isLowMoisture && !willRain && !isTooHot) {
            healthySkipped++;
            diagnostics.push(`Farm ${farm.farmer_name} (${farm.land_name}): Healthy. No alert sent.`);
            continue; // Skip the rest of the loop and move to the next farm
        }

        // 4. Gemini AI Test (Now using land_name)
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const prompt = `
          Context: Sri Lankan Farmer ${farm.farmer_name}. 
          Land Name: ${farm.land_name || 'Main Farm'}. 
          Soil Moisture: ${moisture}. 
          Temperature: ${tempC.toFixed(1)}°C.
          Rain Expected: ${willRain}. 
          
          Write an urgent, short WhatsApp alert specifically mentioning the "${farm.land_name || 'Main Farm'}". 
          Provide strict advice on whether to irrigate or hold off due to rain.
          Format: Natural Sinhala first, then English below. Use emojis.
        `;
        const result = await model.generateContent(prompt);
        const aiMsg = result.response.text();

        // 5. Twilio Test
        await twilioClient.messages.create({
          body: aiMsg,
          from: process.env.TWILIO_WHATSAPP_NUMBER,
          to: `whatsapp:${farm.phone_number}`
        });

        alertsSent++;
        diagnostics.push(`Farm ${farm.farmer_name} (${farm.land_name}): SUCCESS! Alert sent.`);

      } catch (innerErr: any) {
        diagnostics.push(`Farm ${farm.farmer_name} Exception: ${innerErr.message}`);
      }
    }

    return NextResponse.json({ 
      success: true, 
      message: `Alerts sent to ${alertsSent} farms. Skipped ${healthySkipped} healthy farms.`,
      debug_report: diagnostics
    });

  } catch (error: any) {
    return NextResponse.json({ error: 'System failure', details: error.message }, { status: 500 });
  }
}
