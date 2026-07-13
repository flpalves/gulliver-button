/**
 * js/app-init.js
 * Inicializa o aplicativo com suporte a modo local e multiplayer
 */

import { initGameMultiplayer, RULE_MODES, GAME_MODES } from './main.js';
import { MultiplayerUI } from './multiplayer-ui.js';

// Inicializar UI de multiplayer
const multiplayerUI = new MultiplayerUI();

multiplayerUI.onGameStart = (mode, multiplayer) => {
  console.log(`[App Init] Modo selecionado: ${mode}`);

  if (mode === 'local') {
    // Jogar Local - chamar init() diretamente
    const { initGame } = await import('./main.js');
    initGame();
  } else if (mode === 'multiplayer' && multiplayer) {
    // Jogar Online - chamar initGameMultiplayer com multiplayer
    initGameMultiplayer(
      RULE_MODES.FOUR_TOUCHES,
      'sphere',
      GAME_MODES.STANDARD,
      5 * 60,
      multiplayer
    );
  }
};

console.log('[App Init] Aplicativo pronto. Aguardando escolha do modo...');
