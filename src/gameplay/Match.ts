// CS2 风格回合 / 比赛 / 经济系统
// 5v5, 最多 30 回合, 先到 ROUNDS_TO_WIN=8 胜
import {
  RoundPhase,
  MatchScore,
  Team,
  PlayerState,
  RoundResult,
  WeaponId,
  BombSite,
  CONFIG,
  WeaponInstance,
  WeaponStats,
  BulletHit
} from '../types';
import { WEAPONS, BUY_LIST } from '../weapons/weapons.db';
import { bus } from '../utils/events';
import { clamp } from '../utils/util';

/** 世界快照 - 由 Game 层每帧注入 */
export interface WorldSnapshot {
  aliveCounts: { T: number; CT: number };
  playerPositions: Map<string, { pos: [number, number, number]; team: Team; alive: boolean }>;
  sites: { A: [number, number, number]; B: [number, number, number] };
  plantingPlayer: string | null;
  defusingPlayer: string | null;
  plantProgress: number;
  defuseProgress: number;
}

/** 内部: 单个玩家的连败计数 */
interface PlayerEconomy {
  lossStreak: number;
}

const SITE_RADIUS = 2.5;       // 站点判定半径 (米)
const BOMB_DEFUSE_RADIUS = 2.0;// 拆包判定半径 (米)

export class Match {
  phase: RoundPhase = RoundPhase.Warmup;
  timeLeft: number = CONFIG.BUY_TIME;
  round: number = 0;
  score: MatchScore = { T: 0, CT: 0 };

  // 玩家状态 (id -> state)
  players: Map<string, PlayerState> = new Map();

  // 炸弹状态
  bombPlanted: boolean = false;
  bombSite: BombSite = BombSite.None;
  bombPos: [number, number, number] | null = null;
  bombPlanter: string | null = null;
  bombTimer: number = 0;       // 0 = 未埋
  bombDefuser: string | null = null;

  // 配置
  maxRounds: number = 30;

  // 内部状态
  private playerEconomy: Map<string, PlayerEconomy> = new Map();
  private endTimer: number = 0;          // End 阶段倒计时
  private bombPlantedThisRound: boolean = false; // 简化: 记录本回合是否已经埋过包

  constructor(playerIds: string[]) {
    this.initializePlayers(playerIds);
  }

  // ────────────────────────────────────────────────────────
  // 初始化 / 重置
  // ────────────────────────────────────────────────────────

  private initializePlayers(playerIds: string[]): void {
    this.players.clear();
    this.playerEconomy.clear();

    // 假设前 5 个是 T, 后 5 个是 CT (由 Game 层保证)
    const tIds = playerIds.slice(0, 5);
    const ctIds = playerIds.slice(5, 10);

    tIds.forEach((id, idx) => {
      this.players.set(id, this.createPlayerState(id, `T${idx + 1}`, Team.T, idx === 0));
      this.playerEconomy.set(id, { lossStreak: 0 });
    });
    ctIds.forEach((id, idx) => {
      this.players.set(id, this.createPlayerState(id, `CT${idx + 1}`, Team.CT, false));
      this.playerEconomy.set(id, { lossStreak: 0 });
    });
  }

  private createPlayerState(
    id: string,
    name: string,
    team: Team,
    hasBomb: boolean
  ): PlayerState {
    const knife = this.makeWeapon(WEAPONS[WeaponId.Knife]);
    const pistolId = team === Team.T ? WeaponId.Glock : WeaponId.USP;
    const pistol = this.makeWeapon(WEAPONS[pistolId]);
    return {
      id,
      name,
      team,
      alive: true,
      health: 100,
      armor: 0,
      helmet: false,
      money: CONFIG.START_MONEY,
      position: [0, 0, 0],
      rotation: 0,
      pitch: 0,
      weapons: [knife, pistol],
      activeWeaponIndex: 1,   // 默认切到手枪
      kills: 0,
      deaths: 0,
      assists: 0,
      isBot: false,
      hasBomb
    };
  }

  private makeWeapon(stats: WeaponStats): WeaponInstance {
    return {
      stats,
      ammoInMag: stats.magazineSize,
      reserveAmmo: stats.reserveAmmo,
      lastFireTime: 0,
      reloading: false,
      reloadStart: 0
    };
  }

  start(): void {
    this.score = { T: 0, CT: 0 };
    this.round = 0;
    this.beginRound();
  }

  reset(): void {
    this.phase = RoundPhase.Warmup;
    this.timeLeft = CONFIG.BUY_TIME;
    this.round = 0;
    this.score = { T: 0, CT: 0 };
    this.bombPlanted = false;
    this.bombSite = BombSite.None;
    this.bombPos = null;
    this.bombPlanter = null;
    this.bombTimer = 0;
    this.bombDefuser = null;
    this.bombPlantedThisRound = false;
    this.endTimer = 0;
    this.playerEconomy.clear();
    this.players.forEach(p => {
      p.alive = true;
      p.health = 100;
      p.armor = 0;
      p.helmet = false;
      p.money = CONFIG.START_MONEY;
      p.kills = 0;
      p.deaths = 0;
      p.assists = 0;
      p.weapons = [
        this.makeWeapon(WEAPONS[WeaponId.Knife]),
        this.makeWeapon(WEAPONS[p.team === Team.T ? WeaponId.Glock : WeaponId.USP])
      ];
      p.activeWeaponIndex = 1;
    });
    this.playerEconomy.forEach(e => (e.lossStreak = 0));
  }

  // ────────────────────────────────────────────────────────
  // 主循环
  // ────────────────────────────────────────────────────────

  update(dt: number, world: WorldSnapshot): void {
    if (dt <= 0) return;
    switch (this.phase) {
      case RoundPhase.BuyTime:
        this.updateBuyTime(dt);
        break;
      case RoundPhase.Live:
        this.updateLive(dt, world);
        break;
      case RoundPhase.End:
        this.updateEnd(dt);
        break;
      case RoundPhase.MatchOver:
      case RoundPhase.Warmup:
      default:
        break;
    }
  }

  private updateBuyTime(dt: number): void {
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    if (this.timeLeft <= 0) {
      this.phase = RoundPhase.Live;
      this.timeLeft = CONFIG.ROUND_TIME;
    }
  }

  private updateLive(dt: number, world: WorldSnapshot): void {
    // 1) 炸弹倒计时
    if (this.bombPlanted) {
      this.bombTimer = Math.max(0, this.bombTimer - dt);
      if (this.bombTimer <= 0) {
        this.endRound(Team.T, 'bomb_explode');
        bus.emit('bomb_explode', { site: this.bombSite });
        return;
      }
    }

    // 2) 胜负判定 - 全歼
    const { T, CT } = world.aliveCounts;
    if (this.bombPlanted) {
      // 埋包后: T 死光 → CT 胜; CT 死光 → T 胜
      if (T === 0) this.endRound(Team.CT, 'elimination');
      else if (CT === 0) this.endRound(Team.T, 'elimination');
    } else {
      // 未埋包: T 死光 → CT 胜; CT 死光 → T 胜
      if (T === 0) this.endRound(Team.CT, 'elimination');
      else if (CT === 0) this.endRound(Team.T, 'elimination');
    }

    if (this.phase !== RoundPhase.Live) return;

    // 3) 倒计时
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    if (this.timeLeft <= 0) {
      if (this.bombPlanted) {
        // 时间到但包在: 继续等拆/爆 (do nothing)
      } else {
        // 时间到且未埋包 → CT 胜 (target_saved)
        this.endRound(Team.CT, 'target_saved');
        return;
      }
    }
  }

  private updateEnd(dt: number): void {
    this.endTimer = Math.max(0, this.endTimer - dt);
    if (this.endTimer <= 0) {
      this.nextRound();
    }
  }

  // ────────────────────────────────────────────────────────
  // 玩家操作
  // ────────────────────────────────────────────────────────

  buyWeapon(uid: string, weaponId: WeaponId): boolean {
    // 仅买枪时间可买
    if (this.phase !== RoundPhase.BuyTime) return false;
    const player = this.players.get(uid);
    if (!player || !player.alive) return false;
    const stats = WEAPONS[weaponId];
    if (!stats) return false;
    // 阵营限制
    if (stats.team !== 'both' && stats.team !== player.team) return false;
    if (!BUY_LIST[player.team].includes(weaponId)) return false;
    if (player.money < stats.price) return false;

    // 免费 (刀/初始手枪) 也允许, 但不重复发刀
    if (stats.price > 0) {
      player.money -= stats.price;
    }
    // 替换当前武器: 移除同 id 旧实例 (保留刀)
    if (weaponId !== WeaponId.Knife) {
      player.weapons = player.weapons.filter(w => w.stats.id === WeaponId.Knife);
      player.weapons.push(this.makeWeapon(stats));
      // 自动切到新武器
      player.activeWeaponIndex = player.weapons.length - 1;
    }
    return true;
  }

  onPlayerKilled(killer: string, victim: string, headshot: boolean, weaponId: WeaponId): void {
    const victimState = this.players.get(victim);
    if (!victimState) return;
    victimState.alive = false;
    victimState.deaths += 1;

    // 包掉落: 如果被击杀者有包, 转移给同队友 (简化: 不处理掉落到地, 保持 hasBomb 不变)
    // 这里为简化, 暂不转移

    const killerState = killer ? this.players.get(killer) : null;
    if (killerState && killer !== victim) {
      killerState.kills += 1;
      // 杀敌奖励 - 按武器类型
      const reward = this.calcKillReward(weaponId);
      killerState.money = clamp(killerState.money + reward, 0, 99999);
    }

    // 触发事件
    const hit: BulletHit = {
      shooterId: killer,
      victimId: victim,
      weaponId,
      damage: 0,
      headshot,
      position: victimState.position
    };
    bus.emit('player_kill', { kill: hit, killer, victim });
  }

  private calcKillReward(weaponId: WeaponId): number {
    const stats = WEAPONS[weaponId];
    if (!stats) return CONFIG.KILL_REWARD_PISTOL;
    if (stats.id === WeaponId.Knife) return CONFIG.KILL_REWARD_KNIFE;
    if (stats.id === WeaponId.AWP) return CONFIG.KILL_REWARD_AWP;
    if (stats.id === WeaponId.AK47 || stats.id === WeaponId.M4A4) return CONFIG.KILL_REWARD_RIFLE;
    return CONFIG.KILL_REWARD_PISTOL;
  }

  /** T 玩家在 A/B 站点按 E, 保持 3.2s 完成埋包 */
  startPlant(uid: string, site: BombSite): void {
    if (this.phase !== RoundPhase.Live) return;
    if (this.bombPlanted) return;
    if (this.bombPlantedThisRound) return; // 简化: 整局每回合只允许一次
    const player = this.players.get(uid);
    if (!player || !player.alive || player.team !== Team.T) return;
    if (!player.hasBomb) return;
    if (site !== BombSite.A && site !== BombSite.B) return;

    // 检查 playerPositions 是否在 site 半径内 - 这里 world 不在手, 改由 Game 层校验
    // 此处仅占位逻辑: 真实进度由 world.plantProgress 推进
    // 简化: 直接同步完成埋包 (因为 Game 层会在 update 内传入 world.plantProgress)
    // 实际处理: 在 updateLive 末尾由 world.plantProgress==1 触发完成
  }

  /** CT 玩家在 bomb 半径内按 E 拆包, 持续 10s */
  startDefuse(uid: string): void {
    if (this.phase !== RoundPhase.Live) return;
    if (!this.bombPlanted) return;
    const player = this.players.get(uid);
    if (!player || !player.alive || player.team !== Team.CT) return;
    this.bombDefuser = uid;
  }

  cancelDefuse(uid: string): void {
    if (this.bombDefuser === uid) {
      this.bombDefuser = null;
    }
  }

  // ────────────────────────────────────────────────────────
  // 内部: 回合流程
  // ────────────────────────────────────────────────────────

  private beginRound(): void {
    this.round += 1;
    this.bombPlanted = false;
    this.bombSite = BombSite.None;
    this.bombPos = null;
    this.bombPlanter = null;
    this.bombTimer = 0;
    this.bombDefuser = null;
    this.bombPlantedThisRound = false;
    this.endTimer = 0;

    this.respawnAll();
    this.phase = RoundPhase.BuyTime;
    this.timeLeft = CONFIG.BUY_TIME;

    bus.emit('round_start', { phase: this.phase, roundNumber: this.round });
  }

  private endRound(winner: Team, reason: RoundResult['reason']): void {
    if (this.phase === RoundPhase.End || this.phase === RoundPhase.MatchOver) return;

    if (winner === Team.T) this.score.T += 1;
    else this.score.CT += 1;

    this.applyEconomy(winner);

    const result: RoundResult = { winner, reason };
    this.phase = RoundPhase.End;
    this.endTimer = 5;
    this.timeLeft = 5;

    bus.emit('round_end', { result, score: { ...this.score } });

    // 是否比赛结束
    if (this.score.T >= CONFIG.ROUNDS_TO_WIN || this.score.CT >= CONFIG.ROUNDS_TO_WIN) {
      this.phase = RoundPhase.MatchOver;
      this.timeLeft = 0;
      const matchWinner: Team = this.score.T >= CONFIG.ROUNDS_TO_WIN ? Team.T : Team.CT;
      bus.emit('match_over', { winner: matchWinner, score: { ...this.score } });
    }
  }

  private applyEconomy(winner: Team): void {
    this.players.forEach((player, uid) => {
      if (player.team === winner) {
        player.money = clamp(player.money + CONFIG.WIN_BONUS, 0, 99999);
        this.playerEconomy.get(uid)!.lossStreak = 0;
      } else {
        const eco = this.playerEconomy.get(uid)!;
        const inc = Math.min(eco.lossStreak, 4) * CONFIG.LOSS_BONUS_INC;
        const bonus = clamp(
          CONFIG.LOSS_BONUS_BASE + inc,
          0,
          CONFIG.LOSS_BONUS_MAX
        );
        player.money = clamp(player.money + bonus, 0, 99999);
        eco.lossStreak += 1;
      }
    });
  }

  private nextRound(): void {
    if (this.score.T >= CONFIG.ROUNDS_TO_WIN || this.score.CT >= CONFIG.ROUNDS_TO_WIN) {
      this.phase = RoundPhase.MatchOver;
      return;
    }
    this.beginRound();
  }

  private respawnAll(): void {
    this.players.forEach(p => {
      p.alive = true;
      p.health = 100;
      p.armor = 0;
      p.helmet = false;
      // 重置当前武器弹匣 (不重置金钱, 那是经济系统的事)
      p.weapons.forEach(w => {
        w.ammoInMag = w.stats.magazineSize;
        w.reserveAmmo = w.stats.reserveAmmo;
        w.reloading = false;
        w.reloadStart = 0;
      });
      // 位置由 Game 层根据 spawn 点重新设置, 这里只重置 health/alive
    });
  }
}
