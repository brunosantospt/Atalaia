// The map under the fire, one profile at a time (settings drawer, key M). Each answers another
// question: the satellite what is on the ground, the roads how to get there, the chart where the
// paths, streams and ridges are, the contours how steep it is. The satellite is the viewer's own
// base layer; the others are added under the fire the first time and shown or hidden after that.

import {
  Color,
  Credit,
  type ImageryLayer,
  Material,
  UrlTemplateImageryProvider,
  type Viewer,
} from 'cesium'

export type MapId = 'satellite' | 'roads' | 'topo' | 'contours'

export const MAPS: { id: MapId; name: string; detail: string }[] = [
  { id: 'satellite', name: 'Satélite', detail: 'O que há no terreno: mato, eucalipto, casas' },
  { id: 'roads', name: 'Estradas', detail: 'Por onde se chega: rede viária e localidades' },
  { id: 'topo', name: 'Cartográfico', detail: 'A carta: caminhos, linhas de água, cotas' },
  { id: 'contours', name: 'Curvas de nível', detail: 'O relevo: de 20 em 20 m, mestras de 100 em 100 m' },
]

export const DEFAULT_MAP: MapId = 'satellite'

interface Tiles {
  url: string
  subdomains?: string
  maximumLevel: number
  credit: string
}

// Raster tiles in Web Mercator, no key needed. OpenStreetMap's own map for the roads: in the Minho
// it has the forest, the tracks and the streams that Esri's street map leaves out (CARTO's now asks
// for a key). OpenTopoMap reads like the military chart (1:25 000) the fire brigades carry.
const TILES: Partial<Record<MapId, Tiles>> = {
  roads: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    maximumLevel: 19,
    credit: 'Estradas © contribuidores do OpenStreetMap (ODbL)',
  },
  topo: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    subdomains: 'abc',
    maximumLevel: 17,
    credit: 'Carta © OpenTopoMap (CC-BY-SA) · dados © contribuidores do OpenStreetMap, SRTM',
  },
}

interface Look {
  brightness: number
  contrast: number
  saturation: number
  gamma: number
}

// The satellite keeps most of its colour where the spotlight falls (spotlight.ts greys the rest).
// Under the contours it steps back, so the lines read first.
const SATELLITE: Record<'satellite' | 'contours', Look> = {
  satellite: { brightness: 1.12, contrast: 1.02, saturation: 1.08, gamma: 1.12 }, // natural daylight colours under the spotlight
  contours: { brightness: 0.55, contrast: 1.1, saturation: 0.25, gamma: 1.0 },
}
// The maps are drawn for daylight; a touch darker, the HUD and the fire's amber still read over them.
const MAP_LOOK: Look = { brightness: 0.9, contrast: 1.05, saturation: 0.95, gamma: 1.0 }
// The light that shades the dark satellite (scene.ts) washes a paper map out; over one it only
// models the relief.
const MAP_LIGHT = 1.1

// Contour lines from the terrain's own heights, `width` pixels wide wherever they fall. A level
// fades out where its lines would come closer than about ten pixels, so zoomed out only the 100 m
// lines are left and the slopes stay legible.
const CONTOURS = /* glsl */ `
uniform vec4 minorColor;
uniform vec4 majorColor;
uniform float minorSpacing;
uniform float majorSpacing;
uniform float width;

float contourLine(float h, float spacing, float perPixel, float px) {
  float d = mod(h, spacing);
  d = min(d, spacing - d) / max(perPixel, 1e-6); // pixels to the nearest line
  float line = clamp(0.5 * px + 0.5 - d, 0.0, 1.0);
  return line * smoothstep(6.0, 12.0, spacing / max(perPixel, 1e-6));
}

czm_material czm_getMaterial(czm_materialInput materialInput) {
  czm_material material = czm_getDefaultMaterial(materialInput);
  float h = materialInput.height;
  float perPixel = max(abs(dFdx(h)), abs(dFdy(h))) * czm_pixelRatio;
  float minor = contourLine(h, minorSpacing, perPixel, width) * minorColor.a;
  float major = contourLine(h, majorSpacing, perPixel, width * 1.6) * majorColor.a;
  vec3 rgb = major >= minor ? majorColor.rgb : minorColor.rgb;
  vec4 color = czm_gammaCorrect(vec4(rgb, max(minor, major)));
  material.diffuse = color.rgb;
  material.alpha = color.a;
  return material;
}
`

export class Basemap {
  private readonly satellite: ImageryLayer
  private readonly maps = new Map<MapId, ImageryLayer>()
  private readonly contours: Material
  private readonly satelliteLight: number
  id: MapId = DEFAULT_MAP

  constructor(private readonly viewer: Viewer) {
    this.satellite = viewer.imageryLayers.get(0)
    this.satelliteLight = viewer.scene.light.intensity
    this.contours = new Material({
      fabric: {
        type: 'AtalaiaContours',
        uniforms: {
          minorColor: Color.fromCssColorString('#d9dcdf').withAlpha(0.32),
          majorColor: Color.fromCssColorString('#f2f3f4').withAlpha(0.85),
          minorSpacing: 20,
          majorSpacing: 100,
          width: 1.2,
        },
        source: CONTOURS,
      },
      translucent: true,
    })
  }

  set(id: MapId) {
    this.id = id
    const tiles = TILES[id]
    if (tiles && !this.maps.has(id)) this.maps.set(id, this.add(tiles))
    for (const [map, layer] of this.maps) layer.show = map === id
    this.satellite.show = !tiles
    if (!tiles) Object.assign(this.satellite, SATELLITE[id as keyof typeof SATELLITE])
    this.viewer.scene.light.intensity = tiles ? MAP_LIGHT : this.satelliteLight
    this.viewer.scene.globe.material = id === 'contours' ? this.contours : undefined
  }

  /** A tiled map just above the satellite, so every layer of the fire stays over it. */
  private add({ url, subdomains, maximumLevel, credit }: Tiles): ImageryLayer {
    const provider = new UrlTemplateImageryProvider({ url, subdomains, maximumLevel, credit: new Credit(credit) })
    const layer = this.viewer.imageryLayers.addImageryProvider(provider, 1)
    Object.assign(layer, MAP_LOOK)
    return layer
  }
}
