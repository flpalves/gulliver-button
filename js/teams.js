// ─────────────────────────────────────────────
// TEAM PRESETS
// color    = cor principal do botão (hexadecimal)
// rimColor = cor da borda do botão (hexadecimal)
// css      = cor CSS para HUD / menu
// ─────────────────────────────────────────────
export const TEAMS = [
  { id: 'flamengo',    name: 'Flamengo',      color: '#DD0000', rimColor: '#111111', css: '#DD0000' },
  { id: 'palmeiras',   name: 'Palmeiras',     color: '#006437', rimColor: '#003D20', css: '#006437' },
  { id: 'corinthians', name: 'Corinthians',   color: '#DDDDDD', rimColor: '#111111', css: '#DDDDDD' },
  { id: 'gremio',      name: 'Grêmio',        color: '#1755AA', rimColor: '#111111', css: '#1755AA' },
  { id: 'atletico',    name: 'Atlético MG',   color: '#111111', rimColor: '#555555', css: '#111111' },
  { id: 'cruzeiro',    name: 'Cruzeiro',      color: '#0033BB', rimColor: '#001F88', css: '#0033BB' },
  { id: 'fluminense',  name: 'Fluminense',    color: '#114e02', rimColor: '#500D15', css: '#8B1A28' },
  { id: 'santos',      name: 'Santos',        color: '#F0F0F0', rimColor: '#333333', css: '#F0F0F0' },
  { id: 'botafogo',    name: 'Botafogo',      color: '#151515', rimColor: '#DDDDDD', css: '#151515' },
  { id: 'vasco',       name: 'Vasco',         color: '#222222', rimColor: '#999999', css: '#222222' },
  { id: 'inter',       name: 'Internacional', color: '#AA0000', rimColor: '#660000', css: '#AA0000' },
  { id: 'spfc',        name: 'São Paulo FC',  color: '#e8e8e852', rimColor: '#cc0000', css: '#E8E8E8' },
];

export function hexToNumber(hex) {
  return parseInt(hex.replace('#', ''), 16);
}

export function teamById(id) {
  return TEAMS.find(t => t.id === id) ?? TEAMS[0];
}
