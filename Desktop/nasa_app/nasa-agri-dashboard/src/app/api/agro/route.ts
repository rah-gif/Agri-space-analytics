import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    // We receive the drawn coordinates from your map
    const body = await req.json();
    const geojson = body.geojson;
    
    // We grab your new Agro API key from .env.local
    const AGRO_KEY = process.env.AGRO_API_KEY;

    if (!AGRO_KEY) {
      return NextResponse.json({ error: 'Missing Agro API Key' }, { status: 500 });
    }

    // Step 1: Register the farm polygon with OpenWeather
    const polyRes = await fetch(`http://api.agromonitoring.com/agro/1.0/polygons?appid=${AGRO_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: "SriLanka_Farm_Plot",
        geo_json: geojson
      })
    });
    
    const polyData = await polyRes.json();
    
    // If the API rejects the shape, we catch it
    if (!polyData.id) {
       return NextResponse.json({ error: 'Polygon rejected by API', details: polyData }, { status: 400 });
    }
    
    const polyId = polyData.id;

    // Step 2: Fetch the Soil Data for that specific polygon ID
    const soilRes = await fetch(`http://api.agromonitoring.com/agro/1.0/soil?polyid=${polyId}&appid=${AGRO_KEY}`);
    const soilData = await soilRes.json();

    // Step 3: Fetch Weather Forecast Data for the polygon
    const weatherRes = await fetch(`http://api.agromonitoring.com/agro/1.0/weather/forecast?polyid=${polyId}&appid=${AGRO_KEY}`);
    const weatherData = await weatherRes.json();
    
    // Analyze the weather forecast to see if it will rain soon (next 24 hours)
    let willRain = false;
    let weatherDesc = 'Clear Skies';

    if (Array.isArray(weatherData) && weatherData.length > 0) {
      // The forecast usually returns in 3 hour steps. Let's check the first 8 items (24 hours)
      const next24h = weatherData.slice(0, 8);
      
      for (const forecast of next24h) {
        if (forecast.weather && forecast.weather.length > 0) {
          const id = forecast.weather[0].id;
          // OpenWeather condition codes: 2xx=Thunderstorm, 3xx=Drizzle, 5xx=Rain, 6xx=Snow
          if ((id >= 200 && id < 600) || id === 615 || id === 616) {
            willRain = true;
            weatherDesc = forecast.weather[0].description;
            break; // Stop looking, it's going to rain!
          }
        }
      }
      
      // If it's not raining, just grab the current description
      if (!willRain && next24h[0].weather && next24h[0].weather.length > 0) {
         weatherDesc = next24h[0].weather[0].description;
      }
    }

    // Capitalize the first letter for nicer presentation
    const formattedDesc = weatherDesc.charAt(0).toUpperCase() + weatherDesc.slice(1);

    // Send the final processed data back to your frontend UI
    return NextResponse.json({ 
      soil: soilData, 
      polyId: polyId,
      weather: {
        willRain: willRain,
        description: formattedDesc
      }
    });
    
  } catch (error) {
    console.error("Agro API Error:", error);
    return NextResponse.json({ error: 'Failed to process Agro data' }, { status: 500 });
  }
}