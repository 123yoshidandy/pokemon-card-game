/**
 * API Gateway（WebSocket）から呼ばれる Lambda の入口（部屋の仕組みは server/netplay/ の共通部品）
 */

import { createHandler } from '../netplay/handler.js';
import game from './game-definition.js';

export const handler = createHandler(game);
