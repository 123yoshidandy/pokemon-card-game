/**
 * ビュー：そのプレイヤーから見てよい情報だけを JSON にしたもの
 * 相手の手札・山札・サイドは枚数だけ。山札の並びは誰にも見せない。選択待ちの中身は、答える本人にだけ見せる
 * 画面はビューだけを見て描く（ローカル対戦でもオンライン対戦でも同じ）
 */

const LOG_LIMIT = 80;

export function createGameView(game, viewerId) {
    const prompt = game.pendingPrompt;
    return {
        viewerId,
        phase: game.phase,
        turn: game.turn,
        current: game.current,
        firstPlayer: game.firstPlayer,
        winner: game.winner,
        decksSubmitted: game.decks.map(Boolean), // デッキの中身は見せず、決めたかどうかだけ
        endReason: game.endReason,
        stadium: game.stadium ? { id: game.stadium.inst.id, owner: game.stadium.owner } : null,
        turnState: { ...game.turnState, abilitiesUsed: [...game.turnState.abilitiesUsed] },
        players: game.players.map(player => playerView(game, player, viewerId)),
        prompt: prompt ? promptView(game, prompt, viewerId) : null,
        legal: viewerId === null ? null : game.getLegalActions(viewerId),
        log: game.logs.filter(entry => entry.to === null || entry.to === viewerId).slice(-LOG_LIMIT).map(entry => entry.text)
    };
}

function playerView(game, player, viewerId) {
    const isMe = player.id === viewerId;
    return {
        id: player.id,
        name: player.name,
        isCPU: player.isCPU,
        deckCount: player.deck.length,
        handCount: player.hand.length,
        hand: isMe ? player.hand.map(cardView) : null,
        discard: player.discard.map(cardView),
        prizeCount: player.prizes.length,
        // オモテになっているサイド（効果でオモテにしたもの。おたがいに見える）
        faceUpPrizes: player.prizes.filter(inst => inst.faceUp).map(inst => inst.id),
        active: player.active ? pokemonView(game, player.active, isMe) : null,
        bench: player.bench.map(pokemon => pokemonView(game, pokemon, isMe)),
        benchLimit: game.benchLimit(player)
    };
}

const cardView = inst => ({ uid: inst.uid, id: inst.id });
// 場では別の形で働くカード（たねポケモンとして出した化石など）は、形の印を付けたIDにする
const formId = inst => (inst.form ? `${inst.id}#${inst.form}` : inst.id);

function pokemonView(game, pokemon, isMine) {
    // 準備中にウラで出したポケモンは、相手からは中身が見えない
    if (pokemon.faceDown && !isMine) return { id: pokemon.id, faceDown: true };
    return {
        id: pokemon.id,
        faceDown: pokemon.faceDown,
        cards: pokemon.cards.map(formId),
        top: formId(pokemon.cards[pokemon.cards.length - 1]),
        hp: game.maxHp(pokemon),
        damage: pokemon.damage,
        energies: pokemon.energies.map(inst => inst.id),
        tool: pokemon.tool?.id ?? null,
        tool2: pokemon.tool2?.id ?? null,
        conditions: [pokemon.rotation, pokemon.poisoned && 'poisoned', pokemon.burned && 'burned'].filter(Boolean),
        effects: pokemon.effects.map(effect => effect.kind),
        retreat: game.retreatCost(pokemon),
        // カードのワザのほかに使えるワザ（どうぐに書かれたワザ・進化前のワザなど。番号はカードのワザの続き）
        extraAttacks: game.attacksOf(pokemon).slice(game.topCard(pokemon).attacks.length)
            .map(attack => ({ name: attack.name, cost: attack.cost, damageText: attack.damageText ?? '', text: attack.text ?? '' }))
    };
}

function promptView(game, prompt, viewerId) {
    if (prompt.player.id !== viewerId) return { id: prompt.id, player: prompt.player.id, waiting: true };
    const base = { id: prompt.id, player: prompt.player.id, type: prompt.type, title: prompt.title, purpose: prompt.purpose, min: prompt.min, max: prompt.max };
    switch (prompt.type) {
        case 'cards': return { ...base, cards: prompt.cards.map(cardView) };
        case 'pokemon': return { ...base, pokemon: prompt.pokemon.map(pokemon => pokemon.id) };
        case 'choose': return { ...base, options: [...prompt.options] };
        default: return { ...base, card: prompt.card };
    }
}
