// Use the globally available `db` from firebase-init.js
// Reference to all players in Firebase
const playersRef = db.ref("players");

playersRef.on("value", (snapshot) => {
    console.log("Real-time data from Firebase:", snapshot.val());
    const players = snapshot.val() || {};
    renderDashboard(players);
});


// Event listener for the End Game button
document.getElementById("trigger-endgame-button").addEventListener("click", () => {
    triggerEndGame();
});

// Function to trigger end game and assign bonuses
function triggerEndGame() {
    const endGameRef = db.ref("endGameTriggered");

    // Check if the end game has already been triggered
    endGameRef.once("value").then((snapshot) => {
        if (snapshot.val()) {
            alert("End Game has already been triggered. No additional bonuses can be awarded.");
            return; // Exit if the end game is already triggered
        }

        // Proceed to calculate and assign bonuses
        playersRef.once("value").then((playersSnapshot) => {
            const players = playersSnapshot.val() || {};
            let firstToSeven = null;

            // Step 1: Identify the first player to reach 7+ cards
            Object.entries(players).forEach(([id, player]) => {
                if (player.district && player.district.length >= 7 && !firstToSeven) {
                    firstToSeven = id;
                }
            });

            // Step 2: Calculate and prepare updates for bonuses
            const updates = {};
            Object.entries(players).forEach(([id, player]) => {
                let bonus = 0;

                if (id === firstToSeven) {
                    bonus = 4; // First player bonus
                } else if (player.district && player.district.length >= 7) {
                    bonus = 2; // Other players with 7+ cards
                }

                // Update player scores
                if (bonus > 0) {
                    updates[`players/${id}/score`] = (player.score || 0) + bonus;
                }
            });

            // Step 3: Set the endGameTriggered flag and update player scores
            if (Object.keys(updates).length > 0) {
                updates["endGameTriggered"] = true; // Set flag in Firebase

                db.ref().update(updates).then(() => {
                    alert("End Game Triggered! Bonuses have been awarded.");
                });
            } else {
                alert("No players have 7 or more cards.");
            }
        });
    });
}

// Function to monitor card counts and reset the endGameTriggered flag if necessary
function monitorCardCounts() {
    playersRef.on("value", (snapshot) => {
        const players = snapshot.val() || {};

        // Check if all players have fewer than 7 cards
        const allBelowSeven = Object.values(players).every(
            (player) => !player.district || player.district.length < 7
        );

        if (allBelowSeven) {
            // Reset the endGameTriggered flag if it was previously set
            db.ref("endGameTriggered").set(false).then(() => {
                console.log("End Game Trigger reset because all players have fewer than 7 cards.");
            });
        }
    });
}

// Call monitorCardCounts to start monitoring card counts
monitorCardCounts();




// Render the 3x3 dashboard
function renderDashboard(players) {
    const dashboardGrid = document.getElementById("dashboard-grid");
    dashboardGrid.innerHTML = ""; // Clear existing content

    Object.entries(players).forEach(([id, player]) => {
        const playerDiv = document.createElement("div");
        playerDiv.className = "player-tile";

        // Render the district cards
        const districtCards = player.district
            ? player.district
                  .map((card) => {
                      // Ensure card data exists before rendering
                      const name = card.name || "Unknown Card";
                      const points = card.points || 0;
                      const color = card.color || "default";

                      return `
                          <span class="card ${color}">
                              ${name} ${points}
                              ${
                                  card.description
                                      ? `<br><small>${card.description}</small>`
                                      : ""
                              }
                          </span>
                      `;
                  })
                  .join("")
            : "No cards";

        // Player tile content
        playerDiv.innerHTML = `
            <h2>${player.name || `Player ${id}`}</h2>
            <p>Score: ${player.score || 0}</p>
            <div class="player-cards">${districtCards}</div>
        `;

        // Click to navigate to the player's page
        playerDiv.addEventListener("click", () => {
            window.location.href = `player${id}.html?id=${id}`;
        });

        dashboardGrid.appendChild(playerDiv);
    });
}
