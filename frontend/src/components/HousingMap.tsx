import { useEffect, useMemo, useRef } from 'react'
import L from 'leaflet'
import type { GeoJsonObject } from 'geojson'
import { GeoJSON as GeoJSONLayer, MapContainer, CircleMarker, TileLayer, Tooltip, useMap } from 'react-leaflet'
import type { Area, Bedroom, FeatureCollection, HousingProperties, StationProperties } from '../types/api'
import { dollars, rentFieldFor } from '../lib/preferences'

interface Props {
  areas: Area[]
  housing: FeatureCollection<HousingProperties>
  stations: FeatureCollection<StationProperties>
  eligibleIds: Set<string>
  selectedId: string | null
  comparedIds: string[]
  resetKey: number
  bedrooms: Bedroom
  showStations: boolean
  onSelect: (id: string) => void
}

function MapFocus({ housing, selectedId, resetKey }: { housing: FeatureCollection<HousingProperties>; selectedId: string | null; resetKey: number }) {
  const map = useMap()
  const fitted = useRef(false)
  useEffect(() => {
    if (!fitted.current) {
      map.fitBounds(L.geoJSON(housing as GeoJsonObject).getBounds(), { padding: [24, 24] })
      fitted.current = true
    }
  }, [housing, map])
  useEffect(() => {
    if (resetKey > 0) map.fitBounds(L.geoJSON(housing as GeoJsonObject).getBounds(), { padding: [24, 24], animate: true })
  }, [housing, map, resetKey])
  useEffect(() => {
    if (!selectedId) return
    const feature = housing.features.find(f => f.properties.area_id === selectedId)
    if (feature) map.flyToBounds(L.geoJSON(feature as GeoJsonObject).getBounds(), { padding: [70, 70], maxZoom: 12, duration: 0.7 })
  }, [housing, map, selectedId])
  return null
}

export function HousingMap({ areas, housing, stations, eligibleIds, selectedId, comparedIds, resetKey, bedrooms, showStations, onSelect }: Props) {
  const areaById = useMemo(() => new Map(areas.map(a => [a.area_id, a])), [areas])
  const selectedFeature = housing.features.find(f => f.properties.area_id === selectedId)
  const workplace = areas[0]
  return <div className="relative h-[440px] overflow-hidden rounded-2xl border border-line bg-[#e9efeb] md:h-[570px] xl:h-[calc(100vh-240px)] xl:min-h-[570px]" aria-label="Chicago housing map">
    <MapContainer center={[41.86, -87.68]} zoom={10} scrollWheelZoom={false} className="h-full w-full" zoomControl={false}>
      <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' maxZoom={18}/>
      <GeoJSONLayer key={`${bedrooms}-${[...eligibleIds].sort().join(',')}`} data={housing as GeoJsonObject} style={feature => {
        const id = (feature?.properties as HousingProperties | undefined)?.area_id
        const eligible = id ? eligibleIds.has(id) : false
        return { color: eligible ? '#ffffff' : '#b7c5be', weight: eligible ? 1.5 : 1, fillColor: eligible ? '#6ba995' : '#c8d2ca', fillOpacity: eligible ? 0.67 : 0.55 }
      }} onEachFeature={(feature, layer) => {
        const id = (feature.properties as HousingProperties).area_id
        const area = areaById.get(id)
        layer.bindTooltip(`<strong>ZIP ${area?.zip_code ?? id.slice(5)}</strong><br>HUD rent benchmark: ${dollars(area?.[rentFieldFor(bedrooms)])}`, { sticky: true, direction: 'top' })
        layer.on('click', () => onSelect(id))
      }}/>
      {comparedIds.filter(id => id !== selectedId).map(id => {
        const feature = housing.features.find(item => item.properties.area_id === id)
        return feature ? <GeoJSONLayer key={`compared-${id}`} data={feature as GeoJsonObject} interactive={false} style={{ color: '#536c8b', weight: 4, dashArray: '6 4', fillOpacity: 0.08, fillColor: '#536c8b' }}/> : null
      })}
      {selectedFeature && <GeoJSONLayer key={`selected-${selectedId}`} data={selectedFeature as GeoJsonObject} interactive={false} style={{ color: '#134d42', weight: 4, fillColor: '#e4bb77', fillOpacity: 0.55 }}/ >}
      {showStations && stations.features.map(station => {
        const coords = station.geometry.coordinates as number[]
        return <CircleMarker key={station.properties.station_id} center={[coords[1], coords[0]]} radius={4} pathOptions={{ color: '#ffffff', weight: 1.5, fillColor: '#356a85', fillOpacity: 0.95 }}><Tooltip>{station.properties.station_name}</Tooltip></CircleMarker>
      })}
      {workplace && <CircleMarker center={[workplace.workplace_latitude, workplace.workplace_longitude]} radius={8} pathOptions={{ color: '#ffffff', weight: 2, fillColor: '#d48657', fillOpacity: 1 }}><Tooltip permanent direction="top" offset={[0, -5]}>Chicago Loop</Tooltip></CircleMarker>}
      <MapFocus housing={housing} selectedId={selectedId} resetKey={resetKey}/>
    </MapContainer>
    <div className="pointer-events-none absolute bottom-7 left-3 z-[400] rounded-xl border border-line bg-white/95 px-3 py-2.5 text-sm text-ink shadow-sm"><div className="font-bold">Map key</div><div className="mt-1.5 flex items-center gap-2"><span className="h-3 w-3 rounded-sm bg-[#6ba995]"/>Meets requirements</div><div className="mt-1 flex items-center gap-2"><span className="h-3 w-3 rounded-sm bg-[#c8d2ca]"/>Outside requirements</div><div className="mt-1 flex items-center gap-2"><span className="h-3 w-3 rounded-sm bg-[#e4bb77]"/>Selected area</div><div className="mt-1 flex items-center gap-2"><span className="h-3 w-3 rounded-sm border-2 border-dashed border-[#536c8b]"/>In comparison</div></div>
  </div>
}
