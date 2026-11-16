// The look plan, in one place: dark slate foundry, amber accent, dusk-teal fill.
// The same six names are the CSS custom properties in index.html.
export const PALETTE = {
  canvas: '#1c1f24',
  surface: '#2b3038',
  hairline: '#31373f',
  ink: '#ece7db',
  muted: '#8f9aa3',
  accent: '#f5a623',
};

export function shade(name) {
  return PALETTE[name];
}
