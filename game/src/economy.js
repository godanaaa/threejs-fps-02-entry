// The economy: money earned each round and spent in the buy menu. The player starts
// with $800 and a pistol; a win pays $300, a loss $150, a kill $300 and a plant $300.
// Armour halves incoming damage for the round. Prices match weapon.js.
export const REWARDS = { win: 300, loss: 150, kill: 300, plant: 300 };
export const ARMOR_PRICE = 400;
export const GRENADE_PRICE = 300;
export const GRENADE_MAX = 2;

export const BUY_ITEMS = [
  { key: 'rifle', name: 'VK-7 Repeater', kind: 'primary', price: 1200, blurb: '30 rounds · steady at range' },
  { key: 'smg', name: 'Hornet-9', kind: 'primary', price: 800, blurb: '24 rounds · fast up close' },
  { key: 'marksman', name: 'Longshot', kind: 'primary', price: 2200, blurb: '5 rounds · one shot, one down' },
  { key: 'grenade', name: 'Frag grenade', kind: 'grenade', price: GRENADE_PRICE, blurb: 'Arcing throw · radius damage' },
  { key: 'armor', name: 'Armour vest', kind: 'armor', price: ARMOR_PRICE, blurb: 'Halves damage this round' },
];

export function createEconomy() {
  const state = { money: 800, armor: false, grenades: 0 };
  return {
    state,
    reset() {
      state.money = 800;
      state.armor = false;
      state.grenades = 0;
    },
    earn(amount) {
      state.money += amount;
    },
    roundEnd(won) {
      state.money += won ? REWARDS.win : REWARDS.loss;
      state.armor = false;
    },
    // Returns the item bought, or null when it cannot be bought.
    buy(item) {
      if (item.kind === 'armor') {
        if (state.armor || state.money < item.price) return null;
        state.money -= item.price;
        state.armor = true;
        return item;
      }
      if (item.kind === 'grenade') {
        if (state.grenades >= GRENADE_MAX || state.money < item.price) return null;
        state.money -= item.price;
        state.grenades += 1;
        return item;
      }
      if (state.money < item.price) return null;
      state.money -= item.price;
      return item;
    },
  };
}
