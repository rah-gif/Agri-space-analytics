'use client';
import { useState } from 'react';
import dynamic from 'next/dynamic';

const SatelliteMap = dynamic(() => import('@/app/components/SatelliteMap'), { 
  ssr: false,
  loading: () => <div className="h-[600px] w-full bg-slate-100 animate-pulse flex items-center justify-center">Loading Engine...</div>
});

export default function Home() {
  const [farmData, setFarmData] = useState<any>(null);
  
  // State for the Secure Registration Vault
  const [farmerName, setFarmerName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [regStatus, setRegStatus] = useState('');

  // Function to lock data into Supabase
  const handleRegisterFarm = async () => {
    if (!farmerName || !phoneNumber) {
      setRegStatus('⚠️ Please enter both name and WhatsApp number.');
      return;
    }

    setIsRegistering(true);
    setRegStatus('Securely saving to vault...');

    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: farmerName,
          phone: phoneNumber,
          geojson: farmData.rawGeojson // Grabbing the exact shape drawn on the map
        })
      });

      const data = await res.json();
      
      if (data.success) {
        setRegStatus('✅ Farm successfully secured! Automation ready.');
        setFarmerName(''); 
        setPhoneNumber('');
      } else {
        setRegStatus('❌ Failed to save. Check database connection.');
      }
    } catch (error) {
      setRegStatus('❌ Network error.');
    } finally {
      setIsRegistering(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 p-4 md:p-8 font-sans">
      <div className="max-w-6xl mx-auto space-y-6">
        
        <header className="space-y-2">
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Agri-Space <span className="text-blue-600">Analytics</span></h1>
          <p className="text-slate-600">Downstream satellite monitoring for Sri Lankan Agriculture.</p>
        </header>

        {/* The Map Engine */}
        <section className="bg-white p-2 rounded-2xl shadow-xl border border-slate-200">
          <SatelliteMap onFarmAnalyzed={(data) => setFarmData(data)} />
        </section>

        {/* The Live Data Dashboard */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
            <h3 className="font-semibold text-slate-700 flex items-center gap-2">🌡️ Surface Temp</h3>
            <p className="text-3xl font-bold text-slate-800 mt-2">
              {farmData?.status === 'loading' ? '...' : farmData?.soil?.t0 ? `${(farmData.soil.t0 - 273.15).toFixed(1)}°C` : '--'}
            </p>
          </div>

          <div className={`p-4 rounded-xl border shadow-sm transition-colors ${
              !farmData?.soil?.moisture ? 'bg-white border-slate-200' :
              farmData.soil.moisture < 0.20 ? 'bg-red-50 border-red-200' : 
              farmData.soil.moisture < 0.30 ? 'bg-yellow-50 border-yellow-200' : 
              'bg-green-50 border-green-200'
            }`}>
            <h3 className="font-semibold text-slate-700 flex items-center gap-2">💧 Soil Moisture</h3>
            <p className={`text-3xl font-bold mt-2 ${!farmData?.soil?.moisture ? 'text-slate-800' : farmData.soil.moisture < 0.20 ? 'text-red-600' : farmData.soil.moisture < 0.30 ? 'text-yellow-600' : 'text-green-600'}`}>
              {farmData?.status === 'loading' ? '...' : farmData?.soil?.moisture ? `${farmData.soil.moisture} m³/m³` : '--'}
            </p>
          </div>

          <div className={`p-4 rounded-xl border shadow-sm flex flex-col justify-between transition-colors ${farmData?.weather?.willRain ? 'bg-blue-50 border-blue-300' : 'bg-white border-slate-200'}`}>
            <h3 className="font-semibold text-slate-700 flex items-center gap-2">{farmData?.weather?.willRain ? '🌧️ Rain Alert' : '☀️ 24-Hour Forecast'}</h3>
            <p className={`text-xl font-bold mt-2 ${farmData?.weather?.willRain ? 'text-blue-600' : 'text-slate-600'}`}>
              {farmData?.status === 'loading' ? 'Checking skies...' : farmData?.weather ? farmData.weather.description : '--'}
            </p>
          </div>
        </div>

        {/* THE AUTOMATION ONBOARDING FORM */}
        {farmData?.rawGeojson && (
          <div className="mt-8 bg-gradient-to-br from-blue-50 to-slate-100 border border-blue-200 rounded-2xl p-6 md:p-8 shadow-lg animate-in fade-in slide-in-from-bottom-4 duration-500">
            <h2 className="text-2xl font-bold text-slate-800 mb-2 flex items-center gap-2">
              🤖 Automate this Farm
            </h2>
            <p className="text-slate-600 mb-6 text-sm md:text-base">
              Enter details to receive daily AI-powered WhatsApp alerts for this specific plot of land. We will monitor the soil and weather for you.
            </p>
            
            <div className="flex flex-col md:flex-row gap-4">
              <input
                type="text"
                placeholder="Farmer Name (e.g. Amara)"
                className="flex-1 px-4 py-3 rounded-xl border border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
                value={farmerName}
                onChange={(e) => setFarmerName(e.target.value)}
              />
              <input
                type="tel"
                placeholder="WhatsApp Number (e.g. +9477...)"
                className="flex-1 px-4 py-3 rounded-xl border border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
              />
              <button
                onClick={handleRegisterFarm}
                disabled={isRegistering}
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded-xl shadow-md transition-all disabled:opacity-50 whitespace-nowrap"
              >
                {isRegistering ? 'Locking Vault...' : 'Save & Automate'}
              </button>
            </div>
            
            {regStatus && (
              <p className={`mt-4 text-sm font-semibold ${regStatus.includes('✅') ? 'text-green-600' : regStatus.includes('❌') ? 'text-red-600' : 'text-blue-600'}`}>
                {regStatus}
              </p>
            )}
          </div>
        )}

      </div>
    </main>
  );
}