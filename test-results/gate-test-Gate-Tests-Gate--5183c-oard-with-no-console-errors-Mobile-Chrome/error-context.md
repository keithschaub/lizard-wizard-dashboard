# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: gate-test.spec.js >> Gate Tests >> Gate (a): Load to board with no console errors
- Location: tests/gate-test.spec.js:6:7

# Error details

```
TimeoutError: page.waitForSelector: Timeout 300000ms exceeded.
Call log:
  - waiting for locator('#game-container:not(.hidden)') to be visible

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - heading "🦎 Lizard Wizard" [level=1] [ref=e4]
  - paragraph [ref=e6]: "Failed to initialize game: Engine tests failed: Traceback (most recent call last): File \"/lib/python311.zip/_pyodide/_base.py\", line 571, in eval_code_async await CodeRunner( File \"/lib/python311.zip/_pyodide/_base.py\", line 394, in run_async coroutine = eval(self.code, globals, locals) ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ File \"<exec>\", line 10, in <module> File \"/home/pyodide/carddb.py\", line 38, in _load _DB = json.load(open(PATH)) ^^^^^^^^^^ FileNotFoundError: [Errno 44] No such file or directory: '/home/pyodide/../assets/carddb.json'"
```

# Test source

```ts
  1   | import { test, expect } from '@playwright/test';
  2   | 
  3   | test.describe('Gate Tests', () => {
  4   |   test.setTimeout(600000); // 10 minutes
  5   | 
  6   |   test('Gate (a): Load to board with no console errors', async ({ page, browser }) => {
  7   |     const errors = [];
  8   |     page.on('console', msg => {
  9   |       if (msg.type() === 'error') {
  10  |         errors.push(msg.text());
  11  |       }
  12  |     });
  13  |     
  14  |     page.on('pageerror', error => {
  15  |       errors.push(error.message);
  16  |     });
  17  | 
  18  |     await page.goto('/');
  19  |     
  20  |     // Wait for game container to become visible (engine loaded)
  21  |     console.log('Waiting for game to load...');
> 22  |     await page.waitForSelector('#game-container:not(.hidden)', { timeout: 300000 });
      |                ^ TimeoutError: page.waitForSelector: Timeout 300000ms exceeded.
  23  |     
  24  |     // Wait for board to render
  25  |     await page.waitForSelector('#board-canvas', { state: 'visible', timeout: 10000 });
  26  |     await page.waitForTimeout(3000); // Let board fully render
  27  |     
  28  |     // Take screenshot
  29  |     await page.screenshot({ 
  30  |       path: 'screenshots/gate-a-board-loaded.png',
  31  |       fullPage: true 
  32  |     });
  33  |     
  34  |     // Check for errors
  35  |     if (errors.length > 0) {
  36  |       console.log('Console errors:', errors);
  37  |       throw new Error(`Gate (a) FAILED: Console errors: ${errors.join('; ')}`);
  38  |     }
  39  |     
  40  |     // Verify board canvas is visible
  41  |     const canvasVisible = await page.locator('#board-canvas').isVisible();
  42  |     expect(canvasVisible).toBe(true);
  43  |     
  44  |     console.log('Gate (a) PASSED: Board loaded with no console errors');
  45  |   });
  46  | 
  47  |   test('Gate (d): Full playthrough - 3 rounds', async ({ page }) => {
  48  |     await page.goto('/');
  49  |     
  50  |     // Wait for game to load
  51  |     console.log('Waiting for game to load...');
  52  |     await page.waitForSelector('#game-container:not(.hidden)', { timeout: 300000 });
  53  |     await page.waitForTimeout(3000);
  54  |     
  55  |     // Get initial game state
  56  |     const getGameState = async () => {
  57  |       return await page.evaluate(() => {
  58  |         return {
  59  |           round: window.game?.gameState?.meta?.round || 0,
  60  |           players: window.game?.gameState?.players?.map(p => ({
  61  |             name: p.name,
  62  |             mana: p.mana,
  63  |             tokCount: p.tok?.length || 0,
  64  |             wizards: p.wizards?.length || 0,
  65  |             towers: p.towers?.length || 0,
  66  |             spells: p.spells?.length || 0
  67  |           })) || []
  68  |         };
  69  |       });
  70  |     };
  71  |     
  72  |     let state = await getGameState();
  73  |     console.log('Initial state:', JSON.stringify(state, null, 2));
  74  |     
  75  |     const initialRound = state.round;
  76  |     let actionCount = 0;
  77  |     
  78  |     // Play at least 3 rounds
  79  |     for (let round = 0; round < 5; round++) {
  80  |       console.log(`\n=== Attempting Round ${round + 1} ===`);
  81  |       
  82  |       // Try gather action - tap reagent deck area
  83  |       try {
  84  |         await page.click('#board-canvas', { position: { x: 100, y: 100 } });
  85  |         await page.waitForTimeout(1000);
  86  |         
  87  |         const gatherVisible = await page.locator('#gather-ui:not(.hidden)').isVisible().catch(() => false);
  88  |         if (gatherVisible) {
  89  |           console.log('Gather UI opened');
  90  |           await page.screenshot({ path: `screenshots/gate-d-round${round+1}-gather.png` });
  91  |           
  92  |           // Select reagents if any
  93  |           const reagentCount = await page.locator('.reagent-option').count();
  94  |           if (reagentCount > 0) {
  95  |             await page.locator('.reagent-option').first().click();
  96  |             await page.waitForTimeout(500);
  97  |           }
  98  |           actionCount++;
  99  |         }
  100 |       } catch (e) {
  101 |         console.log('Gather failed:', e.message);
  102 |       }
  103 |       
  104 |       // Tap board center to close any overlays
  105 |       await page.click('#board-canvas', { position: { x: 200, y: 400 } });
  106 |       await page.waitForTimeout(1000);
  107 |       
  108 |       // Check if state changed
  109 |       const newState = await getGameState();
  110 |       console.log('State after actions:', JSON.stringify(newState, null, 2));
  111 |       
  112 |       // If round advanced, good
  113 |       if (newState.round > state.round) {
  114 |         console.log(`✓ Round advanced from ${state.round} to ${newState.round}`);
  115 |         state = newState;
  116 |       }
  117 |       
  118 |       await page.waitForTimeout(2000);
  119 |     }
  120 |     
  121 |     const finalState = await getGameState();
  122 |     console.log('\nFinal state:', JSON.stringify(finalState, null, 2));
```