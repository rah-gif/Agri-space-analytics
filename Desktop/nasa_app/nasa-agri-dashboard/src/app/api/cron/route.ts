import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import twilio from 'twilio';

export async function GET() {
  try {
    // 1. Initialize all our API Engines
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const AGRO_KEY = process.env.AGRO_API_KEY;

    // 2. Fetch EVERY registered farm from our secure vault
    const { data: farms, error } = await supabase.from('farms').select('*');
    if (error || !farms) return NextResponse.json({ error: 'Failed to read database' }, { status: 500 });

    let alertsSent = 0;

    // 3. Loop through the farms and process them one by one
// 3. Loop through the farms and process them one by one
    for (const farm of farms) {
      const [lon, lat] = farm.polygon_data.coordinates[0][0];

      // A. Fetch Weather Data
      const weatherRes = await fetch(`https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${AGRO_KEY}`);
      const weatherData = await weatherRes.json();
      
      let willRain = false;
      if (weatherData.list) {
        const next24Hours = weatherData.list.slice(0, 8);
        willRain = next24Hours.some((block: any) => block.weather[0].main === 'Rain');
      }

      // B. Fetch Soil Data using the polygon ID (assuming you saved it, or using coordinates)
      // *Note: For this to work perfectly, ensure you saved the OpenWeather 'polyId' in Supabase!*
      // For now, let's pass the raw polygon coordinates to the API to get instant soil data
      const polyRes = await fetch(`http://api.agromonitoring.com/agro/1.0/polygons?appid=${AGRO_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: "Daily_Check", geo_json: farm.polygon_data })
      });
      const polyData = await polyRes.json();
      
      const soilRes = await fetch(`http://api.agromonitoring.com/agro/1.0/soil?polyid=${polyData.id}&appid=${AGRO_KEY}`);
      const soilData = await soilRes.json();
      const surfaceTempC = (soilData.t0 - 273.15).toFixed(1);

      
      // C. The Upgraded AI Prompt (Full Data Analysis)
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const prompt = `
        You are an expert agricultural AI assistant in Sri Lanka. 
        Analyze this live satellite data for farmer ${farm.farmer_name}'s land:
        - Soil Moisture: ${soilData.moisture} m³/m³ (Optimal is 0.25 to 0.35)
        - Surface Temperature: ${surfaceTempC}°C
        - Rain Expected in next 24h: ${willRain ? 'YES' : 'NO'}

        Write a short, urgent WhatsApp message to the farmer. 
        1. Explain the current soil and heat conditions simply.
        2. Give strict advice on irrigation and fertilizer based on this data combination.
        Write it FIRST in natural Sinhala, and then underneath, a short English translation. Use emojis.
      `;

      const aiResponse = await model.generateContent(prompt);
      const aiMessage = aiResponse.response.text();

      // D. Fire the AI-generated message
      await twilioClient.messages.create({
        body: aiMessage,
        from: process.env.TWILIO_WHATSAPP_NUMBER,
        to: farm.phone_number
      });

      alertsSent++;
    }

    return NextResponse.json({ success: true, message: `Successfully automated ${alertsSent} farm alerts!` });

  } catch (error) {
    console.error("Cron Engine Error:", error);
    return NextResponse.json({ error: 'System failure' }, { status: 500 });
  }
}