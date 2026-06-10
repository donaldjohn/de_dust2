import * as THREE from 'three';

/**
 * Lighting manager for the de_dust2 desert map.
 * Middle-east afternoon: strong but slightly hazy sunlight.
 */
export class Lighting {
 group: THREE.Group;
 sun: THREE.DirectionalLight;
 ambient: THREE.AmbientLight;
 hemi: THREE.HemisphereLight;

 // 时间控制 (简化:固定下午)
 timeOfDay: number =16; //24小时制

 private _baseSunIntensity: number;
 private _dustPhase: number;

 constructor(scene: THREE.Scene) {
 this.group = new THREE.Group();
 this.group.name = 'Lighting';

 // ---- Sun (DirectionalLight) ----
 this.sun = new THREE.DirectionalLight(0xffe8c0, 1.6);  // 提亮一些
 this.sun.position.set(50,100,30); //偏东南,下午
 this.sun.castShadow = true;
 this.sun.shadow.mapSize.set(2048,2048);
 this.sun.shadow.camera.left = -150;
 this.sun.shadow.camera.right =150;
 this.sun.shadow.camera.top =150;
 this.sun.shadow.camera.bottom = -150;
 this.sun.shadow.camera.near =1;
 this.sun.shadow.camera.far =400;
 this.sun.shadow.bias = -0.0005;
 this.sun.shadow.normalBias =0.02;

 // ---- Ambient ----
 this.ambient = new THREE.AmbientLight(0xfff4d0, 0.5);  // 提亮一些

 // ---- Hemisphere ----
 this.hemi = new THREE.HemisphereLight(0xb8d4e8,0xc2a26b,0.5);

 this.group.add(this.sun);
 this.group.add(this.ambient);
 this.group.add(this.hemi);

 this._baseSunIntensity = this.sun.intensity;
 this._dustPhase =0;

 scene.add(this.group);
 }

 build(): void {
 // Constructor already adds the group to the scene; build is a no-op
 // kept to match the documented interface.
 }

 update(dt: number): void {
 // 微调:沙尘扰动让阳光强度有微弱波动,模拟午后沙尘感
 this._dustPhase += dt *0.35;
 const dustJitter = Math.sin(this._dustPhase) *0.04 + Math.sin(this._dustPhase *2.3) *0.02;
 this.sun.intensity = this._baseSunIntensity + dustJitter;

 // 让 sun跟随场景 (可选, 这里保持位置固定表示固定下午)
 // 若以后要做日夜循环, 可基于 timeOfDay重新计算 sun.position
 }
}
