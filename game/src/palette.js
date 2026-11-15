// The look plan, in one place. Ember Yard at dusk: warm dark ground, rusted steel,
// one ember-orange accent, red for the enemy team, yellow for the bombsite.
// The same names are the CSS custom properties in index.html.
export const PALETTE = {
  canvas: '#211a14',
  surface: '#2a211a',
  hairline: '#4a3a2a',
  ink: '#f2e8d8',
  muted: '#a89a86',
  accent: '#ff7a2f',
  foe: '#e5484d',
  site: '#ffc53d',
  steel: '#6b7c8c',
};

export function shade(name) {
  return PALETTE[name];
}
