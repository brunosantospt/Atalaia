import { Cartesian3, Ion, Math as CesiumMath, Terrain, Viewer } from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import './style.css'

const ionToken = import.meta.env.VITE_CESIUM_ION_TOKEN
if (ionToken) Ion.defaultAccessToken = ionToken

// Monte da Penha, Guimarães (617 m): the reference point for the whole twin.
const PENHA = { lon: -8.2683, lat: 41.4256 }

const viewer = new Viewer('globe', {
  terrain: Terrain.fromWorldTerrain(),
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

// Fire perimeters and units are drawn on the ground, so they must be hidden behind relief.
viewer.scene.globe.depthTestAgainstTerrain = true

// Oblique view from the south-west: Penha in the foreground, the Minho fires further north-east.
viewer.camera.setView({
  destination: Cartesian3.fromDegrees(PENHA.lon - 0.07, PENHA.lat - 0.055, 3500),
  orientation: {
    heading: CesiumMath.toRadians(35),
    pitch: CesiumMath.toRadians(-20),
    roll: 0,
  },
})
