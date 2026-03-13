import { NextResponse } from 'next/server';

export async function GET() {
  // We grab the key from your .env.local file
  const NASA_KEY = process.env.NEXT_PUBLIC_NASA_API_KEY; 
  
  // We only fetch "open" (currently active) events
  const url = `https://eonet.gsfc.nasa.gov/api/v3/events?status=open&api_key=${NASA_KEY || 'DEMO_KEY'}`;
  
  try {
    const res = await fetch(url);
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch NASA data' }, { status: 500 });
  }
}