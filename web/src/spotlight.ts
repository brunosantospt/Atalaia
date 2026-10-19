// Spotlight: a post-process that dims and desaturates everything further than a radius from
// the area in play, sky included. Distances are measured in 3D from the depth buffer, so the
// light falls on the relief and not on a flat disc on the screen.

import { Cartesian3, Matrix4, PostProcessStage, type Scene } from 'cesium'
import type { LonLat } from './geo'

const FRAGMENT = /* glsl */ `
uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
uniform vec3 u_centerEC;
uniform float u_radius;
uniform float u_strength;
in vec2 v_textureCoordinates;

void main() {
  vec4 color = texture(colorTexture, v_textureCoordinates);
  float depth = texture(depthTexture, v_textureCoordinates).r;
  float d = 1.0e12; // nothing drawn here: space counts as far away
  if (depth < 1.0) {
    // Takes the raw (log) depth; czm_readDepth would undo the log a second time.
    vec4 eye = czm_windowToEyeCoordinates(gl_FragCoord.xy, depth);
    d = distance(eye.xyz / eye.w, u_centerEC);
  }
  float k = smoothstep(u_radius, u_radius * 1.5, d) * u_strength;
  float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
  vec3 outside = mix(vec3(luma), color.rgb, 0.25) * 0.38;
  out_FragColor = vec4(mix(color.rgb, outside, k), color.a);
}
`

export class Spotlight {
  private readonly stage: PostProcessStage
  private readonly centerWC = new Cartesian3()
  private readonly centerEC = new Cartesian3()
  private radius = 1e7
  strength = 1

  constructor(private readonly scene: Scene) {
    this.stage = new PostProcessStage({
      name: 'atalaia_spotlight',
      fragmentShader: FRAGMENT,
      uniforms: {
        u_centerEC: () => this.centerEC,
        u_radius: () => this.radius,
        u_strength: () => this.strength,
      },
    })
    scene.postProcessStages.add(this.stage)
    // The centre moves with the camera, so it is put in eye coordinates just before each render.
    scene.preRender.addEventListener(() =>
      Matrix4.multiplyByPoint(scene.camera.viewMatrix, this.centerWC, this.centerEC),
    )
  }

  set(center: LonLat & { h: number }, radius: number) {
    Cartesian3.fromDegrees(center.lon, center.lat, center.h, undefined, this.centerWC)
    this.radius = radius
  }

  destroy() {
    this.scene.postProcessStages.remove(this.stage)
  }
}
