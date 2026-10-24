/**
 * オンライン対戦の部屋に差し込む、ポケモンカードゲームの定義（部屋の仕組みは server/netplay/ の共通部品）
 *
 * 部屋には参加者・シード・操作の記録だけを保存し、操作を受けるたびに記録からゲームを再現する
 * 各プレイヤーには、そのプレイヤーから見える状態（ビュー）だけを送る
 * デッキは対戦の最初に、各プレイヤーが { type: 'deck', cards } で送る
 */

import Game from '../../public/js/game.js';
import { createGameView } from '../../public/js/game-view.js';
import { runCpuStep, actingPlayerId } from '../../public/js/cpu-player.js';

// 端末から受け付ける操作と、記録する項目（proxy はサーバーだけが使う）
const COMMAND_FIELDS = {
    deck: ['cards'],
    playBasic: ['uid'],
    evolve: ['uid', 'target'],
    attachEnergy: ['uid', 'target'],
    playTrainer: ['uid', 'target'],
    useAbility: ['target'],
    useHandAbility: ['uid'],
    useStadium: [],
    retreat: ['target'],
    attack: ['index'],
    endTurn: [],
    answer: ['answer']
};

export default {
    minPlayers: 2,
    maxPlayers: 2,
    allowCpu: true,
    rematch: 'host',
    maxCpuSteps: 3000, // CPU だけが残った部屋でも、決着まで進められるように

    create({ players, random }) {
        const options = { seed: Math.floor(random() * 2 ** 32) };
        return startGame(players.map(({ name, isCPU }) => ({ name, isCPU })), options, []);
    },

    // 保存するのは参加者（開始したときの CPU の指定）・シード・操作の記録だけ
    persist: (game) => ({ players: game.startingPlayers, options: game.startingOptions, commands: game.commands }),
    restore: (saved) => startGame(saved.players, saved.options, saved.commands),

    view: (game, seat) => createGameView(game, seat),

    actions: {
        command({ game, seat, message, reject }) {
            const command = message.command;
            const fields = command && typeof command === 'object' ? COMMAND_FIELDS[command.type] : null;
            if (!fields) return reject('不明な操作です');
            // 記録する項目だけに絞る
            const accepted = { type: command.type, ...Object.fromEntries(fields.map(field => [field, command[field]])) };
            if (!game.applyCommand(seat, accepted)) reject(game.lastError ?? '今はその操作はできません');
        }
    },

    isOver: (game) => game.phase === 'end',

    cpu: {
        needsStep: (game) => {
            const playerId = actingPlayerId(game);
            return playerId !== null && game.players[playerId].isCPU;
        },
        step: (game) => runCpuStep(game),
        progress: (game) => game.commands.length
    },

    // 対戦中に部屋を出た人は、以後 CPU が代わりに操作する（切断は戻ってくるかもしれないので待つ）
    onPlayerGone(ctx, { seat, reason }) {
        if (reason !== 'left' || !ctx.game.applyCommand(seat, { type: 'proxy' })) ctx.ignore();
    }
};

// 記録からゲームを作る（開始したときの参加者とオプションは、保存するために残しておく）
function startGame(players, options, commands) {
    const game = Game.replay(players, options, commands);
    game.startingPlayers = players;
    game.startingOptions = options;
    return game;
}
