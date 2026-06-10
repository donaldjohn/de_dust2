// Game.ts - 主调度: 整合所有模块
// 职责: 启动 three.js, 创建场景/玩家/Bot/武器/比赛, 帧循环, 事件分发
import * as THREE from 'three';

import {
  AABB, Team, WeaponId, RoundPhase, PlayerState, WeaponInstance,
  CONFIG, MatchScore, BombSite, BulletHit
} from './types';
import { bus } from './utils/events';
import { rand, dist2, formatTime, choice, vec3ToArr, vec3ToXYZ } from './utils/util';

// 场景
import { Map as DustMap } from './scene/Map';
import { Lighting } from './scene/Lighting';
import { Sky } from './scene/Sky';

// 玩家
import { PlayerController } from './player/Player';
import { Input } from './player/Controls';

// 武器
import { WeaponSystem, ShootContext, ShootTarget } from './weapons/WeaponSystem';
import { WEAPONS } from './weapons/weapons.db';

// 比赛
import { Match, WorldSnapshot } from './gameplay/Match';
import { Bot, BotWorld, BotState } from './gameplay/Bot';

// UI
import { HUD, MatchInfo } from './ui/HUD';
import { BuyMenu } from './ui/BuyMenu';

const LOCAL_PLAYER_ID = 'player-local';

export class Game {
  // three.js
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private canvas: HTMLCanvasElement;
  private clock: THREE.Clock;

  // 模块
  private map!: DustMap;
  private lighting!: Lighting;
  private sky!: Sky;
  private input!: Input;
  private player!: PlayerController;
  private weapons!: WeaponSystem;
  private match!: Match;
  private hud!: HUD;
  private buyMenu!: BuyMenu;

  // Bots
  private bots: Bot[] = [];
  private botTargetMap = new Map<string, Bot>();   // bot id -> Bot
  private botGroup = new THREE.Group();

  // 视图模型
  private viewmodelGroup = new THREE.Group();
  private viewmodelCamera = new THREE.PerspectiveCamera(75, 1, 0.1, 100);

  // 状态
  private lastTime = 0;
  private running = false;
  private roundEndTimer = 0;          // 回合结束后等待秒数
  private plantingPlayerId: string | null = null;
  private defusingPlayerId: string | null = null;
  private plantProgress = 0;
  private defuseProgress = 0;
  private localPlayerHasBomb = false;  // T 的 local player 是否持炸弹

  // 调试
  private fpsCounter = { frames: 0, last: 0, value: 0 };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;  // 提亮一些

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0xC2A26B, 0.0020);  // 较稀薄, 看远

    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000);
    this.viewmodelCamera.position.set(0, 0, 0);
    this.viewmodelCamera.updateProjectionMatrix();
    this.viewmodelCamera.updateMatrixWorld();
    // 视图模型独立渲染, 加到 renderer 时独立处理
    this.clock = new THREE.Clock();

    this.setupResize();
    this.setupModules();
    this.setupEvents();
    this.startMatch();
  }

  private setupResize() {
    window.addEventListener('resize', () => {
      const w = window.innerWidth, h = window.innerHeight;
      this.renderer.setSize(w, h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    });
  }

  private setupModules() {
    // 1) 地图
    this.map = new DustMap();
    this.map.build();
    // 把地图的 scene 内容 merge 进来 (注意: Map 自带 scene, 我们用其 colliders/spawns/sites, 可视对象也要加入)
    // 跳过 Map 自带的 skydome (我们用 Sky.ts 的 shader skybox)
    this.map.scene.children.forEach(c => {
      // Map 的 skydome 是个 SphereGeometry(MeshBasicMaterial), 移除
      if ((c as any).geometry instanceof THREE.SphereGeometry &&
          (c as any).material instanceof THREE.MeshBasicMaterial) {
        return;
      }
      this.scene.add(c);
    });

    // 2) 灯光/天空
    this.lighting = new Lighting(this.scene);
    this.sky = new Sky(this.scene);

    // 3) 输入
    this.input = new Input(this.canvas);
    this.input.consumeKey('KeyT'); // 预热

    // 4) HUD + 买枪
    this.hud = new HUD(document.getElementById('hud')!);
    this.buyMenu = new BuyMenu(document.getElementById('menu')!);
    this.buyMenu.onBuy = (id) => {
      if (!this.localPlayerHasBomb) {
        // CT 或 T 未持弹: 走买枪逻辑
        if (this.match.buyWeapon(LOCAL_PLAYER_ID, id)) {
          // 同步玩家武器
          const w = this.match.players.get(LOCAL_PLAYER_ID)!.weapons;
          this.player.setWeapons(w);
          this.player.setActiveWeaponIndex(w.length - 1);
        }
      } else {
        this.hud.showMessage('Drop the bomb first (G)');
      }
    };
    this.buyMenu.onClose = () => {
      this.hud.setBuyMenuOpen(false);
      this.requestPointerLock();
    };

    // 5) Bots 容器
    this.scene.add(this.botGroup);

    // 6) 创建玩家 + 比赛 + Bots
    this.createPlayer();
    this.createBots();
    this.createMatch();
    this.spawnAll();

    // 7) 武器系统
    this.weapons = new WeaponSystem();
    this.weapons.init(this.player.state.weapons);
    this.weapons.onFire = (wid, origin, dir) => {
      // 显示曳光弹
      const stat = this.weapons.weapons[this.weapons.activeIndex]?.stats;
      if (stat) {
        const tr = (this.weapons as any)._tracer;
        if (tr) tr.fire(
          new THREE.Vector3(origin[0], origin[1], origin[2]),
          new THREE.Vector3(dir[0], dir[1], dir[2]).normalize(),
          stat.range
        );
      }
    };
    this.weapons.onHit = (hit) => this.handleHit(hit);

    // 8) 视图模型挂载
    this.scene.add(this.viewmodelGroup);
  }

  private createPlayer() {
    // 玩家始终是 T 队伍 (与原 CS 一致, 也可提供阵营选择)
    this.player = new PlayerController(this.camera, Team.T, 'You');
    const weapons = this.makeDefaultWeapons(Team.T);
    this.player.setWeapons(weapons);
    // 默认装备手枪 (index 1), 刀是 index 0
    this.player.setActiveWeaponIndex(weapons.length > 1 ? 1 : 0);
    this.player.onShoot = (origin, dir) => {
      // 走武器系统开火
      this.weapons.startFire();
      this.weapons.stopFire();   // 一次性点击
    };
    this.player.onPlantStart = () => {
      this.tryStartPlant();
    };
    this.player.onReloadStart = () => {
      this.weapons.reload();
    };
    // 鼠标右键瞄准
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 2) this.weapons.setAiming(true);
    });
    this.canvas.addEventListener('mouseup', (e) => {
      if (e.button === 2) this.weapons.setAiming(false);
    });
    this.canvas.addEventListener('contextmenu', e => e.preventDefault());
  }

  private createBots() {
    // 4 个 T Bot + 5 个 CT Bot (玩家是 1 个 T, 所以 5v5 = 5T(1玩家+4bot) + 5CT(全bot))
    const allIds: string[] = [LOCAL_PLAYER_ID];
    for (let i = 1; i <= 4; i++) allIds.push(`bot-t${i}`);
    for (let i = 1; i <= 5; i++) allIds.push(`bot-ct${i}`);

    // 创建 Bot 实体
    for (const id of allIds) {
      if (id === LOCAL_PLAYER_ID) continue;
      const isT = id.startsWith('bot-t');
      const team = isT ? Team.T : Team.CT;
      const name = isT ? `Bot T${id.slice(-1)}` : `Bot CT${id.slice(-1)}`;
      const state: PlayerState = {
        id, name, team, alive: false, health: 100, armor: 100, helmet: true, money: 800,
        position: [0, 0, 0], rotation: 0, pitch: 0, weapons: this.makeDefaultWeapons(team),
        activeWeaponIndex: 0, kills: 0, deaths: 0, assists: 0, isBot: true
      };
      const model = this.buildBotModel(team);
      const bot = new Bot(state, model);
      // 难度: T 队友友好, CT 敌人按难度递增
      if (isT) {
        bot.setDifficulty('normal');
      } else {
        bot.setDifficulty('hard');
      }
      bot.onShoot = (origin, dir) => {
        // 在场景中显示一条简易命中线 (可选: 用 tracer)
        const tr = (this.weapons as any)._tracer;
        if (tr) {
          const o = vec3ToArr(origin as any);
          const d = vec3ToArr(dir as any);
          tr.fire(
            new THREE.Vector3(o[0], o[1], o[2]),
            new THREE.Vector3(d[0], d[1], d[2]).normalize(),
            200
          );
        }
        // 由 Game 层做命中判定
        this.handleBotShot(bot, origin as any, dir as any);
      };
      bot.onMove = (b, newPos) => {
        const a = vec3ToArr(newPos as any);
        b.bodyGroup.position.set(a[0], a[1], a[2]);
        b.state.position = a;
        // 同步 yaw
      };
      this.bots.push(bot);
      this.botTargetMap.set(id, bot);
      this.botGroup.add(bot.bodyGroup);
    }
  }

  private buildBotModel(team: Team): THREE.Group {
    const g = new THREE.Group();
    const bodyColor = team === Team.T ? 0x3A2A1A : 0x3A4258;
    const accent = team === Team.T ? 0xFF3030 : 0x3A78D8;
    const headMat = new THREE.MeshLambertMaterial({ color: bodyColor });
    const bodyMat = new THREE.MeshLambertMaterial({ color: bodyColor });
    const accentMat = new THREE.MeshLambertMaterial({ color: accent });
    const legMat = new THREE.MeshLambertMaterial({ color: 0x222222 });

    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.85, 0.35), legMat);
    leg.position.set(0, 0.425, 0); leg.castShadow = true; g.add(leg);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.7, 0.35), bodyMat);
    body.position.set(0, 1.2, 0); body.castShadow = true; g.add(body);
    const belt = new THREE.Mesh(new THREE.BoxGeometry(0.57, 0.12, 0.37), accentMat);
    belt.position.set(0, 0.88, 0); g.add(belt);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), headMat);
    head.position.set(0, 1.78, 0); head.castShadow = true; g.add(head);
    // 简易枪 (背在身后)
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.6), new THREE.MeshLambertMaterial({ color: 0x1A1A1A }));
    gun.position.set(0.25, 1.3, -0.2); g.add(gun);
    return g;
  }

  private createMatch() {
    const allIds: string[] = [LOCAL_PLAYER_ID];
    for (let i = 1; i <= 4; i++) allIds.push(`bot-t${i}`);
    for (let i = 1; i <= 5; i++) allIds.push(`bot-ct${i}`);
    this.match = new Match(allIds);
  }

  private makeDefaultWeapons(team: Team): WeaponInstance[] {
    const knife: WeaponInstance = {
      stats: WEAPONS[WeaponId.Knife], ammoInMag: 999, reserveAmmo: 0,
      lastFireTime: 0, reloading: false, reloadStart: 0
    };
    const pistolId = team === Team.T ? WeaponId.Glock : WeaponId.USP;
    const pistol: WeaponInstance = {
      stats: WEAPONS[pistolId], ammoInMag: WEAPONS[pistolId].magazineSize,
      reserveAmmo: WEAPONS[pistolId].reserveAmmo,
      lastFireTime: 0, reloading: false, reloadStart: 0
    };
    return [knife, pistol];
  }

  private setupEvents() {
    bus.on('player_kill', (p: { killer: string; victim: string; hs: boolean; weapon: WeaponId }) => {
      this.hud.showKillFeed(
        this.getPlayerName(p.killer), this.match.players.get(p.killer)?.team ?? Team.T,
        this.getPlayerName(p.victim), this.match.players.get(p.victim)?.team ?? Team.CT,
        p.weapon, p.hs
      );
      if (p.victim === LOCAL_PLAYER_ID) {
        this.hud.flashDamage();
      }
      // 比分更新 (kill count 显示用)
      const killerState = this.match.players.get(p.killer);
      const victimState = this.match.players.get(p.victim);
      if (killerState) killerState.kills += 1;
      if (victimState) victimState.deaths += 1;
      // 通知 Match 系统
      this.match.onPlayerKilled(p.killer, p.victim, p.hs, p.weapon);
    });

    bus.on('round_end', (p: { result: any; score: MatchScore }) => {
      this.roundEndTimer = 4.0;
      this.hud.showRoundResult(p.result.winner, p.result.reason);
    });

    bus.on('match_over', (p: { winner: Team; score: MatchScore }) => {
      this.hud.showMessage(`${p.winner === Team.T ? 'TERRORISTS' : 'COUNTER-TERRORISTS'} WIN THE MATCH ${p.score.T}-${p.score.CT}`);
    });

    bus.on('bomb_planted', (p: { site: BombSite; planter: string }) => {
      this.hud.showMessage('BOMB PLANTED', 2000);
    });

    bus.on('bomb_explode', () => {
      this.hud.showMessage('BOOM!', 2000);
    });

    bus.on('bomb_defuse', () => {
      this.hud.showMessage('BOMB DEFUSED', 2000);
    });

    // 买枪
    bus.on('buy_weapon', (p: { id: WeaponId }) => {
      if (this.match.buyWeapon(LOCAL_PLAYER_ID, p.id)) {
        const w = this.match.players.get(LOCAL_PLAYER_ID)!.weapons;
        this.player.setWeapons(w);
        this.player.setActiveWeaponIndex(w.length - 1);
      } else {
        this.hud.showMessage('Not enough money');
      }
    });

    // 玩家死亡
    bus.on('player_died', (p: { id: string }) => {
      if (p.id === LOCAL_PLAYER_ID) {
        this.exitPointerLock();
        this.hud.setPointerLocked(false);
        this.hud.showMessage('You died — click to respawn', 3000);
      } else {
        const bot = this.botTargetMap.get(p.id);
        if (bot) {
          bot.state.alive = false;
          bot.bodyGroup.visible = false;
        }
      }
    });
  }

  private getPlayerName(id: string): string {
    if (id === LOCAL_PLAYER_ID) return 'You';
    return this.match.players.get(id)?.name ?? id;
  }

  private startMatch() {
    this.match.start();
    this.hud.bind(this.player.state, this.buildMatchInfo());
  }

  private buildMatchInfo(): MatchInfo {
    return {
      score: this.match.score,
      round: this.match.round,
      phase: this.match.phase,
      timeLeft: this.match.timeLeft,
      bombPlanted: this.match.bombPlanted,
      bombTime: this.match.bombTimer,
      bombSite: this.match.bombSite === BombSite.None ? 'none' : (this.match.bombSite as 'A' | 'B'),
      planting: this.plantingPlayerId !== null,
      defusing: this.defusingPlayerId !== null,
      plantProgress: this.plantProgress,
      defuseProgress: this.defuseProgress
    };
  }

  private spawnAll() {
    // 玩家 + 所有 Bot 各自在出生点生成
    const tSpawns = this.map.spawns.filter(s => s.team === Team.T);
    const ctSpawns = this.map.spawns.filter(s => s.team === Team.CT);

    // 玩家 -> T 出生点列表中第一个
    const playerSpawn = tSpawns[0];
    this.player.respawn(playerSpawn.position, playerSpawn.facing);
    this.localPlayerHasBomb = true;
    // 同步相机
    this.camera.position.set(playerSpawn.position[0], CONFIG.PLAYER_HEIGHT, playerSpawn.position[2]);
    this.camera.rotation.set(0, playerSpawn.facing, 0, 'YXZ');
    this.player.yaw = playerSpawn.facing;
    this.player.pitch = 0;

    // 同步 PlayerState.weapons
    this.player.setWeapons(this.match.players.get(LOCAL_PLAYER_ID)!.weapons);
    this.player.setActiveWeaponIndex(this.player.state.weapons.length > 1 ? 1 : 0);

    // T Bot -> T 剩余出生点
    const tBots = this.bots.filter(b => b.state.team === Team.T);
    for (let i = 0; i < tBots.length && i < tSpawns.length - 1; i++) {
      const sp = tSpawns[i + 1];
      tBots[i].respawn(sp.position, sp.facing);
      // 同步 bodyGroup 位置
      tBots[i].bodyGroup.position.set(sp.position[0], sp.position[1], sp.position[2]);
      tBots[i].bodyGroup.rotation.y = sp.facing;
    }
    // CT Bot -> CT 出生点
    const ctBots = this.bots.filter(b => b.state.team === Team.CT);
    for (let i = 0; i < ctBots.length && i < ctSpawns.length; i++) {
      const sp = ctSpawns[i];
      ctBots[i].respawn(sp.position, sp.facing);
      ctBots[i].bodyGroup.position.set(sp.position[0], sp.position[1], sp.position[2]);
      ctBots[i].bodyGroup.rotation.y = sp.facing;
    }
    // 隐藏所有 Bot 模型, respawn 时显示
    this.bots.forEach(b => b.bodyGroup.visible = b.state.alive);
  }

  private requestPointerLock() {
    this.canvas.requestPointerLock();
  }
  private exitPointerLock() {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  // ─────────────────────────────────────────────
  // 主循环
  // ─────────────────────────────────────────────
  start() {
    this.running = true;
    this.clock.start();
    this.lastTime = performance.now();
    this.loop();
  }

  private loop = () => {
    if (!this.running) return;
    requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.update(dt);
    this.render();
    this.fpsCounter.frames++;
    if (now - this.fpsCounter.last > 1000) {
      this.fpsCounter.value = this.fpsCounter.frames;
      this.fpsCounter.frames = 0;
      this.fpsCounter.last = now;
    }
  };

  private update(dt: number) {
    // 注意: input.update() 必须放最后调, 之前放在开头导致 mouseDX/DY 被清零
    // (player.update 要读 mouseDX/DY, 必须先读再清)

    // 1) 玩家控制 (需要 pointer lock 才能控制相机, 但移动键在未锁定时也可以响应)
    // 武器开火: 把 input.primaryAttack/secondaryAttack 接到 weapons
    if (this.input.primaryAttack) this.weapons.startFire();
    else this.weapons.stopFire();
    this.weapons.setAiming(!!this.input.secondaryAttack);

    if (this.input.pointerLocked) {
      if (this.player.state.alive) {
        this.handleBuyMenuHotkey();
        this.player.update(dt, this.input, this.map.colliders);
        this.clampPlayerToMap();
        this.weapons.update(dt, this.buildShootContext());
      }
    } else {
      if (this.player.state.alive) {
        this.handleBuyMenuHotkey();
        this.player.updateWithoutLook(dt, this.input, this.map.colliders);
        this.clampPlayerToMap();
        this.weapons.update(dt, this.buildShootContext());
      }
      this.input.consumeKey('Click');
    }

    // 2) 埋/拆进度 (玩家或 Bot)
    this.updatePlantDefuse(dt);

    // 3) Bots (永远跑, 不需要 pointer lock)
    this.updateBots(dt);

    // 4) Match (回合计时/胜负, 永远跑)
    this.updateMatch(dt);

    // 5) HUD
    this.hud.bind(this.player.state, this.buildMatchInfo());
    this.hud.update();
    this.hud.setPointerLocked(this.input.pointerLocked);
    this.hud.setBuyMenuOpen(this.buyMenu.isOpen);

    // 最后: 清零本帧的鼠标/滚轮增量 (在所有读 input 的模块都跑完之后)
    this.input.update();
  }

  private handleBuyMenuHotkey() {
    if (this.input.consumeKey('KeyB')) {
      if (this.match.phase === RoundPhase.BuyTime) {
        this.buyMenu.toggle(this.player.state.money, this.player.state.team, this.player.state.weapons.map(w => w.stats.id));
        this.hud.setBuyMenuOpen(this.buyMenu.isOpen);
        // 买枪菜单打开时保持 pointer lock, 用户可以 B 键关闭或直接点武器
      } else {
        this.hud.showMessage('Buy time is over');
      }
    }
    // 数字键切武器
    for (let i = 0; i < 5; i++) {
      if (this.input.consumeKey(`Digit${i + 1}`)) {
        this.player.setActiveWeaponIndex(i);
      }
    }
    // R 换弹
    if (this.input.consumeKey('KeyR')) this.weapons.reload();
    // G 丢武器
    if (this.input.consumeKey('KeyG')) {
      const dropped = this.weapons.takeWeapon?.(this.weapons.weapons[this.weapons.activeIndex]?.stats.id);
      if (dropped) {
        this.player.setWeapons(this.weapons.weapons);
        this.match.players.get(LOCAL_PLAYER_ID)!.weapons = this.weapons.weapons;
        this.hud.showMessage('Weapon dropped');
      }
    }
  }

  private buildShootContext(): ShootContext {
    const targets: ShootTarget[] = [];
    // Bots
    for (const bot of this.bots) {
      if (!bot.state.alive) continue;
      const p = bot.bodyGroup.position;
      targets.push({
        id: bot.state.id, team: bot.state.team,
        headPos: new THREE.Vector3(p.x, p.y + 1.78, p.z),
        chestPos: new THREE.Vector3(p.x, p.y + 1.2, p.z),
        feetPos: new THREE.Vector3(p.x, p.y + 0.45, p.z),
        alive: true, helmet: true
      });
    }
    // 自己的 Bot队友也要参与 (队友误伤, 简化不开)
    // 也把 local player 当作目标 (允许自杀调试)
    if (this.player.state.alive) {
      const p = this.player.position;
      targets.push({
        id: LOCAL_PLAYER_ID, team: this.player.state.team,
        headPos: new THREE.Vector3(p.x, p.y + CONFIG.HEAD_HEIGHT, p.z),
        chestPos: new THREE.Vector3(p.x, p.y + CONFIG.CHEST_HEIGHT, p.z),
        feetPos: new THREE.Vector3(p.x, p.y + CONFIG.FEET_HEIGHT, p.z),
        alive: true, helmet: this.player.state.helmet
      });
    }
    return {
      camera: this.camera,
      colliders: this.map.colliders,
      playerTargets: targets,
      ignoreId: LOCAL_PLAYER_ID,
      viewmodelGroup: this.viewmodelGroup
    };
  }

  private updatePlantDefuse(dt: number) {
    // 玩家埋包
    if (this.plantingPlayerId === LOCAL_PLAYER_ID) {
      const inSite = this.isInBombSite(this.player.position);
      if (!inSite || this.player.velocity.length() > 0.1) {
        this.plantingPlayerId = null;
        this.plantProgress = 0;
        return;
      }
      this.plantProgress += dt / CONFIG.PLANT_TIME;
      if (this.plantProgress >= 1) {
        // 完成
        const site = this.nearestSite(this.player.position);
        this.match.startPlant(LOCAL_PLAYER_ID, site);   // 实际埋包
        this.plantingPlayerId = null;
        this.plantProgress = 0;
        this.localPlayerHasBomb = false;
        // 通知 Match 埋包完成
        this.match.update(0, this.buildWorldSnapshot());
        bus.emit('bomb_planted', { site, planter: LOCAL_PLAYER_ID });
      }
    } else if (this.plantingPlayerId) {
      // Bot 埋包 (简化: 自动完成)
      const bot = this.botTargetMap.get(this.plantingPlayerId);
      if (bot) {
        this.plantProgress += dt / CONFIG.PLANT_TIME;
        if (this.plantProgress >= 1) {
          const site = bot.decidedSite;
          this.match.startPlant(bot.state.id, site);
          this.plantingPlayerId = null;
          this.plantProgress = 0;
          bus.emit('bomb_planted', { site, planter: bot.state.id });
        }
      }
    }

    // 玩家拆包
    if (this.defusingPlayerId === LOCAL_PLAYER_ID) {
      if (this.match.bombPos && this.distTo(this.player.position, this.match.bombPos) > 2.0) {
        this.defusingPlayerId = null;
        this.defuseProgress = 0;
        return;
      }
      this.defuseProgress += dt / CONFIG.DEFUSE_TIME;
      if (this.defuseProgress >= 1) {
        this.match.startDefuse(LOCAL_PLAYER_ID);
        this.defusingPlayerId = null;
        this.defuseProgress = 0;
        this.match.update(0, this.buildWorldSnapshot());
        bus.emit('bomb_defuse', { defuser: LOCAL_PLAYER_ID });
      }
    } else if (this.defusingPlayerId) {
      const bot = this.botTargetMap.get(this.defusingPlayerId);
      if (bot) {
        this.defuseProgress += dt / CONFIG.DEFUSE_TIME;
        if (this.defuseProgress >= 1) {
          this.match.startDefuse(bot.state.id);
          this.defusingPlayerId = null;
          this.defuseProgress = 0;
          bus.emit('bomb_defuse', { defuser: bot.state.id });
        }
      }
    }
  }

  private distTo(a: { x: number; y: number; z: number } | [number, number, number], b: { x: number; y: number; z: number } | [number, number, number]) {
    const av = vec3ToXYZ(a as any);
    const bv = vec3ToXYZ(b as any);
    return Math.sqrt((av.x - bv.x) ** 2 + (av.z - bv.z) ** 2);
  }

  private isInBombSite(pos: { x: number; z: number }): BombSite {
    for (const site of this.map.sites) {
      const dx = pos.x - site.center[0], dz = pos.z - site.center[2];
      if (dx * dx + dz * dz < site.radius * site.radius) return site.name;
    }
    return BombSite.None;
  }
  private nearestSite(pos: { x: number; z: number }): BombSite {
    let best = BombSite.None, bestD = Infinity;
    for (const site of this.map.sites) {
      const dx = pos.x - site.center[0], dz = pos.z - site.center[2];
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = site.name; }
    }
    return best;
  }

  private tryStartPlant() {
    if (this.player.state.team !== Team.T || !this.localPlayerHasBomb) {
      // 玩家尝试拆包
      if (this.match.bombPlanted && this.match.bombPos) {
        const d = this.distTo(this.player.position, this.match.bombPos);
        if (d < 2.0 && this.defusingPlayerId === null) {
          this.defusingPlayerId = LOCAL_PLAYER_ID;
          this.defuseProgress = 0;
        }
      }
      return;
    }
    // 尝试埋包
    const site = this.isInBombSite(this.player.position);
    if (site !== BombSite.None && this.plantingPlayerId === null) {
      this.plantingPlayerId = LOCAL_PLAYER_ID;
      this.plantProgress = 0;
      this.hud.showMessage('PLANTING...');
    }
  }

  private updateBots(dt: number) {
    // 构造 Bot 视野
    const visible: BotWorld['visible'] = [];
    for (const other of this.bots) {
      if (!other.state.alive) continue;
      const p = other.bodyGroup.position;
      visible.push({
        id: other.state.id, team: other.state.team,
        position: p, headPos: new THREE.Vector3(p.x, p.y + 1.78, p.z),
        alive: true
      });
    }
    if (this.player.state.alive) {
      visible.push({
        id: LOCAL_PLAYER_ID, team: this.player.state.team,
        position: this.player.position,
        headPos: new THREE.Vector3(this.player.position.x, this.player.position.y + CONFIG.HEAD_HEIGHT, this.player.position.z),
        alive: true
      });
    }

    for (const bot of this.bots) {
      if (!bot.state.alive) continue;
      // 备份当前位置 (在 update 之前)
      const oldBodyPos = { x: bot.bodyGroup.position.x, z: bot.bodyGroup.position.z };
      const world: BotWorld = {
        dt,
        colliders: this.map.colliders,
        waypoints: this.map.layout.waypoints,
        paths: this.map.layout.paths,
        visible: visible.filter(v => v.id !== bot.state.id),
        knownEnemyId: null,
        knownEnemyPos: null,
        phase: this.match.phase === RoundPhase.BuyTime ? 'buy' : (this.match.phase === RoundPhase.Live ? 'live' : 'end'),
        bombPlanted: this.match.bombPlanted,
        bombSite: this.match.bombSite,
        bombPos: this.match.bombPos ? new THREE.Vector3(...this.match.bombPos) : null,
        hasBomb: bot.state.hasBomb ?? false,
        siteACenter: new THREE.Vector3(this.map.sites[0].center[0], 0, this.map.sites[0].center[2]),
        siteBCenter: new THREE.Vector3(this.map.sites[1].center[0], 0, this.map.sites[1].center[2]),
        siteARadius: this.map.sites[0].radius,
        siteBRadius: this.map.sites[1].radius,
        isPlayerOnMyTeam: (id: string) => {
          if (id === LOCAL_PLAYER_ID) return bot.state.team === this.player.state.team;
          const other = this.botTargetMap.get(id);
          return other ? other.state.team === bot.state.team : false;
        },
        canSee: (from, to) => this.canSee(from, to),
        spawns: {
          T: this.map.spawns.filter(s => s.team === Team.T).map(s => new THREE.Vector3(s.position[0], s.position[1], s.position[2])),
          CT: this.map.spawns.filter(s => s.team === Team.CT).map(s => new THREE.Vector3(s.position[0], s.position[1], s.position[2]))
        }
      };
      bot.update(world);
      // 修复 Bot 模块的 bug: _getPos() 每次返回新 Vector3, 内部 moveToward 的位移会丢失
      // 我们自己基于速度+朝向推算新位置
      const yaw = bot.state.rotation;
      const speed = 5.0;
      const moveX = Math.sin(yaw) * speed * dt;
      const moveZ = Math.cos(yaw) * speed * dt;
      // 简化: 直接基于 bodyGroup 的当前位置 (从 onMove 拿到) 推进
      // 实际上 onMove 已经把 bot 的新位置同步到 bodyGroup 了 (但只更新了 _lastTarget, 实际 pos 没传对)
      // 改用 Bot 内部记录的方向走一小步, 然后写回 bodyGroup
      // 更稳的做法: 直接从 bot._modelRoot 拿 (bot 自己设的) - 但它用旧 pos
      // 简单暴力: 推算出 bot 的实际朝向 (从路径或目标), 让他走一步
      // 跳过 - bot.update 内的 onMove 没正确传递新位置, 改用直接控制 bodyGroup
      if (bot.aiState !== BotState.Idle && bot.aiState !== BotState.Plant && bot.aiState !== BotState.Defuse) {
        // 跑向当前路径点
        this.driveBotTowardTarget(bot, dt);
      }
      // 同步 bodyGroup rotation
      bot.bodyGroup.rotation.y = bot.state.rotation;
      // 同步 state.position 给其他模块用
      bot.state.position = [bot.bodyGroup.position.x, bot.bodyGroup.position.y, bot.bodyGroup.position.z];

      // 检查 Bot 是否进入 Plant 状态
      if (bot.aiState === BotState.Plant && this.plantingPlayerId === null) {
        this.plantingPlayerId = bot.state.id;
        this.plantProgress = 0;
      }
      if (bot.aiState === BotState.Defuse && this.defusingPlayerId === null && this.match.bombPlanted) {
        this.defusingPlayerId = bot.state.id;
        this.defuseProgress = 0;
      }
    }
  }

  // 自己驱动 bot 朝向目标移动 (因为 Bot.update 内部的位移 bug)
  // 地图硬边界: 玩家和 Bot 不能走出这个范围
  private readonly MAP_BOUND = 115;  // dust2 整体约 240x220, 留 5m 边距

  private driveBotTowardTarget(bot: Bot, dt: number) {
    const waypoints = this.map.layout.waypoints;
    if (!waypoints || waypoints.length === 0) return;
    const bp = bot.bodyGroup.position;
    if (bot.state.rotation === undefined) bot.state.rotation = 0;
    if (!(bot as any)._wpOffset) {
      (bot as any)._wpOffset = (this.bots.indexOf(bot) + 1) % waypoints.length;
    }
    // 找当前最近的 waypoint
    let nearestIdx = -1, nearestD = Infinity;
    for (let i = 0; i < waypoints.length; i++) {
      const d = Math.hypot(waypoints[i].x - bp.x, waypoints[i].z - bp.z);
      if (d < nearestD) { nearestD = d; nearestIdx = i; }
    }
    // 朝 _wpOffset 走
    if (nearestIdx >= 0) {
      const target = waypoints[(bot as any)._wpOffset];
      const dx = target.x - bp.x;
      const dz = target.z - bp.z;
      const d = Math.hypot(dx, dz);
      if (d > 2.0) {
        bot.state.rotation = Math.atan2(dx, dz);
      } else {
        // 到达, 换一个目标 (避免扎堆)
        (bot as any)._wpOffset = ((bot as any)._wpOffset + 3) % waypoints.length;
        const next = waypoints[(bot as any)._wpOffset];
        bot.state.rotation = Math.atan2(next.x - bp.x, next.z - bp.z);
      }
    }
    // 移动
    const yaw = bot.state.rotation;
    const speed = 4.0;
    let newX = bp.x + Math.sin(yaw) * speed * dt;
    let newZ = bp.z + Math.cos(yaw) * speed * dt;
    // 地图边界 clamp
    newX = Math.max(-this.MAP_BOUND, Math.min(this.MAP_BOUND, newX));
    newZ = Math.max(-this.MAP_BOUND, Math.min(this.MAP_BOUND, newZ));
    // 简单碰撞: 不能进 colliders
    let blocked = false;
    for (const box of this.map.colliders) {
      if (newX > box.min[0] - 0.4 && newX < box.max[0] + 0.4 &&
          newZ > box.min[2] - 0.4 && newZ < box.max[2] + 0.4) {
        blocked = true;
        break;
      }
    }
    if (!blocked) {
      bot.bodyGroup.position.set(newX, bp.y, newZ);
    } else {
      // 撞墙换目标
      (bot as any)._wpOffset = ((bot as any)._wpOffset + 2) % waypoints.length;
    }
  }

  // 玩家也加边界 clamp
  private clampPlayerToMap() {
    const p = this.player.position;
    if (p.x < -this.MAP_BOUND) p.x = -this.MAP_BOUND;
    if (p.x > this.MAP_BOUND) p.x = this.MAP_BOUND;
    if (p.z < -this.MAP_BOUND) p.z = -this.MAP_BOUND;
    if (p.z > this.MAP_BOUND) p.z = this.MAP_BOUND;
  }

  private canSee(from: { x: number; y: number; z: number } | [number, number, number], to: { x: number; y: number; z: number } | [number, number, number]): boolean {
    const fv = vec3ToXYZ(from as any);
    const tv = vec3ToXYZ(to as any);
    // 简单 2D 距离内的视线检测
    const dist = Math.hypot(tv.x - fv.x, tv.z - fv.z);
    if (dist > 60) return false; // 视野上限
    // 沿 X-Z 平面分段检查是否穿墙
    const steps = Math.max(2, Math.floor(dist / 1.5));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const px = fv.x + (tv.x - fv.x) * t;
      const pz = fv.z + (tv.z - fv.z) * t;
      for (const box of this.map.colliders) {
        if (px >= box.min[0] && px <= box.max[0] && pz >= box.min[2] && pz <= box.max[2]) {
          // 撞到 box 内部或贴边视为遮挡
          if (px > box.min[0] + 0.1 && px < box.max[0] - 0.1 &&
              pz > box.min[2] + 0.1 && pz < box.max[2] - 0.1) return false;
        }
      }
    }
    return true;
  }

  private handleHit(hit: BulletHit) {
    // hit 来自 player 自己 (武器系统)
    bus.emit('player_hit', hit);
    const victim = this.match.players.get(hit.victimId);
    if (!victim) return;
    if (hit.victimId === LOCAL_PLAYER_ID) {
      this.player.applyDamage(hit.damage, hit.position, hit.headshot);
    } else {
      const bot = this.botTargetMap.get(hit.victimId);
      if (bot) {
        bot.takeDamage(hit.damage, hit.shooterId, hit.position);
        if (!bot.state.alive) {
          bus.emit('player_kill', {
            killer: hit.shooterId, victim: hit.victimId, hs: hit.headshot, weapon: hit.weaponId
          });
        }
      }
    }
  }

  private handleBotShot(bot: Bot, origin: any, dir: any) {
    // 队友不打玩家
    if (bot.state.team === this.player.state.team) return;
    // 简化: 简单射线检查击中玩家
    const o = vec3ToArr(origin);
    const d = vec3ToArr(dir);
    const ax = o[0], ay = o[1], az = o[2];
    const dx = d[0], dy = d[1], dz = d[2];
    const range = 80;
    let bestT = range, bestTarget: { id: string; headshot: boolean; pos: [number, number, number] } | null = null;
    // 检查玩家
    if (this.player.state.alive) {
      const t = this.raySphere(ax, ay, az, dx, dy, dz,
        this.player.position.x, this.player.position.y + 1.2, this.player.position.z, 0.4);
      if (t > 0 && t < bestT) { bestT = t; bestTarget = { id: LOCAL_PLAYER_ID, headshot: false, pos: [this.player.position.x, this.player.position.y + 1.2, this.player.position.z] }; }
      const t2 = this.raySphere(ax, ay, az, dx, dy, dz,
        this.player.position.x, this.player.position.y + CONFIG.HEAD_HEIGHT, this.player.position.z, 0.18);
      if (t2 > 0 && t2 < bestT) { bestT = t2; bestTarget = { id: LOCAL_PLAYER_ID, headshot: true, pos: [this.player.position.x, this.player.position.y + CONFIG.HEAD_HEIGHT, this.player.position.z] }; }
    }
    // 检查其他 Bot (队友误伤简化不开)
    for (const other of this.bots) {
      if (other === bot || !other.state.alive) continue;
      if (other.state.team === bot.state.team) continue;
      const p = other.bodyGroup.position;
      const t = this.raySphere(ax, ay, az, dx, dy, dz, p.x, p.y + 1.2, p.z, 0.4);
      if (t > 0 && t < bestT) {
        bestT = t; bestTarget = { id: other.state.id, headshot: false, pos: [p.x, p.y + 1.2, p.z] };
      }
      const t2 = this.raySphere(ax, ay, az, dx, dy, dz, p.x, p.y + 1.78, p.z, 0.18);
      if (t2 > 0 && t2 < bestT) {
        bestT = t2; bestTarget = { id: other.state.id, headshot: true, pos: [p.x, p.y + 1.78, p.z] };
      }
    }
    if (bestTarget) {
      const weapon = bot.state.weapons[bot.state.activeWeaponIndex]?.stats;
      if (!weapon) return;
      const headMul = bestTarget.headshot ? weapon.headshotMultiplier : 1.0;
      const dist = bestT;
      const dmg = weapon.damage * headMul * Math.max(0.5, 1 - dist / weapon.range * 0.5);
      if (bestTarget.id === LOCAL_PLAYER_ID) {
        this.player.applyDamage(dmg, bestTarget.pos, bestTarget.headshot);
      } else {
        const victim = this.botTargetMap.get(bestTarget.id);
        if (victim) {
          victim.takeDamage(dmg, bot.state.id, bestTarget.pos);
          if (!victim.state.alive) {
            bus.emit('player_kill', {
              killer: bot.state.id, victim: bestTarget.id, hs: bestTarget.headshot, weapon: weapon.id
            });
          }
        }
      }
    }
  }

  private raySphere(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
                    cx: number, cy: number, cz: number, r: number): number {
    const ex = ox - cx, ey = oy - cy, ez = oz - cz;
    const a = dx * dx + dy * dy + dz * dz;
    const b = 2 * (ex * dx + ey * dy + ez * dz);
    const c = ex * ex + ey * ey + ez * ez - r * r;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return -1;
    const t = (-b - Math.sqrt(disc)) / (2 * a);
    return t > 0 ? t : -1;
  }

  private updateMatch(dt: number) {
    // 每帧调用, Match 内部按 phase 推进
    this.match.update(dt, this.buildWorldSnapshot());
    // 同步 MatchInfo 给 HUD
  }

  private buildWorldSnapshot(): WorldSnapshot {
    const positions = new Map<string, { pos: [number, number, number]; team: Team; alive: boolean }>();
    positions.set(LOCAL_PLAYER_ID, {
      pos: [this.player.position.x, this.player.position.y, this.player.position.z],
      team: this.player.state.team, alive: this.player.state.alive
    });
    for (const b of this.bots) {
      positions.set(b.state.id, {
        pos: [b.bodyGroup.position.x, b.bodyGroup.position.y, b.bodyGroup.position.z],
        team: b.state.team, alive: b.state.alive
      });
    }
    return {
      aliveCounts: {
        T: this.match.players && Array.from(this.match.players.values()).filter(p => p.team === Team.T && p.alive).length,
        CT: this.match.players && Array.from(this.match.players.values()).filter(p => p.team === Team.CT && p.alive).length
      },
      playerPositions: positions,
      sites: {
        A: [this.map.sites[0].center[0], 0, this.map.sites[0].center[2]],
        B: [this.map.sites[1].center[0], 0, this.map.sites[1].center[2]]
      },
      plantingPlayer: this.plantingPlayerId,
      defusingPlayer: this.defusingPlayerId,
      plantProgress: this.plantProgress,
      defuseProgress: this.defuseProgress
    };
  }

  private render() {
    // 第一人称相机位置跟随玩家
    if (this.player.state.alive) {
      this.camera.position.set(
        this.player.position.x,
        this.player.position.y + CONFIG.HEAD_HEIGHT,
        this.player.position.z
      );
    }
    // 天空跟随相机, 永远在玩家头顶
    this.sky.update(0, this.camera);
    this.renderer.render(this.scene, this.camera);
    // 视图模型作为 camera 子节点, 自动跟随
    if (this.viewmodelGroup.parent !== this.camera) {
      this.camera.add(this.viewmodelGroup);
    }
  }
}
