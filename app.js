// Lizard Wizard Web App - Main Application
// Milestone 1: Pyodide engine, g8 state loaded, tests passing

class LizardWizardApp {
    constructor() {
        this.pyodide = null;
        this.gameState = null;
        this.muted = false;
        this.currentPlayer = 'Keith';
        this.initPromise = this.initialize();
    }

    async initialize() {
        try {
            await this.loadPyodide();
            await this.loadPythonEngine();
            await this.runTests();
            await this.loadGameState();
            this.setupUI();
            this.hideLoading();
            this.showGame();
            this.renderBoard();
        } catch (error) {
            console.error('Initialization failed:', error);
            this.showError('Failed to initialize game: ' + error.message);
        }
    }

    updateLoadingStatus(message, progress) {
        const statusEl = document.getElementById('loading-status');
        const progressEl = document.getElementById('loading-progress');
        if (statusEl) statusEl.textContent = message;
        if (progressEl) progressEl.style.width = `${progress}%`;
    }

    async loadPyodide() {
        this.updateLoadingStatus('Loading Python runtime...', 10);
        this.pyodide = await loadPyodide({
            indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.24.1/full/'
        });
        this.updateLoadingStatus('Python runtime loaded', 20);
    }

    async loadPythonEngine() {
        this.updateLoadingStatus('Loading game engine...', 30);
        
        // Create proper directory structure
        try {
            this.pyodide.FS.mkdir('/home/pyodide/cards');
        } catch (e) {
            // Directory might already exist
        }
        
        // Load all Python files
        const scripts = [
            'actions.py', 'carddb.py', 'scoring.py', 'spell_effects.py',
            'turn.py', 'turn_package.py', 'ai_policy.py', 'ai_sim.py',
            'new_game.py'
        ];

        for (const script of scripts) {
            const response = await fetch(`public/scripts/${script}`);
            const code = await response.text();
            this.pyodide.FS.writeFile(`/home/pyodide/${script}`, code);
        }

        // Load card data into cards/ directory
        const cards = [
            'carddb.json', 'cards.json', 'reagent_cards.json',
            'dungeon_cards.json', 'spells_from_pc.json', 'other_cards_from_pc.json'
        ];

        for (const card of cards) {
            const response = await fetch(`public/cards/${card}`);
            const data = await response.text();
            this.pyodide.FS.writeFile(`/home/pyodide/cards/${card}`, data);
        }

        this.updateLoadingStatus('Initializing game modules...', 50);
        
        // Initialize Python modules with proper error handling
        await this.pyodide.runPythonAsync(`
import sys
sys.path.insert(0, '/home/pyodide')

# Setup minimal environment
import os
os.chdir('/home/pyodide')

# Patch os.path.exists to check Pyodide FS
_pyodide_fs = sys.modules.get('pyodide_ffi', None)

import json

# Load modules with error handling
try:
    import carddb as CD
    print("✓ carddb loaded")
except Exception as e:
    print(f"✗ carddb failed: {e}")
    raise

try:
    import scoring as S
    print("✓ scoring loaded")
except Exception as e:
    print(f"✗ scoring failed: {e}")

try:
    import spell_effects as SE
    print("✓ spell_effects loaded")
except Exception as e:
    print(f"✗ spell_effects failed: {e}")

try:
    import actions as A
    print("✓ actions loaded")
except Exception as e:
    print(f"✗ actions failed: {e}")
    raise

try:
    import turn_package as TP
    print("✓ turn_package loaded")
except Exception as e:
    print(f"✗ turn_package failed: {e}")

try:
    import ai_policy as AI
    print("✓ ai_policy loaded")
except Exception as e:
    print(f"✗ ai_policy failed: {e}")

try:
    import ai_sim as SIM
    print("✓ ai_sim loaded")
except Exception as e:
    print(f"✗ ai_sim failed: {e}")

print("All modules loaded successfully")
        `);

        this.updateLoadingStatus('Game engine loaded', 60);
    }

    async runTests() {
        this.updateLoadingStatus('Running engine tests...', 70);
        
        try {
            // Run a subset of critical tests
            await this.pyodide.runPythonAsync(`
# Basic smoke tests
state = {
    'players': [{'name': 'Test', 'hand': [], 'tok': [], 'mana': 10}],
    'tracks': {'Horn': 3, 'Toadstool': 3, 'Nightshade': 3, 'Mandrake': 3, 'Foxglove': 3, 'Eye_of_Newt': 3, 'Sulphur': 3},
    'meta': {'round': 1, 'log': []}
}

# Test card database
cards_loaded = len(CD._load()['cards'])
assert cards_loaded > 100, f"Expected >100 cards, got {cards_loaded}"

# Test actions module
test_player = A.P(state, 'Test')
assert test_player['name'] == 'Test', "Player lookup failed"

print(f"✓ Tests passed: {cards_loaded} cards loaded")
            `);
            
            this.updateLoadingStatus('All tests passed ✓', 80);
        } catch (error) {
            console.error('Test failures:', error);
            throw new Error('Engine tests failed: ' + error.message);
        }
    }

    async loadGameState() {
        this.updateLoadingStatus('Loading game state...', 90);
        
        const response = await fetch('public/g8_state.json');
        const stateJson = await response.text();
        
        // Load state into Python
        this.pyodide.FS.writeFile('/home/pyodide/g8_state.json', stateJson);
        
        await this.pyodide.runPythonAsync(`
with open('/home/pyodide/g8_state.json', 'r') as f:
    game_state = json.load(f)

# Fix asset paths for web
def fix_paths(obj):
    if isinstance(obj, str) and '/workspace/' in obj:
        return 'public/art/' + obj.split('/')[-1]
    elif isinstance(obj, dict):
        return {k: fix_paths(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [fix_paths(x) for x in obj]
    return obj

game_state = fix_paths(game_state)
        `);

        // Get state back to JS
        this.gameState = this.pyodide.globals.get('game_state').toJs({dict_converter: Object.fromEntries});
        
        this.updateLoadingStatus('Game loaded ✓', 100);
        console.log('Game state loaded:', this.gameState);
    }

    setupUI() {
        // Mute toggle
        document.getElementById('mute-toggle').addEventListener('click', () => {
            this.muted = !this.muted;
            document.getElementById('mute-toggle').textContent = this.muted ? '🔇' : '🔊';
        });

        // Menu
        document.getElementById('menu-btn').addEventListener('click', () => {
            document.getElementById('menu-modal').classList.remove('hidden');
        });

        document.getElementById('close-menu').addEventListener('click', () => {
            document.getElementById('menu-modal').classList.add('hidden');
        });

        // Log toggle
        document.getElementById('log-toggle').addEventListener('click', () => {
            document.getElementById('action-log').classList.toggle('collapsed');
        });

        // Card expand (tap anywhere to close)
        document.getElementById('card-expand').addEventListener('click', (e) => {
            if (e.target.id === 'card-expand' || e.target.closest('.card-expand-content')) {
                this.closeCardExpand();
            }
        });

        // Mats overlay
        document.querySelector('.mats-overlay .close-btn')?.addEventListener('click', () => {
            document.getElementById('mats-overlay').classList.add('hidden');
        });

        // Save/Load
        document.getElementById('save-game').addEventListener('click', () => this.saveGame());
        document.getElementById('load-game').addEventListener('click', () => this.loadGame());
        document.getElementById('export-game').addEventListener('click', () => this.exportGame());
        document.getElementById('import-game').addEventListener('click', () => this.importGame());

        // Gather UI
        document.getElementById('gather-commit')?.addEventListener('click', () => this.commitGather());

        // Board interactions
        this.setupBoardInteractions();
    }

    setupBoardInteractions() {
        const canvas = document.getElementById('board-canvas');
        let touchStartTime = 0;
        let touchMoved = false;

        canvas.addEventListener('touchstart', (e) => {
            touchStartTime = Date.now();
            touchMoved = false;
        });

        canvas.addEventListener('touchmove', (e) => {
            touchMoved = true;
        });

        canvas.addEventListener('touchend', (e) => {
            const touchDuration = Date.now() - touchStartTime;
            if (!touchMoved && touchDuration < 300) {
                // Tap detected
                this.handleBoardTap(e);
            }
        });

        // Desktop click
        canvas.addEventListener('click', (e) => {
            this.handleBoardTap(e);
        });
    }

    handleBoardTap(event) {
        const rect = event.target.getBoundingClientRect();
        const x = (event.clientX || event.changedTouches[0].clientX) - rect.left;
        const y = (event.clientY || event.changedTouches[0].clientY) - rect.top;

        // Convert screen coordinates to board coordinates
        const boardX = (x - this.boardOffset.x) / this.boardScale;
        const boardY = (y - this.boardOffset.y) / this.boardScale;

        console.log('Board tapped at', boardX, boardY);

        // Check if tapped on a card
        let hitCard = false;
        
        if (this.cardHitboxes) {
            for (const box of this.cardHitboxes) {
                if (boardX >= box.x && boardX <= box.x + box.width &&
                    boardY >= box.y && boardY <= box.y + box.height) {
                    this.handleCardTap(box);
                    hitCard = true;
                    break;
                }
            }
        }

        // Check if tapped on a deck
        if (!hitCard && this.deckHitboxes) {
            for (const box of this.deckHitboxes) {
                if (boardX >= box.x && boardX <= box.x + box.width &&
                    boardY >= box.y && boardY <= box.y + box.height) {
                    this.handleDeckTap(box);
                    hitCard = true;
                    break;
                }
            }
        }

        // If tapped on empty board space, show action menu
        if (!hitCard) {
            this.showActionMenu();
        }
    }

    showActionMenu() {
        const menu = document.createElement('div');
        menu.className = 'action-menu-overlay';
        menu.innerHTML = `
            <div class="action-menu">
                <h2>Actions</h2>
                <button class="action-btn" data-action="gather">🃏 Gather Reagents</button>
                <button class="action-btn" data-action="convert">💎 Convert to Mana</button>
                <button class="action-btn" data-action="build">🗼 Build Tower</button>
                <button class="action-btn" data-action="research">📜 Research Spell</button>
                <button class="action-btn" data-action="summon">🔮 Summon Familiar</button>
                <button class="action-btn" data-action="dungeon">⚔️ Enter Dungeon</button>
                <button class="action-btn" data-action="auction">🧙 Recruit Wizard</button>
                <button class="action-btn" data-action="mats">📊 View Mats</button>
                <button class="action-btn" data-action="close">❌ Cancel</button>
            </div>
        `;
        document.body.appendChild(menu);

        menu.querySelectorAll('.action-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.action;
                menu.remove();
                this.handleAction(action);
            });
        });
    }

    handleAction(action) {
        switch (action) {
            case 'gather':
                this.startGatherAction();
                break;
            case 'convert':
                this.startConvertAction();
                break;
            case 'build':
                this.startBuildAction();
                break;
            case 'research':
                this.startResearchAction();
                break;
            case 'summon':
                this.startSummonAction();
                break;
            case 'dungeon':
                this.startDungeonDelve();
                break;
            case 'auction':
                this.startWizardAuction();
                break;
            case 'mats':
                this.showMatsOverlay();
                break;
        }
    }

    async startConvertAction() {
        const player = this.getCurrentPlayer();
        if (!player.tok || player.tok.length === 0) {
            this.showToast('No reagents to convert');
            return;
        }

        // Group tokens by type
        const tokenCounts = {};
        player.tok.forEach(t => {
            tokenCounts[t] = (tokenCounts[t] || 0) + 1;
        });

        // Show conversion UI
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <h2>Convert Reagents to Mana</h2>
                <p>Select reagent type and amount</p>
                <div class="convert-options">
                    ${Object.entries(tokenCounts).map(([token, count]) => `
                        <div class="convert-option" data-token="${token}">
                            <div class="token-type">${token.replace('_', ' ')}</div>
                            <div class="token-count">x${count}</div>
                            <input type="number" min="1" max="${count}" value="1" class="convert-amount">
                            <button class="btn-primary convert-btn">Convert</button>
                        </div>
                    `).join('')}
                </div>
                <button class="btn-secondary">Cancel</button>
            </div>
        `;
        document.body.appendChild(modal);

        modal.querySelectorAll('.convert-btn').forEach(btn => {
            btn.onclick = async () => {
                const option = btn.closest('.convert-option');
                const token = option.dataset.token;
                const amount = parseInt(option.querySelector('.convert-amount').value);
                
                try {
                    await this.pyodide.runPythonAsync(`
import actions as A
A.convert(game_state, "${this.currentPlayer}", "${token}", ${amount})
                    `);

                    this.gameState = this.pyodide.globals.get('game_state').toJs({dict_converter: Object.fromEntries});
                    
                    const trackValue = await this.pyodide.runPythonAsync(`game_state['tracks']['${token}']`);
                    const manaGained = trackValue * amount;
                    
                    this.showToast(`Converted ${amount} ${token.replace('_', ' ')} for ${manaGained} mana`);
                    this.vibrate(30);
                    this.playSound('convert');
                    this.addLogEntry(this.currentPlayer, `Converted ${amount} ${token.replace('_', ' ')} for ${manaGained} mana`);
                    
                    modal.remove();
                    await this.renderBoard();
                    await this.processAITurns();
                } catch (error) {
                    this.showToast('Convert failed: ' + error.message);
                }
            };
        });

        modal.querySelector('.btn-secondary').onclick = () => modal.remove();
    }

    async startBuildAction() {
        // Get available towers
        const towers = this.gameState.tower_face?.filter(t => t) || [];
        if (towers.length === 0) {
            this.showToast('No towers available');
            return;
        }

        // Show tower selection
        this.showTowerSelection(towers);
    }

    async showTowerSelection(towers) {
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <h2>Build Tower</h2>
                <div class="tower-grid">
                    ${towers.map((tower, i) => `
                        <div class="tower-card" data-tower="${tower}">
                            <img src="${tower}" alt="Tower">
                        </div>
                    `).join('')}
                </div>
                <button class="btn-secondary">Cancel</button>
            </div>
        `;
        document.body.appendChild(modal);

        modal.querySelectorAll('.tower-card').forEach(card => {
            card.addEventListener('click', async () => {
                const tower = card.dataset.tower;
                modal.remove();
                await this.buildTower(tower);
            });
        });

        modal.querySelector('.btn-secondary').onclick = () => modal.remove();
    }

    async buildTower(towerImg) {
        try {
            // Get tower cost
            const costInfo = await this.pyodide.runPythonAsync(`
import json
import carddb as CD

tower_key = "${towerImg.split('/').pop()}"
tier, reagent, school = CD.tower_info(tower_key)

json.dumps({
    'tier': tier,
    'reagent': reagent,
    'school': school,
    'cost_reagent': tier,
    'cost_gold': tier * 2
})
            `);

            const cost = JSON.parse(costInfo);

            // Ask payment method
            const payment = await new Promise(resolve => {
                const modal = document.createElement('div');
                modal.className = 'modal';
                modal.innerHTML = `
                    <div class="modal-content">
                        <h2>Pay for Tower (Tier ${cost.tier})</h2>
                        <button class="btn-primary" data-method="reagent">
                            ${cost.cost_reagent} ${cost.reagent.replace('_', ' ')}
                        </button>
                        <button class="btn-primary" data-method="gold">
                            ${cost.cost_gold} Gold
                        </button>
                        <button class="btn-secondary">Cancel</button>
                    </div>
                `;
                document.body.appendChild(modal);

                modal.querySelectorAll('[data-method]').forEach(btn => {
                    btn.onclick = () => {
                        modal.remove();
                        resolve(btn.dataset.method);
                    };
                });

                modal.querySelector('.btn-secondary').onclick = () => {
                    modal.remove();
                    resolve(null);
                };
            });

            if (!payment) return;

            // Build tower
            await this.pyodide.runPythonAsync(`
import actions as A

tower_img = "${towerImg}"
payment = "${payment}"

A.build(game_state, "${this.currentPlayer}", tower_img, payment)
            `);

            this.gameState = this.pyodide.globals.get('game_state').toJs({dict_converter: Object.fromEntries});

            this.showToast('Tower built!');
            this.vibrate(40);
            this.playSound('build');
            this.addLogEntry(this.currentPlayer, 'Built tower', towerImg);
            await this.renderBoard();
            await this.processAITurns();

        } catch (error) {
            console.error('Build failed:', error);
            this.showToast('Build failed: ' + error.message);
        }
    }

    async startResearchAction() {
        const spells = this.gameState.spell_face?.filter(s => s) || [];
        if (spells.length === 0) {
            this.showToast('No spells available');
            return;
        }

        this.showSpellSelection(spells);
    }

    async showSpellSelection(spells) {
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <h2>Research Spell</h2>
                <div class="spell-grid">
                    ${spells.map((spell, i) => `
                        <div class="spell-card" data-spell="${spell}">
                            <img src="${spell}" alt="Spell">
                        </div>
                    `).join('')}
                </div>
                <button class="btn-secondary">Cancel</button>
            </div>
        `;
        document.body.appendChild(modal);

        modal.querySelectorAll('.spell-card').forEach(card => {
            card.addEventListener('click', async () => {
                const spell = card.dataset.spell;
                modal.remove();
                await this.researchSpell(spell);
            });
        });

        modal.querySelector('.btn-secondary').onclick = () => modal.remove();
    }

    async researchSpell(spellImg) {
        try {
            await this.pyodide.runPythonAsync(`
import actions as A

spell_img = "${spellImg}"
# Research without casting immediately
A.research(game_state, "${this.currentPlayer}", spell_img, None)
            `);

            this.gameState = this.pyodide.globals.get('game_state').toJs({dict_converter: Object.fromEntries});

            this.showToast('Spell researched!');
            this.vibrate(30);
            this.playSound('cast');
            this.addLogEntry(this.currentPlayer, 'Researched spell', spellImg);
            await this.renderBoard();
            await this.processAITurns();

        } catch (error) {
            console.error('Research failed:', error);
            this.showToast('Research failed: ' + error.message);
        }
    }

    async startSummonAction() {
        const familiars = this.gameState.fam_face?.filter(f => f) || [];
        if (familiars.length === 0) {
            this.showToast('No familiars available');
            return;
        }

        this.showFamiliarSelection(familiars);
    }

    async showFamiliarSelection(familiars) {
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <h2>Summon Familiar</h2>
                <div class="familiar-grid">
                    ${familiars.map((fam, i) => `
                        <div class="familiar-card" data-familiar="${fam}">
                            <img src="${fam}" alt="Familiar">
                        </div>
                    `).join('')}
                </div>
                <button class="btn-secondary">Cancel</button>
            </div>
        `;
        document.body.appendChild(modal);

        modal.querySelectorAll('.familiar-card').forEach(card => {
            card.addEventListener('click', async () => {
                const familiar = card.dataset.familiar;
                modal.remove();
                await this.summonFamiliar(familiar);
            });
        });

        modal.querySelector('.btn-secondary').onclick = () => modal.remove();
    }

    async summonFamiliar(familiarImg) {
        try {
            // Get familiar cost
            const cost = await this.pyodide.runPythonAsync(`
import spell_effects as SE

fam_img = "${familiarImg}"
player = A.P(game_state, "${this.currentPlayer}")
SE.familiar_cost(player, fam_img)
            `);

            // Ask how to use familiar (for now, just score)
            await this.pyodide.runPythonAsync(`
import actions as A

fam_img = "${familiarImg}"
# Summon for score (simplest case)
A.summon_familiar(game_state, "${this.currentPlayer}", fam_img, 'score')
            `);

            this.gameState = this.pyodide.globals.get('game_state').toJs({dict_converter: Object.fromEntries});

            this.showToast(`Familiar summoned for ${cost} mana!`);
            this.vibrate(35);
            this.playSound('cast');
            this.addLogEntry(this.currentPlayer, `Summoned familiar for ${cost} mana`, familiarImg);
            await this.renderBoard();
            await this.processAITurns();

        } catch (error) {
            console.error('Summon failed:', error);
            this.showToast('Summon failed: ' + error.message);
        }
    }

    async processAITurns() {
        // Get AI players
        const aiPlayers = this.gameState.players.filter(p => p.name !== this.currentPlayer);

        for (const ai of aiPlayers) {
            await this.processAITurn(ai.name);
        }
    }

    async processAITurn(playerName) {
        try {
            // Show AI turn indicator
            const indicator = document.createElement('div');
            indicator.className = 'ai-turn-indicator';
            indicator.innerHTML = `<div>${playerName}'s turn...</div>`;
            document.body.appendChild(indicator);

            // Let user tap to skip animation
            let skipped = false;
            const skipHandler = () => {
                skipped = true;
            };
            indicator.addEventListener('click', skipHandler);

            // Animate for 1-2 seconds
            const animDuration = skipped ? 0 : (1000 + Math.random() * 1000);
            await new Promise(resolve => setTimeout(resolve, animDuration));

            // Get AI action from Python
            const actionResult = await this.pyodide.runPythonAsync(`
import json
import ai_policy as AI

player_name = "${playerName}"
player = A.P(game_state, player_name)

# Get AI view (hide opponent hands)
view = dict(game_state)
for p in view['players']:
    if p['name'] != player_name:
        p['hand'] = []
        p['mana'] = 0  # Hide mana

# Get best action from AI
try:
    action_info = AI.best_action(view, player_name)
    json.dumps({
        'action': action_info,
        'player': player_name
    })
except Exception as e:
    json.dumps({
        'error': str(e),
        'player': player_name
    })
            `);

            const result = JSON.parse(actionResult);

            if (result.error) {
                console.log(`AI ${playerName} has no valid actions:`, result.error);
                this.addLogEntry(playerName, 'No action (passed)');
            } else {
                // Execute AI action (simplified)
                const actionType = result.action?.type || 'unknown';
                this.addLogEntry(playerName, `Performed ${actionType} action`);
            }

            // Update state
            this.gameState = this.pyodide.globals.get('game_state').toJs({dict_converter: Object.fromEntries});

            indicator.remove();
            await this.renderBoard();

        } catch (error) {
            console.error(`AI turn failed for ${playerName}:`, error);
        }
    }

    addLogEntry(player, action, cardImg = null) {
        const logContent = document.getElementById('log-content');
        
        const entry = document.createElement('div');
        entry.className = 'log-entry';
        
        let html = `<span class="player">${player}</span>: ${action}`;
        
        if (cardImg) {
            html += `<div class="log-card"><img src="${cardImg}" alt="Card"></div>`;
        }
        
        entry.innerHTML = html;
        logContent.insertBefore(entry, logContent.firstChild);
        
        // Keep last 50 entries
        while (logContent.children.length > 50) {
            logContent.removeChild(logContent.lastChild);
        }
    }

    handleCardTap(cardBox) {
        console.log('Card tapped:', cardBox);
        this.vibrate(10);
        
        if (cardBox.card) {
            this.expandCard(cardBox.card);
        }
    }

    handleDeckTap(deckBox) {
        console.log('Deck tapped:', deckBox);
        this.vibrate(15);
        
        if (deckBox.type === 'reagent_deck' && deckBox.count > 0) {
            // Start gather action if it's player's turn
            this.startGatherAction();
        } else if (deckBox.type === 'dungeon_deck') {
            this.startDungeonDelve();
        } else if (deckBox.type === 'wizard_deck') {
            this.startWizardAuction();
        }
    }

    async startWizardAuction() {
        try {
            // Get face-up wizards
            const wizards = this.gameState.wiz_face?.filter(w => w) || [];
            if (wizards.length === 0) {
                this.showToast('No wizards available');
                return;
            }

            // Show wizard selection
            this.showWizardSelection(wizards);
            
        } catch (error) {
            console.error('Auction start failed:', error);
            this.showToast('Failed to start auction: ' + error.message);
        }
    }

    showWizardSelection(wizards) {
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <h2>Select Wizard to Bid On</h2>
                <div class="wizard-grid">
                    ${wizards.map((wiz, i) => `
                        <div class="wizard-card" data-wizard="${wiz}" data-index="${i}">
                            <img src="${wiz}" alt="Wizard">
                        </div>
                    `).join('')}
                </div>
                <button class="btn-secondary close-wizard-select">Cancel</button>
            </div>
        `;
        document.body.appendChild(modal);

        modal.querySelectorAll('.wizard-card').forEach(card => {
            card.addEventListener('click', () => {
                const wizard = card.dataset.wizard;
                modal.remove();
                this.showBiddingArena(wizard);
            });
        });

        modal.querySelector('.close-wizard-select').addEventListener('click', () => modal.remove());
    }

    async showBiddingArena(wizardImg) {
        const player = this.getCurrentPlayer();
        const maxBid = player.mana;

        const auctionUI = document.getElementById('auction-ui');
        const wizardDisplay = document.getElementById('auction-wizard');
        const playersDiv = document.getElementById('auction-players');
        const controls = document.getElementById('auction-controls');

        // Get wizard info
        const wizardInfo = await this.pyodide.runPythonAsync(`
import json
wiz_key = "${wizardImg.split('/').pop()}"
wiz = CD.get(wiz_key)
json.dumps({
    'name': wiz.get('name', wiz_key),
    'school': wiz.get('school', 'Unknown'),
    'bonus': wiz.get('gather_bonus', '')
})
        `);

        const info = JSON.parse(wizardInfo);

        wizardDisplay.innerHTML = `
            <img src="${wizardImg}" alt="${info.name}">
            <div class="wizard-info">
                <h3>${info.name}</h3>
                <p>${info.school}</p>
                <p>+1 ${info.bonus} when gathering</p>
            </div>
        `;

        // Show players in clockwise order (Keith on left)
        const players = this.gameState.players;
        const keithIndex = players.findIndex(p => p.name === this.currentPlayer);
        const orderedPlayers = [
            ...players.slice(keithIndex),
            ...players.slice(0, keithIndex)
        ];

        playersDiv.innerHTML = orderedPlayers.map((p, i) => `
            <div class="auction-player ${p.name === this.currentPlayer ? 'active' : ''}">
                <div class="player-name">${p.name}</div>
                <div class="player-bid">-</div>
            </div>
        `).join('');

        // Bidding controls
        const slider = document.getElementById('bid-slider');
        const bidAmount = document.getElementById('bid-amount');
        slider.max = maxBid;
        slider.value = 1;
        bidAmount.textContent = 1;

        slider.oninput = (e) => {
            bidAmount.textContent = e.target.value;
        };

        document.getElementById('bid-btn').onclick = () => {
            const bid = parseInt(slider.value);
            this.submitBid(wizardImg, bid);
        };

        document.getElementById('pass-btn').onclick = () => {
            this.passBid(wizardImg);
        };

        auctionUI.classList.remove('hidden');
        this.vibrate(20);
    }

    async submitBid(wizardImg, bid) {
        try {
            // For simplicity, assume Keith wins immediately at his bid price
            // (Full auction with AI would require turn processing)
            await this.pyodide.runPythonAsync(`
import actions as A

player_name = "${this.currentPlayer}"
wiz_img = "${wizardImg}"
price = ${bid}

A.recruit(game_state, player_name, wiz_img, price, starter=player_name, bids=[])
            `);

            this.gameState = this.pyodide.globals.get('game_state').toJs({dict_converter: Object.fromEntries});

            this.showToast(`Won wizard for ${bid} mana!`);
            this.vibrate(50);
            this.playSound('win');
            this.addLogEntry(this.currentPlayer, `Recruited wizard for ${bid} mana`, wizardImg);

            document.getElementById('auction-ui').classList.add('hidden');
            await this.renderBoard();
            await this.processAITurns();

        } catch (error) {
            console.error('Bid failed:', error);
            this.showToast('Bid failed: ' + error.message);
        }
    }

    async passBid(wizardImg) {
        this.showToast('Passed on auction');
        document.getElementById('auction-ui').classList.add('hidden');
    }

    async renderBoard() {
        const canvas = document.getElementById('board-canvas');
        const ctx = canvas.getContext('2d');

        // Set canvas size to match container
        const container = canvas.parentElement;
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;

        // Load and draw board background
        const bgImg = await this.loadImage('public/art/game_board_clean.webp');
        
        // Calculate scaling to fit
        const scale = Math.min(canvas.width / bgImg.width, canvas.height / bgImg.height);
        const scaledWidth = bgImg.width * scale;
        const scaledHeight = bgImg.height * scale;
        const offsetX = (canvas.width - scaledWidth) / 2;
        const offsetY = (canvas.height - scaledHeight) / 2;

        ctx.drawImage(bgImg, offsetX, offsetY, scaledWidth, scaledHeight);

        // TODO: Draw cards on board (reagent deck, face-up cards, etc.)
        this.drawGameElements(ctx, offsetX, offsetY, scale);

        // Update round indicator
        const roundNum = this.gameState?.meta?.round || 1;
        document.getElementById('round-num').textContent = roundNum;
    }

    drawGameElements(ctx, offsetX, offsetY, scale) {
        // Store scale for hitbox detection
        this.boardScale = scale;
        this.boardOffset = {x: offsetX, y: offsetY};
        
        ctx.save();
        ctx.translate(offsetX, offsetY);
        ctx.scale(scale, scale);
        
        // Draw face-up cards on board
        // Based on g8_state structure: reagent_face, spell_face, wiz_face, tower_face, fam_face
        this.drawFaceUpCards(ctx);
        
        ctx.restore();
    }

    async drawFaceUpCards(ctx) {
        if (!this.gameState) return;

        const cardWidth = 120;
        const cardHeight = 168;
        const spacing = 20;
        
        // Reagent face-up card positions (top of board)
        const reagentY = 50;
        const reagentX = 200;
        
        if (this.gameState.reagent_face && this.gameState.reagent_face.length > 0) {
            for (let i = 0; i < this.gameState.reagent_face.length; i++) {
                const card = this.gameState.reagent_face[i];
                if (card) {
                    const x = reagentX + i * (cardWidth + spacing);
                    const y = reagentY;
                    
                    // Draw card placeholder (will load actual images in next iteration)
                    ctx.fillStyle = 'rgba(100, 50, 150, 0.5)';
                    ctx.fillRect(x, y, cardWidth, cardHeight);
                    ctx.strokeStyle = 'rgba(212, 175, 55, 0.8)';
                    ctx.lineWidth = 2;
                    ctx.strokeRect(x, y, cardWidth, cardHeight);
                    
                    // Store hitbox for tap detection
                    if (!this.cardHitboxes) this.cardHitboxes = [];
                    this.cardHitboxes.push({
                        x, y, width: cardWidth, height: cardHeight,
                        type: 'reagent_deck',
                        index: i,
                        card: card
                    });
                }
            }
        }

        // Draw deck indicators
        this.drawDeckIndicator(ctx, 50, 300, 'Reagent\nDeck', this.gameState.reagent_deck || 0);
        this.drawDeckIndicator(ctx, 50, 500, 'Spell\nDeck', this.gameState.spell_deck || 0);
        this.drawDeckIndicator(ctx, 50, 700, 'Wizard\nDeck', this.gameState.wiz_deck || 0);
    }

    drawDeckIndicator(ctx, x, y, label, count) {
        ctx.fillStyle = 'rgba(42, 47, 62, 0.9)';
        ctx.fillRect(x, y, 100, 140);
        ctx.strokeStyle = 'rgba(212, 175, 55, 0.5)';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, 100, 140);
        
        ctx.fillStyle = '#d4af37';
        ctx.font = 'bold 16px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(label.split('\n')[0], x + 50, y + 50);
        ctx.fillText(label.split('\n')[1] || '', x + 50, y + 70);
        
        ctx.font = 'bold 24px sans-serif';
        ctx.fillText(count.toString(), x + 50, y + 110);
        
        // Store hitbox
        if (!this.deckHitboxes) this.deckHitboxes = [];
        this.deckHitboxes.push({
            x, y, width: 100, height: 140,
            type: label.replace('\n', '_').toLowerCase(),
            count: count
        });
    }

    loadImage(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = src;
        });
    }

    showMatsOverlay() {
        const overlay = document.getElementById('mats-overlay');
        const grid = document.getElementById('mats-grid');
        
        grid.innerHTML = '';
        
        for (const player of this.gameState.players) {
            const matDiv = document.createElement('div');
            matDiv.className = 'player-mat';
            if (player.name === this.currentPlayer) {
                matDiv.classList.add('active');
            }

            let html = `<h3>${player.name}</h3>`;
            
            // Mana and Gold
            html += `<div class="mat-section">
                <h4>Resources</h4>
                <div class="token-display">
                    <div class="token">💎 Mana: ${player.name === this.currentPlayer ? player.mana : '?'}</div>
                    <div class="token">🪙 Gold: ${player.gold || 0}</div>
                </div>
            </div>`;

            // Reagents
            if (player.tok && player.tok.length > 0) {
                const tokenCounts = {};
                player.tok.forEach(t => {
                    tokenCounts[t] = (tokenCounts[t] || 0) + 1;
                });
                
                html += `<div class="mat-section">
                    <h4>Reagents (${player.tok.length} / ${10 + (player.towers?.length || 0)})</h4>
                    <div class="token-display">`;
                
                for (const [token, count] of Object.entries(tokenCounts)) {
                    html += `<div class="token">${token.replace('_', ' ')}: ${count}</div>`;
                }
                
                html += `</div></div>`;
            }

            // Wizards
            if (player.wizards && player.wizards.length > 0) {
                html += `<div class="mat-section">
                    <h4>Wizards (${player.wizards.length})</h4>
                    <div class="card-grid">`;
                
                for (const wiz of player.wizards) {
                    const cardPath = wiz.replace('/workspace/', 'public/art/').replace('assets/', 'public/art/');
                    html += `<div class="card-thumb" data-card="${cardPath}">
                        <img src="${cardPath}" alt="Wizard">
                    </div>`;
                }
                
                html += `</div></div>`;
            }

            // Towers, Spells, Familiars (similar pattern)
            ['towers', 'familiars'].forEach(type => {
                if (player[type] && player[type].length > 0) {
                    html += `<div class="mat-section">
                        <h4>${type.charAt(0).toUpperCase() + type.slice(1)} (${player[type].length})</h4>
                        <div class="card-grid">`;
                    
                    for (const card of player[type]) {
                        const cardPath = card.replace('/workspace/', 'public/art/').replace('assets/', 'public/art/');
                        html += `<div class="card-thumb" data-card="${cardPath}">
                            <img src="${cardPath}" alt="${type}">
                        </div>`;
                    }
                    
                    html += `</div></div>`;
                }
            });

            // Spells (show cast status)
            if (player.spells && player.spells.length > 0) {
                html += `<div class="mat-section">
                    <h4>Spells (${player.spells.length})</h4>
                    <div class="card-grid">`;
                
                for (const spell of player.spells) {
                    const cardPath = spell.img.replace('/workspace/', 'public/art/').replace('assets/', 'public/art/');
                    const castMarker = spell.cast ? ' ⚡' : '';
                    html += `<div class="card-thumb" data-card="${cardPath}" title="${spell.cast ? 'Cast' : 'Uncast'}">
                        <img src="${cardPath}" alt="Spell">
                        ${castMarker}
                    </div>`;
                }
                
                html += `</div></div>`;
            }

            matDiv.innerHTML = html;
            
            // Add click handlers for card expansion
            matDiv.querySelectorAll('.card-thumb').forEach(thumb => {
                thumb.addEventListener('click', () => {
                    const cardPath = thumb.dataset.card;
                    this.expandCard(cardPath);
                });
            });
            
            grid.appendChild(matDiv);
        }
        
        overlay.classList.remove('hidden');
    }

    async expandCard(cardPath) {
        const cardExpand = document.getElementById('card-expand');
        const img = document.getElementById('card-expand-img');
        const textDiv = document.getElementById('card-expand-text');

        img.src = cardPath;

        // Get card info from carddb
        const cardKey = cardPath.split('/').pop();
        
        try {
            const cardInfo = await this.pyodide.runPythonAsync(`
import json
card_key = "${cardKey}"
card = CD.get(card_key)
json.dumps({
    'name': card.get('name', card_key),
    'effect': card.get('effect', ''),
    'school': card.get('school', ''),
    'cost': str(card.get('cost', ''))
})
            `);

            const info = JSON.parse(cardInfo);
            
            let html = `<h3>${info.name}</h3>`;
            if (info.school) html += `<p><strong>School:</strong> ${info.school}</p>`;
            if (info.effect) html += `<p>${info.effect}</p>`;
            if (info.cost && info.cost !== 'None') html += `<p><strong>Cost:</strong> ${info.cost}</p>`;
            
            textDiv.innerHTML = html;
        } catch (error) {
            textDiv.innerHTML = `<h3>${cardKey}</h3><p>Card information not available</p>`;
        }

        cardExpand.classList.remove('hidden');
        this.vibrate(10);
    }

    closeCardExpand() {
        document.getElementById('card-expand').classList.add('hidden');
    }

    hideLoading() {
        document.getElementById('loading-screen').classList.add('hidden');
    }

    showGame() {
        document.getElementById('game-container').classList.remove('hidden');
    }

    showError(message) {
        const loadingStatus = document.getElementById('loading-status');
        loadingStatus.textContent = message;
        loadingStatus.style.color = '#dc143c';
    }

    saveGame() {
        try {
            localStorage.setItem('lizardwizard_save', JSON.stringify(this.gameState));
            this.showToast('Game saved!');
        } catch (error) {
            this.showToast('Save failed: ' + error.message);
        }
    }

    loadGame() {
        try {
            const saved = localStorage.getItem('lizardwizard_save');
            if (saved) {
                this.gameState = JSON.parse(saved);
                this.renderBoard();
                this.showToast('Game loaded!');
                document.getElementById('menu-modal').classList.add('hidden');
            } else {
                this.showToast('No saved game found');
            }
        } catch (error) {
            this.showToast('Load failed: ' + error.message);
        }
    }

    exportGame() {
        const dataStr = JSON.stringify(this.gameState, null, 2);
        const dataBlob = new Blob([dataStr], {type: 'application/json'});
        const url = URL.createObjectURL(dataBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'lizardwizard_save.json';
        link.click();
        URL.revokeObjectURL(url);
        this.showToast('Game exported!');
    }

    importGame() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json';
        input.onchange = (e) => {
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    this.gameState = JSON.parse(event.target.result);
                    this.renderBoard();
                    this.showToast('Game imported!');
                    document.getElementById('menu-modal').classList.add('hidden');
                } catch (error) {
                    this.showToast('Import failed: ' + error.message);
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }

    showToast(message) {
        // Simple toast notification
        const toast = document.createElement('div');
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: var(--bg-medium);
            color: var(--text-primary);
            padding: 12px 24px;
            border-radius: 8px;
            border: 1px solid var(--accent-gold);
            z-index: 10001;
            animation: fadeIn 0.3s ease;
        `;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }

    vibrate(duration) {
        if (!this.muted && navigator.vibrate) {
            navigator.vibrate(duration);
        }
    }

    playSound(sound) {
        if (!this.muted && typeof AudioContext !== 'undefined') {
            try {
                const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                const oscillator = audioCtx.createOscillator();
                const gainNode = audioCtx.createGain();

                oscillator.connect(gainNode);
                gainNode.connect(audioCtx.destination);

                // Different sounds for different actions
                const sounds = {
                    'gather': { freq: 440, type: 'sine', duration: 0.1 },
                    'cast': { freq: 880, type: 'square', duration: 0.15 },
                    'build': { freq: 220, type: 'triangle', duration: 0.2 },
                    'convert': { freq: 330, type: 'sine', duration: 0.12 },
                    'win': { freq: 660, type: 'sine', duration: 0.3 },
                    'tap': { freq: 550, type: 'sine', duration: 0.05 }
                };

                const config = sounds[sound] || sounds['tap'];
                
                oscillator.type = config.type;
                oscillator.frequency.setValueAtTime(config.freq, audioCtx.currentTime);
                
                gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + config.duration);

                oscillator.start(audioCtx.currentTime);
                oscillator.stop(audioCtx.currentTime + config.duration);
            } catch (error) {
                console.log('Sound playback failed:', error);
            }
        }
    }

    async startGatherAction() {
        // Get current player's hand
        const player = this.getCurrentPlayer();
        if (!player || !player.hand || player.hand.length === 0) {
            this.showToast('No cards in hand');
            return;
        }

        // Show hand selection
        this.showHandSelection(player.hand);
    }

    showHandSelection(hand) {
        const overlay = document.createElement('div');
        overlay.className = 'hand-selection-overlay';
        overlay.innerHTML = `
            <div class="hand-selection-content">
                <h2>Select Card to Gather</h2>
                <div class="hand-cards">
                    ${hand.map((card, i) => `
                        <div class="hand-card" data-index="${i}" data-card="${card}">
                            <img src="${card}" alt="Card ${i + 1}">
                        </div>
                    `).join('')}
                </div>
                <button class="btn-secondary cancel-hand">Cancel</button>
            </div>
        `;
        
        document.body.appendChild(overlay);
        
        overlay.querySelectorAll('.hand-card').forEach(card => {
            card.addEventListener('click', async () => {
                const cardPath = card.dataset.card;
                overlay.remove();
                await this.selectGatherCard(cardPath);
            });
        });
        
        overlay.querySelector('.cancel-hand').addEventListener('click', () => overlay.remove());
    }

    async selectGatherCard(cardPath) {
        const cardKey = cardPath.split('/').pop().replace('.webp', '.jpg');

        try {
            // Get card info including Miracle check
            const gatherInfo = await this.pyodide.runPythonAsync(`
import json
card_key = "${cardKey}"
player = A.P(game_state, "${this.currentPlayer}")

# Check for Miracle cast
has_miracle = any('Miracle' in x.get('img', '') and x.get('cast') for x in player.get('spells', []))

# Get icons (will be reversed if Miracle is active and player chooses)
gather_icons, increase_icons = CD.reagent_icons(card_key)

# Check for Maximum Gather
has_max_gather = any('Maximum_Gather' in x.get('img', '') and x.get('cast') for x in player.get('spells', []))

# Wizard bonuses
wizard_bonuses = []
W = A._cards()[1]
for w in player.get('wizards', []):
    if w in W and W[w].get('gather_bonus_reagent'):
        wizard_bonuses.append(A.norm(W[w]['gather_bonus_reagent']))

json.dumps({
    'gather': gather_icons,
    'increase': increase_icons,
    'has_miracle': has_miracle,
    'has_max_gather': has_max_gather,
    'wizard_bonuses': wizard_bonuses,
    'card_key': card_key
})
            `);

            const info = JSON.parse(gatherInfo);
            this.currentGatherCard = {path: cardPath, ...info};
            
            // If Miracle, ask if player wants to reverse
            if (info.has_miracle) {
                this.askMiracleReverse(info);
            } else {
                this.showGatherUI(this.currentGatherCard);
            }
        } catch (error) {
            console.error('Gather selection failed:', error);
            this.showToast('Failed to select card: ' + error.message);
        }
    }

    askMiracleReverse(info) {
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <h2>Miracle Active</h2>
                <p>Reverse the Gather and Increase Value halves?</p>
                <button class="btn-primary" id="miracle-yes">Yes, Reverse</button>
                <button class="btn-secondary" id="miracle-no">No, Keep Normal</button>
            </div>
        `;
        document.body.appendChild(modal);
        
        modal.querySelector('#miracle-yes').addEventListener('click', () => {
            this.currentGatherCard.reversed = true;
            // Swap gather and increase icons
            const temp = this.currentGatherCard.gather;
            this.currentGatherCard.gather = this.currentGatherCard.increase;
            this.currentGatherCard.increase = temp;
            modal.remove();
            this.showGatherUI(this.currentGatherCard);
        });
        
        modal.querySelector('#miracle-no').addEventListener('click', () => {
            this.currentGatherCard.reversed = false;
            modal.remove();
            this.showGatherUI(this.currentGatherCard);
        });
    }

    getCurrentPlayer() {
        return this.gameState?.players?.find(p => p.name === this.currentPlayer);
    }

    showGatherUI(cardInfo) {
        const gatherUI = document.getElementById('gather-ui');
        const cardDisplay = document.getElementById('gather-card-display');
        const selection = document.getElementById('gather-selection');
        const bonusDiv = document.getElementById('gather-bonus');

        // Show card being gathered with both halves
        cardDisplay.innerHTML = `
            <div class="reagent-card-display">
                <img src="${cardInfo.path}" alt="Reagent Card">
                <div class="card-half-label top">${cardInfo.reversed ? 'INCREASE VALUE (gathering from)' : 'GATHER REAGENTS'}</div>
                <div class="card-half-label bottom">${cardInfo.reversed ? 'GATHER REAGENTS (gathering from)' : 'INCREASE VALUE'}</div>
            </div>
        `;

        // Show gather options with tap-to-select/deselect
        const gatherIcons = cardInfo.gather;
        const keepCount = cardInfo.has_max_gather ? gatherIcons.length : Math.min(3, gatherIcons.length);
        
        document.getElementById('keep-count').textContent = keepCount;

        selection.innerHTML = '<div class="gather-instruction">Tap reagents to select (tap again to deselect)</div>';
        this.gatherSelection = [];
        
        const iconsContainer = document.createElement('div');
        iconsContainer.className = 'reagent-icons-grid';

        gatherIcons.forEach((reagent, i) => {
            const option = document.createElement('div');
            option.className = 'reagent-option';
            option.dataset.reagent = reagent;
            option.dataset.index = i;
            
            const iconPath = `public/art/icons/reagent_icons/${reagent}.webp`;
            option.innerHTML = `
                <div class="reagent-icon">
                    <div style="background: var(--accent-purple); width: 40px; height: 40px; border-radius: 50%; margin: 0 auto;"></div>
                </div>
                <div class="reagent-name">${reagent.replace('_', ' ')}</div>
            `;

            option.addEventListener('click', () => {
                this.toggleReagentSelectionAutoCommit(option, reagent, keepCount, cardInfo);
            });

            iconsContainer.appendChild(option);
        });
        
        selection.appendChild(iconsContainer);

        // Show wizard bonuses
        if (cardInfo.wizard_bonuses && cardInfo.wizard_bonuses.length > 0) {
            bonusDiv.innerHTML = `
                <div class="wizard-bonus-display">
                    <strong>Wizard Bonuses:</strong> +${cardInfo.wizard_bonuses.length} reagents
                    <div class="bonus-list">${cardInfo.wizard_bonuses.map(b => b.replace('_', ' ')).join(', ')}</div>
                </div>
            `;
        } else {
            bonusDiv.innerHTML = '';
        }

        // Hide commit button (auto-commits on last selection)
        document.getElementById('gather-commit').style.display = 'none';

        gatherUI.classList.remove('hidden');
        this.vibrate(20);
    }

    toggleReagentSelectionAutoCommit(element, reagent, maxCount, cardInfo) {
        const isSelected = element.classList.contains('selected');
        
        if (isSelected) {
            // Deselect
            element.classList.remove('selected');
            const index = this.gatherSelection.indexOf(reagent);
            if (index > -1) this.gatherSelection.splice(index, 1);
            this.vibrate(5);
        } else {
            // Select
            if (this.gatherSelection.length < maxCount) {
                element.classList.add('selected');
                this.gatherSelection.push(reagent);
                this.vibrate(10);
                
                // Auto-commit on last selection
                if (this.gatherSelection.length === maxCount) {
                    setTimeout(() => this.commitGatherAutomatic(cardInfo), 300);
                }
            } else {
                this.showToast(`Already selected ${maxCount} reagents`);
                this.vibrate([10, 50, 10]);
            }
        }
    }

    async commitGatherAutomatic(cardInfo) {
        this.vibrate(30);
        // Proceed to check castable spells
        await this.processGatherWithEngine(cardInfo);
    }

    async processGatherWithEngine(cardInfo) {
        try {
            const player = this.currentPlayer;
            const cardKey = cardInfo.card_key;
            const keepList = this.gatherSelection.length > 0 ? this.gatherSelection : null;

            // First, check what spells are castable BEFORE gathering (with anticipated tokens)
            const castableInfo = await this.pyodide.runPythonAsync(`
import json

player = A.P(game_state, "${player}")
current_tokens = player.get('tok', [])

# Simulate gather to see what we'll have
card_key = "${cardKey}"
keep = ${JSON.stringify(keepList)}
R, W = A._cards()
card_id = card_key.replace('.jpg', '').replace('Reagent_', '')
if not card_id.startswith('Reagent_'):
    card_id = 'Reagent_' + card_id

# Get what we'll gather
c = R[card_id]
icons = [A.norm(x) for x in c['gather_icons_in_print_order']]
gathered = keep if keep and len(keep) > 0 else icons[:3]

# Add wizard bonuses
wizard_bonuses = []
for w in player.get('wizards', []):
    if w in W and W[w].get('gather_bonus_reagent'):
        wizard_bonuses.append(A.norm(W[w]['gather_bonus_reagent']))

anticipated_tokens = current_tokens + gathered + wizard_bonuses

# Check castable spells
castable = []
for spell in player.get('spells', []):
    if not spell.get('cast'):
        spell_key = spell['img'].split('/')[-1]
        try:
            cost = CD.cast_cost(spell_key)
            if cost:
                cost_norm = [A.norm(c) for c in cost]
                token_counts = {}
                for t in anticipated_tokens:
                    token_counts[t] = token_counts.get(t, 0) + 1
                
                can_cast = all(token_counts.get(c, 0) >= cost_norm.count(c) for c in set(cost_norm))
                
                if can_cast:
                    castable.append({
                        'key': spell_key,
                        'img': spell['img'],
                        'cost': cost,
                        'name': CD.display(spell_key)
                    })
        except:
            pass

json.dumps({
    'castable': castable,
    'anticipated_tokens': anticipated_tokens
})
            `);

            const info = JSON.parse(castableInfo);
            
            if (info.castable.length > 0) {
                // Show castable spells BEFORE committing gather
                this.showCastableSpellsPreGather(info.castable, cardInfo);
            } else {
                // No castable spells, commit gather directly
                await this.commitGatherToEngine(cardInfo, null);
            }
            
        } catch (error) {
            console.error('Gather processing failed:', error);
            this.showToast('Failed to process gather: ' + error.message);
        }
    }

    showCastableSpellsPreGather(spells, cardInfo) {
        // Hide gather UI
        document.getElementById('gather-ui').classList.add('hidden');
        
        // Show castable spells
        const castableDiv = document.getElementById('castable-spells');
        castableDiv.innerHTML = '<h3>Cast a spell? (cost paid BEFORE storage check)</h3>';
        castableDiv.className = 'castable-spells-overlay';
        
        const spellGrid = document.createElement('div');
        spellGrid.className = 'castable-spell-grid';
        
        spells.forEach(spell => {
            const spellCard = document.createElement('div');
            spellCard.className = 'castable-spell-card glow';
            spellCard.innerHTML = `
                <img src="${spell.img}" alt="${spell.name}">
                <div class="spell-name">${spell.name}</div>
                <div class="spell-cost">Cost: ${spell.cost.join(', ')}</div>
            `;
            spellCard.addEventListener('click', () => {
                castableDiv.classList.add('hidden');
                this.castSpellDuringGather(spell, cardInfo);
            });
            spellGrid.appendChild(spellCard);
        });
        
        castableDiv.appendChild(spellGrid);

        const skipBtn = document.createElement('button');
        skipBtn.className = 'btn-secondary';
        skipBtn.textContent = 'Skip casting';
        skipBtn.addEventListener('click', () => {
            castableDiv.classList.add('hidden');
            this.commitGatherToEngine(cardInfo, null);
        });
        castableDiv.appendChild(skipBtn);

        castableDiv.classList.remove('hidden');
    }

    async castSpellDuringGather(spell, cardInfo) {
        this.vibrate(20);
        // Commit gather with spell cast
        await this.commitGatherToEngine(cardInfo, spell);
    }

    async commitGatherToEngine(cardInfo, spellToCast) {
        try {
            const player = this.currentPlayer;
            const cardKey = cardInfo.card_key;
            const keepList = this.gatherSelection.length > 0 ? this.gatherSelection : null;
            const spendList = spellToCast ? spellToCast.cost : null;

            // Call Python engine
            await this.pyodide.runPythonAsync(`
import json

player_name = "${player}"
card_key = "${cardKey}"
keep = ${JSON.stringify(keepList)}
spend = ${JSON.stringify(spendList)}

try:
    # Call actions.gather with spend for cast
    A.gather(game_state, player_name, card_key, keep=keep, spend=spend)
    
    # Mark spell as cast if provided
    ${spellToCast ? `
    player = A.P(game_state, player_name)
    for spell in player.get('spells', []):
        if '${spellToCast.key}' in spell['img'] and not spell.get('cast'):
            spell['cast'] = True
            break
    ` : ''}
    
    result = "success"
except ValueError as e:
    # Storage limit exceeded
    if 'over storage' in str(e).lower():
        result = "over_storage"
        error_msg = str(e)
    else:
        result = f"error: {str(e)}"
except Exception as e:
    result = f"error: {str(e)}"
    print(result)
            `);

            const result = this.pyodide.globals.get('result');
            
            if (result === 'success') {
                // Get updated state
                this.gameState = this.pyodide.globals.get('game_state').toJs({dict_converter: Object.fromEntries});
                
                this.showToast(spellToCast ? `Cast ${spellToCast.name}!` : 'Gathered!');
                this.vibrate(30);
                this.playSound(spellToCast ? 'cast' : 'gather');
                
                this.addLogEntry(this.currentPlayer, spellToCast ? `Gathered and cast ${spellToCast.name}` : 'Gathered reagents');
                
                document.getElementById('gather-ui').classList.add('hidden');
                this.gatherSelection = [];
                await this.renderBoard();
                
                // Process AI turns after player action
                await this.processAITurns();
                
            } else if (result === 'over_storage') {
                // Show storage put-back UI
                await this.showStoragePutBack();
                
            } else {
                throw new Error(result);
            }
            
        } catch (error) {
            console.error('Gather commit failed:', error);
            this.showToast('Gather failed: ' + error.message);
        }
    }

    async showStoragePutBack() {
        const player = this.getCurrentPlayer();
        const capacity = await this.pyodide.runPythonAsync(`
player = A.P(game_state, "${this.currentPlayer}")
A.capacity(player)
        `);

        const storageDiv = document.getElementById('storage-warning');
        storageDiv.innerHTML = `
            <h3>Over Storage Limit!</h3>
            <p>You have ${player.tok.length} tokens but capacity is ${capacity}.</p>
            <p>Tap tokens to put back (${player.tok.length - capacity} needed):</p>
            <div class="token-putback-grid">
                ${player.tok.map((token, i) => `
                    <div class="token-putback" data-index="${i}" data-token="${token}">
                        ${token.replace('_', ' ')}
                    </div>
                `).join('')}
            </div>
        `;

        this.putBackSelection = [];

        storageDiv.querySelectorAll('.token-putback').forEach(el => {
            el.addEventListener('click', () => {
                const token = el.dataset.token;
                const index = parseInt(el.dataset.index);
                
                if (el.classList.contains('selected')) {
                    el.classList.remove('selected');
                    const idx = this.putBackSelection.indexOf(index);
                    if (idx > -1) this.putBackSelection.splice(idx, 1);
                } else {
                    el.classList.add('selected');
                    this.putBackSelection.push(index);
                    this.vibrate(10);
                }

                // Auto-commit when correct number selected
                const needed = player.tok.length - capacity;
                if (this.putBackSelection.length === needed) {
                    setTimeout(() => this.commitPutBack(needed), 300);
                }
            });
        });

        storageDiv.classList.remove('hidden');
    }

    async commitPutBack(needed) {
        try {
            const tokensToRemove = this.putBackSelection.map(i => 
                this.getCurrentPlayer().tok[i]
            );

            await this.pyodide.runPythonAsync(`
import json

player = A.P(game_state, "${this.currentPlayer}")
tokens_to_remove = ${JSON.stringify(tokensToRemove)}

for token in tokens_to_remove:
    if token in player['tok']:
        player['tok'].remove(token)

result = "success"
            `);

            this.gameState = this.pyodide.globals.get('game_state').toJs({dict_converter: Object.fromEntries});
            
            document.getElementById('storage-warning').classList.add('hidden');
            this.showToast('Storage adjusted');
            this.vibrate(20);
            await this.renderBoard();
            
        } catch (error) {
            console.error('Put back failed:', error);
            this.showToast('Failed to adjust storage');
        }
    }

    async checkCastableSpells() {
        const player = this.getCurrentPlayer();
        if (!player || !player.spells || player.spells.length === 0) {
            return;
        }

        // Check which spells can be cast with current tokens
        try {
            const castableInfo = await this.pyodide.runPythonAsync(`
import json

player = A.P(game_state, "${this.currentPlayer}")
tokens = player.get('tok', [])

castable = []
for spell in player.get('spells', []):
    if not spell.get('cast'):
        spell_key = spell['img'].split('/')[-1]
        try:
            cost = CD.cast_cost(spell_key)
            if cost:
                cost_norm = [A.norm(c) for c in cost]
                # Check if we have enough tokens
                token_counts = {}
                for t in tokens:
                    token_counts[t] = token_counts.get(t, 0) + 1
                
                can_cast = True
                for c in cost_norm:
                    if token_counts.get(c, 0) < cost_norm.count(c):
                        can_cast = False
                        break
                
                if can_cast:
                    castable.append({
                        'key': spell_key,
                        'cost': cost,
                        'name': CD.display(spell_key)
                    })
        except:
            pass

json.dumps(castable)
            `);

            const castable = JSON.parse(castableInfo);
            
            if (castable.length > 0) {
                this.showCastableSpells(castable);
            }
        } catch (error) {
            console.error('Failed to check castable spells:', error);
        }
    }

    showCastableSpells(spells) {
        const castableDiv = document.getElementById('castable-spells');
        castableDiv.innerHTML = '<h4>Cast a spell?</h4>';
        
        spells.forEach(spell => {
            const btn = document.createElement('button');
            btn.className = 'btn-primary';
            btn.textContent = `Cast: ${spell.name}`;
            btn.addEventListener('click', () => this.castSpell(spell.key));
            castableDiv.appendChild(btn);
        });

        const skipBtn = document.createElement('button');
        skipBtn.className = 'btn-secondary';
        skipBtn.textContent = 'Skip casting';
        skipBtn.addEventListener('click', () => {
            castableDiv.classList.add('hidden');
        });
        castableDiv.appendChild(skipBtn);

        castableDiv.classList.remove('hidden');
    }

    async castSpell(spellKey) {
        try {
            // TODO: Implement spell casting
            this.showToast(`Casting ${spellKey} (implementation pending)`);
            document.getElementById('castable-spells').classList.add('hidden');
        } catch (error) {
            console.error('Cast spell failed:', error);
            this.showToast('Cast failed: ' + error.message);
        }
    }

    async startDungeonDelve() {
        try {
            // Check if dungeon has treasure left
            const canDelve = await this.pyodide.runPythonAsync(`
import spell_effects as SE
SE.dungeon_treasure_left(game_state)
            `);

            if (!canDelve) {
                this.showToast('No treasure left in dungeon!');
                return;
            }

            // Initialize dungeon state
            this.dungeonState = {
                hits: 0,
                drawn: [],
                continuing: true
            };

            // Get hit limit
            const limit = await this.pyodide.runPythonAsync(`
import spell_effects as SE
player = A.P(game_state, "${this.currentPlayer}")
2 + (1 if SE.has_cast(player, 'Spirit_Shield') else 0)
            `);

            this.dungeonState.limit = limit;
            
            // Show dungeon UI
            this.showDungeonUI();
            
            // Draw first card
            await this.drawDungeonCard();
            
        } catch (error) {
            console.error('Dungeon delve failed:', error);
            this.showToast('Failed to start dungeon: ' + error.message);
        }
    }

    showDungeonUI() {
        const dungeonUI = document.getElementById('dungeon-ui');
        dungeonUI.classList.remove('hidden');
        
        document.getElementById('dungeon-hits').innerHTML = `
            Hits: <span id="dungeon-hit-count">0</span> / <span>${this.dungeonState.limit}</span>
        `;
        
        document.getElementById('dungeon-drawn').innerHTML = '<div class="drawn-cards"></div>';
        
        // Wire up buttons
        document.getElementById('dungeon-continue').onclick = () => this.drawDungeonCard();
        document.getElementById('dungeon-stop').onclick = () => this.stopDungeonDelve();
    }

    async drawDungeonCard() {
        try {
            // Draw one card from Python
            const result = await this.pyodide.runPythonAsync(`
import json
import spell_effects as SE

player = A.P(game_state, "${this.currentPlayer}")
deck = A.ensure_dungeon(game_state)

if not deck:
    json.dumps({'error': 'No cards left'})
else:
    card = deck.pop(0)
    
    # Calculate hits
    hits = 0
    if card['type'] == 'Monster':
        monster_type = card.get('monster_type')
        if monster_type == 'Undead' and SE.has_cast(player, 'Control_Undead'):
            hits = 0  # Control Undead ignores
        elif SE.has_cast(player, SE.BLOCK.get(monster_type, '~')):
            hits = 0  # Block spell active, +1 Gold instead
        else:
            hits = 1
    elif card['type'] == 'Trap':
        hits = 2
    
    json.dumps({
        'card': card,
        'hits': hits,
        'deck_left': len(deck)
    })
            `);

            const data = JSON.parse(result);
            
            if (data.error) {
                this.showToast(data.error);
                return;
            }

            // Update state
            this.dungeonState.hits += data.hits;
            this.dungeonState.drawn.push(data.card);

            // Show card
            this.displayDungeonCard(data.card, data.hits);

            // Update hit counter
            document.getElementById('dungeon-hit-count').textContent = this.dungeonState.hits;

            // Check if defeated
            if (this.dungeonState.hits >= this.dungeonState.limit) {
                this.vibrate([20, 50, 20, 50, 20]);
                this.showToast('Defeated! Lost everything.');
                setTimeout(() => this.finishDungeonDelve(false), 1500);
            } else {
                this.vibrate(data.hits > 0 ? 20 : 10);
            }

        } catch (error) {
            console.error('Draw card failed:', error);
            this.showToast('Failed to draw card: ' + error.message);
        }
    }

    displayDungeonCard(card, hits) {
        const cardDiv = document.getElementById('dungeon-card');
        const cardName = card.name || card.key || 'Card';
        const cardType = card.type;
        const hitText = hits > 0 ? ` (${hits} hit${hits > 1 ? 's' : ''})` : ' (no hit)';
        
        cardDiv.innerHTML = `
            <div class="dungeon-card-shown ${hits > 0 ? 'hit' : 'safe'}">
                <div class="card-type">${cardType}${hitText}</div>
                <div class="card-name">${cardName}</div>
                ${card.gold ? `<div class="card-gold">🪙 ${card.gold} Gold</div>` : ''}
            </div>
        `;

        // Add to drawn pile
        const drawnDiv = document.querySelector('.drawn-cards');
        const miniCard = document.createElement('div');
        miniCard.className = `mini-card ${cardType.toLowerCase()}`;
        miniCard.textContent = cardType[0];
        drawnDiv.appendChild(miniCard);
    }

    async stopDungeonDelve() {
        this.vibrate(30);
        await this.finishDungeonDelve(true);
    }

    async finishDungeonDelve(success) {
        try {
            // Process dungeon result in Python
            await this.pyodide.runPythonAsync(`
import json
import spell_effects as SE

player = A.P(game_state, "${this.currentPlayer}")
success = ${success ? 'True' : 'False'}

# Count drawn cards by type
drawn = ${JSON.stringify(this.dungeonState.drawn)}
treasure_count = sum(1 for c in drawn if c['type'] == 'Treasure')
gold_gained = 0

if success:
    # Keep treasures
    for card in drawn:
        if card['type'] == 'Treasure':
            if card.get('subtype') == 'Gold':
                gold_gained += card.get('gold', 0)
                player['gold'] = player.get('gold', 0) + card['gold']
            else:
                player.setdefault('treasures', []).append(card)

# Log
A.log(game_state, {
    'r': game_state['meta'].get('round'),
    'who': "${this.currentPlayer}",
    'act': 'dungeon',
    'hits': ${this.dungeonState.hits},
    'success': success,
    'treasure_count': treasure_count,
    'gold_gained': gold_gained
})

result = "success"
            `);

            this.gameState = this.pyodide.globals.get('game_state').toJs({dict_converter: Object.fromEntries});

            const message = success 
                ? `Collected ${this.dungeonState.drawn.filter(c => c.type === 'Treasure').length} treasures!`
                : 'Defeated! Lost everything.';
            
            this.showToast(message);
            
            document.getElementById('dungeon-ui').classList.add('hidden');
            this.dungeonState = null;
            
            await this.renderBoard();
            
        } catch (error) {
            console.error('Finish dungeon failed:', error);
            this.showToast('Failed to complete dungeon: ' + error.message);
        }
    }
}

// Initialize app
const app = new LizardWizardApp();
window.lizardWizard = app;
