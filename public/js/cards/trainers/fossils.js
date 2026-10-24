/**
 * 化石（「HP60の無色タイプのたねポケモンとして、場に出せる」グッズ）と化石採掘場。書き方は cards/HOOKS.md
 *
 * playAsPokemon：手札から使うと、このカード自身がたねポケモンとしてベンチに出る（game.playAsPokemon）
 * asPokemon：場に出ている間の形（card-data.js が「<ID>#pokemon」のカードとして作る。デッキ構築には出ない）
 *   化石の決まり（特殊状態にならない・にげられない・自分の番に場からトラッシュできる）は、その形の特性に書く
 *   （文の「HP60のタイプの」は記号が抜けている版があるが、古びた化石はどれも無色タイプ）
 */

function isActive(game, pokemon) {
    const owner = game.ownerOf(pokemon);
    return Boolean(owner) && owner.active === pokemon;
}

// 化石の決まり（にげられない・特殊状態にならない）と、場からトラッシュする特性。extra は、化石が持つ特性の名前・文・フック
function fossil({ name = null, text = '', hooks = {} } = {}) {
    const rule = '自分の番に、場に出ているこのカードをトラッシュできる（特性として使う）。このカードは、特殊状態にならず、にげられない。';
    return {
        playAsPokemon: true,
        canPlay: (game, player) => player.bench.length < game.benchSize,
        // その化石から進化するポケモンが手札にあるか、ベンチがいないなら出す
        cpuWants: (game, player, card) => player.bench.length === 0 || player.hand.some(inst => game.cardOf(inst).evolvesFrom && game.cardOf(inst).evolvesFrom.startsWith('古びた')),
        asPokemon: {
            hp: 60,
            type: 'colorless',
            retreat: 0,
            ability: {
                type: 'activated',
                name: name ?? '化石をトラッシュ',
                text: name ? `${text}（${rule}）` : rule,
                canUse: (game, player) => game.current === player.id,
                use: (game, player, pokemon) => {
                    game.removeFromPlay(player, pokemon);
                    game.log(`${player.name}は${game.topCard(pokemon).name}を場からトラッシュした`);
                    game.runNext(() => game.checkKnockouts());
                },
                cpuWants: () => false,
                hooks: {
                    conditionImmune: (game, source, pokemon) => pokemon === source.pokemon,
                    blockRetreat: (game, source, player, pokemon) => pokemon === source.pokemon,
                    ...hooks
                }
            }
        }
    };
}

export const TRAINER_EFFECTS = {
    '古びたアゴの化石': fossil(),
    '古びたヒレの化石': fossil(),
    '古びたねっこの化石': fossil(),
    '古びたふたの化石': fossil(),
    '古びたずがいの化石': fossil({
        name: 'ずがいのトゲ',
        text: 'このポケモンが、バトル場で相手のポケモンからワザのダメージを受けたとき、ワザを使ったポケモンにダメカンを3個のせる。',
        hooks: {
            onDamaged: (game, source, ctx, target) => {
                if (target !== source.pokemon || !isActive(game, target)) return;
                if (ctx.attacker && game.ownerOf(ctx.attacker)) game.putDamage(ctx.attacker, 30);
            }
        }
    }),
    '古びたたての化石': fossil({
        name: 'たてのまもり',
        text: 'このポケモンがバトル場にいるかぎり、自分のポケモン全員が、相手のポケモンから受けるワザのダメージは「-10」される。',
        hooks: {
            damageTaken: (game, source, ctx, target) => (isActive(game, source.pokemon) && game.ownerOf(target) === source.player ? -10 : 0)
        }
    }),
    '古びたはねの化石': fossil({
        name: 'はねのまもり',
        text: 'このポケモンは、ベンチにいるかぎり、相手のポケモンからワザのダメージを受けない。',
        hooks: {
            preventDamage: (game, source, ctx, target) => target === source.pokemon && !isActive(game, target)
        }
    }),

    '化石採掘場': {
        // おたがいのプレイヤーは、自分の番ごとに1回、山札から名前に「古びた」とつくグッズを2枚まで選び、ベンチに出してよい
        canUse: (game, player) => player.bench.length < game.benchSize
            && player.deck.some(inst => { const card = game.cardOf(inst); return card.name.startsWith('古びた') && card.playAsPokemon; }),
        use: (game, player) => game.searchDeck({
            player,
            filter: card => card.kind === 'trainer' && card.name.startsWith('古びた') && Boolean(card.playAsPokemon),
            max: Math.min(2, game.benchSize - player.bench.length),
            title: 'ベンチに出す「古びた」グッズを2枚まで選ぶ',
            purpose: 'bench-basic',
            onSelected: found => found.forEach(inst => game.playAsPokemon(player, inst))
        }),
        cpuWants: (game, player) => player.deck.some(inst => game.cardName(inst).startsWith('古びた')),
        cpuWantsUse: (game, player) => player.bench.length < 4
    }
};
