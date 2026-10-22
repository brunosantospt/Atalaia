import { Cartesian2, Cartesian3, Color, CustomDataSource, PolylineArrowMaterialProperty, SceneTransforms, type Viewer } from 'cesium'
import type { Weather } from './data'
import { compass, destination, type LonLat } from './geo'
import { fmtNumber } from './format'

/** Meteorological direction is where wind comes FROM; the map arrow points where it blows TO. */
export function windAt(weather: Weather, startIndex: number, minutes: number) {
  const h = Math.max(0, startIndex+minutes/60), i = Math.min(Math.floor(h), weather.time.length-1), j = Math.min(i+1, weather.time.length-1)
  const k = h-Math.floor(h), turn = ((weather.windFromDeg[j]-weather.windFromDeg[i]+540)%360)-180
  return { from: (weather.windFromDeg[i]+turn*k+360)%360, kmh: weather.windKmh[i]+(weather.windKmh[j]-weather.windKmh[i])*k,
    gust: weather.gustKmh[i]+(weather.gustKmh[j]-weather.gustKmh[i])*k }
}
export class WindLayer {
  private source = new CustomDataSource('wind-arrow')
  private label = document.createElement('div')
  private key = ''
  private weather?: Weather
  private anchor: Cartesian3
  private pixel = new Cartesian2()
  private remove: () => void
  constructor(private viewer: Viewer, parent: HTMLElement, private ignition: LonLat) {
    viewer.dataSources.add(this.source)
    this.anchor = Cartesian3.fromDegrees(ignition.lon, ignition.lat)
    this.label.className = 'wind-readout'; this.label.hidden = true
    parent.append(this.label)
    this.remove = viewer.scene.postRender.addEventListener(() => {
      const p = SceneTransforms.worldToWindowCoordinates(viewer.scene, this.anchor, this.pixel)
      const show = !!p && p.x>0 && p.y>0 && p.x<viewer.scene.canvas.clientWidth && p.y<viewer.scene.canvas.clientHeight
      this.label.hidden = !show
      if (show) this.label.style.transform = `translate(${Math.round(p.x+14)}px, ${Math.round(p.y-12)}px)`
    })
  }
  update(weather: Weather, start: number, minute: number) {
    const key = `${start}:${Math.round(minute)}`
    if (this.weather===weather && this.key===key) return
    this.weather=weather;this.key=key
    const wind=windAt(weather,start,minute), to=(wind.from+180)%360
    const centre=destination(this.ignition,45,500), length=Math.min(650,180+wind.kmh*13)
    const tail=destination(centre,to+180,length/2), tip=destination(centre,to,length/2)
    this.anchor=Cartesian3.fromDegrees(tip.lon,tip.lat)
    this.source.entities.removeAll()
    this.source.entities.add({polyline:{positions:[Cartesian3.fromDegrees(tail.lon,tail.lat),this.anchor],width:13,clampToGround:true,
      material:new PolylineArrowMaterialProperty(Color.fromCssColorString('#b9e7ff').withAlpha(.95))}})
    this.label.textContent=`Vento ${fmtNumber(wind.kmh)} km/h · de ${compass(wind.from)}`
    this.label.title=`Seta aponta para onde o vento sopra · rajadas ${fmtNumber(wind.gust)} km/h`
    this.viewer.scene.requestRender()
  }
  destroy(){this.remove();this.source.entities.removeAll();this.viewer.dataSources.remove(this.source,true);this.label.remove()}
}
