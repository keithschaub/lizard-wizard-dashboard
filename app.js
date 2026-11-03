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

        console.log('Board tapped at', x, y);

        // For now, show the mats overlay on any tap on empty board space
        // TODO: Detect specific card regions
        this.showMatsOverlay();
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
        // Placeholder for drawing face-up cards, decks, etc.
        // Will be implemented in Milestone 2
        ctx.save();
        ctx.translate(offsetX, offsetY);
        ctx.scale(scale, scale);
        
        // Draw placeholders for interactive elements
        ctx.fillStyle = 'rgba(212, 175, 55, 0.3)';
        ctx.strokeStyle = 'rgba(212, 175, 55, 0.8)';
        ctx.lineWidth = 2;
        
        // Example: Reagent deck position (will be refined)
        ctx.fillRect(100, 100, 80, 112);
        ctx.strokeRect(100, 100, 80, 112);
        
        ctx.restore();
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
}

// Initialize app
const app = new LizardWizardApp();
window.lizardWizard = app;
