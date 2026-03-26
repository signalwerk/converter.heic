# HEIC Converter

A small browser-based app for converting `.heic` and `.heif` images into `JPEG` or `PNG`.

The app runs fully client-side in the browser. Files are processed locally and are not uploaded to a server.

## Features

- Drag and drop one or more HEIC/HEIF files
- Convert to JPEG or PNG
- Choose JPEG quality presets or a custom quality value
- Resize by max width or max height before download
- Download files individually or all at once

## Tech Stack

- React 19
- TypeScript
- Vite
- [`heic-to`](https://www.npmjs.com/package/heic-to) for browser-side HEIC conversion
- [`file-saver`](https://www.npmjs.com/package/file-saver) for downloads

## Development

```bash
npm install
npm run dev
```

The local dev server usually starts at `http://localhost:5173`.

## Scripts

- `npm run dev` starts the Vite development server
- `npm run build` creates a production build in `dist/`
- `npm run preview` previews the production build locally
- `npm run lint` runs ESLint

## GitHub Pages Deployment

This repository includes a GitHub Actions workflow that builds the app and deploys `dist/` to GitHub Pages whenever code is pushed to `main`.

### One-time GitHub setup

1. Push this repository to GitHub.
2. In GitHub, open `Settings` -> `Pages`.
3. Under `Build and deployment`, set `Source` to `GitHub Actions`.
4. Make sure your default deployment branch is `main`, or update the workflow if you use a different branch.

### Notes

- The Vite config automatically uses the correct base path when building on GitHub Actions for project pages such as `https://username.github.io/repository-name/`.
- If this repo is published as a user or organization site like `https://username.github.io/`, the app keeps using `/` as the base path.

## Project Structure

```text
.
├── public/
├── src/
├── .github/workflows/
├── index.html
├── package.json
└── vite.config.ts
```
