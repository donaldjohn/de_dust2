// HealthBar - 头顶血条 (3D, 跟随 bot 移动)
// 绿色 (满血) → 黄 (中) → 红 (残血)
// Bot 死了隐藏

import * as THREE from 'three';

export class HealthBar {
  group: THREE.Group;
  private bg: THREE.Mesh;       // 黑色背景条
  private fill: THREE.Mesh;     // 彩色填充条
  private fillMat: THREE.MeshBasicMaterial;
  private bgMat: THREE.MeshBasicMaterial;

  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'HealthBar';

    // 背景: 1.0 x 0.08
    this.bgMat = new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0.75, depthTest: false
    });
    this.bg = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.10), this.bgMat);
    this.bg.renderOrder = 996;
    this.group.add(this.bg);

    // 填充: 0.96 x 0.06, 默认满血绿色
    this.fillMat = new THREE.MeshBasicMaterial({
      color: 0x00FF40, transparent: true, opacity: 1.0, depthTest: false
    });
    this.fill = new THREE.Mesh(new THREE.PlaneGeometry(0.96, 0.06), this.fillMat);
    this.fill.position.z = 0.001;
    this.fill.renderOrder = 997;
    this.group.add(this.fill);

    // 默认位置: bot 头顶
    this.group.position.set(0, 2.2, 0);

    // 血条永远朝相机 (用 Sprite 模式做, 但 Sprite 不能"分段缩放"; 用 group + 锁定 rotation 也行)
    // 这里用 group 但每帧在 Game.update 里手动设 lookAt(camera)
  }

  setRatio(ratio: number) {
    ratio = Math.max(0, Math.min(1, ratio));
    // 缩放 fill
    this.fill.scale.x = ratio;
    // 位置调整: 让 fill 从左往右缩短时, 左端不动
    this.fill.position.x = -(1 - ratio) * 0.48;
    // 颜色: 绿 → 黄 → 红
    if (ratio > 0.6) this.fillMat.color.setHex(0x00FF40);
    else if (ratio > 0.3) this.fillMat.color.setHex(0xFFC800);
    else this.fillMat.color.setHex(0xFF3030);
  }

  setVisible(v: boolean) {
    this.group.visible = v;
  }

  dispose() {
    this.bg.geometry.dispose(); this.bgMat.dispose();
    this.fill.geometry.dispose(); this.fillMat.dispose();
  }
}
