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
        active: player.active ? pokemonView(game, player.active, isMe) : null,
        bench: player.bench.map(pokemon => pokemonView(game, pokemon, isMe))
    };
}

const cardView = inst => ({ uid: inst.uid, id: inst.id });

function pokemonView(game, pokemon, isMine) {
    // 準備中にウラで出したポケモンは、相手からは中身が見えない
    if (pokemon.faceDown && !isMine) return { id: pokemon.id, faceDown: true };
    return {
        id: pokemon.id,
        faceDown: pokemon.faceDown,
        cards: pokemon.cards.map(inst => inst.id),
        top: pokemon.cards[pokemon.cards.length - 1].id,
        hp: game.maxHp(pokemon),
        damage: pokemon.damage,
        energies: pokemon.energies.map(inst => inst.id),
        tool: pokemon.tool?.id ?? null,
        conditions: [pokemon.rotation, pokemon.poisoned && 'poisoned', pokemon.burned && 'burned'].filter(Boolean),
        effects: pokemon.effects.map(effect => effect.kind),
        retreat: game.retreatCost(pokemon)
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
