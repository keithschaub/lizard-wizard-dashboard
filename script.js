// Wait for the DOM to fully load
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded.');

    // -----------------------------
    // 1. Firebase Initialization
    // -----------------------------
    const db = firebase.database();

    // -----------------------------
    // 2. Global Variables
    // -----------------------------
    let deleteMode = false;
    let currentPlayer = null;    // Which player is adding cards
    let selectedCategory = null; // "Wizard", "Tower", "Familiar", or "Spell"
    
    // We'll store all possible Spell cards (loaded from spell_cards.json) here
    let ALL_SPELLS = [];

    // School of magic icons
    const schoolIcons = {
        Druidry: 'assets/greenDruidry.webp',
        Sorcery: 'assets/blueSorcery.webp',
        Thaumaturgy: 'assets/goldThaumaturgy.webp',
        Alchemy: 'assets/purpleAlchemy.webp',
        Enchantment: 'assets/whiteEnchantment.webp',
        Necromancy: 'assets/blackNecromancy.webp',
        Conjuring: 'assets/redConjuring.webp'
    };

    // -----------------------------
    // 3. Load the Spell Cards (from spell_cards.json)
    // -----------------------------
    // This assumes spell_cards.json is in the same folder as your index.html
    fetch('spell_cards.json')
        .then(response => response.json())
        .then(data => {
            ALL_SPELLS = data; 
            console.log('Loaded spell cards:', ALL_SPELLS);
        })
        .catch(err => console.error('Error loading spell_cards.json:', err));

    // -----------------------------
    // 4. Name Editing (contenteditable)
    // -----------------------------
    document.addEventListener('blur', (e) => {
        if (e.target.classList.contains('player-name')) {
            const newName = e.target.innerText.trim();
            const playerId = e.target.dataset.playerid;

            if (newName.length > 0) {
                db.ref(`players/${playerId}/name`).set(newName)
                    .then(() => console.log(`Player ${playerId} renamed to "${newName}"`))
                    .catch(err => console.error(err));
            }
        }
    }, true);

    // -----------------------------
    // 5. Add Card Flow
    // -----------------------------
    function openAddPopup(playerId) {
        currentPlayer = playerId;
        document.getElementById('card-selection').style.display = 'block';
    }
    window.openAddPopup = openAddPopup;

    function closeCardSelection() {
        document.getElementById('card-selection').style.display = 'none';
        currentPlayer = null;
        selectedCategory = null;
    }
    window.closeCardSelection = closeCardSelection;

    function closeSchoolSelection() {
        document.getElementById('school-selection').style.display = 'none';
        selectedCategory = null;
    }
    window.closeSchoolSelection = closeSchoolSelection;

    /**
     * Called when the user clicks “Wizard / Tower / Familiar / Spell”
     */
    function selectCard(category) {
        if (!currentPlayer) return;
        selectedCategory = category;

        // Hide the “Category” popup
        document.getElementById('card-selection').style.display = 'none';

        if (category === 'Spell') {
            // For Spell, we open the Spell List popup instead of the “school selection”
            openSpellListPopup();
        } else {
            // For Wizard, Tower, Familiar, we still do the old “school selection” approach
            document.getElementById('school-selection').style.display = 'block';
        }
    }
    window.selectCard = selectCard;

    /**
     * openSpellListPopup:
     * Renders a list of ALL_SPELLS by name. 
     * User clicks one to select it => we store that entire object in the DB.
     */
    function openSpellListPopup() {
    	const spellListDiv = document.getElementById('spell-list');
    	// Build HTML for each spell in ALL_SPELLS
    	let html = '';
    	ALL_SPELLS.forEach(spell => {
        	html += `
            		<div class="spell-option" onclick="chooseSpell(${spell.id})">
                		<strong>${spell.name}</strong>
            		</div>
        	`;
    	});
    	spellListDiv.innerHTML = html;
    	document.getElementById('spell-selection').style.display = 'block';
     }


    function closeSpellListPopup() {
        document.getElementById('spell-selection').style.display = 'none';
        currentPlayer = null;
        selectedCategory = null;
    }
    window.closeSpellListPopup = closeSpellListPopup;

    /**
     * chooseSpell(spellId):
     * Find that spell in ALL_SPELLS, push it into player's spells array, 
     * including name, school, customText. 
     */
    window.chooseSpell = function(spellId) {
        const chosen = ALL_SPELLS.find(s => s.id === spellId);
        if (!chosen || !currentPlayer) return;

        // Save to Firebase
        db.ref(`players/${currentPlayer}/spells`).once('value')
          .then(snap => {
              const currentSpells = snap.val() || [];
              // We'll store the entire chosen object
              // If you want a new 'id' for the card in the DB, you can do Date.now() or such.
              // For clarity, we’ll keep the same 'id' that was in spell_cards.json.
              currentSpells.push({ 
                  id: chosen.id,
                  school: chosen.school,
                  name: chosen.name,
                  customText: chosen.customText
              });
              return db.ref(`players/${currentPlayer}/spells`).set(currentSpells);
          })
          .then(() => {
              console.log(`Spell "${chosen.name}" added to ${currentPlayer}.`);
              closeSpellListPopup();
          })
          .catch(err => console.error(err));
    };

    // For non-spell categories (Wizard/Tower/Familiar), we do the old approach:
    function selectSchool(school) {
        if (!currentPlayer || !selectedCategory) return;
        const categoryKey = selectedCategory.toLowerCase() + 's';

        db.ref(`players/${currentPlayer}/${categoryKey}`).once('value')
          .then(snap => {
              const cards = snap.val() || [];
              cards.push({ id: Date.now(), school });
              return db.ref(`players/${currentPlayer}/${categoryKey}`).set(cards);
          })
          .then(() => {
              console.log(`Added ${selectedCategory} of school ${school} to ${currentPlayer}`);
              closeSchoolSelection();
          })
          .catch(err => console.error(err));
    }
    window.selectSchool = selectSchool;

    // -----------------------------
    // 6. Delete Mode
    // -----------------------------
    function deleteLastItem(playerId) {
        deleteMode = !deleteMode;
        console.log(deleteMode ? 'Delete mode ON' : 'Delete mode OFF');

        // Highlight all card-items for this player
        document.querySelectorAll(`#${playerId} .card-item`).forEach(card => {
            if (deleteMode) {
                card.classList.add('deletable-card');
                card.onclick = () => {
                    const cardId = card.dataset.id;
                    const cat = card.dataset.category; // wizards/towers/familiars/spells
                    confirmDeleteCard(playerId, cat, cardId);
                };
            } else {
                card.classList.remove('deletable-card');
                card.onclick = null;
            }
        });
    }
    window.deleteLastItem = deleteLastItem;

    function confirmDeleteCard(playerId, category, cardId) {
        db.ref(`players/${playerId}/${category}`).once('value')
          .then(snap => {
              const cards = snap.val() || [];
              const updated = cards.filter(c => String(c.id) !== String(cardId));
              return db.ref(`players/${playerId}/${category}`).set(updated);
          })
          .then(() => {
              console.log(`Deleted card ${cardId} from ${category}`);
              deleteMode = false;
          })
          .catch(err => console.error(err));
    }
    window.confirmDeleteCard = confirmDeleteCard;

    // -----------------------------
    // 7. Compute Score
    // -----------------------------
    // Same scoring logic as before
    function computeScore(player) {
        if (!player) return 0;

        const wizards   = Array.isArray(player.wizards)   ? player.wizards   : [];
        const towers    = Array.isArray(player.towers)    ? player.towers    : [];
        const familiars = Array.isArray(player.familiars) ? player.familiars : [];
        const spells    = Array.isArray(player.spells)    ? player.spells    : [];

        const wizardCount = {};
        const towerCount  = {};
        const spellCount  = {};

        function inc(obj, s) {
            obj[s] = (obj[s] || 0) + 1;
        }

        wizards.forEach(w => inc(wizardCount, w.school));
        towers.forEach(t => inc(towerCount, t.school));
        spells.forEach(s => inc(spellCount, s.school));

        const allSchools = new Set([
            ...Object.keys(wizardCount),
            ...Object.keys(towerCount),
            ...Object.keys(spellCount),
        ]);

        let totalPoints = 0;
        let leftoverW = 0;
        let leftoverT = 0;

        allSchools.forEach(sch => {
            const wCount = wizardCount[sch] || 0;
            const tCount = towerCount[sch]  || 0;
            const sCount = spellCount[sch]  || 0;

            // same-school pairs
            const samePairs = Math.min(wCount, tCount);
            totalPoints += samePairs * 10;

            // leftover after same-school pairing
            leftoverW += (wCount - samePairs);
            leftoverT += (tCount - samePairs);

            // spells bonus
            if (samePairs > 0 && sCount > 0) {
                totalPoints += sCount * 5;
            }
        });

        // mismatch pairs
        const mismatch = Math.min(leftoverW, leftoverT);
        totalPoints += mismatch * 5;

        leftoverW -= mismatch;
        leftoverT -= mismatch;

        // leftover single wizard/tower => 1 point
        totalPoints += leftoverW + leftoverT;

        // familiars not scored in your rules => 0
        return totalPoints;
    }

    // -----------------------------
    // 8. Group & Render (Pivot Table)
    // -----------------------------
    function gatherAndGroupBySchool(player) {
        const categories = ['wizards', 'towers', 'familiars', 'spells'];
        const grouped = {};

        categories.forEach(cat => {
            if (Array.isArray(player[cat])) {
                player[cat].forEach(card => {
                    const sch = card.school || 'Unknown';
                    if (!grouped[sch]) {
                        grouped[sch] = {
                            wizards: [],
                            towers: [],
                            familiars: [],
                            spells: []
                        };
                    }
                    grouped[sch][cat].push(card);
                });
            }
        });
        return grouped;
    }

    /**
     * Render a single card. 
     * - For Spells, we show school on one line, the name on the next line, 
     *   plus a tooltip for customText if present.
     * - For non-spells, just show the school name.
     */
    function renderCardItem(card, category) {
        const iconPath = schoolIcons[card.school] || 'assets/defaultIcon.webp';

        // If it's a spell, we do a 2-line layout: 
        // 1) school
        // 2) card.name
        // We'll also place the card.customText into a 'title' attribute for easy hover tooltip.
        const isSpell = (category === 'spells');
        const tooltip = (isSpell && card.customText)
            ? `title="${card.customText.replace(/"/g, '&quot;')}"`
            : '';

        let htmlContent = `
            <div class="card-item" data-id="${card.id}" data-category="${category}" ${tooltip}>
                <img src="${iconPath}" alt="${card.school}" class="card-icon">
                <div class="card-details">
                    <div class="card-school">${card.school}</div>
        `;

        if (isSpell && card.name) {
            htmlContent += `
                    <div class="spell-name">${card.name}</div>
            `;
        }

        htmlContent += `
                </div>
            </div>
        `;
        return htmlContent;
    }

    function renderCategoryCell(cards, category) {
        if (!cards || cards.length === 0) return '';
        return cards.map(c => renderCardItem(c, category)).join('');
    }

    // -----------------------------
    // 9. Render a Single Player Tile
    // -----------------------------
    function renderPlayerRow(playerId) {
        db.ref(`players/${playerId}`).once('value').then(snapshot => {
            const player = snapshot.val();
            if (!player) return;

            const tile = document.getElementById(playerId);
            if (!tile) return;

            // compute new score
            const newScore = computeScore(player);
            if (player.score !== newScore) {
                db.ref(`players/${playerId}/score`).set(newScore);
            }

            const playerName = player.name || playerId;
            tile.innerHTML = `
                <h3>
                  <span 
                    class="player-name"
                    contenteditable="true"
                    data-playerid="${playerId}"
                  >
                    ${playerName}
                  </span>
                  (Score: <span class="player-score">${newScore}</span>)
                </h3>
                <div class="cards-container"></div>
                <div class="button-container">
                  <button onclick="openAddPopup('${playerId}')">Add</button>
                  <button onclick="deleteLastItem('${playerId}')">Delete</button>
                </div>
            `;

            // Gather cards by school => pivot table
            const grouped = gatherAndGroupBySchool(player);
            const allSchools = Object.keys(grouped).sort();

            const container = tile.querySelector('.cards-container');
            if (allSchools.length === 0) {
                container.innerHTML = `<div class="no-cards">No cards</div>`;
                return;
            }

            let tableHTML = `
                <table class="cards-table">
                    <thead>
                        <tr>
                            <th>Wizards</th>
                            <th>Towers</th>
                            <th>Familiars</th>
                            <th>Spells</th>
                        </tr>
                    </thead>
                    <tbody>
            `;

            allSchools.forEach(sch => {
                const catObj = grouped[sch];
                tableHTML += `
                    <tr>
                        <td>${renderCategoryCell(catObj.wizards, 'wizards')}</td>
                        <td>${renderCategoryCell(catObj.towers, 'towers')}</td>
                        <td>${renderCategoryCell(catObj.familiars, 'familiars')}</td>
                        <td>${renderCategoryCell(catObj.spells, 'spells')}</td>
                    </tr>
                `;
            });

            tableHTML += `
                    </tbody>
                </table>
            `;

            container.innerHTML = tableHTML;
        });
    }

    // -----------------------------
    // 10. Render the Entire Dashboard
    // -----------------------------
    function renderDashboard() {
        // Listen for changes on 'players'
        db.ref('players').on('value', snapshot => {
            const dash = document.getElementById('dashboard');
            dash.innerHTML = '';

            snapshot.forEach(playerSnapshot => {
                const playerId = playerSnapshot.key;
                const playerTile = document.createElement('div');
                playerTile.id = playerId;
                playerTile.className = 'player-tile';
                dash.appendChild(playerTile);

                // Render each player's row
                renderPlayerRow(playerId);
            });
        });
    }

    // Initialize
    renderDashboard();
});
