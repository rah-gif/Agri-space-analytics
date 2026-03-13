'use client';
import { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, LayersControl, Marker, Popup, FeatureGroup } from 'react-leaflet';
import { EditControl } from 'react-leaflet-draw';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css'; // The new CSS for the drawing tools
import L from 'leaflet';

// Fix for default map pins
const defaultIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
});

// Math helper for distance
function getDistanceInKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; 
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); 
  return Math.round(R * c);
}

export default function SatelliteMap({ onFarmAnalyzed }: { onFarmAnalyzed: (data: any) => void }) {
  const srilankaPos: [number, number] = [7.8731, 80.7718]; 
  const [events, setEvents] = useState<any[]>([]);

  useEffect(() => {
    async function getNASAEvents() {
      try {
        const response = await fetch('/api/events');
        const data = await response.json();
        if (data.events) setEvents(data.events);
      } catch (error) {
        console.error("Error fetching events:", error);
      }
    }
    getNASAEvents();
  }, []);

  // ARCHITECT ADDITION: This function fires exactly when the user finishes drawing their farm!
// 2. Update the shape creation function
  const onShapeCreated = async (e: any) => {
    const { layerType, layer } = e;
    if (layerType === 'polygon' || layerType === 'rectangle') {
      const geojson = layer.toGeoJSON();
      
      // Tell the dashboard we are fetching data!
      onFarmAnalyzed({ status: 'loading' }); 
      
      try {
        // Send the coordinates to our Next.js backend
        const res = await fetch('/api/agro', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ geojson })
        });
        
        if (!res.ok) {
          const errData = await res.json();
          const apiMessage = errData.details?.message || errData.error || 'Failed to analyze farm';
          alert(`Farm Analysis Failed 🚨\n\n${apiMessage}\n\nTip: You need to draw a larger farm area (at least 1 hectare).`);
          onFarmAnalyzed({ status: 'error' });
          // If the API rejects it, automatically remove the invalid drawing from the map
          if (layer._map) layer._map.removeLayer(layer);
          return;
        }
        
        const data = await res.json();
        
        // Combine API data with the raw geometric shape for automation later
        const finalData = { ...data, rawGeojson: geojson.geometry };
        
        // MULTI-FARM SUPPORT: Store data on the layer itself!
        layer.farmData = finalData;
        
        // Make the shape clickable so the dashboard updates when they click it!
        layer.on('click', () => {
          onFarmAnalyzed(layer.farmData);
        });
        
        // Add a nice hover tooltip
        layer.bindTooltip("Farm Plot<br><span class='text-xs text-slate-500'>Click to view data</span>", { direction: 'center', className: 'text-center' });
        
        // Send the final processed data back up to the dashboard cards!
        onFarmAnalyzed(finalData);  
      } catch (error) {
        console.error("Failed to analyze farm:", error);
      }
    }
  };

  const onShapeDeleted = () => {
    // Tell the dashboard to clear the data
    onFarmAnalyzed(null);
  };

  const onShapeEdited = async (e: any) => {
    // When a user drags the corners of existing shapes and saves
    const { layers } = e;
    
    // We loop through EVERY edited layer (since they can edit multiple before pushing 'save')
    layers.eachLayer(async (layer: any) => {
      const geojson = layer.toGeoJSON();
      onFarmAnalyzed({ status: 'loading' }); 
      
      try {
        const res = await fetch('/api/agro', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ geojson })
        });
        
        if (!res.ok) {
          const errData = await res.json();
          const apiMessage = errData.details?.message || errData.error || 'Failed to analyze edited farm';
          alert(`Farm Analysis Failed 🚨\n\n${apiMessage}\n\nTip: You need a larger farm area.`);
          onFarmAnalyzed({ status: 'error' });
          return;
        }
        
        const data = await res.json();
        
        // Combine API data with the raw geometric shape for automation later
        const finalData = { ...data, rawGeojson: geojson.geometry };
        
        // MULTI-FARM SUPPORT: Update the stored data on this specific layer
        layer.farmData = finalData;
        
        // Make sure click behavior is intact
        layer.off('click'); // remove old
        layer.on('click', () => {
          onFarmAnalyzed(layer.farmData);
        });

        onFarmAnalyzed(finalData); 
      } catch (error) {
        console.error("Failed to analyze edited farm:", error);
      }
    });
  };

  return (
    <div className="h-[600px] w-full rounded-xl overflow-hidden shadow-2xl border-2 border-slate-800">
      <MapContainer center={srilankaPos} zoom={7} style={{ height: '100%', width: '100%' }}>
        
<LayersControl position="topright">
          {/* Layer 1: Standard Street Map */}
          <LayersControl.BaseLayer name="Street Map">
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; OpenStreetMap' />
          </LayersControl.BaseLayer>

          {/* Layer 2: High-Resolution Hybrid Map (For Farmers to Draw) */}
          <LayersControl.BaseLayer checked name="High-Res Satellite (Draw Here)">
            <FeatureGroup>
              {/* The high-res satellite ground imagery */}
              <TileLayer
                attribution='Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                maxZoom={19} // Allows deep zoom without white squares!
              />
              {/* A transparent layer of city/street names floating on top */}
              <TileLayer
                url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png"
                attribution='&copy; CartoDB'
                maxZoom={19}
              />
            </FeatureGroup>
          </LayersControl.BaseLayer>

          {/* Layer 3: NASA Macro Weather (For viewing large storms/clouds) */}
          <LayersControl.BaseLayer name="NASA Weather View">
            <TileLayer
              attribution='NASA GIBS'
              url="https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/2026-03-10/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg"
              maxNativeZoom={9} // Prevents the white square crash
              maxZoom={19}      // Stretches the pixels if you zoom past level 9
            />
          </LayersControl.BaseLayer>
        </LayersControl>

        {/* ARCHITECT ADDITION: The Drawing Toolbar */}
        <FeatureGroup>
          <EditControl
            position="topleft"
            onCreated={onShapeCreated}
            onDeleted={onShapeDeleted}
            onEdited={onShapeEdited}
            draw={{
              polyline: false, // We don't need lines
              circle: false,   // We don't need circles
              circlemarker: false,
              marker: false,   // We don't need single points
              polygon: true,   // YES: Freeform farm shapes
              rectangle: true, // YES: Square farm plots
            }}
          />
        </FeatureGroup>

        {/* Existing NASA Event Markers */}
        {events.map((event) => {
          if (!event.geometry || event.geometry.length === 0) return null;
          const latestLocation = event.geometry[event.geometry.length - 1];
          if (latestLocation.type !== 'Point') return null;
          const [lon, lat] = latestLocation.coordinates; 
          const distanceToSL = getDistanceInKm(srilankaPos[0], srilankaPos[1], lat, lon);
          
          if (distanceToSL > 1500) return null;

          return (
            <Marker key={event.id} position={[lat, lon]} icon={defaultIcon}>
              <Popup>
                <div className="font-sans min-w-[150px]">
                  <strong className="text-red-600 block mb-1">{event.categories[0]?.title}</strong>
                  <span className="text-slate-700 text-sm font-medium block mb-2">{event.title}</span>
                  <span className="text-xs bg-slate-100 px-2 py-1 rounded-md border border-slate-200">
                    {distanceToSL} km from Sri Lanka
                  </span>
                </div>
              </Popup>
            </Marker>
          );
        })}

      </MapContainer>
    </div>
  );
}