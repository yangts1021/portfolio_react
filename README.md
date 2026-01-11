# Portfolio React

This is a personal portfolio website built with React, Vite, and TypeScript.

## Features

- **React 19** with **Vite** for fast development.
- **TypeScript** for type safety.
- **ESLint** & **Prettier** for code quality.
- **Recharts** for data visualization.
- **GitHub Actions** for automatic deployment to GitHub Pages.

## Getting Started

### Prerequisites

- Node.js (v18 or higher recommended)
- npm

### Installation

1. Clone the repository:

   ```bash
   git clone <repository-url>
   cd portfolio_react
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

## Development

To start the development server:

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

## Scripts

- `npm run dev`: Start dev server.
- `npm run build`: Build for production.
- `npm run preview`: Preview the production build locally.
- `npm run lint`: Run ESLint to check for code quality issues.
- `npm run format`: Auto-format code with Prettier.
- `npm run deploy`: Deploy the app to GitHub Pages (gh-pages branch).

## Deployment

This project is configured to automatically deploy to GitHub Pages when changes are pushed to the `main` branch.

To manually deploy:

```bash
npm run deploy
```

## Folder Structure

- `src/`: Source code
  - `components/`: Reusable React components
  - `utils/`: Utility functions
- `public/`: Static assets
- `.github/workflows/`: CI/CD configurations
- `dist/`: Production build output (created after build)
