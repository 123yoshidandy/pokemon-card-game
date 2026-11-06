/**
 * 共有デッキの保存先
 * 部屋と同じ DynamoDB のテーブルに、デッキごとに1つの項目（pk = SHARED_DECK#デッキのID）で入れる
 * 部屋と違って expiresAt を付けないので、TTL では消えない
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchGetCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';

const key = id => `SHARED_DECK#${id}`;

export class DynamoSharedDeckStore {
    constructor(tableName, client = DynamoDBDocumentClient.from(new DynamoDBClient({}))) {
        this.tableName = tableName;
        this.client = client;
    }

    async getAll(ids) {
        const { Responses } = await this.client.send(new BatchGetCommand({
            RequestItems: { [this.tableName]: { Keys: ids.map(id => ({ pk: key(id) })), ConsistentRead: true } }
        }));
        const decks = {};
        for (const { pk, deck } of Responses?.[this.tableName] ?? []) decks[pk.slice(key('').length)] = deck;
        return decks;
    }

    async put(id, deck) {
        await this.client.send(new PutCommand({ TableName: this.tableName, Item: { pk: key(id), deck } }));
    }

    async remove(id) {
        await this.client.send(new DeleteCommand({ TableName: this.tableName, Key: { pk: key(id) } }));
    }
}
