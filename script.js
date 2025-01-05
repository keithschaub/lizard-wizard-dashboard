/*******************************************
 * 1. Global Variables
 *******************************************/
// We assume "db" is already defined from firebase-init.js

let allPlayers = [];       // Holds current players from DB
let ALL_SPELLS = [];       // Loaded from spell_cards.json
let deleteMode = false;    // Toggles delete mode for cards
let currentPlayer = null;  // Which player is adding a card
let selectedCategory = null; // "Wizard", "Tower", "Familiar", or "Spell"

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

// Optional color classes for spells
const schoolColorClass = {
  Alchemy:     'alchemy-bg',
  Conjuring:   'conjuring-bg',
  Druidry:     'druidry-bg',
  Enchantment: 'enchantment-bg',
  Necromancy:  'necromancy-bg',
  Sorcery:     'sorcery-bg',
  Thaumaturgy: 'thaumaturgy-bg'
};


/*******************************************
 * 2. Initialization on DOM Load
 *******************************************/
document.addEventListener('DOMContentLoaded', async () => {
  console.log('[script.js] DOM fully loaded. Using db from firebase-init.js.');

  // Load spells from JSON
  try {
    const response = await fetch('spell_cards.json');
    ALL_SPELLS = await response.json();
    console.log('[Initialization] Loaded spell cards:', ALL_SPELLS);
  } catch (err) {
    console.error('[Initialization] Error loading spell_cards.json:', err);
  }

  // Fetch all players and render the dashboard
  await fetchAllPlayers();
  renderDashboard();

  // Set up global event listeners
  setupGlobalEventListeners();
});


/*******************************************
 * 3. Fetch & Store Players
 *******************************************/
function fetchAllPlayers() {
  return db.ref('players/').once('value')
    .then(snapshot => {
      const newList = [];
      snapshot.forEach(childSnap => {
        const data = childSnap.val() || {};
        // Attach the DB key (e.g. "player1") as "id"
        data.id = childSnap.key;
        newList.push(data);
      });
      allPlayers = newList;
      console.log('[fetchAllPlayers] allPlayers:', allPlayers);
      return allPlayers;
    })
    .catch(err => {
      console.error('[fetchAllPlayers] Error:', err);
      throw err;
    });
}


/*******************************************
 * 4. Compute & Update Scores
 *******************************************/
function computeScore(player, allPlayersArray) {
  if (!player) {
    console.warn('[computeScore] Invalid player data:', player);
    return 0;
  }

  // Safely handle arrays
  const wizards   = Array.isArray(player.wizards)   ? player.wizards   : [];
  const towers    = Array.isArray(player.towers)    ? player.towers    : [];
  const familiars = Array.isArray(player.familiars) ? player.familiars : [];
  const spells    = Array.isArray(player.spells)    ? player.spells    : [];

  // Count objects
  const wizardCount = {};
  const towerCount  = {};
  const spellCount  = {};

  function inc(obj, school) {
    obj[school] = (obj[school] || 0) + 1;
  }

  // Tally up each type
  wizards.forEach(w => inc(wizardCount, w.school));
  towers.forEach(t => inc(towerCount, t.school));
  spells.forEach(s => inc(spellCount, s.school));

  // Combine schools from wizards/towers/spells
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
    const tCount = towerCount[sch] || 0;
    const sCount = spellCount[sch] || 0;

    // +10 per Wizard/Tower matching pair
    const samePairs = Math.min(wCount, tCount);
    totalPoints += samePairs * 10;

    leftoverW += (wCount - samePairs);
    leftoverT += (tCount - samePairs);

    // If at least one Wizard/Tower pair, each Spell = +5
    if (samePairs > 0 && sCount > 0) {
      totalPoints += sCount * 5;
    }
  });

  // Mismatched Wizard/Tower => +5 if they can pair across schools
  const mismatch = Math.min(leftoverW, leftoverT);
  totalPoints += mismatch * 5;
  leftoverW -= mismatch;
  leftoverT -= mismatch;

  // Any leftover wizards/towers => +1 each
  totalPoints += leftoverW + leftoverT;

  // Gold => +1 each
  const goldPoints = parseInt(player.gold) || 0;
  totalPoints += goldPoints;

  // Achievements => +10 each
  const achvPoints = (parseInt(player.achievements) || 0) * 10;
  totalPoints += achvPoints;

  // Items => top gets +10, second gets +5
  const itemCounts = allPlayersArray.map(p => parseInt(p.dungeonItems) || 0);
  const sortedItems = [...itemCounts].sort((a, b) => b - a);
  const maxItems = sortedItems[0] || 0;
  const secondMax = sortedItems.find(cnt => cnt < maxItems) || 0;

  const playerItems = parseInt(player.dungeonItems) || 0;
  if (playerItems === maxItems && maxItems > 0) {
    totalPoints += 10; // top
  } else if (playerItems === secondMax && secondMax > 0) {
    totalPoints += 5; // second
  }

  return totalPoints;
}

function updateScores() {
  const updates = {};
  allPlayers.forEach(player => {
    const newScore = computeScore(player, allPlayers);
    updates[`players/${player.id}/score`] = newScore;
  });

  return db.ref().update(updates)
    .then(() => console.log('[updateScores] All scores updated.'))
    .catch(err => console.error('[updateScores] Error:', err));
}


/*******************************************
 * 5. Rendering the Dashboard
 *******************************************/
function renderDashboard() {
  console.log('[renderDashboard] Start');
  const dash = document.getElementById('dashboard');
  dash.innerHTML = ''; // Clear out old content

  allPlayers.forEach(player => {
    // 'player.id' is "player1", etc. 'player.name' is "Keith" or whatever
    const tile = document.createElement('div');
    tile.id = player.id;
    tile.className = 'player-tile';

    tile.innerHTML = `
      <h3>
        <span class="player-name"
              contenteditable="true"
              data-playerid="${player.id}">
          ${player.name || player.id}
        </span>
        (Score: <span class="player-score">${player.score || 0}</span>)

        <span class="gold-value"
              contenteditable="true"
              data-playerid="${player.id}"
              data-field="gold"
              onclick="highlightText(this)">
          ${player.gold || 0}
        </span> Gold /

        <span class="items-value"
              contenteditable="true"
              data-playerid="${player.id}"
              data-field="dungeonItems"
              onclick="highlightText(this)">
          ${player.dungeonItems || 0}
        </span> Items /

        <span class="achv-value"
              contenteditable="true"
              data-playerid="${player.id}"
              data-field="achievements"
              onclick="highlightText(this)">
          ${player.achievements || 0}
        </span> Achv
      </h3>

      <div class="cards-container"></div>

      <div class="button-container">
        <button onclick="openAddPopup('${player.id}')">Add</button>
        <button onclick="deleteLastItem('${player.id}')">Delete</button>
      </div>
    `;

    dash.appendChild(tile);

    // Render the pivot table for wizards/towers/familiars/spells
    const container = tile.querySelector('.cards-container');
    renderPlayerCards(container, player);
  });

  console.log('[renderDashboard] Done');
}

function renderPlayerCards(container, player) {
  const grouped = gatherAndGroupBySchool(player);
  const allSchools = Object.keys(grouped).sort();

  if (allSchools.length === 0) {
    container.innerHTML = '<div class="no-cards">No cards</div>';
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

  tableHTML += `</tbody></table>`;
  container.innerHTML = tableHTML;
}

function gatherAndGroupBySchool(player) {
  const categories = ['wizards', 'towers', 'familiars', 'spells'];
  const grouped = {};

  categories.forEach(cat => {
    if (Array.isArray(player[cat])) {
      player[cat].forEach(card => {
        const sch = card.school || 'Unknown';
        if (!grouped[sch]) {
          grouped[sch] = { wizards: [], towers: [], familiars: [], spells: [] };
        }
        grouped[sch][cat].push(card);
      });
    }
  });

  return grouped;
}

function renderCategoryCell(cards, category) {
  if (!cards || cards.length === 0) return '';
  return cards.map(c => renderCardItem(c, category)).join('');
}

function renderCardItem(card, category) {
  const iconPath = schoolIcons[card.school] || 'assets/defaultIcon.webp';
  const isSpell = (category === 'spells');

  let onClickAttr = '';
  if (isSpell && card.customText) {
    const escapedText = card.customText
      .replace(/'/g, "\\'")
      .replace(/"/g, '\\"');
    onClickAttr = `onclick="alert('${escapedText}')"`; 
  }

  return `
    <div class="card-item"
         data-id="${card.id}"
         data-category="${category}"
         ${onClickAttr}>
      <img src="${iconPath}" alt="${card.school}" class="card-icon">
      <div class="card-details">
        <div class="card-school">${card.school}</div>
        ${
          isSpell && card.name
            ? `<div class="spell-name">${card.name}</div>`
            : ''
        }
      </div>
    </div>
  `;
}


/*******************************************
 * 6. Global Event Listeners
 *******************************************/
function setupGlobalEventListeners() {
  // Listen for blur events on gold, items, achievements
  document.addEventListener('blur', handleEditableBlur, true);
}

function handleEditableBlur(e) {
  const target = e.target;
  console.log('[handleEditableBlue] blur fired!', e.target);

  if (!['gold-value', 'items-value', 'achv-value'].some(cls => target.classList.contains(cls))) {
    return;
  }

  const playerId = target.dataset.playerid;
  const field    = target.dataset.field; // "gold", "dungeonItems", "achievements"
  const newValue = parseInt(target.innerText.trim(), 10) || 0;

  if (!playerId || !field) return;

  db.ref(`players/${playerId}/${field}`).set(newValue)
    .then(() => {
      // Optionally you can chain everything...
      return fetchAllPlayers();
    })
    .then(() => updateScores())
    .then(() => {
      // Re-render if you want to see an immediate update *before* the page reload
      renderDashboard();

      // Then force a full page reload
      window.location.reload();
    })
    .catch(err => console.error('[handleEditableBlur] Error:', err));
}



/*******************************************
 * 7. Add / Delete Card Flow
 *******************************************/
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
 * selectCard:
 * Called when user clicks "Wizard" / "Tower" / "Familiar" / "Spell" in the "Add" popup.
 */
function selectCard(category) {
  if (!currentPlayer) return;
  selectedCategory = category;

  // Hide the Category popup
  document.getElementById('card-selection').style.display = 'none';

  if (category === 'Spell') {
    openSpellListPopup();
  } else {
    document.getElementById('school-selection').style.display = 'block';
  }
}
window.selectCard = selectCard;

/**
 * openSpellListPopup:
 * Shows a grouped list of spells for the user to pick from.
 */
function openSpellListPopup() {
  const spellListDiv = document.getElementById('spell-list');
  const grouped = groupSpellsBySchool(ALL_SPELLS);
  const sortedSchools = Object.keys(grouped).sort();

  let html = '';
  sortedSchools.forEach(school => {
    html += `<div class="spell-school-heading">${school}</div>`;
    const colorClass = schoolColorClass[school] || '';
    grouped[school].forEach(spell => {
      html += `
        <div class="spell-option ${colorClass}" onclick="chooseSpell(${spell.id})">
          <strong>${spell.name}</strong>
        </div>
      `;
    });
  });

  spellListDiv.innerHTML = html;
  document.getElementById('spell-selection').style.display = 'block';
}

/** 
 * closeSpellListPopup: hide the Spell List popup and reset
 */
function closeSpellListPopup() {
  document.getElementById('spell-selection').style.display = 'none';
  currentPlayer = null;
  selectedCategory = null;
}
window.closeSpellListPopup = closeSpellListPopup;

/**
 * groupSpellsBySchool: 
 * Utility to group all spells by their "school" for the popup.
 */
function groupSpellsBySchool(spellArray) {
  const groups = {};
  spellArray.forEach(spell => {
    const sch = spell.school || 'Unknown';
    if (!groups[sch]) groups[sch] = [];
    groups[sch].push(spell);
  });
  // Sort each group by spell name
  Object.keys(groups).forEach(school => {
    groups[school].sort((a, b) => a.name.localeCompare(b.name));
  });
  return groups;
}

/**
 * chooseSpell:
 * Called when the user selects a spell from the Spell popup.
 * We push that spell to the player's "spells" array in Firebase,
 * then do a full refresh (fetchAllPlayers -> updateScores -> renderDashboard)
 */
window.chooseSpell = function(spellId) {
  const chosen = ALL_SPELLS.find(s => s.id === spellId);
  if (!chosen || !currentPlayer) return;

  // 1. Read existing spells
  db.ref(`players/${currentPlayer}/spells`).once('value')
    .then(snap => {
      const spells = snap.val() || [];
      spells.push({
        id: chosen.id,
        school: chosen.school,
        name: chosen.name,
        customText: chosen.customText
      });
      // 2. Write updated array
      return db.ref(`players/${currentPlayer}/spells`).set(spells);
    })
    // 3. Refresh: fetch new data, update scores, re-render
    .then(() => fetchAllPlayers())
    .then(() => updateScores())
    .then(() => {
      renderDashboard();
      window.location.reload(); // Force a full page reload
      closeSpellListPopup(); // Close the popup after everything
    })
    .catch(err => console.error('[chooseSpell] Error:', err));
};

/**
 * selectSchool:
 * Called when user chooses a school for a Wizard/Tower/Familiar card.
 */
function selectSchool(school) {
  if (!currentPlayer || !selectedCategory) return;
  const categoryKey = selectedCategory.toLowerCase() + 's'; 
  // e.g. "wizards", "towers", or "familiars"

  // 1. Read existing array
  db.ref(`players/${currentPlayer}/${categoryKey}`).once('value')
    .then(snap => {
      const arr = snap.val() || [];
      // Add a simple object with an ID and the school
      arr.push({ id: Date.now(), school });
      // 2. Write updated array
      return db.ref(`players/${currentPlayer}/${categoryKey}`).set(arr);
    })
    // 3. Refresh
    .then(() => fetchAllPlayers())
    .then(() => updateScores())
    .then(() => {
      renderDashboard();
      window.location.reload(); // Force a full page reload
      closeSchoolSelection(); 
    })
    .catch(err => console.error('[selectSchool] Error:', err));
}
window.selectSchool = selectSchool;

/*******************************************
 * 8. Delete Mode
 *******************************************/
/**
 * deleteLastItem:
 * Toggles "delete mode" and highlights the player's cards 
 * so the user can click which card to remove.
 */
function deleteLastItem(playerId) {
  deleteMode = !deleteMode;
  console.log(deleteMode ? 'Delete mode ON' : 'Delete mode OFF');

  // Toggle highlight on that player's card items
  document.querySelectorAll(`#${playerId} .card-item`).forEach(card => {
    if (deleteMode) {
      card.classList.add('deletable-card');
      // On click, attempt to delete that specific card
      card.onclick = () => {
        const cardId = card.dataset.id;        // e.g. "168312311"
        const cat    = card.dataset.category;  // e.g. "wizards"
        confirmDeleteCard(playerId, cat, cardId);
      };
    } else {
      card.classList.remove('deletable-card');
      card.onclick = null;
    }
  });
}
window.deleteLastItem = deleteLastItem;

/**
 * confirmDeleteCard:
 * Actually removes the chosen card from the array in Firebase,
 * then does a full refresh so the UI updates.
 */
function confirmDeleteCard(playerId, category, cardId) {
  // 1. Read the player's [category] array (wizards/towers/familiars/spells)
  db.ref(`players/${playerId}/${category}`).once('value')
    .then(snap => {
      const cards = snap.val() || [];
      // Filter out the card with matching ID
      const filtered = cards.filter(c => String(c.id) !== String(cardId));
      // 2. Write updated array
      return db.ref(`players/${playerId}/${category}`).set(filtered);
    })
    // 3. Refresh
    .then(() => fetchAllPlayers())
    .then(() => updateScores())
    .then(() => {
      renderDashboard();
      window.location.reload(); // Force a full page reload
      deleteMode = false;
    })
    .catch(err => console.error('[confirmDeleteCard] Error:', err));
}
window.confirmDeleteCard = confirmDeleteCard;



/*******************************************
 * 8. Delete Mode
 *******************************************/
function deleteLastItem(playerId) {
  deleteMode = !deleteMode;
  console.log(deleteMode ? 'Delete mode ON' : 'Delete mode OFF');

  // Toggle highlight on that player's card items
  document.querySelectorAll(`#${playerId} .card-item`).forEach(card => {
    if (deleteMode) {
      card.classList.add('deletable-card');
      card.onclick = () => {
        const cardId = card.dataset.id;
        const cat = card.dataset.category; 
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
      const filtered = cards.filter(c => String(c.id) !== String(cardId));
      return db.ref(`players/${playerId}/${category}`).set(filtered);
    })
    .then(() => fetchAllPlayers())
    .then(() => updateScores())
    .then(() => {
      renderDashboard();
      window.location.reload(); // Force a full page reload
      deleteMode = false;
    })
    .catch(err => console.error('[confirmDeleteCard] Error:', err));
}
window.confirmDeleteCard = confirmDeleteCard;


/*******************************************
 * 9. Utility: highlightText
 *******************************************/
function highlightText(element) {
  if (document.createRange && window.getSelection) {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }
}
window.highlightText = highlightText;

