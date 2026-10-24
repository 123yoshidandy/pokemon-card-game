# カードの効果の書き方

カードのデータ（名前・HP・ワザ・効果の文）は `catalog.js` にある（`tools/build-cards.mjs` が作る。手で直さない）。
効果は、カードの種類ごとのファイルに、名前で引ける形で書く。`card-data.js` が、データと効果をつないで1枚のカードにする。
効果が書かれていないカードは `supported: false` になり、デッキ構築に出ない。

| 種類 | ファイル | 引き方 |
|---|---|---|
| ワザ | `attack-effects.js`（文を読み替える） / `attack-overrides.js` | 「カード名/ワザ名」 |
| 特性 | `abilities/abilities-*.js` | 「カード名/特性名」か「特性名」（同じ名前・同じ文なら特性名だけでよい） |
| サポート・グッズ・どうぐ・スタジアム | `trainers/*.js`（前からあるものは `trainer-effects.js`） | カード名 |
| 特殊エネルギー | `energy-effects.js` | カード名 |

## トレーナーズ

```js
'カード名': {
    canPlay: (game, player) => true,        // 使えるか（使えないときに断る。手札から出す前に呼ぶので、このカード自身はまだ手札にある）
    play: (game, player) => { ... },        // グッズ・サポートの効果（使ったカードは効果の後にトラッシュされる）
    firstTurnOk: true,                      // サポートを先攻の最初の番でも使える
    hooks: { ... },                         // どうぐ・スタジアムのいるだけで働く効果（下の「フック」）
    canUse: (game, player) => true,         // スタジアムの「自分の番に1回使える」効果
    use: (game, player) => { ... },
    cpuWants: (game, player) => true,       // CPU が今使いたいか。書かなければ CPU は使わない
    cpuWantsUse: (game, player) => true,    // スタジアムの canUse / use を、CPU が今使いたいか。書かなければ CPU は使わない
    afterPlay: (game, player, inst) => { player.hand.push(inst); }  // 使ったグッズ・サポートの行き先（書かなければトラッシュ）
}
```

どうぐは `playTrainer` の target のポケモンにつく（つけた後の効果は hooks に書く）。どうぐの hooks の `source.pokemon` が、つけているポケモン。
CPU がつけ先を選ぶときの目安は `cpuTarget: (game, player, pokemon) => true` に書く（合うポケモンにだけつける）。

## 特性

```js
'特性名': {
    type: 'activated' | 'onEvolve' | 'onBench' | 'onActive' | 'passive',
    //   activated：自分の番に使う（1匹につき1回。unlimited: true なら何回でも）
    //   onEvolve：手札から出して進化させたとき / onBench：手札からベンチに出したとき / onActive：自分の番にベンチからバトル場に出たとき
    //     （使うかどうかを持ち主に聞いてから use を呼ぶ）
    //   passive：いるだけで働く（hooks だけ書く）
    canUse: (game, player, pokemon) => true,
    use: (game, player, pokemon) => { ... },
    unlimited: true,           // 自分の番に何回でも使える
    oncePerTurnByName: true,   // 「この番、すでに別の『同じ特性』を使っていたなら、この特性は使えない」
    hooks: { ... },            // いるだけで働く効果（type が何でも書ける。source.pokemon が特性を持つポケモン）
    cpuWants: (game, player, pokemon) => true   // CPU が今使いたいか（書かなければ、使えるときはいつも使う）
}
```

## 特殊エネルギー

```js
'カード名': {
    provides: (game, pokemon, inst) => ['colorless', 'colorless'],  // 出すエネルギー（1個ずつ。'any' はどのタイプにもなる）
    hooks: { ... },                                                  // source.pokemon が、ついているポケモン
    onAttach: (game, player, pokemon, inst) => { ... }               // 手札からつけたとき
}
```

## フック（いるだけで働く効果）

`hooks: { 名前: (game, source, ...args) => 値 }`。source は `{ kind, player（持ち主）, pokemon, card, inst }`。
場のすべてのポケモンの特性・どうぐ・特殊エネルギーと、場のスタジアムのフックが、毎回呼ばれる。
**自分に関係あるときだけ値を返す**こと（例：どうぐなら `pokemon === source.pokemon` を確かめる。特性の「自分のポケモン全員」なら `game.ownerOf(pokemon) === source.player`）。

| 名前 | 引数 | 返す値 | 使われ方 |
|---|---|---|---|
| maxHp | pokemon | 足す数 | 最大HP |
| retreatCost | pokemon | 足す数（「すべてなくなる」は -99） | にげるためのエネルギー |
| attackCost | pokemon, attack, cost | 新しいコストの配列（変えないなら undefined） | ワザを使うためのエネルギー |
| damageDealt | ctx, target | 足す数 | ワザのダメージ。ワザを使う側（弱点・抵抗力の前）。ctx.attacker を確かめる |
| damageTaken | ctx, target | 足す数（減らすならマイナス） | ワザのダメージ。受ける側（弱点・抵抗力の後）。target を確かめる |
| preventDamage | ctx, target | true | 相手のワザのダメージを受けない |
| preventEffects | ctx, target | true | 相手のワザの効果（特殊状態・エネルギーのトラッシュなど）を受けない |
| onDamaged | ctx, target, damage | なし | 相手のワザのダメージを受けた後（ダメージが1以上のとき） |
| afterAttackDamage | ctx, target, damage | なし | 相手のワザのダメージの計算が終わった後（0でも呼ぶ。状態を変えてよい。きのみのトラッシュなど） |
| conditionImmune | pokemon, condition | true | 特殊状態にならない（condition：'poisoned' 'burned' 'asleep' 'paralyzed' 'confused'） |
| preventKnockout | pokemon, player, { byAttack } | true（pokemon.damage を直してから） | きぜつせずに残る |
| prizeModifier | pokemon, player, { byAttack } | 足す数 | きぜつしたとき、相手がとるサイドの枚数 |
| onKnockout | pokemon, player, { byAttack } | なし | きぜつしたとき（場から離れる前） |
| blockTrainer | player, card | 理由の文字列 | そのトレーナーズを使えない |
| blockAbility | player, pokemon | 理由の文字列 | 特性（activated）を使えない |
| blockAttack | player, pokemon, attack | 理由の文字列 | ワザを使えない |
| blockRetreat | player, pokemon | true | にげられない |
| allowEarlyEvolve | player, target, card | true | 最初の番や、出したばかりの番でも進化できる |
| suppressAbility | pokemon | true | そのポケモンの特性がなくなる（下の注意を参照） |
| suppressTool | pokemon | true | そのポケモンのどうぐの効果がなくなる（スタジアムだけが書ける） |
| onAttachEnergy | player, pokemon, inst | なし | 手札からエネルギーをつけた後 |
| onTurnEnd | player（番を終える人） | なし | 番の終わり（ポケモンチェックの前） |
| poisonDamage / burnDamage | pokemon | 足す数 | ポケモンチェックの、どく・やけどのダメージ |
| doubleHeal | pokemon | true | 回復するHPが2倍になる |
| blockAttachEnergy | player, pokemon, card | 理由の文字列 | 手札からそのエネルギーをつけられない（カード自身の制限は特殊エネルギーの canAttachTo(game, pokemon)） |
| blockPlayPokemon | player, card | 理由の文字列 | 手札からポケモンを出せない（たねポケモンをベンチに出す・進化させる・ふしぎなアメ） |
| blockEvolve | player, target, card | 理由の文字列 | そのポケモンを進化させられない |
| blockReturnToHand | pokemon | true | 効果で手札にもどらない（game.returnToHand が見る） |
| allowFirstTurnAttack | player, pokemon, attack | true | 先攻の最初の番でもワザを使える |
| preventFinalDamage | ctx, target, damage | true | 計算し終えたダメージを見て、受けないと決める |
| beforeAttack | ctx | なし | ワザの効果の前。ctx を変えてよい（ctx.ignoreEffects を立てる、など） |
| onEvolved | player, pokemon, { fromHand } | なし | 進化した後 |
| onSwitchOut | player, pokemon | なし | バトル場からベンチにもどった後 |
| onPokemonToActive | player, pokemon | なし | ベンチからバトル場に出た後（入れ替え・きぜつの後に出す、のどちらも） |
| extraTypes | pokemon | タイプの配列 | ポケモンのタイプを増やす（弱点・抵抗力の計算に使う。game.typesOf） |
| weaknessOverride | pokemon | タイプか 'none' | 弱点のタイプを変える・なくす（game.weaknessOf） |

特性の type には 'onToBench'（自分の番に、バトル場からベンチにもどったとき）もある。
suppressAbility は特性にも書ける（ほかのポケモンの特性をなくす）。ただし、その特性自身が特性以外の効果でなくなっていれば働かない。

**プレイヤーにかかる効果にもフックを持たせられる**（サポートの「この番、自分のポケモンが使うワザのダメージは+30」「次の相手の番、自分のポケモン全員が受けるダメージは-30」など）：
`game.addPlayerEffect(player, 'kind', untilTurn, { hooks: { damageDealt: ... } })`。効果の間（untilTurn の番の終わりまで）、source.kind が 'effect'・source.player がその人として呼ばれる。

フックの中で選択（prompt）を出してよいのは onDamaged・afterAttackDamage・onKnockout・onAttachEnergy・onTurnEnd だけ。
そのほかは何度も呼ばれる（画面の更新のたびにも呼ばれる）ので、状態を変えないこと。

## ゲームの道具（game のメソッド）

- 場：`inPlay(player)` `ownerOf(pokemon)` `opponentOf(player)` `topCard(pokemon)` `cardOf(inst)` `cardName(inst)` `maxHp(pokemon)` `retreatCost(pokemon)` `energyUnits(pokemon)` `prizesTaken(player)`
- 引く・探す：`draw(player, n)` `searchDeck({ player, filter(card), max, title, purpose, onSelected(insts) })`（最後に山札を切る）`benchFromDeck(player, filter, max, purpose)` `addToHand(player, insts, { reveal })` `shuffleDeck(player)` `millDeck(player, n)`
- 手札：`discardHand(player)` `shuffleHandIntoDeck(player)` `putHandOnDeckBottom(player)` `discardRandomFromHand(player, n)` `revealHand(owner, viewer)`
- ポケモン：`switchActive(player, benchPokemon)` `promptSwitchOwnActive(player, purpose, { optional })` `evolveInto(player, pokemon, inst)` `evolveFromOutside(player, pokemon, inst)` `returnToHand(player, pokemon)` `removeFromPlay(player, pokemon)`（トラッシュへ） `createPokemon(inst)`（ベンチに置くときは `player.bench.push(...)`。ベンチは `game.benchSize` 匹まで）
- ダメージ：`putDamage(pokemon, amount)`（ダメカン。弱点・抵抗力なし） `heal(pokemon, amount)` `dealAttackDamage(ctx, target, amount)`（ワザのダメージ）
- 特殊状態：`addCondition(pokemon, condition)` `clearConditions(pokemon)` `hasCondition(pokemon, condition)` `hasAnyCondition(pokemon)`
- エネルギー：`moveEnergy(source, target, inst)` `moveBasicEnergy(source, target)` `attachFromOutside(pokemon, inst)` `attachAnyWay(player, insts, filter(pokemon), purpose)` `discardEnergyFrom(pokemon, count, type)`
- 残る効果：`addEffect(pokemon, kind, untilTurn, extra)` `hasEffect(pokemon, kind)` `addPlayerEffect(player, kind, untilTurn)` `hasPlayerEffect(player, kind)`（untilTurn：この番だけなら `game.turn`、次の相手の番までなら `game.turn + 1`）
- スタジアム・どうぐ：`discardStadium()` `discardTool(pokemon)` / `game.stadium`（{ inst, owner }）
- コイン：`flipCoin()`（乱数はこれと `game.random()` だけを使う。Math.random は使わない）
- 手順：`runNext(...steps)`（次に行う手順を先頭に足す）`endTurnByEffect(player)` `log(text, { to })`
- 選択：`promptCards({ player, cards, min, max, title, purpose, callback(insts), cpuAnswer })` `promptPokemon({ ..., pokemon, callback(pokemons) })` `promptChoose({ player, options, min, max, title, purpose, callback(indices) })` `promptConfirm({ player, title, purpose, callback(yes) })`
  - 選択の後に続きがあるときは、callback の中に書く（選択を待つ間、手順は止まる）
  - cpuAnswer：`(game, prompt) => 答え`（cards・pokemon・choose はインデックスの配列、confirm は真偽値）。書かなければ、CPU は最小の答えを返す
- きぜつ：ダメカンをのせたり、ポケモンを場から動かしたりした後に、きぜつとバトル場の補充を確かめるなら `game.runNext(() => game.checkKnockouts())`（ワザの後と番の終わりには、本体が確かめる）
- ワザの途中：`game.currentAttack`（使っている途中のワザの ctx。ワザの後のきぜつの確認が終わるまで。prizeModifier などで、ワザを使ったポケモンを知るのに使う）
- 番の情報：`game.turn` `game.current` `game.turnState`（supporterPlayed・supporterNames・energyAttached・retreated・abilityNamesUsed など） `player.turnsTaken`
  - `player.knockedOutTurn` / `knockedOutNames`：理由を問わず、自分のポケモンがきぜつした番と名前。`knockedOutByAttackTurn` / `knockedOutByAttackNames` はワザのダメージによるものだけ

カードの判定：`card.kind`（'pokemon' 'trainer' 'energy'）・`card.stage`（0=たね）・`card.rule`（'ex' 'mega' か null）・`card.type`・`card.trainerType`・`card.basic`（基本エネルギー）・`card.energyType`・`card.aceSpec`・`card.tera`（テラスタル）・`card.ancient`（古代）・`card.future`（未来）
（テラスタル・古代・未来・ACE SPEC の印は、tools/data/limitless-tags.json から補っている）

## 守ること

- 決まった乱数（`flipCoin` / `game.random`）だけを使う。記録から同じ対戦を作り直せなくなるので、Math.random・Date は使わない
- 効果の文と違う動きにしない。動かせない・確かめられないカードは書かない（書かなければ、デッキに入らないだけ）
- 選べる数は、候補の数と `min`・`max` を合わせる（候補が足りないときは min を下げる）。候補がなければ選択を出さない
