import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: Request) {
  try {
    // 1. Receive the farmer's details from the frontend
    const { name, phone, geojson } = await req.json();

    // 2. Initialize the secure Supabase connection using your new keys
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!; // The master key!
    
    if (!supabaseUrl || !supabaseKey) {
        return NextResponse.json({ error: 'Database keys missing' }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // 3. Insert the data into your 'farms' table
    const { data, error } = await supabase
      .from('farms')
      .insert([
        { 
          farmer_name: name, 
          phone_number: phone, 
          polygon_data: geojson 
        }
      ]);

    if (error) {
        console.error("Supabase rejection:", error);
        return NextResponse.json({ error: 'Failed to save to database' }, { status: 400 });
    }

    // 4. Send success back to the dashboard
    return NextResponse.json({ success: true, message: 'Farm secured in the vault!' });

  } catch (error) {
    console.error("Server Error:", error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}