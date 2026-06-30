#!/bin/bash
set -e

# Ignore specific untracked files if they shouldn't be committed
echo "Movo_Product_Description.docx" >> .gitignore
echo ".claude/" >> .gitignore
git add .gitignore
git commit -m "chore: update gitignore" || true

# Commit 1: Assets
git add public/logo.png index.html src-tauri/icons/ public/vite.svg public/tauri.svg
git commit -m "chore(assets): update app logo and favicon

- Replaced default Tauri/Vite icons with Movo brand logo
- Updated index.html title and favicon
- Generated all platform-specific icon sizes" || true

# Commit 3: Tray Popup
git add src/components/TrayPopup.tsx src-tauri/tauri.conf.json src-tauri/src/lib.rs
git commit -m "feat(tray): rewrite tray popup as inline chat panel

- Transformed tray popup from a simple input bar into a 420x420 compact chat window
- Integrated global message state for seamless conversation continuity
- Updated Tauri window configuration and positioning logic" || true

# Commit 4: State Fixes
git add src/App.tsx src/components/EmptyState.tsx src/components/GlobalChat.tsx src/store/index.ts
git commit -m "fix(state): resolve global chat and tray capture race conditions

- Added component mounted guards to GlobalChat to prevent lost messages
- Removed redundant tray capture listener from EmptyState
- Ensured goals list is fetched before navigating to goal view" || true

# Commit 5: UI Tweaks
git add src/components/SettingsDropdown.tsx src/components/GoalDetailView.tsx
git commit -m "fix(ui): wire logout button and remove unconfigured settings

- Wired the LogOut action in SettingsDropdown
- Removed the out-of-scope Integrations menu item
- Removed the out-of-scope Update Deadline button from goal details" || true

# Commit 6: AI Context
git add src/utils/messageParser.ts src-tauri/src/ai/openai.rs src-tauri/src/commands/global_chat.rs
git commit -m "feat(ai): enforce strict context gathering and fallback options

- Updated system prompts to enforce strict context gathering before code generation
- Modified messageParser to ensure 'Other' is always provided as a fallback option in interactive questions" || true

# Commit 2: Styling (Catch-all for the remaining src/components changes)
git add src/components/
git commit -m "style: change primary brand color to blue

- Migrated primary brand color from #85D24E (green) to #4D5AE8 (blue)
- Updated hover states and text contrast for better readability across all UI components
- Replaced Sparkles placeholder icons with the Movo brand logo" || true

# Add any remaining files that might have been missed
git add .
git commit -m "chore: catch all minor updates" || true
