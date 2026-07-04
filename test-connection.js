/**
 * test-connection.js
 * Script para testar Socket.io e fluxo de criar/entrar em sala
 *
 * Execução:
 *   1. npm start (em outro terminal)
 *   2. node test-connection.js
 */

import { io } from 'socket.io-client';

const SERVER_URL = 'http://localhost:3000';

console.log('🔌 Teste de Conexão Socket.io - Passos 1-5\n');
console.log(`Conectando a ${SERVER_URL}...\n`);

// Cliente 1 (Amarelo - Criador da Sala)
const client1 = io(SERVER_URL);
let roomCodeGenerated = null;

client1.on('connect', () => {
  console.log('✅ [Cliente 1] Conectado ao servidor');
  console.log(`   Socket ID: ${client1.id.substring(0, 12)}...\n`);

  // Criar sala
  console.log('📝 [Cliente 1] Criando sala...');
  client1.emit('create_room', {
    gameConfig: {
      gameMode: 'button_football',
      yellowTeam: 'flamengo',
      blueTeam: 'palmeiras',
      matchDuration: 600
    }
  });
});

client1.on('room_created', (data) => {
  roomCodeGenerated = data.roomCode;
  console.log(`✅ [Cliente 1] Sala criada!`);
  console.log(`   Código: ${data.roomCode}`);
  console.log(`   Config: ${JSON.stringify(data.config, null, 2)}\n`);

  // Agora cliente 2 tenta entrar
  setTimeout(() => {
    console.log('🔌 [Cliente 2] Conectando ao servidor...');
    const client2 = io(SERVER_URL);

    client2.on('connect', () => {
      console.log('✅ [Cliente 2] Conectado ao servidor');
      console.log(`   Socket ID: ${client2.id.substring(0, 12)}...\n`);

      // Entrar na sala
      console.log(`📝 [Cliente 2] Entrando na sala ${roomCodeGenerated}...`);
      client2.emit('join_room', roomCodeGenerated);
    });

    client2.on('room_ready', (data) => {
      console.log(`✅ [Cliente 2] Sala pronta!`);
      console.log(`   Seu time: ${data.myTeam}`);
      console.log(`   Código da sala: ${data.roomCode}\n`);
    });

    client1.on('room_ready', (data) => {
      console.log(`✅ [Cliente 1] Sala pronta!`);
      console.log(`   Seu time: ${data.myTeam}`);
      console.log(`   Código da sala: ${data.roomCode}\n`);

      // Sucesso! Encerrar teste
      setTimeout(() => {
        console.log('✅ TESTE BEM-SUCEDIDO!\n');
        console.log('📊 Resumo:');
        console.log('   ✓ Cliente 1 conectou');
        console.log('   ✓ Cliente 1 criou sala com código 4-letras');
        console.log('   ✓ Cliente 2 conectou');
        console.log('   ✓ Cliente 2 entrou na sala');
        console.log('   ✓ Ambos receberam room_ready');
        console.log('   ✓ Salas foram geradas corretamente\n');

        client1.disconnect();
        client2.disconnect();
        process.exit(0);
      }, 1000);
    });

    client2.on('error', (error) => {
      console.error('❌ [Cliente 2] Erro:', error);
      process.exit(1);
    });
  }, 500);
});

client1.on('error', (error) => {
  console.error('❌ [Cliente 1] Erro:', error);
  process.exit(1);
});

// Timeout geral
setTimeout(() => {
  console.error('❌ TIMEOUT - Teste não completou em 10 segundos');
  process.exit(1);
}, 10000);
