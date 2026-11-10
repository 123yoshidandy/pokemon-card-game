/**
 * 共有デッキの保存先
 * 部屋と同じ DynamoDB のテーブルに、デッキごとに1つの項目（pk = SHARED_DECK#デッキのID）で入れる
 * 部屋と違って expiresAt を付けないので、TTL では消えない
 * 作った共有デッキのIDは決まっていないので、読むときは SHARED_DECK# で始まる項目を Scan で集める
 * （テーブルには部屋と接続も入るが、部屋は TTL で消えるので小さい）
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';

const PREFIX = 'SHARED_DECK#';
const key = id => `${PREFIX}${id}`;

export class DynamoSharedDeckStore {
    constructor(tableName, client = DynamoDBDocumentClient.from(new DynamoDBClient({}))) {
        this.tableName = tableName;
        this.client = client;
    }

    async getAll() {
        const decks = {};
        let start;
        do {
            const { Items, LastEvaluatedKey } = await this.client.send(new ScanCommand({
                TableName: this.tableName,
                FilterExpression: 'begins_with(pk, :prefix)',
                ExpressionAttributeValues: { ':prefix': PREFIX },
                ConsistentRead: true,
                ExclusiveStartKey: start
            }));
            for (const { pk, deck } of Items ?? []) decks[pk.slice(PREFIX.length)] = deck;
            start = LastEvaluatedKey;
        } while (start);
        return decks;
    }

    async put(id, deck) {
        await this.client.send(new PutCommand({ TableName: this.tableName, Item: { pk: key(id), deck } }));
    }

    async remove(id) {
        await this.client.send(new DeleteCommand({ TableName: this.tableName, Key: { pk: key(id) } }));
    }
}
