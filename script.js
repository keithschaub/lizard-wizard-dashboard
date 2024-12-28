// Wait for the DOM to fully load
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM fully loaded and parsed.');

    // Firebase Initialization
    const db = firebase.database();

    // Global Variables
    let deleteMode = false;
    let currentPlayer = null;
    let selectedCategory = null;

    // School of Magic Icon Mapping
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
    // 🟦 Add Button Functionality
    // -----------------------------
    function openAddPopup(playerId) {
        currentPlayer = playerId;
        console.log(`Add item to ${playerId}`);
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

    // -----------------------------
    // 🟧 Handle Category Selection
    // -----------------------------
    function selectCard(category) {
        if (!currentPlayer) {
            console.error('No player selected for adding a card.');
            return;
        }
        selectedCategory = category;
        document.getElementById('card-selection').style.display = 'none';
        document.getElementById('school-selection').style.display = 'block';
    }
    window.selectCard = selectCard;

    // -----------------------------
    // 🟩 Handle School Selection
    // -----------------------------
    function selectSchool(school) {
        if (!currentPlayer || !selectedCategory) {
            console.error('Player or category not selected!');
            return;
        }

        const categoryKey = selectedCategory.toLowerCase() + 's';

        db.ref(`players/${currentPlayer}/${categoryKey}`).once('value', snapshot => {
            const cards = snapshot.val() || [];
            cards.push({ id: Date.now(), school });
            db.ref(`players/${currentPlayer}/${categoryKey}`).set(cards)
                .then(() => {
                    console.log(`${school} added successfully to ${selectedCategory}`);
                    closeSchoolSelection();
                })
                .catch(error => console.error(`Error: ${error.message}`));
        });
    }
    window.selectSchool = selectSchool;

    // -----------------------------
    // 🟥 Delete Mode Toggle
    // -----------------------------
    function deleteLastItem(playerId) {
        deleteMode = !deleteMode;
        console.log(deleteMode ? 'Delete mode activated. Click on a card to delete it.' : 'Delete mode deactivated.');

        // Highlight deletable cards
        document.querySelectorAll(`#${playerId} .card-item`).forEach(card => {
            if (deleteMode) {
                card.classList.add('deletable-card');
                card.onclick = () => {
                    const categoryElement = card.closest('div.card-row').previousElementSibling;
                    const category = categoryElement.textContent.replace(':', '').toLowerCase();
                    const cardId = card.dataset.id; // Assuming dataset contains ID

                    confirmDeleteCard(playerId, category, cardId);
                };
            } else {
                card.classList.remove('deletable-card');
                card.onclick = null;
            }
        });
    }
    window.deleteLastItem = deleteLastItem;

    // -----------------------------
    // 🟨 Confirm Deletion of Selected Card
    // -----------------------------
    function confirmDeleteCard(playerId, category, cardId) {
        db.ref(`players/${playerId}/${category}`).once('value', snapshot => {
            const cards = snapshot.val() || [];
            const updatedCards = cards.filter(card => String(card.id) !== String(cardId));

            db.ref(`players/${playerId}/${category}`).set(updatedCards)
                .then(() => {
                    console.log(`Deleted card ${cardId} from ${category}`);
                    deleteMode = false;
                    renderDashboard();
                })
                .catch(error => console.error(`Error: ${error.message}`));
        });
    }
    window.confirmDeleteCard = confirmDeleteCard;


/**
 * Sorts an array of cards by school of magic and maintains grouping in rows.
 * @param {Array} cards - The array of cards to sort.
 * @returns {Array} - The sorted array of cards.
 */
function sortCardsBySchoolAndCategory(cards) {
    if (!Array.isArray(cards)) return [];

    return cards.sort((a, b) => {
        // First, sort by school of magic
        const schoolA = a.school || '';
        const schoolB = b.school || '';
        if (schoolA !== schoolB) {
            return schoolA.localeCompare(schoolB);
        }

        // Second, maintain insertion order (or by ID if available)
        return (a.id || 0) - (b.id || 0);
    });
}

/**
 * Groups cards by school of magic within each category.
 * @param {Object} player - The player object containing card categories.
 * @returns {Object} - Cards grouped by category, then sorted by school.
 */
function groupBySchool(player) {
    const grouped = {
        wizards: [],
        towers: [],
        familiars: [],
        spells: []
    };

    // Process each category
    ['wizards', 'towers', 'familiars', 'spells'].forEach(category => {
        if (player[category]) {
            // Group by school within each category
            const schoolGroups = {};
            player[category].forEach(card => {
                const school = card.school || 'Unknown';
                if (!schoolGroups[school]) {
                    schoolGroups[school] = [];
                }
                schoolGroups[school].push(card);
            });

            // Flatten school groups into the category
            Object.keys(schoolGroups)
                .sort()
                .forEach(school => {
                    grouped[category].push(...schoolGroups[school]);
                });
        }
    });

    return grouped;
}


    // -----------------------------
    // 🟦 Real-time Updates with Icons
    // -----------------------------
    function renderCard(school, id) {
        const iconPath = schoolIcons[school] || 'assets/defaultIcon.webp';
        return `
            <div class="card-item" data-id="${id}">
                <img src="${iconPath}" alt="${school}" class="card-icon">
                <span>${school}</span>
            </div>
        `;
    }

/**
 * Renders a single player's row in the dashboard.
 * @param {string} playerId - The ID of the player to render.
 */
function renderPlayerRow(playerId) {
    db.ref(`players/${playerId}`).once('value', snapshot => {
        const player = snapshot.val();
        if (!player) return;

        const playerTile = document.getElementById(playerId);
        if (!playerTile) return;

        // Clear existing content
        playerTile.innerHTML = `
            <h3>${player.name || playerId}</h3>
            <div class="card-grid"></div>
            <button onclick="openAddPopup('${playerId}')">Add</button>
            <button onclick="deleteLastItem('${playerId}')">Delete</button>
        `;

        const groupedCards = groupBySchool(player); // Group cards by school within categories
        const cardGrid = playerTile.querySelector('.card-grid');

        // Render each category
        ['wizards', 'towers', 'familiars', 'spells'].forEach(category => {
            const categoryCards = groupedCards[category] || [];

            // Generate HTML for the category
            const categoryHTML = `
                <div>
                    <strong>${category.charAt(0).toUpperCase() + category.slice(1)}:</strong>
                    <div class="card-row">
                        ${categoryCards.length > 0 
                            ? categoryCards.map(card => renderCard(card.school, card.id, category)).join('')
                            : 'None'
                        }
                    </div>
                </div>
            `;
            
            // Append to the card grid
            cardGrid.innerHTML += categoryHTML;
        });
    });
}


/**
 * Renders the entire dashboard with sorted player data.
 */
function renderDashboard() {
    db.ref('players').on('value', snapshot => {
        const dashboard = document.getElementById('dashboard');
        dashboard.innerHTML = '';

        snapshot.forEach(playerSnapshot => {
            const playerId = playerSnapshot.key;
            const playerTile = document.createElement('div');
            playerTile.id = playerId;
            playerTile.className = 'player-tile';
            dashboard.appendChild(playerTile);

            renderPlayerRow(playerId); // Render each player
        });
    });
}


    renderDashboard();
    console.log('Script loaded successfully.');
});
