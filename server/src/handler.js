/**
 * API Gateway（WebSocket）から呼ばれる Lambda の入口（部屋の仕組みは server/netplay/ の共通部品）
 * 共有デッキの操作（shared-decks.js）だけは、部屋の処理に渡す前にここで答える
 */

import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { createHandler } from '../netplay/handler.js';
import game from './game-definition.js';
import { createSharedDecks, parseSharedDeckMessage } from './shared-decks.js';
import { DynamoSharedDeckStore } from './shared-deck-store.js';

const roomHandler = createHandler(game);
const sharedDecks = createSharedDecks(new DynamoSharedDeckStore(process.env.TABLE_NAME));
const clients = new Map(); // 送信用のクライアント（Lambda の呼び出しをまたいで使い回す）

function reply({ domainName, stage, connectionId }, message) {
    const endpoint = `https://${domainName}/${stage}`;
    if (!clients.has(endpoint)) clients.set(endpoint, new ApiGatewayManagementApiClient({ endpoint }));
    return clients.get(endpoint).send(new PostToConnectionCommand({ ConnectionId: connectionId, Data: JSON.stringify(message) }));
}

export const handler = async (event) => {
    const message = event.requestContext.routeKey === '$default' ? parseSharedDeckMessage(event.body) : null;
    if (!message) return roomHandler(event);
    await reply(event.requestContext, await sharedDecks(message));
    return { statusCode: 200 };
};
