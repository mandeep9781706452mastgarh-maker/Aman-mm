# Prompt to Video

Type a video prompt, add up to 3 photos, get a real AI-generated video (with sound).
Uses Google's Gemini Omni Flash video model through the Gemini API.

## What you need
1. A Gemini API key from https://aistudio.google.com (video generation is a paid feature; check the current price at https://ai.google.dev/gemini-api/docs/pricing).
2. Node.js 18 or newer.

## Run on a computer
    export GEMINI_API_KEY=your-key-here
    export APP_PASSWORD=pick-a-password     # recommended, so strangers can't spend your money
    node server.js
Open http://localhost:3000

## Put it online (so you can use it on your phone)
Deploy this folder to any Node host (Render, Railway, Fly.io). Start command: `node server.js`.
Set the environment variables GEMINI_API_KEY and APP_PASSWORD in the host's settings.
Never put the key in the web page itself.

## Notes
- One clip is a few seconds long, not a full minute. Longer videos need extra "extend" steps (not built yet).
- If the service rejects a prompt or photo, the app shows the service's message.
- Written against Google's Gemini Omni Flash docs; not yet tried with a real key.
