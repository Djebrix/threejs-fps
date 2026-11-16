// Money and the buy menu: one ledger, no hidden state. A round pays on its outcome,
// kills and plants pay at once, and the buy menu spends from the same balance the HUD shows.
export const WEAPONS = {
  pistol: { id: 'pistol', name: 'P9 Sidearm', key: '1', price: 0, damage: 26, headMult: 4, mag: 12, reserve: 48, fireGap: 0.16, reloadTime: 1.3, spreadStill: 0.0035, spreadMove: 0.03, auto: false, kind: 'pistol', pellets: 1 },
  smg: { id: 'smg', name: 'VK-9 Ripper', key: '2', price: 1200, damage: 21, headMult: 4, mag: 28, reserve: 112, fireGap: 0.075, reloadTime: 1.7, spreadStill: 0.005, spreadMove: 0.034, auto: true, kind: 'smg', pellets: 1 },
  rifle: { id: 'rifle', name: 'AR-77 Ember', key: '3', price: 2700, damage: 34, headMult: 4, mag: 30, reserve: 90, fireGap: 0.096, reloadTime: 1.9, spreadStill: 0.0022, spreadMove: 0.028, auto: true, kind: 'rifle', pellets: 1 },
  dmr: { id: 'dmr', name: 'Lance DMR', key: '4', price: 4000, damage: 88, headMult: 4, mag: 8, reserve: 32, fireGap: 0.85, reloadTime: 2.6, spreadStill: 0.0006, spreadMove: 0.05, auto: false, kind: 'dmr', pellets: 1 },
  shotgun: { id: 'shotgun', name: 'M12 Breacher', key: '5', price: 1800, damage: 13, headMult: 4, mag: 6, reserve: 24, fireGap: 0.8, reloadTime: 2.4, spreadStill: 0.02, spreadMove: 0.045, auto: false, kind: 'shotgun', pellets: 8 },
};

export const GRENADE_PRICE = 300;
export const ARMOR_PRICE = 650;
export const KILL_REWARD = 300;
export const PLANT_REWARD = 300;
export const WIN_REWARD = 3000;
export const LOSS_REWARD = 1900;
export const LOSS_STREAK_BONUS = 500;
export const START_MONEY = 800;

export function createEconomy() {
  const state = {
    money: START_MONEY,
    owned: new Set(['pistol']),
    grenades: 0,
    armor: 0,
    lossStreak: 0,
    kills: 0,
    plants: 0,
  };

  return {
    state,
    canAfford(price) {
      return state.money >= price;
    },
    buyWeapon(id) {
      const def = WEAPONS[id];
      if (!def) return false;
      if (state.owned.has(id)) return true;
      if (state.money < def.price) return false;
      state.money -= def.price;
      state.owned.add(id);
      return true;
    },
    buyGrenade() {
      if (state.grenades >= 2 || state.money < GRENADE_PRICE) return false;
      state.money -= GRENADE_PRICE;
      state.grenades += 1;
      return true;
    },
    buyArmor() {
      if (state.armor >= 100 || state.money < ARMOR_PRICE) return false;
      state.money -= ARMOR_PRICE;
      state.armor = 100;
      return true;
    },
    useGrenade() {
      if (state.grenades <= 0) return false;
      state.grenades -= 1;
      return true;
    },
    awardKill() {
      state.money += KILL_REWARD;
      state.kills += 1;
    },
    awardPlant() {
      state.money += PLANT_REWARD;
      state.plants += 1;
    },
    awardRound(won) {
      if (won) {
        state.money += WIN_REWARD;
        state.lossStreak = 0;
      } else {
        state.money += LOSS_REWARD + Math.min(2, state.lossStreak) * LOSS_STREAK_BONUS;
        state.lossStreak += 1;
      }
    },
    reset() {
      state.money = START_MONEY;
      state.owned = new Set(['pistol']);
      state.grenades = 0;
      state.armor = 0;
      state.lossStreak = 0;
      state.kills = 0;
      state.plants = 0;
    },
  };
}
