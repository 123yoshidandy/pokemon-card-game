/**
 * ゲームの進行（ポケモンカードゲームの基本ルール）
 * DOM に依存しないので、ブラウザ・サーバー・テストのどこでも同じように動く
 *
 * 操作はすべて applyCommand(playerId, command) を通し、受け付けた操作だけを commands に記録する
 * 乱数はシード付きなので、Game.replay で記録から同じ状態を作り直せる
 *
 * カードの効果やターンの進行は「手順」の列（effectQueue）で進め、プレイヤーの選択待ち（pendingPrompt）の間は止める
 */

import { createRandom, shuffle } from './random.js';
import { getCard, isBasicEnergy, isBasicPokemon, TYPE_NAMES } from './card-data.js';
import { validateDeck } from './deck-rules.js';

export const PRIZE_COUNT = 6;
export const BENCH_SIZE = 5;
export const OPENING_HAND = 7;
const CONFUSION_DAMAGE = 30;
const POISON_DAMAGE = 10;
const BURN_DAMAGE = 20;
const WEAKNESS_MULTIPLIER = 2;
const RESISTANCE_REDUCTION = 30;

export const CONDITION_NAMES = {
    asleep: 'ねむり',
    paralyzed: 'マヒ',
    confused: 'こんらん',
    poisoned: 'どく',
    burned: 'やけど'
};

const newTurnState = () => ({
    energyAttached: false,
    supporterPlayed: false,
    stadiumPlayed: false,
    stadiumUsed: false,
    retreated: false,
    attacked: false,
    abilitiesUsed: []
});

export default class Game {
    // players: [{ name, isCPU }] / options: { seed, decks: [[カードID...], [カードID...]] }
    // decks を渡さなければ、各プレイヤーが { type: 'deck' } でデッキを決めてから始める（オンライン対戦）
    constructor(players, { seed = 0, decks = null } = {}) {
        if (players.length !== 2) throw new Error('プレイヤーは2人です');
        if (decks) {
            if (decks.length !== 2) throw new Error('デッキが2つ必要です');
            decks.forEach(deck => {
                if (!deck.some(id => isBasicPokemon(getCard(id)))) throw new Error('デッキにたねポケモンがありません');
            });
        }
        this.seed = seed >>> 0;
        this.random = createRandom(this.seed);
        this.decks = decks ? [...decks] : [null, null];
        this.benchSize = BENCH_SIZE;
        this.players = players.map((player, id) => ({
            id,
            name: player.name,
            isCPU: Boolean(player.isCPU),
            deck: [],
            hand: [],
            discard: [],
            prizes: [],
            active: null,
            bench: [],
            turnsTaken: 0,
            mulligans: 0
        }));
        this.phase = 'setup'; // deck（デッキを決める）→ setup → main → end
        this.turn = 0;
        this.current = 0;
        this.firstPlayer = null;
        this.stadium = null; // { inst, owner }
        this.turnState = newTurnState();
        this.effectQueue = [];
        this.pendingPrompt = null;
        this.promptCount = 0;
        this.commands = [];
        this.logs = [];
        this.winner = null; // プレイヤーのID、引き分けは 'draw'
        this.endReason = null;
        this.lastError = null;
        this.nextUid = 1;
    }

    // ===== 準備 =====

    setup() {
        if (this.decks.some(deck => !deck)) {
            this.phase = 'deck';
            return;
        }
        this.beginSetup();
    }

    // デッキを決める（両者がそろったら準備を始める）
    submitDeck(player, cards) {
        this.decks[player.id] = [...cards];
        this.log(`${player.name}はデッキを決めた`);
        if (this.decks.every(Boolean)) {
            this.phase = 'setup';
            this.beginSetup();
        }
    }

    beginSetup() {
        this.players.forEach((player, index) => {
            player.deck = this.decks[index].map(id => ({ uid: `c${this.nextUid++}`, id }));
            shuffle(player.deck, this.random);
        });
        this.effectQueue.push(
            () => this.decideFirstPlayer(),
            () => this.players.forEach(player => this.drawOpeningHand(player)),
            () => this.promptSetupPokemon(this.players[0]),
            () => this.promptSetupPokemon(this.players[1]),
            () => this.revealSetup(),
            () => this.promptMulliganDraws(),
            () => this.startTurn(this.firstPlayer)
        );
        this.processEffects();
    }

    // コインを投げて、勝った人が先攻・後攻を選ぶ
    decideFirstPlayer() {
        const winner = this.players[this.random() < 0.5 ? 0 : 1];
        this.log(`コイントスで${winner.name}が勝った`);
        this.promptChoose({
            player: winner,
            options: ['先攻', '後攻'],
            title: '先攻・後攻を選ぶ',
            purpose: 'first-player',
            callback: ([index]) => {
                this.firstPlayer = index === 0 ? winner.id : 1 - winner.id;
                this.log(`${this.players[this.firstPlayer].name}の先攻`);
            }
        });
    }

    // 7枚引き、たねポケモンがなければ引き直す（マリガン）
    drawOpeningHand(player) {
        for (;;) {
            this.draw(player, OPENING_HAND, { silent: true });
            if (player.hand.some(inst => isBasicPokemon(this.cardOf(inst)))) break;
            player.mulligans++;
            this.log(`${player.name}の手札にたねポケモンがないので、引き直した（${player.mulligans}回目）`);
            player.deck.push(...player.hand);
            player.hand = [];
            shuffle(player.deck, this.random);
        }
        this.log(`${player.name}は手札を${OPENING_HAND}枚引いた`);
    }

    // バトル場とベンチに、たねポケモンをウラで出す
    promptSetupPokemon(player) {
        const basics = () => player.hand.filter(inst => isBasicPokemon(this.cardOf(inst)));
        this.promptCards({
            player,
            cards: basics(),
            min: 1,
            max: 1,
            title: 'バトル場に出すたねポケモンを選ぶ',
            purpose: 'setup-active',
            callback: ([inst]) => {
                this.removeCard(player.hand, inst);
                player.active = this.createPokemon(inst, { faceDown: true });
                const rest = basics();
                if (rest.length === 0) return;
                this.promptCards({
                    player,
                    cards: rest,
                    min: 0,
                    max: Math.min(BENCH_SIZE, rest.length),
                    title: 'ベンチに出すたねポケモンを選ぶ',
                    purpose: 'setup-bench',
                    callback: selected => {
                        selected.forEach(benchInst => {
                            this.removeCard(player.hand, benchInst);
                            player.bench.push(this.createPokemon(benchInst, { faceDown: true }));
                        });
                    }
                });
            }
        });
    }

    // サイドを置き、出したポケモンをオモテにする
    revealSetup() {
        this.players.forEach(player => {
            player.prizes = player.deck.splice(0, PRIZE_COUNT);
            this.inPlay(player).forEach(pokemon => { pokemon.faceDown = false; });
            const names = this.inPlay(player).map(pokemon => this.topCard(pokemon).name);
            this.log(`${player.name}：${names[0]}がバトル場${names.length > 1 ? `、${names.slice(1).join('・')}がベンチ` : ''}`);
        });
    }

    // 相手がマリガンした回数まで、追加で引ける
    promptMulliganDraws() {
        const steps = this.players
            .filter(player => this.opponentOf(player).mulligans > 0 && player.deck.length > 0)
            .map(player => () => {
                const max = Math.min(this.opponentOf(player).mulligans, player.deck.length);
                this.promptChoose({
                    player,
                    options: Array.from({ length: max + 1 }, (_, count) => `${count}枚`),
                    title: '相手のマリガンの回数まで、追加で引けます',
                    purpose: 'mulligan-draw',
                    callback: ([count]) => { if (count > 0) this.draw(player, count); }
                });
            });
        this.runNext(...steps);
    }

    // ===== 手番の進行 =====

    startTurn(playerId) {
        this.phase = 'main';
        this.turn++;
        this.current = playerId;
        this.turnState = newTurnState();
        const player = this.players[playerId];
        player.turnsTaken++;
        this.log(`— ${this.turn}ターン目：${player.name}の番 —`);
        if (player.deck.length === 0) {
            this.endGame(this.opponentOf(player).id, 'deckout', `${player.name}は山札を引けなかった`);
            return;
        }
        this.draw(player, 1);
    }

    // 番の終わり：ポケモンチェック → きぜつの確認 → 相手の番
    queueEndOfTurn() {
        this.effectQueue.push(
            () => this.pokemonCheckup(),
            () => this.checkKnockouts(),
            () => this.startTurn(1 - this.current)
        );
    }

    // ポケモンチェック：どく・やけど・ねむり・マヒ（手番のプレイヤーから）
    pokemonCheckup() {
        [this.current, 1 - this.current].forEach(playerId => {
            const pokemon = this.players[playerId].active;
            if (!pokemon) return;
            const name = this.topCard(pokemon).name;
            if (pokemon.poisoned) {
                pokemon.damage += POISON_DAMAGE;
                this.log(`${name}はどくで${POISON_DAMAGE}ダメージ`);
            }
            if (pokemon.burned) {
                pokemon.damage += BURN_DAMAGE;
                this.log(`${name}はやけどで${BURN_DAMAGE}ダメージ`);
                if (this.flipCoin()) {
                    pokemon.burned = false;
                    this.log(`${name}のやけどが治った`);
                }
            }
            if (pokemon.rotation === 'asleep' && this.flipCoin()) {
                pokemon.rotation = null;
                this.log(`${name}は目を覚ました`);
            }
            if (pokemon.rotation === 'paralyzed' && playerId === this.current) {
                pokemon.rotation = null;
                this.log(`${name}のマヒが治った`);
            }
        });
        this.players.forEach(player => this.inPlay(player).forEach(pokemon => {
            pokemon.effects = pokemon.effects.filter(effect => effect.untilTurn > this.turn);
        }));
    }

    // HP がなくなったポケモンをきぜつさせ、サイドを取り、勝敗とバトル場の補充を確かめる
    checkKnockouts() {
        if (this.phase === 'end') return;
        const knocked = [];
        this.players.forEach(player => this.inPlay(player).forEach(pokemon => {
            if (pokemon.damage >= this.maxHp(pokemon)) knocked.push({ player, pokemon });
        }));
        if (knocked.length === 0) return;

        knocked.forEach(({ player, pokemon }) => {
            const card = this.topCard(pokemon);
            this.log(`${player.name}の${card.name}はきぜつした`);
            this.removeFromPlay(player, pokemon);
            const taker = this.opponentOf(player);
            const count = Math.min(this.prizeValue(card), taker.prizes.length);
            const taken = taker.prizes.splice(0, count);
            taker.hand.push(...taken);
            this.log(`${taker.name}はサイドを${count}枚取った（残り${taker.prizes.length}枚）`);
            this.log(`サイドから${taken.map(inst => this.cardName(inst)).join('と')}を手札に加えた`, { to: taker.id });
        });

        if (this.checkWinner()) return;

        // バトル場が空いたら、ベンチから出す（手番でないプレイヤーから）
        const steps = [1 - this.current, this.current]
            .map(id => this.players[id])
            .filter(player => !player.active)
            .map(player => () => this.promptPromote(player));
        this.runNext(...steps);
    }

    // サイドを取り切った・相手の場にポケモンがいない、を確かめる。決着したら true
    checkWinner() {
        const wins = this.players.map(player =>
            player.prizes.length === 0 || this.inPlay(this.opponentOf(player)).length === 0);
        if (wins[0] && wins[1]) {
            this.endGame('draw', 'both', '両者が同時に勝利条件を満たした');
            return true;
        }
        const winner = wins.indexOf(true);
        if (winner === -1) return false;
        const loser = this.players[1 - winner];
        const reason = this.players[winner].prizes.length === 0 ? 'prizes' : 'nopokemon';
        this.endGame(winner, reason, reason === 'prizes'
            ? `${this.players[winner].name}がサイドをすべて取った`
            : `${loser.name}の場にポケモンがいなくなった`);
        return true;
    }

    promptPromote(player) {
        if (player.active || player.bench.length === 0 || this.phase === 'end') return;
        this.promptPokemon({
            player,
            pokemon: player.bench,
            min: 1,
            max: 1,
            title: 'バトル場に出すポケモンを選ぶ',
            purpose: 'promote',
            callback: ([pokemon]) => {
                this.removeCard(player.bench, pokemon);
                player.active = pokemon;
                this.log(`${player.name}は${this.topCard(pokemon).name}をバトル場に出した`);
            }
        });
    }

    endGame(winner, reason, message) {
        this.phase = 'end';
        this.winner = winner;
        this.endReason = reason;
        this.effectQueue = [];
        this.pendingPrompt = null;
        this.log(message);
        this.log(winner === 'draw' ? '引き分け' : `${this.players[winner].name}の勝ち`);
    }

    // ===== 操作 =====
    //   { type: 'deck', cards }               デッキを決める（カードIDの配列。オンライン対戦の最初だけ）
    //   { type: 'playBasic', uid }            たねポケモンをベンチに出す
    //   { type: 'evolve', uid, target }       手札のポケモンで進化させる（target は場のポケモンのID）
    //   { type: 'attachEnergy', uid, target } エネルギーをつける（1ターンに1回）
    //   { type: 'playTrainer', uid, target }  トレーナーズを使う（target はポケモンのどうぐのつけ先）
    //   { type: 'useAbility', target }        場のポケモンの特性を使う
    //   { type: 'useStadium' }                スタジアムの効果を使う
    //   { type: 'retreat', target }           にげる（target は入れ替えるベンチポケモン）
    //   { type: 'attack', index }             バトルポケモンのワザを使う（番が終わる）
    //   { type: 'endTurn' }                   番を終える
    //   { type: 'answer', answer }            選択に答える（cards・pokemon・choose はインデックスの配列、confirm は真偽値）
    //   { type: 'proxy' }                     部屋を出たプレイヤーを、以後CPUが代わりに操作する（オンライン対戦のサーバーだけが送る）
    applyCommand(playerId, command) {
        this.lastError = null;
        const player = this.players[playerId];
        if (!player || !command) return this.reject('不明な操作です');

        let accepted = false;
        const main = () => this.checkMain(player);
        switch (command.type) {
            case 'deck': accepted = this.run(this.checkDeck(player, command.cards), () => this.submitDeck(player, command.cards)); break;
            case 'playBasic': accepted = this.run(main() ?? this.checkPlayBasic(player, command.uid), () => this.playBasic(player, command.uid)); break;
            case 'evolve': accepted = this.run(main() ?? this.checkEvolve(player, command.uid, command.target), () => this.evolve(player, command.uid, command.target)); break;
            case 'attachEnergy': accepted = this.run(main() ?? this.checkAttachEnergy(player, command.uid, command.target), () => this.attachEnergy(player, command.uid, command.target)); break;
            case 'playTrainer': accepted = this.run(main() ?? this.checkPlayTrainer(player, command.uid, command.target), () => this.playTrainer(player, command.uid, command.target)); break;
            case 'useAbility': accepted = this.run(main() ?? this.checkAbility(player, command.target), () => this.useAbility(player, command.target)); break;
            case 'useStadium': accepted = this.run(main() ?? this.checkStadium(player), () => this.useStadium(player)); break;
            case 'retreat': accepted = this.run(main() ?? this.checkRetreat(player, command.target), () => this.retreat(player, command.target)); break;
            case 'attack': accepted = this.run(main() ?? this.checkAttack(player, command.index), () => this.attack(player, command.index)); break;
            case 'endTurn': accepted = this.run(main(), () => this.endTurn()); break;
            case 'answer': accepted = this.run(this.checkAnswer(player, command.answer), () => this.resolvePrompt(command.answer)); break;
            case 'proxy': accepted = this.run(player.isCPU || this.phase === 'end' ? 'できません' : null, () => this.startProxy(player)); break;
            default: this.reject('不明な操作です');
        }
        if (accepted) this.commands.push({ playerId, ...command });
        return accepted;
    }

    // 判定（error が null なら受け付ける）→ 実行 → 手順を進める。判定は状態を変えない
    run(error, action) {
        if (error) return this.reject(error);
        action();
        this.processEffects();
        return true;
    }

    reject(message) {
        this.lastError = message;
        return false;
    }

    static replay(players, options, commands) {
        const game = new Game(players, options);
        game.setup();
        commands.forEach(({ playerId, ...command }, index) => {
            if (!game.applyCommand(playerId, command)) {
                throw new Error(`操作 ${index} を再現できませんでした: ${game.lastError}`);
            }
        });
        return game;
    }

    startProxy(player) {
        player.isCPU = true;
        this.log(`${player.name}が部屋を出たため、CPUが代わりに操作します`);
    }

    // ===== 操作の判定（状態を変えない。だめなら理由の文字列を返す） =====

    checkDeck(player, cards) {
        if (this.phase !== 'deck') return '今はデッキを決められません';
        if (this.decks[player.id]) return 'デッキはもう決めました';
        return validateDeck(cards);
    }

    checkMain(player) {
        if (this.phase !== 'main') return '今はその操作はできません';
        if (this.pendingPrompt) return '選択を完了してください';
        if (player.id !== this.current) return 'あなたの番ではありません';
        return null;
    }

    findInHand(player, uid) {
        return player.hand.find(inst => inst.uid === uid) ?? null;
    }

    checkPlayBasic(player, uid) {
        const inst = this.findInHand(player, uid);
        if (!inst || !isBasicPokemon(this.cardOf(inst))) return 'たねポケモンを選んでください';
        if (player.bench.length >= BENCH_SIZE) return 'ベンチがいっぱいです';
        return null;
    }

    checkEvolve(player, uid, targetId) {
        const inst = this.findInHand(player, uid);
        const card = inst && this.cardOf(inst);
        if (!card || card.kind !== 'pokemon' || card.stage === 0) return '進化ポケモンを選んでください';
        const target = this.ownPokemon(player, targetId);
        if (!target) return '進化させるポケモンを選んでください';
        if (this.topCard(target).id !== card.evolvesFrom) return `${card.name}は${this.topCard(target).name}から進化しません`;
        return this.checkCanEvolveNow(player, target);
    }

    // 最初の自分の番と、この番に出した（進化した）ポケモンは進化できない
    checkCanEvolveNow(player, target) {
        if (player.turnsTaken <= 1) return '最初の自分の番は進化できません';
        if (target.enteredTurn >= this.turn) return 'この番に出したポケモンは進化できません';
        return null;
    }

    checkAttachEnergy(player, uid, targetId) {
        const inst = this.findInHand(player, uid);
        if (!inst || this.cardOf(inst).kind !== 'energy') return 'エネルギーを選んでください';
        if (this.turnState.energyAttached) return 'エネルギーはこの番にもうつけました';
        if (!this.ownPokemon(player, targetId)) return 'つけるポケモンを選んでください';
        return null;
    }

    checkPlayTrainer(player, uid, targetId) {
        const inst = this.findInHand(player, uid);
        const card = inst && this.cardOf(inst);
        if (!card || card.kind !== 'trainer') return 'トレーナーズを選んでください';
        if (card.trainerType === 'supporter') {
            if (this.turnState.supporterPlayed) return 'サポートはこの番にもう使いました';
            if (this.turn === 1 && !card.firstTurnOk) return '先攻の最初の番はサポートを使えません';
        }
        if (card.trainerType === 'stadium') {
            if (this.turnState.stadiumPlayed) return 'スタジアムはこの番にもう出しました';
            if (this.stadium && this.cardOf(this.stadium.inst).name === card.name) return '同じ名前のスタジアムが出ています';
        }
        if (card.trainerType === 'tool') {
            const target = this.ownPokemon(player, targetId);
            if (!target) return 'つけるポケモンを選んでください';
            if (target.tool) return 'そのポケモンはもうどうぐをつけています';
        }
        if (!card.canPlay(this, player)) return `今は${card.name}を使えません`;
        return null;
    }

    checkAbility(player, targetId) {
        const pokemon = this.ownPokemon(player, targetId);
        const ability = pokemon && this.topCard(pokemon).ability;
        if (!ability || ability.type !== 'activated') return '使える特性がありません';
        if (this.turnState.abilitiesUsed.includes(pokemon.id)) return 'この特性はこの番にもう使いました';
        if (!ability.canUse(this, player, pokemon)) return `今は${ability.name}を使えません`;
        return null;
    }

    checkStadium(player) {
        const card = this.stadium && this.cardOf(this.stadium.inst);
        if (!card?.use) return '使えるスタジアムがありません';
        if (this.turnState.stadiumUsed) return 'スタジアムはこの番にもう使いました';
        if (!card.canUse(this, player)) return `今は${card.name}を使えません`;
        return null;
    }

    checkRetreat(player, targetId) {
        const active = player.active;
        if (!active) return 'バトルポケモンがいません';
        if (this.turnState.retreated) return 'にげるはこの番にもう使いました';
        if (active.rotation === 'asleep' || active.rotation === 'paralyzed') return `${CONDITION_NAMES[active.rotation]}のポケモンはにげられません`;
        if (!player.bench.some(pokemon => pokemon.id === targetId)) return '入れ替えるベンチポケモンを選んでください';
        if (active.energies.length < this.retreatCost(active)) return 'にげるためのエネルギーが足りません';
        return null;
    }

    checkAttack(player, index) {
        if (this.turn === 1) return '先攻の最初の番はワザを使えません';
        const active = player.active;
        const attack = active && this.topCard(active).attacks[index];
        if (!attack) return 'ワザを選んでください';
        if (active.rotation === 'asleep' || active.rotation === 'paralyzed') return `${CONDITION_NAMES[active.rotation]}のポケモンはワザを使えません`;
        if (active.effects.some(effect => effect.kind === 'cannotAttack' && effect.untilTurn >= this.turn)) return 'このポケモンはこの番ワザを使えません';
        if (active.effects.some(effect => effect.kind === 'cannotUseAttack' && effect.attack === attack.name && effect.untilTurn >= this.turn)) return `この番は「${attack.name}」を使えません`;
        if (!this.canPayCost(active, attack.cost)) return 'エネルギーが足りません';
        return null;
    }

    checkAnswer(player, answer) {
        const prompt = this.pendingPrompt;
        if (!prompt) return '選択はありません';
        if (prompt.player.id !== player.id) return 'あなたの選択ではありません';
        if (prompt.type === 'confirm') return null;
        const indices = Array.isArray(answer) ? answer : null;
        if (!indices || new Set(indices).size !== indices.length) return '選び方が正しくありません';
        const length = this.promptItems(prompt).length;
        if (indices.some(index => !Number.isInteger(index) || index < 0 || index >= length)) return '選び方が正しくありません';
        if (indices.length < prompt.min || indices.length > prompt.max) {
            return prompt.min === prompt.max ? `${prompt.min}つ選んでください` : `${prompt.min}〜${prompt.max}つ選んでください`;
        }
        return null;
    }

    // ===== 操作の実行 =====

    playBasic(player, uid) {
        const inst = this.findInHand(player, uid);
        this.removeCard(player.hand, inst);
        player.bench.push(this.createPokemon(inst));
        this.log(`${player.name}は${this.cardName(inst)}をベンチに出した`);
    }

    evolve(player, uid, targetId) {
        const inst = this.findInHand(player, uid);
        this.evolveInto(player, this.ownPokemon(player, targetId), inst);
    }

    // 手札のカードをのせて進化させる（ふしぎなアメからも使う）。特殊状態とワザの効果は消える
    evolveInto(player, pokemon, inst) {
        const beforeCard = this.topCard(pokemon);
        const before = beforeCard.name;
        this.removeCard(player.hand, inst);
        pokemon.cards.push(inst);
        pokemon.enteredTurn = this.turn;
        pokemon.evolvedFrom = { id: beforeCard.id, turn: this.turn };
        this.clearConditions(pokemon);
        const card = this.cardOf(inst);
        this.log(`${player.name}は${before}を${card.name}に進化させた`);
        const ability = card.ability;
        if (ability?.type === 'onEvolve' && ability.canUse(this, player, pokemon)) {
            this.runNext(() => this.promptConfirm({
                player,
                title: `特性「${ability.name}」を使いますか？`,
                card: inst.id,
                purpose: `ability-${card.id}`,
                callback: yes => {
                    if (!yes) return;
                    this.log(`${card.name}の特性「${ability.name}」`);
                    ability.use(this, player, pokemon);
                }
            }));
        }
    }

    attachEnergy(player, uid, targetId) {
        const inst = this.findInHand(player, uid);
        const target = this.ownPokemon(player, targetId);
        this.removeCard(player.hand, inst);
        target.energies.push(inst);
        this.turnState.energyAttached = true;
        this.log(`${player.name}は${this.topCard(target).name}に${this.cardName(inst)}をつけた`);
    }

    playTrainer(player, uid, targetId) {
        const inst = this.findInHand(player, uid);
        const card = this.cardOf(inst);
        this.removeCard(player.hand, inst);
        this.log(`${player.name}は${card.name}を使った`);
        switch (card.trainerType) {
            case 'tool': {
                const target = this.ownPokemon(player, targetId);
                target.tool = inst;
                this.log(`${this.topCard(target).name}に${card.name}をつけた`);
                return;
            }
            case 'stadium':
                if (this.stadium) this.players[this.stadium.owner].discard.push(this.stadium.inst);
                this.stadium = { inst, owner: player.id };
                this.turnState.stadiumPlayed = true;
                // 最大HPが変わるスタジアムで、HPがなくなるポケモンが出ることがある
                this.runNext(() => this.checkKnockouts());
                return;
            case 'supporter':
                this.turnState.supporterPlayed = true;
                break;
        }
        // グッズとサポートは、効果を終えてからトラッシュする
        this.runNext(() => card.play(this, player), () => player.discard.push(inst));
    }

    useAbility(player, targetId) {
        const pokemon = this.ownPokemon(player, targetId);
        const card = this.topCard(pokemon);
        this.turnState.abilitiesUsed.push(pokemon.id);
        this.log(`${card.name}の特性「${card.ability.name}」`);
        card.ability.use(this, player, pokemon);
    }

    useStadium(player) {
        const card = this.cardOf(this.stadium.inst);
        this.turnState.stadiumUsed = true;
        this.log(`${player.name}は${card.name}の効果を使った`);
        card.use(this, player);
    }

    retreat(player, targetId) {
        const active = player.active;
        const cost = this.retreatCost(active);
        const target = player.bench.find(pokemon => pokemon.id === targetId);
        const finish = discarded => {
            discarded.forEach(inst => this.moveCard(active.energies, player.discard, inst));
            this.turnState.retreated = true;
            this.log(`${this.topCard(active).name}はにげた`);
            this.switchActive(player, target);
        };
        const types = new Set(active.energies.map(inst => this.cardOf(inst).energyType));
        if (cost === 0 || cost === active.energies.length || types.size <= 1) {
            finish(active.energies.slice(0, cost));
            return;
        }
        this.turnState.retreated = true; // 選択の間に、もう一度にげないようにする
        this.promptCards({
            player,
            cards: active.energies,
            min: cost,
            max: cost,
            title: `にげるためにトラッシュするエネルギーを${cost}個選ぶ`,
            purpose: 'retreat-energy',
            callback: finish
        });
    }

    attack(player, index) {
        const opponent = this.opponentOf(player);
        const attacker = player.active;
        const attack = this.topCard(attacker).attacks[index];
        const ctx = { game: this, player, opponent, attacker, defender: opponent.active, attack, damage: attack.damage, failed: false };
        this.turnState.attacked = true;
        this.log(`${this.topCard(attacker).name}の「${attack.name}」`);
        this.effectQueue.push(
            () => {
                if (attacker.rotation !== 'confused' || this.flipCoin()) return;
                ctx.failed = true;
                attacker.damage += CONFUSION_DAMAGE;
                this.log(`こんらんでワザが失敗し、${this.topCard(attacker).name}に${CONFUSION_DAMAGE}ダメージ`);
            },
            () => { if (!ctx.failed) attack.before?.(ctx); },
            () => { if (!ctx.failed && ctx.damage > 0 && ctx.defender) this.dealAttackDamage(ctx, ctx.defender, ctx.damage); },
            () => { if (!ctx.failed) attack.after?.(ctx); },
            () => this.checkKnockouts()
        );
        this.queueEndOfTurn();
    }

    endTurn() {
        this.log(`${this.players[this.current].name}は番を終えた`);
        this.queueEndOfTurn();
    }

    // ===== 効果の道具（カードの効果から使う） =====

    // ワザのダメージ。バトルポケモンには弱点・抵抗力を計算する。テラスタルのポケモンはベンチでダメージを受けない
    dealAttackDamage(ctx, target, amount) {
        const card = this.topCard(target);
        const owner = this.ownerOf(target);
        const isActive = owner.active === target;
        if (!isActive && card.tera) {
            this.log(`${card.name}はテラスタルのため、ダメージを受けない`);
            return;
        }
        // ワザを使うポケモンのどうぐ（ブレイブバングルなど）は、弱点・抵抗力より先に足す
        let damage = amount + (ctx.attacker?.tool ? (this.cardOf(ctx.attacker.tool).damageBonus?.({ game: this, attacker: ctx.attacker, target }) ?? 0) : 0);
        if (isActive) {
            const attackerType = this.topCard(ctx.attacker).type;
            if (card.weakness === attackerType) damage *= WEAKNESS_MULTIPLIER;
            if (card.resistance === attackerType) damage -= RESISTANCE_REDUCTION;
        }
        damage = Math.max(0, damage);
        target.damage += damage;
        this.log(`${card.name}に${damage}ダメージ`);
    }

    // 弱点・抵抗力を計算しないダメージ（自分へのダメージなど）
    putDamage(pokemon, amount) {
        pokemon.damage += amount;
        this.log(`${this.topCard(pokemon).name}に${amount}ダメージ`);
    }

    heal(pokemon, amount) {
        const healed = Math.min(amount, pokemon.damage);
        pokemon.damage -= healed;
        this.log(`${this.topCard(pokemon).name}のHPを${healed}回復した`);
    }

    // 特殊状態にする。ねむり・マヒ・こんらんは重ならず、新しいものに置き換わる
    addCondition(pokemon, condition) {
        if (!pokemon) return;
        if (condition === 'poisoned' || condition === 'burned') pokemon[condition] = true;
        else pokemon.rotation = condition;
        this.log(`${this.topCard(pokemon).name}は${CONDITION_NAMES[condition]}になった`);
    }

    clearConditions(pokemon) {
        pokemon.rotation = null;
        pokemon.poisoned = false;
        pokemon.burned = false;
        pokemon.effects = [];
    }

    // ワザの効果を残す（untilTurn のターンの終わりまで）。extra には、どのワザかなどを入れる
    addEffect(pokemon, kind, untilTurn, extra = {}) {
        pokemon.effects.push({ kind, untilTurn, ...extra });
    }

    // この番に、指定したカードから進化したか
    evolvedThisTurnFrom(pokemon, cardId) {
        return pokemon.evolvedFrom?.turn === this.turn && pokemon.evolvedFrom.id === cardId;
    }

    // 基本エネルギーを1個つけ替える（タイプが混ざっていても、最初の1個）
    moveBasicEnergy(source, target) {
        const inst = source.energies.find(energy => isBasicEnergy(this.cardOf(energy)));
        if (!inst) return;
        this.moveCard(source.energies, target.energies, inst);
        this.log(`${this.cardName(inst)}を${this.topCard(source).name}から${this.topCard(target).name}につけ替えた`);
    }

    // カードの効果で自分の番を終える（ミアレシティ）。効果の手順が終わってから、番の終わりの処理に進む
    endTurnByEffect(player) {
        this.log(`${player.name}の番は終わった`);
        this.queueEndOfTurn();
    }

    // きぜつしたときに相手が取るサイドの枚数
    prizeValue(card) {
        if (card.rule === 'mega') return 3;
        if (card.rule === 'ex') return 2;
        return 1;
    }

    // ポケモンについているエネルギーをトラッシュする（type を指定すればそのタイプだけ）
    discardEnergyFrom(pokemon, count, type) {
        const owner = this.ownerOf(pokemon);
        const targets = pokemon.energies.filter(inst => !type || this.cardOf(inst).energyType === type).slice(0, count);
        targets.forEach(inst => this.moveCard(pokemon.energies, owner.discard, inst));
        if (targets.length) this.log(`${this.topCard(pokemon).name}のエネルギーを${targets.length}個トラッシュした`);
    }

    // バトルポケモンとベンチポケモンを入れ替える。ベンチに下がったポケモンの特殊状態は消える
    switchActive(player, benchPokemon) {
        const old = player.active;
        this.removeCard(player.bench, benchPokemon);
        if (old) {
            this.clearConditions(old);
            player.bench.push(old);
        }
        player.active = benchPokemon;
        this.log(`${player.name}のバトル場に${this.topCard(benchPokemon).name}が出た`);
    }

    promptSwitchOwnActive(player, purpose) {
        if (player.bench.length === 0) return;
        this.promptPokemon({
            player,
            pokemon: player.bench,
            min: 1,
            max: 1,
            title: 'バトル場に出すベンチポケモンを選ぶ',
            purpose,
            callback: ([target]) => this.switchActive(player, target)
        });
    }

    // 山札から条件に合うカードを max 枚まで選ぶ。選んだら onSelected（山札から取り除いた後）、最後に山札を切る
    searchDeck({ player, filter, max, title, purpose, onSelected }) {
        const candidates = player.deck.filter(inst => filter(this.cardOf(inst)));
        if (candidates.length === 0 || max <= 0) {
            this.log(`${player.name}は山札を見たが、選べるカードはなかった`);
            this.shuffleDeck(player);
            return;
        }
        this.promptCards({
            player,
            cards: candidates,
            min: 0,
            max: Math.min(max, candidates.length),
            title,
            purpose,
            callback: selected => {
                selected.forEach(inst => this.removeCard(player.deck, inst));
                this.runNext(() => onSelected(selected), () => this.shuffleDeck(player));
            }
        });
    }

    benchFromDeck(player, filter, max, purpose) {
        this.searchDeck({
            player,
            filter,
            max: Math.min(max, BENCH_SIZE - player.bench.length),
            title: 'ベンチに出すポケモンを選ぶ',
            purpose,
            onSelected: selected => selected.forEach(inst => {
                player.bench.push(this.createPokemon(inst));
                this.log(`${player.name}は${this.cardName(inst)}をベンチに出した`);
            })
        });
    }

    addToHand(player, insts, { reveal = false } = {}) {
        player.hand.push(...insts);
        if (insts.length === 0) return;
        const names = insts.map(inst => this.cardName(inst)).join('と');
        if (reveal) this.log(`${player.name}は${names}を手札に加えた`);
        else {
            this.log(`${player.name}はカードを${insts.length}枚手札に加えた`);
            this.log(`${names}を手札に加えた`, { to: player.id });
        }
    }

    // エネルギーを1枚ずつ、条件に合う自分のポケモンにつける（つけ先が1匹だけなら自動）
    attachAnyWay(player, energies, filter, purpose) {
        const steps = energies.map(inst => () => {
            const targets = this.inPlay(player).filter(filter);
            if (targets.length === 0) {
                player.discard.push(inst);
                return;
            }
            const attach = target => {
                target.energies.push(inst);
                this.log(`${this.topCard(target).name}に${this.cardName(inst)}をつけた`);
            };
            if (targets.length === 1) {
                attach(targets[0]);
                return;
            }
            this.promptPokemon({
                player,
                pokemon: targets,
                min: 1,
                max: 1,
                title: `${this.cardName(inst)}をつけるポケモンを選ぶ`,
                purpose,
                callback: ([target]) => attach(target)
            });
        });
        this.runNext(...steps);
    }

    // ふしぎなアメで進化できる組（手札の2進化ポケモンと、場のたねポケモン）
    rareCandyPairs(player) {
        const pairs = [];
        player.hand.forEach(inst => {
            const card = this.cardOf(inst);
            if (card.kind !== 'pokemon' || card.stage !== 2) return;
            const stage1 = getCard(card.evolvesFrom);
            this.inPlay(player).forEach(pokemon => {
                if (this.topCard(pokemon).id !== stage1.evolvesFrom) return;
                if (this.checkCanEvolveNow(player, pokemon)) return;
                pairs.push({ inst, pokemon });
            });
        });
        return pairs;
    }

    discardHand(player) {
        const count = player.hand.length;
        player.discard.push(...player.hand);
        player.hand = [];
        this.log(`${player.name}は手札を${count}枚トラッシュした`);
    }

    putHandOnDeckBottom(player) {
        const hand = shuffle(player.hand, this.random);
        player.deck.push(...hand);
        player.hand = [];
        this.log(`${player.name}は手札${hand.length}枚を山札の下にもどした`);
    }

    shuffleHandIntoDeck(player) {
        const count = player.hand.length;
        player.deck.push(...player.hand);
        player.hand = [];
        this.shuffleDeck(player);
        this.log(`${player.name}は手札${count}枚を山札にもどして切った`);
    }

    shuffleDeck(player) {
        shuffle(player.deck, this.random);
    }

    draw(player, count, { silent = false } = {}) {
        const drawn = player.deck.splice(0, count);
        player.hand.push(...drawn);
        if (!silent && drawn.length > 0) {
            this.log(`${player.name}はカードを${drawn.length}枚引いた`);
            this.log(`${drawn.map(inst => this.cardName(inst)).join('・')}を引いた`, { to: player.id });
        }
        return drawn.length;
    }

    flipCoin() {
        const heads = this.random() < 0.5;
        this.log(`コイン：${heads ? 'オモテ' : 'ウラ'}`);
        return heads;
    }

    // ===== 場の情報 =====

    createPokemon(inst, { faceDown = false } = {}) {
        return {
            id: inst.uid,
            cards: [inst],
            energies: [],
            tool: null,
            damage: 0,
            rotation: null,
            poisoned: false,
            burned: false,
            effects: [],
            enteredTurn: this.turn,
            evolvedFrom: null, // { id, turn }：最後に進化したときの進化元と、その番
            faceDown
        };
    }

    removeFromPlay(player, pokemon) {
        if (player.active === pokemon) player.active = null;
        else this.removeCard(player.bench, pokemon);
        player.discard.push(...pokemon.cards, ...pokemon.energies, ...(pokemon.tool ? [pokemon.tool] : []));
    }

    cardOf(inst) {
        return getCard(inst.id);
    }

    cardName(inst) {
        return this.cardOf(inst).name;
    }

    topCard(pokemon) {
        return this.cardOf(pokemon.cards[pokemon.cards.length - 1]);
    }

    maxHp(pokemon) {
        const card = this.topCard(pokemon);
        const bonus = pokemon.tool ? (this.cardOf(pokemon.tool).hpBonus?.(card) ?? 0) : 0;
        const stadium = this.stadium ? (this.cardOf(this.stadium.inst).hpModifier?.(card) ?? 0) : 0;
        return Math.max(0, card.hp + bonus + stadium);
    }

    retreatCost(pokemon) {
        const reduction = pokemon.tool ? (this.cardOf(pokemon.tool).retreatReduction ?? 0) : 0;
        return Math.max(0, this.topCard(pokemon).retreat - reduction);
    }

    // エネルギーが足りるか。タイプの指定から先に割り当て、残りで無色をまかなう
    canPayCost(pokemon, cost) {
        const pool = pokemon.energies.map(inst => this.cardOf(inst).energyType);
        for (const type of cost.filter(type => type !== 'colorless')) {
            const index = pool.indexOf(type);
            if (index === -1) return false;
            pool.splice(index, 1);
        }
        return pool.length >= cost.filter(type => type === 'colorless').length;
    }

    inPlay(player) {
        return [player.active, ...player.bench].filter(Boolean);
    }

    ownPokemon(player, pokemonId) {
        return this.inPlay(player).find(pokemon => pokemon.id === pokemonId) ?? null;
    }

    ownerOf(pokemon) {
        return this.players.find(player => this.inPlay(player).includes(pokemon));
    }

    opponentOf(player) {
        return this.players[1 - player.id];
    }

    prizesTaken(player) {
        return PRIZE_COUNT - player.prizes.length;
    }

    removeCard(list, item) {
        const index = list.indexOf(item);
        if (index !== -1) list.splice(index, 1);
    }

    moveCard(from, to, item) {
        this.removeCard(from, item);
        to.push(item);
    }

    // to を付けたログは、そのプレイヤーにだけ見せる
    log(text, { to = null } = {}) {
        this.logs.push({ text, to });
    }

    // ===== 手順と選択 =====

    runNext(...steps) {
        this.effectQueue.unshift(...steps);
    }

    processEffects() {
        while (!this.pendingPrompt && this.effectQueue.length > 0 && this.phase !== 'end') {
            const step = this.effectQueue.shift();
            step();
        }
    }

    // カードを min〜max 枚選ばせる。callback には選んだカードの配列が渡る
    promptCards({ player, cards, min, max, title, purpose, callback }) {
        const list = [...cards];
        this.setPrompt({ type: 'cards', player, cards: list, min, max, title, purpose, callback: indices => callback(indices.map(index => list[index])) });
    }

    // 場のポケモンを選ばせる。callback には選んだポケモンの配列が渡る
    promptPokemon({ player, pokemon, min, max, title, purpose, callback }) {
        const list = [...pokemon];
        this.setPrompt({ type: 'pokemon', player, pokemon: list, min, max, title, purpose, callback: indices => callback(indices.map(index => list[index])) });
    }

    // 文字の選択肢から選ばせる。callback には選んだインデックスの配列が渡る
    promptChoose({ player, options, min = 1, max = 1, title, purpose, callback }) {
        this.setPrompt({ type: 'choose', player, options, min, max, title, purpose, callback });
    }

    promptConfirm({ player, title, card = null, purpose, callback }) {
        this.setPrompt({ type: 'confirm', player, title, card, purpose, callback });
    }

    setPrompt(prompt) {
        this.promptCount++;
        this.pendingPrompt = { ...prompt, id: this.promptCount };
    }

    promptItems(prompt) {
        if (prompt.type === 'cards') return prompt.cards;
        if (prompt.type === 'pokemon') return prompt.pokemon;
        if (prompt.type === 'choose') return prompt.options;
        return [];
    }

    resolvePrompt(answer) {
        const prompt = this.pendingPrompt;
        this.pendingPrompt = null;
        prompt.callback(prompt.type === 'confirm' ? Boolean(answer) : answer);
    }

    // ===== 画面とCPUのための情報 =====

    // そのプレイヤーが今できる操作（画面で光らせる・CPUが選ぶ）
    getLegalActions(playerId) {
        const player = this.players[playerId];
        const actions = { hand: {}, attacks: [], retreat: [], abilities: [], stadium: false, endTurn: false };
        if (this.checkMain(player)) return actions;
        const targets = this.inPlay(player).map(pokemon => pokemon.id);
        player.hand.forEach(inst => {
            const card = this.cardOf(inst);
            let list = null;
            if (card.kind === 'energy') {
                if (!this.checkAttachEnergy(player, inst.uid, targets[0])) list = targets;
            } else if (card.kind === 'pokemon' && card.stage === 0) {
                if (!this.checkPlayBasic(player, inst.uid)) list = [];
            } else if (card.kind === 'pokemon') {
                list = targets.filter(target => !this.checkEvolve(player, inst.uid, target));
                if (list.length === 0) list = null;
            } else if (card.trainerType === 'tool') {
                list = targets.filter(target => !this.checkPlayTrainer(player, inst.uid, target));
                if (list.length === 0) list = null;
            } else if (!this.checkPlayTrainer(player, inst.uid)) {
                list = [];
            }
            if (list) actions.hand[inst.uid] = list;
        });
        const attacks = player.active ? this.topCard(player.active).attacks : [];
        actions.attacks = attacks.map((_, index) => !this.checkAttack(player, index));
        actions.retreat = player.bench.map(pokemon => pokemon.id).filter(id => !this.checkRetreat(player, id));
        actions.abilities = targets.filter(id => !this.checkAbility(player, id));
        actions.stadium = !this.checkStadium(player);
        actions.endTurn = true;
        return actions;
    }

    typeName(type) {
        return TYPE_NAMES[type] ?? type;
    }
}

export { isBasicEnergy };
