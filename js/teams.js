// ─────────────────────────────────────────────
// TEAM PRESETS
// color    = cor principal do botão (THREE hex)
// rimColor = cor da borda do botão (THREE hex)
// css      = cor CSS para HUD / menu
// ─────────────────────────────────────────────
export const TEAMS = [
  { id: 'flamengo',    name: 'Flamengo',      color: 0xDD0000, rimColor: 0x111111, css: '#DD0000' },
  { id: 'palmeiras',   name: 'Palmeiras',     color: 0x006437, rimColor: 0x003d20, css: '#006437' },
  { id: 'corinthians', name: 'Corinthians',   color: 0xDDDDDD, rimColor: 0x111111, css: '#DDDDDD' },
  { id: 'gremio',      name: 'Grêmio',        color: 0x1755AA, rimColor: 0x111111, css: '#1755AA' },
  { id: 'atletico',    name: 'Atlético MG',   color: 0x111111, rimColor: 0x555555, css: '#111111' },
  { id: 'cruzeiro',    name: 'Cruzeiro',      color: 0x0033BB, rimColor: 0x001f88, css: '#0033BB' },
  { id: 'fluminense',  name: 'Fluminense',    color: 0x8B1A28, rimColor: 0x500d15, css: '#8B1A28' },
  { id: 'santos',      name: 'Santos',        color: 0xF0F0F0, rimColor: 0x333333, css: '#F0F0F0' },
  { id: 'botafogo',    name: 'Botafogo',      color: 0x151515, rimColor: 0xDDDDDD, css: '#151515' },
  { id: 'vasco',       name: 'Vasco',         color: 0x222222, rimColor: 0x999999, css: '#222222' },
  { id: 'inter',       name: 'Internacional', color: 0xAA0000, rimColor: 0x660000, css: '#AA0000' },
  { id: 'spfc',        name: 'São Paulo FC',  color: 0xE8E8E8, rimColor: 0xCC0000, css: '#E8E8E8' },
];

export function teamById(id) {
  return TEAMS.find(t => t.id === id) ?? TEAMS[0];
}
