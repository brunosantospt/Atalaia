// The Cesium viewer in the "intel" look: dark, desaturated imagery over relief, black space,
// and one fixed light from the north-west so the terrain reads like a shaded-relief map.

import {
  Cartesian3,
  Color,
  createWorldTerrainAsync,
  DirectionalLight,
  Ion,
  Matrix4,
  Transforms,
  Viewer,
} from 'cesium'
import type { LonLat } from './geo'

const LIGHT_FROM_DEG = 315 // azimuth the light comes from (NW, as on printed relief maps)
const LIGHT_ELEVATION_DEG = 35

export async function createViewer(container: string, center: LonLat): Promise<Viewer> {
  const token = import.meta.env.VITE_CESIUM_ION_TOKEN
  if (token) Ion.defaultAccessToken = token

  const viewer = new Viewer(container, {
    terrainProvider: await createWorldTerrainAsync(),
    animation: false,
    timeline: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
  })

  const { scene } = viewer
  // Fire perimeters and markers sit on the ground and must hide behind the relief.
  scene.globe.depthTestAgainstTerrain = true

  // Space is black: no stars, sun, moon or atmosphere glow.
  scene.backgroundColor = Color.BLACK
  scene.globe.baseColor = Color.BLACK
  if (scene.skyBox) scene.skyBox.show = false
  if (scene.sun) scene.sun.show = false
  if (scene.moon) scene.moon.show = false
  if (scene.skyAtmosphere) scene.skyAtmosphere.show = false
  scene.globe.showGroundAtmosphere = false
  scene.fog.enabled = false

  // Imagery pushed back so the fire is the only strong colour on screen; the spotlight dims
  // everything outside the area in play further still.
  const imagery = viewer.imageryLayers.get(0)
  imagery.brightness = 0.8
  imagery.contrast = 1.25
  imagery.saturation = 0.22
  imagery.gamma = 1.1

  scene.globe.enableLighting = true
  scene.globe.dynamicAtmosphereLighting = false
  scene.light = new DirectionalLight({ direction: lightDirection(center), intensity: 2.2 })

  return viewer
}

/** Direction the light travels, in Earth-fixed coordinates, for a light standing NW of `center`. */
function lightDirection(center: LonLat): Cartesian3 {
  const az = (LIGHT_FROM_DEG * Math.PI) / 180
  const el = (LIGHT_ELEVATION_DEG * Math.PI) / 180
  // Towards the light in east-north-up, then flipped: the light shines from there onto the ground.
  const towardLight = new Cartesian3(Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el))
  const enu = Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(center.lon, center.lat))
  const fixed = Matrix4.multiplyByPointAsVector(enu, towardLight, new Cartesian3())
  return Cartesian3.normalize(Cartesian3.negate(fixed, fixed), fixed)
}
