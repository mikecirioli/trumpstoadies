# Feature Brief: "My Representatives" State Directory & Vote Tracker

## 1. Objective
Provide users with a frictionless, highly local way to find their state’s federal delegation (Senators & Representatives), see their overall Trump-alignment score, and audit their specific votes on key measures.

---

## 2. User Experience (UX)

### Flow & Interface
1.  **The Entry Point (Homepage or Dedicated Page `/toadies/my-reps/`):**
    *   A clean, prominent dropdown selector: **"Select your state to find your representatives."**
    *   *(Optional Visual Accent)*: A simple interactive SVG map of the US.
2.  **The State Dashboard:**
    Once a state is selected (e.g., Texas), the user is presented with a dashboard split into two main sections:
    *   **U.S. Senate (2 cards):** Displays both Senators with their party, image, and their **Overall Alignment Score** (percentage of "Yay" votes on tracked bills).
    *   **U.S. House of Representatives (N cards sorted by District):** Displays all Representatives from that state, ordered by district number, showing their name, party, district, and **Overall Alignment Score**.
3.  **The Quick-Audit Vote List:**
    Clicking any representative opens an inline expandable drawer (or routes to their existing profile) containing a simple, chronological ledger of their recent votes:
    *   `[Date] | [Bill Number & Title] | Vote: [Yay (Red) / Nay (Blue)]`

---

## 3. Technical Architecture (Astro Static Site)

Because the "Trump's Toadies" website is built as a static Astro application, we want to maintain the benefits of static rendering (instant loads, perfect SEO, zero server load) while making the state-selection experience feel interactive.

We can achieve this via a **Hybrid Static + Client-Side Filtering** approach:

### Route Structure
*   **Main Directory:** `/toadies/people/` (We can embed the selector directly into the existing People directory).
*   **Static State Pages (SEO Friendly):** `/toadies/states/[state]/` (e.g., `/toadies/states/tx/`)
    *   We will use Astro's `getStaticPaths()` to generate a dedicated page for all 50 states + territories. 
    *   *Benefit:* Users can bookmark or share direct links to their state's record (e.g., *"Look at how all Florida representatives voted on S.2"*).

### Data Layer (No New APIs Required!)
We already have **100% of the data needed** inside your existing JSON files:
*   `subjects.json` contains: `id`, `name`, `type` (Representative/Senator), `state`, `district`, `party`, `description`, and contact info.
*   `actions.json` contains: every tracked vote linked to `subjectId`.
*   `rankings.json` contains: the pre-calculated alignment percentage (`score`), `pro` count, and `total` count.

---

## 4. Implementation Plan

### Phase 1: Create the Static State Pages
1.  Create a new Astro page: `trumpstoadies/src/pages/states/[state].astro`.
2.  Implement `getStaticPaths()` to group all legislators in `subjects.json` by state.
3.  Design the state page layout with:
    *   Overall State Alignment Rank (e.g., *"Texas is the #12 most aligned delegation"*).
    *   Dual lists (Senate vs. House) using clean, responsive cards.

### Phase 2: Add State Selector to Homepage / People Page
1.  Add a dropdown `<select>` element to the main landing page and the directory.
2.  Write a simple, vanilla client-side JS script to route the browser when a state is chosen.
