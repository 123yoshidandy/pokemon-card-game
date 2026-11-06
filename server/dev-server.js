/**
 * 手元でオンライン対戦を試すための WebSocket サーバー（AWS と同じ部屋の処理を、保存先をメモリにして動かす）
 * 使い方: npm run dev:server  （ポートは PORT で変えられる。画面は別に python3 -m http.server などで public/ を配信する）
 */

import { startDevServer } from './netplay/dev-server.js';
import game from './src/game-definition.js';
import { createSharedDecks, parseSharedDeckMessage, MemorySharedDeckStore } from './src/shared-decks.js';

const { service } = startDevServer(game);

// 共有デッキの操作は、部屋の処理に渡す前に答える（src/handler.js と同じ）
const sharedDecks = createSharedDecks(new MemorySharedDeckStore());
const handleRoomMessage = service.handleRaw.bind(service);
service.handleRaw = async (connectionId, raw) => {
    const message = parseSharedDeckMessage(raw);
    if (!message) return handleRoomMessage(connectionId, raw);
    await service.send(connectionId, await sharedDecks(message));
};
