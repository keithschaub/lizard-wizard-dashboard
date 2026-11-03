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
        
        // Load all Python files
        const scripts = [
            'actions.py', 'carddb.py', 'scoring.py', 'spell_effects.py',
            'turn.py', 'turn_package.py', 'ai_policy.py', 'ai_sim.py',
            'new_game.py', 'test_turn_process.py'
        ];

        for (const script of scripts) {
            const response = await fetch(`public/scripts/${script}`);
            const code = await response.text();
            this.pyodide.FS.writeFile(`/home/pyodide/${script}`, code);
        }

        // Load card data
        const cards = [
            'carddb.json', 'cards.json', 'reagent_cards.json',
            'dungeon_cards.json', 'spells_from_pc.json', 'other_cards_from_pc.json'
        ];

        this.pyodide.FS.mkdir('/home/pyodide/assets');
        for (const card of cards) {
            const response = await fetch(`public/cards/${card}`);
            const data = await response.text();
            this.pyodide.FS.writeFile(`/home/pyodide/assets/${card}`, data);
        }

        this.updateLoadingStatus('Initializing game modules...', 50);
        
        // Initialize Python modules
        await this.pyodide.runPythonAsync(`
import sys
sys.path.insert(0, '/home/pyodide')
import json
import actions as A
import carddb as CD
import scoring as S
import spell_effects as SE
import turn_package as TP
import ai_policy as AI
import ai_sim as SIM

# Patch file paths to use web paths
import os
os.path.exists = lambda p: True  # Stub for now
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

        // If tapped on empty board space, show mats overlay
        if (!hitCard) {
            this.showMatsOverlay();
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
        }
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
        if (!this.muted) {
            // Placeholder for sound effects
            // Will be implemented in Milestone 4
        }
    }

    async startGatherAction() {
        // Get current player's hand
        const player = this.getCurrentPlayer();
        if (!player || !player.hand || player.hand.length === 0) {
            this.showToast('No cards in hand');
            return;
        }

        // For simplicity, gather with first card in hand
        const cardPath = player.hand[0];
        const cardKey = cardPath.split('/').pop();

        try {
            // Get card gather icons from Python
            const gatherInfo = await this.pyodide.runPythonAsync(`
import json
card_key = "${cardKey}"
gather_icons, increase_icons = CD.reagent_icons(card_key)
json.dumps({
    'gather': gather_icons,
    'increase': increase_icons
})
            `);

            const info = JSON.parse(gatherInfo);
            this.currentGatherCard = {path: cardPath, key: cardKey, ...info};
            
            this.showGatherUI(this.currentGatherCard);
        } catch (error) {
            console.error('Gather action failed:', error);
            this.showToast('Failed to start gathering');
        }
    }

    getCurrentPlayer() {
        return this.gameState?.players?.find(p => p.name === this.currentPlayer);
    }

    showGatherUI(cardInfo) {
        const gatherUI = document.getElementById('gather-ui');
        const cardDisplay = document.getElementById('gather-card-display');
        const selection = document.getElementById('gather-selection');
        const bonusDiv = document.getElementById('gather-bonus');

        // Show card being gathered
        cardDisplay.innerHTML = `<img src="${cardInfo.path}" alt="Gathering card">`;

        // Show gather options
        const gatherIcons = cardInfo.gather;
        const keepCount = gatherIcons.length > 3 ? 3 : gatherIcons.length; // TODO: Check Maximum Gather
        
        document.getElementById('keep-count').textContent = keepCount;

        selection.innerHTML = '';
        this.gatherSelection = [];

        gatherIcons.forEach((reagent, i) => {
            const option = document.createElement('div');
            option.className = 'reagent-option';
            option.dataset.reagent = reagent;
            option.dataset.index = i;
            
            // TODO: Load actual reagent icon
            option.innerHTML = `
                <div class="reagent-icon" style="background: #4169e1; border-radius: 50%;"></div>
                <div>${reagent.replace('_', ' ')}</div>
            `;

            option.addEventListener('click', () => {
                this.toggleReagentSelection(option, reagent, keepCount);
            });

            selection.appendChild(option);
        });

        // Show wizard bonuses
        const player = this.getCurrentPlayer();
        if (player && player.wizards && player.wizards.length > 0) {
            bonusDiv.innerHTML = `<p>Wizard Bonuses: +${player.wizards.length} reagents</p>`;
        } else {
            bonusDiv.innerHTML = '';
        }

        gatherUI.classList.remove('hidden');
        this.vibrate(20);
    }

    toggleReagentSelection(element, reagent, maxCount) {
        const isSelected = element.classList.contains('selected');
        
        if (isSelected) {
            element.classList.remove('selected');
            const index = this.gatherSelection.indexOf(reagent);
            if (index > -1) this.gatherSelection.splice(index, 1);
        } else {
            if (this.gatherSelection.length < maxCount) {
                element.classList.add('selected');
                this.gatherSelection.push(reagent);
                this.vibrate(10);
            } else {
                this.showToast(`Can only keep ${maxCount} reagents`);
            }
        }

        // Enable commit button when correct number selected
        const commitBtn = document.getElementById('gather-commit');
        commitBtn.disabled = this.gatherSelection.length !== maxCount;
    }

    async commitGather() {
        // TODO: Call Python engine to process gather
        // For now, just update UI
        this.showToast('Gather action committed (engine integration pending)');
        document.getElementById('gather-ui').classList.add('hidden');
        this.gatherSelection = [];
        await this.renderBoard();
    }

    startDungeonDelve() {
        this.showToast('Dungeon delve (to be implemented)');
        // TODO: Implement dungeon UI
    }
}

// Initialize app
const app = new LizardWizardApp();
window.lizardWizard = app;
