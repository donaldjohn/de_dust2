import * as THREE from 'three';

/**
 * Procedural skybox for the desert map.
 * Inverted sphere with a custom shader that produces:
 * - top: hazy desert blue0x9CB7C8
 * - mid: sand horizon haze0xC2A26B
 * - bottom: yellow sand0xB89A6F
 * Optionally follows the camera and exposes uTime for subtle dust drift.
 */
export class Sky {
 mesh: THREE.Mesh;

 private _uniforms: {
 uTopColor: { value: THREE.Color };
 uHorizonColor: { value: THREE.Color };
 uBottomColor: { value: THREE.Color };
 uTime: { value: number };
 };

 constructor(scene: THREE.Scene) {
 const geometry = new THREE.SphereGeometry(800,32,32);

 this._uniforms = {
 uTopColor: { value: new THREE.Color(0x9CB7C8) },
 uHorizonColor: { value: new THREE.Color(0xC2A26B) },
 uBottomColor: { value: new THREE.Color(0xB89A6F) },
 uTime: { value:0 }
 };

 const material = new THREE.ShaderMaterial({
 uniforms: this._uniforms,
 side: THREE.BackSide,
 depthWrite: false,
 fog: false,
 vertexShader: /* glsl */ `
 varying vec3 vWorldPos;

 void main() {
 vec4 worldPosition = modelMatrix * vec4(position,1.0);
 vWorldPos = worldPosition.xyz;
 gl_Position = projectionMatrix * viewMatrix * worldPosition;
 }
 `,
 fragmentShader: /* glsl */ `
 uniform vec3 uTopColor;
 uniform vec3 uHorizonColor;
 uniform vec3 uBottomColor;
 uniform float uTime;

 varying vec3 vWorldPos;

 // Cheap value noise for subtle dust drift in the haze band.
 float hash(vec2 p) {
 return fract(sin(dot(p, vec2(127.1,311.7))) *43758.5453);
 }
 float vnoise(vec2 p) {
 vec2 i = floor(p);
 vec2 f = fract(p);
 float a = hash(i);
 float b = hash(i + vec2(1.0,0.0));
 float c = hash(i + vec2(0.0,1.0));
 float d = hash(i + vec2(1.0,1.0));
 vec2 u = f * f * (3.0 -2.0 * f);
 return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
 }

 void main() {
 // Normalised vertical coordinate on the inverted sphere.
 // h =1 at zenith,0 at horizon, -1 at nadir.
 float h = normalize(vWorldPos).y;

 // Horizon haze band: thicker and slightly animated for dust feel.
 float band = exp(-pow(h *4.0,2.0));
 float dustDrift = vnoise(vec2(atan(vWorldPos.z, vWorldPos.x) *6.0, uTime *0.05));
 band = clamp(band + (dustDrift -0.5) *0.15,0.0,1.0);

 // Sky gradient: top -> horizon (with haze band) -> bottom.
 vec3 sky = mix(uHorizonColor, uTopColor, smoothstep(0.0,0.55, h));
 vec3 lower = mix(uBottomColor, uHorizonColor, smoothstep(-0.4,0.0, h));
 vec3 col = h >=0.0 ? sky : lower;

 // Blend the haze band over the gradient near the horizon.
 col = mix(col, uHorizonColor *1.05, band *0.65);

 // Slight brightness lift at the horizon to sell the haze.
 col += band * vec3(0.06,0.05,0.03);

 gl_FragColor = vec4(col,1.0);
 }
 `
 });

 this.mesh = new THREE.Mesh(geometry, material);
 this.mesh.name = 'Sky';
 this.mesh.frustumCulled = false; // skybox should never be culled

 scene.add(this.mesh);
 }

 /**
 * Update the skybox. Follows the camera so the player never reaches the edge.
 */
 update(dt: number, camera?: THREE.Camera): void {
 this._uniforms.uTime.value += dt;
 if (camera) {
 this.mesh.position.set(camera.position.x, camera.position.y, camera.position.z);
 }
 }
}
