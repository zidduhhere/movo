<div align="center">
  <img src="public/logo.png" alt="Movo Logo" width="120" />
  <h1>Movo</h1>
  <p>Your AI-Powered Chief of Staff</p>
</div>

---

## 🚀 Download

You can download the latest macOS release of Movo below:

📥 **[Download Movo for macOS (.dmg) - Google Drive](https://drive.google.com/file/d/1dPM8Q1DAL6CE9A48LteFYy4E93rmaVQY/view?usp=sharing)**

> **Note:** Since this app is an unsigned developer build, macOS might show a warning when you open it. To bypass this, go to **System Settings > Privacy & Security** and click **Open Anyway**.

---

## 📖 Overview

Movo is a desktop application designed to act as your personal AI Chief of Staff. Instead of manually juggling tasks, calendars, and goals, you simply chat with Movo. Tell Movo what you want to achieve, and it will break down your goals, create tasks, and schedule them into your calendar based on your preferred working hours and focus blocks.

Built for speed and deep focus, Movo features both a rich main window and a quick-capture Tray Popup for rapid, frictionless interactions without breaking your workflow.

## ✨ Features

- 🧠 **Global AI Chat:** Converse naturally with your AI assistant to plan projects, ask questions, and delegate task creation.
- ⚡ **Quick-Capture Tray:** A compact, 420x420 globally accessible menu bar popup for rapid task entry and seamless AI chat continuity.
- 🎙️ **Voice Input:** Speak your thoughts aloud and let Movo transcribe and process your requests instantly.
- 📅 **Intelligent Scheduling Engine:** Set your working hours, preferred focus block lengths, and days off. Movo automatically finds the perfect time to schedule your tasks.
- 🎯 **Goal & Task Tracking:** Organize your life into high-level Goals and actionable Tasks with deadlines.

## 🛠️ Tech Stack

Movo is built with a modern, high-performance stack prioritizing speed, minimal footprint, and beautiful UI:

**Frontend:**
- [React 19](https://react.dev/)
- [TypeScript](https://www.typescriptlang.org/)
- [Vite](https://vitejs.dev/)
- [Tailwind CSS v4](https://tailwindcss.com/)
- [Zustand](https://zustand-demo.pmnd.rs/) (State Management)
- [Framer Motion](https://www.framer.com/motion/) (Animations)
- [Lucide React](https://lucide.dev/) (Icons)

**Backend & Desktop Integration:**
- [Tauri v2](https://v2.tauri.app/) (Rust)
- SQLite (Local Database)

## 💻 Development Setup

If you want to build Movo from source or contribute to the project, follow these steps:

### Prerequisites
1. **Node.js** (v18 or newer)
2. **Rust** (Follow the [Tauri Prerequisites guide](https://v2.tauri.app/start/prerequisites/))

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-username/movo.git
   cd movo
   ```

2. **Install frontend dependencies:**
   ```bash
   npm install
   ```

3. **Set up Environment Variables:**
   Create a `.env` file inside the `src-tauri/` directory (i.e., `src-tauri/.env`) and add your AI provider configuration. The following variables are supported:
   
   ```env
   # Required: Your OpenAI (or compatible provider) API key
   OPENAI_API_KEY=your_api_key_here
   
   # Optional: Override the base URL if you're using a custom endpoint or alternative provider (e.g., AWS Bedrock, local LLM)
   OPENAI_BASE_URL=https://api.openai.com/v1
   
   # Optional: Specify the model name to use (defaults to gpt-4o)
   OPENAI_MODEL=gpt-4o
   ```

4. **Run the development server:**
   ```bash
   npm run tauri dev
   ```

### Building for Production

To build the optimized `.app` and `.dmg` bundles:

```bash
npm run tauri build
```
The output bundles will be generated in `src-tauri/target/release/bundle/`.

## 🤝 Contributing

Contributions are welcome! Feel free to open an issue or submit a Pull Request if you'd like to improve Movo.

## 📄 License

This project is licensed under the MIT License.
