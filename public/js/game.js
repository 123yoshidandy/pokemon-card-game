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
import { getCard, isBasicEnergy, isBasicPokemon, isPokemonEx, baseOfStage1, TYPE_NAMES } from './card-data.js';
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
    supporterNames: [], // この番に使ったサポートの名前
    stadiumPlayed: false,
    stadiumUsed: false,
    retreated: false,
    attacked: false,
    abilitiesUsed: [], // 特性を使ったポケモンのID
    abilityNamesUsed: [], // 使った特性の名前（「この番、すでに別の〜を使っていたなら」に使う）
    abilityUseCount: {} // ポケモンのID → この番に特性を使った回数（何回でも使える特性のため）
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
            mulligans: 0,
            effects: [], // プレイヤーにかかる効果（グッズが使えない、など）{ kind, untilTurn }
            knockedOutByAttackTurn: -1, // ワザのダメージで自分のポケモンがきぜつした番と、その名前
            knockedOutByAttackNames: [],
            knockedOutTurn: -1, // 理由を問わず、自分のポケモンがきぜつした番と、その名前
            knockedOutNames: []
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
            () => this.hookAll('onTurnEnd', this.players[this.current]),
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
            // 特殊状態にならない効果がかかっているなら、受けている特殊状態は回復する
            ['poisoned', 'burned'].forEach(condition => { if (pokemon[condition] && this.conditionBlocked(pokemon, condition)) pokemon[condition] = false; });
            if (pokemon.rotation && this.conditionBlocked(pokemon, pokemon.rotation)) pokemon.rotation = null;
            if (pokemon.poisoned) {
                const poison = (pokemon.poisonDamage ?? POISON_DAMAGE) + this.hookSum('poisonDamage', pokemon);
                pokemon.damage += poison;
                this.log(`${name}はどくで${poison}ダメージ`);
            }
            if (pokemon.burned) {
                const burn = BURN_DAMAGE + this.hookSum('burnDamage', pokemon);
                pokemon.damage += burn;
                this.log(`${name}はやけどで${burn}ダメージ`);
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
        this.players.forEach(player => {
            player.effects = player.effects.filter(effect => effect.untilTurn > this.turn);
            this.inPlay(player).forEach(pokemon => {
                pokemon.effects = pokemon.effects.filter(effect => effect.untilTurn > this.turn);
            });
        });
    }

    // HP がなくなったポケモンをきぜつさせ、サイドを取り、勝敗とバトル場の補充を確かめる
    checkKnockouts() {
        if (this.phase === 'end') return;
        const knocked = [];
        this.players.forEach(player => this.inPlay(player).forEach(pokemon => {
            if (pokemon.damage < this.maxHp(pokemon)) return;
            // 特性などで、きぜつせずに残ることがある（フック preventKnockout がダメージを直して true を返す）
            if (this.hookAny('preventKnockout', pokemon, player, { byAttack: Boolean(this.resolvingAttack) })) return;
            knocked.push({ player, pokemon });
        }));
        knocked.forEach(({ player, pokemon }) => {
            const card = this.topCard(pokemon);
            this.log(`${player.name}の${card.name}はきぜつした`);
            const info = { byAttack: Boolean(this.resolvingAttack) };
            // きぜつの理由を問わず、きぜつした番と名前を残す（「前の相手の番に、自分のポケモンがきぜつしていたなら」）
            if (player.knockedOutTurn !== this.turn) player.knockedOutNames = [];
            player.knockedOutTurn = this.turn;
            player.knockedOutNames.push(card.name);
            const prizes = Math.max(0, this.prizeValue(card) + this.hookSum('prizeModifier', pokemon, player, info));
            this.hookAll('onKnockout', pokemon, player, info);
            if (this.resolvingAttack) {
                if (player.knockedOutByAttackTurn !== this.turn) player.knockedOutByAttackNames = [];
                player.knockedOutByAttackTurn = this.turn;
                player.knockedOutByAttackNames.push(card.name);
            }
            this.removeFromPlay(player, pokemon);
            const taker = this.opponentOf(player);
            const count = Math.min(prizes, taker.prizes.length);
            const taken = taker.prizes.splice(0, count);
            taker.hand.push(...taken);
            this.log(`${taker.name}はサイドを${count}枚取った（残り${taker.prizes.length}枚）`);
            this.log(`サイドから${taken.map(inst => this.cardName(inst)).join('と')}を手札に加えた`, { to: taker.id });
        });

        // きぜつがなくても、効果でポケモンが場からいなくなることがある（手札にもどす、など）
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
                pokemon.movedToActiveTurn = this.turn;
                this.log(`${player.name}は${this.topCard(pokemon).name}をバトル場に出した`);
                if (this.phase === 'main' && player.id === this.current) this.triggerAbility(player, pokemon, 'onActive');
                this.hookAll('onPokemonToActive', player, pokemon);
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
        const blocked = this.hookAny('blockPlayPokemon', player, this.cardOf(inst));
        if (blocked) return typeof blocked === 'string' ? blocked : '今はポケモンを出せません';
        return null;
    }

    checkEvolve(player, uid, targetId) {
        const inst = this.findInHand(player, uid);
        const card = inst && this.cardOf(inst);
        if (!card || card.kind !== 'pokemon' || card.stage === 0) return '進化ポケモンを選んでください';
        const target = this.ownPokemon(player, targetId);
        if (!target) return '進化させるポケモンを選んでください';
        if (this.topCard(target).name !== card.evolvesFrom) return `${card.name}は${this.topCard(target).name}から進化しません`;
        const blocked = this.hookAny('blockPlayPokemon', player, card) || this.hookAny('blockEvolve', player, target, card);
        if (blocked) return typeof blocked === 'string' ? blocked : '今は進化できません';
        return this.checkCanEvolveNow(player, target, card);
    }

    // 最初の自分の番と、この番に出した（進化した）ポケモンは進化できない（特性などで、できることもある）
    checkCanEvolveNow(player, target, card = null) {
        if (card && (card.canEvolveEarly?.(this, player, target) || this.hookAny('allowEarlyEvolve', player, target, card))) return null;
        if (player.turnsTaken <= 1) return '最初の自分の番は進化できません';
        if (target.enteredTurn >= this.turn) return 'この番に出したポケモンは進化できません';
        return null;
    }

    checkAttachEnergy(player, uid, targetId) {
        const inst = this.findInHand(player, uid);
        if (!inst || this.cardOf(inst).kind !== 'energy') return 'エネルギーを選んでください';
        if (this.turnState.energyAttached) return 'エネルギーはこの番にもうつけました';
        const target = this.ownPokemon(player, targetId);
        if (!target) return 'つけるポケモンを選んでください';
        if (this.hasEffect(target, 'cannotAttachFromHand')) return 'そのポケモンには手札からエネルギーをつけられません';
        const card = this.cardOf(inst);
        if (card.canAttachTo && !card.canAttachTo(this, target)) return `${card.name}はそのポケモンにつけられません`;
        const blocked = this.hookAny('blockAttachEnergy', player, target, card);
        if (blocked) return typeof blocked === 'string' ? blocked : 'そのポケモンにはエネルギーをつけられません';
        return null;
    }

    checkPlayTrainer(player, uid, targetId) {
        const inst = this.findInHand(player, uid);
        const card = inst && this.cardOf(inst);
        if (!card || card.kind !== 'trainer') return 'トレーナーズを選んでください';
        if (card.trainerType === 'item' && this.hasPlayerEffect(player, 'itemLock')) return 'この番はグッズを使えません';
        if (card.trainerType === 'supporter' && this.hasPlayerEffect(player, 'supporterLock')) return 'この番はサポートを使えません';
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
        const blocked = this.hookAny('blockTrainer', player, card);
        if (blocked) return typeof blocked === 'string' ? blocked : `今は${card.name}を使えません`;
        if (!card.canPlay(this, player)) return `今は${card.name}を使えません`;
        return null;
    }

    checkAbility(player, targetId) {
        const pokemon = this.ownPokemon(player, targetId);
        const ability = pokemon && this.topCard(pokemon).ability;
        if (!ability || ability.type !== 'activated') return '使える特性がありません';
        if (this.abilitySuppressed(pokemon)) return 'このポケモンの特性は、今はなくなっています';
        if (!ability.unlimited && this.turnState.abilitiesUsed.includes(pokemon.id)) return 'この特性はこの番にもう使いました';
        if (ability.oncePerTurnByName && this.turnState.abilityNamesUsed.includes(ability.name)) return `この番は、もう「${ability.name}」を使いました`;
        const blocked = this.hookAny('blockAbility', player, pokemon);
        if (blocked) return typeof blocked === 'string' ? blocked : '今は特性を使えません';
        if (ability.canUse && !ability.canUse(this, player, pokemon)) return `今は${ability.name}を使えません`;
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
        const stopped = ['asleep', 'paralyzed'].find(condition => this.hasCondition(active, condition));
        if (stopped) return `${CONDITION_NAMES[stopped]}のポケモンはにげられません`;
        if (this.hasEffect(active, 'cannotRetreat') || this.hookAny('blockRetreat', player, active)) return 'このポケモンはにげられません';
        if (!player.bench.some(pokemon => pokemon.id === targetId)) return '入れ替えるベンチポケモンを選んでください';
        if (this.energyUnits(active).length < this.retreatCost(active)) return 'にげるためのエネルギーが足りません';
        return null;
    }

    checkAttack(player, index) {
        const active = player.active;
        const attack = active && this.topCard(active).attacks[index];
        if (!attack) return 'ワザを選んでください';
        if (this.turn === 1 && !attack.firstTurnOk && !this.hookAny('allowFirstTurnAttack', player, active, attack)) return '先攻の最初の番はワザを使えません';
        const stopped = ['asleep', 'paralyzed'].find(condition => this.hasCondition(active, condition));
        if (stopped) return `${CONDITION_NAMES[stopped]}のポケモンはワザを使えません`;
        if (active.effects.some(effect => effect.kind === 'cannotAttack' && effect.untilTurn >= this.turn)) return 'このポケモンはこの番ワザを使えません';
        if (active.effects.some(effect => effect.kind === 'cannotUseAttack' && effect.attack === attack.name && effect.untilTurn >= this.turn)) return `この番は「${attack.name}」を使えません`;
        const blocked = this.hookAny('blockAttack', player, active, attack);
        if (blocked) return typeof blocked === 'string' ? blocked : 'このポケモンは今ワザを使えません';
        if (attack.canUse && !attack.canUse(this, player, active)) return `今は「${attack.name}」を使えません`;
        if (!this.canPayCost(active, this.attackCost(active, attack))) return 'エネルギーが足りません';
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
        const pokemon = this.createPokemon(inst);
        player.bench.push(pokemon);
        this.log(`${player.name}は${this.cardName(inst)}をベンチに出した`);
        this.triggerAbility(player, pokemon, 'onBench');
    }

    evolve(player, uid, targetId) {
        const inst = this.findInHand(player, uid);
        this.evolveInto(player, this.ownPokemon(player, targetId), inst);
    }

    // 手札のカードをのせて進化させる（ふしぎなアメからも使う）。特殊状態とワザの効果は消える
    evolveInto(player, pokemon, inst, { fromHand = true } = {}) {
        const beforeCard = this.topCard(pokemon);
        const before = beforeCard.name;
        this.removeCard(player.hand, inst);
        pokemon.cards.push(inst);
        pokemon.enteredTurn = this.turn;
        pokemon.evolvedFrom = { name: beforeCard.name, turn: this.turn };
        this.clearConditions(pokemon);
        const card = this.cardOf(inst);
        this.log(`${player.name}は${before}を${card.name}に進化させた`);
        // 特性の「手札から出して進化させたとき」（山札などから進化させたときは使えない）
        if (fromHand) this.triggerAbility(player, pokemon, 'onEvolve');
        this.hookAll('onEvolved', player, pokemon, { fromHand });
    }

    attachEnergy(player, uid, targetId) {
        const inst = this.findInHand(player, uid);
        const target = this.ownPokemon(player, targetId);
        this.removeCard(player.hand, inst);
        target.energies.push(inst);
        this.turnState.energyAttached = true;
        this.log(`${player.name}は${this.topCard(target).name}に${this.cardName(inst)}をつけた`);
        // 特殊エネルギーの「手札からつけたとき」と、ほかのカードの「エネルギーがついたとき」
        const card = this.cardOf(inst);
        if (card.onAttach) this.runNext(() => card.onAttach(this, player, target, inst));
        this.runNext(() => this.hookAll('onAttachEnergy', player, target, inst));
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
                this.turnState.supporterNames.push(card.name);
                break;
        }
        // グッズとサポートは、効果を終えてからトラッシュする（afterPlay があれば、使ったカードの行き先はそれが決める）
        this.runNext(() => card.play(this, player, inst), () => {
            if (card.afterPlay) card.afterPlay(this, player, inst);
            else player.discard.push(inst);
        });
    }

    useAbility(player, targetId) {
        const pokemon = this.ownPokemon(player, targetId);
        const card = this.topCard(pokemon);
        this.turnState.abilitiesUsed.push(pokemon.id);
        this.turnState.abilityNamesUsed.push(card.ability.name);
        this.turnState.abilityUseCount[pokemon.id] = (this.turnState.abilityUseCount[pokemon.id] ?? 0) + 1;
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
        const kinds = new Set(active.energies.map(inst => inst.id));
        if (cost === 0 || cost >= active.energies.length || kinds.size <= 1) {
            // 2個ぶんになる特殊エネルギーがあれば、トラッシュする枚数は少なくてすむ
            const selected = [];
            let units = 0;
            for (const inst of active.energies) {
                if (units >= cost) break;
                selected.push(inst);
                units += this.energyUnits(active, [inst]).length;
            }
            finish(selected);
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
        const ctx = { game: this, player, opponent, attacker, defender: opponent.active, attack, damage: attack.damage, failed: false, dealt: 0 };
        this.turnState.attacked = true;
        this.log(`${this.topCard(attacker).name}の「${attack.name}」`);
        this.effectQueue.push(
            () => {
                this.currentAttack = ctx; // 使っている途中のワザ（フックが、ワザを使ったポケモンを知るため）
                if (this.hasCondition(attacker, 'confused') && !this.flipCoin()) {
                    ctx.failed = true;
                    attacker.damage += CONFUSION_DAMAGE;
                    this.log(`こんらんでワザが失敗し、${this.topCard(attacker).name}に${CONFUSION_DAMAGE}ダメージ`);
                    return;
                }
                // 前の相手の番のワザの効果で、コインのウラならワザが失敗する
                if (this.hasEffect(attacker, 'attackCoinFlip') && !this.flipCoin()) {
                    ctx.failed = true;
                    this.log('ワザは失敗した');
                }
            },
            // ワザの前に、特性などが ctx を変える（ctx.ignoreEffects を立てる、など）
            () => { if (!ctx.failed) this.hookAll('beforeAttack', ctx); },
            () => { if (!ctx.failed) attack.before?.(ctx); },
            () => { if (!ctx.failed && ctx.damage > 0 && ctx.defender) this.dealAttackDamage(ctx, ctx.defender, ctx.damage); },
            () => { if (!ctx.failed) attack.after?.(ctx); },
            () => {
                this.resolvingAttack = true;
                this.checkKnockouts();
                this.resolvingAttack = false;
                this.currentAttack = null;
            }
        );
        this.queueEndOfTurn();
    }

    endTurn() {
        this.log(`${this.players[this.current].name}は番を終えた`);
        this.queueEndOfTurn();
    }

    // ===== 効果の道具（カードの効果から使う） =====

    // ワザのダメージ。与えたダメージを返す
    //   ワザを使うポケモンの側（どうぐ・効果）→ 弱点・抵抗力 → 受けるポケモンにかかっている効果、の順に計算する
    //   弱点・抵抗力はバトルポケモンにだけ計算する。テラスタルのポケモンはベンチでダメージを受けない
    //   ctx.ignoreWeakness・ignoreResistance・ignoreEffects で、それぞれ計算しない
    dealAttackDamage(ctx, target, amount) {
        const card = this.topCard(target);
        const owner = this.ownerOf(target);
        if (!owner) return 0;
        const isActive = owner.active === target;
        const attackerCard = this.topCard(ctx.attacker);
        const opposing = owner !== ctx.player;
        if (!isActive && card.tera) {
            this.log(`${card.name}はテラスタルのため、ダメージを受けない`);
            return 0;
        }
        const guarded = kind => opposing && !ctx.ignoreEffects && this.hasEffect(target, kind);
        if (guarded('preventAll') || guarded('preventDamage')
            || (guarded('preventDamageFromBasic') && attackerCard.stage === 0)
            || (guarded('preventDamageFromEx') && isPokemonEx(attackerCard))
            || (opposing && this.hookAny('preventDamage', ctx, target))) {
            this.log(`${card.name}はワザのダメージを受けない`);
            return 0;
        }
        // ワザを使うポケモンの側（どうぐ・特性などのフック damageDealt と、ワザの効果）は、弱点・抵抗力より先に足す
        let damage = amount + (opposing ? this.hookSum('damageDealt', ctx, target) : 0);
        if (isActive && opposing) {
            damage += this.effectsOf(ctx.attacker, 'attackDamageModifier')
                .filter(effect => !effect.attack || effect.attack === ctx.attack?.name)
                .reduce((sum, effect) => sum + effect.amount, 0);
        }
        if (isActive) {
            const attackerTypes = this.typesOf(ctx.attacker);
            const weakness = this.weaknessOf(target);
            if (weakness && attackerTypes.includes(weakness) && !ctx.ignoreWeakness && !this.hasEffect(target, 'noWeakness')) damage *= WEAKNESS_MULTIPLIER;
            if (card.resistance && attackerTypes.includes(card.resistance) && !ctx.ignoreResistance) damage -= RESISTANCE_REDUCTION;
        }
        if (isActive && opposing && !ctx.ignoreEffects) {
            damage -= this.effectsOf(target, 'damageReduction').reduce((sum, effect) => sum + effect.amount, 0);
            damage += this.effectsOf(target, 'damageIncrease').reduce((sum, effect) => sum + effect.amount, 0);
        }
        // 受けるポケモンの側（どうぐ・特性・スタジアムなどのフック damageTaken）は、弱点・抵抗力の後
        if (opposing) damage += this.hookSum('damageTaken', ctx, target);
        damage = Math.max(0, damage);
        // 「N」以下のワザのダメージを受けない
        if (opposing && !ctx.ignoreEffects && this.effectsOf(target, 'preventDamageUpTo').some(effect => damage <= effect.amount)) {
            this.log(`${card.name}は${damage}ダメージを受けない`);
            return 0;
        }
        // 計算し終えたダメージを見て、受けないと決める（「200以上のダメージを受けない」など）
        if (opposing && damage > 0 && this.hookAny('preventFinalDamage', ctx, target, damage)) {
            this.log(`${card.name}は${damage}ダメージを受けない`);
            return 0;
        }
        target.damage += damage;
        this.log(`${card.name}に${damage}ダメージ`);
        if (target === ctx.defender) ctx.dealt = (ctx.dealt ?? 0) + damage;
        // ダメージの計算が終わった後（0でも呼ぶ。きのみのように、働いた後にトラッシュするカードのため）
        if (opposing) this.hookAll('afterAttackDamage', ctx, target, damage);
        // ダメージを受けたら、ワザを使ったポケモンにダメカンをのせる効果
        if (damage > 0 && opposing && ctx.attacker && this.ownerOf(ctx.attacker)) {
            this.effectsOf(target, 'counterOnDamaged').forEach(effect => this.putDamage(ctx.attacker, effect.amount));
        }
        if (damage > 0 && opposing) this.hookAll('onDamaged', ctx, target, damage);
        return damage;
    }

    // ワザの効果を与えられるか（相手のポケモンに「ワザの効果を受けない」がかかっていないか。特性などのフック preventEffects も見る）
    canAffectByAttack(ctx, pokemon) {
        if (this.ownerOf(pokemon) === ctx.player) return true;
        if (this.hookAny('preventEffects', ctx, pokemon)) return false;
        if (ctx.ignoreEffects) return true;
        return !this.hasEffect(pokemon, 'preventAll');
    }

    // 弱点・抵抗力を計算しないダメージ（自分へのダメージなど）
    putDamage(pokemon, amount) {
        pokemon.damage += amount;
        this.log(`${this.topCard(pokemon).name}に${amount}ダメージ`);
    }

    heal(pokemon, amount) {
        // スタジアムなどで、回復するHPが2倍になることがある（フック doubleHeal）
        const total = this.hookAny('doubleHeal', pokemon) ? amount * 2 : amount;
        const healed = Math.min(total, pokemon.damage);
        pokemon.damage -= healed;
        if (healed > 0) pokemon.healedTurn = this.turn;
        this.log(`${this.topCard(pokemon).name}のHPを${healed}回復した`);
    }

    // 特殊状態にする。ねむり・マヒ・こんらんは重ならず、新しいものに置き換わる
    addCondition(pokemon, condition) {
        if (!pokemon) return;
        if (this.hookAny('conditionImmune', pokemon, condition)) {
            this.log(`${this.topCard(pokemon).name}は${CONDITION_NAMES[condition]}にならない`);
            return;
        }
        if (condition === 'poisoned' || condition === 'burned') pokemon[condition] = true;
        else pokemon.rotation = condition;
        this.log(`${this.topCard(pokemon).name}は${CONDITION_NAMES[condition]}になった`);
    }

    clearConditions(pokemon) {
        pokemon.rotation = null;
        pokemon.poisoned = false;
        pokemon.poisonDamage = null;
        pokemon.burned = false;
        pokemon.effects = [];
    }

    // 特殊状態にならない効果（フック conditionImmune）がかかっているか
    conditionBlocked(pokemon, condition) {
        return Boolean(this.hookAny('conditionImmune', pokemon, condition));
    }

    // 特殊状態を受けているか（特殊状態にならない効果がかかっていれば、受けていないものとして扱う）
    hasCondition(pokemon, condition) {
        const has = condition === 'poisoned' || condition === 'burned' ? Boolean(pokemon[condition]) : pokemon.rotation === condition;
        return has && !this.conditionBlocked(pokemon, condition);
    }

    hasAnyCondition(pokemon) {
        return ['asleep', 'paralyzed', 'confused', 'poisoned', 'burned'].some(condition => this.hasCondition(pokemon, condition));
    }

    // ワザの効果を残す（untilTurn のターンの終わりまで）。extra には、どのワザか・いくつかなどを入れる
    addEffect(pokemon, kind, untilTurn, extra = {}) {
        if (!pokemon) return;
        pokemon.effects.push({ kind, untilTurn, ...extra });
    }

    effectsOf(pokemon, kind) {
        return pokemon ? pokemon.effects.filter(effect => effect.kind === kind && effect.untilTurn >= this.turn) : [];
    }

    hasEffect(pokemon, kind) {
        return this.effectsOf(pokemon, kind).length > 0;
    }

    // プレイヤーにかかる効果（次の相手の番、グッズを使えない、など）。extra.hooks があれば、効果の間フックとして働く
    addPlayerEffect(player, kind, untilTurn, extra = {}) {
        player.effects.push({ kind, untilTurn, ...extra });
        if (kind === 'itemLock') this.log(`次の番、${player.name}はグッズを使えない`);
        if (kind === 'supporterLock') this.log(`次の番、${player.name}はサポートを使えない`);
    }

    hasPlayerEffect(player, kind) {
        return player.effects.some(effect => effect.kind === kind && effect.untilTurn >= this.turn);
    }

    // この番に、指定した名前のポケモンから進化したか
    evolvedThisTurnFrom(pokemon, name) {
        return pokemon.evolvedFrom?.turn === this.turn && pokemon.evolvedFrom.name === name;
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
        benchPokemon.movedToActiveTurn = this.turn;
        this.log(`${player.name}のバトル場に${this.topCard(benchPokemon).name}が出た`);
        if (this.phase === 'main' && player.id === this.current) {
            this.triggerAbility(player, benchPokemon, 'onActive');
            if (old) this.triggerAbility(player, old, 'onToBench');
        }
        // 入れ替えを知らせる（バトル場からベンチにもどったポケモンと、バトル場に出たポケモン）
        if (old) this.hookAll('onSwitchOut', player, old);
        this.hookAll('onPokemonToActive', player, benchPokemon);
    }

    // optional なら、入れ替えなくてもよい（何も選ばなければ入れ替えない）
    promptSwitchOwnActive(player, purpose, { optional = false } = {}) {
        if (player.bench.length === 0) return;
        this.promptPokemon({
            player,
            pokemon: player.bench,
            min: optional ? 0 : 1,
            max: 1,
            title: optional ? '入れ替えるベンチポケモンを選ぶ（入れ替えないなら選ばない）' : 'バトル場に出すベンチポケモンを選ぶ',
            purpose,
            callback: ([target]) => { if (target) this.switchActive(player, target); }
        });
    }

    // エネルギーを1個つけ替える
    moveEnergy(source, target, inst) {
        if (!inst || !source.energies.includes(inst)) return;
        this.moveCard(source.energies, target.energies, inst);
        this.log(`${this.cardName(inst)}を${this.topCard(source).name}から${this.topCard(target).name}につけ替えた`);
    }

    // 手札以外（山札・トラッシュ）からエネルギーをつける
    attachFromOutside(pokemon, inst) {
        pokemon.energies.push(inst);
        this.log(`${this.topCard(pokemon).name}に${this.cardName(inst)}をつけた`);
    }

    // 手札以外（山札など）のカードで進化させる
    evolveFromOutside(player, pokemon, inst) {
        player.hand.push(inst);
        this.evolveInto(player, pokemon, inst, { fromHand: false });
    }

    // ポケモンと、ついているすべてのカードを手札にもどす（バトル場が空いたら、きぜつの確認でベンチから出す）
    returnToHand(player, pokemon) {
        if (!this.inPlay(player).includes(pokemon)) return;
        if (this.hookAny('blockReturnToHand', pokemon)) {
            this.log(`${this.topCard(pokemon).name}は手札にもどらない`);
            return;
        }
        if (player.active === pokemon) player.active = null;
        else this.removeCard(player.bench, pokemon);
        player.hand.push(...pokemon.cards, ...pokemon.energies, ...(pokemon.tool ? [pokemon.tool] : []));
        this.log(`${player.name}は${this.topCard(pokemon).name}と、ついているカードを手札にもどした`);
    }

    // 山札を上から count 枚トラッシュする
    millDeck(player, count) {
        const milled = player.deck.splice(0, count);
        player.discard.push(...milled);
        if (milled.length) this.log(`${player.name}は山札を上から${milled.length}枚トラッシュした（${milled.map(inst => this.cardName(inst)).join('・')}）`);
    }

    // 手札からオモテを見ないで選ぶ（乱数はシード付きなので、記録から再現できる）
    discardRandomFromHand(player, count) {
        const discarded = [];
        for (let i = 0; i < count && player.hand.length > 0; i++) {
            const inst = player.hand[Math.floor(this.random() * player.hand.length)];
            this.moveCard(player.hand, player.discard, inst);
            discarded.push(inst);
        }
        if (discarded.length) this.log(`${player.name}の手札の${discarded.map(inst => this.cardName(inst)).join('と')}がトラッシュされた`);
    }

    // 手札を相手に見せる（見せた相手にだけログを出す）
    revealHand(owner, viewer) {
        this.log(`${owner.name}の手札を見た`);
        this.log(`${owner.name}の手札：${owner.hand.map(inst => this.cardName(inst)).join('・') || 'なし'}`, { to: viewer.id });
    }

    discardTool(pokemon) {
        if (!pokemon.tool) return;
        const owner = this.ownerOf(pokemon);
        const name = this.cardName(pokemon.tool);
        owner.discard.push(pokemon.tool);
        pokemon.tool = null;
        this.log(`${this.topCard(pokemon).name}の${name}をトラッシュした`);
    }

    discardStadium() {
        if (!this.stadium) return;
        const { inst, owner } = this.stadium;
        this.players[owner].discard.push(inst);
        this.stadium = null;
        this.log(`${this.cardName(inst)}をトラッシュした`);
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
            const base = baseOfStage1(card.evolvesFrom);
            if (!base || this.hookAny('blockPlayPokemon', player, card)) return;
            this.inPlay(player).forEach(pokemon => {
                const top = this.topCard(pokemon);
                if (top.stage !== 0 || top.name !== base) return;
                if (this.hookAny('blockEvolve', player, pokemon, card)) return;
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

    // ===== いるだけで働く効果（特性・ポケモンのどうぐ・特殊エネルギー・スタジアム） =====
    // カードの定義の hooks（特性は ability.hooks）に、フックの名前で関数を書く。関数は (game, source, ...args) で呼ぶ
    //   source：{ kind: 'ability' | 'tool' | 'energy' | 'stadium', player（持ち主）, pokemon（特性・どうぐ・エネルギーのついたポケモン。スタジアムは null）, card, inst }
    // フックの名前と使い方は cards/HOOKS.md にまとめてある

    passiveSources({ abilities = true } = {}) {
        const sources = [];
        this.players.forEach(player => this.inPlay(player).forEach(pokemon => {
            const top = this.topCard(pokemon);
            if (abilities && top.ability?.hooks && !this.abilitySuppressed(pokemon)) {
                sources.push({ kind: 'ability', hooks: top.ability.hooks, player, pokemon, card: top, inst: pokemon.cards[pokemon.cards.length - 1] });
            }
            if (pokemon.tool) {
                const card = this.cardOf(pokemon.tool);
                if (card.hooks && !this.toolSuppressed(pokemon)) sources.push({ kind: 'tool', hooks: card.hooks, player, pokemon, card, inst: pokemon.tool });
            }
            pokemon.energies.forEach(inst => {
                const card = this.cardOf(inst);
                if (card.hooks) sources.push({ kind: 'energy', hooks: card.hooks, player, pokemon, card, inst });
            });
        }));
        if (this.stadium) {
            const card = this.cardOf(this.stadium.inst);
            if (card.hooks) sources.push({ kind: 'stadium', hooks: card.hooks, player: this.players[this.stadium.owner], pokemon: null, card, inst: this.stadium.inst });
        }
        // プレイヤーにかかる効果（サポートの「この番」「次の相手の番」など）にも、フックを持たせられる
        this.players.forEach(player => player.effects.forEach(effect => {
            if (effect.hooks && effect.untilTurn >= this.turn) sources.push({ kind: 'effect', hooks: effect.hooks, player, pokemon: null, card: null, inst: null, effect });
        }));
        return sources;
    }

    // 数を足し合わせるフック（最大HP・にげるためのエネルギー・ダメージの増減など）
    hookSum(name, ...args) {
        return this.passiveSources().reduce((sum, source) => sum + (source.hooks[name]?.(this, source, ...args) ?? 0), 0);
    }

    // どれか1つでも値を返せば、その値（止める理由の文字列・true など）
    hookAny(name, ...args) {
        for (const source of this.passiveSources()) {
            const result = source.hooks[name]?.(this, source, ...args);
            if (result) return result;
        }
        return null;
    }

    // 起きたことを知らせるフック（ダメージを受けた・きぜつした・番の終わり など）
    hookAll(name, ...args) {
        this.passiveSources().forEach(source => source.hooks[name]?.(this, source, ...args));
    }

    // 配列を集めるフック（ポケモンのタイプを増やす、など）
    hookCollect(name, ...args) {
        return this.passiveSources().flatMap(source => source.hooks[name]?.(this, source, ...args) ?? []);
    }

    // ポケモンのタイプ（フック extraTypes で増えることがある）
    typesOf(pokemon) {
        const type = this.topCard(pokemon).type;
        return [...new Set([type, ...this.hookCollect('extraTypes', pokemon)])];
    }

    // 弱点のタイプ（フック weaknessOverride で変わることがある。'none' ならなし）
    weaknessOf(pokemon) {
        const override = this.hookAny('weaknessOverride', pokemon);
        if (override === 'none') return null;
        return override ?? this.topCard(pokemon).weakness;
    }

    // 特性がなくなっているか（ポケモンについている効果か、ほかのカードの効果で）
    // 特性がほかのポケモンの特性をなくすとき、その特性自身が、特性以外の効果でなくなっていれば働かない（なくし合いでループしないように）
    abilitySuppressed(pokemon) {
        if (this.baseAbilitySuppressed(pokemon)) return true;
        if (this.checkingAbilitySuppression) return false;
        this.checkingAbilitySuppression = true;
        try {
            return this.players.some(player => this.inPlay(player).some(holder => {
                if (holder === pokemon) return false;
                const ability = this.topCard(holder).ability;
                if (!ability?.hooks?.suppressAbility || this.baseAbilitySuppressed(holder)) return false;
                const source = { kind: 'ability', hooks: ability.hooks, player, pokemon: holder, card: this.topCard(holder), inst: holder.cards[holder.cards.length - 1] };
                return Boolean(ability.hooks.suppressAbility(this, source, pokemon));
            }));
        } finally {
            this.checkingAbilitySuppression = false;
        }
    }

    baseAbilitySuppressed(pokemon) {
        if (this.hasEffect(pokemon, 'abilityLock')) return true;
        return this.passiveSources({ abilities: false }).some(source => source.hooks.suppressAbility?.(this, source, pokemon));
    }

    toolSuppressed(pokemon) {
        if (!this.stadium) return false;
        const card = this.cardOf(this.stadium.inst);
        return Boolean(card.hooks?.suppressTool?.(this, { kind: 'stadium', player: this.players[this.stadium.owner], pokemon: null, card, inst: this.stadium.inst }, pokemon));
    }

    // ワザを使うためのエネルギー（特性・どうぐなどで変わることがある）
    attackCost(pokemon, attack) {
        let cost = [...attack.cost];
        for (const source of this.passiveSources()) {
            const changed = source.hooks.attackCost?.(this, source, pokemon, attack, cost);
            if (changed) cost = changed;
        }
        return cost;
    }

    // ポケモンについているエネルギーが出すエネルギー（1個ずつの配列。'any' はどのタイプにもなる）
    energyUnits(pokemon, energies = pokemon.energies) {
        return energies.flatMap(inst => {
            const card = this.cardOf(inst);
            if (card.basic) return [card.energyType];
            return card.provides ? card.provides(this, pokemon, inst) : ['colorless'];
        });
    }

    // 特性の「〜したとき」を使うか聞く（進化させたとき・ベンチに出したとき・バトル場に出たとき）
    triggerAbility(player, pokemon, type) {
        const card = this.topCard(pokemon);
        const ability = card.ability;
        if (ability?.type !== type || this.abilitySuppressed(pokemon)) return;
        if (ability.canUse && !ability.canUse(this, player, pokemon)) return;
        this.runNext(() => this.promptConfirm({
            player,
            title: `特性「${ability.name}」を使いますか？`,
            card: pokemon.cards[pokemon.cards.length - 1].id,
            purpose: `ability-${card.id}`,
            // CPU は、特性の cpuWants が「使いたい」と言うときだけ使う（書かれていなければ使う）
            cpuAnswer: game => (ability.cpuWants ? Boolean(ability.cpuWants(game, player, pokemon)) : true),
            callback: yes => {
                if (!yes) return;
                this.log(`${card.name}の特性「${ability.name}」`);
                this.turnState.abilityNamesUsed.push(ability.name);
                ability.use(this, player, pokemon);
            }
        }));
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
            poisonDamage: null, // どくで受けるダメージ（null なら10）
            burned: false,
            effects: [],
            enteredTurn: this.turn,
            movedToActiveTurn: -1, // ベンチからバトル場に出た番
            healedTurn: -1, // HP を回復した番
            evolvedFrom: null, // { name, turn }：最後に進化したときの進化元の名前と、その番
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

    // 最大HP（どうぐ・スタジアム・特性などのフック maxHp で変わる）
    maxHp(pokemon) {
        return Math.max(0, this.topCard(pokemon).hp + this.hookSum('maxHp', pokemon));
    }

    // にげるためのエネルギーの数（フック retreatCost で変わる）
    retreatCost(pokemon) {
        return Math.max(0, this.topCard(pokemon).retreat + this.hookSum('retreatCost', pokemon));
    }

    // エネルギーが足りるか。タイプの指定から先に割り当て（同じタイプ → どのタイプにもなるもの）、残りで無色をまかなう
    canPayCost(pokemon, cost) {
        const pool = this.energyUnits(pokemon);
        // 'psychic|darkness' のように、どれか1つのタイプになるエネルギーもある
        const fits = (unit, type) => unit.includes('|') && unit.split('|').includes(type);
        for (const type of cost.filter(type => type !== 'colorless')) {
            let index = pool.indexOf(type);
            if (index === -1) index = pool.findIndex(unit => fits(unit, type));
            if (index === -1) index = pool.indexOf('any');
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
    // ほかの値（cpuAnswer：CPU の答え方 (game, prompt) => 答え、など）は、そのまま選択に残す
    promptCards({ player, cards, min, max, title, purpose, callback, ...extra }) {
        const list = [...cards];
        this.setPrompt({ ...extra, type: 'cards', player, cards: list, min, max, title, purpose, callback: indices => callback(indices.map(index => list[index])) });
    }

    // 場のポケモンを選ばせる。callback には選んだポケモンの配列が渡る（amount など、ほかの値はそのまま選択に残す）
    promptPokemon({ player, pokemon, min, max, title, purpose, callback, ...extra }) {
        const list = [...pokemon];
        this.setPrompt({ ...extra, type: 'pokemon', player, pokemon: list, min, max, title, purpose, callback: indices => callback(indices.map(index => list[index])) });
    }

    // 文字の選択肢から選ばせる。callback には選んだインデックスの配列が渡る
    promptChoose({ player, options, min = 1, max = 1, title, purpose, callback, ...extra }) {
        this.setPrompt({ ...extra, type: 'choose', player, options, min, max, title, purpose, callback });
    }

    promptConfirm({ player, title, card = null, purpose, callback, ...extra }) {
        this.setPrompt({ ...extra, type: 'confirm', player, title, card, purpose, callback });
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
                list = targets.filter(target => !this.checkAttachEnergy(player, inst.uid, target));
                if (list.length === 0) list = null;
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
