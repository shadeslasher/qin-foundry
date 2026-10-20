# Qin: The Warring States for Foundry VTT

An unofficial game system for **Qin: The Warring States** on Foundry VTT v14. It also includes a Fire Emblem–style **battlefield unit combat** system built for a Three Kingdoms campaign. Qin is a trademark of its publisher; this system contains no rulebook text, so keep your book handy.

## Install

1. In Foundry's setup screen, go to **Game Systems → Install System**.
2. Paste this into **Manifest URL** at the bottom and click **Install**:
   ```
   https://raw.githubusercontent.com/shadeslasher/qin-foundry/main/system.json
   ```
3. Create a world with the **Qin: The Warring States** system.

## What's in it

### Characters (Qin rules)

- **Character** actors for PCs and important NPCs, and **Henchman** actors for minor NPCs.
- **Aspects:** the five Aspects, with click-to-roll.
- **Skills:** the full skill list by domain, plus **Command** (campaign homebrew). Skills marked * need Apprentice to attempt; Beginners roll the Aspect alone.
- **Calculated automatically:**
  - Chi = Basic Chi × Earth × best Skill Level.
  - Passive Defense = Water + Wood + 2.
  - Resistance = Metal + Earth.
  - Breath of Life boxes from the Balance/Resistance tables.
  - Injury penalties of −1 / −3 / −5.
  - Armor movement penalty.
- **Tao of the Strengthened Body:** extra boxes follow the book. Levels 1–2 add +2 Normal, Level 3 +2 Bruised, Level 4 +2 Slightly Injured.
- **Rolls:** a dialog for Aspect, Skill, ST and modifier, plus **inner strength** (up to Earth, 2 Chi per point).
- **Combat:**
  - Attacks roll Metal + Skill + Yin/Yang against the target's Passive Defense, with combat techniques adding to the ST.
  - Damage = Metal + weapon + (Yang − Yin when Yang is higher).
  - The chat card has **Block**, **Dodge** and **Apply damage** buttons. Armor is subtracted; Direct Hit and Masterstroke reduce it by 2.
  - Henchmen go down when one blow exceeds their Resistance.
- **Taos and magic:** using one spends its Chi. Magic with a Preparation ST rolls Earth + its way.
- **Chi recovery:** meditation (Earth + Meditation vs 7, regain the margin) and sleep (1 Chi per hour).
- **Negative Chi:** spending past 0 turns each point into damage.
- **Personal combat initiative:** Water + Yin/Yang, rerolled every round (can be turned off in settings).

### Campaign homebrew built in

- **Doubles:** a double counts as its face value (double 8 = 8). It is not an automatic success, but you regain that much Chi. On an attack that hits, it also adds its value to damage.
- **Double zero:** a critical failure and −5 Chi.
- **No homebrew Chi regeneration skills.**

### Battlefield units

- **Battlefield unit** actors. Each has 100 men and morale, tier, category, weapon type and skill, Unit Value, damage, Defense, movement, range and formation.
- **Officers:** drag a Qin character onto a unit's **Officer** tab to make them its officer. The unit then uses the officer's **Fire**, **Command** skill and weapon skill. Give the character **Officer abilities** (passive, battle skill, heroic actions, battle art) on their Officer tab.
- **Battle panel:** the chess-rook button in the token controls opens it. It runs the whole battle:
  1. **Formations:** players set formations in the panel and mark themselves ready.
  2. **Initiative:** the GM starts the round, rolling initiative for officer units (Yin/Yang + Fire; ties go to Fire, then the player side, then random).
  3. **Officer phase:** officers **Act** or **Hold**.
  4. **Officer-less phase:** sides alternate one unit at a time. Players press **Claim turn**, first come first served.
  5. **Interjecting:** held officers appear as portraits with an **Interject** button, and higher initiative can interject on an interjection.
  6. **Final pass:** remaining held officers act or give up their turn.
- **On a unit's turn:** drag its token to move (or **Don't move**, **Swap with target**, **Hold position**). Then **Attack target** after targeting an enemy token with T, or arm a **Forced march** and drag again. Officer skills, heroic actions and battle arts are buttons. **End turn** finishes.
- **Automated:**
  - The opposed roll, with both sides dealing damage and the loser losing morale.
  - Casualties minus Defense, and the strength penalties.
  - Charges and rear attacks (×2, or ×3 for a rear charge).
  - Ambush from hiding, facing (tokens rotate), and encirclement (−50).
  - Morale states, kill morale, officer regen up to 75, surrender, and the adjacent-ally penalty.
  - Formations, and the officer passive effects.
- **Terrain:** name scene **Regions** "Trees", "Tall grass" or "Impassable". Units ending their turn in grass or trees become hidden, and hidden enemy units are hidden from players until spotted (2 tiles in grass, 4 in trees).
- **Battle log:** every action is posted to chat with a roll breakdown.

### Compendiums

Taos (all 15, with level effects), Combat Techniques, Weapons & Armor, Gifts & Weaknesses, and Battlefield Units (the Han, Yellow Turban and Bandit roster). All are short summaries.

## Known limits (v0.1)

- **Tao effects:** these are posted to chat and paid in Chi, but most numeric effects are applied with the roll dialog's modifier and damage-bonus boxes. The exception is Strengthened Body's boxes, which are automatic.
- **Linking units:** not implemented yet.
- **Officer skills, heroic actions and battle arts:** using one is logged and its morale cost is paid. Their effects are applied by the GM, using the unit sheet or roll modifiers.
- **Movement:** it isn't blocked. An over-long move is allowed but flagged in chat. During a unit's turn, a token dragged outside its move step snaps back.
- **Token footprint:** 1×1 tokens on a square grid are assumed.
- **Unit Value and movement:** these are placeholders on the compendium units until the stat sheets are done.

## Development

```
npm install
npm test             # rules, battle engine and Foundry bridge tests
npm run build:packs  # rebuild compendiums from tools/content.mjs
npm run package      # rebuild dist/qin.zip (commit it; Foundry downloads it from the repo)
```
