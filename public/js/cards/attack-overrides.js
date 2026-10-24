/**
 * 決まった形に読み替えられないワザの効果（「カード名/ワザ名」で引く）
 * { before(ctx), after(ctx), expected(ctx), costFor(game, pokemon) }。ctx は attack-effects.js と同じ
 * costFor：このワザを使うためのエネルギーを、そのときの状況で変える（変えないなら undefined）
 */

const isPokemonEx = card => card.rule === 'ex' || card.rule === 'mega';

function isActive(game, pokemon) {
    const owner = game.ownerOf(pokemon);
    return Boolean(owner) && owner.active === pokemon;
}

// 場の、印（'tera' 'ancient' 'future'）のあるポケモンの数
const countTagged = (game, player, tag) => game.inPlay(player).filter(pokemon => game.topCard(pokemon)[tag]).length;

// この番に、手札から印のあるサポートを使っていたか
const playedTaggedSupporter = (game, tag) => game.turnState.supporterIds.some(id => game.cardOf({ id })[tag]);

// ダメージを足すワザ（before と expected の両方）
const bonus = amountOf => ({
    before: ctx => { ctx.damage += amountOf(ctx); },
    expected: ctx => ctx.damage + amountOf(ctx)
});

export const ATTACK_OVERRIDES = {
    'メガリザードンYex/プロージョンY': {
        after: ctx => {
            const { game, opponent, attacker } = ctx;
            game.discardEnergyFrom(attacker, 3);
            game.promptPokemon({
                player: ctx.player,
                pokemon: game.inPlay(opponent),
                min: 1,
                max: 1,
                title: 'プロージョンY：280ダメージを与えるポケモンを選ぶ',
                purpose: 'snipe-target',
                amount: 280,
                callback: ([target]) => game.dealAttackDamage(ctx, target, 280)
            });
        },
        expected: () => 280
    },

    // ===== ワザを使うためのエネルギーが変わる =====
    'シザリガー/やりかえしシザー': {
        // このポケモンにダメカンがのっているなら、エネルギー1個で使える
        costFor: (game, pokemon) => (pokemon.damage > 0 ? ['colorless'] : undefined)
    },
    'オトスパス/テンタクルレイジ': {
        costFor: (game, pokemon) => (pokemon.damage > 0 ? ['fighting'] : undefined)
    },
    'ローブシン/ガッツスイング': {
        // このポケモンが特殊状態なら、エネルギーがついていなくても使える
        costFor: (game, pokemon) => (game.hasAnyCondition(pokemon) ? [] : undefined)
    },

    // ===== 前の番の記録を使う =====
    'メガヘラクロスex/パンツァーホーン': bonus(ctx => {
        const log = ctx.attacker.damageTakenLog;
        return log?.turn === ctx.game.turn - 1 ? log.amount : 0;
    }),
    'イイネイヌ/おれいまいり': bonus(ctx => {
        const log = ctx.opponent.prizesTakenLog;
        return log?.turn === ctx.game.turn - 1 ? log.count * 60 : 0;
    }),
    'コライドン/はじょうもうこう': bonus(ctx => {
        // 前の自分の番、このポケモン以外の「古代」のポケモンがワザを使っていたなら
        const previous = ctx.player.previousAttack;
        const used = previous && previous.turn === ctx.game.turn - 2 && previous.pokemonId !== ctx.attacker.id && ctx.game.cardOf({ id: previous.cardId }).ancient;
        return used ? 150 : 0;
    }),

    // ===== 古代・未来・テラスタル =====
    'サケブシッポ/うたいはげます': {
        after: ctx => {
            const { game, player } = ctx;
            const targets = player.bench.filter(pokemon => game.topCard(pokemon).ancient && pokemon.damage > 0);
            if (targets.length === 0) return;
            game.promptPokemon({ player, pokemon: targets, min: 1, max: 1, title: 'HPを100回復する「古代」のポケモンを選ぶ', purpose: 'potion', callback: ([target]) => game.heal(target, 100) });
        }
    },
    'ミライドン/アクセルピーク': {
        after: ctx => {
            const { game, player } = ctx;
            if (countTagged(game, player, 'future') === 0) return;
            game.searchDeck({
                player,
                filter: card => card.kind === 'energy' && card.basic,
                max: 2,
                title: '「未来」のポケモンにつける基本エネルギーを2枚まで選ぶ',
                purpose: 'search-energy',
                onSelected: found => game.attachAnyWay(player, found, pokemon => Boolean(game.topCard(pokemon).future), 'attach-energy-target')
            });
        }
    },
    'コライドン/げんせいらんだ': {
        before: ctx => { ctx.damage = countTagged(ctx.game, ctx.player, 'ancient') * 30; },
        expected: ctx => countTagged(ctx.game, ctx.player, 'ancient') * 30
    },
    'イダイナキバ/じばんほうかい': {
        after: ctx => ctx.game.millDeck(ctx.opponent, playedTaggedSupporter(ctx.game, 'ancient') ? 4 : 1)
    },
    'トドロクツキ/あだうちやばね': bonus(ctx => ctx.player.discard.filter(inst => ctx.game.cardOf(inst).ancient).length * 10),
    'テツノブジン/マジェスティソード': bonus(ctx => (playedTaggedSupporter(ctx.game, 'future') ? 100 : 0)),
    'テツノイバラ/デスタプレッサー': {
        // 山札を上から5枚オモテにして、「未来」のカードの枚数×70ダメージ。「未来」のカードはトラッシュし、残りは山札にもどして切る
        before: ctx => {
            const { game, player } = ctx;
            const revealed = player.deck.slice(0, 5);
            const future = revealed.filter(inst => game.cardOf(inst).future);
            game.log(`${player.name}は山札を上から${revealed.length}枚オモテにした（${revealed.map(inst => game.cardName(inst)).join('・')}）`);
            future.forEach(inst => game.moveCard(player.deck, player.discard, inst));
            game.shuffleDeck(player);
            ctx.damage = future.length * 70;
        },
        expected: () => 70
    },
    'テツノカシラex/ツインショーテル': {
        after: ctx => {
            const { game, player, opponent } = ctx;
            const targets = game.inPlay(opponent);
            const n = Math.min(2, targets.length);
            const deal = selected => {
                // 弱点・抵抗力と、ダメージを受けるポケモンにかかっている効果を計算しない
                const saved = [ctx.ignoreWeakness, ctx.ignoreResistance, ctx.ignoreEffects];
                ctx.ignoreWeakness = ctx.ignoreResistance = ctx.ignoreEffects = true;
                selected.forEach(target => game.dealAttackDamage(ctx, target, 50));
                [ctx.ignoreWeakness, ctx.ignoreResistance, ctx.ignoreEffects] = saved;
            };
            if (n === targets.length) {
                deal(targets);
                return;
            }
            game.promptPokemon({ player, pokemon: targets, min: n, max: n, title: '50ダメージを与えるポケモンを2匹選ぶ', purpose: 'snipe-target', amount: 50, callback: deal });
        },
        expected: () => 100
    },
    'テツノドクガ/ワイルドリジェクター': {
        after: ctx => ctx.game.addEffect(ctx.attacker, 'preventDamageFromAncient', ctx.game.turn + 1)
    },
    'チヲハウハネ/てつつぶし': bonus(ctx => (countTagged(ctx.game, ctx.opponent, 'future') > 0 ? 120 : 0)),
    'ミライドン/プロテクトコード': {
        // 次の相手の番、自分の「未来」のポケモン全員は、「ポケモンex」からワザのダメージを受けない。このポケモンがバトル場をはなれたら、この効果はなくなる
        after: ctx => {
            const { game, player, attacker } = ctx;
            game.addPlayerEffect(player, 'protectCode', game.turn + 1, {
                hooks: {
                    preventDamage: (g, source, attack, target) => player.active === attacker && g.ownerOf(target) === player
                        && Boolean(g.topCard(target).future) && isPokemonEx(g.topCard(attack.attacker))
                }
            });
        }
    },
    'ハバタクカミ/まどわしうつす': {
        after: ctx => {
            const { game, player, defender } = ctx;
            const sources = player.bench.filter(pokemon => game.topCard(pokemon).ancient && pokemon.damage > 0);
            if (sources.length === 0 || !defender || !game.canAffectByAttack(ctx, defender)) return;
            game.promptPokemon({
                player,
                pokemon: sources,
                min: 1,
                max: 1,
                title: 'ダメカンをのせ替える「古代」のポケモンを選ぶ',
                purpose: 'move-counters',
                cpuAnswer: g => [sources.reduce((best, pokemon, index) => (pokemon.damage > sources[best].damage ? index : best), 0)],
                callback: ([source]) => {
                    const amount = source.damage;
                    source.damage = 0;
                    defender.damage += amount;
                    game.log(`${game.topCard(source).name}のダメカン${amount / 10}個を${game.topCard(defender).name}にのせ替えた`);
                }
            });
        }
    },
    'テラパゴス/プリズムチャージ': {
        // 山札から、それぞれちがうタイプの基本エネルギーを3枚まで選び、自分の「テラスタル」のポケモンに好きなようにつける
        after: ctx => {
            const { game, player } = ctx;
            if (countTagged(game, player, 'tera') === 0) return;
            const chosen = [];
            const pick = () => game.searchDeck({
                player,
                filter: card => card.kind === 'energy' && card.basic && !chosen.some(inst => game.cardOf(inst).energyType === card.energyType),
                max: 1,
                title: `つける基本エネルギーを選ぶ（ちがうタイプで、あと${3 - chosen.length}枚まで）`,
                purpose: 'search-energy',
                onSelected: found => {
                    if (found.length === 0) {
                        game.attachAnyWay(player, chosen, pokemon => Boolean(game.topCard(pokemon).tera), 'attach-energy-target');
                        return;
                    }
                    chosen.push(...found);
                    if (chosen.length < 3) game.runNext(pick);
                    else game.attachAnyWay(player, chosen, pokemon => Boolean(game.topCard(pokemon).tera), 'attach-energy-target');
                }
            });
            pick();
        }
    },
    'レジギガス/ジュエルブレイク': bonus(ctx => (ctx.defender && ctx.game.topCard(ctx.defender).tera ? 230 : 0)),

    // ===== そのほか =====
    'ランターン/さくらんフラッシュ': {
        after: ctx => {
            const { game, defender } = ctx;
            if (!defender || !game.canAffectByAttack(ctx, defender)) return;
            game.addCondition(defender, 'confused');
            if (game.hasCondition(defender, 'confused')) defender.confusionDamage = 80;
        }
    },
    'Nのシンボラー/ビクトリーシンボル': {
        // このワザを使ったとき、自分のサイドの残り枚数が1枚なら、この対戦は自分の勝ちになる
        before: ctx => {
            if (ctx.player.prizes.length === 1) ctx.game.winByEffect(ctx.player, `${ctx.player.name}は「ビクトリーシンボル」で勝った`);
        }
    }
};
